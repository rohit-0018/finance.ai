import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  projectFinishRate,
  listGoals,
} from '../lib/db'
import type { LifeProject, LifeCategory, LifeHealth, LifeStatus, LifeGoal } from '../types'

const CATS: LifeCategory[] = ['office', 'personal', 'health', 'learn']
const HEALTHS: LifeHealth[] = ['green', 'yellow', 'red']
const STATUSES: LifeStatus[] = ['active', 'paused', 'done', 'dropped']

// Extra project metadata stored under LifeProject.context to avoid schema
// migrations. Each field is optional and the rest of the app keeps working
// even if `context` is missing or shaped differently.
interface ProjectMeta {
  target_date?: string | null
  owner?: string | null
  success_metric?: string | null
  milestones?: Array<{ id: string; title: string; done: boolean; target_date?: string | null }>
  links?: string[]
}

function readMeta(p: LifeProject): ProjectMeta {
  const c = (p.context ?? {}) as ProjectMeta
  return {
    target_date: c.target_date ?? null,
    owner: c.owner ?? null,
    success_metric: c.success_metric ?? null,
    milestones: Array.isArray(c.milestones) ? c.milestones : [],
    links: Array.isArray(c.links) ? c.links : [],
  }
}

function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null
  const target = new Date(`${date}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

type Group = 'all' | LifeStatus

const ProjectsPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [goals, setGoals] = useState<LifeGoal[]>([])
  const [rates, setRates] = useState<Map<string, { rate: number; done: number; open: number }>>(
    new Map()
  )
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Group>('active')
  const [search, setSearch] = useState('')

  // Composer (create or edit)
  const [editing, setEditing] = useState<LifeProject | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<LifeCategory>('personal')
  const [health, setHealth] = useState<LifeHealth>('green')
  const [status, setStatus] = useState<LifeStatus>('active')
  const [targetDate, setTargetDate] = useState('')
  const [owner, setOwner] = useState('')
  const [successMetric, setSuccessMetric] = useState('')
  const [definitionOfDone, setDefinitionOfDone] = useState('')
  const [goalId, setGoalId] = useState<string>('')
  const [milestonesText, setMilestonesText] = useState('')

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      const list = await listProjects(lifeUser.id, activeWorkspace?.id)
      setProjects(list)
      const gls = await listGoals(lifeUser.id, activeWorkspace?.id)
      setGoals(gls)
      const entries = await Promise.all(
        list.map(async (p) => {
          const r = await projectFinishRate(lifeUser.id, p.id).catch(() => ({
            rate: 0,
            done: 0,
            open: 0,
          }))
          return [p.id, r] as const
        })
      )
      const map = new Map<string, { rate: number; done: number; open: number }>()
      for (const [id, r] of entries) map.set(id, r)
      setRates(map)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, activeWorkspace?.id])

  useEffect(() => {
    load()
  }, [load])

  const reset = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setCategory('personal')
    setHealth('green')
    setStatus('active')
    setTargetDate('')
    setOwner('')
    setSuccessMetric('')
    setDefinitionOfDone('')
    setGoalId('')
    setMilestonesText('')
  }

  const openCreate = () => {
    reset()
    setComposerOpen(true)
  }

  const openEdit = (p: LifeProject) => {
    const meta = readMeta(p)
    setEditing(p)
    setName(p.name)
    setDescription(p.description ?? '')
    setCategory(p.category)
    setHealth(p.health)
    setStatus(p.status)
    setTargetDate(meta.target_date ?? '')
    setOwner(meta.owner ?? '')
    setSuccessMetric(meta.success_metric ?? '')
    setDefinitionOfDone(p.definition_of_done ?? '')
    setGoalId(p.goal_id ?? '')
    setMilestonesText((meta.milestones ?? []).map((m) => `${m.done ? '[x]' : '[ ]'} ${m.title}`).join('\n'))
    setComposerOpen(true)
  }

  const submit = async () => {
    if (!lifeUser || !name.trim()) return
    const milestones = milestonesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const done = /^\[x\]/i.test(line)
        const title = line.replace(/^\[[ x]\]\s*/i, '')
        return { id: `m_${Date.now()}_${i}`, title, done }
      })
    const meta: ProjectMeta = {
      target_date: targetDate || null,
      owner: owner.trim() || null,
      success_metric: successMetric.trim() || null,
      milestones,
    }
    if (editing) {
      await updateProject(lifeUser.id, editing.id, {
        name: name.trim(),
        description: description || null,
        category,
        health,
        status,
        goal_id: goalId || null,
        definition_of_done: definitionOfDone || null,
        context: { ...(editing.context ?? {}), ...meta },
      })
    } else {
      const created = await createProject({
        userId: lifeUser.id,
        workspaceId: activeWorkspace?.id,
        name: name.trim(),
        description,
        category,
        goal_id: goalId || null,
        definition_of_done: definitionOfDone || null,
      })
      // Persist extras (createProject doesn't accept context yet)
      if (Object.values(meta).some((v) => v != null && (Array.isArray(v) ? v.length : true))) {
        await updateProject(lifeUser.id, created.id, { context: meta as Record<string, unknown> })
      }
    }
    setComposerOpen(false)
    reset()
    load()
  }

  const archive = async (p: LifeProject) => {
    if (!lifeUser) return
    if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return
    await deleteProject(lifeUser.id, p.id)
    load()
  }

  const advanceStatus = async (p: LifeProject, next: LifeStatus) => {
    if (!lifeUser) return
    await updateProject(lifeUser.id, p.id, { status: next })
    load()
  }

  const visible = useMemo(() => {
    let rows = projects
    if (filter !== 'all') rows = rows.filter((p) => p.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q) ||
          readMeta(p).owner?.toLowerCase().includes(q)
      )
    }
    return rows
  }, [projects, filter, search])

  return (
    <LifeLayout title="Projects">
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted, #888)', fontSize: '0.85rem' }}>
        Projects are <strong>units of execution</strong>. They have owners, deadlines, milestones,
        and a definition of done. Link them to a goal to know <em>why</em> they exist.
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        {(['active', 'paused', 'done', 'all'] as Group[]).map((g) => (
          <button
            key={g}
            className={`life-btn ${filter === g ? 'primary' : ''}`}
            onClick={() => setFilter(g)}
            style={{ textTransform: 'capitalize' }}
          >
            {g}
          </button>
        ))}
        <input
          className="life-search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: 280 }}
        />
        <button className="life-btn primary" onClick={openCreate}>
          + New project
        </button>
      </div>

      {loading && projects.length === 0 ? (
        <div className="life-empty">
          <p>Loading…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="life-empty">
          <h3>No projects {filter !== 'all' ? `in ${filter}` : ''}</h3>
          <p>Create one to start tracking work.</p>
        </div>
      ) : (
        visible.map((p) => {
          const meta = readMeta(p)
          const r = rates.get(p.id)
          const taskRate = r && r.done + r.open > 0 ? r.rate : 0
          const milestoneTotal = meta.milestones?.length ?? 0
          const milestoneDone = (meta.milestones ?? []).filter((m) => m.done).length
          const milestoneRate = milestoneTotal > 0 ? milestoneDone / milestoneTotal : 0
          // Combined progress: milestones if present, else task finish rate.
          const progress = milestoneTotal > 0 ? milestoneRate : taskRate
          const days = daysUntil(meta.target_date)
          const goalName = goals.find((g) => g.id === p.goal_id)?.title ?? null
          return (
            <div key={p.id} className="life-card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <div
                  style={{ flex: 1, cursor: 'pointer' }}
                  onClick={() => navigate(`/life/projects/${p.id}`)}
                >
                  <div className="life-card-title">{p.name}</div>
                  {p.description && (
                    <p
                      style={{
                        margin: '6px 0',
                        fontSize: '0.85rem',
                        color: 'var(--text-muted, #888)',
                      }}
                    >
                      {p.description}
                    </p>
                  )}
                  <div className="life-card-meta" style={{ flexWrap: 'wrap' }}>
                    <span className={`life-pill ${p.category}`}>{p.category}</span>
                    <span className={`life-pill ${p.health}`}>{p.health}</span>
                    <span>status: {p.status}</span>
                    {meta.owner && <span>👤 {meta.owner}</span>}
                    {goalName && <span title="Linked goal">🎯 {goalName}</span>}
                    {days != null && (
                      <span
                        style={{
                          color:
                            days < 0
                              ? '#ef4444'
                              : days <= 7
                              ? '#f59e0b'
                              : 'var(--text-muted)',
                        }}
                      >
                        {days < 0
                          ? `${-days}d overdue`
                          : days === 0
                          ? 'due today'
                          : `${days}d left`}
                      </span>
                    )}
                    {milestoneTotal > 0 && (
                      <span>
                        {milestoneDone}/{milestoneTotal} milestones
                      </span>
                    )}
                    {r && r.done + r.open > 0 && (
                      <span>
                        {r.done}/{r.done + r.open} tasks
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div
                    style={{
                      marginTop: 10,
                      height: 6,
                      background: 'var(--border)',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round(progress * 100)}%`,
                        height: '100%',
                        background:
                          progress >= 0.7
                            ? '#10b981'
                            : progress >= 0.4
                            ? '#f59e0b'
                            : 'var(--accent)',
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>

                  {meta.success_metric && (
                    <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      <strong>Metric:</strong> {meta.success_metric}
                    </div>
                  )}
                  {p.definition_of_done && (
                    <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      <strong>Done when:</strong> {p.definition_of_done}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button className="life-btn" onClick={() => openEdit(p)}>
                    Edit
                  </button>
                  {p.status === 'active' && (
                    <button className="life-btn" onClick={() => advanceStatus(p, 'paused')}>
                      Pause
                    </button>
                  )}
                  {p.status === 'paused' && (
                    <button className="life-btn" onClick={() => advanceStatus(p, 'active')}>
                      Resume
                    </button>
                  )}
                  {p.status !== 'done' && (
                    <button className="life-btn" onClick={() => advanceStatus(p, 'done')}>
                      Mark done
                    </button>
                  )}
                  <button className="life-btn danger" onClick={() => archive(p)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
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
            style={{ width: 600, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div className="life-card-title">{editing ? 'Edit project' : 'New project'}</div>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              style={inp}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project? Who is it for?"
              style={{ ...inp, minHeight: 60 }}
            />

            <Field label="Linked goal (optional)">
              <select
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                style={inp}
              >
                <option value="">— none —</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
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

            <Field label="Health">
              <div style={{ display: 'flex', gap: 6 }}>
                {HEALTHS.map((h) => (
                  <button
                    key={h}
                    className={`life-pill ${health === h ? h : ''}`}
                    onClick={() => setHealth(h)}
                    style={{ cursor: 'pointer', border: 'none' }}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Status">
              <div style={{ display: 'flex', gap: 6 }}>
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    className={`life-btn ${status === s ? 'primary' : ''}`}
                    onClick={() => setStatus(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>

            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Target date">
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  style={inp}
                />
              </Field>
              <Field label="Owner">
                <input
                  type="text"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="who's responsible?"
                  style={inp}
                />
              </Field>
            </div>

            <Field label="Success metric">
              <input
                type="text"
                value={successMetric}
                onChange={(e) => setSuccessMetric(e.target.value)}
                placeholder="how do you measure success? e.g. '100 paying users'"
                style={inp}
              />
            </Field>

            <Field label="Definition of done">
              <textarea
                value={definitionOfDone}
                onChange={(e) => setDefinitionOfDone(e.target.value)}
                placeholder="When can you say this is finished?"
                style={{ ...inp, minHeight: 50 }}
              />
            </Field>

            <Field label="Milestones (one per line, prefix with [x] for done)">
              <textarea
                value={milestonesText}
                onChange={(e) => setMilestonesText(e.target.value)}
                placeholder={'[x] Initial sketch\n[ ] First user test\n[ ] Launch'}
                style={{ ...inp, minHeight: 80, fontFamily: 'monospace', fontSize: '0.82rem' }}
              />
            </Field>

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
                {editing ? 'Save changes' : 'Create project'}
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
  padding: 8,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '0.88rem',
  fontFamily: 'inherit',
  outline: 'none',
  marginBottom: 10,
  boxSizing: 'border-box',
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ flex: 1, marginBottom: 4 }}>
    <label
      style={{
        display: 'block',
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {label}
    </label>
    {children}
  </div>
)

export default ProjectsPage
