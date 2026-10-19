import Module from 'manifold-3d';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { zipSync } from 'fflate';
import {
  PRESETS, OPENING_PRESETS, CORNERS, WALLS, SHAPES,
  blockSize, buildBlock, frontProfile, meshArrays, toSTL, innerBox,
  defaultStairs, isStairs, stairwell, ROOM_DEFAULTS, migrateOpening,
  defaultLift, isLift, liftShaft, liftWall, RAILS,
} from './geometry.js';

const k = await Module();
k.setup();

const STORAGE_KEY = 'shelf-house-layout-v3';
const LEGACY_KEY = 'shelf-house-layout-v2';
const TYPES_KEY = 'shelf-house-types-v1';
const UNITS_KEY = 'shelf-house-units';
const PLA_DENSITY = 1.24; // g/cm³
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const clone = (v) => structuredClone(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (v) => (Math.round(v * 10) / 10).toString();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ units

// Everything is stored, built and exported in millimetres; inches only change
// what the page shows and how typed lengths are read.
const MM_PER_IN = 25.4;
let units = loadUnits();

function loadUnits() {
  try { return localStorage.getItem(UNITS_KEY) === 'in' ? 'in' : 'mm'; } catch { return 'mm'; }
}
const inches = () => units === 'in';
const unitName = () => (inches() ? 'in' : 'mm');
const toUnit = (mm) => (inches() ? mm / MM_PER_IN : mm);
// Typed inches come in clean of float dust, so 3 in is 76.2 mm exactly.
const fromUnit = (v) => (inches() ? Math.round(v * MM_PER_IN * 1e6) / 1e6 : v);
const fmtLen = (mm) => (inches() ? (Math.round((mm / MM_PER_IN) * 100) / 100).toString() : fmt(mm));
const len = (mm) => `${fmtLen(mm)} ${unitName()}`;
// The sideways step of the nudge chips and Shift+arrow: 10 mm, or half an inch.
const bigStep = () => (inches() ? MM_PER_IN / 2 : 10);
// The factory room widths are round in either unit: 120 or 80 mm, 5 or 3 in.
const roomDefaults = () => (inches() ? { ...ROOM_DEFAULTS, wide: 127, narrow: 76.2 } : ROOM_DEFAULTS);

// ------------------------------------------------------------------ grid

// Snapping belongs to the visitor, like the units, and each unit keeps a
// grid of its own, so switching never leaves an odd step: 5 mm and ⅛ in to
// start. While it is on, whatever moves lands on it, every length field but
// the fine ones steps by it, and the band offers to snap what is off it.
const GRID_KEY = 'shelf-house-grid';
const GRID_DEFAULT = { on: false, mm: 5, in: 0.125 };
const GRID_LIMITS = { mm: [0.5, 100, 0.5], in: [0.0625, 4, 0.0625] }; // min, max, step
let grid = loadGrid();

function loadGrid() {
  try {
    const g = JSON.parse(localStorage.getItem(GRID_KEY));
    const size = (u) => (Number.isFinite(g?.[u]) && g[u] >= GRID_LIMITS[u][0] && g[u] <= GRID_LIMITS[u][1] ? g[u] : GRID_DEFAULT[u]);
    if (g) return { on: g.on === true, mm: size('mm'), in: size('in') };
  } catch { /* storage unavailable */ }
  return { ...GRID_DEFAULT };
}
function saveGrid() {
  try { localStorage.setItem(GRID_KEY, JSON.stringify(grid)); } catch { /* ignore */ }
}
// The grid's step in the page's units, and in mm; 0 while snapping is off.
const gridStep = () => (grid.on ? grid[units] : 0);
const gridMM = () => (grid.on ? fromUnit(grid[units]) : 0);
// The grid line nearest v (mm), without float dust or a negative zero.
const toGrid = (v, g = gridMM()) => (g ? Math.round(Math.round(v / g) * g * 1e6) / 1e6 + 0 : v);
const isOnGrid = (v, g = gridMM()) => !g || Math.abs(v - toGrid(v, g)) < 0.01;

// ------------------------------------------------------------------ block types

let customTypes = loadTypes();

function loadTypes() {
  try {
    const t = JSON.parse(localStorage.getItem(TYPES_KEY));
    if (Array.isArray(t)) return t.filter((x) => x && x.key && x.cfg).map(migrateItem);
  } catch { /* storage unavailable */ }
  return [];
}
function saveTypes() {
  try { localStorage.setItem(TYPES_KEY, JSON.stringify(customTypes)); } catch { /* ignore */ }
}
function typeDef(key) {
  return PRESETS[key] || customTypes.find((t) => t.key === key);
}
function fromType(key) {
  const t = typeDef(key);
  const block = { kind: t.kind, name: t.name, base: key, cfg: clone(t.cfg) };
  if (t.kind === 'room') Object.assign(block, { size: t.size || 'wide', own: clone(t.own || {}), walls: clone(t.walls || ALL_THICK) });
  return block;
}

// ------------------------------------------------------------------ sizes

// A room follows the page's settings on every size the user has not set:
// `size` says which of the two widths it takes, `own` which sizes are its own,
// and `walls` whether each wall is thick, thin or missing. cfg.w/h/d and
// cfg.walls always hold the resolved millimetres, so geometry never needs to know.
const WALL_KINDS = ['thick', 'thin', 'none'];
const ALL_THICK = Object.fromEntries(WALLS.map((w) => [w, 'thick']));

function resolveSize(it, s) {
  const own = it.own || (it.own = {});
  if (!own.w) it.cfg.w = it.size === 'narrow' ? s.narrow : s.wide;
  if (!own.h) it.cfg.h = s.h;
  if (!own.d) it.cfg.d = s.d;
  const walls = it.walls || (it.walls = { ...ALL_THICK });
  it.cfg.walls = Object.fromEntries(WALLS.map((w) => [w, walls[w] === 'none' ? 0 : walls[w] === 'thin' ? s.thin : s.thick]));
  it.cfg.outerR = s.outerR;
  it.cfg.innerR = s.innerR;
  return it;
}

function applyDefaults(layout) {
  const s = layout.settings = { ...roomDefaults(), ...(layout.settings || state?.settings) };
  for (const it of layout.items) if (isRoom(it)) resolveSize(it, s);
  return layout;
}

const defaultFor = (it, dim, s = state.settings) => (dim === 'w' ? s[it.size === 'narrow' ? 'narrow' : 'wide'] : s[dim]);

// Rooms and room types saved before settings existed were made at the factory
// sizes of the time: anything else was set by hand. Their wall openings move
// to anchors.
const FACTORY_V2 = { ...ROOM_DEFAULTS, narrow: 78 };

function migrateItem(it) {
  if (it.kind !== 'room') return it;
  const c = it.cfg;
  if (it.size !== 'wide' && it.size !== 'narrow') it.size = c.w <= (FACTORY_V2.wide + FACTORY_V2.narrow) / 2 ? 'narrow' : 'wide';
  if (!it.own || typeof it.own !== 'object') {
    it.own = {};
    if (c.w !== FACTORY_V2[it.size]) it.own.w = true;
    if (c.h !== FACTORY_V2.h) it.own.h = true;
    if (c.d !== FACTORY_V2.d) it.own.d = true;
  }
  // Walls used to be any thickness: each becomes the nearer of thick and thin.
  if (!it.walls || typeof it.walls !== 'object') {
    const mid = (FACTORY_V2.thick + FACTORY_V2.thin) / 2;
    it.walls = Object.fromEntries(WALLS.map((w) => {
      const t = c.walls?.[w];
      return [w, !(t > 0) && t != null ? 'none' : t != null && t < mid ? 'thin' : 'thick'];
    }));
  }
  for (const w of WALLS) if (!WALL_KINDS.includes(it.walls[w])) it.walls[w] = 'thick';
  c.openings = (c.openings || []).map((o) => migrateOpening(c, o));
  return it;
}

const SETTING_MIN = { thick: 0.4, thin: 0.4, outerR: 0, innerR: 0 };
const SETTING_MAX = { thick: 30, thin: 30, outerR: 100, innerR: 100 };

function sanitizeSettings(s, base = roomDefaults()) {
  const out = { ...base };
  for (const key of Object.keys(out)) {
    const v = s?.[key];
    if (Number.isFinite(v) && v >= (SETTING_MIN[key] ?? 10) && v <= (SETTING_MAX[key] ?? 500)) out[key] = v;
  }
  return out;
}

// Laid out for the current shelf settings: a wide and a narrow column two
// floors high, a wide room centred on top, a table in the middle of it.
function makeExample() {
  const s = { ...roomDefaults(), ...state?.settings };
  const table = blockSize('furniture', PRESETS.round_table.cfg).w;
  let id = 0;
  const at = (key, x, y, extra = {}) => ({ id: ++id, ...fromType(key), x, y, ...extra });
  return {
    items: [
      at('wide_porthole', 0, 0),
      at('narrow_4pane', s.wide, 0),
      at('wide_doorways', 0, s.h),
      at('narrow_skylight', s.wide, s.h),
      at('wide_arched', Math.round(s.narrow / 2), 2 * s.h),
      at('round_table', Math.round((s.wide - table) / 2), 0, { parent: 5 }),
    ],
    settings: s,
  };
}

// ------------------------------------------------------------------ state

let state = null; // set at start-up, once the helpers below exist
let selectedId = null;
let drag = null;
let editSnapshot = null;
const undoStack = [];
const redoStack = [];

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY));
    if (s && Array.isArray(s.items)) return sanitize(s);
  } catch { /* storage unavailable or corrupt */ }
  return null;
}

function sanitize(s) {
  const items = s.items.filter((it) => it && (it.kind === 'room' || it.kind === 'furniture') && it.cfg && Number.isFinite(it.x)).map(migrateItem);
  return settle({ items, settings: sanitizeSettings(s.settings, s.settings ? roomDefaults() : FACTORY_V2) });
}

const snap = (s) => JSON.stringify({ settings: s.settings, items: s.items });
const layoutFile = () => JSON.stringify({ version: 3, settings: state.settings, items: state.items, types: customTypes }, null, 2);

function persist() {
  try { localStorage.setItem(STORAGE_KEY, snap(state)); } catch { /* ignore */ }
}

function pushUndo(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0;
}

function commit(next, { inspector = true } = {}) {
  endEdit();
  pushUndo(snap(state));
  state = settle(next);
  if (selectedId != null && !state.items.some((i) => i.id === selectedId)) selectedId = null;
  persist();
  render();
  if (inspector) renderInspector();
}

function undo() {
  endEdit();
  if (!undoStack.length) return;
  redoStack.push(snap(state));
  state = settle(JSON.parse(undoStack.pop()));
  afterHistory();
}
function redo() {
  endEdit();
  if (!redoStack.length) return;
  undoStack.push(snap(state));
  state = settle(JSON.parse(redoStack.pop()));
  afterHistory();
}
function afterHistory() {
  if (selectedId != null && !state.items.some((i) => i.id === selectedId)) selectedId = null;
  persist();
  render();
  renderInspector();
  renderSettings();
  renderPalette();
}

const nextId = () => Math.max(0, ...state.items.map((i) => i.id)) + 1;
const isRoom = (it) => it.kind === 'room';
const sizeOf = (it) => blockSize(it.kind, it.cfg);
const selected = () => state.items.find((i) => i.id === selectedId);
const layoutCopy = () => ({ items: clone(state.items), settings: { ...state.settings } });

// Absolute bottom-left of an item in a layout.
function absPos(layout, it) {
  if (isRoom(it)) return { x: it.x, y: it.y };
  const host = it.parent != null && layout.items.find((m) => m.id === it.parent);
  if (host) return { x: host.x + it.x, y: host.y + host.cfg.walls.floor };
  return { x: it.x, y: 0 };
}

// ------------------------------------------------------------------ physics

// Drop every room straight down until it rests on the floor or on another
// room. Rooms are processed bottom-up; the one being moved yields to rooms
// already at the same height so it lands on top rather than shoving them.
function settle(layout, movedId = null) {
  applyDefaults(layout);
  const rooms = layout.items.filter(isRoom);
  rooms.sort((a, b) => a.y - b.y || (a.id === movedId) - (b.id === movedId) || a.x - b.x);
  const placed = [];
  const info = new Map();
  for (const m of rooms) {
    const w = sizeOf(m).w;
    let y = 0;
    for (const o of placed) if (overlapX(m.x, w, o.x, sizeOf(o).w) > 0.01) y = Math.max(y, o.y + sizeOf(o).h);
    m.y = y;
    let level = 0, lo = Infinity, hi = -Infinity;
    for (const o of placed) {
      const os = sizeOf(o);
      if (Math.abs(o.y + os.h - y) < 0.01 && overlapX(m.x, w, o.x, os.w) > 0.01) {
        level = Math.max(level, info.get(o.id).level + 1);
        lo = Math.min(lo, Math.max(m.x, o.x));
        hi = Math.max(hi, Math.min(m.x + w, o.x + os.w));
      }
    }
    const cx = m.x + w / 2;
    info.set(m.id, { level, tips: y > 0 && (cx < lo - 0.01 || cx > hi + 0.01) });
    placed.push(m);
  }
  for (const it of layout.items) {
    if (isRoom(it) || it.parent == null) continue;
    if (!layout.items.some((m) => m.id === it.parent)) it.parent = null;
  }
  cutStairwells(layout, rooms);
  raiseLifts(layout, rooms, info);
  layout.info = info;
  return layout;
}

// Stairs take their height and depth from the room they stand in, and open
// a hole over the top half of their run, the right half unless turned, in
// its ceiling and in the floor of every room resting on it. Recomputed from
// scratch on every settle.
function cutStairwells(layout, rooms) {
  for (const m of rooms) m.cfg.stairwells = [];
  for (const it of layout.items) {
    if (isRoom(it) || !isStairs(it.cfg)) continue;
    const host = it.parent != null && rooms.find((m) => m.id === it.parent);
    if (!host) {
      const d = defaultStairs();
      Object.assign(it.cfg, { rise: d.rise, depth: d.depth });
      continue;
    }
    const b = innerBox(host.cfg);
    it.cfg.rise = b.y1 - b.y0;
    it.cfg.depth = (host.cfg.d - host.cfg.walls.back) / 2;
    const half = it.cfg.run / 2, x0 = host.x + it.x + (it.cfg.flip ? 0 : half), x1 = x0 + half;
    const z0 = host.cfg.walls.back, z1 = z0 + it.cfg.depth;
    const top = host.y + sizeOf(host).h;
    const add = (m, wall) => { const o = stairwell(m, x0, x1, z0, z1, wall); if (o) m.cfg.stairwells.push(o); };
    add(host, 'ceiling');
    for (const o of rooms) if (Math.abs(o.y - top) < 0.01 && overlapX(x0, x1 - x0, o.x, sizeOf(o).w) > 0.01) add(o, 'floor');
  }
}

