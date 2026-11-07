# Turn 8: kill stale prices, make the chart always render, and make trading work end to end

> **Read `PROMPT-0-shared-context.md` first** — repo map, contract facts, existing types, RPC
> constraints, and the regression + responsive checklists for this turn. Everything you need is in
> these two files. Do not spend context exploring the repo.

Three things are broken for a visitor who opens the app cold:

1. **Prices go stale.** `AssetRegistry.priceE8` reverts past `maxStaleness` (1h), so `useAssets()` stores `priceE8: null`, `usePriceBook()` marks the row `stale`, and the ticket refuses to trade. The only writer today is the CRE workflow run by hand with `cre workflow simulate … --broadcast`. Nobody is running it, so within an hour of the last manual run the whole exchange is dead.
2. **The chart is blank for almost every market.** `ChartBody` charts `row.ref.topPool`, which comes from `findMainnetToken(symbol)` searching **Arc mainnet** pools whose base token has a CoinGecko listing. `cirBTC`, `GBPA`, `XAUM`, `ASTOCK`, `syrupUSDC` have no such Arc mainnet pool, so `pool === null` → "No Arc mainnet market". When GeckoTerminal 429s, `fetchMarket` returns nulls and the same thing happens to EURC and WETH.
3. **A new wallet cannot complete a trade.** There is no path from "connected, 0 balance" to "filled order", and failures surface as raw reverts.

Fix all three. Frontend + one small contract addition only.

## Hard rules
- Do not redeploy `AssetRegistry`, `BucketFactory`, `BucketAccount`, `UniswapV4Venue` or `MirrorVenue`. The only new contract is `OracleKeeper` in §1.3, and it must be optional — the app works without it.
- Do not add npm packages. Use the existing `@tanstack/react-query`, `wagmi`, `viem`, `lucide-react`.
- Never invent a number. Every price, candle and age on screen carries its provenance. If something is unknown it is `—`, never a guess, never an interpolation.
- Keep the single price book: `src/lib/prices.ts` stays the one source for `last` / `ref` / `deviation`. Components read rows; they do not fetch prices.
- Keep hash routes and the existing theme tokens.
- Finish with `bun run typecheck` and `bun run lint` clean, and leave the dev server up on `--host 0.0.0.0 --port 5173`.

---

## 1. Prices that do not go stale

### 1.1 Pin what is knowable without an oracle
- **USDC is the unit of account.** Stop treating it as an oracle asset in the UI: its price is exactly `1.00` by definition, labelled `unit`. It must never render "stale" and must never block a trade.
- **EURC already has an on-chain truth**: the Uniswap v4 USDC/EURC pool on Arc Testnet via `StateView.getSlot0` (`usePoolPrice` in `src/components/trade/hooks.ts`). Promote it from a reference line to a **fallback last price**: when the registry price for EURC is stale, show the pool mid as `last`, tagged `source: pool`. This is a real on-chain price from the venue the trade actually settles on, so it is honest to display — but note in the tooltip that the *contract* still requires a fresh registry price to execute, and keep the ticket disabled until §1.3 refreshes it.

