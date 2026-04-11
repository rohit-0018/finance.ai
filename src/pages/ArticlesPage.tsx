import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import { dbGetArticles, dbSaveArticle, dbDeleteArticle, dbToggleReaderPick, dbArchiveArticle } from '../lib/supabase'
import { deepExtractArticle } from '../lib/anthropic'
import { UploaderBadge } from '../components/Avatar'
import type { Article, DeepAnalysis } from '../types'
import { formatRelative, truncate } from '../lib/utils'
import TagPill from '../components/TagPill'
import toast from 'react-hot-toast'
import { Readability } from '@mozilla/readability'
import { recordLLMCall } from '../store/llmDebug'

// ---------- Extraction ----------

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
]

// Convert article HTML to text while preserving structure (headings, lists,
// code blocks, quotes, paragraphs). Readability alone gives us clean HTML —
// this walker turns it into faithful plain text so nothing is collapsed.
function htmlToStructuredText(root: Element): string {
  const lines: string[] = []
  const listStack: Array<'ul' | 'ol'> = []
  const olCounters: number[] = []

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? '').replace(/\s+/g, ' ')
      if (t.trim()) lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + t
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()

    // Skip non-content elements
    if (['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer', 'header', 'aside', 'form', 'button'].includes(tag)) return

    const block = (open?: string, close?: string): void => {
      if (open !== undefined) lines.push(open)
      else lines.push('')
      el.childNodes.forEach(walk)
      if (close !== undefined) lines.push(close)
      lines.push('')
    }

    switch (tag) {
      case 'h1': block('# '); break
      case 'h2': block('## '); break
      case 'h3': block('### '); break
      case 'h4': block('#### '); break
      case 'h5': block('##### '); break
      case 'h6': block('###### '); break
      case 'p': block(''); break
      case 'br': lines.push(''); break
      case 'hr': lines.push(''); lines.push('---'); lines.push(''); break
      case 'blockquote': {
        const start = lines.length
        block('> ')
        // prefix every line produced for this blockquote with "> "
        for (let i = start; i < lines.length; i++) {
          if (lines[i] && !lines[i].startsWith('> ')) lines[i] = '> ' + lines[i]
        }
        break
      }
      case 'pre': {
        lines.push('')
        lines.push('```')
        const txt = (el.textContent ?? '').replace(/\s+$/g, '')
        txt.split('\n').forEach((l) => lines.push(l))
        lines.push('```')
        lines.push('')
        break
      }
      case 'code': {
        // inline code if inside paragraph; pre handled above
        const parentTag = el.parentElement?.tagName.toLowerCase()
        if (parentTag !== 'pre') {
          const txt = el.textContent ?? ''
          lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + '`' + txt + '`'
        }
        break
      }
      case 'ul':
      case 'ol': {
        listStack.push(tag as 'ul' | 'ol')
        if (tag === 'ol') olCounters.push(0)
        el.childNodes.forEach(walk)
        listStack.pop()
        if (tag === 'ol') olCounters.pop()
        lines.push('')
        break
      }
      case 'li': {
        const depth = Math.max(0, listStack.length - 1)
        const indent = '  '.repeat(depth)
        const parent = listStack[listStack.length - 1]
        let marker = '- '
        if (parent === 'ol') {
          const c = ++olCounters[olCounters.length - 1]
          marker = `${c}. `
        }
        lines.push(indent + marker)
        el.childNodes.forEach(walk)
        break
      }
      case 'table': {
        // Rough table rendering — enough to keep the data intact for the LLM.
        lines.push('')
        const rows = Array.from(el.querySelectorAll('tr'))
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('th, td'))
            .map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())
          lines.push('| ' + cells.join(' | ') + ' |')
        }
        lines.push('')
        break
      }
      case 'a': {
        const href = el.getAttribute('href') ?? ''
        const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (txt && href && /^https?:/.test(href)) {
          lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + `[${txt}](${href})`
        } else if (txt) {
          lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + txt
        }
        break
      }
      case 'img': {
        const alt = el.getAttribute('alt') ?? ''
        const src = el.getAttribute('src') ?? ''
        if (alt || src) lines.push(`![${alt}](${src})`)
        break
      }
      default:
        // Descend into unknown containers (div, span, section, article, etc.)
        el.childNodes.forEach(walk)
    }
  }

  root.childNodes.forEach(walk)

  // Tidy: collapse runs of >2 blank lines, trim trailing whitespace per line
  const out = lines
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return out
}

