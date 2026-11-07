// One place that moves the wallet onto Arc Testnet, so the auto-switch on connect, the order ticket
// and useTx never fight over the wallet prompt.
//
//   - runSwitch() de-duplicates: concurrent callers share one wallet prompt.
//   - a rejection (or any failure) is remembered for the session, so nothing re-prompts in a loop;
//     the UI then offers a calm "Retry Arc Testnet" button, which calls retry().
//   - wagmi's switchChain adds the chain first when the wallet answers 4902 (config.ts has arcTestnet
//     with its RPC https://rpc.testnet.arc.io and native USDC), so there is no separate add step.
import { useCallback, useSyncExternalStore } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { toast } from 'sonner'

export type SwitchStatus = 'idle' | 'switching' | 'rejected'
type SwitchFn = (vars: { chainId: typeof arcTestnet.id }) => Promise<unknown>

let status: SwitchStatus = 'idle'
let inflight: Promise<boolean> | null = null
const listeners = new Set<() => void>()

export function setSwitchStatus(next: SwitchStatus) {
  if (status === next) return
  status = next
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
const getStatus = () => status

const isRejection = (e: unknown) => {
  const err = (e ?? {}) as { code?: number; name?: string; cause?: { code?: number } }
  return err.code === 4001 || err.cause?.code === 4001 || err.name === 'UserRejectedRequestError'
}

/** Ask the wallet to move to Arc Testnet. Resolves true when it did. Never throws. */
export function runSwitch(switchChainAsync: SwitchFn): Promise<boolean> {
  if (inflight) return inflight
  setSwitchStatus('switching')
  inflight = switchChainAsync({ chainId: arcTestnet.id })
    .then(() => {
      setSwitchStatus('idle')
      toast.success('Switched to Arc Testnet', { id: 'arc-switch', duration: 2500 })
      return true
    })
    .catch((e: unknown) => {
      setSwitchStatus('rejected')
      // a plain "no" in the wallet is not an error worth a toast; the retry button is already on screen
      if (!isRejection(e)) {
        const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? ''
        toast.error('Could not switch to Arc Testnet', { id: 'arc-switch', description: msg.slice(0, 140) })
      }
      return false
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Switch helper for imperative code (useTx): resolves true once the wallet is on Arc Testnet. */
export function useEnsureArc() {
  const { switchChainAsync } = useSwitchChain()
  return useCallback(() => runSwitch(switchChainAsync), [switchChainAsync])
}

/** Network state for UI. `switching` covers the moment between connecting and the wallet answering. */
export function useArcNetwork() {
  const { isConnected, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const st = useSyncExternalStore(subscribe, getStatus, getStatus)
  const onArc = isConnected && chainId === arcTestnet.id
  const wrongNet = isConnected && chainId !== arcTestnet.id
  const rejected = wrongNet && st === 'rejected'
  const retry = useCallback(() => void runSwitch(switchChainAsync), [switchChainAsync])
  return { isConnected, chainId, onArc, wrongNet, rejected, switching: wrongNet && !rejected, retry }
}
