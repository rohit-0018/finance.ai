// Brainstorm agent — the phase-aware scripted interview that turns a talk
// into a committable plan. Lives on top of the same OpenAI browser client
// we already use in src/life/lib/agent.ts (that bigger file will be
// refactored in Phase 9 when agent calls move to Edge Functions).
//
// Four phases, in order:
//   goal          → nail down what "done" looks like and why now
//   constraints   → deadline, people, budget, risks
//   decomposition → milestones + tasks + estimates + first actions
//   schedule      → dates, depend_on links, implementation intentions
//   review        → commit gates run, user clicks "commit"
//
// The agent is ALLOWED to advance phases. Each turn it returns:
//   - user_facing: what to show in chat
//   - context_update: partial patch to merge into brainstorm.context
//   - next_phase: which phase should be active after this turn
//   - draft_plan?: only when decomposition/schedule phases, a full PlanSnapshot
//
// We force JSON output. Retry once on parse failure.
import type {
  LifeBrainstorm,
  LifeAgentMessage,
  LifeUser,
  LifeWorkspace,
  LifeValue,
  LifeHorizon,
  BrainstormPhase,
  PlanSnapshot,
} from '../types'
import { getEnergyWindow } from './energy'
import { summarizeOtherWorkspace } from './crossWorkspace'
import type { ModePreset } from './modes'

const MODEL = 'gpt-4o'

async function callOpenAI(opts: {
  system: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  max_tokens?: number
  json?: boolean
}): Promise<string> {
  const key = import.meta.env.OPENAI_KEY
  if (!key) throw new Error('OPENAI_KEY not set in .env')
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })

  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: opts.max_tokens ?? 2200,
    response_format: opts.json ? { type: 'json_object' } : undefined,
    messages: [{ role: 'system' as const, content: opts.system }, ...opts.messages],
  })
  return res.choices[0]?.message?.content ?? ''
}

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const m = text.match(/\{[\s\S]*\}/)
  return m ? m[0] : text
}

// ────────────────────────────────────────────────────────────────────
// System prompt — the productivity coach persona
// ────────────────────────────────────────────────────────────────────

const BASE_SYSTEM = `You are the user's Life copilot running a BRAINSTORM INTERVIEW.

Rules you must never break:
- You are not a generic chatbot. You are turning a vague idea into a committable plan.
- You move the user through exactly four phases in order: goal → constraints → decomposition → schedule. Do not jump phases.
- You advance a phase ONLY when the required fields for that phase are answered clearly.
- You ask at most TWO questions per turn. Usually one.
- You are direct, concrete, and push for action. No platitudes.
- You never invent facts. If something is unclear, ask.
- When the user is vague, propose a specific interpretation and ask them to confirm or correct it. Don't bounce the question back empty.
- You end every turn with a concrete micro-ask (what you need from them next).

PHASE RULES:
• goal → you need: a one-line outcome ("done looks like ___"), and a why_now.
• constraints → you need: deadline or "soft", stakeholders/dependencies, budget/resources, and risks the user is already aware of.
• decomposition → you draft a PlanSnapshot: milestones (2-5), tasks (5-15, each with estimate_min, priority 1-3, a first_action, when_where optional), and a rough pre_mortem (why_fail / smallest_version / first_cut).
• schedule → you turn tasks into real start_at/due_at timestamps (ISO). P1 tasks MUST have a when_where. Don't pack every slot; leave breathing room.

OUTPUT FORMAT (JSON only, no prose outside the object):
{
  "user_facing": "what to show the user in chat — short, 1-3 sentences",
  "context_update": { /* partial patch to merge into brainstorm.context */ },
  "next_phase": "goal" | "constraints" | "decomposition" | "schedule" | "review",
  "draft_plan": { /* optional PlanSnapshot — only in decomposition/schedule phases */ },
  "memory_updates": [ /* optional — facts to persist long-term, e.g.
     { "key": "manager", "value": "Priya", "workspace_scoped": true }
     { "key": "partner_name", "value": "Sam", "workspace_scoped": false }
    cross-workspace facts (partner name, timezone quirks) should NOT be
    workspace_scoped. Things specific to one life (your manager's name)
    SHOULD be workspace_scoped. */ ]
}

PlanSnapshot shape:
{
  "definition_of_done": "single sentence",
  "milestones": [{ "title": "...", "target_date": "YYYY-MM-DD optional" }],
  "tasks": [{
    "temp_id": "t1",
    "title": "...",
    "notes": "...",
    "estimate_min": 60,
    "priority": 1,
    "when_where": "Mon 8am, desk, after coffee",
    "first_action": "open file X and draft 3 bullets",
    "start_at": "ISO — only in schedule phase",
    "due_at": "ISO — only in schedule phase",
    "depends_on": ["t0"],
    "milestone": "milestone title"
  }],
  "risks": ["risk 1", "risk 2"],
  "pre_mortem": {
    "why_fail": "single sentence",
    "smallest_version": "single sentence",
    "first_cut": "single sentence"
  }
}`

