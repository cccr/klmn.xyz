# adraw "typecloud" pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new adraw pattern, `typecloud`, that fills the page with user-typed text: phrases split on `;`, each set in a different stroke font at a different size, packed into a dense word cloud.

**Architecture:** Patterns are Go code in the engine repo `~/github/abstract_drawing` (`cccr/adraw`), compiled to WebAssembly and copied into klmn.xyz by `make deploy-klmn`. The engine gets a string parameter kind (today every param is a float), an embedded stroke-font package, and the patch itself (mask packing on an occupancy grid, spiral search from the page centre). klmn.xyz then gets a text field in `adraw.js`, which builds its controls from the engine's parameter list.

**Tech Stack:** Go 1.22 (stdlib only, plus the existing `fogleman/delaunay`), WebAssembly, ES5 page script, jsdom/headless-Chrome tests.

**Spec:** `/Users/mart/.claude/plans/twinkly-drifting-wall-of-9ad527d0-21fd-4911-b81f-59bb0b9a3351.md` (approved in conversation: packed word cloud, mask packing, chunks repeat to fill gaps, no rotation).

## Global Constraints

- Engine patches must be deterministic: the same `Request` gives the same `Frame`. Seed a private `*rand.Rand` from `req.Seed`; never use the global source.
- A patch reads all configuration from `req`. Numeric params stay `float64` in `[Min,Max]`; existing numeric behaviour must not change.
- Files under `static/tools/adraw/` other than `adraw.js` and `adraw.css` are build output. Never hand-edit them; run `make deploy-klmn` in the engine repo.
- klmn.xyz page scripts are ES5: `'use strict'`, `var`, function declarations, one IIFE. Nothing loads from a CDN.
- No new CSS unless a text field style is missing. A new shared primitive in `style.css` must also appear on `/design/` in the same commit.
- Text separator is `;`. A literal semicolon is `\;`, a literal backslash is `\\`.
- Fonts are public-domain stroke (Hershey-style) fonts, 3 to 4 of them, embedded as Go data.
- Do not commit or push without the user asking.

## Review Focus

- Empty or whitespace-only text: falls back to a built-in phrase list, never a blank page.
- Text of only separators (`;;;`) or with empty chunks (`a;;b`): empties are dropped.
- Characters missing from a font (emoji, accents, CJK): skipped or substituted, never a crash or a zero-size chunk.
- Very long text (thousands of characters) and a single very long chunk: finishes in bounded time, stays on the page.
- Tiny pages (`10x10 mm`) and extreme sliders (`min` equal to `max`): no infinite loop, returns a valid frame.

---

## Task 1: String parameters in the engine

**Files:**
- Modify: `~/github/abstract_drawing/pkg/patch/param.go`, `pkg/patch/patch.go`, `pkg/patch/patchtest/patchtest.go`, `patches/README.md`
- Test: `pkg/patch/param_test.go`

**Interfaces:**
- Produces:
  - `type ParamKind int` with `KindNumber` (zero value, so every existing spec stays numeric) and `KindText`.
  - `ParamSpec.Kind ParamKind` and `ParamSpec.DefaultText string`.
  - `func (p *ParamSet) Text(key, label, desc, def string) *ParamSet`.
  - `type Strings map[string]string` with `func (s Strings) Get(spec ParamSpec) string` (returns `DefaultText` when the key is absent).
  - `Request.Strings Strings`.

- [ ] **Step 1: Write failing tests** in `param_test.go`: `TestTextParamDefaultsAndOverride` (absent key gives `DefaultText`, present key gives the given value), `TestNumericSpecIsKindNumber` (a spec built with `MM`/`Unit`/`Count` has `Kind == KindNumber`), `TestTextParamIgnoresRangeClamp` (`Get` on a nil `Strings` returns the default).
- [ ] **Step 2: Run** `go test ./pkg/patch/...`. Expected: compile failure, `KindText` undefined.
- [ ] **Step 3: Implement** the types above in `param.go`/`patch.go`. `Strings` is deliberately separate from `Values` so numeric control surfaces (MIDI, CV) can never reach a text param.
- [ ] **Step 4: Extend `patchtest.Verify`** so determinism is checked with `Strings` set when the patch declares a text param. Document rule 3's exception in `patches/README.md`.
- [ ] **Step 5: Run** `go test ./...`. Expected: PASS.

## Task 2: Carry text params through the API

