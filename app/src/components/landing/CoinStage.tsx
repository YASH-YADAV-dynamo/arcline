// The landing's moving backdrop: six large tilted coins (the assets a basket holds) that spin on their
// own axis and move with the page, telling its story section by section:
//   hero      scattered around the headline
//   drift     cirBTC swells (one asset pulls the mix out of balance)
//   tagline   two even columns of three beside the tagline, equal size (back on target)
//   content   pulled to the edges and faint, so cards and copy stay readable
//   final     a ring around the closing call to action
//   out       gone before the footer
//
// Motion is scroll linked, not scene switched: every [data-scene] section is an anchor at its centre,
// and the coins blend between the two anchors either side of the 45% line, so they travel exactly as
// far as you scroll. On top of that a damped follow (each frame closes 12% of the gap) turns coarse
// wheel steps into a glide. One requestAnimationFrame loop writes transform and opacity straight to the
// coin elements: no React render per frame, no layout properties touched. The loop sleeps once settled.
// Reduced motion: no spin, and the coins hold a faint resting layout instead of following the scroll.
import { useEffect, useRef, useState } from 'react'
import { iconOf } from '@/lib/market-snapshots'
import { assetColor } from '@/components/markets/ui'

export type Scene = 'hero' | 'drift' | 'tagline' | 'content' | 'final' | 'out'
type Spot = readonly [x: number, y: number, scale: number, opacity: number] // x in vw, y in svh

const COINS = ['USDC', 'EURC', 'cirBTC', 'XAUM', 'WETH', 'GBPA'] as const
// Per coin: resting tilt, spin period (s), spin direction. Uneven on purpose so they never sync up.
const TILT = [
  { rx: 62, rz: -14, spin: 14, dir: 1 },
  { rx: 58, rz: 18, spin: 19, dir: -1 },
  { rx: 66, rz: -6, spin: 16, dir: 1 },
  { rx: 55, rz: 24, spin: 22, dir: -1 },
  { rx: 64, rz: -22, spin: 12, dir: 1 },
  { rx: 60, rz: 10, spin: 25, dir: -1 },
]

const ring = (r: number, ry: number, s: number): Spot[] =>
  COINS.map((_, i) => {
    const a = (i / COINS.length) * Math.PI * 2 - Math.PI / 2
    return [50 + r * Math.cos(a), 50 + ry * Math.sin(a), s, 1] as const
  })

const DESKTOP: Record<Scene, Spot[]> = {
  hero: [[9, 34, 1.15, 1], [90, 24, 1, 1], [86, 76, 1.25, 1], [12, 80, 0.9, 1], [24, 12, 0.6, 0.9], [96, 52, 0.55, 0.9]],
  drift: [[6, 80, 0.55, 0.5], [17, 90, 0.5, 0.5], [86, 74, 1.8, 1], [28, 94, 0.45, 0.5], [3, 60, 0.45, 0.4], [36, 86, 0.4, 0.4]],
  tagline: COINS.map((_, i) => [i % 2 ? 87 : 13, 28 + Math.floor(i / 2) * 22, 0.7, 0.9] as const),
  content: [[-2, 20, 0.9, 0.16], [102, 30, 0.8, 0.16], [103, 80, 1, 0.16], [-3, 74, 0.8, 0.16], [50, -12, 0.6, 0], [50, 112, 0.6, 0]],
  final: ring(42, 40, 0.75),
  out: ring(46, 44, 0.6).map(([x, y, s]) => [x, y, s, 0] as const),
}

// Phones: smaller coins pushed into the corners, so the centred headline stays clear.
const MOBILE: Record<Scene, Spot[]> = {
  ...DESKTOP,
  hero: [[4, 12, 0.85, 1], [96, 8, 0.75, 1], [94, 90, 1, 1], [6, 92, 0.8, 1], [50, -12, 0.5, 0], [104, 50, 0.5, 0.6]],
  drift: [[4, 92, 0.45, 0.4], [20, 96, 0.4, 0.4], [86, 16, 1.4, 0.9], [36, 98, 0.4, 0.4], [-4, 60, 0.4, 0.3], [60, 102, 0.4, 0.3]],
  tagline: COINS.map((_, i) => [i % 2 ? 98 : 2, 22 + Math.floor(i / 2) * 26, 0.5, 0.6] as const),
  content: DESKTOP.content.map(([x, y, s]) => [x, y, s, 0.1] as const),
  final: ring(46, 44, 0.55),
}

const EDGE_LAYERS = 10 // stacked discs that give the coin its thickness when it turns
const FOLLOW = 0.12 // share of the remaining distance closed per frame (about 60fps): the glide
const LINE = 0.45 // the reading line, as a share of the viewport height

const smooth = (t: number) => t * t * (3 - 2 * t) // ease in and out between two anchors
const mix = (a: Spot, b: Spot, t: number): Spot => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]

