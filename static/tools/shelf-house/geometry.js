// Parametric room geometry — grown out of dollhouse_generator.py.
// All units are millimetres. Built with manifold-3d so every part is watertight.
//
// A room is a plain config object (see defaultRoom). Presets are just
// starting configs; every placed block carries its own copy and can be tuned.
//
// Room coordinates: x across the width (0 = left outer face), y up
// (0 = underside), z front-to-back depth (0 = outside of the back panel,
// cfg.d = open front). Rooms print lying on their back, so z is up on the bed.

export const CORNERS = ['tl', 'tr', 'br', 'bl'];
export const WALLS = ['back', 'left', 'right', 'ceiling', 'floor'];
export const SHAPES = ['rect', 'arch', 'round'];

const SEG = 16; // segments per quarter circle

// Factory sizes of the two room widths, the height, the depth, the two wall
// thicknesses and the corner radii. Rooms follow the page's settings, which
// start from these, on every size the user has not set themselves; each wall
// is thick, thin or missing and takes its thickness from the settings, and
// every rounded corner takes the shelf's outer or inner radius.
export const ROOM_DEFAULTS = { wide: 120, narrow: 78, h: 72, d: 56, thick: 3, thin: 1.5, outerR: 8, innerR: 5 };

export function defaultRoom(over = {}) {
  return {
    w: ROOM_DEFAULTS.wide, h: ROOM_DEFAULTS.h, d: ROOM_DEFAULTS.d,
    walls: { left: 3, right: 3, ceiling: 3, floor: 3, back: 3 },
    outerR: 8, innerR: 5,
    outer: { tl: true, tr: true, br: true, bl: true },
    inner: { tl: true, tr: true, br: true, bl: true },
    color: '#d8b4a0',
    openings: [],
    ...over,
  };
}

// An opening cut through one wall, positioned from the wall's middle:
//  back, left, right: x = along the wall; y = up from the middle of the
//                     interior height (anchor 'centre', a window) or up from
//                     the floor (anchor 'floor', a doorway, normally 0)
//  ceiling, floor:    x = across the width, y = front/back
// The shape is split by `cols` × `rows` glazing bars of width `bar`, and
// repeated `count` times, `pitch` mm apart (centre to centre).
export function defaultOpening(over = {}) {
  return {
    wall: 'back', anchor: 'centre', shape: 'rect', x: 0, y: 0, w: 30, h: 30, r: 0,
    cols: 1, rows: 1, bar: 2.5, count: 1, pitch: 40,
    ...over,
  };
}

export const OPENING_PRESETS = {
  window: () => defaultOpening({ wall: 'back', shape: 'rect', y: 2, w: 34, h: 30, cols: 2, rows: 2 }),
  doorway: () => defaultOpening({ wall: 'left', anchor: 'floor', shape: 'arch', y: 0, w: 24, h: 50 }),
  skylight: () => defaultOpening({ wall: 'ceiling', shape: 'round', y: 0, w: 30, h: 30, cols: 2, rows: 2 }),
};

export function defaultTable(over = {}) {
  return { topD: 36, baseD: 26, stemD: 10, height: 26.5, color: '#b5838d', ...over };
}

// A straight flight of stairs. `rise` and `depth` follow the room the stairs
// stand in (its interior height, half its depth) and are set by the layout;
// `flip` makes it rise to the left instead of the right.
export function defaultStairs(over = {}) {
  return { form: 'stairs', run: 56, steps: 8, flip: false, rise: 66, depth: 26.5, color: '#a98467', ...over };
}

export const isStairs = (cfg) => cfg.form === 'stairs';

// A lift: a shaft rising `floors` storeys from the room it stands in, and the
// car that rides in it. The shaft's walls are built into every room it passes
// (see liftShaft); the lift itself prints as the car. `w` is the shaft's inside
// width; `rise`, `depth` and `wall` follow the room and the shelf's thick
// walls and are set by the layout, like the stairs'. `rail` is the filament
// glued into a groove up each shaft wall, half its diameter deep, and the car
// has a notch up each side that rides on it.
export function defaultLift(over = {}) {
  return { form: 'lift', w: 32, floors: 2, rail: 1.75, rise: 66, depth: 26.5, wall: 3, color: '#8d99ae', ...over };
}

