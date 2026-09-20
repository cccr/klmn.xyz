'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildSite, loadPage, SITE } = require('./harness');

buildSite();

function page(opts) { return loadPage('tools/mass-qr/index.html', opts); }

test('page builds and is reachable at /qrs', () => {
  assert.ok(fs.existsSync(path.join(SITE, 'tools/mass-qr/index.html')));
  const alias = fs.readFileSync(path.join(SITE, 'qrs/index.html'), 'utf8');
  assert.match(alias, /tools\/mass-qr/);
});

test('renders a default 2x2 grid of empty cells', () => {
  const { doc } = page();
  assert.ok(doc.getElementById('sheet'), 'has #sheet');
  const cells = doc.querySelectorAll('#grid .cell');
  assert.equal(cells.length, 4);
  assert.deepEqual([...cells].map((c) => c.dataset.pos), ['0,0', '0,1', '1,0', '1,1']);
  assert.equal(doc.querySelectorAll('#grid .cell.is-empty').length, 4);
});

test('default state matches the spec defaults', () => {
  const { window } = page();
  const s = window.massQr.defaultState();
  assert.equal(s.v, 1);
  assert.equal(s.rows, 2);
  assert.equal(s.cols, 2);
  assert.equal(s.paper, 'a4');
  assert.equal(s.orient, 'p');
  assert.equal(s.ecc, 'Q');
  assert.equal(s.capPos, 'above');
  assert.equal(s.capSize, 'm');
  assert.equal(s.fg, '#000000');
  assert.equal(s.bg, '#ffffff');
  assert.deepEqual(s.tiles, {});
});

test('state round-trips through base64url', () => {
  const { window } = page();
  const s = window.massQr.defaultState();
  s.tiles['0,0'] = { u: 'https://school.edu/schedule', l: 'Schedule', d: 'Bell times' };
  const encoded = window.massQr.encodeState(s);
  assert.doesNotMatch(encoded, /[+/=]/, 'must be URL-safe');
  assert.deepEqual(window.massQr.decodeState(encoded), s);
});

test('non-Latin1 labels survive the round-trip', () => {
  const { window } = page();
  const s = window.massQr.defaultState();
  s.tiles['0,0'] = { u: 'https://школа.рф', l: 'Расписание', d: 'Звонки 🔔' };
  assert.deepEqual(window.massQr.decodeState(window.massQr.encodeState(s)), s);
});

test('garbage and wrong-version hashes decode to null', () => {
  const { window } = page();
  assert.equal(window.massQr.decodeState('!!!not-base64!!!'), null);
  assert.equal(window.massQr.decodeState(''), null);
  assert.equal(window.massQr.decodeState(window.massQr.encodeState({ v: 99 })), null);
});

test('normalize clamps the grid and drops out-of-range tiles', () => {
  const { window } = page();
  const s = window.massQr.normalize({
    v: 1, rows: 99, cols: 0, ecc: 'BOGUS', paper: 'a3',
    tiles: { '0,0': { u: 'a', l: 'A', d: '' }, '5,5': { u: 'b', l: 'B', d: '' } }
  });
  assert.ok(s.rows <= 6 && s.rows >= 1);
  assert.ok(s.cols >= 1);
  assert.equal(s.ecc, 'Q', 'invalid enum falls back to the default');
  assert.equal(s.paper, 'a4');
  assert.ok(s.tiles['0,0']);
  assert.ok(!s.tiles['5,5'], 'tile outside the grid is dropped');
});

test('normalize rejects malformed tile-key coordinates instead of coercing them', () => {
  const { window } = page();
  const s = window.massQr.normalize({
    v: 1, rows: 4, cols: 4,
    tiles: {
      '1.5,2': { u: 'https://evil.example/', l: 'Evil', d: '' },
      '-1,0': { u: 'https://evil.example/', l: 'Evil', d: '' },
      'a,b': { u: 'https://evil.example/', l: 'Evil', d: '' }
    }
  });
  assert.deepEqual(s.tiles, {}, 'no malformed coordinate should produce a stored tile');
  assert.ok(!s.tiles['1,2'], 'a fractional coordinate must not truncate onto an integer key');
});

const { decodeSvgString } = require('./harness');

function withTiles(tiles, extra) {
  const p = page();
  p.window.massQr.setState(Object.assign({ tiles }, extra || {}));
  return p;
}

