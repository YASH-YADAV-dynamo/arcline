# Turn 9: Arc Rebalance — a DEX-exclusive execution service for trading agents

> **Read `PROMPT-0-shared-context.md` first** — repo map, contract facts, existing types, RPC
> constraints, and the regression + responsive checklists for this turn. Everything you need is in
> these two files. Do not spend context exploring the repo.

Today a bucket rebalances when anyone pokes `rebalance()` and the contract checks its gates. That is a feature of one app. Turn it into **a service**: a non-custodial venue where *anyone's* AI agent can read portfolio context, propose trades, and have them executed under guardrails the user set and the agent cannot exceed.

The pitch, and the thing the build must actually earn: **the user keeps custody and sets the limits; the agent only gets to decide direction and timing inside them.** An agent that goes rogue, gets prompt-injected, or is simply wrong should be able to lose the user turnover costs — never the position.

"DEX-exclusive" means the service settles only through Arc Treasury's own venues (`UniswapV4Venue`, `MirrorVenue`) against on-chain oracle prices. No off-exchange routing, no custody transfer, no CEX leg. The guardrails are only credible because the execution path is one we control end to end.

## Hard rules
- Non-custodial, always. An agent must **never** be able to move funds out of a `BucketAccount`. No `withdraw`, no `transfer`, no approval-granting, no owner change, no implementation upgrade. Grant exactly one capability: `executeIntent`.
- Every limit is enforced **on-chain**, in the contract that moves the money. UI-side and relayer-side checks are convenience, never the control. Assume the agent is adversarial and the relayer is compromised, and make the contract still safe.
- Do not change `BucketAccount`'s existing owner-facing surface or redeploy the registry/factory/venues. Add new contracts and extend `BucketAccount` through a module, so existing buckets keep working untouched.
- Do not add npm packages. No new chain, no bridges.
- No performance claims, no backtests, no "returns" anywhere in the UI. Show realised turnover, costs, drift reduction and rejection counts — facts the contract can prove — and nothing else. Testnet only, not investment advice.
- Finish with `bun run typecheck`, `bun run lint`, `bun run contracts:test` all clean.

---

## 1. The permission model

New contract `contracts/AgentSessions.sol`.

An owner grants an agent a **session**: scoped, expiring, revocable, and bounded on every axis that matters.

```solidity
struct Session {
    address bucket;        // the BucketAccount this session can act on
    address agent;         // the key that signs intents
    uint64  expiresAt;     // hard expiry; no session is open-ended
    uint64  cooldownSec;   // min seconds between executed intents
    uint16  maxSlippageBps;
    uint16  maxDeviationBps;   // max |venue price - oracle price|; above this, refuse
    uint128 maxNotionalPerTrade;   // USDC, 6dp
    uint128 maxNotionalPerDay;     // rolling 24h budget, USDC
    uint16  maxTradesPerDay;
    uint16  minBandBps;        // agent may not act inside this drift band
    uint256 assetMask;         // bitmask over the registry's asset list: the only tokens it may touch
    bool    paused;
}
```

- `grant(Session)` / `revoke(bucket, agent)` / `pauseAll(bucket)` — owner only, and `revoke` and `pauseAll` must work in **one transaction with no cooldown, no delay, and no agent cooperation**. This is the kill switch; it is the single most important function in the build. Make it impossible for a pending intent, a queued slice, or a reentrant call to survive it.
- A session can only ever be **narrowed** after grant, never widened — widening requires a fresh `grant`. This makes an approval dialog honest: whatever the user agreed to is the ceiling for that session's life.
- `maxNotionalPerDay` and `maxTradesPerDay` are enforced on a **rolling 24h window** (ring buffer of timestamps), not a calendar day, so an agent cannot double-spend the budget across a midnight boundary.
- Emit `SessionGranted`, `SessionRevoked`, `IntentExecuted`, `IntentRejected(reason)` — rejections are as important as fills; the whole value proposition is observable refusal.

## 2. The intent

Agents do not send transactions. They sign **EIP-712 intents**, which anyone (the agent, a relayer, the user, a cron) may submit. This is what makes it fast: the agent's decision loop never waits on gas, nonces or RPC.

