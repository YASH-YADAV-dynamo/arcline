# OpenAlpha on Arc: USDC bounty vault + paper basket proof log

OpenAlpha is a research swarm: AI agents investigate crypto incidents, validators accept findings by commit-reveal vote, and accepted research rebalances a PAPER basket. Arc is our settlement layer. Build, test and deploy two contracts to **Arc Testnet** (chain id 5042002) plus a small frontend in this sandbox. Testnet only; label everything "testnet" and the basket "paper".

**Do not ask clarifying questions: every decision is made in this spec. If something is ambiguous, pick the simplest option consistent with it, note it in `ARC.md`, and finish the build, tests and deploy in this one turn.**

## Interface (must reuse, do not change)

The reference file `IOpenAlpha.sol` is in `context/` (likely `context/arc/IOpenAlpha.sol`). Copy it unchanged to `contracts/IOpenAlpha.sol` and have both contracts implement it exactly: same function names, argument order, return tuples, events and custom errors. Our web backend already codes against it. 

## Arc facts (honor these)

- USDC is the native gas token (18 decimals natively). Its ERC-20 interface is at `0x3600000000000000000000000000000000000000` with **6 decimals**. All amounts in these contracts are ERC-20 amounts (6 decimals). Never use `msg.value`; no `payable` functions, no `receive`/`fallback`, so native value reverts.
- EURC is at `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (6 decimals); not needed now, but keep the token an immutable constructor argument so EURC could be used later.
- `PREVRANDAO` is always 0 (no randomness). Timestamps are non-decreasing, not strictly increasing: never require `block.timestamp > last`. Value sends to `address(0)` revert.
- Use `maxFeePerGas` of at least 20 gwei for deploy and setup transactions.

## (a) OpenAlphaBountyVault (implements IOpenAlphaBountyVault)

- `constructor(address token, address owner_, address initialSettler)`; deploy with `token = 0x3600000000000000000000000000000000000000`. Use OpenZeppelin `Ownable2Step`, `ReentrancyGuard`, `SafeERC20`.
- `fund(issueId, amount, expiresAt)`: amount > 0. First deposit for an issue sets `expiresAt` (must be > block.timestamp, else `BadExpiry`). Later deposits pass 0 or the same value (else `BadExpiry`), revert `AlreadySettled` once settled and `Expired` at or after expiry. Track per-funder contributions. `safeTransferFrom` the funder. Emit `BountyFunded`.
- `settle(issueId, payees, bps, evidenceHash)`: only settlers (`NotSettler`). Once per issue (`AlreadySettled`), only if funded (`NotFunded`) and before expiry (`Expired`). `BadSplit` on: empty or mismatched arrays, more than 50 payees, zero address, duplicate payee, zero bps, or sum > 10000. Credit `total * bps[i] / 10000` (floor) to each payee as claimable; store `allocatedBps` and the allocated amount. Emit `BountySettled`.
- `claim(issueId)`: pull payment, nonReentrant, checks-effects-interactions; `NothingToClaim` if zero. Emit `Claimed`.
- `refund(issueId)`: nonReentrant, once per funder per issue. Not settled: only at or after `expiresAt` (`NotExpired`), returns the full contribution. Settled: returns `contribution * (total - allocated) / total`. `NothingToRefund` if zero. Emit `Refunded`.
- `setSettler` (owner), `isSettler`, `bountyOf`, `contributionOf`, `claimable`, `totalEscrowed` (sum still held). The settler is our backend wallet or a Chainlink CRE forwarder.
- Invariant: the vault's token balance always covers `totalEscrowed()`; sum of payouts + refunds never exceeds deposits.

## (b) OpenAlphaBasketLedger (implements IOpenAlphaBasketLedger)

- Proof log only. **Holds no funds**, no token logic, no payable paths. `LABEL()` returns exactly `"paper/testnet: proof log only, holds no user funds"`.
- `constructor(address owner_, address initialRecorder)`; `Ownable2Step`; `setRecorder`/`isRecorder`.
- `recordRebalance(basketId, seq, symbols, weightsBps, researchHash, findingsHash)`: recorders only (`NotRecorder`). Monotonic per basket: `seq` must equal `lastSeq(basketId) + 1` (`BadSeq(expected, got)`). `BadWeights` on: empty or mismatched arrays, more than 16 entries, any symbol not 1..11 bytes, or weights not summing to exactly 10000. Store latest symbols, weights, hashes and `recordedAt = uint64(block.timestamp)`. Emit `Rebalanced`.
- Views: `lastSeq`, `latest`, `weightsOf`, `isRecorder`, `LABEL`.

## Tests (Foundry)

Write thorough tests with a 6-decimal mock ERC-20 standing in for USDC:
- vault: fund, multi-funder, settle split math with floor dust, claim, double claim reverts, refund after expiry, pro-rata refund of the unallocated remainder after settle, settle after expiry reverts, non-settler reverts, every `BadSplit` case, sending native value reverts, a reentrancy attempt via a malicious token fails, and fuzz that payouts + refunds never exceed deposits.
- ledger: happy path, `BadSeq` on skip and replay, every `BadWeights` case, non-recorder reverts, two baskets keep independent sequences, and the same block timestamp twice is fine.
Run `forge test` and show the summary. Fix anything that fails before deploying.

## Deploy (Arc Testnet)

Deploy both contracts to Arc Testnet with the deployer as owner. Set `initialSettler` (vault) and `initialRecorder` (ledger) to our backend wallet `0x85b21DDa9a3826662fA5B2D9800cf34b59df7624`. Do not send any transactions from or to it beyond these constructor args. Vault token = `0x3600000000000000000000000000000000000000`. Verify on https://explorer.testnet.arc.io if supported. Report each deployment (contract name exactly `OpenAlphaBountyVault` / `OpenAlphaBasketLedger`, address, tx hash, explorer URL). Never invent an address or hash; report only what the deploy returned.

## Frontend (Studio preview must be a working app)

A minimal, responsive single page (works at 360px wide, light and dark) titled "OpenAlpha on Arc (testnet)" that reads the deployed contracts over https://rpc.testnet.arc.io with viem's `arcTestnet` chain:
1. **Vault**: the vault's USDC balance (one USDC figure, formatted from 6 decimals; never show the native 18-decimal balance next to it), `totalEscrowed()`, and a table of recent `BountyFunded`, `BountySettled`, `Claimed` and `Refunded` events (issue id, payees with %, amounts, tx link to the explorer).
2. **Rebalances**: recent `Rebalanced` events per basket (seq, symbol weights as %, research hash, findings hash, tx link), plus the `LABEL()` string shown prominently.
3. **Wallet actions** (connect an injected wallet, switch/add Arc Testnet 5042002): approve + `fund` a bounty by issue id (text input hashed with keccak256 of the UTF-8 string), `claim`, and `refund`. Show the connected account's `claimable` for an issue id. Set `maxFeePerGas` to at least 20 gwei on every write. Link https://faucet.circle.com for test USDC.
Show a fixed banner: "Testnet only. Paper research basket. Not investment advice." No mock data: show an empty state when there are no events.

## Deliverables in the workspace

`contracts/IOpenAlpha.sol`, `contracts/OpenAlphaBountyVault.sol`, `contracts/OpenAlphaBasketLedger.sol`, tests, a deploy script, the frontend, and a short `ARC.md` listing deployments and how to run tests. Keep the code readable and commented where Arc-specific behaviour matters (decimals, no native value, timestamps).
