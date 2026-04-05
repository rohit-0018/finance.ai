export type ReadStatus = 'unread' | 'reading' | 'done'
export type NoteType = 'note' | 'insight' | 'question' | 'highlight'
export type PaperSource = 'arXiv' | 'SSRN' | 'HuggingFace' | 'NeurIPS' | 'ICML' | 'ICLR' | 'RSS' | string

export interface User {
  id: string
  username: string
  password: string
  is_admin: boolean
  display_name: string | null
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
  added_by: string | null
  approved: boolean
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
}

export type NavigationPage = 'feed' | 'reader' | 'saved' | 'notes' | 'feeds' | 'settings'

export interface RawRSSItem {
  title: string
  link: string
  abstract: string
  authors: string
  pubDate: string
  externalId: string
}