export const isLift = (cfg) => cfg.form === 'lift';
export const RAILS = [1.75, 2.85];

// The car clears the shaft walls and the back by LIFT_GAP and the ceiling by
// LIFT_HEADROOM; a groove is RAIL_FIT wider than its filament.
const LIFT_GAP = 0.3, LIFT_HEADROOM = 1, RAIL_FIT = 0.2;
// Shaft and car walls stay thick enough to take a groove or a notch.
export const liftWall = (cfg) => Math.max(cfg.wall, cfg.rail / 2 + 0.8);

const onWall = (o) => o.wall === 'back' || o.wall === 'left' || o.wall === 'right';

// Openings saved before anchors measured y on a wall as the sill height. A
// sill of 0 was a doorway; anything else becomes a window measured from the
// middle of this room's interior, so it cuts exactly the same hole.
export function migrateOpening(cfg, o) {
  if (o.anchor || !onWall(o)) return defaultOpening({ ...o });
  if (!o.y) return defaultOpening({ ...o, anchor: 'floor', y: 0 });
  const b = innerBox(cfg);
  return defaultOpening({ ...o, anchor: 'centre', y: o.y + o.h / 2 - (b.y1 - b.y0) / 2 });
}

const op = defaultOpening;
export const PRESETS = {
  wide_6pane: {
    name: 'Wide · 6-pane', kind: 'room', size: 'wide',
    cfg: defaultRoom({ color: '#e9c46a', openings: [op({ y: 4, w: 46, h: 36, cols: 2, rows: 3 })] }),
  },
  wide_arched: {
    name: 'Wide · arched', kind: 'room', size: 'wide',
    cfg: defaultRoom({ color: '#f4a261', openings: [op({ shape: 'arch', y: 3, w: 22, h: 40, rows: 2, count: 3, pitch: 28 })] }),
  },
  wide_porthole: {
    name: 'Wide · portholes', kind: 'room', size: 'wide',
    cfg: defaultRoom({
      color: '#8ab17d',
      openings: [
        op({ shape: 'round', x: -26, y: 4, w: 34, h: 34, cols: 2, rows: 2 }),
        op({ shape: 'round', x: 20, y: 4, w: 34, h: 34, cols: 2, rows: 2 }),
        op({ x: 45, y: 4, w: 7, h: 20, r: 3.5 }),
      ],
    }),
  },
  wide_doorways: {
    name: 'Wide · doorways', kind: 'room', size: 'wide',
    cfg: defaultRoom({
      color: '#cdb4db',
      openings: [
        op({ wall: 'left', anchor: 'floor', shape: 'arch', y: 0, w: 24, h: 50 }),
        op({ wall: 'right', anchor: 'floor', shape: 'arch', y: 0, w: 24, h: 50 }),
        op({ y: 2, w: 40, h: 26, r: 4, cols: 3 }),
      ],
    }),
  },
  narrow_4pane: {
    name: 'Narrow · 4-pane', kind: 'room', size: 'narrow',
    cfg: defaultRoom({ w: ROOM_DEFAULTS.narrow, color: '#7fb7be', openings: [op({ y: 6, w: 34, h: 30, cols: 2, rows: 2 })] }),
  },
  narrow_skylight: {
    name: 'Narrow · skylight', kind: 'room', size: 'narrow',
    cfg: defaultRoom({
      w: ROOM_DEFAULTS.narrow, color: '#a8dadc',
      outer: { tl: true, tr: true, br: false, bl: false },
      inner: { tl: true, tr: true, br: false, bl: false },
      openings: [op({ wall: 'ceiling', shape: 'rect', y: 0, w: 44, h: 30, r: 3, cols: 2 })],
    }),
  },
  narrow_blank: {
    name: 'Narrow · blank', kind: 'room', size: 'narrow',
    cfg: defaultRoom({ w: ROOM_DEFAULTS.narrow }),
  },
  round_table: {
    name: 'Round table', kind: 'furniture',
    cfg: defaultTable(),
  },
  stairs: {
    name: 'Stairs', kind: 'furniture',
    cfg: defaultStairs(),
  },
  lift: {
    name: 'Lift', kind: 'furniture',
    cfg: defaultLift(),
  },
};

