import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import { dbGetArticles, dbSaveArticle, dbDeleteArticle } from '../lib/supabase'
import { summarizeArticle } from '../lib/anthropic'
import type { Article, DeepAnalysis } from '../types'
import { formatRelative, truncate } from '../lib/utils'
import TagPill from '../components/TagPill'
import toast from 'react-hot-toast'

// ---------- Extraction ----------

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
]

async function fetchPageContent(url: string): Promise<{ title: string; content: string }> {
  const errors: string[] = []

  for (const buildUrl of CORS_PROXIES) {
    const proxyUrl = buildUrl(url)
    const proxyName = proxyUrl.split('/')[2]
    try {
      console.log(`[Extract] Trying ${proxyName}...`)
      const res = await fetch(proxyUrl)
      if (!res.ok) { errors.push(`${proxyName}: HTTP ${res.status}`); continue }

      const html = await res.text()
      if (html.length < 200) { errors.push(`${proxyName}: too short (${html.length})`); continue }

      const doc = new DOMParser().parseFromString(html, 'text/html')
      doc.querySelectorAll('script,style,nav,footer,header,aside,iframe,svg,[role="navigation"],[role="banner"],.sidebar,.comments,.ad,.social-share').forEach((el) => el.remove())

      const title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
        ?? doc.querySelector('h1')?.textContent?.trim()
        ?? doc.querySelector('title')?.textContent?.trim()
        ?? url

      const selectors = ['article','[role="main"]','main','.post-content','.article-content','.entry-content','.post-body','.article-body','.content-body','.blog-post','.post','#content','.content','.body.markup','.available-content','.single-post']
      let content = ''
      for (const sel of selectors) {
        const el = doc.querySelector(sel)
        if (el) { content = el.textContent?.replace(/\s+/g, ' ').trim() ?? ''; if (content.length >= 100) break }
      }
      if (content.length < 100) content = doc.body?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      if (content.length < 100) { errors.push(`${proxyName}: content too short`); continue }

      return { title, content: content.slice(0, 15000) }
    } catch (err) {
      errors.push(`${proxyName}: ${err instanceof Error ? err.message : 'error'}`)
    }
  }
  throw new Error(`Extraction failed: ${errors.join(', ')}`)
}

// ---------- Component ----------

interface IngestResult { url: string; status: 'success' | 'error'; message: string }

