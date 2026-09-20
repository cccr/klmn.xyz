# mass-qr Layout, Print and Control Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every QR code on a mass-qr sheet the same size and aligned across its row, make captions and error states legible on any sheet colour, give the user control of margin and gutter, and close the print and control gaps found in the measured review.

**Architecture:** The tile stops being a flex column and becomes a two-row CSS grid whose caption row is one sheet-wide height (`--cap-h`, measured once per render from the tallest caption). That single change makes every `.code` box identical, so codes align; `preserveAspectRatio: xMidYMid` then centres each code in its box and splits the leftover space evenly. Everything else is additive: two new state fields (`mg`, `gp`) plus `zoom` moving into state, styling for captions and error tiles, print resets, and the contrast/quiet-zone warnings lifted into the already-shared `qr-render.js`.

**Tech Stack:** Hugo (layout template with inline CSS/JS), vanilla ES5-style browser JS (no build step, no framework), Tailwind via CDN for chrome only, `node:test` + jsdom + jsQR for unit/DOM tests, headless Chrome via CDP and `--print-to-pdf` for layout and print tests.

**Spec:** `docs/superpowers/specs/2026-09-20-mass-qr-layout-fixes.md` (amends `docs/superpowers/specs/2026-09-19-mass-qr-design.md`)

## Global Constraints

