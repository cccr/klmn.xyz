# mass-qr — printable QR sheet builder

**Status:** drafted from brainstorming; awaiting review
**Date:** 2026-09-19

## Context

`/tools/qr/` makes one QR code at a time. The need here is different: a single sheet of paper
carrying several codes, each labelled with where it leads, pinned to a cork board next to the
other notices.

The driving example is a school board — four links (schedule, lunch, portal, news), each a code
with a caption, printed on one page. Whoever walks past scans the one they want.

The finished product is the printed page, not the screen. Everything below follows from that:
the editor shows a real page at real size, and Print produces exactly that page with no
browser chrome, no controls, and no second sheet.

## Goals

- Place QR codes into a grid of chosen size, filling the cells you want and leaving others blank.
- Give each code a label and an optional description.
- Print straight from the browser to a clean one-page sheet.
- Reopen or share a sheet via its URL.

## Non-goals

- No backend, no accounts, no stored sheets.
- No per-tile styling, no logos, no tile borders (decided against — tiles print frameless).
- No sheet title, subtitle, or footer (decided against — the grid is the whole page).
- No multi-page sheets. A sheet is one page by construction.
- No bulk/CSV import. Sheets are a handful of links, typed in.

## Decisions

Settled during brainstorming, recorded so they don't get relitigated:

| Decision | Choice | Why |
|---|---|---|
| Persistence | URL hash + localStorage | Shareable and bookmarkable, survives a tab close, no backend |
| Layout model | Explicit grid, cells filled individually | Deliberate blanks are useful; matches how the sheet is imagined |
| Print sizing | Fit exactly one page | A poster is one page; removes all page-break surprises |
| Tile content | Label + optional description | Blank descriptions collapse, so simple sheets stay simple |
| Sheet chrome | None | Maximum room for codes |
| Global controls | Caption position/size, ECC, colors | Paper size and orientation are required by fit-to-page |
| Editing | Strictly inline in the cell | Purest WYSIWYG; cramping mitigated by zoom + edit-mode overlay |
| QR rendering | Shared SVG renderer | Vector prints at printer resolution; one implementation, no drift |

## Architecture

### Routing

Mirrors the existing tool pattern exactly:

- `content/tools/mass-qr/index.md` — front matter only: `title`, `description`,
  `layout: mass-qr`, `aliases: [/qrs]`
- `themes/klmn-theme/layouts/tools/mass-qr.html` — markup, CSS and JS inline
- `netlify.toml` — a forced 301 from `/qrs` to `/tools/mass-qr/`, alongside the existing `/qr`
  rule. `force = true` is required or the Hugo alias file shadows it.

### State

A single object, short-keyed to keep URLs short:

```js
{
  v: 1,                    // schema version, for future migrations
  cols: 3, rows: 2,
  paper: 'a4',             // 'a4' | 'letter'
  orient: 'p',             // 'p' | 'l'
  ecc: 'Q',                // 'L' | 'M' | 'Q' | 'H'
  capPos: 'above',         // 'above' | 'below'
  capSize: 'm',            // 's' | 'm' | 'l'
  fg: '#000000',
  bg: '#ffffff',
  tiles: {                 // sparse — absent key means empty cell
    "0,0": { u: "https://school.edu/schedule", l: "Schedule", d: "Bell times" }
  }
}
```

Tiles keyed `"row,col"`. Sparseness is what makes deliberate blanks free rather than a special
case.

**Defaults** for a fresh sheet: 2×2, A4 portrait, ECC `Q` (a poster gets handled and thumbtacked),
caption above at medium, black on white.

**Caption sizes** are concrete millimetres, not relative units, so they hold at any grid density:
`s` = 3mm label / 2.2mm description, `m` = 4mm / 2.8mm, `l` = 5.5mm / 3.6mm.

**Serialization.** JSON → UTF-8 bytes → base64url, written to `location.hash` as `#s=…` with
`history.replaceState` on a ~300ms debounce, and mirrored to `localStorage` on every change.

