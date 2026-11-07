import { ExternalLink, Droplets } from 'lucide-react'

export const CIRCLE_FAUCET = 'https://faucet.circle.com'

/**
 * Shown to a connected wallet that is short on USDC. On Arc Testnet USDC is both the trading asset and the
 * gas token, so one faucet fixes both "can't afford the trade" and "can't pay for gas".
 */
export function FaucetNotice({ gasOnly = false }: { gasOnly?: boolean }) {
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-xl border border-accent/40 bg-accent/10 p-2.5 text-xs">
      <Droplets size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-ink">
          <span className="font-semibold">{gasOnly ? 'Low on USDC for gas.' : 'Need testnet USDC?'}</span>{' '}
          <span className="text-muted">USDC is also the gas token on Arc, so a small balance is needed for any trade. Pick Arc Testnet in the Circle faucet; the funds are free and have no real value.</span>
        </p>
        <a href={CIRCLE_FAUCET} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 font-medium text-accent hover:underline">
          Get testnet USDC from Circle <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}
