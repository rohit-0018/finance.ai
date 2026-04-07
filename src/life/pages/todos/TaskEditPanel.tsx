// Side-panel task editor — opens from the right when a Todos row is clicked.
//
// Editing model:
//   - Local "draft" state mirrors every field. Typing is responsive.
//   - Autosave fires on every change for selects/dates/booleans, and after
//     a 400ms debounce for text fields. Saves use PARTIAL patches via the
//     parent's onPatched(id, patch) — never a whole-row replace, so two
//     concurrent autosaves can never clobber each other.
//   - An explicit "Save" button in the header force-flushes any pending
//     debounced saves and shows a clear save-state indicator
//     (Saved / Saving… / Unsaved).
//
// Layout extras:
//   - The panel is resizable: drag the left edge to widen it.
//   - There's an "Expand" button in the header that maximizes to ~92vw.
//   - Esc / overlay click / Close button all close it.
//
// Tag UX:
//   - Dedicated section with the current chips, an input that autocompletes
//     against the user's existing tag library (passed in via props), and
//     suggestions from the dropdown that you can click or arrow-down into.
//   - Adding a tag immediately surfaces it in the parent's tag list via
//     onTagsAdded so the filter bar picks it up.
//
// Data-loss guarantees:
//   - Title drafts are mirrored to localStorage per task id, restored on
//     reopen if the autosave hadn't yet landed.
//   - We never call patch with a stale spread of `task` — only the field(s)
//     being changed go to the parent.
//   - All errors surface via onError so the parent banner shows them.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { LifeTask, TaskStatus } from '../../types'
import {
  updateTask,
  updateTaskStatus,
  deleteTask,
  createTask,
  listSubtasks,
  addActualMinutes,
} from '../../lib/db/tasks'
import {
  startTimer,
  stopTimer,
  useActiveTimer,
  formatElapsed,
  formatDuration,
} from '../../lib/activeTimer'

const DEBOUNCE_MS = 400
const DRAFT_KEY = (id: string) => `todos_edit_draft_${id}`
const WIDTH_KEY = 'todos_panel_width_v1'
const MIN_WIDTH = 380
const MAX_WIDTH = 1100
const DEFAULT_WIDTH = 480

