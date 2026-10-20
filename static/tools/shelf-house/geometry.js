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
export const ROOM_DEFAULTS = { wide: 120, narrow: 80, h: 72, d: 56, thick: 3, thin: 1.5, outerR: 8, innerR: 5 };

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
// width; `rise`, `depth`, `back` (the room's, behind the car), `wall` (the
// shaft's) and `panel` (the car's) follow the room and the shelf's thick and
// thin walls and are set by the layout, like the stairs'. A guide rib up the
// outside of each side of the car runs in a V-groove up the shaft wall facing
// it, and magnets in the car and the back wall latch it at each floor.
export function defaultLift(over = {}) {
  return { form: 'lift', w: 32, floors: 2, rise: 66, depth: 26.5, back: 3, wall: 3, panel: 1.5, color: '#8d99ae', ...over };
}

export const isLift = (cfg) => cfg.form === 'lift';

// The car clears the shaft walls and the back by LIFT_GAP and the ceiling by
// LIFT_HEADROOM. Rib and groove are 90° vees, so both print without support
// lying on their backs. A rib stands RIB proud of the car; its groove is
// LIFT_GAP clear of it on both flanks, which puts the groove's point
// LIFT_GAP·√2 past the rib's, GROOVE deep in the wall.
const LIFT_GAP = 0.3, LIFT_HEADROOM = 1, RIB = 1.5;
const GROOVE = RIB - LIFT_GAP + LIFT_GAP * Math.SQRT2;
// Shaft walls stay thick enough to take the groove.
export const liftWall = (cfg) => Math.max(cfg.wall, GROOVE + 0.8);

// The latch: disc magnets low on the back of the car, and as many in the
// room's back wall at each storey, in line with them when the car stands on
// that floor. Each sits in a pocket MAG_FIT bigger all round, behind SKIN of
// plastic on the side toward its partner, so the pull seats it instead of
// drawing it out: the car's pockets open inside the car, the room's on its
// outside back face. Both stand upright as printed.
const MAG_FIT = 0.1, SKIN = 0.6, BOSS = 0.8;
// Disc magnets as sold, [diameter, height, hold] in mm and N, narrowest
// first and thickest first within a diameter: what a pair holds against
// sliding across the two skins, 1.2 mm (N35, by the magnetic charge model).
// The car's pull on the back wall adds friction of about 60% of that again.
const MAGNETS = [
  [3, 2, 0.29], [3, 1, 0.15], [4, 2, 0.56], [4, 1, 0.27], [5, 2, 0.87], [5, 1, 0.38],
  [6, 3, 1.75], [6, 2, 1.19], [6, 1, 0.49], [8, 3, 2.85], [8, 2, 1.81], [8, 1, 0.68],
  [10, 3, 3.9], [10, 2, 2.36], [10, 1, 0.85], [12, 3, 4.88], [12, 2, 2.87],
];
// A car gets a magnet for every MAG_PITCH of its width, all of the narrowest
// size, as thick as the back allows, that together hold MAG_MARGIN times its
// weight in solid PLA (g/mm³) on the magnets alone; more of them if no size
// it has room for does.
const MAG_PITCH = 50, MAG_MARGIN = 3, PLA = 1.24e-3;

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

// A round post or hole along z, from z0 to z1, centred on (x, y).
const disc = (k, x, y, r, z0, z1) => k.Manifold.cylinder(z1 - z0, r, r, SEG * 4).translate([x, y, z0]);

// A 90° vee running up y from y0 to y1: its mouth on the plane x, `half`
// either side of zm, its point `half` from the mouth toward `dir` (±1).
function vee(k, x, dir, zm, half, y0, y1) {
  const pts = [[x, zm - half], [x + dir * half, zm], [x, zm + half]];
  // Counter-clockwise in x–z; the turn stands it up along y.
  return k.CrossSection.ofPolygons([dir > 0 ? pts : pts.reverse()]).extrude(y1 - y0).rotate([90, 0, 0]).translate([0, y1, 0]);
}

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

// A lift shaft's two walls in a room, [x0, x1] each; the face of each toward
// the car and which way is into the wall from it, [x, dir]; the middle of
// the shaft's depth, where the grooves run; and how far up they run: from the
// floor and to the ceiling, or on through either where the shaft does.
function shaftParts(s, cfg) {
  const l = s.x + s.t, r = l + s.w; // the faces the car runs between
  const b = innerBox(cfg);
  return {
    walls: [[s.x, l], [r, r + s.t]],
    faces: [[l, -1], [r, 1]],
    zm: (s.z0 + s.z1) / 2,
    y0: s.floor ? 0 : b.y0,
    y1: s.ceiling ? cfg.h : b.y1,
  };
}

