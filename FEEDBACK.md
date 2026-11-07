# Uniswap v4 developer feedback — Arcline (ETHGlobal Mumbai 2026)

Built a spot exchange on Arc Testnet where every USDC/EURC trade settles through a Uniswap v4
pool. This is what the integration was actually like, including the parts that cost us time.

## What we built on v4

`UniswapV4Venue` ([app/contracts/UniswapV4Venue.sol](app/contracts/UniswapV4Venue.sol)) implements
our internal `IVenue` interface (`quote` / `swap`) directly against `IPoolManager`, with no
periphery router. It is the settlement path for every EURC trade in the app and for the EURC leg of
every automated bucket rebalance.

- **Pool**: USDC/EURC on Arc Testnet, `fee: 500` (0.05%), `tickSpacing: 10`, no hooks.
- **Swap** — `swap()` at [UniswapV4Venue.sol:72](app/contracts/UniswapV4Venue.sol#L72): pulls the
  input, calls `poolManager.unlock()`, and enforces `minOut` on the decoded result
  ([L81](app/contracts/UniswapV4Venue.sol#L81)).
- **Unlock callback** — [UniswapV4Venue.sol:84](app/contracts/UniswapV4Venue.sol#L84): asserts the
  caller is the PoolManager, runs `poolManager.swap()` with `SwapParams`
  ([L88](app/contracts/UniswapV4Venue.sol#L88)), validates the `BalanceDelta` signs, then
  `sync` → `transfer` → settles.
- **Quote** — `quote()` at [UniswapV4Venue.sol:56](app/contracts/UniswapV4Venue.sol#L56): calls
  `IV4Quoter.quoteExactInputSingle` via `staticcall` and treats failure as `Unsupported`.
- **Frontend quoting** — [app/src/components/trade/hooks.ts:91](app/src/components/trade/hooks.ts#L91):
  quotes through `simulateContract` rather than `readContract`.
- **Pool mid price** — [hooks.ts:130](app/src/components/trade/hooks.ts#L130): reads
  `StateView.getSlot0` and converts `sqrtPriceX96` to a USDC/EURC mid, shown in the UI beside the
  oracle price so users can see venue-vs-oracle deviation.

## What worked well

**The unlock/callback model is the right abstraction for a custom venue.** We needed a venue that
conforms to our own interface, is callable by per-user smart accounts, and holds no liquidity of its
own. With v3 that would have meant fighting a router; with v4 we implemented `IUnlockCallback` and
settled the deltas ourselves in about 60 lines. The flash accounting meant no intermediate token
approvals inside the callback.

**`BalanceDelta` sign conventions caught real bugs.** Asserting `inputDelta <= 0` and
`outputDelta >= 0` ([L96](app/contracts/UniswapV4Venue.sol#L96)) surfaced a direction error in our
`zeroForOne` derivation immediately rather than as a silent mispricing.

**Singleton PoolManager simplified deployment.** One immutable address and one `PoolKey` in the
constructor, no per-pair factory lookups.

## What cost us time

**1. The Quoter reverts under `staticcall`, and the failure mode is opaque.**
`quoteExactInputSingle` works by reverting with the result and decoding it, so calling it through
`eth_call` with a `view` wrapper fails. Our `quote()` therefore always reverts for callers that use
`readContract`, and we had to special-case EURC on the frontend to use `simulateContract` instead
([hooks.ts:15](app/src/components/trade/hooks.ts#L15) documents the workaround). This is correct
behaviour but it is not obvious, and the revert carries no signal that the problem is *how* you
called it. A `staticcall`-safe view quoter, or a documented error for this case, would have saved
us a couple of hours.

**2. Custom errors from a shallow pool are hard to attribute.** When a rebalance failed we got
selector `0xf3b4d029` with no local match, because our ABI had the venue's error but the tooling was
decoding against the calling contract. Not strictly a v4 issue, but v4's deeper call stack
(account → venue → PoolManager → callback) makes it more likely. More worked examples of decoding
errors raised inside `unlockCallback` would help.

**3. `sqrtPriceX96` → human price needs a worked example per decimal pairing.** Both our tokens are
6-decimal, so `(sqrtP / 2^96)^2` is the raw ratio and the inversion depends on which token is
`currency0`. We got this wrong once in a way that silently produced a reciprocal price. A short doc
table for the common decimal combinations would be genuinely useful.

**4. Thin testnet pools interact badly with oracle-priced systems.** Our automated rebalancer
computes `minOut` from an oracle price, and the oracle reads the pool mid. A single 1 USDC swap
moved the Arc Testnet pool ~11%, after which rebalances reverted `MinOut` until the oracle resynced.
This is a liquidity problem, not a v4 defect, but anything that makes it easier to seed a
realistic-depth test pool (a documented helper, or deeper canonical testnet pools) would
meaningfully improve the testnet development loop.

## Suggestions, ranked

1. **A `staticcall`-safe quoter**, or an explicit documented error when the Quoter is called in a
   context that cannot catch the revert. This was our single biggest time sink.
2. **A decimals × currency-ordering table** for converting `sqrtPriceX96` to a display price.
3. **A minimal custom-venue example** — `IUnlockCallback` plus `sync`/`transfer`/`settle` for an
   exact-input swap, without periphery. We ended up reading core tests to confirm the settle order.
4. **Guidance on decoding custom errors raised inside `unlockCallback`**, since the selector
   surfaces far from its origin.

## Environment

Arc Testnet (chain 5042002) · Solidity 0.8.28 · `@uniswap/v4-core`, `@uniswap/v4-periphery` ·
viem 2.57 · wagmi v2. Venue deployed at
[`0x767f4a60…86208`](https://explorer.testnet.arc.io/address/0x767f4a602d1944409482f57aad56fd5696586208).
