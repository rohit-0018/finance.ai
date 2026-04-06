// Atomic-ish plan commit. supabase-js doesn't give us a real transaction, so
// we go best-effort: create the project, create all tasks, mark the plan
// committed, mark the brainstorm committed. If any step fails we try to
// clean up what we created. A true transaction lives in a future edge
// function — for now this is close enough for single-user admin use.
import type {
  LifeBrainstorm,
  LifePlan,
  PlanSnapshot,
  LifeUser,
  LifeTask,
} from '../types'
import { createProject, deleteProject } from './db/projects'
import { createTask, deleteTask } from './db/tasks'
import { markPlanCommitted, updatePlanSnapshot } from './db/plans'
import { updateBrainstorm } from './db/brainstorms'
import { addCommittedMinutes } from './db/capacity'
import { pushTaskToCalendar } from './google/sync'
import { getIntegration, createNotification, listWorkspaces } from './db'

export interface CommitBrainstormInput {
  user: LifeUser
  brainstorm: LifeBrainstorm
  plan: LifePlan
  /** Calibrated snapshot from commitGates. Use this, not plan.snapshot. */
  snapshot: PlanSnapshot
  /** Optional: category override ("office" for work, else "personal"). */
  category?: 'office' | 'personal' | 'health' | 'learn'
}

export interface CommitBrainstormOutput {
  projectId: string
  taskIds: string[]
}

export async function commitBrainstorm(
  input: CommitBrainstormInput
): Promise<CommitBrainstormOutput> {
  const { user, brainstorm, plan, snapshot } = input
  const createdTaskIds: string[] = []
  let createdProjectId: string | null = null

  try {
    // 1. Persist the final snapshot (in case gates mutated it).
    await updatePlanSnapshot(user.id, plan.id, snapshot)

    // 2. Create the project.
    const project = await createProject({
      userId: user.id,
      workspaceId: brainstorm.workspace_id,
      name: brainstorm.title,
      description: brainstorm.context.why_now ?? undefined,
      category: input.category ?? 'personal',
      goal_id: null,
      definition_of_done: snapshot.definition_of_done,
      contract_mode: true, // committed plans are contracts by default
      brainstorm_id: brainstorm.id,
    })
    createdProjectId = project.id

    // 3. Create tasks. Dependencies are remapped from temp_ids to real ids
    //    after the first pass — we insert in two sweeps.
    const tempToReal = new Map<string, string>()
    const pending = [...snapshot.tasks]

    // First pass — insert tasks without dependencies (or empty depends_on)
    const firstPass = pending.filter((t) => !t.depends_on || t.depends_on.length === 0)
    for (const t of firstPass) {
      const row = await createTask({
        userId: user.id,
        workspaceId: brainstorm.workspace_id,
        project_id: project.id,
        plan_id: plan.id,
        title: t.title,
        notes: t.notes ?? undefined,
        estimate_min: t.estimate_min ?? null,
        priority: t.priority ?? 3,
        start_at: t.start_at ?? null,
        due_at: t.due_at ?? null,
        scheduled_for: t.start_at?.slice(0, 10) ?? null,
        when_where: t.when_where ?? null,
        first_action: t.first_action ?? null,
        hard_start: Boolean(t.when_where && (t.priority ?? 3) <= 1),
        depends_on: [],
        source: 'plan',
      })
      createdTaskIds.push(row.id)
      tempToReal.set(t.temp_id, row.id)
    }

    // Second pass — insert dependent tasks, remapping depends_on.
    const remaining = pending.filter((t) => t.depends_on && t.depends_on.length > 0)
    // Iterate until all are inserted (dependency chains may be multi-level).
    let safety = remaining.length * 2
    while (remaining.length > 0 && safety-- > 0) {
      for (let i = 0; i < remaining.length; i++) {
        const t = remaining[i]
        const allDepsResolved = (t.depends_on ?? []).every((d) => tempToReal.has(d))
        if (!allDepsResolved) continue
        const row = await createTask({
          userId: user.id,
          workspaceId: brainstorm.workspace_id,
          project_id: project.id,
          plan_id: plan.id,
          title: t.title,
          notes: t.notes ?? undefined,
          estimate_min: t.estimate_min ?? null,
          priority: t.priority ?? 3,
          start_at: t.start_at ?? null,
          due_at: t.due_at ?? null,
          scheduled_for: t.start_at?.slice(0, 10) ?? null,
          when_where: t.when_where ?? null,
          first_action: t.first_action ?? null,
          hard_start: Boolean(t.when_where && (t.priority ?? 3) <= 1),
          depends_on: (t.depends_on ?? []).map((d) => tempToReal.get(d)!).filter(Boolean),
          source: 'plan',
        })
        createdTaskIds.push(row.id)
        tempToReal.set(t.temp_id, row.id)
        remaining.splice(i, 1)
        i--
      }
    }
    if (remaining.length > 0) {
      throw new Error(`Could not resolve dependencies for: ${remaining.map((t) => t.title).join(', ')}`)
    }

    // 4. Update per-day capacity committed_min so the next brainstorm's
    //    capacity gate sees the load.
    const byDate = new Map<string, number>()
    for (const t of snapshot.tasks) {
      if (!t.start_at || !t.estimate_min) continue
      const date = t.start_at.slice(0, 10)
      byDate.set(date, (byDate.get(date) ?? 0) + t.estimate_min)
    }
    for (const [date, minutes] of byDate) {
      await addCommittedMinutes(user.id, date, minutes)
    }

    // 5. Mark plan + brainstorm committed.
    await markPlanCommitted(user.id, plan.id, project.id)
    await updateBrainstorm(user.id, brainstorm.id, {
      status: 'committed',
      project_id: project.id,
      committed_at: new Date().toISOString(),
    })

    // 6a. Cross-workspace notice — so if you just committed in Work, the
    //     Personal dashboard surfaces a "Work committed: <title> (N tasks)"
    //     pill on its next load. Non-fatal.
    try {
      const workspaces = await listWorkspaces(user.id)
      const other = workspaces.find((w) => w.id !== brainstorm.workspace_id)
      if (other) {
        await createNotification({
          userId: user.id,
          workspaceId: other.id,
          kind: 'agent_message',
          title: `${brainstorm.workspace_id === other.id ? '' : 'Other workspace'} committed: ${brainstorm.title}`,
          body: `${snapshot.tasks.length} tasks, ${snapshot.tasks.filter((t) => t.start_at).length} scheduled.`,
          link: `/life/projects/${project.id}`,
        })
      }
    } catch {/* non-fatal */}

    // 6. Push scheduled tasks to Google Calendar if the user has connected it.
    //    Non-fatal: if anything fails here the commit still holds.
    try {
      const integration = await getIntegration(user.id, 'google_calendar')
      if (integration) {
        const { lifeDb } = await import('./db/_client')
        const { data } = await lifeDb()
          .from('life_tasks')
          .select('*')
          .in('id', createdTaskIds)
        const rows = (data ?? []) as LifeTask[]
        for (const row of rows) {
          if (!row.start_at) continue
          await pushTaskToCalendar(user, row).catch(() => {/* skip individual failures */})
        }
      }
    } catch {
      /* calendar push is best-effort */
    }

    return { projectId: project.id, taskIds: createdTaskIds }
  } catch (err) {
    // Best-effort rollback.
    for (const taskId of createdTaskIds) {
      await deleteTask(user.id, taskId).catch(() => {/* ignore */})
    }
    if (createdProjectId) {
      await deleteProject(user.id, createdProjectId).catch(() => {/* ignore */})
    }
    throw err
  }
}
