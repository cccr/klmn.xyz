'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSite } = require('./harness');
const { withPage, withSheet, closeAll, CHROME } = require('./cdp');

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

// Every "they all match" assertion below needs this first. A grid that
// collapses to zero satisfies "all the same height" perfectly, which is
// exactly what an early cut of the caption band did — the sameness tests
// passed while the sheet printed blank.
function assertSubstantial(cells) {
  assert.equal(cells.length, 4);
  cells.forEach(function (c) {
    assert.ok(c.qrSide > 100, `tile ${c.pos} rendered a ${c.qrSide.toFixed(1)}px code`);
    assert.ok(c.codeW > 100, `tile ${c.pos} code box is ${c.codeW.toFixed(1)}px wide`);
  });
}

test('every code box on a sheet is the same height', { skip: !CHROME && 'no Chrome' }, async () => {
  const cells = await withSheet(MIXED, (p) => p.evalJson(PROBE));
  assertSubstantial(cells);
  const heights = cells.map((c) => c.codeH);
  const spread = Math.max(...heights) - Math.min(...heights);
  assert.ok(spread < 0.5, `code box heights differ by ${spread.toFixed(1)}px: ${heights.join(', ')}`);
});

test('codes are the same size and share a top edge across a row',
  { skip: !CHROME && 'no Chrome' }, async () => {
  const cells = await withSheet(MIXED, (p) => p.evalJson(PROBE));
  assertSubstantial(cells);
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
  assertSubstantial(cells);
  for (const row of ['0', '1']) {
    const tops = cells.filter((c) => c.pos[0] === row).map((c) => c.capTop);
    const spread = Math.max(...tops) - Math.min(...tops);
    assert.ok(spread < 0.5,
      `row ${row} captions differ in top edge by ${spread.toFixed(1)}px`);
  }
});

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
  // Resolve the palette from the page rather than hardcoding a hex: the claim
  // is that the tile reads as an error and not as body text, and a repaint
  // should not be able to fail this test without breaking that claim.
  const probe = `(function () {
    var el = document.querySelector('.code.too-long');
    if (!el) return null;
    var swatch = document.createElement('span');
    document.body.appendChild(swatch);
    var resolve = function (v) { swatch.style.color = v; return getComputedStyle(swatch).color; };
    var cs = getComputedStyle(el);
    var out = { text: el.textContent, color: cs.color,
                align: cs.alignItems, justify: cs.justifyContent,
                alert: resolve('var(--alert)'), ink: resolve('var(--ink)') };
    swatch.remove();
    return out;
  })()`;
  const m = await withSheet(state, (p) => p.evalJson(probe));
  assert.ok(m, 'the tile reports its failure');
  assert.equal(m.text, 'Link too long');
  assert.equal(m.color, m.alert, 'painted with the alert colour');
  assert.notEqual(m.color, m.ink, 'and so not mistakable for body text');
  assert.equal(m.align, 'center');
  assert.equal(m.justify, 'center');
});




// The regression that started all of this, restated for the current design:
// every code the same size, aligned across a row, and sitting directly under
// its caption rather than floating in the middle of a tall box.
test('a mixed-caption sheet is uniform end to end', { skip: !CHROME && 'no Chrome' }, async () => {
  const m = await withSheet(MIXED, (p) => p.evalJson(`(function () {
    var out = [];
    document.querySelectorAll('#grid .cell.is-filled').forEach(function (cell) {
      var cr = cell.getBoundingClientRect();
      var cap = cell.querySelector('.cap').getBoundingClientRect();
      var svg = cell.querySelector('.code svg').getBoundingClientRect();
      out.push({ pos: cell.dataset.pos,
                 side: Math.min(svg.width, svg.height),
                 capToCode: svg.top - cap.bottom,
                 overflow: svg.bottom - cr.bottom });
    });
    return out;
  })()`));
  assert.equal(m.length, 4);
  const sides = m.map((c) => c.side);
  assert.ok(Math.min(...sides) > 100, 'codes actually rendered');
  assert.ok(Math.max(...sides) - Math.min(...sides) < 0.5, 'codes are one size');

  // The complaint this replaced: with the code centred in a 1fr row, half the
  // cell's leftover height sat between the label and the code — tens of
  // millimetres on a sparse grid. It is now just the deliberate --cap-gap.
  m.forEach(function (c) {
    assert.ok(c.capToCode >= 0 && c.capToCode < 12,
      `tile ${c.pos}: ${c.capToCode.toFixed(1)}px between caption and code`);
    assert.ok(c.overflow <= 0.5, `tile ${c.pos} overflows its cell by ${c.overflow.toFixed(1)}px`);
  });
  const gaps = m.map((c) => c.capToCode);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.5,
    `caption-to-code gap differs across tiles: ${gaps.map((g) => g.toFixed(1)).join(', ')}`);
});

// A rail full of controls sits in a grid column, and an implicit `auto`
// column cannot shrink below its content's minimum — so one wide control
// widens the column past the viewport instead of wrapping, taking the whole
// document sideways with it. This has now happened twice, from two different
// causes (a max-content fieldset on mass-qr, example thumbnails on wiggler),
// so it is checked on every page rather than on the page it last broke.
test('no page scrolls sideways, down to a phone',
  { skip: !CHROME && 'no Chrome' }, async () => {
  const pages = ['/', '/tools/', '/tools/qr/', '/tools/mass-qr/',
                 '/tools/milling/', '/tools/wiggler/', '/tools/ripple/', '/design/'];
  for (const url of pages) {
    for (const w of [1400, 900, 760, 390]) {
      const [scroll, inner] = await withPage(url, async (p) => {
        await p.setViewport(w, 900);
        return p.evalJson('[document.documentElement.scrollWidth, window.innerWidth]');
      });
      assert.ok(scroll <= inner, `${url} at ${w}px is ${scroll}px wide`);
    }
  }
});
