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

test('a new room\'s sizes sit on the starting grid, in millimetres and in inches', async () => {
  const { g } = await geometry();
  // 5 mm and ⅛ in, as the page's grid starts; walls and radii are too fine for it.
  const on = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-9;
  for (const k of ['wide', 'narrow', 'h', 'd']) {
    assert.ok(on(g.ROOM_DEFAULTS[k], 5), `${k} ${g.ROOM_DEFAULTS[k]} mm`);
    assert.ok(on(g.ROOM_DEFAULTS_IN[k] / 25.4, 0.125), `${k} ${g.ROOM_DEFAULTS_IN[k] / 25.4} in`);
  }
  for (const k of ['thick', 'thin', 'outerR', 'innerR']) assert.strictEqual(g.ROOM_DEFAULTS_IN[k], g.ROOM_DEFAULTS[k]);
});

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
  // Absolute x 20–76, z 3–29 (back half of a 55 mm deep room).
  const below = g.stairwell(room(0, 120), 20, 76, 3, 29, 'ceiling');
  assert.deepStrictEqual([below.x, below.y, below.w, below.h], [-12, -13, 56, 26]);
  // A narrower room on top, shifted right: same absolute hole, its own offsets.
  const above = g.stairwell(room(40, 78), 20, 76, 3, 29, 'floor');
  assert.strictEqual(above.wall, 'floor');
  assert.strictEqual(above.x, 48 - 40 - 39);
  // A room that only shares the hole's span with its wall gets nothing.
  assert.strictEqual(g.stairwell(room(74, 78), 20, 76, 3, 29, 'floor'), null);
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

// A guide rib stands 1.5 mm off each side of the car; its V-groove is 0.3 mm
// clear of it on both flanks, so its point is 0.3·√2 past the rib's.
const RIB = 1.5, GROOVE = RIB - 0.3 + 0.3 * Math.SQRT2;

test('a lift car is one open-fronted solid, clear of its shaft, with a guide rib up each side', async () => {
  const { g, k } = await geometry();
  // No back to seat magnets in: the latch has a test of its own.
  const cfg = g.defaultLift({ w: 32, rise: 66, depth: 26.5, back: 0, wall: 3, panel: 1.5 });
  const car = g.buildLift(k, cfg);
  assert.strictEqual(car.status(), 'NoError');
  assert.strictEqual(car.genus(), 0);
  // 0.3 mm clear of each shaft wall, of the back and of the front edge of
  // the openings it rides through, 1 mm under the ceiling; the ribs reach
  // past the walls' faces into their grooves.
  const bb = car.boundingBox();
  assert.deepStrictEqual([...bb.min, ...bb.max].map((v) => Math.round(v * 100) / 100), [1.8, 0, 0.3, 36.2, 65, 26.2]);
  assert.deepStrictEqual(g.blockSize('furniture', cfg), { w: 38, h: 66, d: 26.5 });
  // Floor, roof, back and two sides, 1.5 mm panels, and up each side a
  // right-angled triangle 3 mm across its base and 1.5 mm high.
  const box = 31.4 * 65 * 25.9, inside = 28.4 * 62 * 24.4, ribs = 2 * RIB * RIB * 65;
  assert.ok(Math.abs(car.volume() - (box - inside + ribs)) < 1e-3, `${car.volume()}`);
  // Its panels follow the shelf's thin walls.
  const thinner = g.buildLift(k, { ...cfg, panel: 1 });
  assert.ok(Math.abs(thinner.volume() - (box - 29.4 * 63 * 24.9 + ribs)) < 1e-3, `${thinner.volume()}`);
  // Seen from the front: a frame round its inside, the ribs end-on.
  const prof = g.frontProfile(k, 'furniture', cfg);
  assert.deepStrictEqual(prof.marks.map((m) => m.map((v) => Math.round(v * 100) / 100)), [[1.8, 0, 3.3, 65], [34.7, 0, 36.2, 65]]);
  assert.ok(prof.room.length && prof.shell.length);
});

test('a lift shaft is built into a room, and the car runs in its grooves on a sliding fit', async () => {
  const { g, k } = await geometry();
  const cfg = g.defaultRoom();
  // Without magnets, which have a test of their own.
  const lift = g.defaultLift({ rise: 64, depth: 26.5, back: 0, wall: 3, panel: 1.5 });
  // Outer left edge at x 40, from the back wall's inside face forward.
  const s = g.liftShaft({ x: 0, y: 0, cfg }, 40, lift, 3);
  assert.deepStrictEqual(s, { x: 40, w: 32, t: 3, z0: 3, z1: 29.5, floor: false, ceiling: false, magnets: null });
  const shaft = { ...cfg, shafts: [s] };
  const room = g.buildRoom(k, shaft);
  assert.strictEqual(room.status(), 'NoError');
  const b = g.innerBox(cfg), ih = b.y1 - b.y0;
  // Two walls the shaft's depth and the room's inside height, less a 90°
  // V-groove up each, GROOVE deep and twice that across its mouth.
  const added = room.volume() - g.buildRoom(k, cfg).volume();
  assert.ok(Math.abs(added - 2 * (3 * ih * 26.5 - GROOVE * GROOVE * ih)) < 0.01, `added ${added} mm³`);
  // The walls join the room's frame on the front view; the grooves show end-on.
  const near = (a, e) => a.length === e.length && a.every((v, i) => Math.abs(v - e[i]) < 1e-9);
  const prof = g.frontProfile(k, 'room', shaft);
  assert.strictEqual(prof.marks.length, 2);
  assert.ok(near(prof.marks[0], [43 - GROOVE, b.y0, 43, b.y1]) && near(prof.marks[1], [75, b.y0, 75 + GROOVE, b.y1]), JSON.stringify(prof.marks));
  const area = (polys) => polys.reduce((sum, p) => sum + p.reduce((a, [x, y], i) => {
    const [x2, y2] = p[(i + 1) % p.length];
    return a + (x * y2 - x2 * y) / 2;
  }, 0), 0);
  const plain = g.frontProfile(k, 'room', cfg);
  assert.ok(Math.abs(area(prof.shell) - area(plain.shell) - 2 * 3 * ih) < 0.01);

  // The car in its shaft touches nothing, nor when it is pushed nearly the
  // whole running clearance any way across or along the shaft. Pulled
  // forward further, its ribs bear on the grooves' flanks: they hold it in.
  const car = g.buildLift(k, lift).translate([40, b.y0, 3]);
  const hits = (dx, dz) => car.translate([dx, 0, dz]).intersect(room).volume() > 1e-6;
  for (const [dx, dz] of [[0, 0], [-0.29, 0], [0.29, 0], [0, -0.29], [0, 0.29]]) assert.ok(!hits(dx, dz), `car moved ${dx}, ${dz}`);
  assert.ok(hits(0, 0.6));

  // With the floor and ceiling open between the walls and the grooves carried
  // on through both, the car rides up from the room below, through this one
  // and on into the room above.
  const open = ['floor', 'ceiling'].map((wall) => g.stairwell({ x: 0, y: 0, cfg }, 43, 75, 3, 29.5, wall));
  const through = { ...s, floor: true, ceiling: true };
  const passed = g.buildRoom(k, { ...shaft, shafts: [through], stairwells: open });
  for (const dy of [-40, -10, 0, 30, 60]) {
    assert.ok(car.translate([0, dy, 0]).intersect(passed).volume() < 1e-6, `car ${dy} mm up`);
    // Its front clears the front edge of the openings, as its sides clear the walls.
    assert.ok(car.translate([0, dy, 0.29]).intersect(passed).volume() < 1e-6, `car ${dy} mm up and forward`);
  }
  // The grooves run out through the floor and the ceiling, and show so.
  const t = cfg.walls;
  const shut = g.buildRoom(k, { ...shaft, stairwells: open });
  const lost = shut.volume() - passed.volume();
  assert.ok(Math.abs(lost - 2 * GROOVE * GROOVE * (t.floor + t.ceiling)) < 0.01, `removed ${lost} mm³`);
  const marks = g.frontProfile(k, 'room', { ...shaft, shafts: [through] }).marks;
  assert.ok(near(marks[0], [43 - GROOVE, 0, 43, cfg.h]), JSON.stringify(marks));
  // Without them the ceiling stops the ribs.
  assert.ok(car.translate([0, 30, 0]).intersect(shut).volume() > 1e-6);
});

