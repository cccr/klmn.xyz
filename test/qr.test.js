'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSite, loadPage, decodeCanvas, decodeSvgString } = require('./harness');

buildSite();

function page() { return loadPage('tools/qr/index.html'); }

test('empty state disables downloads', () => {
  const { $, canvas } = page();
  assert.equal(canvas.style.display, 'none');
  assert.ok($('btnPng').disabled && $('btnSvg').disabled);
});

test('a URL encodes and decodes from the canvas', () => {
  const { $, setInput, canvas } = page();
  setInput($('payload'), 'https://klmn.xyz');
  assert.equal(decodeCanvas(canvas), 'https://klmn.xyz');
  assert.equal(canvas.width, 264);
  assert.ok(!$('btnPng').disabled);
});

test('every ECC level round-trips', () => {
  const { doc, $, setInput, click, canvas } = page();
  setInput($('payload'), 'https://klmn.xyz');
  for (const lvl of ['LOW', 'MEDIUM', 'QUARTILE', 'HIGH']) {
    click(doc.querySelector(`button[data-ecc="${lvl}"]`));
    assert.equal(decodeCanvas(canvas), 'https://klmn.xyz', lvl);
  }
});

test('SVG export decodes to the same payload', () => {
  const { window, $, setInput, click } = page();
  setInput($('payload'), 'https://klmn.xyz');
  let svg = null;
  window.Blob = function (parts) { this.__text = parts.join(''); };
  window.URL.createObjectURL = (b) => { svg = b.__text; return 'blob:x'; };
  window.URL.revokeObjectURL = () => {};
  click($('btnSvg'));
  assert.ok(svg.startsWith('<?xml'));
  assert.equal(decodeSvgString(svg), 'https://klmn.xyz');
});

test('unicode payloads round-trip', () => {
  const { $, setInput, canvas } = page();
  const text = 'Привет, мир! 🎉 漢字';
  setInput($('payload'), text);
  assert.equal(decodeCanvas(canvas), text);
});

test('overflow shows an error and disables downloads, then recovers', () => {
  const { $, setInput, canvas } = page();
  setInput($('payload'), 'x'.repeat(5000));
  assert.ok(!$('qrError').classList.contains('hidden'));
  assert.ok($('btnPng').disabled);
  setInput($('payload'), 'https://klmn.xyz');
  assert.ok($('qrError').classList.contains('hidden'));
  assert.equal(decodeCanvas(canvas), 'https://klmn.xyz');
});

