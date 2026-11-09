// Hero: headline (outcome), subheadline (how), one primary action, one proof signal, then the hero
// visual. The proof signal is live chain data, so it is passed in as a slot: the hero itself stays a
// pure component that renders without a wallet provider (see scripts/smoke-render.tsx).
import type { ReactNode } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { Link } from '@/lib/router'

export function Hero({ proof }: { proof?: ReactNode }) {
  return (
    <section aria-labelledby="hero-h" className="px-4 pb-16 pt-8 text-center sm:pb-20">
      <div className="mx-auto max-w-[680px] pt-12 sm:pt-16">
        <p style={{ animationDelay: '60ms' }} className="rise inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-muted caption-4">
          <span aria-hidden="true" className="size-2 rounded-full bg-up" />
          Live on Arc Testnet
        </p>

        <h1 id="hero-h" style={{ animationDelay: '120ms' }} className="rise hero-ink mt-6 heading-3 sm:heading-2 lg:heading-1">
          Build a basket once.
          <br />
          It rebalances itself.
        </h1>

        <p style={{ animationDelay: '180ms' }} className="rise mx-auto mt-6 text-muted body-3 sm:body-7">
          Choose a mix of dollars, euros, gold and crypto. When prices push it out of shape, your basket trades back to
          your target on its own, and never outside the limits you set.
        </p>

        <div style={{ animationDelay: '240ms' }} className="rise mt-8 flex flex-col items-center gap-3">
          <Link to="/buckets/new" className="cta">
            Create a basket <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </Link>
          <p className="text-faint caption-5">Free to try with test USDC. Withdraw whenever you like.</p>
        </div>

        {proof && (
          <div style={{ animationDelay: '300ms' }} className="rise mt-8">
            {proof}
          </div>
        )}
      </div>

      <div style={{ animationDelay: '360ms' }} className="rise mx-auto mt-16 max-w-3xl text-left">
        <BasketPreview />
      </div>
    </section>
  )
}

type Row = { sym: string; target: number; now: number; tone: string }

// Illustrative numbers (labelled as such below). They add up: now sums to 100, and the sell equals
// the two buys, because a rebalance sells first and spends the proceeds.
const ROWS: Row[] = [
  { sym: 'cirBTC', target: 50, now: 57.3, tone: 'bg-accent' },
  { sym: 'XAUM', target: 30, now: 26.1, tone: 'bg-accent/60' },
  { sym: 'EURC', target: 20, now: 16.6, tone: 'bg-accent/30' },
]
const PLAN = [
  { side: 'Sell', sym: 'cirBTC', usdc: '72.40' },
  { side: 'Buy', sym: 'XAUM', usdc: '38.90' },
  { side: 'Buy', sym: 'EURC', usdc: '33.50' },
]
const LIMITS = ['Range ±5%', 'Max 250 USDC per trade', 'Slippage 0.5%', 'Waits 1h between trades']
const BAND = 5

function Mix({ label, pick }: { label: string; pick: (r: Row) => number }) {
  return (
    <div>
      <p className="mb-2 text-muted caption-4">{label}</p>
      <div
        role="img"
        aria-label={`${label}: ${ROWS.map((r) => `${r.sym} ${pick(r)}%`).join(', ')}`}
        className="flex h-8 gap-0.5 overflow-hidden rounded-lg"
      >
        {ROWS.map((r) => (
          <div key={r.sym} style={{ width: `${pick(r)}%` }} className={`flex min-w-0 items-center justify-center px-1 ${r.tone}`}>
            <span className={`truncate font-mono caption-4 ${r.tone === 'bg-accent' ? 'text-onaccent' : 'text-ink'}`}>
              {r.sym} {pick(r)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BasketPreview() {
  return (
    <figure className="card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="title-3">Global mix</p>
          <p className="text-muted caption-5">Example basket</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-warn/40 px-3 py-1 text-warn caption-3">
          <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
          Rebalance due
        </span>
      </div>

      <div className="mt-6 grid gap-4">
        <Mix label="Target" pick={(r) => r.target} />
        <Mix label="Now, after prices moved" pick={(r) => r.now} />
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <dl className="grid gap-2">
          {ROWS.map((r) => {
            const drift = r.now - r.target
            const past = Math.abs(drift) > BAND
            return (
              <div key={r.sym} className="flex items-center justify-between gap-3">
                <dt className="body-5">{r.sym}</dt>
                <dd className={`num font-mono caption-4 ${past ? 'text-warn' : 'text-muted'}`}>
                  {drift > 0 ? '+' : '−'}
                  {Math.abs(drift).toFixed(1)}% {past ? 'outside range' : 'within range'}
                </dd>
              </div>
            )
          })}
        </dl>
        <ol className="grid gap-2" aria-label="What the basket will trade, sells first">
          {PLAN.map((p) => (
            <li key={p.sym} className="flex items-center justify-between gap-3 rounded-lg bg-panel2 px-3 py-2">
              <span className="body-6">
                <span className={p.side === 'Sell' ? 'text-down' : 'text-up'}>{p.side}</span> {p.sym}
              </span>
              <span className="num font-mono text-muted caption-4">{p.usdc} USDC</span>
            </li>
          ))}
        </ol>
      </div>

      <ul className="mt-6 flex flex-wrap gap-2" aria-label="Limits the contract enforces">
        {LIMITS.map((l) => (
          <li key={l} className="rounded-full border border-line px-3 py-1 font-mono text-muted caption-5">
            {l}
          </li>
        ))}
      </ul>
      <figcaption className="mt-4 text-faint caption-5">Illustrative example, not live data.</figcaption>
    </figure>
  )
}
