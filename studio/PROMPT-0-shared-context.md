# Shared context pack — paste this block at the top of Prompts 8, 9 and 10

> Everything Arc Studio needs to know about the existing codebase, so it never has to read files to find it.
> Keep this in sync by hand if the code changes.

## Repo layout

```
app/
  src/
    App.tsx                     route switch (if-chain, falls through to <Landing/> — BUG, see P10)
    config.ts                   wagmi config
    lib/
      assets.ts                 useAssets() — reads AssetRegistry, returns ListedAsset[]
      contracts.ts              ADDR map + ABIs + DEPLOY_BLOCK + USDC_EURC_POOL
      prices.ts                 usePriceBook() — THE price book (last/ref/deviation)
      market.ts                 GeckoTerminal fetch + useOhlcv/useCandles/fetchMarket
      format.ts                 usd(), compactUsd() etc — the ONLY formatter
      router.tsx                tiny hash router: useRoute(), navigate(), <Link>
      tx.ts                     useTx() — write + toast + receipt
      share.ts                  getShareBase/buildShareLink/installShareSync (Arc Studio)
    pages/                      Landing, Markets, Trade, Portfolio, BucketNew, BucketDetail
    components/
      Shell.tsx
      shell/                    TopBar, Footer, MobileTabs, TickerTape, ThemeToggle,
                                WalletControls, ConnectNotice, nav.ts
      trade/                    CandleChart, ChartPanel, OrderTicket, MarketList,
                                BottomTabs, PriceChart, hooks.ts, favs.ts, ui.tsx
      markets/                  MarketsTable, OverviewStrip, Sparkline, ui.tsx
      bucket/                   data.ts + views
  contracts/                    Foundry sources (see ABI facts below)
cre/price-guard/main.ts         Chainlink CRE workflow (cron 5m, prices + risk)
```

## Chain + token facts

- Arc Testnet, chain id **5042002**, imported from `viem/chains` as `arcTestnet`.
- USDC `0x3600000000000000000000000000000000000000`, **6 decimals**, ERC-20 interface.
  Never read the native 18-decimal balance for USDC.
- EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`.
- Explorer: `https://explorer.testnet.arc.io/address/<addr>` and `/tx/<hash>`.

## `src/lib/contracts.ts` — exact contents (GENERATED from `contracts/out`; do not hand-edit ABIs)

Exports: `ADDR`, `DEPLOY_BLOCK`, `USDC_EURC_POOL`, `registryAbi`, `templatesAbi`, `factoryAbi`,
`bucketAbi`, `venueAbi`, `v4QuoterAbi`. **Those are the only exports — there is no `bucketAbi`
alias, no `creReceiverAbi`, and `ADDR` has exactly these nine keys:**

```ts
export const ADDR = {
  registry:    "0x79E37808c2187B949D36c0295C7947154CD85A47",
  templates:   "0xb46DD5FA830b43031f3FF907634963F158D840a5",
  factory:     "0x6677b355ca5c21c77198bfe62d223d3e8fc23875",
  uniVenue:    "0x767f4a602d1944409482f57aad56fd5696586208",
  mirrorVenue: "0xBaF806f5a0020F97ACB16f9f7501495b1473B7a7",
  usdc:        "0x3600000000000000000000000000000000000000",
  eurc:        "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  v4Quoter:    "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  v4StateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
} as const satisfies Record<string, `0x${string}`>

export const DEPLOY_BLOCK = 70998886n
export const USDC_EURC_POOL = {
  currency0: ADDR.usdc, currency1: ADDR.eurc,
  fee: 500, tickSpacing: 10, hooks: "0x0000000000000000000000000000000000000000",
} as const
```

Contracts deployed but **not** in `ADDR` (add a key if you need one):
CreReceiver `0x97f154f7991948bcd218e96300a50b053eec04dd`,
ArcTreasuryCore `0x1dcb59c9afab2e0f660206a9c8233454d6e3a6fc`,
BucketAccount impl `0x97dc3f2d27e8054c982c71e40db4bce315496554`,
MirrorTokenBatch `0x6b12ce46563c92ebf9148dd33e41cba9699c24f2`,
SeedRelay `0xf1f34a52f70325581736aa5f4ad60423471460a1`.

Confirmed present in `registryAbi`: `maxStaleness`, `riskOf`, `PriceUpdated`, and in `venueAbi`:
`Swapped`. The pool fee is **500 (0.05%)**, not 3000.

## Contract facts you will rely on

`AssetRegistry` (verified in source):
```solidity
uint64 public maxStaleness = 3600;              // public getter — read it, never hardcode
mapping(address => bool) public reporters;      // additive; multiple reporters allowed
function setReporter(address reporter, bool allowed) external onlyOwner;
function isReporter(address reporter) external view returns (bool);
function assets() external view returns (address[] memory);
function assetOf(address) external view returns (Asset memory);
function riskOf(address) external view returns (uint8);
function priceE8(address) external view returns (uint256 price, uint64 observedAt); // REVERTS when stale
function onReport(bytes calldata, bytes calldata report) external;  // reporters only
```