- **Page script style:** ES5-compatible, `'use strict'`, `var`, `function` declarations, no arrow functions, no `let`/`const`, no template literals. Match the surrounding file exactly.
- **No build step, no new runtime dependencies.** Everything ships as inline CSS/JS in the Hugo layout, or in `static/tools/qr/qr-render.js`.
- **State schema stays `v: 1`.** New fields are additive; `normalize()` supplies defaults for anything absent so existing `#s=` links and `localStorage` values keep working. Never bump `v`.
- **Test commands run from `test/`:** `cd test && npm test`. Full suite must stay green — **66 tests pass today**. Never reduce that number.
- **Hugo must be rebuilt before tests read `public/`.** `buildSite()` in `test/harness.js` does this; call it once per test file.
- **Source of truth for shared JS is `static/tools/qr/qr-render.js`.** `public/tools/qr/qr-render.js` is Hugo build output — never edit it directly.
- **`docs/superpowers/specs/2026-09-19-mass-qr-design.md` state block** must be updated whenever a state field is added, in the same task that adds it.
- **Commit style:** lowercase imperative summary, no scope prefix — match `git log` (`add a quiet zone control, and actually hide the custom dimension fields`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `themes/klmn-theme/layouts/tools/mass-qr.html` | The whole tool: markup, CSS, state, render | Modified in every task |
| `static/tools/qr/qr-render.js` | Shared QR SVG rendering + colour advice for both tools | Modified in Task 8 |
| `themes/klmn-theme/layouts/tools/qr.html` | Single-code tool | Modified in Task 8 (consume shared helper) |
| `test/cdp.js` | **New.** Chrome DevTools Protocol driver: launch Chrome, serve `public/`, open a sheet, evaluate JS, measure real boxes | Created in Task 1 |
| `test/layout.test.js` | **New.** Measured-layout assertions that jsdom cannot make | Created in Task 1, extended in Tasks 2, 4, 5 |
| `test/mass-qr.test.js` | jsdom/DOM unit tests | Extended in Tasks 2, 4, 5, 6, 8 |
| `test/print.test.js` | End-to-end print pipeline | Extended in Task 3 |
| `docs/superpowers/specs/2026-09-19-mass-qr-design.md` | Design of record | State block updated in Tasks 4, 5 |

`test/cdp.js` exists because jsdom has no layout engine — `offsetHeight` is always 0 and
`getBoundingClientRect()` always returns zeros. That is precisely why the alignment bugs in
this plan shipped with a green suite. Node 26 has a global `WebSocket`, so a CDP client needs
no dependency.

---

### Task 1: Uniform caption band and centred codes

Fixes spec F1 and F2. Also creates the CDP test harness, because this task's deliverable
cannot be verified without it.

**Files:**
- Create: `test/cdp.js`
- Create: `test/layout.test.js`
- Modify: `themes/klmn-theme/layouts/tools/mass-qr.html:22-36` (CSS), `:437-440` (preserveAspectRatio), `:614-638` (render)
- Test: `test/layout.test.js`, `test/mass-qr.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `test/cdp.js` exports `{ withSheet, hashFor, closeAll }`.
    - `hashFor(stateObject) -> string` — base64url of the JSON, no `#`.
    - `withSheet(state, fn)` — `async`. Boots Chrome + a static server for `public/` (lazily, once per process), opens `/tools/mass-qr/#s=<hash>`, waits for render, calls `await fn(page)`, closes the tab. Returns `fn`'s return value.
    - `page.evalJson(expr)` — `async`, evaluates `expr` (a JS expression string) in the tab and returns the JSON-parsed result.
    - `page.setViewport(width, height)` — `async`.
    - `page.blockUrls(patterns)` — `async`, array of glob patterns.
    - `page.printToPDF(opts)` — `async`, returns a `Buffer`.
    - `closeAll()` — `async`, kills Chrome and the server. Call from `test.after()`.
  - `mass-qr.html` `#grid` carries a `--cap-h` custom property; `.cell.is-filled` is a two-row grid.

- [ ] **Step 1: Write the CDP driver**

Create `test/cdp.js`:

```js
'use strict';
// Chrome DevTools Protocol driver for layout assertions.
//
// jsdom has no layout engine — offsetHeight is always 0 and
// getBoundingClientRect() always returns zeros — so every test in
// mass-qr.test.js is blind to where things actually land on the sheet. That
// blindness is why codes were misaligned across a row through a green suite.
// This drives real Chrome and measures real boxes.
//
// Node 26 ships a global WebSocket, so the CDP client needs no dependency.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { SITE } = require('./harness');

const PORT = 9222 + (process.pid % 500);
const SITE_PORT = 8700 + (process.pid % 90);

function resolveChrome() {
  if (process.env.CHROME) return fs.existsSync(process.env.CHROME) ? process.env.CHROME : null;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(mac)) return mac;
  for (const bin of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (found) return found;
    } catch (e) { /* not on PATH */ }
  }
  return null;
}

const CHROME = resolveChrome();

function hashFor(state) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let booted = null;

async function boot() {
  if (booted) return booted;
  const server = spawn('python3', ['-m', 'http.server', String(SITE_PORT)], { cwd: SITE, stdio: 'ignore' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'massqr-cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1400,1000', 'about:blank'
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { booted = { server, chrome, profile }; return booted; }
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome did not expose a debugging port');
}

// One WebSocket per tab, with id-matched request/response.
function connect(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  });
  const ready = new Promise((res) => ws.addEventListener('open', res));
  return {
    ready,
    send(method, params) {
      const id = ++seq;
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
    },
    close() { ws.close(); }
  };
}

async function withSheet(state, fn) {
  await boot();
  const url = `http://localhost:${SITE_PORT}/tools/mass-qr/#s=${hashFor(state)}`;
  const tab = await (await fetch(
    `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const c = connect(tab.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  await c.send('Network.enable');
  // Tailwind's CDN script rewrites styles after load; 2s is comfortably past
  // it on this machine and in CI, and the alternative (polling for a sentinel)
  // would need a hook in the page that exists only for tests.
  await new Promise((r) => setTimeout(r, 2000));
  const page = {
    async evalJson(expr) {
      const r = await c.send('Runtime.evaluate',
        { expression: `JSON.stringify(${expr})`, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' evaluating: ' + expr);
      return JSON.parse(r.result.value);
    },
    async setViewport(width, height) {
      await c.send('Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile: false });
      await c.send('Runtime.evaluate', { expression: "window.dispatchEvent(new Event('resize'))" });
      await new Promise((r) => setTimeout(r, 300));
    },
    async blockUrls(urls) {
      await c.send('Network.setBlockedURLs', { urls });
      await c.send('Page.reload');
      await new Promise((r) => setTimeout(r, 2000));
    },
    async printToPDF(opts) {
      const r = await c.send('Page.printToPDF', Object.assign(
        { printBackground: true, preferCSSPageSize: true,
          marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 }, opts || {}));
      return Buffer.from(r.data, 'base64');
    }
  };
  try {
    return await fn(page);
  } finally {
    c.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);
  }
}

async function closeAll() {
  if (!booted) return;
  booted.chrome.kill();
  booted.server.kill();
  fs.rmSync(booted.profile, { recursive: true, force: true });
  booted = null;
}

module.exports = { withSheet, hashFor, closeAll, CHROME };
```

- [ ] **Step 2: Write the failing layout test**

Create `test/layout.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSite } = require('./harness');
const { withSheet, closeAll, CHROME } = require('./cdp');

buildSite();

test.after(closeAll);

const BASE = {
  v: 1, rows: 2, cols: 2, paper: 'a4', orient: 'p', ecc: 'Q',
  capPos: 'above', capSize: 'm', fg: '#000000', bg: '#ffffff',
  cw: 210, ch: 297, cu: 'mm', qz: 4, tiles: {}
};

// One tile carries a description and the others do not. Before the caption
// band this made tile 0,0's code box 15.8px shorter than its neighbour's and
// pushed its code 15.8px (4.2mm) down the page — two codes in one row that
// visibly did not line up.
const MIXED = Object.assign({}, BASE, { tiles: {
  '0,0': { u: 'https://school.edu/schedule', l: 'Schedule', d: 'Bell times' },
  '0,1': { u: 'https://school.edu/lunch', l: 'Lunch', d: '' },
  '1,0': { u: 'https://school.edu/portal', l: 'Portal', d: '' },
  '1,1': { u: 'https://school.edu/news', l: 'News', d: 'Weekly newsletter' }
} });

// Reads the untransformed layout box of each code and its rendered QR square.
// getBoundingClientRect() is fine here because the sheet renders at scale 1 at
// this viewport; the numbers are compared against each other, not absolutes.
const PROBE = `(function () {
  var out = [];
  document.querySelectorAll('#grid .cell.is-filled').forEach(function (cell) {
    var code = cell.querySelector('.code');
    var svg = cell.querySelector('.code svg');
    var cr = code.getBoundingClientRect();
    var sr = svg.getBoundingClientRect();
    out.push({
      pos: cell.dataset.pos,
      codeH: cr.height, codeW: cr.width,
      qrSide: Math.min(sr.width, sr.height),
      qrTop: sr.top + (sr.height - Math.min(sr.width, sr.height)) / 2,
      capTop: cell.querySelector('.cap').getBoundingClientRect().top
    });
  });
  return out;
})()`;

test('every code box on a sheet is the same height', { skip: !CHROME && 'no Chrome' }, async () => {
  const cells = await withSheet(MIXED, (p) => p.evalJson(PROBE));
  assert.equal(cells.length, 4);
  const heights = cells.map((c) => c.codeH);
  const spread = Math.max(...heights) - Math.min(...heights);
  assert.ok(spread < 0.5, `code box heights differ by ${spread.toFixed(1)}px: ${heights.join(', ')}`);
});

test('codes are the same size and share a top edge across a row',
  { skip: !CHROME && 'no Chrome' }, async () => {
  const cells = await withSheet(MIXED, (p) => p.evalJson(PROBE));
  const sides = cells.map((c) => c.qrSide);
  assert.ok(Math.max(...sides) - Math.min(...sides) < 0.5,
    `code sizes differ: ${sides.map((s) => s.toFixed(1)).join(', ')}`);

  for (const row of ['0', '1']) {
    const tops = cells.filter((c) => c.pos[0] === row).map((c) => c.qrTop);
    const spread = Math.max(...tops) - Math.min(...tops);
    assert.ok(spread < 0.5,
      `row ${row} codes differ in top edge by ${spread.toFixed(1)}px`);
  }
});

test('captions share a top edge across a row with the caption below',
  { skip: !CHROME && 'no Chrome' }, async () => {
  const below = Object.assign({}, MIXED, { capPos: 'below' });
  const cells = await withSheet(below, (p) => p.evalJson(PROBE));
  for (const row of ['0', '1']) {
    const tops = cells.filter((c) => c.pos[0] === row).map((c) => c.capTop);
    const spread = Math.max(...tops) - Math.min(...tops);
    assert.ok(spread < 0.5,
      `row ${row} captions differ in top edge by ${spread.toFixed(1)}px`);
  }
});
```

- [ ] **Step 3: Run the layout test to verify it fails**

Run: `cd test && node --test --test-concurrency=1 layout.test.js`

Expected: FAIL. `code box heights differ by 15.8px: 477.4, 493.2, 493.2, 477.4`, and the
row-top and caption-top assertions fail with a ~15.8px / ~20.5px spread.

- [ ] **Step 4: Replace the tile's flex column with a two-row grid**

In `themes/klmn-theme/layouts/tools/mass-qr.html`, replace the `.cell` / `.cell.cap-below`
block (currently lines 24-28) and the `.code` rule (line 35) with:

```css
    .cell {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 0; min-width: 0; min-height: 0; position: relative;
    }

    /* A filled tile is a two-row grid, not a flex column. The caption row is
       one height for the whole sheet (--cap-h, measured per render from the
       tallest caption), so every .code box comes out identical and the codes
       line up across a row. As a flex column the code box shrank by exactly
       its own caption's height, so a tile carrying a description produced a
       code 15.8px (4.2mm) lower than its neighbour's. */
    .cell.is-filled {
        display: grid;
        grid-template-rows: var(--cap-h, auto) minmax(0, 1fr);
    }
    /* The caption hugs its code — bottom-aligned in the band when it sits
       above, top-aligned when below — so extra description lines grow away
       from the code rather than shifting it. */
    .cell.is-filled .cap  { grid-row: 1; align-self: end; }
    .cell.is-filled .code { grid-row: 2; }
    .cell.is-filled.cap-below { grid-template-rows: minmax(0, 1fr) var(--cap-h, auto); }
    .cell.is-filled.cap-below .cap  { grid-row: 2; align-self: start; }
    .cell.is-filled.cap-below .code { grid-row: 1; }
```

Then delete the now-dead `.cell.cap-below { flex-direction: column-reverse; }` rule and drop
`flex: 1 1 auto;` from `.code`, leaving:

```css
    .code { min-height: 0; width: 100%; position: relative; }
```

- [ ] **Step 5: Centre the code in its box**

Replace the `preserveAspectRatio` block in `buildTile` (currently lines 437-440) with:

```js
            var svgEl = code.querySelector('svg');
            // Centred, not pinned to the caption edge: every .code box is now
            // the same size, so centring splits the leftover space evenly
            // above and below each code instead of pooling ~43mm of it at the
            // bottom of every cell.
            if (svgEl) svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
```

- [ ] **Step 6: Measure and apply the caption band**

Add above `render()` in `mass-qr.html`:

```js
    // The caption band is one height for the whole sheet. It has to be
    // measured rather than computed, because a caption's height depends on
    // how its text wraps and only layout knows that. Two passes: let the row
    // size to content, read the tallest caption, then write the band back.
    //
    // offsetHeight, not getBoundingClientRect(): the sheet carries a zoom
    // transform, and a transformed rect would report 0.7x the real height at
    // "fit" zoom and under-size the band.
    var CAP_LINE = 1.3; // line-height, matching the .cap rules
    function applyCaptionBand() {
        grid.style.setProperty('--cap-h', 'auto');
        var tallest = 0;
        grid.querySelectorAll('.cell.is-filled .cap').forEach(function (cap) {
            if (cap.offsetHeight > tallest) tallest = cap.offsetHeight;
        });
        if (tallest > 0) {
            grid.style.setProperty('--cap-h', tallest + 'px');
            return;
        }
        // No layout engine (jsdom) or a sheet that is not displayed: fall
        // back to the nominal single-line heights the sizes are defined in.
        var sizes = CAP_MM[state.capSize];
        var anyDesc = Object.keys(state.tiles).some(function (k) { return !!state.tiles[k].d; });
        grid.style.setProperty('--cap-h',
            (Math.round((sizes.label + (anyDesc ? sizes.desc : 0)) * CAP_LINE * 100) / 100) + 'mm');
    }
```

Then in `render()`, change the final line from `applySheetChrome();` to:

```js
        // Sheet dimensions first: the caption's wrapping width comes from the
        // cell, which comes from the sheet, so measuring before the sheet is
        // sized would band the captions against the previous paper size.
        applySheetChrome();
        applyCaptionBand();
```

- [ ] **Step 7: Run the layout test to verify it passes**

Run: `cd test && node --test --test-concurrency=1 layout.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 8: Add a jsdom guard for the aspect-ratio attribute**

Append to `test/mass-qr.test.js`:

```js
// ── Tile layout ────────────────────────────────────────────────────

test('codes are centred in their box regardless of caption position', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: 'desc' } });
  const par = () => p.doc.querySelector('.cell[data-pos="0,0"] .code svg')
    .getAttribute('preserveAspectRatio');
  assert.equal(par(), 'xMidYMid meet');
  fireChange(p, p.$('capPos'), 'below');
  assert.equal(par(), 'xMidYMid meet', 'still centred with the caption below');
});

