// Final CTA: the same action as the hero, with the risk reversal stated plainly next to it.
import { ArrowRight, ArrowUpRight } from '@phosphor-icons/react'
import { Link } from '@/lib/router'

const REASSURE = ['Free with test USDC', 'Your own contract, never pooled', 'Withdraw anytime']

export function FinalCta() {
  return (
    <section aria-labelledby="final-h" className="card px-6 py-16 text-center sm:px-12 sm:py-20">
      <h2 id="final-h" className="mx-auto max-w-[680px] heading-5 sm:heading-3">
        Ready to stop
        <br />
        rebalancing by hand?
      </h2>
      <ul className="mx-auto mt-6 flex max-w-[680px] flex-wrap justify-center gap-x-6 gap-y-2 text-muted caption-2">
        {REASSURE.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div className="mt-8 flex flex-col items-center gap-4">
        <Link to="/buckets/new" className="cta">
          Create a basket <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </Link>
        <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="link-quiet caption-5">
          No test USDC yet? Get some free from Circle
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}
