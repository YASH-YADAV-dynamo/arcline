// Landing (layout A, classic hero plus sections): one offer (a basket that rebalances itself), one
// primary action (Create a basket). Order: hero, problem to solution, tagline, benefits, how it
// works, proof (live templates, contracts), FAQ, final CTA. Manual trading lives on #/trade, not here.
// Behind it all, CoinStage moves six coins with the scroll, blending between the arrangement each
// section names in data-scene. Scroll snaps gently (proximity) to section starts while this page is mounted.
import { useEffect } from 'react'
import { Reveal } from '@/components/Reveal'
import { CoinStage } from '@/components/landing/CoinStage'
import { Hero } from '@/components/landing/Hero'
import { OracleProof, VerifyOnchain } from '@/components/landing/Proof'
import { RebalanceSpotlight } from '@/components/landing/RebalanceSpotlight'
import { TaglineReveal } from '@/components/landing/TaglineReveal'
import { Benefits } from '@/components/landing/Benefits'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { BucketsShowcase } from '@/components/landing/BucketsShowcase'
import { Faq } from '@/components/landing/Faq'
import { FinalCta } from '@/components/landing/FinalCta'

function useSectionSnap() {
  useEffect(() => {
    const s = document.documentElement.style
    const prev = [s.scrollSnapType, s.scrollPaddingTop]
    s.scrollSnapType = 'y proximity' // settles onto a section near its start, never traps a long one
    s.scrollPaddingTop = '80px' // the sticky navbar's height
    return () => {
      ;[s.scrollSnapType, s.scrollPaddingTop] = prev
    }
  }, [])
}

export default function Landing() {
  useSectionSnap()
  return (
    <>
      <CoinStage />
      <div className="relative z-10">
        <div data-scene="hero" className="snap-start">
          <Hero proof={<OracleProof />} />
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 pb-24 sm:gap-24">
          <div data-scene="drift" className="snap-start"><Reveal><RebalanceSpotlight /></Reveal></div>
          <div data-scene="tagline" className="snap-center"><TaglineReveal /></div>
          <div data-scene="content" className="snap-start"><Reveal><Benefits /></Reveal></div>
          <div data-scene="content" className="snap-start"><Reveal><HowItWorks /></Reveal></div>
          <div data-scene="content" className="snap-start"><Reveal><BucketsShowcase /></Reveal></div>
          <div data-scene="content" className="snap-start"><Reveal><VerifyOnchain /></Reveal></div>
          <div data-scene="content" className="snap-start"><Reveal><Faq /></Reveal></div>
          <div data-scene="final" className="snap-center"><Reveal><FinalCta /></Reveal></div>
          <div data-scene="out" aria-hidden="true" className="h-px" />
        </div>
      </div>
    </>
  )
}
