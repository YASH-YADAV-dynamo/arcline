# Arcline contracts: security review

Date: 2026-11-10. Scope: everything in `app/contracts/` plus `studio/CreReceiver.sol`, as deployed on
Arc Testnet (registry `0x79E3…5A47`, factory `0x6677…3875`, mirror venue `0xBaF8…B7a7`, CRE receiver
`0x97f1…04dd`). Method: line-by-line manual review, live reads of on-chain configuration, and
proof-of-concept transactions on a local anvil fork of Arc Testnet (nothing was sent to the real chain).

| ID | Severity | Title | Status |
|---|---|---|---|
| C-1 | Critical | Anyone can write oracle prices and risk levels through the CRE receiver | Open, proven on fork |
| H-1 | High | One EOA holds every privileged role | Open |
| H-2 | High | Mirror venue fills at prices up to one hour old | Open |
| H-3 | High | No sanity bound on a single price update | Open |
| M-1 | Medium | Uniswap v4 venue swaps without a price limit; rebalance timing is attacker chosen | Open |
| M-2 | Medium | One stale price freezes the whole basket, exits included | Open |
| M-3 | Medium | Keeper tip is never paid when a basket targets 0% cash | Fixed in pending BucketAccount |
| M-4 | Medium | Venue spread is counted against the owner's slippage bound | Fixed in pending BucketAccount |
| M-5 | Medium | Template curator changes take effect on followers immediately | Open |
| M-6 | Medium | Assets cannot be delisted and venues cannot be replaced | Open |
| L-1..L-6 | Low | See below | Open |
| I-1..I-4 | Info | See below | Open |

---

## C-1 Critical: anyone can write oracle prices and risk levels

`CreReceiver.onReport` only checks `msg.sender == forwarder`, then relays the report to
`AssetRegistry.onReport`, where the receiver is an authorised reporter. It never checks the report
**metadata** (workflow owner, workflow ID, workflow name). The configured forwarder
`0x6E9E…eDc1` accepts reports from any caller with no signatures (it behaves like the CRE simulation
forwarder), and even the production KeystoneForwarder is shared by every CRE workflow on the chain.

**Proof (anvil fork of Arc Testnet):** an address with no roles (`0x…bEEF`) called
`forwarder.report(receiver, header ‖ abi.encode(1, abi.encode([cirBTC.m], [1e8], now)), "", [])`.
The forwarder emitted `ReportProcessed(result = true)` and `priceE8(cirBTC.m)` went from
**$74,912.17 to $1.00**. A read-only `eth_call` of the same request against the live chain also succeeds.

**Impact:** anyone can (a) set a mirror asset cheap, buy it from `MirrorVenue`, set it high and sell,
draining the venue's USDC reserve (14.17 USDC today); (b) make every basket value itself and trade at
fake prices; (c) post kind 2 risk reports to force Exit sells (level 3) or block buys (level 2).

**Fix:**
1. Now: `AssetRegistry.setReporter(0x97f1…04dd, false)`. The CRE workflow is not deployed to a DON,
   so the receiver carries no legitimate traffic; the keeper reports from the operator key.
2. Before re-enabling: in `CreReceiver`, decode the metadata and require the expected
   `workflowOwner` (and `workflowId` or `workflowName`), as Chainlink's `ReceiverTemplate` does, and
   point it at the production KeystoneForwarder for Arc.
3. Defence in depth: see H-3.

## H-1 High: one EOA holds every privileged role

`0x58ca…477d` is AssetRegistry owner, a price reporter, the template owner and the keeper. Its key sits
in `.env` on a dev machine and in CI secrets. Compromise means listing an asset with an attacker venue,
posting any price and rewriting templates.
**Fix:** registry and template ownership to a multisig behind a timelock (`Ownable2Step` is already in
place); a separate reporter key with no other role; the keeper needs no role at all.

## H-2 High: mirror venue fills at prices up to one hour old

`MirrorVenue.quote` prices at `registry.priceE8`, which is accepted for `maxStaleness = 3600` seconds,
with a fixed 0.3% spread. When the real market has moved more than about 0.6% since the last report,
anyone can buy at the stale price and sell after the next report, risk free, paid from the reserve.
Reports are pushed (and on testnet they were missed for days), so this window is common.
**Fix:** a venue-level price age limit far below `maxStaleness` (for example 120 s), a spread that widens
with price age, or a pull update (report and trade in the same transaction). The app already refuses
rebalances on prices older than 2 minutes; the venue should enforce it too.

## H-3 High: no sanity bound on a single price update

`_pricesReport` accepts any price above 0 and below `2^192`, with no limit on the move from the last
price. One bad source turns straight into the oracle price: on 2026-11-09 the thin EURC pool pushed
EURC to $9.71 (767% off) and it went on chain. Combined with C-1 this is unbounded.
**Fix:** reject (or quarantine for a guardian) moves beyond a per-asset bound per update, for example
10% for crypto and 2% for FX and gold, and require the observed time to strictly increase.

## M-1 Medium: v4 venue has no price limit; rebalance timing is attacker chosen