### 1.2 Make staleness visible and actionable instead of silent
```ts
// src/lib/oracle.ts
import { useQuery } from '@tanstack/react-query'
import { useReadContract } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { ADDR, registryAbi } from './contracts'
import { useAssets } from './assets'

export type PriceSource = 'cre' | 'keeper' | 'pool' | 'unit'
export type AssetHealth = {
  token: `0x${string}`; display: string
  ageSec: number | null; secondsToStale: number | null
  state: 'fresh' | 'aging' | 'stale'; source: PriceSource
}

export function useOracleHealth() {
  const assets = useAssets()
  // read it, never hardcode 3600 — AssetRegistry.maxStaleness is a public getter
  const max = useReadContract({
    address: ADDR.registry, abi: registryAbi, functionName: 'maxStaleness',
    chainId: arcTestnet.id, query: { staleTime: 300_000 },
  })
  const maxStaleness = Number(max.data ?? 3600n)
  const now = Math.floor(Date.now() / 1000)

  const list: AssetHealth[] = (assets.data ?? []).map((a) => {
    if (a.display === 'USDC') return { token: a.token, display: a.display, ageSec: 0, secondsToStale: null, state: 'fresh', source: 'unit' }
    const ageSec = a.observedAt ? Math.max(0, now - a.observedAt) : null
    const left = ageSec === null ? null : maxStaleness - ageSec
    const state = a.priceE8 === null || left === null || left <= 0 ? 'stale'
      : left < maxStaleness * 0.2 ? 'aging' : 'fresh'
    return { token: a.token, display: a.display, ageSec, secondsToStale: left, state, source: 'cre' }
  })

  return {
    maxStaleness, list,
    staleCount: list.filter((x) => x.state === 'stale').length,
    worst: list.reduce<AssetHealth | null>((w, x) => (!w || (x.ageSec ?? 0) > (w.ageSec ?? 0) ? x : w), null),
    isLoading: assets.isLoading || max.isLoading,
  }
}
```

`source` starts as `'cre'` and is refined once §1.3 lands: read the most recent of `CreReceiver`'s
and `OracleKeeper`'s `KeeperPrice` events per token (via the shared `scanLogs`) to decide between
`'cre'` and `'keeper'`.

Then surface it:
- **Footer status bar** (already exists): replace the static "oracle age" with a live countdown — `Oracle · 12 of 12 fresh · oldest 41m · stale in 19m`. Amber at `aging`, red at `stale`.
- **Pair header + route panel**: when a row is stale, the `Last · oracle` cell shows the last known price struck through with the time it was observed, not the word "stale" alone. A user needs to know *what* the last price was and *when*, not just that it expired.
- **Order ticket**: a stale asset gets a blocking banner with the reason and the refresh action from §1.3, not a dead greyed-out button.

### 1.3 A keeper so prices refresh without a human
The CRE workflow stays the primary, signed, decentralised writer. Add a **backup** writer for when no DON run has landed, so a judge opening the app at 3am still sees a live exchange.

New contract `contracts/OracleKeeper.sol`. `AssetRegistry.reporters` is a mapping and `setReporter`
is additive, so this is added **alongside** `CreReceiver`, never replacing it.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IRegistry {
    function onReport(bytes calldata metadata, bytes calldata report) external;
    function priceE8(address token) external view returns (uint256 price, uint64 observedAt);
}

