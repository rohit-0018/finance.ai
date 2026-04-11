export type ReadStatus = 'unread' | 'reading' | 'done'
export type NoteType = 'note' | 'insight' | 'question' | 'highlight'
export type PaperSource = 'arXiv' | 'SSRN' | 'HuggingFace' | 'NeurIPS' | 'ICML' | 'ICLR' | 'RSS' | 'Article' | string

export interface UserPreferences {
  nav_hidden?: string[]
}

export interface User {
  id: string
  username: string
  password: string
  is_admin: boolean
  blocked: boolean
  display_name: string | null
  preferences?: UserPreferences
  created_at: string
}

export interface Paper {
  id: string
  external_id: string
  title: string
  authors: string | null
  year: number | null
  source: PaperSource
  category: string | null
  topic: string
  abstract: string | null
  problem: string | null
  method: string | null
  finding: string | null
  tags: string[]
  url: string | null
  feed_id: string | null
  analysis: DeepAnalysis | null
  added_by: string | null
  approved: boolean
  marked_for_reading?: boolean
  fetched_at: string
  created_at: string
}

export interface SavedPaper {
  id: string
  user_id: string
  paper_id: string
  read_status: ReadStatus
  saved_at: string
  paper: Paper
}

export interface Note {
  id: string
  user_id: string
  paper_id: string
  content: string
  highlight: string | null
  note_type: NoteType
  created_at: string
  updated_at: string
  paper?: Pick<Paper, 'id' | 'title' | 'topic' | 'source'>
}

export interface QAMessage {
  id?: string
  user_id?: string
  paper_id: string
  role: 'user' | 'assistant'
  content: string
  created_at?: string
}

export interface RSSFeed {
  id: string
  name: string
  url: string
  topic: string
  color: string
  active: boolean
  approved: boolean
  added_by: string | null
  last_fetched_at: string | null
  created_at: string
}

export type ArticleType =
  | 'research'
  | 'tutorial'
  | 'news'
  | 'opinion'
  | 'product'
  | 'guide'
  | 'analysis'
  | 'story'
  | 'other'

export type ConceptTier = 'foundational' | 'intermediate' | 'implementation' | 'expert'

export interface ExtractedConcept {
  name: string
  tier: ConceptTier
  oneLiner: string            // plain-language definition in one sentence
  deepDive: string            // 2-5 sentences with mechanism/why-it-matters
  analogy?: string            // optional mental model anchor
  prerequisites?: string[]    // concept names that should be known first
  relatedConcepts?: string[]  // adjacent concepts in this article
  example?: string            // concrete real-world example from article
}

export interface Tradeoff {
  decision: string            // the decision being made
  optionA: string
  optionB: string
  axis: string                // what's being traded (e.g. "reliability vs flexibility")
  whenA: string               // when to pick A
  whenB: string               // when to pick B
}

export interface MentalModel {
  name: string
  intuition: string           // the core metaphor / "think of it as..."
  whyItHelps: string          // what misunderstanding it prevents
}

export interface ArchitectureFlow {
  name: string                // e.g. "RAG pipeline"
  steps: string[]             // ordered steps, each a short phrase
  purpose: string             // what this flow achieves
}

export interface ExpertRule {
  rule: string                // "Don't use X for Y"
  reason: string              // why
  example?: string            // real-world example
}

export interface DeepAnalysis {
  // Universal (always present after deep extract)
  articleType?: ArticleType
  hook?: string
  tldr?: string
  longSummary?: string          // 6-10 paragraph comprehensive cream-of-the-article
  keyPoints?: string[]          // 8-15 bullet "every important idea" points
  takeaways?: string[]          // actionable so-what bullets
  keyNumbers?: string[]         // notable stats/figures with context
  quotes?: string[]             // notable direct quotes from article
  glossary?: Array<{ term: string; definition: string }>

  // Research-paper specific (only when applicable)
  coreProblem?: string
  proposedSolution?: string
  evidence?: string
  implications?: string
  limitations?: string
  fieldContext?: string

  // System-design / expert layer (populated when article is technical)
  concepts?: ExtractedConcept[]
  principles?: string[]           // durable laws/heuristics from the article
  tradeoffs?: Tradeoff[]          // structured design decisions
  hiddenCosts?: string[]          // gotchas a first-time reader would miss
  commonMistakes?: string[]       // things practitioners typically get wrong
  whenToUse?: string[]            // bullet list of "good fit" conditions
  whenNotToUse?: string[]         // bullet list of "bad fit" conditions
  mentalModels?: MentalModel[]
  architectureFlows?: ArchitectureFlow[]
  expertJudgment?: ExpertRule[]   // "it depends" wisdom
  failureModes?: Array<{ mode: string; mitigation: string }>
  prerequisiteMap?: string[]      // concepts reader should know first
  furtherReading?: Array<{ title: string; why: string }>
  estimatedReadMinutes?: number

  // Critical signals
  noveltySignals?: string[]
  hedgingSignals?: string[]
  cherryPickRisks?: string[]
  readingMode?: 'researcher' | 'practitioner' | 'layperson'
}

export interface Uploader {
  id: string
  display_name: string | null
  username: string
  is_admin: boolean
}

export interface Article {
  id: string
  url: string
  title: string
  content: string
  summary: string | null
  topic: string
  tags: string[]
  analysis: DeepAnalysis | null
  added_by: string | null
  is_private: boolean
  approved: boolean
  marked_for_reading?: boolean
  archived?: boolean
  created_at: string
  uploader?: Uploader | null
}

export interface UserTopic {
  id: string
  user_id: string
  topic: string
  rating: number
  created_at: string
}

export interface DailyBrief {
  id: string
  user_id: string
  content: string
  topics: string[]
  paper_count: number
  read: boolean
  created_at: string
}

export interface PaperDigest {
  problem: string
  method: string
  finding: string
  category: string
  tags: string[]
}

export interface AppStats {
  totalPapers: number
  savedPapers: number
  totalNotes: number
  topicsFollowed: number
  articlesRead: number
  streak: number
}

export type NavigationPage = 'feed' | 'reader' | 'saved' | 'notes' | 'feeds' | 'interests' | 'settings'

export interface RawRSSItem {
  title: string
  link: string
  abstract: string
  authors: string
  pubDate: string
  externalId: string
}
