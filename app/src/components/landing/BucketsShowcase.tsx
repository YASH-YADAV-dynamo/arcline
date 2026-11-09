// Default bucket templates from the on-chain TemplateRegistry, as horizontally scrolling strategy cards.
import { ArrowRight } from '@phosphor-icons/react'
import { useAssets } from '@/lib/assets'
import { bps } from '@/lib/format'
import { Link } from '@/lib/router'
import { useTemplates, type Template } from '@/components/bucket/data'
import { RISK_LABEL } from '@/components/trade/hooks'
import { RiskDot, Skel, assetColor } from '@/components/markets/ui'

export function BucketsShowcase() {
  const templates = useTemplates()
  const assets = useAssets()
  const byToken = new Map((assets.data ?? []).map((a) => [a.token.toLowerCase(), a]))

  return (
    <section aria-labelledby="templates-h">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[680px]">
          <p className="text-accent caption-3 uppercase tracking-wide">Ready baskets</p>
          <h2 id="templates-h" className="mt-3 heading-5 sm:heading-4">Not sure what to pick? Start from one of these.</h2>
        </div>
        <Link to="/buckets/new" className="link-quiet shrink-0 caption-1">
          Build your own <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>

      {templates.isError ? (
        <div className="card p-6 text-muted body-6">Templates could not be read from Arc Testnet. Refresh the page, or <Link to="/buckets/new" className="text-accent underline-offset-4 hover:underline">build a custom basket</Link>.</div>
      ) : templates.isLoading || !templates.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading templates">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card space-y-3 p-6" aria-hidden>
              <Skel className="h-5 w-28" />
              <Skel className="h-2 w-full" />
              <Skel className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      ) : templates.data.length === 0 ? (
        <div className="card p-6 text-muted body-6">No templates are published yet. <Link to="/buckets/new" className="text-accent hover:underline">Build a custom basket</Link></div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.slice(0, 6).map((t) => (
            <Card key={t.id.toString()} t={t} symbolOf={(tok) => byToken.get(tok.toLowerCase())?.display ?? `${tok.slice(0, 6)}…`} riskOf={(tok) => byToken.get(tok.toLowerCase())?.risk ?? 0} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Card({ t, symbolOf, riskOf }: { t: Template; symbolOf: (token: string) => string; riskOf: (token: string) => number }) {
  const parts = t.tokens.map((tok, i) => ({ tok, sym: symbolOf(tok), w: t.weightsBps[i] ?? 0 }))
  const worst = Math.max(0, ...t.tokens.map(riskOf))
  return (
    <li className="card flex min-w-0 flex-col gap-4 p-6">
      <div className="min-w-0">
        <h3 className="truncate title-3">{t.name}</h3>
        <p className="mt-1 line-clamp-2 min-h-8 text-muted caption-5">{t.description}</p>
      </div>
      <div>
        <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.sym} ${bps(p.w)}`).join(', ')}>
          {parts.map((p) => (
            <div key={p.tok} className="h-full" style={{ width: `${p.w / 100}%`, background: assetColor(p.sym) }} />
          ))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 caption-5">
          {parts.map((p) => (
            <li key={p.tok} className="flex items-center gap-1">
              <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: assetColor(p.sym) }} />
              <span>{p.sym}</span>
              <span className="num font-mono text-muted">{bps(p.w)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 rounded-lg bg-panel2 p-3">
        <div className="space-y-0.5 font-mono text-muted caption-5">
          <div>Band ±{bps(t.bandBps)}</div>
          <div className="flex items-center gap-1" title={`Highest constituent risk level: ${RISK_LABEL[Math.min(worst, 3)]}`}>
            Risk <RiskDot level={worst} />
          </div>
        </div>
        <Link to={`/buckets/new?template=${t.id.toString()}`} className="cta-sm" aria-label={`Use the ${t.name} template`}>
          Use template
        </Link>
      </div>
    </li>
  )
}