/// @notice Liveness backstop for AssetRegistry prices when no CRE report has landed.
/// @dev NOT a trust upgrade: bounded freshness and a max jump mean a compromised keeper
///      cannot print an arbitrary price. The DON remains the real feed.
contract OracleKeeper {
    address public immutable registry;
    address public owner;
    address public keeper;
    bool    public paused;
    uint16  public maxJumpBps = 1000;      // 10% vs the stored price
    uint64  public maxBackdate = 15 minutes;

    event KeeperPrice(address indexed token, uint256 priceE8, uint64 observedAt);
    event KeeperSet(address indexed keeper);
    event PausedSet(bool paused);

    error NotOwner(); error NotKeeper(); error Paused();
    error BadTime(); error JumpTooLarge(address token, uint256 prev, uint256 next);
    error LengthMismatch();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(address registry_, address keeper_) {
        registry = registry_; owner = msg.sender; keeper = keeper_;
    }

    function setKeeper(address k) external onlyOwner { keeper = k; emit KeeperSet(k); }
    function setPaused(bool p) external onlyOwner { paused = p; emit PausedSet(p); }
    function setLimits(uint16 jumpBps, uint64 backdate) external onlyOwner {
        maxJumpBps = jumpBps; maxBackdate = backdate;
    }

    function postPrices(address[] calldata tokens, uint256[] calldata pricesE8, uint64 observedAt) external {
        if (msg.sender != keeper) revert NotKeeper();
        if (paused) revert Paused();
        if (tokens.length != pricesE8.length) revert LengthMismatch();
        // never future-dated, never older than maxBackdate
        if (observedAt > block.timestamp || observedAt + maxBackdate < block.timestamp) revert BadTime();

        for (uint256 i; i < tokens.length; ++i) {
            (uint256 prev, ) = _lastPrice(tokens[i]);
            if (prev != 0) {
                uint256 next = pricesE8[i];
                uint256 diff = next > prev ? next - prev : prev - next;
                if (diff * 10_000 > prev * maxJumpBps) revert JumpTooLarge(tokens[i], prev, next);
            }
            emit KeeperPrice(tokens[i], pricesE8[i], observedAt);
        }
        // same report shape AssetRegistry.onReport already decodes for kind 1
        IRegistry(registry).onReport("", abi.encode(uint8(1), abi.encode(tokens, pricesE8, observedAt)));
    }

    /// @dev priceE8 reverts when stale; treat that as "no previous price" so a stale asset
    ///      can always be revived, while a fresh one stays jump-bounded.
    function _lastPrice(address token) private view returns (uint256 price, uint64 at) {
        try IRegistry(registry).priceE8(token) returns (uint256 p, uint64 a) { return (p, a); }
        catch { return (0, 0); }
    }
}
```

Deploy, then `AssetRegistry.setReporter(<OracleKeeper>, true)` from the owner. Write Foundry tests
proving: a future-dated write reverts, a 15-minute-old write reverts, an 11% jump reverts, a 9%
jump succeeds, and a stale asset can be revived at any price.

Wire it up:
- `src/lib/contracts.ts`: add `ADDR.oracleKeeper` and `oracleKeeperAbi`. If the address is unset, every keeper code path must no-op — the app must build and run with no keeper deployed.
- Add `scripts/keeper.ts` (bun): reads the same GeckoTerminal `/tokens/multi` batch the CRE workflow uses, signs with `KEEPER_PRIVATE_KEY` **read from the environment only** (never committed, never in a config file, never logged — redact it in any error output), and calls `postPrices` every 2 minutes. Add `bun run keeper` to `package.json`. Document in the README that this is a hackathon liveness backstop and that the DON is the real feed.
- **Provenance in the UI is mandatory.** Every price carries `source: 'cre' | 'keeper' | 'pool' | 'unit'`. Read the most recent of `CreReceiver`'s and `OracleKeeper`'s events per token to decide. The footer and the route panel both name the source. A keeper-sourced price must visibly say so — a centralised backstop presented as a Chainlink price would be a lie about the trust model.

### 1.4 Stop GeckoTerminal from being a single point of failure
`src/lib/market.ts` currently throws to `null` on any non-200 and the UI degrades to empty.
- Keep the 60s cache and the 400ms serialised queue, but make the cache **persist to `sessionStorage`** so a reload does not restart from zero and immediately get rate-limited.
- Widen the stale-while-error window: on failure, serve a cached entry up to 30 minutes old and mark the row `delayed` with its age, rather than returning `null`. Delayed reference data is still useful; missing reference data erases the chart.
- Add a `429` backoff that is shared across all in-flight paths (one global cooldown timestamp), so a burst of 12 asset queries does not each burn their own retries.

---

## 2. A chart that always renders

The chart must never be empty on a listed market. Build a three-tier fallback in `src/lib/market.ts` + a new `src/lib/candles.ts`, and have `ChartBody` consume one hook that hides which tier won.

### Tier 1 — Arc mainnet pool (today's path, keep it)
Fix the discovery so it stops failing silently:
- `findMainnetToken` requires the pool name to start with `SYMBOL /`. Also accept the symbol on the **quote** side (`/ SYMBOL`) and set a `invert: true` flag so prices are flipped. Many real pools are quoted the other way round.
- The CoinGecko-listing filter rejects legitimate tokens that GeckoTerminal has not linked yet. Keep it as a *ranking* signal, not a hard filter: prefer listed tokens, but fall back to the deepest unlisted pool above $50k reserve rather than returning `null`.

### Tier 2 — an explicit reference map, cross-network
Mirror assets are mirrors *of something real*. Hardcode what they mirror in `src/lib/assets.ts`:

```ts
// What each mirror asset tracks, for reference pricing and charts only.
// GeckoTerminal network slug + token address. Never used for settlement.
export const MIRROR_REF: Record<string, { network: string; token: string; label: string }> = {
  cirBTC:    { network: 'eth', token: '<WBTC mainnet>',  label: 'WBTC / Ethereum' },
  WETH:      { network: 'eth', token: '<WETH mainnet>',  label: 'WETH / Ethereum' },
  XAUM:      { network: 'eth', token: '<XAUM mainnet>',  label: 'XAUM / Ethereum' },
  // GBPA, ASTOCK, syrupUSDC: fill in where a real reference exists, omit where it does not
}
```

Generalise `market.ts`: `BASE` becomes `https://api.geckoterminal.com/api/v2/networks/${network}` with `arc` as the default, so the same cached, queued `get()` serves any network. Resolve a row's reference as `mainnetRef (Arc) → MIRROR_REF[display] → symbol search`. Label the chart footer with which one was used — "Chart: WBTC/USDC on Ethereum (reference for cirBTC)" is honest and informative; a silent substitution is not.