export function blockSize(kind, cfg) {
  if (kind === 'furniture' && isStairs(cfg)) return { w: cfg.run, h: cfg.rise, d: cfg.depth };
  if (kind === 'furniture' && isLift(cfg)) return { w: cfg.w + 2 * liftWall(cfg), h: cfg.rise, d: cfg.depth };
  if (kind === 'furniture') return { w: Math.max(cfg.topD, cfg.baseD), h: cfg.height, d: Math.max(cfg.topD, cfg.baseD) };
  return { w: cfg.w, h: cfg.h, d: cfg.d };
}

// ---------------------------------------------------------------- 2D helpers

const rect = (k, x0, y0, x1, y1) => k.CrossSection.square([x1 - x0, y1 - y0]).translate([x0, y0]);
const cuboid = (k, x0, x1, y0, y1, z0, z1) => k.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);

// Rectangle with an independent radius per corner (radii: {tl,tr,br,bl}).
function cornerRect(k, x0, y0, x1, y1, radii) {
  const max = Math.max(0, Math.min(x1 - x0, y1 - y0) / 2 - 0.01);
  const r = (c) => Math.min(Math.max(radii[c] || 0, 0), max);
  const pts = [];
  const corner = (cx, cy, rad, a0) => {
    if (rad <= 0.01) { pts.push([cx, cy]); return; }
    const ox = cx + (a0 === 90 || a0 === 180 ? rad : -rad);
    const oy = cy + (a0 === 180 || a0 === 270 ? rad : -rad);
    for (let i = 0; i <= SEG; i++) {
      const a = ((a0 + (90 * i) / SEG) * Math.PI) / 180;
      pts.push([ox + rad * Math.cos(a), oy + rad * Math.sin(a)]);
    }
  };
  // Counter-clockwise from bottom-left.
  corner(x0, y0, r('bl'), 180);
  corner(x1, y0, r('br'), 270);
  corner(x1, y1, r('tr'), 0);
  corner(x0, y1, r('tl'), 90);
  return k.CrossSection.ofPolygons([pts]);
}

// A wall of thickness 0 is no wall: that side of the room is open, and the
// two corners beside it are square so the walls either side end cleanly.
const CORNER_WALLS = { tl: ['left', 'ceiling'], tr: ['right', 'ceiling'], br: ['right', 'floor'], bl: ['left', 'floor'] };
const missing = (cfg, wall) => !(cfg.walls[wall] > 0);
const radii = (cfg, on, r) => Object.fromEntries(CORNERS.map((c) =>
  [c, on[c] && !CORNER_WALLS[c].some((w) => missing(cfg, w)) ? r : 0]));

export function innerBox(cfg) {
  const t = cfg.walls;
  return { x0: t.left, y0: t.floor, x1: cfg.w - t.right, y1: cfg.h - t.ceiling };
}

function outerSection(k, cfg) {
  return cornerRect(k, 0, 0, cfg.w, cfg.h, radii(cfg, cfg.outer, cfg.outerR));
}

// The interior runs 1 mm past any missing wall, so subtracting it leaves no
// skin of zero thickness behind.
function innerSection(k, cfg) {
  const b = innerBox(cfg);
  const out = (wall) => (missing(cfg, wall) ? 1 : 0);
  return cornerRect(k, b.x0 - out('left'), b.y0 - out('floor'), b.x1 + out('right'), b.y1 + out('ceiling'),
    radii(cfg, cfg.inner, cfg.innerR));
}

