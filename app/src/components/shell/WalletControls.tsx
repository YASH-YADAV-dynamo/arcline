import { ConnectKitButton } from 'connectkit'
import { useAccount, useReadContract } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { erc20Abi, formatUnits } from 'viem'
import { Wallet } from 'lucide-react'
import { ADDR } from '@/lib/contracts'
import { useArcNetwork } from '@/lib/arc-chain'

/** Always names the network. Green dot on Arc Testnet (5042002), neutral when no wallet is connected,
 *  and a calm "Switching…" while the shell moves the wallet over (a "Retry" button only if it was declined). */
export function NetworkPill() {
  const { onArc, wrongNet, rejected, retry } = useArcNetwork()
  if (rejected) {
    return (
      <button
        type="button"
        onClick={retry}
        title="Your wallet is on another network. Reconnect to Arc Testnet"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line px-2.5 text-xs font-medium text-muted transition hover:bg-panel2 hover:text-ink"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-faint" />
        <span className="hidden sm:inline">Reconnect to Arc Testnet</span>
        <span className="sm:hidden">Retry</span>
      </button>
    )
  }
  const label = wrongNet ? 'Switching…' : 'Arc Testnet'
  return (
    <span
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-line px-2.5 text-xs text-muted max-sm:w-9 max-sm:px-0"
      role="status"
      aria-label={wrongNet ? 'Switching your wallet to Arc Testnet' : onArc ? 'Connected to Arc Testnet' : 'Network: Arc Testnet'}
      title={wrongNet ? 'Switching your wallet to Arc Testnet' : onArc ? 'Connected to Arc Testnet (5042002)' : 'Arc Testnet (5042002)'}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${onArc ? 'bg-up' : wrongNet ? 'animate-pulse bg-faint' : 'bg-faint'}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  )
}

/** USDC balance via the 6-decimal ERC-20 interface (never the native 18-decimal balance). */
export function UsdcChip() {
  const { address, chainId } = useAccount()
  const bal = useReadContract({
    address: ADDR.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  })
  if (!address || chainId !== arcTestnet.id) return null
  const n = bal.data === undefined ? null : Number(formatUnits(bal.data, 6))
  return (
    <span className="hidden h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line px-2.5 font-mono text-xs lg:inline-flex" title="USDC balance on Arc Testnet">
      <span className="num text-ink">{n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
      <span className="text-muted">USDC</span>
    </span>
  )
}

export function WalletControls() {
  return (
    <ConnectKitButton.Custom>
      {({ show, isConnected, isConnecting, truncatedAddress, ensName }) => (
        <button
          type="button"
          onClick={show}
          className={isConnected ? 'btn-ghost h-9 min-w-0 max-w-[9.5rem] px-3 font-mono text-xs' : 'btn h-9 shrink-0 px-3'}
        >
          {isConnected ? (
            <span className="truncate">{ensName ?? truncatedAddress}</span>
          ) : (
            <>
              <Wallet size={15} />
              <span>{isConnecting ? 'Connecting…' : 'Connect'}</span>
            </>
          )}
        </button>
      )}
    </ConnectKitButton.Custom>
  )
}
