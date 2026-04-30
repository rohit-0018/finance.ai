import { lifeDb } from './_client'
import type {
  LifeFinanceCategory,
  LifeFinanceTransaction,
  FinanceKind,
  PaymentMethod,
  LifeFinanceLoan,
  LoanDirection,
  LoanStatus,
  LoanPayment,
} from '../../types'

// ──────────────────────────────────────────────────────────────────────
// Category seed — only run once. The defaults cover the common buckets a
// daily expense logger needs without overwhelming the picker. Users can
// rename / recolor / archive any of them later.
// ──────────────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES: Array<Omit<LifeFinanceCategory, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'archived'>> = [
  { name: 'Food',          slug: 'food',          kind: 'expense', color: '#f97316', icon: '🍔', monthly_budget_cents: 0, sort_order: 1 },
  { name: 'Groceries',     slug: 'groceries',     kind: 'expense', color: '#10b981', icon: '🛒', monthly_budget_cents: 0, sort_order: 2 },
  { name: 'Transport',     slug: 'transport',     kind: 'expense', color: '#3b82f6', icon: '🚗', monthly_budget_cents: 0, sort_order: 3 },
  { name: 'Bills',         slug: 'bills',         kind: 'expense', color: '#ef4444', icon: '🧾', monthly_budget_cents: 0, sort_order: 4 },
  { name: 'Rent',          slug: 'rent',          kind: 'expense', color: '#8b5cf6', icon: '🏠', monthly_budget_cents: 0, sort_order: 5 },
  { name: 'Loan / EMI',    slug: 'loan',          kind: 'expense', color: '#dc2626', icon: '💳', monthly_budget_cents: 0, sort_order: 6 },
  { name: 'Health',        slug: 'health',        kind: 'expense', color: '#14b8a6', icon: '💊', monthly_budget_cents: 0, sort_order: 7 },
  { name: 'Shopping',      slug: 'shopping',      kind: 'expense', color: '#ec4899', icon: '🛍️', monthly_budget_cents: 0, sort_order: 8 },
  { name: 'Entertainment', slug: 'entertainment', kind: 'expense', color: '#f59e0b', icon: '🎬', monthly_budget_cents: 0, sort_order: 9 },
  { name: 'Subscriptions', slug: 'subscriptions', kind: 'expense', color: '#6366f1', icon: '🔁', monthly_budget_cents: 0, sort_order: 10 },
  { name: 'Travel',        slug: 'travel',        kind: 'expense', color: '#0ea5e9', icon: '✈️', monthly_budget_cents: 0, sort_order: 11 },
  { name: 'Education',     slug: 'education',     kind: 'expense', color: '#a855f7', icon: '📚', monthly_budget_cents: 0, sort_order: 12 },
  { name: 'Gifts',         slug: 'gifts',         kind: 'expense', color: '#f43f5e', icon: '🎁', monthly_budget_cents: 0, sort_order: 13 },
  { name: 'Misc',          slug: 'misc',          kind: 'expense', color: '#64748b', icon: '💸', monthly_budget_cents: 0, sort_order: 14 },
  { name: 'Salary',        slug: 'salary',        kind: 'income',  color: '#22c55e', icon: '💼', monthly_budget_cents: 0, sort_order: 1 },
  { name: 'Freelance',     slug: 'freelance',     kind: 'income',  color: '#16a34a', icon: '🧑‍💻', monthly_budget_cents: 0, sort_order: 2 },
  { name: 'Investment',    slug: 'investment',    kind: 'income',  color: '#0d9488', icon: '📈', monthly_budget_cents: 0, sort_order: 3 },
  { name: 'Other Income',  slug: 'other-income',  kind: 'income',  color: '#84cc16', icon: '💰', monthly_budget_cents: 0, sort_order: 4 },
]

/** List the user's categories, seeding the defaults on first call. */
export async function listFinanceCategories(
  userId: string,
  includeArchived = false
): Promise<LifeFinanceCategory[]> {
  const { data, error } = await lifeDb()
    .from('life_finance_categories')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(`listFinanceCategories: ${error.message}`)
  let rows = (data ?? []) as LifeFinanceCategory[]
  if (rows.length === 0) {
    // Seed defaults exactly once.
    const insert = DEFAULT_CATEGORIES.map((c) => ({ user_id: userId, ...c }))
    const { data: seeded, error: seedErr } = await lifeDb()
      .from('life_finance_categories')
      .insert(insert)
      .select()
    if (seedErr) throw new Error(`seedFinanceCategories: ${seedErr.message}`)
    rows = (seeded ?? []) as LifeFinanceCategory[]
  }
  if (!includeArchived) rows = rows.filter((c) => !c.archived)
  return rows
}

