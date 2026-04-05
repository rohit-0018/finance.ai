import React, { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePaper } from '../hooks/usePapers'
import { useNotes, useSaveNote } from '../hooks/useNotes'
import { useToggleSave, useUpdateReadStatus } from '../hooks/useSaved'
import { useAppStore } from '../store'
import { generateDigest, autoExtractNotes } from '../lib/anthropic'
import { supabase } from '../lib/supabase'
import TagPill from '../components/TagPill'
import DigestPanel from '../components/DigestPanel'
import QAChat from '../components/QAChat'
import NoteCard from '../components/NoteCard'
import type { NoteType, ReadStatus } from '../types'
import toast from 'react-hot-toast'

const ReaderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: paper, isLoading, isError } = usePaper(id ?? '')
  const { data: notes = [] } = useNotes(id ?? '')
  const savedIds = useAppStore((s) => s.savedIds)
  const toggleSave = useToggleSave()
  const updateStatus = useUpdateReadStatus()
  const saveNote = useSaveNote()

  const [activeTab, setActiveTab] = useState<'qa' | 'notes'>('qa')
  const [noteContent, setNoteContent] = useState('')
  const [noteType, setNoteType] = useState<NoteType>('note')
  const [extracting, setExtracting] = useState(false)
  const [digestLoading, setDigestLoading] = useState(false)

  const isSaved = paper ? savedIds.has(paper.id) : false

  const handleSave = useCallback(() => {
    if (paper) toggleSave.mutate({ paperId: paper.id, saved: isSaved })
  }, [paper, isSaved, toggleSave])

  const handleStatusChange = useCallback(
    (status: ReadStatus) => {
      if (paper) updateStatus.mutate({ paperId: paper.id, status })
    },
    [paper, updateStatus]
  )

  const handleAddNote = useCallback(() => {
    if (!noteContent.trim() || !paper) return
    saveNote.mutate({
      paperId: paper.id,
      content: noteContent.trim(),
      noteType,
    })
    setNoteContent('')
  }, [noteContent, noteType, paper, saveNote])

  const handleAutoExtract = useCallback(async () => {
    if (!paper) return
    setExtracting(true)
    try {
      const extracted = await autoExtractNotes(paper)
      for (const note of extracted) {
        await saveNote.mutateAsync({
          paperId: paper.id,
          content: note.content,
          highlight: note.highlight,
          noteType: note.note_type,
        })
      }
      toast.success(`Extracted ${extracted.length} notes`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to extract notes')
    } finally {
      setExtracting(false)
    }
  }, [paper, saveNote])

  const handleExtractDigest = useCallback(async () => {
    if (!paper || !paper.abstract) return
    setDigestLoading(true)
    try {
      const digest = await generateDigest(paper.title, paper.abstract)
      await supabase
        .from('papers')
        .update({
          problem: digest.problem,
          method: digest.method,
          finding: digest.finding,
          category: digest.category,
          tags: digest.tags,
        })
        .eq('id', paper.id)
      toast.success('Digest extracted')
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to extract digest')
    } finally {
      setDigestLoading(false)
    }
  }, [paper])

  if (isLoading) {
    return <div className="loading-center">Loading paper...</div>
  }

  if (isError || !paper) {
    return <div className="loading-center" style={{ color: 'var(--coral)' }}>Paper not found</div>
  }

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <button onClick={() => navigate('/')} style={{ color: 'var(--text3)' }}>Feed</button>
          <span className="breadcrumb-sep">/</span>
          <span style={{ color: 'var(--text2)' }}>{paper.title.slice(0, 50)}...</span>
        </div>
        <div className="page-actions">
          <select
            value={isSaved ? 'saved' : 'unsaved'}
            onChange={(e) => {
              if (e.target.value === 'unsaved' && isSaved) handleSave()
              if (e.target.value !== 'unsaved' && !isSaved) handleSave()
              if (e.target.value !== 'unsaved' && e.target.value !== 'saved') {
                handleStatusChange(e.target.value as ReadStatus)
              }
            }}
            style={{ minWidth: '120px' }}
          >
            <option value="unsaved">Not Saved</option>
            <option value="unread">Unread</option>
            <option value="reading">Reading</option>
            <option value="done">Done</option>
          </select>
          <button
            className={`btn ${isSaved ? 'btn-primary' : ''}`}
            onClick={handleSave}
          >
            {isSaved ? 'Saved' : 'Save'}
          </button>
          {paper.url && (
            <a
              href={paper.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
            >
              Source
            </a>
          )}
        </div>
      </div>

      <div className="reader-layout">
        <div className="reader-left">
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <TagPill label={paper.source} source />
            {paper.category && <TagPill label={paper.category} />}
            {paper.year && <TagPill label={String(paper.year)} />}
          </div>

          <div className="reader-paper-title">{paper.title}</div>

          {paper.authors && (
            <div className="reader-authors">{paper.authors}</div>
          )}

          {paper.tags && paper.tags.length > 0 && (
            <div className="reader-tags">
              {paper.tags.map((tag, i) => (
                <TagPill key={i} label={tag} />
              ))}
            </div>
          )}

          {paper.abstract && (
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', fontWeight: 600 }}>
                Abstract
              </div>
              <div className="reader-abstract">{paper.abstract}</div>
            </div>
          )}

          <DigestPanel
            problem={paper.problem}
            method={paper.method}
            finding={paper.finding}
          />

          {!paper.problem && !paper.method && !paper.finding && paper.abstract && (
            <button
              className="btn"
              onClick={handleExtractDigest}
              disabled={digestLoading}
              style={{ alignSelf: 'flex-start' }}
            >
              {digestLoading ? 'Extracting...' : 'Auto-extract Digest'}
            </button>
          )}
        </div>

        <div className="reader-right">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'qa' ? 'active' : ''}`}
              onClick={() => setActiveTab('qa')}
            >
              Q&A ({useAppStore.getState().qaMessages.length})
            </button>
            <button
              className={`tab ${activeTab === 'notes' ? 'active' : ''}`}
              onClick={() => setActiveTab('notes')}
            >
              Notes ({notes.length})
            </button>
          </div>

          {activeTab === 'qa' ? (
            <QAChat paper={paper} />
          ) : (
            <div className="tab-content">
              <div className="notes-input">
                <div className="note-type-selector">
                  {(['note', 'insight', 'question', 'highlight'] as NoteType[]).map(
                    (type) => (
                      <button
                        key={type}
                        className={`note-type-btn ${noteType === type ? 'active' : ''}`}
                        style={
                          noteType === type
                            ? { color: type === 'note' ? 'var(--accent)' : type === 'insight' ? 'var(--green)' : type === 'question' ? 'var(--amber)' : 'var(--coral)' }
                            : undefined
                        }
                        onClick={() => setNoteType(type)}
                      >
                        {type}
                      </button>
                    )
                  )}
                </div>
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Write a note..."
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleAddNote}
                    disabled={!noteContent.trim()}
                  >
                    Add Note
                  </button>
                  <button
                    className="btn"
                    onClick={handleAutoExtract}
                    disabled={extracting}
                  >
                    {extracting ? 'Extracting...' : 'Auto-extract Notes'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {notes.map((note) => (
                  <NoteCard key={note.id} note={note} />
                ))}
                {notes.length === 0 && (
                  <div style={{ color: 'var(--text3)', fontSize: '0.82rem', textAlign: 'center', padding: '40px 0' }}>
                    No notes yet. Add one above or auto-extract from the paper.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default ReaderPage
