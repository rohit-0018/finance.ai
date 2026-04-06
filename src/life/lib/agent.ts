// Life agent — uses the same OpenAI client pattern as src/lib/anthropic.ts
// (papermind is browser-only). Two entry points:
//   1) chat()         — conversational; streams nothing yet, returns full text
//   2) generatePulse() — structured per-project read; persisted to life_project_pulse
import type {
  LifeProject,
  LifeTask,
  LifeProjectPulse,
  LifeAgentMessage,
  LifeJournalEntry,
  LifeUser,
  TimeBlockKind,
} from '../types'

const MODEL = 'gpt-4o'

async function callOpenAI(opts: {
  system?: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  max_tokens?: number
}): Promise<string> {
  const key = import.meta.env.OPENAI_KEY
  if (!key) throw new Error('OPENAI_KEY not set in .env')
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })

  const msgs = opts.system
    ? [{ role: 'system' as const, content: opts.system }, ...opts.messages]
    : opts.messages

  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: opts.max_tokens ?? 2048,
    messages: msgs,
  })
  return res.choices[0]?.message?.content ?? ''
}

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const m = text.match(/[\[{][\s\S]*[\]}]/)
  return m ? m[0] : text
}

// ──────────────────────────────────────────────────────────────────────
// System prompts
// ──────────────────────────────────────────────────────────────────────

const GLOBAL_SYSTEM = `You are the user's Life copilot inside an app called knowledge.ai → Life.

Your job is to help them gain control of their life: office work (11–8 IST WFH), personal projects, health, learning, and daily execution. You are NOT a generic chatbot. You are direct, concrete, and you push them toward action.

Rules:
- Be brief by default. Long answers only when synthesis is needed.
- Always end with one concrete next step they can do in the next 30 minutes.
- When you see a project, ask "what's missing" before "what's next".
- Never invent project names, tasks, or facts that aren't in the context. If unsure, say so.
- Treat the user's time as expensive. Don't ask clarifying questions you can answer from context.`

function projectSystemPrompt(project: LifeProject): string {
  return `${GLOBAL_SYSTEM}

You are currently focused on ONE project:
- Name: ${project.name}
- Category: ${project.category}
- Status: ${project.status}
- Health: ${project.health}
- Description: ${project.description ?? '(none)'}
- Context: ${JSON.stringify(project.context ?? {})}

When the user asks about "this project", they mean the one above.`
}

// ──────────────────────────────────────────────────────────────────────
// Conversational chat
// ──────────────────────────────────────────────────────────────────────

export async function chat(input: {
  project?: LifeProject | null
  history: LifeAgentMessage[]
  userMessage: string
  recentTasks?: LifeTask[]
  recentJournal?: LifeJournalEntry[]
}): Promise<string> {
  const sys = input.project ? projectSystemPrompt(input.project) : GLOBAL_SYSTEM

  const contextBlocks: string[] = []
  if (input.recentTasks && input.recentTasks.length > 0) {
    contextBlocks.push(
      'Recent tasks:\n' +
        input.recentTasks
          .slice(0, 15)
          .map(
            (t) =>
              `- [${t.status}] ${t.title}${t.scheduled_for ? ` (for ${t.scheduled_for})` : ''}`
          )
          .join('\n')
    )
  }
  if (input.recentJournal && input.recentJournal.length > 0) {
    contextBlocks.push(
      'Recent journal entries:\n' +
        input.recentJournal
          .slice(0, 5)
          .map((j) => `- ${j.date}: ${(j.summary ?? '').slice(0, 200)}`)
          .join('\n')
    )
  }

  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
  if (contextBlocks.length > 0) {
    messages.push({ role: 'system', content: contextBlocks.join('\n\n') })
  }
  for (const m of input.history.slice(-20)) {
    if (m.role === 'system') continue
    messages.push({ role: m.role, content: m.content })
  }
  messages.push({ role: 'user', content: input.userMessage })

  return callOpenAI({ system: sys, messages })
}

