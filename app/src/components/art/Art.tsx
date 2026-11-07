// Procedural SVG artwork. No raster assets, no network, themed through the same CSS variables as
// the rest of the app, so it follows dark/light and never goes out of date. Deterministic (seeded)
// so a re-render never shuffles the picture. All decorative: aria-hidden, no pointer events.
import { useId, useMemo } from 'react'

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const A = 'rgb(var(--accent))'
const UP = 'rgb(var(--up))'
const DOWN = 'rgb(var(--down))'
const LINE = 'rgb(var(--line))'

/** Full-bleed hero background: fading grid, drifting candle silhouettes, accent glow. */
export function HeroBackdrop({ className = '' }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const candles = useMemo(() => {
    const r = rng(7)
    const out: { x: number; y1: number; y2: number; w1: number; w2: number; up: boolean }[] = []
    let p = 300
    for (let i = 0; i < 46; i++) {
      const o = p
      const c = p + (r() - 0.46) * 46
      const hi = Math.max(o, c) + r() * 22
      const lo = Math.min(o, c) - r() * 22
      out.push({ x: 20 + i * 25, y1: Math.min(o, c), y2: Math.max(o, c), w1: hi, w2: lo, up: c >= o })
      p = c
    }
    return out
  }, [])
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}>
      <defs>
        <radialGradient id={`${id}g`} cx="50%" cy="0%" r="70%">
          <stop offset="0%" stopColor={A} stopOpacity="0.28" />
          <stop offset="60%" stopColor={A} stopOpacity="0.05" />
          <stop offset="100%" stopColor={A} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}m`}><rect width="1200" height="600" fill={`url(#${id}f)`} /></mask>
      </defs>
      <rect width="1200" height="600" fill={`url(#${id}g)`} />
      <g mask={`url(#${id}m)`}>
        {Array.from({ length: 13 }, (_, i) => <line key={`v${i}`} x1={i * 100} x2={i * 100} y1="0" y2="600" stroke={LINE} strokeOpacity="0.55" />)}
        {Array.from({ length: 7 }, (_, i) => <line key={`h${i}`} x1="0" x2="1200" y1={i * 100} y2={i * 100} stroke={LINE} strokeOpacity="0.55" />)}
        <g opacity="0.5">
          {candles.map((c, i) => (
            <g key={i} stroke={c.up ? UP : DOWN} fill={c.up ? 'none' : DOWN}>
              <line x1={c.x} x2={c.x} y1={c.w1 + 120} y2={c.w2 + 120} strokeOpacity="0.7" />
              <rect x={c.x - 6} y={c.y1 + 120} width="12" height={Math.max(2, c.y2 - c.y1)} rx="1.5" strokeOpacity="0.8" fillOpacity="0.55" />
            </g>
          ))}
        </g>
      </g>
    </svg>
  )
}

/** Basket artwork: concentric weighted arcs, the same shape as an allocation ring. */
export function BasketArt({ className = '', seed = 3 }: { className?: string; seed?: number }) {
  const segs = useMemo(() => {
    const r = rng(seed)
    const w = Array.from({ length: 5 }, () => 0.4 + r())
    const total = w.reduce((a, b) => a + b, 0)
    let acc = 0
    return w.map((x, i) => { const s = acc; acc += x / total; return { s, e: acc, i } })
  }, [seed])
  const arc = (rad: number, s: number, e: number) => {
    const a0 = s * Math.PI * 2 - Math.PI / 2
    const a1 = e * Math.PI * 2 - Math.PI / 2 - 0.05
    const p = (a: number) => `${(100 + rad * Math.cos(a)).toFixed(2)} ${(100 + rad * Math.sin(a)).toFixed(2)}`
    return `M${p(a0)}A${rad} ${rad} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`
  }
  const cols = [A, UP, 'rgb(var(--warn))', 'rgb(var(--muted))', DOWN]
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 200 200" className={`pointer-events-none ${className}`}>
      {[78, 60, 42].map((rad, ring) => (
        <g key={rad} fill="none" strokeWidth={ring === 0 ? 11 : 9} strokeLinecap="round" opacity={1 - ring * 0.22}>
          {segs.map((s) => <path key={s.i} d={arc(rad, (s.s + ring * 0.13) % 1, Math.min(1.0, ((s.s + ring * 0.13) % 1) + (s.e - s.s)))} stroke={cols[(s.i + ring) % cols.length]} />)}
        </g>
      ))}
      <circle cx="100" cy="100" r="22" fill="none" stroke={LINE} />
      <circle cx="100" cy="100" r="3" fill={A} />
    </svg>
  )
}

/** Portfolio artwork: a rising area curve with a soft fill. */
export function PortfolioArt({ className = '' }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const d = useMemo(() => {
    const r = rng(11)
    const pts: Array<readonly [number, number]> = []
    for (let i = 0, y = 150; i < 41; i++) {
      y = Math.max(28, Math.min(170, y - 2.3 + (r() - 0.5) * 16))
      pts.push([i * 15, y] as const)
    }
    const line = pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${x} ${yy.toFixed(1)}`).join('')
    return { line, area: `${line}L600 200L0 200Z` }
  }, [])
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 600 200" preserveAspectRatio="none" className={`pointer-events-none ${className}`}>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={A} stopOpacity="0.35" />
          <stop offset="100%" stopColor={A} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[50, 100, 150].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke={LINE} strokeOpacity="0.6" strokeDasharray="2 6" />)}
      <path d={d.area} fill={`url(#${id}a)`} />
      <path d={d.line} fill="none" stroke={A} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Footer artwork: perspective horizon grid under an accent glow. */
export function HorizonArt({ className = '' }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice" className={`pointer-events-none ${className}`}>
      <defs>
        <radialGradient id={`${id}r`} cx="50%" cy="100%" r="60%">
          <stop offset="0%" stopColor={A} stopOpacity="0.30" />
          <stop offset="100%" stopColor={A} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={`${id}k`}><rect width="1200" height="220" fill={`url(#${id}l)`} /></mask>
      </defs>
      <rect width="1200" height="220" fill={`url(#${id}r)`} />
      <g mask={`url(#${id}k)`} stroke={A} strokeOpacity="0.5" fill="none">
        {Array.from({ length: 25 }, (_, i) => <line key={`r${i}`} x1="600" y1="60" x2={(i - 12) * 190 + 600} y2="220" />)}
        {[0, 1, 2, 3, 4, 5].map((i) => { const y = 60 + 160 * Math.pow(i / 5, 2); return <line key={`h${i}`} x1="0" x2="1200" y1={y} y2={y} /> })}
      </g>
    </svg>
  )
}
