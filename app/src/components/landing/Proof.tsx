// Proof that needs the chain: the live oracle line under the hero CTA, and the list of deployed
// contracts. Nothing here is invented: ages come from the AssetRegistry, addresses from ADDR.
import { ArrowUpRight } from '@phosphor-icons/react'
import { useAssets } from '@/lib/assets'
import { ADDR } from '@/lib/contracts'
import { addrUrl, short } from '@/lib/format'
import { useNow } from '@/components/bucket/data'

function age(sec: number) {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  return `${Math.floor(sec / 3600)}h`
}

/** "N markets priced onchain by Chainlink CRE, newest price Xs old". Skeleton while loading.
 *  USDC is pinned at $1 by the registry, so it never counts as a fresh report; and when every other
 *  price is stale the line says trading is paused instead of quoting a misleading age. */
export function OracleProof() {
  const now = useNow(5_000)
  const assets = useAssets()
  const list = (assets.data ?? []).filter((a) => a.display !== 'USDC')
  const ages = list.filter((a) => a.priceE8 !== null && a.observedAt).map((a) => Math.max(0, now - (a.observedAt ?? 0)))

  if (assets.isLoading) {
    return <span aria-hidden="true" className="mx-auto block h-4 w-64 animate-pulse rounded bg-panel2 motion-reduce:animate-none" />
  }
  if (assets.isError || list.length === 0) {
    return <p className="text-muted caption-5">Prices are posted onchain by a Chainlink CRE workflow.</p>
  }
  if (ages.length === 0) {
    return (
      <p className="inline-flex items-center gap-2 text-warn caption-5">
        <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
        Oracle prices are stale, so baskets are paused until the next report.
      </p>
    )
  }
  return (
    <p className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-muted caption-5">
      <span aria-hidden="true" className="size-2 rounded-full bg-up" />
      <span>
        <span className="num font-mono text-ink">{ages.length}</span> of {list.length} markets freshly priced onchain
      </span>
      <span aria-hidden="true" className="text-faint">·</span>
      <span>
        newest price <span className="num font-mono text-ink">{age(Math.min(...ages))}</span> old
      </span>
    </p>
  )
}

const CONTRACTS: { label: string; what: string; addr: string }[] = [
  { label: 'Basket factory', what: 'Deploys one basket contract per user', addr: ADDR.factory },
  { label: 'Asset registry', what: 'Holds prices, their age and risk levels', addr: ADDR.registry },
  { label: 'Template registry', what: 'Publishes the starter baskets', addr: ADDR.templates },
  { label: 'Uniswap v4 venue', what: 'Settles USDC and EURC trades', addr: ADDR.uniVenue },
  { label: 'Mirror venue', what: 'Settles oracle priced test tokens', addr: ADDR.mirrorVenue },
]

export function VerifyOnchain() {
  return (
    <section aria-labelledby="verify-h" className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
      <div>
        <p className="text-accent caption-3 uppercase tracking-wide">Trust</p>
        <h2 id="verify-h" className="mt-3 heading-5 sm:heading-4">Do not take our word for it. Check the contracts.</h2>
        <p className="mt-4 text-muted body-6 sm:body-3">
          Your limits are saved in your own basket contract, not on our servers. Every contract below is public on the
          Arc explorer.
        </p>
      </div>
      <ul className="card divide-y divide-line overflow-hidden">
        {CONTRACTS.map((c) => (
          <li key={c.addr}>
            <a
              href={addrUrl(c.addr)}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-4 p-4 transition duration-300 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <span className="min-w-0">
                <span className="block title-4">{c.label}</span>
                <span className="block truncate text-muted caption-5">{c.what}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 font-mono text-muted caption-5 group-hover:text-ink">
                {short(c.addr)}
                <ArrowUpRight size={14} aria-hidden="true" />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
