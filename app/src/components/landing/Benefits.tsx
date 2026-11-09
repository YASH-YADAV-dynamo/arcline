// Benefits: what each contract feature means for the person holding the basket, in plain words.
import type { Icon } from '@phosphor-icons/react'
import { ArrowsClockwise, CalendarCheck, Gauge, ShieldCheck, Vault } from '@phosphor-icons/react'

const BENEFITS: { icon: Icon; title: string; line: string }[] = [
  {
    icon: ArrowsClockwise,
    title: 'Stays balanced without you',
    line: 'A keeper checks every basket every couple of minutes and fixes the ones that drifted. You can also hit rebalance yourself.',
  },
  {
    icon: Gauge,
    title: 'Your limits, enforced',
    line: 'Max trade size, slippage, drift range and wait time are saved in your contract. A trade that breaks them simply fails.',
  },
  {
    icon: ShieldCheck,
    title: 'No trades on bad prices',
    line: 'Every price shows how old it is. Old prices block trading, and a coin that jumps 20% above its reference is sold back to USDC.',
  },
  {
    icon: CalendarCheck,
    title: 'Recurring buys',
    line: 'Pick an amount and a schedule. The basket buys in for you each time, the same way a SIP works.',
  },
  {
    icon: Vault,
    title: 'Your money stays yours',
    line: 'Each basket is your own contract, never pooled with anyone else. Take out one coin or everything, anytime.',
  },
]

export function Benefits() {
  return (
    <section aria-labelledby="benefits-h">
      <div className="max-w-[680px]">
        <p className="text-accent caption-3 uppercase tracking-wide">What you get</p>
        <h2 id="benefits-h" className="mt-3 heading-5 sm:heading-4">A portfolio that looks after itself</h2>
      </div>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map(({ icon: I, title, line }) => (
          <li key={title} className="card p-6">
            <span className="inline-flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <I size={22} aria-hidden="true" />
            </span>
            <h3 className="mt-4 title-3">{title}</h3>
            <p className="mt-2 text-muted body-6">{line}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
