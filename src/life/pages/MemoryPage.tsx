// Memory — "what the agent knows about you." Read-only view of life_memory
// with delete-to-forget. Groups rows into Shared (workspace_id = null) and
// per-workspace buckets.
import React, { useCallback, useEffect, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { listMemory, deleteMemory, upsertMemory } from '../lib/db'
import type { LifeMemory } from '../types'

const MemoryPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const workspaces = useLifeStore((s) => s.workspaces)
  const [rows, setRows] = useState<LifeMemory[]>([])
  const [loading, setLoading] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newScope, setNewScope] = useState<'shared' | string>('shared')

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      // Fetch all scopes
      const shared = await listMemory(lifeUser.id, null)
      const perWs: LifeMemory[] = []
      for (const w of workspaces) {
        const items = await listMemory(lifeUser.id, w.id)
        perWs.push(...items.filter((m) => m.workspace_id === w.id))
      }
      // Deduplicate — sharedfetch returns only null, perWs returns only non-null.
      setRows([...shared.filter((m) => m.workspace_id === null), ...perWs])
    } finally {
      setLoading(false)
    }
  }, [lifeUser, workspaces])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = async (id: string) => {
    if (!lifeUser) return
    await deleteMemory(lifeUser.id, id)
    await load()
  }

  const handleAdd = async () => {
    if (!lifeUser || !newKey.trim() || !newValue.trim()) return
    await upsertMemory({
      userId: lifeUser.id,
      workspaceId: newScope === 'shared' ? null : newScope,
      key: newKey.trim(),
      value: newValue.trim(),
      source: 'user',
    })
    setNewKey('')
    setNewValue('')
    await load()
  }

  const shared = rows.filter((r) => r.workspace_id === null)
  const byWorkspace = (id: string) => rows.filter((r) => r.workspace_id === id)

  return (
    <LifeLayout title="Memory">
      <div className="life-card" style={{ marginBottom: 16 }}>
        <h3>Add a fact</h3>
        <p className="life-empty-inline">
          Facts the agent should remember across conversations. Keys are short, values
          are plain text.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="key (e.g. manager)"
            style={{
              flex: '1 1 120px',
              padding: 8,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: '0.85rem',
            }}
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value (e.g. Priya)"
            style={{
              flex: '2 1 200px',
              padding: 8,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: '0.85rem',
            }}
          />
          <select
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            className="life-select"
          >
            <option value="shared">shared</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} only
              </option>
            ))}
          </select>
          <button className="life-btn primary" onClick={handleAdd}>
            Add
          </button>
        </div>
      </div>

      <MemoryGroup
        title="Shared (both workspaces)"
        items={shared}
        onDelete={handleDelete}
        empty={loading ? 'Loading…' : 'No shared facts yet.'}
      />

      {workspaces.map((w) => (
        <MemoryGroup
          key={w.id}
          title={`${w.name} only`}
          items={byWorkspace(w.id)}
          onDelete={handleDelete}
          empty={loading ? 'Loading…' : `No ${w.name.toLowerCase()}-scoped facts yet.`}
        />
      ))}
    </LifeLayout>
  )
}

const MemoryGroup: React.FC<{
  title: string
  items: LifeMemory[]
  onDelete: (id: string) => void
  empty: string
}> = ({ title, items, onDelete, empty }) => (
  <div className="life-card" style={{ marginBottom: 12 }}>
    <h3>
      {title} · {items.length}
    </h3>
    {items.length === 0 ? (
      <div className="life-empty-inline">{empty}</div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg)',
              fontSize: '0.84rem',
            }}
          >
            <strong style={{ minWidth: 110 }}>{m.key}</strong>
            <span style={{ flex: 1 }}>{m.value}</span>
            <span className="tag">{m.source}</span>
            <button
              onClick={() => onDelete(m.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted, #888)',
                cursor: 'pointer',
                fontSize: '1.1rem',
                padding: '0 4px',
              }}
              title="Forget this"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
)

export default MemoryPage
