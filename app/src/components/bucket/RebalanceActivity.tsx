// Portfolio feed of what the user's baskets did on their own: rebalances and recurring buys, with the swaps
// each rebalance made. Read from BucketAccount events (Rebalanced / SipExecuted / TradeExecuted), newest
// first. Rebalances are permissionless, so the "by" field shows who triggered it: the owner, or someone else
// (normally the keeper). Stacked rows, not a table, so it never scrolls sideways on a phone.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ExternalLink, RefreshCw, Repeat } from 'lucide-react'
import { bucketAbi } from '@/lib/contracts'
import type { ListedAsset } from '@/lib/assets'
import { amt, bps, e18, short, txUrl, usd } from '@/lib/format'
import { blockChunks, dateTime, pool, useArcClient, type Creation, type Hex } from './data'
import { Section, Skeleton, symbolOf } from './ui'

type Raw = { name: string; args: Record<string, unknown>; tx: Hex; block: bigint; index: number; bucket: Hex }
type Swap = { from: string; to: string; amountIn: bigint; amountOut: bigint; tokenIn: string; tokenOut: string }
type Item = {
  key: string
  kind: 'rebalance' | 'sip'
  bucket: Hex
  tx: Hex
  block: bigint
  caller: string
  detail: string
  swaps: Swap[]
}

const PAGE = 8
const WANT = new Set(['Rebalanced', 'SipExecuted', 'TradeExecuted'])

