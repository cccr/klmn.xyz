# Dropping Tailwind — migration reference

**Status: done, 2026-09-20.** No page loads Tailwind. The gate, the script and
the test workarounds are all gone.
**Purpose:** the record of why it went and what replaced it. The visual
direction that landed on top of it is in `docs/design/2026-09-20-press-bed.md`.

## Why

Tailwind is loaded from `cdn.tailwindcss.com` as a runtime JIT compiler. On a site this size
(5 pages, 8 layouts) it buys very little and costs concretely:

- **A runtime dependency for static pages.** Body's margin reset came only from Tailwind's
  preflight. With the CDN blocked, `getComputedStyle(document.body).margin` was `8px`, which
  put `mass-qr`'s print output 8px from spilling a blank second page.
- **Specificity fights.** `mass-qr.html` used to open with `[hidden] { display: none !important }`
  purely because Tailwind's `flex` utility beat the `hidden` attribute.
- **Test tax.** `test/harness.js` skips CDN scripts under jsdom, and `test/cdp.js` had to sleep
  2s per page load waiting for Tailwind to rewrite styles — now only on pages that still load it,
  which took the suite from 32s to 13s.
- **Nothing load-bearing.** The parts that matter — the QR sheet grid, the print rules — were
  always hand-written plain CSS.

## What replaced it

1. **`_default/baseof.html` is class-free.** The chrome is styled by
   `style.css` with element selectors.
2. **`style.css` is the site stylesheet** — a trimmed reset, the design
   tokens, the chrome, and the primitives more than one page uses: `.press`,
   `.rail`, `.field`, `.trim`, `.artifact`, `.btn`, `.seg`, `.spec`,
   `.notice`, `.prose`.
3. **`baseof.html` exposes a `head` block**, so each tool links its own
   stylesheet into `<head>`:

   ```
   {{ define "head" }}
   <link rel="stylesheet" href="/tools/<name>/<name>.css">
   {{ end }}
   ```
4. **Every tool's CSS and JS are files** under `static/tools/<name>/`. The
   layouts are markup and link/script tags, nothing else.

During the migration `style.css` had to render identically with and without
Tailwind, since pages converted one at a time and the chrome is shared. That
constraint is retired — nothing loads the CDN any more — but it is why the
reset mirrors preflight rather than contradicting it.

## What it cost, and what it bought

Removed: a runtime JIT compiler on the critical path of every page; a
`[hidden] { display: none !important }` in `mass-qr.html` that existed purely
to beat a `flex` utility; a 2s settle per page load in `test/cdp.js`; and a
branch in `test/harness.js` that silently skipped remote scripts, which is now
a loud error instead, since a remote script would be a mistake.

The suite went from 32s to 13s when the settle went. Body's margin reset no
longer depends on a third-party host being reachable at the moment someone
hits Ctrl-P, which was one blank second page away from mattering.

## Lessons worth keeping

- **A `<style>` block in a layout hides broken CSS.** An unbalanced comment
  marker eats the next rule and nothing anywhere complains. This happened
  twice — once in the original `mass-qr.html`, once while writing the file
  that replaced it. The file caught it in one measurement.
- **The stylesheet owns appearance; the script owns state.** Three tools were
  assembling utility class strings in JS on every repaint. They toggle a state
  class now, which is also how two of them ended up reporting `aria-pressed`
  for the first time.
- **Check every page for sideways scroll, not the one that last broke.** An
  implicit `auto` grid column cannot shrink below its content's minimum, so
  one wide control drags the whole document sideways. It happened on mass-qr
  (a `max-content` fieldset), got a test pinned to that page, then happened
  again on wiggler for a different reason.

## Status

| Page | Layout | Converted |
|---|---|---|
| `/tools/qr/` | `tools/qr.html` | ✅ |
| `/tools/mass-qr/` | `tools/mass-qr.html` | ✅ |
| `/tools/milling/` | `tools/milling.html` | ✅ |
| `/tools/wiggler/` | `tools/wiggler.html` | ✅ |
| `/` and `/tools/` | `_default/list.html` | ✅ |
| single pages | `_default/single.html` | ✅ |

## Conventions settled here

- **Chrome CSS uses semantic selectors**, no invented class names, so it survives the migration
  unchanged.
- **A tool's own CSS and JS live in their own files**, not in `style.css`, and not inline in the
  layout. `mass-qr.html` reached 1068 lines inline and `wiggler.html` 1735; don't let that
  happen again.
- **The stylesheet owns appearance, the script owns state.** No class lists built in JS.
- **No CSS framework replaces Tailwind.** Plain CSS, custom properties for the few shared values.
