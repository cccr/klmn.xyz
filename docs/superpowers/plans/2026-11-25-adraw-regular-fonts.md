# adraw typecloud: regular fonts and a PNG renderer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `typecloud` can set its chunks in ordinary bundled typefaces, drawn as solid letters in a PNG, while the line fonts stay as they are. Solid letters cannot be plotted as lines, so the PNG is the output for this mode. SVG and G-code still work and give the letter outlines.

**Architecture (decided with the user):** everything stays in the Go engine (`~/github/abstract_drawing`). Bundled open-licence TTFs are parsed with `golang.org/x/image` (v0.47.0 is already in the module cache) into closed glyph contours. The existing grid packer places them, but their mask is the *filled* letter shape, so small words nest in the gaps. Placed glyph contours go into the frame as closed `Path`s flagged `Fill`. A new `png` renderer fills `Fill` paths and draws other paths as thin lines. The page preview fills the same paths on its canvas.

*Refinement of the approved plan:* the approved version returned text placements (font, size, position). Filled contours as paths do the same job with no font files in the browser, no font metrics to keep in step, and no new Frame concept except one flag.

**Tech Stack:** Go 1.22 + `golang.org/x/image` (`font/sfnt`, `vector`), `go:embed`, ES5 page script, Chrome tests.

**Spec:** this file (the approach was chosen in conversation: bundled fonts, in the engine, PNG output; line fonts kept).

## Global Constraints

- Same as the typecloud plan: deterministic per seed, ES5 page script, no CDN, no new CSS unless needed, do not commit or push or run `make deploy-klmn` without being asked.
- Fonts must be open-licence (OFL or similar). Ship each licence file next to its font, and list the fonts and licences in `pkg/outlinefont/README.md`.
- `golang.org/x/image` is the only new dependency.
- Existing numeric behaviour, existing patterns and the line-font mode of `typecloud` must not change (same seeds draw the same).
- SVG and G-code treat a `Fill` path as an ordinary closed path.

## Review Focus

- Characters a font lacks (Cyrillic, CJK, emoji, accents): skipped, never a crash or a blank page.
- Huge pages for PNG (2000x2000 mm): pixel size is capped, no out-of-memory.
- Glyphs with holes (o, e, 8, B, a) and overlapping contours: counters stay open (even-odd fill) in the PNG and the preview, and the mask treats the hole as part of the letter.
- Wasm size and first draw time with the fonts embedded; PNG encode time in the browser.
- A font file that fails to parse: the mode falls back to line fonts rather than failing the draw.

---

## Task 1: `Fill` flag on paths, carried everywhere

**Files:** Modify `pkg/drawing/frame.go`, `pkg/optimize/*.go` (wherever paths are copied, reordered or reversed), `ui/web/api.go` (`FrameJSON`), tests beside each.

**Interfaces:** Produces `Path.Fill bool` (meaning: closed, solid; ignored by plotters) and `FrameJSON.Fill []bool` (parallel to `Paths`, always present).

