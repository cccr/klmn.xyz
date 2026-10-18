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

test('a centred window stays in the middle of its wall when the room gets shorter', async () => {
  const { g, k } = await geometry();
  const win = g.defaultOpening({ anchor: 'centre', y: 0, w: 30, h: 30 });
  for (const h of [72, 50]) {
    const cfg = g.defaultRoom({ h, openings: [win] });
    const b = g.innerBox(cfg);
    const ys = g.frontProfile(k, 'room', cfg).holes.flat().map(([, y]) => y);
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - (b.y0 + b.y1) / 2) < 0.01, `h ${h}`);
    assert.ok(Math.max(...ys) < b.y1);
  }
});

test('a doorway stands on the floor whatever the room height', async () => {
  const { g, k } = await geometry();
  const door = g.OPENING_PRESETS.doorway();
  assert.strictEqual(door.anchor, 'floor');
  for (const h of [72, 90]) {
    const cfg = g.defaultRoom({ h, openings: [door] });
    const [mark] = g.frontProfile(k, 'room', cfg).marks;
    assert.ok(Math.abs(mark[1] - cfg.walls.floor) < 0.01, `h ${h}`);
  }
});

test('an opening saved before anchors cuts the same hole after migration', async () => {
  const { g, k } = await geometry();
  const cfg = g.defaultRoom({ h: 80 });
  const legacy = { wall: 'back', shape: 'rect', x: 5, y: 19, w: 46, h: 36, r: 0, cols: 2, rows: 3, bar: 2.5, count: 1, pitch: 40 };
  const asSill = g.defaultOpening({ ...legacy, anchor: 'floor' });
  const migrated = g.migrateOpening(cfg, legacy);
  assert.strictEqual(migrated.anchor, 'centre');
  assert.ok(Math.abs(migrated.y - (19 + 18 - 37)) < 1e-9);
  const vol = (o) => g.buildRoom(k, { ...cfg, openings: [o] }).volume();
  assert.ok(Math.abs(vol(asSill) - vol(migrated)) < 1e-6);
  assert.strictEqual(g.migrateOpening(cfg, { ...legacy, y: 0 }).anchor, 'floor');
  assert.strictEqual(g.migrateOpening(cfg, { ...legacy, wall: 'ceiling' }).anchor, 'centre');
  assert.strictEqual(g.migrateOpening(cfg, { ...legacy, wall: 'ceiling' }).y, 19);
});

