// Candlestick / area chart in plain SVG (no chart library): OHLC candles + volume pane, right price axis,
// crosshair with an OHLC/volume legend, and horizontal reference lines (on-chain oracle last price, testnet pool mid).
// Reference lines are overlays only: historical candles are never rewritten.
import { toPriceString } from '@/lib/chart-pick'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { TIMEFRAMES, type Timeframe } from '@/lib/market'
import type { ChartCandle } from '@/lib/candles'
import { compactUsd } from './ui'

export type RefLine = { price: number; label: string; tone: 'up' | 'down' | 'muted' | 'warn'; dashed?: 'long' | 'short' }

const PAD = { t: 28, r: 74, b: 22, l: 4 }
const VOL_FRAC = 0.18
const TONE = { up: 'rgb(var(--up))', down: 'rgb(var(--down))', muted: 'rgb(var(--muted))', warn: 'rgb(var(--warn))' } as const

function niceStep(raw: number) {
  const e = 10 ** Math.floor(Math.log10(raw))
  const f = raw / e
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e
}
const fmtN = (v: number, d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

/** The price pane never zooms tighter than this share of the mid price, so oracle noise reads as a calm line. */
const MIN_SPAN_FRAC = 0.006
const MIN_SPAN_ABS = 1e-6
const Y_PAD = 0.08
/** Label spacings (seconds) the time axis can snap to. */
const TICK_STEPS = [900, 1800, 3600, 7200, 10_800, 21_600, 43_200, 86_400, 172_800, 432_000, 604_800, 1_209_600, 2_592_000]
const tzOffset = (t: number) => -new Date(t * 1000).getTimezoneOffset() * 60

const NONE: RefLine[] = []

export function CandleChart({ candles, tf, mode, lines = NONE, height = 360, showVolume = true, onPick }: { candles: ChartCandle[]; tf: Timeframe; mode: 'candle' | 'area'; lines?: RefLine[]; height?: number; showVolume?: boolean; onPick?: (price: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState<{ i: number; y: number } | null>(null)
  const gid = useId().replace(/:/g, '')

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const g = useMemo(() => {
    const n = candles.length
    if (n < 2 || w < 120) return null
    const iw = w - PAD.l - PAD.r
    const ih = height - PAD.t - PAD.b
    // an oracle series has no volume, so the price pane takes the whole height instead of
    // leaving an empty strip at the bottom
    const vf = showVolume ? VOL_FRAC : 0
    const ph = ih * (1 - vf) - (showVolume ? 6 : 0) // price pane
    const vTop = PAD.t + ih * (1 - vf)
    const vh = ih * vf

    let lo = Infinity
    let hi = -Infinity
    for (const c of candles) {
      lo = Math.min(lo, mode === 'area' ? c.c : c.l)
      hi = Math.max(hi, mode === 'area' ? c.c : c.h)
    }
    // pull reference lines into view only when they sit near the candles; far ones are pinned to the edge
    const minSpan = Math.max(Math.abs(hi + lo) / 2 * MIN_SPAN_FRAC, MIN_SPAN_ABS)
    const near = Math.max(hi - lo, minSpan)
    for (const l of lines) if (l.price >= lo - near && l.price <= hi + near) { lo = Math.min(lo, l.price); hi = Math.max(hi, l.price) }
    // enforce a minimum visible span centred on the data: tiny oracle noise stays a calm line.
    // Real highs and lows are never clipped, the window only ever grows around them.
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2
      lo = mid - minSpan / 2
      hi = mid + minSpan / 2
    }
    const span = hi - lo
    const min = lo - span * Y_PAD
    const max = hi + span * Y_PAD
    const step = niceStep((max - min) / Math.max(3, Math.min(7, Math.floor(ph / 48))))
    const dec = Math.min(8, Math.max(0, 1 - Math.floor(Math.log10(step))))
    const ticks: number[] = []
    for (let k = Math.ceil(min / step); k * step <= max; k++) ticks.push(Number((k * step).toFixed(dec + 2)))

    const slot = iw / n
    const bw = Math.max(1, Math.min(14, slot * 0.68))
    const x = (i: number) => PAD.l + (i + 0.5) * slot
    const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * ph
    const vMax = Math.max(...candles.map((c) => c.v), 0) || 1

    let upW = '', upB = '', upBH = '', dnW = '', dnB = '', upV = '', dnV = '', fl = '', line = ''
    const tw = Math.max(2, Math.min(12, slot * 0.7)) // width of a gap tick
    candles.forEach((c, i) => {
      const cx = x(i)
      line += `${i ? 'L' : 'M'}${cx.toFixed(1)},${y(c.c).toFixed(1)}`
      if (c.filled) {
        // no report in this bucket: a thin muted tick at the carried price, no body, wick or volume
        fl += `M${(cx - tw / 2).toFixed(1)},${y(c.c).toFixed(1)}h${tw.toFixed(1)}`
        return
      }
      const up = c.c >= c.o
      const wick = `M${cx.toFixed(1)},${y(c.h).toFixed(1)}V${y(c.l).toFixed(1)}`
      const top = y(Math.max(c.o, c.c))
      const bh = Math.max(1, y(Math.min(c.o, c.c)) - top)
      const body = `M${(cx - bw / 2).toFixed(1)},${top.toFixed(1)}h${bw.toFixed(1)}v${bh.toFixed(1)}h${(-bw).toFixed(1)}Z`
      const vhgt = Math.max(c.v > 0 ? 1 : 0, (c.v / vMax) * (vh - 2))
      const vol = vhgt > 0 ? `M${(cx - bw / 2).toFixed(1)},${(vTop + vh - vhgt).toFixed(1)}h${bw.toFixed(1)}v${vhgt.toFixed(1)}h${(-bw).toFixed(1)}Z` : ''
      if (up) {
        upW += wick
        // Hollow up-bodies, filled down-bodies: shape carries direction, not hue alone. The
        // up/down pair is only ΔE 6.5 apart under deuteranopia, so colour by itself fails for
        // red-green colourblind readers — about 8% of men. Inset by 0.5px so the 1px stroke
        // lands crisply and the hollow body matches a filled one's footprint. Bodies under 2px
        // stay solid: a hollow rect that thin collapses into a smudge. bw is clamped to >= 1, so
        // a hollow body also needs bw >= 3 — at bw 1 the inset interior would be zero-width and
        // the candle would vanish entirely on dense timeframes.
        if (bh >= 2 && bw >= 3) upBH += `M${(cx - bw / 2 + 0.5).toFixed(1)},${(top + 0.5).toFixed(1)}h${(bw - 1).toFixed(1)}v${(bh - 1).toFixed(1)}h${(-(bw - 1)).toFixed(1)}Z`
        else upB += body
        upV += vol
      } else { dnW += wick; dnB += body; dnV += vol }
    })
    const area = `${line}L${x(n - 1).toFixed(1)},${(PAD.t + ph).toFixed(1)}L${x(0).toFixed(1)},${(PAD.t + ph).toFixed(1)}Z`

    // Time axis: labels at the first candle of each regular wall-clock period (e.g. every 3h, every
    // 2 days), spaced >= ~96px apart. Candles sit on an even grid, so the labels are evenly spaced too.
    const csec = TIMEFRAMES[tf].sec
    const want = (96 / slot) * csec
    const period = TICK_STEPS.find((s) => s >= want && s >= csec) ?? TICK_STEPS[TICK_STEPS.length - 1]
    const xt: number[] = []
    for (let i = 1; i < n; i++) {
      const t = candles[i].t
      if (Math.floor((t + tzOffset(t)) / period) !== Math.floor((t - csec + tzOffset(t - csec)) / period)) xt.push(i)
    }
    // labels must not collide with the plot edges; a very short series still gets one label
    const xs = xt.filter((i) => x(i) >= PAD.l + 24 && x(i) <= PAD.l + iw - 24)
    if (!xs.length) xs.push(Math.floor(n / 2))

    return { n, iw, ph, vTop, vh, min, max, dec, ticks, slot, x, y, upW, upB, upBH, dnW, dnB, upV, dnV, fl, line, area, xt: xs, period, up: candles[n - 1].c >= candles[0].c }
  }, [candles, w, height, mode, lines, showVolume, tf])

  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const hm = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  /** legend / crosshair label (long) or axis label: HH:mm intraday (date at local midnight), MMM d once labels are a day or more apart */
  const fmtT = (t: number, long = false) => {
    const d = new Date(t * 1000)
    if (long) return tf === '1D' ? md(d) : `${md(d)} ${hm(d)}`
    if (tf === '1D' || (g?.period ?? 0) >= 86_400) return md(d)
    return d.getHours() === 0 && d.getMinutes() === 0 ? md(d) : hm(d)
  }

  // Click a price level: hand it to the order ticket, rounded to the axis precision.
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!g || !onPick) return
    const r = e.currentTarget.getBoundingClientRect()
    const py = e.clientY - r.top
    if (py < PAD.t || py > PAD.t + g.ph) return
    const price = toPriceString(g.min + (1 - (py - PAD.t) / g.ph) * (g.max - g.min), g.dec)
    if (price) onPick(price)
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!g) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left - PAD.l
    const py = e.clientY - r.top
    if (px < 0 || px > g.iw) return setHover(null)
    setHover({ i: Math.max(0, Math.min(g.n - 1, Math.floor(px / g.slot))), y: py })
  }

  const cur = candles[hover?.i ?? candles.length - 1]
  const prev = candles[(hover?.i ?? candles.length - 1) - 1]
  const chg = cur && prev ? ((cur.c - prev.c) / prev.c) * 100 : null
  const dec = g?.dec ?? 4
  const legendTone = cur && cur.c >= cur.o ? 'text-up' : 'text-down'

  // right-axis labels for reference lines, nudged apart so they never overlap
  const refs = g
    ? lines
        .map((l) => {
          const raw = g.y(l.price)
          const top = PAD.t + 8
          const bot = PAD.t + g.ph - 8
          return { ...l, y: Math.min(bot, Math.max(top, raw)), off: raw < top ? 'above' : raw > bot ? 'below' : null }
        })
        .sort((a, b) => a.y - b.y)
    : []
  for (let i = 1; i < refs.length; i++) if (refs[i].y - refs[i - 1].y < 18) refs[i].y = refs[i - 1].y + 18

  const hoverPrice = g && hover && hover.y >= PAD.t && hover.y <= PAD.t + g.ph ? g.min + (1 - (hover.y - PAD.t) / g.ph) * (g.max - g.min) : null

  return (
    <div ref={box} className="relative w-full" style={{ height }}>
      {cur && (
        <div className="pointer-events-none absolute left-2 right-[78px] top-1.5 z-10 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[11px] num leading-4">
          <span className="text-muted">{fmtT(cur.t, true)}</span>
          {cur.filled && <span className="text-faint" title="No oracle report in this period; the previous close is carried forward">no report · carried</span>}
          <span className="text-faint">O<span className={`ml-1 ${legendTone}`}>{fmtN(cur.o, dec)}</span></span>
          <span className="text-faint">H<span className={`ml-1 ${legendTone}`}>{fmtN(cur.h, dec)}</span></span>
          <span className="text-faint">L<span className={`ml-1 ${legendTone}`}>{fmtN(cur.l, dec)}</span></span>
          <span className="text-faint">C<span className={`ml-1 ${legendTone}`}>{fmtN(cur.c, dec)}</span></span>
          {chg !== null && <span className={chg >= 0 ? 'text-up' : 'text-down'}>{chg >= 0 ? '+' : '−'}{Math.abs(chg).toFixed(2)}%</span>}
          {showVolume && <span className="text-faint">Vol<span className="ml-1 text-muted">{compactUsd(cur.v)}</span></span>}
        </div>
      )}
      {g && (
        <svg width={w} height={height} className={`block select-none ${onPick ? 'cursor-crosshair' : ''}`} style={{ touchAction: 'pan-y' }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} onClick={onClick}
          role="img" aria-label={`${mode === 'area' ? 'Area' : 'Candlestick'} chart, ${tf} candles, ${candles.length} periods${mode === 'area' ? '' : '. Hollow bodies rose over the period, filled bodies fell'}`}>
          <defs>
            <linearGradient id={`a${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={g.up ? TONE.up : TONE.down} stopOpacity="0.22" />
              <stop offset="100%" stopColor={g.up ? TONE.up : TONE.down} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* grid + price axis */}
          {g.ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={PAD.l + g.iw} y1={g.y(v)} y2={g.y(v)} stroke="rgb(var(--line))" strokeOpacity="0.7" />
              <text x={PAD.l + g.iw + 8} y={g.y(v) + 3.5} fill="rgb(var(--faint))" className="font-mono text-[10px]">{fmtN(v, g.dec)}</text>
            </g>
          ))}
          <line x1={PAD.l + g.iw} x2={PAD.l + g.iw} y1={PAD.t - 6} y2={height - PAD.b} stroke="rgb(var(--line))" />
          {showVolume && <line x1={PAD.l} x2={PAD.l + g.iw} y1={g.vTop - 3} y2={g.vTop - 3} stroke="rgb(var(--line))" strokeOpacity="0.5" />}
          {g.xt.map((i) => (
            <text key={i} x={g.x(i)} y={height - 6} textAnchor="middle" fill="rgb(var(--faint))" className="font-mono text-[10px]">{fmtT(candles[i].t)}</text>
          ))}

          {/* volume */}
          {showVolume && (
            <>
              <path d={g.upV} fill={TONE.up} fillOpacity="0.28" />
              <path d={g.dnV} fill={TONE.down} fillOpacity="0.28" />
            </>
          )}

          {/* price */}
          {mode === 'candle' ? (
            <>
              <path d={g.upW} stroke={TONE.up} strokeWidth={1} fill="none" />
              <path d={g.dnW} stroke={TONE.down} strokeWidth={1} fill="none" />
              <path d={g.upBH} fill="none" stroke={TONE.up} strokeWidth={1} />
              <path d={g.upB} fill={TONE.up} />
              <path d={g.dnB} fill={TONE.down} />
              <path d={g.fl} stroke="rgb(var(--muted))" strokeOpacity="0.65" strokeWidth={1} fill="none" />
            </>
          ) : (
            <>
              <path d={g.area} fill={`url(#a${gid})`} />
              <path d={g.line} fill="none" stroke={g.up ? TONE.up : TONE.down} strokeWidth={1.6} strokeLinejoin="round" />
            </>
          )}

          {/* reference lines (oracle last, testnet pool) */}
          {refs.map((l) => (
            <g key={l.label}>
              {!l.off && <line x1={PAD.l} x2={PAD.l + g.iw} y1={g.y(l.price)} y2={g.y(l.price)} stroke={TONE[l.tone]} strokeWidth={1} strokeDasharray={l.dashed === 'short' ? '2 3' : '6 4'} />}
              <rect x={PAD.l + g.iw + 1} y={l.y - 8} width={PAD.r - 3} height={16} rx={3} fill={TONE[l.tone]} fillOpacity={l.tone === 'muted' ? 0.9 : 1} />
              <text x={PAD.l + g.iw + 6} y={l.y + 3.5} fill="rgb(var(--onaccent))" className="font-mono text-[10px] font-semibold">
                {l.off === 'above' ? '▲' : l.off === 'below' ? '▼' : ''}{fmtN(l.price, g.dec)}
              </text>
            </g>
          ))}

          {/* crosshair */}
          {hover && (
            <g pointerEvents="none">
              <line x1={g.x(hover.i)} x2={g.x(hover.i)} y1={PAD.t - 6} y2={height - PAD.b} stroke="rgb(var(--muted))" strokeOpacity="0.6" strokeDasharray="3 3" />
              {hoverPrice !== null && (
                <>
                  <line x1={PAD.l} x2={PAD.l + g.iw} y1={hover.y} y2={hover.y} stroke="rgb(var(--muted))" strokeOpacity="0.6" strokeDasharray="3 3" />
                  <rect x={PAD.l + g.iw + 1} y={hover.y - 8} width={PAD.r - 3} height={16} rx={3} fill="rgb(var(--panel2))" stroke="rgb(var(--line))" />
                  <text x={PAD.l + g.iw + 6} y={hover.y + 3.5} fill="rgb(var(--ink))" className="font-mono text-[10px]">{fmtN(hoverPrice, g.dec)}</text>
                </>
              )}
              <rect x={Math.min(Math.max(g.x(hover.i) - 46, PAD.l), PAD.l + g.iw - 92)} y={height - PAD.b + 2} width={92} height={17} rx={3} fill="rgb(var(--panel2))" stroke="rgb(var(--line))" />
              <text x={Math.min(Math.max(g.x(hover.i), PAD.l + 46), PAD.l + g.iw - 46)} y={height - 6} textAnchor="middle" fill="rgb(var(--ink))" className="font-mono text-[10px]">{fmtT(candles[hover.i].t, true)}</text>
            </g>
          )}
        </svg>
      )}
    </div>
  )
}
