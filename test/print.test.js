'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const { buildSite, SITE } = require('./harness');
const { withSheet, closeAll, CHROME: CDP_CHROME } = require('./cdp');

test.after(closeAll);

// Resolves a real Chrome/Chromium binary across platforms instead of a
// hardcoded macOS path, so this — the sole end-to-end coverage of loading
// state from a real #s= hash, the one-page guarantee, and the @page rule
// actually applying — doesn't silently vanish (green suite, zero coverage)
// on any machine that isn't this one. `CHROME` env var wins if set; the
// skip message names it so the gap is visible instead of invisible.
function resolveChrome() {
  if (process.env.CHROME) {
    if (fs.existsSync(process.env.CHROME)) return process.env.CHROME;
    return null;
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(mac)) return mac;
  const candidates = ['google-chrome', 'chromium', 'chromium-browser'];
  for (const bin of candidates) {
    try {
      const found = execFileSync('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (found) return found;
    } catch (e) { /* not on PATH */ }
  }
  return null;
}

const CHROME = resolveChrome();
const PORT = 8781;

// A sheet of four links, pre-loaded via the URL hash the app itself writes.
const STATE = {
  v: 1, rows: 2, cols: 2, paper: 'a4', orient: 'p', ecc: 'Q',
  capPos: 'above', capSize: 'm', fg: '#000000', bg: '#ffffff',
  tiles: {
    '0,0': { u: 'https://school.edu/schedule', l: 'Schedule', d: 'Bell times' },
    '0,1': { u: 'https://school.edu/lunch', l: 'Lunch', d: '' },
    '1,0': { u: 'https://school.edu/portal', l: 'Portal', d: '' },
    '1,1': { u: 'https://school.edu/news', l: 'News', d: '' }
  }
};

function hashFor(state) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

test('the sheet prints as one page, on whatever paper it is given',
  { skip: !CDP_CHROME && 'no Chrome' }, async () => {
  // Three very different papers. Nothing in the page declares a size any
  // more, so all three must come out as one full page of scannable codes —
  // that is the whole claim the tool now makes about printing.
  const papers = [
    { name: 'A4',      w: 8.27, h: 11.69 },
    { name: 'Letter',  w: 8.5,  h: 11 },
    { name: 'A5-land', w: 8.27, h: 5.83 }
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'massqr-paper-'));
  try {
    await withSheet(STATE, async (p) => {
      for (const paper of papers) {
        const pdf = await p.printToPDF({ preferCSSPageSize: false,
          paperWidth: paper.w, paperHeight: paper.h,
          marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4 });

        const counts = [...pdf.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m2) => +m2[1]);
        assert.equal(Math.max(...counts), 1, `${paper.name}: exactly one page`);

        const f = path.join(tmp, `${paper.name}.pdf`);
        fs.writeFileSync(f, pdf);
        const png = f.replace('.pdf', '.png');
        execFileSync('sips', ['-s', 'format', 'png', f, '--out', png], { stdio: 'ignore' });
        const img = PNG.sync.read(fs.readFileSync(png));

        // Aspect follows the paper, not a hardcoded sheet.
        const ratio = img.height / img.width;
        assert.ok(Math.abs(ratio - paper.h / paper.w) < 0.03,
          `${paper.name}: page follows the paper, got ${ratio.toFixed(3)} want ${(paper.h / paper.w).toFixed(3)}`);

        // Every code still scans. jsQR finds one per call, so crop quadrants.
        const found = [];
        for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const w = Math.floor(img.width / 2), h = Math.floor(img.height / 2);
          const buf = new Uint8ClampedArray(w * h * 4);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const si = ((y + qy * h) * img.width + (x + qx * w)) * 4;
            const di = (y * w + x) * 4;
            buf[di] = img.data[si]; buf[di + 1] = img.data[si + 1];
            buf[di + 2] = img.data[si + 2]; buf[di + 3] = 255;
          }
          const res = jsQR(buf, w, h);
          if (res) found.push(res.data);
        }
        assert.deepEqual(found.sort(), Object.values(STATE.tiles).map((t2) => t2.u).sort(),
          `${paper.name}: all four codes scan`);
      }
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// A custom size is the one paper option with no @page keyword behind it — the
// millimetres come straight from state — so prove the printer honours them.
// 120x180mm at 72dpi is 340.2x510.2pt, a ratio of 1.5 that no preset shares
// (A4 is 1.414, Letter 1.294), so a silent fallback to a preset fails here.
const CUSTOM_STATE = {
  v: 1, rows: 1, cols: 1, paper: 'custom', cw: 120, ch: 180, cu: 'mm',
  orient: 'p', ecc: 'Q', capPos: 'above', capSize: 'm',
  fg: '#000000', bg: '#ffffff',
  tiles: { '0,0': { u: 'https://school.edu/custom', l: 'Custom', d: '' } }
};


// Landscape + a dense grid + large captions is the combination that exposed a
// broken height chain: in print, #sheetWrap loses `overflow: auto`, the grid's
// `height: 100%` went indefinite, and each tile's square SVG then sized itself
// from its intrinsic aspect ratio — pushing the bottom row onto a second page
// while the sheet box itself still measured correctly. Portrait 1x1 and 2x2
// sheets did not reproduce it, so this case is kept explicitly.
const LANDSCAPE_STATE = {
  v: 1, rows: 2, cols: 2, paper: 'custom', cw: 127, ch: 177.8, cu: 'in',
  orient: 'l', ecc: 'Q', capPos: 'above', capSize: 'l', qz: 1,
  fg: '#000000', bg: '#ffffff',
  tiles: {
    '0,0': { u: 'https://test.io/a', l: 'test', d: '' },
    '0,1': { u: 'https://test.io/b', l: 'test.io', d: '' },
    '1,0': { u: 'https://test.io/c', l: 'test.io', d: '' },
    '1,1': { u: 'https://test.io/d', l: 'test.io', d: '' }
  }
};

// Body margin comes only from Tailwind's CDN preflight. Block that script —
// offline, corporate proxy, a slow CDN on the day someone hits Ctrl-P — and
// body keeps its 8px UA margin while the sheet exactly fills the page.
test('the sheet still prints on one page without the Tailwind CDN',
  { skip: !CDP_CHROME && 'no Chrome' }, async () => {
  const pdf = await withSheet(STATE, async (p) => {
    await p.blockUrls(['*cdn.tailwindcss.com*']);
    assert.equal(await p.evalJson("getComputedStyle(document.body).margin"), '8px',
      'precondition: with no preflight, the UA margin is live on screen');

    await p.emulateMedia('print');
    assert.equal(await p.evalJson("getComputedStyle(document.body).margin"), '0px',
      'the print reset does not depend on the CDN');
    await p.emulateMedia('');
    return p.printToPDF();
  });
  const counts = [...pdf.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => +m[1]);
  assert.equal(Math.max(...counts), 1, 'exactly one page');
});
