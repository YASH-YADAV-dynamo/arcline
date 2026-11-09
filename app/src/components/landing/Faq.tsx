// FAQ. Native <details> so it works without JS, is keyboard operable and searchable by Ctrl+F.
// Plain answers a trader can act on, honest about the testnet limits: a visitor finding out later is
// worse than reading it here. Plain question and answer text, so it also reads well to answer engines.
import { CaretDown } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Link } from '@/lib/router'

type Qa = { q: string; a: ReactNode }

const link = 'text-accent underline-offset-4 hover:underline'

export const QA: Qa[] = [
  {
    q: 'What is a basket?',
    a: (
      <>
        A small contract that belongs to you and holds a mix of coins, like 50% bitcoin, 30% gold and 20% euro. It keeps
        that mix on target for you. <Link to="/buckets/new" className={link}>Create one</Link>.
      </>
    ),
  },
  {
    q: 'When does it rebalance?',
    a: <>When any coin moves further from its target than the range you picked, say 5%. A keeper checks every couple of minutes. Anyone can trigger a due rebalance, including you, and the caller gets a small capped tip for doing it.</>,
  },
  {
    q: 'Can it make a bad trade?',
    a: (
      <>
        It is built not to. Every trade has to pass your <strong>max trade size</strong>, <strong>slippage</strong>, <strong>drift range</strong> and{' '}
        <strong>wait time</strong>. If the price is old, nothing trades. If a coin spikes far above its reference, the basket sells it to USDC.
      </>
    ),
  },
  {
    q: 'Where do prices come from?',
    a: <>A Chainlink CRE workflow writes them onchain every five minutes. Each price carries the time it was taken, and old ones are refused.</>,
  },
  {
    q: 'Can I take my money out?',
    a: <>Yes, anytime. Withdraw one coin or everything to any address you choose.</>,
  },
  {
    q: 'Can I add more money later?',
    a: <>Yes. Deposit more USDC whenever you like, or set a recurring buy and the basket tops itself up on your schedule.</>,
  },
  {
    q: 'Are these real coins?',
    a: (
      <>
        Not yet. Coins marked <strong>MIRROR</strong> are test tokens that track the real price on Arc mainnet. Coins marked{' '}
        <strong>REAL</strong> are the genuine token on Arc Testnet. Every coin in the list shows which.
      </>
    ),
  },
  {
    q: 'Can I still trade by hand?',
    a: (
      <>
        Yes. <Link to="/trade/EURC" className={link}>Trade</Link> lets you buy or sell any listed coin against USDC. USDC and EURC trade on a real Uniswap v4 pool.
      </>
    ),
  },
  {
    q: 'What pays for gas?',
    a: <>USDC. On Arc it is also the gas token, so you never need a second coin. The app keeps a little aside for gas and tells you when it does.</>,
  },
  {
    q: 'Is this ready for real money?',
    a: (
      <>
        No. It runs on <strong>Arc Testnet</strong> with test USDC, the price workflow is not yet on a decentralised oracle network, and test pools are
        thin, so small trades move prices. Not investment advice.
      </>
    ),
  },
]

export function Faq() {
  return (
    <section aria-labelledby="faq-h" className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
      <div>
        <p className="text-accent caption-3 uppercase tracking-wide">Questions</p>
        <h2 id="faq-h" className="mt-3 heading-5 sm:heading-4">Straight answers, including what is not finished</h2>
      </div>
      <div className="grid gap-2">
        {QA.map(({ q, a }) => (
          <details key={q} className="group card min-w-0 transition-colors duration-300 open:border-accent/40">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl p-4 title-4 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">{q}</span>
              <CaretDown
                size={16}
                aria-hidden="true"
                className="shrink-0 text-muted transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <p className="px-4 pb-4 text-muted body-6">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
