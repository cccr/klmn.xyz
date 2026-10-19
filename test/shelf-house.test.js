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

test('a lift car is one open-fronted solid, clear of its shaft, with a notch up each side', async () => {
  const { g, k } = await geometry();
  const cfg = g.defaultLift({ w: 32, rise: 66, depth: 26.5, wall: 3, rail: 1.75 });
  const car = g.buildLift(k, cfg);
  assert.strictEqual(car.status(), 'NoError');
  assert.strictEqual(car.genus(), 0);
  // 0.3 mm clear of each shaft wall and of the back, 1 mm under the ceiling.
  const bb = car.boundingBox();
  assert.deepStrictEqual([...bb.min, ...bb.max].map((v) => Math.round(v * 100) / 100), [3.3, 0, 0.3, 34.7, 65, 26.5]);
  assert.deepStrictEqual(g.blockSize('furniture', cfg), { w: 38, h: 66, d: 26.5 });
  // Floor, roof, back and two sides, less a notch half the rail deep and the
  // rail plus 0.3 mm each side wide up each side.
  const box = 31.4 * 65 * 26.2, inside = 25.4 * 59 * 23.2, notches = 2 * 0.875 * 2.35 * 65;
  assert.ok(Math.abs(car.volume() - (box - inside - notches)) < 1e-3, `${car.volume()}`);
  // Seen from the front: a frame round its inside, the notches edge-on.
  const prof = g.frontProfile(k, 'furniture', cfg);
  assert.deepStrictEqual(prof.marks, [[3.3, 0, 4.175, 65], [33.825, 0, 34.7, 65]]);
  assert.ok(prof.room.length && prof.shell.length);
});

