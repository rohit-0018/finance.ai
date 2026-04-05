import { createClient } from '@supabase/supabase-js'
import type {
  Paper,
  SavedPaper,
  Note,
  QAMessage,
  RSSFeed,
  ReadStatus,
  NoteType,
  AppStats,
  User,
  Article,
  UserTopic,
  DailyBrief,
} from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// ---------- Auth ----------

export async function dbLogin(username: string, password: string): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .eq('password', password)
    .maybeSingle()

  if (error) throw new Error(`Login failed: ${error.message}`)
  if (!data) throw new Error('Invalid username or password')
  if ((data as User).blocked) throw new Error('Your account has been blocked. Contact admin.')
  return data as User
}

export async function dbCreateUser(opts: {
  username: string
  password: string
  displayName: string
  isAdmin: boolean
}): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .insert({
      username: opts.username,
      password: opts.password,
      is_admin: opts.isAdmin,
      blocked: false,
      display_name: opts.displayName || opts.username,
    })
    .select()
    .single()

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      throw new Error('Username already taken')
    }
    throw new Error(`Failed to create user: ${error.message}`)
  }
  return data as User
}

export async function dbBlockUser(userId: string, blocked: boolean): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ blocked })
    .eq('id', userId)

  if (error) throw new Error(`Failed to update user: ${error.message}`)
}

export async function dbDeleteUser(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', userId)

  if (error) throw new Error(`Failed to delete user: ${error.message}`)
}

export async function dbResetPassword(userId: string, newPassword: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ password: newPassword })
    .eq('id', userId)

  if (error) throw new Error(`Failed to reset password: ${error.message}`)
}

export async function dbGetAllUsers(): Promise<User[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to fetch users: ${error.message}`)
  return (data ?? []) as User[]
}

export async function dbToggleAdmin(userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ is_admin: isAdmin })
    .eq('id', userId)

  if (error) throw new Error(`Failed to update admin status: ${error.message}`)
}

// ---------- Papers (global) ----------

export async function dbSavePapers(papers: Partial<Paper>[], userId?: string): Promise<Paper[]> {
  const rows = papers.map((p) => ({
    external_id: p.external_id ?? crypto.randomUUID(),
    title: p.title ?? 'Untitled',
    authors: p.authors ?? null,
    year: p.year ?? null,
    source: p.source ?? 'arXiv',
    category: p.category ?? null,
    topic: p.topic ?? 'AI',
    abstract: p.abstract ?? null,
    problem: p.problem ?? null,
    method: p.method ?? null,
    finding: p.finding ?? null,
    tags: p.tags ?? [],
    url: p.url ?? null,
    feed_id: p.feed_id ?? null,
    added_by: userId ?? null,
    approved: true,
  }))

  const { data, error } = await supabase
    .from('papers')
    .upsert(rows, { onConflict: 'external_id' })
    .select()

  if (error) throw new Error(`Failed to save papers: ${error.message}`)
  return (data ?? []) as Paper[]
}

export async function dbGetPapers(opts: {
  topic?: string
  limit?: number
  offset?: number
}): Promise<Paper[]> {
  const { topic, limit = 12, offset = 0 } = opts
  let query = supabase
    .from('papers')
    .select('*')
    .eq('approved', true)
    .order('fetched_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (topic && topic !== 'All') {
    query = query.eq('topic', topic)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to fetch papers: ${error.message}`)
  return (data ?? []) as Paper[]
}

export async function dbGetPaper(id: string): Promise<Paper> {
  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw new Error(`Failed to fetch paper: ${error.message}`)
  return data as Paper
}

