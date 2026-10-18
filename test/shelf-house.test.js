'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildSite } = require('./harness');
const { withPage, closeAll, CHROME } = require('./cdp');

// geometry.js is a plain ES module and the vendored manifold runs under node,
// so the solids are tested here directly; the page itself needs real Chrome.
const dir = path.join(__dirname, '..', 'static', 'tools', 'shelf-house');
const load = async () => {
  const { default: Module } = await import(pathToFileURL(path.join(dir, 'vendor', 'manifold.js')));
  const g = await import(pathToFileURL(path.join(dir, 'geometry.js')));
  const k = await Module();
  k.setup();
  return { g, k };
};
let lib;
const geometry = () => (lib = lib || load());

buildSite();
test.after(closeAll);

test('stairs are one watertight solid, run × rise × depth, and turn without changing', async () => {
  const { g, k } = await geometry();
  const cfg = g.defaultStairs({ run: 60, rise: 70, depth: 25 });
  const right = g.buildStairs(k, cfg), left = g.buildStairs(k, { ...cfg, flip: true });
  for (const m of [right, left]) {
    assert.strictEqual(m.status(), 'NoError');
    assert.strictEqual(m.genus(), 0);
    const bb = m.boundingBox();
    assert.deepStrictEqual(bb.min.map(Math.round), [0, 0, 0]);
    assert.deepStrictEqual(bb.max.map(Math.round), [60, 70, 25]);
  }
  assert.ok(Math.abs(right.volume() - left.volume()) < 1e-6);
  // Highest point of the profile at its left end: one riser when it rises to
  // the right, the full rise when turned.
  const leftEnd = (c) => Math.max(...g.frontProfile(k, 'furniture', c).shell.flat()
    .filter(([x]) => x < 0.01).map(([, y]) => y));
  assert.ok(Math.abs(leftEnd(cfg) - 70 / 8) < 0.01);
  assert.ok(Math.abs(leftEnd({ ...cfg, flip: true }) - 70) < 0.01);
  assert.deepStrictEqual(g.blockSize('furniture', cfg), { w: 60, h: 70, d: 25 });
});

test('a stairwell is placed in each room\'s own coordinates and clipped to it', async () => {
  const { g } = await geometry();
  const room = (x, w) => ({ x, y: 0, cfg: g.defaultRoom({ w }) });
  // Absolute x 20–76, z 3–29.5 (back half of a 56 mm deep room).
  const below = g.stairwell(room(0, 120), 20, 76, 3, 29.5, 'ceiling');
  assert.deepStrictEqual([below.x, below.y, below.w, below.h], [-12, -13.25, 56, 26.5]);
  // A narrower room on top, shifted right: same absolute hole, its own offsets.
  const above = g.stairwell(room(40, 78), 20, 76, 3, 29.5, 'floor');
  assert.strictEqual(above.wall, 'floor');
  assert.strictEqual(above.x, 48 - 40 - 39);
  // A room that only shares the hole's span with its wall gets nothing.
  assert.strictEqual(g.stairwell(room(74, 78), 20, 76, 3, 29.5, 'floor'), null);
});

test('a room cuts its stairwells and shows them edge-on in the front view', async () => {
  const { g, k } = await geometry();
  const cfg = g.defaultRoom();
  const hole = g.stairwell({ x: 0, y: 0, cfg }, 20, 76, 3, 29.5, 'ceiling');
  const cut = { ...cfg, stairwells: [hole] };
  const lost = g.buildRoom(k, cfg).volume() - g.buildRoom(k, cut).volume();
  assert.ok(Math.abs(lost - 56 * 26.5 * cfg.walls.ceiling) < 1, `removed ${lost} mm³`);
  assert.deepStrictEqual(g.frontProfile(k, 'room', cut).marks, [[20, cfg.h - cfg.walls.ceiling, 76, cfg.h]]);
  // Partly over the right wall of a wider hole: clipped, the frame stays whole.
  const wide = { ...cfg, stairwells: [g.stairwell({ x: 0, y: 0, cfg }, 90, 150, 3, 29.5, 'floor')] };
  assert.deepStrictEqual(g.frontProfile(k, 'room', wide).marks, [[90, 0, cfg.w - cfg.walls.right, cfg.walls.floor]]);
});

test('stairs added to a room open its ceiling and the floor of the room on top',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    const ready = "!!document.querySelector('#mat .block')";
    for (let i = 0; i < 200 && !(await p.evalJson(ready)); i++) await new Promise((r) => setTimeout(r, 50));
    const marks = (id) => `document.querySelectorAll('#mat .block[data-id="${id}"] .mark').length`;
    await p.evalJson(`(() => {
      document.getElementById('example').click();
      // Select the ground-floor porthole room (1); the doorway room (3) sits on it.
      const g = document.querySelector('#mat .block[data-id="1"] path');
      const r = g.getBoundingClientRect();
      const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.bottom - 4, button: 0 };
      g.dispatchEvent(new PointerEvent('pointerdown', at));
      window.dispatchEvent(new PointerEvent('pointerup', at));
      return true;
    })()`);
    const before = [await p.evalJson(marks(1)), await p.evalJson(marks(3))];
    await p.evalJson(`(() => {
      const card = document.querySelector('#palette [aria-label="Add Stairs"]');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
    assert.deepStrictEqual([await p.evalJson(marks(1)), await p.evalJson(marks(3))], [before[0] + 1, before[1] + 1]);
    assert.ok(await p.evalJson("[...document.querySelectorAll('#bom td')].some((td) => td.textContent.trim() === 'Stairs')"));

    // Turning them keeps the stairwells; deleting them closes both again.
    await p.evalJson("(document.querySelector('[data-act=\"flip\"]').click(), true)");
    assert.deepStrictEqual([await p.evalJson(marks(1)), await p.evalJson(marks(3))], [before[0] + 1, before[1] + 1]);
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })), true)");
    assert.deepStrictEqual([await p.evalJson(marks(1)), await p.evalJson(marks(3))], before);
  });
});
