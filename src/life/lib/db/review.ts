import { lifeDb } from './_client'

export interface WeekStats {
  done: number
  open: number
  byCategory: Record<string, number>
  closedJournalDays: number
}

export async function getRangeStats(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<WeekStats> {
  const db = lifeDb()
  const [tasks, journals, projects] = await Promise.all([
    db
      .from('life_tasks')
      .select('id, status, project_id, scheduled_for, done_at')
      .eq('user_id', userId)
      .gte('scheduled_for', fromDate)
      .lte('scheduled_for', toDate),
    db
      .from('life_journal')
      .select('date, closed_at')
      .eq('user_id', userId)
      .gte('date', fromDate)
      .lte('date', toDate),
    db.from('life_projects').select('id, category').eq('user_id', userId),
  ])
  if (tasks.error) throw new Error(`getRangeStats tasks: ${tasks.error.message}`)
  if (journals.error) throw new Error(`getRangeStats journal: ${journals.error.message}`)
  if (projects.error) throw new Error(`getRangeStats projects: ${projects.error.message}`)

  const projCat = new Map<string, string>()
  for (const p of (projects.data ?? []) as { id: string; category: string }[]) {
    projCat.set(p.id, p.category)
  }

  const stats: WeekStats = { done: 0, open: 0, byCategory: {}, closedJournalDays: 0 }
  type TaskRow = { status: string; project_id: string | null }
  for (const t of (tasks.data ?? []) as TaskRow[]) {
    if (t.status === 'done') stats.done++
    else if (t.status === 'todo' || t.status === 'doing') stats.open++
    const cat = (t.project_id ? projCat.get(t.project_id) : 'unassigned') ?? 'unassigned'
    stats.byCategory[cat] = (stats.byCategory[cat] ?? 0) + 1
  }
  stats.closedJournalDays = ((journals.data ?? []) as { closed_at: string | null }[]).filter(
    (j) => j.closed_at
  ).length
  return stats
}