test('magnets in the car and the back wall latch it at each floor', async () => {
  const { g, k } = await geometry();
  const cfg = g.defaultRoom();
  const lift = g.defaultLift({ w: 32, rise: 64, depth: 26.5, back: 3, wall: 3, panel: 1.5 });
  const b = g.innerBox(cfg);
  const round = (at) => at.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  // A car this size takes one 4 × 2 mm disc, which holds it three times over:
  // on its back, centred, its post standing on the floor panel.
  const m = g.liftMagnets(lift);
  assert.deepStrictEqual({ ...m, at: round(m.at) }, { d: 4, h: 2, at: [[19, 4.4]] });
  const car = g.buildLift(k, lift);
  assert.strictEqual(car.status(), 'NoError');
  assert.strictEqual(car.genus(), 0);

  // The disc fits the car's pocket, 0.6 mm in front of its back face, and the
  // pocket is open above it; the room's fits its pocket from behind, 0.6 mm
  // short of the face the car runs on.
  const disc = (x, y, z) => k.Manifold.cylinder(m.h, m.d / 2, m.d / 2, 64).translate([x, y, z]);
  const [[mx, my]] = m.at;
  assert.ok(disc(mx, my, 0.9).intersect(car).volume() < 1e-6);
  assert.ok(disc(mx, my, 0.85).intersect(car).volume() > 1e-6);
  assert.ok(disc(mx, my, 3).intersect(car).volume() < 1e-6, 'drops in from inside');
  const s = g.liftShaft({ x: 0, y: 0, cfg }, 40, lift, 3);
  assert.deepStrictEqual({ ...s.magnets, at: round(s.magnets.at) }, { d: 4, h: 2, at: [[59, b.y0 + 4.4]] });
  const room = g.buildRoom(k, { ...cfg, shafts: [s] });
  assert.strictEqual(room.status(), 'NoError');
  const [[rx, ry]] = s.magnets.at;
  assert.ok(disc(rx, ry, 0.4).intersect(room).volume() < 1e-6);
  assert.ok(disc(rx, ry, 0.45).intersect(room).volume() > 1e-6);
  assert.ok(disc(rx, ry, -1.5).intersect(room).volume() < 1e-6, 'goes in from the back');
  // Standing on the floor, the car's magnet is square in front of the room's.
  assert.ok(Math.abs(40 + mx - rx) < 1e-9 && Math.abs(b.y0 + my - ry) < 1e-9);

  // A room with a thinner back than the one the lift stands in gets a pad up
  // to the car, so its magnet sits the same distance behind the car.
  const thin = { ...cfg, walls: { ...cfg.walls, back: 1.5 } };
  const padded = g.buildRoom(k, { ...thin, shafts: [s] });
  assert.ok(disc(rx, ry, 0.4).intersect(padded).volume() < 1e-6);
  assert.ok(disc(rx, ry, 0.45).intersect(padded).volume() > 1e-6);

  // Size follows the car's weight and the count its width: a taller car
  // takes a bigger magnet, a wider one more of them, one each 50 mm, spread
  // evenly across its back; a car with more posts than a size has room for
  // takes another.
  const vol = (q) => q.d * q.d * q.h;
  const tall = g.liftMagnets({ ...lift, rise: 200 });
  assert.strictEqual(tall.at.length, 1);
  assert.ok(vol(tall) > vol(m), JSON.stringify(tall));
  const wide = g.liftMagnets({ ...lift, w: 200 });
  assert.strictEqual(wide.at.length, 4);
  const gaps = wide.at.slice(1).map(([x], i) => x - wide.at[i][0]);
  assert.ok(gaps.every((d) => Math.abs(d - gaps[0]) < 1e-9) && wide.at.every(([, y]) => y === wide.at[0][1]));
  // A thinner back takes a thinner magnet; one too thin for any, or a car
  // too small for a post, takes none, and the car is left plain.
  assert.strictEqual(g.liftMagnets({ ...lift, back: 2.5 }).h, 1);
  assert.strictEqual(g.liftMagnets({ ...lift, back: 1.5 }), null);
  assert.strictEqual(g.liftMagnets({ ...lift, w: 4 }), null);
  assert.strictEqual(g.buildLift(k, { ...lift, back: 1.5 }).volume(), g.buildLift(k, { ...lift, back: 0 }).volume());
  assert.strictEqual(g.liftShaft({ x: 0, y: 0, cfg }, 40, { ...lift, back: 1.5 }, 3).magnets, null);
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

// An arch is a straight body under a round top. The top used to be a whole
// circle, so on an opening wider than it was tall (the + adds a 34 × 30 window)
// its lower half poked out under the bottom and gave the hole a curve there.
test('an arch stays inside its own box, with a flat bottom, whatever its proportions', async () => {
  const { g, k } = await geometry();
  const cfg0 = g.defaultRoom();
  const b = g.innerBox(cfg0);
  const mid = (b.y0 + b.y1) / 2, cx = cfg0.w / 2;
  for (const [w, h] of [[22, 40], [34, 34], [34, 30], [40, 20], [40, 12], [60, 8]]) {
    const cfg = g.defaultRoom({ openings: [g.defaultOpening({ wall: 'back', shape: 'arch', w, h })] });
    const [hole] = g.frontProfile(k, 'room', cfg).holes;
    const xs = hole.map(([x]) => x), ys = hole.map(([, y]) => y);
    const label = `${w} × ${h}`;
    const near = (a, v) => Math.abs(a - v) < 1e-6;
    assert.ok(near(Math.min(...ys), mid - h / 2), `${label}: bottom ${Math.min(...ys)}`);
    assert.ok(near(Math.max(...ys), mid + h / 2), `${label}: top ${Math.max(...ys)}`);
    assert.ok(near(Math.min(...xs), cx - w / 2) && near(Math.max(...xs), cx + w / 2), `${label}: width`);
    // The bottom is straight: it has just its two corners, and nothing between.
    assert.strictEqual(hole.filter(([, y]) => near(y, mid - h / 2)).length, 2, `${label}: flat bottom`);
    // A semicircle on a body where it fits, a flatter arch where it does not.
    const r = w / 2, ry = Math.min(r, h);
    const area = w * (h - ry) + (Math.PI * r * ry) / 2;
    const got = Math.abs(hole.reduce((a, [x, y], i) => { const [x2, y2] = hole[(i + 1) % hole.length]; return a + (x * y2 - x2 * y); }, 0)) / 2;
    assert.ok(Math.abs(got - area) / area < 0.01, `${label}: area ${got.toFixed(1)} against ${area.toFixed(1)}`);
    // The solid loses exactly that much of the back wall, and is still one piece.
    const room = g.buildRoom(k, cfg);
    const lost = g.buildRoom(k, { ...cfg, openings: [] }).volume() - room.volume();
    assert.ok(Math.abs(lost - got * cfg.walls.back) / (got * cfg.walls.back) < 0.01, `${label}: the solid loses ${lost.toFixed(1)} mm³`);
    assert.strictEqual(room.decompose().length, 1, `${label}: one solid`);
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
  assert.deepStrictEqual(m.boundingBox().max.map(Math.round), [120, 70, 55]);
  // Nothing of the left wall or the back is left, and the doorway on the
  // missing wall cuts nothing: what remains is ceiling, floor and right wall.
  const t = full.walls;
  const solid = (120 * (t.ceiling + t.floor) + (70 - t.ceiling - t.floor) * t.right) * 55;
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
    // Each hole spans the top half of the run, measured from the stairs' left end.
    const holes = `(() => {
      const items = JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items;
      const st = items.find((i) => i.cfg.form === 'stairs'), host = items.find((i) => i.id === st.parent);
      return [1, 3].map((id) => {
        const m = items.find((i) => i.id === id), [o] = m.cfg.stairwells, mid = m.x + m.cfg.w / 2 + o.x;
        return [mid - o.w / 2, mid + o.w / 2].map((v) => Math.round((v - host.x - st.x) / st.cfg.run * 100) / 100);
      });
    })()`;
    assert.deepStrictEqual(await p.evalJson(holes), [[0.5, 1], [0.5, 1]]);

    // Turning them moves the stairwells to the end that is now high; deleting
    // them closes both again.
    await p.evalJson("(document.querySelector('[data-jig=\"flip\"]').click(), true)");
    assert.deepStrictEqual([await p.evalJson(marks(1)), await p.evalJson(marks(3))], [before[0] + 1, before[1] + 1]);
    assert.deepStrictEqual(await p.evalJson(holes), [[0, 0.5], [0, 0.5]]);
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })), true)");
    assert.deepStrictEqual([await p.evalJson(marks(1)), await p.evalJson(marks(3))], before);
  });
});