async function personaContext(
  user: LifeUser,
  workspace: LifeWorkspace,
  values: LifeValue[],
  horizons: LifeHorizon[]
): Promise<string> {
  const energy = await getEnergyWindow(user).catch(() => null)
  const vs = values.map((v) => `- ${v.title}${v.description ? ` (${v.description})` : ''}`).join('\n') || '(none defined yet)'
  const qGoals =
    horizons.filter((h) => h.kind === 'quarter' && h.status === 'active').map((h) => `- ${h.title}${h.why ? ` — ${h.why}` : ''}`).join('\n') || '(none defined yet)'
  const yrGoals =
    horizons.filter((h) => h.kind === 'year' && h.status === 'active').map((h) => `- ${h.title}`).join('\n') || '(none)'
  const energyLine = energy
    ? `- Peak focus window: ${energy.startHour}:00–${energy.endHour}:00 (${
        energy.confident ? `learned from ${energy.sample} completed tasks` : 'default guess'
      }). Schedule P1 deep work here.`
    : ''

  return `USER CONTEXT:
- Workspace: ${workspace.name} (${workspace.kind})
- Timezone: ${user.timezone}
- WFH hours: ${user.work_start_hour}:00–${user.work_end_hour}:00
- EOD: ${user.eod_hour}:00
${energyLine}

VALUES (use to flag misalignment):
${vs}

QUARTERLY GOALS (every committed plan must trace to one):
${qGoals}

YEARLY GOALS:
${yrGoals}`
}

function phasePrompt(phase: BrainstormPhase, brainstorm: LifeBrainstorm): string {
  const ctxLines: string[] = []
  const c = brainstorm.context
  if (c.goal) ctxLines.push(`- goal: ${c.goal}`)
  if (c.why_now) ctxLines.push(`- why_now: ${c.why_now}`)
  if (c.definition_of_done) ctxLines.push(`- definition_of_done: ${c.definition_of_done}`)
  if (c.deadline) ctxLines.push(`- deadline: ${c.deadline}`)
  if (c.constraints?.length) ctxLines.push(`- constraints: ${c.constraints.join('; ')}`)
  if (c.stakeholders?.length) ctxLines.push(`- stakeholders: ${c.stakeholders.join(', ')}`)
  if (c.risks?.length) ctxLines.push(`- risks: ${c.risks.join('; ')}`)
  if (c.pre_mortem) ctxLines.push(`- pre_mortem: ${JSON.stringify(c.pre_mortem)}`)

  return `CURRENT PHASE: ${phase}
BRAINSTORM TITLE: ${brainstorm.title}

WHAT YOU ALREADY KNOW:
${ctxLines.length > 0 ? ctxLines.join('\n') : '(nothing yet — this is turn 1)'}`
}

