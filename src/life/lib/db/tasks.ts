import { lifeDb } from './_client'
import { resolveDefaultWorkspaceId } from './_defaults'
import type { LifeTask, TaskStatus, TaskAutomation, TaskSource } from '../../types'

export async function listTasksForDate(
  userId: string,
  date: string,
  workspaceId?: string
): Promise<LifeTask[]> {
  let q = lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('scheduled_for', date)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`listTasksForDate: ${error.message}`)
  return (data ?? []) as LifeTask[]
}

/**
 * Fetch every task with a scheduled_for or start_at falling inside [from, to]
 * across ALL workspaces. Used by the unified Calendar view so the user sees
 * work + personal items side-by-side regardless of which workspace is active.
 */
export async function listTasksInRangeAllWorkspaces(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<LifeTask[]> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .gte('scheduled_for', fromDate)
    .lte('scheduled_for', toDate)
    .order('scheduled_for', { ascending: true })
  if (error) throw new Error(`listTasksInRangeAllWorkspaces: ${error.message}`)
  return (data ?? []) as LifeTask[]
}

export async function listOverdueOpenTasks(
  userId: string,
  beforeDate: string,
  workspaceId?: string
): Promise<LifeTask[]> {
  let q = lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .lt('scheduled_for', beforeDate)
    .in('status', ['todo', 'doing'])
    .order('scheduled_for', { ascending: true })
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`listOverdueOpenTasks: ${error.message}`)
  return (data ?? []) as LifeTask[]
}

export async function listTasksForProject(
  userId: string,
  projectId: string,
  limit = 50
): Promise<LifeTask[]> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listTasksForProject: ${error.message}`)
  return (data ?? []) as LifeTask[]
}

export async function createTask(input: {
  userId: string
  /** Optional — resolves to the user's active workspace (default: personal) when omitted. */
  workspaceId?: string
  title: string
  notes?: string
  project_id?: string | null
  goal_id?: string | null
  parent_task_id?: string | null
  scheduled_for?: string | null
  start_at?: string | null
  due_at?: string | null
  estimate_min?: number | null
  priority?: number
  tags?: string[]
  source?: TaskSource
  when_where?: string | null
  first_action?: string | null
  hard_start?: boolean
  depends_on?: string[]
  automation?: TaskAutomation
  origin_message_id?: string | null
  plan_id?: string | null
}): Promise<LifeTask> {
  const workspaceId = input.workspaceId ?? (await resolveDefaultWorkspaceId(input.userId))
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .insert({
      user_id: input.userId,
      workspace_id: workspaceId,
      title: input.title,
      notes: input.notes ?? null,
      project_id: input.project_id ?? null,
      goal_id: input.goal_id ?? null,
      parent_task_id: input.parent_task_id ?? null,
      // Stay undated unless caller explicitly provides a date — otherwise
      // every task without a start date silently lands on Today and
      // clutters the dashboard.
      scheduled_for: input.scheduled_for ?? null,
      start_at: input.start_at ?? null,
      due_at: input.due_at ?? null,
      estimate_min: input.estimate_min ?? null,
      priority: input.priority ?? 3,
      tags: input.tags ?? [],
      source: input.source ?? 'manual',
      when_where: input.when_where ?? null,
      first_action: input.first_action ?? null,
      hard_start: input.hard_start ?? false,
      depends_on: input.depends_on ?? [],
      automation: input.automation ?? {},
      origin_message_id: input.origin_message_id ?? null,
      plan_id: input.plan_id ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createTask: ${error.message}`)
  return data as LifeTask
}

