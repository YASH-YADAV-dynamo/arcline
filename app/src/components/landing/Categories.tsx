// Asset classes as browsable groups. The categories are NOT a marketing taxonomy — they are the
// `category` enum on AssetRegistry (Cash / FX / Crypto / Yield / RWA), so a tile can only show what
// the chain actually lists. Cash is omitted: USDC is the quote asset, not something you trade into.
import { Bitcoin, Coins, Landmark, Percent, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import type { Category } from '@/lib/assets'
import type { PriceRow } from '@/lib/prices'
import { Link } from '@/lib/router'
import { signedPct } from '@/components/trade/ui'

type Group = { key: Category; title: string; blurb: string; Icon: LucideIcon }

// Order is fixed and meaningful: blue chips first, then the RWA classes this venue exists for.
const GROUPS: Group[] = [
  { key: 'Crypto', title: 'Blue chips', blurb: 'BTC, ETH', Icon: Bitcoin },
  { key: 'RWA', title: 'RWA', blurb: 'Gold, equities', Icon: Landmark },
  { key: 'FX', title: 'FX', blurb: 'Stablecoin pairs on Uniswap v4', Icon: Coins },
  { key: 'Yield', title: 'Yield', blurb: 'Accrues while held', Icon: Percent },
]

export function Categories({ rows, loading }: { rows: PriceRow[] | undefined; loading: boolean }) {
  const byCat = useMemo(() => {
    const m = new Map<Category, PriceRow[]>()
    for (const r of rows ?? []) {
      if (r.asset.category === 'Cash') continue
      const list = m.get(r.asset.category)
      if (list) list.push(r)
      else m.set(r.asset.category, [r])
    }
    return m
  }, [rows])

  // Never render a tile for a class the registry does not list.
  const shown = GROUPS.filter((g) => loading || (byCat.get(g.key)?.length ?? 0) > 0)
  if (!loading && shown.length === 0) return null

  return (
    <section aria-labelledby="classes-h">
      <div className="mb-3">
        <h2 id="classes-h" className="text-lg font-semibold tracking-tight">Asset classes</h2>
        <p className="text-xs text-muted">Classes come straight from the on-chain registry.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map(({ key, title, blurb, Icon }) => {
          const list = byCat.get(key) ?? []
          return (
            <Link
              key={key}
              to={`/markets?class=${key}`}
              className="group card flex min-w-0 flex-col p-4 transition hover:border-accent/50 hover:bg-panel2"
            >
              <div className="flex items-center gap-2">
                <Icon size={16} className="shrink-0 text-accent" aria-hidden="true" />
                <h3 className="truncate text-sm font-semibold tracking-tight">{title}</h3>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted">{blurb}</p>
              <ul className="mt-3 flex-1 space-y-1.5">
                {loading
                  ? [0, 1].map((i) => <li key={i} className="h-4 animate-pulse rounded bg-panel2" />)
                  : list.slice(0, 3).map((r) => (
                      <li key={r.asset.token} className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                        <span className="truncate text-ink">{r.asset.display}</span>
                        <span className={`num shrink-0 ${r.change24h === null ? 'text-faint' : r.change24h >= 0 ? 'text-up' : 'text-down'}`}>
                          {r.change24h === null ? '—' : signedPct(r.change24h)}
                        </span>
                      </li>
                    ))}
              </ul>
              <p className="mt-3 text-[11px] text-faint">
                {loading ? '—' : `${list.length} market${list.length === 1 ? '' : 's'}`}
                <span className="ml-1 text-muted group-hover:text-ink">· Browse →</span>
              </p>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