test('every tile renders a decodable QR code', () => {
  const links = {
    '0,0': { u: 'https://school.edu/schedule', l: 'Schedule', d: 'Bell times' },
    '0,1': { u: 'https://school.edu/lunch', l: 'Lunch', d: '' },
    '1,0': { u: 'https://school.edu/portal', l: 'Portal', d: '' },
    '1,1': { u: 'https://school.edu/news', l: 'News', d: '' }
  };
  const { doc } = withTiles(links);
  const svgs = doc.querySelectorAll('#grid .cell.is-filled .code svg');
  assert.equal(svgs.length, 4);
  const decoded = [...svgs].map((s) => decodeSvgString(s.outerHTML));
  assert.deepEqual(decoded.sort(), Object.values(links).map((t) => t.u).sort());
});

test('captions render and empty descriptions collapse', () => {
  const { doc } = withTiles({
    '0,0': { u: 'https://a.example', l: 'Schedule', d: 'Bell times' },
    '0,1': { u: 'https://b.example', l: 'Lunch', d: '' }
  });
  const first = doc.querySelector('.cell[data-pos="0,0"]');
  assert.equal(first.querySelector('.label').textContent, 'Schedule');
  assert.equal(first.querySelector('.desc').textContent, 'Bell times');
  assert.equal(doc.querySelector('.cell[data-pos="0,1"] .desc'), null, 'blank desc renders no node');
});

test('unfilled cells stay empty and clickable', () => {
  const { doc } = withTiles({ '0,0': { u: 'https://a.example', l: 'A', d: '' } });
  assert.equal(doc.querySelectorAll('.cell.is-empty').length, 3);
});

test('caption position is reflected on the cell', () => {
  const { doc } = withTiles({ '0,0': { u: 'https://a.example', l: 'A', d: '' } }, { capPos: 'below' });
  assert.ok(doc.querySelector('.cell[data-pos="0,0"]').classList.contains('cap-below'));
});

test('a link past QR capacity shows Link too long instead of throwing', () => {
  const overlong = 'https://example.com/' + 'a'.repeat(4000);
  const { doc } = withTiles({ '0,0': { u: overlong, l: 'A', d: '' } });
  const code = doc.querySelector('.cell[data-pos="0,0"] .code');
  assert.ok(code.classList.contains('too-long'));
  assert.equal(code.textContent, 'Link too long');
});

test('clicking an empty cell opens the editor', () => {
  const { doc, click } = page();
  const cell = doc.querySelector('.cell[data-pos="0,0"]');
  click(cell);
  const editing = doc.querySelector('.cell[data-pos="0,0"].is-editing');
  assert.ok(editing);
  assert.ok(editing.querySelector('input.f-url'));
  assert.ok(editing.querySelector('input.f-label'));
  assert.ok(editing.querySelector('input.f-desc'));
});

test('filling the editor and hitting Done creates a decodable tile', () => {
  const { doc, click, setInput, window } = page();
  click(doc.querySelector('.cell[data-pos="0,1"]'));
  const cell = doc.querySelector('.cell.is-editing');
  setInput(cell.querySelector('input.f-url'), 'https://school.edu/lunch');
  setInput(cell.querySelector('input.f-label'), 'Lunch');
  setInput(cell.querySelector('input.f-desc'), 'This week');
  click(cell.querySelector('button.f-done'));

  assert.deepEqual(window.massQr.getState().tiles['0,1'],
    { u: 'https://school.edu/lunch', l: 'Lunch', d: 'This week' });
  const svg = doc.querySelector('.cell[data-pos="0,1"] .code svg');
  assert.equal(decodeSvgString(svg.outerHTML), 'https://school.edu/lunch');
});

test('Done with a blank URL leaves the cell empty', () => {
  const { doc, click, setInput, window } = page();
  click(doc.querySelector('.cell[data-pos="0,0"]'));
  setInput(doc.querySelector('.cell.is-editing input.f-label'), 'No link');
  click(doc.querySelector('.cell.is-editing button.f-done'));
  assert.equal(window.massQr.getState().tiles['0,0'], undefined);
  assert.ok(doc.querySelector('.cell[data-pos="0,0"]').classList.contains('is-empty'));
});

test('Delete clears a filled cell', () => {
  const p = page();
  p.window.massQr.setState({ tiles: { '1,1': { u: 'https://a.example', l: 'A', d: '' } } });
  p.click(p.doc.querySelector('.cell[data-pos="1,1"]'));
  p.click(p.doc.querySelector('.cell.is-editing button.f-delete'));
  assert.equal(p.window.massQr.getState().tiles['1,1'], undefined);
});

test('editing an existing tile prefills its fields', () => {
  const p = page();
  p.window.massQr.setState({ tiles: { '0,0': { u: 'https://a.example', l: 'Alpha', d: 'Desc' } } });
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  const cell = p.doc.querySelector('.cell.is-editing');
  assert.equal(cell.querySelector('input.f-url').value, 'https://a.example');
  assert.equal(cell.querySelector('input.f-label').value, 'Alpha');
  assert.equal(cell.querySelector('input.f-desc').value, 'Desc');
});

