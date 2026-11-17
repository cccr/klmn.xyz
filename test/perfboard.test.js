'use strict';
// Perfboard Planner. The model files are classic scripts that add to globalThis.PCB, so they load
// here with require() in the order the page lists them. The page itself is driven in real Chrome:
// drawing needs real pointer input, which jsdom cannot give.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSite } = require('./harness');
const { withPage, closeAll, CHROME } = require('./cdp');

const MODEL = path.join(__dirname, '..', 'static', 'tools', 'perfboard', 'model');
for (const name of ['project', 'footprints', 'geometry', 'nets', 'checks', 'buildOrder', 'serialize']) {
  require(path.join(MODEL, name + '.js'));
}
const PCB = globalThis.PCB;

buildSite();
test.after(closeAll);

let n = 0;
const routed = (points, label) => ({ id: 'w' + ++n, label: label || 'W' + n, color: '#d8342b', mode: 'routed', side: 'top', points: points.map(([x, y]) => ({ x, y })) });
const direct = (a, b, label) => ({ id: 'w' + ++n, label: label || 'W' + n, color: '#2f6fd6', mode: 'direct', side: 'top', points: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }] });
const project = (extra) => Object.assign(PCB.newProject('t', 30, 20), extra);

test('straight routed wire over 5 pitches cuts to 19 mm', () => {
  const w = routed([[0, 0], [5, 0]]);
  assert.equal(PCB.pitchLength(w), 5);
  assert.equal(PCB.cutLengthMm(w, PCB.defaultSettings()), 19); // 12.7 + 2 * 3 = 18.7
  assert.equal(PCB.bendCount(w), 0);
});

test('L of 3 + 4 pitches has one bend', () => {
  const w = { ...routed([[0, 0], [0, 0]]), points: PCB.lRoute({ x: 0, y: 0 }, { x: 3, y: 4 }, true) };
  assert.deepEqual(w.points, [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]);
  assert.equal(PCB.bendCount(w), 1);
  assert.equal(PCB.cutLengthMm(w, PCB.defaultSettings()), 24); // 17.78 + 6
});

test('direct wire uses straight distance plus slack', () => {
  const w = direct([0, 0], [3, 4]);
  assert.equal(PCB.pitchLength(w), 5);
  assert.equal(PCB.cutLengthMm(w, { endAllowanceMm: 3, slackPct: 10 }), 20); // 12.7 * 1.1 + 6 = 19.97
  assert.equal(PCB.cutLengthMm(w, { endAllowanceMm: 0, slackPct: 0 }), 13);
  assert.equal(PCB.bendCount(w), 0);
});

test('normalizeRoute drops repeats, mid-run points and doubled-back spurs', () => {
  const pts = (list) => list.map(([x, y]) => ({ x, y }));
  assert.deepEqual(PCB.normalizeRoute(pts([[0, 0], [2, 0], [2, 0], [5, 0], [5, 3]])), pts([[0, 0], [5, 0], [5, 3]]));
  assert.deepEqual(PCB.normalizeRoute(pts([[0, 0], [5, 0], [3, 0], [3, 2]])), pts([[0, 0], [3, 0], [3, 2]]));
});

test('collinear routed wires sharing a stretch are an overlap, not a crossing', () => {
  const a = routed([[0, 2], [6, 2]]);
  const b = routed([[4, 2], [9, 2]]);
  const c = PCB.wireConflicts([a, b]);
  assert.equal(c.overlaps.length, 1);
  assert.deepEqual([c.overlaps[0].a, c.overlaps[0].b], [{ x: 4, y: 2 }, { x: 6, y: 2 }]);
  assert.equal(c.crossings.length, 0);
});

test('wires that only meet end to end do not conflict', () => {
  const c = PCB.wireConflicts([routed([[0, 0], [4, 0]]), routed([[4, 0], [8, 0]]), routed([[4, 0], [4, 5]])]);
  assert.equal(c.overlaps.length, 0);
  assert.equal(c.crossings.length, 0);
});

test('direct wire across a routed one is one crossing', () => {
  const r = routed([[0, 3], [10, 3]]);
  const d = direct([2, 0], [6, 7]);
  const c = PCB.wireConflicts([r, d]);
  assert.equal(c.crossings.length, 1);
  assert.equal(c.crossings[0].at.y, 3);
  assert.ok(Math.abs(c.crossings[0].at.x - (2 + 4 * 3 / 7)) < 1e-9);
  assert.deepEqual(PCB.crossingCounts(c), { [r.id]: 1, [d.id]: 1 });
});

