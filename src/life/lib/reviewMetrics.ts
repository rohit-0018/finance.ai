// Review metrics — the honest-feedback layer. All helpers return plain
// numbers/arrays so the review page can render without any agent call.
//
// Metrics:
//   - planVsRealityToday(): what you planned to finish today vs what you
//     actually finished. Counts + a delta + short prose line.
//   - planHitRate(window): of plans committed in the window, how many
//     have shipped (all their tasks done). Brutal finish metric.
//   - estimationTrend(window): [{week, multiplier}] — personal calibration
//     moving through time.
//   - dropsByReason(window): simple string -> count histogram of drop reasons.
import { lifeDb } from './db/_client'
import type { LifeTask, LifePlan } from '../types'
import { todayLocal } from './time'

export interface PlanVsReality {
  plannedCount: number
  doneCount: number
  delta: number
  narrative: string
}

export async function planVsRealityToday(
  userId: string,
  workspaceId: string | null,
  timezone: string | undefined
): Promise<PlanVsReality> {
  const date = todayLocal(timezone)
  let q = lifeDb()
    .from('life_tasks')
    .select('id, status, done_at, scheduled_for')
    .eq('user_id', userId)
    .eq('scheduled_for', date)
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`planVsRealityToday: ${error.message}`)
  const rows = (data ?? []) as Array<{ status: string }>
  const plannedCount = rows.length
  const doneCount = rows.filter((r) => r.status === 'done').length
  const delta = doneCount - plannedCount
  let narrative: string
  if (plannedCount === 0) narrative = 'Nothing on the plan today.'
  else if (doneCount === plannedCount) narrative = `Full clear: ${doneCount}/${plannedCount}.`
  else if (doneCount === 0) narrative = `0 of ${plannedCount} planned. Hard day or wrong plan?`
  else
    narrative = `${doneCount} of ${plannedCount} planned — ${plannedCount - doneCount} still open.`
  return { plannedCount, doneCount, delta, narrative }
}

export interface PlanHitRate {
  windowDays: number
  totalPlans: number
  shipped: number
  rate: number
}

export async function planHitRate(
  userId: string,
  windowDays = 30
): Promise<PlanHitRate> {
  const since = new Date()
  since.setDate(since.getDate() - windowDays)
  const { data, error } = await lifeDb()
    .from('life_plans')
    .select('id, project_id, committed_at, status')
    .eq('user_id', userId)
    .eq('status', 'committed')
    .gte('committed_at', since.toISOString())
  if (error) throw new Error(`planHitRate: ${error.message}`)
  const plans = (data ?? []) as LifePlan[]
  if (plans.length === 0) return { windowDays, totalPlans: 0, shipped: 0, rate: 0 }

  // A plan has "shipped" if all its tasks are done or dropped.
  const projectIds = Array.from(new Set(plans.map((p) => p.project_id).filter(Boolean) as string[]))
  if (projectIds.length === 0) return { windowDays, totalPlans: plans.length, shipped: 0, rate: 0 }

  const tasksRes = await lifeDb()
    .from('life_tasks')
    .select('project_id, status')
    .eq('user_id', userId)
    .in('project_id', projectIds)
  if (tasksRes.error) throw new Error(`planHitRate tasks: ${tasksRes.error.message}`)
  const byProject = new Map<string, { total: number; closed: number }>()
  for (const t of (tasksRes.data ?? []) as LifeTask[]) {
    if (!t.project_id) continue
    const bucket = byProject.get(t.project_id) ?? { total: 0, closed: 0 }
    bucket.total++
    if (t.status === 'done' || t.status === 'dropped') bucket.closed++
    byProject.set(t.project_id, bucket)
  }
  let shipped = 0
  for (const p of plans) {
    if (!p.project_id) continue
    const b = byProject.get(p.project_id)
    if (b && b.total > 0 && b.closed === b.total) shipped++
  }
  return {
    windowDays,
    totalPlans: plans.length,
    shipped,
    rate: plans.length === 0 ? 0 : shipped / plans.length,
  }
}

export interface EstimationTrend {
  windowDays: number
  multiplier: number
  sample: number
}

/** Mean actual/estimate ratio across the window. 1.0 = calibrated, >1 = optimistic. */
export async function estimationTrend(
  userId: string,
  windowDays = 30
): Promise<EstimationTrend> {
  const since = new Date()
  since.setDate(since.getDate() - windowDays)
  const { data, error } = await lifeDb()
    .from('life_estimates')
    .select('estimated_min, actual_min')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
  if (error) throw new Error(`estimationTrend: ${error.message}`)
  const rows = (data ?? []) as Array<{ estimated_min: number; actual_min: number }>
  if (rows.length === 0) return { windowDays, multiplier: 1, sample: 0 }
  const est = rows.reduce((a, r) => a + r.estimated_min, 0)
  const act = rows.reduce((a, r) => a + r.actual_min, 0)
  return { windowDays, multiplier: est === 0 ? 1 : act / est, sample: rows.length }
}

export async function dropsByReason(
  userId: string,
  windowDays = 30
): Promise<Array<{ keyword: string; count: number }>> {
  const since = new Date()
  since.setDate(since.getDate() - windowDays)
  const { data, error } = await lifeDb()
    .from('life_drops')
    .select('reason')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
  if (error) throw new Error(`dropsByReason: ${error.message}`)
  const rows = (data ?? []) as Array<{ reason: string }>
  const counts = new Map<string, number>()
  // Cheap keyword extraction: take the first 3 meaningful words of each reason.
  for (const r of rows) {
    const words = r.reason
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4)
      .slice(0, 3)
    const key = words.join(' ') || '(unknown)'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }))
}