const ArticlesPage: React.FC = () => {
  const navigate = useNavigate()
  const userId = useAppStore((s) => s.currentUser?.id)
  const isAdmin = useAppStore((s) => s.isAdmin)
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [urls, setUrls] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<IngestResult[]>([])
  const [showIngest, setShowIngest] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    dbGetArticles().then(setArticles).finally(() => setLoading(false))
  }, [])

  const handleIngest = useCallback(async () => {
    const urlList = urls.split('\n').map((u) => u.trim()).filter((u) => u.startsWith('http'))
    if (urlList.length === 0) { toast.error('Enter at least one valid URL'); return }

    setIngesting(true)
    setResults([])
    const newResults: IngestResult[] = []

    for (const url of urlList) {
      try {
        setProgress(`Extracting: ${new URL(url).hostname}`)
        const { title, content } = await fetchPageContent(url)
        setProgress(`Analyzing: ${title.slice(0, 40)}...`)
        const analysis = await summarizeArticle(title, content)
        const article = await dbSaveArticle({ url, title, content, summary: analysis.summary, topic: analysis.topic, tags: analysis.tags, addedBy: userId })
        setArticles((prev) => [article, ...prev.filter((a) => a.id !== article.id)])
        newResults.push({ url, status: 'success', message: title })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[Ingest] ${url}:`, msg)
        newResults.push({ url, status: 'error', message: msg })
        toast.error(`Failed: ${msg.split('\n')[0].slice(0, 60)}`)
      }
    }

    setResults(newResults)
    setIngesting(false)
    setProgress('')
    const ok = newResults.filter((r) => r.status === 'success').length
    if (ok > 0) toast.success(`${ok} article${ok > 1 ? 's' : ''} saved`)
    if (newResults.every((r) => r.status === 'success')) { setUrls(''); setShowIngest(false) }
  }, [urls, userId])

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('Delete this article?')) return
    try {
      await dbDeleteArticle(id)
      setArticles((prev) => prev.filter((a) => a.id !== id))
      toast.success('Deleted')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
  }, [])

  const filtered = search
    ? articles.filter((a) => a.title.toLowerCase().includes(search.toLowerCase()) || a.topic.toLowerCase().includes(search.toLowerCase()))
    : articles

  const analyzed = filtered.filter((a) => a.analysis)
  const unanalyzed = filtered.filter((a) => !a.analysis)

  return (
    <>
      <div className="page-header">
        <div className="page-title">Articles</div>
        <div className="page-actions">
          {isAdmin() && (
            <button className="btn btn-primary" onClick={() => setShowIngest(!showIngest)}>
              {showIngest ? 'Close' : '+ Add Articles'}
            </button>
          )}
        </div>
      </div>

      {/* Admin ingest panel */}
      {showIngest && isAdmin() && (
        <div className="al-ingest">
          <div className="al-ingest-inner">
            <div className="al-ingest-label">Paste article URLs (one per line)</div>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={'https://example.com/article-one\nhttps://blog.example.com/post-two'}
              rows={3}
            />
            <div className="al-ingest-bar">
              <button className="btn btn-primary" onClick={handleIngest} disabled={ingesting || !urls.trim()}>
                {ingesting ? progress || 'Processing...' : 'Extract & Save'}
              </button>
              {results.length > 0 && (
                <button className="btn btn-sm" onClick={() => setResults([])}>Clear log</button>
              )}
            </div>
            {results.length > 0 && (
              <div className="al-ingest-log">
                {results.map((r, i) => (
                  <div key={i} className={`al-log-row ${r.status}`}>
                    <span className="al-log-icon">{r.status === 'success' ? '✓' : '✗'}</span>
                    <span className="al-log-text">{r.status === 'success' ? r.message : `${r.url.slice(0, 50)} — ${r.message.split('\n')[0]}`}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search + count bar */}
      <div className="al-toolbar">
        <input
          type="text"
          placeholder="Search articles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="al-search"
        />
        <span className="al-count">{filtered.length} article{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="loading-center">Loading articles...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">A</div>
          <div className="empty-state-title">{search ? 'No matches' : 'No articles yet'}</div>
          <div className="empty-state-desc">
            {search ? 'Try a different search.' : isAdmin() ? 'Click "+ Add Articles" to start ingesting.' : 'Articles will appear here once an admin adds them.'}
          </div>
        </div>
      ) : (
        <div className="al-grid">
          {/* Analyzed articles first */}
          {analyzed.length > 0 && (
            <>
              {unanalyzed.length > 0 && <div className="al-section-label">Deep Reads</div>}
              {analyzed.map((article) => (
                <ArticleCard key={article.id} article={article} navigate={navigate} isAdmin={isAdmin()} onDelete={handleDelete} />
              ))}
            </>
          )}
          {unanalyzed.length > 0 && (
            <>
              {analyzed.length > 0 && <div className="al-section-label">Unanalyzed</div>}
              {unanalyzed.map((article) => (
                <ArticleCard key={article.id} article={article} navigate={navigate} isAdmin={isAdmin()} onDelete={handleDelete} />
              ))}
            </>
          )}
        </div>
      )}
    </>
  )
}

// ---------- Article Card ----------

const ArticleCard: React.FC<{
  article: Article
  navigate: ReturnType<typeof useNavigate>
  isAdmin: boolean
  onDelete: (id: string) => void
}> = ({ article, navigate, isAdmin, onDelete }) => {
  const analysis = article.analysis as DeepAnalysis | null
  const domain = (() => { try { return new URL(article.url).hostname.replace('www.', '') } catch { return '' } })()

  return (
    <div className="al-card" onClick={() => navigate(`/article/${article.id}`)}>
      {/* Top: domain + date */}
      <div className="al-card-top">
        <span className="al-card-domain">{domain}</span>
        <span className="al-card-date">{formatRelative(article.created_at)}</span>
      </div>

      {/* Title */}
      <h3 className="al-card-title">{article.title}</h3>

      {/* TL;DR or summary */}
      <p className="al-card-excerpt">
        {analysis?.tldr
          ? analysis.tldr
          : article.summary
            ? truncate(article.summary, 160)
            : 'No summary available.'}
      </p>

      {/* Tags */}
      <div className="al-card-tags">
        <TagPill label={article.topic} />
        {(article.tags as string[]).slice(0, 3).map((tag) => (
          <TagPill key={tag} label={tag} />
        ))}
      </div>

      {/* Bottom bar */}
      <div className="al-card-bottom" onClick={(e) => e.stopPropagation()}>
        {analysis ? (
          <span className="al-card-badge analyzed">Deep Read</span>
        ) : (
          <span className="al-card-badge pending">Not analyzed</span>
        )}
        <div className="al-card-actions">
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="al-card-link" onClick={(e) => e.stopPropagation()}>
            Source
          </a>
          {isAdmin && (
            <button className="al-card-link danger" onClick={(e) => { e.stopPropagation(); onDelete(article.id) }}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ArticlesPage