/** Where every coin should be for the current scroll position. */
function targets(table: Record<Scene, Spot[]>, anchors: HTMLElement[]): Spot[] {
  const line = window.innerHeight * LINE
  const pts = anchors.map((el) => {
    const r = el.getBoundingClientRect()
    return { y: r.top + r.height / 2, scene: el.getAttribute('data-scene') as Scene }
  })
  if (!pts.length) return table.hero
  if (line <= pts[0].y) return table[pts[0].scene]
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]
    const b = pts[k + 1]
    if (line >= a.y && line <= b.y) {
      const t = smooth((line - a.y) / Math.max(1, b.y - a.y))
      // Coins travelling between two layouts cross the copy, so they dim mid flight (down to 45% at
      // the halfway point) and come back to full strength as they land.
      const dip = a.scene === b.scene ? 1 : 1 - 0.55 * Math.sin(Math.PI * t)
      return table[a.scene].map((s, i) => {
        const m = mix(s, table[b.scene][i], t)
        return [m[0], m[1], m[2], m[3] * dip] as const
      })
    }
  }
  return table[pts[pts.length - 1].scene]
}

function Coin({ sym, i, size, setRef }: { sym: string; i: number; size: number; setRef: (el: HTMLDivElement | null) => void }) {
  const t = TILT[i]
  const c = assetColor(sym)
  const src = iconOf(sym)
  const face = (back: boolean) => (
    <span
      className="absolute inset-0 rounded-full [backface-visibility:hidden]"
      style={{ background: c, transform: `translateZ(${back ? -EDGE_LAYERS : 0}px)${back ? ' rotateY(180deg)' : ''}` }}
    >
      {src && <img src={src} alt="" draggable={false} className="absolute inset-[9%] size-[82%] rounded-full bg-white object-contain" />}
    </span>
  )
  return (
    <div
      ref={setRef}
      className="absolute left-0 top-0 opacity-0 will-change-transform"
      style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
    >
      <div className="size-full [perspective:900px]">
        <div className="size-full [transform-style:preserve-3d]" style={{ transform: `rotateX(${t.rx}deg) rotateZ(${t.rz}deg)` }}>
          <div
            className="coin-spin relative size-full [transform-style:preserve-3d]"
            style={{ animationDuration: `${t.spin}s`, animationDirection: t.dir > 0 ? 'normal' : 'reverse', animationDelay: `${-i * 2.3}s` }}
          >
            {Array.from({ length: EDGE_LAYERS }, (_, k) => (
              <span
                key={k}
                className="absolute inset-0 rounded-full"
                style={{ background: `color-mix(in srgb, ${c} 62%, #000)`, transform: `translateZ(${-k - 0.5}px)` }}
              />
            ))}
            {face(false)}
            {face(true)}
          </div>
        </div>
      </div>
    </div>
  )
}

function useIsPhone() {
  const q = '(max-width: 767px)'
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

export function CoinStage() {
  const phone = useIsPhone()
  const size = phone ? 112 : 184
  const els = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const table = phone ? MOBILE : DESKTOP
    const anchors = [...document.querySelectorAll<HTMLElement>('[data-scene]')]
    const paint = (spots: Spot[]) =>
      spots.forEach(([x, y, s, o], i) => {
        const el = els.current[i]
        if (!el) return
        el.style.transform = `translate3d(${x}vw, ${y}svh, 0) scale(${s})`
        el.style.opacity = String(o)
      })

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paint(table.content)
      return
    }

    // `cur` starts at the target, so the first paint has no sweep in from nowhere.
    const st = { frame: 0, cur: targets(table, anchors) }
    paint(st.cur)
    const tick = () => {
      const goal = targets(table, anchors)
      let moving = false
      st.cur = st.cur.map((c, i) => {
        const g = goal[i]
        const n = mix(c, g, FOLLOW)
        const settled = Math.abs(g[0] - n[0]) + Math.abs(g[1] - n[1]) < 0.02 && Math.abs(g[2] - n[2]) + Math.abs(g[3] - n[3]) < 0.002
        if (!settled) moving = true
        return settled ? g : n
      })
      paint(st.cur)
      st.frame = moving ? requestAnimationFrame(tick) : 0
    }
    const wake = () => {
      if (!st.frame) st.frame = requestAnimationFrame(tick)
    }
    window.addEventListener('scroll', wake, { passive: true })
    window.addEventListener('resize', wake)
    return () => {
      window.removeEventListener('scroll', wake)
      window.removeEventListener('resize', wake)
      if (st.frame) cancelAnimationFrame(st.frame)
    }
  }, [phone])

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {COINS.map((sym, i) => (
        <Coin key={sym} sym={sym} i={i} size={size} setRef={(el) => (els.current[i] = el)} />
      ))}
    </div>
  )
}
