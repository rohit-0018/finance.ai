import React, { useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePaper } from '../hooks/usePapers'
import { useNotes, useSaveNote } from '../hooks/useNotes'
import { useToggleSave, useUpdateReadStatus } from '../hooks/useSaved'
import { useAppStore } from '../store'
import { generateDeepAnalysis, claudeChat } from '../lib/anthropic'
import { dbUpdatePaperAnalysis } from '../lib/supabase'
import TagPill from '../components/TagPill'
import NoteCard from '../components/NoteCard'
import type { NoteType, DeepAnalysis } from '../types'
import toast from 'react-hot-toast'

type ReadingMode = 'researcher' | 'practitioner' | 'layperson'

type StringSectionKey = 'hook' | 'coreProblem' | 'proposedSolution' | 'evidence' | 'implications' | 'limitations' | 'fieldContext' | 'tldr'

const SECTION_META: Array<{
  key: StringSectionKey
  label: string
  icon: string
  drillPrompt: string
}> = [
  { key: 'hook', label: 'The Hook', icon: '\u26A1', drillPrompt: 'Tell me more about the historical context and what prompted this research' },
  { key: 'coreProblem', label: 'Core Problem', icon: '\uD83C\uDFAF', drillPrompt: 'Explain the core problem in more detail with technical specifics' },
  { key: 'proposedSolution', label: 'The Solution', icon: '\uD83D\uDCA1', drillPrompt: 'Break down the solution step by step. How does it actually work?' },
  { key: 'evidence', label: 'Evidence', icon: '\uD83D\uDCCA', drillPrompt: 'Analyze the evidence critically. Are the results convincing?' },
  { key: 'implications', label: 'Real-World Impact', icon: '\uD83C\uDF0D', drillPrompt: 'Give more concrete examples of who benefits and how' },
  { key: 'limitations', label: 'Honest Limitations', icon: '\u26A0\uFE0F', drillPrompt: 'What are the deepest concerns with this work?' },
  { key: 'fieldContext', label: 'Where It Fits', icon: '\uD83D\uDDFA\uFE0F', drillPrompt: 'Map this against the most important related work' },
  { key: 'tldr', label: 'TL;DR', icon: '\uD83D\uDCCB', drillPrompt: '' },
]

function formatSection(text: string): string {
  return text
    .replace(/\[PAPER\]/g, '<span class="source-label paper">PAPER</span>')
    .replace(/\[CONTEXT\]/g, '<span class="source-label context">CONTEXT</span>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>')
}

const ReaderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: paper, isLoading, isError, refetch } = usePaper(id ?? '')
  const { data: notes = [] } = useNotes(id ?? '')
  const savedIds = useAppStore((s) => s.savedIds)
  const toggleSave = useToggleSave()
  const updateStatus = useUpdateReadStatus()
  const saveNote = useSaveNote()

  const [mode, setMode] = useState<ReadingMode>('researcher')
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState('')
  const [activeTab, setActiveTab] = useState<'analysis' | 'notes'>('analysis')

  // Chat
  const chatRef = useRef<HTMLDivElement>(null)
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  // Notes
  const [noteContent, setNoteContent] = useState('')
  const [noteType, setNoteType] = useState<NoteType>('note')

  const isSaved = paper ? savedIds.has(paper.id) : false

  const handleAnalyze = useCallback(async () => {
    if (!paper) return
    const content = [paper.abstract, paper.problem, paper.method, paper.finding].filter(Boolean).join('\n\n')
    if (content.length < 50) { toast.error('Not enough content to analyze'); return }

    setAnalyzing(true)
    try {
      const fullContent = `Title: ${paper.title}\nAuthors: ${paper.authors ?? 'Unknown'}\n\n${content}`
      const analysis = await generateDeepAnalysis(paper.title, fullContent, mode, setProgress)
      await dbUpdatePaperAnalysis(paper.id, analysis)
      await refetch()
      toast.success('Deep analysis complete!')
    } catch (err) {
      console.error('Analysis failed:', err)
      toast.error(err instanceof Error ? err.message : 'Analysis failed')
    } finally { setAnalyzing(false); setProgress('') }
  }, [paper, mode, refetch])

  const handleDrill = useCallback(async (prompt: string) => {
    if (!paper) return
    setChatOpen(true)
    setTimeout(() => chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    const newMsgs = [...chatMessages, { role: 'user' as const, content: prompt }]
    setChatMessages(newMsgs)
    setChatLoading(true)
    try {
      const systemPrompt = `You are a deep research assistant analyzing: "${paper.title}"\nAbstract: ${paper.abstract ?? ''}\nProblem: ${paper.problem ?? ''}\nMethod: ${paper.method ?? ''}\nFinding: ${paper.finding ?? ''}\n\nUse [PAPER] and [CONTEXT] labels. Be specific and technical.`
      const reply = await claudeChat(systemPrompt, newMsgs)
      setChatMessages([...newMsgs, { role: 'assistant' as const, content: reply }])
    } catch (err) {
      setChatMessages([...newMsgs, { role: 'assistant' as const, content: `Error: ${err instanceof Error ? err.message : 'Failed'}` }])
    } finally { setChatLoading(false) }
  }, [paper, chatMessages])

  const sendChat = useCallback(() => {
    if (!chatInput.trim() || chatLoading) return
    const msg = chatInput.trim()
    setChatInput('')
    handleDrill(msg)
  }, [chatInput, chatLoading, handleDrill])

  const handleAddNote = useCallback(() => {
    if (!noteContent.trim() || !paper) return
    saveNote.mutate({ paperId: paper.id, content: noteContent.trim(), noteType })
    setNoteContent('')
  }, [noteContent, noteType, paper, saveNote])

  if (isLoading) return <div className="loading-center">Loading paper...</div>
  if (isError || !paper) return <div className="loading-center" style={{ color: 'var(--coral)' }}>Paper not found</div>

  const analysis = paper.analysis as DeepAnalysis | null

  return (
    <>
      <div className="page-header">
        <div className="breadcrumb">
          <button onClick={() => navigate('/')} style={{ color: 'var(--text3)' }}>Feed</button>
          <span className="breadcrumb-sep">/</span>
          <span style={{ color: 'var(--text2)' }}>{paper.title.slice(0, 40)}...</span>
        </div>
        <div className="page-actions">
          <button className={`btn btn-sm ${isSaved ? 'btn-primary' : ''}`} onClick={() => toggleSave.mutate({ paperId: paper.id, saved: isSaved })}>
            {isSaved ? 'Saved' : 'Save'}
          </button>
          {isSaved && (
            <button className="btn btn-sm" onClick={() => updateStatus.mutate({ paperId: paper.id, status: 'done' })} style={{ color: 'var(--green)' }}>
              Mark Read
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setChatOpen(!chatOpen)}>
            {chatOpen ? 'Hide Chat' : 'Ask AI'}
          </button>
          {paper.url && <a href={paper.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm">Source ↗</a>}
        </div>
      </div>

      <div className="article-reader">
        {/* Hero */}
        <div className="ar-hero">
          <div className="ar-meta">
            <TagPill label={paper.source} source />
            {paper.category && <TagPill label={paper.category} />}
            {paper.year && <TagPill label={String(paper.year)} />}
            {paper.tags?.slice(0, 4).map((t, i) => <TagPill key={i} label={t} />)}
          </div>
          <h1 className="ar-title">{paper.title}</h1>
          {paper.authors && <p style={{ fontSize: '0.87rem', color: 'var(--text2)', marginTop: '-4px' }}>{paper.authors}</p>}
          {paper.abstract && <p className="ar-summary">{paper.abstract}</p>}
        </div>

        {/* Tabs: Analysis | Notes */}
        <div className="tabs" style={{ marginBottom: '20px', background: 'transparent', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <button className={`tab ${activeTab === 'analysis' ? 'active' : ''}`} onClick={() => setActiveTab('analysis')}>
            Deep Analysis {analysis ? '✓' : ''}
          </button>
          <button className={`tab ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>
            Notes ({notes.length})
          </button>
        </div>

        {activeTab === 'analysis' && (
          <>
            {/* Analyze prompt */}
            {!analysis && (
              <div className="ar-analyze-prompt">
                <div>
                  <div style={{ fontWeight: 650, fontSize: '0.95rem', marginBottom: '4px' }}>Generate Deep Read</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
                    Multi-pass AI analysis: structural extraction, critical reading, and expert enrichment.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={mode} onChange={(e) => setMode(e.target.value as ReadingMode)} style={{ minWidth: '140px' }}>
                    <option value="researcher">Researcher</option>
                    <option value="practitioner">Practitioner</option>
                    <option value="layperson">Curious Layperson</option>
                  </select>
                  <button className="btn btn-primary" onClick={handleAnalyze} disabled={analyzing}>
                    {analyzing ? progress || 'Analyzing...' : 'Analyze'}
                  </button>
                </div>
              </div>
            )}

            {analysis && (
              <div className="ar-reanalyze">
                <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>Mode: {analysis.readingMode ?? 'researcher'}</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <select value={mode} onChange={(e) => setMode(e.target.value as ReadingMode)} style={{ fontSize: '0.78rem', padding: '3px 8px' }}>
                    <option value="researcher">Researcher</option>
                    <option value="practitioner">Practitioner</option>
                    <option value="layperson">Layperson</option>
                  </select>
                  <button className="btn btn-sm" onClick={handleAnalyze} disabled={analyzing}>
                    {analyzing ? progress || '...' : 'Re-analyze'}
                  </button>
                </div>
              </div>
            )}

            {/* Analysis sections */}
            {analysis && (
              <div className="ar-sections">
                {SECTION_META.map(({ key, label, icon, drillPrompt }) => {
                  const text = analysis[key]
                  if (!text) return null
                  return (
                    <div key={key} className="ar-section">
                      <div className="ar-section-header">
                        <span className="ar-section-icon">{icon}</span>
                        <span className="ar-section-label">{label}</span>
                        {drillPrompt && (
                          <button className="ar-drill-btn" onClick={() => handleDrill(drillPrompt)}>Explore ↓</button>
                        )}
                      </div>
                      <div className="ar-section-body" dangerouslySetInnerHTML={{ __html: formatSection(text) }} />
                    </div>
                  )
                })}

                {((analysis.noveltySignals?.length ?? 0) > 0 || (analysis.hedgingSignals?.length ?? 0) > 0 || (analysis.cherryPickRisks?.length ?? 0) > 0) && (
                  <div className="ar-signals">
                    <div className="ar-section-header">
                      <span className="ar-section-icon">🔍</span>
                      <span className="ar-section-label">Critical Signals</span>
                    </div>
                    {(analysis.noveltySignals?.length ?? 0) > 0 && (
                      <div className="ar-signal-group">
                        <div className="ar-signal-title" style={{ color: 'var(--accent)' }}>Novelty Claims</div>
                        <div className="ar-signal-items">{analysis.noveltySignals!.map((s, i) => <span key={i} className="ar-signal novelty">"{s}"</span>)}</div>
                      </div>
                    )}
                    {(analysis.hedgingSignals?.length ?? 0) > 0 && (
                      <div className="ar-signal-group">
                        <div className="ar-signal-title" style={{ color: 'var(--amber)' }}>Hedging Language</div>
                        <div className="ar-signal-items">{analysis.hedgingSignals!.map((s, i) => <span key={i} className="ar-signal hedging">"{s}"</span>)}</div>
                      </div>
                    )}
                    {(analysis.cherryPickRisks?.length ?? 0) > 0 && (
                      <div className="ar-signal-group">
                        <div className="ar-signal-title" style={{ color: 'var(--coral)' }}>Watch For</div>
                        <div className="ar-signal-items">{analysis.cherryPickRisks!.map((s, i) => <span key={i} className="ar-signal risk">{s}</span>)}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* No analysis, show basic digest as fallback */}
            {!analysis && (paper.problem || paper.method || paper.finding) && (
              <div className="ar-sections">
                {paper.problem && (
                  <div className="ar-section">
                    <div className="ar-section-header"><span className="ar-section-icon">🎯</span><span className="ar-section-label">Problem</span></div>
                    <div className="ar-section-body">{paper.problem}</div>
                  </div>
                )}
                {paper.method && (
                  <div className="ar-section">
                    <div className="ar-section-header"><span className="ar-section-icon">💡</span><span className="ar-section-label">Method</span></div>
                    <div className="ar-section-body">{paper.method}</div>
                  </div>
                )}
                {paper.finding && (
                  <div className="ar-section">
                    <div className="ar-section-header"><span className="ar-section-icon">📊</span><span className="ar-section-label">Finding</span></div>
                    <div className="ar-section-body">{paper.finding}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Notes tab */}
        {activeTab === 'notes' && (
          <div>
            <div className="notes-input" style={{ background: 'var(--bg)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', marginBottom: '16px' }}>
              <div className="note-type-selector">
                {(['note', 'insight', 'question', 'highlight'] as NoteType[]).map((type) => (
                  <button
                    key={type}
                    className={`note-type-btn ${noteType === type ? 'active' : ''}`}
                    style={noteType === type ? { color: type === 'note' ? 'var(--accent)' : type === 'insight' ? 'var(--green)' : type === 'question' ? 'var(--amber)' : 'var(--coral)' } : undefined}
                    onClick={() => setNoteType(type)}
                  >{type}</button>
                ))}
              </div>
              <textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} placeholder="Write a note..." />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-primary" onClick={handleAddNote} disabled={!noteContent.trim()}>Add Note</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {notes.map((note) => <NoteCard key={note.id} note={note} />)}
              {notes.length === 0 && <div style={{ color: 'var(--text3)', fontSize: '0.85rem', textAlign: 'center', padding: '40px 0' }}>No notes yet.</div>}
            </div>
          </div>
        )}

        {/* Chat */}
        {chatOpen && (
          <div className="ar-chat" ref={chatRef}>
            <div className="ar-chat-header">
              <span style={{ fontWeight: 600, fontSize: '0.87rem' }}>Ask about this paper</span>
              <button className="btn btn-sm" onClick={() => setChatOpen(false)}>Close</button>
            </div>
            <div className="qa-messages" style={{ maxHeight: '350px' }}>
              {chatMessages.length === 0 && <div style={{ color: 'var(--text3)', fontSize: '0.85rem', textAlign: 'center', padding: '24px 0' }}>Ask anything, or click "Explore ↓" on any section above.</div>}
              {chatMessages.map((msg, i) => (
                <div key={i} className="qa-message">
                  <div className={`qa-avatar ${msg.role}`}>{msg.role === 'user' ? 'U' : 'AI'}</div>
                  <div className="qa-bubble" dangerouslySetInnerHTML={{ __html: msg.content }} />
                </div>
              ))}
              {chatLoading && <div className="qa-message"><div className="qa-avatar assistant">AI</div><div className="typing-indicator"><span /><span /><span /></div></div>}
            </div>
            <div className="qa-input-area">
              <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }} placeholder="Ask a question..." rows={1} disabled={chatLoading} />
              <button className="btn btn-primary" onClick={sendChat} disabled={chatLoading || !chatInput.trim()}>Send</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default ReaderPage
