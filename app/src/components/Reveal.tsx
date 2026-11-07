// Fades and lifts a section into place the first time it scrolls into view. Pure CSS transition driven by
// one IntersectionObserver. Content is always visible without IntersectionObserver or when the user
// prefers reduced motion (see .reveal in index.css), so animation can never hide content.
import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = ref.current
    if (!el || shown) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    )
    io.observe(el)
    // Safety net: never leave a section hidden if the observer is throttled (background tab, print).
    const t = setTimeout(() => setShown(true), 4000)
    return () => {
      io.disconnect()
      clearTimeout(t)
    }
  }, [shown])

  return (
    <div ref={ref} data-shown={shown} style={delay ? { transitionDelay: `${delay}ms` } : undefined} className={`reveal empty:hidden ${className}`}>
      {children}
    </div>
  )
}
