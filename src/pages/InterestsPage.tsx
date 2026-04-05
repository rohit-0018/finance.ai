import React, { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '../store'
import {
  dbGetUserTopics,
  dbUpsertUserTopic,
  dbDeleteUserTopic,
  dbGetBriefs,
  dbSaveBrief,
  dbGetPapers,
} from '../lib/supabase'
import { generateDailyBrief } from '../lib/anthropic'
import { useStats } from '../hooks/useSaved'
import type { UserTopic, DailyBrief } from '../types'
import { TOPICS } from '../lib/utils'
import { formatRelative } from '../lib/utils'
import toast from 'react-hot-toast'

const RATING_LABELS = ['', 'Low', 'Some', 'Medium', 'High', 'Must-read']

const InterestsPage: React.FC = () => {
  const userId = useAppStore((s) => s.currentUser?.id)
  const { data: stats } = useStats()
  const [topics, setTopics] = useState<UserTopic[]>([])
  const [briefs, setBriefs] = useState<DailyBrief[]>([])
  const [loading, setLoading] = useState(true)
  const [briefLoading, setBriefLoading] = useState(false)
  const [customTopic, setCustomTopic] = useState('')

  useEffect(() => {
    if (!userId) return
    Promise.all([dbGetUserTopics(userId), dbGetBriefs(userId)]).then(
      ([t, b]) => {
        setTopics(t)
        setBriefs(b)
        setLoading(false)
      }
    )
  }, [userId])

  const handleRate = useCallback(
    async (topic: string, rating: number) => {
      if (!userId) return
      try {
        const saved = await dbUpsertUserTopic(userId, topic, rating)
        setTopics((prev) => {
          const exists = prev.find((t) => t.topic === topic)
          if (exists) return prev.map((t) => (t.topic === topic ? saved : t))
          return [...prev, saved]
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed')
      }
    },
    [userId]
  )

  const handleRemove = useCallback(
    async (id: string) => {
      if (!userId) return
      try {
        await dbDeleteUserTopic(userId, id)
        setTopics((prev) => prev.filter((t) => t.id !== id))
        toast.success('Topic removed')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed')
      }
    },
    [userId]
  )

  const handleAddCustom = useCallback(() => {
    if (!customTopic.trim()) return
    handleRate(customTopic.trim(), 3)
    setCustomTopic('')
  }, [customTopic, handleRate])

  const handleGenerateBrief = useCallback(async () => {
    if (!userId || topics.length === 0) {
      toast.error('Add some topics first')
      return
    }
    setBriefLoading(true)
    try {
      const topicNames = topics.sort((a, b) => b.rating - a.rating).map((t) => t.topic)
      const papers = await dbGetPapers({ limit: 30, offset: 0 })
      const briefContent = await generateDailyBrief(
        topicNames,
        papers.map((p) => ({ title: p.title, finding: p.finding, topic: p.topic }))
      )
      const saved = await dbSaveBrief({
        userId,
        content: briefContent,
        topics: topicNames,
        paperCount: papers.length,
      })
      setBriefs((prev) => [saved, ...prev])
      toast.success('Brief generated!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate brief')
    } finally {
      setBriefLoading(false)
    }
  }, [userId, topics])

  const getRating = (topic: string) => topics.find((t) => t.topic === topic)?.rating ?? 0
  const suggestedTopics = TOPICS.filter((t) => t !== 'All' && !topics.find((ut) => ut.topic === t))

  return (
    <>
      <div className="page-header">
        <div className="page-title">My Interests</div>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            onClick={handleGenerateBrief}
            disabled={briefLoading || topics.length === 0}
          >
            {briefLoading ? 'Generating...' : 'Generate Daily Brief'}
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats.topicsFollowed}</div>
            <div className="stat-label">Topics</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.streak}</div>
            <div className="stat-label">Papers Read</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--amber)' }}>{stats.totalNotes}</div>
            <div className="stat-label">Notes</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--teal)' }}>{stats.articlesRead}</div>
            <div className="stat-label">Articles</div>
          </div>
        </div>
      )}

      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* My Topics */}
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 650, marginBottom: '12px' }}>
            Your Topics
          </h3>
          {loading ? (
            <div className="loading-center">Loading...</div>
          ) : topics.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text3)' }}>
              No topics yet. Add topics below to personalize your feed and daily briefs.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topics.map((ut) => (
                <div key={ut.id} className="topic-row">
                  <span className="topic-row-name">{ut.topic}</span>
                  <div className="star-rating">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        className={`star-btn ${star <= ut.rating ? 'active' : ''}`}
                        onClick={() => handleRate(ut.topic, star)}
                        title={RATING_LABELS[star]}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <span className="topic-row-label">{RATING_LABELS[ut.rating]}</span>
                  <button className="btn btn-sm btn-danger" onClick={() => handleRemove(ut.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add topic */}
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 650, marginBottom: '12px' }}>
            Add Topics
          </h3>
          {suggestedTopics.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {suggestedTopics.map((topic) => (
                <button
                  key={topic}
                  className="topic-chip"
                  onClick={() => handleRate(topic, 3)}
                >
                  + {topic}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', maxWidth: '400px' }}>
            <input
              type="text"
              placeholder="Custom topic..."
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAddCustom}
              disabled={!customTopic.trim()}
            >
              Add
            </button>
          </div>
        </div>

        {/* Daily Briefs */}
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 650, marginBottom: '12px' }}>
            Daily Briefs
          </h3>
          {briefs.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text3)' }}>
              No briefs yet. Add topics and click "Generate Daily Brief" to get a personalized AI summary.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {briefs.map((brief) => (
                <div key={brief.id} className="card brief-card">
                  <div className="brief-header">
                    <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>
                      {formatRelative(brief.created_at)} · {brief.paper_count} papers reviewed
                    </span>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {(brief.topics as string[]).slice(0, 4).map((t) => (
                        <span key={t} className="topic-chip" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div
                    className="brief-content"
                    dangerouslySetInnerHTML={{ __html: brief.content }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default InterestsPage
