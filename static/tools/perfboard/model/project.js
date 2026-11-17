// Data shapes and factories. Coordinates are hole indices: x = column, y = row, (0,0) top-left.
//
// Project   { version, name, board:{cols,rows}, footprints[], parts[], wires[], bridges[],
//             settings:{endAllowanceMm, slackPct}, build:{order[]|null, done:{id:true}} }
// Footprint { id, name, prefix, pins:[{x,y,name}], body:{x,y,w,h} }   body is in hole units
// Part      { id, footprintId, ref, x, y, rot }                        rot = quarter turns clockwise
// Wire      { id, label, color, mode:'routed'|'direct', side:'top'|'bottom', points:[{x,y},...] }
//           side is where the wire lies; files from before sides existed have none, meaning top
// Bridge    { id, a:{x,y}, b:{x,y} }   straight (horizontal, vertical or 45 degrees), bottom side
(function (PCB) {
  'use strict';

  const PITCH_MM = 2.54;
  const VERSION = 1;
  const MAX_BOARD = 100;

  const WIRE_COLORS = [
    { name: 'Red', value: '#d8342b' },
    { name: 'Black', value: '#22252a' },
    { name: 'Blue', value: '#2f6fd6' },
    { name: 'Green', value: '#2f9e53' },
    { name: 'Yellow', value: '#e6c229' },
    { name: 'Orange', value: '#ec7f1d' },
    { name: 'White', value: '#f1efe6' },
    { name: 'Purple', value: '#8a4fc9' },
    { name: 'Brown', value: '#7a4a2b' },
    { name: 'Grey', value: '#8d9298' },
  ];

  let idCounter = 0;
  function uid(prefix) {
    idCounter += 1;
    return prefix + Date.now().toString(36) + idCounter.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  function defaultSettings() {
    return { endAllowanceMm: 3, slackPct: 10 };
  }

  function newProject(name, cols, rows, footprints) {
    return {
      version: VERSION,
      name: name || 'Untitled board',
      board: { cols: cols || 30, rows: rows || 20 },
      footprints: footprints ? clone(footprints) : [],
      parts: [],
      wires: [],
      bridges: [],
      settings: defaultSettings(),
      build: { order: null, done: {} },
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function footprintById(project, id) {
    return project.footprints.find((f) => f.id === id) || null;
  }

  // Next free reference such as U1, U2 for a footprint prefix.
  function nextRef(project, prefix) {
    const used = new Set(project.parts.map((p) => p.ref));
    let n = 1;
    while (used.has(prefix + n)) n += 1;
    return prefix + n;
  }

  function nextWireLabel(project) {
    const used = new Set(project.wires.map((w) => w.label));
    let n = 1;
    while (used.has('W' + n)) n += 1;
    return 'W' + n;
  }

  // Row letters like a spreadsheet: A..Z, AA, AB...
  function rowLabel(y) {
    let s = '';
    let n = y;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  }

  function holeLabel(h) {
    return rowLabel(h.y) + (h.x + 1);
  }

  function wireSide(wire) {
    return wire.side === 'bottom' ? 'bottom' : 'top';
  }

  // What can be shown or hidden on the board, in menu order.
  const LAYERS = [
    { id: 'parts', name: 'Parts' },
    { id: 'topWires', name: 'Top wires' },
    { id: 'bottomWires', name: 'Bottom wires' },
    { id: 'bridges', name: 'Solder bridges' },
    { id: 'marks', name: 'Overlap and crossing marks' },
    { id: 'labels', name: 'Row and column labels' },
  ];

  function allLayers() {
    const out = {};
    for (const l of LAYERS) out[l.id] = true;
    return out;
  }

  // The layer an item is drawn on: a selection { kind, id } or a build step's id.
  function layerOf(project, kind, id) {
    if (kind === 'part') return 'parts';
    if (kind === 'bridge') return 'bridges';
    const wire = project.wires.find((w) => w.id === id);
    if (wire) return wireSide(wire) === 'bottom' ? 'bottomWires' : 'topWires';
    if (project.bridges.some((b) => b.id === id)) return 'bridges';
    return null;
  }

  function key(h) {
    return h.x + ',' + h.y;
  }

  Object.assign(PCB, {
    PITCH_MM, VERSION, MAX_BOARD, WIRE_COLORS,
    uid, defaultSettings, newProject, clone, footprintById, nextRef, nextWireLabel,
    rowLabel, holeLabel, key, wireSide, LAYERS, allLayers, layerOf,
  });
})(globalThis.PCB = globalThis.PCB || {});
