# Turn 11: the three missing DEX primitives — limit orders, liquidity provision, analytics

> **Read `PROMPT-0-shared-context.md` first** — repo map, contract facts, existing types, RPC
> constraints, and the regression + responsive checklists for this turn. Everything you need is in
> these two files. Do not spend context exploring the repo.

Turn 10 left three routes rendering `UnavailableState` because the contracts behind them do not
exist: `/orders`, `/pools` + `/pools/:id`, and `/stats`. Build them.

Order of work, and why: **§1 limit orders first** (self-contained, highest user value),
**§2 LP second** (it is also what qualifies the project for the Uniswap Foundation track),
**§3 analytics last** (pure read layer, no contract risk). Ship each completely before starting
the next. A finished limit-order book beats three half-built primitives.

## Hard rules
- No new npm packages. No new chain. Do not redeploy or modify `AssetRegistry`, `BucketFactory`,
  `BucketAccount`, `UniswapV4Venue` or `MirrorVenue` — every addition is a new contract.
- Escrowed user funds are the new risk surface in this turn. `nonReentrant` on every state-changing
  external function, checks-effects-interactions ordering everywhere, and **cancel must always
  work** — no path, no price condition and no paused state may ever trap a user's escrow.
- Honesty rules from section C of the context pack apply hard here: **realised fee yield only,
  never a projected APR**, and no TVL or volume number that is not derived from on-chain events.
- Obey sections A and B of the context pack (regression + responsive, four widths).

---

## 1. Limit orders — `contracts/LimitOrderBook.sol`

