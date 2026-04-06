// Energy-aware scheduling. Learns the user's peak productive hours from
// the timestamps on done tasks and exposes a small "when is my peak window?"
// function the brainstorm agent can feed into its schedule prompt.
//
// Method: bucket done_at by hour-of-day in the user's timezone, weight by
// priority (a P1 finished at 7am is worth more than a P4 finished at 7am),
// return the top 2-hour window. Falls back to work_start_hour + 2 if not
// enough data.
import { lifeDb } from './db/_client'
import type { LifeUser } from '../types'

const MIN_SAMPLE = 15

export interface EnergyWindow {
  startHour: number // 0..23 local
  endHour: number
  sample: number
  confident: boolean
}

export async function getEnergyWindow(user: LifeUser): Promise<EnergyWindow> {
  const since = new Date()
  since.setDate(since.getDate() - 60)
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('done_at, priority')
    .eq('user_id', user.id)
    .eq('status', 'done')
    .gte('done_at', since.toISOString())
  if (error) throw new Error(`getEnergyWindow: ${error.message}`)
  const rows = (data ?? []) as { done_at: string | null; priority: number }[]

  const buckets = new Array<number>(24).fill(0)
  for (const r of rows) {
    if (!r.done_at) continue
    const local = new Date(
      new Date(r.done_at).toLocaleString('en-US', { timeZone: user.timezone })
    )
    const hour = local.getHours()
    const weight = Math.max(1, 6 - (r.priority ?? 3))
    buckets[hour] += weight
  }

  if (rows.length < MIN_SAMPLE) {
    return {
      startHour: user.work_start_hour,
      endHour: Math.min(user.work_end_hour, user.work_start_hour + 2),
      sample: rows.length,
      confident: false,
    }
  }

  // Slide a 2-hour window, pick the max total.
  let bestStart = user.work_start_hour
  let bestScore = -1
  for (let h = user.work_start_hour; h <= user.work_end_hour - 2; h++) {
    const score = buckets[h] + buckets[h + 1]
    if (score > bestScore) {
      bestScore = score
      bestStart = h
    }
  }
  return {
    startHour: bestStart,
    endHour: bestStart + 2,
    sample: rows.length,
    confident: true,
  }
}
