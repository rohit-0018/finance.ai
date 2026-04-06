import { lifeDb } from './_client'
import type { LifeEstimate } from '../../types'

export async function recordEstimate(input: {
  userId: string
  taskId: string
  estimatedMin: number
  actualMin: number
}): Promise<LifeEstimate> {
  const { data, error } = await lifeDb()
    .from('life_estimates')
    .insert({
      user_id: input.userId,
      task_id: input.taskId,
      estimated_min: input.estimatedMin,
      actual_min: input.actualMin,
    })
    .select()
    .single()
  if (error) throw new Error(`recordEstimate: ${error.message}`)
  return data as LifeEstimate
}

/**
 * Personal calibration multiplier — the ratio of actual to estimated time
 * over the user's recent history. Returns 1.0 if there isn't enough data;
 * otherwise clamps into [1.0, 3.0] to avoid wild swings.
 */
export async function getCalibrationMultiplier(
  userId: string,
  sample = 30
): Promise<number> {
  const { data, error } = await lifeDb()
    .from('life_estimates')
    .select('estimated_min, actual_min')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(sample)
  if (error) throw new Error(`getCalibrationMultiplier: ${error.message}`)
  const rows = (data ?? []) as { estimated_min: number; actual_min: number }[]
  if (rows.length < 5) return 1.0
  const totalEst = rows.reduce((a, r) => a + r.estimated_min, 0)
  const totalAct = rows.reduce((a, r) => a + r.actual_min, 0)
  if (totalEst <= 0) return 1.0
  const mult = totalAct / totalEst
  return Math.max(1.0, Math.min(3.0, mult))
}
