import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts'

import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  listFinanceCategories,
  listFinanceTransactions,
  createFinanceTransaction,
  deleteFinanceTransaction,
  updateFinanceTransaction,
  createFinanceCategory,
  updateFinanceCategory,
  deleteFinanceCategory,
  aggregateByCategory,
  aggregateDaily,
  aggregateMonthly,
} from '../lib/db'
import type {
  LifeFinanceCategory,
  LifeFinanceTransaction,
  FinanceKind,
  PaymentMethod,
} from '../types'

// All amounts in the UI live as paise/cents to keep aggregations exact.
const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'upi', 'card', 'bank', 'other']

type Tab = 'log' | 'overview' | 'transactions' | 'budgets' | 'categories' | 'insights'
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'log', label: 'Log', icon: '✏️' },
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'transactions', label: 'Transactions', icon: '📜' },
  { id: 'budgets', label: 'Budgets', icon: '🎯' },
  { id: 'categories', label: 'Categories', icon: '🏷️' },
  { id: 'insights', label: 'Insights', icon: '💡' },
]

const RUPEE = '₹'
const fmt = (cents: number) => {
  const v = (cents / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })
  return `${RUPEE}${v}`
}
const fmtFull = (cents: number) => {
  const v = (cents / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${RUPEE}${v}`
}

function startOfMonthIso(): string {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
function endOfMonthIso(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 0)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}
function startOfMonthsAgoIso(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n, 1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
function todayLocalDateInputValue(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const FinancePage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)

  const [tab, setTab] = useState<Tab>('log')
  const [categories, setCategories] = useState<LifeFinanceCategory[]>([])
  const [txnsThisMonth, setTxnsThisMonth] = useState<LifeFinanceTransaction[]>([])
  const [txnsTrend, setTxnsTrend] = useState<LifeFinanceTransaction[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      const cats = await listFinanceCategories(lifeUser.id)
      setCategories(cats)
      const [thisMonth, trend] = await Promise.all([
        listFinanceTransactions(lifeUser.id, {
          fromIso: startOfMonthIso(),
          toIso: endOfMonthIso(),
          limit: 1000,
        }),
        listFinanceTransactions(lifeUser.id, {
          fromIso: startOfMonthsAgoIso(5),
          toIso: endOfMonthIso(),
          limit: 5000,
        }),
      ])
      setTxnsThisMonth(thisMonth)
      setTxnsTrend(trend)
    } finally {
      setLoading(false)
    }
  }, [lifeUser])

  useEffect(() => {
    reload()
  }, [reload])

  const expenseCats = useMemo(() => categories.filter((c) => c.kind === 'expense'), [categories])
  const incomeCats = useMemo(() => categories.filter((c) => c.kind === 'income'), [categories])
  const catById = useMemo(() => {
    const m = new Map<string, LifeFinanceCategory>()
    for (const c of categories) m.set(c.id, c)
    return m
  }, [categories])

  // Headline KPIs
  const totals = useMemo(() => {
    let exp = 0
    let inc = 0
    for (const t of txnsThisMonth) {
      if (t.kind === 'expense') exp += t.amount_cents
      else inc += t.amount_cents
    }
    return { exp, inc, net: inc - exp }
  }, [txnsThisMonth])

  return (
    <LifeLayout title="Finance">
      <div className="life-fin-header">
        <KPICard label="Spent this month" value={fmt(totals.exp)} accent="#ef4444" />
        <KPICard label="Earned this month" value={fmt(totals.inc)} accent="#22c55e" />
        <KPICard
          label="Net"
          value={fmt(totals.net)}
          accent={totals.net >= 0 ? '#22c55e' : '#ef4444'}
        />
        <KPICard label="Transactions" value={`${txnsThisMonth.length}`} accent="#6366f1" />
      </div>

      <nav className="life-fin-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`life-fin-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {loading && categories.length === 0 ? (
        <div className="life-empty">
          <p>Loading…</p>
        </div>
      ) : (
        <>
          {tab === 'log' && (
            <LogTab
              categories={expenseCats.concat(incomeCats)}
              expenseCats={expenseCats}
              incomeCats={incomeCats}
              workspaceId={activeWorkspace?.id ?? null}
              onSaved={reload}
              recent={txnsThisMonth.slice(0, 6)}
              catById={catById}
            />
          )}
          {tab === 'overview' && (
            <OverviewTab
              txnsThisMonth={txnsThisMonth}
              txnsTrend={txnsTrend}
              categories={categories}
            />
          )}
          {tab === 'transactions' && (
            <TransactionsTab
              categories={categories}
              catById={catById}
              onChanged={reload}
            />
          )}
          {tab === 'budgets' && (
            <BudgetsTab
              categories={expenseCats}
              txnsThisMonth={txnsThisMonth}
              onChanged={reload}
            />
          )}
          {tab === 'categories' && (
            <CategoriesTab categories={categories} onChanged={reload} />
          )}
          {tab === 'insights' && (
            <InsightsTab
              txnsThisMonth={txnsThisMonth}
              txnsTrend={txnsTrend}
              catById={catById}
            />
          )}
        </>
      )}
    </LifeLayout>
  )
}

