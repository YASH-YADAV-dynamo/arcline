// How it works: the three steps of creating a basket, in the order the create flow asks for them,
// ending on the action itself.
import { ArrowRight } from '@phosphor-icons/react'
import { Link } from '@/lib/router'

const STEPS = [
  { n: '1', title: 'Pick your coins', line: 'Start from a ready basket, or choose your own mix of FX, gold, crypto and yield.' },
  { n: '2', title: 'Set your limits', line: 'How far the mix can drift, your largest trade, the slippage you accept and how long to wait between trades.' },
  { n: '3', title: 'Add USDC', line: 'The basket buys your mix and keeps it on target from then on. Gas is paid in USDC too.' },
]

export function HowItWorks() {
  return (
    <section aria-labelledby="how-h">
      <div className="max-w-[680px]">
        <p className="text-accent caption-3 uppercase tracking-wide">How it works</p>
        <h2 id="how-h" className="mt-3 heading-5 sm:heading-4">Up and running in three steps</h2>
      </div>
      <ol className="mt-8 grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="card p-6">
            <span className="inline-flex size-8 items-center justify-center rounded-full border border-accent/40 font-mono text-accent caption-3">
              {s.n}
            </span>
            <h3 className="mt-4 title-3">{s.title}</h3>
            <p className="mt-2 text-muted body-6">{s.line}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link to="/buckets/new" className="cta">
          Start step one <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </Link>
        <span className="text-muted caption-2">You can change your mix and limits later.</span>
      </div>
    </section>
  )
}