```solidity
struct Intent {
    address bucket;
    address agent;
    uint64  nonce;
    uint64  deadline;
    Leg[]   legs;          // sells first, then buys — enforced, not assumed
    uint256 minPortfolioValueE8;   // abort if the portfolio is worth less than this
    bytes32 contextHash;   // hash of the context snapshot the agent reasoned over
}
struct Leg { address token; bool isSell; uint128 amountIn; uint128 minOut; }
```

```solidity
// contracts/AgentExecutor.sol — the gate order is the security model. Do not reorder.
bytes32 private constant LEG_TYPEHASH =
    keccak256("Leg(address token,bool isSell,uint128 amountIn,uint128 minOut)");
bytes32 private constant INTENT_TYPEHASH = keccak256(
    "Intent(address bucket,address agent,uint64 nonce,uint64 deadline,Leg[] legs,"
    "uint256 minPortfolioValueE8,bytes32 contextHash)"
    "Leg(address token,bool isSell,uint128 amountIn,uint128 minOut)"
);

function execute(Intent calldata it, bytes calldata sig) external nonReentrant {
    Session storage s = sessions[it.bucket][it.agent];

    // 1. session + signature
    if (s.agent == address(0) || s.paused) revert SessionInactive();
    if (block.timestamp > s.expiresAt) revert SessionExpired();
    if (block.timestamp > it.deadline) revert IntentExpired();
    if (usedNonce[it.bucket][it.agent][it.nonce]) revert NonceUsed();
    if (_recover(it, sig) != it.agent) revert BadSignature();
    if (block.timestamp < lastExec[it.bucket][it.agent] + s.cooldownSec) revert Cooldown();
    usedNonce[it.bucket][it.agent][it.nonce] = true;

    // 2. sells strictly before buys — enforced, never assumed
    bool seenBuy;
    for (uint256 i; i < it.legs.length; ++i) {
        if (!it.legs[i].isSell) seenBuy = true;
        else if (seenBuy) revert SellsMustPrecedeBuys();
    }

    // 3. per-leg gates
    uint256 notional;
    for (uint256 i; i < it.legs.length; ++i) {
        Leg calldata g = it.legs[i];
        if (!_inMask(s.assetMask, g.token)) revert TokenNotPermitted(g.token);

        // oracle freshness: priceE8 REVERTS when stale, so a try/catch is the freshness check
        (uint256 px, ) = _freshPrice(g.token);          // reverts StalePrice if unavailable

        // venue vs oracle deviation — the depeg and thin-pool guard
        uint256 venuePx = _venuePriceE8(g.token, g.amountIn);
        uint256 dev = venuePx > px ? venuePx - px : px - venuePx;
        if (dev * 10_000 > px * s.maxDeviationBps) revert DeviationTooLarge(g.token, dev);

        // risk flags: the agent may agree with them faster, never override them
        uint8 risk = IRegistry(registry).riskOf(g.token);
        if (!g.isSell && risk >= 2) revert BuysPaused(g.token);
        if (risk == 3 && !g.isSell) revert ExitOnly(g.token);

        uint256 legUsd = g.isSell ? (uint256(g.amountIn) * px) / 1e8 : g.amountIn;
        if (legUsd > s.maxNotionalPerTrade) revert TradeTooLarge(legUsd);
        notional += legUsd;
    }

    // 4. rolling 24h budgets (ring buffer, not a calendar day — no midnight double-spend)
    _rollWindow(it.bucket, it.agent);
    if (used24hNotional[it.bucket][it.agent] + notional > s.maxNotionalPerDay) revert DailyNotionalExceeded();
    if (used24hTrades[it.bucket][it.agent] + it.legs.length > s.maxTradesPerDay) revert DailyTradesExceeded();

    // 5. drift must exist before, and must shrink after. Kills the overtrading failure mode.
    uint256 driftBefore = IBucket(it.bucket).maxDriftBps();
    uint16 band = s.minBandBps > IBucket(it.bucket).bandBps() ? s.minBandBps : IBucket(it.bucket).bandBps();
    if (driftBefore <= band) revert WithinBand(driftBefore, band);

    // 6. drawdown circuit breaker: below the HWM threshold, only de-risking sells pass
    uint256 navBefore = IBucket(it.bucket).totalValueE8();
    if (navBefore < it.minPortfolioValueE8) revert PortfolioBelowFloor();
    if (_inDrawdown(it.bucket)) {
        for (uint256 i; i < it.legs.length; ++i) if (!it.legs[i].isSell) revert DrawdownBuysHalted();
    }

    // 7. execute atomically — a partial rebalance is a state nobody designed
    for (uint256 i; i < it.legs.length; ++i) _swap(it.bucket, it.legs[i]);

    // 8. post-conditions: closer to target, and no leg overshot past its target weight
    uint256 driftAfter = IBucket(it.bucket).maxDriftBps();
    if (driftAfter >= driftBefore) revert DriftNotReduced(driftBefore, driftAfter);
    _assertNoOvershoot(it.bucket, it.legs);

    lastExec[it.bucket][it.agent] = uint64(block.timestamp);
    used24hNotional[it.bucket][it.agent] += notional;
    used24hTrades[it.bucket][it.agent] += uint16(it.legs.length);
    _updateHighWaterMark(it.bucket);
    emit IntentExecuted(it.bucket, it.agent, it.nonce, notional, driftBefore, driftAfter, it.contextHash);
}
```