- [ ] **Step 1: failing tests:** `TestReorderKeepsFill` (a frame with filled and unfilled paths keeps each path's flag after `optimize.Reorder`, even when a path is reversed), `TestRenderJSONReportsFill` in `ui/web/api_test.go` (a stub patch with one filled path gives `fill: [true, false]`).
- [ ] **Step 2:** run, expect FAIL (compile error: no field `Fill`).
- [ ] **Step 3: implement** the field and its plumbing. Existing renderers ignore it.
- [ ] **Step 4:** `go test ./...` PASS.

## Task 2: Bundled typefaces (`pkg/outlinefont`)

**Files:** Create `pkg/outlinefont/outlinefont.go`, `pkg/outlinefont/fonts/*.ttf` with a licence file each, `pkg/outlinefont/README.md`; test `outlinefont_test.go`.

**Interfaces:** Produces
- `type Font struct{ Name string; ... }`, `var All []*Font` (6 faces covering serif, sans, slab, script, display, mono; chosen at implementation from OFL sources, each at most about 400 KB; subset to Latin if needed).
- `func (f *Font) Layout(text string, size float64) (paths []drawing.Path, w, h float64)`: same contract as `font.Font.Layout` (cap height = `size` mm, origin top-left, every point inside `[0,w]x[0,h]`), but every path is a closed glyph contour with `Fill: true`. Curves are flattened to segments at most 0.1 mm off.
- Unknown runes skipped; no glyphs gives `w == 0`.
- Fonts are parsed lazily on first use; a font that fails to parse is dropped from `All`.

- [ ] **Step 1: failing tests:** `TestSixFacesWithLicences` (names distinct, `README.md` mentions each), `TestLayoutScalesLinearly`, `TestCapHeightIsSize` (an "H" is the requested height ±5%), `TestLayoutBoundsMatchContours`, `TestUnknownRunesSkipped`, `TestCountersAreSeparateContours` ("o" has 2 contours, "B" has 3), `TestLatin1Covered` ("é", "ß" give contours in every face).
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** download fonts, add licences, implement with `sfnt.Font.LoadGlyph` and a cubic/quadratic flattener.
- [ ] **Step 4:** PASS. Record the size added to `adraw.wasm` in the ledger.

## Task 3: Solid-shape packing in `typecloud`

**Files:** Modify `patches/typecloud/typecloud.go`, `pack.go`; tests in `typecloud_test.go`.

**Interfaces:** Consumes Task 2's `outlinefont.Font.Layout`. Produces
- New parameter `style` (`Count`, 0 to 1, default 0): `0` line fonts (today), `1` regular fonts. Description: "0 single-line plotter fonts, 1 regular solid fonts (draw as PNG; SVG and G-code give outlines)."
- `type typeface interface{ Layout(string, float64) ([]drawing.Path, float64, float64) }`, satisfied by `*font.Font` and `*outlinefont.Font`; `placement.font` becomes `typeface` plus a `name string`.
- `func rasteriseFilled(paths []drawing.Path, cell, radius float64) mask`: fills the contours with the even-odd rule on the grid, then adds the same outline-stamped dilation as `rasterise`, so the gap guarantee holds for solid shapes too.

- [ ] **Step 1: failing tests:** `TestStyleOneUsesRegularFontsAndFillsPaths` (all emitted paths closed, `Fill` true, fonts from `outlinefont.All`), `TestStyleZeroUnchanged` (same seed, same paths as before this task: store a hash of today's output), `TestSolidShapesKeepGap` (the exact-gap check from `TestGapHoldsOnLargePages`, on solid masks), `TestSmallWordsNestInCounters`-style check kept modest: `TestStyleOnePacksDenserThanBoxes` (placed ink area / page area above 0.35 at default settings), `TestFallsBackWhenNoRegularFonts`, plus the conformance suite for `style=1` (`patchtest` runs with a `Values{"style":1}` variant: add an optional per-patch list of extra value sets to `Verify`).
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** implement `rasteriseFilled` (scanline even-odd into the chunk's bitmap), the interface, the `style` switch. Keep the line-font path byte-for-byte as it is.
- [ ] **Step 4:** PASS, then render seeds 1 to 3 to PNG by eye after Task 4.

## Task 4: `png` renderer

**Files:** Create `renderers/png/png.go`, `renderers/png/png_test.go`; modify `renderers/renderers.go` (one import), `ui/web/api.go` (`contentType` for `png`).

**Interfaces:** Produces renderer `png` (`Ext() == "png"`). `Render(w, f)`: white background, `Fill` paths filled black with the even-odd rule in one pass per frame (so holes stay open), non-`Fill` paths drawn as 0.3 mm black lines. Scale 10 px/mm, reduced so the longer side is at most 6000 px.

- [ ] **Step 1: failing tests:** `TestPNGDecodes` (valid PNG, size = bounds x scale), `TestFilledShapeIsSolidAndHolesStayOpen` (a square with a square hole: centre pixel white, ring pixel black), `TestUnfilledPathsAreLines`, `TestHugePageIsCapped`, `TestEmptyFrameRejected` (zero bounds, like svg).
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** implement with `golang.org/x/image/vector`.
- [ ] **Step 4:** PASS; `curl` `/api/export?patch=typecloud&style=1&format=png` and view it.

## Task 5: Page: filled preview and a PNG button

**Files:** Modify (klmn.xyz) `static/tools/adraw/adraw.js` (`paint`, `download`, button wiring), `themes/klmn-theme/layouts/tools/adraw.html` (a `PNG` button next to `G-code`), `test/adraw.test.js`, `CLAUDE.md`. Copy the rebuilt engine files in by hand (not `make deploy-klmn`).

**Interfaces:** Consumes `FrameJSON.fill`. `paint` fills every `fill[i]` path in one `beginPath` with `fill('evenodd')`, strokes the others as now. `#btnPng` calls `download('png')`.

- [ ] **Step 1: failing Chrome tests:** `typecloud style=1 draws filled letters` (canvas has dark pixels in the interior of a big letter's stroke, not only on its outline), `the PNG download is a PNG` (name `typecloud-<seed>.png`, bytes start `89 50 4E 47`), `existing patterns still draw and export` (the existing suite).
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** implement. The `Print` button keeps printing paths (outlines for filled glyphs); say so in the rail note for style 1 only if it proves confusing.
- [ ] **Step 4:** `cd test && npm test` all PASS; look at the page in Chrome.

## My calls (not confirmed)

- `style` is a slider-like 0/1 parameter on `typecloud`, not a second pattern, so there is one text box and one gallery tile.
- Six bundled faces, 10 px/mm PNG, 6000 px cap.
- PNG is black on white, no colour options.
- The `Print` button prints outlines for solid letters.
- Cyrillic/Greek only if a chosen face has them; otherwise skipped like today.

## Self-review

Coverage: user's three asks (regular fonts, PNG, line fonts kept) map to tasks 2/3, 4, 3. Types: `Path.Fill`, `FrameJSON.Fill`, `typeface`, `outlinefont.Font.Layout`, `rasteriseFilled` are named the same wherever used. Order: 1 and 2 are independent; 3 needs 1 and 2; 4 needs 1; 5 needs 1, 3, 4.
