import { lifeDb } from './_client'
import type { LifeJournalEntry } from '../../types'

export async function getJournalEntry(
  userId: string,
  date: string
): Promise<LifeJournalEntry | null> {
  const { data, error } = await lifeDb()
    .from('life_journal')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()
  if (error) throw new Error(`getJournalEntry: ${error.message}`)
  return (data as LifeJournalEntry) ?? null
}

export async function listJournalEntries(
  userId: string,
  limit = 30
): Promise<LifeJournalEntry[]> {
  const { data, error } = await lifeDb()
    .from('life_journal')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listJournalEntries: ${error.message}`)
  return (data ?? []) as LifeJournalEntry[]
}

export async function upsertJournalEntry(
  userId: string,
  date: string,
  patch: Partial<Omit<LifeJournalEntry, 'id' | 'user_id' | 'date' | 'created_at'>>
): Promise<LifeJournalEntry> {
  const { data, error } = await lifeDb()
    .from('life_journal')
    .upsert({ user_id: userId, date, ...patch }, { onConflict: 'user_id,date' })
    .select()
    .single()
  if (error) throw new Error(`upsertJournalEntry: ${error.message}`)
  return data as LifeJournalEntry
}

export async function closeOutDay(
  userId: string,
  date: string,
  fields: { summary?: string; wins?: string; blockers?: string; tomorrow?: string; energy?: number }
): Promise<LifeJournalEntry> {
  return upsertJournalEntry(userId, date, {
    ...fields,
    closed_at: new Date().toISOString(),
  })
}

/** Consecutive trailing days (ending at `today`) with closed_at set. */
export async function getStreak(userId: string, today: string): Promise<number> {
  const { data, error } = await lifeDb()
    .from('life_journal')
    .select('date, closed_at')
    .eq('user_id', userId)
    .lte('date', today)
    .order('date', { ascending: false })
    .limit(60)
  if (error) throw new Error(`getStreak: ${error.message}`)
  let streak = 0
  let cursor = today
  for (const row of (data ?? []) as { date: string; closed_at: string | null }[]) {
    if (row.date !== cursor || !row.closed_at) break
    streak++
    const d = new Date(`${cursor}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    cursor = d.toISOString().slice(0, 10)
  }
  return streak
}
