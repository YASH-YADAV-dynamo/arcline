// Typed access to the captured per-asset snapshots (src/data/market-snapshots.json). Display only:
// logos are self-hosted files and the pool numbers are dated, so nothing here is read as live.
// Refresh with `node ops/snapshot-markets.cjs`.
import raw from '@/data/market-snapshots.json'

/** One hourly candle in compact form: [unix seconds, close USD, volume USD]. */
export type SnapCandle = readonly [number, number, number]

export type MarketSnapshot = {
  icon: string | null
  pair: string | null
  dex: string | null
  priceUsd: number | null
  liquidityUsd: number | null
  volume24hUsd: number | null
  change24hPct: number | null
  candles: SnapCandle[]
}

const data = raw as unknown as { capturedAt: string; source: string; markets: Record<string, MarketSnapshot> }

export const SNAPSHOT_AT = data.capturedAt
export const snapshotOf = (display: string): MarketSnapshot | undefined => data.markets[display]
export const iconOf = (display: string): string | null => data.markets[display]?.icon ?? null
