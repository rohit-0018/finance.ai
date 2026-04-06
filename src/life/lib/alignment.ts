// Alignment score — what fraction of the user's recent work traced to a
// quarterly goal (horizon). Simple Phase-1 definition:
//
//   alignment = tasks_done_with_goal_id / max(tasks_done_total, 1)
//
// Sample window: trailing 7 days. Returns a value in [0, 1] plus a rating
// so the pill in the topbar can colorize without re-computing thresholds.
//
// In Phase 3 we'll upgrade this to time-weighted (estimate_min) instead of
// task-count — but for now we don't yet reliably track estimates.
import { lifeDb } from './db/_client'

export interface AlignmentSnapshot {
  rate: number
  rating: 'good' | 'warn' | 'bad'
  sample: number
  windowDays: number
}

export async function getAlignmentScore(
  userId: string,
  workspaceId: string | null,
  windowDays = 7
): Promise<AlignmentSnapshot> {
  const since = new Date()
  since.setDate(since.getDate() - windowDays)

  let q = lifeDb()
    .from('life_tasks')
    .select('id, goal_id, done_at, estimate_min')
    .eq('user_id', userId)
    .eq('status', 'done')
    .gte('done_at', since.toISOString())
  if (workspaceId) q = q.eq('workspace_id', workspaceId)

  const { data, error } = await q
  if (error) throw new Error(`getAlignmentScore: ${error.message}`)
  const rows = (data ?? []) as { goal_id: string | null; estimate_min: number | null }[]
  if (rows.length === 0) {
    return { rate: 0, rating: 'warn', sample: 0, windowDays }
  }
  const aligned = rows.filter((r) => r.goal_id).length
  const rate = aligned / rows.length
  const rating: AlignmentSnapshot['rating'] =
    rate >= 0.6 ? 'good' : rate >= 0.3 ? 'warn' : 'bad'
  return { rate, rating, sample: rows.length, windowDays }
}
