// Centered hero. The landing has no navbar, so the wordmark sits at the top of the hero.
// Type: Inter with optical sizing (display cut at large sizes), tight tracking on the headline only.
// Order: wordmark, status pill, headline, subline, CTAs, feature capsules. The trade window follows directly.
import { ArrowLeftRight, ArrowRight, Bot, Landmark, Layers, RefreshCw, Repeat, type LucideIcon } from 'lucide-react'
import { Link } from '@/lib/router'
import { HeroBackdrop } from '@/components/art/Art'
import { Wordmark } from '@/components/shell/TopBar'

type Feature = { label: string; icon: LucideIcon; lead?: boolean }

// The first two are what Arcline is about; they get the accent tint.
const FEATURES: Feature[] = [
  { label: 'Auto-rebalancing', icon: RefreshCw, lead: true },
  { label: 'Baskets', icon: Layers, lead: true },
  { label: 'Recurring buys', icon: Repeat },
  { label: 'Spot trading', icon: ArrowLeftRight },
  { label: 'RWA & FX', icon: Landmark },
  { label: 'Agent API', icon: Bot },
]

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden px-2 pb-10 pt-6 text-center sm:pb-14 sm:pt-8" aria-labelledby="hero-h">
      <HeroBackdrop className="-z-10 opacity-70" />

      <div className="rise flex justify-center">
        <Wordmark />
      </div>

      <div className="mx-auto mt-10 max-w-4xl sm:mt-14">
        <p style={{ animationDelay: '60ms' }} className="rise mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-panel/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
          <span aria-hidden="true" className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-up opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-1.5 rounded-full bg-up" />
          </span>
          Spot DEX on Arc
        </p>

        <h1
          id="hero-h"
          style={{ animationDelay: '120ms' }}
          className="rise mx-auto mt-5 max-w-[18ch] text-balance text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-6xl lg:text-[4.5rem]"
        >
          The spot exchange for <span className="text-accent">real-world assets</span> on Arc
        </h1>

        <p style={{ animationDelay: '180ms' }} className="rise mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-muted sm:mt-6 sm:text-lg">
          Build a basket of RWAs, FX and crypto. It rebalances itself, within limits enforced on-chain. Or just trade spot.
        </p>

        <div style={{ animationDelay: '240ms' }} className="rise mt-8 flex flex-col items-center justify-center gap-3 min-[420px]:flex-row">
          <Link to="/buckets/new" className="btn h-12 w-full rounded-xl px-7 text-[15px] min-[420px]:w-auto">
            Create a basket <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link to="/trade/EURC" className="btn-ghost h-12 w-full rounded-xl bg-panel/60 px-7 text-[15px] backdrop-blur min-[420px]:w-auto">
            Start trading
          </Link>
        </div>

        <ul style={{ animationDelay: '300ms' }} className="rise mx-auto mt-9 flex max-w-2xl flex-wrap justify-center gap-2" aria-label="Features">
          {FEATURES.map(({ label, icon: Icon, lead }) => (
            <li
              key={label}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium backdrop-blur ${
                lead ? 'border-accent/35 bg-accent/10 text-ink' : 'border-line bg-panel/60 text-muted'
              }`}
            >
              <Icon size={14} aria-hidden="true" className={lead ? 'text-accent' : 'text-faint'} />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