Events (from `contracts/IArcTreasury.sol`):
```solidity
event AssetListed(address indexed token, string symbol, Category category, address venue, bool mirror);
event PriceUpdated(address indexed token, uint256 priceE8, uint64 observedAt);   // <- chart tier 3
event RiskUpdated(address indexed token, uint8 level, bytes32 evidenceHash);
event ReporterSet(address indexed reporter, bool allowed);
event Swapped(address indexed caller, address indexed tokenIn, address indexed tokenOut,
              uint256 amountIn, uint256 amountOut);
event Deposited(address indexed from, uint256 usdcAmount);
event Withdrawn(address indexed to, address indexed token, uint256 amount);
event TargetsSet(address[] tokens, uint16[] weightsBps, uint256 templateId, uint32 templateVersion);
event Rebalanced(address indexed caller, uint256 valueBeforeE18, uint256 valueAfterE18,
                 uint16 maxDriftBps, uint256 tipUsdc);
event TradeExecuted(address indexed tokenIn, address indexed tokenOut,
                    uint256 amountIn, uint256 amountOut, address venue);
event SipSet(uint256 amountUsdc, uint32 interval, uint32 runsLeft);
event SipExecuted(address indexed caller, uint256 amountUsdc, uint32 runsLeft);
event BucketCreated(address indexed owner, address indexed bucket, uint256 templateId, string name);
```

Venues are **swap-only** — there is no LP management on either:
```solidity
function name() external pure returns (string memory);
function quote(address tIn, address tOut, uint256 amtIn) external view returns (uint256 out);
function swap(address tIn, address tOut, uint256 amtIn, uint256 minOut, address to) external returns (uint256);
```
`UniswapV4Venue.quote()` **always reverts** for EURC — quote through the v4 Quoter instead
(`ADDR.v4Quoter`, `quoteExactInputSingle`, via `simulateContract` not `readContract`).

## Existing types you must reuse, not redefine

```ts
// src/lib/assets.ts
export const CATEGORIES = ['Cash', 'FX', 'Crypto', 'Yield', 'RWA'] as const
export type Category = (typeof CATEGORIES)[number]
export type ListedAsset = {
  token: `0x${string}`; symbol: string; display: string; category: Category
  decimals: number; venue: `0x${string}`; mirror: boolean; mainnetRef: string
  priceE8: bigint | null      // null = stale/unset -> trading disabled
  observedAt: number | null
  risk: number                // 0 ok, 1 watch, 2 no buys, 3 exit
}

// src/lib/prices.ts
export type PriceRow = {
  asset: ListedAsset
  last: number | null; oracleAgeSec: number | null; stale: boolean
  ref: MarketStat | null; refToken: string | null
  change24h: number | null    // percent
  deviation: number | null    // fraction
}

// src/lib/market.ts
export type MarketStat = { priceUsd: number|null; change24h: number|null; volume24h: number|null; liquidityUsd: number|null; topPool: string|null }
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }
export type Timeframe = '15m' | '1H' | '4H' | '1D'
export const TIMEFRAMES: Record<Timeframe, { res: 'minute'|'hour'|'day'; agg: number; limit: number; sec: number }>

// src/components/trade/hooks.ts
export type Side = 'buy' | 'sell'
export const isV4 = (a: ListedAsset) => boolean          // EURC on the real v4 pool
export const isMirrorVenue = (a: ListedAsset) => boolean
export const isUsdc = (a: string) => boolean
export function revertReason(e: unknown): string         // decodes custom errors
export function ago(sec: number | null): string
export const RISK_LABEL = ['OK','Watch','No buys','Exit'] as const
export const RISK_TONE  = ['text-up','text-warn','text-down','text-down'] as const
```

## Theme tokens already defined

`--up --down --warn --muted --faint --ink --line --panel --panel2 --onaccent`, consumed as
`rgb(var(--up))` in SVG and `text-up` / `bg-panel2` / `border-line` in Tailwind.
Dark is default; `.light` on `<html>` flips it. `.num` = tabular monospace numerals.

## The RPC constraints that shape every data hook

These are not style preferences — violating them breaks the app on the public Arc Testnet RPC:

1. **`eth_getLogs` rejects ranges above 10,000 blocks** ("requested range too large"). Scan in
   `10_000n` chunks.
2. **Bursts are rate-limited.** Serialise chunk reads behind a module-level promise lock; never
   fire 12 parallel log queries.
3. **Batch reads through Multicall3** (`client.multicall`), as `useTokenBalances` already does.
4. **GeckoTerminal public API rate-limits per IP** and returns 429 *without CORS headers*, so it
   surfaces as a network error, not a status code. Serialise ~400ms apart and back off.

