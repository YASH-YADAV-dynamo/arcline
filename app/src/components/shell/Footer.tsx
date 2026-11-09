// Exchange status bar (fixed 28px on desktop, inline on mobile) + a multi-column footer with links.
import { useReadContract } from 'wagmi'
import { useLive } from '@/lib/live'
import { arcTestnet } from 'viem/chains'
import { ArrowUpRight } from 'lucide-react'
import { useAssets } from '@/lib/assets'
import { ADDR, registryAbi } from '@/lib/contracts'
import { useNow } from '@/components/bucket/data'

const LINKS = [
  { href: 'https://studio.arc.io', label: 'Arc Studio' },
  { href: 'https://explorer.testnet.arc.io', label: 'Explorer' },
  { href: 'https://faucet.circle.com', label: 'Testnet faucet' },
]

function age(sec: number) {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

export function StatusBar() {
  const now = useNow(5_000)
  const live = useLive() // block number pushed over the WebSocket, no polling
  const maxStale = useReadContract({ address: ADDR.registry, abi: registryAbi, functionName: 'maxStaleness', chainId: arcTestnet.id, query: { staleTime: 300_000 } })
  const assets = useAssets()

  const list = assets.data ?? []
  const ages = list.filter((a) => a.observedAt).map((a) => Math.max(0, now - (a.observedAt ?? 0)))
  const freshest = ages.length ? Math.min(...ages) : null
  const oldest = ages.length ? Math.max(...ages) : null
  const limit = maxStale.data !== undefined ? Number(maxStale.data) : null
  const unpriced = list.filter((a) => a.priceE8 === null).length
  const stale = unpriced > 0 || (limit !== null && oldest !== null && oldest > limit)

  const sep = <span aria-hidden className="text-faint">·</span>
  return (
    <div className="z-30 border-t border-line bg-panel/95 backdrop-blur-md md:fixed md:inset-x-0 md:bottom-0">
      <div className="mx-auto flex min-h-7 max-w-[1600px] flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-1 font-mono text-[11px] leading-5 text-muted md:h-7 md:flex-nowrap md:overflow-hidden md:py-0">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${live.status === 'live' ? 'bg-up' : live.status === 'down' ? 'bg-warn' : 'bg-faint'}`} />
          <span className="num">{live.block ? `Block #${live.block.toLocaleString('en-US')}` : 'Block #…'}</span>
          <span className="text-faint">{live.status === 'live' ? 'live' : live.status === 'down' ? 'reconnecting' : 'connecting'}</span>
        </span>
        {sep}
        <span>Prices on-chain</span>
        {sep}
        <span className="num" title="Age of the freshest and oldest on-chain price in the AssetRegistry">
          oracle age {freshest === null ? '—' : freshest === oldest ? age(freshest) : `${age(freshest)}–${age(oldest ?? freshest)}`}
        </span>
        {stale && (
          <span className="font-semibold text-warn" title={unpriced ? `${unpriced} asset(s) without a fresh price: trading paused for them` : `Older than the registry limit of ${age(limit ?? 0)}`}>
            stale{unpriced ? ` (${unpriced})` : ''}
          </span>
        )}
        {sep}
        <span>Chainlink CRE</span>
        {sep}
        <span>Arc Testnet</span>
        <span className="ml-auto hidden whitespace-nowrap text-faint lg:inline">Not investment advice</span>
      </div>
    </div>
  )
}

const PRODUCT = [
  { href: '#/baskets', label: 'Baskets' },
  { href: '#/portfolio', label: 'Portfolio' },
  { href: '#/assets', label: 'Assets' },
  { href: '#/trade/EURC', label: 'Trade' },
]

const linkCls = 'inline-flex items-center gap-0.5 rounded text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 text-xs sm:pb-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="col-span-2 min-w-0 md:col-span-1">
            <p className="text-sm font-semibold tracking-tight text-ink">Arcline</p>
            <p className="mt-1.5 max-w-xs text-muted">Baskets of FX, crypto and real world assets that rebalance themselves on Arc.</p>
          </div>
          <nav aria-label="Product" className="min-w-0">
            <h2 className="eyebrow mb-2.5">Product</h2>
            <ul className="space-y-2">
              {PRODUCT.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className={linkCls}>{l.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Resources" className="min-w-0">
            <h2 className="eyebrow mb-2.5">Resources</h2>
            <ul className="space-y-2">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} target="_blank" rel="noopener noreferrer" className={linkCls}>
                    {l.label}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <p className="mt-8 border-t border-line pt-4 font-mono text-[11px] text-faint">
          Arc Testnet · Not investment advice · Mirror assets are testnet tokens priced from Arc mainnet
        </p>
      </div>
    </footer>
  )
}
