// Prefix routing — when a user types a task or question whose title begins
// with `Ofc ` (case-insensitive) or `Prs `, route the row into the work or
// personal workspace automatically and strip the prefix from the saved title.
//
// This lets you capture cross-context items from a single quick-add box
// without switching workspaces first.
//
//   "Ofc Review PR for billing"  → workspace=work,    title="Review PR for billing"
//   "Prs Buy birthday card"      → workspace=personal, title="Buy birthday card"
//   "Plain task"                 → workspace=fallback, title unchanged
//
// We accept a few common variants: Ofc, Off, Office, Work, W / Prs, Per,
// Personal, P. Match is case-insensitive and the trailing whitespace or `:` is
// consumed. The match must be a standalone leading token (not "Ofcing").

import type { LifeWorkspace, WorkspaceKind } from '../types'

const WORK_PREFIXES = ['ofc', 'off', 'office', 'work', 'w']
const PERSONAL_PREFIXES = ['prs', 'per', 'personal', 'p']

export interface PrefixResult {
  /** The user-visible title with the prefix stripped (or original if no match). */
  title: string
  /** Which workspace kind the prefix mapped to, or null if no prefix was used. */
  routedKind: WorkspaceKind | null
}

const PREFIX_REGEX = new RegExp(
  `^\\s*(${[...WORK_PREFIXES, ...PERSONAL_PREFIXES].join('|')})[\\s:.\\-]+`,
  'i'
)

export function parsePrefix(rawTitle: string): PrefixResult {
  const match = rawTitle.match(PREFIX_REGEX)
  if (!match) return { title: rawTitle.trim(), routedKind: null }
  const tag = match[1].toLowerCase()
  const routedKind: WorkspaceKind = WORK_PREFIXES.includes(tag) ? 'work' : 'personal'
  return {
    title: rawTitle.slice(match[0].length).trim(),
    routedKind,
  }
}

/**
 * Resolve a prefixed title to its workspace id. Falls back to `fallbackId`
 * (typically the active workspace) when no prefix is present or no matching
 * workspace exists for the kind.
 */
export function resolveWorkspaceFromTitle(
  rawTitle: string,
  workspaces: LifeWorkspace[],
  fallbackId: string | null | undefined
): { title: string; workspaceId: string | null; routedKind: WorkspaceKind | null } {
  const { title, routedKind } = parsePrefix(rawTitle)
  if (!routedKind) {
    return { title, workspaceId: fallbackId ?? null, routedKind: null }
  }
  const ws = workspaces.find((w) => w.kind === routedKind)
  return {
    title,
    workspaceId: ws?.id ?? fallbackId ?? null,
    routedKind,
  }
}
