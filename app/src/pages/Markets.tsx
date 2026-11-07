// #/markets — every listed asset, same table and price book as the landing page and the trade terminal.
import { CATEGORIES, type Category } from '@/lib/assets'
import { usePriceBook } from '@/lib/prices'
import { useHashParam } from '@/lib/router'
import { MarketsTable } from '@/components/markets/MarketsTable'
import { OverviewStrip } from '@/components/markets/OverviewStrip'

export default function Markets() {
  const book = usePriceBook()
  // #/markets?class=RWA preselects that tab, so the landing page's class tiles actually filter.
  // Anything not an on-chain category is ignored rather than shown as an empty tab.
  const raw = useHashParam('class')
  const cls = raw && (CATEGORIES as readonly string[]).includes(raw) ? (raw as Category) : undefined
  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 px-4 py-4 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Markets</h1>
          <p className="text-xs text-muted">Spot vs USDC on Arc Testnet. Prices are the on-chain oracle; 24h, chart and liquidity are Arc mainnet reference data.</p>
        </div>
      </div>
      <OverviewStrip rows={book.rows} loading={book.isLoading} />
      <MarketsTable key={cls ?? 'All'} rows={book.rows} loading={book.isLoading} error={Boolean(book.error)} initialTab={cls} />
      <p className="text-[11px] text-faint">
        MIRROR = testnet token priced from Arc mainnet, not the real asset. REAL = the actual token on Arc Testnet. Not investment advice.
      </p>
    </div>
  )
}
