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

export function defaultRoom(over = {}) {
  return {
    w: 120, h: 72, d: 56,
    walls: { left: 3, right: 3, ceiling: 3, floor: 3, back: 3 },
    outerR: 8, innerR: 5,
    outer: { tl: true, tr: true, br: true, bl: true },
    inner: { tl: true, tr: true, br: true, bl: true },
    color: '#d8b4a0',
    openings: [],
    ...over,
  };
}

// An opening cut through one wall. Position meaning depends on the wall:
//  back, left, right: x = centre offset from the wall's middle,
//                     y = sill height above the floor (0 = doorway)
//  ceiling, floor:    x = offset across the width, y = offset front/back
//                     (both from the middle)
// The shape is split by `cols` × `rows` glazing bars of width `bar`, and
// repeated `count` times, `pitch` mm apart (centre to centre).
export function defaultOpening(over = {}) {
  return {
    wall: 'back', shape: 'rect', x: 0, y: 20, w: 30, h: 30, r: 0,
    cols: 1, rows: 1, bar: 2.5, count: 1, pitch: 40,
    ...over,
  };
}

export const OPENING_PRESETS = {
  window: () => defaultOpening({ wall: 'back', shape: 'rect', y: 20, w: 34, h: 30, cols: 2, rows: 2 }),
  doorway: () => defaultOpening({ wall: 'left', shape: 'arch', y: 0, w: 24, h: 50 }),
  skylight: () => defaultOpening({ wall: 'ceiling', shape: 'round', y: 0, w: 30, h: 30, cols: 2, rows: 2 }),
};

export function defaultTable(over = {}) {
  return { topD: 36, baseD: 26, stemD: 10, height: 26.5, color: '#b5838d', ...over };
}

const op = defaultOpening;
export const PRESETS = {
  wide_6pane: {
    name: 'Wide · 6-pane', kind: 'room',
    cfg: defaultRoom({ color: '#e9c46a', openings: [op({ y: 19, w: 46, h: 36, cols: 2, rows: 3 })] }),
  },
  wide_arched: {
    name: 'Wide · arched', kind: 'room',
    cfg: defaultRoom({ color: '#f4a261', openings: [op({ shape: 'arch', y: 16, w: 22, h: 40, rows: 2, count: 3, pitch: 28 })] }),
  },
  wide_porthole: {
    name: 'Wide · portholes', kind: 'room',
    cfg: defaultRoom({
      color: '#8ab17d',
      openings: [
        op({ shape: 'round', x: -26, y: 20, w: 34, h: 34, cols: 2, rows: 2 }),
        op({ shape: 'round', x: 20, y: 20, w: 34, h: 34, cols: 2, rows: 2 }),
        op({ x: 45, y: 27, w: 7, h: 20, r: 3.5 }),
      ],
    }),
  },
  wide_doorways: {
    name: 'Wide · doorways', kind: 'room',
    cfg: defaultRoom({
      color: '#cdb4db',
      openings: [
        op({ wall: 'left', shape: 'arch', y: 0, w: 24, h: 50 }),
        op({ wall: 'right', shape: 'arch', y: 0, w: 24, h: 50 }),
        op({ y: 22, w: 40, h: 26, r: 4, cols: 3 }),
      ],
    }),
  },
  narrow_4pane: {
    name: 'Narrow · 4-pane', kind: 'room',
    cfg: defaultRoom({ w: 78, color: '#7fb7be', openings: [op({ y: 24, w: 34, h: 30, cols: 2, rows: 2 })] }),
  },
  narrow_skylight: {
    name: 'Narrow · skylight', kind: 'room',
    cfg: defaultRoom({
      w: 78, color: '#a8dadc',
      outer: { tl: true, tr: true, br: false, bl: false },
      inner: { tl: true, tr: true, br: false, bl: false },
      openings: [op({ wall: 'ceiling', shape: 'rect', y: 0, w: 44, h: 30, r: 3, cols: 2 })],
    }),
  },
  narrow_blank: {
    name: 'Narrow · blank', kind: 'room',
    cfg: defaultRoom({ w: 78 }),
  },
  round_table: {
    name: 'Round table', kind: 'furniture',
    cfg: defaultTable(),
  },
};

export function blockSize(kind, cfg) {
  if (kind === 'furniture') return { w: Math.max(cfg.topD, cfg.baseD), h: cfg.height, d: Math.max(cfg.topD, cfg.baseD) };
  return { w: cfg.w, h: cfg.h, d: cfg.d };
}

// ---------------------------------------------------------------- 2D helpers

const rect = (k, x0, y0, x1, y1) => k.CrossSection.square([x1 - x0, y1 - y0]).translate([x0, y0]);

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

const radii = (on, r) => Object.fromEntries(CORNERS.map((c) => [c, on[c] ? r : 0]));

export function innerBox(cfg) {
  const t = cfg.walls;
  return { x0: t.left, y0: t.floor, x1: cfg.w - t.right, y1: cfg.h - t.ceiling };
}

function outerSection(k, cfg) {
  return cornerRect(k, 0, 0, cfg.w, cfg.h, radii(cfg.outer, cfg.outerR));
}

function innerSection(k, cfg) {
  const b = innerBox(cfg);
  return cornerRect(k, b.x0, b.y0, b.x1, b.y1, radii(cfg.inner, cfg.innerR));
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
    case 'back': return { uMid: cfg.w / 2, vBase: b.y0, clip: [b.x0, b.y0, b.x1, b.y1] };
    case 'left':
    case 'right': return { uMid: zMid, vBase: b.y0, clip: [t.back, b.y0, cfg.d + 1, b.y1] };
    default: {
      // Ceiling/floor openings are centred, so shift the base down by half the height.
      return { uMid: cfg.w / 2, vBase: zMid, clip: [b.x0, t.back, b.x1, cfg.d + 1], centred: true };
    }
  }
}

function wallHoles(k, cfg, wall) {
  const list = cfg.openings.filter((o) => o.wall === wall);
  if (!list.length) return null;
  const f = wallFrame(cfg, wall);
  const cs = k.CrossSection.union(list.map((o) =>
    openingSection(k, o, f.uMid, f.centred ? f.vBase - o.h / 2 : f.vBase)));
  const [x0, y0, x1, y1] = f.clip;
  const clipped = wall === 'back' ? cs.intersect(innerSection(k, cfg)) : cs.intersect(rect(k, x0, y0, x1, y1));
  return clipped.isEmpty() ? null : clipped;
}

// ---------------------------------------------------------------- 3D parts

export function buildRoom(k, cfg) {
  const { Manifold } = k;
  const outer = outerSection(k, cfg);
  const walls = outer.subtract(innerSection(k, cfg)).extrude(cfg.d);
  const backHoles = wallHoles(k, cfg, 'back');
  const back = (backHoles ? outer.subtract(backHoles) : outer).extrude(cfg.walls.back);
  let body = Manifold.union([walls, back]);

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

export function buildBlock(k, kind, cfg) {
  return kind === 'furniture' ? buildTable(k, cfg) : buildRoom(k, cfg);
}

// ---------------------------------------------------------------- 2D front view

// Polygons for drawing a block in the front elevation, origin at its
// bottom-left. `marks` are side/ceiling/floor openings seen edge-on, drawn
// on the wall they pass through so you can line doorways up between rooms.
export function frontProfile(k, kind, cfg) {
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
  return {
    shell: outer.subtract(inner).toPolygons(),
    room: (holes ? inner.subtract(holes) : inner).toPolygons(),
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
