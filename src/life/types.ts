// Runtime types for the Life app. Shape mirrors prisma/life/schema.prisma.

// ──────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────
export type LifeCategory = 'office' | 'personal' | 'health' | 'learn'
export type LifeStatus = 'active' | 'paused' | 'done' | 'dropped'
export type LifeHealth = 'green' | 'yellow' | 'red'
export type TaskStatus = 'todo' | 'doing' | 'done' | 'dropped'
export type TaskSource = 'manual' | 'agent' | 'quickadd' | 'plan'
export type AgentRole = 'user' | 'assistant' | 'system'
export type WorkspaceKind = 'work' | 'personal'
export type BrainstormPhase = 'goal' | 'constraints' | 'decomposition' | 'schedule' | 'review'
export type BrainstormStatus = 'open' | 'committed' | 'abandoned'
export type PlanStatus = 'draft' | 'committed' | 'superseded'
export type HorizonKind = 'five_year' | 'year' | 'quarter'
export type WaitingStatus = 'waiting' | 'received' | 'gave_up'
export type StakeKind = 'money' | 'social' | 'forfeit'
export type StakeStatus = 'pending' | 'honored' | 'paid' | 'waived'
export type DropKind = 'task' | 'project'
export type MemorySource = 'agent' | 'user'
export type IntegrationProvider =
  | 'google_calendar'
  | 'github'
  | 'linear'
  | 'slack'
  | 'notion'
export type NotificationKind =
  | 'task_due'
  | 'eod_reminder'
  | 'pulse_ready'
  | 'project_at_risk'
  | 'agent_message'
  | 'waiting_follow_up'
  | 'learning_review'
  | 'stake_triggered'
  | 'capacity_exceeded'

// ──────────────────────────────────────────────────────────────────────
// Users + workspaces
// ──────────────────────────────────────────────────────────────────────
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
  active_workspace_id: string | null
  created_at: string
}

