import { lifeDb } from './_client'
import type { LifeBrainstorm, BrainstormPhase, BrainstormStatus } from '../../types'

export async function listBrainstorms(
  userId: string,
  opts: { workspaceId?: string; status?: BrainstormStatus; limit?: number } = {}
): Promise<LifeBrainstorm[]> {
  let q = lifeDb()
    .from('life_brainstorms')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (opts.workspaceId) q = q.eq('workspace_id', opts.workspaceId)
  if (opts.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) throw new Error(`listBrainstorms: ${error.message}`)
  return (data ?? []) as LifeBrainstorm[]
}

export async function getBrainstorm(
  userId: string,
  id: string
): Promise<LifeBrainstorm | null> {
  const { data, error } = await lifeDb()
    .from('life_brainstorms')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getBrainstorm: ${error.message}`)
  return (data as LifeBrainstorm) ?? null
}

export async function createBrainstorm(input: {
  userId: string
  workspaceId: string
  title: string
}): Promise<LifeBrainstorm> {
  const { data, error } = await lifeDb()
    .from('life_brainstorms')
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      title: input.title,
      phase: 'goal',
      status: 'open',
      context: {},
    })
    .select()
    .single()
  if (error) throw new Error(`createBrainstorm: ${error.message}`)
  return data as LifeBrainstorm
}

export async function updateBrainstorm(
  userId: string,
  id: string,
  patch: Partial<
    Pick<LifeBrainstorm, 'title' | 'phase' | 'status' | 'summary' | 'context' | 'project_id'>
  > & { committed_at?: string }
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_brainstorms')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateBrainstorm: ${error.message}`)
}

export async function setBrainstormPhase(
  userId: string,
  id: string,
  phase: BrainstormPhase
): Promise<void> {
  await updateBrainstorm(userId, id, { phase })
}
