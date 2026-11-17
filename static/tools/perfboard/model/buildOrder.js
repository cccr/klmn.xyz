// The order to solder things in. Default: the top side first, then the bottom, so the board is
// turned over once. On each side routed wires go first, shortest first (they lie flat), then direct
// wires, shortest first (they fly over everything else). Solder bridges open the bottom side.
(function (PCB) {
  'use strict';

  function allSteps(project) {
    const steps = [];
    for (const bridge of project.bridges) {
      const n = PCB.bridgeHoles(bridge).length - 1;
      steps.push({ id: bridge.id, kind: 'bridge', tier: 2, length: n, item: bridge });
    }
    for (const wire of project.wires) {
      const base = PCB.wireSide(wire) === 'bottom' ? 3 : 0;
      steps.push({ id: wire.id, kind: 'wire', tier: base + (wire.mode === 'routed' ? 0 : 1), length: PCB.pitchLength(wire), item: wire });
    }
    return steps;
  }

  function defaultOrder(project) {
    const steps = allSteps(project);
    steps.sort((a, b) => a.tier - b.tier || a.length - b.length || 0);
    return steps;
  }

  // Steps in the order to show them: the saved manual order if there is one, with anything added
  // since appended in default order.
  function buildSteps(project) {
    const sorted = defaultOrder(project);
    const manual = project.build && project.build.order;
    if (!manual) return sorted;
    const byId = new Map(sorted.map((s) => [s.id, s]));
    const out = [];
    for (const id of manual) {
      if (byId.has(id)) {
        out.push(byId.get(id));
        byId.delete(id);
      }
    }
    for (const s of sorted) if (byId.has(s.id)) out.push(s);
    return out;
  }

  // Move step `id` so it sits just before `beforeId` (or at the end when beforeId is null).
  function moveStep(project, id, beforeId) {
    const ids = buildSteps(project).map((s) => s.id).filter((x) => x !== id);
    const at = beforeId ? ids.indexOf(beforeId) : -1;
    if (at < 0) ids.push(id);
    else ids.splice(at, 0, id);
    project.build.order = ids;
  }

  Object.assign(PCB, { defaultOrder, buildSteps, moveStep });
})(globalThis.PCB = globalThis.PCB || {});