// Page helpers: wait for the engine, then drive the page from inside it.
// A desktop-sized view with motion off, so the camera lands where it is going at once.
const ready = async (p) => {
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await p.setViewport(1400, 1000);
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
    assert.deepStrictEqual(sizes[2], [80, 80, 60]);

    // A width typed into room 1 stays its own; its height still follows.
    await p.evalJson("(__sh.pick(1), __sh.set('sh-cfg-w', 110), true)");
    assert.ok(await p.evalJson("!!document.querySelector('[data-act=\"size-default\"][data-dim=\"w\"]')"));
    await p.evalJson("(__sh.set('sh-wide', 130), __sh.set('sh-h', 70), true)");
    sizes = await p.evalJson('__sh.sizes()');
    assert.deepStrictEqual(sizes[1], [110, 70, 60]);
    assert.deepStrictEqual(sizes[3], [130, 70, 60]);
    assert.deepStrictEqual(sizes[2], [80, 70, 60]);

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
    await p.evalJson("(__sh.set('sh-wide', 120), __sh.set('sh-h', 70), __sh.set('sh-d', 55), true)");
    await p.evalJson("(document.querySelector('[data-units=\"in\"]').click(), true)");
    try {
      assert.strictEqual(await p.evalJson("document.getElementById('sh-wide').value"), '4.72');
      await p.evalJson("(__sh.set('sh-wide', 5), true)");
      assert.strictEqual((await p.evalJson('__sh.sizes()'))[1][0], 127);
      assert.ok(await p.evalJson("[...document.querySelectorAll('#bom .sh-size')].some((td) => td.textContent.trim() === '5 × 2.76 × 2.17 in')"));
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
      await p.evalJson("(__sh.set('sh-wide', 120), __sh.set('sh-narrow', 80), __sh.set('sh-h', 70), true)");
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
      await p.evalJson("(__sh.set('sh-wide', 120), __sh.set('sh-narrow', 80), __sh.set('sh-h', 70), true)");
    }
  });
});

test('room widths default to round numbers in the page\'s units',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, true)`);
    const back = (key) => `document.querySelector('[data-act="setting-default"][data-key="${key}"]')`;
    try {
      await p.evalJson("(__sh.set('sh-wide', 130), __sh.set('sh-narrow', 70), true)");
      assert.strictEqual(await p.evalJson(`${back('narrow')}.title`), 'Back to the default, 80 mm');
      await p.evalJson(`(${back('narrow')}.click(), true)`);
      assert.strictEqual(await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).settings.narrow"), 80);
      // In inches, 5 and 3: a room of exactly 3 in is the default, not beside it.
      await p.evalJson("(document.querySelector('[data-units=\"in\"]').click(), true)");
      assert.strictEqual(await p.evalJson(`${back('wide')}.title`), 'Back to the default, 5 in');
      await p.evalJson(`(__sh.set('sh-narrow', 3), ${back('wide')}.click(), true)`);
      assert.strictEqual(await p.evalJson(`!!${back('narrow')}`), false);
      const s = await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).settings");
      assert.deepStrictEqual([s.wide, s.narrow], [127, 76.2]);
    } finally {
      await p.evalJson("(localStorage.removeItem('shelf-house-units'), document.querySelector('[data-units=\"mm\"]').click(), __sh.set('sh-wide', 120), __sh.set('sh-narrow', 80), true)");
    }
  });
});

test('the grid is off until ticked, keeps a size for each unit, and steps every length field',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, document.getElementById('example').click(), true)`);
    const step = (id) => p.evalJson(`document.getElementById('${id}').step`);
    try {
      assert.strictEqual(await p.evalJson("document.getElementById('grid-on').checked"), false);
      assert.strictEqual(await p.evalJson("!!document.getElementById('grid-size')"), false);
      assert.strictEqual(await step('sh-wide'), '0.5');

      await p.evalJson("(document.getElementById('grid-on').click(), __sh.pick(1), true)");
      assert.strictEqual(await p.evalJson("document.getElementById('grid-size').value"), '5');
      // Sizes and places step by it; walls, bars and radii keep their fine steps.
      assert.deepStrictEqual([await step('sh-wide'), await step('sh-cfg-w'), await step('sh-thick')], ['5', '5', '0.1']);
      await p.evalJson("(__sh.set('grid-size', 10), true)");
      assert.deepStrictEqual([await step('sh-wide'), await step('sh-cfg-h')], ['10', '10']);

      // Inches have a grid of their own, an eighth to start; millimetres keep theirs.
      await p.evalJson("(document.querySelector('[data-units=\"in\"]').click(), true)");
      assert.strictEqual(await p.evalJson("document.getElementById('grid-size').value"), '0.125');
      assert.strictEqual(await step('sh-wide'), '0.125');
      await p.evalJson("(document.querySelector('[data-units=\"mm\"]').click(), true)");
      assert.strictEqual(await p.evalJson("document.getElementById('grid-size').value"), '10');

      // The folded band says it is on.
      assert.match(await p.evalJson("document.getElementById('settings-summary').textContent"), /, grid 10 mm$/);
    } finally {
      await p.evalJson("(localStorage.removeItem('shelf-house-grid'), localStorage.removeItem('shelf-house-units'), true)");
    }
  });
});

