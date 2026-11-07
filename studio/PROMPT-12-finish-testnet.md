# Turn 12: make the UI tell the truth about why a trade or rebalance is blocked

> **Read `PROMPT-0-shared-context.md` first** — repo map, contract facts, types, RPC constraints,
> and the regression + responsive checklists. Do not explore the repo; everything is in these files.

The backend is working. A live end-to-end run on Arc Testnet (`node ops/e2e.cjs`) passes: buys and
sells on the real Uniswap v4 venue, buys and sells on the mirror venue, bucket deposit, rebalance,
and the SIP gates. Prices are fresh, and every market has a chart.

**What is left is entirely UI honesty.** Every failure found during live testing was a contract
correctly refusing an action — and in each case the UI either said nothing or said the wrong thing.
Fix that. This is a frontend-only turn: no contracts, no redeploys, no new packages.

These are the real refusals observed, with their causes. Each one needs to be legible in the UI
*before* the user signs:

| Observed | Cause | Today's UI |
|---|---|---|
| `rebalance` reverts `Cooldown(1793990578)` | `params.cooldown` is 3600s and the window had 344s left | button just fails |
| `rebalance` reverts `NotNeeded(drift)` | drift inside `params.bandBps` (300 = 3%) | button just fails |
| `rebalance` reverts `MinOut(got, min)` | pool mid had drifted **11.3%** from the oracle after one 1 USDC swap; `maxSlippageBps` is 300 | raw revert |
| `setSip` reverts `BadParams()` | `interval < 3600` is rejected | raw revert |
| `deposit` reverts `ERC20: transfer amount exceeds balance` | **USDC is the gas token on Arc** — gas spending silently drains trading balance | raw revert |

## 1. Pre-flight every write, and put the reason on the button

Simulate before signing, and turn the refusal into the button's own label. Never let a user pay gas
to discover a gate.

```ts
// src/lib/preflight.ts — one helper for every write path (swap, rebalance, SIP, deposit).
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import type { Abi } from 'viem'

export type Gate = { ok: boolean; code: string | null; args: string[]; message: string | null }

/** Custom-error name + args from a viem revert. BucketAccount bubbles venue errors, so the
 *  selector often is not in the ABI you called — decode against both. */
export function decodeGate(e: unknown, label: string): Gate {
  const err = e as { cause?: { data?: { errorName?: string; args?: unknown[] } }; shortMessage?: string; message?: string }
  const d = err?.cause?.data
  const code = d?.errorName ?? null
  const args = (d?.args ?? []).map(String)
  return { ok: false, code, args, message: explain(code, args) ?? err?.shortMessage ?? `${label} failed` }
}

/** Plain language for every gate the contracts can throw. A user must never see a selector. */
export function explain(code: string | null, args: string[] = []): string | null {
  switch (code) {
    case 'Cooldown': {
      const left = Number(args[0] ?? 0) - Math.floor(Date.now() / 1000)
      return left > 0 ? `Rebalance available in ${fmtDur(left)}` : 'Rebalance available now'
    }
    case 'NotNeeded':   return `Already balanced — drift ${(Number(args[0] ?? 0) / 100).toFixed(2)}% is inside the band`
    case 'MinOut':      return 'Price moved past your slippage limit — the pool has drifted from the oracle price'
    case 'SlippageExceeded': return 'Price moved past the bucket’s slippage limit'
    case 'BadParams':   return 'Those settings are outside the allowed range'
    case 'Paused_':     return 'This bucket is paused'
    case 'SipInactive': return 'No active SIP'
    case 'SipNotDue':   return `Next SIP buy ${fmtWhen(Number(args[0] ?? 0))}`
    case 'StalePrice':  return 'No fresh oracle price for this asset — trading is blocked until the next report'
    case 'RiskBlocked': return 'Buys are paused for this asset by its risk level'
    case 'TradeTooLarge':      return 'Above the venue limit of 5,000 USDC per trade'
    case 'InsufficientReserve':return 'The venue does not hold enough USDC to fill this sell'
    case 'Unsupported':        return 'This venue cannot route this pair or size'
    default: return null
  }
}
export const fmtDur = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.ceil(s / 60)} min` : `${(s / 3600).toFixed(1)} h`)
const fmtWhen = (t: number) => { const d = t - Math.floor(Date.now() / 1000); return d > 0 ? `in ${fmtDur(d)}` : 'is due now' }

