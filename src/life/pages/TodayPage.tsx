import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import QuickAddBar from '../components/QuickAddBar'
import { useLifeStore } from '../store'
import {
  listTasksForDate,
  listOverdueOpenTasks,
  updateTaskStatus,
  getJournalEntry,
  createTimeBlock,
  listTimeBlocks,
} from '../lib/db'
import { planDay } from '../lib/agent'
import type { LifeTask, LifeTimeBlock } from '../types'
import { todayLocal, yesterdayLocal, prettyDate } from '../lib/time'

const TodayPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [today, setToday] = useState<LifeTask[]>([])
  const [overdue, setOverdue] = useState<LifeTask[]>([])
  const [blocks, setBlocks] = useState<LifeTimeBlock[]>([])
  const [loading, setLoading] = useState(false)
  const [planning, setPlanning] = useState(false)

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      const date = todayLocal(lifeUser.timezone)
      const [t, o, b] = await Promise.all([
        listTasksForDate(lifeUser.id, date),
        listOverdueOpenTasks(lifeUser.id, date),
        listTimeBlocks(lifeUser.id, date),
      ])
      setToday(t)
      setOverdue(o)
      setBlocks(b)
    } finally {
      setLoading(false)
    }
  }, [lifeUser])

  const planMyDay = async () => {
    if (!lifeUser) return
    setPlanning(true)
    try {
      const date = todayLocal(lifeUser.timezone)
      const yJournal = await getJournalEntry(lifeUser.id, yesterdayLocal(lifeUser.timezone))
      const openTasks = [...today, ...overdue].filter((t) => t.status !== 'done' && t.status !== 'dropped')
      const planned = await planDay({ user: lifeUser, openTasks, yesterdayJournal: yJournal })
      for (const blk of planned) {
        await createTimeBlock({
          userId: lifeUser.id,
          date,
          start_minute: blk.start_minute,
          end_minute: blk.end_minute,
          label: blk.label,
          kind: blk.kind,
          source: 'agent',
        })
      }
      await load()
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Plan failed: ${(err as Error).message}`)
    } finally {
      setPlanning(false)
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const toggleDone = async (task: LifeTask) => {
    if (!lifeUser) return
    const next = task.status === 'done' ? 'todo' : 'done'
    await updateTaskStatus(lifeUser.id, task.id, next)
    load()
  }

  const top3 = today
    .filter((t) => t.status !== 'done' && t.status !== 'dropped')
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)

  return (
    <LifeLayout title={prettyDate(todayLocal(lifeUser?.timezone), lifeUser?.timezone)}>
      <QuickAddBar onCreated={load} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="life-btn primary" onClick={planMyDay} disabled={planning}>
          {planning ? 'Planning…' : '✨ Plan my day'}
        </button>
        <button className="life-btn" onClick={() => navigate('/life/schedule')}>
          Open schedule →
        </button>
        {blocks.length > 0 && (
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {blocks.length} block{blocks.length === 1 ? '' : 's'} scheduled today
          </span>
        )}
      </div>

      {top3.length > 0 && (
        <div className="life-section">
          <h2>Top 3 priorities</h2>
          {top3.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={toggleDone} />
          ))}
        </div>
      )}

      <div className="life-section">
        <h2>Today ({today.length})</h2>
        {loading && today.length === 0 ? (
          <div className="life-empty"><p>Loading…</p></div>
        ) : today.length === 0 ? (
          <div className="life-empty">
            <h3>Nothing scheduled for today</h3>
            <p>Use the quick-add above (or ⌘K) to drop in a task.</p>
          </div>
        ) : (
          today.map((t) => <TaskRow key={t.id} task={t} onToggle={toggleDone} />)
        )}
      </div>

      {overdue.length > 0 && (
        <div className="life-section">
          <h2>Carry over from earlier ({overdue.length})</h2>
          {overdue.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={toggleDone} showDate />
          ))}
        </div>
      )}

      <div className="life-section">
        <h2>Shortcuts</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="life-btn" onClick={() => navigate('/life/projects')}>
            View projects →
          </button>
          <button className="life-btn" onClick={() => navigate('/life/journal')}>
            Journal →
          </button>
        </div>
      </div>
    </LifeLayout>
  )
}

function TaskRow({
  task,
  onToggle,
  showDate,
}: {
  task: LifeTask
  onToggle: (t: LifeTask) => void
  showDate?: boolean
}) {
  const done = task.status === 'done'
  return (
    <div className={`life-task-row ${done ? 'done' : ''}`}>
      <div className={`check ${done ? 'done' : ''}`} onClick={() => onToggle(task)}>
        {done && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <div className="title">{task.title}</div>
      <div className="meta">
        {task.priority <= 2 && <span className={`pri-${task.priority}`}>P{task.priority}</span>}
        {showDate && task.scheduled_for && <span>{task.scheduled_for}</span>}
        {task.tags.length > 0 && task.tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
      </div>
    </div>
  )
}

export default TodayPage
