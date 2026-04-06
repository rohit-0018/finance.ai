// Data access for the Life app. All queries are scoped by life_users.id.
// Caller must always pass the resolved life user id (NOT the papermind id).
import { lifeDb } from './supabaseLife'
import { todayLocal } from './time'
import type {
  LifeUser,
  LifeGoal,
  LifeProject,
  LifeTask,
  LifeJournalEntry,
  LifeProjectPulse,
  LifeAgentMessage,
  LifeNotification,
  LifeTimeBlock,
  LifeLearnItem,
  TaskStatus,
  LifeCategory,
  LifeHealth,
  TimeBlockKind,
  LearnStatus,
  LearnSourceType,
  NotificationKind,
} from '../types'

// ──────────────────────────────────────────────────────────────────────
// Users — sync from papermind on first /life visit
// ──────────────────────────────────────────────────────────────────────

export async function ensureLifeUser(opts: {
  papermindUserId: string
  username: string
  displayName: string | null
}): Promise<LifeUser> {
  const db = lifeDb()
  // Try to find first
  const existing = await db
    .from('life_users')
    .select('*')
    .eq('papermind_user_id', opts.papermindUserId)
    .maybeSingle()

  if (existing.error) throw new Error(`life_users lookup failed: ${existing.error.message}`)
  if (existing.data) return existing.data as LifeUser

  // Create
  const inserted = await db
    .from('life_users')
    .insert({
      papermind_user_id: opts.papermindUserId,
      username: opts.username,
      display_name: opts.displayName,
    })
    .select()
    .single()

  if (inserted.error) throw new Error(`life_users insert failed: ${inserted.error.message}`)
  return inserted.data as LifeUser
}

export async function updateLifeUser(
  userId: string,
  patch: Partial<Pick<LifeUser, 'timezone' | 'eod_hour' | 'work_start_hour' | 'work_end_hour' | 'display_name' | 'notify_browser'>>
): Promise<void> {
  const { error } = await lifeDb().from('life_users').update(patch).eq('id', userId)
  if (error) throw new Error(`updateLifeUser: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// Goals
// ──────────────────────────────────────────────────────────────────────

export async function listGoals(userId: string): Promise<LifeGoal[]> {
  const { data, error } = await lifeDb()
    .from('life_goals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listGoals: ${error.message}`)
  return (data ?? []) as LifeGoal[]
}

