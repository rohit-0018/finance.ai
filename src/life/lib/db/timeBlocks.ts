import { lifeDb } from './_client'
import { resolveDefaultWorkspaceId } from './_defaults'
import type { LifeTimeBlock, TimeBlockKind } from '../../types'

export async function listTimeBlocks(
  userId: string,
  date: string,
  workspaceId?: string
): Promise<LifeTimeBlock[]> {
  let q = lifeDb()
    .from('life_time_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .order('start_minute', { ascending: true })
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`listTimeBlocks: ${error.message}`)
  return (data ?? []) as LifeTimeBlock[]
}

export async function createTimeBlock(input: {
  userId: string
  workspaceId?: string
  date: string
  start_minute: number
  end_minute: number
  label: string
  kind?: TimeBlockKind
  task_id?: string | null
  source?: 'manual' | 'agent'
}): Promise<LifeTimeBlock> {
  const workspaceId = input.workspaceId ?? (await resolveDefaultWorkspaceId(input.userId))
  const { data, error } = await lifeDb()
    .from('life_time_blocks')
    .insert({
      user_id: input.userId,
      workspace_id: workspaceId,
      date: input.date,
      start_minute: input.start_minute,
      end_minute: input.end_minute,
      label: input.label,
      kind: input.kind ?? 'deep',
      task_id: input.task_id ?? null,
      source: input.source ?? 'manual',
    })
    .select()
    .single()
  if (error) throw new Error(`createTimeBlock: ${error.message}`)
  return data as LifeTimeBlock
}

export async function deleteTimeBlock(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_time_blocks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteTimeBlock: ${error.message}`)
}
