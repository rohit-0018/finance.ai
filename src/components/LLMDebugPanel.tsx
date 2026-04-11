import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLLMDebug, type LLMDebugEntry } from '../store/llmDebug'
import { useAppStore } from '../store'

interface Pose {
  x: number
  y: number
  w: number
  h: number
}

const STORAGE_KEY = 'papermind_llm_debug_pose'

function loadPose(): Pose {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Pose
  } catch { /* ignore */ }
  const w = Math.min(480, window.innerWidth - 40)
  const h = Math.min(640, window.innerHeight - 80)
  return { x: window.innerWidth - w - 20, y: 60, w, h }
}

function savePose(pose: Pose): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pose)) } catch { /* ignore */ }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const EntryRow: React.FC<{ entry: LLMDebugEntry }> = ({ entry }) => {
  const [open, setOpen] = useState(false)
  const time = new Date(entry.startedAt).toLocaleTimeString()
  return (
    <div className={`llmd-entry ${entry.error ? 'error' : ''}`}>
      <button className="llmd-entry-head" onClick={() => setOpen(!open)}>
        <span className="llmd-entry-label">{entry.label}</span>
        <span className="llmd-entry-meta">
          {formatDuration(entry.durationMs)} · in {entry.inputChars.toLocaleString()}ch · out {entry.outputChars.toLocaleString()}ch
        </span>
        <span className="llmd-entry-time">{time}</span>
        <span className="llmd-entry-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="llmd-entry-body">
          <div className="llmd-kv"><span>model</span><code>{entry.model}</code></div>
          <div className="llmd-kv"><span>max_tokens</span><code>{entry.maxTokens ?? '—'}</code></div>
          {entry.error && (
            <>
              <div className="llmd-section-title">error</div>
              <pre className="llmd-pre error">{entry.error}</pre>
            </>
          )}
          {entry.system && (
            <>
              <div className="llmd-section-title">system</div>
              <pre className="llmd-pre">{entry.system}</pre>
            </>
          )}
          {entry.messages.map((m, i) => (
            <React.Fragment key={i}>
              <div className="llmd-section-title">{m.role}</div>
              <pre className="llmd-pre">{m.content}</pre>
            </React.Fragment>
          ))}
          <div className="llmd-section-title">response</div>
          <pre className="llmd-pre response">{entry.response || '(empty)'}</pre>
        </div>
      )}
    </div>
  )
}

const LLMDebugPanel: React.FC = () => {
  const isAdmin = useAppStore((s) => s.isAdmin)
  const enabled = useLLMDebug((s) => s.enabled)
  const open = useLLMDebug((s) => s.open)
  const entries = useLLMDebug((s) => s.entries)
  const setEnabled = useLLMDebug((s) => s.setEnabled)
  const setOpen = useLLMDebug((s) => s.setOpen)
  const clear = useLLMDebug((s) => s.clear)

  const [pose, setPose] = useState<Pose>(() => loadPose())
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; start: Pose } | null>(null)

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.mode === 'move') {
      const nx = Math.max(0, Math.min(window.innerWidth - 80, d.start.x + dx))
      const ny = Math.max(0, Math.min(window.innerHeight - 40, d.start.y + dy))
      setPose((p) => ({ ...p, x: nx, y: ny }))
    } else {
      const nw = Math.max(320, Math.min(window.innerWidth - d.start.x - 8, d.start.w + dx))
      const nh = Math.max(240, Math.min(window.innerHeight - d.start.y - 8, d.start.h + dy))
      setPose((p) => ({ ...p, w: nw, h: nh }))
    }
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    setPose((p) => { savePose(p); return p })
  }, [onPointerMove])

  const startDrag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault()
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: pose }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove, onPointerUp])

  if (!isAdmin()) return null

  // Toggle pill (shown when closed)
  if (!open) {
    return (
      <button
        className="llmd-toggle-pill"
        onClick={() => {
          if (!enabled) setEnabled(true)
          setOpen(true)
        }}
        title="Open LLM debug panel"
      >
        🔬 LLM {enabled ? `· ${entries.length}` : 'off'}
      </button>
    )
  }

  return (
    <div
      className="llmd-panel"
      style={{ left: pose.x, top: pose.y, width: pose.w, height: pose.h }}
    >
      <div className="llmd-header" onPointerDown={startDrag('move')}>
        <span className="llmd-title">🔬 LLM Debug</span>
        <span className="llmd-count">{entries.length} calls</span>
        <div className="llmd-header-actions">
          <label className="llmd-enable">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              onPointerDown={(e) => e.stopPropagation()}
            />
            record
          </label>
          <button onPointerDown={(e) => e.stopPropagation()} onClick={clear}>Clear</button>
          <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)}>✕</button>
        </div>
      </div>
      <div className="llmd-body">
        {!enabled && (
          <div className="llmd-empty">
            Recording is OFF. Enable it above and trigger an extraction — every prompt and response will appear here.
          </div>
        )}
        {enabled && entries.length === 0 && (
          <div className="llmd-empty">No LLM calls yet. Trigger an extraction to populate.</div>
        )}
        {entries.map((e) => <EntryRow key={e.id} entry={e} />)}
      </div>
      <div className="llmd-resize" onPointerDown={startDrag('resize')} />
    </div>
  )
}

export default LLMDebugPanel