export async function createGoal(input: {
  userId: string
  title: string
  why?: string
  category?: LifeCategory
  horizon?: 'quarter' | 'year' | 'life'
  target_date?: string | null
}): Promise<LifeGoal> {
  const { data, error } = await lifeDb()
    .from('life_goals')
    .insert({
      user_id: input.userId,
      title: input.title,
      why: input.why ?? null,
      category: input.category ?? 'personal',
      horizon: input.horizon ?? 'quarter',
      target_date: input.target_date ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createGoal: ${error.message}`)
  return data as LifeGoal
}

export async function updateGoal(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeGoal, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_goals')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateGoal: ${error.message}`)
}

export async function deleteGoal(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb().from('life_goals').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new Error(`deleteGoal: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// Projects
// ──────────────────────────────────────────────────────────────────────

export async function listProjects(userId: string): Promise<LifeProject[]> {
  const { data, error } = await lifeDb()
    .from('life_projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`listProjects: ${error.message}`)
  return (data ?? []) as LifeProject[]
}

export async function getProject(userId: string, id: string): Promise<LifeProject | null> {
  const { data, error } = await lifeDb()
    .from('life_projects')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getProject: ${error.message}`)
  return (data as LifeProject) ?? null
}

export async function createProject(input: {
  userId: string
  name: string
  description?: string
  category?: LifeCategory
  goal_id?: string | null
}): Promise<LifeProject> {
  const { data, error } = await lifeDb()
    .from('life_projects')
    .insert({
      user_id: input.userId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? 'personal',
      goal_id: input.goal_id ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createProject: ${error.message}`)
  return data as LifeProject
}

export async function updateProject(
  userId: string,
  id: string,
  patch: Partial<Omit<LifeProject, 'id' | 'user_id' | 'created_at'>>
): Promise<void> {
  const { error } = await lifeDb()
    .from('life_projects')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateProject: ${error.message}`)
}

export async function deleteProject(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_projects')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteProject: ${error.message}`)
}

export async function setProjectHealth(
  userId: string,
  id: string,
  health: LifeHealth
): Promise<void> {
  await updateProject(userId, id, { health })
}

// ──────────────────────────────────────────────────────────────────────
// Tasks
// ──────────────────────────────────────────────────────────────────────

export async function listTasksForDate(
  userId: string,
  date: string // YYYY-MM-DD
): Promise<LifeTask[]> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('scheduled_for', date)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listTasksForDate: ${error.message}`)
  return (data ?? []) as LifeTask[]
}

export async function listOverdueOpenTasks(
  userId: string,
  beforeDate: string
): Promise<LifeTask[]> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .select('*')
    .eq('user_id', userId)
    .lt('scheduled_for', beforeDate)
    .in('status', ['todo', 'doing'])
    .order('scheduled_for', { ascending: true })
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
  title: string
  notes?: string
  project_id?: string | null
  goal_id?: string | null
  scheduled_for?: string | null
  estimate_min?: number | null
  priority?: number
  tags?: string[]
  source?: 'manual' | 'agent' | 'quickadd'
}): Promise<LifeTask> {
  const { data, error } = await lifeDb()
    .from('life_tasks')
    .insert({
      user_id: input.userId,
      title: input.title,
      notes: input.notes ?? null,
      project_id: input.project_id ?? null,
      goal_id: input.goal_id ?? null,
      scheduled_for: input.scheduled_for ?? todayLocal(),
      estimate_min: input.estimate_min ?? null,
      priority: input.priority ?? 3,
      tags: input.tags ?? [],
      source: input.source ?? 'manual',
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
// Journal
// ──────────────────────────────────────────────────────────────────────

export async function getJournalEntry(
  userId: string,
  date: string
): Promise<LifeJournalEntry | null> {
  const { data, error } = await lifeDb()
    .from('life_journal')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()
  if (error) throw new Error(`getJournalEntry: ${error.message}`)
  return (data as LifeJournalEntry) ?? null
}

export async function listJournalEntries(
  userId: string,
  limit = 30
): Promise<LifeJournalEntry[]> {
  const { data, error } = await lifeDb()
    .from('life_journal')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listJournalEntries: ${error.message}`)
  return (data ?? []) as LifeJournalEntry[]
}

export async function upsertJournalEntry(
  userId: string,
  date: string,
  patch: Partial<Omit<LifeJournalEntry, 'id' | 'user_id' | 'date' | 'created_at'>>
): Promise<LifeJournalEntry> {
  const { data, error } = await lifeDb()
    .from('life_journal')
    .upsert(
      { user_id: userId, date, ...patch },
      { onConflict: 'user_id,date' }
    )
    .select()
    .single()
  if (error) throw new Error(`upsertJournalEntry: ${error.message}`)
  return data as LifeJournalEntry
}

export async function closeOutDay(
  userId: string,
  date: string,
  fields: { summary?: string; wins?: string; blockers?: string; tomorrow?: string; energy?: number }
): Promise<LifeJournalEntry> {
  return upsertJournalEntry(userId, date, {
    ...fields,
    closed_at: new Date().toISOString(),
  })
}

// ──────────────────────────────────────────────────────────────────────
// Project pulses
// ──────────────────────────────────────────────────────────────────────

