'use strict';
// The design system page is only worth having if it is complete, and it only
// stays complete if something fails when it is not. These tests are that
// something: add a shared primitive without showing it at /design/ and the
// suite goes red in the same commit that introduced the gap.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildSite, SITE, ROOT } = require('./harness');
const { withPage, closeAll, CHROME } = require('./cdp');

buildSite();
test.after(closeAll);

const STYLE = path.join(ROOT, 'themes/klmn-theme/static/css/style.css');
const DESIGN_CSS = path.join(ROOT, 'static/design/design.css');
const PAGE = fs.readFileSync(path.join(SITE, 'design/index.html'), 'utf8');

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Every selector in the shared stylesheet, with the declaration blocks gone.
function selectorsOf(css) {
  return stripComments(css).replace(/\{[^{}]*\}/g, '{}').match(/[^{}@]+(?=\{)/g) || [];
}

// A name counts as documented if the page either names it (in the ledger, or
// in running copy) or renders something carrying it.
function documented(name) {
  return PAGE.includes('.' + name) || new RegExp(`class="[^"]*\\b${name}\\b`).test(PAGE);
}

test('every class the shared stylesheet defines is shown at /design/', () => {
  const classes = new Set();
  for (const sel of selectorsOf(fs.readFileSync(STYLE, 'utf8'))) {
    for (const m of sel.matchAll(/\.([A-Za-z][\w-]*)/g)) classes.add(m[1]);
  }
  const missing = [...classes].filter((c) => !documented(c)).sort();
  assert.deepStrictEqual(missing, [],
    `style.css defines these and /design/ never shows them: ${missing.join(', ')}`);
  assert.ok(classes.size > 40, `only found ${classes.size} classes — did the parse break?`);
});

test('every token :root defines is shown at /design/', () => {
  // Every :root block, not just the first — a token added in a second one
  // would otherwise slip past this test unnoticed.
  const css = stripComments(fs.readFileSync(STYLE, 'utf8'));
  const tokens = [...css.matchAll(/:root\s*\{([^}]*)\}/g)]
    .flatMap((b) => [...b[1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const missing = tokens.filter((t) => !PAGE.includes(t));
  assert.deepStrictEqual(missing, [],
    `:root defines these and /design/ never names them: ${missing.join(', ')}`);
  assert.ok(tokens.length > 20, `only found ${tokens.length} tokens — did the parse break?`);
});

test('design.css only styles its own scaffolding', () => {
  // The page is a reference, so it has to render the real components. A rule
  // in design.css that reaches a shipped class would make the specimen a
  // drawing of the component instead of the component.
  const offenders = [];
  for (const sel of selectorsOf(fs.readFileSync(DESIGN_CSS, 'utf8'))) {
    for (const part of sel.split(',')) {
      const classes = [...part.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]);
      if (classes.length && !classes.some((c) => c.startsWith('ds-'))) offenders.push(part.trim());
    }
  }
  assert.deepStrictEqual(offenders, [],
    `these reach past the ds- namespace into shipped components: ${offenders.join(' | ')}`);
});

test('/design/ is reachable only by direct link', () => {
  assert.match(PAGE, /<meta name="robots" content="noindex/);

  const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  assert.ok(!sitemap.includes('/design/'), 'the design page is in the sitemap');

  // Nothing else on the site may link to it — not the menu, not an index.
  const linkers = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html') && !p.endsWith('design/index.html')) {
        if (/href="\/design\//.test(fs.readFileSync(p, 'utf8'))) linkers.push(p.slice(SITE.length));
      }
    }
  };
  walk(SITE);
  assert.deepStrictEqual(linkers, [], `these pages link to /design/: ${linkers.join(', ')}`);
});

test('the specimens are the real components, not copies',
  { skip: !CHROME && 'no Chrome' }, async () => {
  const seen = await withPage('/design/', async (p) => {
    await p.setViewport(1280, 1000);
    return p.evalJson(`(function () {
      var root = getComputedStyle(document.documentElement);
      var go = document.querySelector('.ds-ledger .btn-go');
      var swatch = document.querySelector('.ds-swatch');
      return {
        // The one filled button matches the ink token, because style.css
        // painted it — nothing on this page sets a button colour.
        goBg: getComputedStyle(go).backgroundColor,
        ink: root.getPropertyValue('--ink').trim(),
        // design.js reads each hex back out of the stylesheet, so a blank
        // here means a token was renamed and the page did not notice.
        hexes: Array.prototype.map.call(
          document.querySelectorAll('.ds-hex'), function (e) { return e.textContent; }),
        sizes: Array.prototype.map.call(
          document.querySelectorAll('.ds-px'), function (e) { return e.textContent; }),
        marks: getComputedStyle(document.querySelector('.ds-trim-demo')).backgroundImage
      };
    })()`);
  });

  const hex = (h) => 'rgb(' + [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16)).join(', ') + ')';
  assert.strictEqual(seen.goBg, hex(seen.ink), '.btn-go is not filled with --ink');

  assert.strictEqual(seen.hexes.length, 9);
  for (const h of seen.hexes) assert.match(h, /^#[0-9A-Fa-f]{6}$/, `swatch reads "${h}"`);

  assert.strictEqual(seen.sizes.length, 10);
  assert.deepStrictEqual(seen.sizes, ['12 px', '13 px', '14 px', '15 px', '16 px',
                                      '18 px', '20 px', '22 px', '34 px', '40 px']);

  // Four registration marks on the artifact specimen, from --regmark.
  assert.strictEqual(seen.marks.split('url(').length - 1, 4);
});
