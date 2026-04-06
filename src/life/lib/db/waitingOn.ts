import { lifeDb } from './_client'
import type { LifeWaitingOn, WaitingStatus } from '../../types'

export async function listWaitingOn(
  userId: string,
  opts: { workspaceId?: string; status?: WaitingStatus } = {}
): Promise<LifeWaitingOn[]> {
  let q = lifeDb()
    .from('life_waiting_on')
    .select('*')
    .eq('user_id', userId)
    .order('follow_up_at', { ascending: true })
  if (opts.workspaceId) q = q.eq('workspace_id', opts.workspaceId)
  if (opts.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) throw new Error(`listWaitingOn: ${error.message}`)
  return (data ?? []) as LifeWaitingOn[]
}

export async function createWaitingOn(input: {
  userId: string
  workspaceId: string
  taskId?: string | null
  title: string
  who: string
  slaDays?: number
  notes?: string | null
}): Promise<LifeWaitingOn> {
  const slaDays = input.slaDays ?? 2
  const followUp = new Date()
  followUp.setDate(followUp.getDate() + slaDays)
  const { data, error } = await lifeDb()
    .from('life_waiting_on')
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      task_id: input.taskId ?? null,
      title: input.title,
      who: input.who,
      sla_days: slaDays,
      follow_up_at: followUp.toISOString(),
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createWaitingOn: ${error.message}`)
  return data as LifeWaitingOn
}

export async function updateWaitingOnStatus(
  userId: string,
  id: string,
  status: WaitingStatus
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_waiting_on')
    .update({ status })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateWaitingOnStatus: ${error.message}`)
}