### Tier 3 — on-chain oracle candles (the one that always works)
This is the real fix and the thing that makes the app self-sufficient on testnet.

`AssetRegistry` already emits everything needed:
`event PriceUpdated(address indexed token, uint256 priceE8, uint64 observedAt)`.

Use the shared `scanLogs` helper from the context pack (`src/lib/scan.ts`) — **do not write a
second scanner**; extract it from `useRecentSwaps` and have both callers share it.

```ts
// src/lib/candles.ts — candles built from on-chain oracle history. Always available.
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import type { PublicClient } from 'viem'
import { ADDR, DEPLOY_BLOCK, registryAbi } from './contracts'
import { scanLogs } from './scan'
import { TIMEFRAMES, type Candle, type Timeframe } from './market'

type Point = { token: string; t: number; p: number }

const priceUpdatedAbi = registryAbi.filter((x) => x.type === 'event' && x.name === 'PriceUpdated')

/** Fold (timestamp, price) points into OHLC buckets of `tf`. Volume is genuinely 0 for an
 *  oracle series — the chart hides the volume pane in this mode rather than drawing an empty one. */
export function foldCandles(points: Point[], tf: Timeframe): Candle[] {
  const sec = TIMEFRAMES[tf].sec
  const byBucket = new Map<number, Candle>()
  for (const pt of [...points].sort((a, b) => a.t - b.t)) {
    const t = Math.floor(pt.t / sec) * sec
    const c = byBucket.get(t)
    if (!c) byBucket.set(t, { t, o: pt.p, h: pt.p, l: pt.p, c: pt.p, v: 0 })
    else { c.h = Math.max(c.h, pt.p); c.l = Math.min(c.l, pt.p); c.c = pt.p }
  }
  return [...byBucket.values()].sort((a, b) => a.t - b.t).slice(-TIMEFRAMES[tf].limit)
}

export function useOracleCandles(token: `0x${string}` | undefined, tf: Timeframe) {
  const client = usePublicClient({ chainId: arcTestnet.id })
  return useQuery({
    queryKey: ['oracleCandles', token, tf],
    enabled: Boolean(client && token),
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Candle[]> => {
      const { logs } = await scanLogs<Point>({
        key: 'PriceUpdated',
        client: client as PublicClient,
        address: ADDR.registry,
        abi: priceUpdatedAbi,
        eventName: 'PriceUpdated',
        deployBlock: DEPLOY_BLOCK,
        // keep walking back until we have enough points for the longest timeframe
        needMore: (pts) => pts.length < 400,
        map: (l) => {
          const a = (l as { args?: { token?: string; priceE8?: bigint; observedAt?: bigint } }).args
          if (!a?.token || a.priceE8 === undefined || a.observedAt === undefined) return null
          return { token: a.token.toLowerCase(), t: Number(a.observedAt), p: Number(a.priceE8) / 1e8 }
        },
      })
      return foldCandles(logs.filter((p) => p.token === token!.toLowerCase() && p.p > 0), tf)
    },
  })
}
```

