import { z } from 'zod'
import type { Paper, PaperDigest, NoteType } from '../types'

const MODEL = 'gpt-4o'

// Call OpenAI via server-side proxy (/api/openai) to keep the key secure.
// Falls back to direct client call if VITE_OPENAI_KEY is set (local dev only).
async function callOpenAI(opts: {
  model?: string
  max_tokens?: number
  system?: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}): Promise<string> {
  const clientKey = import.meta.env.VITE_OPENAI_KEY

  if (clientKey) {
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey: clientKey, dangerouslyAllowBrowser: true })
    const msgs = opts.system
      ? [{ role: 'system' as const, content: opts.system }, ...opts.messages]
      : opts.messages
    const response = await client.chat.completions.create({
      model: opts.model ?? MODEL,
      max_tokens: opts.max_tokens ?? 2048,
      messages: msgs,
    })
    return response.choices[0]?.message?.content ?? ''
  }

  const response = await fetch('/api/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model ?? MODEL,
      max_tokens: opts.max_tokens ?? 2048,
      messages: opts.messages,
      system: opts.system,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error((err as { error: string }).error || `API error: ${response.status}`)
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices[0]?.message?.content ?? ''
}

// ---------- Zod Schemas ----------

const PaperSchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.string(),
  year: z.number().int().min(2020).max(2026),
  source: z.enum(['arXiv', 'SSRN', 'HuggingFace', 'NeurIPS', 'ICML', 'ICLR']),
  category: z.string(),
  topic: z.string(),
  abstract: z.string(),
  problem: z.string(),
  method: z.string(),
  finding: z.string(),
  tags: z.array(z.string()).max(6),
  url: z.string().url().optional(),
})

const PapersResponseSchema = z.array(PaperSchema)

const DigestSchema = z.object({
  problem: z.string(),
  method: z.string(),
  finding: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
})

const NotesResponseSchema = z.array(
  z.object({
    content: z.string(),
    note_type: z.enum(['note', 'insight', 'question', 'highlight']),
    highlight: z.string().optional(),
  })
)

// ---------- Helpers ----------

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const bracketMatch = text.match(/[\[{][\s\S]*[\]}]/)
  if (bracketMatch) return bracketMatch[0]
  return text
}

function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>')
}

// ---------- Paper Functions ----------

export async function fetchPapersForTopic(topic: string): Promise<Partial<Paper>[]> {
  const text = await callOpenAI({
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `You are a research paper discovery engine. Return exactly 10 real, recent (2023-2026) academic papers about "${topic}".

Return a JSON array where each object has these fields:
- id: a unique identifier string (use the arXiv ID format like "2401.12345" or make a realistic one)
- title: the paper's full title
- authors: comma-separated author names
- year: publication year (integer)
- source: one of "arXiv", "SSRN", "HuggingFace", "NeurIPS", "ICML", "ICLR"
- category: the specific subcategory (e.g., "cs.AI", "cs.CL", "stat.ML")
- topic: "${topic}"
- abstract: a 2-3 sentence abstract
- problem: one sentence describing the problem addressed
- method: one sentence describing the approach/method
- finding: one sentence describing the key finding/result
- tags: array of 3-5 relevant keyword tags
- url: a plausible URL (optional)

Return ONLY the JSON array, no other text.`,
    }],
  })

  const jsonStr = extractJSON(text)
  let parsed: unknown
  try { parsed = JSON.parse(jsonStr) } catch { throw new Error('Failed to parse OpenAI response as JSON') }

  const result = PapersResponseSchema.safeParse(parsed)
  if (!result.success) {
    console.error('Zod validation errors:', result.error.issues)
    throw new Error(`Invalid paper data: ${result.error.issues.map((i) => i.message).join(', ')}`)
  }

  return result.data.map((p) => ({
    external_id: p.id, title: p.title, authors: p.authors, year: p.year,
    source: p.source, category: p.category, topic: p.topic, abstract: p.abstract,
    problem: p.problem, method: p.method, finding: p.finding, tags: p.tags, url: p.url ?? null,
  }))
}

