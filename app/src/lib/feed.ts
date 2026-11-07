// Server-built snapshots served by Caddy at /feed/* (written by ops/feed-worker.cjs on the server).
//
// Charts used to be assembled in every browser: ~14+ serial eth_getLogs calls on the rate-limited
// public RPC, plus GeckoTerminal calls that all share the server's IP through the /gt proxy. The
// worker now fetches all of that once, on a budget, and the browser makes one request per file.
// Everything here is optional: if a file is missing or old (dev server, worker down), callers fall
// back to their original live path, so the app behaves as before.
type GtSnap = { v: 1; at: number; r: Record<string, { at: number; j: unknown }> }
export type PointsSnap = { v: 1; at: number; to: string; series: Record<string, [number, number][]> }

const FRESH_SEC = 15 * 60 // older than this, treat as missing and go live
const nowSec = () => Math.floor(Date.now() / 1000)

function loader<T extends { at: number }>(url: string, ttlMs: number) {
  let cached: { at: number; p: Promise<T | null> } | null = null
  return (): Promise<T | null> => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.p
    const p = fetch(url, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
      .then((j) => (j && typeof j.at === 'number' && nowSec() - j.at < FRESH_SEC ? j : null))
      .catch(() => null)
    cached = { at: Date.now(), p }
    return p
  }
}

const gtSnap = loader<GtSnap>('/feed/gt.json', 60_000)
export const pointsSnap = loader<PointsSnap>('/feed/points.json', 30_000)

/** GeckoTerminal response for `path` (relative to /api/v2) from the server snapshot, or undefined. */
export async function gtFromFeed<T>(path: string): Promise<T | undefined> {
  const s = await gtSnap()
  return (s?.r[path]?.j as T | undefined) ?? undefined
}
