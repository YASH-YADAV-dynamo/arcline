// The product's differentiator, shown right under the trade window: a basket drifts off its target
// mix and gets rebalanced inside hard on-chain limits. The bars are an ILLUSTRATION (labelled as
// such), not live data; the guardrails listed are the real contract gates.
import { ArrowRight, RefreshCw, ShieldCheck, Target } from 'lucide-react'
import { Link } from '@/lib/router'

type Seg = { sym: string; pct: number; tone: string }

// Same three assets in both bars so the drift is visible. Each segment carries its own text label,
// so the comparison never depends on colour alone.
const TARGET: Seg[] = [
  { sym: 'BTC', pct: 50, tone: 'bg-accent/80 text-onaccent' },
  { sym: 'XAUM', pct: 30, tone: 'bg-accent/50 text-ink' },
  { sym: 'EURC', pct: 20, tone: 'bg-accent/25 text-ink' },
]
const DRIFTED: Seg[] = [
  { sym: 'BTC', pct: 63, tone: 'bg-accent/80 text-onaccent' },
  { sym: 'XAUM', pct: 23, tone: 'bg-accent/50 text-ink' },
  { sym: 'EURC', pct: 14, tone: 'bg-accent/25 text-ink' },
]

const GATES = ['Max trade size', 'Drift band', 'Cooldown', 'Slippage cap']

function Bar({ label, segs }: { label: string; segs: Seg[] }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
        <span className="font-medium text-ink">{label}</span>
      </div>
      <div className="flex h-9 gap-0.5 overflow-hidden rounded-lg" role="img" aria-label={`${label}: ${segs.map((s) => `${s.sym} ${s.pct}%`).join(', ')}`}>
        {segs.map((s) => (
          <div key={s.sym} style={{ width: `${s.pct}%` }} className={`flex items-center justify-center truncate px-1 font-mono text-[11px] font-medium ${s.tone}`}>
            {s.sym} {s.pct}%
          </div>
        ))}
      </div>
    </div>
  )
}

export function RebalanceSpotlight() {
  return (
    <section aria-labelledby="rebal-h">
      <div className="relative overflow-hidden rounded-2xl border border-accent/40 bg-panel">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent" />
        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-2 lg:gap-10">
          <div className="min-w-0">
            <p className="eyebrow inline-flex items-center gap-1.5 text-accent">
              <RefreshCw size={13} aria-hidden="true" /> Auto-rebalancing
            </p>
            <h2 id="rebal-h" className="mt-2 text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              Set your mix. It rebalances itself.
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted sm:text-base">
              Prices move and your basket drifts. A keeper trades it back to target on Arc, and the contract rejects anything outside your limits.
            </p>

            <ol className="mt-5 space-y-3">
              {[
                { Icon: Target, t: 'Pick target weights', d: 'RWA, FX, blue chips, in any mix.' },
                { Icon: RefreshCw, t: 'Drift triggers it automatically', d: 'A keeper checks every basket. You or an agent can also trigger it.' },
                { Icon: ShieldCheck, t: 'Guardrails decide the trade', d: 'Out-of-bounds trades revert.' },
              ].map(({ Icon, t, d }, i) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      <span className="mr-1.5 font-mono text-xs text-muted">{i + 1}</span>
                      {t}
                    </div>
                    <div className="text-xs text-muted">{d}</div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-col gap-2 min-[400px]:flex-row">
              <Link to="/buckets/new" className="btn h-11 px-6">
                Create a basket <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link to="/agents" className="btn-ghost h-11 px-6">
                Rebalance with an agent
              </Link>
            </div>
          </div>

          <div className="min-w-0 self-center rounded-xl border border-line bg-bg/60 p-4 backdrop-blur">
            <div className="space-y-4">
              <Bar label="Target" segs={TARGET} />
              <div className="flex items-center gap-2 text-[11px] text-muted" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                <span className="font-mono">prices move · BTC +13% over target</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <Bar label="Drifted" segs={DRIFTED} />
              <div className="flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-xs font-medium text-ink">
                <RefreshCw size={14} aria-hidden="true" className="shrink-0 text-accent" />
                Rebalance: sell BTC, buy XAUM and EURC
              </div>
            </div>
            <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="On-chain guardrails">
              {GATES.map((g) => (
                <li key={g} className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-[11px] text-muted">
                  {g}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-faint">Illustrative example, not live data.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
