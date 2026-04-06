// Runtime types for the Life app. Shape mirrors prisma/life/schema.prisma.

export type LifeCategory = 'office' | 'personal' | 'health' | 'learn'
export type LifeStatus = 'active' | 'paused' | 'done' | 'dropped'
export type LifeHealth = 'green' | 'yellow' | 'red'
export type TaskStatus = 'todo' | 'doing' | 'done' | 'dropped'
export type TaskSource = 'manual' | 'agent' | 'quickadd'
export type AgentRole = 'user' | 'assistant' | 'system'
export type NotificationKind =
  | 'task_due'
  | 'eod_reminder'
  | 'pulse_ready'
  | 'project_at_risk'
  | 'agent_message'

export interface LifeUser {
  id: string
  papermind_user_id: string
  username: string
  display_name: string | null
  timezone: string
  eod_hour: number
  work_start_hour: number
  work_end_hour: number
  notify_browser: boolean
  created_at: string
}

export type TimeBlockKind = 'office' | 'deep' | 'learn' | 'admin' | 'break'

export interface LifeTimeBlock {
  id: string
  user_id: string
  date: string // YYYY-MM-DD
  start_minute: number // 0..1439
  end_minute: number
  label: string
  kind: TimeBlockKind
  task_id: string | null
  source: 'manual' | 'agent'
  created_at: string
}

export type LearnStatus = 'queue' | 'reading' | 'done' | 'dropped'
export type LearnSourceType = 'manual' | 'papermind_paper' | 'papermind_article' | 'url'

export interface LifeLearnItem {
  id: string
  user_id: string
  title: string
  source_url: string | null
  source_type: LearnSourceType
  papermind_id: string | null
  topic: string | null
  notes: string | null
  status: LearnStatus
  added_at: string
  completed_at: string | null
}

export interface LifeGoal {
  id: string
  user_id: string
  title: string
  why: string | null
  category: LifeCategory
  horizon: 'quarter' | 'year' | 'life'
  status: LifeStatus
  target_date: string | null
  created_at: string
  updated_at: string
}

export interface LifeProject {
  id: string
  user_id: string
  goal_id: string | null
  name: string
  description: string | null
  category: LifeCategory
  status: LifeStatus
  health: LifeHealth
  context: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface LifeTask {
  id: string
  user_id: string
  project_id: string | null
  goal_id: string | null
  title: string
  notes: string | null
  scheduled_for: string | null // YYYY-MM-DD
  due_at: string | null
  estimate_min: number | null
  status: TaskStatus
  priority: number
  tags: string[]
  source: TaskSource
  created_at: string
  updated_at: string
  done_at: string | null
}

export interface LifeJournalEntry {
  id: string
  user_id: string
  date: string // YYYY-MM-DD
  summary: string | null
  wins: string | null
  blockers: string | null
  tomorrow: string | null
  energy: number | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

export interface LifeProjectPulse {
  id: string
  user_id: string
  project_id: string
  last_progress: string | null
  next_step: string | null
  whats_missing: string | null
  risk: string | null
  suggested_tasks: Array<{ title: string; estimate_min?: number; priority?: number }>
  health: LifeHealth
  generated_by: 'agent' | 'user'
  raw: unknown
  created_at: string
}

export interface LifeAgentMessage {
  id: string
  user_id: string
  project_id: string | null
  role: AgentRole
  content: string
  meta: Record<string, unknown> | null
  created_at: string
}

export interface LifeNotification {
  id: string
  user_id: string
  kind: NotificationKind
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}