// One opening outline, centred on x = 0 with its bottom on y = 0.
function openingShape(k, o) {
  const w = Math.max(o.w, 0.5), h = Math.max(o.h, 0.5);
  let s;
  if (o.shape === 'arch') {
    const r = w / 2;
    const body = rect(k, -r, 0, r, Math.max(h - r, 0.01));
    s = body.add(k.CrossSection.circle(r, SEG * 4).translate([0, Math.max(h - r, 0.01)]));
  } else if (o.shape === 'round') {
    s = k.CrossSection.circle(0.5, SEG * 4).scale([w, h]).translate([0, h / 2]);
  } else {
    const r = o.r || 0;
    s = cornerRect(k, -w / 2, 0, w / 2, h, { tl: r, tr: r, br: r, bl: r });
  }
  const bars = [];
  const bar = Math.max(o.bar || 0, 0);
  if (bar > 0) {
    for (let i = 1; i < (o.cols || 1); i++) {
      const x = -w / 2 + (i * w) / o.cols;
      bars.push(rect(k, x - bar / 2, -1, x + bar / 2, h + 1));
    }
    for (let i = 1; i < (o.rows || 1); i++) {
      const y = (i * h) / o.rows;
      bars.push(rect(k, -w / 2 - 1, y - bar / 2, w / 2 + 1, y + bar / 2));
    }
  }
  return bars.length ? s.subtract(k.CrossSection.union(bars)) : s;
}

// All copies of an opening in the wall's own 2D frame: (u along the wall,
// v up the wall, or front/back for ceiling and floor).
function openingSection(k, o, uMid, vBase) {
  const shape = openingShape(k, o);
  const n = Math.max(1, Math.round(o.count || 1));
  const copies = [];
  for (let i = 0; i < n; i++) {
    const u = uMid + o.x + (i - (n - 1) / 2) * (o.pitch || 0);
    copies.push(shape.translate([u, vBase + o.y]));
  }
  return copies.length > 1 ? k.CrossSection.union(copies) : copies[0];
}

// 2D frame of each wall: where its openings are measured from and the area
// they may cut (so the frame of the room always stays intact).
function wallFrame(cfg, wall) {
  const t = cfg.walls, b = innerBox(cfg);
  const zMid = (t.back + cfg.d) / 2;
  switch (wall) {
    case 'back': return { uMid: cfg.w / 2, vBase: b.y0, vMid: (b.y0 + b.y1) / 2, clip: [b.x0, b.y0, b.x1, b.y1] };
    case 'left':
    case 'right': return { uMid: zMid, vBase: b.y0, vMid: (b.y0 + b.y1) / 2, clip: [t.back, b.y0, cfg.d + 1, b.y1] };
    default: {
      // Ceiling/floor openings are centred, so shift the base down by half the height.
      return { uMid: cfg.w / 2, vBase: zMid, clip: [b.x0, t.back, b.x1, cfg.d + 1], centred: true };
    }
  }
}

function wallHoles(k, cfg, wall) {
  if (missing(cfg, wall)) return null;
  const list = [...cfg.openings, ...(cfg.stairwells || [])].filter((o) => o.wall === wall);
  if (!list.length) return null;
  const f = wallFrame(cfg, wall);
  // Centred openings put their middle on the wall's; doorways stand on the floor.
  const v = (o) => (f.centred ? f.vBase - o.h / 2 : o.anchor === 'floor' ? f.vBase : f.vMid - o.h / 2);
  const cs = k.CrossSection.union(list.map((o) => openingSection(k, o, f.uMid, v(o))));
  const [x0, y0, x1, y1] = f.clip;
  const clipped = wall === 'back' ? cs.intersect(innerSection(k, cfg)) : cs.intersect(rect(k, x0, y0, x1, y1));
  return clipped.isEmpty() ? null : clipped;
}

// A lift shaft's two walls in a room, [x0, x1] each, and the groove up the
// face of each toward the car, [x0, x1, z0, z1], centred on the shaft's depth.
function shaftParts(s) {
  const l = s.x + s.t, r = l + s.w; // the faces the car runs between
  const zm = (s.z0 + s.z1) / 2, gw = s.rail + RAIL_FIT, gd = s.rail / 2;
  return {
    walls: [[s.x, l], [r, r + s.t]],
    grooves: [[l - gd, l], [r, r + gd]].map(([x0, x1]) => [x0, x1, zm - gw / 2, zm + gw / 2]),
  };
}

