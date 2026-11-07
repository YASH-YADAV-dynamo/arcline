// ONE chunked, serialised, session-cached event scanner for the whole app.
//
// The Arc testnet RPC rejects eth_getLogs ranges above 10k blocks ("requested range too large")
// and rate-limits bursts, so every caller shares one 10k-chunk queue behind a module-level lock.
// Scanned ranges are cached per key for the session: later calls only read new blocks, and walk
// further back only while `needMore` is still true.
import type { Abi, PublicClient } from 'viem'
import { loadCache, saveCache } from './persist'

const CHUNK = 10_000n

type Cache = { from: bigint | null; to: bigint | null; logs: unknown[] }
const caches = new Map<string, Cache>()
const SCAN_MAX_AGE = 7 * 24 * 60 * 60 * 1000

// A reload would otherwise re-walk up to 12 serial 10k-block chunks. Persisting the scanned
// range means a returning visitor only reads blocks newer than their last visit.
function cacheFor(key: string): Cache {
  const hit = caches.get(key)
  if (hit) return hit
  const stored = loadCache<Cache>(`scan:${key}`, SCAN_MAX_AGE)?.value
  const fresh: Cache =
    stored && typeof stored.from === 'bigint' && typeof stored.to === 'bigint' && Array.isArray(stored.logs)
      ? stored
      : { from: null, to: null, logs: [] }
  caches.set(key, fresh)
  return fresh
}
let lock: Promise<unknown> = Promise.resolve()

export type ScanResult<T> = { logs: T[]; scannedFrom: bigint; complete: boolean }

export async function scanLogs<T>(opts: {
  /** cache key; one per (contract, event) pair */
  key: string
  client: PublicClient
  address: `0x${string}` | `0x${string}`[]
  abi: Abi
  eventName: string
  deployBlock: bigint
  /** how many 10k chunks to walk backwards per call */
  maxBackPerFetch?: number
  /** keep walking back while this is true */
  needMore: (logs: T[]) => boolean
  map: (log: unknown) => T | null
}): Promise<ScanResult<T>> {
  const cache = cacheFor(opts.key)

  const run = lock.then(async () => {
    const latest = await opts.client.getBlockNumber()
    let to = cache.to ?? latest
    let from = cache.from ?? latest + 1n
    cache.to = to
    cache.from = from

    const read = async (f: bigint, t: bigint) => {
      const got = await opts.client.getContractEvents({
        address: opts.address,
        abi: opts.abi,
        eventName: opts.eventName,
        fromBlock: f,
        toBlock: t,
      })
      for (const l of got) {
        const m = opts.map(l)
        if (m) cache.logs.push(m)
      }
    }

    // forward: new blocks since the last scan
    while (to < latest) {
      const f = to + 1n
      const t = f + CHUNK - 1n < latest ? f + CHUNK - 1n : latest
      await read(f, t)
      cache.to = to = t
    }

    // backward: older history, only while the caller still needs rows
    const cap = opts.maxBackPerFetch ?? 12
    for (let n = 0; from > opts.deployBlock && opts.needMore(cache.logs as T[]) && n < cap; n++) {
      const t = from - 1n
      const f = t - CHUNK + 1n > opts.deployBlock ? t - CHUNK + 1n : opts.deployBlock
      await read(f, t)
      cache.from = from = f
    }
    saveCache(`scan:${opts.key}`, cache)
  })
  lock = run.catch(() => undefined)
  await run

  const scannedFrom = cache.from ?? opts.deployBlock
  return { logs: cache.logs as T[], scannedFrom, complete: scannedFrom <= opts.deployBlock }
}
