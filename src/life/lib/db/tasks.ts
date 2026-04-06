import { lifeDb } from './_client'
import { resolveDefaultWorkspaceId } from './_defaults'
import { todayLocal } from '../time'
import type { LifeTask, TaskStatus, TaskAutomation, TaskSource } from '../../types'

export async function listTasksForDate(
  userId: string,
  date: string,
  workspaceId?: string
): Promise<LifeTask[]> {
  let q = lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('scheduled_for', date)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`listTasksForDate: ${error.message}`)
  return (data ?? []) as LifeTask[]
}

export async function listOverdueOpenTasks(
  userId: string,
  beforeDate: string,
  workspaceId?: string
): Promise<LifeTask[]> {
  let q = lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .lt('scheduled_for', beforeDate)
    .in('status', ['todo', 'doing'])
    .order('scheduled_for', { ascending: true })
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`listOverdueOpenTasks: ${error.message}`)
  return (data ?? []) as LifeTask[]
}

export async function listTasksForProject(
  userId: string,
  projectId: string,
  limit = 50
): Promise<LifeTask[]> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listTasksForProject: ${error.message}`)
  return (data ?? []) as LifeTask[]
}

export async function createTask(input: {
  userId: string
  /** Optional — resolves to the user's active workspace (default: personal) when omitted. */
  workspaceId?: string
  title: string
  notes?: string
  project_id?: string | null
  goal_id?: string | null
  scheduled_for?: string | null
  start_at?: string | null
  due_at?: string | null
  estimate_min?: number | null
  priority?: number
  tags?: string[]
  source?: TaskSource
  when_where?: string | null
  first_action?: string | null
  hard_start?: boolean
  depends_on?: string[]
  automation?: TaskAutomation
  origin_message_id?: string | null
  plan_id?: string | null
}): Promise<LifeTask> {
  const workspaceId = input.workspaceId ?? (await resolveDefaultWorkspaceId(input.userId))
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .insert({
      user_id: input.userId,
      workspace_id: workspaceId,
      title: input.title,
      notes: input.notes ?? null,
      project_id: input.project_id ?? null,
      goal_id: input.goal_id ?? null,
      scheduled_for: input.scheduled_for ?? todayLocal(),
      start_at: input.start_at ?? null,
      due_at: input.due_at ?? null,
      estimate_min: input.estimate_min ?? null,
      priority: input.priority ?? 3,
      tags: input.tags ?? [],
      source: input.source ?? 'manual',
      when_where: input.when_where ?? null,
      first_action: input.first_action ?? null,
      hard_start: input.hard_start ?? false,
      depends_on: input.depends_on ?? [],
      automation: input.automation ?? {},
      origin_message_id: input.origin_message_id ?? null,
      plan_id: input.plan_id ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createTask: ${error.message}`)
  return data as LifeTask
}

export async function updateTaskStatus(
  userId: string,
  id: string,
  status: TaskStatus
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (status === 'done') patch.done_at = new Date().toISOString()
  const { error } = await lifeDb()
    .from('life_tasks')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateTaskStatus: ${error.message}`)
}

export async function updateTask(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeTask, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_tasks')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateTask: ${error.message}`)
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb().from('life_tasks').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new Error(`deleteTask: ${error.message}`)
}

/** Project finish-rate — done / (done + open) within the project. */
export async function projectFinishRate(
  userId: string,
  projectId: string
): Promise<{ done: number; open: number; rate: number }> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('status')
    .eq('user_id', userId)
    .eq('project_id', projectId)
  if (error) throw new Error(`projectFinishRate: ${error.message}`)
  let done = 0
  let open = 0
  for (const row of (data ?? []) as { status: string }[]) {
    if (row.status === 'done') done++
    else if (row.status === 'todo' || row.status === 'doing') open++
  }
  const total = done + open
  return { done, open, rate: total === 0 ? 0 : done / total }
}
