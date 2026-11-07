// A price picked on the chart, handed to the order ticket for the same token. Chart and ticket are siblings
// (Trade page and landing window), so a tiny keyed store avoids threading callbacks through both layouts.
import { useEffect, useRef } from 'react'

export type Pick = { price: string; at: number }

const listeners = new Map<string, Set<(p: Pick) => void>>()

/** `price` is already rounded to the chart's display precision, as a plain decimal string. */
export function pickPrice(token: string, price: string) {
  const p = { price, at: Date.now() }
  listeners.get(token.toLowerCase())?.forEach((fn) => fn(p))
}

/** Calls `onPick` whenever the chart for `token` is clicked. */
export function useOnPick(token: string, onPick: (p: Pick) => void) {
  const cb = useRef(onPick)
  useEffect(() => {
    cb.current = onPick
  })
  useEffect(() => {
    const key = token.toLowerCase()
    const set = listeners.get(key) ?? new Set()
    listeners.set(key, set)
    const fn = (p: Pick) => cb.current(p)
    set.add(fn)
    return () => {
      set.delete(fn)
    }
  }, [token])
}

/** Round to `dec` decimals and drop trailing zeros: 1.234500 -> "1.2345". */
export function toPriceString(v: number, dec: number): string {
  if (!Number.isFinite(v) || v <= 0) return ''
  return v.toFixed(Math.max(0, Math.min(dec, 12))).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}
