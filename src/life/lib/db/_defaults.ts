// Resolves a user's default workspace_id when legacy call sites (pre-Phase-1)
// don't pass one explicitly. Prefers life_users.active_workspace_id; falls
// back to the 'personal' workspace; throws if none exists (user didn't run
// ensureDefaultWorkspaces).
//
// Results are cached in-memory for the lifetime of the page so we don't issue
// an extra round-trip on every create call.
import { lifeDb } from './_client'

const cache = new Map<string, string>()

export async function resolveDefaultWorkspaceId(userId: string): Promise<string> {
  const cached = cache.get(userId)
  if (cached) return cached

  const db = lifeDb()
  const userRow = await db
    .from('life_users')
    .select('active_workspace_id')
    .eq('id', userId)
    .maybeSingle()
  if (userRow.error) throw new Error(`resolveDefaultWorkspaceId: ${userRow.error.message}`)

  let workspaceId = (userRow.data as { active_workspace_id: string | null } | null)
    ?.active_workspace_id as string | null

  if (!workspaceId) {
    const ws = await db
      .from('life_workspaces')
      .select('id')
      .eq('user_id', userId)
      .eq('kind', 'personal')
      .maybeSingle()
    if (ws.error) throw new Error(`resolveDefaultWorkspaceId: ${ws.error.message}`)
    workspaceId = (ws.data as { id: string } | null)?.id ?? null
  }

  if (!workspaceId) {
    throw new Error(
      'No workspace found for user. Run Phase 0 migration and call ensureDefaultWorkspaces().'
    )
  }

  cache.set(userId, workspaceId)
  return workspaceId
}

/** Clear the cache entry (e.g. when the user switches workspaces). */
export function forgetDefaultWorkspace(userId: string): void {
  cache.delete(userId)
}
