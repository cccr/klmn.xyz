# mass-qr — layout, print and control fixes

**Status:** drafted from a measured review of the shipped tool
**Date:** 2026-09-20
**Supersedes nothing.** Amends `2026-09-19-mass-qr-design.md`, which stays the design of record.

## Context

`/tools/mass-qr/` shipped in `26e5d57`. Driving the built page in headless Chrome and
measuring real boxes (not jsdom, which has no layout engine) turned up one structural
layout fault and a set of smaller ones. Every number below is measured, not estimated.

## Measured findings

### F1 — Codes in the same row do not line up

On a 2×2 A4 sheet every cell measures 351.5 × 515.9px. `.code` is `flex: 1 1 auto`, so its
height is whatever the caption leaves, and the SVG is pinned to the caption edge
(`preserveAspectRatio: xMidYMin` / `xMidYMax`).

| tile | caption | `.code` height | QR top offset |
|---|---|---|---|
| `0,0` Schedule + "Bell times" | 38.5px | 477.4px | +15.8px |
| `0,1` Lunch | 22.7px | 493.2px | 0 |

**15.8px ≈ 4.2mm** of vertical misalignment between two tiles in one row, caused purely by
one of them carrying a description. With `capPos: below` the captions go ragged instead —
measured tops 464.3px vs 484.8px, **20.5px ≈ 5.4mm** apart.

### F2 — A third of the page is dead space, collected in one band

The QR is width-constrained (351.5px) inside a 515.9px-tall box, so each cell wastes
164px ≈ 43mm below its code, and `xMidYMin` pools all of it at the bottom. Over two rows
that is ~87mm of 277mm usable height (31%). The column gutter is 4mm while the effective
row gutter is ~47mm.

The page copy — "Codes resize to fill the sheet" — is false; they fill the width only.

### F3 — Long labels overflow the cell

`.cap` has `max-width: 100%` but no `overflow-wrap`, and `.cell` has no `overflow`.
`Supercalifragilisticexpialidocious` at 4mm renders wider than its column and bleeds into
the gutter. At three columns or more it overlaps the neighbouring caption.

### F4 — Caption text ignores `fg`

`fg` reaches only the SVG `<path>`. With `bg: #0f172a` the captions render in the theme's
`#0f172a`-ish slate and are invisible — on screen and on paper.

### F5 — "Link too long" is unstyled and prints

`className = 'code too-long'` is set but no rule for `.too-long` or `.error` exists.
Measured: `color: rgb(30,41,59)`, `font-size: 16px`, `text-align: start`, rendered at the
top-left of a 351×493 box and overhanging the sheet padding. Nothing in `@media print`
suppresses it, so a broken sheet reaches paper looking like a typo.

### F6 — No guard tying grid density to paper size

Custom 50 × 50mm at 6×6: 10mm padding a side leaves 30mm; five 4mm gutters eat 20mm;
**10mm is left for six columns**. Margin (`padding: 10mm`) and gutter (`gap: 4mm`) are
hardcoded, so the user cannot recover from this.

### F7 — Fit-zoom reserves a phantom page

`transform: scale()` does not affect layout. At a 600px viewport the sheet scales to 0.705
and renders 792px tall while `#sheetWrap` still reserves **1155px** — 363px of blank scroll
below the sheet — and `scrollWidth` stays 794 against a `clientWidth` of 560, giving a
phantom horizontal scrollbar.

### F8 — Print resets are incomplete

Body margin comes only from Tailwind's CDN preflight. With `cdn.tailwindcss.com` blocked,
`getComputedStyle(document.body).margin` measures `8px`. It survives today only because the
overflowing 8px carries no content — 8px from a second blank page, on a dependency the site
does not control. Nothing tells the user their print dialog must match the sheet's paper
size and use 100% scale, without which Chrome silently rescales physical millimetres.

### F9 — Control-strip and editor gaps

Twelve controls in one `flex-wrap` row with no grouping; selecting Custom injects three more
fields and pushes Print into the middle of row two. `Code` / `Background` do not read as
colour pickers; `Caption` is really caption *position*. Zoom is the only setting not in
`state`, so it resets on reload while everything else persists, and it is width-only.
Measured: Escape and Enter in the editor both do nothing. `paperDims` swaps custom
width/height under landscape while the fields keep their original labels.