// ────────────────────────────────────────────────────────────────────
// Agent turn types
// ────────────────────────────────────────────────────────────────────

export interface BrainstormTurnInput {
  user: LifeUser
  workspace: LifeWorkspace
  workspaces: LifeWorkspace[]
  values: LifeValue[]
  horizons: LifeHorizon[]
  memory: Array<{ key: string; value: string; workspace_id: string | null }>
  mode?: ModePreset | null
  brainstorm: LifeBrainstorm
  history: LifeAgentMessage[]
  userMessage: string
}

export interface MemoryUpdate {
  key: string
  value: string
  workspace_scoped?: boolean
}

export interface BrainstormTurnOutput {
  user_facing: string
  context_update: Record<string, unknown>
  next_phase: BrainstormPhase
  draft_plan?: PlanSnapshot
  memory_updates?: MemoryUpdate[]
}

export async function runBrainstormTurn(
  input: BrainstormTurnInput
): Promise<BrainstormTurnOutput> {
  const persona = await personaContext(
    input.user,
    input.workspace,
    input.values,
    input.horizons
  )
  const otherWs = await summarizeOtherWorkspace(
    input.user,
    input.workspace.id,
    input.workspaces
  ).catch(() => null)
  const memoryBlock =
    input.memory.length > 0
      ? 'MEMORY (facts you already know about the user):\n' +
        input.memory.map((m) => `- ${m.key}: ${m.value}`).join('\n')
      : ''
  const crossBlock = otherWs ? `OTHER WORKSPACE:\n${otherWs.paragraph}` : ''
  const modeBlock = input.mode
    ? `ACTIVE LIFE MODE: ${input.mode.label} — ${input.mode.description}\nTONE: ${input.mode.brainstormTone}`
    : ''
  const system = [
    BASE_SYSTEM,
    persona,
    modeBlock,
    crossBlock,
    memoryBlock,
    phasePrompt(input.brainstorm.phase, input.brainstorm),
  ]
    .filter(Boolean)
    .join('\n\n')

  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
  // Trim history to last 20 turns to keep tokens bounded
  for (const m of input.history.slice(-20)) {
    if (m.role === 'system') continue
    messages.push({ role: m.role as 'user' | 'assistant', content: m.content })
  }
  messages.push({ role: 'user', content: input.userMessage })

  const raw = await callOpenAI({ system, messages, json: true, max_tokens: 2200 })
  const body = extractJSON(raw)

  let parsed: Partial<BrainstormTurnOutput> & { next_phase?: string }
  try {
    parsed = JSON.parse(body)
  } catch {
    // Retry once asking explicitly for JSON only
    const retry = await callOpenAI({
      system: system + '\n\nYour last response was not valid JSON. Return ONLY a JSON object.',
      messages,
      json: true,
      max_tokens: 2200,
    })
    parsed = JSON.parse(extractJSON(retry))
  }

  const nextPhase = normalizePhase(parsed.next_phase) ?? input.brainstorm.phase
  const memory_updates = Array.isArray((parsed as { memory_updates?: unknown }).memory_updates)
    ? ((parsed as { memory_updates: MemoryUpdate[] }).memory_updates ?? []).filter(
        (m) => typeof m?.key === 'string' && typeof m?.value === 'string'
      )
    : undefined
  return {
    user_facing: (parsed.user_facing ?? '').toString(),
    context_update: (parsed.context_update as Record<string, unknown>) ?? {},
    next_phase: nextPhase,
    draft_plan: parsed.draft_plan as PlanSnapshot | undefined,
    memory_updates,
  }
}

function normalizePhase(v: unknown): BrainstormPhase | null {
  if (typeof v !== 'string') return null
  const known: BrainstormPhase[] = ['goal', 'constraints', 'decomposition', 'schedule', 'review']
  return (known as string[]).includes(v) ? (v as BrainstormPhase) : null
}
