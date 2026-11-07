# Turn 6: make Arc Treasury look and feel like a real exchange (frontend only)

The app works: wallet connect, live quotes, real swaps on Arc Testnet (Uniswap v4 USDC/EURC + MirrorVenue mirrors), auto-rebalancing buckets and an on-chain SIP. Now restyle it into a **spot exchange with portfolio automation**, where the landing page itself is an exchange. This is a UI/UX turn only.

## Hard rules (keep cost low)
- Do NOT touch `contracts/`, do NOT redeploy, do NOT add npm packages.
- Keep all on-chain logic and data hooks as they are: `src/lib/{contracts,tx,assets,market,format,router}.ts(x)`, `src/components/trade/hooks.ts`, `src/components/bucket/data.ts`. Reuse them; only change presentation components and pages.
- Keep hash routes: `#/`, `#/trade/:symbol`, `#/portfolio`, `#/buckets/new`, `#/buckets/:address`. Add `#/markets` (new page, reusing the same data).
- Keep the theme tokens in `tailwind.config.js` / `src/index.css` (dark default + `.light`). You may add tokens (e.g. `--up-bg`, `--down-bg`) but keep the variable approach.
- Never show invented numbers. If a value isn't available (no 24h volume on testnet, stale price), show "—". Mirror assets must stay labelled **MIRROR** ("priced from Arc mainnet, testnet token"); EURC is **REAL** (Uniswap v4 on Arc Testnet). No profit/return claims anywhere.
- Finish with `bun run typecheck`, `bun run lint`, and make sure the dev server keeps running with `--host 0.0.0.0 --port 5173` (do not restart it with plain `bun run dev`).

## 1. Global shell → exchange chrome (`src/components/Shell.tsx`, `src/components/shell/*`)
- Top bar (56px): logo "Arc Treasury" · nav **Markets · Trade · Buckets · Portfolio** · right side: network pill "Arc Testnet" (green dot when connected to 5042002, amber "Switch network" button otherwise), USDC balance chip (6-dec ERC-20 `0x3600…0000`), theme toggle, Connect/Account button.
- Under it a **ticker tape**: horizontally scrolling (CSS marquee, pauses on hover, respects `prefers-reduced-motion`) of every listed asset: symbol, price, 24h change coloured up/down, REAL/MIRROR badge. Click → `#/trade/:symbol`.
- Footer status bar (exchange style, 28px, mono 11px): "Block #… · Prices on-chain · oracle age 4m · Chainlink CRE · Arc Testnet", using the registry `observedAt` of the freshest/oldest price. Show "stale" in amber if any price is older than the registry `maxStaleness`.
- Mobile (<768px): bottom tab bar Markets / Trade / Buckets / Portfolio; ticker tape stays; keep the "Built with Arc Studio" badge from overlapping the tab bar.

## 2. Landing = exchange home (`src/pages/Landing.tsx`, `src/components/landing/*`)
Replace the marketing-style hero with an exchange home:
- **Hero row (left 60%)**: one-line headline "Trade FX, gold, BTC and RWAs on Arc. Let buckets rebalance for you." + sub "Non-custodial · USDC gas · sub-second finality". CTAs: **Start trading** (`#/trade/EURC`) and **Create a bucket**.
- **Hero row (right 40%)**: a compact **quick-swap card** (From USDC → To asset select, amount, live quote via the existing quote hooks, "Swap" button that routes to `#/trade/:symbol` with the amount prefilled, or performs the swap inline if simple using the existing OrderTicket logic).
- **Market overview strip**: 3 cards: Top gainer, Top loser, Biggest liquidity (from `useMarket` data; "—" if missing).
- **Markets table** (the centrepiece, same component as `#/markets`): category tabs **All · FX · Crypto · Commodities · Yield · Cash** (use `CATEGORIES` from `src/lib/assets.ts`), search box, columns: Asset (icon circle with initials + name + REAL/MIRROR badge) · Last price · 24h % · 24h sparkline (from `useCandles` when available, else nothing) · Liquidity (mainnet ref) · Risk (registry risk level: Normal/Watch/No-buys/Exit as coloured dot) · **Trade** button. Row click → trade page. Sortable by price/24h/liquidity.
- **Buckets showcase**: horizontal cards for the default templates (Blue Chips, Global FX, Stable Yield, Real Assets, All-Weather) from `TemplateRegistry`: name, allocation bar (stacked colours per asset), band/risk line, "Invest" → `#/buckets/new?template=<id>`. Label: "Templates, not recommendations".
- **How it works** (3 steps, one line each): Deposit USDC → Bucket trades to target weights → SIP + guardrails keep it there (Chainlink CRE prices, risk level 3 exits to USDC).
- **Trust strip**: contract links (registry, factory, venues) to `https://explorer.testnet.arc.io/address/…` from `ADDR`, "Prices via Chainlink CRE", "Per-user bucket contracts, never pooled".

