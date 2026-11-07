// Agent sub-accounts: create a dedicated wallet for an agent, fund it from the user's wallet, watch its USDC balance.
// The private key exists only in this component's `reveal` state until the user dismisses the box. It is never stored.
import { useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { erc20Abi, parseUnits } from 'viem'
import { toast } from 'sonner'
import { ExternalLink, KeyRound, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { ADDR } from '@/lib/contracts'
import { addrUrl, amt, short } from '@/lib/format'
import { capToSpendable, useSpendable } from '@/lib/spendable'
import { useTx } from '@/lib/tx'
import { MAX_AGENTS, createAgent, downloadText, envFileText, removeAgent, useAgents, type Hex, type SavedAgent } from '@/lib/agent-account'
import { CopyButton } from './CodeBlock'

type Reveal = { address: Hex; label: string; privateKey: Hex }

export function AgentAccountPanel() {
  const { agents, persisted } = useAgents()
  const [label, setLabel] = useState('')
  const [reveal, setReveal] = useState<Reveal | null>(null)

  const create = () => {
    const { agent, privateKey } = createAgent(label)
    setReveal({ address: agent.address, label: agent.label, privateKey })
    setLabel('')
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <p className="text-sm text-muted">
          A sub-account is a separate wallet your agent controls with its own key. It holds only what you send it.
          The key is created in this browser and shown once. Basket limits (drift band, cooldown, trade size, slippage) are enforced
          on-chain by the basket contract. The agent wallet itself has no on-chain spending cap beyond what you fund it with:
          <strong className="text-ink"> fund only what the agent may use.</strong>
        </p>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => { e.preventDefault(); if (!reveal && agents.length < MAX_AGENTS) create() }}
        >
          <label className="block min-w-0 flex-1">
            <span className="eyebrow mb-1 block">Label</span>
            <input
              className="field"
              value={label}
              maxLength={32}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. rebalancer-bot"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="btn shrink-0" disabled={Boolean(reveal) || agents.length >= MAX_AGENTS}>
            <Plus size={15} aria-hidden /> Create agent wallet
          </button>
        </form>
        {agents.length >= MAX_AGENTS && <p className="mt-2 text-xs text-warn">Limit of {MAX_AGENTS} saved agents. Remove one to add another.</p>}
        {!persisted && <p className="mt-2 text-xs text-warn">This browser blocked local storage, so the agent list is kept for this session only.</p>}
      </div>

      {reveal && <RevealBox reveal={reveal} onDone={() => setReveal(null)} />}

      {agents.length === 0 ? (
        <p className="card p-4 text-sm text-muted sm:p-5">No agent wallets yet.</p>
      ) : (
        <ul className="space-y-3">
          {agents.map((a) => (
            <li key={a.address}>
              <AgentRow agent={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RevealBox({ reveal, onDone }: { reveal: Reveal; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const file = `arc-agent-${reveal.address.slice(2, 8).toLowerCase()}.env`
  return (
    <section role="alert" aria-label="Agent private key" className="rounded-2xl border-2 border-warn bg-warn/10 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert size={20} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <p className="font-bold text-ink">Save this private key now. It is shown only once.</p>
          <p className="mt-1 text-sm text-ink">
            It cannot be recovered, and Arcline does not store it. Anyone with this key controls the agent wallet and its funds.
            Never commit it to git, paste it in a chat, or share it.
          </p>
        </div>
      </div>

      <dl className="mt-4 space-y-3">
        <div>
          <dt className="eyebrow">{reveal.label} address</dt>
          <dd className="mt-1 break-all font-mono text-xs text-ink">{reveal.address}</dd>
        </div>
        <div>
          <dt className="eyebrow">Private key</dt>
          <dd className="mt-1 select-all break-all rounded-lg border border-warn/60 bg-panel p-2.5 font-mono text-xs text-ink">{reveal.privateKey}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <CopyButton text={reveal.privateKey} label="Copy key" className="btn-ghost h-9 px-3 text-xs" />
        <button type="button" className="btn-ghost h-9 px-3 text-xs" onClick={() => downloadText(file, envFileText(reveal.privateKey))}>
          <KeyRound size={13} aria-hidden /> Download .env
        </button>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-accent" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I saved the key somewhere safe. I understand it cannot be shown again.</span>
      </label>
      <button type="button" className="btn mt-3" disabled={!saved} onClick={onDone}>
        Hide key
      </button>
    </section>
  )
}

/** Parse "1.5" into 6-decimal USDC units; null when empty or invalid. */
function parseUsdc(v: string): bigint | null {
  if (!/^\d*\.?\d{0,6}$/.test(v) || v === '' || v === '.') return null
  try {
    return parseUnits(v, 6)
  } catch {
    return null
  }
}

function AgentRow({ agent }: { agent: SavedAgent }) {
  const { address: user } = useAccount()
  const bal = useReadContract({
    address: ADDR.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [agent.address],
    chainId: arcTestnet.id,
    query: { refetchInterval: 15_000 },
  })
  const spend = useSpendable(user)
  const { send, pending, ready } = useTx()
  const [fundOpen, setFundOpen] = useState(false)
  const [amount, setAmount] = useState('1')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const want = parseUsdc(amount)
  const cap = spend.data?.spendable
  const tooMuch = want !== null && cap !== undefined && want > cap
  const canSend = ready && want !== null && want > 0n && !tooMuch && !pending

  const fund = async () => {
    if (want === null) return
    const r = await send('Fund agent', {
      address: ADDR.usdc,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [agent.address, capToSpendable(want, spend.data)],
    })
    if (r) {
      setFundOpen(false)
      void bal.refetch()
      void spend.refetch()
    }
  }

  const balText = bal.data === undefined ? '—' : amt(bal.data, 6, 4)
  const empty = bal.data === 0n

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{agent.label}</p>
          <p className="mt-0.5 break-all font-mono text-xs text-muted">{agent.address}</p>
        </div>
        <div className="text-right">
          <p className="eyebrow">Agent balance</p>
          <p className="num font-mono text-lg font-semibold text-ink">
            {balText} <span className="text-xs font-normal text-muted">USDC</span>
          </p>
          {empty && <span className="badge bg-warn/15 text-warn">Unfunded</span>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn h-9 px-3 text-xs" onClick={() => setFundOpen((o) => !o)} aria-expanded={fundOpen}>
          Fund agent
        </button>
        <CopyButton text={agent.address} label="Copy address" className="btn-ghost h-9 px-3 text-xs" />
        <a className="btn-ghost h-9 px-3 text-xs" href={addrUrl(agent.address)} target="_blank" rel="noopener noreferrer">
          Explorer <ExternalLink size={12} aria-hidden />
        </a>
        {confirmRemove ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost h-9 border-down/60 px-3 text-xs text-down" onClick={() => { removeAgent(agent.address); toast('Agent removed from this browser', { description: 'Funds at the address are untouched.' }) }}>
              <Trash2 size={13} aria-hidden /> Confirm remove
            </button>
            <button type="button" className="btn-ghost h-9 px-3 text-xs" onClick={() => setConfirmRemove(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="btn-ghost h-9 px-3 text-xs" onClick={() => setConfirmRemove(true)}>
            Remove agent
          </button>
        )}
      </div>
      {confirmRemove && (
        <p className="mt-2 text-xs text-muted">
          This only forgets the address in this browser. Funds stay at {short(agent.address)}; without the private key they cannot be moved.
        </p>
      )}

      {fundOpen && (
        <form
          className="mt-4 rounded-xl border border-line bg-panel2 p-3"
          onSubmit={(e) => { e.preventDefault(); if (canSend) void fund() }}
        >
          <label className="block">
            <span className="eyebrow mb-1 block">Amount (USDC)</span>
            <div className="flex gap-2">
              <input
                className="field num"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
                aria-invalid={want === null || tooMuch}
                aria-describedby={`fund-note-${agent.address}`}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn-ghost shrink-0 px-3 text-xs"
                disabled={!cap}
                onClick={() => cap && setAmount((Number(cap) / 1e6).toFixed(6).replace(/\.?0+$/, ''))}
              >
                Max
              </button>
            </div>
          </label>
          <p id={`fund-note-${agent.address}`} className="mt-2 text-xs text-muted">
            USDC is also the gas token on Arc, so the agent needs a balance to send transactions: fund at least ~1 USDC.
            {cap !== undefined && <> Your spendable balance is {amt(cap, 6, 4)} USDC (a small gas reserve is held back).</>}
          </p>
          {tooMuch && <p className="mt-1 text-xs text-down">That is more than your spendable balance.</p>}
          {amount !== '' && want === null && <p className="mt-1 text-xs text-down">Enter a USDC amount with up to 6 decimals.</p>}
          <button type="submit" className="btn mt-3" disabled={!canSend}>
            {pending ? 'Sending…' : ready ? 'Send USDC to agent' : 'Connect a wallet to fund'}
          </button>
        </form>
      )}
    </div>
  )
}
