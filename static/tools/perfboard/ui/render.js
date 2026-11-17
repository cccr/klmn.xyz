// Draws a project as SVG. Pure: project in, <g> out. Used for the screen, exports and printing, so
// everything is styled with attributes rather than the page's CSS.
(function (PCB) {
  'use strict';

  const P = 10; // SVG units per hole pitch
  const FONT = 'IBM Plex Mono, ui-monospace, Menlo, Consolas, monospace';
  const COLORS = {
    board: '#d3ab6c', boardEdge: '#a9824a', hole: '#33230f', ring: '#c29a5c',
    copper: '#c57f3c', copperEdge: '#9b5d24',
    solder: '#cfd4d8', solderEdge: '#6f777d',
    body: '#2a2f34', bodyEdge: '#0f1214', bodyText: '#eef1f2',
    label: '#62655F', overlap: '#ff2a2a', select: '#ffffff',
  };
  let patternSeq = 0;

  function boardBounds(board) {
    return { x: -0.8 * P, y: -0.8 * P, w: (board.cols - 1) * P + 1.6 * P, h: (board.rows - 1) * P + 1.6 * P };
  }

  // viewBox that shows the whole board with its row and column labels.
  function fullViewBox(board) {
    const b = boardBounds(board);
    return { x: b.x - 1.4 * P, y: b.y - 1.4 * P, w: b.w + 2.8 * P, h: b.h + 2.8 * P };
  }

  function mirrorTransform(board, view) {
    return view === 'bottom' ? 'translate(' + (board.cols - 1) * P + ' 0) scale(-1 1)' : null;
  }

  function pathOf(points) {
    return points.map((p, i) => (i ? 'L' : 'M') + p.x * P + ' ' + p.y * P).join(' ');
  }

  function renderBoard(project, opts) {
    const s = PCB.s;
    const o = Object.assign({ view: 'top', selection: null, focusId: null, conflicts: null, labelColor: COLORS.label }, opts);
    const show = Object.assign(PCB.allLayers(), o.layers);
    const bottom = o.view === 'bottom';
    const board = project.board;
    const conflicts = o.conflicts || PCB.wireConflicts(project.wires);
    const selected = (kind, id) => o.selection && o.selection.kind === kind && o.selection.id === id;
    const dim = (id) => (o.focusId && o.focusId !== id ? 0.18 : null);

    // Text that stays readable when the scene is mirrored for the bottom view.
    const text = (x, y, str, size, fill, extra) =>
      s('text', Object.assign({
        transform: 'translate(' + x + ' ' + y + ')' + (bottom ? ' scale(-1 1)' : ''),
        'font-size': size, 'font-family': FONT, fill, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      }, extra), str);

    const root = s('g', { transform: mirrorTransform(board, o.view) });

    // Board with its holes drawn as one repeating pattern.
    const patternId = 'holes' + ++patternSeq;
    const cell = bottom
      ? [s('circle', { cx: 5, cy: 5, r: 3.3, fill: COLORS.copper, stroke: COLORS.copperEdge, 'stroke-width': 0.3 }),
         s('circle', { cx: 5, cy: 5, r: 1.5, fill: COLORS.hole })]
      : [s('circle', { cx: 5, cy: 5, r: 2.1, fill: COLORS.ring }),
         s('circle', { cx: 5, cy: 5, r: 1.5, fill: COLORS.hole })];
    root.appendChild(s('defs', null, s('pattern', { id: patternId, x: -5, y: -5, width: P, height: P, patternUnits: 'userSpaceOnUse' }, cell)));
    const b = boardBounds(board);
    root.appendChild(s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 3, fill: COLORS.board, stroke: COLORS.boardEdge, 'stroke-width': 0.6 }));
    root.appendChild(s('rect', { x: -5, y: -5, width: board.cols * P, height: board.rows * P, fill: 'url(#' + patternId + ')' }));

    const labels = s('g', { opacity: o.focusId ? 0.5 : null });
    for (let x = 0; x < board.cols; x++) labels.appendChild(text(x * P, b.y - 0.7 * P, String(x + 1), 3.6, o.labelColor));
    for (let y = 0; y < board.rows; y++) labels.appendChild(text(b.x - 0.7 * P, y * P, PCB.rowLabel(y), 3.6, o.labelColor));
    if (show.labels) root.appendChild(labels);

    const placed = PCB.placedParts(project);

    // Solder bridges live on the bottom; from the top they are only hinted at.
    const drawBridges = () => {
      if (!show.bridges) return;
      for (const bridge of project.bridges) {
        const g = s('g', { opacity: dim(bridge.id) });
        const line = { x1: bridge.a.x * P, y1: bridge.a.y * P, x2: bridge.b.x * P, y2: bridge.b.y * P, 'stroke-linecap': 'round' };
        if (selected('bridge', bridge.id)) g.appendChild(s('line', Object.assign({}, line, { stroke: COLORS.select, 'stroke-width': 8 })));
        if (bottom) {
          g.appendChild(s('line', Object.assign({}, line, { stroke: COLORS.solderEdge, 'stroke-width': 5.6 })));
          g.appendChild(s('line', Object.assign({}, line, { stroke: COLORS.solder, 'stroke-width': 4.6 })));
        } else {
          g.appendChild(s('line', Object.assign({}, line, { stroke: COLORS.solderEdge, 'stroke-width': 5, opacity: 0.35 })));
          g.appendChild(s('line', Object.assign({}, line, { stroke: COLORS.solder, 'stroke-width': 1, 'stroke-dasharray': '2 2' })));
        }
        root.appendChild(g);
      }
    };

    const drawParts = () => {
      if (!show.parts) return;
      for (const p of placed) {
        const g = s('g', { opacity: o.focusId ? 0.35 : null });
        const r = { x: p.body.x * P, y: p.body.y * P, width: p.body.w * P, height: p.body.h * P, rx: 1.6 };
        if (selected('part', p.part.id)) {
          g.appendChild(s('rect', { x: r.x - 1.2, y: r.y - 1.2, width: r.width + 2.4, height: r.height + 2.4, rx: 2.4, fill: 'none', stroke: COLORS.select, 'stroke-width': 1.4 }));
        }
        if (bottom) {
          g.appendChild(s('rect', Object.assign({}, r, { fill: 'none', stroke: COLORS.bodyEdge, 'stroke-width': 0.7, 'stroke-dasharray': '3 2', opacity: 0.7 })));
        } else {
          g.appendChild(s('rect', Object.assign({}, r, { fill: COLORS.body, 'fill-opacity': 0.9, stroke: COLORS.bodyEdge, 'stroke-width': 0.6 })));
        }
        p.pins.forEach((pin, i) => {
          const cx = pin.x * P;
          const cy = pin.y * P;
          if (i === 0) {
            g.appendChild(s('rect', { x: cx - 2.5, y: cy - 2.5, width: 5, height: 5, rx: 0.8, fill: COLORS.solder, stroke: COLORS.solderEdge, 'stroke-width': 0.4 }));
          } else {
            g.appendChild(s('circle', { cx, cy, r: bottom ? 2.8 : 2.4, fill: COLORS.solder, stroke: COLORS.solderEdge, 'stroke-width': 0.4 }));
          }
          if (pin.name.length <= 3) g.appendChild(text(cx, cy + 0.1, pin.name, pin.name.length > 2 ? 2 : 2.6, '#1c2428'));
        });
        const cx = (p.body.x + p.body.w / 2) * P;
        const cy = (p.body.y + p.body.h / 2) * P;
        const size = Math.max(2.8, Math.min(5, (Math.min(p.body.w, p.body.h) * P) / 2.2));
        const free = !p.pins.some((pin) => Math.abs(pin.x * P - cx) < 6 && Math.abs(pin.y * P - cy) < 6);
        // When pins fill the middle of the body, the label sits just above it with a halo so it
        // stays readable over the holes.
        g.appendChild(text(cx, free ? cy : p.body.y * P - 2.6, p.part.ref, free ? size : 3.4,
          !free || bottom ? '#1c2428' : COLORS.bodyText,
          Object.assign({ 'font-weight': 600 }, free ? null : { stroke: COLORS.board, 'stroke-width': 1.4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' })));
        root.appendChild(g);
      }
    };

    // Wires on the side being looked at are drawn solid. Wires on the other side are seen
    // through the board, so they are faint and dashed.
    const near = (wire) => PCB.wireSide(wire) === o.view;
    const byLayer = (list) => list.filter((w) => w.mode === 'routed').concat(list.filter((w) => w.mode === 'direct'));

    const drawWires = (wires, ghost) => {
      // Routed wires lie flat, direct wires fly over them.
      for (const wire of byLayer(wires)) {
        const pts = wire.mode === 'direct' ? PCB.wireEnds(wire) : wire.points;
        const d = pathOf(pts);
        const g = s('g', { opacity: dim(wire.id) !== null ? dim(wire.id) : ghost ? 0.3 : null });
        const stroke = { d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
        const width = wire.mode === 'direct' ? 2.2 : 2.8;
        if (selected('wire', wire.id)) g.appendChild(s('path', Object.assign({}, stroke, { stroke: COLORS.select, 'stroke-width': width + 3.4 })));
        if (wire.mode === 'direct' && !ghost) {
          g.appendChild(s('path', Object.assign({}, stroke, { stroke: '#000', 'stroke-width': width, opacity: 0.22, transform: 'translate(1.1 1.5)' })));
        }
        g.appendChild(s('path', Object.assign({}, stroke, { stroke: '#101315', 'stroke-width': width + 1, opacity: 0.75 })));
        g.appendChild(s('path', Object.assign({}, stroke, { stroke: wire.color, 'stroke-width': width, 'stroke-dasharray': ghost ? '3 3' : null })));
        root.appendChild(g);
      }
    };

    // Wire ends. A top-side wire pokes through and is soldered on the bottom, so from the bottom
    // its ends show as solder joints. A bottom-side wire never reaches the top.
    const drawEnds = (wires, ghost) => {
      for (const wire of wires) {
        const joint = ghost && bottom;
        const g = s('g', { opacity: dim(wire.id) !== null ? dim(wire.id) : ghost && !joint ? 0.3 : null });
        for (const end of PCB.wireEnds(wire)) {
          g.appendChild(s('circle', {
            cx: end.x * P, cy: end.y * P, r: joint ? 2.6 : 1.9, fill: joint ? COLORS.solder : wire.color,
            stroke: joint ? wire.color : '#101315', 'stroke-width': joint ? 1 : 0.6,
          }));
        }
        root.appendChild(g);
      }
    };

    const drawConflicts = () => {
      if (!show.marks || !show[o.view + 'Wires']) return;
      const g = s('g', { opacity: o.focusId ? 0.25 : null });
      for (const ov of conflicts.overlaps) {
        if (ov.side !== o.view) continue;
        g.appendChild(s('line', { x1: ov.a.x * P, y1: ov.a.y * P, x2: ov.b.x * P, y2: ov.b.y * P, stroke: COLORS.overlap, 'stroke-width': 4.4, 'stroke-dasharray': '2.5 2.5', opacity: 0.95 }));
      }
      for (const c of conflicts.crossings) {
        if (c.side !== o.view) continue;
        g.appendChild(s('circle', { cx: c.at.x * P, cy: c.at.y * P, r: 2.3, fill: 'none', stroke: '#fff', 'stroke-width': 1.5 }));
        g.appendChild(s('circle', { cx: c.at.x * P, cy: c.at.y * P, r: 2.3, fill: 'none', stroke: '#101315', 'stroke-width': 0.6 }));
      }
      root.appendChild(g);
    };

    const shown = project.wires.filter((w) => show[PCB.wireSide(w) + 'Wires']);
    const nearWires = shown.filter(near);
    const farWires = shown.filter((w) => !near(w));
    if (bottom) {
      drawWires(farWires, true);
      drawParts();
      drawBridges();
      drawEnds(farWires, true);
      drawWires(nearWires, false);
      drawEnds(nearWires, false);
    } else {
      drawBridges();
      drawWires(farWires, true);
      drawEnds(farWires, true);
      drawParts();
      drawWires(nearWires, false);
      drawEnds(nearWires, false);
    }
    drawConflicts();
    return root;
  }

  // A complete standalone <svg> at true size (1 pitch = 2.54 mm) for export and print.
  function renderStandalone(project, view, layers) {
    const vb = fullViewBox(project.board);
    const mm = (units) => ((units / P) * PCB.PITCH_MM).toFixed(2) + 'mm';
    const svg = PCB.s('svg', {
      xmlns: PCB.SVG_NS, viewBox: [vb.x, vb.y, vb.w, vb.h].join(' '), width: mm(vb.w), height: mm(vb.h),
    });
    svg.appendChild(PCB.s('rect', { x: vb.x, y: vb.y, width: vb.w, height: vb.h, fill: '#ffffff' }));
    svg.appendChild(renderBoard(project, { view, layers }));
    return svg;
  }

  PCB.render = { P, FONT, COLORS, boardBounds, fullViewBox, mirrorTransform, pathOf, renderBoard, renderStandalone };
})(globalThis.PCB = globalThis.PCB || {});
