import React, { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllNotes } from '../hooks/useNotes'
import NoteCard from '../components/NoteCard'
import EmptyState from '../components/EmptyState'
import type { NoteType } from '../types'

const NotesPage: React.FC = () => {
  const navigate = useNavigate()
  const { data: notes = [], isLoading } = useAllNotes()
  const [filterType, setFilterType] = useState<NoteType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat')

  const filtered = useMemo(() => {
    let result = notes

    if (filterType !== 'all') {
      result = result.filter((n) => n.note_type === filterType)
    }

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (n) =>
          n.content.toLowerCase().includes(q) ||
          n.paper?.title?.toLowerCase().includes(q) ||
          n.highlight?.toLowerCase().includes(q)
      )
    }

    return result
  }, [notes, filterType, search])

  const grouped = useMemo(() => {
    if (viewMode !== 'grouped') return null
    const map = new Map<string, typeof filtered>()
    for (const note of filtered) {
      const key = note.paper?.title ?? note.paper_id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(note)
    }
    return map
  }, [filtered, viewMode])

  const handlePaperClick = useCallback(
    (paperId: string) => {
      navigate(`/reader/${paperId}`)
    },
    [navigate]
  )

  return (
    <>
      <div className="page-header">
        <div className="page-title">Knowledge Notes</div>
        <div className="page-actions">
          <button
            className={`btn btn-sm ${viewMode === 'flat' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('flat')}
          >
            Flat
          </button>
          <button
            className={`btn btn-sm ${viewMode === 'grouped' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('grouped')}
          >
            Grouped
          </button>
        </div>
      </div>

      <div className="notes-filters">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as NoteType | 'all')}
        >
          <option value="all">All Types</option>
          <option value="note">Notes</option>
          <option value="insight">Insights</option>
          <option value="question">Questions</option>
          <option value="highlight">Highlights</option>
        </select>
        <input
          type="text"
          placeholder="Search notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
          {filtered.length} notes
        </span>
      </div>

      {isLoading ? (
        <div className="loading-center">Loading notes...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="N"
          title="No notes yet"
          description="Open a paper and add notes to start building your knowledge base."
        />
      ) : viewMode === 'flat' ? (
        <div className="notes-grid">
          {filtered.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              showPaperLink
              onPaperClick={handlePaperClick}
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: '20px 24px' }}>
          {grouped &&
            Array.from(grouped.entries()).map(([title, groupNotes]) => (
              <div key={title} style={{ marginBottom: '24px' }}>
                <div
                  style={{
                    fontFamily: 'var(--serif)',
                    fontStyle: 'italic',
                    fontSize: '1rem',
                    marginBottom: '10px',
                    color: 'var(--text)',
                  }}
                >
                  {title}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {groupNotes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onPaperClick={handlePaperClick}
                    />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </>
  )
}

export default NotesPage
