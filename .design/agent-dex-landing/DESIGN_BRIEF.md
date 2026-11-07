# Design brief — agent-native DEX landing

Run as a compressed design-flow on 2026-11-07, the final day of ETHGlobal Mumbai. Phases were
skipped deliberately; see the bottom of this file.

## Problem

The landing page read as a **swap**. The product is a venue **agents** trade through: spot markets
across FX, crypto, yield and RWAs, plus a rebalancing engine with the risk limits enforced
on-chain. A visitor could not tell the difference from the hero.

## Positioning

> A DEX your agents can trade. FX, gold, equities and RWAs with risk management on-chain.

Three capabilities, named in the hero because they are the differentiators:

| Capability | What backs it |
|---|---|
| **Auto-search** | Agents read the registry for price, observation age, risk level, venue and class |
| **Advanced rebalancing** | Drift bands, cooldowns, max-trade caps, slippage bounds |
| **Agent-executable** | Every gate is a contract revert, not a client-side check |

The claim "an agent cannot trade past the guardrails even if it tries" is literal: the gates are in
`BucketAccount`, verified by `ops/e2e.cjs`.

## Information architecture

Landing order, reasoning from what a first-time visitor needs:

1. **Hero + live trade window** — `QuickSwap` is the real component on the real hooks, not a
   screenshot. It cannot go stale and it proves the thing works in the first viewport.
2. **Overview strip** — market pulse.
3. **Markets table** — the full list, the primary action.
4. **Asset classes** — four tiles, each linking into a filtered `#/markets?class=…`.
5. **Buckets showcase** — the rebalancing product.
6. **How it works** — three steps.
7. **FAQ** — eight questions, including what is *not* finished.
8. **Trust strip** — deployed contract addresses on the explorer.

### Classes are not a taxonomy we invented

The tiles map to the `category` enum on `AssetRegistry` (`Cash / FX / Crypto / Yield / RWA`), read
live. Verified on-chain:

```
FX      -> EURC, GBPA.m
Crypto  -> cirBTC.m, WETH.m        (shown as "Blue chips")
Yield   -> syrupUSDC.m
RWA     -> XAUM.m, ASTOCK.m        (gold, equity index)
Cash    -> USDC                    (excluded: it is the quote asset)
```

A tile is not rendered for a class the registry does not list, so the section cannot show an empty
group.

## Decisions

- **No hero mockup image.** No image-generation tool was available, and mounting the live trade
  panel is better anyway — a screenshot of a trade window is a thing that goes out of date.
- **FAQ uses native `<details>`** — keyboard-operable, Ctrl+F-searchable, works without JS.
- **The FAQ states the limits** (testnet only, CRE not on a DON, thin pools, MIRROR ≠ real asset).
  A visitor discovering that later is worse than reading it here.
- **Icon ink is computed, not chosen.** White initials were measured against the eight badge
  colours and failed 7 of 8, down to 2.18:1. `assetInk()` now picks black or white by luminance.
- **Unlisted assets pick from a fixed colour set**, never a generated hue.

## Phases skipped, and why

| Phase | Status |
|---|---|
| 1 Grill me | Skipped — direction was specific |
| 2 Brief | This file |
| 3 Information architecture | Folded in above |
| 4 Design tokens | Skipped — tokens exist and now **validate** (see `DESIGN.md`) |
| 5 Brief to tasks | Skipped — single surface, built directly |
| 6 Frontend design | Done |
| 7 Design review | **Blocked** — needs screenshots of the running app; the browser tool is not connected |

## Not verified

Phase 7 never ran. Nothing here has been **looked at**. Type-checking, linting, the production
build and the on-chain category data all pass, but no human or tool has seen the rendered page.
Responsive behaviour at 360 / 768 / 1280 is unconfirmed.
