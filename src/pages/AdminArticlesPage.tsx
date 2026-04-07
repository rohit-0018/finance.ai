import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import {
  dbGetPendingArticles,
  dbApproveArticle,
  dbDeleteArticle,
} from '../lib/supabase'
import type { Article } from '../types'
import { formatRelative, truncate } from '../lib/utils'
import toast from 'react-hot-toast'

// Admin-only screen for reviewing public articles submitted by users.
// Private articles never appear here — they only need owner-level visibility.
const AdminArticlesPage: React.FC = () => {
  const navigate = useNavigate()
  const isAdmin = useAppStore((s) => s.isAdmin)
  const [pending, setPending] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin()) {
      navigate('/')
      return
    }
    dbGetPendingArticles().then(setPending).finally(() => setLoading(false))
  }, [isAdmin, navigate])

  const handleApprove = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      await dbApproveArticle(id, true)
      setPending((prev) => prev.filter((a) => a.id !== id))
      toast.success('Approved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setBusyId(null)
    }
  }, [])

  const handleReject = useCallback(async (id: string) => {
    if (!window.confirm('Reject and delete this article?')) return
    setBusyId(id)
    try {
      await dbDeleteArticle(id)
      setPending((prev) => prev.filter((a) => a.id !== id))
      toast.success('Rejected')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setBusyId(null)
    }
  }, [])

  return (
    <>
      <div className="page-header">
        <div className="page-title">Article Approvals</div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={() => navigate('/articles')}>
            ← Back to articles
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16, fontSize: '0.85rem', color: 'var(--text2, #888)' }}>
        Public articles submitted by users are listed here. Approve to publish to everyone, or
        reject to remove.
      </div>

      {loading ? (
        <div className="loading-center">Loading pending articles...</div>
      ) : pending.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✓</div>
          <div className="empty-state-title">Nothing pending</div>
          <div className="empty-state-desc">
            All public articles have been reviewed.
          </div>
        </div>
      ) : (
        <div className="al-grid">
          {pending.map((article) => {
            const domain = (() => {
              try { return new URL(article.url).hostname.replace('www.', '') } catch { return '' }
            })()
            const busy = busyId === article.id
            return (
              <div key={article.id} className="al-card">
                <div className="al-card-top">
                  <span className="al-card-domain">{domain}</span>
                  <span className="al-card-date">{formatRelative(article.created_at)}</span>
                </div>
                <h3 className="al-card-title">{article.title}</h3>
                <p className="al-card-excerpt">
                  {article.summary ? truncate(article.summary, 180) : 'No summary available.'}
                </p>
                <div className="al-card-bottom">
                  <span className="al-card-badge pending">Pending review</span>
                  <div className="al-card-actions" style={{ display: 'flex', gap: 8 }}>
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="al-card-link"
                    >
                      Source
                    </a>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() => handleApprove(article.id)}
                    >
                      {busy ? '...' : 'Approve'}
                    </button>
                    <button
                      className="al-card-link danger"
                      disabled={busy}
                      onClick={() => handleReject(article.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export default AdminArticlesPage