test('empty cells are keyboard-operable buttons with a position label', () => {
  const { doc } = page();
  const cell = doc.querySelector('.cell[data-pos="1,0"]');
  assert.equal(cell.getAttribute('role'), 'button');
  assert.equal(cell.getAttribute('tabindex'), '0');
  assert.match(cell.getAttribute('aria-label') || '', /row 2, column 1/i);
});

test('pressing Enter on a focused empty cell opens the editor', () => {
  const { doc, window } = page();
  const cell = doc.querySelector('.cell[data-pos="0,0"]');
  cell.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const editing = doc.querySelector('.cell[data-pos="0,0"].is-editing');
  assert.ok(editing);
});

test('pressing Space on a focused cell opens the editor and prevents page scroll', () => {
  const { doc, window } = page();
  const cell = doc.querySelector('.cell[data-pos="0,1"]');
  const evt = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  cell.dispatchEvent(evt);
  assert.ok(evt.defaultPrevented, 'Space must be prevented so the page does not scroll');
  const editing = doc.querySelector('.cell[data-pos="0,1"].is-editing');
  assert.ok(editing);
});

test('opening a cell via keyboard focuses the URL field', () => {
  const { doc, window } = page();
  const cell = doc.querySelector('.cell[data-pos="0,0"]');
  cell.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const editing = doc.querySelector('.cell[data-pos="0,0"].is-editing');
  assert.ok(editing);
  assert.equal(window.document.activeElement, editing.querySelector('input.f-url'),
    'the URL field must receive focus so a keyboard user lands inside the editor, not at document top');
});

test('clicking away from an open editor commits it without pressing Done', () => {
  const { doc, click, setInput, window } = page();
  click(doc.querySelector('.cell[data-pos="0,0"]'));
  const cellA = doc.querySelector('.cell.is-editing');
  setInput(cellA.querySelector('input.f-url'), 'https://school.edu/away');
  setInput(cellA.querySelector('input.f-label'), 'Away');
  click(doc.querySelector('.cell[data-pos="1,1"]'));
  assert.deepEqual(window.massQr.getState().tiles['0,0'],
    { u: 'https://school.edu/away', l: 'Away', d: '' });
});

test('growing the grid needs no confirmation', () => {
  const p = page();
  p.window.confirm = () => { throw new Error('should not ask'); };
  assert.equal(p.window.massQr.resize(3, 3), true);
  assert.equal(p.doc.querySelectorAll('#grid .cell').length, 9);
});

test('shrinking past empty cells needs no confirmation', () => {
  const p = page();
  p.window.massQr.setState({ rows: 3, cols: 3 });
  p.window.confirm = () => { throw new Error('should not ask'); };
  assert.equal(p.window.massQr.resize(2, 2), true);
});

test('shrinking past filled cells asks and can be declined', () => {
  const p = page();
  p.window.massQr.setState({ rows: 3, cols: 3, tiles: { '2,2': { u: 'https://a.example', l: 'A', d: '' } } });
  let asked = null;
  p.window.confirm = (msg) => { asked = msg; return false; };
  assert.equal(p.window.massQr.resize(2, 2), false);
  assert.match(asked, /1 tile/);
  assert.equal(p.window.massQr.getState().rows, 3, 'declining leaves the grid alone');
  assert.ok(p.window.massQr.getState().tiles['2,2'], 'declining keeps the tile');
});

test('accepting the confirm drops the orphaned tiles', () => {
  const p = page();
  p.window.massQr.setState({
    rows: 3, cols: 3,
    tiles: { '0,0': { u: 'https://keep.example', l: 'K', d: '' }, '2,2': { u: 'https://drop.example', l: 'D', d: '' } }
  });
  p.window.confirm = () => true;
  assert.equal(p.window.massQr.resize(2, 2), true);
  const s = p.window.massQr.getState();
  assert.ok(s.tiles['0,0']);
  assert.ok(!s.tiles['2,2']);
  assert.equal(p.doc.querySelectorAll('#grid .cell').length, 4);
});

test('declining a resize triggered via the column select reverts the select itself', () => {
  const p = page();
  p.window.massQr.setState({ rows: 3, cols: 3, tiles: { '2,2': { u: 'https://a.example', l: 'A', d: '' } } });
  p.window.confirm = () => false;
  const elCols = p.doc.getElementById('cols');
  elCols.value = '2';
  elCols.dispatchEvent(new p.window.Event('change', { bubbles: true }));
  assert.equal(elCols.value, '3', 'the select must revert to the real column count on decline');
  const s = p.window.massQr.getState();
  assert.equal(s.cols, 3, 'declining leaves the grid alone');
  assert.ok(s.tiles['2,2'], 'declining keeps the tile');
  assert.equal(p.doc.querySelectorAll('#grid .cell').length, 9);
});

