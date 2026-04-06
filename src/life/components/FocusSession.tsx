// Focus session — a modal-less overlay that runs a countdown timer on a task,
// hints at DND on Slack/browser, and at the end asks "did you finish the
// intent?" → records actual_min as an estimate row for calibration + updates
// task status + done_at.
//
// Keyboard: Escape to abort, Space to pause/resume.
import React, { useEffect, useRef, useState } from 'react'
import type { LifeTask, LifeUser } from '../types'
import { updateTask, updateTaskStatus, recordEstimate } from '../lib/db'

interface Props {
  user: LifeUser
  task: LifeTask
  onClose: () => void
}

function fmt(mins: number): string {
  const m = Math.max(0, Math.floor(mins))
  const s = Math.max(0, Math.round((mins - m) * 60))
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const FocusSession: React.FC<Props> = ({ user, task, onClose }) => {
  const estimate = task.estimate_min ?? 25
  const [remaining, setRemaining] = useState(estimate)
  const [paused, setPaused] = useState(false)
  const [phase, setPhase] = useState<'running' | 'prompt' | 'done'>('running')
  const [finished, setFinished] = useState<boolean | null>(null)
  const startedAt = useRef<number>(Date.now())
  const elapsedMin = useRef<number>(0)

  // Timer
  useEffect(() => {
    if (phase !== 'running' || paused) return
    const id = setInterval(() => {
      setRemaining((r) => {
        const next = r - 1 / 60
        if (next <= 0) {
          clearInterval(id)
          elapsedMin.current = estimate
          setPhase('prompt')
          return 0
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [phase, paused, estimate])

  // Hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleAbort()
      if (e.code === 'Space' && phase === 'running') {
        e.preventDefault()
        setPaused((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const handleAbort = () => {
    elapsedMin.current = Math.round((Date.now() - startedAt.current) / 60_000)
    setPhase('prompt')
  }

  const resolve = async (didFinish: boolean) => {
    setFinished(didFinish)
    setPhase('done')
    const actual = Math.max(1, elapsedMin.current)
    try {
      if (didFinish) {
        await updateTaskStatus(user.id, task.id, 'done')
        await updateTask(user.id, task.id, { actual_min: actual })
        if (task.estimate_min) {
          await recordEstimate({
            userId: user.id,
            taskId: task.id,
            estimatedMin: task.estimate_min,
            actualMin: actual,
          })
        }
      } else {
        await updateTask(user.id, task.id, { actual_min: actual })
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Focus session persist failed', err)
    }
  }

  return (
    <div className="focus-overlay" role="dialog" aria-label="Focus session">
      <div className="focus-card">
        {phase === 'running' && (
          <>
            <div className="focus-kicker">FOCUS · {task.title}</div>
            <div className="focus-timer">{fmt(remaining)}</div>
            {task.when_where && <div className="focus-hint">{task.when_where}</div>}
            {task.first_action && (
              <div className="focus-hint bold">First action: {task.first_action}</div>
            )}
            <div className="focus-actions">
              <button className="life-btn" onClick={() => setPaused((p) => !p)}>
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button className="life-btn" onClick={handleAbort}>
                Stop early
              </button>
            </div>
            <div className="focus-foot">
              Slack, browser notifications off. Phone face-down. Space = pause, Esc = stop.
            </div>
          </>
        )}

        {phase === 'prompt' && (
          <>
            <div className="focus-kicker">Did you finish the intent?</div>
            <div className="focus-timer small">{task.title}</div>
            <div className="focus-actions">
              <button className="life-btn primary" onClick={() => resolve(true)}>
                Yes, done
              </button>
              <button className="life-btn" onClick={() => resolve(false)}>
                Not yet
              </button>
            </div>
            <div className="focus-foot">
              Calibration will use {Math.max(1, elapsedMin.current)}m as the actual.
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="focus-kicker">
              {finished ? 'Logged as done.' : 'Logged. Come back to it.'}
            </div>
            <div className="focus-actions">
              <button className="life-btn primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default FocusSession