test('a wire passing through the corner of another counts once', () => {
  const a = routed([[0, 0], [3, 0], [3, 3]]);
  const b = direct([2, -1], [4, 1]); // goes exactly through the corner (3,0)
  assert.equal(PCB.wireConflicts([a, b]).crossings.length, 1);
});

test('a wire crossing itself is found', () => {
  const w = routed([[0, 2], [4, 2], [4, 4], [2, 4], [2, 0]]);
  assert.equal(PCB.wireConflicts([w]).crossings.length, 1);
});

test('pin, bridge and wire end resolve to one connected group', () => {
  const fp = PCB.dip(8);
  const p = project({
    footprints: [fp],
    parts: [{ id: 'p1', footprintId: fp.id, ref: 'U1', x: 5, y: 5, rot: 0 }],
    bridges: [{ id: 'b1', a: { x: 5, y: 5 }, b: { x: 4, y: 5 } }],
    wires: [routed([[4, 5], [1, 5], [1, 9]]), routed([[20, 1], [22, 1]])],
  });
  const m = PCB.netMembers(p, { x: 1, y: 9 });
  assert.deepEqual([...m.holes].sort(), ['1,9', '4,5', '5,5']);
  assert.deepEqual(m.pins.map((x) => x.ref + '.' + x.name), ['U1.1']);
  assert.equal(m.wires.size, 1);
  assert.equal(m.bridges.size, 1);
  assert.equal(PCB.netMembers(p, { x: 15, y: 15 }).wires.size, 0);
});

test('DIP numbering and rotation', () => {
  const fp = PCB.dip(8);
  assert.deepEqual(fp.pins.map((p) => [p.x, p.y]), [[0, 0], [0, 1], [0, 2], [0, 3], [3, 3], [3, 2], [3, 1], [3, 0]]);
  assert.deepEqual(fp.body, { x: -0.5, y: -0.5, w: 4, h: 4 });
  const part = { x: 10, y: 10, rot: 1 };
  assert.deepEqual(PCB.partPins(part, fp)[1], { x: 9, y: 10, name: '2' });
  assert.deepEqual(PCB.partBody(part, fp), { x: 6.5, y: 9.5, w: 4, h: 4 });
  assert.deepEqual(PCB.rotatePoint({ x: 2, y: 1 }, 4), { x: 2, y: 1 });
});

test('issues: over a pin, across a part, dangling end, shared free hole, off board', () => {
  const fp = PCB.dip(8);
  const p = project({
    footprints: [fp],
    parts: [{ id: 'p1', footprintId: fp.id, ref: 'U1', x: 5, y: 5, rot: 0 }],
    wires: [
      routed([[2, 6], [10, 6]], 'A'),   // over pins 2 and 7 of U1
      routed([[5, 5], [5, 2]], 'B'),    // from pin 1 to a free hole: dangling
      routed([[12, 2], [15, 2]], 'C'),
      routed([[15, 2], [15, 8]], 'D'),  // C and D share free hole 15,2
      routed([[28, 0], [31, 0]], 'E'),  // off a 30-wide board
    ],
  });
  const kinds = PCB.findIssues(p).map((i) => i.kind);
  const count = (k) => kinds.filter((x) => x === k).length;
  assert.equal(count('over-pin'), 2);
  assert.equal(count('shared-hole'), 1);
  assert.equal(count('wire-off-board'), 1);
  // dangling: A both ends, B at 5,2, C at 12,2, D at 15,8, E both ends; not the shared hole
  assert.equal(count('dangling'), 7);
  assert.equal(PCB.findIssues(p)[0].level, 'error');
});

test('a wire to a pin or to a bridged hole is not dangling', () => {
  const fp = PCB.header(1, 4);
  const p = project({
    footprints: [fp],
    parts: [{ id: 'p1', footprintId: fp.id, ref: 'J1', x: 2, y: 2, rot: 0 }, { id: 'p2', footprintId: fp.id, ref: 'J2', x: 2, y: 8, rot: 0 }],
    bridges: [{ id: 'b1', a: { x: 2, y: 8 }, b: { x: 2, y: 7 } }],
    wires: [routed([[2, 2], [2, 7]])],
  });
  assert.deepEqual(PCB.findIssues(p), []);
});

