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
    v: 1, rows: 99, cols: 0, ecc: 'BOGUS',
    tiles: { '0,0': { u: 'a', l: 'A', d: '' }, '5,5': { u: 'b', l: 'B', d: '' } }
  });
  assert.ok(s.rows <= 6 && s.rows >= 1);
  assert.ok(s.cols >= 1);
  assert.equal(s.ecc, 'Q', 'invalid enum falls back to the default');
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

  p.$('capSize').value = 'l';
  p.$('capSize').dispatchEvent(new p.window.Event('change', { bubbles: true }));

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

test('journey: fill two cells, resize, recolour and recaption without losing tiles or leaving a stuck editor', () => {
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

  p.$('capPos').value = 'below';
  p.$('capPos').dispatchEvent(new p.window.Event('change', { bubbles: true }));

  const s = p.window.massQr.getState();
  assert.deepEqual(s.tiles['0,0'], { u: 'https://school.edu/one', l: 'One', d: '' });
  assert.deepEqual(s.tiles['0,1'], { u: 'https://school.edu/two', l: 'Two', d: '' });
  assert.equal(s.fg, '#ff00ff');
  assert.equal(s.capPos, 'below');
  assert.equal(p.doc.querySelectorAll('.cell.is-editing').length, 0, 'no cell should be left mid-edit');
  assert.equal(p.doc.querySelectorAll('#grid .cell.is-filled .code svg').length, 2);
});

function fireChange(p, el, v) {
  el.value = v;
  el.dispatchEvent(new p.window.Event('change', { bubbles: true }));
}












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










// ── Editor keyboard ────────────────────────────────────────────────

