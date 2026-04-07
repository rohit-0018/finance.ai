import React, { useEffect, useState } from 'react'
import { useLifeStore } from '../store'
import { createTimeBlock, listProjects } from '../lib/db'
import { createTaskSeries, RECURRENCE_OPTIONS, type RecurrencePreset } from '../lib/recurring'
import { resolveWorkspaceFromTitle } from '../lib/prefixRouter'
import { isGoogleConfigured } from '../lib/google/auth'
import type { LifeProject, TimeBlockKind } from '../types'

// This modal is reused from anywhere a user wants to create a task or focus
// block — Calendar (drag-select), Todos (+ New), Today, etc. The original
// `CalendarCreateModal` name is preserved so existing imports keep working.
//
// All fields are optional so callers can either prefill from a calendar
// selection or pop the modal cold.

interface Props {
  /** Optional preselected start (local time). Defaults to "now". */
  start?: Date
  /** Optional preselected end. Defaults to start + 30m. */
  end?: Date
  /** True when the selection lives on the all-day rail. */
  allDay?: boolean
  /** "task" or "block" — defaults to task. */
  initialMode?: 'task' | 'block'
  onClose: () => void
  onCreated: () => void
}

const BLOCK_KINDS: TimeBlockKind[] = ['deep', 'office', 'learn', 'admin', 'break']

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function shiftDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return isoDate(d)
}

