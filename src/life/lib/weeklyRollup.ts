// Weekly rollup — the Friday "here's what I shipped / what I'm doing / what's
// next" draft the user can send to their manager. Built from done tasks and
// open tasks in the work workspace, plus any journal highlights from the
// week. Agent rewrites them into 4-6 crisp bullets.
import type { LifeTask, LifeJournalEntry, LifeUser } from '../types'

const MODEL = 'gpt-4o'

async function callOpenAI(system: string, user: string): Promise<string> {
  const key = import.meta.env.OPENAI_KEY
  if (!key) throw new Error('OPENAI_KEY not set')
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 900,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
  return res.choices[0]?.message?.content ?? ''
}

export interface WeeklyRollupInput {
  user: LifeUser
  fromDate: string
  toDate: string
  doneTasks: LifeTask[]
  openTasks: LifeTask[]
  journals: LifeJournalEntry[]
}

export async function draftWeeklyRollup(input: WeeklyRollupInput): Promise<string> {
  const done = input.doneTasks
    .map((t) => `- ${t.title}${t.notes ? ` — ${t.notes.slice(0, 120)}` : ''}`)
    .join('\n')
  const open = input.openTasks
    .map((t) => `- ${t.title}${t.due_at ? ` (due ${t.due_at.slice(0, 10)})` : ''}`)
    .join('\n')
  const journals = input.journals
    .map((j) => `[${j.date}] ${(j.summary ?? '').slice(0, 200)}${j.blockers ? ` | blockers: ${j.blockers.slice(0, 120)}` : ''}`)
    .join('\n')

  const system = `You are drafting a weekly status update FROM the user TO their manager. Plain prose, short.

Format:
**This week**
- 3-5 concrete things shipped (merge what's related, don't list trivia)

**Next week**
- 2-4 specific intents (not goals — actions)

**Blockers**
- 0-2 items the manager can help unblock. Omit this section entirely if there are none.

Rules:
- Active voice. No hedging, no corporate speak.
- Each bullet starts with a verb.
- Mention names/tickets/PR numbers only if they appear in the source data.
- Total length: under 180 words.`

  const userPrompt = `Period: ${input.fromDate} → ${input.toDate}

DONE THIS WEEK:
${done || '(nothing logged)'}

OPEN / PLANNED:
${open || '(nothing logged)'}

JOURNAL HIGHLIGHTS:
${journals || '(none)'}

Draft the update.`

  return callOpenAI(system, userPrompt)
}