// Shaft walls stand on the floor and reach the ceiling, running half a
// millimetre into both and into the back so they fuse with the room, and
// never past its outline. A room whose back is thinner than the one the lift
// stands in still has its shaft walls reach it.
function shaftWalls(k, cfg) {
  const b = innerBox(cfg);
  const parts = cfg.shafts.map((s) => {
    const { walls, grooves } = shaftParts(s);
    const back = Math.min(s.z0, cfg.walls.back) - 0.5;
    const solid = k.Manifold.union(walls.map(([x0, x1]) => cuboid(k, x0, x1, b.y0 - 0.5, b.y1 + 0.5, back, s.z1)));
    return solid.subtract(k.Manifold.union(grooves.map(([x0, x1, z0, z1]) => cuboid(k, x0, x1, b.y0 - 1, b.y1 + 1, z0, z1))));
  });
  return k.Manifold.union(parts).intersect(outerSection(k, cfg).extrude(cfg.d));
}

// ---------------------------------------------------------------- 3D parts

export function buildRoom(k, cfg) {
  const { Manifold } = k;
  const outer = outerSection(k, cfg);
  const walls = outer.subtract(innerSection(k, cfg)).extrude(cfg.d);
  const backHoles = wallHoles(k, cfg, 'back');
  let body = missing(cfg, 'back') ? walls
    : Manifold.union([walls, (backHoles ? outer.subtract(backHoles) : outer).extrude(cfg.walls.back)]);

  // Side, ceiling and floor openings: extrude the 2D holes through the wall.
  const t = cfg.walls;
  const cuts = [];
  for (const wall of ['left', 'right']) {
    const holes = wallHoles(k, cfg, wall);
    if (!holes) continue;
    const th = t[wall] + 2;
    // (u, v, s) -> (-s, v, u): u is depth, v is height, s goes through the wall.
    const x = wall === 'left' ? t.left + 1 : cfg.w + 1;
    cuts.push(holes.extrude(th).rotate([0, -90, 0]).translate([x, 0, 0]));
  }
  for (const wall of ['ceiling', 'floor']) {
    const holes = wallHoles(k, cfg, wall);
    if (!holes) continue;
    const th = t[wall] + 2;
    // (u, v, s) -> (u, -s, v): u is width, v is depth, s goes through the wall.
    const y = wall === 'ceiling' ? cfg.h + 1 : t.floor + 1;
    cuts.push(holes.extrude(th).rotate([90, 0, 0]).translate([0, y, 0]));
  }
  if (cuts.length) body = body.subtract(Manifold.union(cuts));
  if (cfg.shafts?.length) body = Manifold.union([body, shaftWalls(k, cfg)]);
  return body;
}

export function buildTable(k, cfg) {
  const { Manifold } = k;
  const topT = 3, baseT = 3.5;
  const stemH = Math.max(cfg.height - topT - baseT, 1);
  const base = Manifold.cylinder(baseT, cfg.baseD / 2, cfg.baseD / 2, 64);
  const stem = Manifold.cylinder(stemH, cfg.stemD / 2, cfg.stemD / 2, 48).translate([0, 0, baseT]);
  const top = Manifold.cylinder(topT, cfg.topD / 2, cfg.topD / 2, 80).translate([0, 0, baseT + stemH]);
  return Manifold.union([base, stem, top]);
}

// Side profile of the stairs, in room coordinates (x along the run, y up):
// the steps on top and an underside parallel to them, one riser lower.
function stairsSection(k, cfg) {
  const n = Math.max(2, Math.round(cfg.steps));
  const g = cfg.run / n, r = cfg.rise / n;
  const pts = [[0, 0]];
  for (let i = 0; i < n; i++) pts.push([i * g, (i + 1) * r], [(i + 1) * g, (i + 1) * r]);
  pts.push([cfg.run, cfg.rise - r], [g, 0]);
  const s = k.CrossSection.ofPolygons([pts.reverse()]); // counter-clockwise
  return cfg.flip ? s.mirror([1, 0]).translate([cfg.run, 0]) : s;
}

// Built standing in room coordinates, so it prints lying on its side.
export function buildStairs(k, cfg) {
  return stairsSection(k, cfg).extrude(cfg.depth);
}

