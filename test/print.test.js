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

test('the printed PDF is one A4 page with four scannable codes', async (t) => {
  if (!CHROME) return t.skip('No Chrome/Chromium found; set CHROME=<path to binary> to run this test');
  buildSite();

  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: SITE, stdio: 'ignore' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'massqr-'));
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const pdf = path.join(tmp, 'sheet.pdf');
    const url = `http://localhost:${PORT}/tools/mass-qr/#s=${hashFor(STATE)}`;
    execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
      '--virtual-time-budget=6000', `--print-to-pdf=${pdf}`, url
    ], { stdio: 'ignore' });

    assert.ok(fs.existsSync(pdf), 'PDF was produced');

    // Page count: Chrome writes an uncompressed page tree, so /Count is readable.
    const raw = fs.readFileSync(pdf);
    const counts = [...raw.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => +m[1]);
    assert.equal(Math.max(...counts), 1, 'exactly one page');

    // A4 portrait at 72dpi is 595x842pt; allow a point of rounding either way.
    const png = path.join(tmp, 'sheet.png');
    execFileSync('sips', ['-s', 'format', 'png', pdf, '--out', png], { stdio: 'ignore' });
    const img = PNG.sync.read(fs.readFileSync(png));
    const ratio = img.height / img.width;
    assert.ok(Math.abs(ratio - 842 / 595) < 0.02, `A4 aspect ratio, got ${ratio.toFixed(3)}`);

    // Every code must still scan after going through the print pipeline. jsQR
    // finds one code per call, so each quadrant is cropped and decoded alone.
    const found = [];
    const halves = [[0, 0], [1, 0], [0, 1], [1, 1]];
    for (const [qx, qy] of halves) {
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
    assert.deepEqual(found.sort(), Object.values(STATE.tiles).map((t2) => t2.u).sort());
  } finally {
    server.kill();
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

test('a custom paper size prints at its real physical size', async (t) => {
  if (!CHROME) return t.skip('No Chrome/Chromium found; set CHROME=<path to binary> to run this test');
  buildSite();

  const server = spawn('python3', ['-m', 'http.server', String(PORT + 1)], { cwd: SITE, stdio: 'ignore' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'massqr-custom-'));
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const pdf = path.join(tmp, 'custom.pdf');
    const url = `http://localhost:${PORT + 1}/tools/mass-qr/#s=${hashFor(CUSTOM_STATE)}`;
    execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
      '--virtual-time-budget=6000', `--print-to-pdf=${pdf}`, url
    ], { stdio: 'ignore' });

    assert.ok(fs.existsSync(pdf), 'PDF was produced');

    const raw = fs.readFileSync(pdf);
    const counts = [...raw.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => +m[1]);
    assert.equal(Math.max(...counts), 1, 'exactly one page');

    const png = path.join(tmp, 'custom.png');
    execFileSync('sips', ['-s', 'format', 'png', pdf, '--out', png], { stdio: 'ignore' });
    const img = PNG.sync.read(fs.readFileSync(png));
    const ratio = img.height / img.width;
    assert.ok(Math.abs(ratio - 180 / 120) < 0.02, `120x180mm aspect ratio, got ${ratio.toFixed(3)}`);

    const res = jsQR(
      new Uint8ClampedArray(img.data), img.width, img.height
    );
    assert.ok(res, 'the code on a custom-size page still scans');
    assert.equal(res.data, 'https://school.edu/custom');
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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

test('a landscape custom sheet stays on one page and keeps every code', async (t) => {
  if (!CHROME) return t.skip('No Chrome/Chromium found; set CHROME=<path to binary> to run this test');
  buildSite();

  const server = spawn('python3', ['-m', 'http.server', String(PORT + 2)], { cwd: SITE, stdio: 'ignore' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'massqr-land-'));
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const pdf = path.join(tmp, 'landscape.pdf');
    const url = `http://localhost:${PORT + 2}/tools/mass-qr/#s=${hashFor(LANDSCAPE_STATE)}`;
    execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
      '--virtual-time-budget=6000', `--print-to-pdf=${pdf}`, url
    ], { stdio: 'ignore' });

    const raw = fs.readFileSync(pdf);
    const counts = [...raw.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => +m[1]);
    assert.equal(Math.max(...counts), 1, 'one page — a broken height chain spills the bottom row');

    // 5x7in rotated to landscape is 7x5, ratio 0.714.
    const png = path.join(tmp, 'landscape.png');
    execFileSync('sips', ['-s', 'format', 'png', pdf, '--out', png], { stdio: 'ignore' });
    const img = PNG.sync.read(fs.readFileSync(png));
    const ratio = img.height / img.width;
    assert.ok(Math.abs(ratio - 5 / 7) < 0.02, `landscape 7x5 aspect, got ${ratio.toFixed(3)}`);

    // All four must be on this page: the bug put the bottom row on page two,
    // so a quadrant decode is what proves the whole grid actually fits.
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
    assert.deepEqual(found.sort(), Object.values(LANDSCAPE_STATE.tiles).map((x) => x.u).sort());
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