export async function listPulses(
  userId: string,
  projectId: string,
  limit = 10
): Promise<LifeProjectPulse[]> {
  const { data, error } = await lifeDb()
    .from('life_project_pulse')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listPulses: ${error.message}`)
  return (data ?? []) as LifeProjectPulse[]
}

export async function savePulse(input: {
  userId: string
  projectId: string
  last_progress?: string
  next_step?: string
  whats_missing?: string
  risk?: string
  suggested_tasks?: Array<{ title: string; estimate_min?: number; priority?: number }>
  health?: LifeHealth
  raw?: unknown
}): Promise<LifeProjectPulse> {
  const { data, error } = await lifeDb()
    .from('life_project_pulse')
    .insert({
      user_id: input.userId,
      project_id: input.projectId,
      last_progress: input.last_progress ?? null,
      next_step: input.next_step ?? null,
      whats_missing: input.whats_missing ?? null,
      risk: input.risk ?? null,
      suggested_tasks: input.suggested_tasks ?? [],
      health: input.health ?? 'green',
      raw: input.raw ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`savePulse: ${error.message}`)
  return data as LifeProjectPulse
}

// ──────────────────────────────────────────────────────────────────────
// Agent chat persistence
// ──────────────────────────────────────────────────────────────────────

export async function listAgentMessages(
  userId: string,
  projectId: string | null,
  limit = 50
): Promise<LifeAgentMessage[]> {
  let q = lifeDb()
    .from('life_agent_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit)
  q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
  const { data, error } = await q
  if (error) throw new Error(`listAgentMessages: ${error.message}`)
  return (data ?? []) as LifeAgentMessage[]
}

export async function saveAgentMessage(input: {
  userId: string
  projectId: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  meta?: Record<string, unknown>
}): Promise<LifeAgentMessage> {
  const { data, error } = await lifeDb()
    .from('life_agent_messages')
    .insert({
      user_id: input.userId,
      project_id: input.projectId,
      role: input.role,
      content: input.content,
      meta: input.meta ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`saveAgentMessage: ${error.message}`)
  return data as LifeAgentMessage
}

// ──────────────────────────────────────────────────────────────────────
// Notifications
// ──────────────────────────────────────────────────────────────────────

export async function listNotifications(
  userId: string,
  limit = 30
): Promise<LifeNotification[]> {
  const { data, error } = await lifeDb()
    .from('life_notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listNotifications: ${error.message}`)
  return (data ?? []) as LifeNotification[]
}