export async function updateTaskStatus(
  userId: string,
  id: string,
  status: TaskStatus
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (status === 'done') patch.done_at = new Date().toISOString()
  const { error } = await lifeDb()
    .from('life_tasks')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateTaskStatus: ${error.message}`)
}

export async function updateTask(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeTask, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_tasks')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateTask: ${error.message}`)
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb().from('life_tasks').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new Error(`deleteTask: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// TodosPage helpers — paginated search + subtask hierarchy
// ──────────────────────────────────────────────────────────────────────

export interface TaskSearchFilters {
  /** YYYY-MM-DD inclusive lower bound on scheduled_for. */
  fromDate?: string | null
  /** YYYY-MM-DD inclusive upper bound on scheduled_for. */
  toDate?: string | null
  /** Show tasks with no scheduled_for? Default true. */
  includeUndated?: boolean
  statuses?: TaskStatus[]
  /** Title ILIKE substring. */
  query?: string
  /** Title/notes search — applied AFTER smart-prefix parsing in the page. */
  searchInNotes?: boolean
  /** Tag filter (rows must contain ALL of these tags). */
  tags?: string[]
  /** Priority filter — rows must match one of these priorities (1..5). */
  priorities?: number[]
  /** Default true — hides subtasks from the top-level list. */
  parentsOnly?: boolean
  workspaceId?: string | null
}

export interface TaskSearchPage {
  rows: LifeTask[]
  total: number
  /** True if more rows exist past `offset + rows.length`. */
  hasMore: boolean
}

/**
 * Paginated, filterable task search for the Todos page. Uses Supabase's
 * `.range(start, end)` for offset pagination and asks for an exact count so
 * the UI can render "1,234 tasks" and stop loading at the right point.
 */
export async function searchTasks(
  userId: string,
  filters: TaskSearchFilters,
  pagination: { offset: number; limit: number }
): Promise<TaskSearchPage> {
  const { offset, limit } = pagination
  let q = lifeDb()
    .from('life_tasks')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)

  if (filters.workspaceId) q = q.eq('workspace_id', filters.workspaceId)
  if (filters.parentsOnly !== false) q = q.is('parent_task_id', null)

  if (filters.statuses && filters.statuses.length > 0) {
    q = q.in('status', filters.statuses)
  }

  if (filters.query && filters.query.trim()) {
    // Escape Postgres LIKE wildcards in user input.
    const safe = filters.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)
    if (filters.searchInNotes) {
      // Match in title OR notes — PostgREST `or()` syntax.
      q = q.or(`title.ilike.%${safe}%,notes.ilike.%${safe}%`)
    } else {
      q = q.ilike('title', `%${safe}%`)
    }
  }

  if (filters.priorities && filters.priorities.length > 0) {
    q = q.in('priority', filters.priorities)
  }

  if (filters.tags && filters.tags.length > 0) {
    // life_tasks.tags is jsonb storing a JSON array. We need to send
    //   ?tags=cs.["work","urgent"]
    // i.e. PostgREST `cs` (contains) with a JSON array literal.
    //
    // BEWARE: supabase-js `.contains('tags', ['work'])` serializes the JS
    // array as a PostgreSQL ARRAY literal `{"work"}`, NOT as JSON. That
    // syntax is invalid for a jsonb column and silently returns zero rows
    // (no error, just an empty result set — which is exactly what made
    // tag search look "broken" in the UI).
    //
    // The fix is to bypass the array-aware serializer and use the raw
    // `.filter()` method with `JSON.stringify`, which produces the correct
    // `cs.["work","urgent"]` query string.
    q = q.filter('tags', 'cs', JSON.stringify(filters.tags))
  }

  // Date filtering. Two paths:
  //  - includeUndated=false → use direct .gte/.lte. This is the common case
  //    for "today" / "tomorrow" / "this week" filters and is by far the most
  //    reliable. Wrapping a single clause in `q.or('and(...)')` was causing
  //    PostgREST to mis-parse and silently return zero rows on some Supabase
  //    versions, which is what made today/tomorrow look empty.
  //  - includeUndated=true → fall back to the OR-with-null clause so undated
  //    tasks still appear under "All".
  const hasFrom = !!filters.fromDate
  const hasTo = !!filters.toDate
  const includeUndated = filters.includeUndated !== false
  if (hasFrom || hasTo) {
    if (!includeUndated) {
      if (hasFrom) q = q.gte('scheduled_for', filters.fromDate as string)
      if (hasTo) q = q.lte('scheduled_for', filters.toDate as string)
    } else {
      const between =
        hasFrom && hasTo
          ? `and(scheduled_for.gte.${filters.fromDate},scheduled_for.lte.${filters.toDate})`
          : hasFrom
          ? `scheduled_for.gte.${filters.fromDate}`
          : `scheduled_for.lte.${filters.toDate}`
      q = q.or(`${between},scheduled_for.is.null`)
    }
  }

  q = q
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`searchTasks: ${error.message}`)
  const rows = (data ?? []) as LifeTask[]
  const total = count ?? rows.length
  return {
    rows,
    total,
    hasMore: offset + rows.length < total,
  }
}

/**
 * List all distinct tags the user has across their tasks. Used to populate
 * the Todos page tag filter and edit panel autocomplete.
 *
 * Supabase doesn't have a simple "distinct unnested array values" call we
 * can express via the JS client without an RPC, so we read the tags column
 * for the user (capped) and dedupe in memory. Cheap enough for personal
 * todo scale; revisit when a single user crosses ~50k tasks.
 */
export async function listAllTags(
  userId: string,
  workspaceId?: string | null
): Promise<string[]> {
  let q = lifeDb()
    .from('life_tasks')
    .select('tags')
    .eq('user_id', userId)
    .limit(2000)
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data, error } = await q
  if (error) throw new Error(`listAllTags: ${error.message}`)
  const seen = new Set<string>()
  for (const row of (data ?? []) as { tags: unknown }[]) {
    const arr = Array.isArray(row.tags) ? (row.tags as unknown[]) : []
    for (const t of arr) {
      if (typeof t === 'string' && t.trim()) seen.add(t.trim())
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

/**
 * Add minutes to a task's actual_min counter. We re-read the row first to
 * avoid clobbering concurrent updates — supabase-js has no atomic increment
 * outside an RPC. Returns the new total. Negative deltas are clamped at 0.
 */
export async function addActualMinutes(
  userId: string,
  taskId: string,
  deltaMin: number
): Promise<number> {
  if (!Number.isFinite(deltaMin) || deltaMin === 0) {
    const { data, error } = await lifeDb()
      .from('life_tasks')
      .select('actual_min')
      .eq('id', taskId)
      .eq('user_id', userId)
      .single()
    if (error) throw new Error(`addActualMinutes(read): ${error.message}`)
    return (data?.actual_min as number | null) ?? 0
  }
  const { data: row, error: readErr } = await lifeDb()
    .from('life_tasks')
    .select('actual_min')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single()
  if (readErr) throw new Error(`addActualMinutes(read): ${readErr.message}`)
  const current = (row?.actual_min as number | null) ?? 0
  const next = Math.max(0, Math.round(current + deltaMin))
  const { error: updErr } = await lifeDb()
    .from('life_tasks')
    .update({ actual_min: next })
    .eq('id', taskId)
    .eq('user_id', userId)
  if (updErr) throw new Error(`addActualMinutes(write): ${updErr.message}`)
  return next
}

export async function listSubtasks(
  userId: string,
  parentTaskId: string
): Promise<LifeTask[]> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('parent_task_id', parentTaskId)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listSubtasks: ${error.message}`)
  return (data ?? []) as LifeTask[]
}

/** Project finish-rate — done / (done + open) within the project. */
export async function projectFinishRate(
  userId: string,
  projectId: string
): Promise<{ done: number; open: number; rate: number }> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('status')
    .eq('user_id', userId)
    .eq('project_id', projectId)
  if (error) throw new Error(`projectFinishRate: ${error.message}`)
  let done = 0
  let open = 0
  for (const row of (data ?? []) as { status: string }[]) {
    if (row.status === 'done') done++
    else if (row.status === 'todo' || row.status === 'doing') open++
  }
  const total = done + open
  return { done, open, rate: total === 0 ? 0 : done / total }
}
