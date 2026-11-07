// #/baskets: the Baskets home. Your baskets (with live drift and auto-rebalance status), a one-line
// explainer of how they work, and curated templates. Creating one is a wizard at #/baskets/new.
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Plus, RefreshCw, ShieldCheck, Target } from 'lucide-react'
import { Link } from '@/lib/router'
import { BasketArt } from '@/components/art/Art'
import { BucketCard } from '@/components/bucket/BucketCard'
import { TemplateGallery } from '@/components/bucket/TemplateGallery'
import { useBucketsOf, useCreationsByOwner } from '@/components/bucket/data'
import { Skeleton, VizStyles } from '@/components/bucket/ui'

const POINTS = [
  { Icon: Target, t: 'Target mix', d: 'RWA, FX and blue chips, in the weights you choose.' },
  { Icon: RefreshCw, t: 'Auto-rebalance', d: 'A keeper trades it back to target when it drifts.' },
  { Icon: ShieldCheck, t: 'Guardrails', d: 'Trade size, cooldown and slippage caps, on-chain.' },
] as const

export default function Baskets() {
  const { address, isConnected } = useAccount()
  const buckets = useBucketsOf(address)
  const names = useCreationsByOwner(address)
  const list = buckets.data ?? []

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <VizStyles />

      <header className="relative overflow-hidden rounded-2xl border border-line bg-panel p-5 sm:p-7">
        <BasketArt seed={7} className="pointer-events-none absolute -right-6 top-1/2 h-48 w-48 -translate-y-1/2 opacity-60 sm:right-4 sm:h-56 sm:w-56" />
        <div className="relative max-w-xl">
          <p className="eyebrow inline-flex items-center gap-1.5 text-accent"><RefreshCw size={13} aria-hidden="true" /> Auto-rebalancing</p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight sm:text-4xl">Baskets</h1>
          <p className="mt-2 text-sm text-muted sm:text-base">Pick a mix. It stays on target, and you keep custody.</p>
          <div className="mt-5 flex flex-col gap-2 min-[400px]:flex-row">
            <Link to="/baskets/new" className="btn h-11 px-6"><Plus size={16} aria-hidden="true" /> New basket</Link>
            <a href="#templates" className="btn-ghost h-11 px-6">Browse templates</a>
          </div>
        </div>
      </header>

      <ul className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="How baskets work">
        {POINTS.map(({ Icon, t, d }) => (
          <li key={t} className="card flex items-start gap-3 p-3.5">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon size={16} aria-hidden="true" /></span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t}</div>
              <div className="text-xs text-muted">{d}</div>
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-8" aria-labelledby="mine-h">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 id="mine-h" className="text-lg font-semibold tracking-tight">Your baskets</h2>
          {isConnected && list.length > 0 && <Link to="/portfolio" className="text-xs text-muted hover:text-ink">Portfolio overview →</Link>}
        </div>
        {!isConnected ? (
          <div className="card flex flex-col items-start gap-3 p-5">
            <p className="text-sm text-muted">Connect a wallet to see your baskets.</p>
            <ConnectKitButton />
          </div>
        ) : buckets.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-[260px]" />)}</div>
        ) : buckets.isError ? (
          <p className="text-sm text-muted">Couldn't read your baskets from Arc Testnet right now.</p>
        ) : list.length === 0 ? (
          <div className="card flex flex-col items-start gap-3 p-5">
            <p className="text-sm text-muted">No baskets yet. Start from a template below or build your own mix.</p>
            <Link to="/baskets/new" className="btn-ghost"><Plus size={16} aria-hidden="true" /> Create a basket</Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {[...list].reverse().map((b) => <BucketCard key={b} address={b} name={names.data?.get(b.toLowerCase())?.name} />)}
          </div>
        )}
      </section>

      <section id="templates" className="mt-8 scroll-mt-24 pb-6" aria-labelledby="tpl-h">
        <div className="mb-3">
          <h2 id="tpl-h" className="text-lg font-semibold tracking-tight">Templates</h2>
          <p className="text-xs text-muted">Curated starting points published on-chain. Copy one, then adjust.</p>
        </div>
        <TemplateGallery />
      </section>
    </div>
  )
}
