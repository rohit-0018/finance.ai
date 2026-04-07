import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { dbGetArticle, dbUpdateArticleAnalysis } from '../lib/supabase'
import { generateDeepAnalysis, articleChat } from '../lib/anthropic'
import { useAppStore } from '../store'
import type { Article, DeepAnalysis } from '../types'
import TagPill from '../components/TagPill'
import { formatRelative } from '../lib/utils'
import toast from 'react-hot-toast'

type ReadingMode = 'researcher' | 'practitioner' | 'layperson'

const SECTION_META: Array<{
  key: keyof Omit<DeepAnalysis, 'noveltySignals' | 'hedgingSignals' | 'cherryPickRisks' | 'readingMode'>
  label: string
  icon: string
  color: string
  drillPrompt: string
}> = [
  { key: 'hook', label: 'The Hook', icon: '⚡', color: 'var(--amber)', drillPrompt: 'Tell me more about the historical context and what prompted this research' },
  { key: 'coreProblem', label: 'Core Problem', icon: '🎯', color: 'var(--coral)', drillPrompt: 'Explain the core problem in more detail. What are the technical specifics?' },
  { key: 'proposedSolution', label: 'The Solution', icon: '💡', color: 'var(--accent)', drillPrompt: 'Break down the solution step by step. How does it actually work?' },
  { key: 'evidence', label: 'Evidence', icon: '📊', color: 'var(--green)', drillPrompt: 'Analyze the evidence more critically. Are these results convincing?' },
  { key: 'implications', label: 'Real-World Impact', icon: '🌍', color: 'var(--teal)', drillPrompt: 'Give me more concrete examples of who benefits and how' },
  { key: 'limitations', label: 'Honest Limitations', icon: '⚠️', color: 'var(--amber)', drillPrompt: 'What are the deepest concerns with this work?' },
  { key: 'fieldContext', label: 'Where It Fits', icon: '🗺️', color: 'var(--accent)', drillPrompt: 'Map this against the most important related work in the field' },
  { key: 'tldr', label: 'TL;DR', icon: '📋', color: 'var(--text2)', drillPrompt: '' },
]

const ArticleReaderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const currentUserId = useAppStore((s) => s.currentUser?.id)
  const isAdmin = useAppStore((s) => s.isAdmin)
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState('')
  const [mode, setMode] = useState<ReadingMode>('researcher')

  // Chat
  const chatRef = useRef<HTMLDivElement>(null)
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    dbGetArticle(id)
      .then((a) => {
        // Visibility guard: private articles are only readable by their owner
        // (or an admin); pending public articles only by their submitter or admin.
        const isOwner = a.added_by && a.added_by === currentUserId
        const allowed = isAdmin() || isOwner || (!a.is_private && a.approved)
        if (!allowed) {
          toast.error('You do not have access to this article')
          navigate('/articles')
          return
        }
        setArticle(a)
      })
      .catch(() => toast.error('Article not found'))
      .finally(() => setLoading(false))
  }, [id, currentUserId, isAdmin, navigate])

  const handleAnalyze = useCallback(async () => {
    if (!article) return
    setAnalyzing(true)
    try {
      const analysis = await generateDeepAnalysis(article.title, article.content, mode, setProgress)
      await dbUpdateArticleAnalysis(article.id, analysis)
      setArticle({ ...article, analysis })
      toast.success('Deep analysis complete!')
    } catch (err) {
      console.error('Analysis failed:', err)
      toast.error(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
      setProgress('')
    }
  }, [article, mode])

  const handleDrill = useCallback(async (prompt: string) => {
    if (!article) return
    setChatOpen(true)
    setTimeout(() => chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    const newMessages = [...chatMessages, { role: 'user' as const, content: prompt }]
    setChatMessages(newMessages)
    setChatLoading(true)
    try {
      const reply = await articleChat(
        { title: article.title, content: article.content, summary: article.summary, analysis: article.analysis },
        newMessages
      )
      setChatMessages([...newMessages, { role: 'assistant' as const, content: reply }])
    } catch (err) {
      setChatMessages([...newMessages, { role: 'assistant' as const, content: `Error: ${err instanceof Error ? err.message : 'Failed'}` }])
    } finally {
      setChatLoading(false)
    }
  }, [article, chatMessages])

  const sendChat = useCallback(async () => {
    if (!article || !chatInput.trim() || chatLoading) return
    const msg = chatInput.trim()
    setChatInput('')
    handleDrill(msg)
  }, [article, chatInput, chatLoading, handleDrill])

  if (loading) return <div className="loading-center">Loading article...</div>
  if (!article) return <div className="loading-center" style={{ color: 'var(--coral)' }}>Article not found</div>

  const analysis = article.analysis as DeepAnalysis | null

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumb">
          <button onClick={() => navigate('/articles')} style={{ color: 'var(--text3)' }}>Articles</button>
          <span className="breadcrumb-sep">/</span>
          <span style={{ color: 'var(--text2)' }}>{article.title.slice(0, 40)}...</span>
        </div>
        <div className="page-actions">
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm">Source ↗</a>
          <button className="btn btn-sm" onClick={() => setChatOpen(!chatOpen)}>
            {chatOpen ? 'Hide Chat' : 'Ask AI'}
          </button>
        </div>
      </div>

      <div className="article-reader">
        {/* Title block */}
        <div className="ar-hero">
          <div className="ar-meta">
            <TagPill label={article.topic} />
            {(article.tags as string[]).slice(0, 4).map((tag) => (
              <TagPill key={tag} label={tag} />
            ))}
            <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>{formatRelative(article.created_at)}</span>
          </div>
          <h1 className="ar-title">{article.title}</h1>
          {article.summary && <p className="ar-summary">{article.summary}</p>}
        </div>

        {/* Analysis controls */}
        {!analysis && (
          <div className="ar-analyze-prompt">
            <div>
              <div style={{ fontWeight: 650, fontSize: '0.95rem', marginBottom: '4px' }}>Generate Deep Read</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
                Multi-pass AI analysis: structural scan, critical extraction, and expert enrichment.
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

        {/* Re-analyze option */}
        {analysis && (
          <div className="ar-reanalyze">
            <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
              Mode: {analysis.readingMode ?? 'researcher'}
            </span>
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
            {SECTION_META.map(({ key, label, icon, color, drillPrompt }) => {
              const text = analysis[key]
              if (!text) return null
              return (
                <div key={key} className="ar-section" style={{ '--section-color': color } as React.CSSProperties}>
                  <div className="ar-section-header">
                    <span className="ar-section-icon">{icon}</span>
                    <span className="ar-section-label">{label}</span>
                    {drillPrompt && (
                      <button
                        className="ar-drill-btn"
                        onClick={() => handleDrill(drillPrompt)}
                        title="Drill deeper"
                      >
                        Explore ↓
                      </button>
                    )}
                  </div>
                  <div
                    className="ar-section-body"
                    dangerouslySetInnerHTML={{
                      __html: formatSection(text),
                    }}
                  />
                </div>
              )
            })}

            {/* Signals */}
            {(analysis.noveltySignals.length > 0 || analysis.hedgingSignals.length > 0 || analysis.cherryPickRisks.length > 0) && (
              <div className="ar-signals">
                <div className="ar-section-header">
                  <span className="ar-section-icon">🔍</span>
                  <span className="ar-section-label">Critical Signals</span>
                </div>
                {analysis.noveltySignals.length > 0 && (
                  <div className="ar-signal-group">
                    <div className="ar-signal-title" style={{ color: 'var(--accent)' }}>Novelty Claims</div>
                    <div className="ar-signal-items">
                      {analysis.noveltySignals.map((s, i) => (
                        <span key={i} className="ar-signal novelty">"{s}"</span>
                      ))}
                    </div>
                  </div>
                )}
                {analysis.hedgingSignals.length > 0 && (
                  <div className="ar-signal-group">
                    <div className="ar-signal-title" style={{ color: 'var(--amber)' }}>Hedging Language</div>
                    <div className="ar-signal-items">
                      {analysis.hedgingSignals.map((s, i) => (
                        <span key={i} className="ar-signal hedging">"{s}"</span>
                      ))}
                    </div>
                  </div>
                )}
                {analysis.cherryPickRisks.length > 0 && (
                  <div className="ar-signal-group">
                    <div className="ar-signal-title" style={{ color: 'var(--coral)' }}>Watch For</div>
                    <div className="ar-signal-items">
                      {analysis.cherryPickRisks.map((s, i) => (
                        <span key={i} className="ar-signal risk">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat panel */}
        {chatOpen && (
          <div className="ar-chat" ref={chatRef}>
            <div className="ar-chat-header">
              <span style={{ fontWeight: 600, fontSize: '0.87rem' }}>Ask about this article</span>
              <button className="btn btn-sm" onClick={() => setChatOpen(false)}>Close</button>
            </div>
            <div className="qa-messages" style={{ maxHeight: '350px' }}>
              {chatMessages.length === 0 && (
                <div style={{ color: 'var(--text3)', fontSize: '0.85rem', textAlign: 'center', padding: '24px 0' }}>
                  Ask anything, or click "Explore ↓" on any section above.
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className="qa-message">
                  <div className={`qa-avatar ${msg.role}`}>{msg.role === 'user' ? 'U' : 'AI'}</div>
                  <div className="qa-bubble" dangerouslySetInnerHTML={{ __html: msg.content }} />
                </div>
              ))}
              {chatLoading && (
                <div className="qa-message">
                  <div className="qa-avatar assistant">AI</div>
                  <div className="typing-indicator"><span /><span /><span /></div>
                </div>
              )}
            </div>
            <div className="qa-input-area">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                placeholder="Ask a question..."
                rows={1}
                disabled={chatLoading}
              />
              <button className="btn btn-primary" onClick={sendChat} disabled={chatLoading || !chatInput.trim()}>
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function formatSection(text: string): string {
  return text
    .replace(/\[PAPER\]/g, '<span class="source-label paper">PAPER</span>')
    .replace(/\[CONTEXT\]/g, '<span class="source-label context">CONTEXT</span>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>')
}

export default ArticleReaderPage
