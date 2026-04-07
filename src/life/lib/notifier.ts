// Browser notification helpers + a daily scheduler for EOD/task-due reminders.
// Uses sessionStorage to ensure each reminder fires at most once per day per session.
import type { LifeUser, LifeTask } from '../types'
import { localHour, todayLocal } from './time'

export function browserNotificationsAvailable(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function browserNotificationsGranted(): boolean {
  return browserNotificationsAvailable() && Notification.permission === 'granted'
}

export async function requestBrowserNotifications(): Promise<boolean> {
  if (!browserNotificationsAvailable()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function fireBrowserNotification(
  title: string,
  body?: string,
  onClick?: () => void
): void {
  if (!browserNotificationsGranted()) return
  try {
    const n = new Notification(title, { body, icon: '/favicon.ico', silent: false })
    if (onClick) n.onclick = () => { onClick(); window.focus(); n.close() }
  } catch {
    /* ignore — some browsers throw on iframe contexts */
  }
}

export interface DueDigest {
  overdue: LifeTask[]
  dueToday: LifeTask[]
  dueTomorrow: LifeTask[]
}

interface SchedulerOpts {
  user: LifeUser
  todayTasks: () => LifeTask[]
  onEod: () => void
  /** Optional — invoked when the daily finance log reminder fires (22:00). */
  onFinanceLog?: () => void
  /** Optional — return overdue / due-today / due-tomorrow for the morning brief. */
  dueDigest?: () => Promise<DueDigest | null>
  /** Click target when the deadline brief notification is clicked. */
  onOpenTodos?: () => void
}

/**
 * Polling scheduler: every 60s, check the local hour and fire any reminders
 * that haven't yet fired today (tracked via sessionStorage).
 *
 * Reminders:
 *  - eod: fires once at user.eod_hour
 *  - task_due: fires once at 17:00 if there are P1/P2 tasks still open today
 */
export function startReminderScheduler(opts: SchedulerOpts): () => void {
  if (!opts.user.notify_browser || !browserNotificationsGranted()) return () => {}

  let cancelled = false

  const tick = () => {
    if (cancelled) return
    const tz = opts.user.timezone
    const h = localHour(new Date(), tz)
    const dayKey = todayLocal(tz)

    // EOD reminder
    const eodKey = `life_notify_eod_${dayKey}`
    if (h >= opts.user.eod_hour && !sessionStorage.getItem(eodKey)) {
      sessionStorage.setItem(eodKey, '1')
      fireBrowserNotification(
        'Close the day',
        'Two minutes — write today\'s journal so future you has the context.',
        opts.onEod
      )
    }

    // Daily finance log nudge — fires at 22:00 local once per day. The user
    // confirmed they want to log expenses around 10pm; this opens the page.
    const finKey = `life_notify_finance_${dayKey}`
    if (h >= 22 && !sessionStorage.getItem(finKey)) {
      sessionStorage.setItem(finKey, '1')
      fireBrowserNotification(
        'Log today\'s expenses',
        'Daily 10pm check-in — what did you spend today?',
        opts.onFinanceLog
      )
    }

    // Late-afternoon high-priority nudge (17:00 local)
    const dueKey = `life_notify_due_${dayKey}`
    if (h >= 17 && !sessionStorage.getItem(dueKey)) {
      const open = opts.todayTasks().filter(
        (t) => (t.status === 'todo' || t.status === 'doing') && t.priority <= 2
      )
      if (open.length > 0) {
        sessionStorage.setItem(dueKey, '1')
        fireBrowserNotification(
          `${open.length} priority task${open.length === 1 ? '' : 's'} still open`,
          open
            .slice(0, 3)
            .map((t) => `• ${t.title}`)
            .join('\n')
        )
      }
    }

    // Morning deadline brief (09:00 local). Pulls all open tasks and counts
    // how many are overdue or due today/tomorrow, then fires one digest.
    const briefKey = `life_notify_deadline_brief_${dayKey}`
    if (h >= 9 && !sessionStorage.getItem(briefKey) && opts.dueDigest) {
      sessionStorage.setItem(briefKey, '1')
      opts.dueDigest().then((digest) => {
        if (!digest) return
        const { overdue, dueToday, dueTomorrow } = digest
        const total = overdue.length + dueToday.length + dueTomorrow.length
        if (total === 0) return
        const lines: string[] = []
        if (overdue.length > 0) lines.push(`⚠️ ${overdue.length} overdue`)
        if (dueToday.length > 0) lines.push(`📅 ${dueToday.length} due today`)
        if (dueTomorrow.length > 0) lines.push(`⏰ ${dueTomorrow.length} due tomorrow`)
        const sample = [...overdue, ...dueToday, ...dueTomorrow]
          .slice(0, 3)
          .map((t) => `• ${t.title}`)
          .join('\n')
        fireBrowserNotification(
          'Deadline brief',
          [lines.join(' · '), '', sample].filter(Boolean).join('\n'),
          opts.onOpenTodos
        )
      })
    }
  }

  tick()
  const id = setInterval(tick, 60_000)
  return () => {
    cancelled = true
    clearInterval(id)
  }
}
