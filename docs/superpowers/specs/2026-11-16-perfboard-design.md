# Perfboard wire planner

> **Moved onto klmn.xyz on 2026-11-17** as `/tools/perfboard/` ("Perfboard Planner"). It was built
> as a standalone page that opened from disk; the sections below describe that first build. What
> changed in the move: the scripts live in `static/tools/perfboard/` (same files, same `PCB`
> namespace, loaded in order by `themes/klmn-theme/layouts/tools/perfboard.html`), the look follows
> the press bed (`/design/`), every class of its own is prefixed `pb-`, the File menu became a row
> of chips, browser storage keys are `perfboard-project`, `perfboard-library`, `perfboard-layers`
> and `perfboard-picture`, and the tests are in `test/perfboard.test.js`. The page now gets the
> site's web fonts like every other page; the planner itself makes no other requests.


## Context

You build projects on 2.54 mm universal prototype boards (isolated pads, nothing pre-connected) and want to
work out the jumper wiring on screen before cutting and soldering. `/Users/mart/github/pcb` is empty, so
this is a new app.

What you told me:

- Board size is set in holes; parts are placed using footprints you define yourself.
- Wires are dragged between holes. Each wire is either **routed** (laid flat, 90° bends along the grid)
  or **direct** (flying straight from A to B), chosen per wire.
- A wire may end directly on a part's pin, or in a free neighbour hole joined to the pin by a solder bridge.
- You want to see length, bends and overlaps while drawing.
- You want to take away: a wire cut list, a mirrored bottom view, image/print export, and a step-by-step
  build order.

## Approach

**Plain HTML + CSS + vanilla JavaScript, board drawn in SVG** (your decision: no external servers, no
dependencies).

- You open `index.html` by double-clicking it. There is no build step, no npm packages, no CDN links, no
  web fonts and no network requests of any kind.
- Because browsers block ES modules on `file://`, the code is split into ordinary `<script>` files that
  share one `PCB` namespace, loaded in order from `index.html`.
- The layout autosaves in the browser (localStorage) and can be saved/opened as a `.json` file.
- Tests use Node's built-in runner (`node --test`), so they need nothing installed either.

Others I considered:

- *Vite + React + TypeScript.* Ruled out by the no-dependencies requirement.
- *Canvas instead of SVG.* Faster for huge scenes, but a board is a few thousand holes at most, and SVG gives
  click targets and SVG/PNG/print export nearly for free.
- *Everything in one HTML file.* Also dependency-free, but an editor of this size is easier to keep correct
  and test when the logic lives in separate files.

## My calls (correct any of these)

- **Each wire is on the top or the bottom side** (added after the first build, at your request). A new
  wire goes on the side you are viewing, and a switch on the wire moves it. Solder bridges are always on
  the bottom. Wires on the side you are viewing are solid; the other side's are faint and dashed.
  Overlaps and crossings are only checked between wires on the same side.
- **Routed wires run horizontally/vertically only**, no 45° segments.
- **Cut length**, rounded up to the next mm, with the allowances editable in settings:
  - routed: path length along the grid × 2.54 mm + 2 × end allowance (default 3 mm per end, which is also
    the strip length)
  - direct: straight distance × 2.54 mm + 10 % slack + 2 × end allowance
- **Bends** = number of corners in a routed wire (the two downward bends into the holes are not counted).
- **What gets flagged:**
  - two routed wires sharing a stretch of the same grid line (overlap, red)
  - any two wires crossing (marker and count; allowed, since one hops over)
  - a routed wire running across a part body or someone else's pin
  - two wire ends in one free hole
  - a wire end in a free hole with no bridge (dangling)
  - parts overlapping or off the board
- **Connection highlight:** hovering a hole lights up everything electrically joined to it through pins,
  wires and bridges. There is no schematic or netlist import; the tool doesn't know what *should* be connected.
- **Footprints:** a small editor where you click holes to make pins, name them, and drag a body outline
  (half-hole steps, may overhang the pins). Parts rotate in 90° steps. Built-in generators for DIP-n,
  1×N / 2×N headers and two-lead parts at a chosen pitch. Your footprints are kept in a library in the
  browser and also embedded in each project file.
- **Build order:** top side first (routed wires shortest first, then direct wires), then the bottom side
  (bridges, routed wires, direct wires), so the board is turned over once. You can drag to reorder; ticks are saved with the project.

## Screen

```
┌ Board 30×20 ▾ │ Select · Routed wire · Direct wire · Bridge │ Top/Bottom │ Undo Redo │ Save Open Export ┐
├──────────────┬───────────────────────────────────────────────────────────┬──────────────────────────────┤
│ Parts        │      1  2  3  4  5  6  7  8  9 ...                        │ Wires │ Build │ Issues       │
│  DIP-8       │   A  o  o  o  o  o  o  o  o  o                            │ ■ W1 routed 23 mm 1 bend     │
│  Header 1×6  │   B  o  ┌U1────┐ o  o  o  o                               │ ■ W2 direct 41 mm ✕2         │
│  My relay    │   C  o  │●  ●  │━━━━━┓  o  o                              │ ■ W3 routed 18 mm 0 bends    │
│  + New…      │   D  o  │●  ●  │ o  o┃  o  o                              │ ...                          │
│              │   E  o  └──────┘ o  o┗━━● o        W1: 23 mm · 2 bends    │ Total 14 wires, 412 mm       │
└──────────────┴───────────────────────────────────────────────────────────┴──────────────────────────────┘
```

