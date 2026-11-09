// One WebSocket to the Arc RPC for the whole app. It pushes what used to be polled:
//   new blocks              -> the status bar block number
//   PriceUpdated / RiskUpdated -> patched straight into the ['assets'] and ['oraclePoints', token] caches
//   AssetListed             -> refetch the asset list (a new token appears without a reload)
// React Query stays the single source of state; the socket only writes into it. If the socket drops,
// viem reconnects, and the hooks fall back to their normal polling (see liveStatus() in assets.ts).
import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { createPublicClient, fallback, webSocket, type Log } from 'viem'
import { arcTestnet } from 'viem/chains'
import { ADDR, registryAbi } from './contracts'
import type { ListedAsset } from './assets'

export type LiveStatus = 'connecting' | 'live' | 'down'
type State = { status: LiveStatus; block: bigint | null }

let state: State = { status: 'connecting', block: null }
const subs = new Set<() => void>()
const set = (next: Partial<State>) => {
  state = { ...state, ...next }
  subs.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

/** Current socket status, readable outside React (query options use it to pick a poll interval). */
export const liveStatus = () => state.status

export function useLive(): State {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

type Point = { token: string; t: number; p: number }
type Args = { token?: `0x${string}`; priceE8?: bigint; observedAt?: bigint; level?: number }

function apply(qc: QueryClient, logs: Log[]) {
  let relist = false
  for (const l of logs as (Log & { eventName?: string; args?: Args })[]) {
    const a = l.args ?? {}
    const token = a.token?.toLowerCase()
    if (l.eventName === 'AssetListed') relist = true
    else if (l.eventName === 'PriceUpdated' && token && a.priceE8 !== undefined && a.observedAt !== undefined) {
      const at = Number(a.observedAt)
      qc.setQueryData<ListedAsset[]>(['assets'], (list) =>
        list?.map((x) => (x.token.toLowerCase() === token ? { ...x, priceE8: a.priceE8!, observedAt: at } : x)),
      )
      const p = Number(a.priceE8) / 1e8
      qc.setQueryData<Point[]>(['oraclePoints', token], (pts) => (pts && p > 0 && !pts.some((x) => x.t === at) ? [...pts, { token, t: at, p }] : pts))
    } else if (l.eventName === 'RiskUpdated' && token && a.level !== undefined) {
      qc.setQueryData<ListedAsset[]>(['assets'], (list) =>
        list?.map((x) => (x.token.toLowerCase() === token ? { ...x, risk: Number(a.level) } : x)),
      )
    }
  }
  if (relist) void qc.invalidateQueries({ queryKey: ['assets'] })
}

function start(qc: QueryClient) {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: fallback(arcTestnet.rpcUrls.default.webSocket.map((u) => webSocket(u, { reconnect: { attempts: 10, delay: 2_000 }, keepAlive: true }))),
  })
  set({ status: 'connecting' })
  const stopBlocks = client.watchBlockNumber({
    emitOnBegin: true,
    onBlockNumber: (block) => set({ status: 'live', block }),
    onError: () => set({ status: 'down' }),
  })
  const stopEvents = client.watchContractEvent({
    address: ADDR.registry,
    abi: registryAbi,
    onLogs: (logs) => apply(qc, logs),
    onError: () => set({ status: 'down' }),
  })
  return () => {
    stopBlocks()
    stopEvents()
  }
}

/** Mount once (Shell). Opens the socket for the lifetime of the app. */
export function useLiveFeed() {
  const qc = useQueryClient()
  useEffect(() => start(qc), [qc])
}
