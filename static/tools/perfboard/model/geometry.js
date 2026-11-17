// Wire maths: routes, lengths, bends, overlaps and crossings. All inputs are integer hole coordinates,
// so the orientation tests below are exact.
(function (PCB) {
  'use strict';

  const same = (a, b) => a.x === b.x && a.y === b.y;

  // L-shaped route between two holes.
  function lRoute(a, b, horizontalFirst) {
    const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    return normalizeRoute([a, corner, b]);
  }

  // Drop repeated points and points that sit in the middle of a straight run.
  function normalizeRoute(points) {
    const out = points.map((p) => ({ x: p.x, y: p.y }));
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = out.length - 1; i >= 1; i--) {
        if (same(out[i - 1], out[i]) && out.length > 2) {
          out.splice(i, 1);
          changed = true;
        }
      }
      // A point on the line through its neighbours adds nothing, whether the wire carries on
      // or doubles back over itself.
      for (let i = out.length - 2; i >= 1; i--) {
        if (orient(out[i - 1], out[i], out[i + 1]) === 0) {
          out.splice(i, 1);
          changed = true;
        }
      }
    }
    return out;
  }

  function isOrthogonal(points) {
    for (let i = 1; i < points.length; i++) {
      if (points[i].x !== points[i - 1].x && points[i].y !== points[i - 1].y) return false;
    }
    return true;
  }

  function segments(wire) {
    const pts = wire.mode === 'direct' ? [wire.points[0], wire.points[wire.points.length - 1]] : wire.points;
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      if (!same(pts[i - 1], pts[i])) out.push({ a: pts[i - 1], b: pts[i] });
    }
    return out;
  }

  function wireEnds(wire) {
    return [wire.points[0], wire.points[wire.points.length - 1]];
  }

  // Length in hole pitches.
  function pitchLength(wire) {
    return segments(wire).reduce((sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0);
  }

  // Length to cut, in whole millimetres, rounded up.
  function cutLengthMm(wire, settings) {
    const s = settings || PCB.defaultSettings();
    let mm = pitchLength(wire) * PCB.PITCH_MM;
    if (wire.mode === 'direct') mm *= 1 + s.slackPct / 100;
    mm += 2 * s.endAllowanceMm;
    return Math.ceil(mm - 1e-9);
  }

  // Corners in a routed wire. The two bends down into the holes are not counted.
  function bendCount(wire) {
    if (wire.mode === 'direct') return 0;
    const segs = segments(wire);
    let bends = 0;
    for (let i = 1; i < segs.length; i++) {
      const p = segs[i - 1];
      const q = segs[i];
      const cross = (p.b.x - p.a.x) * (q.b.y - q.a.y) - (p.b.y - p.a.y) * (q.b.x - q.a.x);
      if (cross !== 0) bends += 1;
    }
    return bends;
  }

  // Every hole a routed wire lies on, ends included, in order.
  function holesAlong(wire) {
    if (wire.mode === 'direct') return wireEnds(wire).map((p) => ({ x: p.x, y: p.y }));
    const out = [];
    const push = (p) => {
      if (!out.length || !same(out[out.length - 1], p)) out.push({ x: p.x, y: p.y });
    };
    for (const s of segments(wire)) {
      const dx = Math.sign(s.b.x - s.a.x);
      const dy = Math.sign(s.b.y - s.a.y);
      let p = { x: s.a.x, y: s.a.y };
      push(p);
      while (!same(p, s.b)) {
        p = { x: p.x + dx, y: p.y + dy };
        push(p);
      }
    }
    return out;
  }

  // Holes joined by a straight bridge (horizontal, vertical or 45 degrees).
  function bridgeHoles(bridge) {
    const dx = Math.sign(bridge.b.x - bridge.a.x);
    const dy = Math.sign(bridge.b.y - bridge.a.y);
    const n = Math.max(Math.abs(bridge.b.x - bridge.a.x), Math.abs(bridge.b.y - bridge.a.y));
    const out = [];
    for (let i = 0; i <= n; i++) out.push({ x: bridge.a.x + dx * i, y: bridge.a.y + dy * i });
    return out;
  }

  // Snap a bridge end to the nearest of the 8 straight directions from its start.
  function snapBridgeEnd(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax >= 2 * ay) return { x: b.x, y: a.y };
    if (ay >= 2 * ax) return { x: a.x, y: b.y };
    const n = Math.max(ax, ay);
    return { x: a.x + Math.sign(dx) * n, y: a.y + Math.sign(dy) * n };
  }

  const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const within = (a, b, p) =>
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);

  // How two segments meet:
  //   null                          apart, or only touching end to end
  //   { type:'cross', at }          they meet at one point that is inside at least one of them
  //   { type:'overlap', a, b }      they run along the same line for a stretch
  function segmentRelation(s, t) {
    const d1 = orient(s.a, s.b, t.a);
    const d2 = orient(s.a, s.b, t.b);
    const d3 = orient(t.a, t.b, s.a);
    const d4 = orient(t.a, t.b, s.b);

    if (d1 === 0 && d2 === 0) {
      // Collinear: project on the dominant axis and intersect the intervals.
      const axis = Math.abs(s.b.x - s.a.x) >= Math.abs(s.b.y - s.a.y) ? 'x' : 'y';
      const sorted = (u) => (u.a[axis] <= u.b[axis] ? [u.a, u.b] : [u.b, u.a]);
      const [s0, s1] = sorted(s);
      const [t0, t1] = sorted(t);
      const lo = s0[axis] >= t0[axis] ? s0 : t0;
      const hi = s1[axis] <= t1[axis] ? s1 : t1;
      if (lo[axis] < hi[axis]) return { type: 'overlap', a: { x: lo.x, y: lo.y }, b: { x: hi.x, y: hi.y } };
      return null;
    }

    const proper = ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    if (proper) {
      const t0 = d1 / (d1 - d2);
      return { type: 'cross', at: { x: t.a.x + (t.b.x - t.a.x) * t0, y: t.a.y + (t.b.y - t.a.y) * t0 } };
    }

    // T-shaped touch: an end of one segment lies strictly inside the other.
    const inside = (u, p, d) => d === 0 && within(u.a, u.b, p) && !same(u.a, p) && !same(u.b, p);
    if (inside(s, t.a, d1)) return { type: 'cross', at: { x: t.a.x, y: t.a.y } };
    if (inside(s, t.b, d2)) return { type: 'cross', at: { x: t.b.x, y: t.b.y } };
    if (inside(t, s.a, d3)) return { type: 'cross', at: { x: s.a.x, y: s.a.y } };
    if (inside(t, s.b, d4)) return { type: 'cross', at: { x: s.b.x, y: s.b.y } };
    return null;
  }

  // Crossings and overlaps between every pair of wires on the same side of the board (and within
  // one wire). Returns { crossings:[{wireA, wireB, at, side}], overlaps:[{wireA, wireB, a, b, side}] }
  // with wire ids.
  function wireConflicts(wires) {
    const crossings = [];
    const overlaps = [];
    const segs = wires.map(segments);
    for (let i = 0; i < wires.length; i++) {
      const side = PCB.wireSide(wires[i]);
      for (let j = i; j < wires.length; j++) {
        if (PCB.wireSide(wires[j]) !== side) continue;
        const seen = new Set();
        for (let m = 0; m < segs[i].length; m++) {
          for (let n = i === j ? m + 2 : 0; n < segs[j].length; n++) {
            const rel = segmentRelation(segs[i][m], segs[j][n]);
            if (!rel) continue;
            if (rel.type === 'overlap') {
              overlaps.push({ wireA: wires[i].id, wireB: wires[j].id, a: rel.a, b: rel.b, side });
            } else {
              const k = rel.at.x.toFixed(3) + ',' + rel.at.y.toFixed(3);
              if (seen.has(k)) continue;
              seen.add(k);
              crossings.push({ wireA: wires[i].id, wireB: wires[j].id, at: rel.at, side });
            }
          }
        }
      }
    }
    return { crossings, overlaps };
  }

  // Number of crossings each wire takes part in: { wireId: count }.
  function crossingCounts(conflicts) {
    const counts = {};
    for (const c of conflicts.crossings) {
      counts[c.wireA] = (counts[c.wireA] || 0) + 1;
      if (c.wireB !== c.wireA) counts[c.wireB] = (counts[c.wireB] || 0) + 1;
    }
    return counts;
  }

  function pointInRect(p, r) {
    const eps = 1e-9;
    return p.x > r.x - eps && p.x < r.x + r.w + eps && p.y > r.y - eps && p.y < r.y + r.h + eps;
  }

  function rectsOverlap(a, b) {
    const eps = 1e-9;
    return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
  }

  // --- Editing helpers for routed wires (each returns a new, normalized point list) ---

  // Move one end of a route to a new hole.
  function moveRouteEnd(points, which, to) {
    const pts = which === 'start' ? points.slice().reverse() : points.slice();
    let out;
    if (pts.length <= 3) {
      const first = pts[0];
      const horizontalFirst = pts.length < 2 || same(pts[0], pts[1]) ? true : pts[1].y === first.y;
      out = lRoute(first, to, horizontalFirst);
    } else {
      const n = pts[pts.length - 2];
      const e = pts[pts.length - 1];
      const corner = n.y === e.y ? { x: to.x, y: n.y } : { x: n.x, y: to.y };
      out = normalizeRoute(pts.slice(0, -1).concat([corner, to]));
    }
    if (which === 'start') out.reverse();
    return out;
  }

  // Slide segment `index` sideways so it passes through `to`. Wire ends stay where they are.
  function moveRouteSegment(points, index, to) {
    const pts = points.map((p) => ({ x: p.x, y: p.y }));
    const a = pts[index];
    const b = pts[index + 1];
    if (!a || !b) return normalizeRoute(pts);
    const horizontal = a.y === b.y;
    const na = horizontal ? { x: a.x, y: to.y } : { x: to.x, y: a.y };
    const nb = horizontal ? { x: b.x, y: to.y } : { x: to.x, y: b.y };
    const out = pts.slice(0, index);
    if (index === 0) out.push(a);
    out.push(na, nb);
    if (index + 1 === pts.length - 1) out.push(b);
    return normalizeRoute(out.concat(pts.slice(index + 2)));
  }

  // Put a one-hole step into segment `index` at hole h, giving two new corners to drag around.
  function jogRouteSegment(points, index, h) {
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b || same(h, b)) return normalizeRoute(points);
    const horizontal = a.y === b.y;
    const split = points.slice(0, index + 1).concat([{ x: h.x, y: h.y }, { x: h.x, y: h.y }], points.slice(index + 1));
    const to = horizontal ? { x: h.x, y: h.y + 1 } : { x: h.x + 1, y: h.y };
    return moveRouteSegment(split, index + 2, to);
  }

  // Index of the routed segment that passes through hole h, or -1.
  function segmentIndexAt(points, h) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (orient(a, b, h) === 0 && within(a, b, h)) return i - 1;
    }
    return -1;
  }

  Object.assign(PCB, {
    lRoute, normalizeRoute, isOrthogonal, segments, wireEnds, pitchLength, cutLengthMm, bendCount,
    holesAlong, bridgeHoles, snapBridgeEnd, segmentRelation, wireConflicts, crossingCounts,
    pointInRect, rectsOverlap, moveRouteEnd, moveRouteSegment, jogRouteSegment, segmentIndexAt,
  });
})(globalThis.PCB = globalThis.PCB || {});
