// Eulogy mode — quarterly calm reckoning. Shows the last 90 days' time
// allocation (tasks-per-horizon as a proxy) and extrapolates it across five
// years. The point is not shame; it's clarity. Run it once a quarter.
//
// Method (Phase 8 version):
//   - count done tasks in last 90 days, grouped by their goal_id → horizon_id
//     → 5-year root
//   - compute % per 5-year root
//   - display "if the next 5 years looked like the last 90 days, you'd spend
//     ~X days on each long-horizon goal"
//
// If values/horizons aren't set, show an onboarding CTA instead.
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { lifeDb } from '../lib/db/_client'

interface Row {
  label: string
  share: number
  tasks: number
}

const EulogyPage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const horizons = useLifeStore((s) => s.horizons)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [sampleCount, setSampleCount] = useState(0)

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      const since = new Date()
      since.setDate(since.getDate() - 90)
      const { data, error } = await lifeDb()
        .from('life_tasks')
        .select('goal_id, status, done_at')
        .eq('user_id', lifeUser.id)
        .eq('status', 'done')
        .gte('done_at', since.toISOString())
      if (error) throw new Error(error.message)
      const tasks = (data ?? []) as Array<{ goal_id: string | null }>
      setSampleCount(tasks.length)

      // Map goal_id → horizon title via the horizons in store + a quick goals lookup
      const goalIds = Array.from(new Set(tasks.map((t) => t.goal_id).filter(Boolean))) as string[]
      const goalToHorizon = new Map<string, string>()
      if (goalIds.length > 0) {
        const { data: goals } = await lifeDb()
          .from('life_goals')
          .select('id, horizon_id')
          .eq('user_id', lifeUser.id)
          .in('id', goalIds)
        for (const g of (goals ?? []) as Array<{ id: string; horizon_id: string | null }>) {
          if (g.horizon_id) goalToHorizon.set(g.id, g.horizon_id)
        }
      }

      // Walk the horizon tree up to find the 5-year root for each task.
      const horizonMap = new Map(horizons.map((h) => [h.id, h]))
      const rootFor = (id: string): string | null => {
        let cursor: string | null = id
        let safety = 5
        while (cursor && safety-- > 0) {
          const h = horizonMap.get(cursor)
          if (!h) return null
          if (h.kind === 'five_year') return h.id
          cursor = h.parent_id
        }
        return null
      }

      const buckets = new Map<string, number>()
      let unattributed = 0
      for (const t of tasks) {
        const horizonId = t.goal_id ? goalToHorizon.get(t.goal_id) : null
        const rootId = horizonId ? rootFor(horizonId) : null
        if (!rootId) {
          unattributed++
          continue
        }
        buckets.set(rootId, (buckets.get(rootId) ?? 0) + 1)
      }

      const total = tasks.length || 1
      const out: Row[] = []
      for (const [rootId, n] of buckets) {
        out.push({
          label: horizonMap.get(rootId)?.title ?? 'Unknown',
          share: n / total,
          tasks: n,
        })
      }
      if (unattributed > 0) {
        out.push({
          label: '(unattributed — no 5-year goal)',
          share: unattributed / total,
          tasks: unattributed,
        })
      }
      out.sort((a, b) => b.share - a.share)
      setRows(out)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, horizons])

  useEffect(() => {
    load()
  }, [load])

  const fiveYearHorizons = horizons.filter((h) => h.kind === 'five_year')

  if (fiveYearHorizons.length === 0) {
    return (
      <LifeLayout title="Eulogy">
        <div className="life-card accented">
          <h3>Eulogy mode needs your 5-year regret list</h3>
          <p className="big">
            This view shows whether your day-to-day matches what you said you'd regret not
            doing in 5 years. It only works if you've declared those bets. Go set 3-5
            five-year items, then come back.
          </p>
          <div>
            <button className="life-btn primary" onClick={() => navigate('/life/goals')}>
              Define 5-year bets →
            </button>
          </div>
        </div>
      </LifeLayout>
    )
  }

  return (
    <LifeLayout title="Eulogy — last 90 days → next 5 years">
      <div className="life-card accented">
        <h3>What your 90 days actually say</h3>
        {loading ? (
          <div className="life-empty-inline">Loading…</div>
        ) : sampleCount === 0 ? (
          <div className="life-empty-inline">
            Not enough data — need done tasks over the last 90 days.
          </div>
        ) : (
          <>
            <p className="life-empty-inline">
              {sampleCount} tasks closed. If the next 5 years spend time the way the last
              90 days did, this is your allocation:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {rows.map((r) => (
                <div key={r.label}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                      marginBottom: 4,
                    }}
                  >
                    <span>{r.label}</span>
                    <span style={{ color: 'var(--text-muted, #888)' }}>
                      {Math.round(r.share * 100)}% · {r.tasks} tasks
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 999,
                      background: 'var(--bg2, rgba(0,0,0,0.06))',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round(r.share * 100)}%`,
                        height: '100%',
                        background: 'var(--ws-accent, var(--accent))',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 16,
                fontSize: '0.85rem',
                lineHeight: 1.55,
                color: 'var(--text)',
              }}
            >
              {rows[0]?.label.startsWith('(unattributed')
                ? 'Most of your last 90 days has no trace to a 5-year goal. The eulogy is: you were busy, but on what?'
                : `Biggest allocation: ${rows[0]?.label}. Ask yourself — is that the one you actually want?`}
            </div>
          </>
        )}
      </div>
    </LifeLayout>
  )
}

export default EulogyPage
