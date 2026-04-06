import React, { useCallback, useEffect, useMemo, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { listJournalEntries } from '../lib/db'
import type { LifeJournalEntry } from '../types'
import { prettyDate } from '../lib/time'

const JournalPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [entries, setEntries] = useState<LifeJournalEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      setEntries(await listJournalEntries(lifeUser.id, 90))
    } finally {
      setLoading(false)
    }
  }, [lifeUser])

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter((e) =>
      [e.summary, e.wins, e.blockers, e.tomorrow, e.date]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(q))
    )
  }, [entries, search])

  return (
    <LifeLayout title="Journal">
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted, #888)', fontSize: '0.85rem' }}>
        End-of-day summaries. Use "Close the day" in the topbar to add today's entry.
      </p>

      <input
        className="life-search"
        placeholder="Search journal entries…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading && entries.length === 0 ? (
        <div className="life-empty"><p>Loading…</p></div>
      ) : visible.length === 0 ? (
        <div className="life-empty">
          <h3>{search ? 'No matches' : 'No entries yet'}</h3>
          <p>{search ? 'Try a different search.' : 'Click "Close the day" to write your first one.'}</p>
        </div>
      ) : (
        visible.map((e) => (
          <div key={e.id} className="life-card">
            <div className="life-card-title">{prettyDate(e.date, lifeUser?.timezone)} · {e.date}</div>
            {e.summary && <p style={{ margin: '8px 0', fontSize: '0.88rem', lineHeight: 1.55 }}>{e.summary}</p>}
            {e.wins && <div style={{ marginTop: 6 }}><strong style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>WINS</strong><p style={{ margin: '2px 0', fontSize: '0.84rem' }}>{e.wins}</p></div>}
            {e.blockers && <div style={{ marginTop: 6 }}><strong style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>BLOCKERS</strong><p style={{ margin: '2px 0', fontSize: '0.84rem' }}>{e.blockers}</p></div>}
            {e.tomorrow && <div style={{ marginTop: 6 }}><strong style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>TOMORROW</strong><p style={{ margin: '2px 0', fontSize: '0.84rem' }}>{e.tomorrow}</p></div>}
            <div className="life-card-meta" style={{ marginTop: 8 }}>
              {e.energy != null && <span>energy {e.energy}/5</span>}
              {e.closed_at && <span>closed</span>}
            </div>
          </div>
        ))
      )}
    </LifeLayout>
  )
}

export default JournalPage
