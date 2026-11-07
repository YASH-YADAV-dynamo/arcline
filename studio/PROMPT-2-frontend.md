# Arc Treasury, turn 2/2: the frontend (same app, contracts already deployed)

Build the full frontend in this sandbox against the contracts deployed last turn (addresses are in `ARC.md`; ABIs come from `contracts/out`). **Don't change or redeploy the contracts.** **Don't ask clarifying questions:** pick the simplest option, note it in `ARC.md`, and finish in this turn.

**Look and feel:** follow the attached reference files in `context/` (an existing trading terminal: layout, density, tabs, order ticket). Copy the structure, not the code verbatim.
- Dark-first, with a light mode too, and it must work at 360px wide.
- Minimal text and big numbers. Use tabular numerals for prices.
- Fixed banner: **"Arc Testnet · mirror assets are priced from mainnet, not the real assets · not investment advice"**.

## Routes
1. **`/` landing.**
   - Hero: "Your portfolio, rebalanced on-chain." Subline: "Pick a bucket, set a SIP, and guardrails keep it on target with Chainlink-checked prices on Arc."
   - Three cards: **Buckets**, **Auto-rebalance**, **On-chain SIP**.
   - A live strip of 6 assets with mainnet prices.
   - CTAs: "Start trading" and "Build a bucket".
   - A "How it's safe" row: price staleness, slippage caps, per-trade caps, exploit/pump flags, your own contract.
2. **`/trade/:symbol`, the exchange screen.**
   - **Left:** market list grouped by **category tabs**: All · FX · Crypto · Yield · RWA. Each row shows symbol, price, 24h %, and a `Real` or `Mirror` badge.
   - **Center:** price chart (lightweight-charts) of mainnet history.
   - **Right: order ticket.**
     - Buy/Sell, amount in USDC or token, a slider.
     - Quote from `venue.quote()`, showing min received with the slippage setting (default 0.5%).
     - Venue name ("Uniswap v4 (Arc testnet)" or "Mirror (testnet)").
     - Approve, then Swap.
   - **Bottom tabs:** Balances · Recent trades (from `Swapped` events) · Risk (current risk level per asset with its evidence hash).
   - Mobile: Markets / Chart / Trade with a bottom nav.
3. **`/portfolio`.**
   - Total value, then each of the user's buckets (`factory.bucketsOf`) as a card: donut of actual vs target, max drift vs band, SIP status, next run, and a "Rebalance now" button (enabled only when drift > band and the cooldown has passed).
   - A **Default buckets** row from `TemplateRegistry`: name, description, weights, "Copy to my portfolio" with a "Follow updates" toggle, and the curator's `rationaleHash`.
4. **`/buckets/new`.**
   - Custom builder: add assets (≤ 12) from the registry with weight sliders that must sum to 100%.
   - Params with the contract's bounds (band, slippage, max trade, cooldown), with defaults and one-line explanations.
   - Calls `factory.createBucket`.
5. **`/buckets/:address`.**
   - Holdings table (token, amount, value, actual %, target %, drift); deposit/withdraw/withdraw-all; edit targets; pause.
   - **SIP panel:** amount, interval (daily/weekly/monthly), runs. It sets the USDC allowance to the bucket, then calls `setSip`. Show the next run and "Run SIP now" when due (anyone can call `executeSip`).
   - **History:** `Rebalanced`, `TradeExecuted`, `SipExecuted` and `TargetsSet` events with explorer links (`https://explorer.testnet.arc.io/tx/<hash>`).

## Data
- **Chain:** viem `arcTestnet`, RPC `https://rpc.testnet.arc.io`. Wallet connect via the existing template (injected wallets), with switch/add network 5042002. Set `maxFeePerGas` ≥ 20 gwei on every write.
- **Amounts:** USDC and EURC use 6 decimals through ERC-20. Show **one** USDC balance; never also show the native 18-decimal balance.
- **Mainnet market data (display only):** GeckoTerminal public API.
  - Price: `GET https://api.geckoterminal.com/api/v2/networks/arc/tokens/{mainnetRef}` (take `price_usd`).
  - 24h change and chart: `GET .../networks/arc/pools/{pool}/ohlcv/hour?limit=168`, using the top pool for that token from `GET .../networks/arc/tokens/{mainnetRef}/pools`.
  - Cache 60s and stay under about 25 requests a minute. Show a "data delayed" state on errors, never fake numbers.
- **On-chain values** (holdings, quotes, drift) always come from the contracts, not the API.
- Reads use multicall where possible. Events are scanned from the deploy block, at most 50k blocks per query.

Example read for the ticket:
```ts
const out = await publicClient.readContract({ address: asset.venue, abi: venueAbi,
  functionName: 'quote', args: [USDC, asset.token, parseUnits(amount, 6)] })
const minOut = out * BigInt(10_000 - slippageBps) / 10_000n
```

## Done means
- `tsc` and lint are clean, and every route renders with **empty states** when there are no buckets or events.
- The preview works at 360px and in desktop widths, in light and dark mode.
- `ARC.md` is updated with the routes and a 90-second demo script:
  1. Connect, switch to Arc Testnet.
  2. Trade USDC→EURC (real Uniswap v4).
  3. Copy "All-Weather" and deposit.
  4. Set a weekly SIP and run it.
  5. Show the drift, then rebalance.
  6. Show the explorer txs.
