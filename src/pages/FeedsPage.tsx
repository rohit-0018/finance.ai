import React, { useState, useCallback } from 'react'
import { useFeeds, useAddFeed, useFetchRSSFeeds } from '../hooks/useFeeds'
import { useAppStore } from '../store'
import EmptyState from '../components/EmptyState'
import { formatRelative, generateColor, TOPICS, ARXIV_PRESETS } from '../lib/utils'

const FEED_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6']

const FeedsPage: React.FC = () => {
  const { data: allFeeds = [], isLoading } = useFeeds()
  const addFeed = useAddFeed()
  const fetchRSS = useFetchRSSFeeds()
  const isAdmin = useAppStore((s) => s.isAdmin)

  // Non-admins only see approved feeds
  const feeds = isAdmin() ? allFeeds : allFeeds.filter((f) => f.approved)

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [topic, setTopic] = useState('AI')
  const [color, setColor] = useState(generateColor())
  const [showForm, setShowForm] = useState(false)

  const handleAdd = useCallback(() => {
    if (!name.trim() || !url.trim()) return
    addFeed.mutate(
      { name: name.trim(), url: url.trim(), topic, color, active: true, added_by: null },
      {
        onSuccess: () => {
          setName('')
          setUrl('')
          setShowForm(false)
        },
      }
    )
  }, [name, url, topic, color, addFeed])

  const handlePreset = useCallback(
    (preset: (typeof ARXIV_PRESETS)[number]) => {
      addFeed.mutate({
        name: `arXiv ${preset.name}`,
        url: preset.url,
        topic: preset.topic,
        color: generateColor(),
        active: true,
        added_by: null,
      })
    },
    [addFeed]
  )

  const handleFetchRSS = useCallback(() => {
    const approvedActive = allFeeds.filter((f) => f.approved && f.active)
    fetchRSS.mutate(approvedActive)
  }, [allFeeds, fetchRSS])

  return (
    <>
      <div className="page-header">
        <div className="page-title">RSS Feeds</div>
        <div className="page-actions">
          <button
            className="btn"
            onClick={handleFetchRSS}
            disabled={fetchRSS.isPending}
          >
            {fetchRSS.isPending ? 'Pulling...' : 'Pull Feeds'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancel' : 'Suggest Feed'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="add-feed-form">
          <div style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
            Suggested feeds require admin approval before they appear for everyone.
          </div>
          <div className="form-row">
            <input
              type="text"
              placeholder="Feed name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type="url"
              placeholder="Feed URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="form-row">
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              {TOPICS.filter((t) => t !== 'All').map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div className="color-picker">
              {FEED_COLORS.map((c) => (
                <div
                  key={c}
                  className={`color-swatch ${color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={handleAdd}
              disabled={!name.trim() || !url.trim() || addFeed.isPending}
            >
              {addFeed.isPending ? 'Submitting...' : 'Submit'}
            </button>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: '6px' }}>
              Quick-add arXiv presets:
            </div>
            <div className="preset-chips">
              {ARXIV_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  className="preset-chip"
                  onClick={() => handlePreset(preset)}
                  disabled={addFeed.isPending}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="loading-center">Loading feeds...</div>
      ) : feeds.length === 0 ? (
        <EmptyState
          icon="R"
          title="No feeds available"
          description="Suggest a new RSS feed or wait for admin to approve existing ones."
        >
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            Suggest Feed
          </button>
        </EmptyState>
      ) : (
        <div className="feeds-list">
          {feeds.map((feed) => (
            <div key={feed.id} className="feed-row">
              <div className="feed-color-dot" style={{ background: feed.color }} />
              <div className="feed-info">
                <div className="feed-name">{feed.name}</div>
                <div className="feed-url">{feed.url}</div>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{feed.topic}</span>
              {feed.approved ? (
                <span className="approved-badge">Approved</span>
              ) : (
                <span className="pending-badge">Pending</span>
              )}
              <div className="feed-meta">
                {feed.last_fetched_at
                  ? `Fetched ${formatRelative(feed.last_fetched_at)}`
                  : 'Never fetched'}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default FeedsPage