// A lift's car takes its height from the room it stands in, its depth as the
// stairs do, and its walls from the shelf's thick walls. Its shaft rises
// through `floors` storeys: each room on the way gets the shaft's walls, and
// each ceiling it passes opens along with the floor above, until no room on
// top holds the whole shaft. The info records how far it got. Recomputed
// from scratch on every settle, after the stairs.
function raiseLifts(layout, rooms, info) {
  for (const m of rooms) m.cfg.shafts = [];
  for (const it of layout.items) {
    if (isRoom(it) || !isLift(it.cfg)) continue;
    const c = it.cfg;
    c.wall = layout.settings.thick;
    const host = it.parent != null && rooms.find((m) => m.id === it.parent);
    if (!host) {
      const d = defaultLift();
      Object.assign(c, { rise: d.rise, depth: d.depth });
      info.set(it.id, { reach: 0 });
      continue;
    }
    const b = innerBox(host.cfg);
    c.rise = b.y1 - b.y0;
    c.depth = (host.cfg.d - host.cfg.walls.back) / 2;
    const t = liftWall(c), x0 = host.x + it.x, x1 = x0 + sizeOf(it).w;
    const z0 = host.cfg.walls.back, z1 = z0 + c.depth;
    const holds = (m) => {
      const mb = innerBox(m.cfg);
      return x0 - m.x >= mb.x0 - 0.01 && x1 - m.x <= mb.x1 + 0.01 && m.cfg.walls.back <= z0 + 0.01 && m.cfg.d >= z1 - 0.01;
    };
    let room = host, reach = 1;
    host.cfg.shafts.push(liftShaft(host, x0, c, z0));
    while (reach < c.floors) {
      const top = room.y + sizeOf(room).h;
      const above = rooms.find((m) => Math.abs(m.y - top) < 0.01 && holds(m));
      if (!above) break;
      for (const [m, wall] of [[room, 'ceiling'], [above, 'floor']]) {
        const o = stairwell(m, x0 + t, x1 - t, z0, z1, wall);
        if (o) m.cfg.stairwells.push(o);
      }
      above.cfg.shafts.push(liftShaft(above, x0, c, z0));
      room = above;
      reach++;
    }
    info.set(it.id, { reach, top: room.y + innerBox(room.cfg).y1 });
  }
}

// Stairs and lifts are built standing, against the back wall.
const backed = (cfg) => isStairs(cfg) || isLift(cfg);

// Depth (z) of a furniture item's origin: against the back wall, or in the
// middle of the room for anything else.
function furnitureZ(host, it) {
  if (backed(it.cfg)) return host ? host.cfg.walls.back : 0;
  return host ? host.cfg.walls.back + (host.cfg.d - host.cfg.walls.back) / 2 : sizeOf(it).d / 2;
}

function overlapX(ax, aw, bx, bw) {
  return Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
}

// Magnetic x: snap to edges and centres of nearby rooms, or else to the
// grid while it is on.
function snapX(x, w, others, tol) {
  let best = gridMM() ? toGrid(x) : Math.round(x), bestD = tol;
  const consider = (c) => { const d = Math.abs(c - x); if (d < bestD) { bestD = d; best = c; } };
  consider(0);
  for (const o of others) {
    const ow = sizeOf(o).w;
    consider(o.x); consider(o.x + ow); consider(o.x - w);
    consider(o.x + ow - w); consider(o.x + ow / 2 - w / 2);
  }
  return best;
}

// The topmost room whose interior contains point (px, py).
function hostAt(layout, px, py) {
  let host = null;
  for (const m of layout.items.filter(isRoom)) {
    const s = sizeOf(m);
    if (px >= m.x && px <= m.x + s.w && py >= m.y - 4 && py <= m.y + s.h && (!host || m.y > host.y)) host = m;
  }
  return host;
}

function furnitureRange(host, it) {
  const b = innerBox(host.cfg);
  return [b.x0, Math.max(b.x0, b.x1 - sizeOf(it).w)];
}

// The grid counts from the shelf's left edge, not the room's, so things in
// different rooms line up; against a wall is always allowed.
function placeFurniture(layout, it, ax, px, py) {
  const host = hostAt(layout, px, py);
  const g = gridMM();
  if (host) {
    it.parent = host.id;
    it.x = g ? clamp(toGrid(ax) - host.x, ...furnitureRange(host, it)) : Math.round(clamp(ax - host.x, ...furnitureRange(host, it)));
  } else {
    it.parent = null;
    it.x = g ? toGrid(ax) : Math.round(ax);
  }
}

// Layout with one item moved to (ax, ay); px/py is the pointer.
function proposeMove(base, d, ax, ay, px, py, tol) {
  const layout = { items: clone(base.items), settings: base.settings };
  let it = layout.items.find((i) => i.id === d.id);
  if (!it) { it = { id: d.id, ...fromType(d.typeKey), x: 0, y: 0 }; layout.items.push(it); }
  if (isRoom(it)) {
    const others = layout.items.filter((o) => isRoom(o) && o.id !== d.id);
    it.x = snapX(ax, sizeOf(it).w, others, tol);
    it.y = Math.max(0, ay);
    settle(layout, d.id);
  } else {
    settle(layout);
    placeFurniture(layout, it, ax, px, py);
  }
  return layout;
}

// What reflow needs to know about a block from before a change.
const measure = (it) => ({ ...sizeOf(it), box: isRoom(it) ? innerBox(it.cfg) : null });

// Where a block w wide stands along a run from lo to hi, kept as the share of
// the way from flush with lo to flush with hi, so flush stays flush and
// centred stays centred. Returns where it stands on the run once resized.
// A block as wide as the run has no way to go and keeps its offset.
function along(x, w, lo, hi) {
  const free = hi - lo - w;
  if (Math.abs(free) < 0.5) return (w2, lo2) => lo2 + x - lo;
  const t = (x - lo) / free;
  return (w2, lo2, hi2) => Math.round((lo2 + t * (hi2 - lo2 - w2)) * 10) / 10;
}

// After blocks change size, each keeps its place against the others: a room
// keeps touching the room on its left, a room on the floor keeps its gap to
// the one on its left, and a room standing on others keeps its place along
// the run they make together. Furniture keeps its place along its room.
// `old` maps id -> measure() from before the change.
function reflow(layout, old) {
  applyDefaults(layout);
  const rooms = layout.items.filter(isRoom).sort((a, b) => a.y - b.y || a.x - b.x);
  const was = (it) => old.get(it.id) || measure(it);
  const right = (o) => o.x + was(o).w;
  const span = (under, w) => [Math.min(...under.map((o) => o.x)), Math.max(...under.map((o) => o.x + w(o)))];
  const anchors = new Map();
  for (const m of rooms) {
    let left = null;
    for (const o of rooms) if (o !== m && Math.abs(o.y - m.y) < 0.01 && right(o) < m.x + 0.5 && (!left || right(o) > right(left))) left = o;
    if (left && (m.y < 0.01 || Math.abs(right(left) - m.x) < 0.5)) { anchors.set(m.id, { left, gap: m.x - right(left) }); continue; }
    const under = rooms.filter((o) => Math.abs(o.y + was(o).h - m.y) < 0.01 && overlapX(m.x, was(m).w, o.x, was(o).w) > 0.01);
    if (under.length) anchors.set(m.id, { under, place: along(m.x, was(m).w, ...span(under, (o) => was(o).w)) });
  }
  for (const m of rooms) {
    const a = anchors.get(m.id);
    if (a?.left) m.x = a.left.x + sizeOf(a.left).w + a.gap;
    else if (a) m.x = a.place(sizeOf(m).w, ...span(a.under, (o) => sizeOf(o).w));
  }
  for (const it of layout.items) {
    if (isRoom(it) || it.parent == null) continue;
    const host = layout.items.find((m) => m.id === it.parent);
    if (!host) continue;
    const ob = old.get(host.id)?.box, b = innerBox(host.cfg);
    if (ob) it.x = along(it.x, was(it).w, ob.x0, ob.x1)(sizeOf(it).w, b.x0, b.x1);
    it.x = clamp(it.x, ...furnitureRange(host, it));
  }
  return settle(layout);
}

// ------------------------------------------------------------------ geometry caches

const cfgKey = (kind, cfg) => kind + JSON.stringify(cfg);
const cache = { manifolds: new Map(), geometries: new Map(), profiles: new Map(), stats: new Map() };

function manifoldFor(kind, cfg) {
  const key = cfgKey(kind, cfg);
  if (!cache.manifolds.has(key)) cache.manifolds.set(key, buildBlock(k, kind, cfg));
  return cache.manifolds.get(key);
}

function geometryFor(kind, cfg) {
  const key = cfgKey(kind, cfg);
  if (!cache.geometries.has(key)) {
    const { positions, indices } = meshArrays(manifoldFor(kind, cfg));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    const flat = g.toNonIndexed();
    flat.computeVertexNormals();
    g.dispose();
    cache.geometries.set(key, flat);
  }
  return cache.geometries.get(key);
}

function profileFor(kind, cfg) {
  const key = cfgKey(kind, cfg);
  if (!cache.profiles.has(key)) cache.profiles.set(key, frontProfile(k, kind, cfg));
  return cache.profiles.get(key);
}

function statsFor(kind, cfg) {
  const key = cfgKey(kind, cfg);
  if (!cache.stats.has(key)) {
    const m = manifoldFor(kind, cfg);
    const bb = m.boundingBox();
    cache.stats.set(key, { size: bb.max.map((v, i) => v - bb.min[i]), grams: (m.volume() / 1000) * PLA_DENSITY });
  }
  return cache.stats.get(key);
}

// Drop cached geometry no block uses any more (live editing creates lots).
function pruneCache() {
  if (cache.manifolds.size + cache.profiles.size < 120) return;
  const keep = new Set([
    ...state.items.map((i) => cfgKey(i.kind, i.cfg)),
    ...(drag?.preview?.items || []).map((i) => cfgKey(i.kind, i.cfg)),
    ...Object.values(PRESETS).map((t) => cfgKey(t.kind, t.cfg)),
    ...customTypes.map((t) => cfgKey(t.kind, t.cfg)),
  ]);
  for (const [key, m] of cache.manifolds) if (!keep.has(key)) { m.delete(); cache.manifolds.delete(key); }
  for (const [key, g] of cache.geometries) if (!keep.has(key)) { g.dispose(); cache.geometries.delete(key); }
  for (const key of cache.profiles.keys()) if (!keep.has(key)) cache.profiles.delete(key);
  for (const key of cache.stats.keys()) if (!keep.has(key)) cache.stats.delete(key);
}

// ------------------------------------------------------------------ palette

function polyPath(polys, ox, oy) {
  return polys.map((poly) => 'M' + poly.map(([x, y]) => `${(ox + x).toFixed(2)},${(-(oy + y)).toFixed(2)}`).join('L') + 'Z').join('');
}

// `frame` ({ w, h }) draws blocks at one scale, standing on the same line, so
// a narrow room looks narrower than a wide one; without it a block fills its box.
function thumb(kind, cfg, frame = null) {
  const { w, h } = blockSize(kind, cfg);
  const prof = profileFor(kind, cfg);
  const pad = 4;
  const marks = prof.marks.map(([x0, y0, x1, y1]) => `<rect x="${x0}" y="${-y1}" width="${x1 - x0}" height="${y1 - y0}" fill="var(--sh-mark)"/>`).join('');
  const box = frame
    ? `${(w - frame.w) / 2 - pad} ${-frame.h - pad} ${frame.w + 2 * pad} ${frame.h + 2 * pad}`
    : `${-pad} ${-h - pad} ${w + 2 * pad} ${h + 2 * pad}`;
  const shaft = prof.shaft ? `<path d="${polyPath(prof.shaft, 0, 0)}" fill="var(--sh-mark)"/>` : '';
  return `<svg viewBox="${box}" aria-hidden="true">${shaft}
    <path d="${polyPath(prof.room, 0, 0)}" fill="${shade(cfg.color, -0.18)}" fill-rule="evenodd"/>
    <path d="${polyPath(prof.shell, 0, 0)}" fill="${cfg.color}" fill-rule="evenodd"/>${marks}</svg>`;
}

function renderPalette() {
  const ul = $('palette');
  ul.replaceChildren();
  const entries = [
    ...Object.entries(PRESETS).map(([key, t]) => ({ key, ...t, custom: false })),
    ...customTypes.map((t) => ({ ...t, custom: true })),
  ];
  for (const t of entries) {
    if (t.kind === 'room') t.cfg = resolveSize({ size: t.size, own: { ...t.own }, walls: { ...(t.walls || ALL_THICK) }, cfg: clone(t.cfg) }, state.settings).cfg;
  }
  // Rooms share one scale and furniture another, so each kind compares at a glance.
  const frameOf = (kind) => {
    const sizes = entries.filter((t) => t.kind === kind).map((t) => blockSize(t.kind, t.cfg));
    return { w: Math.max(...sizes.map((z) => z.w)), h: Math.max(...sizes.map((z) => z.h)) };
  };
  const frames = { room: frameOf('room'), furniture: frameOf('furniture') };
  for (const t of entries) {
    const { w, h } = blockSize(t.kind, t.cfg);
    const li = document.createElement('li');
        const btn = document.createElement('button');
    btn.className = 'sh-card';
    btn.type = 'button';
    // Pictures only: the name and size are in the tooltip.
    btn.innerHTML = thumb(t.kind, t.cfg, frames[t.kind]);
    btn.title = `${t.name}, ${t.kind === 'room' ? `${fmtLen(w)} × ${fmtLen(h)} ${unitName()}` : 'sits inside a room'}. Drag it onto the front view, or click to add it.`;
    btn.setAttribute('aria-label', `Add ${t.name}`);
    btn.addEventListener('pointerdown', (e) => startPaletteDrag(e, t.key));
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addBlock(t.key); } });
    li.append(btn);
    if (t.custom) {
      const del = document.createElement('button');
      del.className = 'sh-remove';
      del.type = 'button';
      del.textContent = '×';
      del.title = `Remove “${t.name}” from the palette (placed blocks stay)`;
      del.onclick = () => { customTypes = customTypes.filter((c) => c.key !== t.key); saveTypes(); renderPalette(); };
      li.append(del);
    }
    ul.append(li);
  }
}

