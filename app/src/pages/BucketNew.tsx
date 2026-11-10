// #/buckets/new: build a basket in three short steps (start, mix and limits, money in), then create it
// through the factory. Same visual language as the landing page: Geist text styles, Phosphor icons,
// cards on a plain background, one accent. Accepts ?template=<id> and ?asset=<SYMBOL> deep links.
import { useState, type ReactNode } from 'react'
import { useAccount } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi, formatUnits } from 'viem'
import { ArrowLeft, ArrowRight, Check, CircleNotch, PencilSimple, X } from '@phosphor-icons/react'
import { ADDR, bucketAbi, factoryAbi } from '@/lib/contracts'
import { findAsset, useAssets, type ListedAsset } from '@/lib/assets'
import { amt, bps, usd } from '@/lib/format'
import { Link, navigate } from '@/lib/router'
import { useTx } from '@/lib/tx'
import { BOUNDS, DEFAULT_PARAMS, duration, featured, useNow, useTemplates, useUsdc, type Params, type Template } from '@/components/bucket/data'
import { ParamsForm, paramsError } from '@/components/bucket/ParamsForm'
import { TargetsEditor, targetsError, type Row } from '@/components/bucket/TargetsEditor'
import { createdBucket } from '@/components/bucket/TemplateGallery'
import { parseAmount } from '@/components/bucket/OwnerPanel'
import { WeightsBar } from '@/components/bucket/charts'

import { LATEST_PRICE_SEC, useHashQuery } from '@/components/bucket/plan'
import { Dot, Skeleton, VizStyles, act, colorFor } from '@/components/bucket/ui'

const STEPS = ['Start', 'Mix and limits', 'Add money'] as const
const INTERVALS = [
  { label: 'Daily', sec: 86_400 },
  { label: 'Weekly', sec: 604_800 },
  { label: 'Monthly', sec: 2_592_000 },
] as const

const templateParams = (t: Template): Params => ({ ...DEFAULT_PARAMS, bandBps: t.bandBps }) // BucketFactory.createFromTemplate defaults
const sameRows = (rows: Row[], t: Template) =>
  rows.length === t.tokens.length && rows.every((r, i) => r.token.toLowerCase() === t.tokens[i].toLowerCase() && r.bps === t.weightsBps[i])

type Phase = { label: string; state: 'todo' | 'run' | 'done' | 'fail' }

