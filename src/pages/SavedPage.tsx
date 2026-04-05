import React, { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSavedPapers, useStats, useUpdateReadStatus, useToggleSave } from '../hooks/useSaved'
import type { ReadStatus, SavedPaper } from '../types'
import TagPill from '../components/TagPill'
import EmptyState from '../components/EmptyState'
import { formatDate } from '../lib/utils'

const STATUS_ORDER: ReadStatus[] = ['unread', 'reading', 'done']

function nextStatus(current: ReadStatus): ReadStatus {
  const idx = STATUS_ORDER.indexOf(current)
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]
}

const SavedPage: React.FC = () => {
  const navigate = useNavigate()
  const { data: savedPapers = [], isLoading } = useSavedPapers()
  const { data: stats } = useStats()
  const updateStatus = useUpdateReadStatus()
  const toggleSave = useToggleSave()

  const [filterStatus, setFilterStatus] = useState<ReadStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'status'>('date')

  const filtered = useMemo(() => {
    let result = savedPapers

    if (filterStatus !== 'all') {
      result = result.filter((sp) => sp.read_status === filterStatus)
    }

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (sp) =>
          sp.paper.title.toLowerCase().includes(q) ||
          sp.paper.authors?.toLowerCase().includes(q)
      )
    }

    result = [...result].sort((a, b) => {
      if (sortBy === 'title') return a.paper.title.localeCompare(b.paper.title)
      if (sortBy === 'status') return STATUS_ORDER.indexOf(a.read_status) - STATUS_ORDER.indexOf(b.read_status)
      return new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime()
    })

    return result
  }, [savedPapers, filterStatus, search, sortBy])

  const handleCycleStatus = useCallback(
    (sp: SavedPaper) => {
      const next = nextStatus(sp.read_status)
      updateStatus.mutate({ paperId: sp.paper_id, status: next })
    },
    [updateStatus]
  )

  const handleUnsave = useCallback(
    (paperId: string) => {
      toggleSave.mutate({ paperId, saved: true })
    },
    [toggleSave]
  )

  const unreadCount = savedPapers.filter((sp) => sp.read_status === 'unread').length
  const readingCount = savedPapers.filter((sp) => sp.read_status === 'reading').length
  const doneCount = savedPapers.filter((sp) => sp.read_status === 'done').length

  return (
    <>
      <div className="page-header">
        <div className="page-title">Reading List</div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--text)' }}>
            {stats?.totalPapers ?? 0}
          </div>
          <div className="stat-label">Total Papers</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--coral)' }}>
            {unreadCount}
          </div>
          <div className="stat-label">Unread</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--amber)' }}>
            {readingCount}
          </div>
          <div className="stat-label">Reading</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--green)' }}>
            {doneCount}
          </div>
          <div className="stat-label">Done</div>
        </div>
      </div>

      <div className="saved-filters">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as ReadStatus | 'all')}
        >
          <option value="all">All Status</option>
          <option value="unread">Unread</option>
          <option value="reading">Reading</option>
          <option value="done">Done</option>
        </select>
        <input
          type="text"
          placeholder="Search saved papers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'date' | 'title' | 'status')}>
          <option value="date">Sort: Date</option>
          <option value="title">Sort: Title</option>
          <option value="status">Sort: Status</option>
        </select>
      </div>

      {isLoading ? (
        <div className="loading-center">Loading...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="B"
          title="No saved papers"
          description={search || filterStatus !== 'all' ? 'No papers match your filters.' : 'Save papers from the feed to build your reading list.'}
        />
      ) : (
        <div className="saved-list">
          {filtered.map((sp) => (
            <div key={sp.id} className="saved-row">
              <div
                className="status-dots"
                onClick={() => handleCycleStatus(sp)}
                title={`Status: ${sp.read_status} (click to cycle)`}
              >
                <div
                  className={`status-dot ${
                    sp.read_status === 'done'
                      ? 'filled'
                      : sp.read_status === 'reading'
                        ? 'reading'
                        : ''
                  }`}
                />
                <div
                  className={`status-dot ${
                    sp.read_status === 'done' ? 'filled' : ''
                  }`}
                />
                <div
                  className={`status-dot ${
                    sp.read_status === 'done' ? 'filled' : ''
                  }`}
                />
              </div>

              <TagPill label={sp.paper.source} source />

              <div
                className="saved-row-title"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/reader/${sp.paper_id}`)}
              >
                {sp.paper.title}
              </div>

              <div className="saved-row-date">{formatDate(sp.saved_at)}</div>

              <button
                className="btn btn-sm"
                onClick={() => navigate(`/reader/${sp.paper_id}`)}
              >
                Read &rarr;
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => handleUnsave(sp.paper_id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default SavedPage
