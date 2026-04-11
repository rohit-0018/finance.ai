import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { dbGetArticle, dbUpdateArticleAnalysis } from '../lib/supabase'
import { deepExtractArticle, articleChat } from '../lib/anthropic'
import { useAppStore } from '../store'
import type { Article, DeepAnalysis } from '../types'
import TagPill from '../components/TagPill'
import { UploaderBadge } from '../components/Avatar'
import { formatRelative } from '../lib/utils'
import toast from 'react-hot-toast'

type ReadingMode = 'researcher' | 'practitioner' | 'layperson'

type SectionKey =
  | 'tldr' | 'longSummary' | 'coreProblem' | 'proposedSolution'
  | 'evidence' | 'implications' | 'limitations' | 'fieldContext'

const SECTION_META: Array<{
  key: SectionKey
  label: string
  icon: string
  color: string
  drillPrompt: string
}> = [
  { key: 'tldr', label: 'TL;DR', icon: '📋', color: 'var(--text2)', drillPrompt: '' },
  { key: 'longSummary', label: 'The Cream', icon: '🥛', color: 'var(--accent)', drillPrompt: 'Go even deeper on the most important parts of this article' },
  { key: 'coreProblem', label: 'Core Problem', icon: '🎯', color: 'var(--coral)', drillPrompt: 'Explain the core problem in more detail. What are the technical specifics?' },
  { key: 'proposedSolution', label: 'The Solution', icon: '💡', color: 'var(--accent)', drillPrompt: 'Break down the solution step by step. How does it actually work?' },
  { key: 'evidence', label: 'Evidence', icon: '📊', color: 'var(--green)', drillPrompt: 'Analyze the evidence more critically. Are these results convincing?' },
  { key: 'implications', label: 'Real-World Impact', icon: '🌍', color: 'var(--teal)', drillPrompt: 'Give me more concrete examples of who benefits and how' },
  { key: 'limitations', label: 'Honest Limitations', icon: '⚠️', color: 'var(--amber)', drillPrompt: 'What are the deepest concerns with this work?' },
  { key: 'fieldContext', label: 'Where It Fits', icon: '🗺️', color: 'var(--accent)', drillPrompt: 'Map this against the most important related work in the field' },
]

type ConceptTierFilter = 'all' | 'foundational' | 'intermediate' | 'implementation' | 'expert'

