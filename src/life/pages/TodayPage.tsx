// Today — the narrative dashboard.
//
// Phase 1 rebuild. This is no longer a three-stack of task lists. It is a
// command center that answers four questions at a glance:
//   1. What did yesterday leave me? (briefing)
//   2. What am I supposed to be doing RIGHT NOW? (now)
//   3. What's next? (next up, with countdowns)
//   4. What's drifting? (stalled projects, cross-workspace alerts)
//
// The old "Top 3 / Today / Overdue" lists are collapsed into a single "Next
// up" card — if the user wants the full list they open /life/schedule.
//
// The QuickAddBar is deliberately gone. The only way new work enters Life is
// via a brainstorm — we want talk-to-plan, not a free-form to-do dump.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  listTasksForDate,
  listOverdueOpenTasks,
  updateTaskStatus,
  getJournalEntry,
  listProjects,
} from '../lib/db'
import {
  loadMvdItems,
  loadMvdDone,
  toggleMvdDone,
  type MvdItem,
} from '../lib/mvd'
import type { LifeTask, LifeProject, LifeJournalEntry } from '../types'
import { todayLocal, yesterdayLocal, prettyDate } from '../lib/time'
import FocusSession from '../components/FocusSession'
import { planVsRealityToday, type PlanVsReality } from '../lib/reviewMetrics'

interface DashboardData {
  today: LifeTask[]
  overdue: LifeTask[]
  yesterdayJournal: LifeJournalEntry | null
  projects: LifeProject[]
  mvdItems: MvdItem[]
  mvdDone: Set<string>
}

const EMPTY: DashboardData = {
  today: [],
  overdue: [],
  yesterdayJournal: null,
  projects: [],
  mvdItems: [],
  mvdDone: new Set(),
}

function formatTime(iso: string | null, tz: string | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    })
  } catch {
    return ''
  }
}

function relativeCountdown(iso: string | null): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) return 'overdue'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  const days = Math.round(hrs / 24)
  return `in ${days}d`
}

const TodayPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const [data, setData] = useState<DashboardData>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [focusTask, setFocusTask] = useState<LifeTask | null>(null)
  const [pvr, setPvr] = useState<PlanVsReality | null>(null)

  const load = useCallback(async () => {
    if (!lifeUser || !activeWorkspace) return
    setLoading(true)
    try {
      const date = todayLocal(lifeUser.timezone)
      const [today, overdue, yJournal, projects, mvdItems, mvdDone] = await Promise.all([
        listTasksForDate(lifeUser.id, date, activeWorkspace.id),
        listOverdueOpenTasks(lifeUser.id, date, activeWorkspace.id),
        getJournalEntry(lifeUser.id, yesterdayLocal(lifeUser.timezone)),
        listProjects(lifeUser.id, activeWorkspace.id),
        loadMvdItems(lifeUser.id, activeWorkspace.id),
        loadMvdDone(lifeUser.id, activeWorkspace.id, date),
      ])
      setData({ today, overdue, yesterdayJournal: yJournal, projects, mvdItems, mvdDone })
      planVsRealityToday(lifeUser.id, activeWorkspace.id, lifeUser.timezone)
        .then(setPvr)
        .catch(() => {/* non-fatal */})
    } finally {
      setLoading(false)
    }
  }, [lifeUser, activeWorkspace])

  useEffect(() => {
    load()
  }, [load])

  const toggleTask = async (task: LifeTask) => {
    if (!lifeUser) return
    const next = task.status === 'done' ? 'todo' : 'done'
    await updateTaskStatus(lifeUser.id, task.id, next)
    load()
  }

  const onToggleMvd = async (id: string) => {
    if (!lifeUser || !activeWorkspace) return
    const date = todayLocal(lifeUser.timezone)
    const nextDone = await toggleMvdDone(lifeUser.id, activeWorkspace.id, date, id)
    setData((d) => ({ ...d, mvdDone: nextDone }))
  }

  // Derived buckets for the cards
  const openToday = useMemo(
    () => data.today.filter((t) => t.status !== 'done' && t.status !== 'dropped'),
    [data.today]
  )

  const nextUp = useMemo(() => {
    const all = [...openToday, ...data.overdue].sort((a, b) => {
      const at = a.start_at ?? a.due_at ?? ''
      const bt = b.start_at ?? b.due_at ?? ''
      if (at && bt) return at.localeCompare(bt)
      if (at) return -1
      if (bt) return 1
      return a.priority - b.priority
    })
    return all.slice(0, 5)
  }, [openToday, data.overdue])

  const nowTask = useMemo(() => {
    const now = Date.now()
    return openToday.find((t) => {
      if (!t.start_at) return false
      const s = new Date(t.start_at).getTime()
      const e = t.due_at ? new Date(t.due_at).getTime() : s + 60 * 60_000
      return s <= now && now <= e
    })
  }, [openToday])

  const drifting = useMemo(() => {
    const now = Date.now()
    const fourDays = 4 * 24 * 60 * 60 * 1000
    return data.projects
      .filter((p) => p.status === 'active')
      .filter((p) => now - new Date(p.updated_at).getTime() > fourDays)
      .slice(0, 5)
  }, [data.projects])

  const title = prettyDate(todayLocal(lifeUser?.timezone), lifeUser?.timezone)
  const workspaceLabel = activeWorkspace?.name ?? 'Life'
  const briefing = buildBriefing({
    workspaceLabel,
    yJournal: data.yesterdayJournal,
    openCount: openToday.length,
    overdueCount: data.overdue.length,
    drifting: drifting.length,
  })

  return (
    <LifeLayout title={title}>
      {/* Minimum viable day — always first, always before work */}
      <div className="life-mvd" style={{ marginBottom: 16 }}>
        <span className="label">Minimum day</span>
        {data.mvdItems.map((item) => {
          const done = data.mvdDone.has(item.id)
          return (
            <button
              key={item.id}
              className={`chip ${done ? 'done' : ''}`}
              onClick={() => onToggleMvd(item.id)}
            >
              <span className="check">
                {done && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              {item.title}
            </button>
          )
        })}
      </div>

      {/* Brainstorm CTA replaces QuickAddBar */}
      <div
        className="life-brainstorm-cta"
        style={{ marginBottom: 16 }}
        onClick={() => navigate('/life/brainstorm')}
        role="button"
        tabIndex={0}
      >
        <span className="bolt">✦</span>
        <div className="cta-body">
          <span className="cta-title">Start a brainstorm</span>
          <span className="cta-sub">
            Talk it through. The agent will draft a plan with dates, risks, and first
            actions — you commit it in one click.
          </span>
        </div>
      </div>

      <div className="life-dash">
        {/* Briefing card — the narrative */}
        <section className="life-card accented col-span-2">
          <h3>Briefing · {workspaceLabel}</h3>
          <p className="big">{briefing}</p>
          {pvr && pvr.plannedCount > 0 && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #888)' }}>
              Reality check: {pvr.narrative}
            </div>
          )}
        </section>

        {/* Now card */}
        <section className="life-card">
          <h3>Now</h3>
          {nowTask ? (
            <>
              <div className="big">{nowTask.title}</div>
              {nowTask.when_where && (
                <div className="life-empty-inline">{nowTask.when_where}</div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="life-btn primary" onClick={() => setFocusTask(nowTask)}>
                  Focus
                </button>
                <button className="life-btn" onClick={() => toggleTask(nowTask)}>
                  Mark done
                </button>
              </div>
            </>
          ) : nextUp[0] ? (
            <>
              <div className="life-empty-inline">
                Nothing scheduled right this minute.
              </div>
              <div className="big">Start with: {nextUp[0].title}</div>
              <div>
                <button className="life-btn primary" onClick={() => setFocusTask(nextUp[0])}>
                  5-minute start
                </button>
              </div>
            </>
          ) : (
            <div className="life-empty-inline">
              Nothing scheduled. Open a brainstorm to plan something real.
            </div>
          )}
        </section>

        {/* Next up card */}
        <section className="life-card">
          <h3>Next up</h3>
          {nextUp.length === 0 ? (
            <div className="life-empty-inline">
              {loading ? 'Loading…' : 'Empty. Open a brainstorm to plan something real.'}
            </div>
          ) : (
            <ul className="dash-list">
              {nextUp.map((t) => (
                <li key={t.id}>
                  <span>{t.title}</span>
                  {t.priority <= 2 && <span className="tag">P{t.priority}</span>}
                  <span className="when">
                    {t.start_at
                      ? formatTime(t.start_at, lifeUser?.timezone)
                      : t.due_at
                      ? relativeCountdown(t.due_at)
                      : 'today'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Drifting projects */}
        <section className="life-card col-span-2">
          <h3>Drifting · not touched in 4+ days</h3>
          {drifting.length === 0 ? (
            <div className="life-empty-inline">
              Nothing is drifting. That's rare — enjoy it.
            </div>
          ) : (
            <ul className="dash-list">
              {drifting.map((p) => {
                const daysAgo = Math.floor(
                  (Date.now() - new Date(p.updated_at).getTime()) / (24 * 60 * 60_000)
                )
                return (
                  <li
                    key={p.id}
                    onClick={() => navigate(`/life/projects/${p.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span>{p.name}</span>
                    <span className="tag">{p.health}</span>
                    <span className="when">{daysAgo}d silent</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {focusTask && lifeUser && (
        <FocusSession
          user={lifeUser}
          task={focusTask}
          onClose={() => {
            setFocusTask(null)
            load()
          }}
        />
      )}
    </LifeLayout>
  )
}

function buildBriefing(input: {
  workspaceLabel: string
  yJournal: LifeJournalEntry | null
  openCount: number
  overdueCount: number
  drifting: number
}): string {
  const parts: string[] = []
  if (input.yJournal?.tomorrow) {
    parts.push(`Yesterday you planned: ${input.yJournal.tomorrow.trim()}.`)
  } else if (input.yJournal?.summary) {
    parts.push(
      `Yesterday's note: ${input.yJournal.summary.slice(0, 140).trim()}${
        input.yJournal.summary.length > 140 ? '…' : ''
      }`
    )
  } else {
    parts.push('No journal from yesterday.')
  }
  if (input.openCount > 0) {
    parts.push(
      `${input.openCount} open for today${
        input.overdueCount > 0 ? `, ${input.overdueCount} carrying over` : ''
      }.`
    )
  } else if (input.overdueCount > 0) {
    parts.push(`${input.overdueCount} tasks still waiting from earlier.`)
  } else {
    parts.push('Nothing scheduled for today yet.')
  }
  if (input.drifting > 0) {
    parts.push(
      `${input.drifting} project${input.drifting === 1 ? '' : 's'} hasn't moved in 4+ days.`
    )
  }
  return parts.join(' ')
}

export default TodayPage