test('the caption band falls back to millimetres when nothing can be measured', () => {
  // jsdom reports offsetHeight 0, which is exactly the fallback path: medium
  // captions are 4mm label + 2.8mm description at line-height 1.3.
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: 'desc' } });
  assert.equal(p.$('grid').style.getPropertyValue('--cap-h'), '8.84mm');

  const noDesc = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: '' } });
  assert.equal(noDesc.$('grid').style.getPropertyValue('--cap-h'), '5.2mm',
    'a sheet with no descriptions reserves only the label line');
});
```

- [ ] **Step 9: Run the full suite**

Run: `cd test && npm test`
Expected: PASS, 71 tests (66 existing + 3 layout + 2 jsdom), 0 fail.

- [ ] **Step 10: Commit**

```bash
git add themes/klmn-theme/layouts/tools/mass-qr.html test/cdp.js test/layout.test.js test/mass-qr.test.js docs/superpowers/specs/2026-09-20-mass-qr-layout-fixes.md docs/superpowers/plans/2026-09-20-mass-qr-layout-fixes.md
git commit -m "give every tile the same caption band so codes line up across a row"
```

---

### Task 2: Legible captions and error tiles on any sheet colour

Fixes spec F3, F4 and F5.

**Files:**
- Modify: `themes/klmn-theme/layouts/tools/mass-qr.html:32-36` (caption CSS), `:403-457` (`buildTile`)
- Test: `test/mass-qr.test.js`, `test/layout.test.js`

**Interfaces:**
- Consumes: `.cell.is-filled` grid and `--cap-h` from Task 1.
- Produces: `.cap` carries an inline `color` equal to `state.fg`. `.code.too-long` and
  `.code.error` are styled, centred boxes.

- [ ] **Step 1: Write the failing tests**

Append to `test/mass-qr.test.js`:

```js
test('caption text takes the code colour, so it survives a dark sheet', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: 'd' } },
    { fg: '#ffffff', bg: '#0f172a' });
  const cap = p.doc.querySelector('.cell[data-pos="0,0"] .cap');
  assert.equal(cap.style.color, 'rgb(255, 255, 255)');
});

test('caption colour follows the code colour control', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: '' } });
  const cap = () => p.doc.querySelector('.cell[data-pos="0,0"] .cap').style.color;
  assert.equal(cap(), 'rgb(0, 0, 0)');
  p.setInput(p.$('fg'), '#b91c1c');
  assert.equal(cap(), 'rgb(185, 28, 28)');
});
```

Append to `test/layout.test.js`:

```js
test('a long unbroken label stays inside its column',
  { skip: !CHROME && 'no Chrome' }, async () => {
  const state = Object.assign({}, BASE, { cols: 3, tiles: {
    '0,0': { u: 'https://a.example/1', l: 'Supercalifragilisticexpialidocious', d: '' },
    '0,1': { u: 'https://a.example/2', l: 'Short', d: '' },
    '0,2': { u: 'https://a.example/3', l: 'Three', d: '' }
  } });
  const probe = `(function () {
    var cell = document.querySelector('.cell[data-pos="0,0"]');
    var label = cell.querySelector('.cap .label');
    return { cellW: cell.getBoundingClientRect().width,
             labelScrollW: label.scrollWidth, labelClientW: label.clientWidth };
  })()`;
  const m = await withSheet(state, (p) => p.evalJson(probe));
  assert.ok(m.labelScrollW <= m.labelClientW + 1,
    `label overflows its box: ${m.labelScrollW} > ${m.labelClientW}`);
});

