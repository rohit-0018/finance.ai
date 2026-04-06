import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import QuickAddBar from '../components/QuickAddBar'
import { useLifeStore } from '../store'
import {
  getProject,
  listTasksForProject,
  updateTaskStatus,
  listPulses,
  savePulse,
  listJournalEntries,
  setProjectHealth,
  createNotification,
  createTask,
} from '../lib/db'
import { generatePulse } from '../lib/agent'
import type { LifeProject, LifeTask, LifeProjectPulse, LifeStake } from '../types'
import { localTime } from '../lib/time'
import DropModal from '../components/DropModal'
import { listStakes, createStake, resolveStake } from '../lib/db'

const ProjectDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const setAgentProject = useLifeStore((s) => s.setAgentProject)
  const setAgentOpen = useLifeStore((s) => s.setAgentOpen)

  const [project, setProject] = useState<LifeProject | null>(null)
  const [tasks, setTasks] = useState<LifeTask[]>([])
  const [pulses, setPulses] = useState<LifeProjectPulse[]>([])
  const [stakes, setStakes] = useState<LifeStake[]>([])
  const [generating, setGenerating] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [dropTarget, setDropTarget] = useState<{ kind: 'task' | 'project'; id: string; title: string } | null>(null)
  const [showStakeForm, setShowStakeForm] = useState(false)
  const [stakeDesc, setStakeDesc] = useState('')
  const [stakeKind, setStakeKind] = useState<'money' | 'social' | 'forfeit'>('money')
  const [stakeAmount, setStakeAmount] = useState<number>(20)

  const load = useCallback(async () => {
    if (!lifeUser || !id) return
    const [p, t, pl, st] = await Promise.all([
      getProject(lifeUser.id, id),
      listTasksForProject(lifeUser.id, id),
      listPulses(lifeUser.id, id),
      listStakes(lifeUser.id),
    ])
    setProject(p)
    setTasks(t)
    setPulses(pl)
    setStakes(st.filter((s) => s.project_id === id))
  }, [lifeUser, id])

  useEffect(() => {
    load()
  }, [load])

  // Sync agent dock scope to this project
  useEffect(() => {
    if (project) setAgentProject(project)
    return () => {
      // unset on unmount so global pages get global scope
      setAgentProject(null)
    }
  }, [project, setAgentProject])

  const toggle = async (task: LifeTask) => {
    if (!lifeUser) return
    await updateTaskStatus(lifeUser.id, task.id, task.status === 'done' ? 'todo' : 'done')
    load()
  }

  const runPulse = async () => {
    if (!lifeUser || !project) return
    setGenerating(true)
    try {
      const recentJournal = await listJournalEntries(lifeUser.id, 7)
      const draft = await generatePulse({
        project,
        recentTasks: tasks,
        recentPulses: pulses,
        recentJournal,
      })
      await savePulse({
        userId: lifeUser.id,
        projectId: project.id,
        last_progress: draft.last_progress,
        next_step: draft.next_step,
        whats_missing: draft.whats_missing,
        risk: draft.risk,
        health: draft.health,
        suggested_tasks: draft.suggested_tasks,
        raw: draft,
      })
      if (draft.health !== project.health) {
        await setProjectHealth(lifeUser.id, project.id, draft.health)
      }
      try {
        await createNotification({
          userId: lifeUser.id,
          kind: 'pulse_ready',
          title: `Pulse: ${project.name}`,
          body: draft.next_step || 'New pulse generated.',
          link: `/life/projects/${project.id}`,
        })
      } catch {/* ignore */}
      load()
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Pulse failed: ${(err as Error).message}`)
    } finally {
      setGenerating(false)
    }
  }

  const acceptSuggested = async (s: { title: string; estimate_min?: number; priority?: number }) => {
    if (!lifeUser || !project) return
    await createTask({
      userId: lifeUser.id,
      title: s.title,
      project_id: project.id,
      priority: s.priority ?? 3,
      estimate_min: s.estimate_min ?? null,
      source: 'agent',
    })
    load()
  }

  if (!project) {
    return (
      <LifeLayout title="Project">
        <div className="life-empty"><p>Loading…</p></div>
      </LifeLayout>
    )
  }

  const latestPulse = pulses[0]

  return (
    <LifeLayout title={project.name}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="life-btn" onClick={() => navigate('/life/projects')}>← back</button>
        <span className={`life-pill ${project.category}`}>{project.category}</span>
        <span className={`life-pill ${project.health}`}>{project.health}</span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>status: {project.status}</span>
        <div style={{ flex: 1 }} />
        <button className="life-btn primary" onClick={runPulse} disabled={generating}>
          {generating ? 'Generating…' : 'Run pulse'}
        </button>
        <button className="life-btn" onClick={() => { setAgentProject(project); setAgentOpen(true) }}>
          Open copilot
        </button>
        {project.status === 'active' && (
          <button
            className="life-btn"
            onClick={() => setDropTarget({ kind: 'project', id: project.id, title: project.name })}
            title={project.contract_mode ? 'Contract mode — drop with reason required' : 'Drop project'}
          >
            Drop
          </button>
        )}
      </div>

      {project.description && (
        <p style={{ color: 'var(--text-muted, #888)', fontSize: '0.88rem', lineHeight: 1.55, marginBottom: 22 }}>
          {project.description}
        </p>
      )}

      {latestPulse && (
        <div className="life-pulse">
          <h3>Latest pulse · {localTime(latestPulse.created_at)}</h3>
          {latestPulse.last_progress && (
            <div className="life-pulse-row"><strong>Progress</strong><p>{latestPulse.last_progress}</p></div>
          )}
          {latestPulse.next_step && (
            <div className="life-pulse-row"><strong>Next step</strong><p>{latestPulse.next_step}</p></div>
          )}
          {latestPulse.whats_missing && (
            <div className="life-pulse-row"><strong>What's missing</strong><p>{latestPulse.whats_missing}</p></div>
          )}
          {latestPulse.risk && (
            <div className="life-pulse-row"><strong>Risk</strong><p>{latestPulse.risk}</p></div>
          )}
          {latestPulse.suggested_tasks?.length > 0 && (
            <div className="life-pulse-row">
              <strong>Suggested tasks</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {latestPulse.suggested_tasks.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, fontSize: '0.85rem' }}>{s.title}</span>
                    <button className="life-btn" onClick={() => acceptSuggested(s)}>+ add</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <QuickAddBar onCreated={load} defaultProjectId={project.id} />

      <div className="life-section">
        <h2>Tasks ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <div className="life-empty"><p>No tasks yet for this project.</p></div>
        ) : (
          tasks.map((t) => {
            const done = t.status === 'done'
            return (
              <div key={t.id} className={`life-task-row ${done ? 'done' : ''}`}>
                <div className={`check ${done ? 'done' : ''}`} onClick={() => toggle(t)}>
                  {done && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <div className="title">{t.title}</div>
                <div className="meta">
                  {t.priority <= 2 && <span className={`pri-${t.priority}`}>P{t.priority}</span>}
                  {t.scheduled_for && <span>{t.scheduled_for}</span>}
                  {t.source === 'agent' && <span>↳ agent</span>}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Stakes */}
      <div className="life-section">
        <h2>Stakes</h2>
        {stakes.length === 0 && !showStakeForm && (
          <div className="life-empty">
            <p>No stakes on this project. Want to put something real on the line?</p>
            <button className="life-btn" onClick={() => setShowStakeForm(true)}>
              + Attach a stake
            </button>
          </div>
        )}
        {stakes.map((s) => (
          <div key={s.id} className="life-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`life-pill ${s.status}`}>{s.status}</span>
            <span style={{ flex: 1 }}>{s.description}</span>
            {s.amount_cents && <span>${(s.amount_cents / 100).toFixed(0)}</span>}
            {s.status === 'pending' && lifeUser && (
              <>
                <button
                  className="life-btn"
                  onClick={async () => {
                    await resolveStake(lifeUser.id, s.id, 'honored')
                    load()
                  }}
                >
                  Honored
                </button>
                <button
                  className="life-btn"
                  onClick={async () => {
                    await resolveStake(lifeUser.id, s.id, 'paid')
                    load()
                  }}
                >
                  Paid
                </button>
              </>
            )}
          </div>
        ))}
        {showStakeForm && (
          <div className="life-card">
            <h3>Attach stake</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select
                value={stakeKind}
                onChange={(e) => setStakeKind(e.target.value as 'money' | 'social' | 'forfeit')}
                className="life-select"
              >
                <option value="money">money</option>
                <option value="social">social</option>
                <option value="forfeit">forfeit</option>
              </select>
              {stakeKind === 'money' && (
                <input
                  type="number"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(Number(e.target.value))}
                  style={{
                    width: 100,
                    padding: 8,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--bg)',
                    color: 'var(--text)',
                  }}
                />
              )}
            </div>
            <input
              value={stakeDesc}
              onChange={(e) => setStakeDesc(e.target.value)}
              placeholder="describe the stake (e.g. $20 to charity if missed)"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 10,
                marginBottom: 8,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '0.88rem',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="life-btn primary"
                onClick={async () => {
                  if (!lifeUser || !project || !stakeDesc.trim()) return
                  await createStake({
                    userId: lifeUser.id,
                    projectId: project.id,
                    kind: stakeKind,
                    amountCents: stakeKind === 'money' ? stakeAmount * 100 : undefined,
                    description: stakeDesc.trim(),
                  })
                  setStakeDesc('')
                  setShowStakeForm(false)
                  load()
                }}
              >
                Save stake
              </button>
              <button className="life-btn" onClick={() => setShowStakeForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {dropTarget && lifeUser && (
        <DropModal
          userId={lifeUser.id}
          kind={dropTarget.kind as 'task' | 'project'}
          refId={dropTarget.id}
          title={dropTarget.title}
          onClose={() => setDropTarget(null)}
          onDropped={() => {
            setDropping(false)
            if (dropTarget.kind === 'project') navigate('/life/projects')
            else load()
          }}
        />
      )}

      {pulses.length > 1 && (
        <div className="life-section">
          <h2>Pulse history</h2>
          {pulses.slice(1).map((p) => (
            <div key={p.id} className="life-card">
              <div className="life-card-meta">
                <span>{localTime(p.created_at)}</span>
                <span className={`life-pill ${p.health}`}>{p.health}</span>
              </div>
              {p.next_step && <p style={{ marginTop: 6, fontSize: '0.85rem' }}>{p.next_step}</p>}
            </div>
          ))}
        </div>
      )}
    </LifeLayout>
  )
}

export default ProjectDetailPage
