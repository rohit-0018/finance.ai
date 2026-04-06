// Turn a pasted URL into a partial LifeTask. Best-effort: use the GitHub REST
// API when the URL is a GitHub PR/issue, otherwise fall back to Open Graph
// scrape via a public reader proxy (r.jina.ai). If both fail, return the URL
// as the title.
//
// No auth for GitHub — we hit the unauthenticated REST API. Fine for Phase 4
// public repos; Phase 6 will add authenticated GitHub when we store the user's
// PAT in life_integrations.

export interface EnrichedLink {
  title: string
  description?: string
  dueIso?: string
  source: 'github' | 'opengraph' | 'fallback'
  meta?: Record<string, unknown>
}

const GH_PR_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/i

export async function enrichLink(url: string): Promise<EnrichedLink> {
  const trimmed = url.trim()
  try {
    const gh = trimmed.match(GH_PR_RE)
    if (gh) {
      const [, owner, repo, kind, num] = gh
      const api = `https://api.github.com/repos/${owner}/${repo}/${
        kind === 'pull' ? 'pulls' : 'issues'
      }/${num}`
      const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
      if (res.ok) {
        const data = await res.json()
        return {
          title: `${owner}/${repo}#${num}: ${data.title ?? `${kind} ${num}`}`,
          description: (data.body as string | null)?.slice(0, 500) ?? undefined,
          dueIso: data.milestone?.due_on ?? undefined,
          source: 'github',
          meta: { state: data.state, author: data.user?.login },
        }
      }
    }
  } catch {
    /* fall through to OG */
  }

  // Open Graph via r.jina.ai reader. Public, no auth. Returns readable markdown.
  try {
    const res = await fetch(`https://r.jina.ai/${trimmed}`, {
      headers: { Accept: 'text/plain' },
    })
    if (res.ok) {
      const text = await res.text()
      const titleLine = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('Title:'))
      const title = titleLine ? titleLine.slice(6).trim() : trimmed
      // Grab a short description from the first paragraph after the title.
      const description = text
        .split('\n')
        .filter((l) => l.trim().length > 20 && !l.startsWith('Title:') && !l.startsWith('URL Source:'))
        .slice(0, 2)
        .join(' ')
        .slice(0, 280)
      return { title, description, source: 'opengraph' }
    }
  } catch {
    /* fall through */
  }

  return { title: trimmed, source: 'fallback' }
}
