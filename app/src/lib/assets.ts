// Listed assets from the on-chain AssetRegistry, with on-chain price/risk. One hook for the whole app.
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { ADDR, registryAbi } from './contracts'
import { liveStatus } from './live'

export const CATEGORIES = ['Cash', 'FX', 'Crypto', 'Yield', 'RWA'] as const
export type Category = (typeof CATEGORIES)[number]

export type ListedAsset = {
  token: `0x${string}`
  symbol: string          // on-chain symbol, e.g. "cirBTC.m"
  display: string         // without the ".m" suffix, e.g. "cirBTC"
  category: Category
  decimals: number
  venue: `0x${string}`
  mirror: boolean         // true = testnet mirror priced from Arc mainnet
  mainnetRef: string      // mainnet token address ('' for real testnet assets)
  priceE8: bigint | null  // null = stale or never set (trading disabled)
  observedAt: number | null
  risk: number            // 0 ok, 1 watch, 2 no buys, 3 exit
}

/** Plain-language names for the assets (UI only). */
export const ASSET_NAME: Record<string, string> = {
  USDC: 'USD Coin', EURC: 'Euro Coin', cirBTC: 'Bitcoin (Circle)', WETH: 'Ether', GBPA: 'British Pound',
  syrupUSDC: 'Yield-bearing USDC', XAUM: 'Gold (Matrixdock)', ASTOCK: 'ArcStocks index',
}

export function useAssets() {
  const client = usePublicClient({ chainId: arcTestnet.id })
  return useQuery({
    queryKey: ['assets'],
    enabled: Boolean(client),
    // The WebSocket patches prices and risk as they land (lib/live.ts), so polling is only a safety net.
    refetchInterval: () => (liveStatus() === 'live' ? 120_000 : 30_000),
    queryFn: async (): Promise<ListedAsset[]> => {
      const c = client!
      const tokens = await c.readContract({ address: ADDR.registry, abi: registryAbi, functionName: 'assets' })
      // One multicall (Multicall3 is deployed on Arc Testnet) instead of three calls per token: the
      // public RPC rate-limits bursts, and this list gates every price, table and chart in the app.
      const calls = tokens.flatMap((t) => [
        { address: ADDR.registry, abi: registryAbi, functionName: 'assetOf', args: [t] } as const,
        { address: ADDR.registry, abi: registryAbi, functionName: 'riskOf', args: [t] } as const,
        { address: ADDR.registry, abi: registryAbi, functionName: 'priceE8', args: [t] } as const,
      ])
      const res = await c.multicall({ contracts: calls, allowFailure: true })
      return tokens.flatMap((t, i) => {
        const [meta, risk, price] = [res[i * 3], res[i * 3 + 1], res[i * 3 + 2]]
        if (meta.status !== 'success') return []
        const a = meta.result as { symbol: string; category: number; decimals: number; venue: `0x${string}`; mirror: boolean; mainnetRef: string }
        // priceE8 reverts when the price is stale or unset: trading stays disabled for that asset
        const p = price.status === 'success' ? (price.result as readonly [bigint, bigint]) : null
        return [{
          token: t,
          symbol: a.symbol,
          display: a.symbol.replace(/\.m$/, ''),
          category: CATEGORIES[Number(a.category)] ?? 'Cash',
          decimals: Number(a.decimals),
          venue: a.venue,
          mirror: a.mirror,
          mainnetRef: a.mainnetRef,
          priceE8: p ? p[0] : null,
          observedAt: p ? Number(p[1]) : null,
          risk: risk.status === 'success' ? Number(risk.result) : 0,
        }]
      })
    },
  })
}

export const findAsset = (list: ListedAsset[] | undefined, key: string | undefined) =>
  list?.find((a) => a.display.toLowerCase() === key?.toLowerCase() || a.token.toLowerCase() === key?.toLowerCase())
