'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSite } = require('./harness');
const { withPage, closeAll, CHROME } = require('./cdp');

// The engine is WebAssembly, which jsdom cannot run, so every test here is a
// real-Chrome test. They exercise the page and the engine together: the
// engine's files are replaced by adraw's deploy, and this is what has to keep
// passing when they are.
buildSite();

test.after(closeAll);

const skip = !CHROME && 'no Chrome';

// Polls until the expression is truthy; the engine has to download and
// compile before anything draws.
async function waitFor(page, expr, what) {
  for (let i = 0; i < 200; i++) {
    try { if (await page.evalJson(expr)) return; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  const notice = await page.evalJson("document.getElementById('notice').textContent");
  throw new Error(`timed out waiting for ${what}${notice ? ' — notice: ' + notice : ''}`);
}

const drawn = (name) => `document.getElementById('specPatch').textContent === ${JSON.stringify(name)}
  && +document.getElementById('specPaths').textContent > 0`;

// With no pattern in the link, the page opens on the first thumbnail, whose
// order adraw.json decides — so the tests ask rather than assume.
const drawnFirst = `!!document.querySelector('.pattern-tile')
  && document.getElementById('specPatch').textContent ===
     document.querySelector('.pattern-tile').getAttribute('data-patch')
  && +document.getElementById('specPaths').textContent > 0`;

// Captures the next download instead of letting Chrome save it, into
// window.__download as { name, text }. evalJson stringifies what it is given,
// so a test cannot simply return the promise.
const CAPTURE = `(function () {
  window.__download = null;
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    HTMLAnchorElement.prototype.click = click;
    var name = this.download;
    fetch(this.href).then(function (r) { return r.text(); })
      .then(function (text) { window.__download = { name: name, text: text }; });
  };
  return true;
})()`;

async function download(page, button) {
  await page.evalJson(CAPTURE);
  await page.evalJson(`(document.getElementById(${JSON.stringify(button)}).click(), true)`);
  await waitFor(page, 'window.__download', 'the download');
  return page.evalJson('window.__download');
}

test('the default pattern draws on load', { skip }, async () => {
  await withPage('/tools/adraw/', async (p) => {
    await waitFor(p, drawnFirst, 'the first drawing');
    const m = await p.evalJson(`({ w: document.getElementById('canvas').width,
      first: document.querySelector('.pattern-tile').getAttribute('data-patch'),
      search: location.search, notice: document.getElementById('notice').classList.contains('hidden') })`);
    assert.ok(m.w > 100, `canvas is ${m.w}px wide`);
    assert.ok(m.search.indexOf('patch=' + m.first) >= 0, 'the address bar mirrors the drawing');
    assert.ok(m.notice, 'no error is showing');
  });
});

test('every pattern the engine reports can be picked and drawn', { skip }, async () => {
  await withPage('/tools/adraw/', async (p) => {
    await waitFor(p, drawnFirst, 'the first drawing');
    const names = await p.evalJson(
      "Array.prototype.map.call(document.querySelectorAll('#patch option'), function (o) { return o.value; })");
    assert.ok(names.length >= 10, `only ${names.length} patterns listed`);
    for (const name of names) {
      await p.evalJson(`(function () { var s = document.getElementById('patch');
        s.value = ${JSON.stringify(name)}; s.dispatchEvent(new Event('change')); return true; })()`);
      await waitFor(p, drawn(name), `pattern ${name}`);
      const sliders = await p.evalJson("document.querySelectorAll('#params input[type=range]').length");
      assert.ok(sliders > 0, `${name} has no controls`);
    }
  });
});

test('a shared link reopens the same drawing', { skip }, async () => {
  await withPage('/tools/adraw/?patch=topo&seed=5&page=210x297&levels=10', async (p) => {
    await waitFor(p, drawn('topo'), 'the linked drawing');
    const m = await p.evalJson(`({ seed: document.getElementById('seed').value,
      w: document.getElementById('pageW').value, h: document.getElementById('pageH').value,
      preset: document.getElementById('pagePreset').selectedOptions[0].textContent,
      levels: document.getElementById('p-levels').value,
      page: document.getElementById('specPage').textContent })`);
    assert.deepEqual([m.seed, m.w, m.h, m.levels], ['5', '210', '297', '10']);
    assert.equal(m.preset, 'A4 portrait', 'typed sizes select their preset');
    assert.equal(m.page, '210 × 297 mm');
  });
});

test('a mangled link still opens a drawing', { skip }, async () => {
  await withPage('/tools/adraw/?patch=nope&seed=x&page=abc&cell=wat', async (p) => {
    await waitFor(p, drawnFirst, 'the fallback drawing');
  });
});

test('SVG and G-code downloads carry the drawing and its settings', { skip }, async () => {
  await withPage('/tools/adraw/?patch=hatch&seed=9', async (p) => {
    await waitFor(p, drawn('hatch'), 'the drawing');

    const svg = await download(p, 'btnSvg');
    assert.equal(svg.name, 'hatch-9.svg');
    assert.match(svg.text, /<svg[^>]+viewBox/);
    assert.match(svg.text, /<path/);
    assert.match(svg.text, /seed=9/, 'the file records how to reproduce it');

    const gcode = await download(p, 'btnGcode');
    assert.equal(gcode.name, 'hatch-9.nc');
    assert.match(gcode.text, /^G1 /m);
  });
});

test('Wiggle hands the drawing to the Wiggler, which loads it once', { skip }, async () => {
  await withPage('/tools/adraw/?patch=hatch&seed=9', async (p) => {
    await waitFor(p, drawn('hatch'), 'the drawing');
    const h = await p.evalJson(`(function () {
      var opened = null;
      window.open = function (url) { opened = url; return {}; };
      document.getElementById('btnWiggle').click();
      var h = JSON.parse(localStorage.getItem('klmn:wiggler-handoff'));
      return { opened: opened, name: h.name, svg: h.svg };
    })()`);
    assert.equal(h.opened, '../wiggler/');
    assert.equal(h.name, 'hatch-9.svg');
    assert.match(h.svg, /^<svg[^>]+viewBox/);
    assert.match(h.svg, /<path d="M/);
  });
  await withPage('/tools/wiggler/', async (p) => {
    await waitFor(p, "document.getElementById('filenameEl').textContent === 'hatch-9.svg'", 'the handoff');
    const m = await p.evalJson(`({ run: document.getElementById('btnRun').disabled,
      left: localStorage.getItem('klmn:wiggler-handoff') })`);
    assert.equal(m.run, false, 'Run is enabled');
    assert.equal(m.left, null, 'the handoff is taken once');
  });
});

test('every thumbnail is drawn, and picking one switches the pattern', { skip }, async () => {
  await withPage('/tools/adraw/', async (p) => {
    await waitFor(p, drawnFirst, 'the first drawing');
    await waitFor(p, `Array.prototype.every.call(document.querySelectorAll('.pattern-tile canvas'),
      function (c) { return c.width > 0; })`, 'every thumbnail');
    await p.evalJson("(document.querySelector('.pattern-tile[data-patch=\"flow\"]').click(), true)");
    await waitFor(p, drawn('flow'), 'the picked pattern');
    const on = await p.evalJson("document.querySelector('.pattern-tile.is-on').getAttribute('data-patch')");
    assert.equal(on, 'flow');
  });
});

test('printing sends the drawing alone, as vector lines at true size', { skip }, async () => {
  await withPage('/tools/adraw/?patch=topo&page=297x210', async (p) => {
    await waitFor(p, drawn('topo'), 'the drawing');
    await p.emulateMedia('print');
    await waitFor(p, "!!document.querySelector('#printArea svg')", 'the print SVG');
    const m = await p.evalJson(`(function () {
      var svg = document.querySelector('#printArea svg');
      var shown = function (sel) { return getComputedStyle(document.querySelector(sel)).display !== 'none'; };
      return { w: svg.getAttribute('width'), h: svg.getAttribute('height'),
               paths: svg.querySelectorAll('path').length,
               rail: shown('.rail'), canvas: shown('.bed > .trim'), area: shown('#printArea') };
    })()`);
    await p.emulateMedia('');
    assert.deepEqual([m.w, m.h], ['297mm', '210mm']);
    assert.ok(m.paths > 0);
    assert.deepEqual([m.rail, m.canvas, m.area], [false, false, true]);
  });
});

// ── typecloud: the one pattern with a text parameter ─────────────────────────

const BS = String.fromCharCode(92); // a backslash, spelled so no tool layer eats it
const typecloudUrl = (text, extra) =>
  '/tools/adraw/?patch=typecloud&seed=4&fill=0&fonts=1' + (extra || '') + '&text=' + encodeURIComponent(text);

// Types into the text field the way a person does, and waits for the redraw
// to land in the address bar.
async function typeText(page, text) {
  await page.evalJson(`(function () { var t = document.getElementById('p-text');
    t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor(page, `location.search.indexOf(${JSON.stringify('text=' + encodeURIComponent(text).replace(/%20/g, '+'))}) >= 0`,
    'the redraw');
}

test('typecloud gets a text field, not a slider, for its text', { skip }, async () => {
  await withPage('/tools/adraw/?patch=typecloud&seed=4', async (p) => {
    await waitFor(p, drawn('typecloud'), 'the typecloud drawing');
    const m = await p.evalJson(`(function () { var t = document.getElementById('p-text');
      return { tag: t && t.tagName, value: t && t.value,
        sliderForText: !!document.querySelector('input[type="range"][data-key="text"]'),
        sliders: document.querySelectorAll('#params input[type="range"]').length }; })()`);
    assert.equal(m.tag, 'TEXTAREA');
    assert.ok(m.value.indexOf(';') > 0, `the box starts with the engine's default phrases, got "${m.value}"`);
    assert.equal(m.sliderForText, false);
    assert.ok(m.sliders >= 5, `${m.sliders} sliders for the numeric settings`);
  });
});

test('typecloud: ; splits the text into chunks, and typing redraws', { skip }, async () => {
  const count = async (page) => +(await page.evalJson("document.getElementById('specPaths').textContent"));
  let one;
  await withPage(typecloudUrl('HHHH'), async (p) => {
    await waitFor(p, drawn('typecloud'), 'the one-chunk drawing');
    one = await count(p);
  });
  await withPage(typecloudUrl('HHHH;HHHH;HHHH'), async (p) => {
    await waitFor(p, drawn('typecloud'), 'the three-chunk drawing');
    assert.equal(await count(p), one * 3, 'three chunks in one font draw three times the strokes');

    await typeText(p, 'HHHH');
    await waitFor(p, `+document.getElementById('specPaths').textContent === ${one}`, 'the redraw with one chunk');
  });
});

test('typecloud: text, with an escaped semicolon, survives the link and reaches the file', { skip }, async () => {
  const text = 'a' + BS + ';b;c d';
  await withPage(typecloudUrl(text), async (p) => {
    await waitFor(p, drawn('typecloud'), 'the linked drawing');
    assert.equal(await p.evalJson("document.getElementById('p-text').value"), text, 'the box is restored from the link');
    const svg = await download(p, 'btnSvg');
    assert.ok(svg.text.indexOf('text=' + text) >= 0, 'the file records the text it was drawn from');
    assert.equal(await p.evalJson("new URLSearchParams(location.search).get('text')"), text);
  });
});

test('Wiggle hands over a typecloud drawing', { skip }, async () => {
  await withPage('/tools/adraw/?patch=typecloud&seed=4', async (p) => {
    await waitFor(p, drawn('typecloud'), 'the drawing');
    const h = await p.evalJson(`(function () {
      window.open = function () { return {}; };
      document.getElementById('btnWiggle').click();
      var h = JSON.parse(localStorage.getItem('klmn:wiggler-handoff'));
      return { name: h.name, svg: h.svg };
    })()`);
    assert.equal(h.name, 'typecloud-4.svg');
    assert.match(h.svg, /<path d="M/);
  });
});

// ── typecloud with regular fonts: solid letters and the PNG ──────────────────

// Share of the canvas that is dark ink. Line letters leave most of the sheet
// white; solid ones are far heavier.
const INK_SHARE = `(function () {
  var c = document.getElementById('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  var dark = 0, n = d.length / 4;
  for (var i = 0; i < d.length; i += 4) if (d[i] < 110) dark++;
  return dark / n;
})()`;

test('typecloud with regular fonts fills its letters on the canvas', { skip }, async () => {
  let lines, solid;
  await withPage('/tools/adraw/?patch=typecloud&seed=3&style=0', async (p) => {
    await waitFor(p, drawn('typecloud'), 'the line-font drawing');
    lines = await p.evalJson(INK_SHARE);
  });
  await withPage('/tools/adraw/?patch=typecloud&seed=3&style=1', async (p) => {
    await waitFor(p, drawn('typecloud'), 'the regular-font drawing');
    assert.equal(await p.evalJson("document.getElementById('p-style').value"), '1', 'the setting is restored from the link');
    solid = await p.evalJson(INK_SHARE);
  });
  assert.ok(lines < 0.08, `line letters cover ${(lines * 100).toFixed(1)}% of the sheet`);
  assert.ok(solid > 0.2, `solid letters cover only ${(solid * 100).toFixed(1)}% of the sheet`);
});

test('the PNG download is a PNG, named for the pattern and seed', { skip }, async () => {
  await withPage('/tools/adraw/?patch=typecloud&seed=6&style=1', async (p) => {
    await waitFor(p, drawn('typecloud'), 'the drawing');
    await p.evalJson(`(function () {
      window.__png = null;
      var click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        HTMLAnchorElement.prototype.click = click;
        var name = this.download;
        fetch(this.href).then(function (r) { return r.arrayBuffer(); }).then(function (b) {
          window.__png = { name: name, size: b.byteLength, head: Array.prototype.slice.call(new Uint8Array(b, 0, 4)) };
        });
      };
      return true;
    })()`);
    await p.evalJson("(document.getElementById('btnPng').click(), true)");
    await waitFor(p, 'window.__png', 'the PNG');
    const png = await p.evalJson('window.__png');
    assert.equal(png.name, 'typecloud-6.png');
    assert.deepEqual(png.head, [0x89, 0x50, 0x4e, 0x47]);
    assert.ok(png.size > 20000, `the PNG is only ${png.size} bytes`);
  });
});

test('SVG of solid letters still carries their outlines', { skip }, async () => {
  await withPage('/tools/adraw/?patch=typecloud&seed=6&style=1', async (p) => {
    await waitFor(p, drawn('typecloud'), 'the drawing');
    const svg = await download(p, 'btnSvg');
    assert.equal(svg.name, 'typecloud-6.svg');
    assert.match(svg.text, /<path d="M/);
    assert.match(svg.text, /style=1/);
  });
});

test('the Fonts slider of typecloud goes up to 11', { skip }, async () => {
  await withPage('/tools/adraw/?patch=typecloud&seed=2&fonts=11', async (p) => {
    await waitFor(p, drawn('typecloud'), 'the drawing');
    const m = await p.evalJson(`(function () { var s = document.getElementById('p-fonts');
      return { min: s.min, max: s.max, value: s.value }; })()`);
    assert.deepEqual([m.min, m.max, m.value], ['1', '11', '11']);
  });
});
