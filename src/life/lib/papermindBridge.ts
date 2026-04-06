// Bridge: read user content from the main papermind Supabase project
// (saved papers + read articles) and shape it for life_learn_items.
// Uses the existing papermind client at src/lib/supabase.ts.
import { dbGetSavedPapers, dbGetArticles } from '../../lib/supabase'

export interface BridgedItem {
  papermind_id: string
  title: string
  source_url: string | null
  source_type: 'papermind_paper' | 'papermind_article'
  topic: string | null
}

export async function fetchPapermindLibrary(papermindUserId: string): Promise<BridgedItem[]> {
  const items: BridgedItem[] = []

  try {
    const saved = await dbGetSavedPapers(papermindUserId)
    for (const s of saved) {
      if (!s.paper) continue
      items.push({
        papermind_id: s.paper.id,
        title: s.paper.title,
        source_url: s.paper.url ?? null,
        source_type: 'papermind_paper',
        topic: s.paper.topic ?? null,
      })
    }
  } catch {
    /* ignore — bridge is best-effort */
  }

  try {
    const articles = await dbGetArticles()
    for (const a of articles) {
      items.push({
        papermind_id: a.id,
        title: a.title,
        source_url: a.url ?? null,
        source_type: 'papermind_article',
        topic: a.topic ?? null,
      })
    }
  } catch {
    /* ignore */
  }

  return items
}