`CandleChart` gains a `showVolume` prop defaulting to `true`; the oracle tier passes `false` and
the price pane expands to fill. In `CandleChart.tsx` that means `VOL_FRAC` becomes
`showVolume ? 0.18 : 0`, and the volume paths and divider line render only when `showVolume`.

Volume is genuinely zero for an oracle series, so **hide the volume pane entirely** in this mode rather than drawing an empty strip — `CandleChart` takes a `showVolume` prop defaulting to `true`, and the price pane expands to fill when it is off.

### Wiring

```ts
// src/lib/chart-series.ts — one hook, three tiers, callers never know which won.
import { useOhlcv, type Candle, type Timeframe } from './market'
import { useOracleCandles } from './candles'
import { MIRROR_REF } from './assets'
import type { PriceRow } from './prices'

export type ChartSource = 'arc' | 'ref' | 'onchain'
export type ChartSeries = { candles: Candle[]; source: ChartSource | null; label: string; loading: boolean }

export function useChartSeries(row: PriceRow, tf: Timeframe): ChartSeries {
  const a = row.asset
  const ref = MIRROR_REF[a.display]
  // tier 1: Arc mainnet pool for this asset
  const t1 = useOhlcv(row.ref?.topPool, tf, row.refToken)
  // tier 2: the explicit cross-network reference (hooks are unconditional; `enabled` gates the fetch)
  const t2 = useOhlcv(ref?.pool ?? null, tf, ref?.token ?? null, ref?.network)
  // tier 3: always available, from PriceUpdated events
  const t3 = useOracleCandles(a.token, tf)

  if ((t1.data?.length ?? 0) >= 2) return { candles: t1.data!, source: 'arc', label: `Arc mainnet ${a.display}/USDC (deepest pool)`, loading: false }
  if ((t2.data?.length ?? 0) >= 2) return { candles: t2.data!, source: 'ref', label: `${ref!.label} — reference for ${a.display}`, loading: false }
  if ((t3.data?.length ?? 0) >= 2) return { candles: t3.data!, source: 'onchain', label: 'On-chain oracle history (AssetRegistry)', loading: false }
  return { candles: [], source: null, label: '', loading: t1.isLoading || t2.isLoading || t3.isLoading }
}
```

Keep tier 3 *below* tiers 1 and 2 even when it has more points: external market data makes a
better chart; the oracle series is the guarantee that something always draws.

`ChartBody`:
- renders the chart whenever `candles.length >= 2`, whatever the tier;
- shows a small source chip next to the timeframe pills: `Arc mainnet` / `Ethereum ref` / `On-chain oracle`, each with a tooltip naming exactly what the series is;
- only shows the `Empty` state when **all three** tiers are empty — which, once tier 3 exists, means the asset has literally never had a price written, and the copy should say that;
- keeps the oracle and testnet-pool reference lines in every tier.

`useOhlcv` gains an optional 4th arg `network` (default `'arc'`), and `market.ts`'s `BASE` becomes
`https://api.geckoterminal.com/api/v2/networks/${network}` so the same cached, serialised `get()`
serves any network.

---

## 3. End to end: a stranger with a fresh wallet can place a trade

Walk the whole path and make every step either work or explain itself. Add an **`#/onboard` checklist** reachable from the Connect button and from any blocked ticket, with one row per gate, each either green or carrying its own fix button:

