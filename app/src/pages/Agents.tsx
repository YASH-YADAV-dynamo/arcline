// #/agents: give an agent its own wallet, connect it to the onchain markets, and watch for new listings.
// Same visual language as the landing page: Geist text styles, Phosphor icons, numbered steps, cards.
import type { ReactNode } from 'react'
import { ArrowsClockwise, Plugs, Robot, Wallet } from '@phosphor-icons/react'
import { AgentAccountPanel } from '@/components/agents/AgentAccountPanel'
import { ConnectPanel } from '@/components/agents/ConnectPanel'
import { DetectionFeed } from '@/components/agents/DetectionFeed'

const STEPS = [
  { icon: Wallet, title: 'Create a wallet', line: 'A separate wallet with its own key, made in your browser and shown once.' },
  { icon: Robot, title: 'Fund only what it needs', line: 'It can spend what you send it and nothing more. USDC also pays its gas.' },
  { icon: Plugs, title: 'Connect your code', line: 'Read prices from the registry, trade, or run rebalances and earn the keeper tip.' },
]

function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`agents-step-${n}`} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12">
      <div>
        <span className="inline-flex size-8 items-center justify-center rounded-full border border-accent/40 font-mono text-accent caption-3">{n}</span>
        <h2 id={`agents-step-${n}`} className="mt-4 title-2">{title}</h2>
        <p className="mt-2 text-muted body-6">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

export default function Agents() {
  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <header className="max-w-[720px]">
        <p className="text-accent caption-3 uppercase tracking-wide">Agents</p>
        <h1 className="mt-3 heading-5 sm:heading-4">Let an agent run your baskets</h1>
        <p className="mt-3 text-muted body-6">
          Give a bot its own wallet with a fixed budget. Every basket trade it triggers still has to pass the limits in the contract, so a bug
          gets a refused transaction, not a bad fill.
        </p>
      </header>

      <ol className="mt-10 grid gap-4 md:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, line }) => (
          <li key={title} className="card p-6">
            <Icon size={22} className="text-accent" aria-hidden="true" />
            <h3 className="mt-4 title-3">{title}</h3>
            <p className="mt-2 text-muted body-6">{line}</p>
          </li>
        ))}
      </ol>

      <div className="mt-16 space-y-16 sm:mt-20 sm:space-y-20">
        <Step n={1} title="Create and fund a wallet" hint="Each agent gets its own address. Remove it here any time; funds at the address are never touched.">
          <AgentAccountPanel />
        </Step>
        <Step n={2} title="Connect it" hint="Everything an agent needs is onchain. Download the market list, or copy a ready script.">
          <ConnectPanel />
        </Step>
        <Step n={3} title="Watch new listings" hint="When a new market is listed, it shows up here with a ready trade ticket.">
          <DetectionFeed />
        </Step>
      </div>

      <aside className="mt-16 flex items-start gap-3 border-t border-line pt-8 text-muted caption-2 sm:mt-20">
        <ArrowsClockwise size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <p>
          Rebalancing is open to anyone. An agent that calls <code className="font-mono text-ink">rebalance()</code> on a basket that is due is paid a
          small tip from that basket's spare cash, capped at 0.05 USDC.
        </p>
      </aside>
    </div>
  )
}