Every `revert` above is a named custom error, and each one maps to a plain-language string in the
UI and in `simulate_intent`. A refused intent must always say *which* gate caught it.

Gate order in prose, for review:
1. Session valid, not paused, not expired, agent matches, nonce unused, deadline unpassed.
2. Every leg's token is in `assetMask`, and its oracle price is **fresh** per `AssetRegistry.maxStaleness`.
3. Venue price vs oracle price within `maxDeviationBps` — this is the depeg and thin-pool guard, and it is what stops an agent being tricked into trading a manipulated pool.
4. Risk levels honoured: no buys at level ≥ 2, forced sell-only at level 3. The agent cannot override a risk flag; it can only agree with it faster.
5. **Drift gate**: the post-trade weights must be closer to target than the pre-trade weights, and the pre-trade drift must exceed `max(bucket.band, session.minBandBps)`. An agent cannot churn a bucket that is already in balance. This single check kills the dominant failure mode of a bad agent — overtrading.
6. **Overshoot gate**: no leg may push its asset *past* its target weight. Rebalancing to the band edge is permitted; rebalancing through it is not.
7. Notional, trade-count and cooldown budgets.
8. `minPortfolioValueE8` — a circuit breaker the agent itself sets, so a crashing market aborts its own plan.
9. Execute sells, then buys, each with its `minOut`. Any leg reverting reverts the whole intent: partial rebalances are how portfolios end up in states nobody designed.

Executing a whole rebalance as one signed, atomic, multi-leg intent is the speed story. Say that in the UI in those terms — one signature, one transaction, one atomic state change — not with a latency number you cannot substantiate.

## 3. Rebalancing standards the service enforces for the user

The guardrail set is the product. Implement each of these as a named, individually-togglable policy in `contracts/RebalancePolicy.sol`, defaulted on, with the defaults visible in the UI:

- **Tolerance-band (threshold) rebalancing.** Act only when |actual − target| exceeds the band. The band, not the calendar, is the trigger.
- **Rebalance to the band edge, not to target.** Trade only the excess beyond the band. Materially lower turnover than full-to-target for nearly identical tracking, and it is the standard practice most naive agent implementations miss.
- **Calendar floor.** An optional minimum interval (default 1 day) under which no intent executes regardless of drift, so a volatile hour cannot trigger a dozen rebalances.
- **Cost-aware no-trade zone.** Skip any leg whose expected cost (venue spread + estimated impact + gas) exceeds a configured fraction (default 25%) of the drift value it would correct. Trading $3 of drift for $4 of cost is a loss dressed as discipline.
- **Turnover budget.** The rolling notional cap from §1, surfaced as "x% of your monthly turnover budget used".
- **TWAP slicing.** A leg above `maxNotionalPerTrade` is not rejected — it is split into a queue of slices, executable one per cooldown, each re-checking every gate at execution time. Large rebalances complete without a single large print.
- **Drawdown circuit breaker.** If portfolio value falls more than a configured % from its trailing high-water mark, buys stop and only de-risking sells pass, until the owner resets. Store the HWM on-chain.
- **Volatility-aware band widening.** When recent oracle-price volatility is high, widen the effective band proportionally so the agent is not whipsawed into trading every oscillation. Compute volatility from the same on-chain oracle series the chart uses.
- **Oracle freshness and deviation guards**, and **risk-level exits** — §2 steps 2–4.
- **Kill switch and expiry** — §1.

