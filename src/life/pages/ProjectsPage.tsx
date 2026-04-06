import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { listProjects, createProject, projectFinishRate, createTask, listTasksForProject } from '../lib/db'
import type { LifeProject, LifeCategory } from '../types'
import { todayLocal } from '../lib/time'

const CATS: LifeCategory[] = ['office', 'personal', 'health', 'learn']

const ProjectsPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [rates, setRates] = useState<Map<string, { rate: number; done: number; open: number }>>(new Map())
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<LifeCategory>('personal')

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      const list = await listProjects(lifeUser.id, activeWorkspace?.id)
      setProjects(list)
      // Compute finish-rate + run the last-10% detector in parallel. Detector
      // pins a "ship it" task to today if a project has been stuck between 80%
      // and 95% done for 5+ days without an existing ship-it task.
      const entries = await Promise.all(
        list.map(async (p) => {
          const r = await projectFinishRate(lifeUser.id, p.id).catch(() => ({ rate: 0, done: 0, open: 0 }))
          return [p.id, r] as const
        })
      )
      const map = new Map<string, { rate: number; done: number; open: number }>()
      for (const [id, r] of entries) map.set(id, r)
      setRates(map)

      // Last-10% detector — best-effort, non-blocking.
      ;(async () => {
        if (!activeWorkspace) return
        const stuckThresholdMs = 5 * 24 * 60 * 60_000
        for (const p of list) {
          const r = map.get(p.id)
          if (!r || r.rate < 0.8 || r.rate >= 0.95) continue
          if (Date.now() - new Date(p.updated_at).getTime() < stuckThresholdMs) continue
          try {
            const tasks = await listTasksForProject(lifeUser.id, p.id, 20)
            const hasShipIt = tasks.some(
              (t) => /^ship it\b/i.test(t.title) && t.status !== 'done'
            )
            if (hasShipIt) continue
            await createTask({
              userId: lifeUser.id,
              workspaceId: activeWorkspace.id,
              project_id: p.id,
              title: `Ship it — ${p.name}`,
              notes: `Auto-created: project sat between 80–95% done for >5 days. Close out the last few items or drop them.`,
              priority: 1,
              scheduled_for: todayLocal(lifeUser.timezone),
              source: 'agent',
            })
          } catch {/* ignore */}
        }
      })()
    } finally {
      setLoading(false)
    }
  }, [lifeUser, activeWorkspace])

  useEffect(() => {
    load()
  }, [load])

  const submit = async () => {
    if (!lifeUser || !name.trim()) return
    await createProject({
      userId: lifeUser.id,
      workspaceId: activeWorkspace?.id,
      name: name.trim(),
      description,
      category,
    })
    setName('')
    setDescription('')
    setCategory('personal')
    setShowForm(false)
    load()
  }

  return (
    <LifeLayout title="Projects">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ margin: 0, color: 'var(--text-muted, #888)', fontSize: '0.85rem' }}>
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </p>
        <button className="life-btn primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New project'}
        </button>
      </div>

      {showForm && (
        <div className="life-card" style={{ marginBottom: 20 }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            style={{ width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', marginBottom: 10, fontSize: '0.95rem', outline: 'none' }}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project? Why does it exist?"
            style={{ width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', minHeight: 70, marginBottom: 10, fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
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
          <button className="life-btn primary" onClick={submit}>Create</button>
        </div>
      )}

      {loading && projects.length === 0 ? (
        <div className="life-empty"><p>Loading…</p></div>
      ) : projects.length === 0 ? (
        <div className="life-empty">
          <h3>No projects yet</h3>
          <p>Create one to start tracking work and pulses.</p>
        </div>
      ) : (
        projects.map((p) => (
          <div
            key={p.id}
            className="life-card"
            onClick={() => navigate(`/life/projects/${p.id}`)}
            style={{ cursor: 'pointer' }}
          >
            <div className="life-card-title">{p.name}</div>
            <div className="life-card-meta">
              <span className={`life-pill ${p.category}`}>{p.category}</span>
              <span className={`life-pill ${p.health}`}>{p.health}</span>
              <span>status: {p.status}</span>
              {(() => {
                const r = rates.get(p.id)
                if (!r || r.done + r.open === 0) return null
                const pct = Math.round(r.rate * 100)
                const cls = pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'bad'
                return (
                  <span
                    className={`life-align-pill ${cls}`}
                    title={`${r.done} done of ${r.done + r.open} tasks`}
                  >
                    finish {pct}%
                  </span>
                )
              })()}
            </div>
            {p.description && (
              <p style={{ margin: '8px 0 0', fontSize: '0.83rem', color: 'var(--text-muted, #888)' }}>
                {p.description}
              </p>
            )}
          </div>
        ))
      )}
    </LifeLayout>
  )
}

export default ProjectsPage
