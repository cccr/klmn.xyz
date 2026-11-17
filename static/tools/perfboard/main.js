// Perfboard Planner (/tools/perfboard/). Start-up: load the last board, wire the toolbar, dialogs and
// keyboard to the store. The other scripts in this folder are loaded before this one, in the order the
// layout lists them; they share one namespace, PCB.
(function (PCB) {
  'use strict';

  const { h, store } = PCB;
  const $ = (id) => document.getElementById(id);
  let toastTimer = null;

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  function setTool(tool) {
    PCB.boardView.cancelInteraction();
    store.setUi({ tool, focusId: null });
  }

  // ---------- toolbar ----------

  function renderToolbar() {
    const p = store.state.project;
    const ui = store.state.ui;
    if (document.activeElement !== $('board-name')) $('board-name').value = p.name;
    $('board-size').textContent = p.board.cols + ' × ' + p.board.rows + ' holes';
    for (const btn of document.querySelectorAll('[data-tool]')) {
      const on = btn.dataset.tool === ui.tool;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on);
    }
    for (const btn of document.querySelectorAll('[data-view]')) {
      const on = btn.dataset.view === ui.view;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on);
    }
    $('undo').disabled = !store.canUndo();
    $('redo').disabled = !store.canRedo();
    const colors = $('wire-colors');
    PCB.clear(colors);
    for (const c of PCB.WIRE_COLORS) {
      colors.appendChild(h('button', {
        type: 'button', class: 'pb-swatch-btn' + (c.value === ui.wireColor ? ' is-on' : ''), style: 'background:' + c.value,
        title: c.name + ' for new wires', 'aria-label': c.name + ' for new wires', 'aria-pressed': c.value === ui.wireColor,
        onclick: () => store.setUi({ wireColor: c.value }),
      }));
    }
    renderPictureButton();
    renderLayers();
    document.title = p.name + ' – Perfboard planner';
  }

  function renderLayers() {
    const layers = store.state.ui.layers;
    const off = PCB.LAYERS.filter((l) => !layers[l.id]).length;
    const summary = $('layers-menu').querySelector('summary');
    PCB.clear(summary).append('layers', off ? h('span', { class: 'pb-badge', text: String(off) }) : '');
    summary.setAttribute('aria-label', off ? 'Layers, ' + off + ' hidden' : 'Layers');
    summary.classList.toggle('has-hidden', off > 0);
    for (const box of $('layers-list').querySelectorAll('input')) box.checked = !!layers[box.value];
  }

  function initLayers() {
    const list = $('layers-list');
    for (const l of PCB.LAYERS) {
      list.appendChild(h('label', { class: 'pb-check' },
        h('input', { type: 'checkbox', value: l.id, onchange: (ev) => store.setLayer(l.id, ev.target.checked) }),
        l.name));
    }
    list.appendChild(h('hr'));
    list.appendChild(h('button', { type: 'button', onclick: () => { for (const l of PCB.LAYERS) store.setLayer(l.id, true); } }, 'Show everything'));
    const menu = $('layers-menu');
    document.addEventListener('pointerdown', (ev) => { if (menu.open && !menu.contains(ev.target)) menu.open = false; });
  }

  function renderPictureButton() {
    const btn = $('picture');
    const has = PCB.picture.has();
    const on = PCB.picture.visible();
    btn.textContent = !has ? 'add picture' : on ? 'hide picture' : 'show picture';
    btn.title = !has
      ? 'Show a schematic or photo in a floating window (I). You can also drop or paste a picture.'
      : (on ? 'Hide' : 'Show') + ' the reference picture (I)';
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on);
  }

  function initToolbar() {
    $('board-name').addEventListener('change', (ev) => {
      const name = ev.target.value.trim();
      if (name) store.change((p) => { p.name = name.slice(0, 60); });
      else ev.target.value = store.state.project.name;
    });
    for (const btn of document.querySelectorAll('[data-tool]')) btn.addEventListener('click', () => setTool(btn.dataset.tool));
    for (const btn of document.querySelectorAll('[data-view]')) btn.addEventListener('click', () => store.setUi({ view: btn.dataset.view }));
    $('undo').addEventListener('click', store.undo);
    $('redo').addEventListener('click', store.redo);
    $('fit').addEventListener('click', PCB.boardView.fit);
    $('board-size').addEventListener('click', () => openBoardDialog(false));
    $('picture').addEventListener('click', PCB.picture.toggle);

    const item = (id, fn) => $(id).addEventListener('click', () => fn());
    item('file-new', () => openBoardDialog(true));
    item('file-open', () => $('file-input').click());
    item('file-save', PCB.files.save);
    item('file-svg', PCB.files.exportSvg);
    item('file-png', () => PCB.files.exportPng(toast));
    item('file-print', () => PCB.files.print($('print-sheet')));
    $('file-input').addEventListener('change', (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (file) PCB.files.open(file, toast);
    });
  }

  // ---------- board size / new board dialog ----------

  function openBoardDialog(isNew) {
    const dialog = $('board-dialog');
    const p = store.state.project;
    const num = (value) => h('input', { type: 'number', min: 2, max: PCB.MAX_BOARD, value, required: true });
    const cols = num(p.board.cols);
    const rows = num(p.board.rows);
    const name = h('input', { type: 'text', value: '', maxlength: 60, placeholder: 'Untitled board' });
    const error = h('p', { class: 'pb-form-error', role: 'alert', hidden: true });
    const mm = h('p', { class: 'pb-hint' });
    const showMm = () => {
      const c = Number(cols.value);
      const r = Number(rows.value);
      mm.textContent = c > 0 && r > 0 ? 'Hole area about ' + ((c - 1) * 2.54).toFixed(1) + ' × ' + ((r - 1) * 2.54).toFixed(1) + ' mm.' : '';
    };
    cols.addEventListener('input', showMm);
    rows.addEventListener('input', showMm);
    showMm();

    PCB.clear(dialog).append(h('form', { method: 'dialog', onsubmit: (ev) => {
      ev.preventDefault();
      const c = Math.round(Number(cols.value));
      const r = Math.round(Number(rows.value));
      if (!(c >= 2 && c <= PCB.MAX_BOARD && r >= 2 && r <= PCB.MAX_BOARD)) {
        error.textContent = 'Use between 2 and ' + PCB.MAX_BOARD + ' holes each way.';
        error.hidden = false;
        return;
      }
      if (isNew) store.load(PCB.newProject(name.value.trim() || 'Untitled board', c, r, store.state.project.footprints));
      else store.change((proj) => { proj.board = { cols: c, rows: r }; });
      dialog.close();
    } },
      h('h2', { text: isNew ? 'New board' : 'Board size' }),
      isNew ? h('p', { class: 'pb-hint', text: 'This replaces the board on screen. Save it first if you want to keep it. Your footprints carry over.' }) : null,
      isNew ? h('label', { class: 'pb-stack' }, h('span', { class: 'pb-field-label', text: 'Name' }), name) : null,
      h('div', { class: 'pb-form-row' },
        h('label', null, h('span', { class: 'pb-field-label', text: 'Holes across' }), cols),
        h('label', null, h('span', { class: 'pb-field-label', text: 'Holes down' }), rows)),
      mm,
      isNew ? null : h('p', { class: 'pb-hint', text: 'Parts and wires keep their place, counted from the top-left hole. Anything left off the board is listed under Issues.' }),
      error,
      h('div', { class: 'pb-dialog-actions' },
        h('span', { class: 'pb-spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        h('button', { class: 'btn btn-go', type: 'submit' }, isNew ? 'Create board' : 'Resize board'))));
    dialog.showModal();
    (isNew ? name : cols).focus();
  }

  // ---------- keyboard ----------

  function onKey(ev) {
    const target = ev.target;
    if (target.closest && target.closest('input, select, textarea, dialog')) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key.toLowerCase();
    const ui = store.state.ui;

    if (mod && key === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) store.redo();
      else store.undo();
    } else if (mod && key === 'y') {
      ev.preventDefault();
      store.redo();
    } else if (mod && key === 's') {
      ev.preventDefault();
      PCB.files.save();
    } else if (mod || ev.altKey) {
      return;
    } else if (key === 'escape') {
      if (PCB.boardView.cancelInteraction()) return;
      if (ui.tool !== 'select') setTool('select');
      else store.setUi({ selection: null, focusId: null, flashAt: null });
    } else if (key === 'delete' || key === 'backspace') {
      if (ui.selection) {
        ev.preventDefault();
        PCB.sidePanel.removeSelected();
      }
    } else if (key === 'r') {
      if (ui.tool === 'place') store.setUi({ placeRot: (ui.placeRot + 1) % 4 });
      else PCB.sidePanel.rotateSelected();
    } else if (key === 'v') setTool('select');
    else if (key === 'w') setTool('routed');
    else if (key === 'd') setTool('direct');
    else if (key === 'b') setTool('bridge');
    else if (key === 'i') PCB.picture.toggle();
    else if (key === 'f') store.setUi({ view: ui.view === 'top' ? 'bottom' : 'top' });
  }

  function start() {
    const saved = store.savedProject();
    PCB.footprintEditor.init();
    PCB.boardView.init($('board-wrap'), $('status'));
    PCB.partsPanel.init($('parts'));
    PCB.sidePanel.init($('side'));
    PCB.picture.init({ onChange: renderPictureButton, onError: toast });
    initLayers();
    initToolbar();
    store.subscribe(renderToolbar);
    document.addEventListener('keydown', onKey);
    store.load(saved || PCB.newProject('Untitled board', 30, 20, store.library()));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(globalThis.PCB = globalThis.PCB || {});