const TIER_META: Record<'foundational' | 'intermediate' | 'implementation' | 'expert', { label: string; color: string }> = {
  foundational: { label: 'Foundational', color: 'var(--green)' },
  intermediate: { label: 'Intermediate', color: 'var(--teal)' },
  implementation: { label: 'Implementation', color: 'var(--accent)' },
  expert: { label: 'Expert', color: 'var(--amber)' },
}

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
  const [tierFilter, setTierFilter] = useState<ConceptTierFilter>('all')
  const [expandedConcept, setExpandedConcept] = useState<string | null>(null)
  const [readProgress, setReadProgress] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    const handler = () => {
      const el = contentRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      const height = el.offsetHeight
      const viewport = window.innerHeight
      const scrolled = Math.max(0, viewport - top)
      const total = height + viewport
      setReadProgress(Math.min(100, Math.round((scrolled / total) * 100)))
    }
    window.addEventListener('scroll', handler, { passive: true })
    handler()
    return () => window.removeEventListener('scroll', handler)
  }, [article])

  const handleAnalyze = useCallback(async () => {
    if (!article) return
    setAnalyzing(true)
    try {
      const result = await deepExtractArticle(article.title, article.content, setProgress)
      await dbUpdateArticleAnalysis(article.id, result.analysis, result.summary)
      setArticle({ ...article, analysis: result.analysis, summary: result.summary })
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

      {/* Read progress bar */}
      <div className="ar-progress-bar">
        <div className="ar-progress-fill" style={{ width: `${readProgress}%` }} />
      </div>

      <div className="article-reader" ref={contentRef}>
        {/* Title block */}
        <div className="ar-hero">
          <div className="ar-meta">
            <TagPill label={article.topic} />
            {(article.tags as string[]).slice(0, 4).map((tag) => (
              <TagPill key={tag} label={tag} />
            ))}
            <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>{formatRelative(article.created_at)}</span>
            {analysis?.estimatedReadMinutes && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>· {analysis.estimatedReadMinutes} min read</span>
            )}
            {analysis?.concepts && analysis.concepts.length > 0 && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>· {analysis.concepts.length} concepts</span>
            )}
          </div>
          <h1 className="ar-title">{article.title}</h1>
          {article.uploader && !article.uploader.is_admin && (
            <div style={{ marginTop: 10 }}>
              <UploaderBadge uploader={article.uploader} size={28} />
            </div>
          )}
          {analysis?.hook && (
            <p className="ar-summary" style={{ fontStyle: 'italic', opacity: 0.92 }}
               dangerouslySetInnerHTML={{ __html: formatSection(analysis.hook) }} />
          )}
          {!analysis?.hook && article.summary && (
            <p className="ar-summary">{article.summary.slice(0, 400)}{article.summary.length > 400 ? '…' : ''}</p>
          )}
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
            {/* Table of Contents */}
            <div className="ar-toc">
              <div className="ar-toc-title">In this teardown</div>
              <div className="ar-toc-grid">
                {analysis.longSummary && <a href="#sec-cream" className="ar-toc-link">🥛 The Cream</a>}
                {analysis.concepts && analysis.concepts.length > 0 && <a href="#sec-concepts" className="ar-toc-link">🧠 Concepts ({analysis.concepts.length})</a>}
                {analysis.mentalModels && analysis.mentalModels.length > 0 && <a href="#sec-models" className="ar-toc-link">🧭 Mental Models</a>}
                {analysis.tradeoffs && analysis.tradeoffs.length > 0 && <a href="#sec-tradeoffs" className="ar-toc-link">⚖️ Tradeoffs</a>}
                {analysis.architectureFlows && analysis.architectureFlows.length > 0 && <a href="#sec-flows" className="ar-toc-link">🔀 Architecture Flows</a>}
                {analysis.failureModes && analysis.failureModes.length > 0 && <a href="#sec-failures" className="ar-toc-link">💥 Failure Modes</a>}
                {analysis.expertJudgment && analysis.expertJudgment.length > 0 && <a href="#sec-judgment" className="ar-toc-link">🎓 Expert Judgment</a>}
                {analysis.hiddenCosts && analysis.hiddenCosts.length > 0 && <a href="#sec-costs" className="ar-toc-link">🕳️ Hidden Costs</a>}
                {(analysis.whenToUse?.length || analysis.whenNotToUse?.length) && <a href="#sec-when" className="ar-toc-link">✅ When to Use</a>}
                {analysis.principles && analysis.principles.length > 0 && <a href="#sec-principles" className="ar-toc-link">📏 Principles</a>}
              </div>
            </div>

            {SECTION_META.map(({ key, label, icon, color, drillPrompt }) => {
              const text = analysis[key]
              if (!text) return null
              return (
                <div key={key} id={key === 'longSummary' ? 'sec-cream' : undefined} className="ar-section" style={{ '--section-color': color } as React.CSSProperties}>
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

            {/* Key Points — every important idea, ordered */}
            {analysis.keyPoints && analysis.keyPoints.length > 0 && (
              <div className="ar-section" style={{ '--section-color': 'var(--accent)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">🔑</span>
                  <span className="ar-section-label">Key Points</span>
                </div>
                <ul className="ar-section-body" style={{ paddingLeft: 20, margin: 0 }}>
                  {analysis.keyPoints.map((p, i) => (
                    <li key={i} style={{ marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: formatSection(p) }} />
                  ))}
                </ul>
              </div>
            )}

            {/* Takeaways */}
            {analysis.takeaways && analysis.takeaways.length > 0 && (
              <div className="ar-section" style={{ '--section-color': 'var(--green)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">✅</span>
                  <span className="ar-section-label">Takeaways</span>
                </div>
                <ul className="ar-section-body" style={{ paddingLeft: 20, margin: 0 }}>
                  {analysis.takeaways.map((p, i) => (
                    <li key={i} style={{ marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: formatSection(p) }} />
                  ))}
                </ul>
              </div>
            )}

            {/* Key Numbers */}
            {analysis.keyNumbers && analysis.keyNumbers.length > 0 && (
              <div className="ar-section" style={{ '--section-color': 'var(--teal)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">🔢</span>
                  <span className="ar-section-label">Key Numbers</span>
                </div>
                <ul className="ar-section-body" style={{ paddingLeft: 20, margin: 0 }}>
                  {analysis.keyNumbers.map((p, i) => (
                    <li key={i} style={{ marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: formatSection(p) }} />
                  ))}
                </ul>
              </div>
            )}

            {/* Notable Quotes */}
            {analysis.quotes && analysis.quotes.length > 0 && (
              <div className="ar-section" style={{ '--section-color': 'var(--amber)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">❝</span>
                  <span className="ar-section-label">Notable Quotes</span>
                </div>
                <div className="ar-section-body">
                  {analysis.quotes.map((q, i) => (
                    <blockquote key={i} style={{ borderLeft: '3px solid var(--amber)', paddingLeft: 12, margin: '8px 0', fontStyle: 'italic', color: 'var(--text2)' }}>
                      "{q}"
                    </blockquote>
                  ))}
                </div>
              </div>
            )}

            {/* Concepts — tier-filtered, expandable cards */}
            {analysis.concepts && analysis.concepts.length > 0 && (
              <div id="sec-concepts" className="ar-section" style={{ '--section-color': 'var(--accent)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">🧠</span>
                  <span className="ar-section-label">Concepts ({analysis.concepts.length})</span>
                  <div className="ar-tier-filter">
                    {(['all', 'foundational', 'intermediate', 'implementation', 'expert'] as ConceptTierFilter[]).map((t) => (
                      <button
                        key={t}
                        className={`ar-tier-chip ${tierFilter === t ? 'active' : ''}`}
                        onClick={() => setTierFilter(t)}
                      >
                        {t === 'all' ? 'All' : TIER_META[t].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ar-concepts-grid">
                  {analysis.concepts
                    .filter((c) => tierFilter === 'all' || c.tier === tierFilter)
                    .map((c, i) => {
                      const tier = TIER_META[c.tier] ?? TIER_META.intermediate
                      const isOpen = expandedConcept === c.name
                      return (
                        <div key={`${c.name}-${i}`} className={`ar-concept-card ${isOpen ? 'open' : ''}`}>
                          <button
                            className="ar-concept-head"
                            onClick={() => setExpandedConcept(isOpen ? null : c.name)}
                          >
                            <span className="ar-concept-name">{c.name}</span>
                            <span className="ar-tier-pill" style={{ background: tier.color }}>{tier.label}</span>
                          </button>
                          <div className="ar-concept-oneliner">{c.oneLiner}</div>
                          {isOpen && (
                            <div className="ar-concept-deep">
                              <div dangerouslySetInnerHTML={{ __html: formatSection(c.deepDive) }} />
                              {c.analogy && (
                                <div className="ar-concept-analogy">
                                  <strong>Analogy.</strong> {c.analogy}
                                </div>
                              )}
                              {c.example && (
                                <div className="ar-concept-example">
                                  <strong>Example.</strong> {c.example}
                                </div>
                              )}
                              {c.prerequisites && c.prerequisites.length > 0 && (
                                <div className="ar-concept-prereq">
                                  <strong>Prereqs:</strong> {c.prerequisites.join(' · ')}
                                </div>
                              )}
                              {c.relatedConcepts && c.relatedConcepts.length > 0 && (
                                <div className="ar-concept-related">
                                  <strong>Related:</strong>{' '}
                                  {c.relatedConcepts.map((r, j) => (
                                    <button key={j} className="ar-concept-link" onClick={() => setExpandedConcept(r)}>{r}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            )}

            {/* Mental Models */}
            {analysis.mentalModels && analysis.mentalModels.length > 0 && (
              <div id="sec-models" className="ar-section" style={{ '--section-color': 'var(--teal)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">🧭</span>
                  <span className="ar-section-label">Mental Models</span>
                </div>
                <div className="ar-models-grid">
                  {analysis.mentalModels.map((m, i) => (
                    <div key={i} className="ar-model-card">
                      <div className="ar-model-name">{m.name}</div>
                      <div className="ar-model-intuition">{m.intuition}</div>
                      <div className="ar-model-why"><strong>Why it helps:</strong> {m.whyItHelps}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tradeoffs */}
            {analysis.tradeoffs && analysis.tradeoffs.length > 0 && (
              <div id="sec-tradeoffs" className="ar-section" style={{ '--section-color': 'var(--amber)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">⚖️</span>
                  <span className="ar-section-label">Tradeoffs</span>
                </div>
                <div className="ar-tradeoffs">
                  {analysis.tradeoffs.map((t, i) => (
                    <div key={i} className="ar-tradeoff">
                      <div className="ar-tradeoff-decision">{t.decision}</div>
                      <div className="ar-tradeoff-axis">{t.axis}</div>
                      <div className="ar-tradeoff-cols">
                        <div className="ar-tradeoff-col">
                          <div className="ar-tradeoff-opt">{t.optionA}</div>
                          <div className="ar-tradeoff-when"><strong>Pick when:</strong> {t.whenA}</div>
                        </div>
                        <div className="ar-tradeoff-vs">vs</div>
                        <div className="ar-tradeoff-col">
                          <div className="ar-tradeoff-opt">{t.optionB}</div>
                          <div className="ar-tradeoff-when"><strong>Pick when:</strong> {t.whenB}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Architecture Flows */}
            {analysis.architectureFlows && analysis.architectureFlows.length > 0 && (
              <div id="sec-flows" className="ar-section" style={{ '--section-color': 'var(--accent)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">🔀</span>
                  <span className="ar-section-label">Architecture Flows</span>
                </div>
                <div className="ar-flows">
                  {analysis.architectureFlows.map((f, i) => (
                    <div key={i} className="ar-flow">
                      <div className="ar-flow-name">{f.name}</div>
                      <div className="ar-flow-purpose">{f.purpose}</div>
                      <div className="ar-flow-steps">
                        {f.steps.map((s, j) => (
                          <React.Fragment key={j}>
                            <div className="ar-flow-step">{s}</div>
                            {j < f.steps.length - 1 && <div className="ar-flow-arrow">→</div>}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Failure Modes */}
            {analysis.failureModes && analysis.failureModes.length > 0 && (
              <div id="sec-failures" className="ar-section" style={{ '--section-color': 'var(--coral)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">💥</span>
                  <span className="ar-section-label">Failure Modes</span>
                </div>
                <div className="ar-failures">
                  {analysis.failureModes.map((f, i) => (
                    <div key={i} className="ar-failure">
                      <div className="ar-failure-mode">{f.mode}</div>
                      <div className="ar-failure-mitigation"><strong>Mitigation:</strong> {f.mitigation}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Expert Judgment */}
            {analysis.expertJudgment && analysis.expertJudgment.length > 0 && (
              <div id="sec-judgment" className="ar-section" style={{ '--section-color': 'var(--amber)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">🎓</span>
                  <span className="ar-section-label">Expert Judgment</span>
                </div>
                <div className="ar-judgment-list">
                  {analysis.expertJudgment.map((r, i) => (
                    <div key={i} className="ar-judgment">
                      <div className="ar-judgment-rule">{r.rule}</div>
                      <div className="ar-judgment-reason"><strong>Why:</strong> {r.reason}</div>
                      {r.example && <div className="ar-judgment-example"><strong>Example:</strong> {r.example}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hidden Costs + Common Mistakes */}
            {((analysis.hiddenCosts?.length ?? 0) > 0 || (analysis.commonMistakes?.length ?? 0) > 0) && (
              <div id="sec-costs" className="ar-section" style={{ '--section-color': 'var(--coral)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">🕳️</span>
                  <span className="ar-section-label">Hidden Costs & Common Mistakes</span>
                </div>
                <div className="ar-section-body">
                  {(analysis.hiddenCosts?.length ?? 0) > 0 && (
                    <>
                      <div className="ar-sub-label">Hidden Costs</div>
                      <ul style={{ paddingLeft: 18, margin: '0 0 12px 0' }}>
                        {analysis.hiddenCosts!.map((c, i) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}
                      </ul>
                    </>
                  )}
                  {(analysis.commonMistakes?.length ?? 0) > 0 && (
                    <>
                      <div className="ar-sub-label">Common Mistakes</div>
                      <ul style={{ paddingLeft: 18, margin: 0 }}>
                        {analysis.commonMistakes!.map((c, i) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* When to Use / When Not to Use */}
            {((analysis.whenToUse?.length ?? 0) > 0 || (analysis.whenNotToUse?.length ?? 0) > 0) && (
              <div id="sec-when" className="ar-section" style={{ '--section-color': 'var(--green)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">✅</span>
                  <span className="ar-section-label">When to Use / When Not</span>
                </div>
                <div className="ar-when-grid">
                  <div className="ar-when-col good">
                    <div className="ar-when-title">Good fit</div>
                    <ul>{(analysis.whenToUse ?? []).map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                  <div className="ar-when-col bad">
                    <div className="ar-when-title">Bad fit</div>
                    <ul>{(analysis.whenNotToUse ?? []).map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                </div>
              </div>
            )}

            {/* Principles */}
            {analysis.principles && analysis.principles.length > 0 && (
              <div id="sec-principles" className="ar-section" style={{ '--section-color': 'var(--teal)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">📏</span>
                  <span className="ar-section-label">Principles</span>
                </div>
                <ul className="ar-section-body" style={{ paddingLeft: 20, margin: 0 }}>
                  {analysis.principles.map((p, i) => (
                    <li key={i} style={{ marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: formatSection(p) }} />
                  ))}
                </ul>
              </div>
            )}

            {/* Prerequisites */}
            {analysis.prerequisiteMap && analysis.prerequisiteMap.length > 0 && (
              <div className="ar-section" style={{ '--section-color': 'var(--text3)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">🧩</span>
                  <span className="ar-section-label">Know This First</span>
                </div>
                <div className="ar-section-body">
                  <div className="ar-prereq-chips">
                    {analysis.prerequisiteMap.map((p, i) => (
                      <span key={i} className="ar-prereq-chip">{p}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Further Reading */}
            {analysis.furtherReading && analysis.furtherReading.length > 0 && (
              <div className="ar-section" style={{ '--section-color': 'var(--accent)' } as React.CSSProperties}>
                <div className="ar-section-header">
                  <span className="ar-section-icon">📚</span>
                  <span className="ar-section-label">Further Reading</span>
                </div>
                <ul className="ar-section-body" style={{ paddingLeft: 20, margin: 0 }}>
                  {analysis.furtherReading.map((r, i) => (
                    <li key={i} style={{ marginBottom: 8 }}>
                      <strong>{r.title}</strong> — <span style={{ color: 'var(--text3)' }}>{r.why}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Signals */}
            {((analysis.noveltySignals?.length ?? 0) > 0 || (analysis.hedgingSignals?.length ?? 0) > 0 || (analysis.cherryPickRisks?.length ?? 0) > 0) && (
              <div className="ar-signals">
                <div className="ar-section-header">
                  <span className="ar-section-icon">🔍</span>
                  <span className="ar-section-label">Critical Signals</span>
                </div>
                {(analysis.noveltySignals?.length ?? 0) > 0 && (
                  <div className="ar-signal-group">
                    <div className="ar-signal-title" style={{ color: 'var(--accent)' }}>Novelty Claims</div>
                    <div className="ar-signal-items">
                      {analysis.noveltySignals!.map((s, i) => (
                        <span key={i} className="ar-signal novelty">"{s}"</span>
                      ))}
                    </div>
                  </div>
                )}
                {(analysis.hedgingSignals?.length ?? 0) > 0 && (
                  <div className="ar-signal-group">
                    <div className="ar-signal-title" style={{ color: 'var(--amber)' }}>Hedging Language</div>
                    <div className="ar-signal-items">
                      {analysis.hedgingSignals!.map((s, i) => (
                        <span key={i} className="ar-signal hedging">"{s}"</span>
                      ))}
                    </div>
                  </div>
                )}
                {(analysis.cherryPickRisks?.length ?? 0) > 0 && (
                  <div className="ar-signal-group">
                    <div className="ar-signal-title" style={{ color: 'var(--coral)' }}>Watch For</div>
                    <div className="ar-signal-items">
                      {analysis.cherryPickRisks!.map((s, i) => (
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