export async function generateDigest(title: string, abstract: string): Promise<PaperDigest> {
  const text = await callOpenAI({
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Analyze this research paper and return a JSON object with:
- problem: one sentence describing the problem addressed
- method: one sentence describing the approach/method
- finding: one sentence describing the key finding
- category: the paper's category (e.g., "cs.AI", "NLP", "Computer Vision")
- tags: array of 3-5 keyword tags

Paper title: "${title}"
Abstract: "${abstract}"

Return ONLY the JSON object, no other text.`,
    }],
  })

  const jsonStr = extractJSON(text)
  let parsed: unknown
  try { parsed = JSON.parse(jsonStr) } catch { throw new Error('Failed to parse digest response') }

  const result = DigestSchema.safeParse(parsed)
  if (!result.success) throw new Error(`Invalid digest: ${result.error.issues.map((i) => i.message).join(', ')}`)
  return result.data
}

export async function autoExtractNotes(
  paper: Paper
): Promise<Array<{ content: string; note_type: NoteType; highlight?: string }>> {
  const context = [
    paper.title, paper.abstract,
    paper.problem ? `Problem: ${paper.problem}` : '',
    paper.method ? `Method: ${paper.method}` : '',
    paper.finding ? `Finding: ${paper.finding}` : '',
  ].filter(Boolean).join('\n\n')

  const text = await callOpenAI({
    messages: [{
      role: 'user',
      content: `Extract 4-6 research notes from this paper. Return a JSON array where each object has:
- content: the note text (1-2 sentences)
- note_type: one of "note", "insight", "question", "highlight"
- highlight: (optional) a direct quote or key phrase from the text

Paper context:
${context}

Return ONLY the JSON array, no other text.`,
    }],
  })

  const jsonStr = extractJSON(text)
  let parsed: unknown
  try { parsed = JSON.parse(jsonStr) } catch { throw new Error('Failed to parse notes response') }

  const result = NotesResponseSchema.safeParse(parsed)
  if (!result.success) throw new Error(`Invalid notes: ${result.error.issues.map((i) => i.message).join(', ')}`)
  return result.data
}

// ---------- Chat ----------

export async function claudeChat(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const text = await callOpenAI({ system: systemPrompt, messages })
  return formatMarkdown(text)
}

// ---------- Article Functions ----------

export async function summarizeArticle(
  title: string,
  content: string
): Promise<{ summary: string; topic: string; tags: string[] }> {
  const trimmed = content.slice(0, 8000)
  const text = await callOpenAI({
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Analyze this article and return a JSON object with:
- summary: a 2-3 sentence summary
- topic: the main topic category (e.g., "AI", "Machine Learning", "System Design", "Technology", "Science")
- tags: array of 3-5 keyword tags

Title: "${title}"
Content: "${trimmed}"

Return ONLY the JSON object, no other text.`,
    }],
  })

  const jsonStr = extractJSON(text)
  return JSON.parse(jsonStr) as { summary: string; topic: string; tags: string[] }
}

export async function generateDailyBrief(
  topics: string[],
  recentPapers: Array<{ title: string; finding: string | null; topic: string }>
): Promise<string> {
  const paperList = recentPapers
    .slice(0, 20)
    .map((p, i) => `${i + 1}. [${p.topic}] "${p.title}" — ${p.finding ?? 'No summary'}`)
    .join('\n')

  const text = await callOpenAI({
    messages: [{
      role: 'user',
      content: `You are a research briefing assistant. The user follows these topics: ${topics.join(', ')}.

Here are recent papers and articles:
${paperList}

Write a personalized daily brief that:
1. Highlights the most important developments in their interest areas
2. Draws connections between papers where relevant
3. Suggests what to read first and why
4. Notes any emerging trends

Keep it concise and actionable. Use markdown formatting with **bold** for key terms and bullet points.`,
    }],
  })

  return formatMarkdown(text)
}

export async function articleChat(
  article: { title: string; content: string; summary: string | null },
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const trimmedContent = article.content.slice(0, 6000)
  const text = await callOpenAI({
    system: `You are a knowledge assistant. Help the user understand this article.

Title: "${article.title}"
Summary: ${article.summary ?? 'Not available'}
Content: ${trimmedContent}

Answer questions concisely and accurately. Use markdown formatting.`,
    messages,
  })
  return formatMarkdown(text)
}
