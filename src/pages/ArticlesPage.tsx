import React, { useState, useCallback, useEffect } from 'react'
import { useAppStore } from '../store'
import { dbGetArticles, dbSaveArticle, dbDeleteArticle } from '../lib/supabase'
import { summarizeArticle, articleChat } from '../lib/anthropic'
import type { Article } from '../types'
import { formatRelative, truncate } from '../lib/utils'
import TagPill from '../components/TagPill'
import toast from 'react-hot-toast'

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
]

async function fetchPageContent(url: string): Promise<{ title: string; content: string }> {
  for (const buildUrl of CORS_PROXIES) {
    try {
      const res = await fetch(buildUrl(url))
      if (!res.ok) continue
      const html = await res.text()
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')

      // Remove scripts, styles, nav, footer
      doc.querySelectorAll('script, style, nav, footer, header, aside, [role="navigation"], [role="banner"]').forEach((el) => el.remove())

      const title =
        doc.querySelector('h1')?.textContent?.trim() ??
        doc.querySelector('title')?.textContent?.trim() ??
        url

      // Try to get article content from common selectors
      const articleEl =
        doc.querySelector('article') ??
        doc.querySelector('[role="main"]') ??
        doc.querySelector('main') ??
        doc.querySelector('.post-content') ??
        doc.querySelector('.article-content') ??
        doc.querySelector('.entry-content') ??
        doc.body

      const content = articleEl?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

      if (content.length < 100) continue
      return { title, content: content.slice(0, 15000) }
    } catch {
      continue
    }
  }
  throw new Error(`Could not extract content from ${url}`)
}

const ArticlesPage: React.FC = () => {
  const userId = useAppStore((s) => s.currentUser?.id)
  const isAdmin = useAppStore((s) => s.isAdmin)
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [urls, setUrls] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [progress, setProgress] = useState('')

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
      toast.error('Enter at least one valid URL')
      return
    }

    setIngesting(true)
    let success = 0
    let failed = 0

    for (const url of urlList) {
      try {
        setProgress(`Extracting: ${url.slice(0, 50)}...`)
        const { title, content } = await fetchPageContent(url)

        setProgress(`Analyzing: ${title.slice(0, 40)}...`)
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
        success++
      } catch (err) {
        console.error(`Failed: ${url}`, err)
        failed++
      }
    }

    setIngesting(false)
    setProgress('')
    setUrls('')
    toast.success(`Done: ${success} saved${failed > 0 ? `, ${failed} failed` : ''}`)
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
        <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>
          {articles.length} articles
        </span>
      </div>

      {/* Admin ingest form */}
      {isAdmin() && (
        <div className="add-feed-form">
          <div style={{ fontSize: '0.87rem', fontWeight: 600 }}>Ingest Articles</div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
            Paste URLs (one per line). Content will be extracted, summarized by AI, and saved.
          </p>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={'https://example.com/article-1\nhttps://example.com/article-2'}
            rows={4}
            style={{ width: '100%' }}
          />
          {progress && (
            <div style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>{progress}</div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleIngest}
            disabled={ingesting || !urls.trim()}
            style={{ alignSelf: 'flex-start' }}
          >
            {ingesting ? 'Ingesting...' : 'Extract & Save'}
          </button>
        </div>
      )}

      {/* Chat panel */}
      {chatArticle && (
        <div className="article-chat-panel">
          <div className="article-chat-header">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.87rem' }}>{chatArticle.title}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{chatArticle.url}</div>
            </div>
            <button className="btn btn-sm" onClick={() => setChatArticle(null)}>Close</button>
          </div>
          <div className="qa-messages" style={{ maxHeight: '300px' }}>
            {chatMessages.length === 0 && (
              <div style={{ color: 'var(--text3)', fontSize: '0.82rem', textAlign: 'center', padding: '20px 0' }}>
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
        <div className="paper-grid">
          {articles.map((article) => (
            <div key={article.id} className="card paper-card">
              <div className="paper-card-header">
                <div className="paper-card-title">{article.title}</div>
              </div>
              <div className="paper-card-meta">
                <TagPill label={article.topic} />
                <span>{formatRelative(article.created_at)}</span>
              </div>
              {article.summary && (
                <div className="paper-card-finding">{truncate(article.summary, 180)}</div>
              )}
              {article.tags && (article.tags as string[]).length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {(article.tags as string[]).slice(0, 4).map((tag) => (
                    <TagPill key={tag} label={tag} />
                  ))}
                </div>
              )}
              <div className="paper-card-actions">
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="read-link"
                  style={{ fontSize: '0.78rem' }}
                >
                  Source ↗
                </a>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-sm" onClick={() => openChat(article)}>
                    Ask AI
                  </button>
                  {isAdmin() && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(article.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default ArticlesPage
