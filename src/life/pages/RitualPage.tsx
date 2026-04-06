// Ritual — the one-time 30-minute setup that gives the rest of the system a
// spine. Walks through four sections in order:
//   1. Values (3-5 one-word-ish tags you'd die on a hill for)
//   2. Five-year regrets (3-5 things you don't want to look back and realize
//      you never did)
//   3. Yearly goals (2-4 — each links to a 5-year root)
//   4. Quarterly goals (2-4 — each links to a yearly)
//
// Writes live into life_values + life_horizons. Idempotent — re-running won't
// duplicate existing rows (we show them and let the user add/edit/delete).
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  listValues,
  createValue,
  deleteValue,
  listHorizons,
  createHorizon,
  deleteHorizon,
} from '../lib/db'
import type { LifeValue, LifeHorizon, HorizonKind } from '../types'

const STEPS: Array<{ id: number; title: string; hint: string }> = [
  {
    id: 0,
    title: 'Values',
    hint: 'What 3-5 things would you fight for? One word each is fine. These stay forever.',
  },
  {
    id: 1,
    title: 'Five-year regrets',
    hint: '3-5 things you do NOT want to look back in 5 years and realize you never did. No bullshit goals — real ones.',
  },
  {
    id: 2,
    title: 'Yearly goals',
    hint: '2-4 goals for this year. Each one must trace to a 5-year regret.',
  },
  {
    id: 3,
    title: 'Quarterly goals',
    hint: '2-4 goals for this quarter. Each must trace to a yearly goal.',
  },
]

const RitualPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const setValuesStore = useLifeStore((s) => s.setValues)
  const setHorizonsStore = useLifeStore((s) => s.setHorizons)

  const [step, setStep] = useState(0)
  const [values, setValuesState] = useState<LifeValue[]>([])
  const [horizons, setHorizonsState] = useState<LifeHorizon[]>([])
  const [title, setTitle] = useState('')
  const [why, setWhy] = useState('')
  const [parentId, setParentId] = useState<string>('')

  const load = useCallback(async () => {
    if (!lifeUser) return
    const [v, h] = await Promise.all([listValues(lifeUser.id), listHorizons(lifeUser.id)])
    setValuesState(v)
    setHorizonsState(h)
    setValuesStore(v)
    setHorizonsStore(h)
  }, [lifeUser, setValuesStore, setHorizonsStore])

  useEffect(() => {
    load()
  }, [load])

  const addValue = async () => {
    if (!lifeUser || !title.trim()) return
    await createValue({ userId: lifeUser.id, title: title.trim(), description: why.trim() || undefined, weight: 2 })
    setTitle('')
    setWhy('')
    await load()
  }

  const addHorizon = async (kind: HorizonKind) => {
    if (!lifeUser || !title.trim()) return
    if (kind !== 'five_year' && !parentId) {
      alert('Pick a parent so the cascade works.')
      return
    }
    await createHorizon({
      userId: lifeUser.id,
      kind,
      title: title.trim(),
      why: why.trim() || null,
      parent_id: kind === 'five_year' ? null : parentId,
    })
    setTitle('')
    setWhy('')
    setParentId('')
    await load()
  }

  const rmValue = async (id: string) => {
    if (!lifeUser) return
    await deleteValue(lifeUser.id, id)
    await load()
  }

  const rmHorizon = async (id: string) => {
    if (!lifeUser) return
    await deleteHorizon(lifeUser.id, id)
    await load()
  }

  const fiveYears = horizons.filter((h) => h.kind === 'five_year')
  const years = horizons.filter((h) => h.kind === 'year')
  const quarters = horizons.filter((h) => h.kind === 'quarter')

  const current = STEPS[step]
  const canFinish = values.length >= 3 && fiveYears.length >= 2 && years.length >= 1 && quarters.length >= 1

  return (
    <LifeLayout title="Define-once ritual">
      <div className="life-ritual">
        {/* Step strip */}
        <div className="phase-strip" style={{ marginBottom: 16 }}>
          {STEPS.map((s) => (
            <div
              key={s.id}
              className={`phase ${step === s.id ? 'active' : ''} ${step > s.id ? 'done' : ''}`}
            >
              <span className="dot" />
              <span>{s.title}</span>
            </div>
          ))}
        </div>

        <div className="life-card accented">
          <h3>{current.title}</h3>
          <p className="big">{current.hint}</p>

          {step === 0 && (
            <>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Value (e.g. craft, family, honesty)"
                  className="life-input"
                />
                <input
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  placeholder="Why it matters (optional)"
                  className="life-input"
                />
                <button className="life-btn primary" onClick={addValue}>
                  Add
                </button>
              </div>
              <RowList items={values.map((v) => ({ id: v.id, label: v.title, sub: v.description ?? undefined }))} onRemove={rmValue} />
            </>
          )}

          {step === 1 && (
            <>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="5-year regret (e.g. didn't write a book)"
                  className="life-input"
                />
                <input
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  placeholder="Why (optional)"
                  className="life-input"
                />
                <button className="life-btn primary" onClick={() => addHorizon('five_year')}>
                  Add
                </button>
              </div>
              <RowList items={fiveYears.map((h) => ({ id: h.id, label: h.title, sub: h.why ?? undefined }))} onRemove={rmHorizon} />
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Yearly goal"
                  className="life-input"
                />
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="life-select"
                >
                  <option value="">trace to 5-year…</option>
                  {fiveYears.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.title}
                    </option>
                  ))}
                </select>
                <button className="life-btn primary" onClick={() => addHorizon('year')}>
                  Add
                </button>
              </div>
              <RowList
                items={years.map((h) => ({
                  id: h.id,
                  label: h.title,
                  sub: `→ ${fiveYears.find((f) => f.id === h.parent_id)?.title ?? '?'}`,
                }))}
                onRemove={rmHorizon}
              />
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Quarterly goal"
                  className="life-input"
                />
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="life-select"
                >
                  <option value="">trace to yearly…</option>
                  {years.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.title}
                    </option>
                  ))}
                </select>
                <button className="life-btn primary" onClick={() => addHorizon('quarter')}>
                  Add
                </button>
              </div>
              <RowList
                items={quarters.map((h) => ({
                  id: h.id,
                  label: h.title,
                  sub: `→ ${years.find((y) => y.id === h.parent_id)?.title ?? '?'}`,
                }))}
                onRemove={rmHorizon}
              />
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="life-btn" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
              ← Back
            </button>
            {step < 3 ? (
              <button className="life-btn primary" onClick={() => setStep(step + 1)}>
                Next
              </button>
            ) : (
              <button
                className="life-btn primary"
                onClick={() => navigate('/life')}
                disabled={!canFinish}
                title={canFinish ? 'Save and return to Today' : 'Need ≥3 values, ≥2 five-year, ≥1 year, ≥1 quarter'}
              >
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </LifeLayout>
  )
}

const RowList: React.FC<{
  items: Array<{ id: string; label: string; sub?: string }>
  onRemove: (id: string) => void
}> = ({ items, onRemove }) => (
  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
    {items.map((it) => (
      <div
        key={it.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg)',
          fontSize: '0.85rem',
        }}
      >
        <strong style={{ minWidth: 140 }}>{it.label}</strong>
        {it.sub && <span style={{ flex: 1, color: 'var(--text-muted, #888)' }}>{it.sub}</span>}
        <button
          onClick={() => onRemove(it.id)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #888)',
            cursor: 'pointer',
            fontSize: '1.1rem',
          }}
        >
          ×
        </button>
      </div>
    ))}
  </div>
)

export default RitualPage
