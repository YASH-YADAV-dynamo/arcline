// Large type tagline. Words start at 30% opacity and light up one at a time, in reading order, as
// the block scrolls through the viewport. One scroll listener, throttled through requestAnimationFrame;
// each word animates opacity only, on the base curve. Reduced motion shows the final text at once.
import { useEffect, useRef, useState } from 'react'

const LINES = ['You set the rules once.', 'The contract makes every trade follow them.']
const WORDS = LINES.map((l) => l.split(' '))
const TOTAL = WORDS.flat().length
/** Index of each line's first word, so a word's reading order is OFFSET[line] + its position. */
const OFFSET = WORDS.map((_, li) => WORDS.slice(0, li).flat().length)

export function TaglineReveal() {
  const ref = useRef<HTMLHeadingElement>(null)
  // Server render and no-JS: everything lit, so the animation can never hide the text.
  const [lit, setLit] = useState(TOTAL)

  useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const st = { frame: 0, best: 0 } // per-effect scratch: pending rAF id, most words lit so far
    const measure = () => {
      st.frame = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      // 0 when the block's top reaches 85% of the viewport, 1 when its bottom passes the 45% line.
      const start = vh * 0.85
      const end = vh * 0.45 - r.height
      const p = Math.min(1, Math.max(0, (start - r.top) / (start - end)))
      st.best = Math.max(st.best, Math.round(p * TOTAL)) // reveal once: never dims again on scroll up
      setLit(st.best)
      if (st.best >= TOTAL) window.removeEventListener('scroll', onScroll)
    }
    const onScroll = () => {
      if (!st.frame) st.frame = requestAnimationFrame(measure)
    }
    setLit(0)
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (st.frame) cancelAnimationFrame(st.frame)
    }
  }, [])

  return (
    <section aria-label="What Arcline is for" className="py-16 sm:py-24">
      <h2 ref={ref} aria-label={LINES.join(' ')} className="mx-auto max-w-[680px] text-center heading-4 sm:heading-2 lg:heading-1">
        {WORDS.map((line, li) => (
          <span key={li} className="block" aria-hidden="true">
            {line.map((w, wi) => {
              const on = OFFSET[li] + wi < lit
              return (
                <span key={`${li}-${w}`} className={`transition-opacity duration-500 ease-base ${on ? 'opacity-100' : 'opacity-30'}`}>
                  {w}{' '}
                </span>
              )
            })}
          </span>
        ))}
      </h2>
    </section>
  )
}
