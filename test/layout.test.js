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




// The regression that started all of this, stated as one property: on a sheet
// with mixed captions, every code is the same size, every code in a row shares
// a top edge, and the space left over is split evenly above and below.
test('a mixed-caption sheet is uniform end to end', { skip: !CHROME && 'no Chrome' }, async () => {
  const m = await withSheet(MIXED, (p) => p.evalJson(`(function () {
    var out = [];
    document.querySelectorAll('#grid .cell.is-filled').forEach(function (cell) {
      var cr = cell.querySelector('.code').getBoundingClientRect();
      var sr = cell.querySelector('.code svg').getBoundingClientRect();
      var side = Math.min(sr.width, sr.height);
      out.push({ pos: cell.dataset.pos, side: side,
                 above: sr.top - cr.top + (sr.height - side) / 2,
                 below: cr.bottom - sr.bottom + (sr.height - side) / 2 });
    });
    return out;
  })()`));
  assert.equal(m.length, 4);
  const sides = m.map((c) => c.side);
  assert.ok(Math.min(...sides) > 100, 'codes actually rendered');
  assert.ok(Math.max(...sides) - Math.min(...sides) < 0.5, 'codes are one size');
  m.forEach(function (c) {
    assert.ok(Math.abs(c.above - c.below) < 0.5,
      `tile ${c.pos} slack is lopsided: ${c.above.toFixed(1)} above, ${c.below.toFixed(1)} below`);
  });
});