test('an over-capacity tile renders a centred, coloured error',
  { skip: !CHROME && 'no Chrome' }, async () => {
  const state = Object.assign({}, BASE, { ecc: 'H', tiles: {
    '0,0': { u: 'https://example.com/' + 'x'.repeat(3200), l: 'Too long', d: '' }
  } });
  const probe = `(function () {
    var el = document.querySelector('.code.too-long');
    if (!el) return null;
    var cs = getComputedStyle(el);
    return { text: el.textContent, color: cs.color,
             align: cs.alignItems, justify: cs.justifyContent };
  })()`;
  const m = await withSheet(state, (p) => p.evalJson(probe));
  assert.ok(m, 'the tile reports its failure');
  assert.equal(m.text, 'Link too long');
  assert.equal(m.color, 'rgb(185, 28, 28)', 'reads as an error, not as body text');
  assert.equal(m.align, 'center');
  assert.equal(m.justify, 'center');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js layout.test.js`

Expected: FAIL — caption `style.color` is `''`; the long label's `scrollWidth` exceeds its
`clientWidth`; the error box reports `color: rgb(30, 41, 59)` and `alignItems: normal`.

- [ ] **Step 3: Style captions and error tiles**

Replace the `.cap` rules in `mass-qr.html` (currently lines 32-34) with:

```css
    /* Colour is set inline from `fg` in buildTile: the code colour is the
       ink colour of the sheet. Left to the theme's slate, captions were
       invisible on any dark background — on screen and on paper. */
    .cap { text-align: center; max-width: 100%; min-width: 0; }
    .cap .label, .cap .desc {
        /* A long unbroken label used to render wider than its column and
           bleed into the gutter; .cell has no overflow of its own, so from
           three columns up it overlapped the neighbouring caption. The clamp
           also keeps the measured caption band bounded. */
        display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden;
        overflow-wrap: anywhere; line-height: 1.3;
    }
    .cap .label { font-weight: 600; -webkit-line-clamp: 2; line-clamp: 2; }
    .cap .desc { opacity: .75; -webkit-line-clamp: 1; line-clamp: 1; }
```

Add immediately after the `.code` rules:

```css
    /* A tile whose payload will not fit still prints — a visibly broken tile
       beats a silently blank one. Unstyled it came out as 16px left-aligned
       body text hanging out of the cell, reading like a typo. */
    .code.too-long, .code.error {
        display: flex; align-items: center; justify-content: center;
        text-align: center; overflow-wrap: anywhere; padding: 2mm;
        color: #b91c1c; font-size: 3mm; font-weight: 600; line-height: 1.3;
        outline: 1px dashed #b91c1c; outline-offset: -1px;
    }
```

- [ ] **Step 4: Set the caption colour from `fg`**

In `buildTile`, immediately after `cap.className = 'cap';`, add:

```js
        cap.style.color = state.fg;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js layout.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `cd test && npm test`
Expected: PASS, 75 tests, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add themes/klmn-theme/layouts/tools/mass-qr.html test/mass-qr.test.js test/layout.test.js
git commit -m "make captions and failed tiles legible on any sheet colour"
```

---

### Task 3: Print robustness and dialog guidance

Fixes spec F8.

**Files:**
- Modify: `themes/klmn-theme/layouts/tools/mass-qr.html:62-89` (`@media print`), `:200` (control strip)
- Test: `test/print.test.js`

**Interfaces:**
- Consumes: `page.blockUrls()` and `page.printToPDF()` from `test/cdp.js` (Task 1).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `test/print.test.js`:

```js
const { withSheet, closeAll, CHROME: CDP_CHROME } = require('./cdp');
test.after(closeAll);

// Body margin comes only from Tailwind's CDN preflight. Block that script —
// offline, corporate proxy, a slow CDN on the day someone hits Ctrl-P — and
// body keeps its 8px UA margin while the sheet exactly fills the page.
test('the sheet still prints on one page without the Tailwind CDN',
  { skip: !CDP_CHROME && 'no Chrome' }, async () => {
  const pdf = await withSheet(STATE, async (p) => {
    await p.blockUrls(['*cdn.tailwindcss.com*']);
    const margin = await p.evalJson("getComputedStyle(document.body).margin");
    assert.equal(margin, '8px', 'precondition: no preflight, so the UA margin is live');
    return p.printToPDF();
  });
  const counts = [...pdf.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => +m[1]);
  assert.equal(Math.max(...counts), 1, 'exactly one page');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd test && node --test --test-concurrency=1 print.test.js`

Expected: FAIL on the `margin` precondition only once the fix is in. Before the fix the
precondition passes and the page count may pass by luck — the overflowing 8px carries no
content. Confirm the real gap directly instead:

Run: `cd test && node -e "
const { withSheet, closeAll } = require('./cdp');
withSheet({v:1,rows:1,cols:1,paper:'a4',orient:'p',ecc:'Q',capPos:'above',capSize:'m',fg:'#000000',bg:'#ffffff',cw:210,ch:297,cu:'mm',qz:4,tiles:{'0,0':{u:'https://x.example',l:'X',d:''}}}, async (p) => {
  await p.blockUrls(['*cdn.tailwindcss.com*']);
  console.log(await p.evalJson('getComputedStyle(document.body).margin'));
}).then(closeAll);"`

Expected: prints `8px` — the sheet starts 8px down a page it exactly fills.

- [ ] **Step 3: Add the print resets**

In the `@media print` block of `mass-qr.html`, immediately after the
`body > header, body > footer` rule, add:

```css
        /* The only thing keeping body off its 8px UA margin is Tailwind's
           CDN preflight. Block that script and the sheet starts 8px down a
           page it exactly fills — 8px from a second, blank page, on a
           dependency this site does not control. min-height goes too:
           `min-h-screen` resolves against the page box in print. */
        html, body {
            margin: 0 !important; padding: 0 !important;
            min-height: 0 !important; background: #fff !important;
        }
```

- [ ] **Step 4: Add the print-dialog hint**

In `mass-qr.html`, immediately after the `#btnPrint` button, still inside the
`flex flex-wrap items-end gap-4` container, add:

```html
            <p class="basis-full text-xs text-slate-500 no-print">
                In the print dialog pick the same paper size as above, set Margins to
                <strong>None</strong> and Scale to <strong>100%</strong>. Anything else and the
                browser rescales the sheet, so the codes print at the wrong physical size.
            </p>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd test && node --test --test-concurrency=1 print.test.js`
Expected: PASS, 4 tests. The `margin` precondition now measures `8px` on screen while the
printed PDF is one page, which is the property under test.

- [ ] **Step 6: Run the full suite**

Run: `cd test && npm test`
Expected: PASS, 76 tests, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add themes/klmn-theme/layouts/tools/mass-qr.html test/print.test.js
git commit -m "stop the sheet depending on a CDN for its page fit, and say what the print dialog needs"
```

---

### Task 4: Margin and gutter controls with a density guard

Fixes spec F6, and gives the user the lever on F2's leftover space.

**Files:**
- Modify: `themes/klmn-theme/layouts/tools/mass-qr.html` — state (`:232-238`), `normalize` (`:270-301`), controls markup (`:101-202`), `applySheetChrome` (`:651-664`)
- Modify: `docs/superpowers/specs/2026-09-19-mass-qr-design.md` (state block)
- Test: `test/mass-qr.test.js`, `test/layout.test.js`

**Interfaces:**
- Consumes: `paperDims(s)` (existing, `mass-qr.html:646`).
- Produces:
  - State fields `mg` (number, mm, default `10`, clamped 0–50) and `gp` (number, mm, default `4`, clamped 0–30).
  - `clampMm(n, lo, hi, dflt) -> number` — float clamp rounded to 0.1.
  - `cellMm(s) -> [widthMm, heightMm]` — the space one cell gets.
  - `densityNote(s) -> string|null`.
  - `applyWarning()` — writes `densityNote` into `#warn`; **extended in Task 8**.
  - DOM: `#mg`, `#gp` number inputs; `#warn` paragraph.

- [ ] **Step 1: Write the failing tests**

Append to `test/mass-qr.test.js`:

```js
// ── Margin and gutter ──────────────────────────────────────────────

test('margin and gutter default to 10mm and 4mm', () => {
  const s = page().window.massQr.defaultState();
  assert.equal(s.mg, 10);
  assert.equal(s.gp, 4);
});

test('margin and gutter round-trip and clamp', () => {
  const { window } = page();
  const s = window.massQr.defaultState();
  s.mg = 0; s.gp = 12.5;
  assert.deepEqual(window.massQr.decodeState(window.massQr.encodeState(s)), s);
  assert.equal(window.massQr.normalize({ v: 1, mg: 999 }).mg, 50, 'margin clamps down');
  assert.equal(window.massQr.normalize({ v: 1, mg: -5 }).mg, 0, 'margin clamps up');
  assert.equal(window.massQr.normalize({ v: 1, gp: 999 }).gp, 30, 'gutter clamps down');
  assert.equal(window.massQr.normalize({ v: 1, gp: 'wide' }).gp, 4, 'garbage falls back');
});

test('margin and gutter reach the sheet and the grid', () => {
  const p = page();
  fireChange(p, p.$('mg'), '5');
  fireChange(p, p.$('gp'), '1.5');
  assert.equal(p.$('sheet').style.padding, '5mm');
  assert.equal(p.$('grid').style.gap, '1.5mm');
  assert.equal(p.window.massQr.getState().mg, 5);
});

test('a grid too dense for its paper warns instead of rendering a mess', () => {
  const p = page();
  assert.ok(p.$('warn').hidden, 'quiet at the defaults');
  // 6 columns on 50mm paper: 10mm margin a side leaves 30mm, five 4mm
  // gutters eat 20mm, so six columns share 10mm.
  p.window.massQr.setState({ paper: 'custom', cw: 50, ch: 50, rows: 6, cols: 6 });
  assert.ok(!p.$('warn').hidden, 'warns');
  assert.match(p.$('warn').textContent, /margin and gutter use up the whole sheet/i);

  // Recoverable now that margin and gutter are controls.
  p.window.massQr.setState({ cw: 150, ch: 150, mg: 4, gp: 2 });
  assert.ok(p.$('warn').hidden, 'a bigger sheet with a tighter margin clears it');
});

test('a sheet just under the scannable floor warns with the measurement', () => {
  const p = page();
  p.window.massQr.setState({ paper: 'custom', cw: 100, ch: 100, rows: 6, cols: 6, mg: 5, gp: 2 });
  assert.match(p.$('warn').textContent, /about 1[01]mm/);
});
```

Append to `test/layout.test.js`:

```js
test('the margin control changes the printable area', { skip: !CHROME && 'no Chrome' }, async () => {
  const probe = `(function () {
    var sheet = document.getElementById('sheet');
    var grid = document.getElementById('grid');
    return { sheetW: sheet.getBoundingClientRect().width,
             gridW: grid.getBoundingClientRect().width };
  })()`;
  const wide = await withSheet(Object.assign({}, MIXED, { mg: 20 }), (p) => p.evalJson(probe));
  const tight = await withSheet(Object.assign({}, MIXED, { mg: 2 }), (p) => p.evalJson(probe));
  // 20mm a side vs 2mm a side is 36mm ≈ 136px more grid at 96dpi.
  assert.ok(tight.gridW - wide.gridW > 120,
    `tighter margin should widen the grid: ${wide.gridW} -> ${tight.gridW}`);
  assert.ok(Math.abs(tight.sheetW - wide.sheetW) < 0.5, 'the paper itself is unchanged');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js layout.test.js`
Expected: FAIL — `s.mg` is `undefined`, `p.$('mg')` is `null`, `p.$('warn')` is `null`.

- [ ] **Step 3: Add the state fields**

In `defaultState()`, add `mg: 10, gp: 4,` to the returned object (next to `qz: 4`).

Below the existing `clampDim` helper, add:

```js
    // Margin and gutter are fractional millimetres like the custom paper
    // dimensions, so they need a float clamp too — but their own bounds.
    // Rounded to 0.1mm, which is finer than any printer resolves.
    var MG_MAX = 50, GP_MAX = 30;
    function clampMm(n, lo, hi, dflt) {
        n = parseFloat(n);
        if (!isFinite(n)) return dflt;
        return Math.round(Math.min(hi, Math.max(lo, n)) * 10) / 10;
    }
```

In `normalize()`, add to the `s` object literal, after `qz`:

```js
            mg: clampMm(obj.mg, 0, MG_MAX, d.mg),
            gp: clampMm(obj.gp, 0, GP_MAX, d.gp),
```

- [ ] **Step 4: Add the controls and the warning bar**

In `mass-qr.html`, after the Rows control `<div>`, insert:

```html
            <div>
                <label class="form-label" for="mg">Margin (mm)</label>
                <input id="mg" type="number" inputmode="decimal" min="0" max="50" step="0.5"
                       class="block w-24 px-3 py-2 rounded-xl border border-slate-300 bg-white" />
            </div>
            <div>
                <label class="form-label" for="gp">Gutter (mm)</label>
                <input id="gp" type="number" inputmode="decimal" min="0" max="30" step="0.5"
                       class="block w-24 px-3 py-2 rounded-xl border border-slate-300 bg-white" />
            </div>
```

Immediately after the closing `</div>` of the `flex flex-wrap items-end gap-4` row, still
inside `#controls`, add:

```html
        <p id="warn" class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-3 no-print" hidden></p>
```

- [ ] **Step 5: Apply margin and gutter, and wire the guard**

Add above `applySheetChrome()`:

```js
    // Margin and gutter are absolute millimetres, so a small sheet and a
    // dense grid can between them leave nothing for the codes: six columns
    // on 50mm paper at the defaults leaves 10mm for all six. Nothing caught
    // that before — the sheet simply rendered unreadable.
    var MIN_CELL_MM = 12;
    function cellMm(s) {
        var dims = paperDims(s);
        return [
            (dims[0] - 2 * s.mg - (s.cols - 1) * s.gp) / s.cols,
            (dims[1] - 2 * s.mg - (s.rows - 1) * s.gp) / s.rows
        ];
    }

    function densityNote(s) {
        var cell = cellMm(s);
        var side = Math.min(cell[0], cell[1]);
        if (side <= 0) {
            return 'The margin and gutter use up the whole sheet at ' + s.cols + '×' + s.rows +
                   '. Reduce them, or use fewer rows and columns.';
        }
        if (side < MIN_CELL_MM) {
            return 'Each code gets about ' + Math.round(side) + 'mm here — under ' +
                   MIN_CELL_MM + 'mm most phones cannot scan. Use a bigger sheet, fewer cells, ' +
                   'or a smaller margin.';
        }
        return null;
    }

    var elWarn = document.getElementById('warn');
    function applyWarning() {
        var note = densityNote(state);
        elWarn.hidden = !note;
        if (note) elWarn.textContent = note;
    }
```

In `applySheetChrome()`, after the `sheet.style.height` assignment, add:

```js
        sheet.style.padding = state.mg + 'mm';
        grid.style.gap = state.gp + 'mm';
```

and add `applyWarning();` immediately before the existing `applyZoom();` call.

Wire the two inputs next to the `cw`/`ch` wiring:

```js
    [['mg', document.getElementById('mg')], ['gp', document.getElementById('gp')]]
        .forEach(function (pair) {
            pair[1].value = state[pair[0]];
            pair[1].addEventListener('change', function () {
                var patch = {};
                patch[pair[0]] = pair[1].value;
                setState(patch);
            });
        });
```

and keep them in sync after a state change by adding to `syncCustomInputs()`, before its
`elCustom.hidden` early return:

```js
        document.getElementById('mg').value = state.mg;
        document.getElementById('gp').value = state.gp;
```

- [ ] **Step 6: Drop the hardcoded margin and gutter from the CSS**

In `mass-qr.html`, remove `padding: 10mm;` from the `.sheet` rule and `gap: 4mm;` from the
`#grid` rule — both are now written inline by `applySheetChrome()`. Update the comment above
`.sheet` to say padding comes from `state.mg` for the same reason width and height do.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js layout.test.js`
Expected: PASS.

- [ ] **Step 8: Update the design spec's state block**

In `docs/superpowers/specs/2026-09-19-mass-qr-design.md`, add to the state example:

```js
  qz: 4,                   // quiet zone, modules, 0-8
  mg: 10,                  // sheet margin, mm, 0-50
  gp: 4,                   // gutter between cells, mm, 0-30
```

and add below the Defaults paragraph:

> **Margin and gutter** are millimetres on the state, written inline onto the sheet's padding
> and the grid's gap. They are the only lever on the space a square code leaves in a
> non-square cell, and the only way out of a grid too dense for its paper — below 12mm per
> cell the tool warns.

- [ ] **Step 9: Run the full suite**

Run: `cd test && npm test`
Expected: PASS, 82 tests, 0 fail.

- [ ] **Step 10: Commit**

```bash
git add themes/klmn-theme/layouts/tools/mass-qr.html test/mass-qr.test.js test/layout.test.js docs/superpowers/specs/2026-09-19-mass-qr-design.md
git commit -m "put margin and gutter under the user's control, and warn when a grid outgrows its paper"
```

---

### Task 5: Zoom that persists and reserves the space it actually uses

Fixes spec F7 and the zoom half of F9.

**Files:**
- Modify: `themes/klmn-theme/layouts/tools/mass-qr.html` — `ENUMS` (`:226-230`), `defaultState` (`:232-238`), `normalize`, zoom markup (`:192-199`), `#sheetWrap` markup (`:204-208`), `applyZoom` (`:769-787`), print CSS
- Modify: `docs/superpowers/specs/2026-09-19-mass-qr-design.md` (state block)
- Test: `test/mass-qr.test.js`, `test/layout.test.js`

**Interfaces:**
- Consumes: `applySheetChrome()` calling `applyZoom()` (existing).
- Produces:
  - State field `zoom` (enum `'fit' | 'page' | '1' | '1.5'`, default `'fit'`).
  - DOM: `#sheetBox`, a sized wrapper between `#sheetWrap` and `#sheet`.

- [ ] **Step 1: Write the failing tests**

Append to `test/mass-qr.test.js`:

```js
// ── Zoom ───────────────────────────────────────────────────────────

test('zoom defaults to fit and round-trips like every other control', () => {
  const { window } = page();
  assert.equal(window.massQr.defaultState().zoom, 'fit');
  const s = window.massQr.defaultState();
  s.zoom = '1.5';
  assert.deepEqual(window.massQr.decodeState(window.massQr.encodeState(s)), s);
  assert.equal(window.massQr.normalize({ v: 1, zoom: 'enormous' }).zoom, 'fit');
});

test('a shared sheet reopens at the zoom it was saved with', () => {
  const seed = page();
  fireChange(seed, seed.$('zoom'), '1.5');
  assert.equal(seed.window.massQr.getState().zoom, '1.5');
  const hash = '#s=' + seed.window.massQr.encodeState(seed.window.massQr.getState());

  const p = page({ hash });
  assert.equal(p.$('zoom').value, '1.5', 'the control shows the saved zoom');
  assert.match(p.$('sheet').style.transform, /scale\(1\.5\)/);
});

test('changing zoom does not rebuild the grid', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: '' } });
  const before = p.doc.querySelector('.cell[data-pos="0,0"]');
  fireChange(p, p.$('zoom'), '1');
  assert.strictEqual(p.doc.querySelector('.cell[data-pos="0,0"]'), before,
    'a preview-only control must not re-encode every code');
});
```

Append to `test/layout.test.js`:

```js
test('a scaled sheet reserves only the space it occupies',
  { skip: !CHROME && 'no Chrome' }, async () => {
  const m = await withSheet(MIXED, async (p) => {
    await p.setViewport(600, 800);
    return p.evalJson(`(function () {
      var sheet = document.getElementById('sheet');
      var wrap = document.getElementById('sheetWrap');
      var r = sheet.getBoundingClientRect();
      return { visualH: r.height, visualW: r.width,
               wrapScrollH: wrap.scrollHeight, wrapScrollW: wrap.scrollWidth,
               wrapClientW: wrap.clientWidth,
               transform: getComputedStyle(sheet).transform };
    })()`);
  });
  assert.ok(m.transform !== 'none' && !m.transform.startsWith('matrix(1,'),
    'precondition: the sheet is scaled down at 600px');
  // Before #sheetBox, the wrapper reserved the unscaled 1122px for a sheet
  // drawn 792px tall — 363px of blank scroll — and scrollWidth stayed 794
  // against a 560px client, giving a phantom horizontal scrollbar.
  assert.ok(m.wrapScrollH - m.visualH < 40,
    `dead space below the sheet: ${(m.wrapScrollH - m.visualH).toFixed(0)}px`);
  assert.ok(m.wrapScrollW <= m.wrapClientW + 1,
    `phantom horizontal scroll: ${m.wrapScrollW} > ${m.wrapClientW}`);
});

test('fit page brings the whole sheet into view', { skip: !CHROME && 'no Chrome' }, async () => {
  const m = await withSheet(Object.assign({}, MIXED, { zoom: 'page' }), async (p) => {
    await p.setViewport(1400, 700);
    return p.evalJson(`(function () {
      var r = document.getElementById('sheet').getBoundingClientRect();
      return { visualH: r.height, viewportH: window.innerHeight,
               top: r.top };
    })()`);
  });
  assert.ok(m.top + m.visualH <= m.viewportH + 1,
    `sheet runs past the viewport: ${(m.top + m.visualH).toFixed(0)} > ${m.viewportH}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js layout.test.js`
Expected: FAIL — `defaultState().zoom` is `undefined`; dead space measures ~363px;
`wrapScrollW` 794 against `wrapClientW` 560.

- [ ] **Step 3: Put zoom into state**

In `ENUMS`, add:

```js
        zoom: ['fit', 'page', '1', '1.5'],
```

In `defaultState()`, add `zoom: 'fit',` next to `qz: 4`.

In `normalize()`, add to the `s` literal:

```js
            zoom: pickEnum(obj.zoom, 'zoom', d.zoom),
```

- [ ] **Step 4: Add the Fit page option and the sizing box**

Replace the zoom `<select>`'s options with:

```html
                    <option value="fit">Fit width</option>
                    <option value="page">Fit page</option>
                    <option value="1">100%</option>
                    <option value="1.5">150%</option>
```

Replace the `#sheetWrap` markup with:

```html
    <div id="sheetWrap" class="overflow-auto pb-8">
        <!-- #sheetBox exists purely to reserve the sheet's *scaled* size.
             transform: scale() does not affect layout, so the wrapper used to
             reserve the sheet's full unscaled height — 363px of blank scroll
             below a fit-zoomed sheet, plus a phantom horizontal scrollbar. -->
        <div id="sheetBox">
            <div id="sheet" class="sheet">
                <div id="grid"></div>
            </div>
        </div>
    </div>
```

In the `@media print` block, add next to the `#sheetWrap` rule:

```css
        #sheetBox { width: auto !important; height: auto !important; }
```

- [ ] **Step 5: Rewrite applyZoom**

Replace the `elZoom` block (currently lines 769-787) with:

```js
    var elZoom = document.getElementById('zoom');
    var elBox = document.getElementById('sheetBox');
    elZoom.value = state.zoom;

    function zoomScale(naturalW, naturalH, wrap) {
        if (state.zoom === 'fit') {
            return naturalW > 0 ? Math.min(1, wrap.clientWidth / naturalW) : 1;
        }
        if (state.zoom === 'page') {
            // Whatever is left of the viewport below the wrapper's top edge,
            // minus the wrapper's own bottom padding (pb-8 = 32px).
            var room = window.innerHeight - wrap.getBoundingClientRect().top - 32;
            var byW = naturalW > 0 ? wrap.clientWidth / naturalW : 1;
            var byH = naturalH > 0 && room > 0 ? room / naturalH : 1;
            return Math.min(1, byW, byH);
        }
        return parseFloat(state.zoom);
    }

    function applyZoom() {
        var sheet = document.getElementById('sheet');
        var wrap = document.getElementById('sheetWrap');
        // offsetWidth/Height are untransformed layout pixels, so reading them
        // while a previous scale is still applied is safe.
        var naturalW = sheet.offsetWidth, naturalH = sheet.offsetHeight;
        var scale = zoomScale(naturalW, naturalH, wrap);
        sheet.style.margin = '0'; // centring via margin fights a left-origin scale
        sheet.style.transformOrigin = 'top left';
        sheet.style.transform = 'scale(' + scale + ')';
        elBox.style.width = (naturalW * scale) + 'px';
        elBox.style.height = (naturalH * scale) + 'px';
    }

    // Preview-only: it must not go through setState(), which re-renders the
    // grid and re-encodes every code for a change that moves no ink.
    elZoom.addEventListener('change', function () {
        commitOpen();
        state = normalize(Object.assign({}, state, { zoom: elZoom.value }));
        applyZoom();
        persist();
    });
    // The sheet's natural size does not change on resize, but the wrap's
    // available width — and the viewport height "fit page" reads — do.
    window.addEventListener('resize', applyZoom);
```

Note the `Object.assign` here is the one place the file needs it; jsdom and every supported
browser have it, and it avoids restating the shallow-merge loop from `setState`.

Delete the trailing `applyZoom();` call at the very end of the IIFE — `render()` already
reaches it through `applySheetChrome()`, and calling it before `elBox` exists would throw.
Keep the final `render();`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js layout.test.js`
Expected: PASS.

- [ ] **Step 7: Update the design spec's state block**

In `docs/superpowers/specs/2026-09-19-mass-qr-design.md`, add `zoom: 'fit',` to the state
example with the comment `// 'fit' | 'page' | '1' | '1.5' — preview only`, and amend the
"Screen zoom" line under Layout to read:

> Screen zoom (Fit width / Fit page / 100% / 150%) is a `transform: scale()` on the sheet,
> with `#sheetBox` sized to the scaled result so layout reserves exactly what is drawn. It
> never touches the sheet's real dimensions, so the 100% preview is true-to-scale. It lives
> in state like every other control, but changing it re-scales without re-rendering.

- [ ] **Step 8: Run the full suite**

Run: `cd test && npm test`
Expected: PASS, 87 tests, 0 fail.

- [ ] **Step 9: Commit**

```bash
git add themes/klmn-theme/layouts/tools/mass-qr.html test/mass-qr.test.js test/layout.test.js docs/superpowers/specs/2026-09-19-mass-qr-design.md
git commit -m "persist zoom and stop a scaled sheet reserving a page of empty scroll"
```

---

### Task 6: Escape and Enter in the tile editor

Fixes the editor half of spec F9.

**Files:**
- Modify: `themes/klmn-theme/layouts/tools/mass-qr.html:461-513` (`buildEditor`)
- Test: `test/mass-qr.test.js`

**Interfaces:**
- Consumes: `commitEditor(cell, pos)`, `focusCell(pos)`, `editing`, `render()` (all existing).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Append to `test/mass-qr.test.js`:

```js
// ── Editor keyboard ────────────────────────────────────────────────

function keydown(p, el, key) {
  el.dispatchEvent(new p.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

test('Enter in the editor commits the tile', () => {
  const p = page();
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  p.doc.querySelector('.f-url').value = 'https://school.edu/typed';
  p.doc.querySelector('.f-label').value = 'Typed';
  keydown(p, p.doc.querySelector('.f-url'), 'Enter');

  assert.equal(p.doc.querySelectorAll('.cell.is-editing').length, 0, 'editor closed');
  assert.deepEqual(p.window.massQr.getState().tiles['0,0'],
    { u: 'https://school.edu/typed', l: 'Typed', d: '' });
});

test('Escape in the editor discards the edit', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/keep', l: 'Keep', d: '' } });
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  p.doc.querySelector('.f-url').value = 'https://school.edu/discard';
  keydown(p, p.doc.querySelector('.f-url'), 'Escape');

  assert.equal(p.doc.querySelectorAll('.cell.is-editing').length, 0, 'editor closed');
  assert.equal(p.window.massQr.getState().tiles['0,0'].u, 'https://school.edu/keep',
    'the typed value was thrown away');
});

test('Escape on a fresh empty cell leaves it empty', () => {
  const p = page();
  p.click(p.doc.querySelector('.cell[data-pos="1,1"]'));
  p.doc.querySelector('.f-url').value = 'https://school.edu/never';
  keydown(p, p.doc.querySelector('.f-url'), 'Escape');
  assert.ok(!p.window.massQr.getState().tiles['1,1']);
  assert.ok(p.doc.querySelector('.cell[data-pos="1,1"]').classList.contains('is-empty'));
});

test('Enter on the Delete button deletes rather than commits', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/gone', l: 'Gone', d: '' } });
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  const del = p.doc.querySelector('.f-delete');
  keydown(p, del, 'Enter');
  p.click(del); // the browser's own activation, which follows the keydown
  assert.ok(!p.window.massQr.getState().tiles['0,0'], 'the tile is gone');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js`
Expected: FAIL — after Enter the editor is still open and `tiles['0,0']` is undefined; after
Escape the editor is still open.

- [ ] **Step 3: Add the keydown handler**

In `buildEditor`, immediately after `cell.appendChild(editor);`, add:

```js
        // Enter commits, Escape discards. Without these the only way out of
        // an editor was the mouse — Done, or a click somewhere else.
        editor.addEventListener('keydown', function (e) {
            // Buttons carry their own activation: a keydown here would commit
            // and rebuild the grid before the button's click ever fires, so
            // Enter on Delete would silently become Enter on Done.
            if (e.target.tagName === 'BUTTON') return;
            if (e.key === 'Enter') {
                e.preventDefault();
                commitEditor(cell, pos);
                focusCell(pos);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                // Clearing `editing` before render() rebuilds the cell from
                // the state that was there before the edit — the fields only
                // ever lived in the DOM, so dropping them discards the edit.
                editing = null;
                render();
                focusCell(pos);
            }
        });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd test && npm test`
Expected: PASS, 91 tests, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add themes/klmn-theme/layouts/tools/mass-qr.html test/mass-qr.test.js
git commit -m "let Enter commit and Escape discard a tile edit"
```

---

### Task 7: Group the control strip and label it honestly

Fixes the remaining parts of spec F9.

**Files:**
- Modify: `themes/klmn-theme/layouts/tools/mass-qr.html:101-202` (controls markup), `syncCustomInputs` (`:712-724`)
- Test: `test/mass-qr.test.js`

**Interfaces:**
- Consumes: every control id already wired (`cols`, `rows`, `mg`, `gp`, `paper`, `cw`, `ch`, `cu`, `orient`, `ecc`, `qz`, `capPos`, `capSize`, `fg`, `bg`, `zoom`, `btnPrint`, `warn`).
- Produces: DOM `#customNote`. **No ids change** — every existing test and handler keeps working.

- [ ] **Step 1: Write the failing tests**

Append to `test/mass-qr.test.js`:

```js
// ── Control strip ──────────────────────────────────────────────────

test('controls are grouped, and every one still resolves by id', () => {
  const { doc, $ } = page();
  const groups = [...doc.querySelectorAll('#controls fieldset legend')].map((l) => l.textContent.trim());
  assert.deepEqual(groups, ['Sheet', 'Codes', 'Preview']);

  for (const id of ['cols', 'rows', 'mg', 'gp', 'paper', 'cw', 'ch', 'cu', 'orient',
                    'ecc', 'qz', 'capPos', 'capSize', 'fg', 'bg', 'zoom', 'btnPrint', 'warn']) {
    assert.ok($(id), `#${id} still exists`);
  }
});

test('the colour and caption controls say what they do', () => {
  const { doc } = page();
  const label = (id) => doc.querySelector('label[for="' + id + '"]').textContent.trim();
  assert.equal(label('fg'), 'Code colour');
  assert.equal(label('bg'), 'Sheet colour');
  assert.equal(label('capPos'), 'Caption position');
});

test('a landscape custom sheet says what it will actually print', () => {
  const p = page();
  assert.ok(p.$('customNote').hidden, 'nothing to say for A4 portrait');
  p.window.massQr.setState({ paper: 'custom', cw: 120, ch: 180, orient: 'l' });
  assert.ok(!p.$('customNote').hidden);
  // paperDims swaps the pair for landscape, so the fields read 120 x 180
  // while the paper is 180 x 120 — say so rather than let them contradict.
  assert.match(p.$('customNote').textContent, /180\s*×\s*120\s*mm/);

  p.window.massQr.setState({ orient: 'p' });
  assert.ok(p.$('customNote').hidden, 'portrait needs no note');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js`
Expected: FAIL — no `fieldset`/`legend` elements, label text is `Code`/`Background`/`Caption`,
`#customNote` is null.

- [ ] **Step 3: Restructure the control strip**

Replace the contents of `#controls` in `mass-qr.html` with three fieldsets. Keep every
`id`, every `class` on the inputs, and the existing DOM order within each group:

```html
        <div class="flex flex-wrap gap-x-8 gap-y-5">
            <fieldset class="flex flex-wrap items-end gap-3">
                <legend class="form-label mb-1 w-full">Sheet</legend>
                <!-- paper, customDims, customNote, orient, cols, rows, mg, gp go here,
                     each in the same <div><label class="form-label">…</label>…</div>
                     wrapper they already use. -->
            </fieldset>
            <fieldset class="flex flex-wrap items-end gap-3">
                <legend class="form-label mb-1 w-full">Codes</legend>
                <!-- ecc, qz, fg, bg, capPos, capSize -->
            </fieldset>
            <fieldset class="flex flex-wrap items-end gap-3">
                <legend class="form-label mb-1 w-full">Preview</legend>
                <!-- zoom, btnPrint -->
            </fieldset>
        </div>
        <p id="warn" class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-3 no-print" hidden></p>
        <p class="basis-full text-xs text-slate-500 mt-3 no-print">
            In the print dialog pick the same paper size as above, set Margins to
            <strong>None</strong> and Scale to <strong>100%</strong>. Anything else and the
            browser rescales the sheet, so the codes print at the wrong physical size.
        </p>
```

Move each existing control `<div>` into its group verbatim. While moving, change three
label texts only:

- `<label class="form-label" for="fg">Code</label>` → `Code colour`
- `<label class="form-label" for="bg">Background</label>` → `Sheet colour`
- `<label class="form-label" for="capPos">Caption</label>` → `Caption position`

Immediately after the `#customDims` div, add:

```html
                <p id="customNote" class="basis-full text-xs text-slate-500" hidden></p>
```

Delete the standalone print-dialog `<p>` added inside the flex row in Task 3 — it now lives
below the fieldsets.

- [ ] **Step 4: Fill in the landscape note**

In `syncCustomInputs()`, after the `elCustom.hidden` assignment and **before** its early
return, add:

```js
        // Width/Height are the sheet as typed; paperDims() swaps them for
        // landscape, so the fields would otherwise silently contradict the
        // paper that comes out of the printer.
        var note = document.getElementById('customNote');
        note.hidden = state.paper !== 'custom' || state.orient !== 'l';
        if (!note.hidden) {
            var d = paperDims(state);
            note.textContent = 'Prints ' + d[0] + ' × ' + d[1] + ' mm (landscape)';
        }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js`
Expected: PASS.

- [ ] **Step 6: Check the strip visually at two widths**

Run:

```bash
cd test && node -e "
const { withSheet, closeAll } = require('./cdp');
const fs = require('fs');
(async () => {
  for (const w of [1400, 760]) {
    await withSheet({v:1,rows:2,cols:2,paper:'custom',cw:120,ch:180,cu:'mm',orient:'l',ecc:'Q',capPos:'above',capSize:'m',fg:'#000000',bg:'#ffffff',qz:4,mg:10,gp:4,zoom:'fit',tiles:{}}, async (p) => {
      await p.setViewport(w, 900);
      const m = await p.evalJson(\"(function(){var r=[];document.querySelectorAll('#controls fieldset').forEach(function(f){var b=f.getBoundingClientRect();r.push({legend:f.querySelector('legend').textContent.trim(),top:Math.round(b.top),h:Math.round(b.height)});});return r;})()\");
      console.log(w, JSON.stringify(m));
    });
  }
  await closeAll();
})();"
```

Expected: at 1400px the three fieldsets share a row (equal `top`); at 760px they stack
(increasing `top`) without any group splitting across a wrap boundary. If a group splits,
add `min-w-max` to that fieldset and re-run.

- [ ] **Step 7: Run the full suite**

Run: `cd test && npm test`
Expected: PASS, 94 tests, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add themes/klmn-theme/layouts/tools/mass-qr.html test/mass-qr.test.js
git commit -m "group the controls and name the ones that were guessing games"
```

---

### Task 8: Share the contrast and quiet-zone warnings with the QR tool

Fixes spec F10.

**Files:**
- Modify: `static/tools/qr/qr-render.js`
- Modify: `themes/klmn-theme/layouts/tools/qr.html:215-237` (delete local helpers), `:298` (call the shared one)
- Modify: `themes/klmn-theme/layouts/tools/mass-qr.html` — `applyWarning` (from Task 4), the stale comment at `:431-433`
- Test: `test/mass-qr.test.js` (existing `test/qr.test.js` must pass unchanged)

**Interfaces:**
- Consumes: `applyWarning()` and `densityNote(s)` from Task 4.
- Produces: `qrRender.contrastNote(fg, bg) -> string|null` — the same text the QR tool has
  emitted since it shipped. Returns `null` when the pair is fine.

- [ ] **Step 1: Write the failing tests**

Append to `test/mass-qr.test.js`:

```js
// ── Scanning warnings ──────────────────────────────────────────────

test('an inverted sheet warns that scanners will not read it', () => {
  const p = page();
  p.setInput(p.$('fg'), '#ffffff');
  p.setInput(p.$('bg'), '#000000');
  assert.ok(!p.$('warn').hidden);
  assert.match(p.$('warn').textContent, /lighter than your background/);
});

test('a low-contrast sheet warns with the ratio', () => {
  const p = page();
  p.setInput(p.$('fg'), '#777777');
  p.setInput(p.$('bg'), '#999999');
  assert.match(p.$('warn').textContent, /contrast between the two colors/);
});

test('a quiet zone below spec warns', () => {
  const p = page();
  fireChange(p, p.$('qz'), '1');
  assert.match(p.$('warn').textContent, /quiet zone under 4 modules/);
});

test('a grid that does not fit outranks the colour advice', () => {
  const p = page();
  p.window.massQr.setState({ paper: 'custom', cw: 50, ch: 50, rows: 6, cols: 6,
                             fg: '#ffffff', bg: '#000000' });
  assert.match(p.$('warn').textContent, /use up the whole sheet/,
    'the sheet being unbuildable matters more than its colours');
});

test('the default sheet is quiet', () => {
  assert.ok(page().$('warn').hidden);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js`
Expected: FAIL — `#warn` stays hidden for every colour and quiet-zone case.

- [ ] **Step 3: Move the helpers into the shared renderer**

In `static/tools/qr/qr-render.js`, add above the `global.qrRender = …` line:

```js
    function luminance(hex) {
        var c = [1, 3, 5].map(function (i) {
            var v = parseInt(hex.substr(i, 2), 16) / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }

    // Advice on a foreground/background pair, or null if the pair is fine.
    // Shared because both tools offer the same two colour pickers and the
    // same footgun; mass-qr prints up to 36 codes at once, so an unscannable
    // sheet costs 36 times as much there as it does on the single-code tool.
    function contrastNote(fg, bg) {
        var lf = luminance(fg), lb = luminance(bg);
        var ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
        if (lf > lb) {
            return 'Your foreground is lighter than your background. Most scanners expect a dark code ' +
                   'on a light field and will not read an inverted one.';
        }
        if (ratio < 3) {
            return 'Only ' + ratio.toFixed(1) + ':1 contrast between the two colors. Aim for 3:1 or ' +
                   'more, or scanners will struggle.';
        }
        return null;
    }
```

and change the export to:

```js
    global.qrRender = { toSvgString: toSvgString, contrastNote: contrastNote };
```

- [ ] **Step 4: Point the QR tool at the shared helper**

In `themes/klmn-theme/layouts/tools/qr.html`, delete the local `luminance` and
`contrastNote` functions and the `/* ── Contrast guard ── */` banner, then change the single
call site (currently `var note = contrastNote(fg, bg);`) to:

```js
            var note = qrRender.contrastNote(fg, bg);
```

This is behaviour-neutral: the text is byte-identical and `test/qr.test.js`'s
`contrast guard warns on inverted colors` must pass unchanged.

- [ ] **Step 5: Chain the warnings in mass-qr**

Replace `applyWarning()` (added in Task 4) with:

```js
    // Precedence: a sheet that cannot be built at all, then a quiet zone
    // below spec, then colours. Only one line of advice at a time — the first
    // problem is the one worth fixing.
    function applyWarning() {
        var note = densityNote(state);
        if (!note && state.qz < 4) {
            note = 'A quiet zone under 4 modules is below spec — test carefully before printing.';
        }
        if (!note) note = qrRender.contrastNote(state.fg, state.bg);
        elWarn.hidden = !note;
        if (note) elWarn.textContent = note;
    }
```

- [ ] **Step 6: Fix the stale quiet-zone comment**

In `buildTile`, replace the comment above the `qrRender.toSvgString` call — it still claims
the 4-module quiet zone is enforced, which has not been true since the control shipped:

```js
            // The quiet zone is the user's call (0-8 modules) and the grid gap
            // cannot substitute for it — the gap is millimetres, the zone is
            // modules. Anything under 4 is below spec; applyWarning() says so
            // rather than this code silently overriding the choice.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd test && node --test --test-concurrency=1 mass-qr.test.js qr.test.js`
Expected: PASS, including the untouched `contrast guard warns on inverted colors`.

- [ ] **Step 8: Run the full suite**

Run: `cd test && npm test`
Expected: PASS, 99 tests, 0 fail.

- [ ] **Step 9: Commit**

```bash
git add static/tools/qr/qr-render.js themes/klmn-theme/layouts/tools/qr.html themes/klmn-theme/layouts/tools/mass-qr.html test/mass-qr.test.js
git commit -m "share the contrast guard with mass-qr and warn on a quiet zone below spec"
```

---

### Task 9: Correct the page copy and re-measure the sheet end to end

The header still promises behaviour the tool never had, and every measured number in the
spec should be re-taken against the finished tool.

**Files:**
- Modify: `themes/klmn-theme/layouts/tools/mass-qr.html:93-99` (page header copy)
- Modify: `docs/superpowers/specs/2026-09-20-mass-qr-layout-fixes.md` (verification record)
- Test: `test/layout.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `test/layout.test.js`:

```js
// The regression that started all of this, stated as one property: on a sheet
// with mixed captions, every code is the same size, every code in a row shares
// a top edge, and the space left over is split evenly above and below.
test('a mixed-caption sheet is uniform end to end', { skip: !CHROME && 'no Chrome' }, async () => {
  const cells = await withSheet(MIXED, (p) => p.evalJson(PROBE));
  const sides = cells.map((c) => c.qrSide);
  assert.ok(Math.max(...sides) - Math.min(...sides) < 0.5, 'codes are one size');

  const slack = await withSheet(MIXED, (p) => p.evalJson(`(function () {
    var out = [];
    document.querySelectorAll('#grid .cell.is-filled').forEach(function (cell) {
      var cr = cell.querySelector('.code').getBoundingClientRect();
      var sr = cell.querySelector('.code svg').getBoundingClientRect();
      var side = Math.min(sr.width, sr.height);
      out.push({ above: (cr.height - side) / 2, below: (cr.height - side) / 2 });
    });
    return out;
  })()`));
  slack.forEach(function (s, i) {
    assert.ok(Math.abs(s.above - s.below) < 0.5, `tile ${i} slack is lopsided`);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd test && node --test --test-concurrency=1 layout.test.js`
Expected: PASS (Tasks 1-8 already satisfy it). If it fails, the regression is real — fix
before continuing.

- [ ] **Step 3: Correct the page copy**

Replace the header paragraph in `mass-qr.html`:

```html
        <p class="text-slate-600 mt-2 max-w-2xl">
            Fill a grid with links, print one page, pin it to the board. Every code comes out
            the same size on a sheet that fits exactly one page &mdash; margin, gutter and
            paper size are yours to set, and the preview is the page that prints.
        </p>
```

The old copy claimed codes "resize to fill the sheet", which was never true: a square code in
a non-square cell is bounded by the shorter side. Margin and gutter are the honest lever, and
now they are controls.

- [ ] **Step 4: Re-measure and record**

Run:

```bash
cd test && node -e "
const { withSheet, closeAll } = require('./cdp');
const MIXED = {v:1,rows:2,cols:2,paper:'a4',orient:'p',ecc:'Q',capPos:'above',capSize:'m',
  fg:'#000000',bg:'#ffffff',cw:210,ch:297,cu:'mm',qz:4,mg:10,gp:4,zoom:'fit',tiles:{
  '0,0':{u:'https://school.edu/schedule',l:'Schedule',d:'Bell times'},
  '0,1':{u:'https://school.edu/lunch',l:'Lunch',d:''},
  '1,0':{u:'https://school.edu/portal',l:'Portal',d:''},
  '1,1':{u:'https://school.edu/news',l:'News',d:'Weekly newsletter'}}};
withSheet(MIXED, (p) => p.evalJson(\"(function(){var o=[];document.querySelectorAll('#grid .cell.is-filled').forEach(function(c){var r=c.querySelector('.code').getBoundingClientRect();var s=c.querySelector('.code svg').getBoundingClientRect();o.push({pos:c.dataset.pos,codeH:+r.height.toFixed(1),qrSide:+Math.min(s.width,s.height).toFixed(1),qrTop:+s.top.toFixed(1)});});return o;})()\"))
  .then((r) => { console.log(JSON.stringify(r, null, 2)); return closeAll(); });"
```

Append the output to `docs/superpowers/specs/2026-09-20-mass-qr-layout-fixes.md` under a new
`## Verified after implementation` heading, alongside the final test count from `npm test`.
The "before" table in F1 stays as written — it is the record of what was wrong.

- [ ] **Step 5: Run the full suite one last time**

Run: `cd test && npm test`
Expected: PASS, 100 tests, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add themes/klmn-theme/layouts/tools/mass-qr.html test/layout.test.js docs/superpowers/specs/2026-09-20-mass-qr-layout-fixes.md
git commit -m "say what the sheet actually does, and record the measurements that prove it"
```

---

## Self-Review

**Spec coverage.** F1 → Task 1. F2 → Tasks 1 (centring) and 4 (margin/gutter). F3 → Task 2.
F4 → Task 2. F5 → Task 2. F6 → Task 4. F7 → Task 5. F8 → Task 3. F9 → Tasks 5 (zoom),
6 (Escape/Enter) and 7 (grouping, labels, landscape note). F10 → Task 8. The spec's "page
copy is false" note under F2 → Task 9. Every decision in the spec's decision table maps to a
task; `MAX` is explicitly out of scope in both documents.

**Type consistency.** `clampMm(n, lo, hi, dflt)` (Task 4) is distinct from the existing
`clamp` (integers) and `clampDim` (paper dimensions, own bounds) — three clamps, three
purposes, checked against `mass-qr.html:242-260`. `applyWarning()` is defined in Task 4 and
rewritten, not duplicated, in Task 8. `densityNote(s)` and `cellMm(s)` both take the whole
state. `qrRender.contrastNote(fg, bg)` is the name used in Tasks 3 (export), 4 (QR tool call
site) and 5 (mass-qr call site) of Task 8. `withSheet(state, fn)` / `page.evalJson(expr)` /
`page.setViewport(w, h)` / `page.blockUrls(patterns)` / `page.printToPDF(opts)` / `closeAll()`
are used with those exact signatures in Tasks 1, 2, 3, 4, 5, 7 and 9.

**Running test count.** 66 → 71 (T1) → 75 (T2) → 76 (T3) → 82 (T4) → 87 (T5) → 91 (T6) →
94 (T7) → 99 (T8) → 100 (T9). If a task's actual count differs, the discrepancy is a real
signal — find out why before moving on rather than editing the number.

**Ordering constraint.** Task 1 must go first: it builds `test/cdp.js`, which Tasks 2, 3, 4,
5, 7 and 9 all depend on. Task 4 must precede Task 8 (which rewrites `applyWarning` and
reuses `#warn`). Task 3's print-dialog `<p>` is relocated by Task 7, so Task 7 must come
after Task 3. Tasks 5 and 6 are independent of each other.