function keydown(p, el, key) {
  el.dispatchEvent(new p.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

test('Enter in the editor commits the tile', () => {
  const p = page();
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  p.doc.querySelector('.f-url').value = 'https://school.edu/typed';
  p.doc.querySelector('.f-label').value = 'Typed';
  keydown(p, p.doc.querySelector('.f-url'), 'Enter');

  assert.equal(p.doc.querySelectorAll('.cell.is-editing').length, 0, 'editor closed');
  assert.deepEqual(p.window.massQr.getState().tiles['0,0'],
    { u: 'https://school.edu/typed', l: 'Typed', d: '' });
});

test('Escape in the editor discards the edit', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/keep', l: 'Keep', d: '' } });
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  p.doc.querySelector('.f-url').value = 'https://school.edu/discard';
  keydown(p, p.doc.querySelector('.f-url'), 'Escape');

  assert.equal(p.doc.querySelectorAll('.cell.is-editing').length, 0, 'editor closed');
  assert.equal(p.window.massQr.getState().tiles['0,0'].u, 'https://school.edu/keep',
    'the typed value was thrown away');
});

test('Escape on a fresh empty cell leaves it empty', () => {
  const p = page();
  p.click(p.doc.querySelector('.cell[data-pos="1,1"]'));
  p.doc.querySelector('.f-url').value = 'https://school.edu/never';
  keydown(p, p.doc.querySelector('.f-url'), 'Escape');
  assert.ok(!p.window.massQr.getState().tiles['1,1']);
  assert.ok(p.doc.querySelector('.cell[data-pos="1,1"]').classList.contains('is-empty'));
});

test('Enter on the Delete button deletes rather than commits', () => {
  const p = withTiles({ '0,0': { u: 'https://school.edu/gone', l: 'Gone', d: '' } });
  p.click(p.doc.querySelector('.cell[data-pos="0,0"]'));
  const del = p.doc.querySelector('.f-delete');
  keydown(p, del, 'Enter');
  p.click(del); // the browser's own activation, which follows the keydown
  assert.ok(!p.window.massQr.getState().tiles['0,0'], 'the tile is gone');
});

// ── Control strip ──────────────────────────────────────────────────

test('the rail is grouped, and every control still resolves by id', () => {
  const { doc, $ } = page();
  const groups = [...doc.querySelectorAll('.rail .rail-group > h2')].map((h) => h.textContent.trim());
  assert.deepEqual(groups, ['Sheet', 'Codes']);

  for (const id of ['mg', 'gp', 'cols', 'rows', 'ecc', 'qz', 'capPos', 'capSize', 'fg', 'bg', 'btnPrint']) {
    assert.ok($(id), `#${id} still exists`);
  }
});

// The rail shortens visible labels to keep the value column aligned, so the
// full name has to survive somewhere a screen reader will read it.
test('every control announces what it does', () => {
  const { doc } = page();
  const name = (id) => {
    const el = doc.getElementById(id);
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    return doc.querySelector('label[for="' + id + '"]').textContent.trim();
  };
  assert.equal(name('fg'), 'Code colour');
  assert.equal(name('bg'), 'Sheet colour');
  assert.equal(name('capPos'), 'Caption position');
  assert.equal(name('capSize'), 'Caption size');
  assert.equal(name('mg'), 'Margin in millimetres');
  assert.equal(name('gp'), 'Gutter in millimetres');
  assert.equal(name('ecc'), 'Error correction level');
  assert.equal(name('qz'), 'Quiet zone in modules');
});







// ── Margin and gutter ──────────────────────────────────────────────

test('margin and gutter default to 10mm and 4mm and round-trip', () => {
  const { window } = page();
  const d = window.massQr.defaultState();
  assert.equal(d.mg, 10);
  assert.equal(d.gp, 4);
  const s = window.massQr.defaultState();
  s.mg = 0; s.gp = 12.5;
  assert.deepEqual(window.massQr.decodeState(window.massQr.encodeState(s)), s);
  assert.equal(window.massQr.normalize({ v: 1, mg: 999 }).mg, 50, 'margin clamps down');
  assert.equal(window.massQr.normalize({ v: 1, mg: -5 }).mg, 0, 'margin clamps up');
  assert.equal(window.massQr.normalize({ v: 1, gp: 999 }).gp, 30, 'gutter clamps down');
  assert.equal(window.massQr.normalize({ v: 1, gp: 'wide' }).gp, 4, 'garbage falls back');
});

test('margin drives both the preview padding and the real @page margin', () => {
  const p = page();
  assert.match(p.$('pageRule').textContent, /@page \{ margin: 10mm; \}/);
  assert.equal(p.$('sheet').style.getPropertyValue('--sheet-pad'), '10mm');

  p.setInput(p.$('mg'), '4.5');
  assert.equal(p.window.massQr.getState().mg, 4.5);
  assert.equal(p.$('sheet').style.getPropertyValue('--sheet-pad'), '4.5mm');
  assert.match(p.$('pageRule').textContent, /@page \{ margin: 4\.5mm; \}/,
    'the preview and the printer must be asked for the same margin');
});

test('gutter reaches the grid', () => {
  const p = page();
  assert.equal(p.$('sheet').style.getPropertyValue('--gutter'), '4mm');
  p.setInput(p.$('gp'), '1.5');
  assert.equal(p.window.massQr.getState().gp, 1.5);
  assert.equal(p.$('sheet').style.getPropertyValue('--gutter'), '1.5mm');
});

test('@page never declares a paper size', () => {
  // WebKit ignores the size descriptor; declaring one is what broke Safari.
  const p = page();
  p.setInput(p.$('mg'), '25');
  assert.doesNotMatch(p.$('pageRule').textContent, /size/);
});

test('focusing margin or gutter marks the sheet, and blurring clears it', () => {
  const p = page();
  const sheet = p.$('sheet');
  const fire = (el, type) => el.dispatchEvent(new p.window.Event(type, { bubbles: false }));

  fire(p.$('mg'), 'focus');
  assert.ok(sheet.classList.contains('show-margin'));
  assert.ok(!sheet.classList.contains('show-gutter'), 'only the focused control guides');
  fire(p.$('mg'), 'blur');
  assert.ok(!sheet.classList.contains('show-margin'));

  fire(p.$('gp'), 'focus');
  assert.ok(sheet.classList.contains('show-gutter'));
  fire(p.$('gp'), 'blur');
  assert.ok(!sheet.classList.contains('show-gutter'));
});

test('the guide survives the re-render that typing a new value triggers', () => {
  const p = page();
  p.$('mg').dispatchEvent(new p.window.Event('focus', { bubbles: false }));
  p.setInput(p.$('mg'), '20');
  assert.ok(p.$('sheet').classList.contains('show-margin'),
    'render() rebuilds the sheet; the guide must still be on while the field has focus');
});
