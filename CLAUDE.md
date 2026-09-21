# klmn.xyz

A Hugo site of small, single-purpose browser tools. No build step beyond
`hugo`, no framework, no runtime dependencies — every tool runs entirely in
the visitor's browser and ships as plain HTML, CSS and ES5-flavoured JS.

```
hugo --quiet          # build to public/
cd test && npm test   # 82 tests: jsdom for behaviour, headless Chrome for layout
```

## The design system is at /design/

**Read <https://klmn.xyz/design/> — or `public/design/index.html` after a
build — before changing anything visual.** It renders every token and every
shared component live, from the same stylesheet the tools load. It is
unlisted: no menu entry, no sitemap, `noindex`, reachable only by direct
link. That is deliberate, and `test/design.test.js` keeps it that way.

It is the single source of truth in a literal sense, not an aspirational one:

- **Change a value in `themes/klmn-theme/static/css/style.css` and every tool
  changes with it.** There is no per-tool copy of a button, a field or a
  colour to keep in step.
- **Design feedback belongs on that page**, against a component you can point
  at, rather than scattered across four tool pages.
- **Three tests enforce it** — every class and every `:root` token in
  `style.css` has to appear on `/design/`; `static/design/design.css` may not
  style anything outside its own `ds-` namespace. Add a shared primitive
  without documenting it and the suite goes red in the same commit.

### Where a style belongs

| | |
|---|---|
| `themes/klmn-theme/static/css/style.css` | Tokens, reset, site chrome, and every shared primitive. Loaded by every page. Anything added here must appear on `/design/` in the same commit. |
| `static/tools/<name>/<name>.css` | What only that tool has — the QR paper, the sheet grid and its print rules, the recipe table, the example picker, the canvas. |

When a second tool wants something that lives in one tool's file, **move it
up — never copy it.** Two copies of a button diverge within a month, and the
design system stops being true the first time they do.

Geometry that was measured into place stays down with its tool. `mass-qr.css`
looks generic in places and is not: its container-query clamp and its
`@media print` block are load-bearing for one page coming out on one sheet of
paper.

## Visual direction

The "press bed": off-white bench, controls on a rail, the thing you are about
to print or export sitting on paper under registration marks. Reasoning and
history in `docs/design/2026-09-20-press-bed.md`.

Two constraints that came from rejected work, so they do not get re-proposed:

- **The site stays off-white.** A dark press-green bed was built and rejected.
- **No warm cream (~`#F4F1EA`) with a terracotta accent.** It is the most
  recognisable generated-design tell there is.

## Conventions

- Page scripts are browser-ready ES5: `'use strict'`, `var`, function
  declarations, wrapped in an IIFE. No bundler, no modules.
- A tool page is a layout in `themes/klmn-theme/layouts/tools/<name>.html`
  with a `{{ define "head" }}` block linking its own stylesheet, plus files
  under `static/tools/<name>/`.
- `baseof.html` is deliberately class-free; the chrome is styled with element
  selectors.
- Nothing loads from a CDN. `test/harness.js` throws on a remote `<script>`,
  and a test asserts no third-party host is needed.
- `@page` may set `margin` but never `size` — WebKit ignores the size
  descriptor, which is what broke printing in Safari.