test('with the grid on, rooms, things and openings land on it as they move',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, __sh.set('sh-wide', 120), __sh.set('sh-narrow', 80), __sh.set('sh-h', 72), document.getElementById('example').click(), document.getElementById('mat').scrollIntoView({ block: 'center' }), true)`);
    const items = () => p.evalJson("Object.fromEntries(JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items.map((i) => [i.id, i]))");
    const key = (k, shift = false) => p.evalJson(`(window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', shiftKey: ${shift} })), true)`);
    const at = (x, y) => p.evalJson(`(() => { const q = new DOMPoint(${x}, ${-y}).matrixTransform(document.getElementById('mat').getScreenCTM()); return [q.x, q.y]; })()`);
    const drag = async (target, [x0, y0], [x1, y1]) => p.evalJson(`(() => {
      const el = ${target} || document.elementFromPoint(${x0}, ${y0});
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: ${x0}, clientY: ${y0}, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: ${x1}, clientY: ${y1} }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: ${x1}, clientY: ${y1} }));
      return true;
    })()`);
    try {
      await p.evalJson("(document.getElementById('grid-on').click(), true)");

      // Arrow keys go a grid line at a time, Shift the big step's worth.
      await p.evalJson('(__sh.pick(5), true)');
      await key('ArrowRight');
      assert.strictEqual((await items())[5].x, 45);
      await key('ArrowRight', true);
      assert.strictEqual((await items())[5].x, 55);
      await key('ArrowLeft');
      assert.strictEqual((await items())[5].x, 50);

      // A dragged room lands on the grid.
      await drag('null', await at(80, 144 + 2), await at(80 + 13, 144 + 2));
      assert.strictEqual((await items())[5].x, 65);

      // So does a table, counted from the shelf's left edge, not its room's.
      let it = await items();
      const table = it[5].x + it[6].x;
      await drag(`document.querySelector('#mat .block[data-id="6"] path')`, await at(table + 18, 144 + 12), await at(table + 18 + 7.3, 144 + 12));
      it = await items();
      assert.strictEqual(it[5].x + it[6].x, Math.round((table + 7.3) / 5) * 5);

      // An opening moves and resizes on the grid, from the middle of its wall.
      // The table is zoomed to, so let go of it to see the whole shelf again.
      await key('Escape');
      await drag('null', await at(60 - 26, 36 + 4), await at(60 - 15.3, 36 + 9.4));
      let o = (await items())[1].cfg.openings[0];
      assert.deepStrictEqual([o.x, o.y], [-15, 10]);
      const h = await p.evalJson("(() => { const r = document.querySelector('.sh-op-handle').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
      const mm = await p.evalJson("1 / document.getElementById('mat').getScreenCTM().a");
      await drag("document.querySelector('.sh-op-handle')", h, [h[0] + 3.3 / mm, h[1]]);
      o = (await items())[1].cfg.openings[0];
      assert.strictEqual(o.w % 5, 0);

      // Off again, a millimetre at a time. Room 1 has an opening picked, so the
      // first press on room 5 only closes its tile; the second picks the room.
      await p.evalJson("(document.getElementById('grid-on').click(), __sh.pick(5), __sh.pick(5), true)");
      await key('ArrowRight');
      assert.strictEqual((await items())[5].x, 66);
    } finally {
      await p.evalJson("(localStorage.removeItem('shelf-house-grid'), __sh.set('sh-h', 70), true)");
    }
  });
});

