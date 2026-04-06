import React, { useCallback, useEffect, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { listGoals, createGoal, updateGoal, deleteGoal } from '../lib/db'
import type { LifeGoal, LifeCategory } from '../types'

const CATS: LifeCategory[] = ['office', 'personal', 'health', 'learn']
const HORIZONS: Array<'quarter' | 'year' | 'life'> = ['quarter', 'year', 'life']

const GoalsPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [goals, setGoals] = useState<LifeGoal[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [why, setWhy] = useState('')
  const [category, setCategory] = useState<LifeCategory>('personal')
  const [horizon, setHorizon] = useState<'quarter' | 'year' | 'life'>('quarter')

  const load = useCallback(async () => {
    if (!lifeUser) return
    setGoals(await listGoals(lifeUser.id))
  }, [lifeUser])

  useEffect(() => {
    load()
  }, [load])

  const submit = async () => {
    if (!lifeUser || !title.trim()) return
    await createGoal({ userId: lifeUser.id, title: title.trim(), why, category, horizon })
    setTitle(''); setWhy(''); setCategory('personal'); setHorizon('quarter')
    setShowForm(false)
    load()
  }

  const toggleStatus = async (g: LifeGoal) => {
    if (!lifeUser) return
    const next = g.status === 'done' ? 'active' : 'done'
    await updateGoal(lifeUser.id, g.id, { status: next })
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ margin: 0, color: 'var(--text-muted, #888)', fontSize: '0.85rem' }}>
          {goals.filter((g) => g.status === 'active').length} active · {goals.length} total
        </p>
        <button className="life-btn primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New goal'}
        </button>
      </div>

      {showForm && (
        <div className="life-card" style={{ marginBottom: 20 }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Goal title"
            style={{ width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', marginBottom: 10, fontSize: '0.95rem', outline: 'none' }}
          />
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Why does this matter?"
            style={{ width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', minHeight: 70, marginBottom: 10, fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {CATS.map((c) => (
              <button key={c} className={`life-pill ${category === c ? c : ''}`} onClick={() => setCategory(c)} style={{ cursor: 'pointer', border: 'none' }}>
                {c}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {HORIZONS.map((h) => (
              <button key={h} className={`life-btn ${horizon === h ? 'primary' : ''}`} onClick={() => setHorizon(h)}>
                {h}
              </button>
            ))}
          </div>
          <button className="life-btn primary" onClick={submit}>Create</button>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="life-empty">
          <h3>No goals yet</h3>
          <p>Set one to anchor your daily work.</p>
        </div>
      ) : (
        goals.map((g) => (
          <div key={g.id} className="life-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="life-card-title" style={{ textDecoration: g.status === 'done' ? 'line-through' : 'none' }}>
                  {g.title}
                </div>
                <div className="life-card-meta">
                  <span className={`life-pill ${g.category}`}>{g.category}</span>
                  <span>{g.horizon}</span>
                  <span>status: {g.status}</span>
                </div>
                {g.why && (
                  <p style={{ margin: '8px 0 0', fontSize: '0.83rem', color: 'var(--text-muted, #888)' }}>
                    {g.why}
                  </p>
                )}
              </div>
              <button className="life-btn" onClick={() => toggleStatus(g)}>
                {g.status === 'done' ? 'Reopen' : 'Mark done'}
              </button>
              <button className="life-btn danger" onClick={() => remove(g)}>Delete</button>
            </div>
          </div>
        ))
      )}
    </LifeLayout>
  )
}

export default GoalsPage
