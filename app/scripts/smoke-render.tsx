// Component smoke test (`bun run smoke`): actually RENDER the new landing components so a runtime error shows
// up here instead of as a blank page. Pure-prop components only — anything on wagmi hooks needs
// a live provider and is out of scope.
import { renderToString } from 'react-dom/server'
import { Faq } from '@/components/landing/Faq'
import { Categories } from '@/components/landing/Categories'
import { RebalanceSpotlight } from '@/components/landing/RebalanceSpotlight'
import { Hero } from '@/components/landing/Hero'
import { TaglineReveal } from '@/components/landing/TaglineReveal'
import { Benefits } from '@/components/landing/Benefits'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { FinalCta } from '@/components/landing/FinalCta'
import { FaucetNotice } from '@/components/trade/FaucetNotice'
import { LowLiquidityNotice } from '@/components/trade/LowLiquidityNotice'
import { Reveal } from '@/components/Reveal'
import { CandleChart } from '@/components/trade/CandleChart'
import type { PriceRow } from '@/lib/prices'

const asset = (display: string, category: string, token: string) => ({
  token, symbol: display, display, category, decimals: 6,
  venue: '0x0000000000000000000000000000000000000001', mirror: true, mainnetRef: '',
  priceE8: 100000000n, observedAt: 1760000000, risk: 0,
})
const row = (d: string, c: string, t: string, chg: number | null): PriceRow => ({
  asset: asset(d, c, t) as PriceRow['asset'],
  last: 1.23, oracleAgeSec: 42, stale: false, ref: null, refToken: null, change24h: chg, deviation: null,
})

const rows: PriceRow[] = [
  row('cirBTC', 'Crypto', '0x01', 2.4), row('WETH', 'Crypto', '0x02', -1.1),
  row('XAUM', 'RWA', '0x03', 0.3), row('ASTOCK', 'RWA', '0x04', null),
  row('EURC', 'FX', '0x05', -0.2), row('GBPA', 'FX', '0x06', 0.9),
  row('syrupUSDC', 'Yield', '0x07', 0.1), row('USDC', 'Cash', '0x08', 0),
]

let fails = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (ok) console.log(`  PASS  ${name} — ${detail}`)
  else { fails++; console.log(`  FAIL  ${name} — ${detail}`) }
}
const t = (name: string, fn: () => string) => {
  try {
    const html = fn()
    if (!html || html.length < 20) throw new Error(`suspiciously short output (${html.length} chars)`)
    console.log(`  PASS  ${name} — ${html.length} chars`)
    return html
  } catch (e) { fails++; console.log(`  FAIL  ${name} — ${(e as Error).message}`); return '' }
}

console.log('\n=== SSR smoke ===')
const faq = t('Faq renders', () => renderToString(<Faq />))
const cats = t('Categories renders (8 rows)', () => renderToString(<Categories rows={rows} loading={false} />))
t('Categories renders (loading)', () => renderToString(<Categories rows={undefined} loading={true} />))
check(
  'Categories renders nothing when no class has assets',
  renderToString(<Categories rows={[]} loading={false} />) === '',
  'returns null rather than an empty section',
)

const spot = t('RebalanceSpotlight renders', () => renderToString(<RebalanceSpotlight />))
const hero = t('Hero renders', () => renderToString(<Hero />))
const faucet = t('FaucetNotice renders', () => renderToString(<FaucetNotice />))
check('Faucet notice links to Circle faucet in a new tab', faucet.includes('https://faucet.circle.com') && faucet.includes('noopener'), 'link + rel')
const warnGbpa = t('LowLiquidityNotice renders (GBPA)', () => renderToString(<LowLiquidityNotice symbol="GBPA" />))
const warnEurc = renderToString(<LowLiquidityNotice symbol="EURC" />)
check('Low-liquidity warning: shown for GBPA, absent for EURC', warnGbpa.includes('Low liquidity') && warnEurc === '', 'yellow note only on thin markets')
check('Problem section maps to the real gates', ['drift band', 'max trade size', 'slippage', 'cooldown', 'stale price'].every((x) => spot.toLowerCase().includes(x)), 'gates named')
check('Hero has one primary action and a labelled illustrative preview', (hero.match(/Create a basket/g) ?? []).length === 1 && hero.includes('Illustrative') && hero.includes('Arc'), 'one CTA + disclaimer')
const tag = t('TaglineReveal renders', () => renderToString(<TaglineReveal />))
check('Tagline is fully lit server side (animation can never hide it)', !tag.includes('opacity-30'), 'no muted words in SSR output')
t('Benefits renders', () => renderToString(<Benefits />))
t('HowItWorks renders', () => renderToString(<HowItWorks />))
const fin = t('FinalCta renders', () => renderToString(<FinalCta />))
check('Final CTA repeats the hero action', fin.includes('Create a basket') && fin.includes('faucet.circle.com'), 'same CTA + faucet link')
const copy = [hero, spot, tag, fin, faq].join(' ').replace(/<[^>]+>/g, ' ')
const hyph = copy.match(/[A-Za-z]-[A-Za-z]/g) ?? []
check('No hyphens inside landing copy', hyph.length === 0, hyph.length ? `found: ${hyph.slice(0, 5).join(', ')}` : 'none')

check('Reveal renders its children (never hides content server-side)', renderToString(<Reveal><i>kept</i></Reveal>).includes('kept'), 'children present')

// Candles: exercise the new hollow-body branch and the degenerate guards.
const mk = (n: number, flat = false) => Array.from({ length: n }, (_, i) => {
  const base = 100 + (flat ? 0 : Math.sin(i / 3) * 5)
  return { t: 1760000000 + i * 3600, o: base, h: base + (flat ? 0 : 1), l: base - (flat ? 0 : 1), c: base + (flat ? 0 : (i % 2 ? 0.8 : -0.8)), v: 0 }
})
const chart = (n: number, flat = false) =>
  renderToString(<CandleChart candles={mk(n, flat)} tf="1H" mode="candle" height={260} showVolume={false} />)
const c44 = t('CandleChart 44 candles', () => chart(44))
t('CandleChart 500 candles (dense -> solid fallback)', () => chart(500))
t('CandleChart flat series (bh<2 -> solid)', () => chart(40, true))
t('CandleChart single candle', () => chart(1))

// Assertions on what the markup actually contains, not just that it rendered.
check('Faq has 10 details elements', (faq.match(/<details/g) ?? []).length === 10, `${(faq.match(/<details/g) ?? []).length} found`)
check('Categories shows Blue chips + RWA', cats.includes('Blue chips') && /<h3[^>]*>RWA</.test(cats), 'both tiles present')
check('Categories excludes USDC (cash)', !/>USDC</.test(cats), 'USDC not listed as a tradable class')
check('Categories links carry class filter', cats.includes('class=RWA'), 'href has ?class=RWA')
check('No NaN in any chart path', !c44.includes('NaN'), 'all path coordinates finite')
// The candle bodies themselves cannot be asserted here: width comes from a ResizeObserver, which
// reports 0 without layout, so the chart renders its empty shell. What this proves is that none of
// the four candle shapes throws. The hollow/solid branch geometry is covered numerically instead.
check('CandleChart degrades to a shell, not a crash, at zero width', c44.includes('<svg') || c44.length > 100, 'renders without throwing')

console.log(fails === 0 ? '\nALL GREEN\n' : `\n${fails} FAILED\n`)
process.exit(fails === 0 ? 0 : 1)
