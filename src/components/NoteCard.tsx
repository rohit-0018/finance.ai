import React, { useState, useCallback } from 'react'
import type { Note } from '../types'
import { noteTypeToColor, noteTypeToLabel, formatRelative } from '../lib/utils'
import { useUpdateNote, useDeleteNote } from '../hooks/useNotes'

interface NoteCardProps {
  note: Note
  showPaperLink?: boolean
  onPaperClick?: (paperId: string) => void
}

const NoteCard: React.FC<NoteCardProps> = ({ note, showPaperLink, onPaperClick }) => {
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(note.content)
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const borderColor = noteTypeToColor(note.note_type)

  const handleSaveEdit = useCallback(() => {
    if (editContent.trim() && editContent !== note.content) {
      updateNote.mutate({ id: note.id, content: editContent.trim() })
    }
    setEditing(false)
  }, [editContent, note.content, note.id, updateNote])

  const handleDelete = useCallback(() => {
    deleteNote.mutate(note.id)
  }, [deleteNote, note.id])

  const handlePaperClick = useCallback(() => {
    if (onPaperClick) onPaperClick(note.paper_id)
  }, [onPaperClick, note.paper_id])

  return (
    <div className="note-card" style={{ borderLeftColor: borderColor }}>
      {note.highlight && (
        <div className="note-card-highlight">&ldquo;{note.highlight}&rdquo;</div>
      )}

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            autoFocus
          />
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn btn-sm btn-primary" onClick={handleSaveEdit}>
              Save
            </button>
            <button className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="note-card-content">{note.content}</div>
      )}

      <div className="note-card-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: borderColor }}>{noteTypeToLabel(note.note_type)}</span>
          <span>{formatRelative(note.created_at)}</span>
          {showPaperLink && note.paper && (
            <button
              onClick={handlePaperClick}
              style={{ color: 'var(--accent2)', fontSize: '0.7rem' }}
            >
              {note.paper.title.slice(0, 40)}...
            </button>
          )}
        </div>
        <div className="note-card-actions">
          {!editing && (
            <button className="btn btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <button className="btn btn-sm btn-danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export default React.memo(NoteCard)
