// Exchange home: hero, the trade window (candle chart + order ticket), then auto-rebalancing, baskets and the rest of the exchange.
// One vertical rhythm for the whole page (the gap on the list below); sections own no outer padding.
// Each section after the fold fades in as it scrolls into view.
import { usePriceBook } from '@/lib/prices'
import { Link } from '@/lib/router'
import { Reveal } from '@/components/Reveal'
import { Hero } from '@/components/landing/Hero'
import { TerminalPreview } from '@/components/landing/TerminalPreview'
import { RebalanceSpotlight } from '@/components/landing/RebalanceSpotlight'
import { Categories } from '@/components/landing/Categories'
import { Faq } from '@/components/landing/Faq'
import { BucketsShowcase } from '@/components/landing/BucketsShowcase'
import { HowItWorks, TrustStrip } from '@/components/landing/HowItWorks'
import { MarketsTable } from '@/components/markets/MarketsTable'
import { OverviewStrip } from '@/components/markets/OverviewStrip'

export default function Landing() {
  const book = usePriceBook()
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-4">
      <Hero />
      <TerminalPreview />
      <div className="mt-14 flex flex-col gap-14 sm:mt-20 sm:gap-20">
        <Reveal><RebalanceSpotlight /></Reveal>
        <Reveal><BucketsShowcase /></Reveal>
        <Reveal><OverviewStrip rows={book.rows} loading={book.isLoading} /></Reveal>
        <Reveal><Categories rows={book.rows} loading={book.isLoading} /></Reveal>
        <Reveal>
          <section aria-labelledby="markets-h">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 id="markets-h" className="text-lg font-semibold tracking-tight">Markets</h2>
                <p className="text-xs text-muted">Price = on-chain oracle. 24h, chart and liquidity = Arc mainnet reference. MIRROR = testnet token priced from Arc mainnet.</p>
              </div>
              <Link to="/markets" className="hidden shrink-0 text-xs text-muted hover:text-ink sm:inline">All markets →</Link>
            </div>
            <MarketsTable rows={book.rows} loading={book.isLoading} error={Boolean(book.error)} />
          </section>
        </Reveal>
        <Reveal><HowItWorks /></Reveal>
        <Reveal><Faq /></Reveal>
        <Reveal><TrustStrip /></Reveal>
      </div>
    </div>
  )
}