interface TaskEditPanelProps {
  task: LifeTask
  userId: string
  workspaceId: string
  /** Today in user's timezone — for "today/tomorrow" reschedule chips. */
  todayLocalDate: string
  /** All tags the user has across their workspace, for autocomplete. */
  existingTags: string[]
  /** Partial-merge patch — never a whole-row replace. */
  onPatched: (taskId: string, patch: Partial<LifeTask>) => void
  /** Called when the task is deleted. Parent removes it from the list. */
  onDeleted: (taskId: string) => void
  /** Called when new tags are introduced so the parent tag library updates. */
  onTagsAdded: (tags: string[]) => void
  onError: (msg: string) => void
  onClose: () => void
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const TaskEditPanel: React.FC<TaskEditPanelProps> = ({
  task,
  userId,
  workspaceId,
  todayLocalDate,
  existingTags,
  onPatched,
  onDeleted,
  onTagsAdded,
  onError,
  onClose,
}) => {
  // ── Local draft state ────────────────────────────────────────────
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [whenWhere, setWhenWhere] = useState(task.when_where ?? '')
  const [tagInput, setTagInput] = useState('')
  const [showSuggest, setShowSuggest] = useState(false)
  const [suggestIdx, setSuggestIdx] = useState(0)
  const [subtasks, setSubtasksState] = useState<LifeTask[]>([])
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // ── Panel layout state (width + expanded mode) ──
  const [width, setWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(WIDTH_KEY))
      return v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH
    } catch {
      return DEFAULT_WIDTH
    }
  })
  const [expanded, setExpanded] = useState(false)
  const dragging = useRef(false)

  // Reset local state when a different task opens.
  useEffect(() => {
    setTitle(task.title)
    setNotes(task.notes ?? '')
    setWhenWhere(task.when_where ?? '')
    setTagInput('')
    setSaveState('idle')
  }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load subtasks on open. Re-run when task id changes.
  useEffect(() => {
    let cancelled = false
    setLoadingSubs(true)
    listSubtasks(userId, task.id)
      .then((rows) => {
        if (!cancelled) setSubtasksState(rows)
      })
      .catch((err) => onError(`Could not load subtasks: ${(err as Error).message}`))
      .finally(() => {
        if (!cancelled) setLoadingSubs(false)
      })
    return () => {
      cancelled = true
    }
  }, [task.id, userId, onError])

  // Restore unsaved title draft if it exists (e.g. previous session crashed).
  useEffect(() => {
    try {
      const draft = localStorage.getItem(DRAFT_KEY(task.id))
      if (draft && draft !== task.title) setTitle(draft)
    } catch {/* ignore */}
  }, [task.id, task.title])

  // ── Save core: a single function used by every autosave + the manual
  //    Save button. Always sends a PARTIAL patch.
  const persist = useCallback(
    async (patch: Partial<LifeTask>) => {
      setSaveState('saving')
      try {
        await updateTask(userId, task.id, patch)
        onPatched(task.id, patch)
        setSaveState('saved')
        setSavedAt(Date.now())
      } catch (err) {
        setSaveState('error')
        onError(`Save failed: ${(err as Error).message}`)
        throw err
      }
    },
    [userId, task.id, onPatched, onError]
  )

  // ── Debounced text saves ─────────────────────────────────────────
  // We track the latest pending patch and the timer; the manual Save
  // button uses these to flush immediately.
  const pendingTextPatch = useRef<Partial<LifeTask>>({})
  const textTimer = useRef<number | null>(null)

  const scheduleTextSave = useCallback(
    (patch: Partial<LifeTask>) => {
      pendingTextPatch.current = { ...pendingTextPatch.current, ...patch }
      setSaveState('pending')
      if (textTimer.current) clearTimeout(textTimer.current)
      textTimer.current = window.setTimeout(() => {
        const p = pendingTextPatch.current
        pendingTextPatch.current = {}
        textTimer.current = null
        if (Object.keys(p).length === 0) return
        persist(p).catch(() => {/* error already surfaced */})
      }, DEBOUNCE_MS)
    },
    [persist]
  )

  const flushPendingSaves = useCallback(async () => {
    if (textTimer.current) {
      clearTimeout(textTimer.current)
      textTimer.current = null
    }
    const p = pendingTextPatch.current
    pendingTextPatch.current = {}
    if (Object.keys(p).length === 0) return
    await persist(p).catch(() => {/* surfaced */})
  }, [persist])

  // Title typing
  useEffect(() => {
    if (title === task.title) return
    try {
      localStorage.setItem(DRAFT_KEY(task.id), title)
    } catch {/* ignore */}
    if (!title.trim()) return // never save empty
    scheduleTextSave({ title: title.trim() })
    return () => {
      // clear draft after save lands (we don't track exact landing here —
      // safe to clear on the next render cycle if title equals task.title)
    }
  }, [title, task.title, task.id, scheduleTextSave])

  useEffect(() => {
    if (title === task.title) {
      try {
        localStorage.removeItem(DRAFT_KEY(task.id))
      } catch {/* ignore */}
    }
  }, [title, task.title, task.id])

  // Notes typing
  useEffect(() => {
    if ((notes || '') === (task.notes || '')) return
    scheduleTextSave({ notes: notes || null })
  }, [notes, task.notes, scheduleTextSave])

  // when_where typing
  useEffect(() => {
    if ((whenWhere || '') === (task.when_where || '')) return
    scheduleTextSave({ when_where: whenWhere || null })
  }, [whenWhere, task.when_where, scheduleTextSave])

  // ── Field handlers (immediate save) ──────────────────────────────
  const setStatus = async (s: TaskStatus) => {
    try {
      await updateTaskStatus(userId, task.id, s)
      onPatched(task.id, {
        status: s,
        done_at: s === 'done' ? new Date().toISOString() : null,
      })
      setSaveState('saved')
      setSavedAt(Date.now())
    } catch (err) {
      onError(`Could not change status: ${(err as Error).message}`)
    }
  }

  const setPriority = (p: number) => persist({ priority: p })
  const setEstimate = (min: number | null) => persist({ estimate_min: min })
  const setStartAt = (iso: string | null) => persist({ start_at: iso })
  const setDueAt = (iso: string | null) => persist({ due_at: iso })

  // When the user reschedules a task, we have to move ALL of its date
  // anchors — not just `scheduled_for`. Previously only the date pill was
  // updated, so a task with a `start_at` of 2026-04-01 09:00 stayed pinned
  // there even after pressing "Tomorrow", which is what made the calendar
  // and Today views ignore the reschedule. The fix: shift `start_at` /
  // `due_at` to the new date while preserving the original wall-clock time
  // (and the original start→due gap).
  //
  // `newDateLocal` is YYYY-MM-DD in the user's timezone — we splice that
  // into the existing ISO string by pulling the time component out of the
  // current value and constructing a fresh local Date.
  const shiftIsoToDate = (iso: string | null | undefined, newDateLocal: string): string | null => {
    if (!iso) return iso ?? null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return new Date(`${newDateLocal}T${hh}:${mm}:${ss}`).toISOString()
  }

  // Build a patch that moves every date anchor on the task to `newDate`
  // (a YYYY-MM-DD local date). Pass null to clear them all.
  const buildRescheduleP = (newDate: string | null): Partial<LifeTask> => {
    if (newDate === null) {
      return { scheduled_for: null, start_at: null, due_at: null }
    }
    return {
      scheduled_for: newDate,
      start_at: task.start_at ? shiftIsoToDate(task.start_at, newDate) : null,
      due_at: task.due_at ? shiftIsoToDate(task.due_at, newDate) : null,
    }
  }

  // Manual date picker — must move start_at/due_at along with the date.
  const setScheduledFor = (date: string | null) => persist(buildRescheduleP(date))

  const reschedule = (preset: 'today' | 'tomorrow' | 'next-week' | 'clear') => {
    if (preset === 'clear') return persist(buildRescheduleP(null))
    const d = new Date(`${todayLocalDate}T00:00:00`)
    if (preset === 'tomorrow') d.setDate(d.getDate() + 1)
    if (preset === 'next-week') d.setDate(d.getDate() + 7)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    persist(buildRescheduleP(`${yyyy}-${mm}-${dd}`))
  }

  // ── Tags ─────────────────────────────────────────────────────────
  // We need an optimistic local copy so rapid sequential adds (user types
  // tag, Enter, types another, Enter — before persist returns) don't race.
  // The local copy seeds from task.tags on task-id change; otherwise it
  // tracks our own optimistic mutations and reverts on save failure.
  const [tagsLocal, setTagsLocal] = useState<string[]>(task.tags ?? [])
  useEffect(() => {
    setTagsLocal(task.tags ?? [])
  }, [task.id, task.tags])
  const currentTags = tagsLocal

  const addTag = async (raw: string) => {
    const t = raw.trim().toLowerCase().replace(/^#/, '')
    if (!t || t.length > 32) return
    if (currentTags.includes(t)) {
      setTagInput('')
      return
    }
    const previous = currentTags
    const next = [...currentTags, t]
    // Optimistic — render the chip immediately.
    setTagsLocal(next)
    setTagInput('')
    setShowSuggest(false)
    try {
      await persist({ tags: next })
      onTagsAdded([t])
    } catch {
      // Revert on failure (error already surfaced via onError).
      setTagsLocal(previous)
    }
  }

  const removeTag = async (t: string) => {
    const previous = currentTags
    const next = currentTags.filter((x) => x !== t)
    setTagsLocal(next)
    try {
      await persist({ tags: next })
    } catch {
      setTagsLocal(previous)
    }
  }

  // Tag autocomplete suggestions: existing tags that match the input prefix
  // and aren't already on this task.
  const suggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase().replace(/^#/, '')
    if (!q) {
      // Show top 8 unused tags as quick-pick when input is empty
      return existingTags.filter((t) => !currentTags.includes(t)).slice(0, 8)
    }
    return existingTags
      .filter((t) => t.startsWith(q) && !currentTags.includes(t))
      .slice(0, 8)
  }, [tagInput, existingTags, currentTags])

  // Reset suggestion highlight when the list changes
  useEffect(() => {
    setSuggestIdx(0)
  }, [tagInput, suggestions.length])

  // ── Subtasks ─────────────────────────────────────────────────────
  const addSubtask = async () => {
    const t = subtaskTitle.trim()
    if (!t) return
    try {
      const created = await createTask({
        userId,
        workspaceId,
        parent_task_id: task.id,
        title: t,
        scheduled_for: null,
        source: 'manual',
      })
      setSubtasksState((s) => [...s, created])
      setSubtaskTitle('')
    } catch (err) {
      onError(`Could not add subtask: ${(err as Error).message}`)
    }
  }

  const updateSubtask = async (id: string, patch: Partial<LifeTask>) => {
    setSubtasksState((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    try {
      await updateTask(userId, id, patch)
    } catch (err) {
      onError(`Subtask save failed: ${(err as Error).message}`)
    }
  }

  const toggleSubStatus = async (sub: LifeTask) => {
    const next: TaskStatus = sub.status === 'done' ? 'todo' : 'done'
    setSubtasksState((s) =>
      s.map((x) =>
        x.id === sub.id
          ? { ...x, status: next, done_at: next === 'done' ? new Date().toISOString() : null }
          : x
      )
    )
    try {
      await updateTaskStatus(userId, sub.id, next)
    } catch (err) {
      onError(`Subtask status failed: ${(err as Error).message}`)
    }
  }

  const removeSubtask = async (sub: LifeTask) => {
    if (!window.confirm(`Delete subtask "${sub.title}"?`)) return
    setSubtasksState((s) => s.filter((x) => x.id !== sub.id))
    try {
      await deleteTask(userId, sub.id)
    } catch (err) {
      onError(`Subtask delete failed: ${(err as Error).message}`)
    }
  }

  // ── Timer ────────────────────────────────────────────────────────
  const { activeId, elapsedSec } = useActiveTimer()

  const startMine = async (id: string) => {
    const { previous } = startTimer(id)
    if (previous.taskId && previous.elapsedMin > 0) {
      try {
        const next = await addActualMinutes(userId, previous.taskId, previous.elapsedMin)
        if (previous.taskId === task.id) {
          onPatched(task.id, { actual_min: next })
        } else {
          setSubtasksState((s) =>
            s.map((x) => (x.id === previous.taskId ? { ...x, actual_min: next } : x))
          )
        }
      } catch (err) {
        onError(`Could not save previous timer: ${(err as Error).message}`)
      }
    }
  }
  const stopMine = async () => {
    const result = stopTimer()
    if (result.taskId && result.elapsedMin > 0) {
      try {
        const next = await addActualMinutes(userId, result.taskId, result.elapsedMin)
        if (result.taskId === task.id) {
          onPatched(task.id, { actual_min: next })
        } else {
          setSubtasksState((s) =>
            s.map((x) => (x.id === result.taskId ? { ...x, actual_min: next } : x))
          )
        }
      } catch (err) {
        onError(`Could not save timer minutes: ${(err as Error).message}`)
      }
    }
  }

  // ── Delete ───────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!window.confirm(`Delete "${task.title}"? Subtasks go with it.`)) return
    try {
      await deleteTask(userId, task.id)
      onDeleted(task.id)
    } catch (err) {
      onError(`Could not delete: ${(err as Error).message}`)
    }
  }

  // ── Resize: drag the left edge ───────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - e.clientX))
      setWidth(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem(WIDTH_KEY, String(width))
      } catch {/* ignore */}
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [width])

  const startDrag = () => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // ── Esc / Cmd-S ──────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Flush any pending text edits before closing so we never lose them.
        flushPendingSaves().finally(onClose)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        flushPendingSaves()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, flushPendingSaves])

  // Auto-fade "Saved" → "idle" after 1.5s
  useEffect(() => {
    if (saveState !== 'saved') return
    const t = setTimeout(() => setSaveState('idle'), 1500)
    return () => clearTimeout(t)
  }, [saveState, savedAt])

  // ── Render helpers ───────────────────────────────────────────────
  const isThisRunning = activeId === task.id
  const totalActualMin = task.actual_min ?? 0
  const liveMinForThis = isThisRunning ? Math.floor(elapsedSec / 60) : 0
  const panelStyle = expanded
    ? { width: '92vw' }
    : { width: `${width}px` }

  const saveStateLabel: Record<SaveState, string> = {
    idle: '',
    pending: 'Unsaved changes',
    saving: 'Saving…',
    saved: '✓ Saved',
    error: 'Save failed',
  }

  return (
    <>
      <div
        className="todos-panel-overlay"
        onClick={() => flushPendingSaves().finally(onClose)}
      />
      <aside className="todos-panel" role="dialog" aria-label="Edit task" style={panelStyle}>
        {/* Resize handle (left edge) */}
        {!expanded && (
          <div
            className="todos-panel-resizer"
            onMouseDown={startDrag}
            title="Drag to resize"
          />
        )}

        <header className="todos-panel-header">
          <button
            className="todos-check"
            aria-label="Toggle done"
            onClick={() => setStatus(task.status === 'done' ? 'todo' : 'done')}
            style={
              task.status === 'done'
                ? { background: 'var(--accent)', borderColor: 'var(--accent)' }
                : undefined
            }
          >
            {task.status === 'done' ? '✓' : ''}
          </button>
          <input
            className="todos-panel-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            autoFocus
          />
          <div className={`save-state save-${saveState}`}>{saveStateLabel[saveState]}</div>
          <button
            className="todos-panel-action"
            onClick={() => flushPendingSaves()}
            title="Save (⌘S)"
            disabled={saveState === 'saving'}
          >
            Save
          </button>
          <button
            className="todos-panel-icon"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Shrink' : 'Expand'}
          >
            {expanded ? '⇲' : '⇱'}
          </button>
          <button
            className="todos-panel-close"
            onClick={() => flushPendingSaves().finally(onClose)}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="todos-panel-body">
          {/* Status + priority */}
          <section className="todos-panel-section row">
            <label>
              <span className="lbl">Status</span>
              <select
                value={task.status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
              >
                <option value="todo">Todo</option>
                <option value="doing">Doing</option>
                <option value="done">Done</option>
                <option value="dropped">Dropped</option>
              </select>
            </label>
            <label>
              <span className="lbl">Priority</span>
              <select
                value={task.priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              >
                <option value={1}>P1 — urgent</option>
                <option value={2}>P2 — high</option>
                <option value={3}>P3 — normal</option>
                <option value={4}>P4 — low</option>
                <option value={5}>P5 — someday</option>
              </select>
            </label>
          </section>

          {/* Schedule */}
          <section className="todos-panel-section">
            <span className="lbl">Schedule</span>
            <div className="reschedule-chips">
              <button className="chip-btn" onClick={() => reschedule('today')}>
                Today
              </button>
              <button className="chip-btn" onClick={() => reschedule('tomorrow')}>
                Tomorrow
              </button>
              <button className="chip-btn" onClick={() => reschedule('next-week')}>
                +1 week
              </button>
              <button className="chip-btn ghost" onClick={() => reschedule('clear')}>
                Clear
              </button>
            </div>
            <div className="row">
              <label>
                <span className="lbl small">Date</span>
                <input
                  type="date"
                  value={task.scheduled_for ?? ''}
                  onChange={(e) => setScheduledFor(e.target.value || null)}
                />
              </label>
              <label>
                <span className="lbl small">Start</span>
                <input
                  type="datetime-local"
                  value={task.start_at ? task.start_at.slice(0, 16) : ''}
                  onChange={(e) =>
                    setStartAt(
                      e.target.value ? new Date(e.target.value).toISOString() : null
                    )
                  }
                />
              </label>
              <label>
                <span className="lbl small">Due</span>
                <input
                  type="datetime-local"
                  value={task.due_at ? task.due_at.slice(0, 16) : ''}
                  onChange={(e) =>
                    setDueAt(
                      e.target.value ? new Date(e.target.value).toISOString() : null
                    )
                  }
                />
              </label>
            </div>
          </section>

          {/* Time */}
          <section className="todos-panel-section">
            <span className="lbl">Time</span>
            <div className="row time-row">
              <label>
                <span className="lbl small">Estimate</span>
                <div className="num-with-unit">
                  <input
                    type="number"
                    min={0}
                    placeholder="—"
                    value={task.estimate_min ?? ''}
                    onChange={(e) =>
                      setEstimate(e.target.value ? Number(e.target.value) : null)
                    }
                  />
                  <span>min</span>
                </div>
              </label>
              <label>
                <span className="lbl small">Logged</span>
                <div className="logged">
                  {formatDuration(totalActualMin + liveMinForThis)}
                  {isThisRunning && (
                    <span className="live-dot">{formatElapsed(elapsedSec)}</span>
                  )}
                </div>
              </label>
              {isThisRunning ? (
                <button className="timer-btn stop" onClick={stopMine}>
                  ⏸ Stop
                </button>
              ) : (
                <button className="timer-btn start" onClick={() => startMine(task.id)}>
                  ▶ Start timer
                </button>
              )}
            </div>
          </section>

          {/* Tags — dedicated creation area with autocomplete */}
          <section className="todos-panel-section">
            <span className="lbl">Tags</span>
            <div className="tag-list">
              {currentTags.map((t) => (
                <span key={t} className="tag-chip">
                  #{t}
                  <button onClick={() => removeTag(t)} aria-label={`Remove ${t}`}>
                    ×
                  </button>
                </span>
              ))}
              {currentTags.length === 0 && (
                <span className="muted small">No tags yet — add one below.</span>
              )}
            </div>
            <div className="tag-creator">
              <div className="tag-input-wrap">
                <input
                  className="tag-input-real"
                  type="text"
                  placeholder="Type a tag and press Enter…"
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value)
                    setShowSuggest(true)
                  }}
                  onFocus={() => setShowSuggest(true)}
                  onBlur={() => {
                    // Delay so a click on a suggestion still fires.
                    window.setTimeout(() => setShowSuggest(false), 150)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (showSuggest && suggestions[suggestIdx]) {
                        addTag(suggestions[suggestIdx])
                      } else {
                        addTag(tagInput)
                      }
                    } else if (e.key === ',') {
                      e.preventDefault()
                      addTag(tagInput)
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setSuggestIdx((i) => Math.min(suggestions.length - 1, i + 1))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setSuggestIdx((i) => Math.max(0, i - 1))
                    } else if (e.key === 'Escape') {
                      setShowSuggest(false)
                    } else if (e.key === 'Backspace' && !tagInput && currentTags.length > 0) {
                      removeTag(currentTags[currentTags.length - 1])
                    }
                  }}
                />
                <button
                  className="tag-add-btn"
                  onClick={() => addTag(tagInput)}
                  disabled={!tagInput.trim()}
                >
                  Add
                </button>
              </div>
              {showSuggest && suggestions.length > 0 && (
                <div className="tag-suggest">
                  <div className="tag-suggest-head">
                    {tagInput.trim() ? 'Matching tags' : 'Your tags'}
                  </div>
                  {suggestions.map((s, i) => (
                    <button
                      key={s}
                      className={`tag-suggest-item ${i === suggestIdx ? 'active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault() // keep focus on input
                        addTag(s)
                      }}
                      onMouseEnter={() => setSuggestIdx(i)}
                    >
                      #{s}
                    </button>
                  ))}
                </div>
              )}
              <div className="tag-hint muted small">
                Tip: type a new word and Enter to create it. Comma also adds.
              </div>
            </div>
          </section>

          {/* Notes */}
          <section className="todos-panel-section">
            <span className="lbl">Notes</span>
            <textarea
              rows={4}
              placeholder="What's the context? Anything you want to remember…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </section>

          {/* When/Where */}
          <section className="todos-panel-section">
            <span className="lbl">When &amp; where</span>
            <input
              type="text"
              placeholder="e.g. tomorrow 8am, at desk, after coffee"
              value={whenWhere}
              onChange={(e) => setWhenWhere(e.target.value)}
            />
          </section>

          {/* Subtasks */}
          <section className="todos-panel-section">
            <span className="lbl">
              Subtasks {subtasks.length > 0 && `(${subtasks.length})`}
            </span>
            {loadingSubs && <div className="muted small">Loading…</div>}
            {!loadingSubs && subtasks.length === 0 && (
              <div className="muted small">No subtasks yet.</div>
            )}
            <div className="sub-list">
              {subtasks.map((s) => {
                const subRunning = activeId === s.id
                return (
                  <div key={s.id} className={`sub-row ${s.status === 'done' ? 'done' : ''}`}>
                    <button
                      className="todos-check small"
                      onClick={() => toggleSubStatus(s)}
                      aria-label="Toggle done"
                      style={
                        s.status === 'done'
                          ? { background: 'var(--accent)', borderColor: 'var(--accent)' }
                          : undefined
                      }
                    >
                      {s.status === 'done' ? '✓' : ''}
                    </button>
                    <input
                      className="sub-title"
                      value={s.title}
                      onChange={(e) =>
                        setSubtasksState((arr) =>
                          arr.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x))
                        )
                      }
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== s.title) updateSubtask(s.id, { title: v })
                      }}
                    />
                    <input
                      className="sub-eta"
                      type="number"
                      min={0}
                      placeholder="min"
                      value={s.estimate_min ?? ''}
                      onChange={(e) => {
                        const n = e.target.value ? Number(e.target.value) : null
                        updateSubtask(s.id, { estimate_min: n })
                      }}
                    />
                    <span className="sub-logged">
                      {formatDuration(
                        (s.actual_min ?? 0) + (subRunning ? Math.floor(elapsedSec / 60) : 0)
                      )}
                    </span>
                    {subRunning ? (
                      <button className="timer-btn small stop" onClick={stopMine} title="Stop timer">
                        ⏸
                      </button>
                    ) : (
                      <button
                        className="timer-btn small start"
                        onClick={() => startMine(s.id)}
                        title="Start timer"
                      >
                        ▶
                      </button>
                    )}
                    <button
                      className="sub-del"
                      onClick={() => removeSubtask(s)}
                      aria-label="Delete subtask"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
              <div className="sub-add">
                <input
                  type="text"
                  placeholder="+ add subtask, press Enter…"
                  value={subtaskTitle}
                  onChange={(e) => setSubtaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addSubtask()
                  }}
                />
                <button
                  className="add-btn"
                  onClick={addSubtask}
                  disabled={!subtaskTitle.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          </section>

          {/* Footer */}
          <section className="todos-panel-footer">
            <button className="danger-link" onClick={handleDelete}>
              Delete task
            </button>
            <span className="muted small">
              Created {new Date(task.created_at).toLocaleDateString()}
            </span>
          </section>
        </div>
      </aside>
    </>
  )
}

export default TaskEditPanel
