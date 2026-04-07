// Recurring task expander.
//
// Approach: when the user creates a recurring task we materialize N concrete
// life_tasks rows in advance, one per occurrence. Every row carries the same
// `series_id` and the canonical rrule under `automation.recurring`. This keeps
// list/calendar/todos queries dead simple — no special-case "virtual" rows —
// while still letting us delete or skip the whole series later via series_id.
//
// We deliberately materialize a bounded horizon (default 60 days) instead of
// infinity. A periodic refill (run on Today page mount) tops the horizon back
// up to 60 days as time passes.

import { createTask } from './db/tasks'
import { lifeDb } from './db/_client'
import type { LifeTask, TaskAutomation } from '../types'

export type RecurrencePreset =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'every_n_days'

export interface RecurrenceConfig {
  preset: RecurrencePreset
  /** Used by `every_n_days`. */
  intervalDays?: number
  /** Stop after this date (YYYY-MM-DD). Optional. */
  until?: string | null
}

const DEFAULT_HORIZON_DAYS = 60

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function isWeekday(d: Date): boolean {
  const day = d.getDay() // 0=Sun, 6=Sat
  return day >= 1 && day <= 5
}

function presetToRrule(cfg: RecurrenceConfig): string {
  switch (cfg.preset) {
    case 'daily':
      return 'FREQ=DAILY'
    case 'weekdays':
      return 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'
    case 'weekly':
      return 'FREQ=WEEKLY'
    case 'monthly':
      return 'FREQ=MONTHLY'
    case 'every_n_days':
      return `FREQ=DAILY;INTERVAL=${Math.max(1, cfg.intervalDays ?? 1)}`
    default:
      return ''
  }
}

/**
 * Generate the list of YYYY-MM-DD dates that an rrule preset hits, starting
 * from `fromDate` (inclusive) for at most `horizonDays` days.
 */
