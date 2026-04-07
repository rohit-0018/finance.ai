// One-shot paragraph → tasks extractor for the Todos page.
//
// This intentionally does NOT go through the brainstorm agent. Brainstorm
// runs a scripted goal → constraints → decomposition → schedule interview,
// which is overkill (and annoying) when the user just wants to dump a
// paragraph and get a list of todos out.
//
// Contract:
//   - Input: arbitrary text (paragraph, list, mixed).
//   - Output: a flat-or-nested list of tasks with title + optional metadata.
//   - One OpenAI call. JSON-mode response. Throws on any failure (caller is
//     responsible for surfacing the error AND preserving the user's input
//     so nothing is lost).
import type { TaskStatus } from '../types'

const MODEL = 'gpt-4o-mini'

export interface ExtractedSubtask {
  title: string
  notes?: string
  scheduled_for?: string | null
  estimate_min?: number | null
  priority?: number
  tags?: string[]
}

export interface ExtractedTask extends ExtractedSubtask {
  subtasks?: ExtractedSubtask[]
}

export interface ExtractParagraphInput {
  paragraph: string
  /** Today in the user's local timezone (YYYY-MM-DD) — used to resolve "tomorrow", "next week" etc. */
  todayLocalDate: string
  /** Optional timezone hint for the model. */
  timezone?: string
}

interface RawResponse {
  tasks?: unknown
}

const SYSTEM_PROMPT = `You convert a paragraph or list into a clean array of todos.

Rules:
- Return ONLY a JSON object: { "tasks": [...] }.
- Each task has: title (required, short imperative), notes (optional, only if the user wrote real detail — never invent), scheduled_for (YYYY-MM-DD, optional), estimate_min (integer minutes, optional), priority (1=highest..5=lowest, optional), tags (optional array of short lowercase keywords like ["work","urgent"] inferred from context), subtasks (optional array of the same shape, no nesting beyond one level).
- Do NOT make up dates, estimates, or priorities. Only set them if the user clearly implied them.
- Resolve relative dates ("today", "tomorrow", "next monday") against the provided TODAY date.
- Preserve the user's wording in titles. Don't editorialize.
- If the user wrote one big task with multiple steps, model it as a parent task with subtasks.
- If the input is just a flat list of independent things, return them as flat tasks (no subtasks).
- Never ask follow-up questions. Never include explanatory prose. JSON only.`

export async function extractTasksFromParagraph(
  input: ExtractParagraphInput
): Promise<ExtractedTask[]> {
  const text = input.paragraph.trim()
  if (!text) return []

  const key = import.meta.env.OPENAI_KEY
  if (!key) {
    throw new Error('OPENAI_KEY is not set in .env — cannot extract tasks.')
  }

  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })

  const userMessage = `TODAY: ${input.todayLocalDate}${
    input.timezone ? ` (${input.timezone})` : ''
  }\n\nPARAGRAPH:\n${text}`

  let raw: string
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    })
    raw = res.choices[0]?.message?.content ?? ''
  } catch (err) {
    throw new Error(`OpenAI request failed: ${(err as Error).message}`)
  }

  if (!raw) throw new Error('OpenAI returned an empty response.')

  let parsed: RawResponse
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Could not parse extractor response as JSON.')
  }

  if (!Array.isArray(parsed.tasks)) {
    throw new Error('Extractor response missing a "tasks" array.')
  }

  const tasks = parsed.tasks
    .map(normalizeTask)
    .filter((t): t is ExtractedTask => t !== null)

  if (tasks.length === 0) {
    throw new Error('Extractor returned zero usable tasks. Try rewording the paragraph.')
  }

  return tasks
}

function normalizeTask(raw: unknown): ExtractedTask | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  if (!title) return null

  const subRaw = Array.isArray(obj.subtasks) ? obj.subtasks : undefined
  const subtasks = subRaw
    ?.map((s) => normalizeTask(s))
    .filter((s): s is ExtractedTask => s !== null)
    .map((s) => ({ ...s, subtasks: undefined })) // flatten — only one level

  return {
    title,
    notes: typeof obj.notes === 'string' && obj.notes.trim() ? obj.notes.trim() : undefined,
    scheduled_for: normalizeDate(obj.scheduled_for),
    estimate_min: normalizeMinutes(obj.estimate_min),
    priority: normalizePriority(obj.priority),
    tags: normalizeTags(obj.tags),
    subtasks: subtasks && subtasks.length > 0 ? subtasks : undefined,
  }
}

function normalizeTags(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const t of v) {
    if (typeof t !== 'string') continue
    const cleaned = t.trim().toLowerCase().replace(/^#/, '')
    if (cleaned && cleaned.length <= 32) out.push(cleaned)
  }
  return out.length > 0 ? Array.from(new Set(out)) : undefined
}

function normalizeDate(v: unknown): string | null | undefined {
  if (v == null) return undefined
  if (typeof v !== 'string') return undefined
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return undefined
  return v
}

function normalizeMinutes(v: unknown): number | null | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 24 * 60 * 30) return undefined
  return Math.round(n)
}

function normalizePriority(v: unknown): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  if (n < 1 || n > 5) return undefined
  return Math.round(n)
}

// Re-exported for callers that want to type the result alongside DB rows.
export type { TaskStatus }