test('one press puts whatever is off the grid on it, and one undo takes it back',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, __sh.set('sh-wide', 120), __sh.set('sh-narrow', 80), __sh.set('sh-h', 72), __sh.set('sh-d', 56), document.getElementById('example').click(), true)`);
    const saved = () => p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3'))");
    const button = "document.getElementById('grid-snap')";
    try {
      await p.evalJson("(document.getElementById('grid-on').click(), true)");
      // 72 high and 56 deep are off a 5 mm grid, and so are some windows and the table.
      assert.match(await p.evalJson("document.querySelector('#grid-off .field-name').textContent"), /^Shelf sizes and \d+ blocks off the grid$/);
      assert.match(await p.evalJson(`${button}.title`), /^Snap the shelf sizes and \d+ blocks to the grid$/);
      await p.evalJson(`(${button}.click(), true)`);
      const s = await saved();
      assert.deepStrictEqual([s.settings.wide, s.settings.narrow, s.settings.h, s.settings.d], [120, 80, 70, 55]);
      const at = Object.fromEntries(s.items.map((i) => [i.id, i]));
      // The columns still stand side by side, the arched room still over both.
      assert.deepStrictEqual([1, 2, 3, 4, 5].map((id) => [at[id].x, at[id].y]), [[0, 0], [120, 0], [0, 70], [120, 70], [40, 140]]);
      for (const m of s.items.filter((i) => i.kind === 'room')) {
        for (const o of m.cfg.openings) for (const k of ['x', 'y', 'w', 'h']) assert.strictEqual(Math.abs(o[k] % 5), 0, `room ${m.id} opening ${k} ${o[k]}`);
      }
      assert.strictEqual((at[5].x + at[6].x) % 5, 0);
      for (const k of ['topD', 'baseD', 'height']) assert.strictEqual(at[6].cfg[k] % 5, 0, `table ${k}`);
      assert.strictEqual(await p.evalJson(`!!${button}`), false);

      await p.evalJson("(document.getElementById('undo').click(), true)");
      assert.strictEqual((await saved()).settings.h, 72);
      assert.strictEqual(await p.evalJson(`!!${button}`), true);
    } finally {
      await p.evalJson("(localStorage.removeItem('shelf-house-grid'), __sh.set('sh-h', 70), __sh.set('sh-d', 55), true)");
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
    // Five panels, one per wall, all out at once; nothing lit until one is worked in.
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-jig-panel')].map((e) => e.dataset.panel)"),
      ['ceiling', 'left', 'right', 'floor', 'back']);
    assert.strictEqual(await p.evalJson("!!document.querySelector('#mat .wall-hi')"), false);

    // Focusing a wall's weight lights that wall.
    await p.evalJson("(document.querySelector('.sh-jig-panel[data-panel=left] [data-jig=wall]').focus(), true)");
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-jig-panel[data-panel=left]').classList.contains('is-hot')"), true);
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .wall-hi rect').length"), 1);

    await click('[data-jig=wall][data-wall=left][data-v=none]');
    assert.strictEqual((await room()).walls.left, 'none');
    // Still working in the same panel, and the missing wall shows as a broken edge.
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-jig-panel[data-panel=left]').contains(document.activeElement)"), true);
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .wall-hi .open').length"), 1);
    // With no wall there is nothing to open: its row says so, and cannot add.
    assert.match(await p.evalJson("document.querySelector('[data-el=tabs-left]').textContent"), /No wall/);
    assert.strictEqual(await p.evalJson("!!document.querySelector('[data-jig=add][data-wall=left]')"), false);

    // Add a window to the back wall: it lands clear of the one there, and is
    // picked with its tile open, so its shape can be set and it can be removed
    // from the same place.
    const before = (await room()).cfg.openings.length;
    await click('[data-jig=add][data-wall=back]');
    let ops = (await room()).cfg.openings;
    assert.strictEqual(ops.length, before + 1);
    const added = ops.at(-1);
    assert.deepStrictEqual([added.wall, added.shape], ['back', 'rect']);
    assert.ok(ops.filter((o) => o.wall === 'back' && o !== added).every((o) => Math.abs(o.x - added.x) >= (o.w + added.w) / 2));
    assert.strictEqual(await p.evalJson(`!!document.querySelector('.sh-jig-tab.is-picked[data-i="${before}"]')`), true);
    await click('.sh-tile [data-jig=set][data-v=round]');
    assert.strictEqual((await room()).cfg.openings.at(-1).shape, 'round');
    await click(`.sh-tile [data-act=del-opening][data-i="${before}"]`);
    assert.strictEqual((await room()).cfg.openings.length, before);
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-tile')"), false);

    // Undo brings the window back; the panels follow the history.
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
    assert.match(await p.evalJson("document.querySelector('#palette [aria-label=\"Add Narrow · blank\"]').title"), /^Narrow · blank, 80 × 70 mm/);
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
    // The table: four sizes, each in a panel with its field; none on the rail.
    await p.evalJson("(__sh.pick(6), true)");
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-jig-panel')].map((e) => e.dataset.panel)"), ['topD', 'stemD', 'height', 'baseD']);
    assert.strictEqual(await p.evalJson("document.getElementById('sh-jig-topD').value"), '36');
    assert.strictEqual(await p.evalJson("!!document.querySelector('#inspector input[type=number]')"), false);
    await p.evalJson("(__sh.set('sh-jig-topD', 40), true)");
    assert.strictEqual((await item(6)).cfg.topD, 40);
    assert.strictEqual(await p.evalJson("document.getElementById('sh-jig-topD').value"), '40');
    // In inches, a typed value is stored in millimetres.
    try {
      await p.evalJson("(document.querySelector('[data-units=in]').click(), __sh.set('sh-jig-height', 1), true)");
      assert.strictEqual((await item(6)).cfg.height, 25.4);
    } finally {
      await p.evalJson("(document.querySelector('[data-units=mm]').click(), true)");
    }
    await p.evalJson("(document.getElementById('undo').click(), true)");
    assert.strictEqual((await item(6)).cfg.height, 26.5);

    // Stairs: run below, steps beside, a turn above, all out at once.
    await p.evalJson("(__sh.pick(1), document.querySelector('#palette [aria-label=\"Add Stairs\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), true)");
    const id = await p.evalJson("Math.max(...JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items.map((i) => i.id))");
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-jig-panel')].map((e) => e.dataset.panel)"), ['turn', 'run', 'steps']);
    await p.evalJson("(__sh.set('sh-jig-run', 40), true)");
    assert.strictEqual((await item(id)).cfg.run, 40);
    await p.evalJson("(document.querySelector('[data-jig=flip]').click(), true)");
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
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-jig-panel')].map((e) => e.dataset.panel)"), ['floors', 'width']);
    assert.deepStrictEqual(await shafts(), [1, 1, 0]);
    assert.deepStrictEqual(await holes(), [['ceiling'], ['floor'], []]);
    assert.match(await where(), /serving 2 floors/);
    // The room's thick back seats the magnets that latch the car at each floor.
    assert.doesNotMatch(await where(), /no magnets/);
    assert.match(await where(), /1 magnet 4 × 2 mm a floor/);
    assert.ok((await column('shafts')).slice(0, 2).every((s) => s[0].magnets.at.length === 1));
    assert.ok(await p.evalJson("[...document.querySelectorAll('#bom td')].some((td) => td.textContent.trim() === 'Lift')"));

    // Three floors: room 5's left wall stands where the shaft would go up, so it stops.
    await p.evalJson("(__sh.set('sh-jig-floors', 3), true)");
    assert.strictEqual((await items()).find((i) => i.id === id).cfg.floors, 3);
    assert.deepStrictEqual(await shafts(), [1, 1, 0]);
    assert.match(await where(), /serving 2 of 3 floors/);
    // 10 mm to the right, room 5 holds it too.
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true })), true)");
    assert.deepStrictEqual(await shafts(), [1, 1, 1]);
    assert.deepStrictEqual(await holes(), [['ceiling'], ['floor', 'ceiling'], ['floor']]);
    assert.match(await where(), /serving 3 floors/);
    // Every room's grooves are in the same place, and the car's ribs in line
    // with them, so the car runs up through them all.
    const lines = await p.evalJson(`[1, 3, 5, ${id}].map((id) => {
      const r = document.querySelector('#mat .block[data-id="' + id + '"]');
      // The edge toward the car: the left mark's right edge, the right mark's left.
      return [...r.querySelectorAll('.mark')].map((m) => m.getBBox()).filter((b) => b.width < 2).sort((a, b) => a.x - b.x)
        .map((b, i) => Math.round((i ? b.x : b.x + b.width) * 1000) / 1000);
    })`);
    assert.strictEqual(lines[0].length, 2);
    assert.deepStrictEqual(lines[1], lines[0]);
    assert.deepStrictEqual(lines[2], lines[0]);
    // The ribs stand 0.3 mm in from the walls' faces: the running clearance.
    assert.deepStrictEqual(lines[3].map((x, i) => Math.round((x - lines[0][i]) * 10) / 10), [0.3, -0.3]);
    // The grooves run on through the ceilings and floors between the three.
    assert.deepStrictEqual((await column('shafts')).map((s) => [s[0].floor, s[0].ceiling]), [[false, true], [true, true], [true, false]]);
    // The car's panels are the shelf's thin walls.
    assert.strictEqual((await items()).find((i) => i.id === id).cfg.panel, await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).settings.thin"));

    // Deleting it closes every room again.
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })), true)");
    assert.deepStrictEqual(await shafts(), [0, 0, 0]);
    assert.deepStrictEqual(await holes(), [[], [], []]);
  });
});

test('a wall has one + for its openings, shaped in the tile, and tabs carry no counts',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, document.getElementById('example').click(), __sh.pick(2), true)`);
    const ops = async () => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === 2).cfg.openings;
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('[data-jig=add]')].map((b) => b.dataset.wall)"), ['ceiling', 'left', 'right', 'floor', 'back']);

    // A side wall's tile is narrow and tall, and takes round and arched windows;
    // the rest are wide and short.
    await p.evalJson("(document.querySelector('[data-jig=add][data-wall=left]').click(), true)");
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-tile').classList.contains('is-narrow')"), true);
    assert.deepStrictEqual(await p.evalJson("[...document.querySelectorAll('.sh-tile [aria-label=Shape] button')].map((b) => b.dataset.v)"), ['rect', 'arch', 'round']);
    await p.evalJson("(document.querySelector('.sh-tile [data-jig=set][data-v=round]').click(), true)");
    assert.deepStrictEqual([(await ops()).at(-1).wall, (await ops()).at(-1).shape], ['left', 'round']);
    for (const wall of ['ceiling', 'floor', 'back']) {
      await p.evalJson(`(document.querySelector('[data-jig=add][data-wall=${wall}]').click(), true)`);
      assert.strictEqual(await p.evalJson("document.querySelector('.sh-tile').classList.contains('is-wide')"), true, wall);
    }
    // The tabs are pictures of their shapes, with no counts.
    assert.ok(await p.evalJson("document.querySelectorAll('.sh-jig-tab').length") > 5);
    assert.deepStrictEqual(await p.evalJson("[...new Set([...document.querySelectorAll('.sh-jig-tab')].map((t) => t.textContent.replace(/\\D/g, '')))]"), ['']);
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

