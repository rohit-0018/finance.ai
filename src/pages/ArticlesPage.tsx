import React, { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '../store'
import { dbGetArticles, dbSaveArticle, dbDeleteArticle } from '../lib/supabase'
import { summarizeArticle, articleChat } from '../lib/anthropic'
import type { Article } from '../types'
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
      console.log(`[ArticleExtract] Trying ${proxyName}...`)
      const res = await fetch(proxyUrl)

      if (!res.ok) {
        const msg = `${proxyName}: HTTP ${res.status}`
        console.warn(`[ArticleExtract] ${msg}`)
        errors.push(msg)
        continue
      }

      const html = await res.text()
      console.log(`[ArticleExtract] ${proxyName} returned ${html.length} chars`)

      if (html.length < 200) {
        const msg = `${proxyName}: response too short (${html.length} chars)`
        console.warn(`[ArticleExtract] ${msg}`)
        errors.push(msg)
        continue
      }

      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')

      // Remove noise elements
      doc.querySelectorAll(
        'script, style, nav, footer, header, aside, iframe, svg, [role="navigation"], [role="banner"], .sidebar, .comments, .ad, .advertisement, .social-share'
      ).forEach((el) => el.remove())

      // Title: try multiple strategies
      const title =
        doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ??
        doc.querySelector('h1')?.textContent?.trim() ??
        doc.querySelector('title')?.textContent?.trim() ??
        url

      // Content: try progressively broader selectors
      const selectors = [
        'article',
        '[role="main"]',
        'main',
        '.post-content',
        '.article-content',
        '.entry-content',
        '.post-body',
        '.article-body',
        '.content-body',
        '.blog-post',
        '.post',
        '#content',
        '.content',
        // Substack specific
        '.body.markup',
        '.available-content',
        '.single-post',
      ]

      let content = ''
      for (const sel of selectors) {
        const el = doc.querySelector(sel)
        if (el) {
          content = el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
          if (content.length >= 100) {
            console.log(`[ArticleExtract] Found content via "${sel}" (${content.length} chars)`)
            break
          }
        }
      }

      // Fallback to body
      if (content.length < 100) {
        content = doc.body?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        console.log(`[ArticleExtract] Fallback to body (${content.length} chars)`)
      }

      if (content.length < 100) {
        const msg = `${proxyName}: extracted content too short (${content.length} chars)`
        console.warn(`[ArticleExtract] ${msg}`)
        errors.push(msg)
        continue
      }

      return { title, content: content.slice(0, 15000) }
    } catch (err) {
      const msg = `${proxyName}: ${err instanceof Error ? err.message : 'network error'}`
      console.error(`[ArticleExtract] ${msg}`)
      errors.push(msg)
    }
  }

  const errorSummary = errors.join('\n')
  console.error(`[ArticleExtract] All proxies failed for ${url}:\n${errorSummary}`)
  throw new Error(`Extraction failed:\n${errors.join(', ')}`)
}

// ---------- Component ----------

interface IngestResult {
  url: string
  status: 'success' | 'error'
  message: string
}

