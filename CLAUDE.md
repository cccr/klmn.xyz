# klmn.xyz

A Hugo site of small, single-purpose browser tools, and a few games. No build step beyond
`hugo`, no framework, no runtime dependencies — every tool runs entirely in
the visitor's browser and ships as plain HTML, CSS and ES5-flavoured JS.

```
hugo --quiet          # build to public/
cd test && npm test   # 171 tests: jsdom for behaviour, headless Chrome for layout
```

## Pages and their files

Each tool or game has a **slug**. Its URL, folders and file names all use that
slug. When a request names a page, by slug or by title, start with the files listed
for it below. Most pages use these five places:

| | |
|---|---|
| `content/<section>/<slug>/index.md` | Title, description, `layout:`, URL aliases |
| `themes/klmn-theme/layouts/<section>/<slug>.html` | Markup. A `{{ define "head" }}` block links its stylesheet; `<script>` tags come at the end |
| `static/<section>/<slug>/<slug>.js` | Behaviour |
| `static/<section>/<slug>/<slug>.css` | Styles only this page has (see *Where a style belongs*) |
| `test/<slug>.test.js` | Its own tests, if it has any |

`<section>` is `tools` or `games`. Each entry below lists the full set of files,
including any file that sits outside this pattern or belongs to another page.

### Tools — `/tools/<slug>/`

**`adraw` — Abstract Drawing** · `/tools/adraw/`
Pen-plotter line art (vortex, contour, flow field, hatching), exported as SVG or G-code.
- `content/tools/adraw/index.md`
- `themes/klmn-theme/layouts/tools/adraw.html`
- `static/tools/adraw/adraw.js`, `adraw.css`: the page. This is ordinary site code and is changed here.
- `static/tools/adraw/adraw.wasm`, `wasm_exec.js`, `wasm.js`, `adraw.json`: **build
  output** of adraw (github.com/cccr/adraw), compiled to WebAssembly and
  overwritten by adraw's `make deploy-klmn`. Make changes to them in adraw, not here.
  `adraw.json` decides which pattern a visitor sees first.
- Tests: `test/adraw.test.js`. These run in real Chrome only, because jsdom cannot run the engine.
- Hands off to **wiggler**: the Wiggle button writes `klmn:wiggler-handoff`
  to localStorage and opens `/tools/wiggler/`, which reads it once
  (`wiggler.js`). If you change one side, check the other.

**`mass-qr` — Mass QR Sheet** · `/tools/mass-qr/`, alias `/qrs`
A printable grid of labelled QR codes, sized to fit exactly one page.
- `content/tools/mass-qr/index.md` (the `/qrs` alias; `netlify.toml` also redirects it)
- `themes/klmn-theme/layouts/tools/mass-qr.html`
- `static/tools/mass-qr/mass-qr.js`, `mass-qr.css`: the container-query clamp
  and the `@media print` block were measured so the sheet fits one page. They are not generic.
- Uses two files from **qr**: `static/tools/qr/qrcodegen.js`, `static/tools/qr/qr-render.js`
- Tests: `test/mass-qr.test.js` (jsdom), `test/layout.test.js` (sheet geometry,
  Chrome), `test/print.test.js` (prints as one page, Chrome)
- History: `docs/superpowers/specs/2026-09-19-mass-qr-design.md`,
  `docs/superpowers/specs/2026-09-20-mass-qr-layout-fixes.md`, and the plans with
  the same names in `docs/superpowers/plans/`

**`milling` — CNC Feed & Speed Planner** · `/tools/milling/`
Feeds, speeds, chipload, SFM and DOC/WOC for a cutter, material and machine.
- `content/tools/milling/index.md` (has body text)
- `themes/klmn-theme/layouts/tools/milling.html`
- `static/tools/milling/milling.js`, `milling.css`
- Tests: no test file of its own. `test/design.test.js` checks contrast on its `.field-value` and `.rail-hint`.

**`qr` — QR Code Generator** · `/tools/qr/`, alias `/qr`
Text or URL to a QR code; error correction, size, colours; PNG or SVG download.
- `content/tools/qr/index.md` (the `/qr` alias; `netlify.toml` also redirects it)
- `themes/klmn-theme/layouts/tools/qr.html`
- `static/tools/qr/qr.js`, `qr.css`
- `static/tools/qr/qrcodegen.js`: Project Nayuki's QR library, vendored. Do not edit it.
- `static/tools/qr/qr-render.js`: rendering helpers that **mass-qr** also loads.
  A change here affects both pages, so run both test files.
- Tests: `test/qr.test.js`

**`ripple` — Ripple Edge Profile** · `/tools/ripple/`
A decaying sine-wave edge, exported as a DXF polyline for CNC or laser.
- `content/tools/ripple/index.md` (has body text)
- `themes/klmn-theme/layouts/tools/ripple.html`
- `static/tools/ripple/ripple.js`, `ripple.css`
- Tests: no test file of its own

**`shelf-house` — Shelf House** · `/tools/shelf-house/`
Modular dollhouse rooms stacked into a shelf, tuned one by one, checked in 3D and downloaded as STL.
- `content/tools/shelf-house/index.md`
- `themes/klmn-theme/layouts/tools/shelf-house.html`: markup and the import map
- `static/tools/shelf-house/geometry.js`: **every size and solid, in mm.** It holds
  `ROOM_DEFAULTS`, `PRESETS`, `blockSize`, the room/table/stairs/lift builders,
  `frontProfile` and `toSTL`. Proportions and dimensions are set in this file.
  It is a pure module with no DOM.
