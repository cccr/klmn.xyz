// Left panel: the footprint library. Press a footprint and drag it onto the board, or click it and
// then click a hole.
(function (PCB) {
  'use strict';

  const { h, s, store } = PCB;
  let root;

  function thumbnail(fp) {
    const b = fp.body;
    const pad = 0.4;
    const svg = s('svg', { viewBox: [b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad].join(' '), class: 'pb-fp-thumb', 'aria-hidden': 'true' });
    svg.appendChild(s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 0.15, fill: '#2a2f34' }));
    for (const pin of fp.pins) svg.appendChild(s('circle', { cx: pin.x, cy: pin.y, r: 0.28, fill: '#cfd4d8' }));
    return svg;
  }

  function render() {
    const p = store.state.project;
    const ui = store.state.ui;
    PCB.clear(root);
    root.appendChild(h('h2', { text: 'Parts' }));
    const list = h('ul', { class: 'pb-fp-list' });
    for (const fp of p.footprints) {
      const active = ui.tool === 'place' && ui.placeFootprintId === fp.id;
      const used = p.parts.filter((x) => x.footprintId === fp.id).length;
      list.appendChild(h('li', { class: active ? 'is-active' : null },
        h('button', {
          class: 'pb-fp-pick', type: 'button', title: 'Drag onto the board, or click and then click a hole',
          onpointerdown: (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            store.setUi({ tool: 'place', placeFootprintId: fp.id, placeRot: 0, selection: null, focusId: null });
            PCB.boardView.startPlacing();
          },
          onkeydown: (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              store.setUi({ tool: 'place', placeFootprintId: fp.id, placeRot: 0, selection: null, focusId: null });
            }
          },
        },
          thumbnail(fp),
          h('span', { class: 'pb-fp-name', text: fp.name }),
          h('span', { class: 'pb-fp-meta', text: fp.pins.length + ' pins' + (used ? ', ' + used + ' placed' : '') })),
        h('button', { class: 'pb-fp-edit', type: 'button', title: 'Edit ' + fp.name, 'aria-label': 'Edit ' + fp.name, onclick: () => PCB.footprintEditor.open(fp.id) }, 'Edit')));
    }
    root.appendChild(list);
    if (!p.footprints.length) root.appendChild(h('p', { class: 'pb-empty', text: 'No footprints yet. Make one to start placing parts.' }));
    root.appendChild(h('button', { class: 'btn pb-wide', type: 'button', onclick: () => PCB.footprintEditor.open(null) }, 'New footprint'));
  }

  PCB.partsPanel = {
    init(el) {
      root = el;
      store.subscribe(render);
    },
    render,
  };
})(globalThis.PCB = globalThis.PCB || {});
