import { lifeDb } from './_client'
import type { LifeLearning } from '../../types'

export async function listLearnings(
  userId: string,
  opts: { workspaceId?: string; dueBefore?: string; archived?: boolean } = {}
): Promise<LifeLearning[]> {
  let q = lifeDb()
    .from('life_learnings')
    .select('*')
    .eq('user_id', userId)
    .order('next_review_at', { ascending: true })
  if (opts.workspaceId) q = q.eq('workspace_id', opts.workspaceId)
  if (opts.archived !== undefined) q = q.eq('archived', opts.archived)
  if (opts.dueBefore) q = q.lte('next_review_at', opts.dueBefore)
  const { data, error } = await q
  if (error) throw new Error(`listLearnings: ${error.message}`)
  return (data ?? []) as LifeLearning[]
}

export async function createLearning(input: {
  userId: string
  workspaceId: string
  content: string
  source_url?: string | null
  source_type?: LifeLearning['source_type']
  source_ref?: string | null
}): Promise<LifeLearning> {
  const now = new Date()
  const nextReview = new Date(now)
  nextReview.setDate(nextReview.getDate() + 3)
  const actionDeadline = new Date(now)
  actionDeadline.setDate(actionDeadline.getDate() + 7)

  const { data, error } = await lifeDb()
    .from('life_learnings')
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      content: input.content,
      source_url: input.source_url ?? null,
      source_type: input.source_type ?? 'manual',
      source_ref: input.source_ref ?? null,
      interval_days: 3,
      next_review_at: nextReview.toISOString(),
      action_deadline: actionDeadline.toISOString(),
    })
    .select()
    .single()
  if (error) throw new Error(`createLearning: ${error.message}`)
  return data as LifeLearning
}

/** SM-2-lite: grade 0-5 → adjust ease + interval, advance next_review_at. */
export async function reviewLearning(
  userId: string,
  id: string,
  grade: number
): Promise<void> {
  const db = lifeDb()
  const current = await db
    .from('life_learnings')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (current.error || !current.data) throw new Error(`reviewLearning: not found`)
  const l = current.data as LifeLearning
  const ease = Math.max(1.3, l.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
  const interval =
    grade < 3 ? 1 : l.review_count === 0 ? 3 : Math.round(l.interval_days * ease)
  const next = new Date()
  next.setDate(next.getDate() + interval)

  const { error } = await db
    .from('life_learnings')
    .update({
      ease,
      interval_days: interval,
      review_count: l.review_count + 1,
      next_review_at: next.toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`reviewLearning: ${error.message}`)
}

export async function archiveLearning(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_learnings')
    .update({ archived: true })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`archiveLearning: ${error.message}`)
}

export async function linkLearningToTask(
  userId: string,
  id: string,
  taskId: string
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_learnings')
    .update({ became_task_id: taskId })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`linkLearningToTask: ${error.message}`)
}
