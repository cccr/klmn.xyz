// Layout problems worth pointing out. Each issue:
//   { level:'error'|'warn'|'info', kind, text, at:{x,y}|null, ids:[item ids] }
(function (PCB) {
  'use strict';

  function onBoard(h, board) {
    return h.x >= 0 && h.y >= 0 && h.x < board.cols && h.y < board.rows;
  }

  function findIssues(project, conflicts) {
    const issues = [];
    const add = (level, kind, text, at, ids) => issues.push({ level, kind, text, at: at || null, ids: ids || [] });
    const placed = PCB.placedParts(project);
    const wireById = new Map(project.wires.map((w) => [w.id, w]));
    const name = (id) => (wireById.get(id) ? wireById.get(id).label : '?');
    const hl = PCB.holeLabel;

    // Pins by hole.
    const pinAt = new Map();
    for (const p of placed) {
      for (const pin of p.pins) {
        const k = PCB.key(pin);
        if (pinAt.has(k)) {
          add('error', 'pin-clash', p.part.ref + ' and ' + pinAt.get(k).part.ref + ' both have a pin in ' + hl(pin), pin,
            [p.part.id, pinAt.get(k).part.id]);
        } else {
          pinAt.set(k, p);
        }
      }
    }

    // Parts: off the board, or bodies on top of each other.
    for (const p of placed) {
      const off = p.pins.find((pin) => !onBoard(pin, project.board));
      if (off) add('error', 'part-off-board', p.part.ref + ' has pins off the board', null, [p.part.id]);
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (PCB.rectsOverlap(placed[i].body, placed[j].body)) {
          add('warn', 'part-overlap', placed[i].part.ref + ' and ' + placed[j].part.ref + ' overlap', null,
            [placed[i].part.id, placed[j].part.id]);
        }
      }
    }

    // Wires against each other.
    const found = conflicts || PCB.wireConflicts(project.wires);
    for (const o of found.overlaps) {
      const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
      const text = o.wireA === o.wireB
        ? name(o.wireA) + ' runs over itself between ' + hl(o.a) + ' and ' + hl(o.b)
        : name(o.wireA) + ' and ' + name(o.wireB) + ' share the run ' + hl(o.a) + '–' + hl(o.b);
      add('error', 'overlap', text, mid, [o.wireA, o.wireB]);
    }
    const crossPairs = new Map();
    for (const c of found.crossings) {
      const k = c.wireA + '|' + c.wireB;
      if (!crossPairs.has(k)) crossPairs.set(k, { c, n: 0 });
      crossPairs.get(k).n += 1;
    }
    for (const { c, n } of crossPairs.values()) {
      const text = c.wireA === c.wireB
        ? name(c.wireA) + ' crosses itself'
        : name(c.wireA) + ' crosses ' + name(c.wireB) + (n > 1 ? ' ' + n + ' times' : '');
      add('info', 'crossing', text, c.at, [c.wireA, c.wireB]);
    }

    // Wires against parts and the board.
    const endCount = new Map();
    for (const wire of project.wires) {
      for (const end of PCB.wireEnds(wire)) {
        const k = PCB.key(end);
        endCount.set(k, (endCount.get(k) || []).concat(wire.id));
      }
    }
    const bridged = new Set();
    for (const bridge of project.bridges) {
      const holes = PCB.bridgeHoles(bridge);
      for (const h of holes) bridged.add(PCB.key(h));
      if (holes.some((h) => !onBoard(h, project.board))) add('error', 'bridge-off-board', 'A solder bridge runs off the board', bridge.a, [bridge.id]);
    }

    for (const wire of project.wires) {
      const ends = PCB.wireEnds(wire);
      const endKeys = new Set(ends.map(PCB.key));
      if (wire.points.some((p) => !onBoard(p, project.board))) {
        add('error', 'wire-off-board', wire.label + ' runs off the board', null, [wire.id]);
      }

      if (wire.mode === 'routed') {
        const hitParts = new Set();
        for (const h of PCB.holesAlong(wire)) {
          const k = PCB.key(h);
          if (endKeys.has(k)) continue;
          const owner = pinAt.get(k);
          if (owner) {
            add('error', 'over-pin', wire.label + ' runs over a pin of ' + owner.part.ref + ' at ' + hl(h), h, [wire.id, owner.part.id]);
            hitParts.add(owner.part.id);
            continue;
          }
          // Part bodies are on the top, so only top-side wires can run into them.
          if (PCB.wireSide(wire) === 'bottom') continue;
          for (const p of placed) {
            if (!hitParts.has(p.part.id) && PCB.pointInRect(h, p.body)) {
              hitParts.add(p.part.id);
              add('warn', 'over-part', wire.label + ' runs across ' + p.part.ref, h, [wire.id, p.part.id]);
            }
          }
        }
      }

      for (const end of ends) {
        const k = PCB.key(end);
        if (pinAt.has(k)) continue;
        const under = PCB.wireSide(wire) === 'top' && placed.find((p) => PCB.pointInRect(end, p.body));
        if (under) add('warn', 'end-under-part', wire.label + ' ends under ' + under.part.ref + ' at ' + hl(end), end, [wire.id, under.part.id]);
        const sharers = endCount.get(k);
        if (sharers.length === 1 && !bridged.has(k)) {
          add('warn', 'dangling', wire.label + ' ends in ' + hl(end) + ' with nothing joined to it', end, [wire.id]);
        }
      }
    }

    // Two wire ends pushed into one free hole.
    for (const [k, ids] of endCount) {
      if (ids.length < 2 || pinAt.has(k)) continue;
      const [x, y] = k.split(',').map(Number);
      const labels = ids.map(name);
      add('warn', 'shared-hole', labels.join(' and ') + ' end in the same free hole ' + hl({ x, y }), { x, y }, ids);
    }

    const rank = { error: 0, warn: 1, info: 2 };
    issues.sort((a, b) => rank[a.level] - rank[b.level]);
    return issues;
  }

  Object.assign(PCB, { findIssues, onBoard });
})(globalThis.PCB = globalThis.PCB || {});