test('a lift shaft is built into a room, and a strand glued in its grooves clears the car', async () => {
  const { g, k } = await geometry();
  const cfg = g.defaultRoom();
  const lift = g.defaultLift({ rise: 66, depth: 26.5, wall: 3, rail: 1.75 });
  // Outer left edge at x 40, from the back wall's inside face forward.
  const s = g.liftShaft({ x: 0, y: 0, cfg }, 40, lift, 3);
  assert.deepStrictEqual(s, { x: 40, w: 32, t: 3, z0: 3, z1: 29.5, rail: 1.75 });
  const shaft = { ...cfg, shafts: [s] };
  const room = g.buildRoom(k, shaft);
  assert.strictEqual(room.status(), 'NoError');
  const b = g.innerBox(cfg), ih = b.y1 - b.y0;
  // Two walls the shaft's depth and the room's inside height, less a groove
  // half the rail deep and 0.2 mm wider than it up each.
  const added = room.volume() - g.buildRoom(k, cfg).volume();
  assert.ok(Math.abs(added - 2 * (3 * ih * 26.5 - 0.875 * 1.95 * ih)) < 0.01, `added ${added} mm³`);
  // The walls join the room's frame on the front view; the grooves show edge-on.
  const prof = g.frontProfile(k, 'room', shaft);
  assert.deepStrictEqual(prof.marks, [[42.125, b.y0, 43, b.y1], [75, b.y0, 75.875, b.y1]]);
  const area = (polys) => polys.reduce((sum, p) => sum + p.reduce((a, [x, y], i) => {
    const [x2, y2] = p[(i + 1) % p.length];
    return a + (x * y2 - x2 * y) / 2;
  }, 0), 0);
  const plain = g.frontProfile(k, 'room', cfg);
  assert.ok(Math.abs(area(prof.shell) - area(plain.shell) - 2 * 3 * ih) < 0.01);

  // A strand of filament in each groove, its middle on the wall's face: it
  // fits the groove and rides in the car's notch without touching either.
  const car = g.buildLift(k, lift).translate([40, b.y0, 3]);
  for (const x of [43, 75]) {
    const strand = k.Manifold.cylinder(ih, 0.875, 0.875, 24).rotate([-90, 0, 0]).translate([x, b.y0, (3 + 29.5) / 2]);
    assert.ok(strand.intersect(room).volume() < 1e-6, `room at x ${x}`);
    assert.ok(strand.intersect(car).volume() < 1e-6, `car at x ${x}`);
  }

  // With the floor and ceiling open between the walls, the car rides up
  // from the room below, through this one and on into the room above.
  const open = ['floor', 'ceiling'].map((wall) => g.stairwell({ x: 0, y: 0, cfg }, 43, 75, 3, 29.5, wall));
  const passed = g.buildRoom(k, { ...shaft, stairwells: open });
  for (const dy of [-40, -10, 0, 30, 60]) {
    assert.ok(car.translate([0, dy, 0]).intersect(passed).volume() < 1e-6, `car ${dy} mm up`);
  }
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
    await p.evalJson("(document.querySelector('[data-jig=\"flip\"]').click(), true)");
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

test('rooms keep their places against each other when the shelf\'s widths change',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, __sh.set('sh-wide', 120), __sh.set('sh-narrow', 78), __sh.set('sh-h', 72), document.getElementById('example').click(), true)`);
    const at = () => p.evalJson("Object.fromEntries(JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items.map((i) => [i.id, i.kind === 'room' ? [i.x, i.y] : i.x]))");
    const widths = (wide, narrow) => p.evalJson(`(__sh.set('sh-wide', ${wide}), __sh.set('sh-narrow', ${narrow}), true)`);
    try {
      // The columns stay side by side, the arched room centred over both of
      // them and the table in the middle of it, as if the example were new.
      const example = await at();
      await widths(160, 78);
      assert.deepStrictEqual(await at(), { 1: [0, 0], 2: [160, 0], 3: [0, 72], 4: [160, 72], 5: [39, 144], 6: 62 });
      await widths(160, 40);
      assert.deepStrictEqual(await at(), { 1: [0, 0], 2: [160, 0], 3: [0, 72], 4: [160, 72], 5: [20, 144], 6: 62 });
      await widths(120, 78);
      assert.deepStrictEqual(await at(), example);

      // A gap on the floor stays the same gap; a room flush with an edge of
      // the rooms under it stays flush with that edge.
      const ex = await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3'))");
      const from = (src, id, x, y) => ({ ...ex.items.find((i) => i.id === src), id, x, y });
      const layout = { ...ex, items: [from(1, 1, 0, 0), from(2, 2, 140, 0), from(4, 3, 0, 72), from(3, 4, 98, 72)] };
      await p.evalJson(`(localStorage.setItem('shelf-house-layout-v3', ${JSON.stringify(JSON.stringify(layout))}), location.reload(), true)`);
      await new Promise((r) => setTimeout(r, 300));
      await ready(p);
      await p.evalJson(PAGE_HELPERS);
      await widths(160, 78);
      assert.deepStrictEqual(await at(), { 1: [0, 0], 2: [180, 0], 3: [0, 72], 4: [98, 72] });
      await widths(160, 40);
      assert.deepStrictEqual(await at(), { 1: [0, 0], 2: [180, 0], 3: [0, 72], 4: [60, 72] });
      await widths(120, 78);
      assert.deepStrictEqual(await at(), { 1: [0, 0], 2: [140, 0], 3: [0, 72], 4: [98, 72] });
    } finally {
      await widths(120, 78);
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
      const wall = (w, v) => `document.querySelector('[data-jig=wall][data-wall=${w}][data-v=${v}]').click()`;
      await p.evalJson(`(__sh.pick(1), ${wall('left', 'thin')}, ${wall('back', 'none')}, true)`);
      assert.deepStrictEqual(await walls(1), { left: 1.5, right: 3, ceiling: 3, floor: 3, back: 0 });
      // Changing a thickness in the settings changes every wall of that kind.
      await p.evalJson("(__sh.set('sh-thin', 2), __sh.set('sh-thick', 4), true)");
      assert.deepStrictEqual(await walls(1), { left: 2, right: 4, ceiling: 4, floor: 4, back: 0 });
      assert.deepStrictEqual(await walls(2), { left: 4, right: 4, ceiling: 4, floor: 4, back: 4 });
      // Each wall's panel offers only the three choices, and the rail none.
      assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('[data-jig=wall][data-wall=left]')].map((b) => b.dataset.v)"), ['thick', 'thin', 'none']);
      assert.strictEqual(await p.evalJson("!!document.querySelector('#inspector [data-path^=\"walls.\"], #inspector .sh-corners, #inspector .sh-corner')"), false);
    } finally {
      await p.evalJson("(__sh.set('sh-thin', 1.5), __sh.set('sh-thick', 3), true)");
    }
  });
});

test('a selected room is edited in place from panels on its walls',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, document.getElementById('example').click(), __sh.pick(3), true)`);
    const room = async () => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === 3);
    const click = (sel) => p.evalJson(`(document.querySelector('${sel}').click(), true)`);
    // Five folded panels, one per wall; nothing lit until one is worked in.
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-jig-panel')].map((e) => e.dataset.panel)"),
      ['ceiling', 'left', 'right', 'floor', 'back']);
    assert.strictEqual(await p.evalJson("!!document.querySelector('#mat .wall-hi')"), false);

    // Focusing a tab opens its panel and lights that wall.
    await p.evalJson("(document.querySelector('.sh-jig-panel[data-panel=left] .sh-jig-tab').focus(), true)");
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-jig-panel[data-panel=left]').classList.contains('is-hot')"), true);
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .wall-hi rect').length"), 1);

    await click('[data-jig=wall][data-wall=left][data-v=none]');
    assert.strictEqual((await room()).walls.left, 'none');
    // Still working in the same panel, and the missing wall shows as a broken edge.
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-jig-panel[data-panel=left]').contains(document.activeElement)"), true);
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .wall-hi .open').length"), 1);

    // Add a round window to the back wall: it lands clear of the one there,
    // and is picked, so it can be removed again from the same panel.
    const before = (await room()).cfg.openings.length;
    await p.evalJson("(document.querySelector('.sh-jig-panel[data-panel=back] .sh-jig-tab').focus(), true)");
    await click('[data-jig=add][data-wall=back][data-v=porthole]');
    let ops = (await room()).cfg.openings;
    assert.strictEqual(ops.length, before + 1);
    const added = ops.at(-1);
    assert.deepStrictEqual([added.wall, added.shape], ['back', 'round']);
    assert.ok(ops.filter((o) => o.wall === 'back' && o !== added).every((o) => Math.abs(o.x - added.x) >= (o.w + added.w) / 2));
    assert.strictEqual(await p.evalJson(`!!document.querySelector('.sh-jig-op.is-picked[data-i="${before}"]')`), true);
    await click(`[data-jig=del][data-i="${before}"]`);
    assert.strictEqual((await room()).cfg.openings.length, before);

    // Undo brings the round window back; the panels follow the history.
    await p.evalJson("(document.getElementById('undo').click(), true)");
    assert.strictEqual((await room()).cfg.openings.length, before + 1);
  });
});