export async function dbDeletePaper(id: string): Promise<void> {
  const { error } = await supabase.from('papers').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete paper: ${error.message}`)
}

export async function dbGetAllPapersAdmin(): Promise<Paper[]> {
  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .order('fetched_at', { ascending: false })
    .limit(200)

  if (error) throw new Error(`Failed to fetch papers: ${error.message}`)
  return (data ?? []) as Paper[]
}

export async function dbApprovePaper(id: string, approved: boolean): Promise<void> {
  const { error } = await supabase
    .from('papers')
    .update({ approved })
    .eq('id', id)

  if (error) throw new Error(`Failed to update paper approval: ${error.message}`)
}

// ---------- Saved Papers (per user) ----------

export async function dbSavePaper(userId: string, paperId: string): Promise<void> {
  const { error } = await supabase
    .from('saved_papers')
    .upsert({ user_id: userId, paper_id: paperId }, { onConflict: 'user_id,paper_id' })

  if (error) throw new Error(`Failed to save paper: ${error.message}`)
}

export async function dbUnsavePaper(userId: string, paperId: string): Promise<void> {
  const { error } = await supabase
    .from('saved_papers')
    .delete()
    .eq('user_id', userId)
    .eq('paper_id', paperId)

  if (error) throw new Error(`Failed to unsave paper: ${error.message}`)
}

export async function dbGetSavedPapers(userId: string): Promise<SavedPaper[]> {
  const { data, error } = await supabase
    .from('saved_papers')
    .select('*, paper:papers(*)')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch saved papers: ${error.message}`)
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    paper_id: row.paper_id as string,
    read_status: row.read_status as ReadStatus,
    saved_at: row.saved_at as string,
    paper: row.paper as Paper,
  }))
}

export async function dbUpdateReadStatus(
  userId: string,
  paperId: string,
  status: ReadStatus
): Promise<void> {
  const { error } = await supabase
    .from('saved_papers')
    .update({ read_status: status })
    .eq('user_id', userId)
    .eq('paper_id', paperId)

  if (error) throw new Error(`Failed to update read status: ${error.message}`)
}

// ---------- Notes (per user) ----------

export async function dbSaveNote(opts: {
  userId: string
  paperId: string
  content: string
  highlight?: string
  noteType: NoteType
}): Promise<Note> {
  const { data, error } = await supabase
    .from('notes')
    .insert({
      user_id: opts.userId,
      paper_id: opts.paperId,
      content: opts.content,
      highlight: opts.highlight ?? null,
      note_type: opts.noteType,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to save note: ${error.message}`)
  return data as Note
}

export async function dbGetNotes(userId: string, paperId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .eq('paper_id', paperId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch notes: ${error.message}`)
  return (data ?? []) as Note[]
}

export async function dbGetAllNotes(userId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*, paper:papers(id, title, topic, source)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch all notes: ${error.message}`)
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    paper_id: row.paper_id as string,
    content: row.content as string,
    highlight: row.highlight as string | null,
    note_type: row.note_type as NoteType,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    paper: row.paper as Note['paper'],
  }))
}

export async function dbUpdateNote(userId: string, id: string, content: string): Promise<void> {
  const { error } = await supabase
    .from('notes')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)

  if (error) throw new Error(`Failed to update note: ${error.message}`)
}

export async function dbDeleteNote(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('notes')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) throw new Error(`Failed to delete note: ${error.message}`)
}

// ---------- Q&A History (per user) ----------

export async function dbSaveQA(
  userId: string,
  paperId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const { error } = await supabase
    .from('qa_history')
    .insert({ user_id: userId, paper_id: paperId, role, content })

  if (error) throw new Error(`Failed to save QA message: ${error.message}`)
}

export async function dbGetQAHistory(userId: string, paperId: string): Promise<QAMessage[]> {
  const { data, error } = await supabase
    .from('qa_history')
    .select('*')
    .eq('user_id', userId)
    .eq('paper_id', paperId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to fetch QA history: ${error.message}`)
  return (data ?? []) as QAMessage[]
}

// ---------- RSS Feeds ----------

export async function dbGetFeeds(onlyApproved = false): Promise<RSSFeed[]> {
  let query = supabase
    .from('rss_feeds')
    .select('*')
    .order('created_at', { ascending: true })

  if (onlyApproved) {
    query = query.eq('approved', true)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to fetch feeds: ${error.message}`)
  return (data ?? []) as RSSFeed[]
}

export async function dbAddFeed(
  feed: Omit<RSSFeed, 'id' | 'created_at' | 'last_fetched_at' | 'approved'>,
  userId?: string
): Promise<RSSFeed> {
  const { data, error } = await supabase
    .from('rss_feeds')
    .insert({
      ...feed,
      approved: false,
      added_by: userId ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to add feed: ${error.message}`)
  return data as RSSFeed
}

