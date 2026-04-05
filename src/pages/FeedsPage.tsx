import React, { useState, useCallback } from 'react'
import { useFeeds, useAddFeed, useFetchRSSFeeds } from '../hooks/useFeeds'
import { useAppStore } from '../store'
import EmptyState from '../components/EmptyState'
import TagPill from '../components/TagPill'
import { formatRelative, generateColor, TOPICS, ARXIV_PRESETS } from '../lib/utils'
import toast from 'react-hot-toast'

const FEED_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6']

const FeedsPage: React.FC = () => {
  const { data: allFeeds = [], isLoading } = useFeeds()
  const addFeed = useAddFeed()
  const fetchRSS = useFetchRSSFeeds()
  const isAdmin = useAppStore((s) => s.isAdmin)

  const feeds = isAdmin() ? allFeeds : allFeeds.filter((f) => f.approved)

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [topic, setTopic] = useState('AI')
  const [color, setColor] = useState(generateColor())
  const [showForm, setShowForm] = useState(false)
  const [pullLog, setPullLog] = useState<{ total: number; errors: string[] } | null>(null)

  const handleAdd = useCallback(() => {
    if (!name.trim() || !url.trim()) return
    addFeed.mutate(
      { name: name.trim(), url: url.trim(), topic, color, active: true, added_by: null },
      { onSuccess: () => { setName(''); setUrl(''); setShowForm(false) } }
    )
  }, [name, url, topic, color, addFeed])

  const handlePreset = useCallback(
    (preset: (typeof ARXIV_PRESETS)[number]) => {
      addFeed.mutate({ name: `arXiv ${preset.name}`, url: preset.url, topic: preset.topic, color: generateColor(), active: true, added_by: null })
    },
    [addFeed]
  )

  const handleFetchRSS = useCallback(() => {
    const approvedActive = allFeeds.filter((f) => f.approved && f.active)
    if (approvedActive.length === 0) {
      toast.error('No approved & active feeds to pull from')
      return
    }
    setPullLog(null)
    fetchRSS.mutate(approvedActive, {
      onSuccess: (result) => {
        setPullLog(result)
        if (result.errors.length > 0) {
          console.error('[RSS Pull] Errors:', result.errors)
        }
      },
      onError: (err) => {
        console.error('[RSS Pull] Fatal:', err)
        setPullLog({ total: 0, errors: [err instanceof Error ? err.message : 'Unknown error'] })
      },
    })
  }, [allFeeds, fetchRSS])

  const approvedCount = allFeeds.filter((f) => f.approved).length
  const activeCount = allFeeds.filter((f) => f.approved && f.active).length
  const pendingCount = allFeeds.filter((f) => !f.approved).length

  return (
    <>
      <div className="page-header">
        <div className="page-title">RSS Feeds</div>
        <div className="page-actions">
          {isAdmin() && (
            <button className="btn" onClick={handleFetchRSS} disabled={fetchRSS.isPending || activeCount === 0}>
              {fetchRSS.isPending ? 'Pulling...' : `Pull ${activeCount} Feeds`}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Suggest Feed'}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="fd-stats">
        <div className="fd-stat">
          <span className="fd-stat-val">{allFeeds.length}</span>
          <span className="fd-stat-lbl">Total</span>
        </div>
        <div className="fd-stat">
          <span className="fd-stat-val" style={{ color: 'var(--green)' }}>{approvedCount}</span>
          <span className="fd-stat-lbl">Approved</span>
        </div>
        <div className="fd-stat">
          <span className="fd-stat-val" style={{ color: 'var(--accent)' }}>{activeCount}</span>
          <span className="fd-stat-lbl">Active</span>
        </div>
        {pendingCount > 0 && (
          <div className="fd-stat">
            <span className="fd-stat-val" style={{ color: 'var(--amber)' }}>{pendingCount}</span>
            <span className="fd-stat-lbl">Pending</span>
          </div>
        )}
      </div>

      {/* Pull results log */}
      {pullLog && (
        <div className={`fd-pull-log ${pullLog.errors.length > 0 ? 'has-errors' : ''}`}>
          <div className="fd-pull-summary">
            {pullLog.total > 0 ? (
              <span style={{ color: 'var(--green)' }}>Fetched {pullLog.total} papers</span>
            ) : (
              <span style={{ color: 'var(--amber)' }}>No papers fetched</span>
            )}
            {pullLog.errors.length > 0 && (
              <span style={{ color: 'var(--coral)' }}> · {pullLog.errors.length} error{pullLog.errors.length > 1 ? 's' : ''}</span>
            )}
            <button className="btn btn-sm" onClick={() => setPullLog(null)} style={{ marginLeft: 'auto' }}>Dismiss</button>
          </div>
          {pullLog.errors.length > 0 && (
            <div className="fd-pull-errors">
              {pullLog.errors.map((err, i) => (
                <div key={i} className="fd-pull-error">{err}</div>
              ))}
            </div>
          )}
          {pullLog.total === 0 && pullLog.errors.length === 0 && (
            <div className="fd-pull-hint">
              This usually means the CORS proxies couldn't reach the feed URLs, or the feeds returned no new items. Check the browser console for details.
            </div>
          )}
        </div>
      )}

      {/* Add feed form */}
      {showForm && (
        <div className="fd-add-form">
          <div className="fd-add-note">
            Suggested feeds require admin approval before they appear for everyone.
          </div>
          <div className="fd-add-row">
            <input type="text" placeholder="Feed name" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="url" placeholder="Feed URL (RSS/Atom)" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="fd-add-row">
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              {TOPICS.filter((t) => t !== 'All').map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="color-picker">
              {FEED_COLORS.map((c) => (
                <div key={c} className={`color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
            <button className="btn btn-primary" onClick={handleAdd} disabled={!name.trim() || !url.trim() || addFeed.isPending}>
              {addFeed.isPending ? 'Submitting...' : 'Submit'}
            </button>
          </div>
          <div>
            <div className="fd-add-note" style={{ marginBottom: '6px' }}>Quick-add arXiv presets:</div>
            <div className="preset-chips">
              {ARXIV_PRESETS.map((preset) => (
                <button key={preset.name} className="preset-chip" onClick={() => handlePreset(preset)} disabled={addFeed.isPending}>
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Feed list */}
      {isLoading ? (
        <div className="loading-center">Loading feeds...</div>
      ) : feeds.length === 0 ? (
        <EmptyState icon="R" title="No feeds available" description="Suggest a new RSS feed or wait for admin to approve existing ones.">
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>Suggest Feed</button>
        </EmptyState>
      ) : (
        <div className="fd-list">
          {feeds.map((feed) => (
            <div key={feed.id} className="fd-card">
              <div className="fd-card-left">
                <div className="fd-card-dot" style={{ background: feed.color }} />
                <div className="fd-card-info">
                  <div className="fd-card-name">{feed.name}</div>
                  <div className="fd-card-url">{feed.url}</div>
                </div>
              </div>
              <div className="fd-card-right">
                <TagPill label={feed.topic} />
                {feed.approved ? (
                  <span className="approved-badge">Approved</span>
                ) : (
                  <span className="pending-badge">Pending</span>
                )}
                {feed.active && feed.approved && <span className="fd-active-dot" title="Active" />}
                <span className="fd-card-fetched">
                  {feed.last_fetched_at ? formatRelative(feed.last_fetched_at) : 'Never'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default FeedsPage