// The car, in the lift's own coordinates: x from the shaft's outer left edge,
// y up from the floor, z forward from the room's back wall. `inside` is null
// when the car is too small to hollow out.
function carBox(cfg) {
  const t = liftWall(cfg);
  const c = { x0: t + LIFT_GAP, x1: t + cfg.w - LIFT_GAP, y0: 0, y1: cfg.rise - LIFT_HEADROOM, z0: LIFT_GAP, z1: cfg.depth, t };
  const big = c.x1 - c.x0 > 2 * t + 0.5 && c.y1 - c.y0 > 2 * t + 0.5 && c.z1 - c.z0 > t + 0.5;
  c.inside = big ? { x0: c.x0 + t, x1: c.x1 - t, y0: c.y0 + t, y1: c.y1 - t, z0: c.z0 + t } : null;
  return c;
}

// A notch up each side, opposite the shaft wall's groove: half the rail deep,
// so the strand's edge clears it by the gap, and the rail plus the gap each
// side wide.
function carNotches(cfg, c) {
  const d = cfg.rail / 2, nw = cfg.rail + 2 * LIFT_GAP, zm = cfg.depth / 2;
  return [[c.x0, c.x0 + d], [c.x1 - d, c.x1]].map(([x0, x1]) => [x0, x1, zm - nw / 2, zm + nw / 2]);
}

// An open-fronted box: floor, roof, back and two sides. Built standing, so
// it prints lying on its back like the rooms.
export function buildLift(k, cfg) {
  const c = carBox(cfg), n = c.inside;
  let car = cuboid(k, c.x0, c.x1, c.y0, c.y1, c.z0, c.z1);
  if (n) car = car.subtract(cuboid(k, n.x0, n.x1, n.y0, n.y1, n.z0, c.z1 + 1));
  return car.subtract(k.Manifold.union(carNotches(cfg, c).map(([x0, x1, z0, z1]) => cuboid(k, x0, x1, c.y0 - 1, c.y1 + 1, z0, z1))));
}

export function buildBlock(k, kind, cfg) {
  if (kind === 'room') return buildRoom(k, cfg);
  if (isStairs(cfg)) return buildStairs(k, cfg);
  return isLift(cfg) ? buildLift(k, cfg) : buildTable(k, cfg);
}

// A ceiling or floor opening in `room` over an absolute x span and a z span
// measured from the back face, or null when it misses the room's interior.
// The cut itself is still clipped to the interior when the room is built.
export function stairwell(room, x0, x1, z0, z1, wall) {
  const cfg = room.cfg, b = innerBox(cfg);
  const lo = Math.max(x0 - room.x, b.x0), hi = Math.min(x1 - room.x, b.x1);
  if (hi - lo < 0.5) return null;
  const w = x1 - x0, h = z1 - z0;
  return defaultOpening({
    wall, shape: 'rect', w, h,
    x: (x0 + x1) / 2 - room.x - cfg.w / 2,
    y: (z0 + z1) / 2 - (cfg.walls.back + cfg.d) / 2,
    bar: 0,
  });
}

// The piece of a lift's shaft in `room`, in the room's own coordinates: its
// outer left edge at absolute x0, its depth from z0 (measured from the back
// face) forward.
export function liftShaft(room, x0, cfg, z0) {
  return { x: x0 - room.x, w: cfg.w, t: liftWall(cfg), z0, z1: z0 + cfg.depth, rail: cfg.rail };
}

// ---------------------------------------------------------------- 2D front view

