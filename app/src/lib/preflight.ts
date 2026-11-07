// Simulate a write before the user signs, and turn the contract's refusal into plain language.
//
// Every failure found during live testing was a contract correctly refusing an action — a
// rebalance cooldown, a drift band, a slippage cap, a SIP interval below the minimum. A user must
// never pay gas to discover a gate, and must never see a raw 4-byte selector.
//
// Note: BucketAccount bubbles venue errors (MinOut comes from MirrorVenue/UniswapV4Venue, not
// from the bucket), so a selector is often absent from the ABI you called. `explain` is keyed by
// error NAME and covers both.
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import type { Abi } from 'viem'

export type Gate = { ok: boolean; code: string | null; args: string[]; message: string | null }

export const fmtDur = (s: number) => (s < 60 ? `${Math.max(0, s)}s` : s < 3600 ? `${Math.ceil(s / 60)} min` : `${(s / 3600).toFixed(1)} h`)
const fmtWhen = (t: number) => {
  const d = t - Math.floor(Date.now() / 1000)
  return d > 0 ? `in ${fmtDur(d)}` : 'is due now'
}

/** Plain language for every gate the contracts can throw. */
export function explain(code: string | null, args: string[] = []): string | null {
  switch (code) {
    case 'Cooldown': {
      const left = Number(args[0] ?? 0) - Math.floor(Date.now() / 1000)
      return left > 0 ? `Rebalance available in ${fmtDur(left)}` : 'Rebalance available now'
    }
    case 'NotNeeded':
      return `Already balanced — drift ${(Number(args[0] ?? 0) / 100).toFixed(2)}% is inside the band`
    case 'MinOut':
      return 'Price moved past the slippage limit — the pool has drifted from the oracle price'
    case 'SlippageExceeded':
      return 'Price moved past the basket’s slippage limit'
    case 'StalePrice':
      return 'No fresh oracle price for this asset — trading is blocked until the next price report'
    case 'RiskBlocked':
      return 'Buys are paused for this asset by its risk level'
    case 'TradeTooLarge':
      return 'Above the venue limit of 5,000 USDC per trade'
    case 'InsufficientReserve':
      return 'The venue does not hold enough USDC to fill this sell'
    case 'Unsupported':
      return 'This venue cannot route this pair or size'
    case 'BadParams':
      return 'Those settings are outside the allowed range'
    case 'BadWeights':
      return 'Those weights are not a valid allocation'
    case 'Paused_':
      return 'This basket is paused'
    case 'SipInactive':
      return 'No active SIP on this basket'
    case 'SipNotDue':
      return `Next SIP buy ${fmtWhen(Number(args[0] ?? 0))}`
    case 'NotOwner':
      return 'Only the basket owner can do this'
    case 'ReentrantCall':
      return 'A transaction is already in flight'
    case 'InvalidAddress':
      return 'Invalid address'
    default:
      return null
  }
}

type RevertLike = {
  cause?: { data?: { errorName?: string; args?: unknown[] } }
  shortMessage?: string
  message?: string
}

/** Custom-error name + args from a viem revert, with a human message. */
export function decodeGate(e: unknown, label: string): Gate {
  const err = e as RevertLike
  const d = err?.cause?.data
  const code = d?.errorName ?? null
  const args = (d?.args ?? []).map((x) => String(x))
  return { ok: false, code, args, message: explain(code, args) ?? err?.shortMessage ?? `${label} is not available right now` }
}

export type PreflightReq = {
  address?: `0x${string}`
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  account?: `0x${string}`
}

const OK: Gate = { ok: true, code: null, args: [], message: null }

/** Simulates the exact call the user is about to sign. `null` req disables the check. */
export function usePreflight(req: PreflightReq | null, label: string) {
  const client = usePublicClient({ chainId: arcTestnet.id })
  const key = JSON.stringify(req?.args ?? [], (_: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v))
  return useQuery<Gate>({
    queryKey: ['preflight', label, req?.address, req?.functionName, key, req?.account],
    enabled: Boolean(client && req?.address && req?.account),
    retry: false,
    staleTime: 10_000,
    refetchInterval: 15_000, // an expiring cooldown should re-enable the button on its own
    queryFn: async (): Promise<Gate> => {
      try {
        await client!.simulateContract({ ...req!, account: req!.account } as never)
        return OK
      } catch (e) {
        return decodeGate(e, label)
      }
    },
  })
}
