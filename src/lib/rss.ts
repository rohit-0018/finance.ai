import type { Paper, RSSFeed, RawRSSItem } from '../types'
import { generateDigest } from './anthropic'
import { dbSavePapers, dbUpdateFeedFetched, dbLogFetch } from './supabase'

// Multiple CORS proxies as fallback chain
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
]

async function fetchWithProxy(feedUrl: string): Promise<string> {
  const errors: string[] = []

  for (const buildUrl of CORS_PROXIES) {
    const proxyUrl = buildUrl(feedUrl)
    try {
      const response = await fetch(proxyUrl)
      if (response.ok) {
        return await response.text()
      }
      errors.push(`${proxyUrl.split('?')[0]} → ${response.status}`)
    } catch (err) {
      errors.push(`${proxyUrl.split('?')[0]} → ${err instanceof Error ? err.message : 'network error'}`)
    }
  }

  throw new Error(`All CORS proxies failed:\n${errors.join('\n')}`)
}

export async function fetchRSSFeed(feedUrl: string): Promise<RawRSSItem[]> {
  const text = await fetchWithProxy(feedUrl)
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'text/xml')

  const parseError = xml.querySelector('parsererror')
  if (parseError) {
    throw new Error('Failed to parse RSS XML')
  }

  const items: RawRSSItem[] = []

  // Try RSS 2.0 format
  const rssItems = xml.querySelectorAll('item')
  if (rssItems.length > 0) {
    rssItems.forEach((item) => {
      const title = item.querySelector('title')?.textContent?.trim() ?? ''
      const link = item.querySelector('link')?.textContent?.trim() ?? ''
      const description =
        item.querySelector('description')?.textContent?.trim() ?? ''
      const pubDate = item.querySelector('pubDate')?.textContent?.trim() ?? ''
      const creator =
        item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')

      const authors = creator.length > 0
        ? Array.from(creator).map((c) => c.textContent?.trim() ?? '').join(', ')
        : ''

      // Extract arXiv ID from link or generate one
      const arxivMatch = link.match(/abs\/(\d{4}\.\d{4,5})/)
      const externalId = arxivMatch ? arxivMatch[1] : link || crypto.randomUUID()

      if (title) {
        items.push({
          title,
          link,
          abstract: cleanHTML(description),
          authors,
          pubDate,
          externalId,
        })
      }
    })
  }

  // Try Atom format
  const atomEntries = xml.querySelectorAll('entry')
  if (rssItems.length === 0 && atomEntries.length > 0) {
    atomEntries.forEach((entry) => {
      const title = entry.querySelector('title')?.textContent?.trim() ?? ''
      const link =
        entry.querySelector('link[href]')?.getAttribute('href') ?? ''
      const summary =
        entry.querySelector('summary')?.textContent?.trim() ??
        entry.querySelector('content')?.textContent?.trim() ??
        ''
      const published =
        entry.querySelector('published')?.textContent?.trim() ??
        entry.querySelector('updated')?.textContent?.trim() ??
        ''
      const authorNodes = entry.querySelectorAll('author name')
      const authors = Array.from(authorNodes)
        .map((a) => a.textContent?.trim() ?? '')
        .join(', ')

      const arxivMatch = link.match(/abs\/(\d{4}\.\d{4,5})/)
      const externalId = arxivMatch ? arxivMatch[1] : link || crypto.randomUUID()

      if (title) {
        items.push({
          title,
          link,
          abstract: cleanHTML(summary),
          authors,
          pubDate: published,
          externalId,
        })
      }
    })
  }

  return items
}

function cleanHTML(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent?.trim() ?? ''
}

export async function enrichRSSItem(
  item: RawRSSItem,
  feed: RSSFeed
): Promise<Partial<Paper>> {
  let digest = { problem: null as string | null, method: null as string | null, finding: null as string | null, category: feed.topic, tags: [] as string[] }

  if (item.abstract && item.abstract.length > 50) {
    try {
      const d = await generateDigest(item.title, item.abstract)
      digest = { ...d, problem: d.problem, method: d.method, finding: d.finding }
    } catch (err) {
      console.warn('Failed to generate digest for RSS item:', err)
    }
  }

  const year = item.pubDate ? new Date(item.pubDate).getFullYear() : new Date().getFullYear()

  return {
    external_id: item.externalId,
    title: item.title,
    authors: item.authors || null,
    year: isNaN(year) ? new Date().getFullYear() : year,
    source: 'RSS',
    category: digest.category,
    topic: feed.topic,
    abstract: item.abstract || null,
    problem: digest.problem,
    method: digest.method,
    finding: digest.finding,
    tags: digest.tags,
    url: item.link || null,
    feed_id: feed.id,
  }
}

export async function fetchAllActiveFeeds(
  feeds: RSSFeed[]
): Promise<{ total: number; errors: string[] }> {
  const activeFeeds = feeds.filter((f) => f.active)
  let total = 0
  const errors: string[] = []

  for (const feed of activeFeeds) {
    try {
      const items = await fetchRSSFeed(feed.url)
      const enriched: Partial<Paper>[] = []

      // Enrich items in batches of 3 to avoid rate limits
      for (let i = 0; i < items.length; i += 3) {
        const batch = items.slice(i, i + 3)
        const results = await Promise.all(
          batch.map((item) => enrichRSSItem(item, feed))
        )
        enriched.push(...results)
      }

      if (enriched.length > 0) {
        await dbSavePapers(enriched)
        total += enriched.length
      }

      await dbUpdateFeedFetched(feed.id)
      await dbLogFetch('RSS', feed.topic, enriched.length, null)
    } catch (err) {
      const msg = `Feed "${feed.name}": ${err instanceof Error ? err.message : 'Unknown error'}`
      errors.push(msg)
      await dbLogFetch('RSS', feed.topic, 0, msg)
    }
  }

  return { total, errors }
}