test('the blocks sit over the front view as pictures, in a row that folds away',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    // Out of the rail, ahead of the front view, and nothing but pictures.
    assert.strictEqual(await p.evalJson("!!document.querySelector('.rail #palette')"), false);
    assert.strictEqual(await p.evalJson("!!(document.getElementById('palette').compareDocumentPosition(document.getElementById('mat')) & Node.DOCUMENT_POSITION_FOLLOWING)"), true);
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('#palette .sh-card')].filter((b) => b.textContent.trim()).length"), 0);
    assert.match(await p.evalJson("document.querySelector('#palette [aria-label=\"Add Narrow · blank\"]').title"), /^Narrow · blank, 78 × 72 mm/);
    // Folding is remembered.
    try {
      await p.evalJson("(document.getElementById('blocks-toggle').click(), true)");
      assert.strictEqual(await p.evalJson("document.getElementById('palette').hidden"), true);
      assert.strictEqual(await p.evalJson("localStorage.getItem('shelf-house-blocks')"), 'hidden');
      assert.strictEqual(await p.evalJson("document.getElementById('blocks-toggle').getAttribute('aria-expanded')"), 'false');
    } finally {
      await p.evalJson("(localStorage.removeItem('shelf-house-blocks'), true)");
    }
  });
});

test('corners are rounded from dots on the front view, at the shelf\'s radii',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, document.getElementById('example').click(), __sh.pick(1), true)`);
    const room = async (id) => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === id);
    assert.strictEqual(await p.evalJson("document.querySelectorAll('.sh-jig .sh-corner').length"), 8);
    await p.evalJson("(document.querySelector('.sh-corner[data-ring=outer][data-c=tl]').click(), true)");
    assert.deepStrictEqual((await room(1)).cfg.outer, { tl: false, tr: true, br: true, bl: true });
    // Shift sets the whole ring to what the clicked corner becomes.
    await p.evalJson("(document.querySelector('.sh-corner[data-ring=inner][data-c=br]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })), true)");
    assert.deepStrictEqual((await room(1)).cfg.inner, { tl: false, tr: false, br: false, bl: false });
    // A corner beside a missing wall is square and its dot says so.
    await p.evalJson("(document.querySelector('[data-jig=wall][data-wall=right][data-v=none]').click(), true)");
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-corner[data-ring=outer][data-c=tr]').disabled"), true);
    // The radii are the shelf's.
    try {
      await p.evalJson("(__sh.set('sh-outerR', 12), __sh.set('sh-innerR', 2), true)");
      for (const id of [1, 2, 5]) {
        const c = (await room(id)).cfg;
        assert.deepStrictEqual([c.outerR, c.innerR], [12, 2]);
      }
    } finally {
      await p.evalJson("(__sh.set('sh-outerR', 8), __sh.set('sh-innerR', 5), true)");
    }
  });
});

test('tables and stairs are sized from panels around them',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, localStorage.removeItem('shelf-house-units'), document.getElementById('example').click(), true)`);
    const item = async (id) => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === id);
    // The table: four sizes, each in a tab that reads its value; none on the rail.
    await p.evalJson("(__sh.pick(6), true)");
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-jig-panel')].map((e) => e.dataset.panel)"), ['topD', 'stemD', 'height', 'baseD']);
    assert.strictEqual(await p.evalJson("document.querySelector('[data-panel=topD] .sh-jig-val').textContent"), '36');
    assert.strictEqual(await p.evalJson("!!document.querySelector('#inspector input[type=number]')"), false);
    await p.evalJson("(document.querySelector('[data-panel=topD] .sh-jig-tab').focus(), __sh.set('sh-jig-topD', 40), true)");
    assert.strictEqual((await item(6)).cfg.topD, 40);
    assert.strictEqual(await p.evalJson("document.querySelector('[data-panel=topD] .sh-jig-val').textContent"), '40');
    // In inches, a typed value is stored in millimetres.
    try {
      await p.evalJson("(document.querySelector('[data-units=in]').click(), document.querySelector('[data-panel=height] .sh-jig-tab').focus(), __sh.set('sh-jig-height', 1), true)");
      assert.strictEqual((await item(6)).cfg.height, 25.4);
    } finally {
      await p.evalJson("(document.querySelector('[data-units=mm]').click(), true)");
    }
    await p.evalJson("(document.getElementById('undo').click(), true)");
    assert.strictEqual((await item(6)).cfg.height, 26.5);

    // Stairs: run below, steps beside, a turn above.
    await p.evalJson("(__sh.pick(1), document.querySelector('#palette [aria-label=\"Add Stairs\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), true)");
    const id = await p.evalJson("Math.max(...JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items.map((i) => i.id))");
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-jig-panel')].map((e) => e.dataset.panel)"), ['turn', 'run', 'steps']);
    await p.evalJson("(document.querySelector('[data-panel=run] .sh-jig-tab').focus(), __sh.set('sh-jig-run', 40), true)");
    assert.strictEqual((await item(id)).cfg.run, 40);
    await p.evalJson("(document.querySelector('[data-panel=turn] .sh-jig-tab').focus(), document.querySelector('[data-jig=flip]').click(), true)");
    assert.strictEqual((await item(id)).cfg.flip, true);
  });
});

