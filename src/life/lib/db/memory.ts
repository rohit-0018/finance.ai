import { lifeDb } from './_client'
import type { LifeMemory, MemorySource } from '../../types'

export async function listMemory(
  userId: string,
  workspaceId?: string | null
): Promise<LifeMemory[]> {
  let q = lifeDb()
    .from('life_memory')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  // workspace-scoped OR shared (workspace_id is null)
  if (workspaceId !== undefined) {
    q = workspaceId
      ? q.or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
      : q.is('workspace_id', null)
  }
  const { data, error } = await q
  if (error) throw new Error(`listMemory: ${error.message}`)
  return (data ?? []) as LifeMemory[]
}

export async function upsertMemory(input: {
  userId: string
  workspaceId?: string | null
  key: string
  value: string
  source?: MemorySource
  confidence?: number
}): Promise<LifeMemory> {
  const { data, error } = await lifeDb()
    .from('life_memory')
    .upsert(
      {
        user_id: input.userId,
        workspace_id: input.workspaceId ?? null,
        key: input.key,
        value: input.value,
        source: input.source ?? 'user',
        confidence: input.confidence ?? 1.0,
      },
      { onConflict: 'user_id,workspace_id,key' }
    )
    .select()
    .single()
  if (error) throw new Error(`upsertMemory: ${error.message}`)
  return data as LifeMemory
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_memory')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteMemory: ${error.message}`)
}
