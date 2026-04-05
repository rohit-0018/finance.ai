import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import {
  dbGetUserTopics,
  dbUpsertUserTopic,
  dbDeleteUserTopic,
  dbGetBriefs,
  dbSaveBrief,
  dbGetPapers,
  dbToggleBriefRead,
} from '../lib/supabase'
import { generateDailyBrief } from '../lib/anthropic'
import { useStats } from '../hooks/useSaved'
import type { UserTopic, DailyBrief, Paper } from '../types'
import { TOPICS, formatRelative, truncate } from '../lib/utils'
import TagPill from '../components/TagPill'
import toast from 'react-hot-toast'

const RATING_LABELS = ['', 'Low', 'Some', 'Medium', 'High', 'Must-read']

const InterestsPage: React.FC = () => {
  const navigate = useNavigate()
  const userId = useAppStore((s) => s.currentUser?.id)
  const { data: stats } = useStats()
  const [topics, setTopics] = useState<UserTopic[]>([])
  const [briefs, setBriefs] = useState<DailyBrief[]>([])
  const [topicPapers, setTopicPapers] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)
  const [briefLoading, setBriefLoading] = useState(false)
  const [customTopic, setCustomTopic] = useState('')
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [loadingPapers, setLoadingPapers] = useState(false)
  const [expandedBrief, setExpandedBrief] = useState<string | null>(null)
  const [briefProgress, setBriefProgress] = useState('')
  const [briefFilter, setBriefFilter] = useState<'unread' | 'read' | 'all'>('unread')

  useEffect(() => {
    if (!userId) return
    Promise.all([dbGetUserTopics(userId), dbGetBriefs(userId)]).then(([t, b]) => {
      setTopics(t)
      setBriefs(b)
      setLoading(false)
    })
  }, [userId])

  // Load papers when a topic is selected
  useEffect(() => {
    if (!activeTopic) { setTopicPapers([]); return }
    setLoadingPapers(true)
    dbGetPapers({ topic: activeTopic, limit: 20, offset: 0 })
      .then(setTopicPapers)
      .finally(() => setLoadingPapers(false))
  }, [activeTopic])

  const handleRate = useCallback(async (topic: string, rating: number) => {
    if (!userId) return
    try {
      const saved = await dbUpsertUserTopic(userId, topic, rating)
      setTopics((prev) => {
        const exists = prev.find((t) => t.topic === topic)
        return exists ? prev.map((t) => (t.topic === topic ? saved : t)) : [...prev, saved]
      })
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
  }, [userId])

  const handleRemove = useCallback(async (id: string, topic: string) => {
    if (!userId) return
    try {
      await dbDeleteUserTopic(userId, id)
      setTopics((prev) => prev.filter((t) => t.id !== id))
      if (activeTopic === topic) setActiveTopic(null)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
  }, [userId, activeTopic])

  const handleAddCustom = useCallback(() => {
    if (!customTopic.trim()) return
    handleRate(customTopic.trim(), 3)
    setCustomTopic('')
  }, [customTopic, handleRate])

  const handleGenerateBrief = useCallback(async () => {
    if (!userId || topics.length === 0) { toast.error('Add some topics first'); return }
    setBriefLoading(true)
    setBriefProgress('Loading sources...')
    try {
      const topicNames = topics.sort((a, b) => b.rating - a.rating).map((t) => t.topic)
      const papers = await dbGetPapers({ limit: 40, offset: 0 })
      const briefContent = await generateDailyBrief(
        topicNames,
        papers.map((p) => ({ title: p.title, finding: p.finding, topic: p.topic, problem: p.problem, method: p.method, abstract: p.abstract })),
        setBriefProgress
      )
      const saved = await dbSaveBrief({ userId, content: briefContent, topics: topicNames, paperCount: papers.length })
      setBriefs((prev) => [saved, ...prev])
      setExpandedBrief(saved.id)
      toast.success('Brief generated!')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setBriefLoading(false); setBriefProgress('') }
  }, [userId, topics])

  const handleToggleRead = useCallback(async (briefId: string, currentRead: boolean) => {
    try {
      await dbToggleBriefRead(briefId, !currentRead)
      setBriefs((prev) => prev.map((b) => b.id === briefId ? { ...b, read: !currentRead } : b))
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
  }, [])

  const suggestedTopics = TOPICS.filter((t) => t !== 'All' && !topics.find((ut) => ut.topic === t))

  if (loading) return <div className="loading-center">Loading...</div>

  return (
    <>
      <div className="page-header">
        <div className="page-title">My Interests</div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={handleGenerateBrief} disabled={briefLoading || topics.length === 0}>
            {briefLoading ? briefProgress || 'Generating...' : 'Intelligence Brief'}
          </button>
        </div>
      </div>

      <div className="int-layout">
        {/* Left: Topics */}
        <div className="int-sidebar">
          {/* Stats */}
          {stats && (
            <div className="int-stats">
              <div className="int-stat">
                <span className="int-stat-val" style={{ color: 'var(--accent)' }}>{stats.topicsFollowed}</span>
                <span className="int-stat-lbl">Topics</span>
              </div>
              <div className="int-stat">
                <span className="int-stat-val" style={{ color: 'var(--green)' }}>{stats.streak}</span>
                <span className="int-stat-lbl">Read</span>
              </div>
              <div className="int-stat">
                <span className="int-stat-val" style={{ color: 'var(--amber)' }}>{stats.totalNotes}</span>
                <span className="int-stat-lbl">Notes</span>
              </div>
            </div>
          )}

          {/* Your topics */}
          <div className="int-section-label">Your Topics</div>
          {topics.length === 0 && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text3)', padding: '0 4px' }}>No topics yet. Add below.</p>
          )}
          <div className="int-topic-list">
            {topics.map((ut) => (
              <div
                key={ut.id}
                className={`int-topic ${activeTopic === ut.topic ? 'active' : ''}`}
                onClick={() => setActiveTopic(activeTopic === ut.topic ? null : ut.topic)}
              >
                <div className="int-topic-main">
                  <span className="int-topic-name">{ut.topic}</span>
                  <span className="int-topic-rating">
                    {'★'.repeat(ut.rating)}{'☆'.repeat(5 - ut.rating)}
                  </span>
                </div>
                <div className="int-topic-actions" onClick={(e) => e.stopPropagation()}>
                  <span className="int-topic-level">{RATING_LABELS[ut.rating]}</span>
                  <div className="int-star-row">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button key={s} className={`star-btn-sm ${s <= ut.rating ? 'active' : ''}`} onClick={() => handleRate(ut.topic, s)}>★</button>
                    ))}
                  </div>
                  <button className="int-remove" onClick={() => handleRemove(ut.id, ut.topic)}>×</button>
                </div>
              </div>
            ))}
          </div>

          {/* Add topic */}
          <div className="int-section-label" style={{ marginTop: '16px' }}>Add Topics</div>
          {suggestedTopics.length > 0 && (
            <div className="int-suggest">
              {suggestedTopics.map((t) => (
                <button key={t} className="int-suggest-chip" onClick={() => handleRate(t, 3)}>+ {t}</button>
              ))}
            </div>
          )}
          <div className="int-add-row">
            <input type="text" placeholder="Custom topic..." value={customTopic} onChange={(e) => setCustomTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()} />
            <button className="btn btn-sm btn-primary" onClick={handleAddCustom} disabled={!customTopic.trim()}>Add</button>
          </div>
        </div>

        {/* Right: Content */}
        <div className="int-content">
          {/* Topic papers */}
          {activeTopic && (
            <div className="int-panel">
              <div className="int-panel-header">
                <h3>{activeTopic}</h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>{topicPapers.length} papers</span>
              </div>
              {loadingPapers ? (
                <div className="loading-center">Loading...</div>
              ) : topicPapers.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '0.85rem' }}>
                  No papers in this topic yet. Fetch some from the Feed page.
                </div>
              ) : (
                <div className="int-paper-list">
                  {topicPapers.map((p) => (
                    <div key={p.id} className="int-paper" onClick={() => navigate(`/reader/${p.id}`)}>
                      <div className="int-paper-top">
                        <TagPill label={p.source} source />
                        {p.analysis && <span className="al-card-badge analyzed">Deep Read</span>}
                      </div>
                      <div className="int-paper-title">{p.title}</div>
                      {p.finding && <div className="int-paper-finding">{truncate(p.finding, 120)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Briefs */}
          {!activeTopic && (
            <div className="int-panel">
              <div className="int-panel-header">
                <h3>Intelligence Briefs</h3>
                <div className="bf-filter-bar">
                  {(['unread', 'all', 'read'] as const).map((f) => (
                    <button
                      key={f}
                      className={`bf-filter-btn ${briefFilter === f ? 'active' : ''}`}
                      onClick={() => setBriefFilter(f)}
                    >
                      {f === 'unread' ? `Unread (${briefs.filter((b) => !b.read).length})` : f === 'read' ? `Read (${briefs.filter((b) => b.read).length})` : `All (${briefs.length})`}
                    </button>
                  ))}
                </div>
              </div>

              {briefs.length === 0 ? (
                <div className="bf-empty">
                  <div className="bf-empty-icon">📡</div>
                  <div className="bf-empty-title">No briefs yet</div>
                  <div className="bf-empty-desc">
                    Add topics and click "Intelligence Brief" to generate a 3-pass editorial analysis of recent research.
                  </div>
                </div>
              ) : (
                <div className="bf-scroll">
                  {briefs
                    .filter((b) => briefFilter === 'all' ? true : briefFilter === 'read' ? b.read : !b.read)
                    .map((brief) => {
                      const isExpanded = expandedBrief === brief.id
                      return (
                        <div key={brief.id} className={`bf-card ${brief.read ? 'is-read' : ''} ${isExpanded ? 'is-expanded' : ''}`}>
                          {/* Header row */}
                          <div className="bf-card-header" onClick={() => setExpandedBrief(isExpanded ? null : brief.id)}>
                            <button
                              className={`bf-check ${brief.read ? 'checked' : ''}`}
                              onClick={(e) => { e.stopPropagation(); handleToggleRead(brief.id, brief.read) }}
                              title={brief.read ? 'Mark as unread' : 'Mark as read'}
                            >
                              {brief.read ? '✓' : ''}
                            </button>
                            <div className="bf-card-info">
                              <div className="bf-card-date">
                                {formatRelative(brief.created_at)}
                                {brief.read && <span className="bf-read-badge">Read</span>}
                              </div>
                              <div className="bf-card-meta">
                                {brief.paper_count} sources · 3-pass synthesis
                              </div>
                            </div>
                            <div className="bf-card-topics">
                              {(brief.topics as string[]).slice(0, 3).map((t) => (
                                <TagPill key={t} label={t} />
                              ))}
                            </div>
                            <span className="bf-toggle">{isExpanded ? '−' : '+'}</span>
                          </div>

                          {/* Expanded body */}
                          {isExpanded && (
                            <div className="bf-card-body">
                              <div
                                className="bf-prose"
                                dangerouslySetInnerHTML={{ __html: brief.content }}
                              />
                              <div className="bf-card-footer">
                                <button
                                  className="btn btn-sm"
                                  onClick={() => handleToggleRead(brief.id, brief.read)}
                                >
                                  {brief.read ? 'Mark unread' : 'Mark as read'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}

                  {briefs.filter((b) => briefFilter === 'all' ? true : briefFilter === 'read' ? b.read : !b.read).length === 0 && (
                    <div className="bf-empty" style={{ padding: '40px 0' }}>
                      <div className="bf-empty-desc">
                        No {briefFilter} briefs.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default InterestsPage