function Panel({ title, hint, aside, children }: { title: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card min-w-0 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="title-3">{title}</h2>
          {hint && <p className="mt-1 text-muted caption-2">{hint}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

const priceText = (n: number) => (n >= 1 ? usd(n) : `$${n.toPrecision(3)}`)
const ago = (s: number) => (s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`)

/** One coin's live price and its age, so the person sees what a rebalance would be sized on. */
function PriceLine({ a, now }: { a: ListedAsset | undefined; now: number }) {
  if (!a) return <span className="text-faint">…</span>
  if (a.display === 'USDC') return <span className="text-muted">$1.00 · cash</span>
  if (a.priceE8 === null || a.observedAt === null) return <span className="text-warn">price paused</span>
  const age = Math.max(0, now - a.observedAt)
  return (
    <span className={age <= LATEST_PRICE_SEC ? 'text-muted' : 'text-warn'}>
      {priceText(Number(a.priceE8) / 1e8)} · {ago(age)}
    </span>
  )
}

export default function BucketNew() {
  const { address, isConnected } = useAccount()
  const { data: assets } = useAssets()
  const templates = useTemplates()
  const usdc = useUsdc(address, ADDR.factory)
  const { send } = useTx()
  const qc = useQueryClient()
  const q = useHashQuery()
  const now = useNow()

  const [step, setStep] = useState(0)
  const [from, setFrom] = useState<Template | null>(null)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [follow, setFollow] = useState(true)
  const [dep, setDep] = useState('')
  const [sipOn, setSipOn] = useState(false)
  const [sipAmt, setSipAmt] = useState('')
  const [every, setEvery] = useState<number>(INTERVALS[1].sec)
  const [runs, setRuns] = useState('12')
  const [phases, setPhases] = useState<Phase[] | null>(null)
  const [prefilled, setPrefilled] = useState(false)

  const pick = (t: Template | null) => {
    setFrom(t)
    if (t) {
      setRows(t.tokens.map((token, i) => ({ token, bps: t.weightsBps[i] })))
      setParams(templateParams(t))
      setName(t.name)
    } else {
      setRows([])
      setParams(DEFAULT_PARAMS)
      setName('')
    }
  }

  // Deep links: ?template=<id> or ?asset=<SYMBOL>, applied once (state adjusted during render, not in an effect).
  if (!prefilled) {
    const tid = q.get('template')
    const sym = q.get('asset')
    if (tid !== null && templates.data) {
      const t = templates.data.find((x) => String(x.id) === tid)
      if (t) { pick(t); setStep(1) }
      setPrefilled(true)
    } else if (sym && assets) {
      const a = findAsset(assets, sym)
      if (a) { setFrom(null); setRows([{ token: a.token, bps: 10_000 }]); setStep(1) }
      setPrefilled(true)
    } else if ((tid === null && !sym) || (tid !== null && templates.isError)) setPrefilled(true)
  }

  const asTemplate = from !== null && sameRows(rows, from) && JSON.stringify(params) === JSON.stringify(templateParams(from))
  const weightsErr = targetsError(rows) ?? paramsError(params)
  const depN = dep.trim() ? parseAmount(dep, 6) : 0n
  const sipN = sipOn ? parseAmount(sipAmt, 6) : 0n
  const r = Number(runs)
  const runsOk = !sipOn || (Number.isInteger(r) && r >= BOUNDS.runs[0] && r <= BOUNDS.runs[1])
  const approveTotal = (depN ?? 0n) + (sipOn && sipN ? sipN * BigInt(runsOk ? r : 0) : 0n)
  const bal = usdc.data?.balance
  const fundErr =
    depN === null
      ? 'Enter a valid deposit amount'
      : sipOn && !sipN
        ? 'Enter an amount for each recurring buy'
        : !runsOk
          ? 'Number of buys must be 1 to 520'
          : !asTemplate && !name.trim()
            ? 'Give the basket a name'
            : bal !== undefined && depN > bal
              ? 'That is more USDC than your wallet holds'
              : null
  const busy = phases?.some((p) => p.state === 'run') ?? false
  const find = (t: string) => assets?.find((a) => a.token.toLowerCase() === t.toLowerCase())

  const run = async () => {
    const createLabel = asTemplate ? `Create from ${from.name}` : 'Create basket'
    type Job = { label: string; go: (b: `0x${string}`) => Promise<unknown> }
    const jobs: Job[] = []
    if (approveTotal > 0n) jobs.push({ label: `Allow ${amt(approveTotal, 6)} USDC`, go: (b) => send(`Approve ${amt(approveTotal, 6)} USDC`, { address: ADDR.usdc, abi: erc20Abi, functionName: 'approve', args: [b, approveTotal] }) })
    if (depN) jobs.push({ label: `Deposit ${amt(depN, 6)} USDC`, go: (b) => send(`Deposit ${amt(depN, 6)} USDC`, { address: b, abi: bucketAbi, functionName: 'deposit', args: [depN] }) })
    if (sipOn && sipN) jobs.push({ label: `Start recurring buy of ${amt(sipN, 6)} USDC every ${duration(every)}`, go: (b) => send('Start recurring buy', { address: b, abi: bucketAbi, functionName: 'setSip', args: [sipN, every, r] }) })
    const mark = (i: number, state: Phase['state']) => setPhases((p) => p?.map((x, k) => (k === i ? { ...x, state } : x)) ?? null)
    setPhases([{ label: createLabel, state: 'run' }, ...jobs.map((j) => ({ label: j.label, state: 'todo' as const }))])
    const created = asTemplate
      ? await send(createLabel, { address: ADDR.factory, abi: factoryAbi, functionName: 'createFromTemplate', args: [from.id, follow] })
      : await send(createLabel, { address: ADDR.factory, abi: factoryAbi, functionName: 'createBucket', args: [name.trim(), rows.map((x) => x.token), rows.map((x) => x.bps), params] })
    const b = createdBucket(created)
    if (!b) { mark(0, 'fail'); return }
    mark(0, 'done')
    for (let k = 0; k < jobs.length; k++) {
      mark(k + 1, 'run')
      const ok = await jobs[k].go(b)
      mark(k + 1, ok ? 'done' : 'fail')
      if (!ok) break
    }
    await qc.invalidateQueries({ queryKey: ['bucket'] })
    navigate(`/buckets/${b}`)
  }

  const canNext = step === 0 ? true : step === 1 ? !weightsErr : false
  const confirmations = 1 + (approveTotal > 0n ? 1 : 0) + (depN ? 1 : 0) + (sipOn && sipN ? 1 : 0)
  const status =
    step === 0
      ? from ? `Starting from ${from.name}.` : rows.length ? 'Your own mix.' : 'Pick a ready basket, or build your own.'
      : step === 1
        ? (weightsErr ?? 'Looks good. Shares make 100% and every limit is allowed.')
        : (fundErr ?? `${confirmations} wallet ${confirmations === 1 ? 'confirmation' : 'confirmations'}. Gas is paid in USDC.`)
  const statusBad = (step === 1 && Boolean(weightsErr)) || (step === 2 && Boolean(fundErr))

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <VizStyles />
      <Link to="/baskets" className="link-quiet caption-2">
        <ArrowLeft size={14} aria-hidden="true" /> Baskets
      </Link>

      <header className="mt-6 max-w-[680px]">
        <p className="text-accent caption-3 uppercase tracking-wide">New basket</p>
        <h1 className="mt-3 heading-5 sm:heading-4">Build your basket</h1>
        <p className="mt-3 text-muted body-6">Three short steps. You can change the mix and the limits later.</p>
      </header>

      {/* Steps: one quiet line with a progress rule under it. */}
      <nav aria-label="Steps" className="mt-10">
        <ol className="flex gap-6 sm:gap-10">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                disabled={i > step || busy}
                onClick={() => setStep(i)}
                aria-current={i === step ? 'step' : undefined}
                className={`inline-flex items-center gap-2 caption-1 transition-colors ${i === step ? 'text-ink' : i < step ? 'text-muted hover:text-ink' : 'text-faint'}`}
              >
                <span className={`inline-flex size-6 items-center justify-center rounded-full border font-mono caption-4 ${i < step ? 'border-accent bg-accent text-onaccent' : i === step ? 'border-accent text-accent' : 'border-line'}`}>
                  {i < step ? <Check size={12} weight="bold" aria-hidden="true" /> : i + 1}
                </span>
                <span className={i === step ? '' : 'hidden sm:inline'}>{s}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4 h-px w-full bg-line">
          <div className="h-px bg-accent transition-[width] duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </nav>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="min-w-0 space-y-6">
          {step === 0 && (
            <Panel title="How do you want to start?" hint="Ready baskets are starting points, not advice. You can edit any of them.">
              {templates.isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-32" />)}</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {featured(templates.data).map((t) => {
                    const on = from?.id === t.id
                    return (
                      <button
                        key={String(t.id)}
                        type="button"
                        onClick={() => pick(t)}
                        aria-pressed={on}
                        className={`flex min-w-0 flex-col gap-3 rounded-2xl border p-4 text-left transition-colors ${on ? 'border-accent bg-panel2' : 'border-line hover:bg-panel2'}`}
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="truncate title-4">{t.name || `Template ${t.id}`}</span>
                          {on && <Check size={16} weight="bold" className="shrink-0 text-accent" aria-hidden="true" />}
                        </span>
                        <span className="line-clamp-2 text-muted caption-2">{t.description || 'A curated mix.'}</span>
                        <WeightsBar tokens={t.tokens} weights={t.weightsBps} assets={assets} />
                        <span className="text-faint caption-5">Rebalances past {bps(t.bandBps)} drift</span>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => pick(null)}
                    aria-pressed={from === null}
                    className={`flex min-h-[148px] flex-col items-start justify-center gap-2 rounded-2xl border border-dashed p-4 text-left transition-colors ${from === null ? 'border-accent bg-panel2' : 'border-line hover:bg-panel2'}`}
                  >
                    <PencilSimple size={18} className="text-accent" aria-hidden="true" />
                    <span className="title-4">Build my own</span>
                    <span className="text-muted caption-2">Choose up to {BOUNDS.maxAssets} coins and set your own shares.</span>
                  </button>
                </div>
              )}
              {templates.isError && <p className="mt-3 text-muted caption-2">Ready baskets did not load. You can still build your own.</p>}
            </Panel>
          )}

          {step === 1 && (
            <>
              <Panel
                title="Coins and shares"
                hint="New money arrives as USDC and is spread across these shares."
                aside={from && <span className="text-muted caption-4">from {from.name}</span>}
              >
                <TargetsEditor rows={rows} onChange={setRows} assets={assets} />
              </Panel>
              <Panel title="Your limits" hint="The contract checks every trade against these. A trade that breaks one never happens.">
                <ParamsForm value={params} onChange={setParams} />
              </Panel>
            </>
          )}

          {step === 2 && (
            <>
              <Panel title="Name">
                {asTemplate ? (
                  <>
                    <p className="title-4">{from.name}</p>
                    <label className="mt-4 flex cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 accent-[rgb(var(--accent))]" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                      <span className="body-6">
                        Follow updates from the curator
                        <span className="block text-muted caption-2">When they publish a new version, your next rebalance moves to its shares. Your limits stay yours.</span>
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    <input className="field" maxLength={40} placeholder="Euro savings" value={name} onChange={(e) => setName(e.target.value)} />
                    <p className="mt-2 text-muted caption-2">{from ? 'You edited the ready basket, so it becomes your own mix without curator updates.' : 'Only shown to you, on your portfolio.'}</p>
                  </>
                )}
              </Panel>

              <Panel title="First deposit" hint="Optional. It lands as USDC, and the first rebalance buys your mix at live prices.">
                <div className="flex items-center justify-between text-muted caption-2">
                  <label htmlFor="dep">Amount in USDC</label>
                  <button type="button" className="hover:text-ink disabled:opacity-40" disabled={bal === undefined} onClick={() => bal !== undefined && setDep(formatUnits(bal, 6))}>
                    Wallet <span className="font-mono">{bal === undefined ? '…' : amt(bal, 6)}</span> · Max
                  </button>
                </div>
                <input id="dep" className="field mt-2 font-mono" inputMode="decimal" placeholder="0.00" value={dep} onChange={(e) => setDep(e.target.value)} />
              </Panel>

              <Panel
                title="Recurring buy"
                hint="Top the basket up on a schedule, like a savings plan."
                aside={
                  <button
                    type="button"
                    role="switch"
                    aria-checked={sipOn}
                    aria-label="Recurring buy"
                    onClick={() => setSipOn((v) => !v)}
                    className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${sipOn ? 'border-accent bg-accent' : 'border-line bg-panel2'}`}
                  >
                    <span className={`absolute top-0.5 size-[18px] rounded-full bg-ink transition-transform ${sipOn ? 'translate-x-[22px] bg-onaccent' : 'translate-x-0.5'}`} />
                  </button>
                }
              >
                {sipOn ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block text-muted caption-2">
                      USDC each time
                      <input className="field mt-2 font-mono" inputMode="decimal" placeholder="25" value={sipAmt} onChange={(e) => setSipAmt(e.target.value)} />
                    </label>
                    <div className="text-muted caption-2">
                      How often
                      <div className="mt-2 flex gap-1 rounded-xl border border-line p-1" role="radiogroup" aria-label="How often">
                        {INTERVALS.map((i) => (
                          <button key={i.sec} type="button" role="radio" aria-checked={every === i.sec} className={`tab flex-1 px-1 ${every === i.sec ? 'tab-on' : ''}`} onClick={() => setEvery(i.sec)}>
                            {i.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="block text-muted caption-2">
                      Number of buys
                      <input className="field mt-2 font-mono" inputMode="numeric" value={runs} onChange={(e) => setRuns(e.target.value.replace(/\D/g, ''))} />
                    </label>
                    <p className="text-muted caption-5 sm:col-span-3">Each buy takes the amount from your wallet and buys your mix. The first one runs one interval after you start.</p>
                  </div>
                ) : (
                  <p className="text-muted caption-2">Off. You can turn it on later from the basket page.</p>
                )}
              </Panel>
            </>
          )}

          <div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" className={`caption-2 ${statusBad ? 'text-down' : 'text-muted'}`}>{status}</p>
            <div className="flex shrink-0 items-center gap-4">
              {step > 0 && (
                <button type="button" className="link-quiet caption-1" disabled={busy} onClick={() => setStep(step - 1)}>
                  Back
                </button>
              )}
              {step < 2 ? (
                <button type="button" className="cta disabled:cursor-not-allowed disabled:opacity-40" disabled={!canNext} onClick={() => setStep(step + 1)}>
                  Continue <ArrowRight size={18} weight="bold" aria-hidden="true" />
                </button>
              ) : isConnected ? (
                <button type="button" className="cta disabled:cursor-not-allowed disabled:opacity-40" disabled={Boolean(fundErr) || Boolean(weightsErr) || busy} onClick={act(run)}>
                  {busy ? <CircleNotch size={18} className="animate-spin" aria-hidden="true" /> : null}
                  {busy ? 'Working' : depN || (sipOn && sipN) ? 'Create and fund' : 'Create basket'}
                </button>
              ) : (
                <ConnectKitButton />
              )}
            </div>
          </div>

          {phases && (
            <Panel title="Progress" hint="If a funding step fails, the basket still exists. Finish from its page.">
              <ol className="space-y-3">
                {phases.map((p, i) => (
                  <li key={p.label} className="flex items-center gap-3 body-6">
                    <span className={`inline-flex size-6 items-center justify-center rounded-full border font-mono caption-4 ${p.state === 'done' ? 'border-accent bg-accent text-onaccent' : p.state === 'fail' ? 'border-down text-down' : p.state === 'run' ? 'border-accent text-accent' : 'border-line text-faint'}`}>
                      {p.state === 'done' ? <Check size={12} weight="bold" /> : p.state === 'fail' ? <X size={12} weight="bold" /> : p.state === 'run' ? <CircleNotch size={12} className="animate-spin" /> : i + 1}
                    </span>
                    <span className={p.state === 'todo' ? 'text-muted' : ''}>{p.label}</span>
                    {p.state === 'run' && <span className="text-muted caption-5">confirm in your wallet</span>}
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <section className="card p-5 sm:p-6">
            <h2 className="title-3">Your mix</h2>
            {rows.length ? (
              <>
                <div className="mt-5">
                  <WeightsBar tokens={rows.map((x) => x.token)} weights={rows.map((x) => x.bps)} assets={assets} />
                </div>
                <ul className="mt-5 space-y-3">
                  {rows.map((x) => {
                    const a = find(x.token)
                    return (
                      <li key={x.token} className="flex items-center gap-3">
                        <Dot color={colorFor(x.token, assets)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate title-5">{a?.display ?? x.token.slice(0, 8)}</span>
                          <span className="block font-mono caption-5"><PriceLine a={a} now={now} /></span>
                        </span>
                        <span className="font-mono title-5">{bps(x.bps)}</span>
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <p className="mt-4 text-muted caption-2">Pick a ready basket or add coins to see your mix here.</p>
            )}

            <dl className="mt-6 space-y-2 border-t border-line pt-5 caption-2">
              {[
                ['Rebalances past', bps(params.bandBps)],
                ['Largest trade', bps(params.maxTradeBps)],
                ['Max slippage', bps(params.maxSlippageBps)],
                ['Waits between trades', duration(params.cooldown)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-mono">{v}</dd>
                </div>
              ))}
              {step === 2 && (depN || (sipOn && sipN)) ? (
                <div className="flex justify-between gap-3 pt-2">
                  <dt className="text-muted">Money in</dt>
                  <dd className="text-right font-mono">
                    {depN ? usd(Number(depN) / 1e6) : '$0'} now
                    {sipOn && sipN ? <span className="block text-muted">+ {usd(Number(sipN) / 1e6)} {duration(every)} × {runsOk ? r : '…'}</span> : null}
                  </dd>
                </div>
              ) : null}
            </dl>

            <p className="mt-5 border-t border-line pt-5 text-muted caption-5">
              Every rebalance uses the latest prices. Fresh Chainlink prices are posted right before it trades, and it waits if any price is more than {LATEST_PRICE_SEC / 60} minutes old.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