// The row of blocks over the front view folds away; the page remembers which.
const BLOCKS_KEY = 'shelf-house-blocks';
function showBlocks(open) {
  $('palette').hidden = !open;
  $('blocks-toggle').setAttribute('aria-expanded', open);
}
try { showBlocks(localStorage.getItem(BLOCKS_KEY) !== 'hidden'); } catch { showBlocks(true); }
$('blocks-toggle').onclick = () => {
  const open = $('palette').hidden;
  showBlocks(open);
  try { localStorage.setItem(BLOCKS_KEY, open ? 'shown' : 'hidden'); } catch { /* ignore */ }
};

function addBlock(typeKey) {
  const layout = layoutCopy();
  const id = nextId();
  const block = { id, ...fromType(typeKey) };
  if (block.kind === 'room') {
    const ground = layout.items.filter((i) => isRoom(i) && i.y === 0);
    block.x = ground.length ? Math.max(...ground.map((g) => g.x + sizeOf(g).w)) : 0;
    block.y = 0;
    layout.items.push(block);
    settle(layout, id);
  } else {
    const sel = layout.items.find((i) => i.id === selectedId && isRoom(i));
    const host = sel || layout.items.filter(isRoom).sort((a, b) => b.y - a.y)[0];
    if (host) {
      const [lo, hi] = furnitureRange(host, block);
      Object.assign(block, { parent: host.id, x: Math.round((lo + hi) / 2) });
    } else Object.assign(block, { parent: null, x: 0 });
    layout.items.push(block);
  }
  selectedId = id;
  commit(layout);
}

// ------------------------------------------------------------------ 2D mat

const mat = $('mat');
let viewBox = null;

function fitViewBox(layout) {
  let minX = 0, maxX = 360, maxY = 220, topH = 72;
  for (const it of layout.items) {
    const a = absPos(layout, it);
    const s = sizeOf(it);
    minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x + s.w); maxY = Math.max(maxY, a.y + s.h);
    if (isRoom(it)) topH = Math.max(topH, s.h);
  }
  const m = 40;
  return { x: minX - m, y: -(maxY + m + topH * 0.6), w: maxX - minX + 2 * m, h: maxY + 2 * m + topH * 0.6 };
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [a, v] of Object.entries(attrs)) el.setAttribute(a, v);
  return el;
}

// Pixels kept clear under the ground line, where a ground-floor room's floor
// and back-wall panels dock. Reserved whether or not anything is selected, so
// picking a room never rescales the view.
const UNDER_GROUND_PX = 84;

function padForPanels(vb) {
  const W = mat.clientWidth, H = mat.clientHeight;
  if (!W || !H) return vb;
  const below = vb.y + vb.h; // mm under the ground line already in view
  let h = vb.h;
  for (let i = 0; i < 3; i++) {
    const scale = Math.min(W / vb.w, H / h);
    h = vb.h + Math.max(0, UNDER_GROUND_PX / scale - below);
  }
  return { ...vb, h };
}

function renderMat(layout) {
  if (!drag || !drag.moved) viewBox = padForPanels(fitViewBox(layout));
  const vb = viewBox;
  mat.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  mat.setAttribute('preserveAspectRatio', 'xMidYMax meet');
  mat.replaceChildren();

  // A 10/50 mm grid, or quarter inches under whole ones; the ruler counts
  // every 50 mm or every 2 in.
  const [minor, major, every] = inches() ? [MM_PER_IN / 4, MM_PER_IN, MM_PER_IN * 2] : [10, 50, 50];
  const defs = svgEl('defs');
  defs.innerHTML = `
    <pattern id="g10" width="${minor}" height="${minor}" patternUnits="userSpaceOnUse"><path d="M${minor} 0H0V${minor}" fill="none" stroke="var(--mat-minor)" stroke-width="0.5"/></pattern>
    <pattern id="g50" width="${major}" height="${major}" patternUnits="userSpaceOnUse"><rect width="${major}" height="${major}" fill="url(#g10)"/><path d="M${major} 0H0V${major}" fill="none" stroke="var(--mat-major)" stroke-width="0.8"/></pattern>`;
  mat.append(defs);
  const big = { x: vb.x - 2000, y: vb.y - 2000, width: vb.w + 4000, height: vb.h + 4000 };
  mat.append(svgEl('rect', { ...big, fill: 'var(--mat)' }));
  mat.append(svgEl('rect', { ...big, fill: 'url(#g50)' }));
  mat.append(svgEl('line', { x1: vb.x - 2000, x2: vb.x + vb.w + 2000, y1: 0, y2: 0, class: 'ground' }));
  for (let i = Math.ceil((vb.x - 400) / every); i * every < vb.x + vb.w + 400; i++) {
    const t = svgEl('text', { x: i * every, y: 14, class: 'ruler', 'text-anchor': 'middle' });
    t.textContent = Math.round(toUnit(i * every));
    mat.append(t);
  }

  const order = [...layout.items].sort((a, b) => isRoom(b) - isRoom(a));
  for (const it of order) {
    const a = absPos(layout, it);
    const prof = profileFor(it.kind, it.cfg);
    const color = it.cfg.color;
    const g = svgEl('g', { class: 'block', 'data-id': it.id });
    if (drag && drag.moved && drag.id === it.id) {
      g.classList.add('dragging');
      g.append(svgEl('path', { d: polyPath(prof.shell, a.x + 2.5, a.y - 2.5) + polyPath(prof.room, a.x + 2.5, a.y - 2.5), class: 'shadow' }));
    }
    if (prof.room.length) g.append(svgEl('path', { d: polyPath(prof.room, a.x, a.y), fill: shade(color, -0.18), 'fill-rule': 'evenodd' }));
    if (prof.holes.length) g.append(svgEl('path', { d: polyPath(prof.holes, a.x, a.y), fill: 'var(--sh-hole)' }));
    g.append(svgEl('path', { d: polyPath(prof.shell, a.x, a.y), fill: color, 'fill-rule': 'evenodd', stroke: shade(color, -0.35), 'stroke-width': 0.6 }));
    for (const [x0, y0, x1, y1] of prof.marks) {
      g.append(svgEl('rect', { x: a.x + x0, y: -(a.y + y1), width: x1 - x0, height: y1 - y0, class: 'mark' }));
    }
    mat.append(g);
  }

  for (const it of layout.items) {
    const a = absPos(layout, it);
    const s = sizeOf(it);
    if (layout.info?.get(it.id)?.tips) {
      mat.append(svgEl('rect', { x: a.x - 1.5, y: -(a.y + s.h + 1.5), width: s.w + 3, height: s.h + 3, rx: 4, class: 'warn' }));
      mat.append(svgEl('rect', { x: a.x + s.w / 2 - 15, y: -(a.y + s.h + 9), width: 30, height: 12, rx: 6, class: 'warn-tag' }));
      const t = svgEl('text', { x: a.x + s.w / 2, y: -(a.y + s.h + 0.5), 'text-anchor': 'middle', class: 'warn-label' });
      t.textContent = 'tips';
      mat.append(t);
    }
    if (it.id === selectedId) {
      mat.append(svgEl('rect', { x: a.x - 3.5, y: -(a.y + s.h + 3.5), width: s.w + 7, height: s.h + 7, rx: 5, class: 'sel' }));
    }
  }
  $('empty').hidden = layout.items.length > 0;
}

function shade(hex, amt) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  const f = (c) => Math.round(clamp(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt, 0, 255));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function toWorld(e) {
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mat.getScreenCTM().inverse());
  return { x: pt.x, y: -pt.y };
}
function mmPerPx() {
  const ctm = mat.getScreenCTM();
  return ctm ? 1 / ctm.a : 1;
}
function overMat(e) {
  const r = mat.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

function select(id) {
  if (selectedId === id) return;
  endEdit();
  selectedId = id;
  jigPick = null;
  renderInspector();
}

mat.addEventListener('pointerdown', (e) => {
  const g = e.target.closest('.block');
  if (!g) { select(null); render(); return; }
  const id = Number(g.dataset.id);
  const it = state.items.find((i) => i.id === id);
  const a = absPos(state, it);
  const w = toWorld(e);
  // A press on one of a room's openings picks it and may drag it; a press
  // anywhere else on the room drops the pick and may drag the room.
  const hit = isRoom(it) ? openingAt(it, a, w) : -1;
  select(id);
  if (hit >= 0) {
    jigPick = { id, i: hit };
    startOpeningDrag(it, hit, w);
    e.preventDefault();
    render();
    return;
  }
  jigPick = null;
  drag = { id, grabX: w.x - a.x, grabY: w.y - a.y, sx: e.clientX, sy: e.clientY, moved: false, preview: null };
  e.preventDefault();
  render();
});

function startPaletteDrag(e, typeKey) {
  if (e.button !== 0) return;
  const t = typeDef(typeKey);
  const s = blockSize(t.kind, t.cfg);
  drag = { id: nextId(), typeKey, isNew: true, grabX: s.w / 2, grabY: s.h / 2, sx: e.clientX, sy: e.clientY, moved: false, preview: null };
  e.preventDefault();
}

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  drag.moved = true;
  document.body.style.cursor = 'grabbing';
  if (drag.isNew && !overMat(e)) { drag.preview = null; render(); return; }
  const w = toWorld(e);
  drag.preview = proposeMove(state, drag, w.x - drag.grabX, w.y - drag.grabY, w.x, w.y, 10 * mmPerPx());
  render();
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.style.cursor = '';
  if (d.isNew && !d.moved) { addBlock(d.typeKey); return; }
  if (d.moved && d.preview) {
    selectedId = d.id;
    commit({ items: d.preview.items });
    return;
  }
  render();
});
window.addEventListener('pointercancel', () => { drag = null; document.body.style.cursor = ''; render(); });

// ------------------------------------------------------------------ editing on the mat

function removeSelected() {
  if (selectedId == null) return;
  const items = state.items.filter((i) => i.id !== selectedId && i.parent !== selectedId);
  selectedId = null;
  commit({ items: clone(items) });
}

function duplicateSelected() {
  const it = selected();
  if (!it) return;
  const layout = layoutCopy();
  const id = nextId();
  if (isRoom(it)) {
    layout.items.push({ ...clone(it), id, y: 1e6 });
    settle(layout, id);
  } else {
    layout.items.push({ ...clone(it), id, x: gridMM() ? it.x + gridMM() : it.x + 4 });
  }
  selectedId = id;
  commit(layout);
}

// Where a nudge `dir` (±1) takes x: a millimetre, or with `big` the big step.
// With the grid on it goes to the next grid line that way, or as many lines
// as make up the big step.
const bigLines = () => Math.max(1, Math.round(bigStep() / gridMM()));
const bigMove = () => (gridMM() ? bigLines() * gridMM() : bigStep());

function nudged(x, dir, big) {
  const g = gridMM();
  if (!g) return x + dir * (big ? bigStep() : 1);
  const n = big ? bigLines() : 1, at = x / g;
  return toGrid((dir > 0 ? Math.floor(at + 1e-6) + n : Math.ceil(at - 1e-6) - n) * g);
}

// Arrow keys slide a block sideways, stopping against neighbours on its floor.
function nudge(dir, big = false) {
  if (!selected()) return;
  const layout = layoutCopy();
  const m = layout.items.find((i) => i.id === selectedId);
  if (isRoom(m)) {
    const w = sizeOf(m).w;
    let x = nudged(m.x, dir, big);
    for (const o of layout.items) {
      if (o === m || !isRoom(o)) continue;
      const vertical = Math.min(m.y + sizeOf(m).h, o.y + sizeOf(o).h) - Math.max(m.y, o.y);
      if (vertical <= 0.01) continue;
      const ow = sizeOf(o).w;
      if (overlapX(x, w, o.x, ow) > 0.01) x = dir > 0 ? Math.min(x, o.x - w) : Math.max(x, o.x + ow);
    }
    m.x = x;
    settle(layout, m.id);
  } else {
    const host = layout.items.find((h) => h.id === m.parent);
    m.x = host ? clamp(nudged(host.x + m.x, dir, big) - host.x, ...furnitureRange(host, m)) : nudged(m.x, dir, big);
  }
  commit(layout, { inspector: false });
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (selectedId == null || mod) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1, e.shiftKey); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1, e.shiftKey); }
  else if (e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
  else if (e.key === 'Escape') {
    if (jigPick) jigPick = null;
    else select(null);
    render();
  }
});

// The live part of the block line: where the selected block stands, or what
// to do when nothing is selected. Redrawn with the front view, so it follows
// a drag; the rest of the line is built with the inspector.
function renderSelection(layout) {
  const box = $('selection');
  if (!box) return;
  const it = layout.items.find((i) => i.id === selectedId);
  if (!it) {
    const tips = [...(layout.info?.values() || [])].filter((v) => v.tips).length;
    box.innerHTML = tips
      ? `<span class="sh-warn">${tips === 1 ? 'One room overhangs' : `${tips} rooms overhang`} the room below. Move it back over its support or glue it.</span>`
      : 'Click a block to tune it. Arrow keys move it, Delete removes it, D duplicates it.';
    return;
  }
  const a = absPos(layout, it);
  const info = layout.info?.get(it.id);
  const where = isRoom(it) ? `x ${len(a.x)}, floor ${(info?.level ?? 0) + 1}` : it.parent != null ? 'inside a room' : 'on the ground';
  box.innerHTML = `${where}${info?.tips ? ', <span class="sh-warn">overhangs and will tip</span>' : ''}${isLift(it.cfg) && info?.reach ? liftReach(it.cfg, info.reach) : ''}`;
}

// How far a lift's shaft got, and why it stopped short.
function liftReach(c, reach) {
  if (reach >= c.floors) return `, serving ${reach} floors`;
  return `, <span class="sh-warn">serving ${reach} of ${c.floors} floors: no room above holds the shaft</span>`;
}

// ------------------------------------------------------------------ block line

// Under the front view, the selected block's line: its colour and name, a
// room's three sizes, where it stands, moving it, and what can be done with
// it. Sizes a room has set itself carry a ↺ back to the shelf's.
const bar = $('block-bar');
const DIM_NAME = { w: 'Width', h: 'Height', d: 'Depth' };

