// Problem to solution, in plain words: why a mix needs looking after, and what the basket does instead.
// Every claim on the right maps to a real contract gate (drift band, cooldown, max trade size,
// slippage bound, price age, risk level).
import { ArrowRight, CheckCircle, XCircle } from '@phosphor-icons/react'
import { Link } from '@/lib/router'

const WITHOUT = [
  'One coin pumps, and suddenly it is most of your money.',
  'Fixing it means several trades, by hand, at the right moment.',
  'A trading bot can do it for you, but it can also buy at a bad price.',
]

const WITH = [
  'When a coin moves outside your drift band, the basket sells what grew and buys what fell.',
  'Every trade stays under your max trade size and slippage, then waits out a cooldown.',
  'A stale price means no trade. A coin that spikes suspiciously stops being bought.',
]

export function RebalanceSpotlight() {
  return (
    <section aria-labelledby="drift-h">
      <div className="max-w-[680px]">
        <p className="text-accent caption-3 uppercase tracking-wide">Why it matters</p>
        <h2 id="drift-h" className="mt-3 heading-5 sm:heading-4">
          Prices move.
          <br />
          Your portfolio quietly drifts.
        </h2>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <h3 className="text-muted title-3">Doing it yourself</h3>
          <ul className="mt-4 grid gap-3">
            {WITHOUT.map((t) => (
              <li key={t} className="flex gap-3 text-muted body-6">
                <XCircle size={20} aria-hidden="true" className="shrink-0 text-faint" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="card border-accent/40 p-6">
          <h3 className="title-3">With an Arcline basket</h3>
          <ul className="mt-4 grid gap-3">
            {WITH.map((t) => (
              <li key={t} className="flex gap-3 body-6">
                <CheckCircle size={20} weight="fill" aria-hidden="true" className="shrink-0 text-accent" />
                {t}
              </li>
            ))}
          </ul>
          <Link to="/buckets/new" className="link-quiet mt-6 text-accent caption-1 hover:text-ink">
            Try it with test USDC <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}