## 3. Trade page → pro terminal (`src/pages/Trade.tsx`, `src/components/trade/*`)
Desktop grid (≥1280px): `[markets 280px] [chart + header flexible] [order ticket 340px]`, bottom full-width tabs.
- **Pair header**: `EURC / USDC` big, last price, 24h change, 24h high/low and mainnet liquidity when available, oracle age, REAL/MIRROR badge, risk dot. Favourite star (localStorage).
- **Chart**: keep the existing SVG chart but add timeframe pills (1H · 4H · 1D · 1W) mapping to the candle fetch resolution if supported, otherwise only 1H/1D; crosshair tooltip; area for line mode. Under the chart a slim **depth/route panel**: "Route: Uniswap v4 pool fee 0.05%" for EURC or "Route: MirrorVenue (30 bps spread)" for mirrors, plus pool mid price vs oracle price and the deviation %.
- **Order ticket**: Buy/Sell segmented control (green/red), tabs **Market** (existing) and **Bucket** (shortcut: "Add this asset to a new bucket" → BucketNew prefilled). Amount input with balance and 25/50/75/100% chips, receive estimate, price impact, min received, slippage chips (0.1 / 0.5 / 1 / custom), fee line, then Approve → Swap states with the existing `useTx` toasts. Disabled states must explain why (stale price, risk blocked, insufficient balance, wrong network).
- **Bottom tabs**: Recent trades (existing log reader), My trades (filter by connected address), Balances (all listed assets with USD value), Buckets holding this asset.
- **Mobile**: segmented top switch Chart | Trade | Trades; sticky Buy/Sell buttons at the bottom opening the ticket as a sheet.

## 4. Buckets & Portfolio as exchange "Earn/Automation" (`src/pages/Portfolio.tsx`, `BucketNew.tsx`, `BucketDetail.tsx`, `src/components/bucket/*`)
- Portfolio header like an exchange account overview: Total value, USDC available, # buckets, next SIP due, a stacked allocation bar across all buckets.
- Bucket cards styled as "strategies": name, template badge, value, drift vs band as a progress bar (green inside band / amber near / red outside), last rebalance time, SIP status, buttons Rebalance / Deposit / Manage.
- BucketDetail: tabs **Overview · Holdings · Rebalance · SIP · History · Settings**; Rebalance tab shows the planned direction per asset (over/underweight arrows) before the tx; History is an exchange-style fills table with explorer links.
- BucketNew: 3-step wizard (Choose template or custom → Weights & guardrails → Fund & SIP) with a live allocation donut.

## 5. Visual language
- Dense, calm, pro: Inter for UI, JetBrains Mono for numbers (`.num` tabular). 13px base in tables, 12px meta. Up = `--up`, down = `--down`; tint row background briefly (600ms) on price change (flash up/down).
- Radii 10–14px, 1px `--line` borders, no heavy shadows, generous but compact spacing (8px grid). Skeleton loaders, never layout jumps.
- Every number right-aligned and tabular. Empty states with one sentence and one action.
- Accessibility: focus rings, 44px touch targets on mobile, no horizontal scroll at 360px.

Do exactly this; no new features beyond the above, no refactors of data hooks. Report the files changed and confirm typecheck/lint pass and the preview renders.
