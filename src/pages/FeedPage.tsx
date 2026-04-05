import React, { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../store'
import { usePapersFeed, useFetchPapersAI } from '../hooks/usePapers'
import { useFetchRSSFeeds, useFeeds } from '../hooks/useFeeds'
import { useSavedPapers } from '../hooks/useSaved'
import PaperCard from '../components/PaperCard'
import SkeletonCard from '../components/SkeletonCard'
import EmptyState from '../components/EmptyState'
import { TOPICS } from '../lib/utils'

const FeedPage: React.FC = () => {
  const activeTopic = useAppStore((s) => s.activeTopic)
  const setActiveTopic = useAppStore((s) => s.setActiveTopic)
  const setSavedIds = useAppStore((s) => s.setSavedIds)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = usePapersFeed(activeTopic)

  const fetchAI = useFetchPapersAI()
  const { data: feeds } = useFeeds()
  const fetchRSS = useFetchRSSFeeds()
  const { data: savedPapers } = useSavedPapers()

  // Sync saved IDs
  useEffect(() => {
    if (savedPapers) {
      setSavedIds(savedPapers.map((sp) => sp.paper_id))
    }
  }, [savedPapers, setSavedIds])

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const handleFetchAI = useCallback(() => {
    const topic = activeTopic === 'All' ? 'AI' : activeTopic
    fetchAI.mutate(topic)
  }, [activeTopic, fetchAI])

  const handleFetchRSS = useCallback(() => {
    if (feeds) {
      fetchRSS.mutate(feeds)
    }
  }, [feeds, fetchRSS])

  const papers = data?.pages.flatMap((page) => page) ?? []

  return (
    <>
      <div className="page-header">
        <div className="page-title">Discovery Feed</div>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            onClick={handleFetchAI}
            disabled={fetchAI.isPending}
          >
            {fetchAI.isPending ? 'Fetching...' : 'Fetch via AI'}
          </button>
          <button
            className="btn"
            onClick={handleFetchRSS}
            disabled={fetchRSS.isPending}
          >
            {fetchRSS.isPending ? 'Pulling...' : 'Pull RSS Feeds'}
          </button>
        </div>
      </div>

      <div className="topic-bar">
        {TOPICS.map((topic) => (
          <button
            key={topic}
            className={`topic-chip ${activeTopic === topic ? 'active' : ''}`}
            onClick={() => setActiveTopic(topic)}
          >
            {topic}
          </button>
        ))}
      </div>

      {isError && (
        <div className="loading-center" style={{ color: 'var(--coral)' }}>
          Error: {error instanceof Error ? error.message : 'Failed to load papers'}
        </div>
      )}

      {isLoading ? (
        <div className="paper-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : papers.length === 0 ? (
        <EmptyState
          icon="P"
          title="No papers yet"
          description="Fetch papers via AI or pull from your RSS feeds to get started."
        >
          <button className="btn btn-primary" onClick={handleFetchAI}>
            Fetch via AI
          </button>
          <button className="btn" onClick={handleFetchRSS}>
            Pull RSS
          </button>
        </EmptyState>
      ) : (
        <div className="paper-grid">
          {papers.map((paper) => (
            <PaperCard key={paper.id} paper={paper} />
          ))}
          {isFetchingNextPage &&
            Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard key={`skel-${i}`} />
            ))}
        </div>
      )}

      <div ref={sentinelRef} className="scroll-sentinel" />
    </>
  )
}

export default FeedPage