### F10 — Parity gap with `/tools/qr/`

`qr.html:215-301` has a tested contrast guard *and* a sub-4-module quiet-zone warning.
mass-qr has neither, despite exposing both footguns (`qz` down to 0, unconstrained `fg`/`bg`)
and printing up to 36 codes at once. The comment at `mass-qr.html:431-433` still claims the
4-module quiet zone is enforced, which the control has not done since `3a8b9fb`.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Caption band | One measured height for the whole sheet, set as `--cap-h` on `#grid` | Makes every `.code` box identical — the direct fix for F1 |
| Slack distribution | Centre the code in its cell (`xMidYMid`) | Splits slack evenly above and below every code; even rhythm without restructuring the grid |
| Caption band height | Measured from the tallest rendered caption, with an mm formula as fallback | Wrapping is only knowable after layout; the fallback keeps jsdom and hidden sheets sane |
| Caption colour | Inherit `fg` | The code colour is the ink colour; one control, no new state |
| Caption overflow | `overflow-wrap: anywhere` + clamp label to 2 lines, description to 1 | Bounded caption band, no neighbour overlap |
| Margin and gutter | New state fields `mg` (default 10mm) and `gp` (default 4mm) | The real lever on F2/F6, and the only way out of the 50mm case |
| Density guard | Warn below 12mm per cell | Under ~12mm most phone cameras cannot scan |
| Zoom | Move into `state`, add "Fit page", size a `#sheetBox` to the scaled dimensions | Persistence parity with every other control; kills F7's phantom scroll area |
| Error tiles | Styled, centred, red, dashed — and still printed | A visibly broken tile beats a silent one; hiding it would print a blank cell |
| Contrast / quiet-zone warnings | Move `luminance`/`contrastNote` into `qr-render.js`, consume from both tools | `qr-render.js` is the established shared layer; the logic is already tested |
| `MAX` rows/cols | Unchanged at 6 | Raising it is a feature, not a fix — out of scope here |

## Non-goals

- No change to the state schema version (`v: 1`). New fields are additive and `normalize()`
  already supplies defaults for anything absent, so old links keep working.
- No multi-page sheets, no per-tile styling, no CSV import — all still out per the original spec.
- No redesign of the editor overlay; measured at 220 × 162px over a 107px cell at 6×6,
  not clipped and not escaping the sheet.

## Verification

Layout claims cannot be tested in jsdom — it has no layout engine, which is why F1, F2 and
F7 shipped green. This work adds a CDP-driven Chrome harness (`test/cdp.js`) and asserts on
real measured boxes. Existing suites must stay green: 66 tests currently pass.

## Verified after implementation

Re-measured on the finished tool, same sheet as F1 (2×2 A4, tiles `0,0` and `1,1` carrying
descriptions, `0,1` and `1,0` not):

| tile | `.code` height | code size | code top |
|---|---|---|---|
| `0,0` Schedule + "Bell times" | 482.9px | 351.5px | 609.8px |
| `0,1` Lunch | 482.9px | 351.5px | 609.8px |
| `1,0` Portal | 482.9px | 351.5px | 1140.8px |
| `1,1` News + "Weekly newsletter" | 482.9px | 351.5px | 1140.8px |

Every code box is one height, every code is one size, and codes in a row share a top edge
exactly — against 15.8px (4.2mm) of drift before. Slack is split evenly above and below each
code rather than pooled at the bottom of the cell.

**Suite: 101 tests, 101 pass, 0 fail** (66 before this work). The new `test/layout.test.js`
carries 10 measured-layout tests that jsdom structurally cannot make; `test/print.test.js`
gained the Tailwind-blocked one-page case.

One note on method: the first cut of the layout tests passed while the sheet printed blank —
a grid collapsed to zero satisfies "every code box is the same height" perfectly. Only the
pre-existing print test caught it. Every sameness assertion now runs `assertSubstantial()`
first, which requires a real, non-zero code before comparing anything.