test('overlapping parts and clashing pins are reported', () => {
  const fp = PCB.dip(8);
  const p = project({
    footprints: [fp],
    parts: [{ id: 'p1', footprintId: fp.id, ref: 'U1', x: 5, y: 5, rot: 0 }, { id: 'p2', footprintId: fp.id, ref: 'U2', x: 8, y: 5, rot: 0 }],
  });
  const kinds = PCB.findIssues(p).map((i) => i.kind);
  assert.ok(kinds.includes('pin-clash'));
  assert.ok(kinds.includes('part-overlap'));
});

test('build order: top routed, top direct, then bridges and bottom wires; manual order sticks', () => {
  const r1 = routed([[0, 0], [9, 0]]);
  const r2 = routed([[0, 1], [2, 1]]);
  const d1 = direct([0, 5], [1, 5]);
  const p = project({ wires: [d1, r1, r2], bridges: [{ id: 'b1', a: { x: 3, y: 3 }, b: { x: 4, y: 4 } }] });
  const under = { ...routed([[0, 7], [1, 7]]), side: 'bottom' };
  p.wires.push(under);
  assert.deepEqual(PCB.buildSteps(p).map((s) => s.id), [r2.id, r1.id, d1.id, 'b1', under.id]);
  PCB.moveStep(p, d1.id, r2.id);
  assert.deepEqual(PCB.buildSteps(p).map((s) => s.id), [d1.id, r2.id, r1.id, 'b1', under.id]);
  const r3 = routed([[0, 9], [1, 9]]);
  p.wires.push(r3);
  assert.equal(PCB.buildSteps(p).at(-1).id, r3.id);
});

test('editing a route: move an end, slide a segment, add a jog', () => {
  const pts = (list) => list.map(([x, y]) => ({ x, y }));
  assert.deepEqual(PCB.moveRouteEnd(pts([[0, 0], [5, 0]]), 'end', { x: 5, y: 3 }), pts([[0, 0], [5, 0], [5, 3]]));
  assert.deepEqual(PCB.moveRouteEnd(pts([[0, 0], [5, 0], [5, 3]]), 'start', { x: 1, y: 1 }), pts([[1, 1], [5, 1], [5, 3]]));
  // Sliding the only segment keeps both ends in place and makes a U.
  assert.deepEqual(PCB.moveRouteSegment(pts([[0, 0], [5, 0]]), 0, { x: 2, y: 2 }), pts([[0, 0], [0, 2], [5, 2], [5, 0]]));
  // Sliding a middle segment just moves it.
  assert.deepEqual(PCB.moveRouteSegment(pts([[0, 0], [0, 2], [5, 2], [5, 0]]), 1, { x: 3, y: 4 }), pts([[0, 0], [0, 4], [5, 4], [5, 0]]));
  const jog = PCB.jogRouteSegment(pts([[0, 0], [6, 0]]), 0, { x: 3, y: 0 });
  assert.deepEqual(jog, pts([[0, 0], [3, 0], [3, 1], [6, 1], [6, 0]]));
  assert.ok(PCB.isOrthogonal(jog));
  assert.equal(PCB.segmentIndexAt(jog, { x: 4, y: 1 }), 2);
});

