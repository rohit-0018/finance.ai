import { lifeDb } from './_client'
import type { LifeCapacity } from '../../types'

export async function getCapacity(
  userId: string,
  date: string
): Promise<LifeCapacity | null> {
  const { data, error } = await lifeDb()
    .from('life_capacity')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()
  if (error) throw new Error(`getCapacity: ${error.message}`)
  return (data as LifeCapacity) ?? null
}

export async function upsertCapacity(input: {
  userId: string
  date: string
  ceilingMin: number
  committedMin?: number
}): Promise<LifeCapacity> {
  const { data, error } = await lifeDb()
    .from('life_capacity')
    .upsert(
      {
        user_id: input.userId,
        date: input.date,
        ceiling_min: input.ceilingMin,
        committed_min: input.committedMin ?? 0,
      },
      { onConflict: 'user_id,date' }
    )
    .select()
    .single()
  if (error) throw new Error(`upsertCapacity: ${error.message}`)
  return data as LifeCapacity
}

export async function addCommittedMinutes(
  userId: string,
  date: string,
  minutes: number
): Promise<void> {
  const existing = await getCapacity(userId, date)
  const current = existing?.committed_min ?? 0
  const ceiling = existing?.ceiling_min ?? 480
  await upsertCapacity({
    userId,
    date,
    ceilingMin: ceiling,
    committedMin: current + minutes,
  })
}