test('paper and orientation drive the sheet size and @page rule', () => {
  const { $, window } = page();
  const fire = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('change', { bubbles: true })); };

  fire($('paper'), 'letter');
  assert.equal($('sheet').style.width, '215.9mm');
  assert.equal($('sheet').style.height, '279.4mm');
  fire($('orient'), 'l');
  assert.equal($('sheet').style.width, '279.4mm');
  assert.match($('pageRule').textContent, /279\.4mm 215\.9mm/);

  fire($('paper'), 'a4');
  fire($('orient'), 'p');
  assert.equal($('sheet').style.width, '210mm');
  assert.match($('pageRule').textContent, /210mm 297mm/);
});

test('ECC change updates state and the tile still decodes', () => {
  const p = page();
  p.window.massQr.setState({ tiles: { '0,0': { u: 'https://school.edu/x', l: 'X', d: '' } } });
  p.$('ecc').value = 'H';
  p.$('ecc').dispatchEvent(new p.window.Event('change', { bubbles: true }));
  assert.equal(p.window.massQr.getState().ecc, 'H');
  const svg = p.doc.querySelector('.cell[data-pos="0,0"] .code svg');
  assert.equal(decodeSvgString(svg.outerHTML), 'https://school.edu/x');
});

test('colors reach the rendered SVG', () => {
  const p = page();
  p.window.massQr.setState({ tiles: { '0,0': { u: 'https://a.example', l: 'A', d: '' } } });
  p.setInput(p.$('fg'), '#123456');
  const svg = p.doc.querySelector('.cell[data-pos="0,0"] .code svg').outerHTML;
  assert.match(svg, /#123456/);
});

test('caption size maps to millimetre font sizes', () => {
  const p = page();
  p.window.massQr.setState({ tiles: { '0,0': { u: 'https://a.example', l: 'A', d: 'D' } } });
  p.$('capSize').value = 'l';
  p.$('capSize').dispatchEvent(new p.window.Event('change', { bubbles: true }));
  assert.equal(p.doc.querySelector('.cell[data-pos="0,0"] .label').style.fontSize, '5.5mm');
});

test('state survives a reload through the URL hash', () => {
  const p = page();
  p.window.massQr.setState({ rows: 3, cols: 1, tiles: { '0,0': { u: 'https://a.example', l: 'A', d: '' } } });
  const encoded = p.window.massQr.encodeState(p.window.massQr.getState());
  const restored = p.window.massQr.decodeState(encoded);
  assert.equal(restored.rows, 3);
  assert.equal(restored.cols, 1);
  assert.deepEqual(restored.tiles['0,0'], { u: 'https://a.example', l: 'A', d: '' });
});

// --- Finding 6: the hash/localStorage load path, exercised through an actual page load ---

test('landing with a crafted #s= hash loads that sheet', () => {
  const seed = page(); // only used to reach massQr.encodeState/normalize before the real load
  const seeded = seed.window.massQr.normalize({
    v: 1, rows: 3, cols: 1, fg: '#112233', bg: '#eeeeee',
    tiles: { '0,0': { u: 'https://a.example', l: 'A', d: '' } }
  });
  const hash = 's=' + seed.window.massQr.encodeState(seeded);

  const p = loadPage('tools/mass-qr/index.html', { hash });
  const loaded = p.window.massQr.getState();
  assert.equal(loaded.rows, 3);
  assert.equal(loaded.cols, 1);
  assert.equal(loaded.fg, '#112233');
  assert.equal(loaded.bg, '#eeeeee');
  assert.deepEqual(loaded.tiles['0,0'], { u: 'https://a.example', l: 'A', d: '' });
  assert.equal(p.doc.querySelectorAll('#grid .cell').length, 3, 'the real grid was built from the loaded state');
});

test('landing with a garbage hash falls back to 2x2 defaults', () => {
  const p = loadPage('tools/mass-qr/index.html', { hash: 's=!!!not-valid-base64!!!' });
  const s = p.window.massQr.getState();
  assert.equal(s.rows, 2);
  assert.equal(s.cols, 2);
  assert.deepEqual(s.tiles, {});
  assert.equal(p.doc.querySelectorAll('#grid .cell').length, 4);
});

test('landing with no hash but a seeded localStorage sheet loads the stored sheet', () => {
  const seed = page();
  const seeded = seed.window.massQr.normalize({
    v: 1, rows: 1, cols: 4, tiles: { '0,2': { u: 'https://stored.example', l: 'Stored', d: '' } }
  });
  const stored = seed.window.massQr.encodeState(seeded);

  const p = loadPage('tools/mass-qr/index.html', { localStorage: stored });
  const loaded = p.window.massQr.getState();
  assert.equal(loaded.rows, 1);
  assert.equal(loaded.cols, 4);
  assert.deepEqual(loaded.tiles['0,2'], { u: 'https://stored.example', l: 'Stored', d: '' });
});

// --- Finding 1: an open editor must be committed before any other state mutation reads it ---

test('changing a control while an editor is open commits the tile instead of wiping it', () => {
  const p = page();
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  const cell = p.doc.querySelector('.cell.is-editing');
  p.setInput(cell.querySelector('input.f-url'), 'https://school.edu/x');
  p.setInput(cell.querySelector('input.f-label'), 'X');

  p.$('paper').value = 'letter';
  p.$('paper').dispatchEvent(new p.window.Event('change', { bubbles: true }));

  assert.deepEqual(p.window.massQr.getState().tiles['0,0'],
    { u: 'https://school.edu/x', l: 'X', d: '' }, 'the typed tile must survive an unrelated control change');
  const svg = p.doc.querySelector('.cell[data-pos="0,0"] .code svg');
  assert.ok(svg, 'the cell should render its committed code, not a stale editor');
});

test('resizing the grid while an editor is open commits the tile first', () => {
  const p = page();
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  const cell = p.doc.querySelector('.cell.is-editing');
  p.setInput(cell.querySelector('input.f-url'), 'https://school.edu/resize');
  p.window.confirm = () => { throw new Error('should not ask — nothing is orphaned by growing the grid'); };

  assert.equal(p.window.massQr.resize(3, 3), true);
  assert.deepEqual(p.window.massQr.getState().tiles['0,0'],
    { u: 'https://school.edu/resize', l: '', d: '' }, 'resize must not discard an uncommitted edit');
});

test('clicking Print while an editor is open commits it, leaving a rendered svg in the cell', () => {
  const p = page();
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  const cell = p.doc.querySelector('.cell.is-editing');
  p.setInput(cell.querySelector('input.f-url'), 'https://school.edu/print');
  p.window.print = () => {}; // jsdom has no real print(); the handler just needs somewhere to call

  p.click(p.$('btnPrint'));

  assert.equal(p.doc.querySelector('.cell.is-editing'), null, 'no cell should still be mid-edit at print time');
  const svg = p.doc.querySelector('.cell[data-pos="0,0"] .code svg');
  assert.ok(svg, 'printing mid-edit must leave a rendered code, not a hole');
});

test('the native beforeprint event (Ctrl-P) commits an open editor even without touching the Print button', () => {
  const p = page();
  p.click(p.doc.querySelector('.cell[data-pos="1,1"]'));
  const cell = p.doc.querySelector('.cell.is-editing');
  p.setInput(cell.querySelector('input.f-url'), 'https://school.edu/ctrlp');

  p.window.dispatchEvent(new p.window.Event('beforeprint'));

  assert.deepEqual(p.window.massQr.getState().tiles['1,1'],
    { u: 'https://school.edu/ctrlp', l: '', d: '' });
  assert.equal(p.doc.querySelector('.cell.is-editing'), null);
});

test('journey: fill two cells, resize, recolour and reorient without losing tiles or leaving a stuck editor', () => {
  const p = page();

  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  let cell = p.doc.querySelector('.cell.is-editing');
  p.setInput(cell.querySelector('input.f-url'), 'https://school.edu/one');
  p.setInput(cell.querySelector('input.f-label'), 'One');
  p.click(cell.querySelector('button.f-done'));

  // Second cell is left open (Done is never clicked) so the resize below has
  // to be the thing that commits it — exactly the composite path the
  // Critical finding describes.
  p.click(p.doc.querySelector('.cell[data-pos="0,1"]'));
  cell = p.doc.querySelector('.cell.is-editing');
  p.setInput(cell.querySelector('input.f-url'), 'https://school.edu/two');
  p.setInput(cell.querySelector('input.f-label'), 'Two');

  p.window.confirm = () => true;
  assert.equal(p.window.massQr.resize(3, 3), true);

  p.setInput(p.$('fg'), '#ff00ff');

  p.$('orient').value = 'l';
  p.$('orient').dispatchEvent(new p.window.Event('change', { bubbles: true }));

  const s = p.window.massQr.getState();
  assert.deepEqual(s.tiles['0,0'], { u: 'https://school.edu/one', l: 'One', d: '' });
  assert.deepEqual(s.tiles['0,1'], { u: 'https://school.edu/two', l: 'Two', d: '' });
  assert.equal(s.fg, '#ff00ff');
  assert.equal(s.orient, 'l');
  assert.equal(p.doc.querySelectorAll('.cell.is-editing').length, 0, 'no cell should be left mid-edit');
  assert.equal(p.doc.querySelectorAll('#grid .cell.is-filled .code svg').length, 2);
});

// ── Custom paper size ──────────────────────────────────────────────

function fireChange(p, el, v) {
  el.value = v;
  el.dispatchEvent(new p.window.Event('change', { bubbles: true }));
}

test('custom paper: defaults are A4 dimensions in mm', () => {
  const { window } = page();
  const s = window.massQr.defaultState();
  assert.equal(s.cw, 210);
  assert.equal(s.ch, 297);
  assert.equal(s.cu, 'mm');
});

test('custom paper: dimensions round-trip through the URL hash', () => {
  const { window } = page();
  const s = window.massQr.defaultState();
  s.paper = 'custom';
  s.cw = 215.9;
  s.ch = 279.4;
  s.cu = 'in';
  assert.deepEqual(window.massQr.decodeState(window.massQr.encodeState(s)), s);
});

test('custom paper: dimensions are clamped and garbage falls back to A4 size', () => {
  const { window } = page();
  const tiny = window.massQr.normalize({ v: 1, paper: 'custom', cw: 1, ch: 99999 });
  assert.equal(tiny.cw, 50, 'below the floor clamps up');
  assert.equal(tiny.ch, 1200, 'above the ceiling clamps down');

  const junk = window.massQr.normalize({ v: 1, paper: 'custom', cw: 'abc', ch: null });
  assert.equal(junk.paper, 'custom', 'paper choice survives');
  assert.equal(junk.cw, 210, 'unparseable width falls back to A4 width');
  assert.equal(junk.ch, 297);

  assert.equal(window.massQr.normalize({ v: 1, cu: 'furlongs' }).cu, 'mm', 'bad unit falls back');
});

test('custom paper: fractional decimals survive normalization', () => {
  const { window } = page();
  const s = window.massQr.normalize({ v: 1, paper: 'custom', cw: 215.9, ch: 279.4 });
  assert.equal(s.cw, 215.9);
  assert.equal(s.ch, 279.4);
});

test('custom paper: drives the sheet size and the @page rule', () => {
  const p = page();
  p.window.massQr.setState({ paper: 'custom', cw: 100, ch: 150 });
  const sheet = p.$('sheet');
  assert.equal(sheet.style.width, '100mm');
  assert.equal(sheet.style.height, '150mm');
  assert.match(p.$('pageRule').textContent, /100mm 150mm/);
});

test('custom paper: orientation swaps the custom dimensions', () => {
  const p = page();
  p.window.massQr.setState({ paper: 'custom', cw: 100, ch: 150, orient: 'l' });
  assert.equal(p.$('sheet').style.width, '150mm');
  assert.equal(p.$('sheet').style.height, '100mm');
  assert.match(p.$('pageRule').textContent, /150mm 100mm/);
});

test('custom paper: preset sizes still drive the sheet inline, not via CSS classes', () => {
  const p = page();
  fireChange(p, p.$('paper'), 'letter');
  assert.equal(p.$('sheet').style.width, '215.9mm');
  assert.equal(p.$('sheet').style.height, '279.4mm');
  fireChange(p, p.$('orient'), 'l');
  assert.equal(p.$('sheet').style.width, '279.4mm');
});

test('custom paper: the dimension fields show only when Custom is selected', () => {
  const p = page();
  assert.ok(p.$('customDims').hidden, 'hidden for A4');
  fireChange(p, p.$('paper'), 'custom');
  assert.ok(!p.$('customDims').hidden, 'shown for custom');
  fireChange(p, p.$('paper'), 'a4');
  assert.ok(p.$('customDims').hidden, 'hidden again');
});

test('custom paper: typing inches stores millimetres', () => {
  const p = page();
  fireChange(p, p.$('paper'), 'custom');
  fireChange(p, p.$('cu'), 'in');
  fireChange(p, p.$('cw'), '8.5');
  fireChange(p, p.$('ch'), '11');
  const s = p.window.massQr.getState();
  assert.ok(Math.abs(s.cw - 215.9) < 0.01, `8.5in -> ${s.cw}mm`);
  assert.ok(Math.abs(s.ch - 279.4) < 0.01, `11in -> ${s.ch}mm`);
  assert.equal(p.$('sheet').style.width, '215.9mm');
});

test('custom paper: switching unit converts the display, not the sheet', () => {
  const p = page();
  p.window.massQr.setState({ paper: 'custom', cw: 210, ch: 297 });
  fireChange(p, p.$('cu'), 'in');
  assert.ok(Math.abs(parseFloat(p.$('cw').value) - 8.27) < 0.01, `210mm -> ${p.$('cw').value}in`);
  assert.equal(p.$('sheet').style.width, '210mm', 'physical size unchanged');
  fireChange(p, p.$('cu'), 'mm');
  assert.ok(Math.abs(parseFloat(p.$('cw').value) - 210) < 0.01, 'and back again');
  assert.equal(p.$('sheet').style.width, '210mm');
});

test('custom paper: a shared custom sheet reopens with its own unit and size', () => {
  const seed = page();
  seed.window.massQr.setState({ paper: 'custom', cw: 215.9, ch: 279.4, cu: 'in' });
  const hash = '#s=' + seed.window.massQr.encodeState(seed.window.massQr.getState());

  const p = page({ hash });
  const s = p.window.massQr.getState();
  assert.equal(s.paper, 'custom');
  assert.equal(s.cu, 'in');
  assert.equal(p.$('sheet').style.width, '215.9mm');
  assert.ok(!p.$('customDims').hidden, 'fields visible on load');
  assert.ok(Math.abs(parseFloat(p.$('cw').value) - 8.5) < 0.01, 'shown in inches');
});

// ── Quiet zone ─────────────────────────────────────────────────────

test('quiet zone: defaults to the 4-module spec minimum', () => {
  const { window } = page();
  assert.equal(window.massQr.defaultState().qz, 4);
});

test('quiet zone: round-trips and clamps to 0-8', () => {
  const { window } = page();
  const s = window.massQr.defaultState();
  s.qz = 0;
  assert.deepEqual(window.massQr.decodeState(window.massQr.encodeState(s)), s);
  assert.equal(window.massQr.normalize({ v: 1, qz: 99 }).qz, 8, 'clamps down');
  assert.equal(window.massQr.normalize({ v: 1, qz: -3 }).qz, 0, 'clamps up');
  assert.equal(window.massQr.normalize({ v: 1, qz: 'wide' }).qz, 4, 'garbage falls back');
});

test('quiet zone: changes the margin baked into each tile SVG', () => {
  const p = page();
  const tile = { u: 'https://school.edu/x', l: 'X', d: '' };
  p.window.massQr.setState({ tiles: { '0,0': tile } });

  const vb = () => parseInt(
    p.doc.querySelector('.cell[data-pos="0,0"] .code svg').getAttribute('viewBox').split(' ')[2], 10);

  const atFour = vb();
  p.$('qz').value = '0';
  p.$('qz').dispatchEvent(new p.window.Event('change', { bubbles: true }));
  const atZero = vb();

  assert.equal(atFour - atZero, 8, 'four modules of margin on each side');
  assert.equal(p.window.massQr.getState().qz, 0);

  p.$('qz').value = '8';
  p.$('qz').dispatchEvent(new p.window.Event('change', { bubbles: true }));
  assert.equal(vb() - atZero, 16, 'eight modules each side');
});

test('quiet zone: a tile at the default still decodes', () => {
  const p = page();
  p.window.massQr.setState({ tiles: { '0,0': { u: 'https://school.edu/x', l: 'X', d: '' } } });
  const svg = p.doc.querySelector('.cell[data-pos="0,0"] .code svg').outerHTML;
  assert.equal(decodeSvgString(svg), 'https://school.edu/x');
});

// ── Tile layout ────────────────────────────────────────────────────

test('codes are centred in their box regardless of caption position', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: 'desc' } });
  const par = () => p.doc.querySelector('.cell[data-pos="0,0"] .code svg')
    .getAttribute('preserveAspectRatio');
  assert.equal(par(), 'xMidYMid meet');
  fireChange(p, p.$('capPos'), 'below');
  assert.equal(par(), 'xMidYMid meet', 'still centred with the caption below');
});