test('bridges: holes covered and snapping to straight lines', () => {
  assert.deepEqual(PCB.bridgeHoles({ a: { x: 1, y: 1 }, b: { x: 3, y: 3 } }), [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
  assert.deepEqual(PCB.snapBridgeEnd({ x: 0, y: 0 }, { x: 5, y: 1 }), { x: 5, y: 0 });
  assert.deepEqual(PCB.snapBridgeEnd({ x: 0, y: 0 }, { x: 3, y: -4 }), { x: 4, y: -4 });
});

test('save and load round-trips; bad files are rejected with a reason', () => {
  const fp = PCB.dip(8);
  const p = project({
    footprints: [fp],
    parts: [{ id: 'p1', footprintId: fp.id, ref: 'U1', x: 5, y: 5, rot: 3 }],
    wires: [routed([[0, 0], [3, 0], [3, 4]]), direct([1, 1], [8, 9])],
    bridges: [{ id: 'b1', a: { x: 5, y: 5 }, b: { x: 4, y: 5 } }],
  });
  p.build.done.b1 = true;
  assert.deepEqual(PCB.fromJSON(PCB.toJSON(p)), p);

  const broken = (change) => {
    const copy = PCB.clone(p);
    change(copy);
    return () => PCB.fromJSON(JSON.stringify(copy));
  };
  assert.throws(() => PCB.fromJSON('nope'), /not JSON/);
  assert.throws(broken((c) => { c.version = 99; }), /version/);
  assert.throws(broken((c) => { c.board.cols = 5000; }), /board size/);
  assert.throws(broken((c) => { c.parts[0].footprintId = 'gone'; }), /footprint/);
  assert.throws(broken((c) => { c.wires[0].points[1] = { x: 4, y: 1 }; }), /slanted/);
  assert.throws(broken((c) => { c.bridges[0].b = { x: 9, y: 6 }; }), /straight/);
  const odd = PCB.clone(p);
  odd.wires[0].color = 'url(javascript:1)';
  assert.equal(PCB.fromJSON(JSON.stringify(odd)).wires[0].color, PCB.WIRE_COLORS[0].value);
});

test('cut list rows and CSV', () => {
  const p = project({ wires: [routed([[0, 2], [5, 2]], 'W1'), direct([2, 0], [2, 5], '=evil')] });
  const rows = PCB.cutListRows(p);
  assert.deepEqual(rows.map((r) => [r.from, r.to, r.lengthMm, r.bends, r.crossings]), [['C1', 'C6', 19, 0, 1], ['A3', 'F3', 20, 0, 1]]);
  const csv = PCB.cutListCSV(p).split('\n');
  assert.equal(csv[1], 'W1,Red,routed,top,C1,C6,19,3,0,1');
  assert.ok(csv[2].startsWith("'=evil,Blue,direct,"));
});

test('wires on opposite sides do not conflict, and bottom wires ignore part bodies', () => {
  const top = routed([[0, 2], [6, 2]]);
  const under = { ...routed([[3, 0], [3, 5]]), side: 'bottom' };
  const along = { ...routed([[2, 2], [8, 2]]), side: 'bottom' };
  const c = PCB.wireConflicts([top, under, along]);
  assert.equal(c.overlaps.length, 0);
  assert.deepEqual(c.crossings.map((x) => x.side), ['bottom']); // only the two bottom wires meet

  // A DIP-8 at (5,5) has pins in columns 5 and 8, so column 6 runs under its body without touching a pin.
  const fp = PCB.dip(8);
  const mk = (side) => project({
    footprints: [fp],
    parts: [{ id: 'p1', footprintId: fp.id, ref: 'U1', x: 5, y: 5, rot: 0 }],
    wires: [{ ...routed([[6, 2], [6, 12]], 'A'), side }],
  });
  assert.ok(PCB.findIssues(mk('top')).some((i) => i.kind === 'over-part'));
  assert.ok(!PCB.findIssues(mk('bottom')).some((i) => i.kind === 'over-part'));
});

test('files saved before wires had a side load as top-side wires', () => {
  const p = project({ wires: [routed([[0, 0], [3, 0]])] });
  const raw = JSON.parse(PCB.toJSON(p));
  delete raw.wires[0].side;
  assert.equal(PCB.fromJSON(JSON.stringify(raw)).wires[0].side, 'top');
  raw.wires[0].side = 'bottom';
  assert.equal(PCB.fromJSON(JSON.stringify(raw)).wires[0].side, 'bottom');
  assert.equal(PCB.cutListRows(PCB.fromJSON(JSON.stringify(raw)))[0].side, 'bottom');
});

test('hole labels', () => {
  assert.equal(PCB.holeLabel({ x: 0, y: 0 }), 'A1');
  assert.equal(PCB.holeLabel({ x: 6, y: 25 }), 'Z7');
  assert.equal(PCB.holeLabel({ x: 0, y: 26 }), 'AA1');
});

// ---------- the page, in Chrome ----------

// Mouse input through DevTools, at a hole's position on screen.
async function board(p) {
  for (let i = 0; i < 100 && !(await p.evalJson("!!document.querySelector('.pb-board-svg > g')")); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const at = (x, y) => p.evalJson(`(() => {
    const m = document.querySelector('.pb-board-svg > g').getScreenCTM();
    const q = new DOMPoint(${x} * 10, ${y} * 10).matrixTransform(m);
    return { x: q.x, y: q.y };
  })()`);
  const mouse = (type, q, held) => p.send('Input.dispatchMouseEvent', {
    type, x: q.x, y: q.y, button: type === 'mouseMoved' && !held ? 'none' : 'left',
    buttons: type === 'mouseReleased' || (type === 'mouseMoved' && !held) ? 0 : 1, clickCount: 1,
  });
  const drag = async (a, b) => {
    await mouse('mouseMoved', a);
    await mouse('mousePressed', a);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', { x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }, true);
    await mouse('mouseReleased', b);
  };
  const key = async (k) => {
    const params = { key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) };
    await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, params));
    await p.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, params));
  };
  return { at, drag, key, state: () => p.evalJson('PCB.store.state') };
}

