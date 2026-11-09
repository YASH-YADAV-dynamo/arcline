// The one navbar, on every route: a compact bar floating 16px off the top edge, centred and sized to
// its content, on a translucent blurred surface. It is sticky (not fixed), so it takes its own space
// and never covers page content; the header is exactly 80px tall (16 + 56 + 8), which pages with
// their own sticky bars offset against (top-20).
// Mobile: wordmark, wallet and a toggle that morphs between two lines and an X. The menu opens as a
// full height panel whose links rise in one after another (60ms apart, the whole run under 400ms).
import { useEffect, useRef, useState } from 'react'
import { Link } from '@/lib/router'
import { NAV, type NavKey } from './nav'
import { Wordmark } from './TopBar'
import { ThemeToggle } from './ThemeToggle'
import { NetworkPill, UsdcChip, WalletControls } from './WalletControls'

const STEP_MS = 60
const CAP_MS = 400

export function SiteNav({ active }: { active: NavKey | null }) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Lock page scroll behind the panel, close on Escape and on route change, return focus to the toggle.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    const onRoute = () => setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onRoute)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onRoute)
    }
  }, [open])

  const link = (on: boolean) =>
    `block rounded-lg px-3 py-2 text-sm font-medium transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      on ? 'bg-panel2 text-ink' : 'text-muted hover:bg-panel2 hover:text-ink'
    }`

  return (
    <>
      <div className="flex justify-center px-4 pb-2 pt-4">
        <nav aria-label="Main" className="relative z-50 flex h-14 w-full items-center gap-2 rounded-2xl border border-line bg-bg/70 px-2 backdrop-blur-md md:w-auto">
          <span className="px-2" aria-current={active === null ? 'page' : undefined}>
            <Wordmark />
          </span>
          <ul className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <li key={n.key}>
                <Link to={n.to} aria-current={active === n.key ? 'page' : undefined} className={link(active === n.key)}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex min-w-0 items-center gap-2 md:ml-2">
            <NetworkPill />
            <UsdcChip />
            <span className="hidden md:inline-flex">
              <ThemeToggle />
            </span>
            <WalletControls />
            <button
              ref={toggleRef}
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-ink transition duration-300 hover:bg-panel2 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
            >
              <span aria-hidden="true" className="relative block size-4">
                <span className={`absolute left-0 top-1 block h-0.5 w-4 rounded-full bg-current transition-transform duration-500 ease-base motion-reduce:transition-none ${open ? 'translate-y-1 rotate-45' : ''}`} />
                <span className={`absolute left-0 top-3 block h-0.5 w-4 rounded-full bg-current transition-transform duration-500 ease-base motion-reduce:transition-none ${open ? '-translate-y-1 -rotate-45' : ''}`} />
              </span>
            </button>
          </div>
        </nav>
      </div>

      {/* Always rendered so the links have a resting state to animate from; `invisible` removes the
          closed panel from the tab order and the accessibility tree. */}
      <div
        id="site-menu"
        className={`fixed inset-0 z-40 bg-bg/95 px-4 pb-8 pt-24 backdrop-blur-xl transition-[opacity,visibility] duration-300 ease-base md:hidden ${open ? 'visible opacity-100' : 'invisible opacity-0'}`}
      >
        <ul className="flex flex-col gap-2">
          {NAV.map((n, i) => (
            <li
              key={n.key}
              style={{ transitionDelay: open ? `${Math.min(i * STEP_MS, CAP_MS - STEP_MS)}ms` : '0ms' }}
              className={`transition duration-500 ease-base motion-reduce:translate-y-0 ${open ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}
            >
              <Link
                to={n.to}
                aria-current={active === n.key ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={`block rounded-xl px-3 py-3 text-2xl font-semibold transition duration-300 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active === n.key ? 'text-accent' : ''}`}
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex items-center justify-between rounded-xl border border-line p-3">
          <span className="text-sm text-muted">Theme</span>
          <ThemeToggle />
        </div>
      </div>
    </>
  )
}
