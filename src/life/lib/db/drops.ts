import { lifeDb } from './_client'
import type { LifeDrop, DropKind } from '../../types'

export async function listDrops(
  userId: string,
  opts: { kind?: DropKind; limit?: number } = {}
): Promise<LifeDrop[]> {
  let q = lifeDb()
    .from('life_drops')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100)
  if (opts.kind) q = q.eq('kind', opts.kind)
  const { data, error } = await q
  if (error) throw new Error(`listDrops: ${error.message}`)
  return (data ?? []) as LifeDrop[]
}

export async function recordDrop(input: {
  userId: string
  kind: DropKind
  refId: string
  title: string
  reason: string
}): Promise<LifeDrop> {
  const { data, error } = await lifeDb()
    .from('life_drops')
    .insert({
      user_id: input.userId,
      kind: input.kind,
      ref_id: input.refId,
      title: input.title,
      reason: input.reason,
    })
    .select()
    .single()
  if (error) throw new Error(`recordDrop: ${error.message}`)
  return data as LifeDrop
}

/** Count drops by ref_id — used to detect repeat-bail patterns. */
export async function countDropsByTitle(
  userId: string,
  titleLike: string
): Promise<number> {
  const { count, error } = await lifeDb()
    .from('life_drops')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .ilike('title', `%${titleLike}%`)
  if (error) throw new Error(`countDropsByTitle: ${error.message}`)
  return count ?? 0
}