const CalendarCreateModal: React.FC<Props> = ({
  start,
  end,
  allDay = false,
  initialMode = 'task',
  onClose,
  onCreated,
}) => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const workspaces = useLifeStore((s) => s.workspaces)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)

  // Defaults: when no preselection, start = now, end = +30min.
  const startDate = start ?? new Date()
  const endDate = end ?? new Date(startDate.getTime() + 30 * 60_000)

  const [mode, setMode] = useState<'task' | 'block'>(initialMode)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [projectId, setProjectId] = useState<string>('')
  const [date, setDate] = useState(isoDate(startDate))
  const [startTime, setStartTime] = useState(allDay || !start ? '' : hhmm(startDate))
  const [estimate, setEstimate] = useState<number>(
    Math.max(15, Math.round((endDate.getTime() - startDate.getTime()) / 60_000))
  )
  const [priority, setPriority] = useState<number>(3)
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [recurrence, setRecurrence] = useState<RecurrencePreset>('none')
  const [intervalDays, setIntervalDays] = useState(2)
  const [until, setUntil] = useState('')
  const [emailNotify, setEmailNotify] = useState(false)
  const [blockKind, setBlockKind] = useState<TimeBlockKind>('deep')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!lifeUser) return
    listProjects(lifeUser.id, activeWorkspace?.id).then(setProjects).catch(() => {})
  }, [lifeUser, activeWorkspace?.id])

  const today = isoDate(new Date())
  const yesterday = shiftDays(today, -1)
  const tomorrow = shiftDays(today, 1)

  const submit = async () => {
    if (!lifeUser || !title.trim()) return
    setSaving(true)
    try {
      if (mode === 'block') {
        const startMin = startDate.getHours() * 60 + startDate.getMinutes()
        const endMin = endDate.getHours() * 60 + endDate.getMinutes()
        await createTimeBlock({
          userId: lifeUser.id,
          workspaceId: activeWorkspace?.id,
          date,
          start_minute: startMin,
          end_minute: endMin,
          label: title.trim(),
          kind: blockKind,
        })
      } else {
        // Honor Ofc/Prs prefix routing.
        const routed = resolveWorkspaceFromTitle(
          title.trim(),
          workspaces,
          activeWorkspace?.id ?? null
        )
        await createTaskSeries({
          userId: lifeUser.id,
          workspaceId: routed.workspaceId ?? undefined,
          title: routed.title,
          notes: notes.trim() || undefined,
          project_id: projectId || null,
          estimate_min: estimate,
          priority,
          startTime: startTime || null,
          dueDate: dueDate || null,
          dueTime: dueTime || null,
          fromDate: date,
          recurrence: {
            preset: recurrence,
            intervalDays,
            until: until || null,
          },
          emailNotify,
        })
      }
      onCreated()
      onClose()
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="life-card"
        style={{ width: 580, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto' }}
      >
        <div className="life-card-title">New {mode === 'task' ? 'task' : 'focus block'}</div>

        <div style={{ display: 'flex', gap: 6, marginTop: 12, marginBottom: 14 }}>
          <button
            className={`life-btn ${mode === 'task' ? 'primary' : ''}`}
            onClick={() => setMode('task')}
          >
            ✅ Task
          </button>
          <button
            className={`life-btn ${mode === 'block' ? 'primary' : ''}`}
            onClick={() => setMode('block')}
          >
            ▦ Focus block
          </button>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            mode === 'task'
              ? 'What needs doing? (prefix Ofc / Prs to route)'
              : 'Block label — e.g. Deep work, Standup'
          }
          autoFocus
          style={inp}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />

        {mode === 'task' && (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            style={{ ...inp, minHeight: 60 }}
          />
        )}

        <Label>Date</Label>
        {/* Yesterday / Today / Tomorrow shortcut chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            className={`life-btn ${date === yesterday ? 'primary' : ''}`}
            onClick={() => setDate(yesterday)}
            style={{ padding: '6px 12px', fontSize: '0.78rem' }}
          >
            Yesterday
          </button>
          <button
            className={`life-btn ${date === today ? 'primary' : ''}`}
            onClick={() => setDate(today)}
            style={{ padding: '6px 12px', fontSize: '0.78rem' }}
          >
            Today
          </button>
          <button
            className={`life-btn ${date === tomorrow ? 'primary' : ''}`}
            onClick={() => setDate(tomorrow)}
            style={{ padding: '6px 12px', fontSize: '0.78rem' }}
          >
            Tomorrow
          </button>
          <button
            className={`life-btn ${date === shiftDays(today, 7) ? 'primary' : ''}`}
            onClick={() => setDate(shiftDays(today, 7))}
            style={{ padding: '6px 12px', fontSize: '0.78rem' }}
          >
            +1 week
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inp}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Label>Start time</Label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={inp}
              placeholder="—"
            />
          </div>
          <div style={{ flex: 1 }}>
            <Label>Duration (min)</Label>
            <input
              type="number"
              min={15}
              step={15}
              value={estimate}
              onChange={(e) => setEstimate(Number(e.target.value) || 30)}
              style={inp}
            />
          </div>
        </div>

        {mode === 'task' && (
          <>
            <Label>Priority</Label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`life-btn ${priority === n ? 'primary' : ''}`}
                  onClick={() => setPriority(n)}
                  style={{ padding: '6px 14px' }}
                >
                  P{n}
                </button>
              ))}
            </div>

            <Label>Due by (optional)</Label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <button
                className={`life-btn ${dueDate === today ? 'primary' : ''}`}
                onClick={() => setDueDate(today)}
                style={{ padding: '6px 12px', fontSize: '0.78rem' }}
              >
                Today
              </button>
              <button
                className={`life-btn ${dueDate === tomorrow ? 'primary' : ''}`}
                onClick={() => setDueDate(tomorrow)}
                style={{ padding: '6px 12px', fontSize: '0.78rem' }}
              >
                Tomorrow
              </button>
              <button
                className={`life-btn ${dueDate === shiftDays(today, 7) ? 'primary' : ''}`}
                onClick={() => setDueDate(shiftDays(today, 7))}
                style={{ padding: '6px 12px', fontSize: '0.78rem' }}
              >
                +1 week
              </button>
              {dueDate && (
                <button
                  className="life-btn"
                  onClick={() => {
                    setDueDate('')
                    setDueTime('')
                  }}
                  style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                >
                  ✕ clear
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={inp}
              />
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                placeholder="end of day"
                style={inp}
              />
            </div>

            <Label>Project (optional)</Label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={inp}
            >
              <option value="">— none —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <Label>Repeat</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {RECURRENCE_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  className={`life-btn ${recurrence === o.id ? 'primary' : ''}`}
                  onClick={() => setRecurrence(o.id)}
                  style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {recurrence === 'every_n_days' && (
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Label>Every N days</Label>
                  <input
                    type="number"
                    min={1}
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(Math.max(1, Number(e.target.value) || 1))}
                    style={inp}
                  />
                </div>
              </div>
            )}
            {recurrence !== 'none' && (
              <div>
                <Label>Repeat until (optional)</Label>
                <input
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  style={inp}
                />
                <div
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)',
                    marginTop: -4,
                    marginBottom: 10,
                  }}
                >
                  Materializes the next 60 days as real tasks. They show up on Calendar and the
                  Todos page and are individually editable.
                </div>
              </div>
            )}

            {/* Email reminder — needs Gmail OAuth (Integrations page). */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                background: 'var(--bg2, var(--bg))',
                border: '1px solid var(--border)',
                borderRadius: 8,
                marginBottom: 10,
                cursor: isGoogleConfigured() ? 'pointer' : 'not-allowed',
                opacity: isGoogleConfigured() ? 1 : 0.5,
              }}
              title={
                isGoogleConfigured()
                  ? 'Send a Gmail when the start time hits'
                  : 'Connect Google in Integrations to enable email reminders'
              }
            >
              <input
                type="checkbox"
                checked={emailNotify}
                onChange={(e) => setEmailNotify(e.target.checked)}
                disabled={!isGoogleConfigured()}
              />
              <span style={{ fontSize: '0.84rem' }}>
                📧 Email me when this happens
                {!isGoogleConfigured() && (
                  <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>
                    — connect Gmail in Integrations
                  </span>
                )}
              </span>
            </label>
          </>
        )}

        {mode === 'block' && (
          <>
            <Label>Block kind</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {BLOCK_KINDS.map((k) => (
                <button
                  key={k}
                  className={`life-btn ${blockKind === k ? 'primary' : ''}`}
                  onClick={() => setBlockKind(k)}
                  style={{ textTransform: 'capitalize' }}
                >
                  {k}
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="life-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="life-btn primary"
            onClick={submit}
            disabled={saving || !title.trim()}
          >
            {saving ? 'Saving…' : `Create ${mode}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = {
  width: '100%',
  padding: 9,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '0.88rem',
  fontFamily: 'inherit',
  outline: 'none',
  marginBottom: 10,
  boxSizing: 'border-box',
}

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontSize: '0.7rem',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-muted)',
      marginBottom: 4,
      fontWeight: 600,
    }}
  >
    {children}
  </div>
)

export default CalendarCreateModal
