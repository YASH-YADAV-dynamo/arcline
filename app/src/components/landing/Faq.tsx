// FAQ. Native <details> so it works without JS, is keyboard-operable and searchable by Ctrl+F.
// Answers stay short but honest about the testnet limits: a visitor finding out later is worse than
// reading it here, and the risk answers are the ones an agent operator actually needs.
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from '@/lib/router'

type Qa = { q: string; a: ReactNode }

const QA: Qa[] = [
  {
    q: 'What can an agent do here?',
    a: <>Read every market (price, age, risk, venue), quote a trade and rebalance a basket it is authorised for. Out-of-bounds requests revert on-chain.</>,
  },
  {
    q: 'What stops an agent from draining a position?',
    a: (
      <>
        Four on-chain gates: <strong>max trade size</strong>, <strong>drift band</strong>, <strong>cooldown</strong> and a{' '}
        <strong>slippage bound</strong>. A stale oracle blocks trading; risk level 3 exits to USDC.
      </>
    ),
  },
  {
    q: 'Are the RWAs real assets?',
    a: (
      <>
        No. <strong>MIRROR</strong> assets are testnet tokens priced from an Arc mainnet pool. Only <strong>REAL</strong> assets
        are the genuine token. The badge is on every row.
      </>
    ),
  },
  {
    q: 'Where do prices come from?',
    a: <>An on-chain registry written by a Chainlink CRE workflow. Each price is timestamped and stale ones are rejected.</>,
  },
  {
    q: 'Who triggers a rebalance?',
    a: <>A keeper checks every basket every couple of minutes and rebalances the ones outside their drift band. The call is permissionless, so you or your agent can also trigger it, and the contract pays the caller a small capped tip.</>,
  },
  {
    q: 'What is a basket?',
    a: (
      <>
        Your own contract holding target weights. It trades toward them within your limits; a <strong>SIP</strong> adds a
        recurring buy. You keep custody.{' '}
        <Link to="/buckets/new" className="text-accent hover:underline">Create a basket</Link>.
      </>
    ),
  },
  {
    q: 'Which venue executes the trade?',
    a: <>FX pairs settle on a real <strong>Uniswap v4</strong> pool. Mirror assets settle on an oracle-priced venue. Each market shows which.</>,
  },
  {
    q: 'What pays for gas?',
    a: <>USDC is the gas token on Arc. The ticket holds back a small amount for gas and tells you when it does.</>,
  },
  {
    q: 'Is this production-ready?',
    a: (
      <>
        No. It runs on <strong>Arc Testnet</strong>, the CRE workflow is not yet on a decentralised oracle network, and thin
        pools mean small trades move the price. Not investment advice.
      </>
    ),
  },
]

export function Faq() {
  return (
    <section aria-labelledby="faq-h">
      <div className="mb-3">
        <h2 id="faq-h" className="text-lg font-semibold tracking-tight">Questions</h2>
        <p className="text-xs text-muted">Including the parts that are not finished.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {QA.map(({ q, a }) => (
          <details key={q} className="group card min-w-0 p-0 [&[open]]:border-accent/40">
            <summary className="flex cursor-pointer list-none items-start gap-2 rounded-xl p-3.5 text-sm font-medium marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
              <ChevronDown
                size={16}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
              <span className="min-w-0">{q}</span>
            </summary>
            <p className="px-3.5 pb-3.5 pl-[2.1rem] text-[13px] leading-relaxed text-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
