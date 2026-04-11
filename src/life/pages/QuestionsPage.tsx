import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
// A question that the user wants to act on also gets the `todo` tag — that
// makes it surface inside TodosPage *and* keeps it visible here. If a time
// is set on the task it naturally lands on the calendar via scheduled_for /
// start_at — no extra wiring needed.
export const QUESTION_TAG = 'question'
export const TODO_TAG = 'todo'

type Filter = 'open' | 'todo' | 'scheduled' | 'answered' | 'all'

// ──────────────────────────────────────────────────────────────────────
// Lightweight rich-text editor
//
// We deliberately avoid pulling in TipTap/Lexical (~200 KB) just for an
// answer field. This is a contentEditable surface with a tiny toolbar
// that calls document.execCommand. The serialized value is HTML stored
// inside life_tasks.notes — when notes starts with '<' we render it as
// HTML, otherwise as plain text (so legacy plain-text notes still read
// correctly).
// ──────────────────────────────────────────────────────────────────────
interface RichEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}
const RichEditor: React.FC<RichEditorProps> = ({
  value,
  onChange,
  placeholder = 'Write your answer…',
  minHeight = 140,
}) => {
  const ref = useRef<HTMLDivElement>(null)
  // Only sync from props when the editor is NOT focused, otherwise we'd
  // clobber the caret on every keystroke.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (document.activeElement === el) return
    if (el.innerHTML !== value) el.innerHTML = value || ''
  }, [value])

  const exec = (cmd: string, arg?: string) => {
    document.execCommand(cmd, false, arg)
    const el = ref.current
    if (el) onChange(el.innerHTML)
    ref.current?.focus()
  }

  const btn = (label: React.ReactNode, title: string, onClick: () => void) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        padding: '4px 8px',
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--bg)',
        color: 'var(--text)',
        fontSize: '0.78rem',
        cursor: 'pointer',
        minWidth: 28,
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: 6,
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-muted, rgba(127,127,127,0.06))',
          flexWrap: 'wrap',
        }}
      >
        {btn(<b>B</b>, 'Bold (Ctrl+B)', () => exec('bold'))}
        {btn(<i>I</i>, 'Italic (Ctrl+I)', () => exec('italic'))}
        {btn(<u>U</u>, 'Underline', () => exec('underline'))}
        {btn('S', 'Strikethrough', () => exec('strikeThrough'))}
        <span style={{ width: 1, background: 'var(--border)', margin: '2px 4px' }} />
        {btn('H', 'Heading', () => exec('formatBlock', 'H3'))}
        {btn('“ ”', 'Quote', () => exec('formatBlock', 'BLOCKQUOTE'))}
        {btn('</>', 'Code block', () => exec('formatBlock', 'PRE'))}
        <span style={{ width: 1, background: 'var(--border)', margin: '2px 4px' }} />
        {btn('•', 'Bulleted list', () => exec('insertUnorderedList'))}
        {btn('1.', 'Numbered list', () => exec('insertOrderedList'))}
        <span style={{ width: 1, background: 'var(--border)', margin: '2px 4px' }} />
        {btn('🔗', 'Insert link', () => {
          const url = prompt('URL')
          if (url) exec('createLink', url)
        })}
        {btn('⌫', 'Clear formatting', () => exec('removeFormat'))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        data-placeholder={placeholder}
        className="rich-editor-surface"
        style={{
          minHeight,
          padding: 12,
          outline: 'none',
          fontSize: '0.92rem',
          lineHeight: 1.55,
          color: 'var(--text)',
        }}
      />
      <style>{`
        .rich-editor-surface:empty:before {
          content: attr(data-placeholder);
          color: var(--text-muted, #888);
          pointer-events: none;
        }
        .rich-editor-surface h3 { margin: 8px 0 4px; font-size: 1rem; }
        .rich-editor-surface blockquote {
          margin: 6px 0;
          padding: 4px 12px;
          border-left: 3px solid var(--border);
          color: var(--text-muted);
        }
        .rich-editor-surface pre {
          margin: 6px 0;
          padding: 10px 12px;
          background: rgba(127,127,127,0.1);
          border-radius: 6px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.85rem;
          overflow-x: auto;
        }
        .rich-editor-surface ul, .rich-editor-surface ol { padding-left: 22px; margin: 4px 0; }
        .rich-editor-surface a { color: #4f8cff; text-decoration: underline; }
      `}</style>
    </div>
  )
}