`btoa` throws on any character above U+00FF, so a Cyrillic or emoji label would break the link.
Encoding must go through `TextEncoder`/`TextDecoder`:

```js
const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
```

**Load order:** hash, then localStorage, then a default empty 2×2. A malformed or
wrong-version hash falls back rather than throwing.

### Layout

The sheet is a `<div>` sized in real `mm` — 210×297 for A4 portrait — with `padding: 10mm` for
the margin. Inside it, CSS grid: `repeat(cols, 1fr)` × `repeat(rows, 1fr)`, `gap: 4mm`.

Each tile is a flex column holding a caption block (sized by content) and a QR box (taking the
remainder). The QR is an SVG with default `preserveAspectRatio`, so it letterboxes into whatever
box the grid gives it and stays square.

**There is no JavaScript layout math.** The grid engine does the fitting, and the same rules
drive screen and paper. This is the property that makes one-page fit reliable instead of
something to keep patching; preserve it.

Screen zoom (Fit / 100% / 150%) is a `transform: scale()` on a wrapper only. It never touches
the sheet's real dimensions, so the 100% preview is true-to-scale.

### Editing

Empty cells show a `+`. Clicking any cell turns it into three stacked fields — URL, label,
description — plus Done and Delete. Clicking away commits.

On a dense grid a cell is around 45mm (~170px), which is tight for three inputs. Two
mitigations:

1. The zoom control.
2. A cell in edit mode takes `min-width: 220px` and overlays its neighbours. The sheet
   underneath does not reflow; only the editing cell floats above it.

Shrinking `rows`/`cols` past filled cells prompts first — "Removing this row deletes 2 tiles.
Continue?" — rather than silently discarding work.

### Print

`@media print` in the tool's own stylesheet:

- hides the control strip;
- hides the site chrome via `body > header, body > footer` — the theme's `baseof.html` is not
  modified;
- resets zoom to 1 and drops shadows and editor-only cell outlines.

A dedicated `<style id="pageRule">` element carries `@page { size: … }`, rewritten when paper or
orientation changes.

### Shared renderer

`toSvgString` moves from the QR tool into `static/tools/qr/qr-render.js`, loaded by both pages.
The single-code tool keeps its canvas path for PNG export; only the SVG function is shared.

This is a behaviour-neutral extraction. The QR tool's existing 49-check suite must pass
unchanged afterwards.

## Files

| File | Change |
|---|---|
| `content/tools/mass-qr/index.md` | new |
| `themes/klmn-theme/layouts/tools/mass-qr.html` | new |
| `static/tools/qr/qr-render.js` | new — extracted `toSvgString` |
| `themes/klmn-theme/layouts/tools/qr.html` | edit — use the shared renderer |
| `netlify.toml` | edit — `/qrs` redirect |
| `content/_index.md` | edit — homepage link |

## Verification

1. **Unit/DOM** — extend the jsdom + jsQR harness used for the QR tool: decode *every* tile on a
   rendered sheet, not just one.
2. **State round-trip** — encode → decode returns an identical object, including Cyrillic and
   emoji labels. A truncated or garbage hash falls back to default instead of throwing.
3. **Grid edits** — filling, clearing, and shrinking past filled cells (confirm path).
4. **Regression** — the QR tool's 49 checks still pass after the renderer extraction.
5. **Print, end to end** — headless Chrome `--print-to-pdf`, rasterize with `sips`, decode the
   codes out of the resulting PDF. This is the test that matters: it proves one page, correct
   physical size, and every code still scannable through the real print pipeline.
6. **Visual** — headless screenshots at desktop and narrow widths, as with the QR tool.

## Open questions

- **Name.** `/tools/mass-qr/` + `/qrs` follows the working title. Worth a second thought before
  the URL is public.
- **Edit-mode overlay.** Specified to overflow its cell at `min-width: 220px`. The alternative is
  never overflowing and simply getting cramped at high density.
