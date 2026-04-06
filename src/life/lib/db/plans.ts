import { lifeDb } from './_client'
import type { LifePlan, PlanSnapshot, PlanStatus } from '../../types'

export async function listPlansForBrainstorm(
  userId: string,
  brainstormId: string
): Promise<LifePlan[]> {
  const { data, error } = await lifeDb()
    .from('life_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('brainstorm_id', brainstormId)
    .order('version', { ascending: false })
  if (error) throw new Error(`listPlansForBrainstorm: ${error.message}`)
  return (data ?? []) as LifePlan[]
}

export async function getPlan(userId: string, id: string): Promise<LifePlan | null> {
  const { data, error } = await lifeDb()
    .from('life_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getPlan: ${error.message}`)
  return (data as LifePlan) ?? null
}

export async function createPlanDraft(input: {
  userId: string
  brainstormId: string
  snapshot: PlanSnapshot
}): Promise<LifePlan> {
  // next version = existing max + 1
  const existing = await listPlansForBrainstorm(input.userId, input.brainstormId)
  const version = (existing[0]?.version ?? 0) + 1
  const { data, error } = await lifeDb()
    .from('life_plans')
    .insert({
      user_id: input.userId,
      brainstorm_id: input.brainstormId,
      version,
      status: 'draft',
      snapshot: input.snapshot,
    })
    .select()
    .single()
  if (error) throw new Error(`createPlanDraft: ${error.message}`)
  return data as LifePlan
}

export async function updatePlanSnapshot(
  userId: string,
  id: string,
  snapshot: PlanSnapshot
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_plans')
    .update({ snapshot })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'draft')
  if (error) throw new Error(`updatePlanSnapshot: ${error.message}`)
}

export async function markPlanCommitted(
  userId: string,
  id: string,
  projectId: string
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_plans')
    .update({
      status: 'committed' as PlanStatus,
      project_id: projectId,
      committed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`markPlanCommitted: ${error.message}`)
}
