import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { listProjects, createProject } from '../lib/db'
import type { LifeProject, LifeCategory } from '../types'

const CATS: LifeCategory[] = ['office', 'personal', 'health', 'learn']

const ProjectsPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<LifeCategory>('personal')

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      setProjects(await listProjects(lifeUser.id))
    } finally {
      setLoading(false)
    }
  }, [lifeUser])

  useEffect(() => {
    load()
  }, [load])

  const submit = async () => {
    if (!lifeUser || !name.trim()) return
    await createProject({ userId: lifeUser.id, name: name.trim(), description, category })
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
