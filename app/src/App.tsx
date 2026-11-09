// App shell + routes. Pages live in src/pages; shared pieces in src/components and src/lib.
import { lazy, Suspense } from 'react'
import { useRoute } from '@/lib/router'
import { Shell } from '@/components/Shell'
import Landing from '@/pages/Landing'
import { warmFeed } from '@/lib/feed'

// Landing ships in the main bundle (first paint needs it). Every other page is its own chunk, and
// the likely next ones are fetched while the browser is idle so navigating feels instant.
const load = {
  trade: () => import('@/pages/Trade'),
  markets: () => import('@/pages/Markets'),
  portfolio: () => import('@/pages/Portfolio'),
  bucketNew: () => import('@/pages/BucketNew'),
  bucketDetail: () => import('@/pages/BucketDetail'),
  agents: () => import('@/pages/Agents'),
  baskets: () => import('@/pages/Baskets'),
}
const Trade = lazy(load.trade)
const Markets = lazy(load.markets)
const Portfolio = lazy(load.portfolio)
const BucketNew = lazy(load.bucketNew)
const BucketDetail = lazy(load.bucketDetail)
const Agents = lazy(load.agents)
const Baskets = lazy(load.baskets)

function prefetchPages() {
  const run = () => {
    void load.trade()
    void load.markets()
    // Warm the server built chart snapshots (one file each), so the first chart draws from memory.
    void warmFeed()
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 2000)
}
if (typeof window !== 'undefined') window.addEventListener('load', prefetchPages, { once: true })

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8" role="status" aria-label="Loading page">
      <div className="h-6 w-40 animate-pulse rounded bg-panel2 motion-reduce:animate-none" />
      <div className="mt-4 h-72 animate-pulse rounded-2xl bg-panel motion-reduce:animate-none" />
    </div>
  )
}

/** An unknown route must say so, not silently render the landing page — a silent fallback hides
 *  typos and broken links from users and from us. */
function NotFound({ path }: { path: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="eyebrow">404</p>
      <p className="text-sm font-medium">
        No page at <span className="font-mono">#/{path}</span>
      </p>
      <p className="max-w-sm text-xs text-muted">Check the link, or jump to a section below.</p>
      <nav className="mt-2 flex flex-wrap justify-center gap-2">
        {[
          ['/', 'Home'],
          ['/baskets', 'Baskets'],
          ['/portfolio', 'Portfolio'],
          ['/assets', 'Assets'],
          ['/agents', 'Agents'],
        ].map(([to, label]) => (
          <a key={to} href={`#${to}`} className="h-9 rounded-lg border border-line px-3 text-xs leading-9 hover:bg-panel2">
            {label}
          </a>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  const parts = useRoute()
  const [page, arg] = parts
  let view
  if (!page) view = <Landing />
  // `assets` is the public name; `markets` stays as an alias so existing links keep working.
  else if ((page === 'assets' || page === 'markets') && !arg) view = <Markets />
  else if (page === 'trade' && arg) view = <Trade symbol={arg} />
  else if (page === 'trade' && !arg) view = <Trade symbol="EURC" />
  else if (page === 'portfolio' && !arg) view = <Portfolio />
  else if (page === 'agents' && !arg) view = <Agents />
  else if ((page === 'baskets' || page === 'buckets') && !arg) view = <Baskets />
  // `baskets` is the public name; `buckets` stays as an alias so existing links keep working.
  else if ((page === 'buckets' || page === 'baskets') && arg === 'new') view = <BucketNew />
  else if ((page === 'buckets' || page === 'baskets') && /^0x[0-9a-fA-F]{40}$/.test(arg ?? '')) view = <BucketDetail address={arg as `0x${string}`} />
  else view = <NotFound path={parts.join('/')} />
  return (
    <Shell>
      <Suspense fallback={<PageFallback />}>{view}</Suspense>
    </Shell>
  )
}
