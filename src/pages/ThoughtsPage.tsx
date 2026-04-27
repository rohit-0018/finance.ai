import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import EmptyState from '../components/EmptyState'
import { useAppStore } from '../store'
import {
  dbCreateThought,
  dbDeleteThought,
  dbGetThoughts,
  dbUpdateThought,
} from '../lib/supabase'
import type { Thought } from '../types'

// Local YYYY-MM-DD bucket key for grouping. Using local time so a thought
// jotted at 11pm groups with that calendar day, not the next UTC day.
function localDateKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function prettyDateLabel(key: string): string {
  const today = localDateKey(new Date().toISOString())
  if (key === today) return 'Today'
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  if (key === localDateKey(yesterdayDate.toISOString())) return 'Yesterday'
  const d = new Date(`${key}T00:00:00`)
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function parseTagsInput(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
}

const ThoughtsPage: React.FC = () => {
  const currentUser = useAppStore((s) => s.currentUser)
  const [thoughts, setThoughts] = useState<Thought[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<string>('') // YYYY-MM-DD or ''

  // Composer
  const [content, setContent] = useState('')
  const [description, setDescription] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [saving, setSaving] = useState(false)

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editTagsInput, setEditTagsInput] = useState('')

  const load = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)
    try {
      setThoughts(await dbGetThoughts(currentUser.id))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [currentUser])

  useEffect(() => {
    load()
  }, [load])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const t of thoughts) (t.tags ?? []).forEach((tag) => set.add(tag))
    return Array.from(set).sort()
  }, [thoughts])

  const allDates = useMemo(() => {
    const set = new Set<string>()
    for (const t of thoughts) set.add(localDateKey(t.created_at))
    return Array.from(set).sort().reverse()
  }, [thoughts])

  const visible = useMemo(() => {
    let rows = thoughts
    if (dateFilter) {
      rows = rows.filter((t) => localDateKey(t.created_at) === dateFilter)
    }
    if (tagFilter) {
      rows = rows.filter((t) => (t.tags ?? []).includes(tagFilter))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter((t) => {
        const haystack = [t.content, t.description ?? '', (t.tags ?? []).join(' ')]
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
    }
    return rows
  }, [thoughts, dateFilter, tagFilter, search])

  // Group visible thoughts by their local date key, preserving newest-first order.
  const grouped = useMemo(() => {
    const map = new Map<string, Thought[]>()
    for (const t of visible) {
      const key = localDateKey(t.created_at)
      const list = map.get(key)
      if (list) list.push(t)
      else map.set(key, [t])
    }
    return Array.from(map.entries())
  }, [visible])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || !content.trim()) return
    setSaving(true)
    try {
      const created = await dbCreateThought({
        userId: currentUser.id,
        content: content.trim(),
        description: description.trim() || null,
        tags: parseTagsInput(tagsInput),
      })
      setThoughts((prev) => [created, ...prev])
      setContent('')
      setDescription('')
      setTagsInput('')
      toast.success('Thought saved')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const beginEdit = (t: Thought) => {
    setEditingId(t.id)
    setEditContent(t.content)
    setEditDescription(t.description ?? '')
    setEditTagsInput((t.tags ?? []).join(', '))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
    setEditDescription('')
    setEditTagsInput('')
  }

  const saveEdit = async (id: string) => {
    if (!currentUser || !editContent.trim()) return
    try {
      const updated = await dbUpdateThought(currentUser.id, id, {
        content: editContent.trim(),
        description: editDescription.trim() || null,
        tags: parseTagsInput(editTagsInput),
      })
      setThoughts((prev) => prev.map((t) => (t.id === id ? updated : t)))
      cancelEdit()
      toast.success('Updated')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const remove = async (id: string) => {
    if (!currentUser) return
    if (!confirm('Delete this thought?')) return
    try {
      await dbDeleteThought(currentUser.id, id)
      setThoughts((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">Thoughts</div>
        <div className="page-actions">
          <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
            {visible.length} of {thoughts.length}
          </span>
        </div>
      </div>

      <div style={{ padding: '0 24px 16px' }}>
        <form
          onSubmit={submit}
          style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <input
            type="text"
            placeholder="What's on your mind?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 10px',
              color: 'var(--text)',
              fontSize: '0.95rem',
              fontWeight: 500,
            }}
          />
          <textarea
            placeholder="Description (optional) — context, why it matters, what to do next…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 10px',
              color: 'var(--text)',
              fontSize: '0.85rem',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="tags (comma-separated, e.g. idea, work, life)"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              style={{
                flex: 1,
                minWidth: 180,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 10px',
                color: 'var(--text)',
                fontSize: '0.8rem',
              }}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={saving || !content.trim()}
            >
              {saving ? 'Saving…' : '+ Add thought'}
            </button>
          </div>
        </form>
      </div>

      <div className="notes-filters">
        <input
          type="text"
          placeholder="Search content, description, tags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        >
          <option value="">All dates</option>
          {allDates.map((d) => (
            <option key={d} value={d}>
              {prettyDateLabel(d)} · {d}
            </option>
          ))}
        </select>
        {(search || tagFilter || dateFilter) && (
          <button
            className="btn btn-sm"
            onClick={() => {
              setSearch('')
              setTagFilter(null)
              setDateFilter('')
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {allTags.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            padding: '0 24px 12px',
          }}
        >
          <button
            className={`btn btn-sm ${tagFilter === null ? 'btn-primary' : ''}`}
            onClick={() => setTagFilter(null)}
          >
            all tags
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`btn btn-sm ${tagFilter === tag ? 'btn-primary' : ''}`}
              onClick={() => setTagFilter(tag === tagFilter ? null : tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="loading-center">Loading thoughts...</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="T"
          title={
            thoughts.length === 0
              ? 'No thoughts yet'
              : 'No thoughts match your filters'
          }
          description={
            thoughts.length === 0
              ? 'Use the box above to dump anything on your mind. Tag it so future-you can find it.'
              : 'Try clearing search, date, or tag filters.'
          }
        />
      ) : (
        <div style={{ padding: '0 24px 40px' }}>
          {grouped.map(([dateKey, items]) => (
            <section key={dateKey} style={{ marginBottom: 28 }}>
              <h3
                style={{
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text3)',
                  margin: '0 0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span>{prettyDateLabel(dateKey)}</span>
                <span style={{ color: 'var(--text3)', fontWeight: 400 }}>
                  · {dateKey} · {items.length}
                </span>
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((t) =>
                  editingId === t.id ? (
                    <div
                      key={t.id}
                      style={{
                        background: 'var(--bg2)',
                        border: '1px solid var(--accent)',
                        borderRadius: 10,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <input
                        type="text"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '8px 10px',
                          color: 'var(--text)',
                          fontSize: '0.95rem',
                          fontWeight: 500,
                        }}
                      />
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        placeholder="Description"
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '8px 10px',
                          color: 'var(--text)',
                          fontSize: '0.85rem',
                          resize: 'vertical',
                          fontFamily: 'inherit',
                        }}
                      />
                      <input
                        type="text"
                        value={editTagsInput}
                        onChange={(e) => setEditTagsInput(e.target.value)}
                        placeholder="tags"
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 10px',
                          color: 'var(--text)',
                          fontSize: '0.8rem',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => saveEdit(t.id)}
                        >
                          Save
                        </button>
                        <button className="btn btn-sm" onClick={cancelEdit}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <article
                      key={t.id}
                      style={{
                        background: 'var(--bg2)',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        padding: 12,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '0.95rem',
                              fontWeight: 500,
                              color: 'var(--text)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {t.content}
                          </div>
                          {t.description && (
                            <p
                              style={{
                                margin: '6px 0 0',
                                fontSize: '0.85rem',
                                lineHeight: 1.5,
                                color: 'var(--text2)',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {t.description}
                            </p>
                          )}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: 4,
                            flexShrink: 0,
                          }}
                        >
                          <button
                            className="btn btn-sm"
                            onClick={() => beginEdit(t)}
                            title="Edit"
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => remove(t.id)}
                            title="Delete"
                            style={{ color: 'var(--red, #ef4444)' }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 8,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          fontSize: '0.72rem',
                          color: 'var(--text3)',
                        }}
                      >
                        <span>{timeLabel(t.created_at)}</span>
                        {(t.tags ?? []).map((tag) => (
                          <button
                            key={tag}
                            onClick={() => setTagFilter(tag)}
                            style={{
                              background: 'var(--bg3, var(--bg))',
                              border: '1px solid var(--border)',
                              borderRadius: 999,
                              padding: '2px 8px',
                              color: 'var(--text2)',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                            }}
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    </article>
                  )
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

export default ThoughtsPage
