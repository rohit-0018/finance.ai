import { lifeDb } from './_client'
import type { LifeStake, StakeKind, StakeStatus } from '../../types'

export async function listStakes(
  userId: string,
  status?: StakeStatus
): Promise<LifeStake[]> {
  let q = lifeDb()
    .from('life_stakes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(`listStakes: ${error.message}`)
  return (data ?? []) as LifeStake[]
}

export async function createStake(input: {
  userId: string
  taskId?: string | null
  projectId?: string | null
  kind: StakeKind
  amountCents?: number
  description: string
  partner?: string | null
}): Promise<LifeStake> {
  const { data, error } = await lifeDb()
    .from('life_stakes')
    .insert({
      user_id: input.userId,
      task_id: input.taskId ?? null,
      project_id: input.projectId ?? null,
      kind: input.kind,
      amount_cents: input.amountCents ?? null,
      description: input.description,
      partner: input.partner ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createStake: ${error.message}`)
  return data as LifeStake
}

export async function resolveStake(
  userId: string,
  id: string,
  status: Exclude<StakeStatus, 'pending'>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_stakes')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`resolveStake: ${error.message}`)
}
