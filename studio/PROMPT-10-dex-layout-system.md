# Turn 10: a layout system, and a default layout for every DEX feature

> **Read `PROMPT-0-shared-context.md` first** — it holds the repo map, contract facts, existing
> types, RPC constraints, and the regression + responsive checklists that apply to this turn.
> Everything you need is in these two files. Do not spend context exploring the repo.

Today the app has six pages, each inventing its own structure, loading state and empty state. And
an unknown route silently renders the landing page:

```tsx
// src/App.tsx — CURRENT. The last line is a bug: typos and dead links render as Landing.
export default function App() {
  const [page, arg] = useRoute()
  let view
  if (!page) view = <Landing />
  else if (page === 'markets') view = <Markets />
  else if (page === 'trade') view = <Trade symbol={arg ?? 'EURC'} />
  else if (page === 'portfolio') view = <Portfolio />
  else if (page === 'buckets' && arg === 'new') view = <BucketNew />
  else if (page === 'buckets' && arg) view = <BucketDetail address={arg as `0x${string}`} />
  else view = <Landing />          // <-- no 404
  return <Shell>{view}</Shell>
}
```

Fix the cause, not the pages: build a **layout kit where blank is structurally impossible**, then
give every feature a DEX is expected to have a default layout built from it.

## Hard rules
- No new npm packages. Tailwind + existing tokens only. No CSS-in-JS, no headless UI library.
- **No page may ever render blank.** Loading / empty / error / unavailable are states of the
  primitives, not something each page remembers to handle.
- **No fake features.** Limit orders, LP management and protocol analytics need contracts that do
  not exist yet (`PROMPT-11`). Until that lands their routes render `UnavailableState` naming
  exactly what is missing — never a dead button or a mock table.
- Obey sections A, B and C of the shared context pack.

---

## 1. The layout kit — `src/components/layout/`

Build these first, exactly as specified. Every route in §3 is assembled from them and adds no
structural CSS of its own.

### 1.1 `States.tsx` — the no-blank guarantee

```tsx
import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react'

export type PanelState = {
  loading?: boolean
  error?: { message: string; retry?: () => void } | null
  empty?: { title: string; text: string; action?: ReactNode } | null
  unavailable?: { title: string; reason: string; missing: string } | null
}

const Frame = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">{children}</div>
)

export const EmptyState = ({ title, text, action }: NonNullable<PanelState['empty']>) => (
  <Frame>
    <Inbox size={20} className="text-faint" aria-hidden />
    <p className="text-sm font-medium">{title}</p>
    <p className="max-w-sm text-xs text-muted">{text}</p>
    {action}
  </Frame>
)

export const ErrorState = ({ message, retry }: NonNullable<PanelState['error']>) => (
  <Frame>
    <AlertTriangle size={20} className="text-down" aria-hidden />
    <p className="text-sm font-medium">Could not load this</p>
    {/* the real message, never "something went wrong" */}
    <p className="max-w-sm break-words font-mono text-[11px] text-muted">{message}</p>
    {retry && (
      <button type="button" onClick={retry}
        className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs hover:bg-panel2">
        <RefreshCw size={13} aria-hidden /> Retry
      </button>
    )}
  </Frame>
)

/** For a feature whose contracts do not exist yet. Says plainly what is missing. */
export const UnavailableState = ({ title, reason, missing }: NonNullable<PanelState['unavailable']>) => (
  <Frame>
    <Lock size={20} className="text-faint" aria-hidden />
    <p className="text-sm font-medium">{title}</p>
    <p className="max-w-md text-xs text-muted">{reason}</p>
    <p className="max-w-md font-mono text-[11px] text-faint">Needs: {missing}</p>
  </Frame>
)

export function NotFound({ path }: { path: string }) {
  return (
    <Frame>
      <p className="eyebrow">404</p>
      <p className="text-sm font-medium">No page at <span className="font-mono">#{path}</span></p>
      <p className="max-w-sm text-xs text-muted">Check the link, or jump to a section below.</p>
      <nav className="mt-2 flex flex-wrap justify-center gap-2">
        {[['/markets','Markets'],['/trade/EURC','Trade'],['/portfolio','Portfolio'],['/buckets','Buckets']].map(([to,l]) => (
          <a key={to} href={`#${to}`} className="h-9 rounded-lg border border-line px-3 text-xs leading-9 hover:bg-panel2">{l}</a>
        ))}
      </nav>
    </Frame>
  )
}

