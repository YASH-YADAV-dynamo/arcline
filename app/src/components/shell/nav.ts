import { Bot, ChartCandlestick, ChartPie, Layers, LayoutList, type LucideIcon } from 'lucide-react'

export type NavKey = 'markets' | 'trade' | 'buckets' | 'agents' | 'portfolio'
export type NavItem = { key: NavKey; label: string; to: string; icon: LucideIcon }

// Rebalancer first: baskets and the portfolio they live in, then the assets they can hold. Manual
// trading stays, last, for people who want to adjust one asset by hand.
export const NAV: NavItem[] = [
  { key: 'buckets', label: 'Baskets', to: '/baskets', icon: Layers },
  { key: 'portfolio', label: 'Portfolio', to: '/portfolio', icon: ChartPie },
  { key: 'markets', label: 'Assets', to: '/assets', icon: LayoutList },
  { key: 'agents', label: 'Agents', to: '/agents', icon: Bot },
  { key: 'trade', label: 'Trade', to: '/trade/EURC', icon: ChartCandlestick },
]

/** Which nav item a route belongs to. The landing page belongs to none (the wordmark marks it). */
export function activeKey([page]: string[]): NavKey | null {
  if (!page) return null
  if (page === 'trade') return 'trade'
  if (page === 'portfolio') return 'portfolio'
  if (page === 'buckets' || page === 'baskets') return 'buckets'
  if (page === 'agents') return 'agents'
  return 'markets'
}
