// Which holes are electrically joined: wires join their two end holes, bridges join every hole they
// cover. A part's pins are not joined to each other.
(function (PCB) {
  'use strict';

  function computeNets(project) {
    const parent = new Map();
    const find = (k) => {
      if (!parent.has(k)) parent.set(k, k);
      let root = k;
      while (parent.get(root) !== root) root = parent.get(root);
      while (parent.get(k) !== root) {
        const next = parent.get(k);
        parent.set(k, root);
        k = next;
      }
      return root;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const wire of project.wires) {
      const [a, b] = PCB.wireEnds(wire);
      union(PCB.key(a), PCB.key(b));
    }
    for (const bridge of project.bridges) {
      const holes = PCB.bridgeHoles(bridge);
      for (let i = 1; i < holes.length; i++) union(PCB.key(holes[0]), PCB.key(holes[i]));
    }

    return {
      // Net id for a hole, or null when nothing is attached to it.
      netOf(h) {
        const k = PCB.key(h);
        return parent.has(k) ? find(k) : null;
      },
      // All holes on the same net as h (just h itself when it is unconnected).
      holes(h) {
        const k = PCB.key(h);
        if (!parent.has(k)) return [{ x: h.x, y: h.y }];
        const root = find(k);
        const out = [];
        for (const other of parent.keys()) {
          if (find(other) === root) {
            const [x, y] = other.split(',').map(Number);
            out.push({ x, y });
          }
        }
        return out;
      },
    };
  }

  // Everything on the net that hole h belongs to: { holes:Set<key>, wires:Set<id>, bridges:Set<id>, pins:[...] }.
  function netMembers(project, h) {
    const nets = computeNets(project);
    const holes = new Set(nets.holes(h).map(PCB.key));
    const wires = new Set();
    const bridges = new Set();
    const pins = [];
    for (const wire of project.wires) {
      if (holes.has(PCB.key(wire.points[0]))) wires.add(wire.id);
    }
    for (const bridge of project.bridges) {
      if (holes.has(PCB.key(bridge.a))) bridges.add(bridge.id);
    }
    for (const placed of PCB.placedParts(project)) {
      for (const pin of placed.pins) {
        if (holes.has(PCB.key(pin))) pins.push({ ref: placed.part.ref, name: pin.name, x: pin.x, y: pin.y });
      }
    }
    return { holes, wires, bridges, pins };
  }

  Object.assign(PCB, { computeNets, netMembers });
})(globalThis.PCB = globalThis.PCB || {});