// Shaft walls stand on the floor and reach the ceiling, running half a
// millimetre into both and into the back so they fuse with the room, and
// never past its outline. A room whose back is thinner than the one the lift
// stands in still has its shaft walls reach it.
function shaftWalls(k, cfg) {
  const b = innerBox(cfg);
  const parts = cfg.shafts.map((s) => {
    const back = Math.min(s.z0, cfg.walls.back) - 0.5;
    return k.Manifold.union(shaftParts(s, cfg).walls.map(([x0, x1]) => cuboid(k, x0, x1, b.y0 - 0.5, b.y1 + 0.5, back, s.z1)));
  });
  return k.Manifold.union(parts).intersect(outerSection(k, cfg).extrude(cfg.d));
}

// The V-groove up each shaft wall, cut from the room once the walls are on it
// so that it carries on through an open floor or ceiling, where the car's
// ribs pass on their way to the next storey. Each starts half a millimetre
// out in the shaft, which is open there.
function shaftGrooves(k, cfg) {
  return k.Manifold.union(cfg.shafts.flatMap((s) => {
    const { faces, zm, y0, y1 } = shaftParts(s, cfg);
    // Clean out through an open floor or ceiling; flush with a closed one.
    const lo = s.floor ? y0 - 1 : y0, hi = s.ceiling ? y1 + 1 : y1;
    return faces.map(([x, dir]) => vee(k, x - dir * 0.5, dir, zm, GROOVE + 0.5, lo, hi));
  }));
}