- Drag a part from the left list onto the board; `R` rotates, `Del` removes.
- Wire tool: press on a hole, drag to another, release. A routed wire starts as an L-shape; afterwards drag
  an end, drag a segment sideways, or double-click a segment to add a corner. Length and bends update live
  next to the cursor.
- Selected wire: colour, routed/direct switch, label.
- Zoom with the wheel, pan by dragging empty space. Row letters / column numbers stay readable in the
  mirrored bottom view.

## Structure

Pure logic is kept apart from the UI so it can be unit-tested. Every file is a classic script that adds to
`globalThis.PCB`, which lets the same model files load in the browser via `<script>` and in Node via
`require`.

- `index.html`, `style.css` — page shell, script tags in load order, print stylesheet
- `js/model/project.js` — data shapes (JSDoc) and factories: Project, Board, Footprint, Part,
  Wire (`mode`, `points`, `color`), Bridge, Settings
- `js/model/geometry.js` — wire length, bend count, segment overlap, crossings, part-body hits
- `js/model/nets.js` — union-find over pins, wire ends and bridges for the hover highlight
- `js/model/checks.js` — the issue list above
- `js/model/buildOrder.js` — default ordering
- `js/model/footprints.js` — built-in generators, rotation
- `js/model/serialize.js` — versioned JSON save/load, validation on open
- `js/store.js` — single state object, change subscription, snapshot undo/redo, localStorage autosave
- `js/ui/` — `boardView.js` (SVG layers: holes, bridges, parts, wires, markers; pointer tools), `toolbar.js`,
  `partsPanel.js`, `footprintEditor.js`, `wirePanel.js` (cut list, CSV copy), `buildPanel.js`,
  `issuesPanel.js`, `exportMenu.js` (SVG, PNG via an offscreen canvas, print with board and cut list on
  one sheet)
- `js/main.js` — wires the store to the views
- `test/*.test.js` — `node:test` + `node:assert` for the model files

Rendering is plain DOM/SVG: each view redraws its own layer when the store reports a change.

## Steps

1. `git init`, create `index.html`, `style.css` and the `js/` skeleton. Save this design to
   `docs/superpowers/specs/2026-11-16-perfboard-wire-planner-design.md`.
2. Model + tests first: geometry, nets, checks, build order, serialize.
3. Board view: grid, zoom/pan, top/bottom mirror, board size dialog.
4. Footprints: built-ins, editor, library; placing, moving, rotating parts.
5. Wires and bridges: drawing, editing, live readout, crossing/overlap markers, hover highlight.
6. Right-hand panels: cut list, build steps with highlight and ticks, issues.
7. Save/open, autosave, undo/redo, exports.
8. Visual pass using the frontend-design skill.

## Verification

- `node --test`: known cases, e.g. a straight routed wire across 5 hole pitches = 12.7 + 6 → 19 mm; an L of
  3 + 4 pitches has 1 bend; two collinear routed wires sharing a segment are flagged; a direct wire across
  a routed one counts one crossing; a pin, a bridge and a wire end resolve to one connected group.
- Open `index.html` straight from disk in Chrome, confirm the network tab shows no requests beyond the
  local files, then drive it: make a 30×20 board, define a custom footprint, place it and a
  DIP-8, draw routed and direct wires and a bridge, confirm the readouts match the tests, flip to the
  bottom view, tick through the build steps, export SVG/PNG, save, reload and reopen the file.

## Reference picture (added 2026-11-17)

A schematic or photo can be shown in a floating window over the app: toolbar "Add picture" (or `I`),
dropping an image file on the page, or pasting one. The window moves by its title bar, resizes from the
bottom-right corner (the picture scales with it and keeps its proportions; arrow keys on the corner grip
also resize), has an opacity slider (10–100 %, only the picture fades, the title bar and slider stay
solid), and can be hidden and shown again with the toolbar button, `I`, or its Hide button.
Marks can be drawn over the picture (Pen, Circle with Shift for a round one, Erase by clicking a mark,
three inks, Undo and Clear). They are stored in the picture's own pixel coordinates so they follow
resizing, don't fade with the opacity slider, and are cleared when a different picture is loaded.
The picture, its marks, place, size, opacity and hidden state are kept in this browser (`perfboard-picture`), separate
from the board file. A picture too big for browser storage is shown but is gone after a reload.

## Layers (added 2026-11-17)

Toolbar "Layers" menu with checkboxes: Parts, Top wires, Bottom wires, Solder bridges, Overlap and
crossing marks, Row and column labels, plus "Show everything". A badge counts hidden layers.
Hidden items are not drawn and cannot be clicked or dragged; hiding the selected item's layer drops
the selection. Selecting or focusing an item from the side lists shows its layer again, and so does
drawing a wire or bridge, or placing a part, on a hidden layer. Hovering a hole still traces the
whole connection, hidden wires included. Choices are kept in this browser (`perfboard-layers`).
SVG/PNG exports follow the layers on screen; the printed sheet always shows everything.