/** Simulate an exact call; returns ok, or the decoded gate. */
export function usePreflight(req: { address?: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[]; account?: `0x${string}` } | null, label: string) {
  const client = usePublicClient({ chainId: arcTestnet.id })
  return useQuery<Gate>({
    queryKey: ['preflight', label, req?.address, req?.functionName, JSON.stringify(req?.args ?? [], (_, v) => (typeof v === 'bigint' ? v.toString() : v)), req?.account],
    enabled: Boolean(client && req?.address && req?.account),
    retry: false,
    staleTime: 10_000,
    refetchInterval: 15_000, // a cooldown expiring should re-enable the button on its own
    queryFn: async (): Promise<Gate> => {
      try {
        await client!.simulateContract({ ...req!, account: req!.account } as never)
        return { ok: true, code: null, args: [], message: null }
      } catch (e) { return decodeGate(e, label) }
    },
  })
}
```

Apply it to:
- **Order ticket** (`src/components/trade/OrderTicket.tsx`): CTA label becomes the blocker —
  `Switch to Arc Testnet` · `Need 0.40 USDC` · `Price stale` · `Approve USDC` · else `Buy cirBTC`.
- **Bucket rebalance** (`src/components/bucket/*`, `src/pages/BucketDetail.tsx`): the Rebalance
  button shows `Rebalance available in 5.7 min` or `Already balanced — drift 0.05% inside band`,
  and **stays visible** with its reason rather than vanishing.
- **SIP form**: enforce `interval >= 3600` in the input itself (minimum 1 hour, with a helper
  line), so `BadParams` is unreachable.

## 2. Gas and balance, on Arc's terms

**USDC is the gas token** (`0x3600…0000`). A wallet showing "3.08 USDC" can still fail a 3 USDC
deposit because gas comes out of the same balance. Add `src/lib/spendable.ts`:

- `useSpendable()` returns `{ balance, reserved, spendable }` where `reserved` is a small gas buffer
  (default `0.25 USDC`) and `spendable = max(0, balance - reserved)`.
- Every amount input's **Max / 100%** chip uses `spendable`, never `balance`.
- Under the input: `Balance 3.08 USDC · 0.25 reserved for gas`.
- Below the reserve, a warning strip: *"Low gas. USDC pays for gas on Arc, so keep a small balance
  spare."* with a faucet link.

## 3. Oracle freshness, visible and counting down

Use `useOracleHealth()` (add it per `PROMPT-8` §1.2 if not present — `maxStaleness` is a public
getter on the registry; do not hardcode 3600).

- **Footer**: `Oracle · 7 of 7 fresh · oldest 6 min · stale in 54 min`, amber under 20% of budget,
  red when any asset is stale.
- **Pair header**: a stale row shows the last known price struck through plus when it was observed —
  a user needs to know *what* it was and *when*, not just the word "stale".
- **Price provenance chip** on every price: `cre` when the CRE workflow wrote it, `keeper` when
  `ops/report-prices.cjs` did, `pool` for a v4 mid, `unit` for USDC. Derive `cre` vs `keeper` from
  the most recent `PriceUpdated` sender. A keeper price **must** visibly say so — presenting a
  project-key price as a Chainlink price misstates the trust model.

## 4. Oracle-vs-pool deviation, before the trade

This is the subtlest real failure and it deserves prominence. One 1 USDC swap moved the testnet
USDC/EURC pool **11.3%** away from the oracle. Buckets price `minOut` from the oracle, so a
rebalance straight after a manual trade reverts `MinOut`.

`RoutePanel` already computes `poolDev`. Promote it:
- Above 1%: amber. Above the bucket's `maxSlippageBps` (3%): red, with
  *"Pool is 11.3% away from the oracle price. Automated rebalances will refuse to trade until the
  next price report."*
- On `BucketDetail`, if any held asset exceeds its slippage band, show that as the rebalance
  blocker rather than letting the user press a button that cannot succeed.

## 5. First-run gates — `#/onboard`

One row per gate, each green or carrying its own fix: wallet present · chain is 5042002
(`wallet_addEthereumChain` then `wallet_switchEthereumChain`) · USDC balance above the gas reserve
(faucet link, address pre-copied) · asset balance for a sell · oracle fresh for the asset ·
allowance. Reachable from the Connect button and from any blocked ticket.

## 6. Confirm the fill

After the receipt, parse `Swapped` from the logs and show filled amount, effective rate, and
realised slippage against the quote. Invalidate the balances, swaps and portfolio queries so the
bottom tabs update without a reload.

## Report back
- Files changed, and a screenshot of the ticket and the Rebalance button in each blocked state
  (cooldown, inside band, stale price, low gas).
- Confirmation that no raw selector or `0x…` error string can reach the UI.
- The completed checklists from sections A and B of the context pack.

Do exactly this. No contracts, no redeploys, no new dependencies, no refactors beyond adding the
two libs above and wiring them into the existing components.