// A seat for each magnet behind the shaft: a pocket in from the outside back
// face that stops a skin short of the face the car runs against, in a pad
// that makes up a back thinner than the one the lift stands in.
function magnetSeats(k, cfg) {
  return cfg.shafts.filter((s) => s.magnets).flatMap((s) => {
    const r = s.magnets.d / 2 + MAG_FIT;
    return s.magnets.at.map(([x, y]) => ({ pad: disc(k, x, y, r + BOSS, 0, s.z0), pocket: disc(k, x, y, r, -1, s.z0 - SKIN) }));
  });
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
  if (cfg.shafts?.length) {
    const seats = magnetSeats(k, cfg);
    body = Manifold.union([body, shaftWalls(k, cfg), ...seats.map((m) => m.pad)])
      .subtract(Manifold.union([shaftGrooves(k, cfg), ...seats.map((m) => m.pocket)]));
  }
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
// y up from the floor, z forward from the room's back wall. It stops short of
// the front edge of the openings it rides through by the gap too. Its panels
// are `panel` thick; `inside` is null when the car is too small to hollow out.
function carBox(cfg) {
  const t = liftWall(cfg), p = cfg.panel;
  const c = { x0: t + LIFT_GAP, x1: t + cfg.w - LIFT_GAP, y0: 0, y1: cfg.rise - LIFT_HEADROOM, z0: LIFT_GAP, z1: cfg.depth - LIFT_GAP, t };
  const big = c.x1 - c.x0 > 2 * p + 0.5 && c.y1 - c.y0 > 2 * p + 0.5 && c.z1 - c.z0 > p + 0.5;
  c.inside = big ? { x0: c.x0 + p, x1: c.x1 - p, y0: c.y0 + p, y1: c.y1 - p, z0: c.z0 + p } : null;
  return c;
}

// The car's volume in mm³, ribs and all.
function carVolume(c) {
  const n = c.inside, box = (c.x1 - c.x0) * (c.y1 - c.y0) * (c.z1 - c.z0);
  return box - (n ? (n.x1 - n.x0) * (n.y1 - n.y0) * (c.z1 - n.z0) : 0) + 2 * RIB * RIB * (c.y1 - c.y0);
}

// The car's magnets: their diameter `d` and height `h`, and `at`, where each
// sits, [x, y] in the car's own coordinates, spread across its back with
// their posts standing on its floor. Null when none fits: the back of the
// room is too thin to seat one behind its skin, or the car to take its post.
export function liftMagnets(cfg) {
  const c = carBox(cfg), w = c.x1 - c.x0, tall = c.y1 - c.y0 - 2 * cfg.panel;
  const post = (d) => d + 2 * (MAG_FIT + BOSS);
  const across = (d) => Math.floor(w / post(d));
  const fits = MAGNETS.filter(([d, h]) => cfg.back >= SKIN + h + MAG_FIT && post(d) <= Math.min(w, tall));
  if (!fits.length) return null;
  const load = MAG_MARGIN * carVolume(c) * PLA * 9.81e-3;
  const most = Math.max(...fits.map(([d]) => across(d)));
  let pick = null;
  for (let n = Math.max(1, Math.ceil(w / MAG_PITCH)); !pick && n <= most; n++) {
    const m = fits.find(([d, , hold]) => n <= across(d) && n * hold >= load);
    if (m) pick = [m, n];
  }
  // Nothing holds it that much: as many of whichever holds most.
  if (!pick) {
    const m = fits.reduce((a, b) => (across(b[0]) * b[2] > across(a[0]) * a[2] ? b : a));
    pick = [m, across(m[0])];
  }
  const [[d, h], n] = pick, y = c.y0 + cfg.panel + d / 2 + MAG_FIT + BOSS;
  return { d, h, at: Array.from({ length: n }, (_, i) => [c.x0 + ((i + 0.5) * w) / n, y]) };
}

// An open-fronted box: floor, roof, back and two sides, with a guide rib up
// the outside of each side, in line with the shaft wall's groove. Each rib
// starts halfway into its side so the two fuse. Each magnet drops into a post
// on the back from inside, onto a skin of the back panel; where the car is
// solid, its hole runs out through the front. Built standing, so it prints
// lying on its back like the rooms.
export function buildLift(k, cfg) {
  const c = carBox(cfg), n = c.inside, e = cfg.panel / 2;
  let car = cuboid(k, c.x0, c.x1, c.y0, c.y1, c.z0, c.z1);
  if (n) car = car.subtract(cuboid(k, n.x0, n.x1, n.y0, n.y1, n.z0, c.z1 + 1));
  const ribs = [[c.x0 + e, -1], [c.x1 - e, 1]].map(([x, dir]) => vee(k, x, dir, cfg.depth / 2, RIB + e, c.y0, c.y1));
  const m = liftMagnets(cfg);
  if (!m) return k.Manifold.union([car, ...ribs]);
  const r = m.d / 2 + MAG_FIT, seat = c.z0 + SKIN;
  car = k.Manifold.union([car, ...ribs, ...m.at.map(([x, y]) => disc(k, x, y, r + BOSS, c.z0, seat + m.h + MAG_FIT))]);
  return car.subtract(k.Manifold.union(m.at.map(([x, y]) => disc(k, x, y, r, seat, c.z1 + 1))));
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
// face) forward. `floor` and `ceiling` are set where the shaft carries on
// through them, and its grooves with it. `magnets` are the car's, where they
// are when it stands on this room's floor, or null.
export function liftShaft(room, x0, cfg, z0) {
  const x = x0 - room.x, y = innerBox(room.cfg).y0, m = liftMagnets(cfg);
  return {
    x, w: cfg.w, t: liftWall(cfg), z0, z1: z0 + cfg.depth, floor: false, ceiling: false,
    magnets: m && { d: m.d, h: m.h, at: m.at.map(([mx, my]) => [x + mx, y + my]) },
  };
}

// ---------------------------------------------------------------- 2D front view

// Polygons for drawing a block in the front elevation, origin at its
// bottom-left. `marks` are side/ceiling/floor openings seen edge-on, drawn
// on the wall they pass through so you can line doorways up between rooms.
export function frontProfile(k, kind, cfg) {
  if (kind === 'furniture' && isStairs(cfg)) {
    return { shell: stairsSection(k, cfg).toPolygons(), room: [], holes: [], marks: [] };
  }
  // The car's frame round its inside, and its ribs end-on, standing off its
  // sides into the grooves in the shaft walls. `shaft`, the two walls it runs
  // between, belongs to the rooms on the shelf and is drawn only on the palette.
  if (kind === 'furniture' && isLift(cfg)) {
    const c = carBox(cfg), n = c.inside, { w, h } = blockSize(kind, cfg);
    const box = rect(k, c.x0, c.y0, c.x1, c.y1);
    const inside = n && rect(k, n.x0, n.y0, n.x1, n.y1);
    return {
      shell: (inside ? box.subtract(inside) : box).toPolygons(),
      room: inside ? inside.toPolygons() : [],
      holes: [],
      marks: [[c.x0 - RIB, c.y0, c.x0, c.y1], [c.x1, c.y0, c.x1 + RIB, c.y1]],
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
  // Lift shaft walls are part of the room's frame; their grooves show end-on
  // up the faces the car runs between, and on through an open floor or
  // ceiling, lined up from storey to storey.
  let shell = outer.subtract(inner);
  for (const s of cfg.shafts || []) {
    const { walls, faces, y0, y1 } = shaftParts(s, cfg);
    shell = shell.add(k.CrossSection.union(walls.map(([x0, x1]) => rect(k, x0, b.y0, x1, b.y1))).intersect(outer));
    for (const [x, dir] of faces) marks.push([Math.min(x, x + dir * GROOVE), y0, Math.max(x, x + dir * GROOVE), y1]);
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
