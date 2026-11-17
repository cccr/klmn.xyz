// Save and load projects as JSON. Loading checks everything, because files can come from anywhere.
(function (PCB) {
  'use strict';

  function toJSON(project) {
    return JSON.stringify(project, null, 2);
  }

  function fail(msg) {
    throw new Error('Not a valid board file: ' + msg);
  }

  const isInt = (n) => Number.isInteger(n) && Math.abs(n) <= 10000;
  const isNum = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000;
  const str = (s, fallback, max) => (typeof s === 'string' && s.trim() ? s.slice(0, max || 60) : fallback);

  function point(p, what) {
    if (!p || !isInt(p.x) || !isInt(p.y)) fail(what + ' has a bad hole position');
    return { x: p.x, y: p.y };
  }

  function fromJSON(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      fail('the file is not JSON');
    }
    if (!raw || typeof raw !== 'object') fail('unexpected content');
    if (raw.version !== PCB.VERSION) fail('unsupported version ' + raw.version);
    const b = raw.board || {};
    if (!isInt(b.cols) || !isInt(b.rows) || b.cols < 1 || b.rows < 1 || b.cols > PCB.MAX_BOARD || b.rows > PCB.MAX_BOARD) {
      fail('board size must be between 1 and ' + PCB.MAX_BOARD + ' holes each way');
    }

    const project = PCB.newProject(str(raw.name, 'Untitled board'), b.cols, b.rows);
    const ids = new Set();
    const id = (value, what) => {
      if (typeof value !== 'string' || !/^[\w-]{1,40}$/.test(value)) fail(what + ' has a bad id');
      if (ids.has(value)) fail('duplicate id ' + value);
      ids.add(value);
      return value;
    };
    const list = (value, what) => {
      if (value === undefined) return [];
      if (!Array.isArray(value)) fail(what + ' should be a list');
      return value;
    };

    for (const f of list(raw.footprints, 'footprints')) {
      const pins = list(f.pins, 'footprint pins').map((p, i) => ({ ...point(p, 'A footprint pin'), name: str(p.name, String(i + 1), 12) }));
      if (!pins.length) fail('a footprint has no pins');
      const body = f.body && [f.body.x, f.body.y, f.body.w, f.body.h].every(isNum) && f.body.w > 0 && f.body.h > 0
        ? { x: f.body.x, y: f.body.y, w: f.body.w, h: f.body.h }
        : PCB.autoBody(pins);
      project.footprints.push({ id: id(f.id, 'A footprint'), name: str(f.name, 'Part'), prefix: str(f.prefix, 'U', 4), pins, body });
    }
    const footprintIds = new Set(project.footprints.map((f) => f.id));

    for (const p of list(raw.parts, 'parts')) {
      if (!footprintIds.has(p.footprintId)) fail('a part uses a footprint that is not in the file');
      const pos = point(p, 'A part');
      project.parts.push({
        id: id(p.id, 'A part'), footprintId: p.footprintId, ref: str(p.ref, '?', 12),
        x: pos.x, y: pos.y, rot: isInt(p.rot) ? ((p.rot % 4) + 4) % 4 : 0,
      });
    }

    for (const w of list(raw.wires, 'wires')) {
      const mode = w.mode === 'direct' ? 'direct' : 'routed';
      let points = list(w.points, 'wire points').map((p) => point(p, 'A wire'));
      if (points.length < 2) fail('a wire needs two ends');
      if (mode === 'direct') points = [points[0], points[points.length - 1]];
      else if (!PCB.isOrthogonal(points)) fail('a routed wire has a slanted segment');
      const first = points[0];
      const last = points[points.length - 1];
      if (first.x === last.x && first.y === last.y) fail('a wire starts and ends in the same hole');
      project.wires.push({
        id: id(w.id, 'A wire'), label: str(w.label, 'W', 16),
        color: typeof w.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(w.color) ? w.color : PCB.WIRE_COLORS[0].value,
        mode, side: w.side === 'bottom' ? 'bottom' : 'top', points,
      });
    }

    for (const br of list(raw.bridges, 'bridges')) {
      const a = point(br.a, 'A bridge');
      const e = point(br.b, 'A bridge');
      const dx = Math.abs(a.x - e.x);
      const dy = Math.abs(a.y - e.y);
      if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0 && dx !== dy)) fail('a solder bridge is not straight');
      project.bridges.push({ id: id(br.id, 'A bridge'), a, b: e });
    }

    const s = raw.settings || {};
    if (isNum(s.endAllowanceMm) && s.endAllowanceMm >= 0 && s.endAllowanceMm <= 50) project.settings.endAllowanceMm = s.endAllowanceMm;
    if (isNum(s.slackPct) && s.slackPct >= 0 && s.slackPct <= 200) project.settings.slackPct = s.slackPct;

    const build = raw.build || {};
    if (Array.isArray(build.order)) project.build.order = build.order.filter((x) => ids.has(x));
    if (build.done && typeof build.done === 'object') {
      for (const k of Object.keys(build.done)) if (ids.has(k) && build.done[k]) project.build.done[k] = true;
    }
    return project;
  }

  function cutListRows(project, conflicts) {
    const counts = PCB.crossingCounts(conflicts || PCB.wireConflicts(project.wires));
    return project.wires.map((w) => {
      const [a, b] = PCB.wireEnds(w);
      return {
        id: w.id, label: w.label, color: w.color, mode: w.mode, side: PCB.wireSide(w),
        from: PCB.holeLabel(a), to: PCB.holeLabel(b),
        lengthMm: PCB.cutLengthMm(w, project.settings),
        bends: PCB.bendCount(w), crossings: counts[w.id] || 0,
      };
    });
  }

  function colorName(value) {
    const hit = PCB.WIRE_COLORS.find((c) => c.value.toLowerCase() === String(value).toLowerCase());
    return hit ? hit.name : value;
  }

  function cutListCSV(project) {
    const cell = (v) => {
      let s = String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheets from treating a label as a formula
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [['Wire', 'Colour', 'Type', 'Side', 'From', 'To', 'Cut length (mm)', 'Strip each end (mm)', 'Bends', 'Crossings']];
    for (const r of cutListRows(project)) {
      lines.push([r.label, colorName(r.color), r.mode, r.side, r.from, r.to, r.lengthMm, project.settings.endAllowanceMm, r.bends, r.crossings]);
    }
    return lines.map((l) => l.map(cell).join(',')).join('\n') + '\n';
  }

  Object.assign(PCB, { toJSON, fromJSON, cutListRows, cutListCSV, colorName });
})(globalThis.PCB = globalThis.PCB || {});