function dimField(it, dim) {
  const own = it.own?.[dim];
  const name = dim === 'w' ? `Width (${it.size})` : DIM_NAME[dim];
  return `<span class="sh-dim" data-dim="${dim}" title="${name}: ${own ? 'set for this room' : 'follows the shelf settings'}">
    <label for="sh-cfg-${dim}">${dim.toUpperCase()}</label>${numInput(`cfg.${dim}`, it.cfg[dim], {
      min: 10, id: `sh-cfg-${dim}`, extra: ` aria-label="${name}"`,
      after: own ? resetChip('size-default', `data-dim="${dim}"`, name, defaultFor(it, dim)) : '',
    })}</span>`;
}

function renderBlockBar() {
  const it = selected();
  const focusId = bar.contains(document.activeElement) ? document.activeElement.id : null;
  if (!it) {
    bar.innerHTML = '<span id="selection" class="sh-where" aria-live="polite"></span>';
  } else {
    const same = state.items.filter((o) => o.id !== it.id && o.kind === it.kind && o.name === it.name).length;
    const base = typeDef(it.base);
    const step = bigMove();
    bar.innerHTML = `
      <span class="sh-ident">
        <input id="sh-color" type="color" data-path="cfg.color" value="${it.cfg.color}" aria-label="Colour" title="Colour">
        <span class="sh-ident-text">
          <input id="sh-name" type="text" data-path="name" value="${esc(it.name)}" maxlength="40" aria-label="Name" title="Name: type to rename it">
          <span id="selection" class="sh-where" aria-live="polite"></span>
        </span>
      </span>
      ${isRoom(it) ? `<span class="sh-dims">${['w', 'h', 'd'].map((d) => dimField(it, d)).join('')}</span>` : ''}
      <span class="chips sh-move">
        <button type="button" class="chip" data-act="nudge" data-v="-1" title="Move left ${len(step)} (Shift+←)" aria-label="Move left ${len(step)}">◀</button>
        <button type="button" class="chip" data-act="nudge" data-v="1" title="Move right ${len(step)} (Shift+→)" aria-label="Move right ${len(step)}">▶</button>
      </span>
      <span class="chips">
        <button type="button" class="chip" data-act="duplicate" title="Stack a copy on top (D)">duplicate</button>
        <button type="button" class="chip" data-act="delete" title="Delete (Del)">delete</button>
        <button type="button" class="chip" data-act="download" title="Download this block's STL">stl</button>
        <details class="sh-more">
          <summary class="chip" title="More" aria-label="More actions">⋯</summary>
          <div class="sh-menu">
            <button type="button" data-act="save-type">Save as block type</button>
            ${same ? `<button type="button" data-act="apply-same">Copy settings to ${same} other “${esc(it.name)}” block${same > 1 ? 's' : ''}</button>` : ''}
            ${base ? `<button type="button" data-act="reset">Reset to “${esc(base.name)}”</button>` : ''}
          </div>
        </details>
      </span>`;
  }
  if (focusId) $(focusId)?.focus();
  renderSelection(currentView());
}

// The ⋯ menu closes on a choice, a click elsewhere, or Escape.
const closeMenus = (except = null) => { for (const d of bar.querySelectorAll('.sh-more[open]')) if (d !== except) d.open = false; };
document.addEventListener('click', (e) => closeMenus(e.target.closest?.('.sh-more')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

// A size field in the line lights the dimension it sets on the front view.
const dimOf = (e) => { const d = e.target.closest?.('.sh-dim'); return d ? `dim-${d.dataset.dim}` : null; };
bar.addEventListener('pointerover', (e) => { if (dimOf(e) || jigHot?.startsWith('dim-')) setJigHot(dimOf(e)); });
bar.addEventListener('pointerleave', () => { if (jigHot?.startsWith('dim-') && !bar.querySelector('.sh-dim:focus-within')) setJigHot(null); });
bar.addEventListener('focusin', (e) => setJigHot(dimOf(e)));
bar.addEventListener('focusout', (e) => { if (!e.relatedTarget?.closest?.('.sh-dim') && jigHot?.startsWith('dim-')) setJigHot(null); });

// ------------------------------------------------------------------ inspector


const WALL_LABEL = { back: 'Back wall', left: 'Left wall', right: 'Right wall', ceiling: 'Ceiling', floor: 'Floor' };
const SHAPE_LABEL = { rect: 'Rectangle', arch: 'Arch', round: 'Round' };
const CORNER_LABEL = { tl: 'top left', tr: 'top right', br: 'bottom right', bl: 'bottom left' };

// One control per row, in the rail's label/value column. Lengths carry the
// ruler ticks and show in the page's units; counts do not. `fine` lengths
// (walls, bars, radii) step by a hundredth of an inch rather than five.
function num(label, path, value, opts = {}) {
  const { hint = '', unit = 'mm' } = opts;
  const id = 'sh-' + path.replace(/\./g, '-');
  return `<div class="field${unit === 'mm' ? ' field-measure' : ''}"><label for="${id}"${hint ? ` title="${esc(hint)}"` : ''}>${label}</label>
    <span class="field-value">${numInput(path, value, { ...opts, id })}</span></div>`;
}

// The input and its unit, for a field or for a panel on the front view.
function numInput(path, value, { min = 0, max = 500, step = 0.5, hint = '', unit = 'mm', fine = false, after = '', id = '', extra = '' } = {}) {
  const measure = unit === 'mm';
  const attrs = measure && inches()
    ? { value: fmtLen(value), min: Math.round(toUnit(min) * 100) / 100, max: Math.round(toUnit(max) * 100) / 100, step: fine ? 0.01 : 0.05 }
    : { value: fmt(value), min, max, step };
  // With the grid on, every length but the fine ones steps by it, from a
  // minimum on a grid line so that the steps land on lines too.
  const g = measure && !fine ? gridStep() : 0;
  if (g) Object.assign(attrs, { step: g, min: Math.round(Math.ceil(attrs.min / g - 1e-9) * g * 1e6) / 1e6 });
  return `<input${id ? ` id="${id}"` : ''} type="number" data-path="${path}"${measure ? ' data-measure' : ''} value="${attrs.value}" min="${attrs.min}" max="${attrs.max}" step="${attrs.step}"${hint ? ` title="${esc(hint)}"` : ''}${extra}>${unit ? `<span class="unit">${measure ? unitName() : unit}</span>` : ''}${after}`;
}

// The ↺ beside a size that no longer follows its default.
const RESET_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6a3.5 3.5 0 1 0 1.1-2.55" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2 1.6v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const resetChip = (act, attrs, what, to) =>
  `<button type="button" class="sh-reset" data-act="${act}" ${attrs} title="Back to the default, ${len(to)}" aria-label="${what} back to the default, ${len(to)}">${RESET_ICON}</button>`;

function pick(label, path, options, value, labels) {
  const id = 'sh-' + path.replace(/\./g, '-');
  return `<div class="field"><label for="${id}">${label}</label>
    <span class="field-value"><select id="${id}" data-path="${path}">${options.map((v) => `<option value="${v}"${v === value ? ' selected' : ''}>${labels[v]}</option>`).join('')}</select></span></div>`;
}


// Every opening is placed from the middle of its wall.
function positionLabels(wall) {
  if (wall === 'left' || wall === 'right') return ['Along depth', 'Up from centre', 'From the middle of the wall; positive moves it toward the front'];
  if (wall === 'ceiling' || wall === 'floor') return ['Across', 'Along depth', 'From the middle; positive moves it toward the front'];
  return ['Across', 'Up from centre', 'From the middle of the wall; positive moves it right'];
}
const ANCHORS = ['centre', 'floor'];
const ANCHOR_LABEL = { centre: 'Centre of the wall', floor: 'Floor (doorway)' };

// The picked opening's fields, compact enough to sit beside a room on the
// front view: shape and anchor as pictures, the numbers in two columns.
const ANCHOR_GLYPH = {
  centre: '<rect x="4.5" y="4.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.2"/>',
  floor: '<rect x="4.5" y="3" width="7" height="10" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1 13.6h14" stroke="currentColor" stroke-width="1.6"/>',
};

function openingHTML(o, i) {
  const [xl, yl, xh] = positionLabels(o.wall);
  const p = `cfg.openings.${i}`;
  const onWall = !(o.wall === 'ceiling' || o.wall === 'floor');
  const count = { unit: '', step: 1, min: 1, max: 12 };
  const mini = (short, name, key, opts = {}) => `<span class="sh-mini" title="${esc(opts.hint ? `${name}: ${opts.hint}` : name)}">
      <label for="sh-op-${key}">${short}</label>${numInput(`${p}.${key}`, o[key], { ...opts, id: `sh-op-${key}`, extra: ` aria-label="${name}"` })}</span>`;
  const seg = (key, values, labels, glyphs) => `<span class="sh-op-seg" role="group" aria-label="${key === 'shape' ? 'Shape' : 'Sits on'}">${values.map((v) =>
    `<button type="button" class="sh-jig-btn${o[key] === v ? ' is-on' : ''}" data-jig="set" data-path="${p}.${key}" data-v="${v}"
      aria-pressed="${o[key] === v}" title="${labels[v]}" aria-label="${labels[v]}">${glyphs(v)}</button>`).join('')}</span>`;
  return `<div class="sh-opening">
    <div class="sh-opening-head"><span>Opening ${i + 1}</span>
      <select id="sh-op-wall" data-path="${p}.wall" aria-label="Wall" title="Wall">${WALLS.map((w) =>
        `<option value="${w}"${w === o.wall ? ' selected' : ''}>${WALL_LABEL[w]}</option>`).join('')}</select>
      <button type="button" class="chip" data-jig="unpick" title="Close (Esc)" aria-label="Close">×</button></div>
    <div class="sh-op-row">
      ${seg('shape', SHAPES, SHAPE_LABEL, shapeGlyph)}
      ${onWall ? seg('anchor', ANCHORS, ANCHOR_LABEL, (v) => glyph(ANCHOR_GLYPH[v])) : ''}
    </div>
    <div class="sh-op-grid">
      ${mini(xl === 'Along depth' ? 'Depth' : 'Across', xl, 'x', { min: -500, hint: xh })}
      ${onWall && o.anchor === 'floor' ? '<span></span>' : mini('Up', yl, 'y', { min: -500, hint: onWall ? 'from the middle of the wall; positive moves it up' : '' })}
      ${mini('W', 'Width', 'w', { min: 1 })}
      ${mini('H', 'Height', 'h', { min: 1 })}
      <span class="sh-mini" title="Panes across × panes up"><label for="sh-op-cols">Panes</label>${numInput(`${p}.cols`, o.cols, { ...count, unit: '', id: 'sh-op-cols', extra: ' aria-label="Panes across"' })}<span class="unit">×</span>${numInput(`${p}.rows`, o.rows, { ...count, unit: '', id: 'sh-op-rows', extra: ' aria-label="Panes up"' })}</span>
      ${(o.cols > 1 || o.rows > 1) ? mini('Bar', 'Bar width', 'bar', { max: 20, fine: true }) : '<span></span>'}
      ${mini('Copies', 'Copies', 'count', count)}
      ${o.count > 1 ? mini('Gap', 'Spacing, centre to centre', 'pitch', { min: 1 }) : '<span></span>'}
      ${o.shape === 'rect' ? mini('R', 'Corner radius', 'r', { max: 100, fine: true }) : ''}
    </div>
    <div class="chips sh-op-actions">
      <button type="button" class="chip" data-act="dup-opening" data-i="${i}" title="Add a copy of this opening beside it">copy</button>
      <button type="button" class="chip" data-act="del-opening" data-i="${i}" title="Remove this opening">remove</button>
    </div>
  </div>`;
}

// Everything about the selected block is on or under the front view; this
// rebuilds the part that is not redrawn with it.
function renderInspector() {
  renderBlockBar();
}

// Inputs edit the selected block live; each field edit is one undo step.
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const key of keys.slice(0, -1)) o = o[key];
  o[keys.at(-1)] = value;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, key) => o?.[key], obj);
}

function readInput(el) {
  if (el.type === 'number') {
    if (el.value === '') return undefined;
    let v = Number(el.value);
    if (!Number.isFinite(v)) return undefined;
    v = clamp(v, Number(el.min), Number(el.max));
    if (el.step === '1') v = Math.round(v);
    return 'measure' in el.dataset ? fromUnit(v) : v;
  }
  return el.value;
}

const shown = (el, v) => ('measure' in el.dataset ? fmtLen(v) : fmt(v));

function liveEdit(path, value) {
  const it = selected();
  if (!it || value === undefined) return;
  if (!editSnapshot) editSnapshot = snap(state);
  const old = new Map(state.items.map((i) => [i.id, measure(i)]));
  const before = getPath(it, path);
  setPath(it, path, value);
  // A size typed into a room is its own from now on.
  const dim = path.match(/^cfg\.([whd])$/);
  if (dim && isRoom(it)) it.own = { ...it.own, [dim[1]]: true };
  // Moving an opening between a wall and the ceiling/floor, or onto the floor
  // as a doorway, changes what its y offset means: start it from the middle.
  const m = path.match(/^cfg\.openings\.(\d+)\.(wall|anchor)$/);
  if (m) {
    const o = it.cfg.openings[Number(m[1])];
    const flat = (w) => w === 'ceiling' || w === 'floor';
    if (m[2] === 'anchor' || flat(value) !== flat(before)) o.y = 0;
  }
  reflow(state, old);
  persist();
  render();
}

function endEdit() {
  if (!editSnapshot) return;
  pushUndo(editSnapshot);
  editSnapshot = null;
  updateHistoryButtons();
}

// The rail and the block line edit the selected block the same way.
function onFieldInput(e) {
  const el = e.target.closest('[data-path]');
  if (!el || el.tagName === 'SELECT') return;
  // Typed numbers wait for Enter/blur (half-typed values would reshuffle the
  // shelf); spinner arrows and the colour picker update live.
  if (el.type === 'number' && e.inputType) return;
  liveEdit(el.dataset.path, readInput(el));
}

function onFieldChange(e) {
  const el = e.target.closest('[data-path]');
  if (!el) return;
  if (el.type === 'number') {
    const v = readInput(el);
    if (v !== undefined) liveEdit(el.dataset.path, v);
    el.value = shown(el, getPath(selected(), el.dataset.path));
  } else liveEdit(el.dataset.path, el.value);
  endEdit();
  // Some fields show or hide others (shape, panes, copies, wall, anchor), and
  // a typed room size gains its ↺.
  if (/\.(shape|wall|anchor|cols|rows|count)$/.test(el.dataset.path) || /^(name|cfg\.[whd])$/.test(el.dataset.path)) renderInspector();
}

