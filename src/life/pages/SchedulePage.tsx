import React, { useCallback, useEffect, useRef, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { listTimeBlocks, createTimeBlock, deleteTimeBlock } from '../lib/db'
import type { LifeTimeBlock, TimeBlockKind } from '../types'
import { todayLocal, prettyDate } from '../lib/time'

const KINDS: TimeBlockKind[] = ['office', 'deep', 'learn', 'admin', 'break']
const PIXELS_PER_HOUR = 60
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

function snap15(min: number): number {
  return Math.max(0, Math.min(1439, Math.round(min / 15) * 15))
}

const SchedulePage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [date, setDate] = useState(todayLocal(lifeUser?.timezone))
  const [blocks, setBlocks] = useState<LifeTimeBlock[]>([])
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null)
  const [pendingKind, setPendingKind] = useState<TimeBlockKind>('deep')
  const canvasRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!lifeUser) return
    setBlocks(await listTimeBlocks(lifeUser.id, date))
  }, [lifeUser, date])

  useEffect(() => {
    load()
  }, [load])

  // y-pixel inside canvas → minutes since midnight
  const yToMinutes = (y: number): number => {
    return snap15((y / PIXELS_PER_HOUR) * 60)
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const m = yToMinutes(e.clientY - rect.top)
    setDrag({ start: m, end: m + 30 })
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const m = yToMinutes(e.clientY - rect.top)
    setDrag({ start: drag.start, end: Math.max(drag.start + 15, m) })
  }
  const onMouseUp = async () => {
    if (!lifeUser || !drag) return
    const label = window.prompt('Label this block:', pendingKind)
    if (label && label.trim()) {
      await createTimeBlock({
        userId: lifeUser.id,
        date,
        start_minute: drag.start,
        end_minute: drag.end,
        label: label.trim(),
        kind: pendingKind,
      })
      load()
    }
    setDrag(null)
  }

  const remove = async (id: string) => {
    if (!lifeUser) return
    await deleteTimeBlock(lifeUser.id, id)
    load()
  }

  const shiftDate = (delta: number) => {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + delta)
    setDate(d.toISOString().slice(0, 10))
  }

  const workStart = (lifeUser?.work_start_hour ?? 11) * 60
  const workEnd = (lifeUser?.work_end_hour ?? 20) * 60

  return (
    <LifeLayout title="Schedule">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button className="life-btn" onClick={() => shiftDate(-1)}>← prev</button>
        <button className="life-btn" onClick={() => setDate(todayLocal(lifeUser?.timezone))}>today</button>
        <button className="life-btn" onClick={() => shiftDate(1)}>next →</button>
        <span style={{ marginLeft: 12, fontWeight: 600 }}>
          {prettyDate(date, lifeUser?.timezone)} · {date}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>kind:</span>
        {KINDS.map((k) => (
          <button
            key={k}
            className={`life-btn ${pendingKind === k ? 'primary' : ''}`}
            onClick={() => setPendingKind(k)}
            style={{ padding: '6px 10px', fontSize: '0.75rem' }}
          >
            {k}
          </button>
        ))}
      </div>

      <p style={{ margin: '0 0 14px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        Click and drag on the timeline to create a block. Snaps to 15 minutes.
      </p>

      <div className="life-schedule">
        <div className="life-schedule-hours">
          {HOURS.map((h) => (
            <div key={h} className="life-schedule-hour">{h.toString().padStart(2, '0')}:00</div>
          ))}
        </div>
        <div
          className="life-schedule-canvas"
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => drag && setDrag(null)}
          style={{ height: HOURS.length * PIXELS_PER_HOUR }}
        >
          {HOURS.map((h) => {
            const m = h * 60
            const inWork = m >= workStart && m < workEnd
            return <div key={h} className={`life-schedule-row ${inWork ? 'work' : ''}`} />
          })}
          {blocks.map((b) => {
            const top = (b.start_minute / 60) * PIXELS_PER_HOUR
            const height = ((b.end_minute - b.start_minute) / 60) * PIXELS_PER_HOUR
            return (
              <div
                key={b.id}
                className={`life-schedule-block kind-${b.kind}`}
                style={{ top, height }}
                title={`${minutesToLabel(b.start_minute)}–${minutesToLabel(b.end_minute)} · ${b.kind}`}
              >
                <div className="blk-label">{b.label}</div>
                <div className="blk-time">
                  {minutesToLabel(b.start_minute)}–{minutesToLabel(b.end_minute)}
                </div>
                <button
                  className="blk-del"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(b.id)
                  }}
                  aria-label="Delete block"
                >
                  ✕
                </button>
              </div>
            )
          })}
          {drag && (
            <div
              className="life-schedule-drag"
              style={{
                top: (drag.start / 60) * PIXELS_PER_HOUR,
                height: ((drag.end - drag.start) / 60) * PIXELS_PER_HOUR,
              }}
            />
          )}
        </div>
      </div>
    </LifeLayout>
  )
}

export default SchedulePage