This exchange settles against oracle prices, so the natural design is not a central limit order
book but an **escrowed, oracle-triggered, permissionlessly-executable order**. One mechanism gives
you limit buys, limit sells, stop-losses and take-profits.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Escrowed orders that anyone may execute once the oracle price crosses the trigger.
/// @dev Oracle-triggered, not a CLOB: this DEX prices from AssetRegistry, so a resting
///      limit price only means anything relative to that oracle.
contract LimitOrderBook is ReentrancyGuard {
    enum Trigger { AtOrBelow, AtOrAbove }   // AtOrBelow = limit buy / stop-sell; AtOrAbove = limit sell / take-profit

    struct Order {
        address owner;
        address tokenIn;
        address tokenOut;
        uint128 amountIn;        // escrowed on placement
        uint128 minOut;          // slippage floor at execution
        uint256 triggerPriceE8;  // on tokenOut's oracle price, 1e8
        Trigger trigger;
        uint64  expiry;
        uint32  tipBps;          // paid to whoever executes, from amountIn (capped)
        bool    open;
    }

    uint32 public constant MAX_TIP_BPS = 50;      // 0.50%
    uint256 public nextId;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) public ordersOf;

    event OrderPlaced(uint256 indexed id, address indexed owner, address tokenIn, address tokenOut,
                      uint128 amountIn, uint256 triggerPriceE8, Trigger trigger, uint64 expiry);
    event OrderFilled(uint256 indexed id, address indexed filler, uint256 amountOut, uint256 priceE8, uint256 tip);
    event OrderCancelled(uint256 indexed id);
    event OrderExpired(uint256 indexed id);

    error NotOwner(); error NotOpen(); error Expired(); error NotTriggered(uint256 price, uint256 trigger);
    error TipTooHigh(); error BadExpiry(); error ZeroAmount(); error SameToken();

    function place(
        address tokenIn, address tokenOut, uint128 amountIn, uint128 minOut,
        uint256 triggerPriceE8, Trigger trigger, uint64 expiry, uint32 tipBps
    ) external nonReentrant returns (uint256 id) {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenIn == tokenOut) revert SameToken();
        if (tipBps > MAX_TIP_BPS) revert TipTooHigh();
        // bounded lifetime: an order nobody can execute must not rest forever
        if (expiry <= block.timestamp || expiry > block.timestamp + 30 days) revert BadExpiry();

        // escrow first, then record — pull the exact amount and trust the balance delta,
        // never the argument, so a fee-on-transfer token cannot under-fund the order
        uint256 before = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint128 received = uint128(IERC20(tokenIn).balanceOf(address(this)) - before);

        id = ++nextId;
        orders[id] = Order(msg.sender, tokenIn, tokenOut, received, minOut,
                           triggerPriceE8, trigger, expiry, tipBps, true);
        ordersOf[msg.sender].push(id);
        emit OrderPlaced(id, msg.sender, tokenIn, tokenOut, received, triggerPriceE8, trigger, expiry);
    }

    /// @notice Always available to the owner, in every state. No price condition, no pause,
    ///         no venue dependency — an escrow a user cannot retrieve is the worst bug here.
    function cancel(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.owner != msg.sender) revert NotOwner();
        if (!o.open) revert NotOpen();
        o.open = false;
        IERC20(o.tokenIn).safeTransfer(o.owner, o.amountIn);
        emit OrderCancelled(id);
    }

    /// @notice Permissionless. The filler pays gas and takes `tipBps`; this is what makes
    ///         orders execute without the project running a keeper.
    function execute(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (!o.open) revert NotOpen();
        if (block.timestamp > o.expiry) { o.open = false; IERC20(o.tokenIn).safeTransfer(o.owner, o.amountIn); emit OrderExpired(id); return; }

        // priceE8 REVERTS when stale — a stale oracle must never trigger a fill
        (uint256 px, ) = IRegistry(registry).priceE8(o.tokenOut);
        bool hit = o.trigger == Trigger.AtOrBelow ? px <= o.triggerPriceE8 : px >= o.triggerPriceE8;
        if (!hit) revert NotTriggered(px, o.triggerPriceE8);

        // risk flags still bind: an order placed before a flag must not fill into it
        uint8 risk = IRegistry(registry).riskOf(o.tokenOut);
        if (risk >= 2 && !_isUsdc(o.tokenOut)) revert BuysPaused(o.tokenOut);

        o.open = false;                                   // effects before interactions
        uint256 tip = (uint256(o.amountIn) * o.tipBps) / 10_000;
        uint256 swapIn = o.amountIn - tip;

        address venue = IRegistry(registry).assetOf(_isUsdc(o.tokenIn) ? o.tokenOut : o.tokenIn).venue;
        IERC20(o.tokenIn).forceApprove(venue, swapIn);
        uint256 out = IVenue(venue).swap(o.tokenIn, o.tokenOut, swapIn, o.minOut, o.owner);

        if (tip > 0) IERC20(o.tokenIn).safeTransfer(msg.sender, tip);
        emit OrderFilled(id, msg.sender, out, px, tip);
    }
}
```

Design notes that must survive review:
- **`minOut` is still enforced at execution**, so a filler cannot sandwich the order by choosing a
  bad moment — the trigger decides *when*, `minOut` decides *whether it is acceptable*.
- **Expiry self-refunds** rather than reverting, so an expired order clears itself and the user's
  escrow comes back on the first touch by anyone.
- **The tip is the keeper incentive.** Do not add a project-run keeper; a permissionless tip is both
  simpler and more honest about who is executing.

Foundry tests in `contracts/test/LimitOrderBook.t.sol` must prove the *refusals*, not the happy
path: a stale oracle does not fill, an untriggered order does not fill, a flagged asset does not
fill, `minOut` blocks a bad fill, cancel works while paused and while untriggered, expiry refunds,
a tip above `MAX_TIP_BPS` is rejected, and reentrancy on `execute` fails.

### UI — `/orders`
`Tabs` Open / History. Open orders `DataTable`: pair, side, size, trigger price, distance from
current oracle price as a %, expiry countdown, inline Cancel. The order ticket on `/trade/:symbol`
gains a **Limit** tab beside Market: trigger price input with a "x% from last" helper, expiry
select, and a plain-English confirmation line — *"Sell 250 cirBTC when the oracle price reaches
$71,500 or above, expires in 7 days"* — because a user signing an escrow should read a sentence,
not a struct.

---

## 2. Liquidity — `/pools`

Both venues are swap-only (`name`/`quote`/`swap`), so there is nothing to add or remove liquidity
*to* today. Two different problems, two different solutions.

### 2.1 The real v4 pool — route through Uniswap's PositionManager

The USDC/EURC pool is a genuine Uniswap v4 pool (`fee: 500`, `tickSpacing: 10`, no hooks). Do not
wrap it. Add `src/lib/v4-positions.ts` that talks to the canonical v4 `PositionManager` and
`StateView` directly:

- Read the user's positions by enumerating their `PositionManager` ERC-721 tokens, decoding
  `poolKey` and `tickLower`/`tickUpper`, and valuing them from `StateView.getSlot0` +
  `getPositionInfo`.
- Mint via `PositionManager.modifyLiquidities` with the standard `MINT_POSITION` + `SETTLE_PAIR`
  action encoding; burn/decrease with `DECREASE_LIQUIDITY` + `TAKE_PAIR`.
- Range presets: Full range · ±1% · ±0.5% (this pair is a stable/stable FX pool, so narrow is the
  normal choice) plus a custom tick entry.
- **Fees earned are read from the position, never modelled.** Show `fees earned since mint` in
  both tokens and in USDC. If you want a yield figure, express it as *realised fees ÷ time held*
  and label it exactly that. **No APR, no projection, no annualisation of a 20-minute sample.**

This is also what earns the Uniswap Foundation track: a public repo, a `FEEDBACK.md`, and a README
pointing at these contracts and line numbers.

### 2.2 MirrorVenue reserves — `contracts/MirrorVenueLP.sol`

`MirrorVenue` fills at the oracle price from its own USDC and mirror-token reserves, and sells
revert with `InsufficientReserve` when it runs dry. That is a real liquidity problem users can
solve, so let them: a share-accounted wrapper that holds reserves on the venue's behalf.

```solidity
/// @notice Share-accounted reserve provision for MirrorVenue. Depositors take the venue's
///         inventory risk and earn its 0.30% spread pro rata.
contract MirrorVenueLP is ReentrancyGuard {
    mapping(address => uint256) public totalShares;              // token => shares
    mapping(address => mapping(address => uint256)) public shares; // token => lp => shares

    /// @dev Pair deposit (USDC + token at the current oracle price) so a depositor cannot
    ///      tilt the venue's inventory and extract value from existing LPs.
    function deposit(address token, uint256 usdcAmount) external nonReentrant returns (uint256 minted);
    function withdraw(address token, uint256 shareAmount) external nonReentrant returns (uint256 usdc, uint256 tok);
    function reserves(address token) external view returns (uint256 usdc, uint256 tok);
    function sharePriceE8(address token) external view returns (uint256);
}
```

Be explicit in the UI about what the depositor is taking on: **this is inventory risk against an
oracle price, not a fee-earning AMM position.** If the oracle is wrong or lags, LPs absorb it. Say
that in one sentence on the deposit form, not buried in docs.

### UI — `/pools` and `/pools/:id`
`/pools`: `DataTable` — pool, venue, TVL, 24h volume (from §3's indexer), fee tier, your position,
realised fee yield. `/pools/:id`: header stats, a liquidity-distribution chart for the v4 pool from
`StateView` tick data, then `Tabs` Add · Remove · Your position · Fees earned.

---

## 3. Analytics — `/stats`

There is no backend, so index on the client from events you already emit, using the **shared
`scanLogs` helper** from the context pack. Do not write a third scanner.

```ts
// src/lib/indexer.ts — protocol aggregates from on-chain events. Cached, chunked, serialised.
import { ADDR, DEPLOY_BLOCK, venueAbi, factoryAbi } from './contracts'
import { scanLogs } from './scan'

