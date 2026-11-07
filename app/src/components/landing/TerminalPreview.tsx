// The landing "trade window": the same three panes as the Trade route, in one frame.
//   [symbols]  [pair header + candle chart]  [the real order ticket]
// The chart and the ticket are the actual Trade-page components (timeframes, candles/line, oracle and
// pool lines; Buy/Sell, slippage, quote, gas handling), so everything works here on the selected symbol.
// Prices come live from the price book.
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import { usePriceBook } from '@/lib/prices'
import { usd } from '@/lib/format'
import { Link } from '@/lib/router'
import { isUsdc, useTokenBalances } from '@/components/trade/hooks'
import { OrderTicket } from '@/components/trade/OrderTicket'
import { ChartBody, PairHeader } from '@/components/trade/ChartPanel'
import { Skel, signedPct, toneOf } from '@/components/trade/ui'
import { AssetIcon } from '@/components/markets/ui'

const DEFAULT = 'cirBTC'

export function TerminalPreview() {
  const book = usePriceBook()
  const { address } = useAccount()
  const qc = useQueryClient()
  const [picked, setPicked] = useState(DEFAULT)

  const rows = book.rows.filter((r) => r.asset.category !== 'Cash')
  const row = book.bySymbol.get(picked.toLowerCase()) ?? rows[0]
  const tradable = row && !isUsdc(row.asset.token) ? row : undefined
  const balances = useTokenBalances(address, book.rows.map((r) => r.asset.token))
  const afterSwap = () => {
    void balances.refetch()
    void qc.invalidateQueries({ queryKey: ['trade', 'quote'] })
  }
  const current = tradable?.asset.display ?? picked
  const searching = useIsFetching({ queryKey: ['refTokens'] }) > 0
  const refLoading = Boolean(tradable && !tradable.ref && (tradable.asset.mainnetRef || (!tradable.refToken && searching)))

  return (
    <section aria-labelledby="terminal-h" className="relative z-10 mx-auto max-w-6xl">
      <h2 id="terminal-h" className="sr-only">Spot trade window: pick a market, see its liquidity, place an order</h2>
      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_60px_-30px_rgb(var(--accent)/0.35)]">
        <div className="flex items-center gap-3 border-b border-line bg-panel2/60 px-3 py-2">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-down/70" />
            <span className="size-2.5 rounded-full bg-warn/70" />
            <span className="size-2.5 rounded-full bg-up/70" />
          </span>
          <span className="min-w-0 truncate font-mono text-[11px] text-muted">{current} / USDC · Spot</span>
          <Link to={`/trade/${current}`} className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted hover:text-ink">
            Full terminal <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted sm:inline-flex">
            <span className="size-1.5 rounded-full bg-up" aria-hidden="true" />
            Arc Testnet
          </span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[200px_minmax(0,1fr)_330px]">
          {/* symbols: a wrapping grid on small screens, a list from lg */}
          <nav aria-label="Markets" className="min-w-0 border-b border-line lg:border-b-0 lg:border-r">
            <p className="eyebrow hidden px-3 pb-1 pt-3 lg:block">Markets</p>
            <ul className="grid grid-cols-2 gap-1 p-2 sm:grid-cols-4 lg:flex lg:max-h-[420px] lg:flex-col lg:overflow-y-auto">
              {book.isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <li key={i} className="px-2 py-2"><Skel className="h-7 w-full" /></li>
                  ))
                : rows.map((r) => {
                    const sym = r.asset.display
                    const on = sym === current
                    return (
                      <li key={r.asset.token} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setPicked(sym)}
                          aria-pressed={on}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${on ? 'bg-panel2 text-ink' : 'text-muted hover:bg-panel2/60 hover:text-ink'}`}
                        >
                          <AssetIcon symbol={sym} size={24} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium leading-tight text-ink">{sym}</span>
                            <span className="num block font-mono text-[11px] leading-tight">{r.stale ? 'stale' : usd(r.last)}</span>
                          </span>
                          <span className={`num hidden font-mono text-[11px] lg:inline ${toneOf(r.change24h)}`}>{signedPct(r.change24h)}</span>
                        </button>
                      </li>
                    )
                  })}
            </ul>
          </nav>

          <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-r">
            {tradable ? (
              <>
                <PairHeader row={tradable} refLoading={refLoading} as="h3" />
                <ChartBody key={tradable.asset.token} row={tradable} refLoading={refLoading} />
              </>
            ) : (
              <div className="p-4"><Skel className="h-[340px] w-full" /></div>
            )}
          </div>

          <div className="min-w-0">
            {tradable ? (
              <OrderTicket
                key={tradable.asset.token}
                row={tradable}
                balances={balances.data}
                balancesLoading={balances.isLoading}
                onDone={afterSwap}
                hideLiquidityNotice
              />
            ) : (
              <div className="space-y-3 p-4">
                {book.isLoading ? (
                  <>
                    <Skel className="h-9 w-full" />
                    <Skel className="h-11 w-full" />
                    <Skel className="h-24 w-full" />
                  </>
                ) : (
                  <p className="text-sm text-muted">Pick a market to trade.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