test('a block\'s name, colour, size and actions are in its card on the front view',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, document.getElementById('example').click(), __sh.pick(3), true)`);
    const item = async (id) => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === id);
    // There is no rail: the page is the bed, under a head with the tool's name.
    assert.strictEqual(await p.evalJson("!!document.querySelector('.rail, #inspector')"), false);
    assert.strictEqual(await p.evalJson("document.querySelector('.tool-head h1').textContent"), 'Shelf House');
    assert.deepStrictEqual(await p.evalJson("['sh-name', 'sh-color', 'sh-cfg-w', 'sh-cfg-h', 'sh-cfg-d'].map((id) => document.getElementById(id)?.closest('.sh-ident-card') != null)"), [true, true, true, true, true]);
    // The card is on the front view, and nothing about the block is below it.
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-ident-card').closest('.sh-mat')"), true);
    assert.strictEqual(await p.evalJson("!!document.getElementById('block-bar')"), false);

    // Renamed and resized in place; a typed size gets its ↺, and the field it
    // is typed in keeps the focus.
    await p.evalJson("(document.getElementById('sh-cfg-h').focus(), __sh.set('sh-name', 'Hall'), __sh.set('sh-cfg-h', 80), true)");
    const room = await item(3);
    assert.deepStrictEqual([room.name, room.cfg.h, room.own.h], ['Hall', 80, true]);
    assert.strictEqual(await p.evalJson("document.activeElement.id"), 'sh-cfg-h');
    assert.ok(await p.evalJson("!!document.querySelector('.sh-ident-card [data-act=size-default][data-dim=h]')"));
    // Focusing a size draws it on the room.
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .wall-hi .dim').length"), 3);
    assert.match(await p.evalJson("document.getElementById('selection').textContent"), /floor 2/);

    // The rarer actions are behind ⋯, and the menu closes on a choice.
    await p.evalJson("(document.querySelector('.sh-ident-card .sh-more summary').click(), true)");
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-ident-card .sh-more').open"), true);
    await p.evalJson("(document.querySelector('.sh-ident-card [data-act=reset]').click(), true)");
    assert.deepStrictEqual([(await item(3)).name, (await item(3)).cfg.h], ['Wide · doorways', 70]);
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-ident-card .sh-more[open]')"), false);

    const before = (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).length;
    await p.evalJson("(document.querySelector('.sh-ident-card [data-act=duplicate]').click(), true)");
    assert.strictEqual((await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).length, before + 1);
    await p.evalJson("(document.querySelector('.sh-ident-card [data-act=delete]').click(), true)");
    assert.strictEqual((await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).length, before);
  });
});

test('a window is picked on the front view, dragged, resized and edited in its tile',
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
    // The room is selected with the window picked and its tile open.
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-tile .sh-tile-title').textContent.trim()"), 'Opening 1');
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .op-hi rect').length"), 1);

    // Its handle resizes it about its centre.
    const h = await p.evalJson("(() => { const r = document.querySelector('.sh-op-handle').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
    const mm = await p.evalJson("1 / document.getElementById('mat').getScreenCTM().a");
    await press("document.querySelector('.sh-op-handle')", h, [h[0] + 3 / mm, h[1]]);
    o = (await ops())[0];
    assert.deepStrictEqual([o.w, o.h], [40, 34]);

    // The tile's fields and pictures edit it, one undo step each.
    await p.evalJson("(__sh.set('sh-op-h', 30), document.querySelector('.sh-tile [data-jig=set][data-v=rect]').click(), true)");
    o = (await ops())[0];
    assert.deepStrictEqual([o.h, o.shape], [30, 'rect']);
    await p.evalJson("(document.getElementById('undo').click(), true)");
    assert.strictEqual((await ops())[0].shape, 'round');

    // Escape closes the tile but keeps the room selected.
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true)");
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-tile')"), false);
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
      assert.match(await p.evalJson("document.getElementById('settings-summary').textContent"), /^rooms 120 or 80 × 70 × 55, walls 3 \/ 1\.5, corners 8 \/ 5 mm$/);
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
// and iOS gives a tapped button no focus. Panels used to fold on that
// pointerleave, so a tapped button was hidden before its click and removing a
// wall did nothing. They are all out at once now, but the taps are still
// checked the way a phone sends them.
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
      const tapAt = async (x, y) => {
        await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await new Promise((r) => setTimeout(r, 150));
      };
      const tap = async (sel) => {
        const [x, y] = await p.evalJson(`(() => { const r = (${sel}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
        await tapAt(x, y);
      };
      const room = async () => (await p.evalJson("JSON.parse(localStorage.getItem('shelf-house-layout-v3')).items")).find((i) => i.id === 1);

      await tap("document.querySelector('#mat .block[data-id=\"1\"] path')");
      // Everything is out at once, so there is no panel to open first.
      await tap("document.querySelector('[data-jig=wall][data-wall=left][data-v=none]')");
      assert.strictEqual((await room()).walls.left, 'none');

      await tap("document.querySelector('[data-jig=add][data-wall=right]')");
      const o = (await room()).cfg.openings.at(-1);
      assert.strictEqual(o.wall, 'right');
      assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-tile.is-narrow')"), true);

      // A tap on empty paper closes the tile; the next one lets go of the room.
      // Empty paper: a point of the front view that is neither a block nor a panel.
      const paper = await p.evalJson(`(() => {
        const r = document.getElementById('mat').getBoundingClientRect();
        for (let y = r.bottom - 6; y > r.top; y -= 12) for (let x = r.right - 6; x > r.left; x -= 12) {
          const el = document.elementFromPoint(x, y);
          if (el && !el.closest('.block, .sh-jig') && el.closest('#mat')) return [x, y];
        }
        return null;
      })()`);
      assert.ok(paper, 'no empty paper on the front view');
      await tapAt(...paper);
      assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-tile')"), false);
      assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-ident-card')"), true);
      await tapAt(...paper);
      assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-ident-card')"), false);
    } finally {
      await p.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});

// ------------------------------------------------------------------ front-view camera

// Page-side helpers for the tests below: where the view is, and where empty
// paper is (a point on the front view that is neither a block nor a panel).
const CAMERA_HELPERS = `(window.__cam = {
    zoom: () => parseInt(document.getElementById('zoom-pct').textContent),
    inView(sel) {
      const m = document.getElementById('mat').getBoundingClientRect();
      const els = [...document.querySelectorAll(sel)];
      return els.length > 0 && els.every((e) => {
        const r = e.getBoundingClientRect();
        return r.left >= m.left - 1 && r.top >= m.top - 1 && r.right <= m.right + 1 && r.bottom <= m.bottom + 1;
      });
    },
    paper() {
      const r = document.getElementById('mat').getBoundingClientRect();
      for (let y = r.bottom - 6; y > r.top; y -= 10) for (let x = r.right - 6; x > r.left; x -= 10) {
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest('.block, .sh-jig') && el.closest('#mat')) return [x, y];
      }
      return null;
    },
    press([x, y], [dx, dy] = [0, 0]) {
      const el = document.elementFromPoint(x, y);
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
      if (dx || dy) window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + dx, clientY: y + dy }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + dx, clientY: y + dy }));
    },
    viewBox: () => document.getElementById('mat').getAttribute('viewBox').split(' ').map(Number),
    name: () => document.getElementById('sh-name')?.value ?? null,
  }, true)`;

