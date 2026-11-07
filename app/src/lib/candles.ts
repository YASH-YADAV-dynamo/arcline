// Candles built from on-chain oracle history (AssetRegistry.PriceUpdated).
//
// This is the series that ALWAYS exists: GeckoTerminal has no indexed pool for most mirror assets
// on Arc mainnet (it returns a price but zero pools), so there is nothing to chart from. The
// registry's own price history is the honest, self-sufficient fallback.
//
// Volume is genuinely 0 for an oracle series — CandleChart hides the volume pane in this mode
// rather than drawing an empty strip.
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import type { PublicClient } from 'viem'
import { ADDR, DEPLOY_BLOCK, registryAbi } from './contracts'
import { scanLogs } from './scan'
import { pointsSnap } from './feed'
import { TIMEFRAMES, type Candle, type Timeframe } from './market'

export type Point = { token: string; t: number; p: number }

const priceUpdatedAbi = registryAbi.filter((x) => x.type === 'event' && x.name === 'PriceUpdated')

/** A candle plus a marker for buckets in which the oracle reported nothing. */
export type ChartCandle = Candle & {
  /** Forward-filled: no oracle report landed in this bucket, so it repeats the previous close
   *  (o = h = l = c, v = 0). The price did not change as far as the chain knows. Never a fabricated move. */
  filled?: true
}

/** Number of candles that carry a real oracle report (not forward-filled). */
export const realCount = (candles: readonly ChartCandle[]) => candles.reduce((n, c) => n + (c.filled ? 0 : 1), 0)

/** Put candles on a regular time grid for `tf`.
 *
 *  Buckets without data are forward-filled with flat candles at the previous close, so the X axis is
 *  a true, evenly spaced time axis (a thin pool or an oracle only produces candles when something
 *  happened, so the raw candles are unevenly spread). The grid runs from the first candle (or the
 *  earliest bucket that fits in `limit`) up to the bucket containing `nowSec`; the last `limit`
 *  buckets are returned. Input candles keep their own OHLC and volume; only gaps are synthesised. */
export function fillGaps(candles: readonly ChartCandle[], tf: Timeframe, nowSec: number = Math.floor(Date.now() / 1000)): ChartCandle[] {
  const { sec, limit } = TIMEFRAMES[tf]
  const byBucket = new Map<number, ChartCandle>()
  for (const c of candles) {
    const t = Math.floor(c.t / sec) * sec
    byBucket.set(t, t === c.t ? c : { ...c, t })
  }
  const real = [...byBucket.values()].sort((a, b) => a.t - b.t)
  if (!real.length) return []

  const end = Math.max(real[real.length - 1].t, Math.floor(nowSec / sec) * sec)
  const start = Math.max(real[0].t, end - (limit - 1) * sec)
  // close carried into the window from before it (only differs from the first candle when older buckets were cut off)
  let prev = real[0].o
  for (const c of real) if (c.t < start) prev = c.c
  const out: ChartCandle[] = []
  for (let t = start; t <= end; t += sec) {
    const c = byBucket.get(t)
    if (c) {
      out.push(c)
      prev = c.c
    } else out.push({ t, o: prev, h: prev, l: prev, c: prev, v: 0, filled: true })
  }
  return out
}

/** Fold (timestamp, price) points into OHLC buckets of `tf`, then fill gaps (see `fillGaps`). */
export function foldCandles(points: Point[], tf: Timeframe, nowSec?: number): ChartCandle[] {
  const { sec } = TIMEFRAMES[tf]
  const byBucket = new Map<number, ChartCandle>()
  for (const pt of [...points].sort((a, b) => a.t - b.t)) {
    const t = Math.floor(pt.t / sec) * sec
    const c = byBucket.get(t)
    if (!c) byBucket.set(t, { t, o: pt.p, h: pt.p, l: pt.p, c: pt.p, v: 0 })
    else {
      c.h = Math.max(c.h, pt.p)
      c.l = Math.min(c.l, pt.p)
      c.c = pt.p
    }
  }
  return fillGaps([...byBucket.values()], tf, nowSec)
}

/** Raw price points for one asset. Folded into any timeframe client-side, so switching
 *  timeframe costs no extra RPC and per-timeframe availability is free to compute. */
export function useOraclePoints(token: `0x${string}` | undefined, enabled = true) {
  const client = usePublicClient({ chainId: arcTestnet.id })
  return useQuery({
    queryKey: ['oraclePoints', token?.toLowerCase()],
    enabled: Boolean(client && token && enabled),
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Point[]> => {
      // server-indexed history: one static file instead of a chunked eth_getLogs walk in the browser
      const snap = await pointsSnap()
      const series = snap?.series[token!.toLowerCase()]
      if (series) return series.map(([t, p]) => ({ token: token!.toLowerCase(), t, p })).filter((x) => x.p > 0)
      const { logs } = await scanLogs<Point>({
        key: 'registry:PriceUpdated',
        client: client as PublicClient,
        address: ADDR.registry,
        abi: priceUpdatedAbi,
        eventName: 'PriceUpdated',
        deployBlock: DEPLOY_BLOCK,
        needMore: (pts) => pts.length < 400,
        map: (l) => {
          const a = (l as { args?: { token?: string; priceE8?: bigint; observedAt?: bigint } }).args
          if (!a?.token || a.priceE8 === undefined || a.observedAt === undefined) return null
          return { token: a.token.toLowerCase(), t: Number(a.observedAt), p: Number(a.priceE8) / 1e8 }
        },
      })
      return logs.filter((p) => p.token === token!.toLowerCase() && p.p > 0)
    },
  })
}

/** Which timeframes can draw at least `min` REAL candles (distinct buckets that each hold an oracle
 *  report) from these points. Forward-filled candles do not count, so a timeframe that would be
 *  all filler stays disabled. */
export function viableTimeframes(points: Point[] | undefined, min = 2): Set<Timeframe> {
  const out = new Set<Timeframe>()
  if (!points?.length) return out
  for (const k of Object.keys(TIMEFRAMES) as Timeframe[]) {
    if (realCount(foldCandles(points, k)) >= min) out.add(k)
  }
  return out
}
