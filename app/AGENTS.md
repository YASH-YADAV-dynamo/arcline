# Arcline

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

An agent-native spot exchange on Arc Testnet. Users (and their agents) trade USDC against FX,
crypto, yield-bearing and RWA assets, then hand a position to a **bucket**: a per-user contract
holding target weights that rebalances within on-chain limits — drift band, cooldown, max trade
size, slippage bound — plus an optional recurring buy (SIP).

The point is that the risk limits are contract-enforced, not client-side, so an agent driving the
bucket gets a revert rather than a bad fill. FX trades settle on a real Uniswap v4 pool; mirror
assets settle on an oracle-priced venue. Prices come from an on-chain `AssetRegistry` written by a
Chainlink CRE workflow, and every price carries the time it was observed.

See `../README.md` for the full picture, `../DESIGN.md` for the visual system, and
`../FEEDBACK.md` for notes on the Uniswap v4 integration.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28. Sources in `contracts/`. **There are no Solidity unit tests** — there
  is no `foundry.toml` and no `contracts/test/*.t.sol`, so `bun run contracts:build` and
  `bun run contracts:test` both compile nothing (forge looks in `src/`, not `contracts/`). Contract
  behaviour is covered end-to-end against the live chain by `node ../ops/e2e.cjs` instead, which
  asserts the real gates (cooldown, drift band, slippage, SIP interval). Treat that as the test
  suite until a `foundry.toml` exists.
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - hash route table; unknown routes render `NotFound`
- `src/components/` - UI components (`landing/`, `markets/`, `trade/`, `bucket/`)
- `src/config.ts` - wagmi config (chains, connectors, transports)
- `src/lib/preflight.ts` - simulates a write before signing; maps every custom error to plain text
- `src/lib/spendable.ts` - holds back a gas reserve, because **USDC is the gas token on Arc**
- `src/lib/scan.ts` - the one chunked, lock-serialised log scanner (the RPC rejects >10k block ranges)
- `src/lib/chart-series.ts` - picks the chart source: Arc mainnet pool, else on-chain oracle history

## Checks

```bash
bun run typecheck && bun run lint && bun run smoke   # smoke = SSR render of landing components
node ../ops/e2e.cjs                                  # full flow on Arc Testnet (spends testnet USDC)
```

## Gotchas learned the hard way

- **USDC is also the gas token.** A wallet that looks funded can fail mid-flow; size spends from
  `useSpendable()`, never the raw balance.
- **The testnet v4 pool is shallow.** One 1 USDC swap moved it ~11%. Since EURC's oracle price is
  read from that pool, a bucket rebalance straight after a manual trade reverts `MinOut` until the
  next price report. Re-run `ops/report-prices.cjs` in between.
- **The RPC reports rate limits as a JSON-RPC error, not HTTP 429**, so viem's built-in retry never
  fires. `ops/lib.cjs` wraps calls in `withRetry()`.
- **`BucketAccount` bubbles venue errors**, so a revert selector is often absent from the ABI you
  called. Decode by error name, not selector.

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```
