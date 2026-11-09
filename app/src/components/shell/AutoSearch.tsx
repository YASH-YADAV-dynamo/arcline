// Command-palette search: live markets (from the on-chain registry) plus app pages. Ctrl/Cmd+K or "/" opens it.
// Prices and 24h change come from the shared price book; anything unknown renders as an em dash.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { ASSET_NAME, useAssets } from '@/lib/assets'
import { pct, usd } from '@/lib/format'
import { usePriceBook, type PriceRow } from '@/lib/prices'
import { navigate } from '@/lib/router'
import { AssetIcon, changeTone } from '@/components/markets/ui'

type PageItem = { kind: 'page'; id: string; label: string; hint: string; to: string; words: string }
type MarketItem = { kind: 'market'; id: string; row: PriceRow; name: string }
type Item = PageItem | MarketItem

const PAGES: PageItem[] = [
  { kind: 'page', id: 'p-markets', label: 'Assets', hint: 'What a basket can hold', to: '/assets', words: 'assets markets list prices tokens' },
  { kind: 'page', id: 'p-trade', label: 'Trade', hint: 'Buy and sell', to: '/trade/EURC', words: 'trade swap buy sell' },
  { kind: 'page', id: 'p-baskets', label: 'Baskets', hint: 'Your baskets and templates', to: '/baskets', words: 'baskets basket bucket buckets allocation rebalance' },
  { kind: 'page', id: 'p-portfolio', label: 'Portfolio', hint: 'Balances and baskets', to: '/portfolio', words: 'portfolio balances holdings' },
  { kind: 'page', id: 'p-agents', label: 'Agents', hint: 'Agent sub-accounts and API', to: '/agents', words: 'agents agent api sub-account wallet bot tickets' },
]

/** Lower is better. Infinity = no match. Prefix matches rank first. */
function score(q: string, fields: string[], words = ''): number {
  if (!q) return 0
  const f = fields.map((x) => x.toLowerCase())
  if (f[0] === q) return 0
  if (f.some((x) => x.startsWith(q))) return 1
  const tokens = `${f.join(' ')} ${words}`.toLowerCase().split(/[\s-]+/)
  if (tokens.some((t) => t.startsWith(q))) return 2
  if (f.some((x) => x.includes(q))) return 3
  if (words.toLowerCase().includes(q)) return 4
  return Infinity
}

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** Top-bar button + global shortcuts. The dialog (and its price-book subscription) mounts only while open. */
export function AutoSearch() {
  const [open, setOpen] = useState(false)
  const assets = useAssets()
  const live = assets.isSuccess && !assets.isError
  const count = assets.data?.length ?? 0

  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Search markets and pages"
        title="Search (Ctrl K or /)"
        className="btn-ghost h-9 shrink-0 gap-2 px-2.5 text-xs text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Search size={15} aria-hidden />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] text-faint md:inline">Ctrl K</kbd>
      </button>
      {open && <SearchDialog live={live} count={count} onClose={() => setOpen(false)} />}
    </>
  )
}

function SearchDialog({ live, count, onClose }: { live: boolean; count: number; onClose: () => void }) {
  const book = usePriceBook()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const uid = useId()
  const listId = `${uid}-list`
  const query = q.trim().toLowerCase()

  // focus the input on open, restore focus on close
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => prev?.focus?.()
  }, [])

  const { markets, pages } = useMemo(() => {
    const m = book.rows
      .map((row): [MarketItem, number] => {
        const name = ASSET_NAME[row.asset.display] ?? ''
        const s = score(query, [row.asset.display, row.asset.symbol, name, row.asset.category])
        return [{ kind: 'market', id: `m-${row.asset.token}`, row, name }, s]
      })
      .filter(([, s]) => s !== Infinity)
      .sort((a, b) => a[1] - b[1])
      .map(([it]) => it)
    const p = PAGES.map((it): [PageItem, number] => [it, score(query, [it.label], it.words)])
      .filter(([, s]) => s !== Infinity)
      .sort((a, b) => a[1] - b[1])
      .map(([it]) => it)
    return { markets: m, pages: p }
  }, [book.rows, query])

  const items: Item[] = [...markets, ...pages]
  const sel = Math.min(active, Math.max(0, items.length - 1))
  const go = (it: Item | undefined) => {
    if (!it) return
    onClose()
    navigate(it.kind === 'page' ? it.to : `/trade/${it.row.asset.display}`)
  }

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(items.length ? (sel + 1) % items.length : 0) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(items.length ? (sel - 1 + items.length) % items.length : 0) }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]) }
    else if (e.key === 'Tab') {
      // basic focus trap: cycle between the elements inside the dialog
      const f = boxRef.current?.querySelectorAll<HTMLElement>('input, button')
      if (!f || f.length === 0) return
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }

  const missing = query && markets.length === 0
  const shown = q.trim().slice(0, 24)

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-ink/40 px-3 pt-[10vh] backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search markets and pages"
        onKeyDown={onKey}
        className="card flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={16} className="shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0) }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[sel] ? `${uid}-${items[sel].id}` : undefined}
            aria-autocomplete="list"
            aria-label="Search"
            placeholder="Search a symbol, name, category or page"
            autoComplete="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          />
          <button type="button" onClick={onClose} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted hover:bg-panel2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label="Close search">
            Esc
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`h-2 w-2 rounded-full ${live ? 'bg-up motion-safe:animate-pulse' : 'bg-faint'}`} />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wide">{live ? 'Live' : 'Offline'}</span>
          </span>
          <span className="num" aria-live="polite">{count} markets detected</span>
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {markets.length > 0 && <li role="presentation" className="eyebrow px-2 pb-1 pt-1.5">Markets</li>}
          {items.map((it, i) => (
            <PagesHeading key={it.id} first={it.kind === 'page' && (i === 0 || items[i - 1].kind !== 'page')}>
              <li
                id={`${uid}-${it.id}`}
                role="option"
                aria-selected={i === sel}
                onMouseMove={() => { if (i !== sel) setActive(i) }}
                onClick={() => go(it)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 ${i === sel ? 'bg-panel2' : ''}`}
              >
                {it.kind === 'market' ? <MarketRow item={it} /> : <PageRow item={it} />}
              </li>
            </PagesHeading>
          ))}
          {missing && (
            <li role="presentation" className="px-3 py-3 text-sm text-muted" aria-live="polite">
              No ticket for <span className="font-mono text-ink">{shown}</span> yet — watching for new listings
            </li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  )
}

/** Inserts the "Pages" eyebrow before the first page row. */
function PagesHeading({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {first && <li role="presentation" className="eyebrow px-2 pb-1 pt-2">Pages</li>}
      {children}
    </>
  )
}

function MarketRow({ item }: { item: MarketItem }) {
  const { row, name } = item
  return (
    <>
      <AssetIcon symbol={row.asset.display} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          {row.asset.display} <span className="font-normal text-muted">{name}</span>
        </span>
        <span className="block truncate text-xs text-muted">{row.asset.category}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="num block text-sm text-ink">{usd(row.last)}</span>
        <span className={`num block text-xs ${changeTone(row.change24h)}`}>{pct(row.change24h)}</span>
      </span>
    </>
  )
}

function PageRow({ item }: { item: PageItem }) {
  return (
    <>
      <span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[10px] text-muted">/</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{item.label}</span>
        <span className="block truncate text-xs text-muted">{item.hint}</span>
      </span>
    </>
  )
}

export default AutoSearch
