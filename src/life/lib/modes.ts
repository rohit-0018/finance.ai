// Life modes — Phase 10.
//
// Life isn't linear. Sometimes you're in a launch crunch (ship everything,
// ignore the personal slowdown). Sometimes you're recovering (minimum floor,
// no nagging). Sometimes you're travelling (personal logistics up, work down).
// The system reconfigures itself around whichever mode you're in instead of
// being the same shape every week of the year.
//
// Persistence: stored in life_memory with workspace_id=null (shared across
// both workspaces) and key="active_mode". Avoids another schema migration.
//
// Each preset declares:
//   - label + description (UI copy)
//   - accent (optional tint override)
//   - automation: how aggressive the engine should be
//   - gates: which commit gates to relax, tighten, or flip severity on
//   - streak: "normal" | "paused"
//   - brainstormTone: short string injected into the agent prompt
//   - mvdRequired: whether to enforce minimum-viable day
//   - allowNewProjects: whether the no-new-projects gate applies
//   - workWorkspaceAllowed: whether you can commit to work workspace
import { listMemory, upsertMemory } from './db'

export type ModeId = 'normal' | 'launch' | 'recovery' | 'travel' | 'crunch'

export interface ModePreset {
  id: ModeId
  label: string
  description: string
  accent?: string
  automation: {
    dripIntervalMultiplier: number // 1.0 = normal, 0.5 = twice as frequent, 2.0 = half
    suppressDrift: boolean
    suppressSla: boolean
    suppressEscalation: boolean
    reminderVolumeMultiplier: number
  }
  gates: {
    relaxCapacity: boolean
    relaxCascade: boolean
    relaxNoNewProjects: boolean
    relaxCrossWorkspace: boolean
    warningsBecomeBlockers: boolean
  }
  streak: 'normal' | 'paused'
  brainstormTone: string
  mvdRequired: boolean
  allowNewProjects: boolean
  workWorkspaceAllowed: boolean
}

const NORMAL: ModePreset = {
  id: 'normal',
  label: 'Normal',
  description: 'Default. All gates on. Agents at baseline.',
  automation: {
    dripIntervalMultiplier: 1,
    suppressDrift: false,
    suppressSla: false,
    suppressEscalation: false,
    reminderVolumeMultiplier: 1,
  },
  gates: {
    relaxCapacity: false,
    relaxCascade: false,
    relaxNoNewProjects: false,
    relaxCrossWorkspace: false,
    warningsBecomeBlockers: false,
  },
  streak: 'normal',
  brainstormTone: 'Baseline. Direct and concrete.',
  mvdRequired: true,
  allowNewProjects: true,
  workWorkspaceAllowed: true,
}

const LAUNCH: ModePreset = {
  id: 'launch',
  label: 'Launch',
  description: 'Ship mode. No new projects. Gates tightened. Reminders amplified.',
  accent: '#dc2626',
  automation: {
    dripIntervalMultiplier: 0.5,
    suppressDrift: false,
    suppressSla: false,
    suppressEscalation: false,
    reminderVolumeMultiplier: 1.8,
  },
  gates: {
    relaxCapacity: false,
    relaxCascade: false,
    relaxNoNewProjects: false,
    relaxCrossWorkspace: false,
    warningsBecomeBlockers: true, // any warning now blocks
  },
  streak: 'normal',
  brainstormTone:
    'Launch mode is on. Refuse plans that would add scope. Push the user to finish whatever is already open before starting anything new.',
  mvdRequired: true,
  allowNewProjects: false,
  workWorkspaceAllowed: true,
}

const RECOVERY: ModePreset = {
  id: 'recovery',
  label: 'Recovery',
  description: 'Stripped to the minimum floor. No nagging. Streak paused.',
  accent: '#059669',
  automation: {
    dripIntervalMultiplier: 3,
    suppressDrift: true,
    suppressSla: true,
    suppressEscalation: true,
    reminderVolumeMultiplier: 0.3,
  },
  gates: {
    relaxCapacity: true,
    relaxCascade: true,
    relaxNoNewProjects: true,
    relaxCrossWorkspace: true,
    warningsBecomeBlockers: false,
  },
  streak: 'paused',
  brainstormTone:
    'Recovery mode. The user is deliberately resting. Do NOT push for more output. Suggest the smallest possible version. Affirm the decision to slow down.',
  mvdRequired: false,
  allowNewProjects: false,
  workWorkspaceAllowed: true,
}

const TRAVEL: ModePreset = {
  id: 'travel',
  label: 'Travel',
  description: 'Personal logistics up, work down-weighted. Auto-moves recurring work.',
  accent: '#0ea5e9',
  automation: {
    dripIntervalMultiplier: 1.5,
    suppressDrift: true,
    suppressSla: false,
    suppressEscalation: true,
    reminderVolumeMultiplier: 0.7,
  },
  gates: {
    relaxCapacity: true,
    relaxCascade: true,
    relaxNoNewProjects: false,
    relaxCrossWorkspace: true,
    warningsBecomeBlockers: false,
  },
  streak: 'normal',
  brainstormTone:
    'Travel mode. Personal logistics take priority (flights, packing, bookings). Do NOT propose heavy work tasks. Keep work plans small.',
  mvdRequired: false,
  allowNewProjects: true,
  workWorkspaceAllowed: false,
}

const CRUNCH: ModePreset = {
  id: 'crunch',
  label: 'Crunch',
  description: 'Deadline is real. Everything non-critical gets moved automatically.',
  accent: '#f59e0b',
  automation: {
    dripIntervalMultiplier: 0.4,
    suppressDrift: true, // drift is irrelevant during crunch
    suppressSla: false,
    suppressEscalation: false,
    reminderVolumeMultiplier: 2.2,
  },
  gates: {
    relaxCapacity: false,
    relaxCascade: true, // don't make user worry about long-horizon cascade mid-crunch
    relaxNoNewProjects: false,
    relaxCrossWorkspace: false,
    warningsBecomeBlockers: false,
  },
  streak: 'normal',
  brainstormTone:
    'Crunch mode. There is a hard deadline. Propose the tightest scope that still counts. Kill optional items without asking.',
  mvdRequired: true,
  allowNewProjects: false,
  workWorkspaceAllowed: true,
}

export const MODE_PRESETS: Record<ModeId, ModePreset> = {
  normal: NORMAL,
  launch: LAUNCH,
  recovery: RECOVERY,
  travel: TRAVEL,
  crunch: CRUNCH,
}

export const MODE_LIST: ModePreset[] = [NORMAL, LAUNCH, RECOVERY, TRAVEL, CRUNCH]

const MODE_KEY = 'active_mode'

/** Fetch the active mode. Defaults to 'normal' if nothing is set. */
export async function getActiveMode(userId: string): Promise<ModePreset> {
  const rows = await listMemory(userId, null).catch(() => [])
  const row = rows.find((r) => r.key === MODE_KEY && r.workspace_id === null)
  const id = (row?.value as ModeId | undefined) ?? 'normal'
  return MODE_PRESETS[id] ?? NORMAL
}

/** Set the active mode. Persists into life_memory with shared scope. */
export async function setActiveMode(userId: string, mode: ModeId): Promise<void> {
  await upsertMemory({
    userId,
    workspaceId: null,
    key: MODE_KEY,
    value: mode,
    source: 'user',
  })
}