export async function dbDeleteFeed(id: string): Promise<void> {
  const { error } = await supabase.from('rss_feeds').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete feed: ${error.message}`)
}

export async function dbToggleFeed(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('rss_feeds')
    .update({ active })
    .eq('id', id)

  if (error) throw new Error(`Failed to toggle feed: ${error.message}`)
}

export async function dbApproveFeed(id: string, approved: boolean): Promise<void> {
  const { error } = await supabase
    .from('rss_feeds')
    .update({ approved })
    .eq('id', id)

  if (error) throw new Error(`Failed to update feed approval: ${error.message}`)
}

export async function dbUpdateFeedFetched(id: string): Promise<void> {
  const { error } = await supabase
    .from('rss_feeds')
    .update({ last_fetched_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(`Failed to update feed timestamp: ${error.message}`)
}

// ---------- Stats (scoped to user for saved/notes) ----------

export async function dbGetStats(userId: string): Promise<AppStats> {
  const [papersRes, savedRes, notesRes, topicsRes, articlesRes, doneRes] = await Promise.all([
    supabase.from('papers').select('id', { count: 'exact', head: true }).eq('approved', true),
    supabase.from('saved_papers').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('notes').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('user_topics').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('articles').select('id', { count: 'exact', head: true }),
    supabase.from('saved_papers').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('read_status', 'done'),
  ])

  return {
    totalPapers: papersRes.count ?? 0,
    savedPapers: savedRes.count ?? 0,
    totalNotes: notesRes.count ?? 0,
    topicsFollowed: topicsRes.count ?? 0,
    articlesRead: articlesRes.count ?? 0,
    streak: doneRes.count ?? 0,
  }
}

// ---------- Fetch Log ----------

export async function dbLogFetch(
  source: string,
  topic: string | null,
  papersCount: number,
  errors: string | null,
  userId?: string
): Promise<void> {
  await supabase
    .from('fetch_log')
    .insert({ source, topic, papers_count: papersCount, errors, fetched_by: userId ?? null })
}

// ---------- Articles ----------

export async function dbSaveArticle(article: {
  url: string
  title: string
  content: string
  summary?: string
  topic: string
  tags: string[]
  addedBy?: string
}): Promise<Article> {
  const { data, error } = await supabase
    .from('articles')
    .upsert({
      url: article.url,
      title: article.title,
      content: article.content,
      summary: article.summary ?? null,
      topic: article.topic,
      tags: article.tags,
      added_by: article.addedBy ?? null,
    }, { onConflict: 'url' })
    .select()
    .single()

  if (error) throw new Error(`Failed to save article: ${error.message}`)
  return data as Article
}

export async function dbGetArticles(): Promise<Article[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch articles: ${error.message}`)
  return (data ?? []) as Article[]
}

export async function dbDeleteArticle(id: string): Promise<void> {
  const { error } = await supabase.from('articles').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete article: ${error.message}`)
}

// ---------- User Topics ----------

export async function dbGetUserTopics(userId: string): Promise<UserTopic[]> {
  const { data, error } = await supabase
    .from('user_topics')
    .select('*')
    .eq('user_id', userId)
    .order('rating', { ascending: false })

  if (error) throw new Error(`Failed to fetch topics: ${error.message}`)
  return (data ?? []) as UserTopic[]
}

export async function dbUpsertUserTopic(userId: string, topic: string, rating: number): Promise<UserTopic> {
  const { data, error } = await supabase
    .from('user_topics')
    .upsert({ user_id: userId, topic, rating }, { onConflict: 'user_id,topic' })
    .select()
    .single()

  if (error) throw new Error(`Failed to save topic: ${error.message}`)
  return data as UserTopic
}

export async function dbDeleteUserTopic(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('user_topics')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) throw new Error(`Failed to remove topic: ${error.message}`)
}

// ---------- Daily Briefs ----------

export async function dbSaveBrief(brief: {
  userId: string
  content: string
  topics: string[]
  paperCount: number
}): Promise<DailyBrief> {
  const { data, error } = await supabase
    .from('daily_briefs')
    .insert({
      user_id: brief.userId,
      content: brief.content,
      topics: brief.topics,
      paper_count: brief.paperCount,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to save brief: ${error.message}`)
  return data as DailyBrief
}

export async function dbGetBriefs(userId: string): Promise<DailyBrief[]> {
  const { data, error } = await supabase
    .from('daily_briefs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw new Error(`Failed to fetch briefs: ${error.message}`)
  return (data ?? []) as DailyBrief[]
}
