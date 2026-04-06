// Personal landing — the low-friction counterpart to Work. Shows streaks,
// minimum-viable day progress, upcoming personal commitments, and the
// spaced-repetition queue.
import React, { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  listLearnings,
  listTasksForDate,
  listProjects,
  getStreak,
} from '../lib/db'
import { loadMvdItems, loadMvdDone, toggleMvdDone, type MvdItem } from '../lib/mvd'
import { todayLocal } from '../lib/time'
import type { LifeLearning, LifeTask, LifeProject } from '../types'

const PersonalPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)

  const [today, setToday] = useState<LifeTask[]>([])
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [streak, setStreak] = useState(0)
  const [dueLearnings, setDueLearnings] = useState<LifeLearning[]>([])
  const [mvdItems, setMvdItems] = useState<MvdItem[]>([])
  const [mvdDone, setMvdDone] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!lifeUser || !activeWorkspace) return
    const date = todayLocal(lifeUser.timezone)
    const [t, p, s, l, items, done] = await Promise.all([
      listTasksForDate(lifeUser.id, date, activeWorkspace.id),
      listProjects(lifeUser.id, activeWorkspace.id),
      getStreak(lifeUser.id, date),
      listLearnings(lifeUser.id, {
        workspaceId: activeWorkspace.id,
        archived: false,
        dueBefore: new Date().toISOString(),
      }),
      loadMvdItems(lifeUser.id, activeWorkspace.id),
      loadMvdDone(lifeUser.id, activeWorkspace.id, date),
    ])
    setToday(t)
    setProjects(p)
    setStreak(s)
    setDueLearnings(l)
    setMvdItems(items)
    setMvdDone(done)
  }, [lifeUser, activeWorkspace])

  useEffect(() => {
    load()
  }, [load])

  if (activeWorkspace && activeWorkspace.kind !== 'personal') {
    return <Navigate to="/life/work" replace />
  }

  const onToggleMvd = async (id: string) => {
    if (!lifeUser || !activeWorkspace) return
    const date = todayLocal(lifeUser.timezone)
    const next = await toggleMvdDone(lifeUser.id, activeWorkspace.id, date, id)
    setMvdDone(next)
  }

  const mvdDoneCount = mvdItems.filter((i) => mvdDone.has(i.id)).length
  const openToday = today.filter((t) => t.status !== 'done' && t.status !== 'dropped')
  const activeProjects = projects.filter((p) => p.status === 'active')

  return (
    <LifeLayout title="Personal">
      <div className="life-mvd" style={{ marginBottom: 16 }}>
        <span className="label">Minimum day</span>
        {mvdItems.map((item) => {
          const done = mvdDone.has(item.id)
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

      <div className="life-dash">
        <section className="life-card accented col-span-2">
          <h3>Rhythm</h3>
          <p className="big">
            {streak > 0
              ? `${streak}-day journal streak going. `
              : 'No journal streak right now. '}
            {mvdDoneCount === mvdItems.length && mvdItems.length > 0
              ? 'Minimum day is complete. '
              : `${mvdDoneCount} of ${mvdItems.length} minimum-day items done. `}
            {openToday.length > 0
              ? `${openToday.length} open for today.`
              : 'Nothing scheduled for today yet.'}
          </p>
        </section>

        <section className="life-card">
          <h3>Learnings due · {dueLearnings.length}</h3>
          {dueLearnings.length === 0 ? (
            <div className="life-empty-inline">Nothing to review right now.</div>
          ) : (
            <>
              <ul className="dash-list">
                {dueLearnings.slice(0, 3).map((l) => (
                  <li key={l.id}>
                    <span style={{ fontSize: '0.82rem' }}>
                      {l.content.slice(0, 80)}
                      {l.content.length > 80 ? '…' : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <button className="life-btn" onClick={() => navigate('/life/learnings')}>
                Review all →
              </button>
            </>
          )}
        </section>

        <section className="life-card">
          <h3>Personal projects · {activeProjects.length}</h3>
          {activeProjects.length === 0 ? (
            <div className="life-empty-inline">
              Nothing active. Start a brainstorm to plan something.
            </div>
          ) : (
            <ul className="dash-list">
              {activeProjects.slice(0, 5).map((p) => (
                <li
                  key={p.id}
                  onClick={() => navigate(`/life/projects/${p.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <span>{p.name}</span>
                  <span className="tag">{p.health}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="life-card col-span-2">
          <h3>Capture an idea</h3>
          <p className="life-empty-inline">
            Anything worth remembering? Put it into the learnings queue — it'll resurface
            for review and has 7 days to turn into a real task.
          </p>
          <div>
            <button className="life-btn primary" onClick={() => navigate('/life/learnings')}>
              Open learnings →
            </button>
          </div>
        </section>
      </div>
    </LifeLayout>
  )
}

export default PersonalPage
