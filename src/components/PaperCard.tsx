import React, { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Paper } from '../types'
import { truncate } from '../lib/utils'
import TagPill from './TagPill'
import { useAppStore } from '../store'
import { useToggleSave } from '../hooks/useSaved'

interface PaperCardProps {
  paper: Paper
}

const PaperCard: React.FC<PaperCardProps> = ({ paper }) => {
  const navigate = useNavigate()
  const savedIds = useAppStore((s) => s.savedIds)
  const isSaved = savedIds.has(paper.id)
  const toggleSave = useToggleSave()

  const handleSave = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleSave.mutate({ paperId: paper.id, saved: isSaved })
    },
    [paper.id, isSaved, toggleSave]
  )

  const handleRead = useCallback(() => {
    navigate(`/reader/${paper.id}`)
  }, [navigate, paper.id])

  return (
    <div className="card paper-card" style={{ animation: 'fadeUp 0.25s ease' }}>
      <div className="paper-card-header">
        <div className="paper-card-title">{paper.title}</div>
      </div>

      <div className="paper-card-meta">
        <TagPill label={paper.source} source />
        {paper.year && <span>{paper.year}</span>}
        {paper.category && <span>{paper.category}</span>}
      </div>

      {paper.finding && (
        <div className="paper-card-finding">
          {truncate(paper.finding, 150)}
        </div>
      )}

      <div className="paper-card-actions">
        <button
          className={`save-btn ${isSaved ? 'saved' : ''}`}
          onClick={handleSave}
          title={isSaved ? 'Remove from reading list' : 'Save to reading list'}
        >
          {isSaved ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 2h14a1 1 0 011 1v19.143a.5.5 0 01-.766.424L12 18.03l-7.234 4.537A.5.5 0 014 22.143V3a1 1 0 011-1z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 2h14a1 1 0 011 1v19.143a.5.5 0 01-.766.424L12 18.03l-7.234 4.537A.5.5 0 014 22.143V3a1 1 0 011-1z" />
            </svg>
          )}
        </button>

        <button className="read-link" onClick={handleRead}>
          Read <span>&rarr;</span>
        </button>
      </div>
    </div>
  )
}

export default React.memo(PaperCard)