Each policy needs a unit test proving it *blocks* the thing it exists to block, not merely that the happy path passes. Reviewers should be able to read `contracts/test/RebalancePolicy.t.sol` and see an adversarial agent being refused on every axis.

## 4. The agent-facing surface

Agents need context and a way to submit. Both must be trivial to consume from any agent framework.

**Context** — `src/lib/agent-context.ts` builds a single JSON snapshot from on-chain reads only:
```jsonc
{
  "bucket": "0x…", "asOf": 1762400000, "chainId": 5042002,
  "nav": { "totalE8": "…", "usdc": "…" },
  "positions": [{ "token": "0x…", "symbol": "cirBTC", "weightBps": 2480, "targetBps": 2500,
                  "driftBps": -20, "priceE8": "…", "priceAgeSec": 95, "priceSource": "cre", "risk": 0 }],
  "policy": { "bandBps": 300, "effectiveBandBps": 420, "calendarFloorSec": 86400, "…": "…" },
  "session": { "expiresAt": …, "notionalRemaining24h": "…", "tradesRemaining24h": 6, "cooldownUntil": … },
  "venues": [{ "token": "0x…", "venue": "0x…", "quote10kE8": "…", "deviationBps": 12, "maxSize": "…" }],
  "blocked": [{ "token": "0x…", "reason": "risk=2, buys paused" }],
  "contextHash": "0x…"
}
```
The `blocked` array and the `reason` strings matter: an agent that is told *why* it cannot act makes a better next decision than one that just gets a revert.

Expose it three ways, all from the same builder so they cannot drift apart:
1. `GET #/agent/context/:bucket` — a JSON view in the app.
2. `bun run agent:context -- <bucket>` — CLI, prints the same JSON.
3. An **MCP server** at `agent/mcp/` exposing `get_context`, `simulate_intent` and `submit_intent` as tools, so a Claude/OpenAI agent can drive a bucket with no glue code. This is the "connect your agent" story made real — a user pastes one MCP config and their agent can operate a bucket under their limits.

**Submission** — `simulate_intent` runs the identical gate checks off-chain via `simulateContract` and returns the exact rejection reason, so an agent can iterate without spending gas. `submit_intent` relays the signed intent. Both share the executor's logic path; never let the simulator and the contract disagree.

Ship `agent/README.md` and `agent/example-agent.ts` showing a working band-rebalance agent. It must
be obvious from reading it that writing an agent for this takes an afternoon:

```ts
// agent/example-agent.ts — band rebalance to the band EDGE (not to target), signed as one intent.
import { createWalletClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { getContext, simulateIntent, submitIntent } from './client'

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`) // env only, never committed
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() })

const DOMAIN = { name: 'ArcRebalance', version: '1', chainId: arcTestnet.id, verifyingContract: EXECUTOR }
const TYPES = {
  Leg: [
    { name: 'token', type: 'address' }, { name: 'isSell', type: 'bool' },
    { name: 'amountIn', type: 'uint128' }, { name: 'minOut', type: 'uint128' },
  ],
  Intent: [
    { name: 'bucket', type: 'address' }, { name: 'agent', type: 'address' },
    { name: 'nonce', type: 'uint64' }, { name: 'deadline', type: 'uint64' },
    { name: 'legs', type: 'Leg[]' }, { name: 'minPortfolioValueE8', type: 'uint256' },
    { name: 'contextHash', type: 'bytes32' },
  ],
} as const