**Files:**
- Modify: `~/github/abstract_drawing/ui/web/api.go` (query loop at ~lines 219-243, the params listing), `ui/web/config.go` (preview values at ~line 48, 176)
- Test: `ui/web/api_test.go`

**Interfaces:**
- Consumes: Task 1 `ParamSpec.Kind`, `Request.Strings`.
- Produces: `/api/patches` JSON includes `"kind": "number" | "text"` and `"defaultText"` per param. `/api/render?...&text=a%3Bb` fills `Request.Strings["text"]`. Unknown keys still error as `patch %q has no parameter %q`.

- [ ] **Step 1: Write failing tests**: `TestRenderPassesTextParam` (a stub text-param patch receives the exact string, including `;` and `\;`), `TestTextParamRejectsNormalizedPrefix` (`n.text=...` is an error), `TestPatchListReportsKind`.
- [ ] **Step 2: Run** `go test ./ui/web/`. Expected: FAIL.
- [ ] **Step 3: Implement.** In the query loop, branch on `specs[lookup].Kind`: text params go to `strings`, skip `ParseFloat`. `config.go` preview gets an optional `Text map[string]string` next to `Values`.
- [ ] **Step 4: Run** `go test ./...`. Expected: PASS, including every existing numeric API test.

## Task 3: Stroke fonts

**Files:**
- Create: `~/github/abstract_drawing/pkg/font/font.go`, `pkg/font/data_*.go` (one per font)
- Test: `pkg/font/font_test.go`

**Interfaces:**
- Produces:
  - `type Font struct{ Name string; ... }` and `var All []*Font` (3 to 4 fonts: simplex, roman, script, gothic, or the nearest public-domain Hershey sets available).
  - `func (f *Font) Layout(text string, size float64) (paths []geom.Polyline, w, h float64)`: strokes for one line at cap height `size` mm, origin at top-left, plus its width and height.
  - Unknown runes are skipped (never panic); a string with no known glyphs returns `w == 0`.

- [ ] **Step 1: Write failing tests**: `TestEveryFontHasASCII` (every printable ASCII rune except space yields at least one stroke), `TestLayoutScalesLinearly` (width at size 20 is twice the width at 10, within 1e-9), `TestUnknownRunesSkipped` (`"a😀b"` equals `"ab"`), `TestLayoutBoundsMatchStrokes` (all points lie within `[0,w]x[0,h]`), `TestFontsDiffer` (the same word gives different stroke data in each font).
- [ ] **Step 2: Run** `go test ./pkg/font/`. Expected: FAIL.
- [ ] **Step 3: Implement** with glyph tables as compact Go literals; check the types in `pkg/geom` for the polyline type before naming it.
- [ ] **Step 4: Run** and expect PASS.

## Task 4: The `typecloud` patch

**Files:**
- Create: `~/github/abstract_drawing/patches/typecloud/typecloud.go`, `split.go`, `pack.go`
- Modify: `patches/patches.go` (one import line)
- Test: `patches/typecloud/typecloud_test.go`, `split_test.go`

