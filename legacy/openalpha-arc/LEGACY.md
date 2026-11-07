# Legacy: OpenAlpha's earlier Arc integration (not part of Arc Treasury)

Moved here from the OpenAlpha repo on 2026-11-06, when OpenAlpha dropped Arc and became Definitive-only.
Kept for reference only. Nothing in `app/`, `cre/` or `ops/` imports it.

- `IOpenAlpha.sol`, `PROMPT.md`, `run-studio.sh`: the interface, Studio prompt and run script for two contracts
  built in a separate Arc Studio app (15d92133-…): `OpenAlphaBountyVault` (USDC bounty escrow + payouts) and
  `OpenAlphaBasketLedger` (log of paper-basket rebalances). Addresses: `deployments.json`.
- `web/arc.ts`, `web/api-v1-arc-route.ts`: OpenAlpha's server module (settle / recordRebalance on engine events)
  and its `GET /api/v1/arc` status route. They import OpenAlpha paths (`@/lib/...`) and won't compile here.
- `studio-*.log|json`: Studio session output, gitignored.