function onAct(e) {
  const b = e.target.closest('[data-act]');
  const it = selected();
  if (!b || !it) return;
  const act = b.dataset.act;
  closeMenus();
  if (act === 'download') { downloadItem(it); return; }
  if (act === 'save-type') { saveAsType(it); return; }
  if (act === 'duplicate') { duplicateSelected(); return; }
  if (act === 'delete') { removeSelected(); return; }
  if (act === 'nudge') { nudge(Number(b.dataset.v), true); return; }

  const layout = layoutCopy();
  const m = layout.items.find((i) => i.id === it.id);
  const old = new Map(state.items.map((i) => [i.id, measure(i)]));
  const c = m.cfg;
  const i = Number(b.dataset.i);
  if (act === 'size-default') delete m.own[b.dataset.dim];
  else if (act === 'add-opening') c.openings.push(OPENING_PRESETS[b.dataset.preset]());
  else if (act === 'del-opening') {
    c.openings.splice(i, 1);
    jigPick = null;
  } else if (act === 'dup-opening') {
    const o = clone(c.openings[i]);
    o.x += Math.min(o.w + 6, 40);
    c.openings.splice(i + 1, 0, o);
    jigPick = { id: m.id, i: i + 1 };
  } else if (act === 'reset') {
    const t = typeDef(m.base);
    if (!t) return;
    m.cfg = clone(t.cfg);
    m.name = t.name;
    if (isRoom(m)) Object.assign(m, { size: t.size || m.size, own: clone(t.own || {}), walls: clone(t.walls || ALL_THICK) });
  } else if (act === 'apply-same') {
    for (const o of layout.items) {
      if (o.kind !== m.kind || o.name !== m.name) continue;
      o.cfg = clone(m.cfg);
      if (isRoom(m)) Object.assign(o, { size: m.size, own: clone(m.own), walls: clone(m.walls) });
    }
  } else return;
  reflow(layout, old);
  commit(layout);
}

bar.addEventListener('input', onFieldInput);
bar.addEventListener('change', onFieldChange);
bar.addEventListener('click', onAct);

function saveAsType(it) {
  let name = it.name;
  const taken = (n) => Object.values(PRESETS).some((p) => p.name === n) || customTypes.some((t) => t.name === n);
  if (taken(name)) {
    let i = 2;
    while (taken(`${it.name} ${i}`)) i++;
    name = `${it.name} ${i}`;
  }
  const key = `custom_${Date.now().toString(36)}`;
  const cfg = clone(it.cfg);
  // Stairwells and lift shafts belong to where this room stands, not to the type.
  delete cfg.stairwells;
  delete cfg.shafts;
  customTypes.push(isRoom(it) ? { key, name, kind: it.kind, cfg, size: it.size, own: clone(it.own || {}), walls: clone(it.walls) } : { key, name, kind: it.kind, cfg });
  saveTypes();
  renderPalette();
  const layout = layoutCopy();
  Object.assign(layout.items.find((i) => i.id === it.id), { name, base: key });
  commit(layout);
  flash(`Saved “${name}” to the palette.`);
}

function flash(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.hidden = true; }, 2600);
}

// ------------------------------------------------------------------ in-place panels

// A selected block is edited where it stands. A room gets a tab on each of its
// four sides and one for its back wall under the floor tab, setting that
// wall's weight and adding, picking or removing its openings, plus a dot on
// each corner that rounds or squares it. A table, a flight of stairs or a
// lift gets a tab beside each size it has. A tab unfolds on hover or focus,
// and the part it works on lights up on the front view.
const JIG_NAME = { ceiling: 'Ceiling', left: 'Left', right: 'Right', floor: 'Floor', back: 'Back wall' };
const JIG_ADDS = {
  left: ['doorway', 'window', 'porthole', 'arch'], right: ['doorway', 'window', 'porthole', 'arch'],
  ceiling: ['skylight'], floor: ['hatch'], back: ['window', 'arch', 'porthole'],
};
const ADD_LABEL = { doorway: 'doorway', window: 'window', skylight: 'skylight', hatch: 'hatch', arch: 'arched window', porthole: 'round window' };
const KIND_LABEL = { thick: 'Thick', thin: 'Thin', none: 'No wall' };
// Where each tab docks: above, below, under the one below, or beside.
const ROOM_SIDES = { ceiling: 'top', left: 'left', right: 'right', floor: 'bottom', back: 'under' };
// The walls each corner joins; a corner beside a missing wall is square.
const CORNER_WALLS = { tl: ['left', 'ceiling'], tr: ['right', 'ceiling'], br: ['right', 'floor'], bl: ['left', 'floor'] };

function newOpening(kind, wall) {
  const side = wall === 'left' || wall === 'right';
  if (kind === 'doorway') return { ...OPENING_PRESETS.doorway(), wall };
  if (kind === 'skylight') return OPENING_PRESETS.skylight();
  if (kind === 'hatch') return { ...OPENING_PRESETS.skylight(), wall: 'floor', shape: 'rect', r: 2, cols: 1, rows: 1 };
  // A side wall is only as deep as the room, so its windows are smaller.
  if (kind === 'arch') return { ...OPENING_PRESETS.window(), wall, shape: 'arch', w: side ? 18 : 22, h: side ? 32 : 40, cols: 1 };
  if (kind === 'porthole') return { ...OPENING_PRESETS.window(), wall, shape: 'round', w: side ? 24 : 30, h: side ? 24 : 30 };
  return { ...OPENING_PRESETS.window(), wall, w: wall === 'back' ? 34 : 24, h: wall === 'back' ? 30 : 24 };
}

// Beside the openings already on that wall rather than on top of them.
function freeX(cfg, o) {
  const taken = cfg.openings.filter((p) => p.wall === o.wall);
  const clear = (x) => taken.every((p) => Math.abs(p.x - x) >= (p.w + o.w) / 2 + 4);
  for (let k = 0; k < 12; k++) for (const x of [k * (o.w + 6), -k * (o.w + 6)]) if (clear(x)) return x;
  return 0;
}

let jigHot = null;      // the tab being worked in
let jigPick = null;     // { id, i }: the opening picked from a tab

const glyph = (body) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
function weightGlyph(kind, vertical) {
  const bar = (t) => (vertical ? `<rect x="${8 - t / 2}" y="1" width="${t}" height="14"/>` : `<rect x="1" y="${8 - t / 2}" width="14" height="${t}"/>`);
  if (kind === 'thick') return glyph(bar(5));
  if (kind === 'thin') return glyph(bar(1.6));
  const line = vertical ? 'M8 1.5V14.5' : 'M1.5 8H14.5';
  return glyph(`<path d="${line}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2.4"/>`);
}
function shapeGlyph(shape) {
  if (shape === 'round') return glyph('<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/>');
  if (shape === 'arch') return glyph('<path d="M4 14V7.5a4 4 0 0 1 8 0V14z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>');
  return glyph('<rect x="3" y="3" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>');
}
const ADD_SHAPE = { doorway: 'arch', window: 'rect', skylight: 'rect', hatch: 'rect', arch: 'arch', porthole: 'round' };

// One tab and what it unfolds into.
function jigPanel({ id, side, name, label, tab, title, body }) {
  const vertical = side === 'left' || side === 'right' ? !!tab.vertical : false;
  return `<div class="sh-jig-panel${vertical ? ' is-vertical' : ''}${side === 'left' && !vertical ? ' is-start' : ''}${jigHot === id ? ' is-hot' : ''}"
      data-panel="${id}" data-side="${side}" role="group" aria-label="${name}">
    <button type="button" class="sh-jig-tab" data-jig="open" data-panel="${id}" aria-expanded="${jigHot === id}"
      title="${esc(title)}" aria-label="${esc(title)}">${tab.html}</button>
    <span class="sh-jig-body">${body}</span>
  </div>`;
}

function roomPanels(it) {
  const st = state.settings;
  const what = (k) => (k === 'none' ? 'no wall' : `${KIND_LABEL[k].toLowerCase()}, ${len(st[k])}`);
  return Object.entries(ROOM_SIDES).map(([wall, side]) => {
    const vertical = side === 'left' || side === 'right';
    const kind = it.walls[wall];
    const name = JIG_NAME[wall];
    const ops = it.cfg.openings.map((o, i) => [o, i]).filter(([o]) => o.wall === wall);
    const weights = WALL_KINDS.map((k) => `<button type="button" class="sh-jig-btn${k === kind ? ' is-on' : ''}" data-jig="wall" data-wall="${wall}" data-v="${k}"
        aria-pressed="${k === kind}" title="${KIND_LABEL[k]}${k === 'none' ? '' : `, ${len(st[k])}`}" aria-label="${name}: ${what(k)}">${weightGlyph(k, vertical)}</button>`).join('');
    const picked = jigPick && jigPick.id === it.id && ops.some(([, i]) => i === jigPick.i) ? jigPick.i : null;
    const chips = ops.map(([o, i]) => `<button type="button" class="sh-jig-btn sh-jig-op${i === picked ? ' is-picked' : ''}${kind === 'none' ? ' is-idle' : ''}"
        data-jig="pick" data-wall="${wall}" data-i="${i}" aria-pressed="${i === picked}" title="Opening ${i + 1}: ${SHAPE_LABEL[o.shape].toLowerCase()}, ${len(o.w)} × ${len(o.h)}"
        aria-label="${name}, opening ${i + 1}">${shapeGlyph(o.shape)}</button>`).join('');
    const del = picked != null ? `<button type="button" class="sh-jig-btn sh-jig-del" data-jig="del" data-wall="${wall}" data-i="${picked}"
        title="Remove opening ${picked + 1}" aria-label="Remove opening ${picked + 1}">×</button>` : '';
    const adds = kind === 'none' ? '' : JIG_ADDS[wall].map((a) => `<button type="button" class="sh-jig-btn sh-jig-add" data-jig="add" data-wall="${wall}" data-v="${a}"
        title="Add a ${ADD_LABEL[a]}" aria-label="${name}: add a ${ADD_LABEL[a]}">${shapeGlyph(ADD_SHAPE[a])}</button>`).join('');
    return {
      id: wall, side, name,
      title: `${name}: ${what(kind)}`,
      tab: { vertical, html: `${vertical ? '' : `<span class="sh-jig-name">${name}</span>`}${weightGlyph(kind, vertical)}` },
      body: `<span class="sh-jig-set">${weights}</span>${chips || adds ? `<span class="sh-jig-set">${chips}${del}${adds}</span>` : ''}`,
    };
  });
}

// A size of a table or a flight: the tab reads its value, and unfolds into
// the field that sets it.
function sizePanel(it, id, side, name, short, path, opts = {}) {
  const v = getPath(it, path);
  const shown = opts.unit === '' ? fmt(v) : fmtLen(v);
  return {
    id, side, name,
    title: `${name}: ${opts.unit === '' ? shown : len(v)}${opts.hint ? `. ${opts.hint}` : ''}`,
    tab: { html: `<span class="sh-jig-name">${short}</span><span class="sh-jig-val">${shown}</span>` },
    body: `<span class="field-value">${numInput(path, v, { ...opts, id: `sh-jig-${id}`, extra: ` data-jig="num" aria-label="${name}"` })}</span>`,
  };
}

function furniturePanels(it, layout) {
  const c = it.cfg;
  if (isLift(c)) {
    const reach = layout.info?.get(it.id)?.reach ?? 0;
    const rail = (v) => `<button type="button" class="sh-jig-btn sh-jig-wide${v === c.rail ? ' is-on' : ''}" data-jig="rail" data-v="${v}"
      aria-pressed="${v === c.rail}" title="${v} mm filament" aria-label="Rail: ${v} mm filament">${v} mm</button>`;
    return [
      sizePanel(it, 'floors', 'top', 'Floors', 'Floors', 'cfg.floors', {
        unit: '', step: 1, min: 2, max: 12,
        hint: !reach ? 'Put the lift in a room and its shaft rises through the rooms stacked on it'
          : reach < c.floors ? `The shaft stops at floor ${reach}: there is no room above, or its walls are in the way`
            : 'Each room the shaft passes gets its walls, and its ceiling and the floor above open for the car',
      }),
      sizePanel(it, 'width', 'bottom', 'Shaft width', 'Width', 'cfg.w', {
        min: 12, max: 200, hint: `Inside the shaft walls; the car is ${len(0.3)} narrower each side`,
      }),
      {
        id: 'rail', side: 'right', name: 'Rail',
        title: `Rail: ${c.rail} mm filament, glued into the groove up each shaft wall. The car's notches ride on it`,
        tab: { html: `<span class="sh-jig-name">Rail</span><span class="sh-jig-val">${c.rail} mm</span>` },
        body: RAILS.map(rail).join(''),
      },
    ];
  }
  if (isStairs(c)) {
    return [
      {
        id: 'turn', side: 'top', name: 'Turn',
        title: `Rises to the ${c.flip ? 'left' : 'right'}`,
        tab: { html: `<span class="sh-jig-name">Rises ${c.flip ? 'left' : 'right'}</span>` },
        body: `<button type="button" class="sh-jig-btn sh-jig-wide" data-jig="flip" title="Rise to the ${c.flip ? 'right' : 'left'} instead"
          aria-label="Rise to the ${c.flip ? 'right' : 'left'} instead">turn ⇄</button>`,
      },
      sizePanel(it, 'run', 'bottom', 'Run length', 'Run', 'cfg.run', { min: 10 }),
      sizePanel(it, 'steps', 'right', 'Steps', 'Steps', 'cfg.steps', {
        unit: '', step: 1, min: 2, max: 40,
        hint: 'Height and depth follow the room; the ceiling above and the floor of the room on top open up to fit',
      }),
    ];
  }
  return [
    sizePanel(it, 'topD', 'top', 'Top diameter', 'Top ⌀', 'cfg.topD', { min: 4 }),
    sizePanel(it, 'stemD', 'left', 'Stem diameter', 'Stem ⌀', 'cfg.stemD', { min: 1 }),
    sizePanel(it, 'height', 'right', 'Height', 'Height', 'cfg.height', { min: 8 }),
    sizePanel(it, 'baseD', 'bottom', 'Base diameter', 'Base ⌀', 'cfg.baseD', { min: 4 }),
  ];
}