// ──────────────────────────────────────────────────────────────────────
// Project pulse — structured read on a project
// ──────────────────────────────────────────────────────────────────────

export interface PulseDraft {
  last_progress: string
  next_step: string
  whats_missing: string
  risk: string
  health: 'green' | 'yellow' | 'red'
  suggested_tasks: Array<{ title: string; estimate_min?: number; priority?: number }>
}

export async function generatePulse(input: {
  project: LifeProject
  recentTasks: LifeTask[]
  recentPulses: LifeProjectPulse[]
  recentJournal: LifeJournalEntry[]
}): Promise<PulseDraft> {
  const tasksBlock = input.recentTasks
    .slice(0, 30)
    .map(
      (t) =>
        `- [${t.status}] ${t.title}${t.scheduled_for ? ` (${t.scheduled_for})` : ''}${
          t.notes ? ` — ${t.notes.slice(0, 120)}` : ''
        }`
    )
    .join('\n')

  const lastPulse = input.recentPulses[0]
  const lastPulseBlock = lastPulse
    ? `Last pulse (${lastPulse.created_at}):
- Progress: ${lastPulse.last_progress ?? '(none)'}
- Next step then: ${lastPulse.next_step ?? '(none)'}
- Missing then: ${lastPulse.whats_missing ?? '(none)'}`
    : 'No prior pulses.'

  const journalBlock = input.recentJournal
    .slice(0, 5)
    .map((j) => `- ${j.date}: ${(j.summary ?? '').slice(0, 200)}`)
    .join('\n')

  const text = await callOpenAI({
    max_tokens: 1500,
    system: `You are a project monitor. Read the data and produce a STRUCTURED, honest read on this project. You are not trying to be encouraging — you are trying to be useful. Be concrete. Name specific blockers.`,
    messages: [
      {
        role: 'user',
        content: `Project: ${input.project.name}
Category: ${input.project.category}
Description: ${input.project.description ?? '(none)'}

Tasks (most recent first):
${tasksBlock || '(no tasks yet)'}

${lastPulseBlock}

Recent journal mentions:
${journalBlock || '(none)'}

Return ONLY a JSON object with these fields:
{
  "last_progress": "what actually moved since the last pulse (1-2 sentences). If nothing, say so plainly.",
  "next_step": "the SINGLE most important next action — concrete enough to start in 30 minutes",
  "whats_missing": "what is required for this project to move forward that does NOT yet exist (decision, asset, info, person)",
  "risk": "the most likely reason this project stalls in the next 7 days",
  "health": "green | yellow | red — your honest assessment",
  "suggested_tasks": [
    { "title": "...", "estimate_min": 30, "priority": 2 }
  ]
}

Suggest 1-3 tasks max. priority 1 = highest, 5 = lowest.`,
      },
    ],
  })

  const json = extractJSON(text)
  try {
    const parsed = JSON.parse(json) as PulseDraft
    return {
      last_progress: parsed.last_progress ?? '',
      next_step: parsed.next_step ?? '',
      whats_missing: parsed.whats_missing ?? '',
      risk: parsed.risk ?? '',
      health: (parsed.health ?? 'green') as 'green' | 'yellow' | 'red',
      suggested_tasks: Array.isArray(parsed.suggested_tasks) ? parsed.suggested_tasks : [],
    }
  } catch {
    throw new Error('Agent returned a pulse that could not be parsed as JSON.')
  }
}

// ──────────────────────────────────────────────────────────────────────
// Plan my day — produce a structured time-blocked plan
// ──────────────────────────────────────────────────────────────────────

export interface PlannedBlock {
  start_minute: number
  end_minute: number
  label: string
  kind: TimeBlockKind
  task_title?: string
}

