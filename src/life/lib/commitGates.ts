// Commit gates — discipline enforcement at the point a plan becomes real.
//
// Every rule here directly targets a failure mode we mapped earlier:
//   DoD          → 1 (starting but not finishing)
//   pre-mortem   → 3 (over-committing and bailing)
//   intentions   → 4 (procrastination / hard-start)
//   capacity     → 3
//   cascade      → 7 (long-horizon alignment)
//   no-new-proj  → 1 (projects stalled → can't start new ones)
//   calibration  → 3 (silent estimate inflation)
//
// Each gate returns a GateResult. The UI shows all failures at once so the
// user isn't dripped through 6 modals in a row.
import type {
  LifeBrainstorm,
  LifeHorizon,
  LifePlan,
  PlanSnapshot,
  LifeUser,
  LifeWorkspace,
  LifeValue,
} from '../types'
import { countStalledProjects } from './db/projects'
import { getCapacity } from './db/capacity'
import { getCalibrationMultiplier } from './db/estimates'
import { lifeDb } from './db/_client'
import type { ModePreset } from './modes'

export type GateSeverity = 'block' | 'warn'

export interface GateResult {
  gate: string
  severity: GateSeverity
  message: string
  fix?: string
}

export interface CommitGatesInput {
  user: LifeUser
  brainstorm: LifeBrainstorm
  plan: LifePlan
  horizons: LifeHorizon[]
  /** Every workspace the user has — used to enforce the cross-workspace guardrail. */
  workspaces: LifeWorkspace[]
  /** User's declared values. Used for the soft alignment warning. */
  values?: LifeValue[]
  /** Active life mode. Relaxes or tightens specific gates. */
  mode?: ModePreset | null
  /** Override — if true, "exploration" plans can skip the cascade gate. */
  exploration?: boolean
}

export interface CommitGatesOutput {
  blockers: GateResult[]
  warnings: GateResult[]
  /** Plan with calibration multiplier applied to estimates. Use this, not plan.snapshot. */
  calibratedSnapshot: PlanSnapshot
  calibrationMultiplier: number
}

const MAX_STALLED_PROJECTS = 3
const DEFAULT_DAILY_CEILING_MIN = 480