// The dots that round or square each corner, outer ring and inner.
function cornerDots(it) {
  return ['outer', 'inner'].flatMap((ring) => CORNERS.map((key) => {
    const forced = CORNER_WALLS[key].some((w) => it.walls[w] === 'none');
    const on = it.cfg[ring][key] && !forced;
    const name = `${ring === 'outer' ? 'Outer' : 'Inner'} ${CORNER_LABEL[key]} corner`;
    const title = forced ? `${name}: square, because a wall beside it is missing`
      : `${name}: ${on ? 'rounded' : 'square'}. Shift-click to set all four ${ring} corners`;
    return `<button type="button" class="sh-corner${on ? ' on' : ''}" data-jig="corner" data-ring="${ring}" data-c="${key}"
      aria-pressed="${on}" title="${title}" aria-label="${title}"${forced ? ' disabled' : ''}></button>`;
  })).join('');
}

// Where an opening shows on the front view, in its room's coordinates: each
// copy of a back-wall opening face-on, a side-wall opening edge-on across its
// wall, a ceiling or floor opening edge-on along it. Widened a little so the
// edge-on ones can be picked.
function openingBoxes(cfg, o) {
  const t = cfg.walls, b = innerBox(cfg);
  const n = Math.max(1, Math.round(o.count || 1));
  const us = Array.from({ length: n }, (_, k) => cfg.w / 2 + o.x + (k - (n - 1) / 2) * (o.pitch || 0));
  const v0 = o.anchor === 'floor' ? b.y0 + o.y : (b.y0 + b.y1) / 2 + o.y - o.h / 2;
  if (o.wall === 'back') return us.map((u) => ({ x0: u - o.w / 2, x1: u + o.w / 2, y0: v0, y1: v0 + o.h }));
  if (o.wall === 'left') return [{ x0: -1.5, x1: t.left + 1.5, y0: v0, y1: v0 + o.h }];
  if (o.wall === 'right') return [{ x0: cfg.w - t.right - 1.5, x1: cfg.w + 1.5, y0: v0, y1: v0 + o.h }];
  const [y0, y1] = o.wall === 'ceiling' ? [b.y1, cfg.h] : [0, b.y0];
  return us.map((u) => ({ x0: u - o.w / 2, x1: u + o.w / 2, y0: y0 - 1.5, y1: y1 + 1.5 }));
}

// The opening of `room` (at `a`) under world point `w`, or -1. Edge-on ones
// are thin, so they win over a face-on window behind them.
function openingAt(room, a, w) {
  const x = w.x - a.x, y = w.y - a.y;
  const inside = (o) => openingBoxes(room.cfg, o).some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
  const ops = room.cfg.openings.map((o, i) => [o, i]);
  const edge = ops.find(([o]) => o.wall !== 'back' && inside(o));
  if (edge) return edge[1];
  const face = ops.find(([o]) => o.wall === 'back' && inside(o));
  return face ? face[1] : -1;
}

const pickedOpening = (it) => (it && isRoom(it) && jigPick && jigPick.id === it.id ? it.cfg.openings[jigPick.i] || null : null);

// Dragging an opening moves it along the axes the front view shows for its
// wall; dragging its handle resizes it about its centre (a doorway grows up
// from the floor). Either is one undo step, like a field edit, and goes by
// half millimetres, or by the grid from the middle of the wall while it is on.
let opDrag = null;
const half = (v) => (gridMM() ? toGrid(v) : Math.round(v * 2) / 2);

function startOpeningDrag(room, i, w, resize = false) {
  const o = room.cfg.openings[i];
  const flat = o.wall === 'ceiling' || o.wall === 'floor';
  opDrag = {
    id: room.id, i, wx: w.x, wy: w.y, resize, moved: false,
    x: o.x, y: o.y, w: o.w, h: o.h,
    moveX: o.wall === 'back' || flat,
    moveY: !flat && o.anchor !== 'floor',
    floor: o.anchor === 'floor',
  };
}

window.addEventListener('pointermove', (e) => {
  if (!opDrag) return;
  const w = toWorld(e);
  const dx = w.x - opDrag.wx, dy = w.y - opDrag.wy;
  if (!opDrag.moved && Math.hypot(dx, dy) < 2 * mmPerPx()) return;
  const it = state.items.find((m) => m.id === opDrag.id);
  const o = it?.cfg.openings[opDrag.i];
  if (!o) return;
  if (!opDrag.moved) {
    opDrag.moved = true;
    endEdit();
    editSnapshot = snap(state);
  }
  if (opDrag.resize) {
    o.w = Math.max(gridMM() || 2, half(opDrag.w + 2 * dx));
    o.h = Math.max(gridMM() || 2, half(opDrag.h + (opDrag.floor ? dy : 2 * dy)));
  } else {
    if (opDrag.moveX) o.x = half(opDrag.x + dx);
    if (opDrag.moveY) o.y = half(opDrag.y + dy);
  }
  persist();
  render();
});
window.addEventListener('pointerup', () => {
  if (!opDrag) return;
  const moved = opDrag.moved;
  opDrag = null;
  if (moved) endEdit();
});

// The picked opening's card: its fields, docked beside the room.
function openingCard(it) {
  const o = pickedOpening(it);
  if (!o) return '';
  return `<div class="sh-op-card" data-panel="op-card" role="group" aria-label="Opening ${jigPick.i + 1}">${openingHTML(o, jigPick.i)}</div>`
    + (o.wall === 'back' ? `<span class="sh-op-handle" data-jig="resize" title="Drag to resize" aria-hidden="true"></span>` : '');
}

const jig = document.createElement('div');
jig.className = 'sh-jig no-print';
mat.parentElement.append(jig);

function renderJig(layout) {
  const it = layout.items.find((i) => i.id === selectedId);
  const active = jig.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = active ? (active.id ? `#${active.id}` : jigKey(active)) : null;
  if (!it || (drag && drag.moved)) {
    jig.replaceChildren();
    if (!it) jigHot = null;
    drawJigHighlight(layout);
    return;
  }
  const panels = isRoom(it) ? roomPanels(it) : furniturePanels(it, layout);
  // Forget a hot tab or corner that this block does not have.
  const corner = isRoom(it) && /^(corner-(outer|inner)-(tl|tr|br|bl)|dim-[whd])$/.test(jigHot || '');
  if (!corner && !panels.some((p) => p.id === jigHot)) jigHot = null;
  // The panels' fields read like the band's, so they take its input styles.
  if (!pickedOpening(it)) jigPick = null;
  jig.innerHTML = `<div class="rail-band">${panels.map(jigPanel).join('')}${isRoom(it) ? cornerDots(it) : ''}${openingCard(it)}</div>`;
  placeJig(layout, it);
  if (focusKey) jig.querySelector(focusKey)?.focus();
  drawJigHighlight(layout);
  drawPick(layout);
}

// The picked opening, outlined on the front view.
function drawPick(layout) {
  mat.querySelector('.op-hi')?.remove();
  const it = layout.items.find((i) => i.id === selectedId);
  const o = pickedOpening(it);
  if (!o) return;
  const a = absPos(layout, it);
  const g = svgEl('g', { class: 'op-hi' });
  for (const r of openingBoxes(it.cfg, o)) {
    g.append(svgEl('rect', { x: a.x + r.x0 - 1, y: -(a.y + r.y1 + 1), width: r.x1 - r.x0 + 2, height: r.y1 - r.y0 + 2 }));
  }
  mat.append(g);
}

const jigKey = (el) => {
  const b = el.closest('[data-jig]');
  if (!b) return null;
  const attr = (k, a = k) => (b.dataset[k] != null ? `[data-${a}="${b.dataset[k]}"]` : '');
  return `[data-jig="${b.dataset.jig}"]${attr('panel')}${attr('wall')}${attr('v')}${attr('i')}${attr('ring')}${attr('c')}${attr('path')}`;
};

// Dock each tab against its side, just outside the selection outline. An
// open panel unfolds away from its tab (rightwards above and below, outwards
// beside), so the tab never moves from under the pointer.
function placeJig(layout, it) {
  const box = jig.getBoundingClientRect();
  const ctm = mat.getScreenCTM();
  if (!ctm || !box.width) return;
  const a = absPos(layout, it), sz = sizeOf(it);
  const pt = (x, y) => {
    const p = new DOMPoint(x, -y).matrixTransform(ctm);
    return { x: p.x - box.left, y: p.y - box.top };
  };
  const tl = pt(a.x - 3.5, a.y + sz.h + 3.5), br = pt(a.x + sz.w + 3.5, a.y - 3.5);
  const r = { l: tl.x, t: tl.y, r: br.x, b: br.y };
  const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2, gap = 5, pad = 3;
  const fit = (el, x, y) => {
    const fx = clamp(x, 2, box.width - el.offsetWidth - 2), fy = clamp(y, 2, box.height - el.offsetHeight - 2);
    el.style.transform = `translate(${Math.round(fx)}px, ${Math.round(fy)}px)`;
  };
  const bottomTab = jig.querySelector('.sh-jig-panel[data-side="bottom"] .sh-jig-tab');
  for (const el of jig.querySelectorAll('.sh-jig-panel')) {
    const tab = el.querySelector('.sh-jig-tab');
    const tw = tab.offsetWidth + 2 * pad, th = tab.offsetHeight + 2 * pad;
    const side = el.dataset.side;
    if (side === 'top') fit(el, cx - tw / 2, r.t - gap - th);
    else if (side === 'bottom') fit(el, cx - tw / 2, r.b + gap);
    else if (side === 'under') fit(el, cx - tw / 2, r.b + gap + (bottomTab ? bottomTab.offsetHeight + 2 * pad + 3 : 0));
    else if (side === 'right') fit(el, r.r + gap, cy - th / 2);
    // A left tab unfolds leftwards, so it is placed by its right edge.
    else fit(el, r.l - gap - (el.classList.contains('is-vertical') ? tw : el.offsetWidth), cy - th / 2);
  }
  // The opening card goes beside the room's side tabs, on whichever side has
  // room for it, top-aligned with the room; the resize handle on the top
  // right corner of the opening's first copy.
  const card = jig.querySelector('.sh-op-card');
  if (card) {
    const sideW = (s) => jig.querySelector(`.sh-jig-panel[data-side="${s}"]`)?.offsetWidth || 0;
    let x = r.r + gap + sideW('right') + 8;
    if (x + card.offsetWidth > box.width - 2) {
      const left = r.l - gap - sideW('left') - 8 - card.offsetWidth;
      x = left >= 2 ? left : box.width - card.offsetWidth - 2;
    }
    fit(card, x, r.t);
  }
  const handle = jig.querySelector('.sh-op-handle');
  const o = pickedOpening(it);
  if (handle && o) {
    const [first] = openingBoxes(it.cfg, o);
    const p = pt(a.x + first.x1, a.y + first.y1);
    handle.style.left = `${Math.round(p.x)}px`;
    handle.style.top = `${Math.round(p.y)}px`;
  }

  // Corner dots: the outer ring just outside each corner, the inner ring just
  // inside each corner of the interior, so the two never sit on each other.
  if (!isRoom(it)) return;
  const b = innerBox(it.cfg);
  const corner = {
    outer: { tl: [0, sz.h], tr: [sz.w, sz.h], br: [sz.w, 0], bl: [0, 0] },
    inner: { tl: [b.x0, b.y1], tr: [b.x1, b.y1], br: [b.x1, b.y0], bl: [b.x0, b.y0] },
  };
  const dir = { tl: [-1, -1], tr: [1, -1], br: [1, 1], bl: [-1, 1] };
  for (const el of jig.querySelectorAll('.sh-corner')) {
    const [x, y] = corner[el.dataset.ring][el.dataset.c];
    const p = pt(a.x + x, a.y + y);
    const [dx, dy] = dir[el.dataset.c];
    const k = el.dataset.ring === 'outer' ? 7 : -9;
    el.style.left = `${Math.round(p.x + dx * k)}px`;
    el.style.top = `${Math.round(p.y + dy * k)}px`;
  }
}

// What the hot tab works on, lit on the front view: a wall as a strip its own
// thickness (a dashed edge where there is none) or the whole back face; a
// corner as an arc; a part of a table; a whole flight.
function drawJigHighlight(layout) {
  mat.querySelector('.wall-hi')?.remove();
  const it = layout.items.find((i) => i.id === selectedId);
  if (!jigHot || !it) return;
  const a = absPos(layout, it), c = it.cfg, sz = sizeOf(it);
  const g = svgEl('g', { class: 'wall-hi' });
  const rect = (x0, y0, x1, y1) => g.append(svgEl('rect', { x: a.x + x0, y: -(a.y + y1), width: x1 - x0, height: y1 - y0 }));
  const edge = (x0, y0, x1, y1) => g.append(svgEl('line', { x1: a.x + x0, y1: -(a.y + y0), x2: a.x + x1, y2: -(a.y + y1), class: 'open' }));
  const w = jigHot;
  if (!isRoom(it)) {
    if (isStairs(c)) rect(0, 0, sz.w, sz.h);
    else if (isLift(c)) {
      // The shaft up to the ceiling of its last floor; for the rail, its two walls.
      const top = (layout.info?.get(it.id)?.top ?? a.y + sz.h) - a.y, t = liftWall(c);
      if (w === 'rail') { rect(0, 0, t, top); rect(sz.w - t, 0, sz.w, top); }
      else rect(0, 0, sz.w, top);
    } else {
      const mid = sz.w / 2;
      if (w === 'topD') rect(mid - c.topD / 2, c.height - 3, mid + c.topD / 2, c.height);
      if (w === 'baseD') rect(mid - c.baseD / 2, 0, mid + c.baseD / 2, 3.5);
      if (w === 'stemD') rect(mid - c.stemD / 2, 3.5, mid + c.stemD / 2, c.height - 3);
      if (w === 'height') rect(0, 0, sz.w, c.height);
    }
  } else if (w.startsWith('dim-')) {
    // A dimension line across the room, with a tick at each end; depth, which
    // the front view cannot show, lights the back wall it is measured to.
    const b = innerBox(c);
    const line = (x0, y0, x1, y1) => g.append(svgEl('line', { x1: a.x + x0, y1: -(a.y + y0), x2: a.x + x1, y2: -(a.y + y1), class: 'dim' }));
    if (w === 'dim-w') { line(0, c.h / 2, c.w, c.h / 2); line(0, c.h / 2 - 5, 0, c.h / 2 + 5); line(c.w, c.h / 2 - 5, c.w, c.h / 2 + 5); }
    if (w === 'dim-h') { line(c.w / 2, 0, c.w / 2, c.h); line(c.w / 2 - 5, 0, c.w / 2 + 5, 0); line(c.w / 2 - 5, c.h, c.w / 2 + 5, c.h); }
    if (w === 'dim-d') rect(b.x0, b.y0, b.x1, b.y1);
  } else if (w.startsWith('corner-')) {
    const [, ring, key] = w.split('-');
    const b = innerBox(c);
    const r = Math.max(ring === 'outer' ? c.outerR : c.innerR, 3);
    const [x, y] = ring === 'outer'
      ? { tl: [0, c.h], tr: [c.w, c.h], br: [c.w, 0], bl: [0, 0] }[key]
      : { tl: [b.x0, b.y1], tr: [b.x1, b.y1], br: [b.x1, b.y0], bl: [b.x0, b.y0] }[key];
    // The quarter circle the corner is rounded along, from one wall to the other.
    const sx = key[1] === 'l' ? 1 : -1, sy = key[0] === 't' ? -1 : 1;
    const X = (u) => a.x + u, Y = (v) => -(a.y + v);
    const sweep = sx * sy < 0 ? 1 : 0; // both rings round about a centre inside the corner
    g.append(svgEl('path', {
      d: `M${X(x)},${Y(y + sy * r)} A${r},${r} 0 0 ${sweep} ${X(x + sx * r)},${Y(y)}`, class: 'arc',
    }));
  } else {
    const t = c.walls, b = innerBox(c);
    if (w === 'back') rect(b.x0, b.y0, b.x1, b.y1);
    else if (!(t[w] > 0)) {
      if (w === 'left') edge(0, 0, 0, c.h);
      if (w === 'right') edge(c.w, 0, c.w, c.h);
      if (w === 'ceiling') edge(0, c.h, c.w, c.h);
      if (w === 'floor') edge(0, 0, c.w, 0);
    } else {
      if (w === 'left') rect(0, 0, t.left, c.h);
      if (w === 'right') rect(c.w - t.right, 0, c.w, c.h);
      if (w === 'ceiling') rect(0, b.y1, c.w, c.h);
      if (w === 'floor') rect(0, 0, c.w, b.y0);
    }
  }
  mat.append(g);
}