export async function createFinanceCategory(input: {
  userId: string
  name: string
  kind: FinanceKind
  color?: string
  icon?: string
  monthly_budget_cents?: number
}): Promise<LifeFinanceCategory> {
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const { data, error } = await lifeDb()
    .from('life_finance_categories')
    .insert({
      user_id: input.userId,
      name: input.name,
      slug,
      kind: input.kind,
      color: input.color ?? '#6c63ff',
      icon: input.icon ?? '💸',
      monthly_budget_cents: input.monthly_budget_cents ?? 0,
    })
    .select()
    .single()
  if (error) throw new Error(`createFinanceCategory: ${error.message}`)
  return data as LifeFinanceCategory
}

export async function updateFinanceCategory(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeFinanceCategory, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_finance_categories')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateFinanceCategory: ${error.message}`)
}

export async function deleteFinanceCategory(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_finance_categories')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteFinanceCategory: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// Transactions
// ──────────────────────────────────────────────────────────────────────

export interface TransactionFilter {
  fromIso?: string
  toIso?: string
  kind?: FinanceKind
  categoryId?: string | null
  workspaceId?: string | null
  query?: string
  limit?: number
}

export async function listFinanceTransactions(
  userId: string,
  filter: TransactionFilter = {}
): Promise<LifeFinanceTransaction[]> {
  let q = lifeDb()
    .from('life_finance_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
  if (filter.fromIso) q = q.gte('occurred_at', filter.fromIso)
  if (filter.toIso) q = q.lte('occurred_at', filter.toIso)
  if (filter.kind) q = q.eq('kind', filter.kind)
  if (filter.categoryId) q = q.eq('category_id', filter.categoryId)
  if (filter.workspaceId) q = q.eq('workspace_id', filter.workspaceId)
  if (filter.query && filter.query.trim()) {
    const safe = filter.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)
    q = q.ilike('note', `%${safe}%`)
  }
  q = q.limit(filter.limit ?? 500)
  const { data, error } = await q
  if (error) throw new Error(`listFinanceTransactions: ${error.message}`)
  // Normalize tags from jsonb -> string[]
  return ((data ?? []) as LifeFinanceTransaction[]).map((t) => ({
    ...t,
    tags: Array.isArray(t.tags) ? t.tags : [],
  }))
}

export async function createFinanceTransaction(input: {
  userId: string
  workspaceId?: string | null
  categoryId?: string | null
  amount_cents: number
  currency?: string
  kind: FinanceKind
  note?: string | null
  payment_method?: PaymentMethod | null
  occurred_at?: string
  tags?: string[]
  recurring?: boolean
}): Promise<LifeFinanceTransaction> {
  const { data, error } = await lifeDb()
    .from('life_finance_transactions')
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId ?? null,
      category_id: input.categoryId ?? null,
      amount_cents: input.amount_cents,
      currency: input.currency ?? 'INR',
      kind: input.kind,
      note: input.note ?? null,
      payment_method: input.payment_method ?? null,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      tags: input.tags ?? [],
      recurring: input.recurring ?? false,
    })
    .select()
    .single()
  if (error) throw new Error(`createFinanceTransaction: ${error.message}`)
  return data as LifeFinanceTransaction
}

export async function updateFinanceTransaction(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeFinanceTransaction, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_finance_transactions')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateFinanceTransaction: ${error.message}`)
}

export async function deleteFinanceTransaction(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_finance_transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteFinanceTransaction: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// Aggregations
// ──────────────────────────────────────────────────────────────────────

export interface CategorySpend {
  category_id: string | null
  total_cents: number
  count: number
}

export interface DailySpend {
  date: string // YYYY-MM-DD
  expense_cents: number
  income_cents: number
}

/** Group transactions by category for the given window. */
export function aggregateByCategory(
  txns: LifeFinanceTransaction[],
  kind: FinanceKind = 'expense'
): CategorySpend[] {
  const map = new Map<string | null, CategorySpend>()
  for (const t of txns) {
    if (t.kind !== kind) continue
    const key = t.category_id
    const existing = map.get(key) ?? { category_id: key, total_cents: 0, count: 0 }
    existing.total_cents += t.amount_cents
    existing.count++
    map.set(key, existing)
  }
  return Array.from(map.values()).sort((a, b) => b.total_cents - a.total_cents)
}

/** Daily roll-up for the given window. Fills missing days with zeros. */
export function aggregateDaily(
  txns: LifeFinanceTransaction[],
  fromIso: string,
  toIso: string
): DailySpend[] {
  const start = new Date(fromIso)
  start.setHours(0, 0, 0, 0)
  const end = new Date(toIso)
  end.setHours(0, 0, 0, 0)
  const days: DailySpend[] = []
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    days.push({
      date: d.toISOString().slice(0, 10),
      expense_cents: 0,
      income_cents: 0,
    })
  }
  const idx = new Map(days.map((d, i) => [d.date, i]))
  for (const t of txns) {
    const day = t.occurred_at.slice(0, 10)
    const i = idx.get(day)
    if (i == null) continue
    if (t.kind === 'expense') days[i].expense_cents += t.amount_cents
    else days[i].income_cents += t.amount_cents
  }
  return days
}

export interface MonthSummary {
  month: string // YYYY-MM
  expense_cents: number
  income_cents: number
}