`UniswapV4Venue.unlockCallback` swaps with `sqrtPriceLimitX96` at the extreme, so the only protection is
the caller's `minOut`. `rebalance()` is permissionless and anyone can `deposit` dust to create drift, so a
searcher chooses the block, moves the pool by up to `maxSlippageBps` (up to 3%), triggers the rebalance
and trades back. Each EURC leg can leak up to the slippage bound.
**Fix:** derive a `sqrtPriceLimitX96` from the oracle price ± slippage, keep EURC slippage low, and send
keeper rebalances privately where available.

## M-2 Medium: one stale price freezes the whole basket

`_snapshot` calls `registry.valueE18` for every member and reverts with `StalePrice`, so a single asset
whose feed stops blocks every rebalance, including selling an Exit-level asset. The owner can still
withdraw by hand.
**Fix:** let `rebalance` skip stale non-Exit positions (valued at zero weight) and always allow selling
Exit-level assets that still have a price.

## M-3 Medium: keeper tip is never paid when cash targets 0% (fixed, pending deploy)

The tip was paid after the buys, which had spent all USDC. Every rebalance on the live chain paid
`tipUsdc = 0`, including the live test basket, so no third party has a reason to run a keeper.
**Fixed** in the pending `BucketAccount`: the tip is set aside before buying and paid exactly.

## M-4 Medium: spread counted against slippage (fixed, pending deploy)

`minOut` was `oracle × (1 − maxSlippage)`, but the mirror venue always keeps 0.3%. A 1% bound left 0.7%
for real slippage, and a basket set below 0.3% could never rebalance (shown on the fork: the live
factory's basket reverts at 0.2%, the new one rebalances).
**Fixed:** `minOut = oracle × (1 − venueFee) × (1 − maxSlippage)`, with the fee read from the venue
(`spreadBps()` or the v4 pool key) and capped at 3%.

## M-5 Medium: template changes reach followers immediately

A curator `setTemplate` bumps the version; the next permissionless `rebalance` of every follower adopts
it in the same block, and a curator can also push 12 tokens so that a follower holding legacy positions
hits `TooManyAssets` on every rebalance.
**Fix:** a delay before followers adopt a new version, and `_syncTemplate` should fail soft (keep old
targets) instead of reverting.

## M-6 Medium: assets cannot be delisted or re-routed

`AssetRegistry` has no way to change an asset's venue or pause it. The EURC venue (a thin test pool) is
stuck as the only route for EURC.
**Fix:** owner functions to pause an asset and to change its venue, behind the timelock in H-1.

## Low

- **L-1** `maxStaleness` of 3600 s is far too long for trading or rebalancing (see H-2). The keeper and UI
  now require prices under 90 s and 120 s; the contracts do not.
- **L-2** `observed >= _observedAt` allows a report with the same timestamp to overwrite a price, so
  "fresh" does not mean "newer". Require strictly increasing.
- **L-3** `MirrorVenue` sells are paid from its USDC reserve. When it runs dry every mirror sell reverts
  (`InsufficientReserve`), so baskets cannot exit mirrors.
- **L-4** `maxTradeBps` caps each leg, not the rebalance; total turnover in one call can exceed it.
- **L-5** USDC is pinned at $1 (`priceE8`), so a USDC depeg is invisible to every valuation.
- **L-6** `holdings()` silently values a stale asset at 0, so totals shown to users drop rather than
  flag the problem (the app now shows a stale warning).

## Info

- **I-1** No Solidity tests. The fork harness used for this review (old vs new rebalance) should become a
  Foundry test suite.
- **I-2** `setParams` emits no event; parameter changes are invisible to indexers.
- **I-3** Floating `pragma ^0.8.20`; pin `0.8.28` as built.
- **I-4** `ArcTreasuryCore` is sound: chain id and address bound digest, one shot, signer cleared before
  the calls.

## What is done well

`Ownable2Step` on both registries; the implementation contract is locked in its constructor and every
clone is initialised in the same transaction as `Clones.clone`; `SafeERC20` throughout; reentrancy
guards on every state-changing entry point; every price carries its observation time and stale prices
revert; the risk ladder (watch, no buys, exit) is enforced on chain.

## Pending change in this review: cost-aware rebalance

`BucketAccount.rebalance` now sells first, re-reads the basket, then sizes buys to land on target after
the venue fee and the caller's tip, scales buys pro rata when cash is short, skips legs under 0.25% of the
basket (except Exit sells, and except when idle cash itself is outside the band) and applies the
slippage bound on top of the venue fee. Fork results against the live factory, same prices and steps:

| Step | Old: worst gap, tip | New: worst gap, tip |
|---|---|---|
| Invest 6 USDC | 0.014%, 0 | 0.011%, 0.006 USDC |
| Invest 3 more | 0.010%, 0 | 0.006%, 0.009 USDC |
| Retarget 20/50/30 | 0.064%, 0 | 0.120%, 0.009 USDC |
| Same, 0.2% slippage bound | reverts | rebalances |

Existing baskets are clones of the old implementation and keep its behaviour. Using the new logic needs a
new implementation and factory deployment, then the app, keeper and CRE config pointed at the new factory.
