import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import { useFeeds, useDeleteFeed, useApproveFeed, useToggleFeed } from '../hooks/useFeeds'
import {
  dbGetAllUsers,
  dbToggleAdmin,
  dbGetAllPapersAdmin,
  dbDeletePaper,
  dbApprovePaper,
  dbCreateUser,
  dbBlockUser,
  dbDeleteUser,
  dbResetPassword,
  dbLookupUsername,
  dbNormalizeUsers,
} from '../lib/supabase'
import type { User, Paper } from '../types'
import { formatRelative } from '../lib/utils'
import toast from 'react-hot-toast'

const AdminPage: React.FC = () => {
  const navigate = useNavigate()
  const isAdmin = useAppStore((s) => s.isAdmin)
  const currentUser = useAppStore((s) => s.currentUser)
  const [activeTab, setActiveTab] = useState<'feeds' | 'papers' | 'users'>('feeds')
  const [users, setUsers] = useState<User[]>([])
  const [papers, setPapers] = useState<Paper[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [loadingPapers, setLoadingPapers] = useState(false)

  // Create user form
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [creating, setCreating] = useState(false)

  // Reset password
  const [resetUserId, setResetUserId] = useState<string | null>(null)
  const [resetPw, setResetPw] = useState('')

  // Auth diagnostics
  const [lookupInput, setLookupInput] = useState('')
  const [lookupResult, setLookupResult] = useState<string | null>(null)
  const [normalizing, setNormalizing] = useState(false)

  const { data: feeds = [] } = useFeeds()
  const deleteFeed = useDeleteFeed()
  const approveFeed = useApproveFeed()
  const toggleFeed = useToggleFeed()

  useEffect(() => {
    if (!isAdmin()) navigate('/')
  }, [isAdmin, navigate])

  const loadUsers = useCallback(() => {
    setLoadingUsers(true)
    dbGetAllUsers().then(setUsers).finally(() => setLoadingUsers(false))
  }, [])

  useEffect(() => {
    if (activeTab === 'users') loadUsers()
    if (activeTab === 'papers') {
      setLoadingPapers(true)
      dbGetAllPapersAdmin().then(setPapers).finally(() => setLoadingPapers(false))
    }
  }, [activeTab, loadUsers])

  // ---------- User actions ----------

  const handleCreateUser = useCallback(async () => {
    // Username is trimmed/lowercased in dbCreateUser. Password is intentionally
    // NOT trimmed — a trailing space is a legal password character and trimming
    // here silently broke logins when the user typed the exact same password.
    if (!newUsername.trim() || !newPassword) return
    setCreating(true)
    try {
      const user = await dbCreateUser({
        username: newUsername,
        password: newPassword,
        displayName: newDisplayName,
        isAdmin: newIsAdmin,
      })
      setUsers((prev) => [...prev, user])
      setNewUsername('')
      setNewPassword('')
      setNewDisplayName('')
      setNewIsAdmin(false)
      setShowCreateUser(false)
      toast.success(`User "${user.username}" created`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }, [newUsername, newPassword, newDisplayName, newIsAdmin])

  const handleToggleAdmin = useCallback(async (userId: string, currentAdmin: boolean) => {
    try {
      await dbToggleAdmin(userId, !currentAdmin)
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_admin: !currentAdmin } : u)))
      toast.success(currentAdmin ? 'Admin removed' : 'Admin granted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }, [])

  const handleBlockUser = useCallback(async (userId: string, currentBlocked: boolean) => {
    try {
      await dbBlockUser(userId, !currentBlocked)
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, blocked: !currentBlocked } : u)))
      toast.success(!currentBlocked ? 'User blocked' : 'User unblocked')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }, [])

  const handleDeleteUser = useCallback(async (userId: string, username: string) => {
    if (!window.confirm(`Delete user "${username}"? This removes all their data.`)) return
    try {
      await dbDeleteUser(userId)
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      toast.success('User deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }, [])

  const handleResetPassword = useCallback(async (userId: string) => {
    // Do NOT trim — passwords are stored exactly as entered.
    if (!resetPw) return
    try {
      await dbResetPassword(userId, resetPw)
      setResetUserId(null)
      setResetPw('')
      toast.success('Password reset')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }, [resetPw])

  const handleLookup = useCallback(async () => {
    if (!lookupInput.trim()) return
    try {
      const r = await dbLookupUsername(lookupInput)
      if (!r.exists) {
        setLookupResult(`❌ No account for "${lookupInput.trim().toLowerCase()}". Create one or check the spelling.`)
      } else {
        setLookupResult(
          `✅ Found: id=${r.id.slice(0, 8)}… · username="${r.username}" · display="${r.displayName ?? '—'}" · admin=${r.isAdmin} · blocked=${r.blocked}`
        )
      }
    } catch (err) {
      setLookupResult(err instanceof Error ? err.message : 'Lookup failed')
    }
  }, [lookupInput])

  const handleNormalize = useCallback(async () => {
    if (!window.confirm('Lowercase every username in the DB? Safe to run repeatedly. Collisions will be skipped and reported.')) return
    setNormalizing(true)
    try {
      const res = await dbNormalizeUsers()
      const skippedMsg = res.skipped.length > 0
        ? ` · ${res.skipped.length} skipped: ${res.skipped.map((s) => `${s.username} (${s.reason})`).join('; ')}`
        : ''
      toast.success(`Normalized ${res.updated} username${res.updated === 1 ? '' : 's'}${skippedMsg}`)
      loadUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Normalize failed')
    } finally {
      setNormalizing(false)
    }
  }, [loadUsers])

  // ---------- Paper actions ----------

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
            {tab === 'feeds' ? `Feeds (${pendingFeeds.length} pending)` : tab === 'papers' ? 'Papers' : `Users (${users.length})`}
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
                      <button className="btn btn-sm btn-primary" onClick={() => approveFeed.mutate({ id: feed.id, approved: true })}>Approve</button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteFeed.mutate(feed.id)}>Reject</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 650, marginBottom: '10px' }}>
                Approved Feeds ({approvedFeeds.length})
              </h3>
              {approvedFeeds.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text3)' }}>No approved feeds yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {approvedFeeds.map((feed) => (
                    <div key={feed.id} className="feed-row">
                      <div className="feed-color-dot" style={{ background: feed.color }} />
                      <div className="feed-info">
                        <div className="feed-name">{feed.name}</div>
                        <div className="feed-url">{feed.url}</div>
                      </div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{feed.topic}</span>
                      <div className="feed-meta">{feed.last_fetched_at ? formatRelative(feed.last_fetched_at) : 'Never'}</div>
                      <label className="toggle-switch">
                        <input type="checkbox" checked={feed.active} onChange={() => toggleFeed.mutate({ id: feed.id, active: !feed.active })} />
                        <span className="toggle-slider" />
                      </label>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteFeed.mutate(feed.id)}>Delete</button>
                    </div>
                  ))}
                </div>
              )}
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
                    {paper.approved ? <span className="approved-badge">Live</span> : <span className="pending-badge">Hidden</span>}
                    <div className="saved-row-title" style={{ cursor: 'pointer' }} onClick={() => navigate(`/reader/${paper.id}`)}>
                      {paper.title}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{paper.source}</span>
                    <button className="btn btn-sm" onClick={() => handleApprovePaper(paper.id, !paper.approved)}>
                      {paper.approved ? 'Hide' : 'Approve'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDeletePaper(paper.id)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------- Users Tab ---------- */}
        {activeTab === 'users' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 650 }}>Users ({users.length})</h3>
              <button className="btn btn-primary" onClick={() => setShowCreateUser(!showCreateUser)}>
                {showCreateUser ? 'Cancel' : 'Create User'}
              </button>
            </div>

            {/* Auth diagnostics — admin-only debugging for failed logins */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Auth diagnostics</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text3)', lineHeight: 1.5 }}>
                Usernames are stored lowercase and trimmed. Passwords are stored exactly as typed (no trimming).
                If a user can't log in, first check the username resolves here — then use "Reset password" on their row if the password may have been mistyped.
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Check username (e.g. rohit)"
                  value={lookupInput}
                  onChange={(e) => setLookupInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleLookup() }}
                  style={{ flex: 1, minWidth: '200px' }}
                />
                <button className="btn btn-sm" onClick={handleLookup} disabled={!lookupInput.trim()}>Check</button>
                <button className="btn btn-sm" onClick={handleNormalize} disabled={normalizing}>
                  {normalizing ? 'Normalizing…' : 'Normalize all usernames'}
                </button>
              </div>
              {lookupResult && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text2)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '8px 10px', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  {lookupResult}
                </div>
              )}
            </div>

            {showCreateUser && (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '0.87rem', fontWeight: 600 }}>New User</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    style={{ flex: 1, minWidth: '140px' }}
                  />
                  <input
                    type="text"
                    placeholder="Password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    style={{ flex: 1, minWidth: '140px' }}
                  />
                  <input
                    type="text"
                    placeholder="Display name (optional)"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    style={{ flex: 1, minWidth: '140px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text2)' }}>
                    <input
                      type="checkbox"
                      checked={newIsAdmin}
                      onChange={(e) => setNewIsAdmin(e.target.checked)}
                      style={{ width: 'auto', padding: 0 }}
                    />
                    Admin
                  </label>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleCreateUser}
                    disabled={creating || !newUsername.trim() || !newPassword}
                  >
                    {creating ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </div>
            )}

            {loadingUsers ? (
              <div className="loading-center">Loading users...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {users.map((user) => (
                  <div key={user.id} className="feed-row" style={{ opacity: user.blocked ? 0.5 : 1 }}>
                    <div className="sidebar-user-avatar" style={{ width: 32, height: 32, fontSize: '0.8rem' }}>
                      {(user.display_name?.[0] ?? user.username[0]).toUpperCase()}
                    </div>
                    <div className="feed-info">
                      <div className="feed-name">
                        {user.display_name ?? user.username}
                        {user.blocked && <span style={{ color: 'var(--coral)', fontSize: '0.72rem', marginLeft: '6px' }}>(blocked)</span>}
                      </div>
                      <div className="feed-url">@{user.username}</div>
                    </div>
                    {user.is_admin && <span className="admin-badge">Admin</span>}
                    <span style={{ fontSize: '0.75rem', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                      {formatRelative(user.created_at)}
                    </span>

                    {/* Don't let admin modify themselves */}
                    {user.id !== currentUser?.id && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" onClick={() => handleToggleAdmin(user.id, user.is_admin)}>
                          {user.is_admin ? 'Revoke Admin' : 'Make Admin'}
                        </button>
                        <button className="btn btn-sm" onClick={() => handleBlockUser(user.id, user.blocked)}>
                          {user.blocked ? 'Unblock' : 'Block'}
                        </button>
                        {resetUserId === user.id ? (
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <input
                              type="text"
                              placeholder="New password"
                              value={resetPw}
                              onChange={(e) => setResetPw(e.target.value)}
                              style={{ width: '120px', padding: '3px 8px', fontSize: '0.78rem' }}
                            />
                            <button className="btn btn-sm btn-primary" onClick={() => handleResetPassword(user.id)} disabled={!resetPw.trim()}>Set</button>
                            <button className="btn btn-sm" onClick={() => { setResetUserId(null); setResetPw('') }}>Cancel</button>
                          </div>
                        ) : (
                          <button className="btn btn-sm" onClick={() => setResetUserId(user.id)}>Reset PW</button>
                        )}
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeleteUser(user.id, user.username)}>Delete</button>
                      </div>
                    )}
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
