# Turn 13: sync the app to the current Arcline UI, exactly as shipped

The files attached to this turn have ALREADY been placed at their final paths in the workspace. They are the
exact source of the live app at https://arcline.sbs: finished, type-checked, linted and built. Your job is to
make the workspace match them and confirm the preview renders. It is NOT to design, refactor or "improve" anything.

## What changed (for your context only, do not re-implement any of it)
- Landing: new Hero, Categories, RebalanceSpotlight, TerminalPreview, Faq, BucketsShowcase; QuickSwap removed.
- Exchange: CandleChart (hollow-up/filled-down candles), ChartPanel with source labels, OrderTicket with
  preflight simulation and a gas reserve (USDC is the gas token), FaucetNotice, LowLiquidityNotice.
- Baskets: Baskets page, RebalanceActivity, updated BucketCard/OwnerPanel/SipPanel/RebalancePlan.
- Agents page (AgentAccountPanel, ConnectPanel, DetectionFeed, CodeBlock).
- Shell: ArcAutoSwitch, AutoSearch, ListingsWatcher, updated TopBar/Footer/WalletControls/nav.
- Data layer: lib/feed.ts reads server snapshots at /feed/*.json and falls back to the live paths when they
  are absent (as in this preview), lib/scan.ts chunked log scanner, lib/candles.ts on-chain price history,
  lib/preflight.ts, lib/spendable.ts, lib/persist.ts, token logos under public/tokens/.
- index.html: title/meta, Inter + JetBrains Mono fonts, inline favicon. vite.config.ts: /gt dev proxy.

## Steps
1. Delete `src/components/landing/QuickSwap.tsx`. Nothing imports it any more.
2. Do not edit any attached file. If one looks wrong, report it; do not fix it.
3. Do NOT edit `tailwind.config.js`, `postcss.config.js` or `package.json`, and do not install packages:
   every import in the attached files resolves against the existing dependencies.
4. `src/main.tsx` must keep `import './index.css?v=3'` (the attached version does). Never remove the `?v=`.
5. `vite.config.ts` changed (adds a `/gt` proxy to api.geckoterminal.com for dev and preview). Vite restarts
   itself on config changes. If the dev server is not running afterwards, start it with exactly:
   `bunx vite --host 0.0.0.0 --port 5173 --strictPort` (never plain `bun run dev`, never another port).
6. Do not add `@apply` rules or Tailwind plugins to `src/index.css`.

## Verify (read-only, keep it short)
- `bunx tsc --noEmit -p .` reports no errors.
- `curl -s http://localhost:5173/src/index.css?v=3 | grep -c "\.card"` is greater than 0 (compiled Tailwind).
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` is 200, and
  `curl -s "http://localhost:5173/gt/api/v2/networks/arc/pools?page=1" | head -c 60` starts with `{"data"`.
- Routes to check render without a console error: `#/`, `#/markets`, `#/trade/EURC`, `#/baskets`, `#/portfolio`, `#/agents`.

## Report
Only: QuickSwap deleted (yes/no), tsc result, the CSS count, the two curl results, any route that failed.