export interface LifeWorkspace {
  id: string
  user_id: string
  kind: WorkspaceKind
  name: string
  accent_color: string
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────
// Time blocks (kept)
// ──────────────────────────────────────────────────────────────────────
export type TimeBlockKind = 'office' | 'deep' | 'learn' | 'admin' | 'break'

export interface LifeTimeBlock {
  id: string
  user_id: string
  workspace_id: string
  date: string // YYYY-MM-DD
  start_minute: number
  end_minute: number
  label: string
  kind: TimeBlockKind
  task_id: string | null
  source: 'manual' | 'agent'
  google_event_id: string | null
  created_at: string
}

// ──────────────────────────────────────────────────────────────────────
// Learn items (legacy reading queue — Phase 5 will extend via life_learnings)
// ──────────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────────
// Goals + horizons + projects + tasks
// ──────────────────────────────────────────────────────────────────────
export interface LifeGoal {
  id: string
  user_id: string
  workspace_id: string
  title: string
  why: string | null
  category: LifeCategory
  horizon: 'quarter' | 'year' | 'life'
  status: LifeStatus
  target_date: string | null
  horizon_id: string | null
  created_at: string
  updated_at: string
}

export interface LifeHorizon {
  id: string
  user_id: string
  kind: HorizonKind
  title: string
  why: string | null
  target_date: string | null
  parent_id: string | null
  status: LifeStatus
  created_at: string
  updated_at: string
}

export interface LifeProject {
  id: string
  user_id: string
  workspace_id: string
  goal_id: string | null
  name: string
  description: string | null
  category: LifeCategory
  status: LifeStatus
  health: LifeHealth
  context: Record<string, unknown>
  definition_of_done: string | null
  contract_mode: boolean
  brainstorm_id: string | null
  created_at: string
  updated_at: string
}

export interface TaskAutomation {
  reminders?: Array<{
    offset_min: number // negative = before due, positive = after
    channel: 'browser' | 'email' | 'slack' | 'phone'
    label?: string
  }>
  escalate_if_untouched_days?: number
  check_in_cron?: string
  recurring?: {
    rrule?: string // RFC5545
  }
}

export interface LifeTask {
  id: string
  user_id: string
  workspace_id: string
  project_id: string | null
  goal_id: string | null
  parent_task_id: string | null
  title: string
  notes: string | null
  scheduled_for: string | null // YYYY-MM-DD — legacy
  start_at: string | null
  due_at: string | null
  estimate_min: number | null
  actual_min: number | null
  status: TaskStatus
  priority: number
  tags: string[]
  source: TaskSource
  when_where: string | null
  first_action: string | null
  hard_start: boolean
  depends_on: string[]
  automation: TaskAutomation
  origin_message_id: string | null
  plan_id: string | null
  google_event_id: string | null
  created_at: string
  updated_at: string
  done_at: string | null
}

// ──────────────────────────────────────────────────────────────────────
// Journal + pulses
// ──────────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────────
// Agent messages
// ──────────────────────────────────────────────────────────────────────
export interface LifeAgentMessage {
  id: string
  user_id: string
  workspace_id: string
  project_id: string | null
  brainstorm_id: string | null
  role: AgentRole
  content: string
  meta: Record<string, unknown> | null
  created_at: string
}

// ──────────────────────────────────────────────────────────────────────
// Brainstorms + plans
// ──────────────────────────────────────────────────────────────────────
export interface LifeBrainstorm {
  id: string
  user_id: string
  workspace_id: string
  title: string
  phase: BrainstormPhase
  status: BrainstormStatus
  summary: string | null
  context: {
    goal?: string
    why_now?: string
    constraints?: string[]
    stakeholders?: string[]
    deadline?: string | null
    budget?: string | null
    definition_of_done?: string
    risks?: string[]
    pre_mortem?: { why_fail?: string; smallest_version?: string; first_cut?: string }
    horizon_id?: string
    exploration?: boolean
    [k: string]: unknown
  }
  project_id: string | null
  created_at: string
  updated_at: string
  committed_at: string | null
}

export interface PlanSnapshotTask {
  temp_id: string
  title: string
  notes?: string
  estimate_min?: number
  priority?: number
  when_where?: string
  first_action?: string
  start_at?: string
  due_at?: string
  depends_on?: string[] // temp_ids within this plan
  milestone?: string
}

export interface PlanSnapshot {
  definition_of_done: string
  milestones: Array<{ title: string; target_date?: string }>
  tasks: PlanSnapshotTask[]
  risks: string[]
  pre_mortem: {
    why_fail: string
    smallest_version: string
    first_cut: string
  }
}

export interface LifePlan {
  id: string
  user_id: string
  brainstorm_id: string
  project_id: string | null
  version: number
  status: PlanStatus
  snapshot: PlanSnapshot
  created_at: string
  committed_at: string | null
}

// ──────────────────────────────────────────────────────────────────────
// Notifications
// ──────────────────────────────────────────────────────────────────────
export interface LifeNotification {
  id: string
  user_id: string
  workspace_id: string
  kind: NotificationKind
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

// ──────────────────────────────────────────────────────────────────────
// Discipline loop tables
// ──────────────────────────────────────────────────────────────────────
export interface LifeValue {
  id: string
  user_id: string
  title: string
  description: string | null
  weight: number
  created_at: string
  updated_at: string
}

export interface LifeWaitingOn {
  id: string
  user_id: string
  workspace_id: string
  task_id: string | null
  title: string
  who: string
  asked_at: string
  sla_days: number
  follow_up_at: string
  status: WaitingStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface LifeLearning {
  id: string
  user_id: string
  workspace_id: string
  content: string
  source_url: string | null
  source_type: 'manual' | 'papermind' | 'meeting' | 'book' | 'video'
  source_ref: string | null
  interval_days: number
  next_review_at: string
  review_count: number
  ease: number
  archived: boolean
  action_deadline: string | null
  became_task_id: string | null
  created_at: string
  updated_at: string
}

export interface LifeStake {
  id: string
  user_id: string
  task_id: string | null
  project_id: string | null
  kind: StakeKind
  amount_cents: number | null
  description: string
  partner: string | null
  status: StakeStatus
  created_at: string
  resolved_at: string | null
}

export interface LifeDrop {
  id: string
  user_id: string
  kind: DropKind
  ref_id: string
  title: string
  reason: string
  created_at: string
}

export interface LifeEstimate {
  id: string
  user_id: string
  task_id: string
  estimated_min: number
  actual_min: number
  created_at: string
}

export interface LifeCapacity {
  id: string
  user_id: string
  date: string
  ceiling_min: number
  committed_min: number
  updated_at: string
}

export interface LifeMemory {
  id: string
  user_id: string
  workspace_id: string | null
  key: string
  value: string
  source: MemorySource
  confidence: number
  created_at: string
  updated_at: string
}

export interface LifeIntegration {
  id: string
  user_id: string
  provider: IntegrationProvider
  access_token: string
  refresh_token: string | null
  scope: string | null
  expires_at: string | null
  meta: Record<string, unknown>
  created_at: string
  updated_at: string
}
