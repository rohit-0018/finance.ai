import { z } from 'zod'
import type { Paper, PaperDigest, NoteType } from '../types'

const MODEL = 'gpt-4o'

async function callOpenAI(opts: {
  model?: string
  max_tokens?: number
  system?: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}): Promise<string> {
  const key = import.meta.env.OPENAI_KEY
  if (!key) throw new Error('OPENAI_KEY is not set in .env')

  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })

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
  recentPapers: Array<{ title: string; finding: string | null; topic: string; problem: string | null; method: string | null; abstract: string | null }>,
  onProgress?: (step: string) => void
): Promise<string> {
  const sources = recentPapers
    .slice(0, 25)
    .map((p, i) => {
      const parts = [`--- SOURCE ${i + 1}: "${p.title}" | type: paper | topic: ${p.topic}`]
      if (p.problem) parts.push(`Problem: ${p.problem}`)
      if (p.method) parts.push(`Method: ${p.method}`)
      if (p.finding) parts.push(`Key finding: ${p.finding}`)
      if (p.abstract) parts.push(`Abstract: ${p.abstract.slice(0, 300)}`)
      parts.push('---')
      return parts.join('\n')
    })
    .join('\n\n')

  // Pass 1: Internal reasoning — structured analysis (hidden chain-of-thought)
  onProgress?.('Pass 1/3: Cross-source analysis...')
  const analysisText = await callOpenAI({
    max_tokens: 2000,
    system: `You are a senior research analyst. Your job is NOT to summarize. Your job is to synthesize — find the signal in the noise, surface tensions, and reveal what matters.`,
    messages: [{
      role: 'user',
      content: `You have ${recentPapers.length} sources on these topics: ${topics.join(', ')}.

${sources}

Before writing anything public, do your internal analysis. Return structured JSON:

{
  "central_thread": "The single narrative connecting the most important sources",
  "agreements": ["Claims/directions multiple sources converge on"],
  "tensions": ["Where sources conflict, diverge, or reveal unresolved debates"],
  "surprises": ["What a sharp reader familiar with this field would NOT expect"],
  "llm_context_additions": ["What your training knowledge adds that none of the sources say — field history, key debates, recent developments not in these papers"],
  "strongest_implication": "The single most important so-what for a practitioner"
}

Return ONLY the JSON.`,
    }],
  })

  let analysis: {
    central_thread: string; agreements: string[]; tensions: string[];
    surprises: string[]; llm_context_additions: string[]; strongest_implication: string;
  }
  try {
    analysis = JSON.parse(extractJSON(analysisText))
  } catch {
    // If analysis parse fails, proceed with empty analysis
    analysis = { central_thread: '', agreements: [], tensions: [], surprises: [], llm_context_additions: [], strongest_implication: '' }
  }

  // Pass 2: Write the brief — Economist voice, flowing paragraphs
  onProgress?.('Pass 2/3: Writing editorial brief...')
  const draftText = await callOpenAI({
    max_tokens: 3000,
    system: `You are a senior research analyst and editor writing a daily intelligence brief.

Your job is NOT to summarize. Summaries are for people who don't have time to read. Your job is to do the reading FOR them — at a higher level of understanding than they would reach themselves — and deliver only what matters.

Write with the confidence of The Economist, not the hedging of a chatbot. Flowing paragraphs that build an argument. NO bullet points. NO "this paper explores" passive voice. Every sentence must either advance an argument or add irreplaceable context. If a sentence does neither, cut it.

Do NOT treat each paper as isolated. Weave them together. Find the thread.`,
    messages: [{
      role: 'user',
      content: `Topics: ${topics.join(', ')}

Your internal analysis:
Central thread: ${analysis.central_thread}
Agreements: ${analysis.agreements.join('; ')}
Tensions: ${analysis.tensions.join('; ')}
Surprises: ${analysis.surprises.join('; ')}
Your added context: ${analysis.llm_context_additions.join('; ')}
Strongest implication: ${analysis.strongest_implication}

Sources:
${sources}

Write today's brief. Strict structure:

**OPENING LINE** — One sentence that makes the reader sit up. Not a summary. A provocation, a revelation, or a sharp observation.

**THE SITUATION** — 2-3 paragraphs. What's happening, why now, field context. Weave the sources together — don't list them. Name specific papers only when the name adds value. Use your training knowledge to fill in what the papers assume the reader knows.

**THE TENSION** — 1-2 paragraphs. What's contested, unresolved, or genuinely surprising. Where do these sources disagree? What assumption is being quietly challenged? This is where the real intellectual value lives.

**THE IMPLICATION** — 1 paragraph. What changes for practitioners, researchers, or industry if the central thread of these papers proves right? Be concrete: name a tool, a workflow, a business model that shifts.

**ONE THING TO WATCH** — A single forward-looking sentence. Not a safe prediction. A specific bet on what happens next.

The brief should be readable in 4-5 minutes. Dense with insight. Zero filler. Use **bold** for key terms and paper titles.`,
    }],
  })

  // Pass 3: Self-critique and polish
  onProgress?.('Pass 3/3: Quality gate...')
  const finalText = await callOpenAI({
    max_tokens: 3000,
    system: `You are an editor reviewing a daily intelligence brief. Your standards are ruthless.`,
    messages: [{
      role: 'user',
      content: `Here is a daily brief. Evaluate it on these criteria:

1. SYNTHESIS (0-10): Does it weave sources together or just list them separately?
2. VOICE (0-10): Is it confident and editorial, or hedged and robotic?
3. DENSITY (0-10): Is every sentence earning its place?
4. OPENING (0-10): Does the first sentence make you want the second?
5. IMPLICATION (0-10): Is the "so what" clear and concrete?

For any score below 8, rewrite that section. Then return the complete improved brief. Keep the same structure (OPENING LINE, THE SITUATION, THE TENSION, THE IMPLICATION, ONE THING TO WATCH). Use **bold** for key terms.

If all scores are 8+, return the brief unchanged.

Brief to evaluate:
${draftText}`,
    }],
  })

  onProgress?.('Done!')
  return formatMarkdown(finalText)
}