test('picking a room unwraps it and zooms to fit it with every panel; letting go zooms back out',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, ${CAMERA_HELPERS}, document.getElementById('example').click(), true)`);
    // Nothing picked: the whole shelf, and no panels.
    assert.strictEqual(await p.evalJson('__cam.zoom()'), 100);
    assert.strictEqual(await p.evalJson("document.querySelectorAll('.sh-jig [data-el], .sh-ident-card').length"), 0);

    await p.evalJson('(__sh.pick(3), true)');
    assert.ok(await p.evalJson('__cam.zoom()') > 150, 'the room fills the view');
    // Every panel, the card included, is in view; the other rooms step back.
    assert.strictEqual(await p.evalJson("__cam.inView('.sh-jig [data-el], .sh-ident-card')"), true);
    const blocks = await p.evalJson("document.querySelectorAll('#mat .block').length");
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .block.dimmed').length"), blocks - 1);
    assert.strictEqual(await p.evalJson("document.querySelector('#mat .block[data-id=\"3\"]').classList.contains('dimmed')"), false);
    // A table keeps its room clear: only the rest step back.
    await p.evalJson('(__sh.pick(1), __sh.pick(6), true)');
    assert.strictEqual(await p.evalJson("document.querySelectorAll('#mat .block.dimmed').length"), blocks - 2);

    // Escape lets go: the whole shelf again, with no panels.
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true)");
    assert.strictEqual(await p.evalJson('__cam.zoom()'), 100);
    assert.strictEqual(await p.evalJson("document.querySelectorAll('.sh-jig [data-el], .sh-ident-card').length"), 0);
  });
});

test('opening a tile keeps the room at its size and shows the wall it is on',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, ${CAMERA_HELPERS}, document.getElementById('example').click(), __sh.pick(1), true)`);
    const z0 = await p.evalJson('__cam.zoom()');
    for (const wall of ['ceiling', 'left', 'right', 'floor', 'back']) {
      await p.evalJson(`(document.querySelector('[data-jig=add][data-wall=${wall}]').click(), true)`);
      // The zoom holds (to a few percent: it may give a little for the tile),
      // and the room, its wall and the tile are all in view.
      const z = await p.evalJson('__cam.zoom()');
      assert.ok(Math.abs(z - z0) <= 5, `${wall}: ${z}% against ${z0}%`);
      assert.strictEqual(await p.evalJson("__cam.inView('#mat .block[data-id=\"1\"] path')"), true, `${wall}: the room`);
      assert.strictEqual(await p.evalJson(`__cam.inView('.sh-tile, [data-el=tabs-${wall}], [data-el=sel-${wall}]')`), true, `${wall}: the tile`);
      // The tile is shaped by the way it opens.
      const side = wall === 'left' || wall === 'right';
      assert.strictEqual(await p.evalJson(`document.querySelector('.sh-tile').classList.contains('${side ? 'is-narrow' : 'is-wide'}')`), true, wall);
      // It is joined to its tab, which is the picked one.
      assert.strictEqual(await p.evalJson(`document.querySelectorAll('[data-el=tabs-${wall}] .is-picked').length`), 1, wall);
      await p.evalJson("(document.querySelector('[data-jig=unpick]').click(), true)");
      assert.ok(Math.abs(await p.evalJson('__cam.zoom()') - z0) <= 1, `${wall}: back to ${z0}%`);
    }
  });
});