async function run(bucket: Address) {
  const ctx = await getContext(bucket)

  // rebalance to the band edge, not to target: trade only the excess beyond the band.
  // materially lower turnover than full-to-target for near-identical tracking.
  const band = ctx.policy.effectiveBandBps
  const legs = ctx.positions
    .filter((p) => Math.abs(p.driftBps) > band && !ctx.blocked.some((b) => b.token === p.token))
    .map((p) => {
      const excessBps = Math.abs(p.driftBps) - band
      const amountUsd = (Number(ctx.nav.totalE8) / 1e8) * (excessBps / 10_000)
      return { token: p.token, isSell: p.driftBps > 0, amountUsd }
    })
    // cost-aware no-trade zone: skip legs whose cost eats >25% of the drift they fix
    .filter((l) => l.amountUsd * 0.003 < l.amountUsd * 0.25)
    .sort((a, b) => Number(b.isSell) - Number(a.isSell))   // sells first — the contract enforces it too
    .map(toLeg)

  if (!legs.length) return console.log('within band, nothing to do')

  const intent = {
    bucket, agent: account.address,
    nonce: BigInt(ctx.session.nextNonce), deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    legs, minPortfolioValueE8: (BigInt(ctx.nav.totalE8) * 95n) / 100n,
    contextHash: ctx.contextHash,
  }

  // simulate first: identical gate checks off-chain, so iterating costs no gas
  const sim = await simulateIntent(intent)
  if (!sim.ok) return console.log('rejected:', sim.reason)   // e.g. "WithinBand(210, 300)"

  const signature = await wallet.signTypedData({ domain: DOMAIN, types: TYPES, primaryType: 'Intent', message: intent })
  console.log('submitted:', await submitIntent(intent, signature))
}
```

`simulate_intent` must share the executor's logic path. Never let the simulator and the contract
disagree about whether something passes — a simulator that is more permissive than the chain
teaches agents to submit intents that always fail, and one that is stricter hides working strategies.

## 5. The UI — `#/agents`

Make the guardrails the hero. The emotional job of this page is to make handing an agent the keys feel *safe*, so lead with what the agent cannot do.

- **Connect an agent**: paste an agent address or generate a session keypair in-browser (private key stays client-side, shown once, never persisted, never sent anywhere). Then a scope builder — assets, band, per-trade and daily notional, trades/day, cooldown, slippage, expiry — rendering a plain-English summary above the sign button: *"Agent 0x12…ab may rebalance Blue Chips between cirBTC, WETH and USDC, up to 500 USDC per trade and 2,000 USDC per day, no more than 6 trades a day, only when drift exceeds 3%, until 14 Nov. It can never withdraw."* The user signs that sentence, not a struct.
- **Live intent feed**: every intent, executed or rejected, newest first — agent, legs, drift before/after, cost, and for rejections the exact gate that caught it. Rejections render as *working*, not as errors: a refused intent is the system doing its job.
- **Per-agent scorecard**: intents submitted / executed / rejected (by reason), realised turnover, total cost in bps, mean absolute drift before vs after, time in band. All contract-derived. **No PnL, no returns, no leaderboard ranking by performance** — on testnet mirror assets those numbers would be meaningless, and presenting them would invite exactly the wrong decision.
- **Guardrail panel**: every policy from §3 with its current value, live budget bars (notional used, trades used, cooldown remaining), HWM and drawdown state.
- **Kill switch**: a persistent, always-reachable `Revoke all agents` control on the page and in the bucket header. One click, one transaction, immediate. Confirm with a dialog that says exactly what stops.
- Landing page gets one section: "Bring your own agent" — three lines, a link to `#/agents`, and the MCP snippet.

## 6. Documentation

Update `README.md` with: the service framing, the permission model, a `mermaid` sequence diagram (agent → context → simulate → sign intent → relayer → `AgentExecutor` → gates → venue → event), the full guardrail table, and an honest limits section covering what this does *not* protect against — a malicious agent can still burn the turnover budget within the limits; the oracle is a trust assumption; mirror assets are test tokens; the keeper backstop from Turn 8 is centralised; none of it is audited.

## Report back
- New contracts and addresses, and the `contracts:test` summary with the adversarial tests named.
- The context JSON for one live bucket.
- A transcript of `agent/example-agent.ts` doing one full loop against Arc Testnet, including at least one *rejected* intent showing a guardrail firing.
- Confirmation that revoke-while-intent-pending is tested and that no path exists from an agent session to moving funds out of a bucket.

Build exactly this. The guardrails and the kill switch are not the polish step — if time runs short, cut the scorecard and the MCP server before you cut a single on-chain check.
