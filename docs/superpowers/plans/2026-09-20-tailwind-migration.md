# Dropping Tailwind — migration reference

**Status:** in progress. `qr` and `mass-qr` are off it; `milling`, `wiggler`,
`list.html` and `single.html` still load it.
**Purpose:** reference doc. Pick this up in any future session to convert the next page.

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

## Mechanism

Four moving parts, all already in place:

1. **`themes/klmn-theme/layouts/_default/baseof.html` is class-free.** The header, nav, `main`
   and footer carry no utility classes. Their styling comes from plain CSS. This is shared by
   every page, so it only had to happen once.
2. **`themes/klmn-theme/static/css/style.css` is the site stylesheet.** Already loaded
   site-wide by `head.html`. It holds a trimmed preflight, the chrome, and the few primitives
   more than one page uses (`.hidden`, `.form-label`, `.form-tooltip`).
3. **`themes/klmn-theme/layouts/partials/head.html` gates the Tailwind script** on
   `tailwind: false` in a page's front matter. A page opts out; everything else keeps it.
4. **`baseof.html` exposes a `head` block.** A tool layout opens with

   ```
   {{ define "head" }}
   <link rel="stylesheet" href="/tools/<name>/<name>.css">
   {{ end }}
   ```

   so a page's stylesheet lands in `<head>`, after `style.css`, rather than in the body.

### The one real constraint

`style.css` has to render identically with and without Tailwind, because the migration is
happening a page at a time and the chrome is shared. Two things keep it order-insensitive —
the CDN script injects its styles at runtime, so you cannot rely on being last:

- **The reset mirrors preflight rather than contradicting it.** Same declarations, same values.
  Whichever lands last, the outcome is the same.
- **Chrome selectors are two-deep** (`body > header`, `body > header nav a`), which outranks
  preflight's single-element rules regardless of order.

Verify this after touching `style.css`: measure the chrome on the pages still on Tailwind
(`/`, `/tools/`, `/tools/milling/`, `/tools/wiggler/`) before and after. Every box, colour and
font size should be identical. `test/cdp.js`'s `withPage` + `evalJson` is enough to do it.

## Converting the next page

For `<name>` in `milling`, `wiggler` (and `list.html` / `single.html`, which cover the home
page, the tools index and the markdown pages):

1. Inventory what it uses:
   ```
   grep -o 'class="[^"]*"' themes/klmn-theme/layouts/tools/<name>.html \
     | sed 's/class="//;s/"//' | tr ' ' '\n' | sort -u
   ```
2. Screenshot before, at 1400px and 760px, so the diff is checkable. `test/cdp.js` exports
   `withPage(url, fn)`; the page handle has `setViewport(w, h)` and `screenshot()`.
3. Move the page's CSS into `static/tools/<name>/<name>.css` and its JS into
   `static/tools/<name>/<name>.js`, and link both from the layout — the CSS through the
   `head` block, the JS as a `<script src>` where the inline block was. Do **not** add page
   CSS to `style.css`; that file is chrome and shared primitives only.
4. Replace the utility classes with semantic ones, prefixed `<name>-`.
5. Anything the JS writes as a class list (`el.className = 'px-3 py-1.5 bg-slate-900 …'`)
   becomes a state class the stylesheet interprets — `classList.toggle('is-on', …)`. Keep any
   class name the tests assert on; `.hidden` in particular is now defined in `style.css`.
6. Add `tailwind: false` to the page's front matter.
7. Screenshot after and compare, at both widths. Check the document does not scroll sideways:
   `document.documentElement.scrollWidth <= window.innerWidth` at 1400/900/760/390.
   `min-width: max-content` on a wide flex group is the usual culprit; cap it with
   `min(max-content, 100%)`.
8. Run the suite.

### Done when

Every page carries `tailwind: false`. At that point delete the gate and the script from
`head.html`:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

then drop the CDN-skipping branch in `test/harness.js` and the Tailwind detection in
`test/cdp.js`'s `settle()`.

## Status

| Page | Layout | Converted |
|---|---|---|
| `/tools/qr/` | `tools/qr.html` | ✅ 2026-09-20 |
| `/tools/mass-qr/` | `tools/mass-qr.html` | ✅ 2026-09-20 |
| `/tools/milling/` | `tools/milling.html` | ❌ 327 lines |
| `/tools/wiggler/` | `tools/wiggler.html` | ❌ 1735 lines — split the CSS/JS out while you're in there |
| `/` and `/tools/` | `_default/list.html` | ❌ 6 class attributes, small job |
| single pages | `_default/single.html` | ❌ 1 class attribute, plus `.prose` needs real styles |

## Conventions settled here

- **Chrome CSS uses semantic selectors**, no invented class names, so it survives the migration
  unchanged.
- **A tool's own CSS and JS live in their own files**, not in `style.css`, and not inline in the
  layout. `mass-qr.html` reached 1068 lines inline before this; don't let that happen again.
  The concrete failure mode: an unbalanced comment marker in a `<style>` block silently eats the
  next rule and nothing anywhere complains.
- **The stylesheet owns appearance, the script owns state.** No class lists built in JS.
- **No CSS framework replaces Tailwind.** Plain CSS, custom properties for the few shared values.
