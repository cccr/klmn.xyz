// Dialog for making and editing footprints: click holes to add pins, drag to draw the body.
(function (PCB) {
  'use strict';

  const { h, s, store } = PCB;
  const MARGIN = 2; // free holes kept around the pins while editing
  let dialog;
  let ed = null;    // { id, name, prefix, pins:[{x,y,name}], body:null|{x,y,w,h}, mode:'pins'|'body', dragFrom }

  function init() {
    dialog = h('dialog', { class: 'pb-dialog pb-fp-dialog', 'aria-label': 'Footprint' });
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => {
      ed = null;
    });
  }

  function open(id) {
    const fp = id ? PCB.footprintById(store.state.project, id) : null;
    ed = fp
      ? { id: fp.id, name: fp.name, prefix: fp.prefix, mode: 'pins',
          pins: fp.pins.map((p) => ({ x: p.x + MARGIN, y: p.y + MARGIN, name: p.name })),
          body: sameBody(fp.body, PCB.autoBody(fp.pins)) ? null : { x: fp.body.x + MARGIN, y: fp.body.y + MARGIN, w: fp.body.w, h: fp.body.h } }
      : { id: null, name: '', prefix: 'U', pins: [], body: null, mode: 'pins' };
    render();
    if (!dialog.open) dialog.showModal();
  }

  function sameBody(a, b) {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  }

  function gridSize() {
    const xs = ed.pins.map((p) => p.x);
    const ys = ed.pins.map((p) => p.y);
    return { cols: Math.max(14, ...xs.map((x) => x + MARGIN + 2)), rows: Math.max(10, ...ys.map((y) => y + MARGIN + 2)) };
  }

  function loadPreset(fp) {
    ed.pins = fp.pins.map((p) => ({ x: p.x + MARGIN, y: p.y + MARGIN, name: p.name }));
    ed.body = null;
    if (!ed.name.trim()) ed.name = fp.name;
    ed.prefix = fp.prefix;
    render();
  }

  function renderGrid() {
    const size = gridSize();
    const svg = s('svg', { viewBox: [-1, -1, size.cols + 1, size.rows + 1].join(' '), class: 'pb-fp-grid', 'data-mode': ed.mode });
    svg.appendChild(s('rect', { x: -0.8, y: -0.8, width: size.cols + 0.6, height: size.rows + 0.6, rx: 0.3, fill: '#d3ab6c' }));
    for (let y = 0; y < size.rows; y++) {
      for (let x = 0; x < size.cols; x++) svg.appendChild(s('circle', { cx: x, cy: y, r: 0.16, fill: '#33230f' }));
    }
    const body = ed.body || (ed.pins.length ? PCB.autoBody(ed.pins) : null);
    if (body) {
      svg.appendChild(s('rect', { x: body.x, y: body.y, width: body.w, height: body.h, rx: 0.15, fill: '#2a2f34', 'fill-opacity': 0.82, stroke: ed.mode === 'body' ? '#fff' : 'none', 'stroke-width': 0.08, 'stroke-dasharray': '0.3 0.2' }));
    }
    ed.pins.forEach((pin, i) => {
      svg.appendChild(i === 0
        ? s('rect', { x: pin.x - 0.3, y: pin.y - 0.3, width: 0.6, height: 0.6, rx: 0.08, fill: '#cfd4d8', stroke: '#6f777d', 'stroke-width': 0.05 })
        : s('circle', { cx: pin.x, cy: pin.y, r: 0.3, fill: '#cfd4d8', stroke: '#6f777d', 'stroke-width': 0.05 }));
      if (pin.name.length <= 3) {
        svg.appendChild(s('text', { x: pin.x, y: pin.y + 0.02, 'font-size': pin.name.length > 2 ? 0.26 : 0.32, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#1c2428', 'font-family': PCB.render.FONT, 'pointer-events': 'none' }, pin.name));
      }
    });

    const at = (ev) => {
      const m = svg.getScreenCTM();
      const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
      return pt;
    };
    const half = (v) => Math.round(v * 2) / 2;
    svg.addEventListener('pointerdown', (ev) => {
      const pt = at(ev);
      if (ed.mode === 'pins') {
        const hole = { x: Math.round(pt.x), y: Math.round(pt.y) };
        if (hole.x < 0 || hole.y < 0 || hole.x >= size.cols || hole.y >= size.rows) return;
        const i = ed.pins.findIndex((p) => p.x === hole.x && p.y === hole.y);
        if (i >= 0) ed.pins.splice(i, 1);
        else ed.pins.push({ x: hole.x, y: hole.y, name: nextPinName() });
        render();
      } else {
        ed.dragFrom = { x: half(pt.x), y: half(pt.y) };
        svg.setPointerCapture(ev.pointerId);
      }
    });
    svg.addEventListener('pointermove', (ev) => {
      if (ed.mode !== 'body' || !ed.dragFrom) return;
      const pt = at(ev);
      const to = { x: half(pt.x), y: half(pt.y) };
      const rect = { x: Math.min(ed.dragFrom.x, to.x), y: Math.min(ed.dragFrom.y, to.y), w: Math.abs(to.x - ed.dragFrom.x), h: Math.abs(to.y - ed.dragFrom.y) };
      if (rect.w >= 0.5 && rect.h >= 0.5) {
        ed.body = rect;
        const old = svg.querySelector('rect[fill-opacity]');
        const attrs = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
        if (old) for (const k of Object.keys(attrs)) old.setAttribute(k, attrs[k]);
      }
    });
    svg.addEventListener('pointerup', () => {
      if (ed.mode === 'body' && ed.dragFrom) {
        ed.dragFrom = null;
        render();
      }
    });
    return svg;
  }

  function nextPinName() {
    const used = new Set(ed.pins.map((p) => p.name));
    let n = 1;
    while (used.has(String(n))) n += 1;
    return String(n);
  }

  function presetRow() {
    const kind = h('select', { 'aria-label': 'Preset shape' },
      h('option', { value: 'dip' }, 'DIP chip'),
      h('option', { value: 'header' }, 'Pin header'),
      h('option', { value: 'two' }, 'Two leads'));
    const a = h('input', { type: 'number', min: 1, max: 64, value: 8, 'aria-label': 'First number' });
    const b = h('input', { type: 'number', min: 1, max: 40, value: 3, 'aria-label': 'Second number' });
    const la = h('span', { text: 'pins' });
    const lb = h('span', { text: 'holes between rows' });
    const sync = () => {
      const k = kind.value;
      la.textContent = k === 'dip' ? 'pins' : k === 'header' ? 'rows' : 'holes apart';
      lb.textContent = k === 'dip' ? 'holes between rows' : 'pins per row';
      b.hidden = lb.hidden = k === 'two';
      if (k === 'header') {
        a.value = 1;
        b.value = 6;
      } else if (k === 'dip') {
        a.value = 8;
        b.value = 3;
      } else {
        a.value = 4;
      }
    };
    kind.addEventListener('change', sync);
    const num = (input, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(input.value)) || lo));
    return h('div', { class: 'pb-preset-row' },
      h('span', { class: 'pb-field-label', text: 'Start from' }), kind, a, la, b, lb,
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          if (kind.value === 'dip') loadPreset(PCB.dip(num(a, 2, 64), num(b, 1, 12)));
          else if (kind.value === 'header') loadPreset(PCB.header(num(a, 1, 4), num(b, 1, 40)));
          else loadPreset(PCB.twoLead(num(a, 1, 30)));
        },
      }, 'Fill in'));
  }

  function render() {
    const p = store.state.project;
    const usedBy = ed.id ? p.parts.filter((x) => x.footprintId === ed.id).length : 0;
    PCB.clear(dialog);

    const name = h('input', { type: 'text', value: ed.name, maxlength: 40, placeholder: 'e.g. Relay module', oninput: (ev) => { ed.name = ev.target.value; } });
    const prefix = h('input', { type: 'text', value: ed.prefix, maxlength: 4, size: 4, oninput: (ev) => { ed.prefix = ev.target.value; } });
    const error = h('p', { class: 'pb-form-error', role: 'alert', hidden: true });

    const pinList = h('ol', { class: 'pb-pin-list' });
    ed.pins.forEach((pin, i) => {
      pinList.appendChild(h('li', null,
        h('span', { class: 'pb-pin-pos', text: (i === 0 ? 'Pin 1 (square)' : 'Pin ' + (i + 1)) }),
        h('input', { type: 'text', value: pin.name, maxlength: 12, 'aria-label': 'Name of pin ' + (i + 1), onchange: (ev) => { pin.name = ev.target.value.trim() || String(i + 1); render(); } })));
    });

    const modeBtn = (mode, label) => h('button', {
      class: '' + (ed.mode === mode ? ' is-on' : ''), type: 'button', 'aria-pressed': ed.mode === mode,
      onclick: () => { ed.mode = mode; render(); },
    }, label);

    dialog.append(
      h('h2', { text: ed.id ? 'Edit footprint' : 'New footprint' }),
      h('div', { class: 'pb-form-row' },
        h('label', null, h('span', { class: 'pb-field-label', text: 'Name' }), name),
        h('label', null, h('span', { class: 'pb-field-label', text: 'Label prefix' }), prefix)),
      presetRow(),
      h('div', { class: 'pb-fp-editor' },
        h('div', { class: 'pb-fp-canvas' },
          h('div', { class: 'seg', role: 'group', 'aria-label': 'What clicking the grid does' },
            modeBtn('pins', 'Pins'), modeBtn('body', 'Body outline'),
            ed.body ? h('button', { class: 'chip', type: 'button', onclick: () => { ed.body = null; render(); } }, 'Fit body to pins') : null),
          renderGrid(),
          h('p', { class: 'pb-hint', text: ed.mode === 'pins'
            ? 'Click a hole to add a pin, click a pin to remove it. The first pin is drawn square.'
            : 'Drag a rectangle for the part\'s body. It snaps to half holes and may stick out past the pins.' })),
        h('div', { class: 'pb-fp-pins' },
          h('h3', { text: 'Pin names' }),
          ed.pins.length ? pinList : h('p', { class: 'pb-empty', text: 'No pins yet.' }))),
      error,
      h('div', { class: 'pb-dialog-actions' },
        ed.id ? h('button', {
          class: 'btn pb-danger', type: 'button', disabled: usedBy > 0,
          title: usedBy ? 'Remove the ' + usedBy + ' placed part(s) first' : null,
          onclick: () => {
            const id = ed.id;
            store.change((proj) => { proj.footprints = proj.footprints.filter((f) => f.id !== id); });
            dialog.close();
          },
        }, 'Delete footprint') : null,
        h('span', { class: 'pb-spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        h('button', {
          class: 'btn btn-go', type: 'button',
          onclick: () => {
            if (!ed.pins.length) {
              error.textContent = 'Add at least one pin by clicking a hole.';
              error.hidden = false;
              return;
            }
            const pins = ed.pins.map((x) => ({ x: x.x, y: x.y, name: x.name }));
            const fp = PCB.normalizeFootprint({
              id: ed.id || PCB.uid('f'),
              name: ed.name.trim() || 'Part',
              prefix: (ed.prefix.trim() || 'U').replace(/[^A-Za-z]/g, '').slice(0, 4) || 'U',
              pins,
              body: ed.body ? Object.assign({}, ed.body) : PCB.autoBody(pins),
            });
            store.change((proj) => {
              const i = proj.footprints.findIndex((f) => f.id === fp.id);
              if (i >= 0) proj.footprints[i] = fp;
              else proj.footprints.push(fp);
            });
            dialog.close();
          },
        }, ed.id ? 'Save footprint' : 'Add footprint')));
  }

  PCB.footprintEditor = { init, open };
})(globalThis.PCB = globalThis.PCB || {});