// Render notes either as HTML (if it looks like HTML) or as plain text.
const NotesView: React.FC<{ notes: string }> = ({ notes }) => {
  const looksLikeHtml = /^\s*</.test(notes)
  if (looksLikeHtml) {
    return (
      <div
        className="rich-editor-surface"
        style={{
          fontSize: '0.88rem',
          lineHeight: 1.55,
          color: 'var(--text)',
        }}
        dangerouslySetInnerHTML={{ __html: notes }}
      />
    )
  }
  return (
    <p
      style={{
        margin: 0,
        fontSize: '0.88rem',
        lineHeight: 1.55,
        color: 'var(--text)',
        whiteSpace: 'pre-wrap',
      }}
    >
      {notes}
    </p>
  )
}

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
  const [draftTags, setDraftTags] = useState('')

  // Schedule modal state
  const [scheduling, setScheduling] = useState<LifeTask | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduleEstimate, setScheduleEstimate] = useState('')

  // Per-question answer editor — only one open at a time keeps the page calm.
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [answerDraft, setAnswerDraft] = useState('')
  const [savingAnswer, setSavingAnswer] = useState(false)

  // Project filter — null = all projects, '' = unlinked, or a project id.
  const [projectFilter, setProjectFilter] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      // Questions are intentionally cross-workspace knowledge — we never
      // filter by activeWorkspace here.
      const page = await searchTasks(
        lifeUser.id,
        {
          tags: [QUESTION_TAG],
          workspaceId: null,
          parentsOnly: false,
          statuses:
            filter === 'answered'
              ? ['done']
              : filter === 'all'
              ? ['todo', 'doing', 'done', 'dropped']
              : ['todo', 'doing'],
          query: search.trim() || undefined,
          searchInNotes: true,
        },
        { offset: 0, limit: 500 }
      )
      let rows = page.rows
      if (filter === 'scheduled') rows = rows.filter((t) => !!t.scheduled_for || !!t.start_at)
      // "Open" = any unanswered question (todo/doing). Scheduled questions
      // stay visible here — they're still open work, just with a date. The
      // "Scheduled" chip is a narrower view for when you want only those.
      if (filter === 'todo')
        rows = rows.filter((t) => Array.isArray(t.tags) && t.tags.includes(TODO_TAG))
      if (projectFilter !== null) {
        rows = rows.filter((t) =>
          projectFilter === '' ? !t.project_id : t.project_id === projectFilter
        )
      }
      setQuestions(rows)
      const ps = await listProjects(lifeUser.id)
      setProjects(ps)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, filter, search, projectFilter])

  useEffect(() => {
    load()
  }, [load])

  const projectName = useCallback(
    (id: string | null) => projects.find((p) => p.id === id)?.name ?? null,
    [projects]
  )

  // Stat cards in the hero — computed from the currently loaded slice. We
  // also fetch a tiny "all open" count separately would be nice, but the
  // current load already covers most filters, so reuse it.
  const stats = useMemo(() => {
    let open = 0,
      todo = 0,
      scheduled = 0,
      answered = 0
    for (const q of questions) {
      if (q.status === 'done') answered++
      else {
        // Every unanswered question counts toward "Open". Scheduled ones
        // additionally count toward "Scheduled" — the two buckets overlap
        // by design so scheduling a question doesn't make it disappear.
        open++
        if (q.scheduled_for || q.start_at) scheduled++
        if (Array.isArray(q.tags) && q.tags.includes(TODO_TAG)) todo++
      }
    }
    return { open, todo, scheduled, answered, total: questions.length }
  }, [questions])

  const submitDraft = async () => {
    if (!lifeUser || !draft.trim()) return
    const routed = resolveWorkspaceFromTitle(
      draft.trim(),
      workspaces,
      activeWorkspace?.id ?? null
    )
    const extraTags = draftTags
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, '').trim().toLowerCase())
      .filter((t) => t && t !== QUESTION_TAG)
    await createTask({
      userId: lifeUser.id,
      workspaceId: routed.workspaceId ?? undefined,
      title: routed.title,
      notes: draftNotes.trim() || undefined,
      tags: [QUESTION_TAG, ...extraTags],
      project_id: draftProject || null,
      scheduled_for: null,
      priority: 3,
      source: 'manual',
    })
    setDraft('')
    setDraftNotes('')
    setShowNotes(false)
    setDraftProject('')
    setDraftTags('')
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

  const toggleTodo = async (q: LifeTask) => {
    if (!lifeUser) return
    const tags = Array.isArray(q.tags) ? [...q.tags] : []
    const has = tags.includes(TODO_TAG)
    const next = has ? tags.filter((t) => t !== TODO_TAG) : [...tags, TODO_TAG]
    await updateTask(lifeUser.id, q.id, { tags: next })
    load()
  }

  const openAnswer = (q: LifeTask) => {
    setAnsweringId(q.id)
    setAnswerDraft(q.notes ?? '')
  }

  const saveAnswer = async (q: LifeTask) => {
    if (!lifeUser) return
    setSavingAnswer(true)
    try {
      await updateTask(lifeUser.id, q.id, { notes: answerDraft || null })
      setAnsweringId(null)
      setAnswerDraft('')
      load()
    } finally {
      setSavingAnswer(false)
    }
  }

  const StatCard: React.FC<{
    label: string
    value: number
    color: string
    active: boolean
    onClick: () => void
  }> = ({ label, value, color, active, onClick }) => (
    <button
      onClick={onClick}
      style={{
        flex: '1 1 110px',
        minWidth: 0,
        textAlign: 'left',
        padding: '12px 14px',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        borderRadius: 12,
        background: active
          ? `linear-gradient(135deg, ${color}22, ${color}05)`
          : 'var(--bg)',
        color: 'var(--text)',
        cursor: 'pointer',
        transition: 'all 120ms ease',
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'var(--text-muted)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 600, color }}>{value}</div>
    </button>
  )

  return (
    <LifeLayout title="Questions">
      {/* Hero */}
      <div
        style={{
          padding: '18px 20px',
          borderRadius: 14,
          background:
            'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.06))',
          border: '1px solid var(--border)',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: '1.15rem',
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          What are you wondering about?
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Capture open questions, write rich notes as you find answers, promote them
          to your todos, and put them on your calendar when you need focused time.
        </div>
      </div>

      {/* Stat cards (also act as filter chips) */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard
          label="Open"
          value={stats.open}
          color="#6366f1"
          active={filter === 'open'}
          onClick={() => setFilter('open')}
        />
        <StatCard
          label="In todos"
          value={stats.todo}
          color="#f59e0b"
          active={filter === 'todo'}
          onClick={() => setFilter('todo')}
        />
        <StatCard
          label="Scheduled"
          value={stats.scheduled}
          color="#10b981"
          active={filter === 'scheduled'}
          onClick={() => setFilter('scheduled')}
        />
        <StatCard
          label="Answered"
          value={stats.answered}
          color="#a855f7"
          active={filter === 'answered'}
          onClick={() => setFilter('answered')}
        />
        <StatCard
          label="All"
          value={stats.total}
          color="#64748b"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
      </div>

      {/* Quick capture */}
      <div className="life-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
              flex: '1 1 200px',
              minWidth: 0,
              padding: 10,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: '0.95rem',
              outline: 'none',
              boxSizing: 'border-box',
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
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <select
                value={draftProject}
                onChange={(e) => setDraftProject(e.target.value)}
                style={{
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '0.82rem',
                  flex: '1 1 180px',
                  minWidth: 0,
                }}
              >
                <option value="">Link to project (optional)…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={draftTags}
                onChange={(e) => setDraftTags(e.target.value)}
                placeholder="Tags: research, hiring…"
                style={{
                  flex: '1 1 180px',
                  minWidth: 0,
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '0.82rem',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <input
          className="life-search"
          placeholder="Search questions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 240px', minWidth: 0 }}
        />
      </div>

      {/* Project filter chips — derived from the questions actually loaded */}
      {(() => {
        const ids = new Set<string | null>()
        for (const q of questions) ids.add(q.project_id ?? null)
        const linked = projects.filter((p) => ids.has(p.id))
        const hasUnlinked = ids.has(null)
        if (linked.length === 0 && !hasUnlinked) return null
        return (
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginBottom: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Project:</span>
            <button
              className={`life-btn ${projectFilter === null ? 'primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.78rem' }}
              onClick={() => setProjectFilter(null)}
            >
              All
            </button>
            {hasUnlinked && (
              <button
                className={`life-btn ${projectFilter === '' ? 'primary' : ''}`}
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                onClick={() => setProjectFilter('')}
              >
                Unlinked
              </button>
            )}
            {linked.map((p) => (
              <button
                key={p.id}
                className={`life-btn ${projectFilter === p.id ? 'primary' : ''}`}
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                onClick={() => setProjectFilter(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )
      })()}

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {questions.map((q) => {
            const scheduled = !!q.scheduled_for || !!q.start_at
            const projName = projectName(q.project_id)
            const inTodos = Array.isArray(q.tags) && q.tags.includes(TODO_TAG)
            const isAnswering = answeringId === q.id
            const isAnswered = q.status === 'done'
            const accent = isAnswered
              ? '#a855f7'
              : scheduled
              ? '#10b981'
              : inTodos
              ? '#f59e0b'
              : '#6366f1'
            return (
              <div
                key={q.id}
                className="life-card"
                style={{
                  position: 'relative',
                  borderLeft: `3px solid ${accent}`,
                  paddingLeft: 16,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="life-card-title"
                      style={{
                        textDecoration: isAnswered ? 'line-through' : 'none',
                        opacity: isAnswered ? 0.6 : 1,
                        fontSize: '1rem',
                      }}
                    >
                      {q.title}
                    </div>
                    <div className="life-card-meta" style={{ marginTop: 6 }}>
                      {scheduled && q.scheduled_for && (
                        <span
                          className="life-pill"
                          style={{
                            background: 'rgba(16,185,129,0.12)',
                            color: '#10b981',
                            border: '1px solid rgba(16,185,129,0.3)',
                          }}
                          title="Scheduled — also visible on your calendar"
                        >
                          📅 {prettyDate(q.scheduled_for, lifeUser?.timezone)}
                          {q.start_at &&
                            ` · ${new Date(q.start_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`}
                        </span>
                      )}
                      {inTodos && (
                        <span
                          className="life-pill"
                          style={{
                            background: 'rgba(245,158,11,0.12)',
                            color: '#f59e0b',
                            border: '1px solid rgba(245,158,11,0.3)',
                          }}
                          title="Visible in your To-dos"
                        >
                          ✓ in todos
                        </span>
                      )}
                      {projName && <span className="life-pill office">{projName}</span>}
                      {Array.isArray(q.tags) &&
                        q.tags
                          .filter((t) => t !== QUESTION_TAG && t !== TODO_TAG)
                          .map((t) => (
                            <span key={t} className="life-pill">
                              #{t}
                            </span>
                          ))}
                      {q.estimate_min && <span>~{formatDuration(q.estimate_min)}</span>}
                    </div>
                  </div>
                </div>

                {/* Existing answer / notes preview */}
                {!isAnswering && q.notes && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      background: 'rgba(127,127,127,0.06)',
                      borderRadius: 8,
                      borderLeft: '2px solid var(--border)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.68rem',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        color: 'var(--text-muted)',
                        marginBottom: 6,
                      }}
                    >
                      Answer / notes
                    </div>
                    <NotesView notes={q.notes} />
                  </div>
                )}

                {/* Inline answer editor */}
                {isAnswering && (
                  <div style={{ marginTop: 10 }}>
                    <RichEditor value={answerDraft} onChange={setAnswerDraft} />
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        marginTop: 8,
                        justifyContent: 'flex-end',
                      }}
                    >
                      <button
                        className="life-btn"
                        onClick={() => {
                          setAnsweringId(null)
                          setAnswerDraft('')
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="life-btn primary"
                        onClick={() => saveAnswer(q)}
                        disabled={savingAnswer}
                      >
                        {savingAnswer ? 'Saving…' : 'Save answer'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Action bar */}
                {!isAnswering && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      marginTop: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <button className="life-btn" onClick={() => openAnswer(q)}>
                      {q.notes ? '✎ Edit answer' : '✎ Write answer'}
                    </button>
                    {q.status !== 'done' && (
                      <button className="life-btn" onClick={() => toggleTodo(q)}>
                        {inTodos ? '− Remove from todos' : '+ Add to todos'}
                      </button>
                    )}
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
                    <div style={{ flex: 1 }} />
                    <button className="life-btn danger" onClick={() => remove(q)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
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
            <p
              style={{
                margin: '0 0 12px',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
              }}
            >
              Once a time is set, this question shows up on your calendar automatically.
            </p>
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