function setJigHot(id) {
  if (jigHot === id) return;
  jigHot = id;
  for (const p of jig.querySelectorAll('.sh-jig-panel')) {
    p.classList.toggle('is-hot', p.dataset.panel === id);
    p.querySelector('.sh-jig-tab').setAttribute('aria-expanded', p.dataset.panel === id);
  }
  const it = selected();
  if (it) placeJig(state, it);
  drawJigHighlight(currentView());
}
const hotOf = (e) => {
  const p = e.target.closest?.('.sh-jig-panel');
  if (p) return p.dataset.panel;
  const d = e.target.closest?.('.sh-corner');
  return d ? `corner-${d.dataset.ring}-${d.dataset.c}` : null;
};
jig.addEventListener('pointerover', (e) => setJigHot(hotOf(e)));
// A mouse leaving the panels folds them. A finger "leaves" every time it
// lifts, before the tap's click arrives, so folding then would hide the
// button being tapped (iOS gives a tapped button no focus to hold it open):
// a touch-opened panel folds when something outside it is tapped instead.
jig.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !jig.contains(document.activeElement)) setJigHot(null);
});
document.addEventListener('pointerdown', (e) => {
  if (jigHot && e.pointerType !== 'mouse' && !jig.contains(e.target) && !bar.contains(e.target)) setJigHot(null);
}, true);
jig.addEventListener('focusin', (e) => setJigHot(hotOf(e)));
jig.addEventListener('focusout', (e) => { if (!jig.contains(e.relatedTarget) && !jig.matches(':hover')) setJigHot(null); });
// The panels sit over the mat; a press on one is not a press on the shelf.
jig.addEventListener('pointerdown', (e) => e.stopPropagation());

// Fields in the panels and the opening card edit the block as the rail did:
// typed numbers apply on Enter or when the field loses focus, spinner arrows
// as they go, each one undo step.
jig.addEventListener('input', onFieldInput);
jig.addEventListener('change', (e) => { onFieldChange(e); renderJig(state); });
jig.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.sh-op-handle');
  const it = selected();
  if (!h || !pickedOpening(it)) return;
  startOpeningDrag(it, jigPick.i, toWorld(e), true);
  e.preventDefault();
});

jig.addEventListener('click', (e) => {
  if (e.target.closest('[data-act]')) { onAct(e); return; }
  const b = e.target.closest('[data-jig]');
  const it = selected();
  if (!b || !it) return;
  const act = b.dataset.jig;
  if (act === 'open') { setJigHot(b.dataset.panel); return; }
  if (act === 'unpick') { jigPick = null; renderJig(state); return; }
  if (act === 'set') { liveEdit(b.dataset.path, b.dataset.v); endEdit(); return; }
  if (act === 'num') return;
  if (act === 'pick') {
    const i = Number(b.dataset.i);
    jigPick = jigPick && jigPick.id === it.id && jigPick.i === i ? null : { id: it.id, i };
    renderJig(state);
    return;
  }
  const layout = layoutCopy();
  const m = layout.items.find((i) => i.id === it.id);
  const old = new Map(state.items.map((i) => [i.id, measure(i)]));
  if (act === 'wall') m.walls[b.dataset.wall] = b.dataset.v;
  else if (act === 'add') {
    const o = newOpening(b.dataset.v, b.dataset.wall);
    o.x = freeX(m.cfg, o);
    m.cfg.openings.push(o);
    jigPick = { id: m.id, i: m.cfg.openings.length - 1 };
  } else if (act === 'del') {
    m.cfg.openings.splice(Number(b.dataset.i), 1);
    jigPick = null;
  } else if (act === 'corner') {
    const { ring, c } = b.dataset;
    const to = !m.cfg[ring][c];
    if (e.shiftKey) for (const key of CORNERS) m.cfg[ring][key] = to;
    else m.cfg[ring][c] = to;
  } else if (act === 'flip') m.cfg.flip = !m.cfg.flip;
  else if (act === 'rail') m.cfg.rail = Number(b.dataset.v);
  else return;
  reflow(layout, old);
  commit(layout);
  // The control that was used may have gone (a removed opening): stay in the panel.
  if (!jig.contains(document.activeElement)) jig.querySelector(`.sh-jig-panel[data-panel="${b.dataset.wall}"] [data-jig="wall"].is-on`)?.focus();
});


// ------------------------------------------------------------------ shelf settings

const SETTING_LABEL = {
  wide: 'Wide rooms', narrow: 'Narrow rooms', h: 'Height', d: 'Depth',
  thick: 'Thick walls', thin: 'Thin walls', outerR: 'Outer radius', innerR: 'Inner radius',
};
const settingsEl = $('settings');

// Folded, the band is one line: the shelf's sizes at a glance.
const SETTINGS_KEY = 'shelf-house-settings';
function foldSettings(open) {
  $('settings').hidden = $('settings-hint').hidden = !open;
  $('settings-summary').hidden = open;
  $('settings-fold').setAttribute('aria-expanded', open);
}
try { foldSettings(localStorage.getItem(SETTINGS_KEY) !== 'folded'); } catch { foldSettings(true); }
$('settings-fold').onclick = () => {
  const open = $('settings').hidden;
  foldSettings(open);
  try { localStorage.setItem(SETTINGS_KEY, open ? 'open' : 'folded'); } catch { /* ignore */ }
};

const gridText = () => String(+grid[units].toFixed(4));

function renderSettings() {
  const s = state.settings, d = roomDefaults();
  const focusId = settingsEl.contains(document.activeElement) ? document.activeElement.id : null;
  $('settings-summary').textContent = `rooms ${fmtLen(s.wide)} or ${fmtLen(s.narrow)} × ${fmtLen(s.h)} × ${fmtLen(s.d)}, `
    + `walls ${fmtLen(s.thick)} / ${fmtLen(s.thin)}, corners ${fmtLen(s.outerR)} / ${fmtLen(s.innerR)}${grid.on ? `, grid ${gridText()}` : ''} ${unitName()}`;
  settingsEl.innerHTML = Object.keys(SETTING_LABEL).map((key) => num(SETTING_LABEL[key], key, s[key], {
    min: SETTING_MIN[key] ?? 10,
    max: SETTING_MAX[key] ?? 500,
    step: key in SETTING_MIN ? 0.1 : 0.5,
    fine: key in SETTING_MIN,
    hint: key === 'wide' || key === 'narrow' ? 'Width' : '',
    after: Math.abs(s[key] - d[key]) > 1e-6 ? resetChip('setting-default', `data-key="${key}"`, SETTING_LABEL[key], d[key]) : '',
  })).join('') + gridFields();
  if (focusId) $(focusId)?.focus();
  renderOffGrid();
  for (const b of $('units').children) {
    b.classList.toggle('is-on', b.dataset.units === units);
    b.setAttribute('aria-pressed', b.dataset.units === units);
  }
}

// Every room that has not set a size of its own follows, and rooms that
// touched or stood on each other keep doing so.
function setSetting(key, value) {
  if (state.settings[key] === value) return;
  const layout = layoutCopy();
  const old = new Map(state.items.map((i) => [i.id, measure(i)]));
  layout.settings[key] = value;
  reflow(layout, old);
  commit(layout);
  renderPalette();
  renderSettings();
}

settingsEl.addEventListener('change', (e) => {
  if (e.target.id === 'grid-on' || e.target.id === 'grid-size') { setGrid(e.target); return; }
  const el = e.target.closest('[data-path]');
  if (!el) return;
  const v = readInput(el);
  if (v !== undefined) setSetting(el.dataset.path, v);
  el.value = shown(el, state.settings[el.dataset.path]);
});
settingsEl.addEventListener('click', (e) => {
  if (e.target.closest('#grid-snap')) { snapToGrid(); return; }
  const b = e.target.closest('[data-act="setting-default"]');
  if (b) setSetting(b.dataset.key, roomDefaults()[b.dataset.key]);
});

// ------------------------------------------------------------------ grid in the band

// The band's last fields: the switch, the grid's size once it is on, and
// what is off the grid with a press to snap it.
function gridFields() {
  const [min, max, step] = GRID_LIMITS[units];
  return `<div class="field sh-grid-switch"><label for="grid-on">Snap to grid</label>
      <span class="field-value"><label class="toggle-row"><input type="checkbox" id="grid-on"${grid.on ? ' checked' : ''}><span class="toggle-pill"></span></label></span></div>`
    + (grid.on ? `<div class="field field-measure"><label for="grid-size" title="The step everything moves and is sized by">Grid</label>
      <span class="field-value"><input type="number" id="grid-size" value="${gridText()}" min="${min}" max="${max}" step="${step}"><span class="unit">${unitName()}</span></span></div>` : '')
    + '<div class="field sh-grid-off" id="grid-off" hidden></div>';
}

function setGrid(el) {
  if (el.id === 'grid-on') grid.on = el.checked;
  else if (el.value !== '' && Number.isFinite(Number(el.value))) grid[units] = clamp(Number(el.value), GRID_LIMITS[units][0], GRID_LIMITS[units][1]);
  saveGrid();
  renderSettings();
  renderInspector();
  render();
}

const SHELF_SIZES = ['wide', 'narrow', 'h', 'd'];
const thingSizes = (c) => (isStairs(c) ? ['run'] : isLift(c) ? ['w'] : ['topD', 'stemD', 'height', 'baseD']);

// A block's lengths that go on the grid, as [object, key, place]: a room's
// own sizes and its openings, a thing's sizes. A place snaps to the nearest
// line, a size to one step at least. Walls, bars and radii are too fine for
// the grid, and where the block itself stands is placeOnGrid's.
function gridLengths(it) {
  if (!isRoom(it)) return thingSizes(it.cfg).map((k) => [it.cfg, k, false]);
  const out = ['w', 'h', 'd'].filter((dim) => it.own?.[dim]).map((dim) => [it.cfg, dim, false]);
  for (const o of it.cfg.openings) {
    out.push([o, 'x', true], [o, 'y', true], [o, 'w', false], [o, 'h', false]);
    if (o.count > 1) out.push([o, 'pitch', false]);
  }
  return out;
}

// A block stands on the grid when its left edge is on a line, counted from
// the shelf's left; a thing may stand against a wall instead.
function placeOnGrid(layout, it) {
  const host = !isRoom(it) && it.parent != null && layout.items.find((m) => m.id === it.parent);
  if (!host) return isOnGrid(it.x);
  const [lo, hi] = furnitureRange(host, it);
  return isOnGrid(host.x + it.x) || Math.abs(it.x - lo) < 0.01 || Math.abs(it.x - hi) < 0.01;
}

function offGrid(layout) {
  return {
    shelf: SHELF_SIZES.some((k) => !isOnGrid(layout.settings[k])),
    blocks: layout.items.filter((it) => !placeOnGrid(layout, it) || gridLengths(it).some(([o, k]) => !isOnGrid(o[k]))).length,
  };
}

// Redrawn with the front view, since any edit can take something off the grid.
function renderOffGrid() {
  const cell = $('grid-off');
  if (!cell) return;
  const { shelf, blocks } = gridMM() ? offGrid(state) : { shelf: false, blocks: 0 };
  const n = blocks && `${blocks} block${blocks > 1 ? 's' : ''}`;
  const key = `${shelf}${blocks}`;
  if (cell.dataset.key === key) return;
  cell.dataset.key = key;
  cell.hidden = !shelf && !blocks;
  const what = [shelf && 'the shelf sizes', n].filter(Boolean).join(' and ');
  cell.innerHTML = cell.hidden ? '' : `<span class="field-name">${[shelf && 'Shelf sizes', n].filter(Boolean).join(' and ')} off the grid</span>
    <span class="field-value"><button type="button" class="chip" id="grid-snap" title="Snap ${what} to the grid" aria-label="Snap ${what} to the grid">snap</button></span>`;
}

// Everything off the grid onto it, as one undo step. Sizes go first, so that
// reflow keeps rooms that touched touching; then each room's place, after
// the room it touches, which is on the grid by then.
function snapToGrid() {
  const g = gridMM();
  if (!g) return;
  const layout = layoutCopy();
  const old = new Map(state.items.map((i) => [i.id, measure(i)]));
  const size = (v) => Math.max(g, toGrid(v));
  for (const k of SHELF_SIZES) layout.settings[k] = clamp(size(layout.settings[k]), 10, 500);
  for (const it of layout.items) for (const [o, k, place] of gridLengths(it)) o[k] = place ? toGrid(o[k]) : size(o[k]);
  reflow(layout, old);
  const rooms = layout.items.filter(isRoom).sort((a, b) => a.y - b.y || a.x - b.x);
  const was = new Map(rooms.map((m) => [m.id, m.x]));
  for (const m of rooms) {
    const left = rooms.find((o) => o !== m && Math.abs(o.y - m.y) < 0.01 && Math.abs(was.get(o.id) + sizeOf(o).w - m.x) < 0.5);
    m.x = left ? left.x + sizeOf(left).w : toGrid(m.x);
  }
  for (const it of layout.items) {
    if (isRoom(it) || placeOnGrid(layout, it)) continue;
    const host = it.parent != null && layout.items.find((m) => m.id === it.parent);
    it.x = host ? clamp(toGrid(host.x + it.x) - host.x, ...furnitureRange(host, it)) : toGrid(it.x);
  }
  commit(layout);
  renderPalette();
  renderSettings();
}

