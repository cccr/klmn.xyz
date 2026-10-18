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
