// Natural-language date parser for the quick-add input.
//
// Given "Buy milk tomorrow" or "Call mom next friday" or "Ship feature in
// 3 days", strip the trailing date expression out of the title and return
// the resolved YYYY-MM-DD (in the user's local day). Returns the original
// title with scheduled_for=null when nothing matches — callers can fall
// through without any special casing.
//
// Deliberately conservative: we only match date words at the END of the
// input so users who type "tomorrow's standup prep" keep their title
// intact. If matching the trailing expression would leave an empty title
// ("tomorrow" alone) we decline — the user almost certainly means the
// title itself, not a dateless schedule.

export interface ParsedNL {
  title: string
  scheduled_for: string | null
  matched: string | null
}

export function parseNaturalDate(input: string, todayLocalDate: string): ParsedNL {
  const trimmed = input.trim()
  if (!trimmed) return { title: '', scheduled_for: null, matched: null }

  const patterns: Array<{ re: RegExp; resolve: (m: RegExpMatchArray) => string | null }> = [
    { re: /\btoday\b\s*$/i, resolve: () => todayLocalDate },
    { re: /\btomorrow\b\s*$/i, resolve: () => addDays(todayLocalDate, 1) },
    { re: /\byesterday\b\s*$/i, resolve: () => addDays(todayLocalDate, -1) },
    { re: /\bnext\s+week\b\s*$/i, resolve: () => addDays(todayLocalDate, 7) },
    { re: /\bin\s+(\d+)\s+days?\b\s*$/i, resolve: (m) => addDays(todayLocalDate, Number(m[1])) },
    { re: /\bin\s+(\d+)\s+weeks?\b\s*$/i, resolve: (m) => addDays(todayLocalDate, Number(m[1]) * 7) },
    {
      re: /\bnext\s+(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b\s*$/i,
      resolve: (m) => nextWeekday(todayLocalDate, weekdayIndex(m[1]), true),
    },
    {
      re: /\b(?:this\s+)?(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b\s*$/i,
      resolve: (m) => nextWeekday(todayLocalDate, weekdayIndex(m[1]), false),
    },
    { re: /\b(\d{4}-\d{2}-\d{2})\b\s*$/, resolve: (m) => m[1] },
  ]

  for (const { re, resolve } of patterns) {
    const m = trimmed.match(re)
    if (!m || m.index === undefined) continue
    const date = resolve(m)
    if (!date) continue
    // Strip the matched date phrase. Also trim any dangling "on"/"by"
    // connectors so "call mom on friday" → "call mom", not "call mom on".
    const before = trimmed.slice(0, m.index).replace(/\s+(on|by|due)\s*$/i, '').trim()
    if (!before) continue
    return { title: before, scheduled_for: date, matched: m[0].trim() }
  }
  return { title: trimmed, scheduled_for: null, matched: null }
}

function addDays(dateISO: string, delta: number): string {
  const d = new Date(`${dateISO}T00:00:00`)
  d.setDate(d.getDate() + delta)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function weekdayIndex(s: string): number {
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
  return map[s.toLowerCase().slice(0, 3)] ?? 0
}

// `forceNextWeek=true` for explicit "next Xday" — always jumps a full week
// ahead even when today is not Xday. Without it, "friday" on a Wednesday
// means this Friday, and "friday" on a Friday means next Friday (not today).
function nextWeekday(todayLocalDate: string, target: number, forceNextWeek: boolean): string {
  const d = new Date(`${todayLocalDate}T00:00:00`)
  const current = d.getDay()
  let delta = (target - current + 7) % 7
  if (delta === 0) delta = 7
  if (forceNextWeek && delta < 7) delta += 7
  return addDays(todayLocalDate, delta)
}

// Friendly label for the live preview strip under the quick-add input.
// "Fri, Dec 13" style — short enough to fit on one line.
export function formatPreview(dateISO: string, todayLocalDate: string): string {
  if (dateISO === todayLocalDate) return 'Today'
  if (dateISO === addDays(todayLocalDate, 1)) return 'Tomorrow'
  if (dateISO === addDays(todayLocalDate, -1)) return 'Yesterday'
  const d = new Date(`${dateISO}T00:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
