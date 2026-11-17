// One state object, change notifications, snapshot undo/redo and autosave.
(function (PCB) {
  'use strict';

  const SAVE_KEY = 'perfboard-project';
  const LIBRARY_KEY = 'perfboard-library';
  const LAYERS_KEY = 'perfboard-layers';
  const MAX_UNDO = 100;

  const listeners = [];
  let undoStack = [];
  let redoStack = [];
  let revision = 0;
  let derivedAt = -1;
  let derivedValue = null;
  let saveTimer = null;

  const state = {
    project: null,
    ui: {
      tool: 'select',          // select | routed | direct | bridge | place
      placeFootprintId: null,
      placeRot: 0,
      selection: null,         // { kind: 'wire' | 'part' | 'bridge', id }
      view: 'top',             // top | bottom
      wireColor: PCB.WIRE_COLORS[0].value,
      tab: 'wires',            // wires | build | issues
      focusId: null,           // build step shown on its own
      flashAt: null,           // hole to point at (from the issues list)
      layers: PCB.allLayers(), // which layers are shown; kept in this browser
    },
  };

  function storage() {
    try {
      return globalThis.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function savedLayers() {
    const layers = PCB.allLayers();
    try {
      const raw = JSON.parse(storage().getItem(LAYERS_KEY));
      for (const id of Object.keys(layers)) if (raw && raw[id] === false) layers[id] = false;
    } catch (e) { /* none saved yet */ }
    return layers;
  }
  state.ui.layers = savedLayers();

  function saveLayers() {
    try {
      storage().setItem(LAYERS_KEY, JSON.stringify(state.ui.layers));
    } catch (e) { /* only a preference */ }
  }

  // Whatever gets selected or focused is shown, even if its layer was hidden.
  function revealSelection(patch) {
    const p = state.project;
    if (!p) return;
    const wanted = [];
    if (patch.selection) wanted.push(PCB.layerOf(p, patch.selection.kind, patch.selection.id));
    if (patch.focusId) wanted.push(PCB.layerOf(p, null, patch.focusId));
    const hidden = wanted.filter((l) => l && !state.ui.layers[l]);
    if (!hidden.length) return;
    state.ui.layers = Object.assign({}, state.ui.layers);
    for (const l of hidden) state.ui.layers[l] = true;
    saveLayers();
  }

  function notify(what) {
    for (const fn of listeners.slice()) fn(what);
  }

  function saveNow() {
    const ls = storage();
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!ls || !state.project) return;
    try {
      ls.setItem(SAVE_KEY, PCB.toJSON(state.project));
      ls.setItem(LIBRARY_KEY, JSON.stringify(state.project.footprints));
    } catch (e) { /* storage full or blocked: the Save button still works */ }
  }

  // Saves shortly after an edit, and at once if the page is closed or reloaded before that.
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  if (globalThis.addEventListener) globalThis.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

  // Drop selection / focus that points at something that no longer exists.
  function tidyUi() {
    const p = state.project;
    const exists = (kind, id) => {
      const list = kind === 'wire' ? p.wires : kind === 'part' ? p.parts : p.bridges;
      return list.some((x) => x.id === id);
    };
    const sel = state.ui.selection;
    if (sel && !exists(sel.kind, sel.id)) state.ui.selection = null;
    if (state.ui.focusId && !exists('wire', state.ui.focusId) && !exists('bridge', state.ui.focusId)) state.ui.focusId = null;
    if (state.ui.tool === 'place' && !PCB.footprintById(p, state.ui.placeFootprintId)) state.ui.tool = 'select';
    for (const id of Object.keys(p.build.done)) {
      if (!exists('wire', id) && !exists('bridge', id)) delete p.build.done[id];
    }
  }

  const store = {
    state,
    subscribe(fn) {
      listeners.push(fn);
    },
    revision() {
      return revision;
    },

    // Remember the current project so the next edits can be undone as one step.
    begin() {
      undoStack.push(JSON.stringify(state.project));
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack = [];
    },
    // Announce that the project was edited.
    touch() {
      revision += 1;
      tidyUi();
      scheduleSave();
      notify('project');
    },
    // One undoable edit.
    change(fn) {
      store.begin();
      fn(state.project);
      store.touch();
    },
    // Throw away the edits made since the last begin().
    cancel() {
      if (!undoStack.length) return;
      state.project = JSON.parse(undoStack.pop());
      store.touch();
    },
    undo() {
      if (!undoStack.length) return;
      redoStack.push(JSON.stringify(state.project));
      state.project = JSON.parse(undoStack.pop());
      store.touch();
    },
    redo() {
      if (!redoStack.length) return;
      undoStack.push(JSON.stringify(state.project));
      state.project = JSON.parse(redoStack.pop());
      store.touch();
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    setUi(patch) {
      Object.assign(state.ui, patch);
      revealSelection(patch);
      notify('ui');
    },

    // Show or hide one layer. Hiding the layer of the selected item lets go of it.
    setLayer(id, on) {
      const ui = state.ui;
      ui.layers = Object.assign({}, ui.layers, { [id]: !!on });
      const sel = ui.selection;
      if (!on && sel && PCB.layerOf(state.project, sel.kind, sel.id) === id) ui.selection = null;
      if (!on && ui.focusId && PCB.layerOf(state.project, null, ui.focusId) === id) ui.focusId = null;
      saveLayers();
      notify('ui');
    },

    // Replace the whole project (new, open, startup).
    load(project) {
      state.project = project;
      undoStack = [];
      redoStack = [];
      Object.assign(state.ui, { selection: null, focusId: null, flashAt: null, tool: 'select' });
      revision += 1;
      scheduleSave();
      notify('load');
    },

    // Wire conflicts and issues for the current project, computed once per edit.
    derived() {
      if (derivedAt !== revision) {
        const conflicts = PCB.wireConflicts(state.project.wires);
        derivedValue = { conflicts, issues: PCB.findIssues(state.project, conflicts) };
        derivedAt = revision;
      }
      return derivedValue;
    },

    savedProject() {
      const ls = storage();
      if (!ls) return null;
      try {
        const text = ls.getItem(SAVE_KEY);
        return text ? PCB.fromJSON(text) : null;
      } catch (e) {
        return null;
      }
    },

    // Footprints remembered from earlier sessions, checked the same way as a project file.
    library() {
      const ls = storage();
      try {
        const text = ls && ls.getItem(LIBRARY_KEY);
        if (!text) return PCB.defaultLibrary();
        const shell = PCB.newProject('library', 10, 10);
        shell.footprints = JSON.parse(text);
        const checked = PCB.fromJSON(JSON.stringify(shell)).footprints;
        return checked.length ? checked : PCB.defaultLibrary();
      } catch (e) {
        return PCB.defaultLibrary();
      }
    },
  };

  PCB.store = store;
})(globalThis.PCB = globalThis.PCB || {});
