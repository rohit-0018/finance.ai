import { lifeDb } from './_client'
import type { LifeUser } from '../../types'

export async function ensureLifeUser(opts: {
  papermindUserId: string
  username: string
  displayName: string | null
}): Promise<LifeUser> {
  const db = lifeDb()
  const existing = await db
    .from('life_users')
    .select('*')
    .eq('papermind_user_id', opts.papermindUserId)
    .maybeSingle()

  if (existing.error) throw new Error(`life_users lookup failed: ${existing.error.message}`)
  if (existing.data) return existing.data as LifeUser

  const inserted = await db
    .from('life_users')
    .insert({
      papermind_user_id: opts.papermindUserId,
      username: opts.username,
      display_name: opts.displayName,
    })
    .select()
    .single()

  if (inserted.error) throw new Error(`life_users insert failed: ${inserted.error.message}`)
  return inserted.data as LifeUser
}

export async function updateLifeUser(
  userId: string,
  patch: Partial<
    Pick<
      LifeUser,
      | 'timezone'
      | 'eod_hour'
      | 'work_start_hour'
      | 'work_end_hour'
      | 'display_name'
      | 'notify_browser'
      | 'active_workspace_id'
    >
  >
): Promise<void> {
  const { error } = await lifeDb().from('life_users').update(patch).eq('id', userId)
  if (error) throw new Error(`updateLifeUser: ${error.message}`)
}