async function fresh(p) {
  await p.evalJson("(localStorage.removeItem('perfboard-project'), localStorage.removeItem('perfboard-layers'), localStorage.removeItem('perfboard-picture'), true)");
  await p.send('Page.reload');
  await new Promise((r) => setTimeout(r, 300));
  // The web fonts move the parts list when they arrive, so measure after them.
  for (let i = 0; i < 100 && !(await p.evalJson("document.readyState === 'complete' && document.fonts.status === 'loaded'")); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return board(p);
}

test('a part dropped on the board and a wire drawn to it make the cut list',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/perfboard/', async (p) => {
    await p.setViewport(1400, 1000);
    const b = await fresh(p);
    const pick = await p.evalJson("(() => { const r = document.querySelector('.pb-fp-pick').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
    await b.drag(pick, await b.at(10, 5));
    await b.key('w');
    await b.drag(await b.at(4, 9), await b.at(9, 9));
    const s = await b.state();
    assert.equal(s.project.parts.length, 1);
    assert.equal(s.project.wires.length, 1);
    assert.deepEqual(s.project.wires[0].points, [{ x: 4, y: 9 }, { x: 9, y: 9 }]);
    assert.equal(s.project.wires[0].side, 'top');
    // 5 pitches = 12.7 mm, plus 3 mm at each end, rounded up.
    assert.equal(await p.evalJson("document.querySelector('.pb-cut-list tbody td.num').textContent"), '19 mm');
    // Survives a reload.
    await p.send('Page.reload');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await p.evalJson('PCB.store.state.project.wires.length'), 1);
  });
});

test('a wire drawn in the bottom view goes on the bottom, and hidden layers cannot be picked',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/perfboard/', async (p) => {
    await p.setViewport(1400, 1000);
    const b = await fresh(p);
    await b.key('f');
    await b.key('w');
    await b.drag(await b.at(2, 2), await b.at(2, 8));
    await b.key('v');
    let s = await b.state();
    assert.equal(s.ui.view, 'bottom');
    assert.equal(s.project.wires[0].side, 'bottom');
    await p.evalJson("(document.querySelector('#layers-list input[value=\"bottomWires\"]').click(), true)");
    const mid = await b.at(2, 5);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mid.x, y: mid.y, button: 'left', buttons: 1, clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mid.x, y: mid.y, button: 'left', buttons: 0, clickCount: 1 });
    s = await b.state();
    assert.equal(s.ui.selection, null);
    assert.equal(await p.evalJson("document.querySelector('#layers-menu summary').getAttribute('aria-label')"), 'Layers, 1 hidden');
  });
});

test('a picture opens in a window that hides and remembers its marks',
  { skip: !CHROME && 'no Chrome' }, async () => {
  await withPage('/tools/perfboard/', async (p) => {
    await p.setViewport(1400, 1000);
    await fresh(p);
    // evalJson does not wait for a promise, so the paste runs in the page and the test waits here.
    await p.evalJson(`((() => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 200;
      c.getContext('2d').fillRect(0, 0, 300, 200);
      c.toBlob((blob) => {
        const dt = new DataTransfer(); dt.items.add(new File([blob], 'schematic.png', { type: 'image/png' }));
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      }, 'image/png');
    })(), true)`);
    for (let i = 0; i < 60 && !(await p.evalJson("document.querySelector('.pb-picture-title').textContent")); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(await p.evalJson("document.querySelector('.pb-picture-title').textContent"), 'schematic.png');
    assert.equal(await p.evalJson("document.getElementById('picture').textContent"), 'hide picture');
    await p.evalJson("(document.getElementById('picture').click(), true)");
    assert.equal(await p.evalJson("document.querySelector('.pb-picture-win').hidden"), true);
    const saved = await p.evalJson("JSON.parse(localStorage.getItem('perfboard-picture'))");
    assert.equal(saved.hidden, true);
    assert.deepEqual(saved.marks, []);
  });
});
