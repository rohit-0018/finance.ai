// Cross-workspace summary — a compact, token-cheap view of what the OTHER
// workspace is up to, so an agent running in one workspace doesn't contradict
// the other.
//
// Return shape is deliberately a prose paragraph, not structured JSON. The
// brainstorm agent consumes it as extra context in the system prompt.
import { lifeDb } from './db/_client'
import type { LifeUser, LifeWorkspace } from '../types'

export interface CrossWorkspaceSummary {
  paragraph: string
  activeProjectCount: number
  scheduledCount: number
  nextCommitment: string | null
}

const EMPTY: CrossWorkspaceSummary = {
  paragraph: 'Other workspace is empty.',
  activeProjectCount: 0,
  scheduledCount: 0,
  nextCommitment: null,
}

export async function summarizeOtherWorkspace(
  user: LifeUser,
  currentWorkspaceId: string,
  allWorkspaces: LifeWorkspace[]
): Promise<CrossWorkspaceSummary> {
  const other = allWorkspaces.find((w) => w.id !== currentWorkspaceId)
  if (!other) return EMPTY

  const now = new Date()
  const sevenDaysOut = new Date(now)
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7)

  const db = lifeDb()
  const [projects, tasks] = await Promise.all([
    db
      .from('life_projects')
      .select('name, status, health')
      .eq('user_id', user.id)
      .eq('workspace_id', other.id)
      .eq('status', 'active')
      .limit(10),
    db
      .from('life_tasks')
      .select('title, start_at, due_at, priority')
      .eq('user_id', user.id)
      .eq('workspace_id', other.id)
      .in('status', ['todo', 'doing'])
      .gte('start_at', now.toISOString())
      .lte('start_at', sevenDaysOut.toISOString())
      .order('start_at', { ascending: true })
      .limit(20),
  ])

  type Proj = { name: string; status: string; health: string }
  type Task = { title: string; start_at: string | null; due_at: string | null; priority: number }

  const projectRows = (projects.data ?? []) as Proj[]
  const taskRows = (tasks.data ?? []) as Task[]
  const next = taskRows[0] ?? null

  const projectLine =
    projectRows.length > 0
      ? `${other.name} has ${projectRows.length} active project${
          projectRows.length === 1 ? '' : 's'
        } (${projectRows.slice(0, 3).map((p) => p.name).join(', ')}${
          projectRows.length > 3 ? ', …' : ''
        }).`
      : `${other.name} has no active projects.`

  const taskLine =
    taskRows.length > 0
      ? `Next 7 days: ${taskRows.length} commitment${
          taskRows.length === 1 ? '' : 's'
        } scheduled. Next up: "${next!.title}"${
          next!.start_at ? ` at ${next!.start_at.slice(0, 16).replace('T', ' ')}` : ''
        }.`
      : `Next 7 days: nothing scheduled in ${other.name}.`

  return {
    paragraph: `${projectLine} ${taskLine}`,
    activeProjectCount: projectRows.length,
    scheduledCount: taskRows.length,
    nextCommitment: next?.title ?? null,
  }
}