test('the caption band falls back to millimetres when nothing can be measured', () => {
  // jsdom reports offsetHeight 0, which is exactly the fallback path: medium
  // captions are 4mm label + 2.8mm description at line-height 1.3.
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: 'desc' } });
  assert.equal(p.$('grid').style.getPropertyValue('--cap-h'), '8.84mm');

  const noDesc = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: '' } });
  assert.equal(noDesc.$('grid').style.getPropertyValue('--cap-h'), '5.2mm',
    'a sheet with no descriptions reserves only the label line');
});

test('caption text takes the code colour, so it survives a dark sheet', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: 'd' } },
    { fg: '#ffffff', bg: '#0f172a' });
  const cap = p.doc.querySelector('.cell[data-pos="0,0"] .cap');
  assert.equal(cap.style.color, 'rgb(255, 255, 255)');
});

test('caption colour follows the code colour control', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: '' } });
  const cap = () => p.doc.querySelector('.cell[data-pos="0,0"] .cap').style.color;
  assert.equal(cap(), 'rgb(0, 0, 0)');
  p.setInput(p.$('fg'), '#b91c1c');
  assert.equal(cap(), 'rgb(185, 28, 28)');
});

// ── Margin and gutter ──────────────────────────────────────────────

test('margin and gutter default to 10mm and 4mm', () => {
  const s = page().window.massQr.defaultState();
  assert.equal(s.mg, 10);
  assert.equal(s.gp, 4);
});

