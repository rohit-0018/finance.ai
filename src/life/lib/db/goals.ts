import { lifeDb } from './_client'
import { resolveDefaultWorkspaceId } from './_defaults'
import type { LifeGoal, LifeCategory } from '../../types'

export async function listGoals(userId: string, workspaceId?: string): Promise<LifeGoal[]> {
  let q = lifeDb()
    .from('life_goals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`listGoals: ${error.message}`)
  return (data ?? []) as LifeGoal[]
}

export async function createGoal(input: {
  userId: string
  workspaceId?: string
  title: string
  why?: string
  category?: LifeCategory
  horizon?: 'quarter' | 'year' | 'life'
  horizonId?: string | null
  target_date?: string | null
}): Promise<LifeGoal> {
  const workspaceId = input.workspaceId ?? (await resolveDefaultWorkspaceId(input.userId))
  const { data, error } = await lifeDb()
    .from('life_goals')
    .insert({
      user_id: input.userId,
      workspace_id: workspaceId,
      title: input.title,
      why: input.why ?? null,
      category: input.category ?? 'personal',
      horizon: input.horizon ?? 'quarter',
      horizon_id: input.horizonId ?? null,
      target_date: input.target_date ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createGoal: ${error.message}`)
  return data as LifeGoal
}

export async function updateGoal(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeGoal, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_goals')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateGoal: ${error.message}`)
}

export async function deleteGoal(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb().from('life_goals').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new Error(`deleteGoal: ${error.message}`)
}
