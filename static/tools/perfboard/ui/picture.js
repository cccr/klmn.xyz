// A reference picture (schematic, photo, datasheet page) in a floating window over the app.
// It can be moved by its title bar, resized from the corner (the picture scales with it) and hidden.
// Marks can be drawn over the picture (pen strokes and circles), e.g. to tick off parts already placed.
// The picture, its marks and the window's place are kept in this browser, separately from the board file.
(function (PCB) {
  'use strict';

  const { h, s: svgEl } = PCB;
  const INKS = [
    { name: 'Green', value: '#2f9e44' },
    { name: 'Red', value: '#e03131' },
    { name: 'Blue', value: '#1c7ed6' },
  ];
  const MAX_MARKS = 500;
  const KEY = 'perfboard-picture';
  const MIN_W = 260;
  const MARGIN = 8;

  let win = null;
  let img = null;
  let title = null;
  let input = null;
  let slider = null;
  let percent = null;
  let marksSvg = null;
  let toolButtons = {};
  let inkButtons = [];
  let undoBtn = null;
  let clearBtn = null;
  // Drawing tool: null (off), 'pen', 'ring' or 'erase'. Not saved; the window opens with drawing off.
  let tool = null;
  let ink = INKS[0].value;
  // Earlier versions of the marks list, for Undo. Kept for this visit only.
  let history = [];
  let onChange = () => {};
  let onError = () => {};
  // { name, src, x, y, w, hidden, opacity, marks }; w is the picture's width in CSS pixels, opacity 0.1 to 1.
  // Marks are in the picture's own pixels, so they stay put when the window is resized:
  //   { type: 'pen', color, points: [[x, y], ...] } or { type: 'ring', color, cx, cy, rx, ry }
  let state = null;

  function storage() {
    try {
      return globalThis.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function persist() {
    const ls = storage();
    if (!ls) return;
    try {
      if (state) ls.setItem(KEY, JSON.stringify(state));
      else ls.removeItem(KEY);
    } catch (e) {
      onError('The picture is too big to keep in this browser. It will be gone after a reload.');
    }
  }

  function restore() {
    const ls = storage();
    if (!ls) return null;
    try {
      const s = JSON.parse(ls.getItem(KEY));
      if (s && typeof s.src === 'string' && /^data:image\//.test(s.src)) {
        return { name: String(s.name || 'Picture').slice(0, 80), src: s.src, x: +s.x || 0, y: +s.y || 0, w: +s.w || 360, hidden: !!s.hidden, opacity: opacityOf(s.opacity), marks: cleanMarks(s.marks) };
      }
    } catch (e) { /* ignore a damaged entry */ }
    return null;
  }

  const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6;
  const isColor = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

  function cleanMarks(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const m of list.slice(0, MAX_MARKS)) {
      if (!m || !isColor(m.color)) continue;
      if (m.type === 'pen' && Array.isArray(m.points)) {
        const points = m.points.filter((p) => Array.isArray(p) && num(p[0]) && num(p[1])).map((p) => [p[0], p[1]]);
        if (points.length) out.push({ type: 'pen', color: m.color, points });
      } else if (m.type === 'ring' && [m.cx, m.cy, m.rx, m.ry].every(num)) {
        out.push({ type: 'ring', color: m.color, cx: m.cx, cy: m.cy, rx: Math.abs(m.rx), ry: Math.abs(m.ry) });
      }
    }
    return out;
  }

  const opacityOf = (v) => (Number.isFinite(+v) && v !== null ? Math.max(0.1, Math.min(1, +v)) : 1);

  function showOpacity() {
    img.style.opacity = state.opacity;
    win.classList.toggle('is-see-through', state.opacity < 1);
    slider.value = Math.round(state.opacity * 100);
    percent.textContent = Math.round(state.opacity * 100) + '%';
  }

  // Keeps the window on screen and no wider than the viewport.
  function clamp() {
    if (!state) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    state.w = Math.max(MIN_W, Math.min(state.w, vw - 2 * MARGIN));
    const height = win.hidden ? 200 : win.offsetHeight || 200;
    state.x = Math.max(MARGIN, Math.min(state.x, vw - state.w - MARGIN));
    state.y = Math.max(MARGIN, Math.min(state.y, vh - Math.min(height, 40) - MARGIN));
  }

  function layout() {
    win.style.left = state.x + 'px';
    win.style.top = state.y + 'px';
    win.style.width = state.w + 'px';
  }

  function show() {
    if (!state) {
      win.hidden = true;
      onChange();
      return;
    }
    title.textContent = state.name;
    title.title = state.name;
    if (img.getAttribute('src') !== state.src) img.src = state.src;
    showOpacity();
    drawMarks();
    showTools();
    win.hidden = state.hidden;
    if (!state.hidden) {
      clamp();
      layout();
    }
    onChange();
  }

  // ---------- loading a picture ----------

  function load(file) {
    if (!file || !/^image\//.test(file.type)) {
      onError('That file is not a picture. Use a PNG, JPEG, GIF, WebP or SVG image.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => onError('That picture could not be read.');
    reader.onload = () => {
      const src = String(reader.result);
      const probe = new Image();
      probe.onerror = () => onError('That picture could not be shown.');
      probe.onload = () => {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        // Start at its natural size, but no bigger than about a third of the screen.
        const ratio = probe.naturalHeight / (probe.naturalWidth || 1) || 1;
        let w = Math.min(probe.naturalWidth || 360, vw * 0.36, (vh * 0.5) / ratio);
        w = Math.max(MIN_W, Math.round(w));
        const keepPlace = state && !state.hidden;
        const opacity = state ? state.opacity : 1;
        state = {
          name: file.name || 'Pasted picture', src, w,
          x: keepPlace ? state.x : vw - w - 400, y: keepPlace ? state.y : 64, hidden: false, opacity,
          marks: [],
        };
        history = [];
        show();
        persist();
      };
      probe.src = src;
    };
    reader.readAsDataURL(file);
  }

  function choose() {
    input.click();
  }

  function remove() {
    state = null;
    history = [];
    tool = null;
    img.removeAttribute('src');
    persist();
    show();
  }

  // Toolbar button and the I key: pick a picture if there is none, otherwise show or hide it.
  function toggle() {
    if (!state) return choose();
    state.hidden = !state.hidden;
    show();
    persist();
  }

  // ---------- moving and resizing ----------

  function drag(ev, move) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const start = { px: ev.clientX, py: ev.clientY, x: state.x, y: state.y, w: state.w };
    const target = ev.currentTarget;
    target.setPointerCapture(ev.pointerId);
    win.classList.add('is-dragging');
    const onMove = (e) => {
      move(start, e.clientX - start.px, e.clientY - start.py);
      clamp();
      layout();
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      win.classList.remove('is-dragging');
      persist();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  function onMoveStart(ev) {
    if (ev.target.closest('button')) return;
    drag(ev, (s, dx, dy) => { state.x = s.x + dx; state.y = s.y + dy; });
  }

  // The corner follows the pointer; the height comes from the picture's own proportions.
  function onResizeStart(ev) {
    const ratio = img.naturalHeight / (img.naturalWidth || 1) || 1;
    drag(ev, (s, dx, dy) => {
      const down = dy / ratio;
      state.w = s.w + (Math.abs(dx) >= Math.abs(down) ? dx : down);
    });
  }

  function onResizeKey(ev) {
    const step = ev.shiftKey ? 50 : 10;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') state.w += step;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') state.w -= step;
    else return;
    ev.preventDefault();
    clamp();
    layout();
    persist();
  }

  // ---------- marks ----------

  function size() {
    return { w: img.naturalWidth || img.clientWidth || 1000, h: img.naturalHeight || img.clientHeight || 1000 };
  }

  function markShape(m) {
    const common = { stroke: m.color, fill: 'none', 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    if (m.type === 'ring') return svgEl('ellipse', Object.assign({ cx: m.cx, cy: m.cy, rx: m.rx, ry: m.ry }, common));
    // A single tap with the pen leaves a dot.
    const pts = m.points.length === 1 ? [m.points[0], [m.points[0][0] + 0.01, m.points[0][1]]] : m.points;
    return svgEl('path', Object.assign({ d: 'M' + pts.map((p) => p[0] + ' ' + p[1]).join('L') }, common));
  }

  function drawMarks() {
    if (!state) return;
    const { w, h: ht } = size();
    marksSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + ht);
    PCB.clear(marksSvg);
    state.marks.forEach((m, i) => {
      const g = svgEl('g', { 'data-i': i });
      // A wide invisible copy makes thin marks easy to hit with the eraser.
      const hit = markShape(m);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', 14);
      hit.setAttribute('class', 'pb-mark-hit');
      g.append(hit, markShape(m));
      marksSvg.append(g);
    });
  }

  function showTools() {
    if (!state) return;
    for (const [name, btn] of Object.entries(toolButtons)) {
      btn.classList.toggle('is-on', tool === name);
      btn.setAttribute('aria-pressed', tool === name);
    }
    inkButtons.forEach((b) => {
      const on = b.dataset.ink === ink;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on);
    });
    marksSvg.dataset.tool = tool || '';
    undoBtn.disabled = !history.length;
    clearBtn.disabled = !state.marks.length;
  }

  function setTool(name) {
    tool = tool === name ? null : name;
    showTools();
  }

  // Every change to the marks goes through here so it can be undone.
  function changeMarks(fn) {
    history.push(JSON.stringify(state.marks));
    if (history.length > 50) history.shift();
    fn(state.marks);
    state.marks.splice(MAX_MARKS);
    drawMarks();
    showTools();
    persist();
  }

  function undoMark() {
    if (!history.length) return;
    state.marks = JSON.parse(history.pop());
    drawMarks();
    showTools();
    persist();
  }

  function toPicture(ev) {
    const m = marksSvg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  }

  function onMarkDown(ev) {
    if (!tool || ev.button !== 0) return;
    ev.preventDefault();
    if (tool === 'erase') {
      const g = ev.target.closest('g[data-i]');
      if (g) changeMarks((marks) => marks.splice(Number(g.dataset.i), 1));
      return;
    }
    marksSvg.setPointerCapture(ev.pointerId);
    const start = toPicture(ev);
    // Skip points closer than about 2 screen pixels, so long strokes stay small in storage.
    const unit = size().w / (marksSvg.getBoundingClientRect().width || 1);
    const mark = tool === 'pen'
      ? { type: 'pen', color: ink, points: [start] }
      : { type: 'ring', color: ink, cx: start[0], cy: start[1], rx: 0, ry: 0 };
    let live = markShape(mark);
    marksSvg.append(live);
    const onMove = (e) => {
      const p = toPicture(e);
      if (mark.type === 'pen') {
        const last = mark.points[mark.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2 * unit) return;
        mark.points.push(p);
      } else {
        // Drag out the box the circle fits in; Shift makes it round.
        let dx = (p[0] - start[0]) / 2;
        let dy = (p[1] - start[1]) / 2;
        if (e.shiftKey) {
          const r = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * r;
          dy = Math.sign(dy || 1) * r;
        }
        Object.assign(mark, { cx: start[0] + dx, cy: start[1] + dy, rx: Math.abs(dx), ry: Math.abs(dy) });
      }
      const next = markShape(mark);
      live.replaceWith(next);
      live = next;
    };
    const onUp = () => {
      marksSvg.removeEventListener('pointermove', onMove);
      marksSvg.removeEventListener('pointerup', onUp);
      marksSvg.removeEventListener('pointercancel', onUp);
      live.remove();
      const tooSmall = mark.type === 'ring' && Math.max(mark.rx, mark.ry) < 3 * unit;
      if (!tooSmall) changeMarks((marks) => marks.push(mark));
    };
    marksSvg.addEventListener('pointermove', onMove);
    marksSvg.addEventListener('pointerup', onUp);
    marksSvg.addEventListener('pointercancel', onUp);
  }

  // ---------- set-up ----------

  function init(opts) {
    onChange = opts.onChange || onChange;
    onError = opts.onError || onError;

    input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (file) load(file);
    } });
    title = h('span', { class: 'pb-picture-title' });
    img = h('img', { class: 'pb-picture-img', alt: 'Reference picture', draggable: 'false' });
    // Fades the picture while dragging; saved once the slider is let go (the picture can be megabytes).
    slider = h('input', {
      class: 'pb-picture-range', type: 'range', min: 10, max: 100, step: 5, value: 100, 'aria-label': 'Picture opacity',
      oninput: () => { state.opacity = opacityOf(slider.value / 100); showOpacity(); },
      onchange: persist,
    });
    percent = h('output', { class: 'pb-picture-percent', text: '100%' });
    marksSvg = svgEl('svg', { class: 'pb-picture-marks', preserveAspectRatio: 'none', 'aria-label': 'Marks on the picture' });
    marksSvg.addEventListener('pointerdown', onMarkDown);
    img.addEventListener('load', drawMarks);
    const toolBtn = (name, label, tip) => (toolButtons[name] = h('button', {
      class: 'pb-picture-btn pb-picture-tool', type: 'button', title: tip, 'aria-pressed': 'false', onclick: () => setTool(name),
    }, label));
    inkButtons = INKS.map((c) => h('button', {
      class: 'pb-picture-ink', type: 'button', style: 'background:' + c.value, 'data-ink': c.value,
      title: c.name + ' ink', 'aria-label': c.name + ' ink',
      onclick: () => { ink = c.value; if (!tool || tool === 'erase') tool = 'pen'; showTools(); },
    }));
    undoBtn = h('button', { class: 'pb-picture-btn', type: 'button', title: 'Undo the last change to the marks', onclick: undoMark }, 'Undo');
    clearBtn = h('button', { class: 'pb-picture-btn', type: 'button', title: 'Remove all marks (Undo brings them back)',
      onclick: () => changeMarks((marks) => marks.splice(0)) }, 'Clear');
    const grip = h('div', {
      class: 'pb-picture-grip', tabindex: 0, role: 'slider', 'aria-label': 'Picture size (arrow keys)',
      title: 'Drag to resize', onpointerdown: onResizeStart, onkeydown: onResizeKey,
    });
    win = h('section', { class: 'pb-picture-win', 'aria-label': 'Reference picture', hidden: true },
      h('header', { class: 'pb-picture-bar', title: 'Drag to move', onpointerdown: onMoveStart },
        title,
        h('button', { class: 'pb-picture-btn', type: 'button', title: 'Show a different picture', onclick: choose }, 'Change'),
        h('button', { class: 'pb-picture-btn', type: 'button', title: 'Hide the picture (I)', onclick: toggle }, 'Hide'),
        h('button', { class: 'pb-picture-btn', type: 'button', title: 'Remove the picture', 'aria-label': 'Remove the picture', onclick: remove }, '×')),
      h('label', { class: 'pb-picture-opacity' }, h('span', { text: 'Opacity' }), slider, percent),
      h('div', { class: 'pb-picture-draw', role: 'toolbar', 'aria-label': 'Draw on the picture' },
        toolBtn('pen', 'Pen', 'Draw freehand on the picture'),
        toolBtn('ring', 'Circle', 'Drag to circle something (Shift for a round circle)'),
        toolBtn('erase', 'Erase', 'Click a mark to remove it'),
        h('span', { class: 'pb-picture-inks' }, inkButtons),
        h('span', { class: 'pb-picture-edits' }, undoBtn, clearBtn)),
      h('div', { class: 'pb-picture-body' }, img, marksSvg),
      grip);
    document.body.append(win, input);

    window.addEventListener('resize', () => {
      if (state && !state.hidden) {
        clamp();
        layout();
      }
    });

    // A picture can also be dropped anywhere on the page or pasted from the clipboard.
    const imageIn = (list) => Array.from(list || []).find((f) => f && /^image\//.test(f.type));
    document.addEventListener('dragover', (ev) => {
      if (Array.from(ev.dataTransfer.items || []).some((i) => i.kind === 'file' && /^image\//.test(i.type))) ev.preventDefault();
    });
    document.addEventListener('drop', (ev) => {
      const file = imageIn(ev.dataTransfer.files);
      if (!file) return;
      ev.preventDefault();
      load(file);
    });
    document.addEventListener('paste', (ev) => {
      if (ev.target.closest && ev.target.closest('input, textarea')) return;
      const file = imageIn(ev.clipboardData && ev.clipboardData.files);
      if (!file) return;
      ev.preventDefault();
      load(file);
    });

    state = restore();
    if (state) {
      if (img.complete === false || !img.src) img.addEventListener('load', () => { if (state && !state.hidden) { clamp(); layout(); } }, { once: true });
      show();
    }
  }

  PCB.picture = {
    init, choose, toggle, remove,
    has: () => !!state,
    visible: () => !!state && !state.hidden,
  };
})(globalThis.PCB = globalThis.PCB || {});
