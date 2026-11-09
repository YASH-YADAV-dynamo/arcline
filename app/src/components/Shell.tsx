// Exchange chrome: top bar + ticker tape (sticky), connect-error notice, page, status bar, mobile tab bar.
import type { ReactNode } from 'react'
import { useRoute } from '@/lib/router'
import { activeKey } from './shell/nav'
import { SiteNav } from './shell/SiteNav'
import { ConnectNotice } from './shell/ConnectNotice'
import { Footer, StatusBar } from './shell/Footer'
import { ArcAutoSwitch } from './shell/ArcAutoSwitch'
import { ListingsWatcher } from './shell/ListingsWatcher'
import { LiveFeed } from './shell/LiveFeed'

export function Shell({ children }: { children: ReactNode }) {
  const route = useRoute()
  const active = activeKey(route)
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-bg text-ink">
      {/* Skip link. A button, not href="#main": the router owns the hash, so an anchor would navigate. */}
      <button
        type="button"
        onClick={() => document.getElementById('main')?.focus()}
        className="sr-only z-[60] rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-onaccent focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </button>
      <ArcAutoSwitch />
      <ListingsWatcher />
      <LiveFeed />
      {/* One navbar for every route, the landing page included. */}
      <header className="sticky top-0 z-40">
        <SiteNav active={active} />
        <ConnectNotice />
      </header>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">{children}</main>
      {/* mobile: room for the tab bar; desktop: room for the fixed 28px status bar */}
      <div className="md:pb-7">
        <Footer />
        <StatusBar />
      </div>
    </div>
  )
}