$('units').addEventListener('click', (e) => {
  const b = e.target.closest('[data-units]');
  if (!b || b.dataset.units === units) return;
  units = b.dataset.units;
  try { localStorage.setItem(UNITS_KEY, units); } catch { /* ignore */ }
  renderSettings();
  renderPalette();
  renderInspector();
  render();
});

// ------------------------------------------------------------------ views

// The front view and 3D share the width; the divider between them sets how,
// by dragging or with the arrow keys, and double-click puts it back.
const SPLIT_KEY = 'shelf-house-split';
const SPLIT_DEFAULT = 64;
const views = $('views'), split = $('split');
function setSplit(pct, save = true) {
  const v = clamp(Math.round(pct), 35, 80);
  views.style.setProperty('--split', `${v}%`);
  split.setAttribute('aria-valuenow', v);
  if (save) try { localStorage.setItem(SPLIT_KEY, v); } catch { /* ignore */ }
}
try { setSplit(Number(localStorage.getItem(SPLIT_KEY)) || SPLIT_DEFAULT, false); } catch { setSplit(SPLIT_DEFAULT, false); }
split.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  split.setPointerCapture(e.pointerId);
  split.classList.add('is-dragging');
  const move = (ev) => {
    const r = views.getBoundingClientRect();
    setSplit(((ev.clientX - r.left) / r.width) * 100);
  };
  const up = () => {
    split.classList.remove('is-dragging');
    split.removeEventListener('pointermove', move);
    split.removeEventListener('pointerup', up);
  };
  split.addEventListener('pointermove', move);
  split.addEventListener('pointerup', up);
});
split.addEventListener('keydown', (e) => {
  const now = Number(split.getAttribute('aria-valuenow'));
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    setSplit(now + (e.key === 'ArrowLeft' ? -5 : 5));
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    setSplit(e.key === 'Home' ? 35 : 80);
  }
});
split.addEventListener('dblclick', () => setSplit(SPLIT_DEFAULT));

// When the front view changes size, its scale changes: redraw it, so the
// panels stay docked to their walls.
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { if (!drag && !opDrag && state) render(); });
}).observe(mat);

// ------------------------------------------------------------------ 3D view

const viewEl = $('view');
// Without WebGL the 3D pane says so and everything else keeps working: the
// layout, the inspector and the STL export need only manifold.
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { /* no WebGL */ }
if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  $('loading').remove();
  viewEl.append(renderer.domElement);
} else {
  $('loading').textContent = 'This browser has no WebGL, so there is no 3D preview. Everything else works.';
}

const scene = new THREE.Scene();
const css = getComputedStyle(document.documentElement);
const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
scene.background = new THREE.Color(token('--paper', '#ffffff'));
const camera = new THREE.PerspectiveCamera(35, 1, 1, 10000);
const controls = renderer && new OrbitControls(camera, renderer.domElement);
if (controls) {
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
}

scene.add(new THREE.HemisphereLight('#ffffff', '#8a9a90', 1.6));
const sun = new THREE.DirectionalLight('#fff6e8', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.ShadowMaterial({ opacity: 0.18 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const materials = new Map();
function materialFor(color, isSelected) {
  const key = color + (isSelected ? ':sel' : '');
  if (!materials.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0 });
    if (isSelected) m.emissive = new THREE.Color(token('--reg', '#0b6e72')).multiplyScalar(0.45);
    materials.set(key, m);
  }
  return materials.get(key);
}

const meshes = new Map();
let fitted = false;
let fittedKey = '';
let lastBounds = null;

function render3D(layout) {
  if (!renderer) return;
  const explode = Number($('explode').value);
  const seen = new Set();
  let cx = 0, n = 0;
  for (const it of layout.items) if (isRoom(it)) { cx += it.x + sizeOf(it).w / 2; n++; }
  cx = n ? cx / n : 0;

  const box = new THREE.Box3();
  for (const it of layout.items) {
    seen.add(it.id);
    let mesh = meshes.get(it.id);
    const geo = geometryFor(it.kind, it.cfg);
    if (!mesh) {
      mesh = new THREE.Mesh(geo);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      meshes.set(it.id, mesh);
    }
    mesh.geometry = geo;
    mesh.material = materialFor(it.cfg.color, it.id === selectedId);
    const s = sizeOf(it);
    const a = absPos(layout, it);
    const host = isRoom(it) ? it : layout.items.find((m) => m.id === it.parent);
    const level = host ? (layout.info?.get(host.id)?.level ?? 0) : 0;
    const hostCx = host ? host.x + sizeOf(host).w / 2 : a.x;
    const ex = ((hostCx - cx) * explode) / 120;
    const ey = level * explode;
    if (isRoom(it)) {
      mesh.rotation.set(0, 0, 0);
      mesh.position.set(a.x + ex, a.y + ey, 0);
    } else if (backed(it.cfg)) {
      mesh.rotation.set(0, 0, 0);
      mesh.position.set(a.x + ex, a.y + ey, furnitureZ(host, it));
    } else {
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.position.set(a.x + s.w / 2 + ex, a.y + ey, furnitureZ(host, it));
    }
    mesh.updateMatrixWorld();
    box.expandByObject(mesh);
  }
  for (const [id, mesh] of meshes) {
    if (!seen.has(id)) { scene.remove(mesh); meshes.delete(id); }
  }

  if (box.isEmpty()) box.set(new THREE.Vector3(-100, 0, 0), new THREE.Vector3(100, 80, 60));
  lastBounds = box;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z);
  sun.position.set(c.x + r * 0.6, c.y + r * 1.6, c.z + r * 1.4);
  sun.target.position.copy(c);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -r * 1.2; sc.right = sc.top = r * 1.2; sc.near = 1; sc.far = r * 5;
  sc.updateProjectionMatrix();

  // Re-frame when the shelf itself changes size, but not mid-drag or mid-edit.
  const key = [box.min.toArray(), box.max.toArray()].flat().map((v) => Math.round(v / 10)).join();
  if (!fitted) { fitCamera(); fitted = true; fittedKey = key; }
  else if (!drag?.moved && !editSnapshot && key !== fittedKey && explode === 0) { fitCamera(true); fittedKey = key; }
}

function fitCamera(keepDirection = false) {
  if (!lastBounds) return;
  const sphere = lastBounds.getBoundingSphere(new THREE.Sphere());
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = (Math.max(sphere.radius, 60) / Math.sin(Math.min(vFov, hFov) / 2)) * 0.95;
  const dir = keepDirection
    ? camera.position.clone().sub(controls.target).normalize()
    : new THREE.Vector3(0.45, 0.35, 1).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  controls.target.copy(sphere.center);
  controls.update();
}

function resize3D() {
  if (!renderer) return;
  const { clientWidth: w, clientHeight: h } = viewEl;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
if (renderer) {
  new ResizeObserver(resize3D).observe(viewEl);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}

$('fit').onclick = () => fitCamera();
$('explode').oninput = () => render3D(currentView());

// ------------------------------------------------------------------ print list & export

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'block';

// Identical blocks print from the same file; blocks that share a name but
// were tuned differently become separate variants.
function printGroups(layout) {
  const groups = new Map();
  for (const it of layout.items) {
    const key = cfgKey(it.kind, it.cfg);
    if (!groups.has(key)) groups.set(key, { key, kind: it.kind, cfg: it.cfg, name: it.name, qty: 0, ids: [] });
    const g = groups.get(key);
    g.qty++;
    g.ids.push(it.id);
  }
  const list = [...groups.values()];
  const byName = new Map();
  for (const g of list) {
    g.variant = (byName.get(g.name) || 0) + 1;
    byName.set(g.name, g.variant);
  }
  for (const g of list) {
    const multi = byName.get(g.name) > 1;
    g.label = multi ? `${g.name} (variant ${g.variant})` : g.name;
    g.file = `${g.kind === 'room' ? 'room' : 'furniture'}_${slug(g.name)}${multi ? `_v${g.variant}` : ''}`;
  }
  return list;
}

function renderBom() {
  const tbody = $('bom');
  tbody.replaceChildren();
  let grams = 0, parts = 0;
  const groups = printGroups(state);
  for (const g of groups) {
    const st = statsFor(g.kind, g.cfg);
    grams += st.grams * g.qty; parts += g.qty;
    const tr = document.createElement('tr');
    if (g.ids.includes(selectedId)) tr.className = 'current';
    tr.innerHTML = `
      <td><span class="sh-swatch" style="background:${g.cfg.color}"></span>${esc(g.label)}</td>
      <td class="num">${g.qty}</td>
      <td class="sh-size">${st.size.map(fmtLen).join(' × ')} ${unitName()}</td>
      <td class="num">${Math.round(st.grams)} g</td>
      <td></td>`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = 'stl';
    b.title = `Download ${g.file}.stl`;
    b.onclick = () => downloadGroup(g);
    tr.lastElementChild.append(b);
    tbody.append(tr);
  }
  if (!groups.length) tbody.innerHTML = '<tr><td colspan="5">Add blocks to the shelf and the parts to print appear here.</td></tr>';
  $('bom-total').textContent = parts ? `${parts} part${parts > 1 ? 's' : ''} in ${groups.length} file${groups.length > 1 ? 's' : ''}, about ${Math.round(grams)} g of PLA at 100% infill` : '';
  $('zip').disabled = $('assembly').disabled = !parts;
}

const stlFor = (g) => toSTL(meshArrays(manifoldFor(g.kind, g.cfg)), g.file);

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function downloadGroup(g) {
  save(new Blob([stlFor(g)], { type: 'model/stl' }), `${g.file}.stl`);
}
function downloadItem(it) {
  const g = printGroups(state).find((x) => x.ids.includes(it.id));
  if (g) downloadGroup(g);
}

$('zip').onclick = () => {
  const files = {};
  const lines = ['Shelf House print list', '', 'Print each file the number of times shown. Rooms print lying on their back (no supports).', ''];
  for (const g of printGroups(state)) {
    files[`${g.file}_x${g.qty}.stl`] = new Uint8Array(stlFor(g));
    lines.push(`${g.qty} x ${g.file}.stl  (${g.label})`);
  }
  const rails = [...new Set(state.items.filter((i) => !isRoom(i) && isLift(i.cfg)).map((i) => i.cfg.rail))];
  if (rails.length) lines.push('', `Lifts: glue a strand of ${rails.join(' or ')} mm filament into the groove up each shaft wall, in every room the shaft passes. The car's notches ride on them.`);
  files['print_list.txt'] = new TextEncoder().encode(lines.join('\n'));
  files['layout.json'] = new TextEncoder().encode(layoutFile());
  save(new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }), 'shelf_house.zip');
};

$('assembly').onclick = () => {
  const parts = [];
  for (const it of state.items) {
    const a = absPos(state, it);
    // Z-up STL with the open fronts facing -y. Rooms, stairs and lift cars are
    // modelled lying on their back, so stand them up; the table is already upright.
    const host = state.items.find((m) => m.id === it.parent);
    if (isRoom(it)) {
      parts.push(manifoldFor(it.kind, it.cfg).rotate([90, 0, 0]).translate([a.x, 0, a.y]));
    } else if (backed(it.cfg)) {
      parts.push(manifoldFor(it.kind, it.cfg).rotate([90, 0, 0]).translate([a.x, -furnitureZ(host, it), a.y]));
    } else {
      parts.push(manifoldFor(it.kind, it.cfg).translate([a.x + sizeOf(it).w / 2, -furnitureZ(host, it), a.y]));
    }
  }
  const all = k.Manifold.union(parts);
  save(new Blob([toSTL(meshArrays(all), 'shelf_house_assembly')], { type: 'model/stl' }), 'shelf_house_assembly.stl');
  all.delete();
  parts.forEach((m) => m.delete());
};

// ------------------------------------------------------------------ toolbar

$('undo').onclick = undo;
$('redo').onclick = redo;
$('clear').onclick = () => { selectedId = null; commit({ items: [] }); };
const loadExample = () => { selectedId = null; fitted = false; commit(makeExample()); };
$('example').onclick = loadExample;
$('empty-example').onclick = loadExample;
$('save').onclick = () => save(new Blob([layoutFile()], { type: 'application/json' }), 'shelf_house_layout.json');
$('open-layout').onclick = () => $('open').click();
$('open').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const next = sanitize(data);
    if (Array.isArray(data.types)) {
      for (const t of data.types) if (t?.key && t.cfg && !customTypes.some((c) => c.key === t.key)) customTypes.push(migrateItem(t));
      saveTypes();
      renderPalette();
    }
    selectedId = null;
    fitted = false;
    commit(next);
    renderSettings();
    renderPalette();
  } catch {
    flash(`${f.name} is not a Shelf House layout. Choose a .json file saved with “save”.`);
  }
};

// ------------------------------------------------------------------ render

const currentView = () => (drag?.moved && drag.preview ? drag.preview : state);

function updateHistoryButtons() {
  $('undo').disabled = !undoStack.length && !editSnapshot;
  $('redo').disabled = !redoStack.length;
}

function render() {
  const view = currentView();
  settle(view);
  renderMat(view);
  render3D(view);
  renderSelection(view);
  renderJig(view);
  renderOffGrid();
  renderBom();
  updateHistoryButtons();
  let maxX = -Infinity, minX = Infinity, maxY = 0, maxD = 0;
  for (const it of view.items.filter(isRoom)) {
    const s = sizeOf(it);
    minX = Math.min(minX, it.x); maxX = Math.max(maxX, it.x + s.w); maxY = Math.max(maxY, it.y + s.h); maxD = Math.max(maxD, s.d);
  }
  $('overall').textContent = maxY ? `Overall ${fmtLen(maxX - minX)} × ${fmtLen(maxY)} × ${fmtLen(maxD)} ${unitName()}` : '';
  pruneCache();
}

state = load() || settle(makeExample());
renderSettings();
renderPalette();
render();
renderInspector();
