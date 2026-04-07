// Todos — the powerful, single-pane todo manager.
//
// What lives here (vs Today / Schedule):
//   - A flat, filterable, searchable list of every life_task in the active
//     workspace, with infinite-scroll pagination + a fixed-row virtualizer
//     so 10k todos still render at 60fps.
//   - Date filter (today / week / month / range / all + include undated).
//   - Status filter (open / done / dropped) and title ILIKE search.
//   - Inline quick-add and inline editing of completion + due date + ETA.
//   - Expandable rows that lazy-load subtasks (parent_task_id).
//   - "Generate from paragraph" — one-shot AI extractor that converts a
//     paragraph or list into real tasks (and subtasks via parent_task_id)
//     IMMEDIATELY, with no scripted interview, no follow-up questions, no
//     brainstorm round-trip. See lib/paragraphToTasks.ts.
//
// Data-loss guarantees:
//   - Quick-add input and paragraph textarea are mirrored to localStorage
//     on every keystroke and restored on mount. Refreshing the tab or a
//     React error never loses what the user typed.
//   - Inputs are only cleared after the corresponding write succeeds.
//   - Failures show a prominent error banner. We never silently swallow.
//
// Why this exists: Today/Schedule are intentionally narrow ("right now",
// "this hour"). Power users still want a full backlog view + bulk capture.
// This is that view.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  searchTasks,
  listAllTags,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  addActualMinutes,
  type TaskSearchFilters,
} from '../lib/db/tasks'
import type { LifeTask, TaskStatus } from '../types'
import { todayLocal } from '../lib/time'
import {
  extractTasksFromParagraph,
  type ExtractedTask,
} from '../lib/paragraphToTasks'
import {
  startTimer,
  stopTimer,
  useActiveTimer,
  formatElapsed,
  formatDuration,
} from '../lib/activeTimer'
import {
  browserNotificationsGranted,
  requestBrowserNotifications,
  fireBrowserNotification,
} from '../lib/notifier'
import TaskEditPanel from './todos/TaskEditPanel'
import CalendarCreateModal from '../components/CalendarCreateModal'

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 100
const ROW_HEIGHT = 68
const OVERSCAN = 6
const VIEWPORT_HEIGHT = 640

type DatePreset = 'yesterday' | 'today' | 'tomorrow' | 'week' | 'month' | 'all' | 'overdue' | 'custom'

