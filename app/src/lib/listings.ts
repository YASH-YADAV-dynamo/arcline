// Auto-search + auto tickets. A "ticket" is the market page #/trade/<display>, which the app builds dynamically from
// AssetRegistry.assets(). This watcher diffs the live registry against the last-seen set and, when a NEW asset
// appears, toasts it and appends it to a detection log (shown on #/agents).
//
// The first ever run only records the current set (no toasts). Last-seen addresses and the log live in
// localStorage (try/catch, with an in-memory fallback). Nothing sensitive is stored.
import { useEffect, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { useAssets, type Category, type ListedAsset } from './assets'
import { navigate } from './router'

export type Detection = {
  token: string
  symbol: string
  display: string
  category: Category
  at: number // ms since epoch
  href: string // the auto-created ticket: /trade/<display>
}

const SEEN_KEY = 'arc.listings.seen.v1'
const LOG_KEY = 'arc.listings.log.v1'
const LOG_CAP = 50

// ---- last-seen token set ----------------------------------------------------------------
let seenMem: Set<string> | null = null

function readSeen(): Set<string> | null {
  if (seenMem) return seenMem
  try {
    const raw = window.localStorage.getItem(SEEN_KEY)
    if (!raw) return null
    const j: unknown = JSON.parse(raw)
    if (!Array.isArray(j)) return null
    seenMem = new Set((j as unknown[]).filter((x): x is string => typeof x === 'string'))
    return seenMem
  } catch {
    return null
  }
}

function writeSeen(s: Set<string>) {
  seenMem = s
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...s]))
  } catch { /* storage blocked: the in-memory set still prevents repeat toasts this session */ }
}

// ---- detection log (external store) -----------------------------------------------------
let log: Detection[] | null = null
const listeners = new Set<() => void>()

function readLog(): Detection[] {
  try {
    const j: unknown = JSON.parse(window.localStorage.getItem(LOG_KEY) ?? '[]')
    if (!Array.isArray(j)) return []
    return (j as Partial<Detection>[])
      .filter((d) => typeof d?.token === 'string' && typeof d.display === 'string' && typeof d.symbol === 'string')
      .map((d) => ({
        token: String(d.token),
        symbol: String(d.symbol),
        display: String(d.display),
        category: d.category ?? 'Cash',
        at: Number(d.at) || 0,
        href: `/trade/${d.display}`,
      }))
      .slice(0, LOG_CAP)
  } catch {
    return []
  }
}

const getLog = (): Detection[] => (log ??= readLog())

function setLog(next: Detection[]) {
  log = next.slice(0, LOG_CAP)
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(log))
  } catch { /* in-memory only */ }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Newest-first list of detected listings (max 50). */
export function useDetections(): Detection[] {
  return useSyncExternalStore(subscribe, getLog, getLog)
}

export const clearDetections = () => setLog([])

// ---- watcher -----------------------------------------------------------------------------
function announce(a: ListedAsset) {
  const d: Detection = { token: a.token, symbol: a.symbol, display: a.display, category: a.category, at: Date.now(), href: `/trade/${a.display}` }
  setLog([d, ...getLog().filter((x) => x.token.toLowerCase() !== a.token.toLowerCase())])
  toast(`New market detected: ${a.display}`, {
    id: `listing-${a.token}`,
    description: `${a.category} · ticket created`,
    duration: 15_000,
    action: { label: 'Trade', onClick: () => navigate(d.href) },
  })
}

/**
 * Polls the registry (via the shared useAssets query, ~30s) and announces tokens it has not seen before.
 * Mount once (see ListingsWatcher). Safe under StrictMode: the seen set is updated before any re-run.
 */
export function useListingsWatcher() {
  const { data } = useAssets()
  useEffect(() => {
    if (!data) return
    const prev = readSeen()
    const next = new Set(prev ?? [])
    for (const a of data) next.add(a.token.toLowerCase())
    if (prev) {
      const fresh = data.filter((a) => !prev.has(a.token.toLowerCase()))
      writeSeen(next) // record first so a re-run cannot announce the same asset twice
      fresh.forEach(announce)
    } else {
      writeSeen(next) // first ever run: just record, no toasts
    }
  }, [data])
}
