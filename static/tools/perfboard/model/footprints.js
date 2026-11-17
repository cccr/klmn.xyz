// Footprint generators and placement maths (rotation, absolute pins and bodies).
(function (PCB) {
  'use strict';

  const BODY_MARGIN = 0.5;

  // Body that hugs the pins with half a hole of margin.
  function autoBody(pins) {
    if (!pins.length) return { x: -BODY_MARGIN, y: -BODY_MARGIN, w: 1, h: 1 };
    const xs = pins.map((p) => p.x);
    const ys = pins.map((p) => p.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return {
      x: x0 - BODY_MARGIN,
      y: y0 - BODY_MARGIN,
      w: Math.max(...xs) - x0 + 2 * BODY_MARGIN,
      h: Math.max(...ys) - y0 + 2 * BODY_MARGIN,
    };
  }

  // Shift pins and body so the top-left pin sits at (0,0).
  function normalizeFootprint(fp) {
    if (!fp.pins.length) return fp;
    const dx = Math.min(...fp.pins.map((p) => p.x));
    const dy = Math.min(...fp.pins.map((p) => p.y));
    fp.pins = fp.pins.map((p) => ({ x: p.x - dx, y: p.y - dy, name: p.name }));
    fp.body = { x: fp.body.x - dx, y: fp.body.y - dy, w: fp.body.w, h: fp.body.h };
    return fp;
  }

  function make(name, prefix, pins) {
    return { id: PCB.uid('f'), name, prefix, pins, body: autoBody(pins) };
  }

  // DIP: pins numbered down the left column and back up the right one.
  function dip(pinCount, rowSpacing) {
    const half = Math.max(1, Math.floor(pinCount / 2));
    const spacing = rowSpacing || 3;
    const pins = [];
    for (let i = 0; i < half; i++) pins.push({ x: 0, y: i, name: String(i + 1) });
    for (let i = 0; i < half; i++) pins.push({ x: spacing, y: half - 1 - i, name: String(half + i + 1) });
    return make('DIP-' + half * 2, 'U', pins);
  }

  function header(rows, cols) {
    const pins = [];
    let n = 1;
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) pins.push({ x, y, name: String(n++) });
    }
    return make('Header ' + rows + '×' + cols, 'J', pins);
  }

  function twoLead(pitch, name, prefix) {
    const span = Math.max(1, pitch);
    const fp = make(name || 'Two-lead ' + span, prefix || 'R', [
      { x: 0, y: 0, name: '1' },
      { x: span, y: 0, name: '2' },
    ]);
    return fp;
  }

  function defaultLibrary() {
    return [
      dip(8), dip(14), dip(16),
      header(1, 4), header(1, 6), header(2, 4),
      twoLead(4, 'Resistor', 'R'),
      twoLead(2, 'Capacitor', 'C'),
      twoLead(1, 'LED', 'D'),
    ];
  }

  // Quarter turns clockwise on screen (y grows downwards): (x, y) -> (-y, x).
  function rotatePoint(p, rot) {
    let x = p.x;
    let y = p.y;
    for (let i = 0; i < (((rot % 4) + 4) % 4); i++) {
      const nx = -y;
      y = x;
      x = nx;
    }
    return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
  }

  function partPins(part, fp) {
    return fp.pins.map((pin) => {
      const r = rotatePoint(pin, part.rot);
      return { x: part.x + r.x, y: part.y + r.y, name: pin.name };
    });
  }

  function partBody(part, fp) {
    const a = rotatePoint({ x: fp.body.x, y: fp.body.y }, part.rot);
    const b = rotatePoint({ x: fp.body.x + fp.body.w, y: fp.body.y + fp.body.h }, part.rot);
    return {
      x: part.x + Math.min(a.x, b.x),
      y: part.y + Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }

  // Every placed part with its absolute pins and body; parts with a missing footprint are skipped.
  function placedParts(project) {
    const out = [];
    for (const part of project.parts) {
      const fp = PCB.footprintById(project, part.footprintId);
      if (!fp) continue;
      out.push({ part, fp, pins: partPins(part, fp), body: partBody(part, fp) });
    }
    return out;
  }

  Object.assign(PCB, {
    autoBody, normalizeFootprint, dip, header, twoLead, defaultLibrary,
    rotatePoint, partPins, partBody, placedParts,
  });
})(globalThis.PCB = globalThis.PCB || {});
