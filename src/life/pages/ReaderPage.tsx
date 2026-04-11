// Reader — curated feed of gists you've picked from papers + articles.
//
// Wraps LifeLayout so it matches every other life page (topbar, sidebar,
// mobile drawer). The content itself is a responsive grid of colorful
// gradient cards — two-to-three across on desktop, single column on mobile.
// Each card reuses existing summary/tldr data; no re-summarization happens
// here, the reader is purely a viewing surface.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import LifeLayout from '../LifeLayout'
import { dbGetReaderFeed, dbToggleReaderPick, type ReaderItem } from '../../lib/supabase'

// Curated gradient palette — each card is assigned a gradient by index so
// the feed has rhythm without feeling random. Picked for warm contrast
// against white text.
const GRADIENTS = [
  'linear-gradient(135deg, #ff6a88 0%, #ff99ac 50%, #ffc3a0 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
  'linear-gradient(135deg, #cc2b5e 0%, #753a88 100%)',
  'linear-gradient(135deg, #ff512f 0%, #f09819 100%)',
  'linear-gradient(135deg, #1fa2ff 0%, #12d8fa 50%, #a6ffcb 100%)',
]

type Filter = 'all' | 'article' | 'paper'

const ReaderPage: React.FC = () => {
  const navigate = useNavigate()
  const [items, setItems] = useState<ReaderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(() => {
    setLoading(true)
    dbGetReaderFeed()
      .then(setItems)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleUnpick = useCallback(async (item: ReaderItem) => {
    try {
      await dbToggleReaderPick(item.kind, item.id, false)
      setItems((prev) => prev.filter((i) => !(i.id === item.id && i.kind === item.kind)))
      toast.success('Removed from feed')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [])

  const openDetail = useCallback(
    (item: ReaderItem) => {
      if (item.kind === 'article') navigate(`/article/${item.id}`)
      else navigate(`/reader/${item.id}`)
    },
    [navigate]
  )

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.kind === filter)),
    [items, filter]
  )

  const counts = useMemo(
    () => ({
      all: items.length,
      article: items.filter((i) => i.kind === 'article').length,
      paper: items.filter((i) => i.kind === 'paper').length,
    }),
    [items]
  )

  return (
    <LifeLayout title="Reader">
      <div className="reader-page">
        <div className="reader-hero">
          <div className="reader-hero-text">
            <h2 className="reader-hero-title">
              Your crisp, colorful feed
            </h2>
            <p className="reader-hero-sub">
              Everything you've marked for reading, as bite-sized gists. Pull-stuff
              in from any paper or article via the ⋯ menu → <b>Choose for reading</b>.
            </p>
          </div>

          <div className="reader-filters">
            <button
              className={`reader-filter ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All <span className="reader-filter-count">{counts.all}</span>
            </button>
            <button
              className={`reader-filter ${filter === 'article' ? 'active' : ''}`}
              onClick={() => setFilter('article')}
            >
              Articles <span className="reader-filter-count">{counts.article}</span>
            </button>
            <button
              className={`reader-filter ${filter === 'paper' ? 'active' : ''}`}
              onClick={() => setFilter('paper')}
            >
              Papers <span className="reader-filter-count">{counts.paper}</span>
            </button>
            <button
              className="reader-filter reader-filter-refresh"
              onClick={load}
              title="Refresh"
              aria-label="Refresh"
            >
              ↻
            </button>
          </div>
        </div>

        {loading && (
          <div className="reader-skeleton-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="reader-skeleton" style={{ background: GRADIENTS[i % GRADIENTS.length] }}>
                <div className="reader-skeleton-shimmer" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="reader-state">
            <div className="reader-state-title">Something went wrong</div>
            <div className="reader-state-sub">{error}</div>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="reader-state">
            <div className="reader-state-title">
              {items.length === 0 ? 'Nothing picked yet' : 'No items in this filter'}
            </div>
            <div className="reader-state-sub">
              {items.length === 0
                ? 'Open any article or paper, hit the ⋯ menu, and tap "Choose for reading".'
                : 'Try a different filter above.'}
            </div>
            {items.length === 0 && (
              <button className="reader-cta" onClick={() => navigate('/articles')}>
                Browse articles
              </button>
            )}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="reader-grid">
            {filtered.map((item, idx) => (
              <ReaderCard
                key={`${item.kind}-${item.id}`}
                item={item}
                index={idx}
                onOpen={() => openDetail(item)}
                onUnpick={() => handleUnpick(item)}
              />
            ))}
          </div>
        )}
      </div>
    </LifeLayout>
  )
}

interface ReaderCardProps {
  item: ReaderItem
  index: number
  onOpen: () => void
  onUnpick: () => void
}

const ReaderCard: React.FC<ReaderCardProps> = ({ item, index, onOpen, onUnpick }) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const gradient = useMemo(() => GRADIENTS[index % GRADIENTS.length], [index])

  return (
    <article
      className={`reader-card${menuOpen ? ' menu-open' : ''}`}
      onClick={onOpen}
    >
      {/* Decorative layer — clipped to the card's rounded shape. Kept in an
          inner wrapper so the card itself can have overflow:visible and let
          popovers (3-dot menu) escape the bounds. */}
      <div
        className="reader-card-bg"
        style={{ background: gradient }}
        aria-hidden="true"
      >
        <div className="reader-card-blob" />
        <div className="reader-card-veil" />
      </div>

      <div className="reader-card-head">
        <span className="reader-card-kind">
          {item.kind === 'article' ? '📰 Article' : '📄 Paper'}
        </span>
        <div className="reader-card-menu-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            className="reader-card-dot"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="reader-card-scrim" onClick={() => setMenuOpen(false)} />
              <div className="reader-card-menu" role="menu">
                <button onClick={() => { setMenuOpen(false); onOpen() }}>
                  Open full reader
                </button>
                {item.url && (
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      window.open(item.url!, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    Open source
                  </button>
                )}
                <button className="danger" onClick={() => { setMenuOpen(false); onUnpick() }}>
                  Remove from feed
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="reader-card-body">
        <h3 className="reader-card-title">{item.title}</h3>
        <p className="reader-card-gist">{item.gist}</p>
      </div>

      <div className="reader-card-foot">
        <div className="reader-card-meta">
          <span className="reader-card-source">{item.source}</span>
          {item.topic && item.topic !== 'General' && item.topic !== 'AI' && (
            <span className="reader-card-dot-sep">•</span>
          )}
          {item.topic && item.topic !== 'General' && item.topic !== 'AI' && (
            <span className="reader-card-topic">{item.topic}</span>
          )}
        </div>
        {item.tags.length > 0 && (
          <div className="reader-card-tags">
            {item.tags.slice(0, 3).map((t) => (
              <span key={t} className="reader-card-tag">#{t}</span>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

export default ReaderPage