| Gate | Check | Fix action |
|---|---|---|
| Wallet | EIP-6963 injected provider present | links to install a wallet |
| Network | `chainId === 5042002` | `wallet_addEthereumChain` with the full Arc Testnet params, then `wallet_switchEthereumChain` |
| Gas | native balance > 0 | link to the Arc Testnet faucet, with the address pre-copied |
| USDC | ERC-20 `0x3600…0000` balance > 0 | the test-USDC mint/faucet path |
| Asset (sell only) | balance of the asset > 0 | "buy some first", links to the buy side |
| Oracle | the asset's price is fresh | the §1.3 refresh, with the countdown |
| Allowance | allowance ≥ amount | Approve, inline |

Then:
- **Pre-flight every swap.** Before `writeContract`, `simulateContract` the exact call and map the revert through the existing `revertReason`. Extend `REASONS` to cover every custom error in the venue and registry ABIs — a user must never see a raw selector. Show the decoded reason in the ticket *before* they sign, not in a toast after they pay gas.

```ts
// src/components/trade/preflight.ts
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { ADDR, venueAbi } from '@/lib/contracts'
import { revertReason, type Side } from './hooks'
import type { ListedAsset } from '@/lib/assets'

export type Preflight = { ok: boolean; reason: string | null }

/** Simulates the exact swap the user is about to sign. Runs on a debounced amount. */
export function usePreflight(
  asset: ListedAsset | undefined, side: Side, amountIn: bigint | null,
  minOut: bigint | null, account: `0x${string}` | undefined,
) {
  const client = usePublicClient({ chainId: arcTestnet.id })
  return useQuery<Preflight>({
    queryKey: ['preflight', asset?.token, side, amountIn?.toString(), minOut?.toString(), account],
    enabled: Boolean(client && asset && account && amountIn && amountIn > 0n && minOut !== null),
    retry: false,
    staleTime: 10_000,
    queryFn: async () => {
      const tokenIn = side === 'buy' ? ADDR.usdc : asset!.token
      const tokenOut = side === 'buy' ? asset!.token : ADDR.usdc
      try {
        await client!.simulateContract({
          address: asset!.venue, abi: venueAbi, functionName: 'swap',
          args: [tokenIn, tokenOut, amountIn!, minOut!, account!], account,
        })
        return { ok: true, reason: null }
      } catch (e) {
        return { ok: false, reason: revertReason(e) }   // decoded custom error, never a selector
      }
    },
  })
}
```

Extend the existing `REASONS` map in `src/components/trade/hooks.ts` so every custom error in the
venue and registry ABIs has plain-language copy. The current map covers `TradeTooLarge`,
`RiskBlocked`, `InsufficientReserve`, `Unsupported` and `MinOut`; add at least `StalePrice`,
`NotReporter`, `BadReport` and every error the venues can throw.
- **Make the disabled button explain itself.** The CTA's label becomes the blocker: `Switch to Arc Testnet`, `Need 25 USDC`, `Price stale — refresh`, `Approve USDC`. Only when everything passes does it read `Buy cirBTC`.
- **Confirm the fill.** After the receipt, read the `Swapped` event from the receipt logs and show filled amount, effective rate, and the slippage against the quoted rate. Invalidate the balances, swaps and portfolio queries so the bottom tabs update without a reload.
- **Self-test script.** Add `scripts/e2e.ts` (bun + viem, key from env, never committed) that against Arc Testnet: reads the asset list, asserts every listed asset has a fresh price, quotes a 10 USDC buy on each venue, executes one real buy and one real sell on the mirror venue and one on the v4 venue, asserts the `Swapped` events, and prints a pass/fail table. Add `bun run e2e`. This is the audit — run it and paste the table in your report.

---

## Report back
- The files you changed, and the `OracleKeeper` address if you deployed it.
- The `bun run e2e` output table.
- For each listed asset: which chart tier it resolved to, and its price source.
- Confirmation that typecheck and lint pass and the preview renders at 360px and 1440px.

Do exactly this. No refactors beyond the shared block-scanner extraction named in §2 Tier 3, no new features, no new dependencies.
