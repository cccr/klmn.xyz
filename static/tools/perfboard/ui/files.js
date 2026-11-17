// Saving, opening, exporting and printing. Everything stays on this computer.
(function (PCB) {
  'use strict';

  const { h, store } = PCB;

  function safeName(name) {
    return (name || 'board').replace(/[^\w .()-]+/g, '_').trim() || 'board';
  }

  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: safeName(filename) });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function save() {
    const p = store.state.project;
    download(p.name + '.json', PCB.toJSON(p), 'application/json');
  }

  // Reads a board file the user picked. Footprints already in this browser's library are kept too.
  function open(file, onError) {
    const reader = new FileReader();
    reader.onerror = () => onError('That file could not be read.');
    reader.onload = () => {
      try {
        const project = PCB.fromJSON(String(reader.result));
        const have = new Set(project.footprints.map((f) => f.id));
        for (const fp of store.library()) if (!have.has(fp.id)) project.footprints.push(fp);
        store.load(project);
      } catch (e) {
        onError(e.message);
      }
    };
    reader.readAsText(file);
  }

  function svgText(view) {
    // Exports show the layers shown on screen; the printed sheet always shows everything.
    const svg = PCB.render.renderStandalone(store.state.project, view, store.state.ui.layers);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  }

  function exportSvg() {
    const view = store.state.ui.view;
    download(store.state.project.name + ' ' + view + '.svg', svgText(view), 'image/svg+xml');
  }

  function exportPng(onError) {
    const view = store.state.ui.view;
    const vb = PCB.render.fullViewBox(store.state.project.board);
    const scale = Math.min(8, 4000 / Math.max(vb.w, vb.h));
    const img = new Image();
    img.onerror = () => onError('The picture could not be made. Try the SVG export instead.');
    img.onload = () => {
      const canvas = h('canvas', { width: Math.round(vb.w * scale), height: Math.round(vb.h * scale) });
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) download(store.state.project.name + ' ' + view + '.png', blob);
        else onError('The picture could not be made. Try the SVG export instead.');
      }, 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText(view));
  }

  // Fills the print-only sheet (both sides, cut list, build steps) and opens the print dialog.
  function print(sheet) {
    const p = store.state.project;
    const rows = PCB.cutListRows(p);
    const steps = PCB.buildSteps(p);
    const figure = (view, caption) => h('figure', null, PCB.render.renderStandalone(p, view), h('figcaption', { text: caption }));
    PCB.clear(sheet).append(
      h('h1', { text: p.name }),
      h('p', { text: p.board.cols + ' × ' + p.board.rows + ' holes, 2.54 mm pitch. Printed at 100% the drawings are life size.' }),
      figure('top', 'Top (component side)'),
      figure('bottom', 'Bottom (solder side), mirrored as you see it with the board turned over'));
    if (rows.length) {
      sheet.append(h('h2', { text: 'Wire cut list' }), h('table', null,
        h('thead', null, h('tr', null, ['Wire', 'Colour', 'Type', 'Side', 'From', 'To', 'Cut', 'Bends', 'Crossings'].map((t) => h('th', { text: t })))),
        h('tbody', null, rows.map((r) => h('tr', null,
          [r.label, PCB.colorName(r.color), r.mode === 'direct' ? 'straight' : 'flat', r.side, r.from, r.to, r.lengthMm + ' mm', r.mode === 'routed' ? r.bends : '', r.crossings || '']
            .map((t) => h('td', { text: String(t) })))))),
        h('p', { text: 'Strip ' + p.settings.endAllowanceMm + ' mm at each end. Total ' + rows.reduce((sum, r) => sum + r.lengthMm, 0) + ' mm.' }));
    }
    if (steps.length) {
      sheet.append(h('h2', { text: 'Build order' }), h('ol', { class: 'pb-print-steps' }, steps.map((st) => {
        const text = st.kind === 'bridge'
          ? 'Solder bridge ' + PCB.holeLabel(st.item.a) + ' to ' + PCB.holeLabel(st.item.b)
          : st.item.label + ', ' + PCB.colorName(st.item.color).toLowerCase() + ', ' + PCB.cutLengthMm(st.item, p.settings) + ' mm, ' +
            PCB.holeLabel(PCB.wireEnds(st.item)[0]) + ' to ' + PCB.holeLabel(PCB.wireEnds(st.item)[1]) +
            (PCB.wireSide(st.item) === 'bottom' ? ', on the bottom' : '');
        return h('li', null, h('span', { class: 'pb-print-box' }), text);
      })));
    }
    window.print();
  }

  PCB.files = { download, save, open, exportSvg, exportPng, print };
})(globalThis.PCB = globalThis.PCB || {});
