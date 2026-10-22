'use strict';
// Notes are write-ups of design decisions, kept on the site to be shared by
// direct link. Like /design/, nothing may lead to them: no menu, no index
// page, no sitemap entry, and a noindex for anyone who follows a link in.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildSite, SITE } = require('./harness');
const { withPage, closeAll, CHROME } = require('./cdp');

buildSite();
test.after(closeAll);

const NOTE = '/notes/shelf-house-opening-tile/';

test('notes are reachable only by direct link', () => {
  const page = fs.readFileSync(path.join(SITE, NOTE, 'index.html'), 'utf8');
  assert.match(page, /<meta name="robots" content="noindex/);

  assert.ok(!fs.existsSync(path.join(SITE, 'notes/index.html')), 'the notes section has an index page');
  const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  assert.ok(!sitemap.includes('/notes/'), 'a note is in the sitemap');

  const linkers = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== path.join(SITE, 'notes')) walk(p); }
      else if (/\.(html|xml)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('/notes/')) linkers.push(p.slice(SITE.length));
    }
  };
  walk(SITE);
  assert.deepStrictEqual(linkers, [], `these pages lead to a note: ${linkers.join(', ')}`);
});

// The report ranks its ideas by numbers it measures from its own mock-up, so
// the claim at the top has to hold in the browser: the recommended idea keeps
// the room at its unwrapped size whichever opening's panel is open.
test('the opening-tile report measures what it recommends',
  { skip: !CHROME && 'no Chrome' }, async () => {
  // The report measures once the web fonts are in, so it can land a moment
  // after the page has loaded.
  const rows = await withPage(NOTE, async (p) => {
    await p.setViewport(1400, 1000);
    let found = [];
    for (let i = 0; i < 100 && found.length === 0; i++) {
      found = await p.evalJson(`[...document.querySelectorAll('#ot-report tr[data-tab]')]
        .map((r) => [...r.cells].map((c) => c.textContent.trim()))`);
      if (found.length === 0) await new Promise((res) => setTimeout(res, 50));
    }
    return found;
  });
  assert.strictEqual(rows.length, 6, 'the summary ranks six ideas');
  const [best] = rows;
  assert.strictEqual(best[1], 'Keep the zoom, shaped panel');
  assert.strictEqual(best[4], 'none', 'the recommended idea moves the zoom');
  // Ideas that keep the zoom settle on the same scale to within a pixel of
  // rounding, so a tie counts.
  const area = (s) => s.split(' × ').map(Number).reduce((a, b) => a * b);
  for (const row of rows.slice(1)) {
    assert.ok(area(best[2]) >= 0.98 * area(row[2]), `${row[1]} keeps a bigger room than the recommended idea`);
  }
});
