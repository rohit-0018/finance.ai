import React, { useCallback, useEffect, useMemo, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useAppStore } from '../../store'
import { useLifeStore } from '../store'
import {
  listLearnItems,
  createLearnItem,
  updateLearnItem,
  deleteLearnItem,
  getImportedPapermindIds,
} from '../lib/db'
import { fetchPapermindLibrary } from '../lib/papermindBridge'
import type { LifeLearnItem, LearnStatus } from '../types'

const STATUS_TABS: LearnStatus[] = ['queue', 'reading', 'done']

const LearnPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const papermindUser = useAppStore((s) => s.currentUser)
  const [items, setItems] = useState<LifeLearnItem[]>([])
  const [tab, setTab] = useState<LearnStatus>('queue')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!lifeUser) return
    setItems(await listLearnItems(lifeUser.id))
  }, [lifeUser])

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => {
    let list = items.filter((i) => i.status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.notes ?? '').toLowerCase().includes(q) ||
          (i.topic ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, tab, search])

  const addManual = async () => {
    if (!lifeUser || !title.trim()) return
    await createLearnItem({
      userId: lifeUser.id,
      title: title.trim(),
      source_url: url.trim() || null,
      source_type: url.trim() ? 'url' : 'manual',
    })
    setTitle('')
    setUrl('')
    setShowForm(false)
    load()
  }

  const move = async (item: LifeLearnItem, status: LearnStatus) => {
    if (!lifeUser) return
    await updateLearnItem(lifeUser.id, item.id, { status })
    load()
  }

  const remove = async (item: LifeLearnItem) => {
    if (!lifeUser) return
    if (!confirm(`Remove "${item.title}"?`)) return
    await deleteLearnItem(lifeUser.id, item.id)
    load()
  }

  const importFromPapermind = async () => {
    if (!lifeUser || !papermindUser) return
    setImporting(true)
    setImportMsg(null)
    try {
      const [bridged, alreadyImported] = await Promise.all([
        fetchPapermindLibrary(papermindUser.id),
        getImportedPapermindIds(lifeUser.id),
      ])
      let added = 0
      for (const b of bridged) {
        if (alreadyImported.has(b.papermind_id)) continue
        await createLearnItem({
          userId: lifeUser.id,
          title: b.title,
          source_url: b.source_url,
          source_type: b.source_type,
          papermind_id: b.papermind_id,
          topic: b.topic,
        })
        added++
      }
      setImportMsg(
        added === 0
          ? 'Already up to date — nothing new in papermind.'
          : `Imported ${added} item${added === 1 ? '' : 's'} from papermind.`
      )
      load()
    } catch (err) {
      setImportMsg(`Import failed: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <LifeLayout title="Learn">
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((s) => {
          const count = items.filter((i) => i.status === s).length
          return (
            <button
              key={s}
              className={`life-btn ${tab === s ? 'primary' : ''}`}
              onClick={() => setTab(s)}
            >
              {s} ({count})
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <button className="life-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add'}
        </button>
        <button className="life-btn primary" onClick={importFromPapermind} disabled={importing}>
          {importing ? 'Importing…' : '↳ Import from papermind'}
        </button>
      </div>

      {importMsg && (
        <div className="life-card" style={{ marginBottom: 14, fontSize: '0.83rem' }}>
          {importMsg}
        </div>
      )}

      {showForm && (
        <div className="life-card" style={{ marginBottom: 16 }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            style={{ width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', marginBottom: 10, fontSize: '0.95rem', outline: 'none' }}
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (optional)"
            style={{ width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', marginBottom: 10, fontSize: '0.85rem', outline: 'none' }}
          />
          <button className="life-btn primary" onClick={addManual}>Add to queue</button>
        </div>
      )}

      <input
        className="life-search"
        placeholder="Search learn items…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {visible.length === 0 ? (
        <div className="life-empty">
          <h3>Nothing here</h3>
          <p>Add an item or import from papermind.</p>
        </div>
      ) : (
        visible.map((item) => (
          <div key={item.id} className="life-card">
            <div className="life-card-title">
              {item.source_url ? (
                <a href={item.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                  {item.title}
                </a>
              ) : (
                item.title
              )}
            </div>
            <div className="life-card-meta">
              <span>{item.source_type.replace('_', ' ')}</span>
              {item.topic && <span>topic: {item.topic}</span>}
              {item.completed_at && <span>done {item.completed_at.slice(0, 10)}</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {tab !== 'reading' && <button className="life-btn" onClick={() => move(item, 'reading')}>Start reading</button>}
              {tab !== 'done' && <button className="life-btn primary" onClick={() => move(item, 'done')}>Mark done</button>}
              {tab === 'done' && <button className="life-btn" onClick={() => move(item, 'queue')}>Re-queue</button>}
              <button className="life-btn danger" onClick={() => remove(item)}>Delete</button>
            </div>
          </div>
        ))
      )}
    </LifeLayout>
  )
}

export default LearnPage