async function fetchPageContent(url: string): Promise<{ title: string; content: string; method: string }> {
  const errors: string[] = []
  const startedAt = Date.now()

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

      // Give Readability a clone so it can mutate without affecting our doc.
      const docClone = doc.cloneNode(true) as Document
      // Readability needs a baseURI for resolving relative links.
      try {
        const base = docClone.createElement('base')
        base.setAttribute('href', url)
        docClone.head?.appendChild(base)
      } catch { /* ignore */ }

      const reader = new Readability(docClone, {
        charThreshold: 200,
        keepClasses: false,
      })
      const parsed = reader.parse()

      let title = ''
      let content = ''
      let method = ''

      if (parsed && parsed.content) {
        title = parsed.title?.trim()
          || doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
          || doc.querySelector('h1')?.textContent?.trim()
          || url
        // Parse the cleaned HTML into a fragment and walk it preserving structure.
        const container = doc.createElement('div')
        container.innerHTML = parsed.content
        content = htmlToStructuredText(container)
        method = `readability via ${proxyName}`
      } else {
        // Fallback: structure-preserving walk over the raw document body.
        doc.querySelectorAll('script,style,nav,footer,header,aside,iframe,svg,form,[role="navigation"],[role="banner"],.sidebar,.comments,.ad,.social-share').forEach((el) => el.remove())
        title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
          || doc.querySelector('h1')?.textContent?.trim()
          || doc.querySelector('title')?.textContent?.trim()
          || url
        const body = doc.body
        content = body ? htmlToStructuredText(body) : ''
        method = `fallback walker via ${proxyName}`
      }

      if (content.length < 100) {
        errors.push(`${proxyName}: content too short (${content.length})`)
        continue
      }

      recordLLMCall({
        label: 'fetch.scrape',
        model: method,
        startedAt,
        durationMs: Date.now() - startedAt,
        messages: [{ role: 'user', content: `URL: ${url}\n\nEXTRACTED (${content.length} chars, ${content.split(/\s+/).length} words):\n\n${content}` }],
        response: `title: ${title}\nmethod: ${method}\nhtml_size: ${html.length}\ntext_size: ${content.length}`,
        inputChars: html.length,
        outputChars: content.length,
      })

      return { title, content, method }
    } catch (err) {
      errors.push(`${proxyName}: ${err instanceof Error ? err.message : 'error'}`)
    }
  }
  recordLLMCall({
    label: 'fetch.scrape',
    model: 'failed',
    startedAt,
    durationMs: Date.now() - startedAt,
    messages: [{ role: 'user', content: `URL: ${url}` }],
    response: '',
    inputChars: 0,
    outputChars: 0,
    error: errors.join(' | '),
  })
  throw new Error(`Extraction failed: ${errors.join(', ')}`)
}

// ---------- Component ----------

interface IngestResult { url: string; status: 'success' | 'error'; message: string }

interface ArticlesPageProps {
  // When rendered inside Life's chrome we hide the "+ Add Articles" banner
  // so the life page stays focused on reading, not ingest. The papermind
  // articles route still shows it.
  hideIngest?: boolean
}

