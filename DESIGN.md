# Design notes

The visual system is token-first: every colour is a CSS variable in
[`app/src/index.css`](app/src/index.css), surfaced to Tailwind in
[`app/tailwind.config.js`](app/tailwind.config.js). Dark is the default; `.light` on `<html>`
swaps the steps. Dark is a **selected** set of steps, not an automatic inversion of light.

| Role | Tokens |
|---|---|
| Surfaces | `bg`, `panel`, `panel2`, `line` |
| Ink | `ink`, `muted`, `faint` |
| Brand | `accent`, `onaccent` |
| Status | `up`, `down`, `warn` |
| Series (categorical) | `--bk-s0 … --bk-s7`, `--bk-other` ([`components/bucket/ui.tsx`](app/src/components/bucket/ui.tsx)) |

Type is Inter (UI) and JetBrains Mono (all figures). Both are loaded in
[`app/index.html`](app/index.html) — the design assumed them long before they were actually
fetched, and without them `.num`'s tabular numerals silently stopped aligning price columns.

## Colour is validated, not eyeballed

The series palette is the only **categorical** palette in the app, so it is the one that gets
validated. Re-run after any change to `LIGHT`/`DARK`:

```bash
# dark steps
node scripts/validate_palette.js "#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9,#e66767" --mode dark
# light steps
node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#6250d6,#e34948" --mode light
```

Both currently pass all checks. Light mode carries one contrast WARN (`#1baf7a`, `#eda100`,
`#e87ba4` fall below 3:1 on the light surface); the relief is that every donut is paired with
`HoldingsTable`, which states the same allocation as labelled rows.

`accent`, `up`, `down` and `warn` are **brand and status** colours, not a categorical palette.
Running them through a categorical validator reports failures that do not apply — status colours
are allowed to sit outside a shared lightness band. What does apply to them is contrast against
their surface, and the rule below.

## Nothing is encoded by colour alone

`up` and `down` are only **ΔE 6.5 apart under deuteranopia** — about 8% of men cannot reliably
separate them. Every place they appear therefore carries a second signal:

| Where | Second signal |
|---|---|
| Candle bodies | **Hollow = rose, filled = fell** ([`CandleChart.tsx`](app/src/components/trade/CandleChart.tsx)) — shape, not hue |
| Percent changes | `signedPct` always prints `+` or `−` |
| Drift meter | The figure, the bar length, a band tick, and `role="meter"` with `aria-valuenow` |
| Drift legend | Labelled **Near** / **Past** with a swatch, rather than naming "amber" and "red" |
| Buy/Sell rows | The words "Buy" and "Sell" |

Hollow candles fall back to solid when a body is under 2px tall or under 3px wide — `bw` is
clamped to a 1px minimum, so an inset hollow body would otherwise collapse to zero width and the
candle would vanish on dense timeframes. Verified across 360–1920px at up to 2000 candles.

## Charts

- One y-axis, never two.
- Crosshair and tooltip on the price chart; the OHLC readout doubles as the hover label.
- Volume is **hidden**, not drawn empty, when the series is an oracle feed with no real volume.
- A timeframe with fewer than two candles is disabled rather than shown blank.
