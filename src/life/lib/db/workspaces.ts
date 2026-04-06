import { lifeDb } from './_client'
import type { LifeWorkspace, WorkspaceKind } from '../../types'

const DEFAULT_ACCENTS: Record<WorkspaceKind, string> = {
  personal: '#6c63ff',
  work: '#0ea5e9',
}

const DEFAULT_NAMES: Record<WorkspaceKind, string> = {
  personal: 'Personal',
  work: 'Work',
}

/** List every workspace for a user, ordered personal → work. */
export async function listWorkspaces(userId: string): Promise<LifeWorkspace[]> {
  const { data, error } = await lifeDb()
    .from('life_workspaces')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listWorkspaces: ${error.message}`)
  return (data ?? []) as LifeWorkspace[]
}

/**
 * Guarantee that a user has both 'personal' and 'work' workspaces, and return
 * them. Called on first mount after ensureLifeUser. Idempotent — existing
 * rows are untouched, missing kinds are inserted.
 */
export async function ensureDefaultWorkspaces(userId: string): Promise<LifeWorkspace[]> {
  const current = await listWorkspaces(userId)
  const have = new Set(current.map((w) => w.kind))
  const toInsert: Array<{ user_id: string; kind: WorkspaceKind; name: string; accent_color: string }> = []
  for (const kind of ['personal', 'work'] as const) {
    if (!have.has(kind)) {
      toInsert.push({
        user_id: userId,
        kind,
        name: DEFAULT_NAMES[kind],
        accent_color: DEFAULT_ACCENTS[kind],
      })
    }
  }
  if (toInsert.length === 0) return current

  const { error } = await lifeDb().from('life_workspaces').insert(toInsert)
  if (error) throw new Error(`ensureDefaultWorkspaces: ${error.message}`)
  return listWorkspaces(userId)
}

export async function updateWorkspace(
  userId: string,
  id: string,
  patch: Partial<Pick<LifeWorkspace, 'name' | 'accent_color' | 'settings'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_workspaces')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateWorkspace: ${error.message}`)
}