The proven pattern lives in `useRecentSwaps` (`src/components/trade/hooks.ts`). Prompts 8 and 10
both need it; **extract it once** into `src/lib/scan.ts` and have both callers share it:

```ts
// src/lib/scan.ts — ONE chunked, serialised, session-cached log scanner for the whole app.
import type { PublicClient, Abi } from 'viem'

const CHUNK = 10_000n
type Cache = { from: bigint | null; to: bigint | null; logs: unknown[] }
const caches = new Map<string, Cache>()
let lock: Promise<unknown> = Promise.resolve()

/** Scan `key`'s event range forward from the last scan, then backward toward `deployBlock`
 *  while `needMore(logs)` is true. Serialised across all callers. */
export async function scanLogs<T>(opts: {
  key: string
  client: PublicClient
  address: `0x${string}` | `0x${string}`[]
  abi: Abi
  eventName: string
  deployBlock: bigint
  maxBackPerFetch?: number
  needMore: (logs: T[]) => boolean
  map: (log: unknown) => T | null
}): Promise<{ logs: T[]; scannedFrom: bigint; complete: boolean }> {
  const c = caches.get(opts.key) ?? { from: null, to: null, logs: [] }
  caches.set(opts.key, c)
  const run = lock.then(async () => {
    const latest = await opts.client.getBlockNumber()
    let to = c.to ?? latest
    let from = c.from ?? latest + 1n
    c.to = to; c.from = from
    const read = async (f: bigint, t: bigint) => {
      const got = await opts.client.getContractEvents({
        address: opts.address as never, abi: opts.abi, eventName: opts.eventName as never,
        fromBlock: f, toBlock: t,
      })
      for (const l of got) { const m = opts.map(l); if (m) c.logs.push(m) }
    }
    while (to < latest) {
      const f = to + 1n
      const t = f + CHUNK - 1n < latest ? f + CHUNK - 1n : latest
      await read(f, t); c.to = to = t
    }
    const cap = opts.maxBackPerFetch ?? 12
    for (let n = 0; from > opts.deployBlock && opts.needMore(c.logs as T[]) && n < cap; n++) {
      const t = from - 1n
      const f = t - CHUNK + 1n > opts.deployBlock ? t - CHUNK + 1n : opts.deployBlock
      await read(f, t); c.from = from = f
    }
  })
  lock = run.catch(() => undefined)
  await run
  return {
    logs: c.logs as T[],
    scannedFrom: c.from ?? opts.deployBlock,
    complete: (c.from ?? opts.deployBlock) <= opts.deployBlock,
  }
}
```

---

## Non-negotiable contract for every turn

### A. Do not break what works

Before you finish, all of these must still be true. Check them, do not assume them.

- [ ] Wallet connects via EIP-6963 injected provider; the network pill shows Arc Testnet.
- [ ] `#/`, `#/markets`, `#/trade/EURC`, `#/portfolio`, `#/buckets/new`, `#/buckets/0x…` all render.
- [ ] A EURC buy and a EURC sell both quote and execute on the v4 venue.
- [ ] A mirror-asset buy and sell both quote and execute on MirrorVenue.
- [ ] Bucket create → deposit → rebalance → SIP still work.
- [ ] `bun run typecheck` clean, `bun run lint` clean, `bun run contracts:test` green.
- [ ] Dev server still on `--host 0.0.0.0 --port 5173` (do **not** restart with plain `bun run dev`).
- [ ] No new npm package in `package.json`.
- [ ] `installShareSync()` still called in `src/main.tsx`; links still built with `buildShareLink()`.

### B. Responsive, at four widths

Verify each change at **360, 768, 1280 and 1920px**. Every one of these must hold:

- [ ] **No horizontal page scroll at 360px.** Test it; do not eyeball it.
- [ ] Tables never scroll sideways on a phone — columns drop out and rows become two-line cards.
- [ ] Touch targets ≥ 44px below `md`.
- [ ] 16px side gutter at phone width, 24px above.
- [ ] The mobile bottom tab bar never covers content or the "Built with Arc Studio" badge.
- [ ] Charts resize via `ResizeObserver` (never a fixed pixel width) and stay legible at 360px.
- [ ] Modals and sheets are focus-trapped, close on `Escape`, and lock background scroll.
- [ ] Long values (addresses, big numbers, asset names) truncate with `title`, never overflow.
- [ ] `prefers-reduced-motion` disables the ticker marquee and every flash animation.
- [ ] Nothing layout-shifts when data arrives — skeletons match final dimensions.

### C. Honesty rules (these are product requirements, not style)

- Never render an invented number. Unknown is `—`.
- Every price shows its provenance: `cre` / `keeper` / `pool` / `unit`.
- Mirror assets stay badged **MIRROR**; EURC and USDC stay **REAL**.
- No profit, return, APY projection or performance claim anywhere.
- A control that cannot do anything must not exist. Use `UnavailableState`, never a dead button.
