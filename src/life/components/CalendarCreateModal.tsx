import React, { useEffect, useState } from 'react'
import { useLifeStore } from '../store'
import { createTimeBlock, listProjects } from '../lib/db'
import { createTaskSeries, RECURRENCE_OPTIONS, type RecurrencePreset } from '../lib/recurring'
import { resolveWorkspaceFromTitle } from '../lib/prefixRouter'
import type { LifeProject, TimeBlockKind } from '../types'

interface Props {
  /** Selected start (local time) */
  start: Date
  /** Selected end (local time) */
  end: Date
  /** True if the user dragged on the all-day rail. */
  allDay: boolean
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

const CalendarCreateModal: React.FC<Props> = ({ start, end, allDay, onClose, onCreated }) => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const workspaces = useLifeStore((s) => s.workspaces)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)

  const [mode, setMode] = useState<'task' | 'block'>('task')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [projectId, setProjectId] = useState<string>('')
  const [date, setDate] = useState(isoDate(start))
  const [startTime, setStartTime] = useState(allDay ? '' : hhmm(start))
  const [estimate, setEstimate] = useState<number>(
    Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000))
  )
  const [recurrence, setRecurrence] = useState<RecurrencePreset>('none')
  const [intervalDays, setIntervalDays] = useState(2)
  const [until, setUntil] = useState('')
  const [blockKind, setBlockKind] = useState<TimeBlockKind>('deep')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!lifeUser) return
    listProjects(lifeUser.id, activeWorkspace?.id).then(setProjects).catch(() => {})
  }, [lifeUser, activeWorkspace?.id])

  const submit = async () => {
    if (!lifeUser || !title.trim()) return
    setSaving(true)
    try {
      if (mode === 'block') {
        const startMin = start.getHours() * 60 + start.getMinutes()
        const endMin = end.getHours() * 60 + end.getMinutes()
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
          startTime: allDay ? null : startTime || null,
          fromDate: date,
          recurrence: {
            preset: recurrence,
            intervalDays,
            until: until || null,
          },
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
        style={{ width: 540, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}
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

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Label>Date</Label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inp}
            />
          </div>
          {!allDay && (
            <div style={{ flex: 1 }}>
              <Label>Start time</Label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={inp}
              />
            </div>
          )}
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