export type ProtocolStats = {
  volumeUsdc: { total: number; d1: number; d7: number }
  trades: { total: number; d1: number }
  uniqueTraders: number
  buckets: number
  tvlUsdc: number
  byAsset: { token: string; volumeUsdc: number; trades: number }[]
  byVenue: { venue: string; volumeUsdc: number; trades: number }[]
  series: { t: number; volumeUsdc: number; trades: number }[]   // daily buckets for the chart
  scannedFrom: bigint
  complete: boolean      // false => the UI says "partial history from block N", never implies full
}
```

- Source events: `Swapped` (both venues) for volume and traders, `BucketCreated` for bucket count,
  `Deposited`/`Withdrawn` for flows, `Rebalanced` and `TradeExecuted` for automation activity,
  `OrderFilled` from §1, plus `PriceUpdated` for the oracle-coverage panel.
- Volume is only meaningful in USDC terms, and every `Swapped` has USDC on one side, so take the
  USDC leg directly — **do not convert the non-USDC leg at a current price and call it historical
  volume.** That would be a fabricated number.
- Persist the scan cursor and aggregates to `sessionStorage` (wrapped in try/catch) so a reload
  does not re-scan from `DEPLOY_BLOCK` and get rate-limited.
- **`complete: false` must be visible.** The page says *"Partial history — scanned from block N of
  M"* with a Load more control. A TVL or volume figure presented as total when it is a partial
  scan is a lie, and on a hackathon judging run it is the lie most likely to be caught.

### UI — `/stats`
KPI `StatRow` (TVL, 24h volume, 24h trades, unique traders, buckets, active agents) · daily volume
bar chart and TVL line chart reusing `CandleChart`'s area mode · top assets and top venues
`DataTable`s · an oracle-coverage panel showing per-asset freshness from Turn 8's `useOracleHealth`.

---

## 4. Wire the Turn 10 routes

Replace `UnavailableState` with the real thing on `/orders`, `/pools`, `/pools/:id` and `/stats`,
and remove those rows from the "awaiting PROMPT-11" column of the route table. Add the **Limit**
tab to the order ticket and an **Orders** entry to the Account nav group.

## 5. Documentation

Update `README.md`: the limit-order mechanism and why oracle-triggered rather than a CLOB; the two
liquidity paths and the inventory-risk warning; how the client-side indexer works and that its
figures are partial-scan until complete. Extend the honest-limits section — escrowed orders depend
on a filler showing up for the tip, MirrorVenue LPs carry oracle risk, and none of this is audited.

## Report back
- New contracts and addresses; `bun run contracts:test` output with the refusal tests named.
- One real limit order placed, triggered and filled on Arc Testnet, with tx hashes.
- One v4 liquidity position minted and burned, with the realised fees read back from the position.
- The `/stats` figures alongside the block range they were scanned from.
- The completed checklists from sections A and B of the context pack.

Build §1 completely, then §2, then §3. Do not start the next section until the previous one's tests
are green.
