import React, { useCallback, useEffect, useMemo, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  getRangeStats,
  getStreak,
  listJournalEntries,
  listProjects,
  listGoals,
  type WeekStats,
} from '../lib/db'
import { lifeDb } from '../lib/supabaseLife'
import { weeklySynthesis } from '../lib/agent'
import type { LifeProject, LifeGoal, LifeProjectPulse } from '../types'
import { todayLocal } from '../lib/time'

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const ReviewPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)

  const [weekStats, setWeekStats] = useState<WeekStats | null>(null)
  const [monthStats, setMonthStats] = useState<WeekStats | null>(null)
  const [streak, setStreak] = useState(0)
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [goals, setGoals] = useState<LifeGoal[]>([])
  const [synthesis, setSynthesis] = useState<string | null>(null)
  const [loadingSyn, setLoadingSyn] = useState(false)

  const today = useMemo(() => todayLocal(lifeUser?.timezone), [lifeUser])
  const weekFrom = useMemo(() => shiftDate(today, -6), [today])
  const monthFrom = useMemo(() => shiftDate(today, -29), [today])

  const load = useCallback(async () => {
    if (!lifeUser) return
    const [w, m, s, projs, gs] = await Promise.all([
      getRangeStats(lifeUser.id, weekFrom, today),
      getRangeStats(lifeUser.id, monthFrom, today),
      getStreak(lifeUser.id, today),
      listProjects(lifeUser.id),
      listGoals(lifeUser.id),
    ])
    setWeekStats(w)
    setMonthStats(m)
    setStreak(s)
    setProjects(projs)
    setGoals(gs)
  }, [lifeUser, weekFrom, monthFrom, today])

  useEffect(() => {
    load()
  }, [load])

  const runSynthesis = async () => {
    if (!lifeUser || !weekStats) return
    setLoadingSyn(true)
    try {
      // Pull recent journal + recent pulses across all projects (light query)
      const journals = await listJournalEntries(lifeUser.id, 14)
      const { data, error } = await lifeDb()
        .from('life_project_pulse')
        .select('*')
        .eq('user_id', lifeUser.id)
        .gte('created_at', `${weekFrom}T00:00:00Z`)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw new Error(error.message)
      const text = await weeklySynthesis({
        fromDate: weekFrom,
        toDate: today,
        journals,
        pulses: (data ?? []) as LifeProjectPulse[],
        doneCount: weekStats.done,
        openCount: weekStats.open,
      })
      setSynthesis(text)
    } catch (err) {
      setSynthesis(`⚠️ ${(err as Error).message}`)
    } finally {
      setLoadingSyn(false)
    }
  }

  // Goal progress: % of linked tasks done
  const [goalProgress, setGoalProgress] = useState<Record<string, { done: number; total: number }>>({})
  useEffect(() => {
    if (!lifeUser || goals.length === 0) return
    let cancelled = false
    ;(async () => {
      const result: Record<string, { done: number; total: number }> = {}
      for (const g of goals) {
        const { data, error } = await lifeDb()
          .from('life_tasks')
          .select('status')
          .eq('user_id', lifeUser.id)
          .eq('goal_id', g.id)
        if (!error) {
          const rows = (data ?? []) as Array<{ status: string }>
          result[g.id] = {
            done: rows.filter((r) => r.status === 'done').length,
            total: rows.length,
          }
        }
      }
      if (!cancelled) setGoalProgress(result)
    })()
    return () => {
      cancelled = true
    }
  }, [lifeUser, goals])

  const projectsByHealth = useMemo(() => {
    const out = { green: 0, yellow: 0, red: 0 } as Record<string, number>
    for (const p of projects) out[p.health] = (out[p.health] ?? 0) + 1
    return out
  }, [projects])

  return (
    <LifeLayout title="Review">
      <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Last 7 days: <strong>{weekFrom}</strong> → <strong>{today}</strong>
      </p>

      <div className="life-stat-grid">
        <div className="life-stat">
          <div className="label">Streak</div>
          <div className="value">{streak}</div>
          <div className="sub">days closed in a row</div>
        </div>
        <div className="life-stat">
          <div className="label">Tasks done · 7d</div>
          <div className="value">{weekStats?.done ?? '—'}</div>
          <div className="sub">{weekStats?.open ?? 0} still open</div>
        </div>
        <div className="life-stat">
          <div className="label">Tasks done · 30d</div>
          <div className="value">{monthStats?.done ?? '—'}</div>
          <div className="sub">{monthStats?.open ?? 0} still open</div>
        </div>
        <div className="life-stat">
          <div className="label">Projects health</div>
          <div className="value">{projectsByHealth.green ?? 0}/{projects.length}</div>
          <div className="sub">
            🟢 {projectsByHealth.green ?? 0} · 🟡 {projectsByHealth.yellow ?? 0} · 🔴 {projectsByHealth.red ?? 0}
          </div>
        </div>
      </div>

      <div className="life-section">
        <h2>Goal progress</h2>
        {goals.length === 0 ? (
          <div className="life-empty"><p>No goals yet.</p></div>
        ) : (
          goals.map((g) => {
            const p = goalProgress[g.id] ?? { done: 0, total: 0 }
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
            return (
              <div key={g.id} className="life-card">
                <div className="life-card-title">{g.title}</div>
                <div className="life-card-meta">
                  <span className={`life-pill ${g.category}`}>{g.category}</span>
                  <span>{g.horizon}</span>
                  <span>{p.done}/{p.total} tasks · {pct}%</span>
                </div>
                <div className="life-progress">
                  <div className="life-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="life-section">
        <h2>Weekly synthesis</h2>
        <button className="life-btn primary" onClick={runSynthesis} disabled={loadingSyn} style={{ marginBottom: 12 }}>
          {loadingSyn ? 'Thinking…' : '✨ Generate synthesis'}
        </button>
        {synthesis && (
          <div className="life-pulse">
            <h3>Agent's read on your week</h3>
            <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {synthesis}
            </p>
          </div>
        )}
      </div>
    </LifeLayout>
  )
}

export default ReviewPage
