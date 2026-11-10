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
// far as you scroll. Smoothness comes from three choices:
//   - Time based damping (critically damped, ~0.22s time constant), so the glide feels the same at
//     60, 120 or 144 Hz and a dropped frame catches up instead of stuttering.
//   - Anchor positions are measured once (and again when the page resizes), so a frame reads only
//     scrollY: no layout work while scrolling.
//   - Scroll speed leans the coins a few degrees, like objects with weight, and they settle back.
// One requestAnimationFrame loop writes transforms straight to the elements (no React render per frame)
// and sleeps once everything has settled. Spin, hover and lighting are CSS animations on the compositor.
//
// The coin itself is a real solid: two faces with a raised reeded rim, a recessed inlay for the asset
// mark and a soft top light, joined by a reeded edge built from stacked discs about 2px apart. The faces
// catch the light as they turn toward you and darken edge on. It is drawn at its largest on-screen size
// and only ever scaled down, so it stays crisp when it grows.
// Reduced motion: no spin or hover, and the coins hold a faint resting layout instead of following.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { iconOf } from '@/lib/market-snapshots'
import { assetColor } from '@/components/markets/ui'

export type Scene = 'hero' | 'drift' | 'tagline' | 'content' | 'final' | 'out'
type Spot = readonly [x: number, y: number, scale: number, opacity: number] // x in vw, y in svh

const COINS = ['USDC', 'EURC', 'cirBTC', 'XAUM', 'WETH', 'GBPA'] as const
// Per coin: resting tilt, spin period (s), spin direction, hover period (s). Uneven so they never sync.
const TILT = [
  { rx: 62, rz: -14, spin: 14, dir: 1, float: 6.2 },
  { rx: 58, rz: 18, spin: 19, dir: -1, float: 7.4 },
  { rx: 66, rz: -6, spin: 16, dir: 1, float: 5.6 },
  { rx: 55, rz: 24, spin: 22, dir: -1, float: 8.1 },
  { rx: 64, rz: -22, spin: 12, dir: 1, float: 6.8 },
  { rx: 60, rz: 10, spin: 25, dir: -1, float: 7.7 },
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

const maxScale = (t: Record<Scene, Spot[]>) => Math.max(...Object.values(t).flatMap((s) => s.map((p) => p[2])))

const TAU = 0.22 // seconds: time constant of the glide toward the scroll target
const LEAN_TAU = 0.35 // seconds: how quickly the scroll lean settles
const LEAN_MAX = 14 // degrees of extra tilt at fast scroll
const LINE = 0.45 // the reading line, as a share of the viewport height

const smooth = (t: number) => t * t * (3 - 2 * t) // ease in and out between two anchors
const mix = (a: Spot, b: Spot, t: number): Spot => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]

type Anchor = { y: number; scene: Scene } // y: centre of the section in document coordinates

function measure(): Anchor[] {
  const sy = window.scrollY
  return [...document.querySelectorAll<HTMLElement>('[data-scene]')].map((el) => {
    const r = el.getBoundingClientRect()
    return { y: r.top + sy + r.height / 2, scene: el.getAttribute('data-scene') as Scene }
  })
}

