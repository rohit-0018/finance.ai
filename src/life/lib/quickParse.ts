// Quick-add parser: pulls structured fields out of a free-text title.
//
// Supports, in any combination and order:
//   #tagname        → tag (lowercased, max 32 chars)
//   p1 … p5         → priority 1..5 (p1 = urgent, p5 = someday)
//   !1 … !5         → same as p1..p5 (alt syntax)
//   <nl-date>       → natural-language date (parsed via nlDate)
//
// Example:
//   "Buy groceries #home #errands p2 tomorrow"
//   → { title: "Buy groceries", tags: ["home","errands"], priority: 2,
//       scheduled_for: <tomorrow>, matched: ["#home","#errands","p2","tomorrow"] }
//
// Conservative parsing rules:
//   - Tags can appear anywhere; extracted and stripped before date parsing.
//   - Priority can appear anywhere; extracted and stripped before date parsing.
//   - Date is still trailing-only (delegated to parseNaturalDate).
//   - If extracting a field would leave an empty title, we decline that
//     field and leave it in the title instead (unlikely in practice since
//     the user typed something, but keeps the invariant simple).

import { parseNaturalDate, type ParsedNL } from './nlDate'

export interface QuickParsed {
  title: string
  scheduled_for: string | null
  tags: string[]
  priority: number | null
  matched: string[]
}

const TAG_RE = /(?:^|\s)#([a-z0-9][a-z0-9_-]{0,31})\b/gi
const PRIORITY_RE = /(?:^|\s)(?:p|!)([1-5])\b/gi

export function quickParseTask(input: string, todayLocalDate: string): QuickParsed {
  const matched: string[] = []
  let working = input

  // Tags — collect all, then strip.
  const tags: string[] = []
  let m: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(working)) !== null) {
    const tag = m[1].toLowerCase()
    if (!tags.includes(tag)) tags.push(tag)
    matched.push(`#${tag}`)
  }
  working = working.replace(TAG_RE, ' ')

  // Priority — first hit wins (duplicates are silly).
  let priority: number | null = null
  PRIORITY_RE.lastIndex = 0
  const pm = PRIORITY_RE.exec(working)
  if (pm) {
    priority = Number(pm[1])
    matched.push(pm[0].trim())
  }
  working = working.replace(PRIORITY_RE, ' ')

  // Normalize whitespace before handing to the date parser so a trailing
  // "tomorrow" still sits at the end of the string.
  working = working.replace(/\s+/g, ' ').trim()

  const dateParsed: ParsedNL = parseNaturalDate(working, todayLocalDate)
  if (dateParsed.matched) matched.push(dateParsed.matched)

  const title = dateParsed.title || working
  if (!title) {
    // Nothing left after extraction — fall back to the original input
    // so the user can see what they typed and the task still has a title.
    return {
      title: input.trim(),
      scheduled_for: null,
      tags: [],
      priority: null,
      matched: [],
    }
  }

  return {
    title,
    scheduled_for: dateParsed.scheduled_for,
    tags,
    priority,
    matched,
  }
}