// Polygons for drawing a block in the front elevation, origin at its
// bottom-left. `marks` are side/ceiling/floor openings seen edge-on, drawn
// on the wall they pass through so you can line doorways up between rooms.
export function frontProfile(k, kind, cfg) {
  if (kind === 'furniture' && isStairs(cfg)) {
    return { shell: stairsSection(k, cfg).toPolygons(), room: [], holes: [], marks: [] };
  }
  // The car's frame round its inside, and its notches edge-on, in line with
  // the grooves in the shaft walls. `shaft`, the two walls it runs between,
  // belongs to the rooms on the shelf and is drawn only on the palette.
  if (kind === 'furniture' && isLift(cfg)) {
    const c = carBox(cfg), n = c.inside, { w, h } = blockSize(kind, cfg);
    const box = rect(k, c.x0, c.y0, c.x1, c.y1);
    const inside = n && rect(k, n.x0, n.y0, n.x1, n.y1);
    return {
      shell: (inside ? box.subtract(inside) : box).toPolygons(),
      room: inside ? inside.toPolygons() : [],
      holes: [],
      marks: carNotches(cfg, c).map(([x0, x1]) => [x0, c.y0, x1, c.y1]),
      shaft: [...rect(k, 0, 0, c.t, h).toPolygons(), ...rect(k, w - c.t, 0, w, h).toPolygons()],
    };
  }
  if (kind === 'furniture') {
    const { w } = blockSize(kind, cfg);
    const c = w / 2;
    const parts = [
      rect(k, c - cfg.baseD / 2, 0, c + cfg.baseD / 2, 3.5),
      rect(k, c - cfg.stemD / 2, 3.5, c + cfg.stemD / 2, cfg.height - 3),
      rect(k, c - cfg.topD / 2, cfg.height - 3, c + cfg.topD / 2, cfg.height),
    ];
    return { shell: k.CrossSection.union(parts).toPolygons(), room: [], holes: [], marks: [] };
  }
  const outer = outerSection(k, cfg);
  const inner = innerSection(k, cfg);
  const holes = wallHoles(k, cfg, 'back');
  const marks = [];
  const t = cfg.walls, b = innerBox(cfg);
  for (const wall of ['left', 'right', 'ceiling', 'floor']) {
    const cs = wallHoles(k, cfg, wall);
    if (!cs) continue;
    const bb = cs.bounds();
    if (wall === 'left') marks.push([0, bb.min[1], t.left, bb.max[1]]);
    if (wall === 'right') marks.push([cfg.w - t.right, bb.min[1], cfg.w, bb.max[1]]);
    if (wall === 'ceiling') marks.push([bb.min[0], b.y1, bb.max[0], cfg.h]);
    if (wall === 'floor') marks.push([bb.min[0], 0, bb.max[0], b.y0]);
  }
  // Lift shaft walls are part of the room's frame; their grooves show edge-on
  // up the faces the car runs between, lined up from floor to floor.
  let shell = outer.subtract(inner);
  for (const s of cfg.shafts || []) {
    const { walls, grooves } = shaftParts(s);
    shell = shell.add(k.CrossSection.union(walls.map(([x0, x1]) => rect(k, x0, b.y0, x1, b.y1))).intersect(outer));
    for (const [x0, x1] of grooves) marks.push([x0, b.y0, x1, b.y1]);
  }
  return {
    shell: shell.toPolygons(),
    room: (holes ? inner.subtract(holes) : inner).intersect(outer).toPolygons(),
    holes: holes ? holes.toPolygons() : [],
    marks,
  };
}

// ---------------------------------------------------------------- export

export function meshArrays(manifold) {
  const m = manifold.getMesh();
  const np = m.numProp;
  const positions = new Float32Array((m.vertProperties.length / np) * 3);
  for (let i = 0, j = 0; i < m.vertProperties.length; i += np, j += 3) {
    positions[j] = m.vertProperties[i];
    positions[j + 1] = m.vertProperties[i + 1];
    positions[j + 2] = m.vertProperties[i + 2];
  }
  return { positions, indices: new Uint32Array(m.triVerts) };
}

// Binary STL.
export function toSTL({ positions, indices }, name = 'shelf_house') {
  const triCount = indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  const header = `${name} - shelf house generator`.slice(0, 80);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, triCount, true);
  let o = 84;
  const v = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (let t = 0; t < triCount; t++) {
    const a = v(indices[t * 3]), b = v(indices[t * 3 + 1]), c = v(indices[t * 3 + 2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    for (const f of [nx / len, ny / len, nz / len, ...a, ...b, ...c]) {
      dv.setFloat32(o, f, true); o += 4;
    }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}