test('margin and gutter round-trip and clamp', () => {
  const { window } = page();
  const s = window.massQr.defaultState();
  s.mg = 0; s.gp = 12.5;
  assert.deepEqual(window.massQr.decodeState(window.massQr.encodeState(s)), s);
  assert.equal(window.massQr.normalize({ v: 1, mg: 999 }).mg, 50, 'margin clamps down');
  assert.equal(window.massQr.normalize({ v: 1, mg: -5 }).mg, 0, 'margin clamps up');
  assert.equal(window.massQr.normalize({ v: 1, gp: 999 }).gp, 30, 'gutter clamps down');
  assert.equal(window.massQr.normalize({ v: 1, gp: 'wide' }).gp, 4, 'garbage falls back');
});

test('margin and gutter reach the sheet and the grid', () => {
  const p = page();
  fireChange(p, p.$('mg'), '5');
  fireChange(p, p.$('gp'), '1.5');
  assert.equal(p.$('sheet').style.padding, '5mm');
  assert.equal(p.$('grid').style.gap, '1.5mm');
  assert.equal(p.window.massQr.getState().mg, 5);
});

test('a grid too dense for its paper warns instead of rendering a mess', () => {
  const p = page();
  assert.ok(p.$('warn').hidden, 'quiet at the defaults');
  // 6 columns on 50mm paper: 10mm margin a side leaves 30mm, five 4mm
  // gutters eat 20mm, so six columns share 10mm — 1.7mm each.
  p.window.massQr.setState({ paper: 'custom', cw: 50, ch: 50, rows: 6, cols: 6 });
  assert.ok(!p.$('warn').hidden, 'warns');
  assert.match(p.$('warn').textContent, /about 2mm here/);

  // Recoverable now that margin and gutter are controls:
  // (150 - 8 - 10) / 6 = 22mm a cell.
  p.window.massQr.setState({ cw: 150, ch: 150, mg: 4, gp: 2 });
  assert.ok(p.$('warn').hidden, 'a bigger sheet with a tighter margin clears it');
});