const ArticlesPage: React.FC<ArticlesPageProps> = ({ hideIngest = false }) => {
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
  const [makePrivate, setMakePrivate] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    dbGetArticles({ currentUserId: userId ?? null, isAdmin: isAdmin() })
      .then(setArticles)
      .finally(() => setLoading(false))
  }, [userId, isAdmin])

  const handleIngest = useCallback(async () => {
    const urlList = urls.split('\n').map((u) => u.trim()).filter((u) => u.startsWith('http'))
    if (urlList.length === 0) { toast.error('Enter at least one valid URL'); return }

    setIngesting(true)
    setResults([])
    const newResults: IngestResult[] = []

    for (const url of urlList) {
      try {
        setProgress(`Fetching: ${new URL(url).hostname}`)
        const { title, content } = await fetchPageContent(url)
        // Deep multi-phase extraction BEFORE saving — nothing hits the DB
        // until we have the full distilled output.
        const extracted = await deepExtractArticle(title, content, (step) =>
          setProgress(`${title.slice(0, 30)}... — ${step}`)
        )
        const article = await dbSaveArticle({
          url,
          title,
          content,
          summary: extracted.summary,
          topic: extracted.topic,
          tags: extracted.tags,
          analysis: extracted.analysis,
          addedBy: userId,
          isPrivate: makePrivate,
          // Admins auto-approve their public articles. Regular users wait.
          approved: isAdmin() ? true : false,
        })
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
  }, [urls, userId, makePrivate, isAdmin])

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('Delete this article permanently? This cannot be undone.')) return
    try {
      await dbDeleteArticle(id)
      setArticles((prev) => prev.filter((a) => a.id !== id))
      toast.success('Deleted')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
  }, [])

  const handleArchive = useCallback(async (id: string) => {
    try {
      await dbArchiveArticle(id, true)
      setArticles((prev) => prev.filter((a) => a.id !== id))
      toast.success('Archived — hidden from your feed')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
  }, [])

  const filtered = search
    ? articles.filter((a) => a.title.toLowerCase().includes(search.toLowerCase()) || a.topic.toLowerCase().includes(search.toLowerCase()))
    : articles

  const analyzed = filtered.filter((a) => a.analysis)
  const unanalyzed = filtered.filter((a) => !a.analysis)

  return (
    <>
      {!hideIngest && (
        <div className="page-header">
          <div className="page-title">Articles</div>
          <div className="page-actions">
            {isAdmin() && (
              <button className="btn btn-sm" onClick={() => navigate('/admin/articles')}>
                Approval queue
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setShowIngest(!showIngest)}>
              {showIngest ? 'Close' : '+ Add Articles'}
            </button>
          </div>
        </div>
      )}

      {/* Ingest panel — open to all signed-in users, hidden inside Life */}
      {!hideIngest && showIngest && (
        <div className="al-ingest">
          <div className="al-ingest-inner">
            <div className="al-ingest-label">Paste article URLs (one per line)</div>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={'https://example.com/article-one\nhttps://blog.example.com/post-two'}
              rows={3}
            />
            <div className="al-ingest-bar" style={{ flexWrap: 'wrap', gap: 12 }}>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}
                title="Private articles are visible only to you and never need approval"
              >
                <input
                  type="checkbox"
                  checked={makePrivate}
                  onChange={(e) => setMakePrivate(e.target.checked)}
                />
                Private (only visible to me)
              </label>
              <button className="btn btn-primary" onClick={handleIngest} disabled={ingesting || !urls.trim()}>
                {ingesting ? progress || 'Processing...' : 'Extract & Save'}
              </button>
              {results.length > 0 && (
                <button className="btn btn-sm" onClick={() => setResults([])}>Clear log</button>
              )}
            </div>
            {!isAdmin() && !makePrivate && (
              <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text2, #888)' }}>
                Public articles need admin approval before they appear for everyone. They'll show up
                in your list with a "Pending review" badge until approved.
              </div>
            )}
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
            {search ? 'Try a different search.' : 'Click "+ Add Articles" to add one. Public articles need admin approval before everyone can see them.'}
          </div>
        </div>
      ) : (
        <div className="al-grid">
          {/* Analyzed articles first */}
          {analyzed.length > 0 && (
            <>
              {unanalyzed.length > 0 && <div className="al-section-label">Deep Reads</div>}
              {analyzed.map((article) => (
                <ArticleCard key={article.id} article={article} navigate={navigate} isAdmin={isAdmin()} onDelete={handleDelete} onArchive={handleArchive} />
              ))}
            </>
          )}
          {unanalyzed.length > 0 && (
            <>
              {analyzed.length > 0 && <div className="al-section-label">Unanalyzed</div>}
              {unanalyzed.map((article) => (
                <ArticleCard key={article.id} article={article} navigate={navigate} isAdmin={isAdmin()} onDelete={handleDelete} onArchive={handleArchive} />
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
  onArchive: (id: string) => void
}> = ({ article, navigate, isAdmin, onDelete, onArchive }) => {
  const analysis = article.analysis as DeepAnalysis | null
  const domain = (() => { try { return new URL(article.url).hostname.replace('www.', '') } catch { return '' } })()
  const [menuOpen, setMenuOpen] = useState(false)
  const [marked, setMarked] = useState<boolean>(!!article.marked_for_reading)

  const handleToggleReader = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    const next = !marked
    setMarked(next)
    try {
      await dbToggleReaderPick('article', article.id, next)
      toast.success(next ? 'Added to reader feed' : 'Removed from reader feed')
    } catch (err) {
      setMarked(!next)
      toast.error((err as Error).message)
    }
  }

  return (
    <div
      className={`al-card${menuOpen ? ' menu-open' : ''}`}
      onClick={() => navigate(`/article/${article.id}`)}
    >
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

      {/* Uploader chip (hidden if uploaded by admin) */}
      {article.uploader && !article.uploader.is_admin && (
        <div style={{ marginTop: 8 }}>
          <UploaderBadge uploader={article.uploader} compact />
        </div>
      )}

      {/* Bottom bar */}
      <div className="al-card-bottom" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {analysis ? (
            <span className="al-card-badge analyzed">Deep Read</span>
          ) : (
            <span className="al-card-badge pending">Not analyzed</span>
          )}
          {article.is_private && (
            <span className="al-card-badge pending" title="Only you can see this">Private</span>
          )}
          {!article.is_private && !article.approved && (
            <span className="al-card-badge pending" title="Awaiting admin approval">Pending review</span>
          )}
          {marked && (
            <span className="al-card-badge" style={{ background: 'linear-gradient(135deg,#f093fb,#f5576c)', color: '#fff' }}>In Reader</span>
          )}
        </div>
        <div className="al-card-actions">
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="al-card-link" onClick={(e) => e.stopPropagation()}>
            Source
          </a>
          <div className="card-menu-wrap">
            <button
              className={`card-menu-btn${marked ? ' marked' : ''}`}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              aria-label="More"
              title="More"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div
                  className="card-menu-scrim"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }}
                />
                <div className="card-menu" role="menu">
                  <button
                    className={`card-menu-item${marked ? ' active' : ''}`}
                    role="menuitem"
                    onClick={handleToggleReader}
                  >
                    <span className="card-menu-icon">{marked ? '✓' : '📖'}</span>
                    <span>{marked ? 'In reader feed' : 'Choose for reading'}</span>
                  </button>
                  <button
                    className="card-menu-item"
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onArchive(article.id) }}
                  >
                    <span className="card-menu-icon">📥</span>
                    <span>Archive (hide from feed)</span>
                  </button>
                  {isAdmin && (
                    <>
                      <div className="card-menu-divider" />
                      <button
                        className="card-menu-item danger"
                        role="menuitem"
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(article.id) }}
                      >
                        <span className="card-menu-icon">🗑</span>
                        <span>Delete permanently</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ArticlesPage
