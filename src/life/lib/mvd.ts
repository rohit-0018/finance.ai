// Minimum-Viable Day — the 3 non-negotiable things the user has to hit
// on their worst day. Backed by life_memory so we don't need a dedicated
// table. Config and daily "done" state are stored in separate keys so
// marking a chip done doesn't rewrite the definition.
//
// Keys (workspace-scoped — different for work vs personal):
//   - mvd:config   → JSON { items: [{id, title}] }
//   - mvd:done:<YYYY-MM-DD> → JSON string[] of item ids done today
import { listMemory, upsertMemory } from './db'

export interface MvdItem {
  id: string
  title: string
}

const CONFIG_KEY = 'mvd:config'

const DEFAULT_ITEMS: MvdItem[] = [
  { id: 'move', title: 'Move 10 min' },
  { id: 'water', title: 'Drink water' },
  { id: 'journal', title: 'Journal 1 line' },
]

function doneKey(date: string) {
  return `mvd:done:${date}`
}

/**
 * Load the user's MVD items for the given workspace. If no config exists yet
 * (new user or brand-new workspace), seed the defaults into life_memory so
 * the next read is a plain lookup.
 */
export async function loadMvdItems(
  userId: string,
  workspaceId: string
): Promise<MvdItem[]> {
  const rows = await listMemory(userId, workspaceId)
  const row = rows.find((r) => r.key === CONFIG_KEY && r.workspace_id === workspaceId)
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as { items: MvdItem[] }
      if (Array.isArray(parsed.items) && parsed.items.length > 0) return parsed.items
    } catch {
      /* fall through and reseed */
    }
  }
  // Seed defaults on first read. Ignore failures — we can still render.
  try {
    await upsertMemory({
      userId,
      workspaceId,
      key: CONFIG_KEY,
      value: JSON.stringify({ items: DEFAULT_ITEMS }),
      source: 'user',
    })
  } catch {
    /* ignore */
  }
  return DEFAULT_ITEMS
}

export async function saveMvdItems(
  userId: string,
  workspaceId: string,
  items: MvdItem[]
): Promise<void> {
  await upsertMemory({
    userId,
    workspaceId,
    key: CONFIG_KEY,
    value: JSON.stringify({ items }),
    source: 'user',
  })
}

export async function loadMvdDone(
  userId: string,
  workspaceId: string,
  date: string
): Promise<Set<string>> {
  const rows = await listMemory(userId, workspaceId)
  const row = rows.find((r) => r.key === doneKey(date) && r.workspace_id === workspaceId)
  if (!row) return new Set()
  try {
    const ids = JSON.parse(row.value) as string[]
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

export async function toggleMvdDone(
  userId: string,
  workspaceId: string,
  date: string,
  itemId: string
): Promise<Set<string>> {
  const current = await loadMvdDone(userId, workspaceId, date)
  if (current.has(itemId)) current.delete(itemId)
  else current.add(itemId)
  await upsertMemory({
    userId,
    workspaceId,
    key: doneKey(date),
    value: JSON.stringify(Array.from(current)),
    source: 'user',
  })
  return current
}
