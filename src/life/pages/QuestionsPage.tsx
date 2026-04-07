import React, { useCallback, useEffect, useMemo, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  searchTasks,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  listProjects,
} from '../lib/db'
import type { LifeTask, LifeProject } from '../types'
import { todayLocal, prettyDate } from '../lib/time'
import { resolveWorkspaceFromTitle } from '../lib/prefixRouter'
import { formatDuration } from '../lib/activeTimer'

// Convention: a "question" is a LifeTask carrying the `question` tag.
// This lets questions inherit scheduling, calendar surfacing, projects,
// priorities, and search for free — no schema change required.
export const QUESTION_TAG = 'question'

type Filter = 'open' | 'scheduled' | 'answered' | 'all'

const QuestionsPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const workspaces = useLifeStore((s) => s.workspaces)
  const [questions, setQuestions] = useState<LifeTask[]>([])
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('open')
  const [search, setSearch] = useState('')

  // Quick add
  const [draft, setDraft] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [draftProject, setDraftProject] = useState<string | ''>('')

  // Schedule modal state
  const [scheduling, setScheduling] = useState<LifeTask | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduleEstimate, setScheduleEstimate] = useState('')

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      const page = await searchTasks(
        lifeUser.id,
        {
          tags: [QUESTION_TAG],
          workspaceId: activeWorkspace?.id ?? null,
          parentsOnly: false,
          statuses:
            filter === 'open'
              ? ['todo', 'doing']
              : filter === 'answered'
              ? ['done']
              : filter === 'scheduled'
              ? ['todo', 'doing']
              : ['todo', 'doing', 'done', 'dropped'],
          query: search.trim() || undefined,
          searchInNotes: true,
        },
        { offset: 0, limit: 200 }
      )
      let rows = page.rows
      if (filter === 'scheduled') rows = rows.filter((t) => !!t.scheduled_for || !!t.start_at)
      if (filter === 'open') rows = rows.filter((t) => !t.scheduled_for && !t.start_at)
      setQuestions(rows)
      const ps = await listProjects(lifeUser.id, activeWorkspace?.id)
      setProjects(ps)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, activeWorkspace?.id, filter, search])

  useEffect(() => {
    load()
  }, [load])

  const projectName = useCallback(
    (id: string | null) => projects.find((p) => p.id === id)?.name ?? null,
    [projects]
  )

  const counts = useMemo(() => {
    return {
      total: questions.length,
    }
  }, [questions])

  const submitDraft = async () => {
    if (!lifeUser || !draft.trim()) return
    const routed = resolveWorkspaceFromTitle(
      draft.trim(),
      workspaces,
      activeWorkspace?.id ?? null
    )
    await createTask({
      userId: lifeUser.id,
      workspaceId: routed.workspaceId ?? undefined,
      title: routed.title,
      notes: draftNotes.trim() || undefined,
      tags: [QUESTION_TAG],
      project_id: draftProject || null,
      scheduled_for: null,
      priority: 3,
      source: 'manual',
    })
    setDraft('')
    setDraftNotes('')
    setShowNotes(false)
    setDraftProject('')
    load()
  }

  const openScheduler = (q: LifeTask) => {
    setScheduling(q)
    setScheduleDate(q.scheduled_for ?? todayLocal(lifeUser?.timezone))
    setScheduleTime(q.start_at ? new Date(q.start_at).toISOString().slice(11, 16) : '')
    setScheduleEstimate(q.estimate_min?.toString() ?? '')
  }

  const saveSchedule = async () => {
    if (!lifeUser || !scheduling) return
    let start_at: string | null = null
    if (scheduleTime && scheduleDate) {
      // Treat the user's local wall clock as the intended start.
      start_at = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString()
    }
    await updateTask(lifeUser.id, scheduling.id, {
      scheduled_for: scheduleDate || null,
      start_at,
      estimate_min: scheduleEstimate ? Number(scheduleEstimate) : null,
    })
    setScheduling(null)
    load()
  }

  const unschedule = async (q: LifeTask) => {
    if (!lifeUser) return
    await updateTask(lifeUser.id, q.id, { scheduled_for: null, start_at: null })
    load()
  }

  const markAnswered = async (q: LifeTask) => {
    if (!lifeUser) return
    await updateTaskStatus(lifeUser.id, q.id, 'done')
    load()
  }

  const reopen = async (q: LifeTask) => {
    if (!lifeUser) return
    await updateTaskStatus(lifeUser.id, q.id, 'todo')
    load()
  }

  const remove = async (q: LifeTask) => {
    if (!lifeUser) return
    if (!confirm(`Delete question "${q.title}"?`)) return
    await deleteTask(lifeUser.id, q.id)
    load()
  }

  return (
    <LifeLayout title="Questions">
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted, #888)', fontSize: '0.85rem' }}>
        Capture open questions as they pop up. Schedule them when you have time to think — they
        appear on your calendar.
      </p>

      {/* Quick capture */}
      <div className="life-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitDraft()
              }
            }}
            placeholder="What question is on your mind? (prefix with Ofc / Prs to route)"
            style={{
              flex: 1,
              padding: 10,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: '0.95rem',
              outline: 'none',
            }}
          />
          <button
            className="life-btn"
            onClick={() => setShowNotes((v) => !v)}
            title="Add context"
          >
            {showNotes ? '−' : '+'} context
          </button>
          <button className="life-btn primary" onClick={submitDraft}>
            Capture
          </button>
        </div>
        {showNotes && (
          <div style={{ marginTop: 10 }}>
            <textarea
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              placeholder="Why is this question interesting? Any leads or sources?"
              style={{
                width: '100%',
                padding: 10,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg)',
                color: 'var(--text)',
                minHeight: 60,
                fontSize: '0.85rem',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <select
              value={draftProject}
              onChange={(e) => setDraftProject(e.target.value)}
              style={{
                marginTop: 8,
                padding: '6px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '0.82rem',
              }}
            >
              <option value="">Link to project (optional)…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Filter + search */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {(['open', 'scheduled', 'answered', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`life-btn ${filter === f ? 'primary' : ''}`}
            onClick={() => setFilter(f)}
            style={{ textTransform: 'capitalize' }}
          >
            {f}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input
          className="life-search"
          placeholder="Search questions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
      </div>

      {loading && questions.length === 0 ? (
        <div className="life-empty">
          <p>Loading…</p>
        </div>
      ) : questions.length === 0 ? (
        <div className="life-empty">
          <h3>{filter === 'open' ? 'Inbox is empty' : 'No questions'}</h3>
          <p>
            {filter === 'open'
              ? 'When something pops into your head, drop it here so you can keep working.'
              : 'Try a different filter.'}
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              fontSize: '0.74rem',
              color: 'var(--text-muted)',
              marginBottom: 8,
            }}
          >
            {counts.total} {counts.total === 1 ? 'question' : 'questions'}
          </div>
          {questions.map((q) => {
            const scheduled = !!q.scheduled_for || !!q.start_at
            const projName = projectName(q.project_id)
            return (
              <div key={q.id} className="life-card">
                <div
                  className="life-card-title"
                  style={{
                    textDecoration: q.status === 'done' ? 'line-through' : 'none',
                    opacity: q.status === 'done' ? 0.6 : 1,
                  }}
                >
                  {q.title}
                </div>
                {q.notes && (
                  <p
                    style={{
                      margin: '6px 0',
                      fontSize: '0.85rem',
                      lineHeight: 1.5,
                      color: 'var(--text-muted)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {q.notes}
                  </p>
                )}
                <div className="life-card-meta" style={{ marginTop: 8 }}>
                  {scheduled && q.scheduled_for && (
                    <span className="life-pill personal" title="Scheduled">
                      📅 {prettyDate(q.scheduled_for, lifeUser?.timezone)}
                      {q.start_at &&
                        ` · ${new Date(q.start_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`}
                    </span>
                  )}
                  {projName && <span className="life-pill office">{projName}</span>}
                  {q.estimate_min && <span>~{formatDuration(q.estimate_min)}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {q.status !== 'done' && (
                    <button className="life-btn" onClick={() => openScheduler(q)}>
                      {scheduled ? 'Reschedule' : 'Schedule'}
                    </button>
                  )}
                  {scheduled && q.status !== 'done' && (
                    <button className="life-btn" onClick={() => unschedule(q)}>
                      Unschedule
                    </button>
                  )}
                  {q.status !== 'done' ? (
                    <button className="life-btn primary" onClick={() => markAnswered(q)}>
                      Mark answered
                    </button>
                  ) : (
                    <button className="life-btn" onClick={() => reopen(q)}>
                      Reopen
                    </button>
                  )}
                  <button className="life-btn danger" onClick={() => remove(q)}>
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* Schedule modal */}
      {scheduling && (
        <div
          onClick={() => setScheduling(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="life-card"
            style={{ width: 420, maxWidth: '90vw' }}
          >
            <div className="life-card-title">Schedule question</div>
            <p style={{ margin: '6px 0 14px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {scheduling.title}
            </p>
            <label
              style={{
                display: 'block',
                fontSize: '0.74rem',
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              Date
            </label>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              style={{
                width: '100%',
                padding: 8,
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg)',
                color: 'var(--text)',
                marginBottom: 10,
              }}
            />
            <label
              style={{
                display: 'block',
                fontSize: '0.74rem',
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              Time (optional)
            </label>
            <input
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              style={{
                width: '100%',
                padding: 8,
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg)',
                color: 'var(--text)',
                marginBottom: 10,
              }}
            />
            <label
              style={{
                display: 'block',
                fontSize: '0.74rem',
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              Estimate (minutes)
            </label>
            <input
              type="number"
              min={0}
              value={scheduleEstimate}
              onChange={(e) => setScheduleEstimate(e.target.value)}
              placeholder="e.g. 30"
              style={{
                width: '100%',
                padding: 8,
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg)',
                color: 'var(--text)',
                marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="life-btn" onClick={() => setScheduling(null)}>
                Cancel
              </button>
              <button className="life-btn primary" onClick={saveSchedule}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </LifeLayout>
  )
}

export default QuestionsPage
