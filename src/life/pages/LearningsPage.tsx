// Learnings — the spaced-repetition + 7-day action bridge for ideas you pick
// up. Three sections on one page:
//   1. Capture — one-sentence idea input at the top.
//   2. Due for review — SM-2 grade buttons (again / hard / good / easy).
//   3. 7-day queue — unarchived items within their action deadline; each has
//      "convert to task" and "archive as curiosity."
//
// This is the answer to failure mode 6 (forgetting what you learned).
import React, { useCallback, useEffect, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  listLearnings,
  createLearning,
  reviewLearning,
  archiveLearning,
  linkLearningToTask,
  createTask,
  listProjects,
} from '../lib/db'
import type { LifeLearning, LifeProject } from '../types'

const LearningsPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const [all, setAll] = useState<LifeLearning[]>([])
  const [projects, setProjects] = useState<LifeProject[]>([])
  const [content, setContent] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!lifeUser || !activeWorkspace) return
    setLoading(true)
    try {
      const [items, projs] = await Promise.all([
        listLearnings(lifeUser.id, { workspaceId: activeWorkspace.id, archived: false }),
        listProjects(lifeUser.id, activeWorkspace.id),
      ])
      setAll(items)
      setProjects(projs)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, activeWorkspace])

  useEffect(() => {
    load()
  }, [load])

  const capture = async () => {
    if (!lifeUser || !activeWorkspace || !content.trim()) return
    await createLearning({
      userId: lifeUser.id,
      workspaceId: activeWorkspace.id,
      content: content.trim(),
      source_url: sourceUrl.trim() || null,
    })
    setContent('')
    setSourceUrl('')
    await load()
  }

  const grade = async (id: string, g: number) => {
    if (!lifeUser) return
    await reviewLearning(lifeUser.id, id, g)
    await load()
  }

  const archive = async (id: string) => {
    if (!lifeUser) return
    await archiveLearning(lifeUser.id, id)
    await load()
  }

  const convert = async (learning: LifeLearning) => {
    if (!lifeUser || !activeWorkspace) return
    const projectId = projects[0]?.id // simplistic for now — pick first active
    const task = await createTask({
      userId: lifeUser.id,
      workspaceId: activeWorkspace.id,
      project_id: projectId ?? null,
      title: `Apply: ${learning.content.slice(0, 80)}`,
      notes: learning.source_url ?? undefined,
      priority: 3,
      source: 'agent',
    })
    await linkLearningToTask(lifeUser.id, learning.id, task.id)
    await load()
  }

  const now = Date.now()
  const dueReview = all.filter((l) => new Date(l.next_review_at).getTime() <= now)
  const awaitingAction = all.filter(
    (l) =>
      l.action_deadline &&
      !l.became_task_id &&
      new Date(l.action_deadline).getTime() >= now
  )
  const aging = all.filter(
    (l) =>
      l.action_deadline &&
      !l.became_task_id &&
      new Date(l.action_deadline).getTime() < now
  )

  return (
    <LifeLayout title="Learnings">
      {/* Capture */}
      <div className="life-card" style={{ marginBottom: 16 }}>
        <h3>Capture one idea</h3>
        <p className="life-empty-inline">
          One sentence. What's the idea worth remembering? No essays.
        </p>
        <textarea
          rows={2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="The idea…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: 10,
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: '0.9rem',
            fontFamily: 'inherit',
            marginBottom: 8,
          }}
        />
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="source URL (optional)"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: 8,
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: '0.8rem',
            marginBottom: 10,
          }}
        />
        <button className="life-btn primary" onClick={capture} disabled={!content.trim()}>
          Save
        </button>
      </div>

      {/* Due for review */}
      <div className="life-card" style={{ marginBottom: 16 }}>
        <h3>Due for review · {dueReview.length}</h3>
        {dueReview.length === 0 ? (
          <div className="life-empty-inline">Nothing due. Come back tomorrow.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dueReview.map((l) => (
              <LearningRow key={l.id} learning={l}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="life-btn" onClick={() => grade(l.id, 1)}>
                    Again
                  </button>
                  <button className="life-btn" onClick={() => grade(l.id, 3)}>
                    Hard
                  </button>
                  <button className="life-btn" onClick={() => grade(l.id, 4)}>
                    Good
                  </button>
                  <button className="life-btn primary" onClick={() => grade(l.id, 5)}>
                    Easy
                  </button>
                </div>
              </LearningRow>
            ))}
          </div>
        )}
      </div>

      {/* Awaiting action (within 7d window) */}
      <div className="life-card" style={{ marginBottom: 16 }}>
        <h3>Awaiting action · {awaitingAction.length}</h3>
        {awaitingAction.length === 0 ? (
          <div className="life-empty-inline">
            {loading ? 'Loading…' : 'Nothing pending conversion.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {awaitingAction.map((l) => (
              <LearningRow key={l.id} learning={l}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="life-btn" onClick={() => convert(l)}>
                    Convert to task
                  </button>
                  <button className="life-btn" onClick={() => archive(l.id)}>
                    Archive as curiosity
                  </button>
                </div>
              </LearningRow>
            ))}
          </div>
        )}
      </div>

      {/* Aged out — force decision */}
      {aging.length > 0 && (
        <div className="life-card" style={{ borderColor: 'rgba(217,119,6,0.45)' }}>
          <h3>Past 7 days · decide now · {aging.length}</h3>
          <p className="life-empty-inline">
            These sat for 7 days without turning into action. Convert or archive — no
            more limbo.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {aging.map((l) => (
              <LearningRow key={l.id} learning={l}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="life-btn primary" onClick={() => convert(l)}>
                    Convert
                  </button>
                  <button className="life-btn" onClick={() => archive(l.id)}>
                    Archive
                  </button>
                </div>
              </LearningRow>
            ))}
          </div>
        </div>
      )}
    </LifeLayout>
  )
}

const LearningRow: React.FC<{
  learning: LifeLearning
  children: React.ReactNode
}> = ({ learning, children }) => (
  <div
    style={{
      padding: 12,
      border: '1px solid var(--border)',
      borderRadius: 10,
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}
  >
    <div style={{ fontSize: '0.9rem', lineHeight: 1.45 }}>{learning.content}</div>
    {learning.source_url && (
      <a
        href={learning.source_url}
        target="_blank"
        rel="noreferrer"
        style={{ fontSize: '0.72rem', color: 'var(--text-muted, #888)' }}
      >
        {learning.source_url}
      </a>
    )}
    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted, #888)' }}>
      reviewed {learning.review_count}× · interval {learning.interval_days}d
    </div>
    {children}
  </div>
)

export default LearningsPage
