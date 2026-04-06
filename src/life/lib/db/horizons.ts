import { lifeDb } from './_client'
import type { LifeHorizon, HorizonKind } from '../../types'

export async function listHorizons(
  userId: string,
  kind?: HorizonKind
): Promise<LifeHorizon[]> {
  let q = lifeDb()
    .from('life_horizons')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q
  if (error) throw new Error(`listHorizons: ${error.message}`)
  return (data ?? []) as LifeHorizon[]
}

export async function createHorizon(input: {
  userId: string
  kind: HorizonKind
  title: string
  why?: string | null
  target_date?: string | null
  parent_id?: string | null
}): Promise<LifeHorizon> {
  const { data, error } = await lifeDb()
    .from('life_horizons')
    .insert({
      user_id: input.userId,
      kind: input.kind,
      title: input.title,
      why: input.why ?? null,
      target_date: input.target_date ?? null,
      parent_id: input.parent_id ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createHorizon: ${error.message}`)
  return data as LifeHorizon
}

export async function updateHorizon(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeHorizon, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_horizons')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateHorizon: ${error.message}`)
}

export async function deleteHorizon(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_horizons')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteHorizon: ${error.message}`)
}
