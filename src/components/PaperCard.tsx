import React, { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Paper, DeepAnalysis } from '../types'
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
  const analysis = paper.analysis as DeepAnalysis | null

  const handleSave = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleSave.mutate({ paperId: paper.id, saved: isSaved })
    },
    [paper.id, isSaved, toggleSave]
  )

  const handleClick = useCallback(() => {
    navigate(`/reader/${paper.id}`)
  }, [navigate, paper.id])

  return (
    <div className="card paper-card" onClick={handleClick}>
      <div className="paper-card-header">
        <div className="paper-card-title">{paper.title}</div>
      </div>

      <div className="paper-card-meta">
        <TagPill label={paper.source} source />
        {paper.year && <span>{paper.year}</span>}
        {paper.category && <span>{paper.category}</span>}
      </div>

      {(analysis?.tldr || paper.finding) && (
        <div className="paper-card-finding">
          {truncate(analysis?.tldr ?? paper.finding ?? '', 150)}
        </div>
      )}

      <div className="paper-card-actions" onClick={(e) => e.stopPropagation()}>
        <div className="paper-card-badges">
          {analysis && <span className="al-card-badge analyzed">Deep Read</span>}
          {isSaved && <span className="al-card-badge" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>Saved</span>}
        </div>
        <div className="paper-card-btns">
          <button
            className={`save-btn ${isSaved ? 'saved' : ''}`}
            onClick={handleSave}
            title={isSaved ? 'Unsave' : 'Save'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default React.memo(PaperCard)