export async function createNotification(input: {
  userId: string
  kind: NotificationKind
  title: string
  body?: string
  link?: string
}): Promise<LifeNotification> {
  const { data, error } = await lifeDb()
    .from('life_notifications')
    .insert({
      user_id: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createNotification: ${error.message}`)
  return data as LifeNotification
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`markNotificationRead: ${error.message}`)
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false)
  if (error) throw new Error(`markAllNotificationsRead: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// Time blocks (schedule)
// ──────────────────────────────────────────────────────────────────────

export async function listTimeBlocks(
  userId: string,
  date: string
): Promise<LifeTimeBlock[]> {
  const { data, error } = await lifeDb()
    .from('life_time_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .order('start_minute', { ascending: true })
  if (error) throw new Error(`listTimeBlocks: ${error.message}`)
  return (data ?? []) as LifeTimeBlock[]
}

export async function createTimeBlock(input: {
  userId: string
  date: string
  start_minute: number
  end_minute: number
  label: string
  kind?: TimeBlockKind
  task_id?: string | null
  source?: 'manual' | 'agent'
}): Promise<LifeTimeBlock> {
  const { data, error } = await lifeDb()
    .from('life_time_blocks')
    .insert({
      user_id: input.userId,
      date: input.date,
      start_minute: input.start_minute,
      end_minute: input.end_minute,
      label: input.label,
      kind: input.kind ?? 'deep',
      task_id: input.task_id ?? null,
      source: input.source ?? 'manual',
    })
    .select()
    .single()
  if (error) throw new Error(`createTimeBlock: ${error.message}`)
  return data as LifeTimeBlock
}

export async function deleteTimeBlock(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_time_blocks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteTimeBlock: ${error.message}`)
}

// ──────────────────────────────────────────────────────────────────────
// Learn items (reading queue)
// ──────────────────────────────────────────────────────────────────────

export async function listLearnItems(
  userId: string,
  status?: LearnStatus
): Promise<LifeLearnItem[]> {
  let q = lifeDb()
    .from('life_learn_items')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(`listLearnItems: ${error.message}`)
  return (data ?? []) as LifeLearnItem[]
}

export async function createLearnItem(input: {
  userId: string
  title: string
  source_url?: string | null
  source_type?: LearnSourceType
  papermind_id?: string | null
  topic?: string | null
  notes?: string | null
}): Promise<LifeLearnItem> {
  const { data, error } = await lifeDb()
    .from('life_learn_items')
    .insert({
      user_id: input.userId,
      title: input.title,
      source_url: input.source_url ?? null,
      source_type: input.source_type ?? 'manual',
      papermind_id: input.papermind_id ?? null,
      topic: input.topic ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`createLearnItem: ${error.message}`)
  return data as LifeLearnItem
}

export async function updateLearnItem(
  userId: string,
  id: string,
  patch: Partial<Pick<LifeLearnItem, 'status' | 'notes' | 'topic' | 'title'>>
): Promise<void> {
  const next: Record<string, unknown> = { ...patch }
  if (patch.status === 'done') next.completed_at = new Date().toISOString()
  const { error } = await lifeDb()
    .from('life_learn_items')
    .update(next)
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`updateLearnItem: ${error.message}`)
}

export async function deleteLearnItem(userId: string, id: string): Promise<void> {
  const { error } = await lifeDb()
    .from('life_learn_items')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteLearnItem: ${error.message}`)
}

/** Returns a Set of papermind ids that already exist as learn items for this user. */
export async function getImportedPapermindIds(userId: string): Promise<Set<string>> {
  const { data, error } = await lifeDb()
    .from('life_learn_items')
    .select('papermind_id')
    .eq('user_id', userId)
    .not('papermind_id', 'is', null)
  if (error) throw new Error(`getImportedPapermindIds: ${error.message}`)
  return new Set((data ?? []).map((r: { papermind_id: string }) => r.papermind_id))
}

// ──────────────────────────────────────────────────────────────────────
// Review rollups
// ──────────────────────────────────────────────────────────────────────

export interface WeekStats {
  done: number
  open: number
  byCategory: Record<string, number>
  closedJournalDays: number
}

export async function getRangeStats(
  userId: string,
  fromDate: string,
  toDate: string // inclusive YYYY-MM-DD
): Promise<WeekStats> {
  const db = lifeDb()
  const [tasks, journals, projects] = await Promise.all([
    db
      .from('life_tasks')
      .select('id, status, project_id, scheduled_for, done_at')
      .eq('user_id', userId)
      .gte('scheduled_for', fromDate)
      .lte('scheduled_for', toDate),
    db
      .from('life_journal')
      .select('date, closed_at')
      .eq('user_id', userId)
      .gte('date', fromDate)
      .lte('date', toDate),
    db
      .from('life_projects')
      .select('id, category')
      .eq('user_id', userId),
  ])
  if (tasks.error) throw new Error(`getRangeStats tasks: ${tasks.error.message}`)
  if (journals.error) throw new Error(`getRangeStats journal: ${journals.error.message}`)
  if (projects.error) throw new Error(`getRangeStats projects: ${projects.error.message}`)

  const projCat = new Map<string, string>()
  for (const p of projects.data ?? []) projCat.set(p.id as string, p.category as string)

  const stats: WeekStats = { done: 0, open: 0, byCategory: {}, closedJournalDays: 0 }
  for (const t of tasks.data ?? []) {
    if (t.status === 'done') stats.done++
    else if (t.status === 'todo' || t.status === 'doing') stats.open++
    const cat = (t.project_id ? projCat.get(t.project_id as string) : 'unassigned') ?? 'unassigned'
    stats.byCategory[cat] = (stats.byCategory[cat] ?? 0) + 1
  }
  stats.closedJournalDays = (journals.data ?? []).filter((j: { closed_at: string | null }) => j.closed_at).length
  return stats
}

/** Consecutive trailing days (ending at `today`) with closed_at set on the journal entry. */
export async function getStreak(userId: string, today: string): Promise<number> {
  const { data, error } = await lifeDb()
    .from('life_journal')
    .select('date, closed_at')
    .eq('user_id', userId)
    .lte('date', today)
    .order('date', { ascending: false })
    .limit(60)
  if (error) throw new Error(`getStreak: ${error.message}`)
  let streak = 0
  let cursor = today
  for (const row of data ?? []) {
    if (row.date !== cursor || !row.closed_at) break
    streak++
    // step cursor back one day
    const d = new Date(`${cursor}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    cursor = d.toISOString().slice(0, 10)
  }
  return streak
}
