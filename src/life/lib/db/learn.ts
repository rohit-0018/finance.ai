import { lifeDb } from './_client'
import type { LifeLearnItem, LearnStatus, LearnSourceType } from '../../types'

export async function listLearnItems(
  userId: string,
  status?: LearnStatus
): Promise<LifeLearnItem[]> {
  let q = lifeDb()
    .from('life_learn_items')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(`listLearnItems: ${error.message}`)
  return (data ?? []) as LifeLearnItem[]
}

export async function createLearnItem(input: {
  userId: string
  title: string
  source_url?: string | null
  source_type?: LearnSourceType
  papermind_id?: string | null
  topic?: string | null
  notes?: string | null
}): Promise<LifeLearnItem> {
  const { data, error } = await lifeDb()
    .from('life_learn_items')
    .insert({
      user_id: input.userId,
      title: input.title,
      source_url: input.source_url ?? null,
      source_type: input.source_type ?? 'manual',
      papermind_id: input.papermind_id ?? null,
      topic: input.topic ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createLearnItem: ${error.message}`)
  return data as LifeLearnItem
}

export async function updateLearnItem(
  userId: string,
  id: string,
  patch: Partial<Pick<LifeLearnItem, 'status' | 'notes' | 'topic' | 'title'>>
): Promise<void> {
  const next: Record<string, unknown> = { ...patch }
  if (patch.status === 'done') next.completed_at = new Date().toISOString()
  const { error } = await lifeDb()
    .from('life_learn_items')
    .update(next)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateLearnItem: ${error.message}`)
}

export async function deleteLearnItem(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_learn_items')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteLearnItem: ${error.message}`)
}

export async function getImportedPapermindIds(userId: string): Promise<Set<string>> {
  const { data, error } = await lifeDb()
    .from('life_learn_items')
    .select('papermind_id')
    .eq('user_id', userId)
    .not('papermind_id', 'is', null)
  if (error) throw new Error(`getImportedPapermindIds: ${error.message}`)
  return new Set((data ?? []).map((r: { papermind_id: string }) => r.papermind_id))
}