**Interfaces:**
- Consumes: Task 1 `Strings`/`Text`, Task 3 `font.All`, `Font.Layout`.
- Produces:
  - `func splitChunks(s string) []string`: split on unescaped `;`, `\;` becomes `;`, `\\` becomes `\`, trim spaces, drop empties.
  - `var defaultText` (a short built-in phrase list, used when `splitChunks` returns nothing).
  - Params: `text` (Text, default `defaultText` joined by `; `), `min` (mm, text height, 3 to 20, default 5), `max` (mm, 10 to 120, default 45), `gap` (mm, 0.5 to 10, default 2), `fill` (0 to 1, default 0.85, target ink-box coverage), `fonts` (Count 1 to 4, default 4).
  - Patch name `typecloud`, with `Description()`.

- [ ] **Step 1: Write failing tests** for the splitter: `"a;b;c"` gives three, `"a\;b"` gives `["a;b"]`, `"a\\;b"` gives `["a\", "b"]`, `";;  ;"` gives none, `" one ; two "` trims.
- [ ] **Step 2: Write failing patch tests**: `TestDeterministic` (same seed and text give identical frames; a different seed differs), `TestAllPathsInsidePage`, `TestNoOverlap` (placed chunk grids, thickened by half of `gap`, never intersect; expose placements to the test through an unexported `place(...)` that returns rects), `TestEmptyTextUsesDefault`, `TestLargestChunkIsLargest`, `TestHugeInputBounded` (5000 chars and a 10x10 mm page both finish under 2 s), `TestMinEqualsMax`, `patchtest.Verify`.
- [ ] **Step 3: Run** `go test ./patches/typecloud/`. Expected: FAIL.
- [ ] **Step 4: Implement** `splitChunks`. Then `pack.go`: an occupancy grid at about 1 mm cells over the page minus border; rasterise a chunk's strokes thickened by `gap/2`; try candidate positions in an outward spiral from the page centre with a bounding-box rejection first; cap candidates per item. Algorithm for `Generate`: seeded rng assigns each chunk a font and a size rank (largest chunk gets `max`); place largest first; if one does not fit, shrink by 10 percent and retry down to `min`; after all chunks are placed, cycle through chunks again at decreasing sizes until `fill` or `min` is reached.
- [ ] **Step 5: Run** `go test ./...` and `go vet ./...`. Expected: PASS.
- [ ] **Step 6: Look at it.** `make wasm && make serve-wasm`, load several seeds with the default text, with `a;b;c`, with one very long chunk, and with `a\;b`. Check it reads as a cloud, nothing touches, nothing leaves the page, and render time is acceptable. If mask packing is too slow at defaults, fall back to bounding-box packing behind the same `place` function.

## Task 5: Gallery entry and engine UI

**Files:**
- Modify: `~/github/abstract_drawing/adraw.json`, `ui/web/static/app.js`

**Interfaces:**
- Consumes: Task 2 `kind`/`defaultText` in the patch list, preview `text`.

- [ ] **Step 1: Add `typecloud`** to `adraw.json` (category `other` unless the user asks for a new one) with a preview seed, values and text.
- [ ] **Step 2: In `app.js`**, render an `<input type="text">` for a `kind: "text"` param and include it in the render query.
- [ ] **Step 3: Verify** in `make serve-wasm`: the field appears, typing redraws, gallery preview renders.

## Task 6: Text field on klmn.xyz

**Files:**
- Modify: `/Users/mart/github/klmn.xyz/static/tools/adraw/adraw.js` (`buildParams` ~195, query building ~243-260, URL restore ~268-290), `themes/klmn-theme/layouts/tools/adraw.html` only if markup is needed
- Test: `test/adraw.test.js`

**Interfaces:**
- Consumes: the `/api/patches` shape from Task 2, via the existing `adrawFetch`.
- Produces: params with `kind === 'text'` render as `<input type="text" data-key="...">` inside the existing `.field` / `.field-value` markup; value goes into the render query and the page URL; restored from `location.search`. Redraw is debounced about 250 ms while typing.

- [ ] **Step 1: Run** `make deploy-klmn` in the engine repo so the wasm knows `typecloud`. Check `git status` here: only the build-output files and nothing else changed.
- [ ] **Step 2: Write failing Chrome tests**: `typecloud shows a text field and no slider for it`, `typing text redraws with more paths for "a;b;c" than "a"`, `text survives a reload through the URL (including an escaped \;)`, `Wiggle handoff still works on typecloud`.
- [ ] **Step 3: Run** `cd test && npm test -- adraw`. Expected: FAIL.
- [ ] **Step 4: Implement** the text branch in `buildParams`, the query string builder and the URL restore. Stay inside the existing IIFE and ES5 style. Check `adraw.css` and `/design/` for an existing text-input style before adding any.
- [ ] **Step 5: Run** `hugo --quiet && cd test && npm test`. Expected: all pass (197 tests plus the new ones).
- [ ] **Step 6: Look at it** in Chrome at `/tools/adraw/`: pick typecloud, type, shuffle, export SVG and G-code, Print preview, Wiggle. Update the adraw entry in `CLAUDE.md` if the pattern list or file list changed.

## Self-review

- Coverage: string param (T1), API (T2), fonts (T3), splitting, escape, default phrases, repeat-to-fill, no rotation, mask packing (T4), gallery and engine UI (T5), site field, URL round-trip, debounce, tests (T6). The open performance risk has its fallback in T4 step 6.
- Types: `Strings`, `ParamKind`, `Font.Layout`, `splitChunks` and `place` are named the same in every task that uses them.
- Order matters: T1 to T4 are in the engine repo and must land (and be deployed) before T6.
