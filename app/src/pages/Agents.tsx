// #/agents: sub-accounts for agents, how to connect them to the registry, and the live listing-detection feed.
import type { ReactNode } from 'react'
import { AgentAccountPanel } from '@/components/agents/AgentAccountPanel'
import { ConnectPanel } from '@/components/agents/ConnectPanel'
import { DetectionFeed } from '@/components/agents/DetectionFeed'

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`agents-${eyebrow}`} className="mt-8">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={`agents-${eyebrow}`} className="mb-3 mt-1 text-xl font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

export default function Agents() {
  return (
    <div className="mx-auto w-full max-w-4xl min-w-0 px-4 py-6 sm:px-6">
      <p className="eyebrow">Agents</p>
      <h1 className="mt-1 text-3xl font-semibold text-ink sm:text-4xl">Give your agent its own wallet.</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Create a sub-account, fund it, and wire an agent to live markets. New listings are detected automatically and get a ticket.
      </p>

      <Section eyebrow="sub-accounts" title="Sub-accounts">
        <AgentAccountPanel />
      </Section>
      <Section eyebrow="connect" title="Connect">
        <ConnectPanel />
      </Section>
      <Section eyebrow="detection" title="Live detection feed">
        <DetectionFeed />
      </Section>
    </div>
  )
}
