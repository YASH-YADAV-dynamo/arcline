# Turn 2: ship the Arc Treasury frontend (finish fast, fix errors only)

The full frontend was written outside Studio and has been placed at its final paths in `src/` (pages, components, lib) plus `tailwind.config.js`. It already passes `tsc --noEmit` and `vite build` locally with the current package.json (no new dependencies). Contracts are deployed and verified; do NOT touch `contracts/`, do NOT redeploy, do NOT redesign or restyle anything.

The app preview currently shows **"Forbidden"** — the dev server is not serving.

Do exactly this, in order, and stop:

1. `bun install` (only if node_modules is missing or out of date).
2. Run `bun run typecheck` and `bun run lint`. Fix ONLY real errors with the smallest possible edit. Lint warnings that are not errors: leave them.
3. Restart the Vite dev server so the preview loads (`server.allowedHosts: true` is already set in vite.config.ts; keep it). Confirm `/` returns 200 and the app renders (landing page, top bar with Connect Wallet). Routes are hash-based: `#/trade/EURC`, `#/portfolio`, `#/buckets/new`, `#/buckets/<address>`.
4. Update `AGENTS.md` and add a short `README.md` (max ~60 lines) describing what exists:
   - Arc Treasury: per-user auto-rebalancing buckets on Arc Testnet (EIP-1167 clones, never pooled), default template buckets (Blue Chips, Global FX, Stable Yield, Real Assets, All-Weather) + custom buckets, on-chain SIP (`executeSip`), band-based rebalance (sells first, then buys, `maxTradeBps` cap, slippage bound vs registry price, risk level 3 = exit to USDC).
   - Venues: real Uniswap v4 USDC/EURC pool on Arc testnet; MirrorVenue for mainnet-priced mirror tokens (cirBTC.m, WETH.m, GBPA.m, syrupUSDC.m, XAUM.m, ASTOCK.m), clearly labelled as testnet mirrors of Arc mainnet prices.
   - Prices + risk flags: Chainlink CRE workflow writes signed reports to `AssetRegistry.onReport` (kind 1 prices, kind 2 risk). Stale price (>1h) blocks trading — no invented prices.
   - Contract addresses are in `src/lib/contracts.ts` (`ADDR`).
   No performance or profit claims.

Keep the turn short: no exploratory refactors, no new features, no new packages.