export function RebalanceActivity({
  buckets,
  owner,
  names,
  assets,
}: {
  buckets: readonly Hex[]
  owner: Hex | undefined
  names: Map<string, Creation> | undefined
  assets: ListedAsset[] | undefined
}) {
  const client = useArcClient()
  const [shown, setShown] = useState(PAGE)
  const key = buckets.map((b) => b.toLowerCase()).join()

  const events = useQuery({
    queryKey: ['bucket', 'activity', key],
    enabled: Boolean(client && buckets.length),
    refetchInterval: 30_000,
    staleTime: 15_000,
    queryFn: async (): Promise<Raw[]> => {
      const c = client!
      const chunks = await blockChunks(c)
      const parts = await pool(chunks, 4, ([fromBlock, toBlock]) => c.getContractEvents({ address: [...buckets], abi: bucketAbi, fromBlock, toBlock }))
      return parts
        .flat()
        .filter((l) => WANT.has(String(l.eventName)))
        .map((l) => ({ name: String(l.eventName), args: l.args as Record<string, unknown>, tx: l.transactionHash, block: l.blockNumber, index: l.logIndex, bucket: l.address }))
    },
  })

  const items: Item[] = (() => {
    const raw = events.data ?? []
    const swapsByTx = new Map<string, Swap[]>()
    for (const e of raw) {
      if (e.name !== 'TradeExecuted') continue
      const a = e.args
      const k = `${e.tx}-${e.bucket}`
      const list = swapsByTx.get(k) ?? []
      list.push({ from: symbolOf(String(a.tokenIn), assets), to: symbolOf(String(a.tokenOut), assets), amountIn: a.amountIn as bigint, amountOut: a.amountOut as bigint, tokenIn: String(a.tokenIn), tokenOut: String(a.tokenOut) })
      swapsByTx.set(k, list)
    }
    const out: Item[] = []
    for (const e of raw) {
      const a = e.args
      const swaps = swapsByTx.get(`${e.tx}-${e.bucket}`) ?? []
      if (e.name === 'Rebalanced') {
        out.push({
          key: `${e.tx}-${e.index}`, kind: 'rebalance', bucket: e.bucket, tx: e.tx, block: e.block, caller: String(a.caller), swaps,
          detail: `Drift ${bps(Number(a.maxDriftBps))} · ${usd(e18(a.valueBeforeE18 as bigint))} → ${usd(e18(a.valueAfterE18 as bigint))}`,
        })
      } else if (e.name === 'SipExecuted') {
        out.push({
          key: `${e.tx}-${e.index}`, kind: 'sip', bucket: e.bucket, tx: e.tx, block: e.block, caller: String(a.caller), swaps,
          detail: `Bought with ${amt(a.amountUsdc as bigint, 6)} USDC · ${Number(a.runsLeft)} runs left`,
        })
      }
    }
    return out.sort((x, y) => (x.block === y.block ? 0 : x.block > y.block ? -1 : 1))
  })()

  const visible = items.slice(0, shown)
  const blocks = [...new Set(visible.map((i) => i.block))]
  const times = useQuery({
    queryKey: ['bucket', 'blocktimes', blocks.map(String).join()],
    enabled: Boolean(client && blocks.length),
    staleTime: Infinity,
    queryFn: async () => new Map(await pool(blocks, 4, (b) => client!.getBlock({ blockNumber: b }).then((x) => [b, Number(x.timestamp)] as const))),
  })

  const nameOf = (b: Hex) => names?.get(b.toLowerCase())?.name || `Basket ${short(b)}`
  const dec = (t: string) => assets?.find((a) => a.token.toLowerCase() === t.toLowerCase())?.decimals
  const leg = (s: Swap) => {
    const di = dec(s.tokenIn)
    const dout = dec(s.tokenOut)
    return `${di === undefined ? '' : `${amt(s.amountIn, di)} `}${s.from} → ${dout === undefined ? '' : `${amt(s.amountOut, dout)} `}${s.to}`
  }
  const who = (caller: string) => (owner && caller.toLowerCase() === owner.toLowerCase() ? 'You' : `Auto · ${short(caller)}`)

  return (
    <Section title="Rebalance activity" aside={<span className="text-xs text-muted">Runs automatically, limits enforced on-chain</span>}>
      {!buckets.length ? (
        <p className="text-sm text-muted">No baskets yet. Once you create one, every rebalance and recurring buy it makes shows up here.</p>
      ) : events.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : events.isError ? (
        <p className="text-sm text-muted">Couldn't load basket events from the RPC. Retrying shortly.</p>
      ) : !items.length ? (
        <p className="text-sm text-muted">Nothing yet. A basket rebalances on its own when an asset drifts past its band, then logs it here with the swaps it made.</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {visible.map((it) => {
              const ts = times.data?.get(it.block)
              const Icon = it.kind === 'rebalance' ? RefreshCw : Repeat
              return (
                <li key={it.key} className="flex items-start gap-3 py-3">
                  <span aria-hidden className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium">{it.kind === 'rebalance' ? 'Rebalanced' : 'Recurring buy'}</span>
                      <span className="truncate text-sm text-muted">{nameOf(it.bucket)}</span>
                      <span className="num ml-auto font-mono text-xs text-muted">{ts ? dateTime(ts) : `#${it.block}`}</span>
                    </div>
                    <p className="num mt-0.5 font-mono text-xs text-muted [overflow-wrap:anywhere]">{it.detail}</p>
                    {it.swaps.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {it.swaps.map((s, i) => (
                          <li key={i} className="num flex items-center gap-1.5 font-mono text-xs [overflow-wrap:anywhere]">
                            <ArrowRight size={11} aria-hidden className="shrink-0 text-faint" />
                            {leg(s)}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-[11px] text-faint">Triggered by {who(it.caller)}</p>
                  </div>
                  <a href={txUrl(it.tx)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 rounded-lg p-1.5 text-muted hover:bg-panel2 hover:text-ink" aria-label="View transaction on explorer" title="View on explorer">
                    <ExternalLink size={14} />
                  </a>
                </li>
              )
            })}
          </ul>
          {items.length > shown && (
            <button className="btn-ghost mt-3 h-9 w-full" onClick={() => setShown((n) => n + PAGE)}>Show more ({items.length - shown})</button>
          )}
        </>
      )}
    </Section>
  )
}