test('a room with no wall on a side is open there and still one clean solid', async () => {
  const { g, k } = await geometry();
  const full = g.defaultRoom();
  // Square corners, so the volume left is exact.
  const square = { tl: false, tr: false, br: false, bl: false };
  const open = g.defaultRoom({ walls: { ...full.walls, left: 0, back: 0 }, outer: square, inner: square, openings: [g.OPENING_PRESETS.doorway()] });
  const m = g.buildRoom(k, open);
  assert.strictEqual(m.status(), 'NoError');
  assert.deepStrictEqual(m.boundingBox().min.map(Math.round), [0, 0, 0]);
  assert.deepStrictEqual(m.boundingBox().max.map(Math.round), [120, 72, 56]);
  // Nothing of the left wall or the back is left, and the doorway on the
  // missing wall cuts nothing: what remains is ceiling, floor and right wall.
  const t = full.walls;
  const solid = (120 * (t.ceiling + t.floor) + (72 - t.ceiling - t.floor) * t.right) * 56;
  assert.ok(Math.abs(m.volume() - solid) < 1e-6, `${m.volume()} vs ${solid}`);
  // The front view draws the room's interior no wider than the room.
  const xs = g.frontProfile(k, 'room', open).room.flat().map(([x]) => x);
  assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 120);
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

// Page helpers: wait for the engine, then drive the page from inside it.
const ready = async (p) => {
  for (let i = 0; i < 200 && !(await p.evalJson("!!document.querySelector('#mat .block')")); i++) await new Promise((r) => setTimeout(r, 50));
};
const PAGE_HELPERS = `(window.__sh = {
    pick(id) {
      const g = document.querySelector('#mat .block[data-id="' + id + '"] path');
      const r = g.getBoundingClientRect();
      const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.bottom - 4, button: 0 };
      g.dispatchEvent(new PointerEvent('pointerdown', at));
      window.dispatchEvent(new PointerEvent('pointerup', at));
    },
    set(id, v) {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    sizes() {
      const s = JSON.parse(localStorage.getItem('shelf-house-layout-v3'));
      return Object.fromEntries(s.items.filter((i) => i.kind === 'room').map((i) => [i.id, [i.cfg.w, i.cfg.h, i.cfg.d]]));
    },
  }, true)`;

test('rooms follow the shelf settings on every size they have not set themselves',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(localStorage.removeItem('shelf-house-units'), document.getElementById('example').click(), ${PAGE_HELPERS})`);
    // Every room takes a new height and depth.
    await p.evalJson("(__sh.set('sh-h', 80), __sh.set('sh-d', 60), true)");
    let sizes = await p.evalJson('__sh.sizes()');
    assert.deepStrictEqual(Object.values(sizes).map(([, h, d]) => [h, d]), Array(5).fill([80, 60]));
    assert.deepStrictEqual(sizes[2], [78, 80, 60]);

    // A width typed into room 1 stays its own; its height still follows.
    await p.evalJson("(__sh.pick(1), __sh.set('sh-cfg-w', 110), true)");
    assert.ok(await p.evalJson("!!document.querySelector('[data-act=\"size-default\"][data-dim=\"w\"]')"));
    await p.evalJson("(__sh.set('sh-wide', 130), __sh.set('sh-h', 70), true)");
    sizes = await p.evalJson('__sh.sizes()');
    assert.deepStrictEqual(sizes[1], [110, 70, 60]);
    assert.deepStrictEqual(sizes[3], [130, 70, 60]);
    assert.deepStrictEqual(sizes[2], [78, 70, 60]);

    // Its ↺ puts it back on the default, and undo takes that back.
    await p.evalJson("(document.querySelector('[data-act=\"size-default\"][data-dim=\"w\"]').click(), true)");
    assert.deepStrictEqual((await p.evalJson('__sh.sizes()'))[1], [130, 70, 60]);
    await p.evalJson("(document.getElementById('undo').click(), true)");
    assert.deepStrictEqual((await p.evalJson('__sh.sizes()'))[1], [110, 70, 60]);

    // Undo also walks back a shelf setting, and the band shows it.
    await p.evalJson("(document.getElementById('undo').click(), true)");
    assert.deepStrictEqual((await p.evalJson('__sh.sizes()'))[3], [130, 80, 60]);
    assert.strictEqual(await p.evalJson("document.getElementById('sh-h').value"), '80');
  });
});

test('inches change what the page shows and reads, never what it stores',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(document.getElementById('example').click(), ${PAGE_HELPERS})`);
    // Start from the factory settings, whatever an earlier test left behind.
    await p.evalJson("(__sh.set('sh-wide', 120), __sh.set('sh-h', 72), __sh.set('sh-d', 56), true)");
    await p.evalJson("(document.querySelector('[data-units=\"in\"]').click(), true)");
    try {
      assert.strictEqual(await p.evalJson("document.getElementById('sh-wide').value"), '4.72');
      await p.evalJson("(__sh.set('sh-wide', 5), true)");
      assert.strictEqual((await p.evalJson('__sh.sizes()'))[1][0], 127);
      assert.ok(await p.evalJson("[...document.querySelectorAll('#bom .sh-size')].some((td) => td.textContent.trim() === '5 × 2.83 × 2.2 in')"));
      assert.match(await p.evalJson("document.getElementById('overall').textContent"), / in$/);
    } finally {
      await p.evalJson("(localStorage.removeItem('shelf-house-units'), true)");
    }
  });
});