// ──────────────────────────────────────────────────────────────────────
// Loans (lending / borrowing)
// ──────────────────────────────────────────────────────────────────────

function normalizeLoan(row: LifeFinanceLoan): LifeFinanceLoan {
  return {
    ...row,
    interest_pct: Number(row.interest_pct ?? 0),
    tags: Array.isArray(row.tags) ? row.tags : [],
    payments: Array.isArray(row.payments) ? row.payments : [],
  }
}

/** Outstanding = principal − sum of payments. Never negative. */
export function loanOutstandingCents(loan: LifeFinanceLoan): number {
  const paid = loan.payments.reduce((a, p) => a + (p.amount_cents ?? 0), 0)
  return Math.max(0, loan.principal_cents - paid)
}

export interface ListLoansFilter {
  status?: LoanStatus | 'all'
  direction?: LoanDirection
  query?: string
}

export async function listFinanceLoans(
  userId: string,
  filter: ListLoansFilter = {}
): Promise<LifeFinanceLoan[]> {
  let q = lifeDb()
    .from('life_finance_loans')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
  if (filter.status && filter.status !== 'all') q = q.eq('status', filter.status)
  if (filter.direction) q = q.eq('direction', filter.direction)
  if (filter.query && filter.query.trim()) {
    const safe = filter.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)
    q = q.ilike('counterparty', `%${safe}%`)
  }
  const { data, error } = await q
  if (error) throw new Error(`listFinanceLoans: ${error.message}`)
  return ((data ?? []) as LifeFinanceLoan[]).map(normalizeLoan)
}

export async function createFinanceLoan(input: {
  userId: string
  workspaceId?: string | null
  counterparty: string
  direction: LoanDirection
  principal_cents: number
  currency?: string
  interest_pct?: number
  payment_method?: PaymentMethod | null
  note?: string | null
  tags?: string[]
  started_at?: string
  due_at?: string | null
}): Promise<LifeFinanceLoan> {
  const { data, error } = await lifeDb()
    .from('life_finance_loans')
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId ?? null,
      counterparty: input.counterparty.trim(),
      direction: input.direction,
      principal_cents: input.principal_cents,
      currency: input.currency ?? 'INR',
      interest_pct: input.interest_pct ?? 0,
      payment_method: input.payment_method ?? null,
      note: input.note ?? null,
      tags: input.tags ?? [],
      payments: [],
      started_at: input.started_at ?? new Date().toISOString(),
      due_at: input.due_at ?? null,
      closed_at: null,
      status: 'open',
    })
    .select()
    .single()
  if (error) throw new Error(`createFinanceLoan: ${error.message}`)
  return normalizeLoan(data as LifeFinanceLoan)
}

export async function updateFinanceLoan(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeFinanceLoan, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_finance_loans')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateFinanceLoan: ${error.message}`)
}

export async function deleteFinanceLoan(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_finance_loans')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteFinanceLoan: ${error.message}`)
}

/** Append a partial repayment. If it brings outstanding to zero, auto-close. */
export async function addLoanPayment(
  userId: string,
  loan: LifeFinanceLoan,
  payment: LoanPayment
): Promise<LifeFinanceLoan> {
  const next = [...loan.payments, payment]
  const totalPaid = next.reduce((a, p) => a + (p.amount_cents ?? 0), 0)
  const fullyPaid = totalPaid >= loan.principal_cents
  const patch: Record<string, unknown> = { payments: next }
  if (fullyPaid && loan.status === 'open') {
    patch.status = 'closed'
    patch.closed_at = payment.paid_at
  }
  const { data, error } = await lifeDb()
    .from('life_finance_loans')
    .update(patch)
    .eq('id', loan.id)
    .eq('user_id', userId)
    .select()
    .single()
  if (error) throw new Error(`addLoanPayment: ${error.message}`)
  return normalizeLoan(data as LifeFinanceLoan)
}

/** Mark a loan closed (settled in full) or written off. */
export async function closeFinanceLoan(
  userId: string,
  id: string,
  status: 'closed' | 'written_off' = 'closed',
  closedAtIso?: string
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_finance_loans')
    .update({
      status,
      closed_at: closedAtIso ?? new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`closeFinanceLoan: ${error.message}`)
}

/** Re-open a closed loan (e.g. mistakenly closed). */
export async function reopenFinanceLoan(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_finance_loans')
    .update({ status: 'open', closed_at: null })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`reopenFinanceLoan: ${error.message}`)
}

/** Last N month rollup for the trend chart. */
export function aggregateMonthly(
  txns: LifeFinanceTransaction[],
  monthsBack = 6
): MonthSummary[] {
  const buckets = new Map<string, MonthSummary>()
  const now = new Date()
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`
    buckets.set(key, { month: key, expense_cents: 0, income_cents: 0 })
  }
  for (const t of txns) {
    const d = new Date(t.occurred_at)
    const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`
    const b = buckets.get(key)
    if (!b) continue
    if (t.kind === 'expense') b.expense_cents += t.amount_cents
    else b.income_cents += t.amount_cents
  }
  return Array.from(buckets.values())
}
