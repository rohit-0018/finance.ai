import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { listGoals, createGoal, updateGoal, deleteGoal, listProjects } from '../lib/db'
import type { LifeGoal, LifeCategory, LifeProject } from '../types'

const CATS: LifeCategory[] = ['office', 'personal', 'health', 'learn']
const HORIZONS: Array<'quarter' | 'year' | 'life'> = ['quarter', 'year', 'life']

const HORIZON_LABELS: Record<string, string> = {
  quarter: 'This quarter',
  year: 'This year',
  life: 'Life-long',
}

function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null
  const target = new Date(`${date}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

const GoalsPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const [goals, setGoals] = useState<LifeGoal[]>([])
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'active' | 'done' | 'all'>('active')

  // Composer
  const [composerOpen, setComposerOpen] = useState(false)
  const [editing, setEditing] = useState<LifeGoal | null>(null)
  const [title, setTitle] = useState('')
  const [why, setWhy] = useState('')
  const [category, setCategory] = useState<LifeCategory>('personal')
  const [horizon, setHorizon] = useState<'quarter' | 'year' | 'life'>('quarter')
  const [targetDate, setTargetDate] = useState('')

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      const [g, p] = await Promise.all([
        listGoals(lifeUser.id, activeWorkspace?.id),
        listProjects(lifeUser.id, activeWorkspace?.id),
      ])
      setGoals(g)
      setProjects(p)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, activeWorkspace?.id])

  useEffect(() => {
    load()
  }, [load])

  const projectsByGoal = useMemo(() => {
    const map = new Map<string, LifeProject[]>()
    for (const p of projects) {
      if (!p.goal_id) continue
      const list = map.get(p.goal_id) ?? []
      list.push(p)
      map.set(p.goal_id, list)
    }
    return map
  }, [projects])

  const visible = useMemo(() => {
    if (filter === 'all') return goals
    if (filter === 'done') return goals.filter((g) => g.status === 'done')
    return goals.filter((g) => g.status === 'active')
  }, [goals, filter])

  const grouped = useMemo(() => {
    const m: Record<string, LifeGoal[]> = { life: [], year: [], quarter: [] }
    for (const g of visible) {
      const key = g.horizon ?? 'quarter'
      m[key] = m[key] ?? []
      m[key].push(g)
    }
    return m
  }, [visible])

  const reset = () => {
    setEditing(null)
    setTitle('')
    setWhy('')
    setCategory('personal')
    setHorizon('quarter')
    setTargetDate('')
  }

  const openCreate = () => {
    reset()
    setComposerOpen(true)
  }

  const openEdit = (g: LifeGoal) => {
    setEditing(g)
    setTitle(g.title)
    setWhy(g.why ?? '')
    setCategory(g.category)
    setHorizon(g.horizon)
    setTargetDate(g.target_date ?? '')
    setComposerOpen(true)
  }

  const submit = async () => {
    if (!lifeUser || !title.trim()) return
    if (editing) {
      await updateGoal(lifeUser.id, editing.id, {
        title: title.trim(),
        why: why || null,
        category,
        horizon,
        target_date: targetDate || null,
      })
    } else {
      await createGoal({
        userId: lifeUser.id,
        workspaceId: activeWorkspace?.id,
        title: title.trim(),
        why,
        category,
        horizon,
        target_date: targetDate || null,
      })
    }
    setComposerOpen(false)
    reset()
    load()
  }

  const toggleStatus = async (g: LifeGoal) => {
    if (!lifeUser) return
    await updateGoal(lifeUser.id, g.id, { status: g.status === 'done' ? 'active' : 'done' })
    load()
  }

  const remove = async (g: LifeGoal) => {
    if (!lifeUser) return
    if (!confirm(`Delete goal "${g.title}"?`)) return
    await deleteGoal(lifeUser.id, g.id)
    load()
  }

  return (
    <LifeLayout title="Goals">
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted, #888)', fontSize: '0.85rem' }}>
        Goals are the <strong>outcomes</strong> you're aiming for — the "what" and the "why".
        Projects underneath each goal are how you actually get there.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {(['active', 'done', 'all'] as const).map((f) => (
          <button
            key={f}
            className={`life-btn ${filter === f ? 'primary' : ''}`}
            onClick={() => setFilter(f)}
            style={{ textTransform: 'capitalize' }}
          >
            {f}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {goals.filter((g) => g.status === 'active').length} active · {goals.length} total
        </span>
        <button className="life-btn primary" onClick={openCreate}>
          + New goal
        </button>
      </div>

      {loading && goals.length === 0 ? (
        <div className="life-empty">
          <p>Loading…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="life-empty">
          <h3>No goals yet</h3>
          <p>Set one to anchor your daily work.</p>
        </div>
      ) : (
        (['life', 'year', 'quarter'] as const).map((h) => {
          const items = grouped[h] ?? []
          if (items.length === 0) return null
          return (
            <section key={h} style={{ marginBottom: 28 }}>
              <h2
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--text-muted)',
                  marginBottom: 10,
                }}
              >
                {HORIZON_LABELS[h]}
              </h2>
              {items.map((g) => {
                const linked = projectsByGoal.get(g.id) ?? []
                const activeProjects = linked.filter((p) => p.status === 'active').length
                const days = daysUntil(g.target_date)
                return (
                  <div
                    key={g.id}
                    className="life-card"
                    style={{
                      borderLeft: `3px solid ${g.status === 'done' ? '#10b981' : 'var(--accent)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div
                          className="life-card-title"
                          style={{
                            textDecoration: g.status === 'done' ? 'line-through' : 'none',
                            fontSize: '1.05rem',
                          }}
                        >
                          🎯 {g.title}
                        </div>
                        {g.why && (
                          <p
                            style={{
                              margin: '8px 0 6px',
                              fontSize: '0.88rem',
                              fontStyle: 'italic',
                              lineHeight: 1.5,
                              color: 'var(--text-muted, #888)',
                            }}
                          >
                            "{g.why}"
                          </p>
                        )}
                        <div className="life-card-meta" style={{ flexWrap: 'wrap' }}>
                          <span className={`life-pill ${g.category}`}>{g.category}</span>
                          {g.target_date && (
                            <span
                              style={{
                                color:
                                  days != null && days < 0
                                    ? '#ef4444'
                                    : days != null && days <= 30
                                    ? '#f59e0b'
                                    : 'var(--text-muted)',
                              }}
                            >
                              📅 {g.target_date}
                              {days != null &&
                                ` (${
                                  days < 0
                                    ? `${-days}d overdue`
                                    : days === 0
                                    ? 'today'
                                    : `${days}d`
                                })`}
                            </span>
                          )}
                          <span>
                            {linked.length === 0
                              ? 'no projects'
                              : `${activeProjects}/${linked.length} active project${
                                  linked.length === 1 ? '' : 's'
                                }`}
                          </span>
                        </div>

                        {linked.length > 0 && (
                          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {linked.slice(0, 6).map((p) => (
                              <button
                                key={p.id}
                                className="life-btn"
                                onClick={() => navigate(`/life/projects/${p.id}`)}
                                style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                                title={`status: ${p.status} · health: ${p.health}`}
                              >
                                ↳ {p.name}
                              </button>
                            ))}
                            {linked.length > 6 && (
                              <span
                                style={{ fontSize: '0.74rem', color: 'var(--text-muted)', alignSelf: 'center' }}
                              >
                                +{linked.length - 6} more
                              </span>
                            )}
                          </div>
                        )}

                        {linked.length === 0 && g.status !== 'done' && (
                          <div style={{ marginTop: 10 }}>
                            <button
                              className="life-btn"
                              onClick={() => navigate('/life/projects')}
                              style={{ fontSize: '0.78rem' }}
                            >
                              + Add a project for this goal
                            </button>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button className="life-btn" onClick={() => openEdit(g)}>
                          Edit
                        </button>
                        <button className="life-btn" onClick={() => toggleStatus(g)}>
                          {g.status === 'done' ? 'Reopen' : 'Achieved'}
                        </button>
                        <button className="life-btn danger" onClick={() => remove(g)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })
      )}

      {composerOpen && (
        <div
          onClick={() => setComposerOpen(false)}
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
            style={{ width: 540, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div className="life-card-title">{editing ? 'Edit goal' : 'New goal'}</div>
            <p style={{ margin: '6px 0 14px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              State the outcome and the reason. Execution lives in projects.
            </p>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='Outcome — e.g. "Run a half marathon"'
              style={inp}
            />
            <textarea
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="Why does this matter? What changes when you achieve it?"
              style={{ ...inp, minHeight: 80 }}
            />

            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {CATS.map((c) => (
                <button
                  key={c}
                  className={`life-pill ${category === c ? c : ''}`}
                  onClick={() => setCategory(c)}
                  style={{ cursor: 'pointer', border: 'none' }}
                >
                  {c}
                </button>
              ))}
            </div>

            <div style={{ marginBottom: 10 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                  letterSpacing: '0.05em',
                }}
              >
                Horizon
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {HORIZONS.map((h) => (
                  <button
                    key={h}
                    className={`life-btn ${horizon === h ? 'primary' : ''}`}
                    onClick={() => setHorizon(h)}
                  >
                    {HORIZON_LABELS[h]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  marginBottom: 4,
                  letterSpacing: '0.05em',
                }}
              >
                Target date (optional)
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                style={inp}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 14,
              }}
            >
              <button className="life-btn" onClick={() => setComposerOpen(false)}>
                Cancel
              </button>
              <button className="life-btn primary" onClick={submit}>
                {editing ? 'Save changes' : 'Set goal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </LifeLayout>
  )
}

const inp: React.CSSProperties = {
  width: '100%',
  padding: 10,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '0.92rem',
  fontFamily: 'inherit',
  outline: 'none',
  marginBottom: 10,
  boxSizing: 'border-box',
}

export default GoalsPage
