// Agent sub-accounts: create a dedicated wallet for an agent, fund it from the user's wallet, watch its USDC balance.
// The private key exists only in this component's `reveal` state until the user dismisses the box. It is never stored.
import { useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { erc20Abi, parseUnits } from 'viem'
import { toast } from 'sonner'
import { ArrowUpRight, Key, Plus, ShieldWarning, Trash } from '@phosphor-icons/react'
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
      <div className="card p-5 sm:p-6">
        <h3 className="title-4">New agent wallet</h3>
        <p className="mt-2 text-muted body-6">
          Basket trades it triggers must pass the basket's limits. The wallet itself has no spending cap beyond its balance, so
          <strong className="text-ink"> fund only what the agent may use.</strong>
        </p>
        <form
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => { e.preventDefault(); if (!reveal && agents.length < MAX_AGENTS) create() }}
        >
          <label className="block min-w-0 flex-1">
            <span className="mb-2 block text-muted caption-2">Name</span>
            <input
              className="field"
              value={label}
              maxLength={32}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Rebalancer bot"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="cta-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-40" disabled={Boolean(reveal) || agents.length >= MAX_AGENTS}>
            <Plus size={16} weight="bold" aria-hidden /> Create wallet
          </button>
        </form>
        {agents.length >= MAX_AGENTS && <p className="mt-3 text-warn caption-2">You can keep {MAX_AGENTS} agents. Remove one to add another.</p>}
        {!persisted && <p className="mt-3 text-warn caption-2">This browser blocks local storage, so the list is kept for this visit only.</p>}
      </div>

      {reveal && <RevealBox reveal={reveal} onDone={() => setReveal(null)} />}

      {agents.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-5 text-muted body-6 sm:p-6">No agent wallets yet. Create one above.</p>
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
    <section role="alert" aria-label="Agent private key" className="rounded-2xl border border-warn bg-warn/10 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <ShieldWarning size={22} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <p className="title-4">Save this key now. You will not see it again.</p>
          <p className="mt-2 body-6">
            It cannot be recovered, and Arcline does not store it. Anyone with this key controls the agent wallet and its funds.
            Never commit it to git, paste it in a chat, or share it.
          </p>
        </div>
      </div>

      <dl className="mt-4 space-y-3">
        <div>
          <dt className="text-muted caption-2">{reveal.label} address</dt>
          <dd className="mt-1 break-all font-mono text-xs text-ink">{reveal.address}</dd>
        </div>
        <div>
          <dt className="text-muted caption-2">Private key</dt>
          <dd className="mt-1 select-all break-all rounded-lg border border-warn/60 bg-panel p-2.5 font-mono text-xs text-ink">{reveal.privateKey}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <CopyButton text={reveal.privateKey} label="Copy key" className="btn-ghost h-9 px-3 text-xs" />
        <button type="button" className="btn-ghost h-9 px-3 text-xs" onClick={() => downloadText(file, envFileText(reveal.privateKey))}>
          <Key size={14} aria-hidden /> Download .env
        </button>
      </div>

      <label className="mt-5 flex items-start gap-3 body-6">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-accent" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I saved the key somewhere safe. I understand it cannot be shown again.</span>
      </label>
      <button type="button" className="cta-sm mt-4 disabled:cursor-not-allowed disabled:opacity-40" disabled={!saved} onClick={onDone}>
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
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate title-4">{agent.label}</p>
          <p className="mt-1 break-all font-mono text-muted caption-5">{agent.address}</p>
        </div>
        <div className="text-right">
          <p className="text-muted caption-2">Balance</p>
          <p className="font-mono title-3">
            {balText} <span className="text-muted caption-2">USDC</span>
          </p>
          {empty && <span className="text-warn caption-4">Not funded yet</span>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" className="cta-sm" onClick={() => setFundOpen((o) => !o)} aria-expanded={fundOpen}>
          Add USDC
        </button>
        <CopyButton text={agent.address} label="Copy address" className="btn-ghost h-9 px-3 text-xs" />
        <a className="btn-ghost h-9 px-3 text-xs" href={addrUrl(agent.address)} target="_blank" rel="noopener noreferrer">
          Explorer <ArrowUpRight size={12} aria-hidden />
        </a>
        {confirmRemove ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost h-9 border-down/60 px-3 text-xs text-down" onClick={() => { removeAgent(agent.address); toast('Agent removed from this browser', { description: 'Funds at the address are untouched.' }) }}>
              <Trash size={14} aria-hidden /> Confirm remove
            </button>
            <button type="button" className="btn-ghost h-9 px-3 text-xs" onClick={() => setConfirmRemove(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="btn-ghost h-9 px-3 text-xs" onClick={() => setConfirmRemove(true)}>
            Remove
          </button>
        )}
      </div>
      {confirmRemove && (
        <p className="mt-3 text-muted caption-2">
          This only forgets the address in this browser. Funds stay at {short(agent.address)}; without the private key they cannot be moved.
        </p>
      )}

      {fundOpen && (
        <form
          className="mt-5 rounded-2xl border border-line bg-panel2 p-4"
          onSubmit={(e) => { e.preventDefault(); if (canSend) void fund() }}
        >
          <label className="block">
            <span className="mb-2 block text-muted caption-2">Amount in USDC</span>
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
          <p id={`fund-note-${agent.address}`} className="mt-3 text-muted caption-2">
            USDC also pays gas on Arc, so send at least 1 USDC.
            {cap !== undefined && <> You can send up to {amt(cap, 6, 4)} USDC; a little is kept back for your own gas.</>}
          </p>
          {tooMuch && <p className="mt-2 text-down caption-2">That is more than you can send.</p>}
          {amount !== '' && want === null && <p className="mt-2 text-down caption-2">Enter an amount with up to 6 decimals.</p>}
          <button type="submit" className="cta-sm mt-4 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canSend}>
            {pending ? 'Sending…' : ready ? 'Send USDC' : 'Connect a wallet first'}
          </button>
        </form>
      )}
    </div>
  )
}
