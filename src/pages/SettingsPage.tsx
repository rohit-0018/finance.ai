import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import { useFeeds, useDeleteFeed, useApproveFeed, useToggleFeed } from '../hooks/useFeeds'
import { dbGetAllUsers, dbToggleAdmin, dbGetAllPapersAdmin, dbDeletePaper, dbApprovePaper } from '../lib/supabase'
import type { User, Paper } from '../types'
import { formatRelative } from '../lib/utils'
import toast from 'react-hot-toast'

const AdminPage: React.FC = () => {
  const navigate = useNavigate()
  const isAdmin = useAppStore((s) => s.isAdmin)
  const [activeTab, setActiveTab] = useState<'feeds' | 'papers' | 'users'>('feeds')
  const [users, setUsers] = useState<User[]>([])
  const [papers, setPapers] = useState<Paper[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [loadingPapers, setLoadingPapers] = useState(false)

  const { data: feeds = [] } = useFeeds()
  const deleteFeed = useDeleteFeed()
  const approveFeed = useApproveFeed()
  const toggleFeed = useToggleFeed()

  useEffect(() => {
    if (!isAdmin()) {
      navigate('/')
    }
  }, [isAdmin, navigate])

  useEffect(() => {
    if (activeTab === 'users') {
      setLoadingUsers(true)
      dbGetAllUsers().then(setUsers).finally(() => setLoadingUsers(false))
    }
    if (activeTab === 'papers') {
      setLoadingPapers(true)
      dbGetAllPapersAdmin().then(setPapers).finally(() => setLoadingPapers(false))
    }
  }, [activeTab])

  const handleToggleAdmin = useCallback(async (userId: string, currentAdmin: boolean) => {
    try {
      await dbToggleAdmin(userId, !currentAdmin)
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_admin: !currentAdmin } : u))
      )
      toast.success(currentAdmin ? 'Admin removed' : 'Admin granted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }, [])

  const handleDeletePaper = useCallback(async (id: string) => {
    try {
      await dbDeletePaper(id)
      setPapers((prev) => prev.filter((p) => p.id !== id))
      toast.success('Paper deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }, [])

  const handleApprovePaper = useCallback(async (id: string, approved: boolean) => {
    try {
      await dbApprovePaper(id, approved)
      setPapers((prev) => prev.map((p) => (p.id === id ? { ...p, approved } : p)))
      toast.success(approved ? 'Paper approved' : 'Paper hidden')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }, [])

  const pendingFeeds = feeds.filter((f) => !f.approved)
  const approvedFeeds = feeds.filter((f) => f.approved)

  if (!isAdmin()) return null

  return (
    <>
      <div className="page-header">
        <div className="page-title">Admin Panel</div>
        <span className="admin-badge">Admin</span>
      </div>

      <div className="tabs">
        {(['feeds', 'papers', 'users'] as const).map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'feeds' ? `Feeds (${pendingFeeds.length} pending)` : tab === 'papers' ? 'Papers' : 'Users'}
          </button>
        ))}
      </div>

      <div style={{ padding: '20px 24px' }}>
        {/* ---------- Feeds Tab ---------- */}
        {activeTab === 'feeds' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {pendingFeeds.length > 0 && (
              <div>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 650, marginBottom: '10px' }}>
                  Pending Approval ({pendingFeeds.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {pendingFeeds.map((feed) => (
                    <div key={feed.id} className="feed-row">
                      <div className="feed-color-dot" style={{ background: feed.color }} />
                      <div className="feed-info">
                        <div className="feed-name">{feed.name}</div>
                        <div className="feed-url">{feed.url}</div>
                      </div>
                      <span className="pending-badge">Pending</span>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => approveFeed.mutate({ id: feed.id, approved: true })}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => deleteFeed.mutate(feed.id)}
                      >
                        Reject
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 650, marginBottom: '10px' }}>
                Approved Feeds ({approvedFeeds.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {approvedFeeds.map((feed) => (
                  <div key={feed.id} className="feed-row">
                    <div className="feed-color-dot" style={{ background: feed.color }} />
                    <div className="feed-info">
                      <div className="feed-name">{feed.name}</div>
                      <div className="feed-url">{feed.url}</div>
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{feed.topic}</span>
                    <div className="feed-meta">
                      {feed.last_fetched_at ? formatRelative(feed.last_fetched_at) : 'Never'}
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={feed.active}
                        onChange={() => toggleFeed.mutate({ id: feed.id, active: !feed.active })}
                      />
                      <span className="toggle-slider" />
                    </label>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => deleteFeed.mutate(feed.id)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ---------- Papers Tab ---------- */}
        {activeTab === 'papers' && (
          <div>
            {loadingPapers ? (
              <div className="loading-center">Loading papers...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text3)', marginBottom: '8px' }}>
                  {papers.length} papers total
                </div>
                {papers.map((paper) => (
                  <div key={paper.id} className="saved-row">
                    {!paper.approved && <span className="pending-badge">Hidden</span>}
                    {paper.approved && <span className="approved-badge">Live</span>}
                    <div className="saved-row-title" style={{ cursor: 'pointer' }} onClick={() => navigate(`/reader/${paper.id}`)}>
                      {paper.title}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{paper.source}</span>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleApprovePaper(paper.id, !paper.approved)}
                    >
                      {paper.approved ? 'Hide' : 'Approve'}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDeletePaper(paper.id)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------- Users Tab ---------- */}
        {activeTab === 'users' && (
          <div>
            {loadingUsers ? (
              <div className="loading-center">Loading users...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {users.map((user) => (
                  <div key={user.id} className="feed-row">
                    <div
                      className="sidebar-user-avatar"
                      style={{ width: 32, height: 32, fontSize: '0.8rem' }}
                    >
                      {(user.display_name?.[0] ?? user.username[0]).toUpperCase()}
                    </div>
                    <div className="feed-info">
                      <div className="feed-name">
                        {user.display_name ?? user.username}
                      </div>
                      <div className="feed-url">@{user.username}</div>
                    </div>
                    {user.is_admin && <span className="admin-badge">Admin</span>}
                    <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
                      {formatRelative(user.created_at)}
                    </span>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleToggleAdmin(user.id, user.is_admin)}
                    >
                      {user.is_admin ? 'Remove Admin' : 'Make Admin'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export default AdminPage
