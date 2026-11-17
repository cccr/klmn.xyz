// The board on screen: zoom, pan and the pointer tools. Hit-testing is done from hole coordinates
// against the model, so the SVG can be redrawn freely in the middle of a drag.
(function (PCB) {
  'use strict';

  const { s, store } = PCB;
  const R = PCB.render;
  const P = R.P;

  let svg, scene, overlay, readout, statusEl, wrap;
  let vb = null;            // current viewBox
  let boardKey = '';        // board size + view the viewBox was fitted for
  let drag = null;          // interaction in progress
  let hover = null;         // hole under the pointer
  let placing = false;      // dragging a part in from the parts list
  let lastDown = null;      // time and hole of the previous press, to spot double-clicks

  const project = () => store.state.project;
  const ui = () => store.state.ui;

  function init(container, status) {
    wrap = container;
    statusEl = status;
    svg = s('svg', { class: 'pb-board-svg', tabindex: 0, 'aria-label': 'Board' });
    scene = s('g');
    overlay = s('g', { 'pointer-events': 'none' });
    svg.append(scene, overlay);
    readout = PCB.h('div', { class: 'pb-readout', hidden: true });
    wrap.append(svg, readout);

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onCancel);
    svg.addEventListener('pointerleave', () => {
      if (!drag) {
        hover = null;
        drawOverlay();
        setStatus();
      }
    });
    svg.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);

    store.subscribe(() => draw());
  }

  // ---------- view ----------

  function fit() {
    vb = R.fullViewBox(project().board);
    applyViewBox();
  }

  function applyViewBox() {
    svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].join(' '));
  }

  function draw() {
    const p = project();
    const key = p.board.cols + 'x' + p.board.rows;
    if (key !== boardKey || !vb) {
      boardKey = key;
      fit();
    }
    const next = R.renderBoard(p, {
      view: ui().view, selection: ui().selection, focusId: ui().focusId, conflicts: store.derived().conflicts,
      layers: ui().layers,
    });
    svg.replaceChild(next, scene);
    scene = next;
    overlay.setAttribute('transform', R.mirrorTransform(p.board, ui().view) || '');
    svg.dataset.tool = ui().tool;
    drawOverlay();
    setStatus();
  }

  // Pointer position in hole units (fractional), whatever the zoom or mirroring.
  function pointAt(ev) {
    const m = scene.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return { x: pt.x / P, y: pt.y / P };
  }
  const holeOf = (pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) });
  const same = (a, b) => a && b && a.x === b.x && a.y === b.y;
  const inBoard = (h) => PCB.onBoard(h, project().board);
  const clampHole = (h) => ({
    x: Math.max(0, Math.min(project().board.cols - 1, h.x)),
    y: Math.max(0, Math.min(project().board.rows - 1, h.y)),
  });

  function onWheel(ev) {
    ev.preventDefault();
    const m = svg.getScreenCTM();
    if (!m) return;
    const at = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    const full = R.fullViewBox(project().board);
    const factor = Math.exp(Math.max(-1, Math.min(1, ev.deltaY / 100)) * 0.18);
    const w = Math.max(6 * P, Math.min(full.w * 3, vb.w * factor));
    const k = w / vb.w;
    vb = { x: at.x - (at.x - vb.x) * k, y: at.y - (at.y - vb.y) * k, w, h: vb.h * k };
    applyViewBox();
  }

  // ---------- hit testing ----------

  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  function hitTest(pt) {
    const p = project();
    // Wire ends first, so an end sitting on a pin can still be grabbed.
    const sel = ui().selection;
    // Tried last to first: the selected wire wins, then wires on the side being looked at.
    // Hidden layers can't be picked.
    const show = ui().layers;
    const rank = (w) => (sel && sel.id === w.id ? 2 : 0) + (PCB.wireSide(w) === ui().view ? 1 : 0);
    const wires = p.wires.filter((w) => show[PCB.wireSide(w) + 'Wires']).slice().sort((a, b) => rank(a) - rank(b));
    for (const wire of wires.slice().reverse()) {
      const ends = PCB.wireEnds(wire);
      if (Math.hypot(pt.x - ends[0].x, pt.y - ends[0].y) < 0.42) return { kind: 'wire', id: wire.id, end: 'start' };
      if (Math.hypot(pt.x - ends[1].x, pt.y - ends[1].y) < 0.42) return { kind: 'wire', id: wire.id, end: 'end' };
    }
    for (const wire of wires.slice().reverse()) {
      const segs = PCB.segments(wire);
      for (let i = 0; i < segs.length; i++) {
        if (distToSegment(pt, segs[i].a, segs[i].b) < 0.3) return { kind: 'wire', id: wire.id, segment: i };
      }
    }
    const placed = show.parts ? PCB.placedParts(p) : [];
    for (const pl of placed.slice().reverse()) {
      if (PCB.pointInRect(pt, pl.body) || pl.pins.some((pin) => Math.hypot(pt.x - pin.x, pt.y - pin.y) < 0.4)) {
        return { kind: 'part', id: pl.part.id };
      }
    }
    for (const bridge of show.bridges ? p.bridges : []) {
      if (distToSegment(pt, bridge.a, bridge.b) < 0.3) return { kind: 'bridge', id: bridge.id };
    }
    return null;
  }

  const wireById = (id) => project().wires.find((w) => w.id === id);

  // ---------- pointer tools ----------

  function onDown(ev) {
    if (ev.button !== 0 && ev.button !== 1) return;
    // Focus for the keyboard shortcuts, without the keyboard focus ring a click would otherwise draw.
    svg.focus({ preventScroll: true, focusVisible: false });
    const pt = pointAt(ev);
    const hole = holeOf(pt);
    const tool = ev.button === 1 ? 'pan' : ui().tool;
    svg.setPointerCapture(ev.pointerId);

    if (tool === 'pan') {
      drag = { type: 'pan', cx: ev.clientX, cy: ev.clientY, vb: Object.assign({}, vb) };
      return;
    }
    if (tool === 'place') {
      placePart(hole, ev.shiftKey);
      return;
    }
    if (tool === 'routed' || tool === 'direct' || tool === 'bridge') {
      if (!inBoard(hole)) return;
      const layer = tool === 'bridge' ? 'bridges' : ui().view + 'Wires';
      if (!ui().layers[layer]) store.setLayer(layer, true);
      drag = { type: tool === 'bridge' ? 'new-bridge' : 'new-wire', mode: tool, a: hole, b: hole, horizontalFirst: null };
      drawOverlay();
      return;
    }

    // The scene is redrawn between the two presses of a double-click, so the browser's own
    // dblclick event is not dependable here.
    const now = ev.timeStamp;
    const isDouble = lastDown && now - lastDown.time < 450 && same(lastDown.hole, hole);
    lastDown = isDouble ? null : { time: now, hole };
    if (isDouble && addJog(pt)) return;

    const hit = hitTest(pt);
    if (!hit) {
      if (ui().selection || ui().focusId) store.setUi({ selection: null, focusId: null });
      drag = { type: 'pan', cx: ev.clientX, cy: ev.clientY, vb: Object.assign({}, vb) };
      return;
    }
    store.setUi({ selection: { kind: hit.kind, id: hit.id }, flashAt: null });
    if (hit.kind === 'wire') {
      const wire = wireById(hit.id);
      const orig = PCB.clone(wire.points);
      if (hit.end) drag = { type: 'wire-end', id: hit.id, which: hit.end, orig, last: hole, begun: false };
      else if (wire.mode === 'routed') drag = { type: 'wire-segment', id: hit.id, index: hit.segment, orig, last: hole, begun: false };
    } else if (hit.kind === 'part') {
      const part = project().parts.find((x) => x.id === hit.id);
      drag = { type: 'part', id: hit.id, ox: part.x, oy: part.y, start: hole, last: hole, begun: false };
    } else {
      const bridge = project().bridges.find((x) => x.id === hit.id);
      drag = { type: 'bridge', id: hit.id, orig: PCB.clone(bridge), start: hole, last: hole, begun: false };
    }
  }

  function onMove(ev) {
    const pt = pointAt(ev);
    const hole = holeOf(pt);
    if (!drag) {
      if (!same(hover, hole)) {
        hover = hole;
        drawOverlay();
        setStatus();
      }
      return;
    }
    hover = hole;

    if (drag.type === 'pan') {
      const m = svg.getScreenCTM();
      if (!m) return;
      vb.x = drag.vb.x - (ev.clientX - drag.cx) / m.a;
      vb.y = drag.vb.y - (ev.clientY - drag.cy) / m.d;
      applyViewBox();
      return;
    }

    if (drag.type === 'new-wire') {
      const b = clampHole(hole);
      if (same(b, drag.a)) drag.horizontalFirst = null;
      else if (drag.horizontalFirst === null) drag.horizontalFirst = Math.abs(pt.x - drag.a.x) >= Math.abs(pt.y - drag.a.y);
      drag.b = b;
      drawOverlay();
      showReadout(ev, previewWire());
      setStatus();
      return;
    }
    if (drag.type === 'new-bridge') {
      let b = PCB.snapBridgeEnd(drag.a, hole);
      const step = { x: Math.sign(b.x - drag.a.x), y: Math.sign(b.y - drag.a.y) };
      while (!inBoard(b)) b = { x: b.x - step.x, y: b.y - step.y };
      drag.b = b;
      drawOverlay();
      setStatus();
      return;
    }

    if (same(hole, drag.last)) return;
    drag.last = hole;
    const edit = (fn) => {
      if (!drag.begun) {
        store.begin();
        drag.begun = true;
      }
      fn();
      store.touch();
    };

    if (drag.type === 'wire-end') {
      const wire = wireById(drag.id);
      const target = clampHole(hole);
      const other = drag.which === 'start' ? drag.orig[drag.orig.length - 1] : drag.orig[0];
      if (same(target, other)) return;
      edit(() => {
        if (wire.mode === 'direct') wire.points = drag.which === 'start' ? [target, other] : [other, target];
        else wire.points = PCB.moveRouteEnd(drag.orig, drag.which, target);
      });
      showReadout(ev, wire);
    } else if (drag.type === 'wire-segment') {
      const wire = wireById(drag.id);
      edit(() => {
        wire.points = PCB.moveRouteSegment(drag.orig, drag.index, clampHole(hole));
      });
      showReadout(ev, wire);
    } else if (drag.type === 'part') {
      const part = project().parts.find((x) => x.id === drag.id);
      edit(() => {
        part.x = drag.ox + hole.x - drag.start.x;
        part.y = drag.oy + hole.y - drag.start.y;
      });
    } else if (drag.type === 'bridge') {
      const bridge = project().bridges.find((x) => x.id === drag.id);
      const dx = hole.x - drag.start.x;
      const dy = hole.y - drag.start.y;
      edit(() => {
        bridge.a = { x: drag.orig.a.x + dx, y: drag.orig.a.y + dy };
        bridge.b = { x: drag.orig.b.x + dx, y: drag.orig.b.y + dy };
      });
    }
  }

  function onUp(ev) {
    if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
    const d = drag;
    drag = null;
    readout.hidden = true;
    if (!d) return;

    if (d.type === 'new-wire' && !same(d.a, d.b)) {
      const wire = previewWireFrom(d);
      wire.id = PCB.uid('w');
      store.change((p) => {
        wire.label = PCB.nextWireLabel(p);
        p.wires.push(wire);
      });
      store.setUi({ selection: { kind: 'wire', id: wire.id } });
    } else if (d.type === 'new-bridge' && !same(d.a, d.b)) {
      const bridge = { id: PCB.uid('b'), a: d.a, b: d.b };
      store.change((p) => p.bridges.push(bridge));
      store.setUi({ selection: { kind: 'bridge', id: bridge.id } });
    } else {
      drawOverlay();
    }
  }

  function onCancel() {
    const d = drag;
    drag = null;
    readout.hidden = true;
    if (d && d.begun) store.cancel();
    else drawOverlay();
  }

  // Esc: give up whatever is being dragged or placed. Returns true when it did something.
  function cancelInteraction() {
    if (drag) {
      onCancel();
      return true;
    }
    return false;
  }

  // Double-click on a flat wire: put a step in it. Returns true when it did.
  function addJog(pt) {
    const hit = hitTest(pt);
    if (!hit || hit.kind !== 'wire' || hit.end) return false;
    const wire = wireById(hit.id);
    if (wire.mode !== 'routed') return false;
    const hole = holeOf(pt);
    const index = PCB.segmentIndexAt(wire.points, hole);
    if (index < 0) return false;
    store.change(() => {
      wire.points = PCB.jogRouteSegment(wire.points, index, hole);
    });
    return true;
  }

  function previewWireFrom(d) {
    return {
      id: 'preview', label: '', color: ui().wireColor, mode: d.mode, side: ui().view,
      points: d.mode === 'direct' ? [d.a, d.b] : PCB.lRoute(d.a, d.b, d.horizontalFirst !== false),
    };
  }
  const previewWire = () => (drag && drag.type === 'new-wire' && !same(drag.a, drag.b) ? previewWireFrom(drag) : null);

  // ---------- placing parts ----------

  function placePart(hole, keepPlacing) {
    const fp = PCB.footprintById(project(), ui().placeFootprintId);
    if (!fp) return;
    if (!ui().layers.parts) store.setLayer('parts', true);
    const part = { id: PCB.uid('p'), footprintId: fp.id, ref: '', x: hole.x, y: hole.y, rot: ui().placeRot };
    store.change((p) => {
      part.ref = PCB.nextRef(p, fp.prefix);
      p.parts.push(part);
    });
    store.setUi(keepPlacing ? { selection: null } : { tool: 'select', selection: { kind: 'part', id: part.id } });
  }

  // Called by the parts list when a footprint is pressed: it can be dragged straight onto the board.
  function startPlacing() {
    placing = true;
  }

  function overBoard(ev) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    return !!el && svg.contains(el);
  }

  function onWindowMove(ev) {
    if (ui().tool !== 'place' || drag) return;
    const hole = overBoard(ev) ? holeOf(pointAt(ev)) : null;
    if (!same(hole, hover) || (!hole && hover)) {
      hover = hole;
      drawOverlay();
      setStatus();
    }
  }

  function onWindowUp(ev) {
    if (!placing) return;
    placing = false;
    if (ui().tool === 'place' && overBoard(ev)) placePart(holeOf(pointAt(ev)), false);
  }

  // ---------- overlay: previews, hover highlight, handles ----------

  function drawOverlay() {
    PCB.clear(overlay);
    const p = project();
    const tool = ui().tool;

    // Handles on the selected wire.
    const sel = ui().selection;
    if (sel && sel.kind === 'wire' && tool === 'select') {
      const wire = wireById(sel.id);
      if (wire) {
        const pts = wire.mode === 'direct' ? PCB.wireEnds(wire) : wire.points;
        pts.forEach((pt, i) => {
          const end = i === 0 || i === pts.length - 1;
          overlay.appendChild(s('rect', {
            x: pt.x * P - (end ? 1.7 : 1.1), y: pt.y * P - (end ? 1.7 : 1.1), width: end ? 3.4 : 2.2, height: end ? 3.4 : 2.2,
            fill: '#fff', stroke: '#101315', 'stroke-width': 0.5,
          }));
        });
      }
    }

    // Everything joined to the hole under the pointer.
    if (hover && !drag && tool === 'select' && inBoard(hover)) {
      const net = PCB.netMembers(p, hover);
      if (net.wires.size || net.bridges.size) {
        for (const wire of p.wires) {
          if (!net.wires.has(wire.id)) continue;
          const pts = wire.mode === 'direct' ? PCB.wireEnds(wire) : wire.points;
          overlay.appendChild(s('path', { d: R.pathOf(pts), fill: 'none', stroke: '#fff', 'stroke-width': 0.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': '0.1 2.2' }));
        }
        for (const k of net.holes) {
          const [x, y] = k.split(',').map(Number);
          overlay.appendChild(s('circle', { cx: x * P, cy: y * P, r: 3.9, fill: 'none', stroke: '#fff', 'stroke-width': 1.1 }));
          overlay.appendChild(s('circle', { cx: x * P, cy: y * P, r: 3.9, fill: 'none', stroke: '#0B6E72', 'stroke-width': 0.5 }));
        }
      }
    }

    // Hole under the pointer while a drawing tool is active.
    if (hover && inBoard(hover) && (tool === 'routed' || tool === 'direct' || tool === 'bridge') && !drag) {
      overlay.appendChild(s('circle', { cx: hover.x * P, cy: hover.y * P, r: 3.2, fill: 'none', stroke: '#fff', 'stroke-width': 0.9 }));
    }

    const wire = previewWire();
    if (wire) {
      const d = R.pathOf(wire.points);
      overlay.appendChild(s('path', { d, fill: 'none', stroke: '#101315', 'stroke-width': 3.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.6 }));
      overlay.appendChild(s('path', { d, fill: 'none', stroke: wire.color, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }
    if (drag && (drag.type === 'new-wire' || drag.type === 'new-bridge')) {
      overlay.appendChild(s('circle', { cx: drag.a.x * P, cy: drag.a.y * P, r: 3.2, fill: 'none', stroke: '#fff', 'stroke-width': 0.9 }));
    }
    if (drag && drag.type === 'new-bridge' && !same(drag.a, drag.b)) {
      overlay.appendChild(s('line', { x1: drag.a.x * P, y1: drag.a.y * P, x2: drag.b.x * P, y2: drag.b.y * P, stroke: R.COLORS.solder, 'stroke-width': 4.6, 'stroke-linecap': 'round', opacity: 0.85 }));
    }

    // Ghost of the part being placed.
    if (tool === 'place' && hover) {
      const fp = PCB.footprintById(p, ui().placeFootprintId);
      if (fp) {
        const ghost = { x: hover.x, y: hover.y, rot: ui().placeRot };
        const body = PCB.partBody(ghost, fp);
        overlay.appendChild(s('rect', { x: body.x * P, y: body.y * P, width: body.w * P, height: body.h * P, rx: 1.6, fill: R.COLORS.body, 'fill-opacity': 0.55, stroke: '#fff', 'stroke-width': 0.7, 'stroke-dasharray': '2 1.5' }));
        for (const pin of PCB.partPins(ghost, fp)) {
          overlay.appendChild(s('circle', { cx: pin.x * P, cy: pin.y * P, r: 2.2, fill: R.COLORS.solder, opacity: inBoard(pin) ? 0.95 : 0.4 }));
        }
      }
    }

    // Pointer from the issues list.
    const flash = ui().flashAt;
    if (flash) {
      overlay.appendChild(s('circle', { cx: flash.x * P, cy: flash.y * P, r: 6.5, fill: 'none', stroke: '#fff', 'stroke-width': 2.2 }));
      overlay.appendChild(s('circle', { cx: flash.x * P, cy: flash.y * P, r: 6.5, fill: 'none', stroke: R.COLORS.overlap, 'stroke-width': 1.1 }));
    }
  }

  function describe(wire) {
    const mm = PCB.cutLengthMm(wire, project().settings);
    if (wire.mode === 'direct') return mm + ' mm';
    const bends = PCB.bendCount(wire);
    return mm + ' mm, ' + bends + (bends === 1 ? ' bend' : ' bends');
  }

  function showReadout(ev, wire) {
    if (!wire) {
      readout.hidden = true;
      return;
    }
    const box = wrap.getBoundingClientRect();
    readout.textContent = describe(wire);
    readout.style.left = ev.clientX - box.left + 16 + 'px';
    readout.style.top = ev.clientY - box.top + 16 + 'px';
    readout.hidden = false;
  }

  const HINTS = {
    select: 'Drag parts and wires to move them. Drag a wire end to reconnect it, drag a segment to slide it, double-click a segment to add a step.',
    routed: 'Press on a hole and drag to another to lay a wire flat along the grid, on the side you are looking at.',
    direct: 'Press on a hole and drag to another for a wire that goes straight across, on the side you are looking at.',
    bridge: 'Press on a hole and drag along a row, column or diagonal to join pads with solder on the bottom.',
    place: 'Click a hole to put the part there. R turns it, Esc cancels, Shift-click places several.',
  };

  function setStatus() {
    if (!statusEl) return;
    const p = project();
    const parts = [];
    if (hover && inBoard(hover)) {
      let where = PCB.holeLabel(hover);
      for (const pl of PCB.placedParts(p)) {
        const pin = pl.pins.find((x) => same(x, hover));
        if (pin) where += ', ' + pl.part.ref + ' pin ' + pin.name;
      }
      parts.push(where);
      if (ui().tool === 'select' && !drag) {
        const net = PCB.netMembers(p, hover);
        if (net.wires.size || net.bridges.size) {
          const pins = net.pins.map((x) => x.ref + '.' + x.name);
          parts.push('joined: ' + (pins.length ? pins.join(', ') : 'no pins yet'));
        }
      }
    }
    if (drag && drag.type === 'new-bridge' && !same(drag.a, drag.b)) parts.push('bridge ' + PCB.holeLabel(drag.a) + ' to ' + PCB.holeLabel(drag.b));
    const w = previewWire();
    if (w) parts.push(PCB.holeLabel(drag.a) + ' to ' + PCB.holeLabel(drag.b) + ', ' + describe(w));
    PCB.clear(statusEl).append(
      PCB.h('span', { class: 'pb-status-where', text: parts.join('  |  ') }),
      PCB.h('span', { class: 'pb-status-hint', text: HINTS[ui().tool] || '' })
    );
  }

  PCB.boardView = { init, draw, fit, startPlacing, cancelInteraction, describe };
})(globalThis.PCB = globalThis.PCB || {});
