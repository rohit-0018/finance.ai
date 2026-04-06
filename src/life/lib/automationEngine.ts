// Automation engine — Phase 7.
//
// Responsibilities:
//   1. Task-level reminders (from life_tasks.automation.reminders)
//   2. Escalation when a task has been untouched for N days
//   3. Check-in cron for projects (weekly)
//   4. Waiting-on SLA checker
//   5. Drift report (projects not touched in 4+ days)
//
// Implementation strategy for Phase 7: browser-side, polled every 2 minutes
// when the Life app is open. Phase 9 will move the hot parts to Supabase
// Edge Functions + pg_cron so it runs even when you're not on the tab.
//
// Fairness rule: we never fire the same notification twice. Dedupe keys are
// stored in sessionStorage per day.
import type { LifeTask, LifeUser, LifeProject, LifeWorkspace, TaskAutomation } from '../types'
import {
  listTasksForDate,
  listOverdueOpenTasks,
  listProjects,
  listWaitingOn,
  createNotification,
} from './db'
import { todayLocal } from './time'
import { fireBrowserNotification } from './notifier'
import { getActiveMode } from './modes'

const BASE_POLL_INTERVAL_MS = 2 * 60_000

interface EngineOpts {
  user: LifeUser
  workspaces: LifeWorkspace[]
  /** Opens the Life UI — used for notification click handlers. */
  onNavigate?: (path: string) => void
}

function fired(key: string): boolean {
  return sessionStorage.getItem(key) === '1'
}
function markFired(key: string): void {
  sessionStorage.setItem(key, '1')
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000)
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60_000))
}

/** Start the engine. Returns a stop function. Idempotent if called twice. */
export function startAutomationEngine(opts: EngineOpts): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setInterval> | null = null

  const tick = async () => {
    if (cancelled) return
    try {
      await runOnce(opts)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[automation] tick failed', err)
    }
  }

  // Run once immediately on start.
  void tick()
  timer = setInterval(tick, BASE_POLL_INTERVAL_MS)

  return () => {
    cancelled = true
    if (timer) clearInterval(timer)
  }
}

async function runOnce(opts: EngineOpts): Promise<void> {
  const { user, workspaces } = opts
  const date = todayLocal(user.timezone)
  const dayKey = date
  const mode = await getActiveMode(user.id).catch(() => null)

  // 1. Task reminders + escalation — always run, but escalation is skipped
  //    if the current mode suppresses it (recovery/travel/crunch).
  for (const ws of workspaces) {
    const [today, overdue] = await Promise.all([
      listTasksForDate(user.id, date, ws.id),
      listOverdueOpenTasks(user.id, date, ws.id),
    ])
    await processTaskAutomations(
      user,
      ws,
      [...today, ...overdue],
      dayKey,
      mode?.automation.suppressEscalation ?? false
    )
  }

  // 2. Drift report — once per day per workspace, skipped in modes that
  //    suppress drift notifications (recovery/travel/crunch).
  if (mode?.automation.suppressDrift) return
  for (const ws of workspaces) {
    const driftKey = `automation_drift_${ws.id}_${dayKey}`
    if (fired(driftKey)) continue
    const projects = await listProjects(user.id, ws.id)
    const drifting = projects.filter(
      (p) => p.status === 'active' && daysSince(p.updated_at) >= 4
    )
    if (drifting.length >= 3) {
      markFired(driftKey)
      await createNotification({
        userId: user.id,
        workspaceId: ws.id,
        kind: 'project_at_risk',
        title: `${drifting.length} ${ws.name.toLowerCase()} projects drifting`,
        body: drifting
          .slice(0, 3)
          .map((p) => `• ${p.name} — ${daysSince(p.updated_at)}d silent`)
          .join('\n'),
        link: '/life/projects',
      })
      fireBrowserNotification(
        `${ws.name}: ${drifting.length} projects drifting`,
        drifting.slice(0, 3).map((p) => p.name).join(', '),
        () => opts.onNavigate?.('/life/projects')
      )
    }
  }

  // 3. Waiting-on SLA checker — once per day per workspace, skipped when
  //    the mode suppresses SLA (recovery).
  if (mode?.automation.suppressSla) return
  for (const ws of workspaces) {
    const slaKey = `automation_sla_${ws.id}_${dayKey}`
    if (fired(slaKey)) continue
    const waiting = await listWaitingOn(user.id, { workspaceId: ws.id, status: 'waiting' })
    const overdue = waiting.filter((w) => new Date(w.follow_up_at).getTime() < Date.now())
    if (overdue.length > 0) {
      markFired(slaKey)
      await createNotification({
        userId: user.id,
        workspaceId: ws.id,
        kind: 'waiting_follow_up',
        title: `${overdue.length} follow-up${overdue.length === 1 ? '' : 's'} overdue`,
        body: overdue.slice(0, 3).map((w) => `• ${w.who}: ${w.title}`).join('\n'),
        link: '/life/work',
      })
    }
  }
}

async function processTaskAutomations(
  user: LifeUser,
  workspace: LifeWorkspace,
  tasks: LifeTask[],
  dayKey: string,
  suppressEscalation: boolean
): Promise<void> {
  const now = new Date()
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'dropped') continue
    const automation = (task.automation ?? {}) as TaskAutomation

    // 1a. Reminders relative to due_at or start_at
    if (task.automation && automation.reminders?.length && (task.due_at || task.start_at)) {
      const anchor = new Date(task.due_at ?? task.start_at!)
      for (const r of automation.reminders) {
        const fireAt = new Date(anchor.getTime() + r.offset_min * 60_000)
        const delta = minutesBetween(now, fireAt)
        // Fire if within the last poll interval (inclusive of a small fudge)
        if (delta <= 0 && delta > -(BASE_POLL_INTERVAL_MS / 60_000 + 1)) {
          const key = `automation_task_${task.id}_${r.offset_min}_${dayKey}`
          if (fired(key)) continue
          markFired(key)
          await createNotification({
            userId: user.id,
            workspaceId: workspace.id,
            kind: 'task_due',
            title: r.label ?? task.title,
            body: task.when_where ?? task.first_action ?? 'Time to work on this.',
            link: task.project_id ? `/life/projects/${task.project_id}` : '/life',
          })
          if (r.channel === 'browser') {
            fireBrowserNotification(task.title, task.when_where ?? task.notes ?? undefined)
          }
        }
      }
    }

    // 1b. Escalation: untouched for N days. Skipped by mode when suppressing.
    if (
      !suppressEscalation &&
      automation.escalate_if_untouched_days &&
      automation.escalate_if_untouched_days > 0
    ) {
      const untouchedDays = daysSince(task.updated_at)
      if (untouchedDays >= automation.escalate_if_untouched_days) {
        const key = `automation_escalate_${task.id}_${dayKey}`
        if (fired(key)) continue
        markFired(key)
        await createNotification({
          userId: user.id,
          workspaceId: workspace.id,
          kind: 'project_at_risk',
          title: `Untouched ${untouchedDays}d: ${task.title}`,
          body: 'Agent wants to know — still relevant, or drop it?',
          link: task.project_id ? `/life/projects/${task.project_id}` : '/life',
        })
      }
    }
  }
}