// Smart search parser. Extracts inline filters from a query string.
//   "fix login bug tag:work p:1"  →  { text: "fix login bug", tags: ["work"], priorities: [1] }
//   "tag:home,errands"            →  { text: "", tags: ["home","errands"], priorities: [] }
// Anything else stays in `text` for the title/notes ILIKE search.
interface ParsedQuery {
  text: string
  tags: string[]
  priorities: number[]
}
function parseSmartQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { text: '', tags: [], priorities: [] }
  if (!raw) return out
  const tokens = raw.split(/\s+/)
  const remaining: string[] = []
  for (const tok of tokens) {
    const m = tok.match(/^(tag|tags|p|prio|priority):(.+)$/i)
    if (!m) {
      remaining.push(tok)
      continue
    }
    const key = m[1].toLowerCase()
    const values = m[2].split(',').map((v) => v.trim()).filter(Boolean)
    if (key === 'tag' || key === 'tags') {
      for (const v of values) out.tags.push(v.toLowerCase().replace(/^#/, ''))
    } else {
      for (const v of values) {
        const n = Number(v)
        if (Number.isInteger(n) && n >= 1 && n <= 5) out.priorities.push(n)
      }
    }
  }
  out.text = remaining.join(' ').trim()
  return out
}

function isoDateAdd(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function presetToRange(
  preset: DatePreset,
  today: string,
  custom: { from: string; to: string }
): { from: string | null; to: string | null; includeUndated: boolean } {
  switch (preset) {
    case 'yesterday': {
      const y = isoDateAdd(today, -1)
      return { from: y, to: y, includeUndated: false }
    }
    case 'today':
      return { from: today, to: today, includeUndated: false }
    case 'tomorrow': {
      const t = isoDateAdd(today, 1)
      return { from: t, to: t, includeUndated: false }
    }
    case 'week':
      return { from: today, to: isoDateAdd(today, 6), includeUndated: false }
    case 'month':
      return { from: today, to: isoDateAdd(today, 30), includeUndated: false }
    case 'overdue':
      return { from: null, to: isoDateAdd(today, -1), includeUndated: false }
    case 'custom':
      return {
        from: custom.from || null,
        to: custom.to || null,
        includeUndated: false,
      }
    case 'all':
    default:
      return { from: null, to: null, includeUndated: true }
  }
}

// ──────────────────────────────────────────────────────────────────────
// LocalStorage draft keys — protect against data loss across reloads.
// We persist everything the user has typed but not yet submitted.
// ──────────────────────────────────────────────────────────────────────
const LS_QUICK = 'todos_draft_quick_v1'
const LS_PARAGRAPH = 'todos_draft_paragraph_v1'

function readLS(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function writeLS(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* quota or disabled — non-fatal */
  }
}

// ──────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────
const TodosPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const today = todayLocal(lifeUser?.timezone)

  // ── Filter state ──
  const [datePreset, setDatePreset] = useState<DatePreset>('week')
  const [customRange, setCustomRange] = useState({ from: today, to: today })
  const [statuses, setStatuses] = useState<TaskStatus[]>(['todo', 'doing'])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [filterPriorities, setFilterPriorities] = useState<number[]>([])
  const [allTags, setAllTags] = useState<string[]>([])

  // ── Data state ──
  const [rows, setRows] = useState<LifeTask[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)

  // ── Edit panel ──
  const [editingId, setEditingId] = useState<string | null>(null)

  // ── Active timer (single global) ──
  const { activeId, elapsedSec } = useActiveTimer()

  // ── Quick add + paragraph capture (restored from localStorage) ──
  const [quickTitle, setQuickTitle] = useState<string>(() => readLS(LS_QUICK))
  const [paragraph, setParagraph] = useState<string>(() => readLS(LS_PARAGRAPH))
  const [paragraphOpen, setParagraphOpen] = useState<boolean>(() => readLS(LS_PARAGRAPH).length > 0)
  const [generating, setGenerating] = useState(false)

  // Mirror drafts to localStorage so a refresh / crash never loses them.
  useEffect(() => {
    writeLS(LS_QUICK, quickTitle)
  }, [quickTitle])
  useEffect(() => {
    writeLS(LS_PARAGRAPH, paragraph)
  }, [paragraph])

  // ── Virtual scroll state ──
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  // Parse the smart query — splits inline `tag:foo p:1` filters out of the
  // text used for the title/notes ILIKE search. Combined with the explicit
  // tag/priority chip filters via union.
  const parsed = useMemo(() => parseSmartQuery(debouncedQuery), [debouncedQuery])

  const filters: TaskSearchFilters = useMemo(() => {
    const range = presetToRange(datePreset, today, customRange)
    const allTagsCombined = Array.from(new Set([...filterTags, ...parsed.tags]))
    const allPrioritiesCombined = Array.from(
      new Set([...filterPriorities, ...parsed.priorities])
    )
    return {
      fromDate: range.from,
      toDate: range.to,
      includeUndated: range.includeUndated,
      statuses,
      query: parsed.text,
      searchInNotes: true,
      tags: allTagsCombined.length > 0 ? allTagsCombined : undefined,
      priorities: allPrioritiesCombined.length > 0 ? allPrioritiesCombined : undefined,
      parentsOnly: true,
      workspaceId: activeWorkspace?.id ?? null,
    }
  }, [
    datePreset,
    customRange,
    today,
    statuses,
    parsed,
    filterTags,
    filterPriorities,
    activeWorkspace?.id,
  ])

  // Initial / filter-change load
  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    setError(null)
    try {
      const page = await searchTasks(lifeUser.id, filters, {
        offset: 0,
        limit: PAGE_SIZE,
      })
      setRows(page.rows)
      setTotal(page.total)
      setHasMore(page.hasMore)
      // Reset scroll position on a fresh query.
      if (scrollerRef.current) scrollerRef.current.scrollTop = 0
      setScrollTop(0)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, filters])

  useEffect(() => {
    load()
  }, [load])

  // Load all distinct tags for the tag-filter dropdown. Re-runs when the
  // active workspace changes. Cheap — caps at 2000 task rows.
  useEffect(() => {
    if (!lifeUser) return
    listAllTags(lifeUser.id, activeWorkspace?.id ?? null)
      .then(setAllTags)
      .catch(() => {/* non-fatal — tag filter just stays empty */})
  }, [lifeUser, activeWorkspace?.id, rows.length])

  // Upcoming-due notification poller. Every 30s scans loaded rows for tasks
  // whose due_at is within the next 10 minutes (and hasn't fired yet this
  // session) — fires a browser notification with the title. Also fires for
  // overdue P1/P2 tasks once per day. Skipped if notifications aren't
  // granted.
  useEffect(() => {
    if (!browserNotificationsGranted()) return
    const FIRED_KEY = 'todos_due_fired_v1'
    const readFired = (): Record<string, number> => {
      try {
        return JSON.parse(sessionStorage.getItem(FIRED_KEY) ?? '{}')
      } catch {
        return {}
      }
    }
    const writeFired = (m: Record<string, number>) => {
      try {
        sessionStorage.setItem(FIRED_KEY, JSON.stringify(m))
      } catch {/* ignore */}
    }
    const tick = () => {
      const fired = readFired()
      const now = Date.now()
      const horizon = now + 10 * 60_000
      let mutated = false
      for (const t of rows) {
        if (t.status === 'done' || t.status === 'dropped') continue
        if (!t.due_at) continue
        const due = new Date(t.due_at).getTime()
        if (Number.isNaN(due)) continue
        if (due < now - 24 * 3600_000) continue // skip ancient overdue
        if (due > horizon) continue
        if (fired[t.id] === due) continue
        fireBrowserNotification(
          due < now ? `Overdue: ${t.title}` : `Due soon: ${t.title}`,
          t.notes ?? `Due ${new Date(due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          () => setEditingId(t.id)
        )
        fired[t.id] = due
        mutated = true
      }
      if (mutated) writeFired(fired)
    }
    tick()
    const id = window.setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [rows])

  // Infinite scroll: when the user nears the bottom of what we have, fetch
  // the next PAGE_SIZE rows. We trigger from inside the scroll handler.
  const loadMore = useCallback(async () => {
    if (!lifeUser || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await searchTasks(lifeUser.id, filters, {
        offset: rows.length,
        limit: PAGE_SIZE,
      })
      setRows((r) => [...r, ...page.rows])
      setHasMore(page.hasMore)
      setTotal(page.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }, [lifeUser, filters, hasMore, loadingMore, rows.length])

  // ── Virtual windowing math ──
  // All rows are fixed-height ROW_HEIGHT, so windowing math is trivial.
  // Subtasks live in the side edit panel, not inline.
  const totalHeight = rows.length * ROW_HEIGHT
  const visible = useMemo(() => {
    if (rows.length === 0) return { start: 0, end: 0 }
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const end = Math.min(
      rows.length,
      Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN
    )
    return { start, end }
  }, [rows.length, scrollTop])

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      setScrollTop(el.scrollTop)
      // Trigger infinite scroll when within ~3 viewports of the bottom.
      if (
        hasMore &&
        !loadingMore &&
        el.scrollHeight - el.scrollTop - el.clientHeight < VIEWPORT_HEIGHT * 2
      ) {
        loadMore()
      }
    },
    [hasMore, loadingMore, loadMore]
  )

  // ── Row actions ──
  const toggleStatus = async (task: LifeTask) => {
    if (!lifeUser) return
    const next: TaskStatus = task.status === 'done' ? 'todo' : 'done'
    // Optimistic
    setRows((r) =>
      r.map((t) =>
        t.id === task.id
          ? { ...t, status: next, done_at: next === 'done' ? new Date().toISOString() : null }
          : t
      )
    )
    try {
      await updateTaskStatus(lifeUser.id, task.id, next)
    } catch (err) {
      setError((err as Error).message)
      load()
    }
  }

  // Merge a partial patch into a row. We MUST merge instead of replace —
  // multiple debounced saves can race (title autosave still in flight while
  // user adds a tag), and a full replace with a stale snapshot would
  // overwrite fields the other save just persisted, causing data loss.
  const patchRow = useCallback((id: string, patch: Partial<LifeTask>) => {
    setRows((r) => r.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  // ── Quick reschedule (used by row hover menu) ──
  const quickReschedule = async (
    task: LifeTask,
    target: 'yesterday' | 'today' | 'tomorrow' | 'next-week' | 'clear'
  ) => {
    if (!lifeUser) return
    let date: string | null = null
    if (target !== 'clear') {
      const d = new Date(`${today}T00:00:00`)
      if (target === 'yesterday') d.setDate(d.getDate() - 1)
      if (target === 'tomorrow') d.setDate(d.getDate() + 1)
      if (target === 'next-week') d.setDate(d.getDate() + 7)
      date = d.toISOString().slice(0, 10)
    }
    setRows((r) =>
      r.map((t) => (t.id === task.id ? { ...t, scheduled_for: date } : t))
    )
    try {
      await updateTask(lifeUser.id, task.id, { scheduled_for: date })
    } catch (err) {
      setError(`Reschedule failed: ${(err as Error).message}`)
      load()
    }
  }

  // ── Timer handlers (single global active timer) ──
  const onStartTimer = async (task: LifeTask) => {
    if (!lifeUser) return
    const { previous } = startTimer(task.id)
    if (previous.taskId && previous.elapsedMin > 0) {
      try {
        const next = await addActualMinutes(
          lifeUser.id,
          previous.taskId,
          previous.elapsedMin
        )
        setRows((r) =>
          r.map((t) => (t.id === previous.taskId ? { ...t, actual_min: next } : t))
        )
      } catch (err) {
        setError(`Could not save previous timer: ${(err as Error).message}`)
      }
    }
  }

  const onStopTimer = async () => {
    if (!lifeUser) return
    const result = stopTimer()
    if (result.taskId && result.elapsedMin > 0) {
      try {
        const next = await addActualMinutes(
          lifeUser.id,
          result.taskId,
          result.elapsedMin
        )
        setRows((r) =>
          r.map((t) => (t.id === result.taskId ? { ...t, actual_min: next } : t))
        )
      } catch (err) {
        setError(`Could not save timer minutes: ${(err as Error).message}`)
      }
    }
  }

  const editDate = async (task: LifeTask, value: string) => {
    if (!lifeUser) return
    const newDate = value || null
    setRows((r) =>
      r.map((t) => (t.id === task.id ? { ...t, scheduled_for: newDate } : t))
    )
    try {
      await updateTask(lifeUser.id, task.id, { scheduled_for: newDate })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const editEstimate = async (task: LifeTask, value: string) => {
    if (!lifeUser) return
    const n = value ? Number(value) : null
    if (value && Number.isNaN(n)) return
    setRows((r) =>
      r.map((t) => (t.id === task.id ? { ...t, estimate_min: n } : t))
    )
    try {
      await updateTask(lifeUser.id, task.id, { estimate_min: n })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const removeTask = async (task: LifeTask) => {
    if (!lifeUser) return
    if (!window.confirm(`Delete "${task.title}"? Subtasks go with it.`)) return
    setRows((r) => r.filter((t) => t.id !== task.id))
    setTotal((n) => Math.max(0, n - 1))
    try {
      await deleteTask(lifeUser.id, task.id)
    } catch (err) {
      setError((err as Error).message)
      load()
    }
  }

  // Lazy permission request — first time the user creates a todo we ask
  // for browser notification permission. If they deny, we never bug them
  // again. If granted, every create fires a confirmation notification AND
  // the upcoming-due poller (below) starts firing reminders.
  const ensureNotifPermission = useCallback(async () => {
    if (browserNotificationsGranted()) return true
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      return false
    }
    return requestBrowserNotifications()
  }, [])

  const addQuickTask = async () => {
    if (!lifeUser || !activeWorkspace || !quickTitle.trim()) return
    const title = quickTitle.trim()
    setError(null)
    try {
      await createTask({
        userId: lifeUser.id,
        workspaceId: activeWorkspace.id,
        title,
        scheduled_for: today,
        source: 'manual',
      })
      // Only clear AFTER the write lands. Refresh list.
      setQuickTitle('')
      writeLS(LS_QUICK, '')
      load()
      // Confirmation notification (best-effort).
      ensureNotifPermission().then((ok) => {
        if (ok) fireBrowserNotification('Todo added', title)
      })
    } catch (err) {
      // Keep the input intact so the user doesn't lose their typing.
      setError(`Could not add task: ${(err as Error).message}`)
    }
  }

  // One-shot paragraph → real tasks. No interview, no questions, no
  // navigation. The textarea is preserved verbatim until at least one task
  // has been successfully created in the database. If something fails
  // partway through, the user gets the textarea back with the unsubmitted
  // content intact AND a clear error message — nothing is lost.
  const generateFromParagraph = async () => {
    if (!lifeUser || !activeWorkspace) {
      setError('Life is not ready yet — give it a second and try again.')
      return
    }
    const text = paragraph.trim()
    if (!text || generating) return

    setGenerating(true)
    setError(null)
    setNotice(null)

    let extracted: ExtractedTask[]
    try {
      extracted = await extractTasksFromParagraph({
        paragraph: text,
        todayLocalDate: today,
        timezone: lifeUser.timezone,
      })
    } catch (err) {
      // Extraction failed — keep the paragraph, surface the error.
      setError(`Could not extract tasks: ${(err as Error).message}`)
      setGenerating(false)
      return
    }

    // Insert in two passes: parents first, then subtasks (we need parent ids).
    let created = 0
    let failed = 0
    const failures: string[] = []
    try {
      for (const t of extracted) {
        try {
          const parent = await createTask({
            userId: lifeUser.id,
            workspaceId: activeWorkspace.id,
            title: t.title,
            notes: t.notes,
            scheduled_for: t.scheduled_for ?? null,
            estimate_min: t.estimate_min ?? null,
            priority: t.priority ?? 3,
            tags: t.tags,
            source: 'agent',
          })
          created++
          if (t.subtasks && t.subtasks.length > 0) {
            for (const s of t.subtasks) {
              try {
                await createTask({
                  userId: lifeUser.id,
                  workspaceId: activeWorkspace.id,
                  parent_task_id: parent.id,
                  title: s.title,
                  notes: s.notes,
                  scheduled_for: s.scheduled_for ?? null,
                  estimate_min: s.estimate_min ?? null,
                  priority: s.priority ?? 3,
                  tags: s.tags,
                  source: 'agent',
                })
                created++
              } catch (err) {
                failed++
                failures.push(`subtask "${s.title}": ${(err as Error).message}`)
              }
            }
          }
        } catch (err) {
          failed++
          failures.push(`"${t.title}": ${(err as Error).message}`)
        }
      }
    } finally {
      setGenerating(false)
    }

    if (created === 0) {
      // Total failure — keep the paragraph for retry.
      setError(
        `Could not create any tasks. ${failures[0] ?? 'Unknown error.'} ` +
          `Your paragraph is still here — fix the issue and try again.`
      )
      return
    }

    // At least some tasks landed. Reload list. Only clear the textarea if
    // EVERYTHING succeeded — partial failures keep the text so the user
    // can re-run after fixing whatever went wrong.
    await load()
    if (failed === 0) {
      setParagraph('')
      writeLS(LS_PARAGRAPH, '')
      setNotice(`Created ${created} task${created === 1 ? '' : 's'}.`)
      ensureNotifPermission().then((ok) => {
        if (ok) {
          fireBrowserNotification(
            `${created} todo${created === 1 ? '' : 's'} created`,
            extracted.map((t) => `• ${t.title}`).slice(0, 4).join('\n')
          )
        }
      })
    } else {
      setError(
        `Created ${created} task${created === 1 ? '' : 's'}, but ${failed} failed: ${failures
          .slice(0, 3)
          .join('; ')}${failures.length > 3 ? '…' : ''}. Paragraph kept for retry.`
      )
    }
  }

  // ── Status pill toggling ──
  const toggleStatusFilter = (s: TaskStatus) => {
    setStatuses((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]
    )
  }

  // ──────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────
  const datePresets: DatePreset[] = [
    'yesterday',
    'today',
    'tomorrow',
    'week',
    'month',
    'overdue',
    'all',
    'custom',
  ]
  const allStatuses: TaskStatus[] = ['todo', 'doing', 'done', 'dropped']

  return (
    <LifeLayout title="Todos">
      <div className="todos-page">
        {/* Capture: quick-add + paragraph dropdown */}
        <div className="todos-capture">
          <div className="todos-quickadd">
            <span className="plus">+</span>
            <input
              type="text"
              placeholder="Add a todo for today and press Enter…"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addQuickTask()
              }}
            />
            <button
              className="toggle-paragraph"
              onClick={() => setParagraphOpen((v) => !v)}
            >
              {paragraphOpen ? '− paragraph' : '✦ paragraph'}
            </button>
            <button
              className="toggle-paragraph"
              onClick={() => setCreateModalOpen(true)}
              title="Open full task editor — schedule, recurring, email reminder, project, etc."
            >
              ⊕ new
            </button>
            <button
              className="add-btn"
              onClick={addQuickTask}
              disabled={!quickTitle.trim()}
            >
              Add
            </button>
          </div>
          {paragraphOpen && (
            <div className="todos-paragraph">
              <span className="label">Generate tasks from paragraph</span>
              <textarea
                rows={5}
                placeholder="Paste a paragraph or a list of high-level tasks. One AI call extracts a clean list of todos (with subtasks, dates, ETAs) and adds them to the list. No follow-up questions."
                value={paragraph}
                onChange={(e) => setParagraph(e.target.value)}
                disabled={generating}
              />
              <div className="actions">
                <span className="hint">
                  Saved as you type — refresh-safe.
                </span>
                <button
                  className="add-btn"
                  onClick={generateFromParagraph}
                  disabled={!paragraph.trim() || generating}
                >
                  {generating ? 'Generating…' : 'Generate todos'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Banners — error and success notice. Both are dismissible. */}
        {error && (
          <div className="todos-banner error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
          </div>
        )}
        {notice && !error && (
          <div className="todos-banner notice">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        {/* Filter bar */}
        <div className="todos-filterbar">
          <div className="todos-filter-group">
            <span className="label">When</span>
            {datePresets.map((p) => (
              <button
                key={p}
                className={`todos-chip ${datePreset === p ? 'active' : ''}`}
                onClick={() => setDatePreset(p)}
              >
                {p}
              </button>
            ))}
            {datePreset === 'custom' && (
              <span className="todos-range-inputs">
                <input
                  type="date"
                  value={customRange.from}
                  onChange={(e) =>
                    setCustomRange((r) => ({ ...r, from: e.target.value }))
                  }
                />
                →
                <input
                  type="date"
                  value={customRange.to}
                  onChange={(e) =>
                    setCustomRange((r) => ({ ...r, to: e.target.value }))
                  }
                />
              </span>
            )}
          </div>

          <div className="todos-filter-group">
            <span className="label">Status</span>
            {allStatuses.map((s) => (
              <button
                key={s}
                className={`todos-chip ${statuses.includes(s) ? 'active' : ''}`}
                onClick={() => toggleStatusFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="todos-filter-group">
            <span className="label">Priority</span>
            {[1, 2, 3, 4, 5].map((p) => (
              <button
                key={p}
                className={`todos-chip ${filterPriorities.includes(p) ? 'active' : ''}`}
                onClick={() =>
                  setFilterPriorities((cur) =>
                    cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]
                  )
                }
              >
                P{p}
              </button>
            ))}
          </div>

          <div className="todos-search">
            <svg
              className="icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder="Search… try `tag:work p:1`"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Tag filter — only render when we know of any tags */}
        {allTags.length > 0 && (
          <div className="todos-tagbar">
            <span className="label">Tags</span>
            <div className="tag-chip-wrap">
              {allTags.map((t) => (
                <button
                  key={t}
                  className={`tag-filter-chip ${filterTags.includes(t) ? 'active' : ''}`}
                  onClick={() =>
                    setFilterTags((cur) =>
                      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
                    )
                  }
                >
                  #{t}
                </button>
              ))}
              {(filterTags.length > 0 || filterPriorities.length > 0) && (
                <button
                  className="tag-filter-chip clear"
                  onClick={() => {
                    setFilterTags([])
                    setFilterPriorities([])
                  }}
                >
                  clear filters
                </button>
              )}
            </div>
          </div>
        )}

        {/* Status line */}
        <div className="todos-statusline">
          <span className="count">
            {loading ? (
              'Loading…'
            ) : (
              <>
                <strong>{total.toLocaleString()}</strong>{' '}
                match{total === 1 ? '' : 'es'}
                {rows.length < total && (
                  <> · {rows.length.toLocaleString()} loaded</>
                )}
                {loadingMore && ' · loading more…'}
              </>
            )}
          </span>
        </div>

        {/* Virtual list */}
        <div
          ref={scrollerRef}
          className="todos-scroller"
          style={{ height: VIEWPORT_HEIGHT }}
          onScroll={onScroll}
        >
          {rows.length === 0 && !loading ? (
            <div className="todos-empty">
              <div className="big">No todos match these filters</div>
              <div>Add one above, or paste a paragraph to generate tasks.</div>
            </div>
          ) : (
            <div
              className="todos-virt"
              style={{ height: totalHeight, position: 'relative' }}
            >
              {rows.slice(visible.start, visible.end).map((task, i) => {
                const idx = visible.start + i
                const top = idx * ROW_HEIGHT
                const isRunning = activeId === task.id
                const visibleTags = task.tags?.slice(0, 3) ?? []
                const extraTags = (task.tags?.length ?? 0) - visibleTags.length
                const isOverdueRow =
                  !!task.due_at &&
                  task.status !== 'done' &&
                  task.status !== 'dropped' &&
                  new Date(task.due_at).getTime() < Date.now()
                return (
                  <div
                    key={task.id}
                    className="todos-row-wrap"
                    style={{
                      position: 'absolute',
                      top,
                      left: 0,
                      right: 0,
                      height: ROW_HEIGHT,
                    }}
                  >
                    <div
                      className={`todos-row ${task.status === 'done' ? 'done' : ''} ${isRunning ? 'running' : ''} ${isOverdueRow ? 'is-overdue' : ''}`}
                      onClick={() => setEditingId(task.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setEditingId(task.id)
                      }}
                    >
                      <button
                        className="todos-check"
                        aria-label="Toggle completion"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleStatus(task)
                        }}
                      >
                        {task.status === 'done' ? '✓' : ''}
                      </button>

                      <div className="todos-title">
                        <div className="title">{task.title}</div>
                        <div className="meta-line">
                          {visibleTags.map((t) => (
                            <span key={t} className="row-tag">#{t}</span>
                          ))}
                          {extraTags > 0 && <span className="row-tag muted">+{extraTags}</span>}
                          {task.notes && (
                            <span className="row-notes" title={task.notes}>
                              {task.notes}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="todos-meta" onClick={(e) => e.stopPropagation()}>
                        {task.priority <= 2 && (
                          <span className={`todos-priority p${task.priority}`}>
                            P{task.priority}
                          </span>
                        )}
                        <label
                          className={`todos-pill ${task.scheduled_for ? 'set' : ''}`}
                          title="Scheduled for"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          <span>
                            {task.scheduled_for === today
                              ? 'Today'
                              : task.scheduled_for ?? 'date'}
                          </span>
                          <input
                            type="date"
                            value={task.scheduled_for ?? ''}
                            onChange={(e) => editDate(task, e.target.value)}
                          />
                        </label>
                        <span
                          className={`todos-pill ${task.estimate_min != null ? 'set' : ''}`}
                          title="Estimate (minutes)"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          <input
                            className="eta-input"
                            type="number"
                            min={0}
                            placeholder="—"
                            value={task.estimate_min ?? ''}
                            onChange={(e) => editEstimate(task, e.target.value)}
                          />
                          <span>m</span>
                        </span>
                        {(task.actual_min ?? 0) > 0 && (
                          <span
                            className="logged-pill"
                            title={`${task.actual_min} minutes logged`}
                          >
                            {formatDuration(task.actual_min)} logged
                          </span>
                        )}
                        {task.due_at &&
                          (() => {
                            const due = new Date(task.due_at)
                            const now = new Date()
                            const ms = due.getTime() - now.getTime()
                            const isDone = task.status === 'done' || task.status === 'dropped'
                            const isOverdue = !isDone && ms < 0
                            const dayMs = 86_400_000
                            const dueToday =
                              !isDone &&
                              !isOverdue &&
                              due.toDateString() === now.toDateString()
                            const dueTomorrow =
                              !isDone &&
                              !isOverdue &&
                              !dueToday &&
                              ms < 2 * dayMs
                            const cls = isOverdue
                              ? 'overdue'
                              : dueToday
                              ? 'due-today'
                              : dueTomorrow
                              ? 'due-tomorrow'
                              : 'due-set'
                            const label = isOverdue
                              ? `${Math.ceil(-ms / dayMs)}d overdue`
                              : dueToday
                              ? 'due today'
                              : dueTomorrow
                              ? 'due tomorrow'
                              : `due ${due.toLocaleDateString()}`
                            return (
                              <span
                                className={`todos-due-pill ${cls}`}
                                title={`Due ${due.toLocaleString()}`}
                              >
                                ⏰ {label}
                              </span>
                            )
                          })()}
                      </div>

                      <div className="row-hover-actions" onClick={(e) => e.stopPropagation()}>
                        {/* Quick reschedule menu */}
                        <div className="reschedule-menu">
                          <button
                            className="row-action"
                            title="Reschedule"
                            onClick={(e) => e.preventDefault()}
                          >
                            ⟳
                          </button>
                          <div className="reschedule-pop">
                            <button onClick={() => quickReschedule(task, 'yesterday')}>Yesterday</button>
                            <button onClick={() => quickReschedule(task, 'today')}>Today</button>
                            <button onClick={() => quickReschedule(task, 'tomorrow')}>Tomorrow</button>
                            <button onClick={() => quickReschedule(task, 'next-week')}>+1 week</button>
                            <button onClick={() => quickReschedule(task, 'clear')}>Clear</button>
                          </div>
                        </div>
                        {/* Timer */}
                        {isRunning ? (
                          <button
                            className="row-action timer-on"
                            title={`Running ${formatElapsed(elapsedSec)} — click to stop`}
                            onClick={onStopTimer}
                          >
                            ⏸ {formatElapsed(elapsedSec)}
                          </button>
                        ) : (
                          <button
                            className="row-action"
                            title="Start timer"
                            onClick={() => onStartTimer(task)}
                          >
                            ▶
                          </button>
                        )}
                        {/* Delete */}
                        <button
                          className="row-action danger"
                          onClick={() => removeTask(task)}
                          aria-label="Delete"
                          title="Delete"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Floating active timer bar — visible whenever a timer is running */}
      {activeId && (() => {
        const t = rows.find((r) => r.id === activeId)
        return (
          <div className="todos-floating-timer">
            <div className="dot" />
            <div className="info">
              <div className="t-title">{t?.title ?? 'Timer running'}</div>
              <div className="t-elapsed">{formatElapsed(elapsedSec)}</div>
            </div>
            <button className="stop-btn" onClick={onStopTimer}>Stop</button>
          </div>
        )
      })()}

      {/* Side edit panel */}
      {editingId && (() => {
        const t = rows.find((r) => r.id === editingId)
        if (!t || !lifeUser || !activeWorkspace) return null
        return (
          <TaskEditPanel
            task={t}
            userId={lifeUser.id}
            workspaceId={activeWorkspace.id}
            todayLocalDate={today}
            existingTags={allTags}
            onPatched={patchRow}
            onDeleted={(id) => {
              setRows((r) => r.filter((x) => x.id !== id))
              setTotal((n) => Math.max(0, n - 1))
              setEditingId(null)
            }}
            onTagsAdded={(tags) =>
              setAllTags((cur) => Array.from(new Set([...cur, ...tags])).sort())
            }
            onError={(msg) => setError(msg)}
            onClose={() => setEditingId(null)}
          />
        )
      })()}

      {createModalOpen && (
        <CalendarCreateModal
          onClose={() => setCreateModalOpen(false)}
          onCreated={() => {
            load()
            setCreateModalOpen(false)
          }}
        />
      )}
    </LifeLayout>
  )
}

export default TodosPage
