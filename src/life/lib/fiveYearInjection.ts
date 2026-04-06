// 5-year default injection — once a week, pick one active 5-year horizon and
// ask the agent to generate ONE tiny, concrete task the user can do this
// week for it. Schedule it on Today with priority 3.
//
// Dedupe: stores a "last injection" memory key so we don't re-inject within
// the same ISO week.
import type { LifeUser, LifeHorizon } from '../types'
import { listHorizons, createTask, upsertMemory, listMemory } from './db'
import { todayLocal } from './time'

const INJECTION_KEY = 'last_5yr_injection'

function isoWeek(date: Date = new Date()): string {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`
}

export async function maybeInjectFiveYearTask(
  user: LifeUser,
  workspaceId: string | null
): Promise<void> {
  // Check last run
  const mem = await listMemory(user.id, null)
  const lastRow = mem.find((m) => m.key === INJECTION_KEY && m.workspace_id === null)
  const thisWeek = isoWeek()
  if (lastRow?.value === thisWeek) return

  const horizons = await listHorizons(user.id, 'five_year')
  const active = horizons.filter((h) => h.status === 'active')
  if (active.length === 0) return

  // Round-robin: pick the one least recently nudged. We just rotate by
  // index based on ISO week for now; Phase 10 can use a per-horizon counter.
  const index = parseInt(thisWeek.split('-W')[1] ?? '0', 10) % active.length
  const target = active[index]

  const task = await generateTask(user, target)
  if (!task) return

  await createTask({
    userId: user.id,
    workspaceId: workspaceId ?? undefined,
    title: task.title,
    notes: `Auto-injected for 5-year goal: ${target.title}`,
    priority: 3,
    estimate_min: task.estimate_min ?? 20,
    scheduled_for: todayLocal(user.timezone),
    when_where: task.when_where ?? null,
    first_action: task.first_action ?? null,
    source: 'agent',
  })

  await upsertMemory({
    userId: user.id,
    workspaceId: null,
    key: INJECTION_KEY,
    value: thisWeek,
    source: 'agent',
  })
}

interface InjectionTask {
  title: string
  estimate_min?: number
  when_where?: string
  first_action?: string
}

async function generateTask(user: LifeUser, horizon: LifeHorizon): Promise<InjectionTask | null> {
  const key = import.meta.env.OPENAI_KEY
  if (!key) return null
  try {
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You generate ONE tiny task (≤30 minutes) that advances a 5-year life bet. Be concrete. The task must be doable this week. Return JSON: { "title": string, "estimate_min": number, "when_where"?: string, "first_action"?: string }.',
        },
        {
          role: 'user',
          content: `5-year goal: ${horizon.title}\nWhy: ${horizon.why ?? '(not specified)'}\nTimezone: ${user.timezone}\n\nGenerate one task.`,
        },
      ],
    })
    const raw = res.choices[0]?.message?.content ?? '{}'
    return JSON.parse(raw) as InjectionTask
  } catch {
    return null
  }
}