export async function articleChat(
  article: { title: string; content: string; summary: string | null; analysis?: DeepAnalysis | null },
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const trimmedContent = article.content.slice(0, 6000)
  const analysisContext = article.analysis
    ? `\n\nDeep Analysis Available:\nHook: ${article.analysis.hook}\nCore Problem: ${article.analysis.coreProblem}\nSolution: ${article.analysis.proposedSolution}\nEvidence: ${article.analysis.evidence}\nImplications: ${article.analysis.implications}\nLimitations: ${article.analysis.limitations}`
    : ''

  const text = await callOpenAI({
    system: `You are a deep knowledge assistant. You have full access to this article's content and analysis. Give thorough, insightful answers.

Title: "${article.title}"
Summary: ${article.summary ?? 'Not available'}
Content: ${trimmedContent}${analysisContext}

When answering:
- Distinguish between what the article explicitly states vs your own context/knowledge
- Use [FROM ARTICLE] and [CONTEXT] labels when helpful
- Be specific with evidence and examples
- If asked to drill deeper into a section, give comprehensive detail
- Use markdown formatting.`,
    messages,
  })
  return formatMarkdown(text)
}

// ---------- Deep Multi-Pass Analysis ----------

import type { DeepAnalysis } from '../types'

type ReadingMode = 'researcher' | 'practitioner' | 'layperson'

