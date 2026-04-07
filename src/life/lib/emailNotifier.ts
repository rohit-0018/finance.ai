// Email scheduler — every minute, look for tasks whose start_at has just
// passed and that opted into email notification (`automation.email_notify`).
// For each, send a Gmail and stamp `automation.email_sent_at` so we don't
// double-fire if the page is open across the boundary.
//
// We deliberately keep the logic in the browser (no backend cron). The user
// has to have the Life tab open at delivery time. The app already runs in
// the same tab as papermind so the practical hit-rate is high; for users
// who want guaranteed delivery the future MCP/Gmail-server bridge will move
// this to a backend worker.

import { lifeDb } from './db/_client'
import { sendNotificationEmail } from './google/gmail'
import type { LifeTask } from '../types'

export interface EmailSchedulerOpts {
  userId: string
  /** Polling cadence (default 60s). */
  intervalMs?: number
}

interface AutomationShape {
  email_notify?: boolean
  email_sent_at?: string | null
  [k: string]: unknown
}

/**
 * Start the email scheduler. Returns a stop() handle.
 */
export function startEmailScheduler(opts: EmailSchedulerOpts): () => void {
  let cancelled = false
  const interval = opts.intervalMs ?? 60_000

  const tick = async () => {
    if (cancelled) return
    try {
      // Pull all tasks for this user that:
      //  - have start_at in the past 6h (catch missed events when the tab
      //    was closed briefly)
      //  - haven't been emailed yet
      // Filtering on jsonb fields is via PostgREST `->>` operator + filter().
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60_000).toISOString()
      const now = new Date().toISOString()
      const { data, error } = await lifeDb()
        .from('life_tasks')
        .select('*')
        .eq('user_id', opts.userId)
        .gte('start_at', sixHoursAgo)
        .lte('start_at', now)
        .filter('automation->>email_notify', 'eq', 'true')
        .is('automation->>email_sent_at', null)
        .limit(50)
      if (error) {
        // Non-fatal — try again next tick.
        return
      }
      for (const t of (data ?? []) as LifeTask[]) {
        if (cancelled) return
        await fireEmailFor(opts.userId, t)
      }
    } catch {
      // Swallow — never break the tab over a notification glitch.
    }
  }

  // Run once on mount, then on a slow timer.
  tick()
  const id = setInterval(tick, interval)
  return () => {
    cancelled = true
    clearInterval(id)
  }
}

async function fireEmailFor(userId: string, task: LifeTask): Promise<void> {
  const start = task.start_at ? new Date(task.start_at) : null
  const subject = `⏰ ${task.title}`
  const body = [
    `Your scheduled task just hit:`,
    ``,
    `  ${task.title}`,
    start ? `  ${start.toLocaleString()}` : '',
    task.notes ? `\nNotes:\n${task.notes}` : '',
    ``,
    `— Sent automatically by your Life dashboard.`,
  ]
    .filter(Boolean)
    .join('\n')

  const result = await sendNotificationEmail({ userId, subject, body })
  if (!result.ok) return

  // Mark sent so we don't fire again. Merge into existing automation jsonb.
  const automation: AutomationShape = (task.automation as AutomationShape) ?? {}
  automation.email_sent_at = new Date().toISOString()
  await lifeDb()
    .from('life_tasks')
    .update({ automation })
    .eq('id', task.id)
    .eq('user_id', userId)
}
