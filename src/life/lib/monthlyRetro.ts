// Monthly retro — runs on demand or once a month. Reads drops, estimates,
// pulses, journal summaries, and asks the agent to extract 1-3 *lessons*
// worth remembering. Those lessons are written back into life_memory as
// source=agent so they become part of the user's long-term profile.
import type { LifeUser } from '../types'
import {
  listDrops,
  upsertMemory,
  listJournalEntries,
} from './db'
import { planHitRate, estimationTrend, dropsByReason } from './reviewMetrics'

const MODEL = 'gpt-4o'

export interface MonthlyRetroOutput {
  narrative: string
  lessons: string[]
}

export async function runMonthlyRetro(user: LifeUser): Promise<MonthlyRetroOutput> {
  const [drops, journals, hit, est, dropGroups] = await Promise.all([
    listDrops(user.id, { limit: 30 }),
    listJournalEntries(user.id, 30),
    planHitRate(user.id, 30),
    estimationTrend(user.id, 30),
    dropsByReason(user.id, 30),
  ])

  const dropLines = drops
    .slice(0, 20)
    .map((d) => `- [${d.kind}] ${d.title} — ${d.reason.slice(0, 160)}`)
    .join('\n')
  const journalLines = journals
    .slice(0, 10)
    .map((j) => `[${j.date}] ${(j.summary ?? '').slice(0, 180)}`)
    .join('\n')
  const dropHist = dropGroups.map((d) => `- "${d.keyword}" × ${d.count}`).join('\n')

  const system = `You are writing a monthly retrospective for your user. Be honest, concrete, and useful. Extract 1-3 LESSONS — each a single sentence the user should remember for next month. Lessons should be specific to the data, not generic productivity advice.

Return JSON:
{
  "narrative": "one paragraph honest prose, <150 words",
  "lessons": ["single sentence", "single sentence", ...]
}`

  const body = `Plan hit rate (30d): ${hit.shipped}/${hit.totalPlans} = ${(hit.rate * 100).toFixed(0)}%
Estimation multiplier: ${est.multiplier.toFixed(2)} (sample ${est.sample})

DROPS:
${dropLines || '(none)'}

TOP DROP REASONS:
${dropHist || '(none)'}

RECENT JOURNAL SUMMARIES:
${journalLines || '(none)'}`

  const key = import.meta.env.OPENAI_KEY
  if (!key) throw new Error('OPENAI_KEY not set')
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 800,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: body },
    ],
  })
  const raw = res.choices[0]?.message?.content ?? '{}'
  let parsed: MonthlyRetroOutput
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = { narrative: raw, lessons: [] }
  }

  // Persist lessons to memory as source=agent so future brainstorms see them.
  const now = new Date().toISOString().slice(0, 10)
  for (let i = 0; i < (parsed.lessons ?? []).length; i++) {
    const lesson = parsed.lessons[i]
    if (!lesson) continue
    try {
      await upsertMemory({
        userId: user.id,
        workspaceId: null,
        key: `lesson_${now}_${i + 1}`,
        value: lesson,
        source: 'agent',
      })
    } catch {/* ignore */}
  }

  return parsed
}