test('a layout saved before shelf settings loads at exactly its old sizes',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    const v2 = {
      items: [
        { id: 1, kind: 'room', name: 'Wide · doorways', base: 'wide_doorways', x: 0, y: 0, cfg: {
          w: 120, h: 90, d: 56, walls: { left: 3, right: 3, ceiling: 3, floor: 3, back: 3 },
          outerR: 8, innerR: 5, outer: { tl: true, tr: true, br: true, bl: true }, inner: { tl: true, tr: true, br: true, bl: true },
          color: '#cdb4db',
          openings: [
            { wall: 'left', shape: 'arch', x: 0, y: 0, w: 24, h: 50, r: 0, cols: 1, rows: 1, bar: 2.5, count: 1, pitch: 40 },
            { wall: 'back', shape: 'rect', x: 0, y: 22, w: 40, h: 26, r: 4, cols: 3, rows: 1, bar: 2.5, count: 1, pitch: 40 },
          ] } },
        { id: 2, kind: 'room', name: 'Narrow · blank', base: 'narrow_blank', x: 120, y: 0, cfg: {
          w: 78, h: 72, d: 56, walls: { left: 0, right: 1.2, ceiling: 2.6, floor: 3, back: 3 },
          outerR: 8, innerR: 5, outer: { tl: true, tr: true, br: true, bl: true }, inner: { tl: true, tr: true, br: true, bl: true },
          color: '#d8b4a0', openings: [] } },
      ],
    };
    await p.evalJson(`(localStorage.removeItem('shelf-house-layout-v3'), localStorage.setItem('shelf-house-layout-v2', ${JSON.stringify(JSON.stringify(v2))}), true)`);
    await p.evalJson('(location.reload(), true)');
    await new Promise((r) => setTimeout(r, 300));
    await ready(p);
    await p.evalJson(PAGE_HELPERS);
    // Nothing is committed on load, so read the sizes off the print list.
    const rows = await p.evalJson("[...document.querySelectorAll('#bom .sh-size')].map((td) => td.textContent.trim())");
    assert.deepStrictEqual(rows.sort(), ['120 × 90 × 56 mm', '78 × 72 × 56 mm']);
    // Room 1 owns its height; room 2 follows everything. The window kept its hole.
    await p.evalJson("(__sh.set('sh-h', 60), true)");
    const after = await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items");
    assert.deepStrictEqual(after.map((i) => [i.cfg.w, i.cfg.h]), [[120, 90], [78, 60]]);
    // Walls of any thickness became the nearer of thick and thin, or none.
    assert.deepStrictEqual(after[1].walls, { back: 'thick', left: 'none', right: 'thin', ceiling: 'thick', floor: 'thick' });
    assert.deepStrictEqual(after[1].cfg.walls, { back: 3, left: 0, right: 1.5, ceiling: 3, floor: 3 });
    const [door, win] = after[0].cfg.openings;
    assert.deepStrictEqual([door.anchor, door.y], ['floor', 0]);
    assert.deepStrictEqual([win.anchor, win.y], ['centre', 22 + 13 - 42]);
  });
});

test('the example is laid out for the sizes in the shelf settings',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, __sh.set('sh-wide', 140), __sh.set('sh-narrow', 60), __sh.set('sh-h', 90), document.getElementById('example').click(), true)`);
    try {
      const items = await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items");
      const at = Object.fromEntries(items.map((i) => [i.id, [i.x, i.y]]));
      // Two columns side by side, two floors high, the arched room centred on top.
      assert.deepStrictEqual([at[1], at[2], at[3], at[4], at[5]], [[0, 0], [140, 0], [0, 90], [140, 90], [30, 180]]);
      // The table stands in the middle of the top room.
      const table = items.find((i) => i.id === 6);
      assert.strictEqual(table.parent, 5);
      assert.strictEqual(table.x, (140 - 36) / 2);
    } finally {
      await p.evalJson("(__sh.set('sh-wide', 120), __sh.set('sh-narrow', 78), __sh.set('sh-h', 72), true)");
    }
  });
});

test('walls are thick, thin or missing, and take their thickness from the shelf settings',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, document.getElementById('example').click(), true)`);
    const walls = async (id) => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items"))
      .find((i) => i.id === id).cfg.walls;
    try {
      await p.evalJson("(__sh.pick(1), __sh.set('sh-walls-left', 'thin'), __sh.set('sh-walls-back', 'none'), true)");
      assert.deepStrictEqual(await walls(1), { left: 1.5, right: 3, ceiling: 3, floor: 3, back: 0 });
      // Changing a thickness in the settings changes every wall of that kind.
      await p.evalJson("(__sh.set('sh-thin', 2), __sh.set('sh-thick', 4), true)");
      assert.deepStrictEqual(await walls(1), { left: 2, right: 4, ceiling: 4, floor: 4, back: 0 });
      assert.deepStrictEqual(await walls(2), { left: 4, right: 4, ceiling: 4, floor: 4, back: 4 });
      // The inspector offers only the three choices.
      assert.deepStrictEqual(await p.evalJson("[...document.getElementById('sh-walls-left').options].map((o) => o.value)"), ['thick', 'thin', 'none']);
      await p.evalJson("(document.querySelector('[data-act=\"walls-all\"][data-v=\"thin\"]').click(), true)");
      assert.deepStrictEqual(await walls(1), { left: 2, right: 2, ceiling: 2, floor: 2, back: 2 });
    } finally {
      await p.evalJson("(__sh.set('sh-thin', 1.5), __sh.set('sh-thick', 3), true)");
    }
  });
});