// ──────────────────────────────────────────────────────────────────────
// KPI card
// ──────────────────────────────────────────────────────────────────────
const KPICard: React.FC<{ label: string; value: string; accent: string }> = ({
  label,
  value,
  accent,
}) => (
  <div className="life-fin-kpi" style={{ borderLeftColor: accent }}>
    <div className="life-fin-kpi-label">{label}</div>
    <div className="life-fin-kpi-value">{value}</div>
  </div>
)

// ──────────────────────────────────────────────────────────────────────
// LOG TAB — daily 10pm workflow. Big amount input, category grid, instant save.
// ──────────────────────────────────────────────────────────────────────
const LogTab: React.FC<{
  categories: LifeFinanceCategory[]
  expenseCats: LifeFinanceCategory[]
  incomeCats: LifeFinanceCategory[]
  workspaceId: string | null
  onSaved: () => void
  recent: LifeFinanceTransaction[]
  catById: Map<string, LifeFinanceCategory>
}> = ({ expenseCats, incomeCats, workspaceId, onSaved, recent, catById }) => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [kind, setKind] = useState<FinanceKind>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi')
  const [date, setDate] = useState(todayLocalDateInputValue())
  const [tagsInput, setTagsInput] = useState('')
  const [saving, setSaving] = useState(false)

  // When the user toggles kind, prefer a category from that kind.
  useEffect(() => {
    setCategoryId(null)
  }, [kind])

  const visibleCats = kind === 'expense' ? expenseCats : incomeCats

  const submit = async () => {
    if (!lifeUser) return
    const num = parseFloat(amount)
    if (!Number.isFinite(num) || num <= 0) return
    if (!categoryId) {
      alert('Pick a category first.')
      return
    }
    setSaving(true)
    try {
      // Combine the chosen date with the current local time so multiple
      // entries on the same day still sort by clock order.
      const now = new Date()
      const occurred = new Date(`${date}T${now.toTimeString().slice(0, 8)}`)
      await createFinanceTransaction({
        userId: lifeUser.id,
        workspaceId,
        categoryId,
        amount_cents: Math.round(num * 100),
        kind,
        note: note.trim() || null,
        payment_method: paymentMethod,
        occurred_at: occurred.toISOString(),
        tags: tagsInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      })
      setAmount('')
      setNote('')
      setTagsInput('')
      onSaved()
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="life-fin-log">
        <div className="life-fin-log-row">
          <div className="life-fin-kind-toggle">
            <button
              className={kind === 'expense' ? 'active expense' : ''}
              onClick={() => setKind('expense')}
            >
              − Expense
            </button>
            <button
              className={kind === 'income' ? 'active income' : ''}
              onClick={() => setKind('income')}
            >
              + Income
            </button>
          </div>
          <div className="life-fin-amount-wrap">
            <span className="life-fin-currency">{RUPEE}</span>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="life-fin-amount-input"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          </div>
        </div>

        <div className="life-fin-section-label">Category</div>
        <div className="life-fin-cat-grid">
          {visibleCats.map((c) => (
            <button
              key={c.id}
              className={`life-fin-cat-pill ${categoryId === c.id ? 'active' : ''}`}
              onClick={() => setCategoryId(c.id)}
              style={{
                ['--cat-color' as string]: c.color,
              }}
              title={c.name}
            >
              <span className="cat-icon">{c.icon}</span>
              <span className="cat-name">{c.name}</span>
            </button>
          ))}
        </div>

        <div className="life-fin-form-grid">
          <div>
            <label className="life-fin-label">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="life-fin-input"
            />
          </div>
          <div>
            <label className="life-fin-label">Payment</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="life-fin-input"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="life-fin-label">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was this for?"
              className="life-fin-input"
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="life-fin-label">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="lunch, with-team, work"
              className="life-fin-input"
            />
          </div>
        </div>

        <button
          className="life-btn primary life-fin-save"
          onClick={submit}
          disabled={saving || !amount || !categoryId}
        >
          {saving ? 'Saving…' : `Save ${kind}`}
        </button>
      </div>

      <h3 className="life-fin-h3">Just logged</h3>
      {recent.length === 0 ? (
        <div className="life-empty">
          <p>Nothing logged yet this month. Start with whatever you spent today.</p>
        </div>
      ) : (
        <div className="life-fin-recent">
          {recent.map((t) => {
            const c = t.category_id ? catById.get(t.category_id) : null
            return (
              <div key={t.id} className="life-fin-recent-row">
                <span className="life-fin-recent-icon" style={{ background: c?.color ?? '#64748b' }}>
                  {c?.icon ?? '💸'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="life-fin-recent-title">{c?.name ?? 'Uncategorized'}</div>
                  {t.note && <div className="life-fin-recent-note">{t.note}</div>}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    color: t.kind === 'expense' ? '#ef4444' : '#22c55e',
                  }}
                >
                  {t.kind === 'expense' ? '−' : '+'}
                  {fmtFull(t.amount_cents)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// OVERVIEW TAB — charts
// ──────────────────────────────────────────────────────────────────────
const OverviewTab: React.FC<{
  txnsThisMonth: LifeFinanceTransaction[]
  txnsTrend: LifeFinanceTransaction[]
  categories: LifeFinanceCategory[]
}> = ({ txnsThisMonth, txnsTrend, categories }) => {
  const catById = useMemo(() => {
    const m = new Map<string, LifeFinanceCategory>()
    for (const c of categories) m.set(c.id, c)
    return m
  }, [categories])

  const byCategory = useMemo(() => {
    const agg = aggregateByCategory(txnsThisMonth, 'expense')
    return agg.map((a) => {
      const c = a.category_id ? catById.get(a.category_id) : null
      return {
        name: c?.name ?? 'Other',
        value: a.total_cents / 100,
        color: c?.color ?? '#64748b',
      }
    })
  }, [txnsThisMonth, catById])

  const daily = useMemo(() => {
    const days = aggregateDaily(txnsThisMonth, startOfMonthIso(), endOfMonthIso())
    return days.map((d) => ({
      date: d.date.slice(8),
      Expense: d.expense_cents / 100,
      Income: d.income_cents / 100,
    }))
  }, [txnsThisMonth])

  const monthly = useMemo(() => {
    const months = aggregateMonthly(txnsTrend, 6)
    return months.map((m) => ({
      month: m.month.slice(5),
      Expense: m.expense_cents / 100,
      Income: m.income_cents / 100,
    }))
  }, [txnsTrend])

  return (
    <div className="life-fin-grid">
      <div className="life-fin-chart-card" style={{ gridColumn: 'span 2' }}>
        <h3 className="life-fin-h3">Daily flow this month</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={daily}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
            <YAxis stroke="var(--text-muted)" fontSize={11} tickFormatter={(v) => `${RUPEE}${v}`} />
            <Tooltip
              contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              formatter={(v) => fmtFull(Number(v) * 100)}
            />
            <Legend />
            <Line type="monotone" dataKey="Expense" stroke="#ef4444" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Income" stroke="#22c55e" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="life-fin-chart-card">
        <h3 className="life-fin-h3">Spending by category</h3>
        {byCategory.length === 0 ? (
          <div className="life-empty">
            <p>No expenses yet this month.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={byCategory}
                dataKey="value"
                nameKey="name"
                outerRadius={90}
                innerRadius={48}
                paddingAngle={2}
              >
                {byCategory.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
                formatter={(v) => fmtFull(Number(v) * 100)}
              />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="life-fin-chart-card">
        <h3 className="life-fin-h3">Last 6 months</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthly}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={11} />
            <YAxis stroke="var(--text-muted)" fontSize={11} tickFormatter={(v) => `${RUPEE}${v}`} />
            <Tooltip
              contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
              formatter={(v) => fmtFull(Number(v) * 100)}
            />
            <Legend />
            <Bar dataKey="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Income" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// TRANSACTIONS TAB
// ──────────────────────────────────────────────────────────────────────
const TransactionsTab: React.FC<{
  categories: LifeFinanceCategory[]
  catById: Map<string, LifeFinanceCategory>
  onChanged: () => void
}> = ({ categories, catById, onChanged }) => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [rows, setRows] = useState<LifeFinanceTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState<string>('')
  const [filterKind, setFilterKind] = useState<'all' | FinanceKind>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    try {
      const data = await listFinanceTransactions(lifeUser.id, {
        fromIso: from ? new Date(from).toISOString() : undefined,
        toIso: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        kind: filterKind === 'all' ? undefined : filterKind,
        categoryId: filterCat || undefined,
        query: search.trim() || undefined,
        limit: 1000,
      })
      setRows(data)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, from, to, filterKind, filterCat, search])

  useEffect(() => {
    load()
  }, [load])

  const remove = async (t: LifeFinanceTransaction) => {
    if (!lifeUser) return
    if (!confirm(`Delete ${t.kind} of ${fmtFull(t.amount_cents)}?`)) return
    await deleteFinanceTransaction(lifeUser.id, t.id)
    load()
    onChanged()
  }

  const total = useMemo(
    () => rows.reduce((acc, r) => acc + (r.kind === 'expense' ? r.amount_cents : -r.amount_cents), 0),
    [rows]
  )

  return (
    <>
      <div className="life-fin-filters">
        <input
          className="life-search"
          placeholder="Search note…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value as 'all' | FinanceKind)}
          className="life-fin-input"
        >
          <option value="all">All kinds</option>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="life-fin-input"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="life-fin-input"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="life-fin-input"
        />
      </div>

      <div style={{ marginBottom: 10, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        {rows.length} entries · net{' '}
        <strong style={{ color: total > 0 ? '#ef4444' : '#22c55e' }}>{fmtFull(Math.abs(total))}</strong>
      </div>

      {loading && rows.length === 0 ? (
        <div className="life-empty">
          <p>Loading…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="life-empty">
          <h3>No transactions</h3>
          <p>Try widening the date range.</p>
        </div>
      ) : (
        <div className="life-fin-table">
          {rows.map((t) => {
            const c = t.category_id ? catById.get(t.category_id) : null
            return (
              <div key={t.id} className="life-fin-table-row">
                <span className="life-fin-recent-icon" style={{ background: c?.color ?? '#64748b' }}>
                  {c?.icon ?? '💸'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="life-fin-recent-title">
                    {c?.name ?? 'Uncategorized'}
                    {t.note && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {t.note}</span>}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {new Date(t.occurred_at).toLocaleDateString()} · {t.payment_method ?? '—'}
                    {t.tags.length > 0 && ` · ${t.tags.map((x) => `#${x}`).join(' ')}`}
                  </div>
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    color: t.kind === 'expense' ? '#ef4444' : '#22c55e',
                    minWidth: 90,
                    textAlign: 'right',
                  }}
                >
                  {t.kind === 'expense' ? '−' : '+'}
                  {fmtFull(t.amount_cents)}
                </div>
                <button className="life-btn danger" onClick={() => remove(t)} style={{ padding: '4px 10px' }}>
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// BUDGETS TAB
// ──────────────────────────────────────────────────────────────────────
const BudgetsTab: React.FC<{
  categories: LifeFinanceCategory[]
  txnsThisMonth: LifeFinanceTransaction[]
  onChanged: () => void
}> = ({ categories, txnsThisMonth, onChanged }) => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const spent = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of txnsThisMonth) {
      if (t.kind !== 'expense' || !t.category_id) continue
      m.set(t.category_id, (m.get(t.category_id) ?? 0) + t.amount_cents)
    }
    return m
  }, [txnsThisMonth])

  const save = async (c: LifeFinanceCategory) => {
    if (!lifeUser) return
    const val = drafts[c.id]
    if (val == null) return
    const num = parseFloat(val)
    if (!Number.isFinite(num) || num < 0) return
    await updateFinanceCategory(lifeUser.id, c.id, {
      monthly_budget_cents: Math.round(num * 100),
    })
    setDrafts((d) => {
      const next = { ...d }
      delete next[c.id]
      return next
    })
    onChanged()
  }

  return (
    <>
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Set a monthly cap per category. Bars turn red when you blow past 90% of budget.
      </p>
      <div className="life-fin-budget-list">
        {categories.map((c) => {
          const used = spent.get(c.id) ?? 0
          const budget = c.monthly_budget_cents
          const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0
          const overBudget = budget > 0 && used > budget
          return (
            <div key={c.id} className="life-fin-budget-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span className="life-fin-recent-icon" style={{ background: c.color }}>
                  {c.icon}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="life-fin-recent-title">{c.name}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {fmtFull(used)}
                    {budget > 0 ? ` / ${fmtFull(budget)} · ${pct}%` : ' / no budget'}
                  </div>
                </div>
                <input
                  type="number"
                  value={drafts[c.id] ?? (budget / 100).toString()}
                  onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })}
                  className="life-fin-input"
                  style={{ width: 110 }}
                  placeholder="0"
                />
                <button className="life-btn primary" onClick={() => save(c)}>
                  Save
                </button>
              </div>
              {budget > 0 && (
                <div className="life-fin-progress">
                  <div
                    className="life-fin-progress-bar"
                    style={{
                      width: `${Math.min(100, (used / budget) * 100)}%`,
                      background: overBudget ? '#ef4444' : pct >= 90 ? '#f59e0b' : c.color,
                    }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// CATEGORIES TAB — manage list
// ──────────────────────────────────────────────────────────────────────
const CategoriesTab: React.FC<{
  categories: LifeFinanceCategory[]
  onChanged: () => void
}> = ({ categories, onChanged }) => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('💸')
  const [color, setColor] = useState('#6c63ff')
  const [kind, setKind] = useState<FinanceKind>('expense')

  const add = async () => {
    if (!lifeUser || !name.trim()) return
    await createFinanceCategory({
      userId: lifeUser.id,
      name: name.trim(),
      icon,
      color,
      kind,
    })
    setName('')
    onChanged()
  }

  const remove = async (c: LifeFinanceCategory) => {
    if (!lifeUser) return
    if (!confirm(`Delete category "${c.name}"? Past transactions stay but become uncategorized.`)) return
    await deleteFinanceCategory(lifeUser.id, c.id)
    onChanged()
  }

  return (
    <>
      <div className="life-card" style={{ marginBottom: 16 }}>
        <div className="life-card-title">Add a category</div>
        <div className="life-fin-form-grid" style={{ marginTop: 10 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="life-fin-label">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Coffee"
              className="life-fin-input"
            />
          </div>
          <div>
            <label className="life-fin-label">Icon</label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={2}
              className="life-fin-input"
            />
          </div>
          <div>
            <label className="life-fin-label">Color</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="life-fin-input"
              style={{ padding: 2, height: 38 }}
            />
          </div>
          <div>
            <label className="life-fin-label">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as FinanceKind)}
              className="life-fin-input"
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
        </div>
        <button className="life-btn primary" onClick={add} style={{ marginTop: 10 }}>
          + Add category
        </button>
      </div>

      <div className="life-fin-cat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {categories.map((c) => (
          <div
            key={c.id}
            className="life-card"
            style={{
              padding: 12,
              borderLeft: `3px solid ${c.color}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="life-fin-recent-icon" style={{ background: c.color }}>
                {c.icon}
              </span>
              <div style={{ flex: 1 }}>
                <div className="life-fin-recent-title">{c.name}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.kind}</div>
              </div>
            </div>
            <button
              className="life-btn danger"
              onClick={() => remove(c)}
              style={{ marginTop: 8, width: '100%' }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// INSIGHTS TAB
// ──────────────────────────────────────────────────────────────────────
const InsightsTab: React.FC<{
  txnsThisMonth: LifeFinanceTransaction[]
  txnsTrend: LifeFinanceTransaction[]
  catById: Map<string, LifeFinanceCategory>
}> = ({ txnsThisMonth, txnsTrend, catById }) => {
  const insights = useMemo(() => {
    const expenses = txnsThisMonth.filter((t) => t.kind === 'expense')
    const total = expenses.reduce((a, t) => a + t.amount_cents, 0)
    const days = new Set(expenses.map((t) => t.occurred_at.slice(0, 10))).size || 1
    const dailyAvg = total / days
    const monthDays = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
    const projected = dailyAvg * monthDays

    const top5 = [...expenses].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 5)

    const byCat = aggregateByCategory(txnsThisMonth, 'expense').slice(0, 5)

    const monthly = aggregateMonthly(txnsTrend, 6)
    const lastMonth = monthly[monthly.length - 2]
    const thisMonth = monthly[monthly.length - 1]
    const monthDelta = lastMonth
      ? thisMonth.expense_cents - lastMonth.expense_cents
      : 0
    const monthDeltaPct =
      lastMonth && lastMonth.expense_cents > 0
        ? Math.round((monthDelta / lastMonth.expense_cents) * 100)
        : null

    return { total, dailyAvg, projected, top5, byCat, monthDelta, monthDeltaPct }
  }, [txnsThisMonth, txnsTrend])

  return (
    <div className="life-fin-grid">
      <div className="life-fin-chart-card">
        <h3 className="life-fin-h3">Daily average</h3>
        <div className="life-fin-big">{fmt(insights.dailyAvg)}</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Projected month total: <strong>{fmt(insights.projected)}</strong>
        </div>
      </div>

      <div className="life-fin-chart-card">
        <h3 className="life-fin-h3">vs last month</h3>
        {insights.monthDeltaPct == null ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Not enough history yet.</div>
        ) : (
          <>
            <div
              className="life-fin-big"
              style={{ color: insights.monthDelta > 0 ? '#ef4444' : '#22c55e' }}
            >
              {insights.monthDelta > 0 ? '↑' : '↓'} {Math.abs(insights.monthDeltaPct)}%
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {insights.monthDelta > 0 ? 'More' : 'Less'} than last month by{' '}
              <strong>{fmt(Math.abs(insights.monthDelta))}</strong>
            </div>
          </>
        )}
      </div>

      <div className="life-fin-chart-card" style={{ gridColumn: 'span 2' }}>
        <h3 className="life-fin-h3">Top 5 expenses this month</h3>
        {insights.top5.length === 0 ? (
          <div className="life-empty">
            <p>No expenses logged yet.</p>
          </div>
        ) : (
          <div className="life-fin-recent">
            {insights.top5.map((t) => {
              const c = t.category_id ? catById.get(t.category_id) : null
              return (
                <div key={t.id} className="life-fin-recent-row">
                  <span
                    className="life-fin-recent-icon"
                    style={{ background: c?.color ?? '#64748b' }}
                  >
                    {c?.icon ?? '💸'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="life-fin-recent-title">
                      {t.note ?? c?.name ?? 'Uncategorized'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {new Date(t.occurred_at).toLocaleDateString()} · {c?.name ?? 'Other'}
                    </div>
                  </div>
                  <div style={{ fontWeight: 600, color: '#ef4444' }}>−{fmtFull(t.amount_cents)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="life-fin-chart-card" style={{ gridColumn: 'span 2' }}>
        <h3 className="life-fin-h3">Top categories</h3>
        {insights.byCat.length === 0 ? (
          <div className="life-empty">
            <p>—</p>
          </div>
        ) : (
          insights.byCat.map((b) => {
            const c = b.category_id ? catById.get(b.category_id) : null
            const pct = insights.total > 0 ? Math.round((b.total_cents / insights.total) * 100) : 0
            return (
              <div key={b.category_id ?? 'none'} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem' }}>
                  <span>
                    {c?.icon ?? '💸'} {c?.name ?? 'Other'}
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {fmt(b.total_cents)} · {pct}%
                  </span>
                </div>
                <div className="life-fin-progress">
                  <div
                    className="life-fin-progress-bar"
                    style={{ width: `${pct}%`, background: c?.color ?? '#64748b' }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// Avoid unused-imports lint by referencing exports kept for future use.
void updateFinanceTransaction

export default FinancePage
