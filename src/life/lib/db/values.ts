import { lifeDb } from './_client'
import type { LifeValue } from '../../types'

export async function listValues(userId: string): Promise<LifeValue[]> {
  const { data, error } = await lifeDb()
    .from('life_values')
    .select('*')
    .eq('user_id', userId)
    .order('weight', { ascending: false })
  if (error) throw new Error(`listValues: ${error.message}`)
  return (data ?? []) as LifeValue[]
}

export async function createValue(input: {
  userId: string
  title: string
  description?: string
  weight?: number
}): Promise<LifeValue> {
  const { data, error } = await lifeDb()
    .from('life_values')
    .insert({
      user_id: input.userId,
      title: input.title,
      description: input.description ?? null,
      weight: input.weight ?? 1,
    })
    .select()
    .single()
  if (error) throw new Error(`createValue: ${error.message}`)
  return data as LifeValue
}

export async function updateValue(
  userId: string,
  id: string,
  patch: Partial<Pick<LifeValue, 'title' | 'description' | 'weight'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_values')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateValue: ${error.message}`)
}

export async function deleteValue(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_values')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteValue: ${error.message}`)
}