export async function generateDeepAnalysis(
  title: string,
  content: string,
  mode: ReadingMode = 'researcher',
  onProgress?: (step: string) => void
): Promise<DeepAnalysis> {
  const trimmed = content.slice(0, 12000)

  // Pass 1 — Structural scan + extraction
  onProgress?.('Pass 1/3: Structural scan & extraction...')
  const pass1 = await callOpenAI({
    max_tokens: 3000,
    system: `You are extracting structured information from an article/paper. Extract ONLY what is explicitly stated. Do not infer. Do not add context. Mark any uncertainty with [UNCLEAR].`,
    messages: [{
      role: 'user',
      content: `Read this article carefully and extract the following. Be precise and quote when possible.

Return a JSON object with these fields:
- coreProblem: What specific problem/question does this address? (2-3 sentences, plain language)
- priorApproaches: What did prior work try? Why did it fall short? (2-3 sentences)
- proposedSolution: What is the key idea/method/approach? (2-3 sentences, the "aha" moment)
- evidence: What specific results/numbers/benchmarks are presented? Against what baselines? (2-3 sentences with concrete data)
- authorLimitations: What do the authors themselves say is limited? (1-2 sentences)
- futureWork: What future directions do they suggest? (1 sentence)
- noveltySignals: Array of exact phrases claiming novelty (e.g., "first to show", "state of the art", "to the best of our knowledge")
- hedgingSignals: Array of exact phrases showing caution (e.g., "in some settings", "preliminary results", "may generalize")
- cherryPickRisks: Array of concerns about methodology (e.g., "tested on single dataset", "old baselines", "unusual metrics")

Title: "${title}"
Content: "${trimmed}"

Return ONLY the JSON object.`,
    }],
  })

  let extracted: {
    coreProblem: string; priorApproaches: string; proposedSolution: string;
    evidence: string; authorLimitations: string; futureWork: string;
    noveltySignals: string[]; hedgingSignals: string[]; cherryPickRisks: string[];
  }
  try {
    extracted = JSON.parse(extractJSON(pass1))
  } catch {
    throw new Error('Pass 1 failed: could not parse extraction results')
  }

  // Pass 2 — LLM enrichment layer (context, analogies, implications)
  onProgress?.('Pass 2/3: Adding field context & implications...')
  const pass2 = await callOpenAI({
    max_tokens: 3000,
    system: `You are a research analyst adding expert context. You are given factual extractions from a paper. Your job is to ADD VALUE by providing field context, analogies, real-world implications, and critical perspective. Clearly distinguish your additions from the paper's own claims.`,
    messages: [{
      role: 'user',
      content: `Based on these facts extracted from "${title}":

Core Problem: ${extracted.coreProblem}
Prior Approaches: ${extracted.priorApproaches}
Proposed Solution: ${extracted.proposedSolution}
Evidence: ${extracted.evidence}
Author Limitations: ${extracted.authorLimitations}

The reader's mode is: ${mode === 'researcher' ? 'academic researcher (methodology-focused)' : mode === 'practitioner' ? 'industry practitioner (implications-focused)' : 'curious layperson (accessibility-focused)'}

Return a JSON object with:
- hook: A compelling 2-3 sentence opener explaining why this work exists and why it matters RIGHT NOW. What frustration or failure prompted it? Use your knowledge of the field. (Write for the ${mode} audience)
- solutionAnalogy: An analogy or comparison to something well-known that makes the proposed solution click. (1-2 sentences)
- skepticView: An honest critical assessment: are the results convincing? What should a careful reader watch for? Are baselines fair? Is the evaluation comprehensive? (2-3 sentences)
- implications: Concrete real-world impact. Who specifically benefits? What product, workflow, or industry changes if this gets adopted? Give specific examples, not vague claims. (2-3 sentences)
- deeperLimitations: Beyond what the authors admit — what does the broader field suggest is still unsolved? What assumptions might break in practice? (2-3 sentences)
- fieldMap: Where does this sit relative to well-known prior work? Is it incremental or a new direction? Does it contradict anything mainstream? Help the reader integrate it into their mental model. (2-3 sentences)
- tldr: Exactly 3 sentences: problem → solution → why it matters.

Return ONLY the JSON object.`,
    }],
  })

  let enriched: {
    hook: string; solutionAnalogy: string; skepticView: string;
    implications: string; deeperLimitations: string; fieldMap: string; tldr: string;
  }
  try {
    enriched = JSON.parse(extractJSON(pass2))
  } catch {
    throw new Error('Pass 2 failed: could not parse enrichment results')
  }

  // Pass 3 — Final synthesis (combine into polished sections)
  onProgress?.('Pass 3/3: Synthesizing final analysis...')
  const pass3 = await callOpenAI({
    max_tokens: 3000,
    system: `You are writing the final polished deep-read analysis. Combine the extracted facts and enrichment into cohesive, well-written sections. Use markdown formatting (**bold** for key terms). Each section should flow naturally.

IMPORTANT: In each section, use these inline labels:
- Prefix facts from the article with [PAPER]
- Prefix your added context with [CONTEXT]
This helps the reader know what's sourced vs interpreted.`,
    messages: [{
      role: 'user',
      content: `Combine these into polished final sections:

EXTRACTED FROM PAPER:
Problem: ${extracted.coreProblem}
Prior work: ${extracted.priorApproaches}
Solution: ${extracted.proposedSolution}
Evidence: ${extracted.evidence}
Author limitations: ${extracted.authorLimitations}

LLM ENRICHMENT:
Hook: ${enriched.hook}
Solution analogy: ${enriched.solutionAnalogy}
Skeptic view: ${enriched.skepticView}
Implications: ${enriched.implications}
Deeper limitations: ${enriched.deeperLimitations}
Field map: ${enriched.fieldMap}

Return a JSON object with these final sections (each 2-4 sentences, well-written, using [PAPER] and [CONTEXT] labels):
- hook: The opening hook (why this exists, why now)
- coreProblem: The problem in plain language + what was tried before
- proposedSolution: The key idea + the analogy that makes it click
- evidence: Specific results + honest skeptic's assessment
- implications: Real-world impact with concrete examples
- limitations: Combined author + deeper limitations
- fieldContext: Where it fits on the research map
- tldr: 3 sentences. problem → solution → why it matters. No labels needed here.

Return ONLY the JSON object.`,
    }],
  })

  let final: {
    hook: string; coreProblem: string; proposedSolution: string;
    evidence: string; implications: string; limitations: string;
    fieldContext: string; tldr: string;
  }
  try {
    final = JSON.parse(extractJSON(pass3))
  } catch {
    throw new Error('Pass 3 failed: could not parse final synthesis')
  }

  onProgress?.('Done!')

  return {
    hook: final.hook,
    coreProblem: final.coreProblem,
    proposedSolution: final.proposedSolution,
    evidence: final.evidence,
    implications: final.implications,
    limitations: final.limitations,
    fieldContext: final.fieldContext,
    tldr: final.tldr,
    noveltySignals: extracted.noveltySignals ?? [],
    hedgingSignals: extracted.hedgingSignals ?? [],
    cherryPickRisks: extracted.cherryPickRisks ?? [],
    readingMode: mode,
  }
}
