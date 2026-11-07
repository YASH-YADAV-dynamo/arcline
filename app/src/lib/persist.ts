// Small persistent cache so a returning visitor sees charts and prices immediately instead of
// waiting on RPC round-trips. Stale-while-revalidate: cached data paints first, the normal fetch
// still runs and replaces it.
//
// Everything here is best-effort. localStorage can be missing, full, or blocked (private windows,
// embedded previews), so every access is guarded and the app must behave identically without it.
// Values are JSON with a bigint tag, because prices and balances are bigints and plain JSON would
// throw on them. Keys are versioned: bump VERSION to drop everything after a shape change.
import type { QueryClient } from '@tanstack/react-query'

const VERSION = 'v1'
const PREFIX = `at:${VERSION}:`
const MAX_ENTRY_BYTES = 900_000 // one runaway entry must not eat the whole origin quota
const BIG = '__bigint__'

const replacer = (_: string, v: unknown): unknown => (typeof v === 'bigint' ? { [BIG]: v.toString() } : v)
const reviver = (_: string, v: unknown): unknown => {
  if (v && typeof v === 'object' && BIG in (v as Record<string, unknown>)) {
    try {
      return BigInt((v as Record<string, string>)[BIG])
    } catch {
      return null
    }
  }
  return v
}

type Envelope<T> = { savedAt: number; value: T }

export function saveCache<T>(key: string, value: T): void {
  try {
    const raw = JSON.stringify({ savedAt: Date.now(), value } satisfies Envelope<T>, replacer)
    if (raw.length > MAX_ENTRY_BYTES) return
    localStorage.setItem(PREFIX + key, raw)
  } catch {
    /* storage unavailable or full: caching is an optimisation, never a requirement */
  }
}

/** Returns the cached value, or null when absent, unreadable, or older than `maxAgeMs`. */
export function loadCache<T>(key: string, maxAgeMs: number): { value: T; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const env = JSON.parse(raw, reviver) as Envelope<T>
    if (!env || typeof env.savedAt !== 'number' || Date.now() - env.savedAt > maxAgeMs) return null
    return { value: env.value, savedAt: env.savedAt }
  } catch {
    return null
  }
}

/** Drop entries from older cache versions so they do not sit in storage forever. */
export function sweepOldVersions(): void {
  try {
    const dead: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('at:') && !k.startsWith(PREFIX)) dead.push(k)
    }
    dead.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
}

// ---------- React Query bridge ----------

// Only read-only market data is persisted. Never anything wallet- or account-specific
// (balances, allowances, positions), which would be wrong for a different account.
const PERSIST_ROOTS = new Set(['assets', 'market', 'ohlcv', 'oraclePoints', 'refTokens'])
const RQ_KEY = 'rq'
const RQ_MAX_AGE = 24 * 60 * 60 * 1000

type Stored = { key: readonly unknown[]; data: unknown; at: number }

/** Seed the query cache from storage. Call BEFORE the first render so hooks start with data. */
export function hydrateQueryCache(qc: QueryClient): number {
  sweepOldVersions()
  const hit = loadCache<Stored[]>(RQ_KEY, RQ_MAX_AGE)
  if (!hit) return 0
  let n = 0
  for (const e of hit.value) {
    if (!Array.isArray(e.key) || !PERSIST_ROOTS.has(String(e.key[0])) || e.data === undefined) continue
    // updatedAt = when it was really fetched, so staleTime still triggers a background refresh.
    qc.setQueryData(e.key, e.data, { updatedAt: e.at })
    n++
  }
  return n
}

/** Write successful market queries back, debounced so a burst of updates is one write. */
export function persistQueryCache(qc: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    const out: Stored[] = []
    for (const q of qc.getQueryCache().getAll()) {
      const root = String(q.queryKey[0])
      if (!PERSIST_ROOTS.has(root) || q.state.status !== 'success' || q.state.data === undefined) continue
      out.push({ key: q.queryKey, data: q.state.data, at: q.state.dataUpdatedAt })
    }
    saveCache(RQ_KEY, out)
  }
  const unsub = qc.getQueryCache().subscribe((ev) => {
    if (ev.type !== 'updated' || ev.action.type !== 'success') return
    clearTimeout(timer)
    timer = setTimeout(flush, 2_000)
  })
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onHide)
  return () => {
    unsub()
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onHide)
  }
}
