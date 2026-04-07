// Single active timer — Toggl-style. Only one task ticks at a time.
//
// State lives in localStorage so a tab refresh / accidental close does NOT
// lose elapsed time. The hook subscribes to a tiny pub-sub so multiple
// components (row button, edit panel, floating bar) stay in sync.
//
// Contract:
//   start(taskId)        → stops any other running timer, marks taskId as
//                          running with startedAt = Date.now(). Returns the
//                          elapsed minutes from the previously-running task
//                          (caller writes that to actual_min).
//   stop()               → stops the running timer (if any). Returns the
//                          elapsed minutes the caller should add to that
//                          task's actual_min.
//   useActiveTimer()     → React hook returning { activeId, elapsedSec }.
//                          Re-renders once per second when something is running.
import { useEffect, useState } from 'react'

const LS_KEY = 'todos_active_timer_v1'

interface TimerState {
  taskId: string
  startedAt: number // ms epoch
}

interface StopResult {
  taskId: string | null
  /** Whole minutes elapsed since start. */
  elapsedMin: number
}

// ── Pub/sub ────────────────────────────────────────────────────────────
type Listener = () => void
const listeners = new Set<Listener>()
function emit() {
  for (const l of listeners) l()
}

function read(): TimerState | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as TimerState
    if (typeof parsed?.taskId === 'string' && typeof parsed?.startedAt === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function write(state: TimerState | null) {
  try {
    if (state) localStorage.setItem(LS_KEY, JSON.stringify(state))
    else localStorage.removeItem(LS_KEY)
  } catch {
    /* non-fatal */
  }
  emit()
}

function elapsedMinutesSince(startedAt: number): number {
  return Math.max(0, Math.round((Date.now() - startedAt) / 60_000))
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Start the timer on a task. If another task is currently running, it is
 * stopped first and its elapsed minutes are returned in `previous` so the
 * caller can persist them to that task's actual_min.
 */
export function startTimer(taskId: string): { previous: StopResult } {
  const prev = read()
  let previous: StopResult = { taskId: null, elapsedMin: 0 }
  if (prev) {
    previous = { taskId: prev.taskId, elapsedMin: elapsedMinutesSince(prev.startedAt) }
  }
  write({ taskId, startedAt: Date.now() })
  return { previous }
}

/**
 * Stop the active timer. Returns which task was running and for how many
 * minutes. If nothing was running, returns { taskId: null, elapsedMin: 0 }.
 */
export function stopTimer(): StopResult {
  const cur = read()
  if (!cur) return { taskId: null, elapsedMin: 0 }
  const result: StopResult = {
    taskId: cur.taskId,
    elapsedMin: elapsedMinutesSince(cur.startedAt),
  }
  write(null)
  return result
}

/**
 * Read the current active timer without mutating it. Useful for one-off
 * checks where you don't need re-render-on-tick.
 */
export function peekTimer(): { taskId: string; elapsedSec: number } | null {
  const s = read()
  if (!s) return null
  return {
    taskId: s.taskId,
    elapsedSec: Math.max(0, Math.round((Date.now() - s.startedAt) / 1000)),
  }
}

/**
 * React hook — re-renders once per second while a timer is running so the
 * elapsed display stays live. Subscribes to start/stop events from any
 * other component using the same hook.
 */
export function useActiveTimer(): {
  activeId: string | null
  elapsedSec: number
} {
  const [, force] = useState(0)

  useEffect(() => {
    const tick = () => force((n) => n + 1)
    listeners.add(tick)
    // Tick every second, but only if a timer is running.
    let interval: number | undefined
    const ensureInterval = () => {
      if (read()) {
        if (interval == null) {
          interval = window.setInterval(tick, 1000)
        }
      } else if (interval != null) {
        clearInterval(interval)
        interval = undefined
      }
    }
    // Re-evaluate interval every emit (start/stop events).
    const wrapped = () => {
      tick()
      ensureInterval()
    }
    listeners.delete(tick)
    listeners.add(wrapped)
    ensureInterval()
    // Cross-tab sync: storage events fire on other tabs, not our own.
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) wrapped()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(wrapped)
      if (interval != null) clearInterval(interval)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const cur = read()
  if (!cur) return { activeId: null, elapsedSec: 0 }
  return {
    activeId: cur.taskId,
    elapsedSec: Math.max(0, Math.round((Date.now() - cur.startedAt) / 1000)),
  }
}

/**
 * Format seconds as `Hh MMm SSs` (or `MMm SSs` if under an hour, `SSs`
 * under a minute). Used by the floating bar and timer chips.
 */
export function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm.toString().padStart(2, '0')}m`
}
