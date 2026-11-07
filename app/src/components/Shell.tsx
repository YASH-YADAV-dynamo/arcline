// Exchange chrome: top bar + ticker tape (sticky), connect-error notice, page, status bar, mobile tab bar.
import type { ReactNode } from 'react'
import { useRoute } from '@/lib/router'
import { activeKey } from './shell/nav'
import { TopBar } from './shell/TopBar'
import { TickerTape } from './shell/TickerTape'
import { ConnectNotice } from './shell/ConnectNotice'
import { MobileTabs } from './shell/MobileTabs'
import { Footer, StatusBar } from './shell/Footer'
import { ArcAutoSwitch } from './shell/ArcAutoSwitch'
import { ListingsWatcher } from './shell/ListingsWatcher'

export function Shell({ children }: { children: ReactNode }) {
  const route = useRoute()
  const active = activeKey(route)
  const isHome = route.length === 0
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-bg text-ink">
      <ArcAutoSwitch />
      <ListingsWatcher />
      {/* Landing has no navbar: "Start trading" leads to the terminal, which has the wallet button. */}
      {isHome ? (
        <ConnectNotice />
      ) : (
        <header className="sticky top-0 z-40">
          <TopBar active={active} />
          <TickerTape />
          <ConnectNotice />
        </header>
      )}
      <main className="min-w-0 flex-1">{children}</main>
      {/* mobile: room for the tab bar; desktop: room for the fixed 28px status bar */}
      <div className={isHome ? 'pb-7' : 'pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-7'}>
        <Footer />
        <StatusBar />
      </div>
      {!isHome && <MobileTabs active={active} />}
    </div>
  )
}