test('a lift raises its shaft through the floors set, as far as rooms above hold it',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, localStorage.removeItem('shelf-house-units'), document.getElementById('example').click(), true)`);
    const items = () => p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items");
    // Rooms 1, 3 and 5 stand on each other; 5 is shifted right by half a narrow room.
    const column = async (key) => {
      const all = await items();
      return [1, 3, 5].map((id) => all.find((i) => i.id === id).cfg[key]);
    };
    const shafts = async () => (await column('shafts')).map((s) => s.length);
    const holes = async () => (await column('stairwells')).map((s) => s.map((o) => o.wall));
    const where = () => p.evalJson("document.getElementById('selection').textContent");

    await p.evalJson("(__sh.pick(1), document.querySelector('#palette [aria-label=\"Add Lift\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), true)");
    const id = await p.evalJson("Math.max(...JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items.map((i) => i.id))");
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-jig-panel')].map((e) => e.dataset.panel)"), ['floors', 'width', 'rail']);
    assert.deepStrictEqual(await shafts(), [1, 1, 0]);
    assert.deepStrictEqual(await holes(), [['ceiling'], ['floor'], []]);
    assert.match(await where(), /serving 2 floors/);
    assert.ok(await p.evalJson("[...document.querySelectorAll('#bom td')].some((td) => td.textContent.trim() === 'Lift')"));

    // Three floors: room 5's left wall stands where the shaft would go up, so it stops.
    await p.evalJson("(document.querySelector('[data-panel=floors] .sh-jig-tab').focus(), __sh.set('sh-jig-floors', 3), true)");
    assert.strictEqual((await items()).find((i) => i.id === id).cfg.floors, 3);
    assert.deepStrictEqual(await shafts(), [1, 1, 0]);
    assert.match(await where(), /serving 2 of 3 floors/);
    // 10 mm to the right, room 5 holds it too.
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true })), true)");
    assert.deepStrictEqual(await shafts(), [1, 1, 1]);
    assert.deepStrictEqual(await holes(), [['ceiling'], ['floor', 'ceiling'], ['floor']]);
    assert.match(await where(), /serving 3 floors/);
    // Every room's grooves are in the same place, so one rail runs up through them.
    const lines = await p.evalJson(`[1, 3, 5].map((id) => {
      const r = document.querySelector('#mat .block[data-id="' + id + '"]');
      return [...r.querySelectorAll('.mark')].map((m) => m.getBBox()).filter((b) => b.width < 1).map((b) => Math.round(b.x * 1000) / 1000).sort((a, b) => a - b);
    })`);
    assert.strictEqual(lines[0].length, 2);
    assert.deepStrictEqual(lines[1], lines[0]);
    assert.deepStrictEqual(lines[2], lines[0]);

    // The other common filament: every groove and both notches follow.
    await p.evalJson("(document.querySelector('[data-panel=rail] .sh-jig-tab').focus(), document.querySelector('[data-jig=rail][data-v=\"2.85\"]').click(), true)");
    assert.strictEqual((await items()).find((i) => i.id === id).cfg.rail, 2.85);
    assert.deepStrictEqual((await column('shafts')).map((s) => s[0].rail), [2.85, 2.85, 2.85]);

    // Deleting it closes every room again.
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })), true)");
    assert.deepStrictEqual(await shafts(), [0, 0, 0]);
    assert.deepStrictEqual(await holes(), [[], [], []]);
  });
});

test('a side wall takes round and arched windows, and tabs carry no counts',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, document.getElementById('example').click(), __sh.pick(2), true)`);
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('[data-jig=add][data-wall=left]')].map((b) => b.dataset.v)"), ['doorway', 'window', 'porthole', 'arch']);
    await p.evalJson("(document.querySelector('[data-panel=left] .sh-jig-tab').focus(), document.querySelector('[data-jig=add][data-wall=left][data-v=porthole]').click(), true)");
    const ops = (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === 2).cfg.openings;
    assert.deepStrictEqual([ops.at(-1).wall, ops.at(-1).shape], ['left', 'round']);
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-jig-tab')].map((t) => t.textContent.replace(/\\D/g, ''))"), ['', '', '', '', '']);
  });
});

