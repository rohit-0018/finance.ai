// Work landing page — what you did / what you're doing / what's planned,
// scoped to the Work workspace. Three columns over a date range, a
// link-paste input to import work from URLs, a waiting-on side tab, and
// a Friday-only "Draft weekly update" CTA.
//
// This route only makes sense for the 'work' workspace. If the user is on
// personal, we redirect them to Today.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  listProjects,
  listWaitingOn,
  createTask,
  updateWaitingOnStatus,
  listJournalEntries,
} from '../lib/db'
import { lifeDb } from '../lib/db/_client'
import { enrichLink } from '../lib/linkEnrich'
import { draftWeeklyRollup } from '../lib/weeklyRollup'
import type { LifeTask, LifeProject, LifeWaitingOn } from '../types'
import { todayLocal } from '../lib/time'

type Tab = 'dashboard' | 'waiting'

interface WorkData {
  shipped: LifeTask[]
  inFlight: LifeTask[]
  planned: LifeTask[]
  projects: LifeProject[]
  waiting: LifeWaitingOn[]
}

const EMPTY: WorkData = {
  shipped: [],
  inFlight: [],
  planned: [],
  projects: [],
  waiting: [],
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function isoDaysAhead(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

const WorkPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [data, setData] = useState<WorkData>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [rangeDays, setRangeDays] = useState(7)
  const [linkInput, setLinkInput] = useState('')
  const [importing, setImporting] = useState(false)
  const [rollup, setRollup] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)

  const load = useCallback(async () => {
    if (!lifeUser || !activeWorkspace) return
    setLoading(true)
    try {
      const sinceIso = isoDaysAgo(rangeDays)
      const untilIso = isoDaysAhead(rangeDays)
      const db = lifeDb()
      const [shipped, inFlightRes, plannedRes, projects, waiting] = await Promise.all([
        // done this range
        db
          .from('life_tasks')
          .select('*')
          .eq('user_id', lifeUser.id)
          .eq('workspace_id', activeWorkspace.id)
          .eq('status', 'done')
          .gte('done_at', sinceIso)
          .order('done_at', { ascending: false })
          .limit(50),
        // in-flight = doing OR today
        db
          .from('life_tasks')
          .select('*')
          .eq('user_id', lifeUser.id)
          .eq('workspace_id', activeWorkspace.id)
          .in('status', ['todo', 'doing'])
          .lte('scheduled_for', todayLocal(lifeUser.timezone))
          .order('priority', { ascending: true })
          .limit(50),
        // planned = future scheduled
        db
          .from('life_tasks')
          .select('*')
          .eq('user_id', lifeUser.id)
          .eq('workspace_id', activeWorkspace.id)
          .in('status', ['todo', 'doing'])
          .gt('scheduled_for', todayLocal(lifeUser.timezone))
          .lte('start_at', untilIso)
          .order('start_at', { ascending: true })
          .limit(50),
        listProjects(lifeUser.id, activeWorkspace.id),
        listWaitingOn(lifeUser.id, { workspaceId: activeWorkspace.id, status: 'waiting' }),
      ])

      if (shipped.error || inFlightRes.error || plannedRes.error) {
        throw new Error(
          shipped.error?.message ?? inFlightRes.error?.message ?? plannedRes.error?.message
        )
      }

      setData({
        shipped: (shipped.data ?? []) as LifeTask[],
        inFlight: (inFlightRes.data ?? []) as LifeTask[],
        planned: (plannedRes.data ?? []) as LifeTask[],
        projects,
        waiting,
      })
    } catch (err) {
      alert(`Work load failed: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, activeWorkspace, rangeDays])

  useEffect(() => {
    load()
  }, [load])

  // Non-work workspace → bounce to Today
  if (activeWorkspace && activeWorkspace.kind !== 'work') {
    return <Navigate to="/life" replace />
  }

  const handleLinkImport = async () => {
    if (!lifeUser || !activeWorkspace || !linkInput.trim()) return
    setImporting(true)
    try {
      const enriched = await enrichLink(linkInput.trim())
      await createTask({
        userId: lifeUser.id,
        workspaceId: activeWorkspace.id,
        title: enriched.title,
        notes: enriched.description ? `${enriched.description}\n\n${linkInput.trim()}` : linkInput.trim(),
        due_at: enriched.dueIso ?? null,
        priority: 3,
        source: 'manual',
      })
      setLinkInput('')
      await load()
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  const handleDraftRollup = async () => {
    if (!lifeUser || drafting) return
    setDrafting(true)
    try {
      const from = new Date()
      from.setDate(from.getDate() - 7)
      const fromIso = from.toISOString().slice(0, 10)
      const toIso = todayLocal(lifeUser.timezone)
      const journals = await listJournalEntries(lifeUser.id, 10)
      const text = await draftWeeklyRollup({
        user: lifeUser,
        fromDate: fromIso,
        toDate: toIso,
        doneTasks: data.shipped,
        openTasks: [...data.inFlight, ...data.planned],
        journals: journals.filter((j) => j.date >= fromIso && j.date <= toIso),
      })
      setRollup(text)
    } catch (err) {
      alert(`Rollup failed: ${(err as Error).message}`)
    } finally {
      setDrafting(false)
    }
  }

  const projectById = useMemo(() => {
    const m = new Map<string, LifeProject>()
    for (const p of data.projects) m.set(p.id, p)
    return m
  }, [data.projects])

  const isFriday = new Date().getDay() === 5

  return (
    <LifeLayout title={`Work · last ${rangeDays}d`}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="life-work-tabs">
          <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>
            Dashboard
          </button>
          <button className={tab === 'waiting' ? 'active' : ''} onClick={() => setTab('waiting')}>
            Waiting on {data.waiting.length > 0 && <span className="badge">{data.waiting.length}</span>}
          </button>
        </div>
        <div className="spacer" style={{ flex: 1 }} />
        <select
          value={rangeDays}
          onChange={(e) => setRangeDays(Number(e.target.value))}
          className="life-select"
        >
          <option value={3}>last 3d</option>
          <option value={7}>last 7d</option>
          <option value={14}>last 14d</option>
          <option value={30}>last 30d</option>
        </select>
        {isFriday && (
          <button className="life-btn primary" onClick={handleDraftRollup} disabled={drafting}>
            {drafting ? 'Drafting…' : 'Draft weekly update'}
          </button>
        )}
      </div>

      {tab === 'dashboard' && (
        <>
          {/* Link paste */}
          <div className="life-card" style={{ marginBottom: 16 }}>
            <h3>Import from link</h3>
            <p className="life-empty-inline">
              Paste a GitHub PR, Linear ticket, Notion doc, or any URL. We'll fetch the
              title and file it as a work task.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://github.com/org/repo/pull/123"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLinkImport()
                }}
              />
              <button className="life-btn primary" onClick={handleLinkImport} disabled={importing}>
                {importing ? '…' : 'Import'}
              </button>
            </div>
          </div>

          <div className="life-work-grid">
            <Column
              title="Shipped"
              count={data.shipped.length}
              empty={loading ? 'Loading…' : 'Nothing done in this range.'}
              tint="good"
            >
              {data.shipped.map((t) => (
                <TaskLine
                  key={t.id}
                  task={t}
                  project={t.project_id ? projectById.get(t.project_id) : undefined}
                  stamp={t.done_at?.slice(0, 10)}
                />
              ))}
            </Column>

            <Column
              title="In flight"
              count={data.inFlight.length}
              empty="Nothing in flight."
            >
              {data.inFlight.map((t) => (
                <TaskLine
                  key={t.id}
                  task={t}
                  project={t.project_id ? projectById.get(t.project_id) : undefined}
                  stamp={t.scheduled_for ?? undefined}
                />
              ))}
            </Column>

            <Column
              title="Planned"
              count={data.planned.length}
              empty="Nothing planned ahead. Run a brainstorm."
            >
              {data.planned.map((t) => (
                <TaskLine
                  key={t.id}
                  task={t}
                  project={t.project_id ? projectById.get(t.project_id) : undefined}
                  stamp={t.start_at?.slice(0, 10) ?? t.scheduled_for ?? undefined}
                />
              ))}
            </Column>
          </div>

          {rollup && (
            <div className="life-card accented" style={{ marginTop: 16 }}>
              <h3>Weekly update draft</h3>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  fontSize: '0.88rem',
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                {rollup}
              </pre>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="life-btn primary"
                  onClick={() => {
                    navigator.clipboard?.writeText(rollup)
                  }}
                >
                  Copy
                </button>
                <button className="life-btn" onClick={() => setRollup(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'waiting' && (
        <WaitingTab
          items={data.waiting}
          onChange={async (id, status) => {
            if (!lifeUser) return
            await updateWaitingOnStatus(lifeUser.id, id, status)
            load()
          }}
          onOpenProject={(pid) => navigate(`/life/projects/${pid}`)}
          projectById={projectById}
        />
      )}
    </LifeLayout>
  )
}

const Column: React.FC<{
  title: string
  count: number
  empty: string
  tint?: 'good'
  children: React.ReactNode
}> = ({ title, count, empty, tint, children }) => (
  <section className={`life-card life-col ${tint ?? ''}`}>
    <h3>
      {title} · {count}
    </h3>
    {count === 0 ? <div className="life-empty-inline">{empty}</div> : <div className="col-list">{children}</div>}
  </section>
)

const TaskLine: React.FC<{
  task: LifeTask
  project?: LifeProject
  stamp?: string
}> = ({ task, project, stamp }) => (
  <div className="col-task">
    <div className="col-task-title">{task.title}</div>
    <div className="col-task-meta">
      {project && <span className="tag">{project.name}</span>}
      {task.priority <= 2 && <span className="tag pri">P{task.priority}</span>}
      {stamp && <span className="when">{stamp}</span>}
    </div>
  </div>
)

const WaitingTab: React.FC<{
  items: LifeWaitingOn[]
  onChange: (id: string, status: 'received' | 'gave_up') => void
  onOpenProject: (id: string) => void
  projectById: Map<string, LifeProject>
}> = ({ items, onChange }) => {
  if (items.length === 0) {
    return (
      <div className="life-card">
        <h3>Waiting on</h3>
        <div className="life-empty-inline">Clean. Nobody owes you anything.</div>
      </div>
    )
  }
  const now = Date.now()
  return (
    <div className="life-card">
      <h3>Waiting on · {items.length}</h3>
      <ul className="dash-list">
        {items.map((w) => {
          const daysOverdue = Math.floor(
            (now - new Date(w.follow_up_at).getTime()) / (24 * 60 * 60_000)
          )
          const overdue = daysOverdue > 0
          return (
            <li key={w.id} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'center' }}>
                <strong>{w.title}</strong>
                <span className="tag">{w.who}</span>
                <span className="when" style={{ color: overdue ? '#dc2626' : undefined }}>
                  {overdue ? `${daysOverdue}d overdue` : `due ${w.follow_up_at.slice(0, 10)}`}
                </span>
              </div>
              {w.notes && <div className="life-empty-inline">{w.notes}</div>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="life-btn" onClick={() => onChange(w.id, 'received')}>
                  Received
                </button>
                <button className="life-btn" onClick={() => onChange(w.id, 'gave_up')}>
                  Gave up
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default WorkPage