export async function planDay(input: {
  user: LifeUser
  openTasks: LifeTask[]
  yesterdayJournal: LifeJournalEntry | null
}): Promise<PlannedBlock[]> {
  const tasks = input.openTasks
    .slice(0, 25)
    .map((t) => `- (P${t.priority}) ${t.title}${t.estimate_min ? ` [${t.estimate_min}m]` : ''}`)
    .join('\n')

  const text = await callOpenAI({
    max_tokens: 1500,
    system: `You are a calendar planner. The user works WFH ${input.user.work_start_hour}:00–${input.user.work_end_hour}:00 in ${input.user.timezone}. They also work on personal projects in the evening (after ${input.user.work_end_hour}:00) until their EOD at ${input.user.eod_hour}:00. Build a realistic day plan. Don't pack every minute. Include short breaks. Be honest about what fits.`,
    messages: [
      {
        role: 'user',
        content: `Open tasks (most important first):
${tasks || '(no open tasks)'}

Yesterday's journal: ${
          input.yesterdayJournal?.summary?.slice(0, 400) ?? '(none)'
        }

Yesterday's plan for today: ${input.yesterdayJournal?.tomorrow ?? '(none)'}

Return ONLY a JSON array of blocks. Each block:
{
  "start_minute": 660,    // minutes since local midnight (e.g. 660 = 11:00)
  "end_minute": 720,
  "label": "short label",
  "kind": "office | deep | learn | admin | break",
  "task_title": "optional — if this block executes a specific task, copy its title exactly"
}

Rules:
- Office work blocks (kind: office or deep) only between ${input.user.work_start_hour}:00 and ${input.user.work_end_hour}:00.
- Personal/learning blocks after ${input.user.work_end_hour}:00 and before ${input.user.eod_hour}:00.
- Use 30–90 minute blocks. Include at least one break.
- Don't return more than 8 blocks.

JSON array only.`,
      },
    ],
  })

  const json = extractJSON(text)
  try {
    const arr = JSON.parse(json) as PlannedBlock[]
    return Array.isArray(arr)
      ? arr.filter(
          (b) =>
            typeof b.start_minute === 'number' &&
            typeof b.end_minute === 'number' &&
            b.end_minute > b.start_minute &&
            typeof b.label === 'string'
        )
      : []
  } catch {
    throw new Error('Planner returned data that could not be parsed.')
  }
}

// ──────────────────────────────────────────────────────────────────────
// Weekly review synthesis
// ──────────────────────────────────────────────────────────────────────

export async function weeklySynthesis(input: {
  fromDate: string
  toDate: string
  journals: LifeJournalEntry[]
  pulses: LifeProjectPulse[]
  doneCount: number
  openCount: number
}): Promise<string> {
  const journalsBlock = input.journals
    .map(
      (j) =>
        `[${j.date}] ${(j.summary ?? '').slice(0, 200)}${
          j.wins ? ` | wins: ${j.wins.slice(0, 100)}` : ''
        }${j.blockers ? ` | blockers: ${j.blockers.slice(0, 100)}` : ''}`
    )
    .join('\n')

  const pulsesBlock = input.pulses
    .map(
      (p) =>
        `[${p.created_at.slice(0, 10)}] health=${p.health} | next=${(p.next_step ?? '').slice(0, 120)} | risk=${(p.risk ?? '').slice(0, 100)}`
    )
    .join('\n')

  return callOpenAI({
    max_tokens: 1000,
    system: `You are reviewing the user's week. Be honest and direct. No platitudes. Find the pattern they can't see. End with one specific change for next week.`,
    messages: [
      {
        role: 'user',
        content: `Period: ${input.fromDate} → ${input.toDate}
Tasks done: ${input.doneCount}
Tasks still open: ${input.openCount}

Journals:
${journalsBlock || '(none)'}

Project pulses:
${pulsesBlock || '(none)'}

Write a short review (≤220 words):
1. The pattern — what does the data actually say about how this week went?
2. The blocker — what's the one thing that kept showing up?
3. Next week — one concrete behavior change.
Use plain prose. No bullet points.`,
      },
    ],
  })
}
