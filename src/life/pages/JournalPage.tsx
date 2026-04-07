import React, { useCallback, useEffect, useMemo, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { listJournalEntries, upsertJournalEntry, getJournalEntry } from '../lib/db'
import type { LifeJournalEntry } from '../types'
import { prettyDate, todayLocal } from '../lib/time'

// The DB schema stores one row per (user, date) with optional summary/wins/
// blockers/tomorrow/energy. For the upgraded "freeform notes" experience we
// keep using the same row, but treat `summary` as the freeform note body so
// the user can write at any time without going through the EOD modal.
//
// Tags + mood are encoded as a tiny `[meta]` line at the end of the body so
// they survive without a schema migration. Anything in the form
//   [tags: foo, bar | mood: focused]
// is parsed back into structured fields and stripped from the rendered body.

const META_REGEX = /\n?\[meta:(.*?)\]\s*$/s

interface ParsedMeta {
  tags: string[]
  mood: string | null
}

function parseMeta(raw: string | null): { body: string; meta: ParsedMeta } {
  if (!raw) return { body: '', meta: { tags: [], mood: null } }
  const m = raw.match(META_REGEX)
  if (!m) return { body: raw, meta: { tags: [], mood: null } }
  const body = raw.replace(META_REGEX, '').trimEnd()
  const segments = m[1].split('|').map((s) => s.trim())
  const tags: string[] = []
  let mood: string | null = null
  for (const seg of segments) {
    if (seg.startsWith('tags:')) {
      tags.push(
        ...seg
          .slice(5)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      )
    } else if (seg.startsWith('mood:')) {
      mood = seg.slice(5).trim() || null
    }
  }
  return { body, meta: { tags, mood } }
}

function serializeMeta(body: string, meta: ParsedMeta): string {
  const trimmed = body.trimEnd()
  const segs: string[] = []
  if (meta.tags.length) segs.push(`tags: ${meta.tags.join(', ')}`)
  if (meta.mood) segs.push(`mood: ${meta.mood}`)
  if (!segs.length) return trimmed
  return `${trimmed}\n[meta: ${segs.join(' | ')}]`
}

const MOODS = ['🔥 great', '🙂 good', '😐 ok', '😔 low', '😴 tired', '😤 stressed']

const JournalPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [entries, setEntries] = useState<LifeJournalEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  // Composer state
  const [composerOpen, setComposerOpen] = useState(false)
  const [editingDate, setEditingDate] = useState<string>('')
  const [body, setBody] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [mood, setMood] = useState<string>('')
  const [energy, setEnergy] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      setEntries(await listJournalEntries(lifeUser.id, 180))
    } finally {
      setLoading(false)
    }
  }, [lifeUser])

  useEffect(() => {
    load()
  }, [load])

  const parsed = useMemo(() => {
    return entries.map((e) => ({ entry: e, ...parseMeta(e.summary) }))
  }, [entries])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const p of parsed) p.meta.tags.forEach((t) => s.add(t))
    return Array.from(s).sort()
  }, [parsed])

  const visible = useMemo(() => {
    let rows = parsed
    if (tagFilter) rows = rows.filter((p) => p.meta.tags.includes(tagFilter))
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter((p) => {
        const haystack = [
          p.body,
          p.entry.wins,
          p.entry.blockers,
          p.entry.tomorrow,
          p.entry.date,
          p.meta.tags.join(' '),
          p.meta.mood ?? '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
    }
    return rows
  }, [parsed, search, tagFilter])

  const openComposer = async (date?: string) => {
    if (!lifeUser) return
    const d = date ?? todayLocal(lifeUser.timezone)
    setEditingDate(d)
    setComposerOpen(true)
    setBody('')
    setTagsInput('')
    setMood('')
    setEnergy(null)
    try {
      const existing = await getJournalEntry(lifeUser.id, d)
      if (existing) {
        const { body: parsedBody, meta } = parseMeta(existing.summary)
        setBody(parsedBody)
        setTagsInput(meta.tags.join(', '))
        setMood(meta.mood ?? '')
        setEnergy(existing.energy)
      }
    } catch {
      // ignore
    }
  }

  const saveNote = async () => {
    if (!lifeUser || !editingDate) return
    setSaving(true)
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const summary = serializeMeta(body, { tags, mood: mood || null })
      await upsertJournalEntry(lifeUser.id, editingDate, {
        summary,
        energy,
      })
      setComposerOpen(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <LifeLayout title="Journal">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <p style={{ margin: 0, color: 'var(--text-muted, #888)', fontSize: '0.85rem' }}>
          Free-form notes, logs, reflections. Write any time — not just at end of day.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="life-btn" onClick={() => openComposer()}>
            + Note for today
          </button>
          <button
            className="life-btn primary"
            onClick={() => {
              const d = prompt('Date (YYYY-MM-DD)?', todayLocal(lifeUser?.timezone))
              if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) openComposer(d)
            }}
          >
            + Note for date
          </button>
        </div>
      </div>

      <input
        className="life-search"
        placeholder="Search notes, tags, wins, blockers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
          <button
            className={`life-btn ${tagFilter === null ? 'primary' : ''}`}
            style={{ padding: '4px 10px', fontSize: '0.74rem' }}
            onClick={() => setTagFilter(null)}
          >
            all
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              className={`life-btn ${tagFilter === t ? 'primary' : ''}`}
              style={{ padding: '4px 10px', fontSize: '0.74rem' }}
              onClick={() => setTagFilter(t === tagFilter ? null : t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {loading && entries.length === 0 ? (
        <div className="life-empty">
          <p>Loading…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="life-empty">
          <h3>{search || tagFilter ? 'No matches' : 'No entries yet'}</h3>
          <p>
            {search || tagFilter
              ? 'Try a different search or tag filter.'
              : 'Click "+ Note for today" to write your first one.'}
          </p>
        </div>
      ) : (
        visible.map(({ entry: e, body: b, meta }) => (
          <div key={e.id} className="life-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div className="life-card-title">
                {prettyDate(e.date, lifeUser?.timezone)}{' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}>
                  · {e.date}
                </span>
              </div>
              <button className="life-btn" onClick={() => openComposer(e.date)}>
                Edit
              </button>
            </div>
            {b && (
              <p
                style={{
                  margin: '8px 0',
                  fontSize: '0.88rem',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {b}
              </p>
            )}
            {e.wins && (
              <div style={{ marginTop: 6 }}>
                <strong style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>WINS</strong>
                <p style={{ margin: '2px 0', fontSize: '0.84rem' }}>{e.wins}</p>
              </div>
            )}
            {e.blockers && (
              <div style={{ marginTop: 6 }}>
                <strong style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  BLOCKERS
                </strong>
                <p style={{ margin: '2px 0', fontSize: '0.84rem' }}>{e.blockers}</p>
              </div>
            )}
            {e.tomorrow && (
              <div style={{ marginTop: 6 }}>
                <strong style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  TOMORROW
                </strong>
                <p style={{ margin: '2px 0', fontSize: '0.84rem' }}>{e.tomorrow}</p>
              </div>
            )}
            <div className="life-card-meta" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              {meta.mood && <span className="life-pill personal">{meta.mood}</span>}
              {e.energy != null && <span>energy {e.energy}/5</span>}
              {meta.tags.map((t) => (
                <span key={t} className="life-pill office">
                  #{t}
                </span>
              ))}
              {e.closed_at && <span>closed</span>}
            </div>
          </div>
        ))
      )}

      {composerOpen && (
        <div
          onClick={() => setComposerOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="life-card"
            style={{ width: 560, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div className="life-card-title">Journal · {editingDate}</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What's on your mind?"
              autoFocus
              style={{
                width: '100%',
                marginTop: 10,
                padding: 12,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg)',
                color: 'var(--text)',
                minHeight: 220,
                fontSize: '0.92rem',
                lineHeight: 1.5,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />

            <div style={{ marginTop: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.74rem',
                  color: 'var(--text-muted)',
                  marginBottom: 4,
                }}
              >
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="work, idea, gratitude…"
                style={{
                  width: '100%',
                  padding: 8,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.74rem',
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                }}
              >
                Mood
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {MOODS.map((m) => (
                  <button
                    key={m}
                    className={`life-btn ${mood === m ? 'primary' : ''}`}
                    style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                    onClick={() => setMood(mood === m ? '' : m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.74rem',
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                }}
              >
                Energy {energy != null ? `(${energy}/5)` : ''}
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={`life-btn ${energy === n ? 'primary' : ''}`}
                    style={{ padding: '4px 12px', fontSize: '0.78rem' }}
                    onClick={() => setEnergy(energy === n ? null : n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 18,
              }}
            >
              <button className="life-btn" onClick={() => setComposerOpen(false)}>
                Cancel
              </button>
              <button
                className="life-btn primary"
                onClick={saveNote}
                disabled={saving || !body.trim()}
              >
                {saving ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </LifeLayout>
  )
}

export default JournalPage
