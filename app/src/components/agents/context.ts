// Agent context: a JSON snapshot of the live registry, plus the copy-paste Node snippets shown on #/agents.
import type { ListedAsset } from '@/lib/assets'
import { ADDR } from '@/lib/contracts'

export type AgentContext = {
  chainId: number
  registry: string
  venues: { uniswapV4: string; mirror: string }
  assets: {
    symbol: string
    display: string
    category: string
    token: string
    mirror: boolean
    priceE8: string | null // null = stale or never set (trading disabled)
    observedAt: number | null // unix seconds; null = unknown
    risk: number // 0 ok, 1 watch, 2 no buys, 3 exit
    venue: string
  }[]
  generatedAt: string
}

export function buildAgentContext(list: ListedAsset[]): AgentContext {
  return {
    chainId: 5042002,
    registry: ADDR.registry,
    venues: { uniswapV4: ADDR.uniVenue, mirror: ADDR.mirrorVenue },
    assets: list.map((a) => ({
      symbol: a.symbol,
      display: a.display,
      category: a.category,
      token: a.token,
      mirror: a.mirror,
      priceE8: a.priceE8 === null ? null : a.priceE8.toString(),
      observedAt: a.observedAt,
      risk: a.risk,
      venue: a.venue,
    })),
    generatedAt: new Date().toISOString(),
  }
}

export const READ_SNIPPET = `// npm i viem   (ESM, Node 18+)
import { createPublicClient, http, parseAbi } from 'viem'
import { arcTestnet } from 'viem/chains'

const REGISTRY = '${ADDR.registry}'
const abi = parseAbi([
  'function assets() view returns (address[])',
  'function assetOf(address) view returns ((address token, string symbol, uint8 category, uint8 decimals, address venue, bool mirror, string mainnetRef))',
  'function priceE8(address) view returns (uint256 price, uint64 observedAt)', // reverts StalePrice when the price is stale
  'function riskOf(address) view returns (uint8)',                           // 0 ok, 1 watch, 2 no buys, 3 exit
])
const client = createPublicClient({ chain: arcTestnet, transport: http('https://rpc.testnet.arc.io') })
const read = (functionName, args) => client.readContract({ address: REGISTRY, abi, functionName, args })

async function snapshot() {
  const tokens = await read('assets')
  return Promise.all(tokens.map(async (t) => {
    const a = await read('assetOf', [t])
    let price = null, observedAt = null
    try { [price, observedAt] = await read('priceE8', [t]) } catch { /* stale: trading disabled */ }
    return { token: t, symbol: a.symbol, price: price === null ? null : Number(price) / 1e8, observedAt, risk: await read('riskOf', [t]) }
  }))
}

// Watch for new listings: a new token address is a new market (ticket).
const seen = new Set((await snapshot()).map((a) => a.token))
setInterval(async () => {
  for (const a of await snapshot()) {
    if (!seen.has(a.token)) { seen.add(a.token); console.log('TICKET', a.symbol, 'detected') }
  }
}, 30_000)`

export const RUN_SNIPPET = `# 1. save the downloaded .env next to the script (never commit it)
# 2. run the example agent from the repo root
export $(grep -v '^#' agent.env | xargs)
node ops/agent-example.cjs 30                  # list markets, poll every 30s for new listings
node ops/agent-example.cjs 30 --basket 0xYourBasket   # also rebalance that basket when the contract allows it`