test('the layout buttons sit with undo and redo, grouped by what they do',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    assert.deepStrictEqual(
      await p.evalJson("[...document.querySelectorAll('.sh-tools > .chips')].map((g) => [...g.querySelectorAll('button')].map((b) => b.textContent.trim()))"),
      [['undo', 'redo'], ['example', 'clear'], ['open', 'save'], ['blocks']]);
    assert.strictEqual(await p.evalJson("!!document.querySelector('.rail #example, .rail #save, .rail #open')"), false);
    // Open is a real button, so it can be reached from the keyboard; it hands
    // over to the hidden file input.
    assert.strictEqual(await p.evalJson(`(() => {
      let asked = false;
      document.getElementById('open').addEventListener('click', (e) => { asked = true; e.preventDefault(); }, { once: true });
      document.getElementById('open-layout').click();
      return asked;
    })()`), true);
  });
});

test('a block\'s name, colour, size and actions are in the line under the front view',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, document.getElementById('example').click(), __sh.pick(3), true)`);
    const item = async (id) => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === id);
    // There is no rail: the page is the bed, under a head with the tool's name.
    assert.strictEqual(await p.evalJson("!!document.querySelector('.rail, #inspector')"), false);
    assert.strictEqual(await p.evalJson("document.querySelector('.tool-head h1').textContent"), 'Shelf House');
    assert.deepStrictEqual(await p.evalJson("['sh-name', 'sh-color', 'sh-cfg-w', 'sh-cfg-h', 'sh-cfg-d'].map((id) => document.getElementById(id)?.closest('#block-bar') != null)"), [true, true, true, true, true]);

    // Renamed and resized in place; a typed size gets its ↺, and the field it
    // is typed in keeps the focus.
    await p.evalJson("(document.getElementById('sh-cfg-h').focus(), __sh.set('sh-name', 'Hall'), __sh.set('sh-cfg-h', 80), true)");
    const room = await item(3);
    assert.deepStrictEqual([room.name, room.cfg.h, room.own.h], ['Hall', 80, true]);
    assert.strictEqual(await p.evalJson("document.activeElement.id"), 'sh-cfg-h');
    assert.ok(await p.evalJson("!!document.querySelector('#block-bar [data-act=size-default][data-dim=h]')"));
    // Focusing a size draws it on the room.
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .wall-hi .dim').length"), 3);
    assert.match(await p.evalJson("document.getElementById('selection').textContent"), /floor 2/);

    // The rarer actions are behind ⋯, and the menu closes on a choice.
    await p.evalJson("(document.querySelector('#block-bar .sh-more summary').click(), true)");
    assert.strictEqual(await p.evalJson("document.querySelector('#block-bar .sh-more').open"), true);
    await p.evalJson("(document.querySelector('#block-bar [data-act=reset]').click(), true)");
    assert.deepStrictEqual([(await item(3)).name, (await item(3)).cfg.h], ['Wide · doorways', 72]);
    assert.strictEqual(await p.evalJson("!!document.querySelector('#block-bar .sh-more[open]')"), false);

    const before = (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).length;
    await p.evalJson("(document.querySelector('#block-bar [data-act=duplicate]').click(), true)");
    assert.strictEqual((await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).length, before + 1);
    await p.evalJson("(document.querySelector('#block-bar [data-act=delete]').click(), true)");
    assert.strictEqual((await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).length, before);
  });
});

test('a window is picked on the front view, dragged, resized and edited in its card',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, document.getElementById('example').click(), document.getElementById('mat').scrollIntoView({ block: 'center' }), true)`);
    const ops = async () => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === 1).cfg.openings;
    // Screen point of a spot on room 1 (it stands at 0, 0), in mm.
    const at = (x, y) => p.evalJson(`(() => { const q = new DOMPoint(${x}, ${-y}).matrixTransform(document.getElementById('mat').getScreenCTM()); return [q.x, q.y]; })()`);
    const press = async (target, [x0, y0], [x1, y1]) => p.evalJson(`(() => {
      const el = ${target} || document.elementFromPoint(${x0}, ${y0});
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: ${x0}, clientY: ${y0}, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: ${x1}, clientY: ${y1} }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: ${x1}, clientY: ${y1} }));
      return true;
    })()`);

    // The left porthole is centred 26 mm left of the middle, 4 mm above it:
    // press it and drag it 10 mm right and 5 mm up.
    const from = await at(60 - 26, 36 + 4);
    const to = await at(60 - 16, 36 + 9);
    await press('null', from, to);
    let o = (await ops())[0];
    assert.deepStrictEqual([o.x, o.y], [-16, 9]);
    // The room is selected with the window picked and its card open.
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-op-card .sh-opening-head').textContent.trim().startsWith('Opening 1')"), true);
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .op-hi rect').length"), 1);

    // Its handle resizes it about its centre.
    const h = await p.evalJson("(() => { const r = document.querySelector('.sh-op-handle').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
    const mm = await p.evalJson("1 / document.getElementById('mat').getScreenCTM().a");
    await press("document.querySelector('.sh-op-handle')", h, [h[0] + 3 / mm, h[1]]);
    o = (await ops())[0];
    assert.deepStrictEqual([o.w, o.h], [40, 34]);

    // The card's fields and pictures edit it, one undo step each.
    await p.evalJson("(__sh.set('sh-op-h', 30), document.querySelector('.sh-op-card [data-jig=set][data-v=rect]').click(), true)");
    o = (await ops())[0];
    assert.deepStrictEqual([o.h, o.shape], [30, 'rect']);
    await p.evalJson("(document.getElementById('undo').click(), true)");
    assert.strictEqual((await ops())[0].shape, 'round');

    // Escape closes the card but keeps the room selected; pressing the room
    // away from its openings drops the pick too.
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true)");
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-op-card')"), false);
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-jig-panel')"), true);
  });
});

