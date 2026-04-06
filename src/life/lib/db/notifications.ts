import { lifeDb } from './_client'
import { resolveDefaultWorkspaceId } from './_defaults'
import type { LifeNotification, NotificationKind } from '../../types'

/**
 * List notifications. Accepts either a bare numeric `limit` (legacy shape)
 * or an options object with `workspaceId` and `limit`.
 */
export async function listNotifications(
  userId: string,
  optsOrLimit: { workspaceId?: string; limit?: number } | number = {}
): Promise<LifeNotification[]> {
  const opts = typeof optsOrLimit === 'number' ? { limit: optsOrLimit } : optsOrLimit
  let q = lifeDb()
    .from('life_notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 30)
  if (opts.workspaceId) q = q.eq('workspace_id', opts.workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`listNotifications: ${error.message}`)
  return (data ?? []) as LifeNotification[]
}

export async function createNotification(input: {
  userId: string
  workspaceId?: string
  kind: NotificationKind
  title: string
  body?: string
  link?: string
}): Promise<LifeNotification> {
  const workspaceId = input.workspaceId ?? (await resolveDefaultWorkspaceId(input.userId))
  const { data, error } = await lifeDb()
    .from('life_notifications')
    .insert({
      user_id: input.userId,
      workspace_id: workspaceId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createNotification: ${error.message}`)
  return data as LifeNotification
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`markNotificationRead: ${error.message}`)
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false)
  if (error) throw new Error(`markAllNotificationsRead: ${error.message}`)
}