/** Skeletons must match final dimensions or the layout jumps when data lands. */
export function Skeleton({ shape, rows = 8 }: { shape: 'table'|'chart'|'list'|'form'|'stats'; rows?: number }) {
  if (shape === 'chart') return <div className="h-[300px] animate-pulse rounded-lg bg-panel2 lg:h-[400px]" aria-busy />
  if (shape === 'stats') return (
    <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4" aria-busy>
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-panel2" />)}
    </div>
  )
  return (
    <div className="divide-y divide-line" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <div className="h-4 flex-1 animate-pulse rounded bg-panel2" />
          <div className="h-4 w-16 animate-pulse rounded bg-panel2" />
          <div className="hidden h-4 w-20 animate-pulse rounded bg-panel2 md:block" />
        </div>
      ))}
    </div>
  )
}
```

### 1.2 `Panel.tsx` — the universal container

```tsx
import { useCallback, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { EmptyState, ErrorState, Skeleton, UnavailableState, type PanelState } from './States'

const readOpen = (id?: string) => {
  if (!id) return true
  try { return localStorage.getItem(`panel:${id}`) !== 'closed' } catch { return true }
}

export function Panel({
  id, title, actions, footer, collapsible, state = {}, skeleton = 'list', skeletonRows, className = '', children,
}: {
  id?: string; title?: ReactNode; actions?: ReactNode; footer?: ReactNode
  collapsible?: boolean; state?: PanelState
  skeleton?: 'table'|'chart'|'list'|'form'|'stats'; skeletonRows?: number
  className?: string; children?: ReactNode
}) {
  const [open, setOpen] = useState(() => readOpen(id))
  const toggle = useCallback(() => setOpen((o) => {
    const next = !o
    try { if (id) localStorage.setItem(`panel:${id}`, next ? 'open' : 'closed') } catch { /* private mode */ }
    return next
  }), [id])

  // precedence is fixed: loading > error > unavailable > empty > children
  const body =
    state.loading ? <Skeleton shape={skeleton} rows={skeletonRows} />
    : state.error ? <ErrorState {...state.error} />
    : state.unavailable ? <UnavailableState {...state.unavailable} />
    : state.empty ? <EmptyState {...state.empty} />
    : children

  return (
    <section className={`overflow-hidden rounded-xl border border-line bg-panel ${className}`} aria-busy={state.loading || undefined}>
      {(title || actions) && (
        // fixed header height so nothing shifts when data arrives
        <header className="flex h-11 items-center gap-2 border-b border-line px-3">
          {collapsible && (
            <button type="button" onClick={toggle} aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-panel2 hover:text-ink">
              <ChevronDown size={15} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
            </button>
          )}
          <h2 className="truncate text-[13px] font-medium">{title}</h2>
          {actions && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      {open && body}
      {open && footer && <footer className="border-t border-line px-3 py-2 text-[11px] text-faint">{footer}</footer>}
    </section>
  )
}
```

### 1.3 `DataTable.tsx` — every list in the app

Cards-below-`md` is what keeps tables off horizontal scroll on a phone. This is mandatory.

```tsx
import { useMemo, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Panel } from './Panel'
import type { PanelState } from './States'

export type Column<T> = {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** numeric => right-aligned, tabular, monospace. Always use this for money. */
  numeric?: boolean
  sortable?: boolean
  sortValue?: (row: T) => number | string
  width?: string
  /** drops out of the table below this breakpoint and moves into the mobile card */
  hideBelow?: 'sm' | 'md' | 'lg'
  /** shown in the mobile card's second line */
  mobileLabel?: string
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const

export function DataTable<T>({
  rows, columns, rowKey, onRowClick, sort, onSort, state, title, actions, footer, id, empty,
}: {
  rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  sort?: { key: string; dir: 'asc' | 'desc' } | null
  onSort?: (key: string) => void
  state?: PanelState; title?: ReactNode; actions?: ReactNode; footer?: ReactNode; id?: string
  empty?: NonNullable<PanelState['empty']>
}) {
  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = col.sortValue!(a), y = col.sortValue!(b)
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
    })
  }, [rows, columns, sort])

  const merged: PanelState = { ...state, empty: state?.empty ?? (!state?.loading && rows.length === 0 ? empty : null) }

  return (
    <Panel id={id} title={title} actions={actions} footer={footer} state={merged} skeleton="table">
      {/* desktop: real table */}
      <div className="hidden md:block">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`px-3 py-2 text-[11px] font-medium text-muted ${c.numeric ? 'text-right' : 'text-left'} ${c.hideBelow ? HIDE[c.hideBelow] : ''}`}>
                  {c.sortable && onSort ? (
                    <button type="button" onClick={() => onSort(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-ink ${c.numeric ? 'flex-row-reverse' : ''}`}>
                      {c.header}
                      {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r) } : undefined}
                className={`border-b border-line/60 ${onRowClick ? 'cursor-pointer hover:bg-panel2 focus:bg-panel2 focus:outline-none' : ''}`}>
                {columns.map((c) => (
                  <td key={c.key}
                    className={`px-3 py-2 ${c.numeric ? 'text-right font-mono num' : ''} ${c.hideBelow ? HIDE[c.hideBelow] : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile: two-line cards. NEVER a sideways-scrolling table. */}
      <ul className="divide-y divide-line md:hidden">
        {sorted.map((r) => {
          const [primary, secondary, ...rest] = columns
          return (
            <li key={rowKey(r)}>
              <button type="button" onClick={onRowClick ? () => onRowClick(r) : undefined} disabled={!onRowClick}
                className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{primary.render(r)}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] num text-muted">
                    {rest.filter((c) => c.mobileLabel).map((c) => (
                      <span key={c.key}><span className="text-faint">{c.mobileLabel} </span>{c.render(r)}</span>
                    ))}
                  </div>
                </div>
                {secondary && <div className="shrink-0 text-right font-mono text-[13px] num">{secondary.render(r)}</div>}
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
```

### 1.4 `Split.tsx` — the terminal primitive

Declarative collapse, so pages never write media queries.

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export type Col = {
  id: string
  node: ReactNode
  min?: number
  default?: number          // px; omit for the flexible centre column
  /** below this width the column leaves the grid and goes where `to` says */
  collapseBelow?: number
  to?: 'drawer' | 'sheet' | 'tab' | 'hidden'
}

const readW = (id: string, fallback: number) => {
  try { const v = Number(localStorage.getItem(`split:${id}`)); return Number.isFinite(v) && v > 0 ? v : fallback }
  catch { return fallback }
}

export function Split({ cols, className = '' }: { cols: Col[]; className?: string }) {
  const [w, setW] = useState(() => Object.fromEntries(cols.map((c) => [c.id, readW(c.id, c.default ?? 0)])))
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  const drag = useRef<{ id: string; x: number; start: number } | null>(null)

  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return
      const c = cols.find((x) => x.id === drag.current!.id)!
      const next = Math.max(c.min ?? 200, drag.current.start + (e.clientX - drag.current.x))
      setW((p) => ({ ...p, [c.id]: next }))
    }
    const up = () => {
      if (drag.current) { try { localStorage.setItem(`split:${drag.current.id}`, String(w[drag.current.id])) } catch {} }
      drag.current = null
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [cols, w])

  const reset = useCallback((c: Col) => {
    setW((p) => ({ ...p, [c.id]: c.default ?? 0 }))
    try { localStorage.removeItem(`split:${c.id}`) } catch {}
  }, [])

  const visible = cols.filter((c) => !(c.collapseBelow && vw < c.collapseBelow))
  // callers render the collapsed columns themselves as drawer/sheet/tab; Split just reports
  return (
    <div className={`flex w-full items-stretch ${className}`} data-collapsed={cols.filter((c) => !visible.includes(c)).map((c) => c.id).join(',')}>
      {visible.map((c, i) => (
        <div key={c.id} className="min-w-0" style={c.default ? { width: w[c.id], flex: '0 0 auto' } : { flex: '1 1 0%' }}>
          {c.node}
          {i < visible.length - 1 && c.default && (
            <div role="separator" aria-orientation="vertical" tabIndex={0}
              onPointerDown={(e) => { drag.current = { id: c.id, x: e.clientX, start: w[c.id] } }}
              onDoubleClick={() => reset(c)}
              className="absolute inset-y-0 w-1 cursor-col-resize hover:bg-line" />
          )}
        </div>
      ))}
    </div>
  )
}

/** Tells a page which columns Split dropped, so it can render them as a drawer/sheet/tab. */
export function useCollapsed(cols: Col[]) {
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return new Set(cols.filter((c) => c.collapseBelow && vw < c.collapseBelow).map((c) => c.id))
}
```

### 1.5 `Page.tsx`, `Tabs.tsx`, `Sheet.tsx`, `Toolbar.tsx`, `Stat.tsx`

```tsx
// Page.tsx — owns vertical rhythm so no page sets its own top padding.
export function Page({ title, subtitle, breadcrumb, actions, meta, density = 'compact', children }: {
  title?: ReactNode; subtitle?: ReactNode; breadcrumb?: ReactNode; actions?: ReactNode
  meta?: ReactNode; density?: 'comfortable' | 'compact'; children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-[1920px] px-4 py-4 sm:px-6" data-density={density}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            {breadcrumb && <div className="mb-1 text-[11px] text-faint">{breadcrumb}</div>}
            {title && <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {/* below 640px actions collapse into a ⋯ menu */}
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {meta && <div className="mb-4">{meta}</div>}
      {children}
    </div>
  )
}

// Tabs.tsx — syncs to ?tab= so every tab is linkable. Scrolls on mobile, never wraps.
export function Tabs({ tabs, param = 'tab' }: { tabs: { key: string; label: ReactNode; node: ReactNode }[]; param?: string }) {
  const [active, setActive] = useQueryParam(param, tabs[0].key)   // implement with history.replaceState
  const cur = tabs.find((t) => t.key === active) ?? tabs[0]
  return (
    <>
      <div role="tablist" className="-mx-4 mb-3 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={t.key === cur.key} onClick={() => setActive(t.key)}
            className={`h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-[13px] ${t.key === cur.key ? 'bg-panel2 text-ink' : 'text-muted hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{cur.node}</div>
    </>
  )
}

// Stat.tsx — label / value / delta / provenance chip (Turn 8 price sources).
export function Stat({ label, value, delta, source, tip, loading }: {
  label: ReactNode; value: ReactNode; delta?: number | null
  source?: 'cre' | 'keeper' | 'pool' | 'unit'; tip?: string; loading?: boolean
}) {
  return (
    <div className="min-w-0" title={tip}>
      <p className="flex items-center gap-1 text-[11px] text-muted">
        {label}
        {source && <span className="rounded bg-panel2 px-1 text-[9px] uppercase tracking-wide text-faint">{source}</span>}
      </p>
      {loading ? <div className="mt-1 h-5 w-16 animate-pulse rounded bg-panel2" />
        : <p className="truncate font-mono text-[15px] num">{value}
            {delta != null && <span className={`ml-1.5 text-[12px] ${delta >= 0 ? 'text-up' : 'text-down'}`}>
              {delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(2)}%</span>}
          </p>}
    </div>
  )
}
export const StatRow = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
)
```

`Sheet.tsx` is the mobile bottom sheet: focus-trapped, `Escape` closes, background scroll locked,
swipe-to-dismiss. `Toolbar.tsx` is the standard row above a table: search input, segmented
filters, right-aligned action slot.

### 1.6 `CommandPalette.tsx`

`⌘K` / `Ctrl+K` from anywhere. Fuzzy search over assets (→ trade), buckets, agents, routes and
actions ("Connect wallet", "Switch to Arc Testnet", "Copy my address", "Toggle theme"). Arrow keys
plus Enter, recents first. This is the navigation backbone once the route count triples.

### 1.7 Accessibility, once, in the kit

Focus rings on every interactive element, 44px touch targets below `md`, `aria-busy` on loading
panels, `aria-sort` on sorted headers, a live region for fills and errors, full keyboard
reachability. Because it lives in the primitives, every page inherits it.

---

## 2. Routing — a table, a real 404

```tsx
// src/lib/routes.tsx
import type { ComponentType } from 'react'

export type RouteDef = {
  path: string                      // '/trade/:symbol'
  component: ComponentType<Record<string, string>>
  nav?: 'markets' | 'trade' | 'buckets' | 'portfolio' | 'agents'
  title: string                     // document.title
  requires?: 'wallet' | 'network'   // renders the Turn 8 gate inline
}

export const ROUTES: RouteDef[] = [
  { path: '/',                 component: Landing,      nav: 'markets',   title: 'Arc Treasury' },
  { path: '/markets',          component: Markets,      nav: 'markets',   title: 'Markets' },
  { path: '/trade/:symbol',    component: Trade,        nav: 'trade',     title: 'Trade' },
  { path: '/swap',             component: Swap,         nav: 'trade',     title: 'Swap' },
  { path: '/portfolio',        component: Portfolio,    nav: 'portfolio', title: 'Portfolio', requires: 'wallet' },
  { path: '/wallet',           component: Wallet,       nav: 'portfolio', title: 'Wallet',    requires: 'wallet' },
  { path: '/activity',         component: Activity,     nav: 'portfolio', title: 'Activity' },
  // ... tier 2 and 3
]

/** '/trade/:symbol' vs ['trade','EURC'] -> { symbol: 'EURC' } | null */
export function matchRoute(def: string, parts: string[]): Record<string, string> | null {
  const segs = def.split('/').filter(Boolean)
  if (segs.length !== parts.length) return null
  const out: Record<string, string> = {}
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].startsWith(':')) out[segs[i].slice(1)] = parts[i]
    else if (segs[i].toLowerCase() !== parts[i].toLowerCase()) return null
  }
  return out
}
```

```tsx
// src/App.tsx — REPLACEMENT. Unknown route => NotFound, never Landing.
import { useEffect } from 'react'
import { useRoute } from '@/lib/router'
import { ROUTES, matchRoute } from '@/lib/routes'
import { Shell } from '@/components/Shell'
import { NotFound } from '@/components/layout/States'

export default function App() {
  const parts = useRoute()
  const hit = ROUTES.map((r) => ({ r, params: matchRoute(r.path, parts) })).find((x) => x.params)
  useEffect(() => { document.title = hit ? `${hit.r.title} · Arc Treasury` : 'Not found · Arc Treasury' }, [hit])
  if (!hit) return <Shell><NotFound path={parts.join('/')} /></Shell>
  const View = hit.r.component
  return <Shell><View {...hit.params} /></Shell>
}
```

Nav grows past four items — `src/components/shell/nav.ts` becomes grouped: **Trade** (Markets,
Trade, Swap, Pools) · **Earn** (Buckets, Agents) · **Account** (Portfolio, Orders, Activity,
Wallet). Top bar with dropdowns above `lg`; the existing bottom tab bar plus a "More" sheet below.

---

## 3. The route map

Build **Tier 1 completely before starting Tier 2.** A finished Tier 1 beats three half-built tiers.
Layouts given at `≥1280px`; all collapse through `Split`'s rules at `<1024px` and `<640px`.

### Tier 1 — the trading surface

| Route | Purpose | Default layout |
|---|---|---|
| `/` | Exchange home | Hero (headline + quick-swap card) · overview `StatRow` · markets `DataTable` · buckets strip · trust strip |
| `/markets` | Full market list | `Toolbar` (search + category segments) · full-width `DataTable`: asset, last+source, 24h %, sparkline, liquidity, risk, trade |
| `/trade/:symbol` | Pro terminal | `Split`: market rail 280px (`collapseBelow: 1280, to: 'drawer'`) · centre (pair header, chart, route panel) · ticket 340px (`collapseBelow: 768, to: 'sheet'`) · full-width bottom `Tabs` |
| `/swap` | Simple swap | One centred 480px card, no chrome. Where a first-time user lands |
| `/portfolio` | Account overview | Summary `StatRow` · allocation bar · holdings `DataTable` · buckets grid · open-orders preview |
| `/wallet` | Balances, funding, approvals | `Tabs`: Balances · Faucet (gas, test USDC, mirror mint) · Approvals (spender table + revoke) |
| `/activity` | Unified history | `Toolbar` filters · `DataTable` of every on-chain action with explorer links · CSV export |
| `*` | Not found | `<NotFound>` |

### Tier 2 — depth and account

| Route | Purpose | Default layout |
|---|---|---|
| `/asset/:symbol` | Token detail | Header stats · chart · `Tabs`: Overview (what it mirrors, contract, decimals, risk history) · Pools · Trades · Buckets holding it |
| `/orders` | Open and past orders | `Tabs` Open / History, inline cancel. **Needs `PROMPT-11`** → `UnavailableState` until then |
| `/pools` | Liquidity overview | `DataTable`: pool, TVL, 24h volume, fee tier, your position, realised fee yield (never projected) |
| `/pools/:id` | One pool | Header stats · depth chart · `Tabs`: Add · Remove · Your position · Fees. **Needs `PROMPT-11`** |
| `/buckets` | Strategy list | Templates grid · your buckets `DataTable` (drift, value, SIP, last rebalance) |
| `/buckets/new` | Wizard | 3-step `Tabs` + persistent live allocation donut in a right rail |
| `/buckets/:address` | One bucket | Header stats · `Tabs`: Overview · Holdings · Rebalance · SIP · Agents · History · Settings |
| `/settings` | Preferences | Sectioned form: slippage, deadline, expert mode, theme, density, RPC override, reset local data |
| `/onboard` | First-run checklist | Turn 8 gate rows, each with its own fix action |

### Tier 3 — protocol and extended

| Route | Purpose | Default layout |
|---|---|---|
| `/agents` | Agent hub | Turn 9 — connect, scope builder, intent feed, guardrail panel, kill switch |
| `/agents/:address` | One agent | Scorecard · session limits · intent history `DataTable` |
| `/stats` | Protocol analytics | KPI `StatRow` · volume and TVL charts · top assets and venues. **Needs `PROMPT-11`** |
| `/status` | System health | Oracle health per asset with countdowns · contracts with live code check · RPC latency · CRE last run · keeper state |
| `/docs` | How it works | Prose, architecture diagram, contract table, guardrail table, honest limits |
| `/agent/context/:bucket` | Machine-readable | Turn 9 — raw JSON, monospace, copy button |

---

## 4. Consistency rules that make it feel like one product

- **One table component, one empty state, one skeleton language.** Two pages showing a list
  differently is a bug in the kit, not a style choice.
- **Numbers**: right-aligned, tabular, monospace. `src/lib/format.ts` is the only formatter —
  no page calls `toFixed` directly.
- **Every list above ~10 rows is filterable and sortable**, with state in the URL.
- **Every address renders through one `<Address>` component** with copy, truncation and explorer link.
- **Loading never shifts layout.** `Panel`'s header is a fixed `h-11` before data arrives.
- **Mobile is not a fallback.** Every Tier 1 route is usable one-handed at 360px.

---

## Report back
- The kit files, and a screenshot grid of every Tier 1 route at 1280px and 360px.
- A table of every route: tier, status (built / unavailable-awaiting-PROMPT-11), data source.
- Proof the 404 fires on an unknown route instead of rendering Landing.
- The completed checklists from sections A and B of the shared context pack.

Build the kit first, migrate the six existing pages onto it second, then add routes in tier order.
Do not start Tier 2 until every Tier 1 route is finished.