test('a sheet with no room left at all says so rather than quoting 0mm', () => {
  const p = page();
  // 25mm of margin a side on 50mm paper leaves nothing before the gutters.
  p.window.massQr.setState({ paper: 'custom', cw: 50, ch: 50, rows: 6, cols: 6, mg: 25 });
  assert.match(p.$('warn').textContent, /margin and gutter use up the whole sheet at 6×6/i);
});

test('a sheet just under the scannable floor warns with the measurement', () => {
  const p = page();
  // (83 - 10 - 10) / 6 = 10.5mm a cell, just under the 12mm floor.
  p.window.massQr.setState({ paper: 'custom', cw: 83, ch: 83, rows: 6, cols: 6, mg: 5, gp: 2 });
  assert.match(p.$('warn').textContent, /about 1[01]mm/);
});

// ── Zoom ───────────────────────────────────────────────────────────

test('zoom defaults to fit and round-trips like every other control', () => {
  const { window } = page();
  assert.equal(window.massQr.defaultState().zoom, 'fit');
  const s = window.massQr.defaultState();
  s.zoom = '1.5';
  assert.deepEqual(window.massQr.decodeState(window.massQr.encodeState(s)), s);
  assert.equal(window.massQr.normalize({ v: 1, zoom: 'enormous' }).zoom, 'fit');
});

test('a shared sheet reopens at the zoom it was saved with', () => {
  const seed = page();
  fireChange(seed, seed.$('zoom'), '1.5');
  assert.equal(seed.window.massQr.getState().zoom, '1.5');
  const hash = '#s=' + seed.window.massQr.encodeState(seed.window.massQr.getState());

  const p = page({ hash });
  assert.equal(p.$('zoom').value, '1.5', 'the control shows the saved zoom');
  assert.match(p.$('sheet').style.transform, /scale\(1\.5\)/);
});

test('changing zoom does not rebuild the grid', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/x', l: 'X', d: '' } });
  const before = p.doc.querySelector('.cell[data-pos="0,0"]');
  fireChange(p, p.$('zoom'), '1');
  assert.strictEqual(p.doc.querySelector('.cell[data-pos="0,0"]'), before,
    'a preview-only control must not re-encode every code');
});
