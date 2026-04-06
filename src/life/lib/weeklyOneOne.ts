// Weekly AI 1:1 — the scripted interview that forces reflection. Runs as
// five fixed questions in sequence:
//   1. Walk me through last week in 3 sentences.
//   2. Where did you lie to yourself?
//   3. What's the one thing that kept showing up?
//   4. What should change for next week?
//   5. What's the single commitment for the next 7 days?
//
// Answers are persisted into a journal entry (as a special summary) and the
// agent writes back a one-paragraph synthesis at the end.
import type { LifeUser } from '../types'

const MODEL = 'gpt-4o'

export const WEEKLY_ONEONE_QUESTIONS: Array<{ id: string; question: string }> = [
  { id: 'walk_through', question: 'Walk me through your last week in 3 sentences.' },
  { id: 'lies', question: 'Where did you lie to yourself this week?' },
  { id: 'pattern', question: 'What kept showing up — in a good way or a bad way?' },
  { id: 'change', question: 'What should change for next week?' },
  { id: 'commitment', question: 'Single most important commitment for the next 7 days?' },
]

export async function synthesizeOneOne(
  _user: LifeUser,
  answers: Record<string, string>
): Promise<string> {
  const key = import.meta.env.OPENAI_KEY
  if (!key) throw new Error('OPENAI_KEY not set')
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })
  const system = `You are the user's weekly 1:1 partner. You just finished interviewing them with 5 questions. Write a single paragraph (≤150 words) that:
- Names the honest pattern you see across all five answers.
- Flags one contradiction or blind spot, if any.
- Restates their commitment for the week so it feels real.

No platitudes. No "great job." Be their useful friend, not a cheerleader.`
  const body = WEEKLY_ONEONE_QUESTIONS.map(
    (q) => `${q.question}\n  → ${answers[q.id] ?? '(no answer)'}`
  ).join('\n\n')
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 400,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: body },
    ],
  })
  return res.choices[0]?.message?.content ?? ''
}
