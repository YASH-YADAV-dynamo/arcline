// One hook, two tiers, callers never know which won.
//
//   tier 1 "arc"     Arc mainnet pool candles from GeckoTerminal (best chart when it exists).
//   tier 2 "onchain" AssetRegistry.PriceUpdated history (always exists once prices are reported).
//
// GeckoTerminal has an indexed Arc-mainnet pool for only some mirror refs — for the rest it returns
// a price but zero pools, so tier 1 is permanently empty for them and tier 2 is the only chart.
// Tier 1 still wins when available: real market data makes a better chart than an oracle series.
import { useMemo } from 'react'
import { TIMEFRAMES, useOhlcv, type Timeframe } from './market'
import { fillGaps, foldCandles, realCount, useOraclePoints, viableTimeframes, type ChartCandle } from './candles'
import type { PriceRow } from './prices'
import { SNAPSHOT_AT, snapshotOf } from './market-snapshots'

export type ChartSource = 'arc' | 'onchain'
export type ChartSeries = {
  /** oldest first. On-chain series are on a regular time grid; `filled` candles are gaps carried at the previous close. */
  candles: ChartCandle[]
  source: ChartSource | null
  label: string
  showVolume: boolean
  loading: boolean
  /** true when tier 1 had no pool at all, so the UI can say why it fell back */
  noMainnetPool: boolean
  /** timeframes that can actually draw. The UI disables the rest instead of showing an
   *  empty chart — on a young testnet, 1D often has only one candle. */
  viable: Set<Timeframe>
  /** the timeframe actually drawn; may differ from the requested one when that cannot draw */
  tf: Timeframe
  /** true while showing the bundled snapshot because live data has not arrived yet */
  placeholder?: boolean
}

/** Bundled hourly closes (src/data/market-snapshots.json) folded to a timeframe, so a chart can draw
 *  on first paint instead of after the network round trips. Closes only: each candle opens at the
 *  previous close, so there are no invented wicks. Not for 15m (the snapshot is hourly). */
function snapshotCandles(display: string, tf: Timeframe): ChartCandle[] {
  const snap = snapshotOf(display)
  if (!snap?.candles.length || tf === '15m') return []
  const sec = TIMEFRAMES[tf].sec
  const out: ChartCandle[] = []
  let prev = snap.candles[0][1]
  for (const [t, c, v] of snap.candles) {
    const b = Math.floor(t / sec) * sec
    const last = out[out.length - 1]
    if (last && last.t === b) {
      last.c = c
      last.h = Math.max(last.h, c)
      last.l = Math.min(last.l, c)
      last.v += v
    } else out.push({ t: b, o: prev, h: Math.max(prev, c), l: Math.min(prev, c), c, v })
    prev = c
  }
  return out
}
const SNAP_DAY = new Date(SNAPSHOT_AT).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function useChartSeries(row: PriceRow, tf: Timeframe): ChartSeries {
  const a = row.asset
  const pool = row.ref?.topPool ?? null
  const t1 = useOhlcv(pool, tf, row.refToken)
  // only scan events when the external series is unusable, to keep RPC load down
  const needOracle = (t1.data?.length ?? 0) < 2 && !t1.isLoading
  const pts = useOraclePoints(a.token, needOracle)

  const onchainViable = useMemo(() => viableTimeframes(pts.data), [pts.data])
  // if the requested timeframe cannot draw, fall back to the longest that can — derived during
  // render, so no effect and no cascading re-render
  const effTf = useMemo<Timeframe>(() => {
    if (onchainViable.size === 0 || onchainViable.has(tf)) return tf
    return (Object.keys(TIMEFRAMES) as Timeframe[]).filter((k) => onchainViable.has(k)).pop() ?? tf
  }, [onchainViable, tf])
  const onchain = useMemo(() => foldCandles(pts.data ?? [], effTf), [pts.data, effTf])
  const noMainnetPool = !pool
  // external pools only print candles for periods with trades; carry the last close through the quiet ones
  const arcCandles = useMemo(() => fillGaps(t1.data ?? [], tf), [t1.data, tf])

  if ((t1.data?.length ?? 0) >= 2) {
    return {
      candles: arcCandles,
      source: 'arc',
      label: `Arc mainnet ${a.display}/USDC (deepest pool)`,
      showVolume: true,
      loading: false,
      noMainnetPool: false,
      // the external series is fetched per timeframe, so assume all are available
      viable: new Set(Object.keys(TIMEFRAMES) as Timeframe[]),
      tf,
    }
  }
  // forward-filled gap candles are not data: only real oracle reports count toward drawing a chart
  if (realCount(onchain) >= 2) {
    return {
      candles: onchain,
      source: 'onchain',
      label: 'On-chain oracle history (AssetRegistry price reports)',
      showVolume: false,
      loading: false,
      noMainnetPool,
      viable: onchainViable,
      tf: effTf,
    }
  }
  const loading = t1.isLoading || pts.isLoading
  const snap = loading ? snapshotCandles(a.display, tf) : []
  if (snap.length >= 2) {
    return {
      candles: snap,
      source: 'arc',
      label: `Arc mainnet snapshot from ${SNAP_DAY}, loading live data`,
      showVolume: true,
      loading: false,
      noMainnetPool: false,
      viable: new Set(Object.keys(TIMEFRAMES) as Timeframe[]),
      tf,
      placeholder: true,
    }
  }
  return {
    candles: [],
    source: null,
    label: '',
    showVolume: false,
    loading: t1.isLoading || pts.isLoading,
    noMainnetPool,
    viable: onchainViable,
    tf: effTf,
  }
}