export function expandDates(
  cfg: RecurrenceConfig,
  fromDate: string,
  horizonDays = DEFAULT_HORIZON_DAYS
): string[] {
  if (cfg.preset === 'none') return []
  const dates: string[] = []
  const start = new Date(`${fromDate}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + horizonDays - 1)
  const stop = cfg.until ? new Date(`${cfg.until}T00:00:00`) : null

  const interval = Math.max(1, cfg.intervalDays ?? 1)

  if (cfg.preset === 'daily') {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (stop && d > stop) break
      dates.push(isoDate(d))
    }
  } else if (cfg.preset === 'weekdays') {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (stop && d > stop) break
      if (isWeekday(d)) dates.push(isoDate(d))
    }
  } else if (cfg.preset === 'weekly') {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      if (stop && d > stop) break
      dates.push(isoDate(d))
    }
  } else if (cfg.preset === 'monthly') {
    for (let d = new Date(start); d <= end; ) {
      if (stop && d > stop) break
      dates.push(isoDate(d))
      d.setMonth(d.getMonth() + 1)
    }
  } else if (cfg.preset === 'every_n_days') {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + interval)) {
      if (stop && d > stop) break
      dates.push(isoDate(d))
    }
  }
  return dates
}

export interface CreateSeriesInput {
  userId: string
  workspaceId?: string
  title: string
  notes?: string
  project_id?: string | null
  goal_id?: string | null
  estimate_min?: number | null
  priority?: number
  tags?: string[]
  /** Optional time-of-day (HH:mm) for each occurrence. */
  startTime?: string | null
  /** Optional hard deadline date (YYYY-MM-DD) — maps to due_at. */
  dueDate?: string | null
  /** Optional deadline time-of-day (HH:mm) paired with dueDate. */
  dueTime?: string | null
  /** First date to materialize from (YYYY-MM-DD). Defaults to today (local). */
  fromDate?: string
  recurrence: RecurrenceConfig
  horizonDays?: number
  /** Send a Gmail when this task's start_at hits. Persisted under automation. */
  emailNotify?: boolean
}

export interface CreateSeriesResult {
  seriesId: string
  created: LifeTask[]
}

/**
 * Create a recurring task series. Returns the series id and the materialized
 * task rows. If `recurrence.preset === 'none'` it falls back to creating a
 * single task — convenient for callers that always go through this helper.
 */
export async function createTaskSeries(input: CreateSeriesInput): Promise<CreateSeriesResult> {
  const fromDate =
    input.fromDate ??
    (() => {
      const d = new Date()
      return isoDate(d)
    })()
  const seriesId = `srs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const baseAutomation: Record<string, unknown> = {}
  if (input.emailNotify) baseAutomation.email_notify = true

  // Resolve a due_at instant if the user provided a date (and optional time).
  // The time defaults to end-of-day so a "due today" really means "before
  // midnight" rather than "before this exact second".
  const computeDueAt = (forDate: string): string | null => {
    if (!input.dueDate) return null
    const time = input.dueTime ?? '23:59'
    return toIsoLocal(input.dueDate, time)
    void forDate
  }

  if (input.recurrence.preset === 'none') {
    const t = await createTask({
      userId: input.userId,
      workspaceId: input.workspaceId,
      title: input.title,
      notes: input.notes,
      project_id: input.project_id ?? null,
      goal_id: input.goal_id ?? null,
      estimate_min: input.estimate_min ?? null,
      priority: input.priority ?? 3,
      tags: input.tags ?? [],
      scheduled_for: fromDate,
      start_at: input.startTime ? toIsoLocal(fromDate, input.startTime) : null,
      due_at: computeDueAt(fromDate),
      automation: baseAutomation as TaskAutomation,
    })
    return { seriesId: '', created: [t] }
  }

  const dates = expandDates(input.recurrence, fromDate, input.horizonDays ?? DEFAULT_HORIZON_DAYS)
  const automation: TaskAutomation & { series_id?: string } = {
    ...baseAutomation,
    recurring: { rrule: presetToRrule(input.recurrence) },
    series_id: seriesId,
  } as TaskAutomation & { series_id?: string }

  const created: LifeTask[] = []
  for (const d of dates) {
    const t = await createTask({
      userId: input.userId,
      workspaceId: input.workspaceId,
      title: input.title,
      notes: input.notes,
      project_id: input.project_id ?? null,
      goal_id: input.goal_id ?? null,
      estimate_min: input.estimate_min ?? null,
      priority: input.priority ?? 3,
      tags: input.tags ?? [],
      scheduled_for: d,
      start_at: input.startTime ? toIsoLocal(d, input.startTime) : null,
      due_at: computeDueAt(d),
      automation,
    })
    created.push(t)
  }
  return { seriesId, created }
}

function toIsoLocal(date: string, hhmm: string): string {
  // Build a local-time ISO string. The user thinks in their wall clock; the
  // server stores UTC, so this captures the right instant for the local day.
  return new Date(`${date}T${hhmm}:00`).toISOString()
}

/**
 * Top up a series so it has tasks scheduled out to `horizonDays` from today.
 * Idempotent — checks the latest scheduled_for in the series and only creates
 * the missing tail. Call this once on app load (Today page mount) to keep
 * recurring chores from running out.
 */
export async function refillSeries(
  userId: string,
  seriesId: string,
  recurrence: RecurrenceConfig,
  template: Omit<CreateSeriesInput, 'userId' | 'recurrence' | 'fromDate'>,
  horizonDays = DEFAULT_HORIZON_DAYS
): Promise<number> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('scheduled_for')
    .eq('user_id', userId)
    .filter('automation->>series_id', 'eq', seriesId)
    .order('scheduled_for', { ascending: false })
    .limit(1)
  if (error) throw new Error(`refillSeries: ${error.message}`)
  const last = (data ?? [])[0]?.scheduled_for as string | undefined
  const startDate = last
    ? (() => {
        const d = new Date(`${last}T00:00:00`)
        d.setDate(d.getDate() + 1)
        return isoDate(d)
      })()
    : isoDate(new Date())
  const today = isoDate(new Date())
  const horizonEnd = (() => {
    const d = new Date()
    d.setDate(d.getDate() + horizonDays - 1)
    return isoDate(d)
  })()
  if (startDate > horizonEnd) return 0
  // Use whichever is later: today or the day after the last instance.
  const from = startDate < today ? today : startDate
  const dates = expandDates(recurrence, from, horizonDays)
  let made = 0
  for (const d of dates) {
    if (d > horizonEnd) break
    await createTask({
      userId,
      workspaceId: template.workspaceId,
      title: template.title,
      notes: template.notes,
      project_id: template.project_id ?? null,
      goal_id: template.goal_id ?? null,
      estimate_min: template.estimate_min ?? null,
      priority: template.priority ?? 3,
      tags: template.tags ?? [],
      scheduled_for: d,
      start_at: template.startTime ? toIsoLocal(d, template.startTime) : null,
      automation: {
        recurring: { rrule: presetToRrule(recurrence) },
        series_id: seriesId,
      } as TaskAutomation & { series_id?: string },
    })
    made++
  }
  return made
}

/**
 * Delete every open instance of a recurring series at or after `fromDate`
 * (inclusive). Past + completed instances are kept as history.
 */
export async function deleteSeriesFuture(
  userId: string,
  seriesId: string,
  fromDate: string
): Promise<number> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .delete()
    .eq('user_id', userId)
    .filter('automation->>series_id', 'eq', seriesId)
    .gte('scheduled_for', fromDate)
    .in('status', ['todo', 'doing'])
    .select('id')
  if (error) throw new Error(`deleteSeriesFuture: ${error.message}`)
  return (data ?? []).length
}

export const RECURRENCE_OPTIONS: Array<{ id: RecurrencePreset; label: string }> = [
  { id: 'none', label: 'One-time' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'every_n_days', label: 'Every N days' },
]