test('with a tile open a press elsewhere only closes it; another room takes a second press',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, ${CAMERA_HELPERS}, document.getElementById('example').click(), __sh.pick(1), true)`);
    const first = await p.evalJson('__cam.name()');
    await p.evalJson("(document.querySelector('[data-jig=add][data-wall=back]').click(), true)");
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-tile')"), true);

    // Another room: the tile closes, and that is all.
    await p.evalJson('(__sh.pick(3), true)');
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-tile')"), false);
    assert.strictEqual(await p.evalJson('__cam.name()'), first);
    // A second press goes there.
    await p.evalJson('(__sh.pick(3), true)');
    assert.notStrictEqual(await p.evalJson('__cam.name()'), first);

    // Empty paper: the tile first, then the room.
    await p.evalJson("(document.querySelector('[data-jig=add][data-wall=floor]').click(), true)");
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-tile')"), true);
    await p.evalJson('(__cam.press(__cam.paper()), true)');
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-tile')"), false);
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-ident-card')"), true);
    await p.evalJson('(__cam.press(__cam.paper()), true)');
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-ident-card')"), false);
    assert.strictEqual(await p.evalJson('__cam.zoom()'), 100);
  });
});

test('the view zooms by hand, pans on empty paper, and fits again when asked',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.evalJson(`(${PAGE_HELPERS}, ${CAMERA_HELPERS}, document.getElementById('example').click(), __sh.pick(1), true)`);
    const z0 = await p.evalJson('__cam.zoom()');
    const held = () => p.evalJson("document.getElementById('zoom-fit').classList.contains('is-held')");
    assert.strictEqual(await held(), false);

    // + and − go by a quarter, and hold the view until fit.
    await p.evalJson("(document.getElementById('zoom-in').click(), true)");
    assert.ok(Math.abs(await p.evalJson('__cam.zoom()') - z0 * 1.25) <= 2);
    assert.strictEqual(await held(), true);
    await p.evalJson("(document.getElementById('zoom-out').click(), document.getElementById('zoom-out').click(), true)");
    assert.ok(await p.evalJson('__cam.zoom()') < z0);

    // Ctrl+scroll (a trackpad pinch) zooms; plain scrolling is left to the page.
    const wheel = (ctrl) => p.evalJson(`(() => {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: ${ctrl}, deltaY: -120, clientX: 400, clientY: 500 });
      const before = __cam.zoom();
      document.querySelector('.sh-mat').dispatchEvent(e);
      return [e.defaultPrevented, before, __cam.zoom()];
    })()`);
    const [plainStopped, plainBefore, plainAfter] = await wheel(false);
    assert.deepStrictEqual([plainStopped, plainAfter], [false, plainBefore]);
    const [ctrlStopped, ctrlBefore, ctrlAfter] = await wheel(true);
    assert.deepStrictEqual([ctrlStopped, ctrlAfter > ctrlBefore], [true, true]);

    // Dragging empty paper pans.
    const vb = await p.evalJson('__cam.viewBox()');
    await p.evalJson('(__cam.press(__cam.paper(), [-60, -40]), true)');
    const moved = await p.evalJson('__cam.viewBox()');
    assert.ok(moved[0] > vb[0] && moved[1] > vb[1], `${vb} → ${moved}`);
    // A pan is not a click: the room is still selected.
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-ident-card')"), true);

    // Fit hands it back.
    await p.evalJson("(document.getElementById('zoom-fit').click(), true)");
    assert.strictEqual(await p.evalJson('__cam.zoom()'), z0);
    assert.strictEqual(await held(), false);

    // A view set by hand stays through an edit, and goes when another room is picked.
    await p.evalJson("(document.getElementById('zoom-in').click(), true)");
    const zin = await p.evalJson('__cam.zoom()');
    await p.evalJson("(document.querySelector('[data-jig=wall][data-wall=left][data-v=thin]').click(), true)");
    assert.strictEqual(await p.evalJson('__cam.zoom()'), zin);
    await p.evalJson('(__sh.pick(3), __sh.pick(3), true)');
    assert.strictEqual(await held(), false);
    assert.strictEqual(await p.evalJson('__cam.inView(".sh-jig [data-el], .sh-ident-card")'), true, 'the new room is fitted');
  });
});

test('on a narrow view the card folds to its name and colour, and a button unfolds the rest',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await p.setViewport(600, 900);
    await p.evalJson(`(${PAGE_HELPERS}, ${CAMERA_HELPERS}, document.getElementById('example').click(), true)`);
    const before = await p.evalJson("document.getElementById('mat').clientHeight");
    await p.evalJson('(__sh.pick(1), true)');
    // The view grows while a block is edited, so everything around it has room.
    assert.ok(await p.evalJson("document.getElementById('mat').clientHeight") > before);
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-ident-card').classList.contains('is-folded')"), true);
    assert.deepStrictEqual(await p.evalJson("['sh-name', 'sh-color', 'sh-cfg-w'].map((id) => !!document.getElementById(id))"), [true, true, false]);
    assert.strictEqual(await p.evalJson("__cam.inView('.sh-jig [data-el], .sh-ident-card')"), true);
    // Nothing the panels do pushes the page sideways.
    assert.strictEqual(await p.evalJson('document.documentElement.scrollWidth <= innerWidth'), true);
    const room = await p.evalJson("document.querySelector('#mat .block[data-id=\"1\"] path').getBoundingClientRect().width");
    assert.ok(room > 100, `the room is ${room}px wide`);

    await p.evalJson("(document.querySelector('.sh-card-fold').click(), true)");
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-ident-card').classList.contains('is-folded')"), false);
    assert.strictEqual(await p.evalJson("!!document.getElementById('sh-cfg-w')"), true);
    assert.strictEqual(await p.evalJson("__cam.inView('.sh-jig [data-el], .sh-ident-card')"), true);

    // Picking another block folds it again.
    await p.evalJson('(__sh.pick(3), __sh.pick(3), true)');
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-ident-card').classList.contains('is-folded')"), true);
  });
});

// ------------------------------------------------------------------ editing an opening's tile

// These run with motion on: the blink and the slide they guard against are
// animations, and with reduced motion neither shows.
const withMotion = (p) => p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Every distinct viewBox the front view takes from now on.
const WATCH_VIEW = `(() => {
  window.__vb = [];
  new MutationObserver(() => window.__vb.push(document.getElementById('mat').getAttribute('viewBox')))
    .observe(document.getElementById('mat'), { attributes: true, attributeFilter: ['viewBox'] });
  return true;
})()`;
const seen = (p) => p.evalJson('new Set(window.__vb).size');

test('the panels fly out when a block is picked, and not again on every edit',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await withMotion(p);
    await p.evalJson(`(${PAGE_HELPERS}, ${CAMERA_HELPERS}, document.getElementById('example').click(), true)`);
    const unwrapping = () => p.evalJson("document.querySelector('.sh-jig').classList.contains('is-unwrapping')");
    await p.evalJson('(__sh.pick(4), true)');
    assert.strictEqual(await unwrapping(), true, 'flying out');
    await wait(700);
    assert.strictEqual(await unwrapping(), false, 'landed');

    // An edit rebuilds the panels; none of them may start fading in again.
    await p.evalJson("(document.querySelector('[data-jig=add][data-wall=left]').click(), true)");
    await wait(700);
    const states = await p.evalJson(`(() => {
      document.getElementById('sh-op-count').focus();
      __sh.set('sh-op-count', 3);
      return [...document.querySelectorAll('.sh-jig [data-el], .sh-ident-card')].map((e) => [getComputedStyle(e).animationName, getComputedStyle(e).opacity]);
    })()`);
    assert.ok(states.length > 10);
    assert.deepStrictEqual([...new Set(states.map((s) => s.join(' ')))], ['none 1']);
    // Nor when the card is rebuilt, by renaming the room.
    await p.evalJson("(document.getElementById('sh-name').focus(), __sh.set('sh-name', 'Hall'), true)");
    assert.strictEqual(await p.evalJson("getComputedStyle(document.querySelector('.sh-ident-card')).animationName"), 'none');
  });
});

test('while a field of an opening\'s tile has focus the view holds still, and fits when focus leaves',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await withMotion(p);
    await p.evalJson(`(${PAGE_HELPERS}, ${CAMERA_HELPERS}, document.getElementById('example').click(), __sh.pick(4), true)`);
    await wait(700);
    // A narrow tile that grows a row with more than one copy, so the fit would move.
    await p.evalJson("(document.querySelector('[data-jig=add][data-wall=left]').click(), true)");
    await wait(700);
    await p.evalJson(WATCH_VIEW);

    // Editing from the field: nothing slides, for any number of steps.
    await p.evalJson("(document.getElementById('sh-op-count').focus(), true)");
    for (const n of [4, 2, 4, 1]) await p.evalJson(`(__sh.set('sh-op-count', ${n}), true)`);
    await p.evalJson("(document.getElementById('sh-op-count').focus(), __sh.set('sh-op-count', 4), true)");
    await wait(700);
    assert.strictEqual(await seen(p), 1, 'the view moved while the field had focus');
    assert.strictEqual(await p.evalJson("document.activeElement.id"), 'sh-op-count', 'the field keeps its focus');

    // Focus leaving the tile lets the view fit the bigger tile: it slides, once.
    await p.evalJson("(document.getElementById('sh-op-count').blur(), true)");
    await wait(700);
    assert.ok(await seen(p) > 1, 'the view fits again');
    assert.strictEqual(await p.evalJson("__cam.inView('.sh-tile, [data-el=tabs-left], [data-el=sel-left], #mat .block[data-id=\"4\"] path')"), true);
    const settled = await seen(p);
    await wait(300);
    assert.strictEqual(await seen(p), settled, 'and then holds');

    // The tile's other controls pause it too, and Escape lets it go.
    await p.evalJson("(document.querySelector('.sh-tile [data-jig=set][data-v=round]').focus(), true)");
    await p.evalJson("(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true)");
    assert.strictEqual(await p.evalJson("!!document.querySelector('.sh-tile')"), false);
  });
});

test('moving an opening to another wall from its tile takes the view with it',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/shelf-house/', async (p) => {
    await ready(p);
    await withMotion(p);
    await p.evalJson(`(${PAGE_HELPERS}, ${CAMERA_HELPERS}, document.getElementById('example').click(), __sh.pick(4), true)`);
    await wait(700);
    await p.evalJson("(document.querySelector('[data-jig=add][data-wall=left]').click(), true)");
    await wait(700);
    // The wall is chosen in the tile, so it has focus; the tile moves across the
    // room, and the view must follow it.
    await p.evalJson("(document.getElementById('sh-op-wall').focus(), __sh.set('sh-op-wall', 'ceiling'), true)");
    await wait(700);
    assert.strictEqual(await p.evalJson("document.querySelector('.sh-tile').classList.contains('is-wide')"), true);
    assert.strictEqual(await p.evalJson("__cam.inView('.sh-tile, [data-el=tabs-ceiling]')"), true);
    assert.strictEqual(await p.evalJson("document.activeElement.id"), 'sh-op-wall');
  });
});
