# Dropping Tailwind — migration reference

**Status:** in progress. `qr` and `mass-qr` converted 2026-09-20; `milling`, `wiggler`,
`list.html` still on Tailwind.
**Purpose:** reference doc. Pick this up in any future session to convert the next page.

## Why

Tailwind is loaded from `cdn.tailwindcss.com` as a runtime JIT compiler. On a site this size
(5 pages, 8 layouts) it buys very little and costs concretely:

- **A runtime dependency for static pages.** Body's margin reset comes only from Tailwind's
  preflight. With the CDN blocked, `getComputedStyle(document.body).margin` is `8px`, which
  put `mass-qr`'s print output 8px from spilling a blank second page.
- **Specificity fights.** `mass-qr.html` opens with `[hidden] { display: none !important }`
  purely because Tailwind's `flex` utility beat the `hidden` attribute.
- **Test tax.** `test/harness.js` must skip CDN scripts under jsdom, and `test/cdp.js` sleeps
  2s per page load waiting for Tailwind to rewrite styles.
- **Nothing load-bearing.** The parts that matter — the QR sheet grid, the print rules — were
  always hand-written plain CSS.

## Mechanism

Three moving parts, already in place:

1. **`themes/klmn-theme/layouts/_default/baseof.html` is class-free.** The header, nav, `main`
   and footer carry no utility classes. Their styling comes from plain CSS. This is shared by
   every page, so it only had to happen once.
2. **`themes/klmn-theme/static/css/style.css` is the site stylesheet.** Already loaded
   site-wide by `head.html`. Chrome rules use semantic selectors (`body > header`, not invented
   class names), so nothing has to be rewritten as more pages convert.
3. **`themes/klmn-theme/layouts/partials/head.html` gates the Tailwind script** on a front-matter
   flag. A page opts out; everything else keeps loading it.

Because baseof is already class-free and styled by real CSS, **converting a page only means
that page's own markup**. No shared work remains.

## Converting the next page

For `<name>` in `milling`, `wiggler` (and `list.html`, which covers the home page and the
tools index):

1. Inventory what it uses:
   ```
   grep -o 'class="[^"]*"' themes/klmn-theme/layouts/tools/<name>.html \
     | sed 's/class="//;s/"//' | tr ' ' '\n' | sort -u
   ```
2. Screenshot before, at 1400px and 760px, so the diff is checkable:
   ```
   cd test && node -e "require('./cdp').withSheet" # see test/cdp.js: withPage/screenshot
   ```
3. Write the page's CSS into its own file under `static/tools/<name>/<name>.css` and link it
   from the layout. Do **not** add it to `style.css` — that file is for chrome and shared
   primitives only.
4. Replace the classes with semantic ones. Keep `.form-label` / `.form-tooltip`; they already
   live in `style.css` and predate this work.
5. Add `tailwind: false` to `content/tools/<name>/index.md` front matter.
6. Screenshot after; compare. Check both widths and print.

### Done when

Every page carries `tailwind: false`. At that point delete the gate and the script from
`head.html`:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

and drop the CDN-skipping branch in `test/harness.js` and the 2s settle in `test/cdp.js`.

## Status

| Page | Layout | Converted |
|---|---|---|
| `/tools/qr/` | `tools/qr.html` | ✅ 2026-09-20 |
| `/tools/mass-qr/` | `tools/mass-qr.html` | ✅ 2026-09-20 |
| `/tools/milling/` | `tools/milling.html` | ❌ |
| `/tools/wiggler/` | `tools/wiggler.html` | ❌ 1735 lines — split the CSS/JS out while you're in there |
| `/` and `/tools/` | `_default/list.html` | ❌ 6 class attributes, small job |
| single pages | `_default/single.html` | ❌ 1 class attribute |

## Conventions settled here

- **Chrome CSS uses semantic selectors**, no invented class names, so it survives the migration
  unchanged.
- **A tool's own CSS lives in its own file**, not in `style.css`, and not inline in the layout.
  `mass-qr.html` reached 1068 lines inline before this; don't let that happen again.
- **No CSS framework replaces Tailwind.** Plain CSS, custom properties for the few shared
  values.
