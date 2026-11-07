import { TriangleAlert } from 'lucide-react'
import { isLowLiquidity } from '@/lib/liquidity'

/** Yellow warning shown on every market except EURC, which is the only one with real depth on testnet. */
export function LowLiquidityNotice({ symbol }: { symbol: string }) {
  if (!isLowLiquidity(symbol)) return null
  return (
    <div role="note" className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
      <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
      <p>
        <span className="font-semibold">Low liquidity.</span>{' '}
        <span className="text-ink/80">{symbol} trades on a thin testnet venue, so larger orders can move the price. Only EURC has real pool depth. Keep sizes small.</span>
      </p>
    </div>
  )
}
