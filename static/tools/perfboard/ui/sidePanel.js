// Right panel: the selected item, then the wire cut list, build steps and issues.
(function (PCB) {
  'use strict';

  const { h, store } = PCB;
  let root;
  let dragStepId = null;

  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const swatch = (color) => h('span', { class: 'pb-swatch', style: 'background:' + color, 'aria-hidden': 'true' });

  function colorPicker(current, onPick) {
    return h('div', { class: 'pb-swatches', role: 'group', 'aria-label': 'Wire colour' },
      PCB.WIRE_COLORS.map((c) => h('button', {
        type: 'button', class: 'pb-swatch-btn' + (c.value === current ? ' is-on' : ''), style: 'background:' + c.value,
        title: c.name, 'aria-label': c.name, 'aria-pressed': c.value === current, onclick: () => onPick(c.value),
      })));
  }

  function removeSelected() {
    const sel = store.state.ui.selection;
    if (!sel) return;
    store.change((p) => {
      if (sel.kind === 'wire') p.wires = p.wires.filter((x) => x.id !== sel.id);
      else if (sel.kind === 'part') p.parts = p.parts.filter((x) => x.id !== sel.id);
      else p.bridges = p.bridges.filter((x) => x.id !== sel.id);
    });
  }

  function rotateSelected() {
    const sel = store.state.ui.selection;
    if (!sel || sel.kind !== 'part') return;
    store.change((p) => {
      const part = p.parts.find((x) => x.id === sel.id);
      part.rot = (part.rot + 1) % 4;
    });
  }

  function setWireMode(wire, mode) {
    if (wire.mode === mode) return;
    store.change(() => {
      const [a, b] = PCB.wireEnds(wire);
      wire.mode = mode;
      wire.points = mode === 'direct' ? [a, b] : PCB.lRoute(a, b, true);
    });
  }

  function selectionBox() {
    const p = store.state.project;
    const sel = store.state.ui.selection;
    if (!sel) return null;
    const box = h('section', { class: 'pb-selection' });

    if (sel.kind === 'wire') {
      const wire = p.wires.find((x) => x.id === sel.id);
      if (!wire) return null;
      const row = PCB.cutListRows(p, store.derived().conflicts).find((r) => r.id === wire.id);
      const seg = (mode, label) => h('button', {
        type: 'button', class: '' + (wire.mode === mode ? ' is-on' : ''), 'aria-pressed': wire.mode === mode,
        onclick: () => setWireMode(wire, mode),
      }, label);
      const sideSeg = (side, label) => h('button', {
        type: 'button', class: '' + (row.side === side ? ' is-on' : ''), 'aria-pressed': row.side === side,
        onclick: () => {
          if (row.side === side) return;
          store.change(() => { wire.side = side; });
          store.setUi({ view: side });
        },
      }, label);
      box.append(
        h('div', { class: 'pb-selection-head' },
          h('input', { type: 'text', class: 'pb-name-input', value: wire.label, maxlength: 16, 'aria-label': 'Wire name',
            onchange: (ev) => store.change(() => { wire.label = ev.target.value.trim() || wire.label; }) }),
          h('button', { class: 'btn pb-danger', type: 'button', onclick: removeSelected }, 'Delete wire')),
        colorPicker(wire.color, (c) => {
          store.change(() => { wire.color = c; });
          store.setUi({ wireColor: c });
        }),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'How the wire runs' }, seg('routed', 'Flat along the grid'), seg('direct', 'Straight across')),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Side of the board the wire is on' }, sideSeg('top', 'On the top'), sideSeg('bottom', 'On the bottom')),
        h('dl', { class: 'spec' },
          h('dt', { text: 'Runs' }), h('dd', { text: row.from + ' to ' + row.to }),
          h('dt', { text: 'Cut' }), h('dd', { text: row.lengthMm + ' mm, strip ' + p.settings.endAllowanceMm + ' mm each end' }),
          wire.mode === 'routed' ? [h('dt', { text: 'Bends' }), h('dd', { text: String(row.bends) })] : null,
          h('dt', { text: 'Crosses' }), h('dd', { text: row.crossings ? plural(row.crossings, 'time') : 'nothing' })));
    } else if (sel.kind === 'part') {
      const part = p.parts.find((x) => x.id === sel.id);
      const fp = part && PCB.footprintById(p, part.footprintId);
      if (!part || !fp) return null;
      box.append(
        h('div', { class: 'pb-selection-head' },
          h('input', { type: 'text', class: 'pb-name-input', value: part.ref, maxlength: 12, 'aria-label': 'Part label',
            onchange: (ev) => store.change(() => { part.ref = ev.target.value.trim() || part.ref; }) }),
          h('button', { class: 'btn', type: 'button', onclick: rotateSelected, title: 'Rotate (R)' }, 'Rotate'),
          h('button', { class: 'btn pb-danger', type: 'button', onclick: removeSelected }, 'Delete part')),
        h('dl', { class: 'spec' },
          h('dt', { text: 'Footprint' }), h('dd', { text: fp.name + ', ' + plural(fp.pins.length, 'pin') }),
          h('dt', { text: 'Pin 1 at' }), h('dd', { text: PCB.holeLabel(PCB.partPins(part, fp)[0]) })));
    } else {
      const bridge = p.bridges.find((x) => x.id === sel.id);
      if (!bridge) return null;
      box.append(
        h('div', { class: 'pb-selection-head' },
          h('strong', { class: 'pb-name-static', text: 'Solder bridge' }),
          h('button', { class: 'btn pb-danger', type: 'button', onclick: removeSelected }, 'Delete bridge')),
        h('dl', { class: 'spec' },
          h('dt', { text: 'Joins' }), h('dd', { text: PCB.holeLabel(bridge.a) + ' to ' + PCB.holeLabel(bridge.b) + ', ' + plural(PCB.bridgeHoles(bridge).length, 'pad') })));
    }
    return box;
  }

  // ---------- Wires tab ----------

  function wiresTab() {
    const p = store.state.project;
    const rows = PCB.cutListRows(p, store.derived().conflicts);
    const sel = store.state.ui.selection;
    const out = [];
    if (!rows.length) {
      out.push(h('p', { class: 'pb-empty', text: 'No wires yet. Pick a wire tool, press on a hole and drag to another.' }));
    } else {
      const table = h('table', { class: 'pb-cut-list' },
        h('thead', null, h('tr', null,
          h('th', { text: 'Wire' }), h('th', { text: 'From, to' }), h('th', { class: 'num', text: 'Cut' }),
          h('th', { class: 'num', text: 'Bends' }), h('th', { class: 'num', title: 'Crossings with other wires', text: 'Cross' }))));
      const body = h('tbody');
      for (const r of rows) {
        body.appendChild(h('tr', {
          class: sel && sel.id === r.id ? 'is-selected' : null, tabindex: 0,
          onclick: () => store.setUi({ selection: { kind: 'wire', id: r.id }, tool: 'select', view: r.side }),
          onkeydown: (ev) => { if (ev.key === 'Enter') store.setUi({ selection: { kind: 'wire', id: r.id }, tool: 'select', view: r.side }); },
        },
          h('td', null, swatch(r.color), h('span', { text: r.label }), h('span', { class: 'pb-muted', text: (r.mode === 'direct' ? ' straight' : '') + (r.side === 'bottom' ? ' bottom' : '') })),
          h('td', { text: r.from + ' to ' + r.to }),
          h('td', { class: 'num', text: r.lengthMm + ' mm' }),
          h('td', { class: 'num', text: r.mode === 'routed' ? String(r.bends) : '' }),
          h('td', { class: 'num' + (r.crossings ? ' has-cross' : ''), text: r.crossings ? String(r.crossings) : '' })));
      }
      table.appendChild(body);
      out.push(table);

      const byColor = new Map();
      for (const r of rows) byColor.set(r.color, (byColor.get(r.color) || 0) + r.lengthMm);
      const total = rows.reduce((sum, r) => sum + r.lengthMm, 0);
      out.push(h('div', { class: 'pb-totals' },
        h('p', null, h('strong', { text: plural(rows.length, 'wire') + ', ' + total + ' mm in all' })),
        h('ul', null, [...byColor].map(([color, mm]) => h('li', null, swatch(color), PCB.colorName(color) + ' ' + mm + ' mm')))));
      const copied = h('span', { class: 'pb-muted', role: 'status' });
      out.push(h('div', { class: 'pb-row-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => {
          const csv = PCB.cutListCSV(p);
          const done = () => { copied.textContent = 'Copied'; setTimeout(() => { copied.textContent = ''; }, 1500); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(csv).then(done, () => PCB.files.download(p.name + ' cut list.csv', csv, 'text/csv'));
          else PCB.files.download(p.name + ' cut list.csv', csv, 'text/csv');
        } }, 'Copy cut list as CSV'),
        copied));
    }

    const setting = (label, key, unit, max) => h('label', { class: 'pb-setting' },
      h('span', { text: label }),
      h('input', { type: 'number', min: 0, max, step: key === 'slackPct' ? 1 : 0.5, value: p.settings[key],
        onchange: (ev) => {
          const v = Number(ev.target.value);
          if (Number.isFinite(v) && v >= 0 && v <= max) store.change((proj) => { proj.settings[key] = v; });
          else ev.target.value = p.settings[key];
        } }),
      h('span', { class: 'pb-muted', text: unit }));
    out.push(h('fieldset', { class: 'pb-settings' },
      h('legend', { text: 'Length allowances' }),
      setting('Extra at each end', 'endAllowanceMm', 'mm', 50),
      setting('Slack on straight wires', 'slackPct', '%', 200)));
    return out;
  }

  // ---------- Build tab ----------

  function stepText(step, p) {
    if (step.kind === 'bridge') {
      return 'Solder bridge ' + PCB.holeLabel(step.item.a) + ' to ' + PCB.holeLabel(step.item.b) + ' on the bottom';
    }
    const w = step.item;
    const [a, b] = PCB.wireEnds(w);
    const bends = PCB.bendCount(w);
    return w.label + ': ' + PCB.colorName(w.color).toLowerCase() + ', ' + PCB.cutLengthMm(w, p.settings) + ' mm, ' +
      PCB.holeLabel(a) + ' to ' + PCB.holeLabel(b) +
      (w.mode === 'direct' ? ', straight across' : bends ? ', ' + plural(bends, 'bend') : ', no bends') +
      (PCB.wireSide(w) === 'bottom' ? ', on the bottom' : '');
  }

  function focusStep(id) {
    const p = store.state.project;
    const wire = p.wires.find((w) => w.id === id);
    const kind = wire ? 'wire' : 'bridge';
    // Turn the board to the side this step is soldered from.
    store.setUi({ focusId: id, selection: { kind, id }, tool: 'select', view: wire ? PCB.wireSide(wire) : 'bottom' });
  }

  function buildTab() {
    const p = store.state.project;
    const steps = PCB.buildSteps(p);
    const focus = store.state.ui.focusId;
    if (!steps.length) return [h('p', { class: 'pb-empty', text: 'Nothing to build yet. Wires and solder bridges show up here in the order to solder them.' })];

    const done = steps.filter((st) => p.build.done[st.id]).length;
    const nextUndone = (afterIndex) => steps.find((st, i) => i > afterIndex && !p.build.done[st.id]) || steps.find((st) => !p.build.done[st.id]);
    const list = h('ol', { class: 'pb-steps' });
    steps.forEach((step) => {
      const li = h('li', {
        class: (focus === step.id ? 'is-focus ' : '') + (p.build.done[step.id] ? 'is-done' : ''), draggable: 'true',
        ondragstart: (ev) => { dragStepId = step.id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', step.id); },
        ondragover: (ev) => { if (dragStepId && dragStepId !== step.id) { ev.preventDefault(); li.classList.add('pb-drop-here'); } },
        ondragleave: () => li.classList.remove('pb-drop-here'),
        ondrop: (ev) => {
          ev.preventDefault();
          const moved = dragStepId;
          dragStepId = null;
          if (moved && moved !== step.id) store.change((proj) => PCB.moveStep(proj, moved, step.id));
        },
        ondragend: () => { dragStepId = null; },
      },
        h('input', { type: 'checkbox', checked: !!p.build.done[step.id], 'aria-label': 'Done: ' + stepText(step, p),
          onchange: (ev) => store.change((proj) => { if (ev.target.checked) proj.build.done[step.id] = true; else delete proj.build.done[step.id]; }) }),
        h('button', { type: 'button', class: 'pb-step-text', title: 'Show this step on the board', onclick: () => focusStep(step.id) },
          step.kind === 'wire' ? swatch(step.item.color) : h('span', { class: 'pb-swatch pb-swatch-solder', 'aria-hidden': 'true' }),
          stepText(step, p)));
      list.appendChild(li);
    });

    const focusIndex = steps.findIndex((st) => st.id === focus);
    return [
      h('p', { class: 'pb-progress', text: done + ' of ' + steps.length + ' done' }),
      h('div', { class: 'pb-row-actions' },
        h('button', { class: 'btn btn-go', type: 'button', disabled: done === steps.length, onclick: () => {
          if (focus && !p.build.done[focus]) store.change((proj) => { proj.build.done[focus] = true; });
          const next = nextUndone(focusIndex);
          if (next) focusStep(next.id);
          else store.setUi({ focusId: null });
        } }, focus && !p.build.done[focus] ? 'Done, show next' : done ? 'Show next step' : 'Start building'),
        focus ? h('button', { class: 'btn', type: 'button', onclick: () => store.setUi({ focusId: null }) }, 'Show whole board') : null),
      list,
      h('p', { class: 'pb-hint', text: 'Drag steps to change the order.' }),
      h('div', { class: 'pb-row-actions' },
        h('button', { class: 'chip', type: 'button', disabled: !done, onclick: () => store.change((proj) => { proj.build.done = {}; }) }, 'Untick all'),
        h('button', { class: 'chip', type: 'button', disabled: !p.build.order, onclick: () => store.change((proj) => { proj.build.order = null; }) }, 'Back to suggested order')),
    ];
  }

  // ---------- Issues tab ----------

  function issuesTab() {
    const issues = store.derived().issues;
    if (!issues.length) return [h('p', { class: 'pb-empty', text: 'Nothing to flag. Overlapping wires, crossings and loose ends are listed here.' })];
    const p = store.state.project;
    const words = { error: 'Fix', warn: 'Check', info: 'Note' };
    return [h('ul', { class: 'pb-issues' }, issues.map((issue) => h('li', null,
      h('button', { type: 'button', class: 'pb-issue pb-issue-' + issue.level, onclick: () => {
        const id = issue.ids[0];
        const wire = p.wires.find((w) => w.id === id);
        const kind = wire ? 'wire' : p.parts.some((x) => x.id === id) ? 'part' : 'bridge';
        store.setUi({ selection: id ? { kind, id } : null, flashAt: issue.at, tool: 'select', focusId: null, view: wire ? PCB.wireSide(wire) : store.state.ui.view });
      } },
        h('span', { class: 'pb-issue-level', text: words[issue.level] }),
        h('span', { text: issue.text })))))];
  }

  function render() {
    const ui = store.state.ui;
    const issues = store.derived().issues;
    const serious = issues.filter((i) => i.level !== 'info').length;
    const tabs = [
      ['wires', 'Wires'],
      ['build', 'Build'],
      ['issues', 'Issues' + (issues.length ? ' ' + issues.length : '')],
    ];
    const keep = root.querySelector('.pb-tab-body');
    const scroll = keep ? keep.scrollTop : 0;
    PCB.clear(root);
    const box = selectionBox();
    if (box) root.append(box);
    root.append(
      h('div', { class: 'pb-tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': ui.tab === id,
        class: 'pb-tab' + (ui.tab === id ? ' is-on' : '') + (id === 'issues' && serious ? ' has-serious' : ''),
        onclick: () => store.setUi({ tab: id }),
      }, label))),
      h('div', { class: 'pb-tab-body', role: 'tabpanel' }, ui.tab === 'wires' ? wiresTab() : ui.tab === 'build' ? buildTab() : issuesTab()));
    root.querySelector('.pb-tab-body').scrollTop = scroll;
  }

  PCB.sidePanel = {
    init(el) {
      root = el;
      store.subscribe(render);
    },
    render, removeSelected, rotateSelected,
  };
})(globalThis.PCB = globalThis.PCB || {});