/** Where every coin should be for a scroll position. Pure arithmetic: no DOM reads. */
function targets(table: Record<Scene, Spot[]>, pts: Anchor[], scrollY: number): Spot[] {
  const line = scrollY + window.innerHeight * LINE
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
  const thick = Math.max(8, Math.round(size * 0.075)) // a real coin is about 7% as thick as it is wide
  const discs = Math.ceil(thick / 2) // ~2px apart: reads as one solid edge, half the layers of 1px
  const rim = Math.max(3, size * 0.05)
  // Every lighting layer runs on the spin's clock so light and rotation never drift apart.
  const clock: CSSProperties = { animationDuration: `${t.spin}s`, animationDirection: t.dir > 0 ? 'normal' : 'reverse', animationDelay: `${-i * 2.3}s` }

  const light = `color-mix(in srgb, ${c} 55%, #fff)`
  const dark = `color-mix(in srgb, ${c} 55%, #000)`
  const deep = `color-mix(in srgb, ${c} 35%, #000)`
  // Fine vertical ridges around the edge (reeding), as on a minted coin.
  const reeds = (a: string, b: string) => `repeating-conic-gradient(from 0deg, ${a} 0deg 1.6deg, ${b} 1.6deg 3.2deg)`

  const face = (back: boolean) => (
    <span
      className="absolute inset-0 overflow-hidden rounded-full [backface-visibility:hidden]"
      style={{
        transform: back ? `translateZ(${-thick}px) rotateY(180deg)` : 'translateZ(0.5px)',
        background: `radial-gradient(120% 120% at 30% 22%, ${light} 0%, ${c} 42%, ${dark} 100%)`,
      }}
    >
      {/* raised outer rim, reeded on its outer edge */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: reeds(light, c),
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${rim * 0.45}px), #000 calc(100% - ${rim * 0.45 - 0.5}px))`,
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${rim * 0.45}px), #000 calc(100% - ${rim * 0.45 - 0.5}px))`,
          opacity: 0.7,
        }}
      />
      <span
        className="absolute rounded-full"
        style={{
          inset: rim,
          boxShadow: `0 0 0 1px ${deep}, inset 0 ${rim * 0.35}px ${rim * 0.6}px rgba(0,0,0,0.35), 0 ${-rim * 0.18}px ${rim * 0.3}px rgba(255,255,255,0.35)`,
        }}
      />
      {/* recessed inlay holding the asset mark */}
      {src && (
        <span
          className="absolute overflow-hidden rounded-full bg-white"
          style={{ inset: '15%', boxShadow: `inset 0 ${size * 0.012}px ${size * 0.03}px rgba(0,0,0,0.35), 0 0 0 ${Math.max(1, size * 0.008)}px ${dark}` }}
        >
          <img src={src} alt="" draggable={false} className="size-full object-contain p-[6%]" />
        </span>
      )}
      {/* top light that sweeps in as the face turns toward you */}
      <span
        className={`absolute inset-0 rounded-full ${back ? 'coin-lit-back' : 'coin-lit-front'}`}
        style={{ ...clock, opacity: back ? 0 : 1, background: 'radial-gradient(70% 55% at 32% 18%, rgba(255,255,255,0.55), rgba(255,255,255,0) 70%)' }}
      />
      {/* and the shade it falls into edge on */}
      <span
        className={`absolute inset-0 rounded-full bg-black ${back ? 'coin-shade-back' : 'coin-shade-front'}`}
        style={{ ...clock, opacity: 0 }}
      />
    </span>
  )

  return (
    <div
      ref={setRef}
      className="absolute left-0 top-0 opacity-0 will-change-transform"
      style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
    >
      <div className="coin-float size-full" style={{ animationDuration: `${t.float}s`, animationDelay: `${-i * 1.7}s` }}>
        <div className="size-full [perspective:1100px]">
          <div
            data-tilt
            className="size-full [transform-style:preserve-3d]"
            style={{ transform: `rotateX(${t.rx}deg) rotateZ(${t.rz}deg)` }}
          >
            <div className="coin-spin relative size-full [transform-style:preserve-3d]" style={clock}>
              {/* the edge: discs about 1px apart, reeded, lit in the middle and darker toward each face */}
              {Array.from({ length: discs }, (_, k) => {
                const mid = 1 - Math.abs(k / Math.max(1, discs - 1) - 0.5) * 2 // 0 at the faces, 1 in the middle
                const a = `color-mix(in srgb, ${c} ${40 + mid * 25}%, #000)`
                const b = `color-mix(in srgb, ${c} ${60 + mid * 25}%, #fff)`
                return (
                  <span
                    key={k}
                    className="absolute inset-0 rounded-full"
                    style={{ background: reeds(a, b), transform: `translateZ(${(-(k + 0.5) * thick) / discs}px)` }}
                  />
                )
              })}
              {face(false)}
              {face(true)}
            </div>
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
  const table = phone ? MOBILE : DESKTOP
  const big = maxScale(table)
  const base = phone ? 112 : 184
  const size = Math.round(base * big) // drawn at the largest size it ever shows, then scaled down
  const els = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const tilts = els.current.map((el) => el?.querySelector<HTMLElement>('[data-tilt]') ?? null)
    const paint = (spots: Spot[], lean: number) =>
      spots.forEach(([x, y, s, o], i) => {
        const el = els.current[i]
        if (!el) return
        el.style.transform = `translate3d(${x.toFixed(3)}vw, ${y.toFixed(3)}svh, 0) scale(${(s / big).toFixed(4)})`
        el.style.opacity = o.toFixed(3)
        const tl = tilts[i]
        if (tl) tl.style.transform = `rotateX(${(TILT[i].rx + lean * (i % 2 ? 0.8 : 1)).toFixed(2)}deg) rotateZ(${TILT[i].rz}deg)`
      })

    const anchors = { list: measure() }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paint(table.content, 0)
      return
    }

    // `cur` starts at the target, so the first paint has no sweep in from nowhere.
    const st = { frame: 0, last: 0, cur: targets(table, anchors.list, window.scrollY), lean: 0, prevY: window.scrollY }
    paint(st.cur, 0)

    const tick = (now: number) => {
      const dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 1 / 60
      st.last = now
      const y = window.scrollY
      const goal = targets(table, anchors.list, y)
      const k = 1 - Math.exp(-dt / TAU)
      // Scroll speed in viewport heights per second, turned into a gentle lean that eases back to 0.
      const v = (y - st.prevY) / Math.max(dt, 1e-3) / window.innerHeight
      st.prevY = y
      const leanGoal = Math.max(-1, Math.min(1, v / 2.5)) * LEAN_MAX
      st.lean += (leanGoal - st.lean) * (1 - Math.exp(-dt / LEAN_TAU))

      let moving = Math.abs(st.lean) > 0.05 || Math.abs(leanGoal) > 0.05
      st.cur = st.cur.map((c, i) => {
        const g = goal[i]
        const n = mix(c, g, k)
        const settled = Math.abs(g[0] - n[0]) + Math.abs(g[1] - n[1]) < 0.01 && Math.abs(g[2] - n[2]) + Math.abs(g[3] - n[3]) < 0.001
        if (!settled) moving = true
        return settled ? g : n
      })
      if (!moving) st.lean = 0
      paint(st.cur, st.lean)
      if (moving) st.frame = requestAnimationFrame(tick)
      else {
        st.frame = 0
        st.last = 0
      }
    }
    const wake = () => {
      if (!st.frame) {
        st.prevY = window.scrollY
        st.frame = requestAnimationFrame(tick)
      }
    }
    const remeasure = () => {
      anchors.list = measure()
      wake()
    }
    // Sections change height as fonts, images and data arrive, so re-measure when the page does.
    const ro = new ResizeObserver(remeasure)
    ro.observe(document.body)
    window.addEventListener('scroll', wake, { passive: true })
    window.addEventListener('resize', remeasure)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', wake)
      window.removeEventListener('resize', remeasure)
      if (st.frame) cancelAnimationFrame(st.frame)
    }
  }, [table, big])

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {COINS.map((sym, i) => (
        <Coin key={sym} sym={sym} i={i} size={size} setRef={(el) => (els.current[i] = el)} />
      ))}
    </div>
  )
}