export async function evaluateCommitGates(
  input: CommitGatesInput
): Promise<CommitGatesOutput> {
  const { brainstorm, plan, horizons, exploration, mode } = input
  const snap = plan.snapshot

  const blockers: GateResult[] = []
  const warnings: GateResult[] = []

  // ── Phase 10: mode-level short-circuits ────────────────────────────
  // Travel mode refuses work-workspace commits outright — the user said
  // "no new work while I'm travelling", honor it at the door.
  if (mode && !mode.workWorkspaceAllowed) {
    // Check if this brainstorm's workspace is the work one.
    const thisWs = input.workspaces.find((w) => w.id === brainstorm.workspace_id)
    if (thisWs?.kind === 'work') {
      blockers.push({
        gate: 'mode_workspace',
        severity: 'block',
        message: `${mode.label} mode: work-workspace commits are disabled.`,
        fix: 'Switch to Normal mode or commit this plan under Personal.',
      })
      return {
        blockers,
        warnings,
        calibratedSnapshot: snap,
        calibrationMultiplier: 1,
      }
    }
  }

  // 1. Definition of done
  if (!snap.definition_of_done || snap.definition_of_done.trim().length < 10) {
    blockers.push({
      gate: 'definition_of_done',
      severity: 'block',
      message: 'No clear definition of done.',
      fix: 'Write one sentence that describes what "shipped" looks like for this project.',
    })
  }

  // 2. Pre-mortem
  const pm = snap.pre_mortem
  if (!pm?.why_fail || !pm?.smallest_version || !pm?.first_cut) {
    blockers.push({
      gate: 'pre_mortem',
      severity: 'block',
      message: 'Pre-mortem incomplete.',
      fix: 'Answer all three: why this will fail, the smallest version that still counts, the first thing you\'ll cut when behind.',
    })
  }

  // 3. Implementation intentions on P1 tasks
  const p1Missing = snap.tasks.filter(
    (t) => (t.priority ?? 3) <= 1 && (!t.when_where || t.when_where.trim().length < 5)
  )
  if (p1Missing.length > 0) {
    blockers.push({
      gate: 'implementation_intentions',
      severity: 'block',
      message: `${p1Missing.length} P1 task${p1Missing.length === 1 ? '' : 's'} missing a when/where.`,
      fix: 'For every P1: specify when + where + after-what (e.g. "Tue 8am at desk after coffee").',
    })
  }

  // 4. Cascade — plan must trace to a quarterly horizon, unless exploration
  //    or the active mode relaxes the cascade gate (crunch/recovery/travel).
  const qHorizonId = brainstorm.context.horizon_id
  const hasValidHorizon =
    qHorizonId && horizons.some((h) => h.id === qHorizonId && h.kind === 'quarter')
  if (!hasValidHorizon && !exploration && !mode?.gates.relaxCascade) {
    blockers.push({
      gate: 'cascade',
      severity: 'block',
      message: 'Plan does not trace to a quarterly goal.',
      fix: 'Pick a quarter goal, or explicitly commit this as an exploration plan.',
    })
  }

  // 5. No-new-projects gate — relaxed in Recovery (you're resting).
  if (!mode?.gates.relaxNoNewProjects) {
    const stalled = await countStalledProjects(input.user.id, brainstorm.workspace_id)
    if (stalled >= MAX_STALLED_PROJECTS) {
      blockers.push({
        gate: 'no_new_projects',
        severity: 'block',
        message: `${stalled} projects stalled in this workspace.`,
        fix: 'Close or drop at least one stalled project before starting a new one.',
      })
    }
  }

  // 6. Calibration — silently inflate estimates by the user's personal multiplier
  const multiplier = await getCalibrationMultiplier(input.user.id)
  const calibratedSnapshot: PlanSnapshot = {
    ...snap,
    tasks: snap.tasks.map((t) => ({
      ...t,
      estimate_min:
        typeof t.estimate_min === 'number'
          ? Math.round(t.estimate_min * multiplier)
          : t.estimate_min,
    })),
  }

  // 7. Capacity — sum calibrated estimates per date, compare to ceiling.
  //    Relaxed during Recovery and Travel modes.
  const byDate = new Map<string, number>()
  for (const t of calibratedSnapshot.tasks) {
    if (!t.start_at || !t.estimate_min) continue
    const date = t.start_at.slice(0, 10) // YYYY-MM-DD
    byDate.set(date, (byDate.get(date) ?? 0) + t.estimate_min)
  }
  const skipCapacity = mode?.gates.relaxCapacity === true
  for (const [date, minutes] of skipCapacity ? [] : byDate) {
    const cap = await getCapacity(input.user.id, date)
    const ceiling = cap?.ceiling_min ?? DEFAULT_DAILY_CEILING_MIN
    const committed = cap?.committed_min ?? 0
    const total = committed + minutes
    if (total > ceiling) {
      blockers.push({
        gate: 'capacity',
        severity: 'block',
        message: `${date} over capacity: ${total}m scheduled vs ${ceiling}m ceiling.`,
        fix: 'Move tasks to another day or drop lower-priority items.',
      })
    } else if (total > ceiling * 0.85) {
      warnings.push({
        gate: 'capacity',
        severity: 'warn',
        message: `${date} near capacity: ${total}/${ceiling}m.`,
      })
    }
  }

  // 8. Calibration-applied warning (transparency — not a blocker)
  if (multiplier > 1.1) {
    warnings.push({
      gate: 'calibration',
      severity: 'warn',
      message: `Estimates auto-inflated ×${multiplier.toFixed(2)} based on your history.`,
    })
  }

  // 9. Cross-workspace guardrail — does this plan schedule anything on top
  //    of existing commitments in the OTHER workspace? Skipped entirely in
  //    Recovery and Travel modes.
  const otherWorkspaceIds = mode?.gates.relaxCrossWorkspace
    ? []
    : input.workspaces
        .filter((w) => w.id !== brainstorm.workspace_id)
        .map((w) => w.id)
  if (otherWorkspaceIds.length > 0) {
    const scheduled = calibratedSnapshot.tasks.filter((t) => t.start_at)
    if (scheduled.length > 0) {
      const timeMin = scheduled.reduce(
        (min, t) => (t.start_at! < min ? t.start_at! : min),
        scheduled[0].start_at!
      )
      const timeMax = scheduled.reduce((max, t) => {
        const end =
          t.due_at ??
          new Date(
            new Date(t.start_at!).getTime() + (t.estimate_min ?? 30) * 60_000
          ).toISOString()
        return end > max ? end : max
      }, scheduled[0].start_at!)

      const { data, error } = await lifeDb()
        .from('life_tasks')
        .select('id, workspace_id, start_at, due_at, estimate_min, title')
        .eq('user_id', input.user.id)
        .in('workspace_id', otherWorkspaceIds)
        .in('status', ['todo', 'doing'])
        .not('start_at', 'is', null)
        .lt('start_at', timeMax)
        .gte('start_at', timeMin)

      if (!error && data) {
        type Row = {
          id: string
          start_at: string | null
          due_at: string | null
          estimate_min: number | null
          title: string
        }
        for (const t of scheduled) {
          const tStart = new Date(t.start_at!).getTime()
          const tEnd = t.due_at
            ? new Date(t.due_at).getTime()
            : tStart + (t.estimate_min ?? 30) * 60_000
          for (const other of data as Row[]) {
            if (!other.start_at) continue
            const oStart = new Date(other.start_at).getTime()
            const oEnd = other.due_at
              ? new Date(other.due_at).getTime()
              : oStart + (other.estimate_min ?? 30) * 60_000
            if (tStart < oEnd && oStart < tEnd) {
              blockers.push({
                gate: 'cross_workspace_overlap',
                severity: 'block',
                message: `"${t.title}" overlaps "${other.title}" in your other workspace.`,
                fix: 'Move this task to a different slot, or reschedule the other commitment first.',
              })
              break
            }
          }
        }
      }
    }
  }

  // 10. Values warning — if the user has declared values, check whether this
  //     plan's tasks mention any of them. Heuristic: string match against
  //     title+notes. If the plan is "heavy" in one value bucket and "zero" in
  //     another high-weight value, surface a soft warning.
  const values = input.values ?? []
  if (values.length > 0) {
    const corpus = calibratedSnapshot.tasks
      .map((t) => `${t.title} ${t.notes ?? ''}`)
      .join(' ')
      .toLowerCase()
    const hits = values.map((v) => ({
      title: v.title,
      weight: v.weight,
      count: corpus.includes(v.title.toLowerCase()) ? 1 : 0,
    }))
    const highWeightMissed = hits
      .filter((h) => h.weight >= 2 && h.count === 0)
      .map((h) => h.title)
    if (highWeightMissed.length > 0 && calibratedSnapshot.tasks.length >= 4) {
      warnings.push({
        gate: 'values_alignment',
        severity: 'warn',
        message: `Plan doesn't reference your high-weight value${
          highWeightMissed.length === 1 ? '' : 's'
        }: ${highWeightMissed.join(', ')}.`,
        fix: 'Fine if this is a focused push — just noting the imbalance.',
      })
    }
  }

  // Launch mode: warnings are treated as blockers. Promotes every gathered
  // warning into a hard blocker so you can't commit something marginal.
  if (mode?.gates.warningsBecomeBlockers && warnings.length > 0) {
    for (const w of warnings) {
      blockers.push({ ...w, severity: 'block' })
    }
    warnings.length = 0
  }

  return { blockers, warnings, calibratedSnapshot, calibrationMultiplier: multiplier }
}
