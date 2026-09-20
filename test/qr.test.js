'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildSite, loadPage, decodeCanvas, decodeSvgString, SITE } = require('./harness');

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


// The page's styling used to come from a runtime JIT compiler on a CDN. It is
// plain CSS from this origin now, and nothing should quietly put a third-party
// script back — the tests load pages with remote scripts skipped, so one
// creeping back in would be invisible here otherwise.
test('the page loads no third-party script', () => {
  const html = fs.readFileSync(path.join(SITE, 'tools/qr/index.html'), 'utf8');
  const remote = [...html.matchAll(/<script[^>]*\ssrc="(?:https?:)?\/\/[^"]*"/g)].map((m) => m[0]);
  assert.deepEqual(remote, []);
});

// The ECC buttons used to carry their entire appearance in a JS-rewritten
// Tailwind class list. The script now only marks which one is on.
test('the active ECC button is the one marked on', () => {
  const { doc, click } = page();
  click(doc.querySelector('button[data-ecc="HIGH"]'));
  const on = [...doc.querySelectorAll('.qr-seg button')]
    .filter((b) => b.classList.contains('is-on'));
  assert.deepEqual(on.map((b) => b.dataset.ecc), ['HIGH']);
  assert.equal(on[0].getAttribute('aria-pressed'), 'true');
});
