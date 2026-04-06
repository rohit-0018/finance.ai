// Tiny in-memory query cache for the Life app.
//
// Why not TanStack Query? We already have it in deps for papermind, but the
// Life pages all hand-rolled their own load() patterns, and each page mount
// re-fetches the same rows 2–3x. We need something lighter than TanStack's
// full provider + devtools for lazy-loaded Life, that still gives us:
//   - shared cache across components
//   - manual invalidation by key prefix
//   - suspense-free "data + loading + error" triple
//   - stable identity so effects don't thrash
//
// Everything here is local state — no global provider, no context. The cache
// lives in module scope and is cleared when the page reloads (fine; Life is
// lazy-loaded anyway).
import { useCallback, useEffect, useRef, useState } from 'react'

interface CacheEntry<T> {
  data: T | undefined
  promise: Promise<T> | null
  expiresAt: number
  error: Error | null
}

const STORE = new Map<string, CacheEntry<unknown>>()
const LISTENERS = new Map<string, Set<() => void>>()

const DEFAULT_STALE_MS = 30_000

function notify(key: string) {
  LISTENERS.get(key)?.forEach((fn) => fn())
}

function subscribe(key: string, fn: () => void) {
  if (!LISTENERS.has(key)) LISTENERS.set(key, new Set())
  LISTENERS.get(key)!.add(fn)
  return () => {
    LISTENERS.get(key)?.delete(fn)
  }
}

export interface UseLifeQueryResult<T> {
  data: T | undefined
  loading: boolean
  error: Error | null
  refetch: () => Promise<T>
}

/**
 * Shared-cache query hook.
 *
 * @param key      A stable, unique cache key (include all params that affect
 *                 the result, e.g. `['tasks', workspaceId, date]`).
 * @param fetcher  Async function that returns the data. Called on cold cache
 *                 or when `refetch()` is invoked.
 * @param opts     `enabled` to defer fetching, `staleMs` to override TTL.
 */
export function useLifeQuery<T>(
  key: (string | number | null | undefined)[] | null,
  fetcher: () => Promise<T>,
  opts: { enabled?: boolean; staleMs?: number } = {}
): UseLifeQueryResult<T> {
  const enabled = opts.enabled !== false && key !== null
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
  const cacheKey = enabled ? JSON.stringify(key) : null

  // Keep fetcher reference stable across renders so effect deps stay honest.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const [, forceRender] = useState(0)

  const run = useCallback(async (): Promise<T> => {
    if (!cacheKey) throw new Error('useLifeQuery.run called with null key')
    const existing = STORE.get(cacheKey) as CacheEntry<T> | undefined
    if (existing?.promise) return existing.promise

    const entry: CacheEntry<T> =
      existing ?? { data: undefined, promise: null, expiresAt: 0, error: null }
    STORE.set(cacheKey, entry as CacheEntry<unknown>)

    entry.promise = (async () => {
      try {
        const data = await fetcherRef.current()
        entry.data = data
        entry.error = null
        entry.expiresAt = Date.now() + staleMs
        return data
      } catch (err) {
        entry.error = err as Error
        throw err
      } finally {
        entry.promise = null
        notify(cacheKey)
      }
    })()
    notify(cacheKey)
    return entry.promise
  }, [cacheKey, staleMs])

  // Subscribe to cache updates for this key so all mounted consumers re-render
  // when the cache entry changes.
  useEffect(() => {
    if (!cacheKey) return
    return subscribe(cacheKey, () => forceRender((n) => n + 1))
  }, [cacheKey])

  // Trigger a fetch on mount or when key changes, if the cache is cold/stale.
  useEffect(() => {
    if (!enabled || !cacheKey) return
    const existing = STORE.get(cacheKey) as CacheEntry<T> | undefined
    const stale = !existing || existing.expiresAt < Date.now()
    if (stale && !existing?.promise) {
      run().catch(() => {/* surfaced via entry.error */})
    }
  }, [enabled, cacheKey, run])

  const entry = cacheKey ? (STORE.get(cacheKey) as CacheEntry<T> | undefined) : undefined
  return {
    data: entry?.data,
    loading: Boolean(entry?.promise),
    error: entry?.error ?? null,
    refetch: run,
  }
}

/**
 * Invalidate every cache entry whose key starts with the given prefix.
 * Call after mutations, e.g.:
 *   invalidate(['tasks', workspaceId])
 */
export function invalidate(prefix: (string | number | null | undefined)[]): void {
  const prefixStr = JSON.stringify(prefix).slice(0, -1) // drop trailing ']'
  for (const key of STORE.keys()) {
    if (key.startsWith(prefixStr)) {
      STORE.delete(key)
      notify(key)
    }
  }
}

/** Nuke everything. Useful on logout / workspace switch edge cases. */
export function invalidateAll(): void {
  const keys = Array.from(STORE.keys())
  STORE.clear()
  for (const k of keys) notify(k)
}
