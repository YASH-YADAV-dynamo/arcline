// #/assets (alias #/markets): every listed asset, framed as "what can go in a basket". Same table and
// price book as the rest of the app. A price that is stale cannot be rebalanced against, so its age sits
// next to the price.
import { CATEGORIES, type Category } from '@/lib/assets'
import { usePriceBook } from '@/lib/prices'
import { useHashParam } from '@/lib/router'
import { MarketsTable } from '@/components/markets/MarketsTable'

export default function Markets() {
  const book = usePriceBook()
  // #/assets?class=RWA preselects that tab. Anything not an on-chain category is ignored.
  const raw = useHashParam('class')
  const cls = raw && (CATEGORIES as readonly string[]).includes(raw) ? (raw as Category) : undefined
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Assets</h1>
        <p className="text-sm text-muted">What you can hold in a basket. A basket only trades an asset whose price is fresh and not flagged.</p>
      </div>
      <MarketsTable key={cls ?? 'All'} rows={book.rows} loading={book.isLoading} error={Boolean(book.error)} initialTab={cls} />
      <p className="text-xs text-faint">
        MIRROR = testnet token priced from Arc mainnet, not the real asset. REAL = the actual token on Arc Testnet. Not investment advice.
      </p>
    </div>
  )
}
