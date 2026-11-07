// Moves a connected wallet onto Arc Testnet by itself. Mounted once in Shell; renders nothing.
// One attempt per connection / chain change (ref-guarded), and a rejection stops it for the session
// until the user presses "Retry Arc Testnet", so there is never a prompt loop.
import { useEffect, useRef } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { runSwitch, setSwitchStatus } from '@/lib/arc-chain'

export function ArcAutoSwitch() {
  const { isConnected, chainId, connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const tried = useRef<string | null>(null)
  const uid = connector?.uid

  useEffect(() => {
    if (!isConnected || chainId === undefined) {
      tried.current = null
      setSwitchStatus('idle')
      return
    }
    if (chainId === arcTestnet.id) {
      tried.current = null
      setSwitchStatus('idle')
      return
    }
    const key = `${uid ?? 'wallet'}:${chainId}`
    if (tried.current !== null) return // already attempted this session; the retry button is the only way back in
    tried.current = key
    void runSwitch(switchChainAsync)
  }, [isConnected, chainId, uid, switchChainAsync])

  return null
}