test('the settings fold to one line, and the front view and 3D share the width at a divider',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.setViewport(1400, 900);
    try {
      // Folded, the band reads its sizes on one line; the fold is remembered.
      await p.evalJson("(document.getElementById('settings-fold').click(), true)");
      assert.strictEqual(await p.evalJson("document.getElementById('settings').offsetHeight"), 0);
      assert.match(await p.evalJson("document.getElementById('settings-summary').textContent"), /^rooms 120 or 78 × 72 × 56, walls 3 \/ 1\.5, corners 8 \/ 5 mm$/);
      assert.strictEqual(await p.evalJson("localStorage.getItem('shelf-house-settings')"), 'folded');

      // The front view starts wider than 3D; the divider moves with the keys,
      // within limits, and double-click puts it back.
      const widths = () => p.evalJson("[...document.querySelectorAll('.sh-pane')].map((e) => Math.round(e.getBoundingClientRect().width))");
      const [front, three] = await widths();
      assert.ok(front > three * 1.5, `${front} vs ${three}`);
      await p.evalJson("(() => { const s = document.getElementById('split'); s.focus(); for (let i = 0; i < 10; i++) s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return true; })()");
      assert.strictEqual(await p.evalJson("document.getElementById('split').getAttribute('aria-valuenow')"), '80');
      await p.evalJson("(document.getElementById('split').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), true)");
      assert.strictEqual(await p.evalJson("document.getElementById('split').getAttribute('aria-valuenow')"), '64');
    } finally {
      await p.evalJson("(localStorage.removeItem('shelf-house-settings'), localStorage.removeItem('shelf-house-split'), true)");
    }
  });
});

