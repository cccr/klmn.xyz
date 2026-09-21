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

// ── Interactive states ────────────────────────────────────────────────
// A colour pair only exists for real in the state that produces it. The
// earlier contrast pass measured resting states only and called the palette
// AA, which is how a hovered .btn-go shipped with its label the same colour
// as its fill.

const relLum = (css) => {
  const [r, g, b] = css.match(/[\d.]+/g).slice(0, 3).map((n) => {
    n /= 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg, bg) => {
  const [hi, lo] = [relLum(fg), relLum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

// Walks up for the first opaque backdrop, so a transparent control is
// measured against what is actually behind it.
const PROBE = `(function (sel) {
  var e = document.querySelector(sel);
  if (!e) return null;
  var cs = getComputedStyle(e), bg = cs.backgroundColor, n = e;
  while (bg === 'rgba(0, 0, 0, 0)' && (n = n.parentElement)) bg = getComputedStyle(n).backgroundColor;
  return { color: cs.color, bg: bg };
})`;

const STATES = [
  ['/design/', '.ds-ledger .btn-go', 'hover'],
  ['/design/', '.ds-ledger .btn:not(.btn-go)', 'hover'],
  ['/design/', '.seg button.is-on', 'hover'],
  ['/design/', '.seg button:not(.is-on)', 'hover'],
  ['/design/', '.chip', 'hover'],
  ['/design/', '.upload-area', 'hover'],
  ['/design/', '.prose a', null],
  ['/design/', '.prose a', 'hover'],
  ['/', 'body > header nav a', 'hover'],
  ['/', '.index-lede a', null],
  ['/tools/qr/', '.rail-credit a', 'hover'],
  ['/tools/milling/', '.field-value', null],
  ['/tools/milling/', '.rail-hint', null],
];

test('text clears AA in every state, not just at rest',
  { skip: !CHROME && 'no Chrome' }, async () => {
  const failures = [];
  for (const [url, sel, state] of STATES) {
    const seen = await withPage(url, async (p) => {
      await p.setViewport(1280, 900);
      if (state) {
        await p.forcePseudo(sel, [state]);
        // The .12s transition is still interpolating right after the state
        // is pinned; measuring immediately reads a colour that never rests.
        await new Promise((r) => setTimeout(r, 400));
      }
      return p.evalJson(`${PROBE}(${JSON.stringify(sel)})`);
    });
    assert.ok(seen, `${url} has no ${sel} to measure`);
    const c = ratio(seen.color, seen.bg);
    if (c < 4.5) {
      failures.push(`${url} ${sel}${state ? ':' + state : ''} — ${c.toFixed(2)}:1 ` +
                    `(${seen.color} on ${seen.bg})`);
    }
  }
  assert.deepStrictEqual(failures, [], 'below AA:\n  ' + failures.join('\n  '));
});

test('a hovered .btn-go still has a label', { skip: !CHROME && 'no Chrome' }, async () => {
  // The specific collision: .btn:hover and .btn-go:hover have equal
  // specificity, so the fill rule has to restate the colour or the label
  // inherits cyan onto a cyan background.
  const seen = await withPage('/design/', async (p) => {
    await p.setViewport(1280, 900);
    await p.forcePseudo('.ds-ledger .btn-go', ['hover']);
    await new Promise((r) => setTimeout(r, 400));
    return p.evalJson(`${PROBE}('.ds-ledger .btn-go')`);
  });
  assert.notStrictEqual(seen.color, seen.bg, 'the label is the same colour as the fill');
  assert.ok(ratio(seen.color, seen.bg) > 4.5,
    `label to fill is only ${ratio(seen.color, seen.bg).toFixed(2)}:1`);
});

test('<select> is flattened for Safari', () => {
  // Safari's UA stylesheet gives select a 5px radius that `appearance: none`
  // does not clear and Chrome never applies, so on Safari the rail's bottom
  // hairline rendered as a curve on hover. Chrome cannot observe the
  // divergence, so the guard is on the declaration itself.
  const css = stripComments(fs.readFileSync(STYLE, 'utf8'));
  assert.match(css, /(^|\})\s*select\s*\{[^}]*border-radius:\s*0/m,
    'the reset no longer zeroes <select> border-radius; Safari will round the rail again');
});