const ArticlesPage: React.FC = () => {
  const userId = useAppStore((s) => s.currentUser?.id)
  const isAdmin = useAppStore((s) => s.isAdmin)
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [urls, setUrls] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<IngestResult[]>([])

  // Chat state
  const [chatArticle, setChatArticle] = useState<Article | null>(null)
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  useEffect(() => {
    dbGetArticles().then(setArticles).finally(() => setLoading(false))
  }, [])

  const handleIngest = useCallback(async () => {
    const urlList = urls
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0 && (u.startsWith('http://') || u.startsWith('https://')))

    if (urlList.length === 0) {
      toast.error('Enter at least one valid URL (must start with http:// or https://)')
      return
    }

    setIngesting(true)
    setResults([])
    const newResults: IngestResult[] = []

    for (const url of urlList) {
      try {
        setProgress(`Extracting content from ${new URL(url).hostname}...`)
        const { title, content } = await fetchPageContent(url)

        setProgress(`AI analyzing: "${title.slice(0, 50)}"...`)
        const analysis = await summarizeArticle(title, content)

        const article = await dbSaveArticle({
          url,
          title,
          content,
          summary: analysis.summary,
          topic: analysis.topic,
          tags: analysis.tags,
          addedBy: userId,
        })

        setArticles((prev) => [article, ...prev.filter((a) => a.id !== article.id)])
        newResults.push({ url, status: 'success', message: `Saved: "${title}"` })
        toast.success(`Saved: ${title.slice(0, 40)}`)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[Ingest] Failed for ${url}:`, errMsg)
        newResults.push({ url, status: 'error', message: errMsg })
        toast.error(`Failed: ${url.slice(0, 40)}... — ${errMsg.split('\n')[0]}`)
      }
    }

    setResults(newResults)
    setIngesting(false)
    setProgress('')
    if (newResults.every((r) => r.status === 'success')) setUrls('')
  }, [urls, userId])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await dbDeleteArticle(id)
      setArticles((prev) => prev.filter((a) => a.id !== id))
      toast.success('Article deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }, [])

  const openChat = useCallback((article: Article) => {
    setChatArticle(article)
    setChatMessages([])
    setChatInput('')
  }, [])

  const sendChat = useCallback(async () => {
    if (!chatArticle || !chatInput.trim() || chatLoading) return
    const userMsg = chatInput.trim()
    setChatInput('')
    const newMessages = [...chatMessages, { role: 'user' as const, content: userMsg }]
    setChatMessages(newMessages)
    setChatLoading(true)

    try {
      const reply = await articleChat(
        { title: chatArticle.title, content: chatArticle.content, summary: chatArticle.summary },
        newMessages
      )
      setChatMessages([...newMessages, { role: 'assistant' as const, content: reply }])
    } catch (err) {
      setChatMessages([
        ...newMessages,
        { role: 'assistant' as const, content: `Error: ${err instanceof Error ? err.message : 'Failed'}` },
      ])
    } finally {
      setChatLoading(false)
    }
  }, [chatArticle, chatInput, chatMessages, chatLoading])

  return (
    <>
      <div className="page-header">
        <div className="page-title">Articles</div>
        <div className="page-actions">
          <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>
            {articles.length} article{articles.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Admin ingest section */}
      {isAdmin() && (
        <div className="ingest-section">
          <div className="ingest-header">
            <div>
              <div className="ingest-title">Ingest Articles</div>
              <div className="ingest-desc">
                Paste URLs (one per line). Content is extracted, analyzed by AI, and saved for everyone.
              </div>
            </div>
          </div>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={'https://example.com/interesting-article\nhttps://blog.example.com/another-post'}
            rows={3}
            className="ingest-textarea"
          />
          <div className="ingest-actions">
            <button
              className="btn btn-primary"
              onClick={handleIngest}
              disabled={ingesting || !urls.trim()}
            >
              {ingesting ? 'Processing...' : 'Extract & Save'}
            </button>
            {progress && <span className="ingest-progress">{progress}</span>}
          </div>

          {/* Results log */}
          {results.length > 0 && (
            <div className="ingest-results">
              {results.map((r, i) => (
                <div key={i} className={`ingest-result ${r.status}`}>
                  <span className="ingest-result-icon">
                    {r.status === 'success' ? '✓' : '✗'}
                  </span>
                  <div className="ingest-result-body">
                    <div className="ingest-result-url">{r.url}</div>
                    <div className="ingest-result-msg">{r.message}</div>
                  </div>
                </div>
              ))}
              <button
                className="btn btn-sm"
                onClick={() => setResults([])}
                style={{ alignSelf: 'flex-start', marginTop: '4px' }}
              >
                Clear log
              </button>
            </div>
          )}
        </div>
      )}

      {/* Chat panel */}
      {chatArticle && (
        <div className="article-chat-panel">
          <div className="article-chat-header">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="article-chat-title">{chatArticle.title}</div>
              <div className="article-chat-url">{chatArticle.url}</div>
            </div>
            <button className="btn btn-sm" onClick={() => setChatArticle(null)}>Close</button>
          </div>
          <div className="qa-messages" style={{ maxHeight: '300px' }}>
            {chatMessages.length === 0 && (
              <div style={{ color: 'var(--text3)', fontSize: '0.85rem', textAlign: 'center', padding: '24px 0' }}>
                Ask anything about this article.
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className="qa-message">
                <div className={`qa-avatar ${msg.role}`}>
                  {msg.role === 'user' ? 'U' : 'AI'}
                </div>
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
              placeholder="Ask about this article..."
              rows={1}
              disabled={chatLoading}
            />
            <button className="btn btn-primary" onClick={sendChat} disabled={chatLoading || !chatInput.trim()}>
              Send
            </button>
          </div>
        </div>
      )}

      {/* Article list */}
      {loading ? (
        <div className="loading-center">Loading articles...</div>
      ) : articles.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">A</div>
          <div className="empty-state-title">No articles yet</div>
          <div className="empty-state-desc">
            {isAdmin()
              ? 'Paste URLs above to extract and save articles.'
              : 'Articles will appear here once an admin adds them.'}
          </div>
        </div>
      ) : (
        <div className="articles-list">
          {articles.map((article) => (
            <div key={article.id} className="article-row">
              <div className="article-row-main">
                <div className="article-row-title">{article.title}</div>
                {article.summary && (
                  <div className="article-row-summary">{truncate(article.summary, 200)}</div>
                )}
                <div className="article-row-meta">
                  <TagPill label={article.topic} />
                  {article.tags && (article.tags as string[]).slice(0, 3).map((tag) => (
                    <TagPill key={tag} label={tag} />
                  ))}
                  <span className="article-row-date">{formatRelative(article.created_at)}</span>
                </div>
              </div>
              <div className="article-row-actions">
                <a href={article.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                  Source ↗
                </a>
                <button className="btn btn-sm btn-primary" onClick={() => openChat(article)}>
                  Ask AI
                </button>
                {isAdmin() && (
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(article.id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default ArticlesPage