// On a phone a tap lifts the finger (pointerleave) before its click arrives,
// and iOS gives a tapped button no focus. The panels used to fold on that
// pointerleave, so a tapped button was hidden before its click and nothing
// happened: removing a wall did not work on a phone.
test('panels work by tapping, the way iOS taps',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    try {
      // Like iOS: a tap does not focus the button it lands on.
      await p.evalJson("(document.addEventListener('mousedown', (e) => e.preventDefault(), true), document.getElementById('example').click(), document.getElementById('mat').scrollIntoView({ block: 'center' }), true)");
      await new Promise((r) => setTimeout(r, 300));
      const tap = async (sel) => {
        const [x, y] = await p.evalJson(`(() => { const r = (${sel}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
        await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await new Promise((r) => setTimeout(r, 150));
      };
      const room = async () => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === 1);

      await tap("document.querySelector('#mat .block[data-id=\"1\"] path')");
      await tap("document.querySelector('.sh-jig-panel[data-panel=left] .sh-jig-tab')");
      await tap("document.querySelector('[data-jig=wall][data-wall=left][data-v=none]')");
      assert.strictEqual((await room()).walls.left, 'none');

      await tap("document.querySelector('.sh-jig-panel[data-panel=right] .sh-jig-tab')");
      await tap("document.querySelector('[data-jig=add][data-wall=right][data-v=porthole]')");
      const o = (await room()).cfg.openings.at(-1);
      assert.deepStrictEqual([o.wall, o.shape], ['right', 'round']);
      assert.strictEqual(await p.evalJson("document.querySelector('.sh-jig-panel[data-panel=right]').classList.contains('is-hot')"), true);

      // A tap outside the panels folds them.
      await tap("document.querySelector('.tool-head h1')");
      assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-jig-panel.is-hot')"), false);
    } finally {
      await p.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});