- `static/tools/shelf-house/shelf-house.js`: the page. It covers the blocks and their
  settings, the front view and editing on it, the three.js 3D view and the downloads.
  Picking a block unwraps it: its walls' weights and openings, its corners and its card
  (name, colour, sizes, actions) are all out around it on the front view, docked by
  `layoutJig`. The front view is a camera (`look`): picking zooms to fit the block and
  every panel, opening an opening's tile keeps that zoom and only slides to the wall,
  and by hand it is − + fit, pinch or Ctrl+scroll, and dragging empty paper. While a tile
  is open, a press anywhere else only closes it, and while a field in it has focus the
  camera holds still. Panels are placed by script and measured
  at once, so nothing that sets where they are may have a transition.
- `static/tools/shelf-house/shelf-house.css`
- `static/tools/shelf-house/vendor/`: `three.module.js`, `OrbitControls.js`,
  `manifold.js` + `manifold.wasm`, `fflate.js`, all at pinned versions. Do not edit
  them. To upgrade one, replace the file with the same path from its npm package.
- Tests: `test/shelf-house.test.js`. It imports `geometry.js` and the vendored
  manifold directly under node, and drives the page in Chrome at 1400 wide with
  motion off, so the camera lands where it is going at once.
- History: `docs/superpowers/specs/2026-10-21-shelf-house-unwrap-design.md`, and
  `/notes/shelf-house-opening-tile/`, which measures six ways of fitting an opening's
  tile; the one built is "keep the zoom, shaped tile".
- It is the one page written as ES modules, because three.js and manifold-3d ship only
  as modules. The import map in the layout resolves them, so still nothing
  loads from a CDN. Without WebGL the 3D pane shows a notice and the rest of the
  page keeps working. Headless Chrome in the tests sees that notice too.

**`wiggler` — SVG Wiggle Animator** · `/tools/wiggler/`
Animates an uploaded SVG with a hand-drawn wiggle, exported as GIF or WebM.
- `content/tools/wiggler/index.md`
- `themes/klmn-theme/layouts/tools/wiggler.html`. It adds a `<script>` for every
  file in `examples/` through `readDir`.
- `static/tools/wiggler/wiggler.js`, `wiggler.css`
- `static/tools/wiggler/wiggler-examples.js`: the example picker (`WigglerExamples`)
- `static/tools/wiggler/examples/*.js`: one file per example set. Each file
  calls `WigglerExamples.register`. To add a set, add a file; no other change is needed.
- Receives drawings from **adraw** through `klmn:wiggler-handoff` (see adraw)
- Tests: no test file of its own. The handoff is tested in `test/adraw.test.js`.

### Games — `/games/<slug>/`

**`11dots` — 11 Dots** · `/games/11dots/`
Swap three stones across an eleven-dot board against an exact solver.
- `content/games/11dots/index.md`
- `themes/klmn-theme/layouts/games/11dots.html`
- `static/games/11dots/11dots.js`: the engine and the retrograde solver, which are pure and
  exposed as `window.elevenDots`, followed by the UI
- `static/games/11dots/11dots.css`
- Tests: `test/11dots.test.js`

### Not a tool: the design system — `/design/`
- `content/design/index.md`
- `themes/klmn-theme/layouts/design/design.html`: one specimen for every token and component
- `static/design/design.css`: styles only its own `ds-` scaffolding
- `static/design/design.js`: reads each printed value back from `style.css`
- Tests: `test/design.test.js`

### Not a tool: notes — `/notes/<slug>/`
Design write-ups kept on the site so they can be shared by direct link. Like
`/design/` they are unlisted: `content/notes/_index.md` renders no section page,
each note has `_build: list: never` and a noindex meta, and `test/notes.test.js`
checks that nothing on the site leads to them.

**`shelf-house-opening-tile` — Where an opening's settings go** · `/notes/shelf-house-opening-tile/`
Six ways to fit an opening's settings panel beside an unwrapped Shelf House room,
measured on a working mock-up of the front view and ranked.
- `content/notes/shelf-house-opening-tile/index.md`
- `themes/klmn-theme/layouts/notes/shelf-house-opening-tile.html`
- `static/notes/shelf-house-opening-tile/shelf-house-opening-tile.js`, `.css`: the
  mock-up is self-contained and does not load shelf-house's code. Every number
  on the page is measured from it once the web fonts have loaded.
- Tests: `test/notes.test.js`, and its URL is in `test/layout.test.js`

### Shared by every page

- `themes/klmn-theme/static/css/style.css`: tokens and every shared primitive (see below)
- `themes/klmn-theme/layouts/_default/baseof.html` (site chrome, class-free),
  `list.html` (the `/tools/` and `/games/` lists, and the home page, which lists both
  sections by title), `single.html`
- `themes/klmn-theme/layouts/partials/head.html`: fonts and `style.css`
- `content/_index.md` (home page text), `content/tools/_index.html`, `content/games/_index.html`
- `hugo.toml` (menu), `netlify.toml` (build, Hugo version, the `/qr` and `/qrs` redirects)
- `test/harness.js`: builds with Hugo and loads a page in jsdom. `test/cdp.js`:
  the headless Chrome driver for layout tests. `test/safari.js`: a
  WebDriver client for Safari, which `npm test` does not run.
- `test/layout.test.js` checks that **no page scrolls sideways**, at four
  widths, and has a list of every URL it checks.

**Adding a page:** create the five places above. Then add its URL to the list in
`test/layout.test.js`, and add an entry to this section. The section list and the home page
pick it up without any other change.

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
  declarations, wrapped in an IIFE. No bundler, no modules — except
  shelf-house (see its entry above).
- `baseof.html` is deliberately class-free; the chrome is styled with element
  selectors.
- Nothing loads from a CDN. `test/harness.js` throws on a remote `<script>`,
  and a test asserts no third-party host is needed.
- `@page` may set `margin` but never `size` — WebKit ignores the size
  descriptor, which is what broke printing in Safari.
