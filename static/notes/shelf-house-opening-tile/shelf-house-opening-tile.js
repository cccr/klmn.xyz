// Where an opening's settings go: a working mock-up of the Shelf House room
// editor's front view, and a report that measures six ways of fitting an
// opening's settings panel beside an unwrapped room. Every number the report
// shows is measured from the mock-up when the page loads.
(function () {
  'use strict';

  var SIZES = { laptop: [760, 600], small: [560, 460] };
  var VW = 760, VH = 600, TALL = 120, GAP = 8, PAD = 12;
  var T = { thick: 3, thin: 1.5, none: 0 };
  var WALLS = ['back', 'left', 'right', 'ceiling', 'floor'];
  var WALL_NAME = { back: 'Back wall', left: 'Left wall', right: 'Right wall', ceiling: 'Ceiling', floor: 'Floor' };
  var SHAPES = ['rect', 'arch', 'round'];
  var SHAPE_NAME = { rect: 'Rectangle', arch: 'Arch', round: 'Round' };

  // The ideas. tile: the panel's form; keep: opening a panel keeps the zoom
  // the room had with none open, and the view only slides to show the room,
  // that wall and its panel; fold: the room card and the other walls fold
  // away while a panel is open; tall: the view grows while a room is unwrapped.
  var VARIANTS = {
    panShape: { tile: 'shape', keep: true },
    pan: { tile: 'std', keep: true },
    focus: { tile: 'std', keep: true, fold: true },
    shape: { tile: 'shape' },
    tall: { tile: 'std', tall: true },
    base: { tile: 'std' },
  };

  function op(wall, shape, o) {
    var d = { wall: wall, shape: shape, anchor: 'centre', x: 0, y: 0, w: 30, h: 30, r: 0, cols: 1, rows: 1, bar: 2.5, count: 1, pitch: 40 };
    for (var k in o) d[k] = o[k];
    return d;
  }
  function room(id, x, y, size, color, name, ops) {
    return {
      id: id, x: x, y: y, w: size === 'wide' ? 120 : 80, h: 72, d: 56, color: color, name: name,
      walls: { back: 'thick', left: 'thick', right: 'thick', ceiling: 'thick', floor: 'thick' },
      outer: { tl: true, tr: true, br: true, bl: true }, inner: { tl: true, tr: true, br: true, bl: true },
      ops: ops || [],
    };
  }
  var ROOMS = [
    room(1, 0, 0, 'narrow', '#e9c46a', 'Narrow · porthole', [op('back', 'round', { w: 30, h: 30 })]),
    room(2, 80, 0, 'wide', '#90be6d', 'Wide · 6-pane', [op('back', 'rect', { y: 4, w: 46, h: 36, cols: 2, rows: 3 })]),
    room(3, 200, 0, 'wide', '#a7c4a0', 'Wide · 6-pane', [op('back', 'rect', { y: 4, w: 46, h: 36, cols: 2, rows: 3 })]),
    room(4, 320, 0, 'narrow', '#e5989b', 'Narrow · door', [op('left', 'arch', { anchor: 'floor', w: 24, h: 50 })]),
    room(5, 40, 72, 'wide', '#b8c0ff', 'Wide · portholes', [op('back', 'round', { w: 24, h: 24, count: 3, pitch: 32 })]),
    room(6, 160, 72, 'wide', '#f4a261', 'Wide · arched', [
      op('back', 'arch', { x: -22, w: 22, h: 40, rows: 2 }),
      op('back', 'arch', { x: 22, w: 22, h: 40, rows: 2 }),
      op('left', 'arch', { anchor: 'floor', w: 24, h: 50 }),
      op('right', 'rect', { y: 12, w: 24, h: 20, cols: 2, rows: 2 }),
      op('right', 'rect', { y: -14, w: 24, h: 20, cols: 2, rows: 2 }),
      op('ceiling', 'round', { w: 30, h: 30, cols: 2, rows: 2 }),
      op('floor', 'rect', { w: 30, h: 30, r: 2 }),
    ]),
    room(7, 280, 72, 'narrow', '#cdb4db', 'Narrow · plain'),
    room(8, 100, 144, 'wide', '#ffd6a5', 'Wide · attic', [op('back', 'arch', { w: 22, h: 40 })]),
  ];
  var TEST_ROOM = 6;
  var S = { sel: null, pick: null, side: 'left', variant: 'panShape', manual: false };
  var cam = { x: 0, y: 0, s: 1 }, SHELF_S = 1, K = 1;

  function $(id) { return document.getElementById(id); }
  var view = $('ot-view'), svg = $('ot-svg'), jig = $('ot-jig'), stage = $('ot-stage');
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function R() { for (var i = 0; i < ROOMS.length; i++) if (ROOMS[i].id === S.sel) return ROOMS[i]; return null; }
  function V() { return VARIANTS[S.variant]; }
  function viewH() { return VH + (V().tall && S.sel != null ? TALL : 0); }

  // ---------------------------------------------------------- geometry
  // Millimetres, in a room's own coordinates: x across from its left outer
  // face, y up from its underside.
  function inner(r) { return { x0: T[r.walls.left], x1: r.w - T[r.walls.right], y0: T[r.walls.floor], y1: r.h - T[r.walls.ceiling] }; }
  function onWall(o) { return o.wall === 'back' || o.wall === 'left' || o.wall === 'right'; }
  function boxes(r, o) {
    var b = inner(r), n = Math.max(1, Math.round(o.count || 1)), us = [];
    for (var k = 0; k < n; k++) us.push(r.w / 2 + o.x + (k - (n - 1) / 2) * (o.pitch || 0));
    var v0 = o.anchor === 'floor' && onWall(o) ? b.y0 + o.y : (b.y0 + b.y1) / 2 + o.y - o.h / 2;
    if (o.wall === 'back') return us.map(function (u) { return { x0: u - o.w / 2, x1: u + o.w / 2, y0: v0, y1: v0 + o.h }; });
    if (o.wall === 'left') return [{ x0: 0, x1: b.x0, y0: v0, y1: v0 + o.h }];
    if (o.wall === 'right') return [{ x0: b.x1, x1: r.w, y0: v0, y1: v0 + o.h }];
    var yy = o.wall === 'ceiling' ? [b.y1, r.h] : [0, b.y0];
    return us.map(function (u) { return { x0: u - o.w / 2, x1: u + o.w / 2, y0: yy[0], y1: yy[1] }; });
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16), a = n >> 16, g = (n >> 8) & 255, bl = n & 255;
    var f = function (c) { return Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt)); };
    return 'rgb(' + f(a) + ',' + f(g) + ',' + f(bl) + ')';
  }
  // A rectangle with its own radius at each corner.
  function rr(x0, y0, x1, y1, r) {
    return 'M' + (x0 + r.tl) + ',' + y0 + 'H' + (x1 - r.tr) + (r.tr ? 'A' + r.tr + ',' + r.tr + ' 0 0 1 ' + x1 + ',' + (y0 + r.tr) : '')
      + 'V' + (y1 - r.br) + (r.br ? 'A' + r.br + ',' + r.br + ' 0 0 1 ' + (x1 - r.br) + ',' + y1 : '')
      + 'H' + (x0 + r.bl) + (r.bl ? 'A' + r.bl + ',' + r.bl + ' 0 0 1 ' + x0 + ',' + (y1 - r.bl) : '')
      + 'V' + (y0 + r.tl) + (r.tl ? 'A' + r.tl + ',' + r.tl + ' 0 0 1 ' + (x0 + r.tl) + ',' + y0 : '') + 'Z';
  }
  var CORNER_WALLS = { tl: ['left', 'ceiling'], tr: ['right', 'ceiling'], br: ['right', 'floor'], bl: ['left', 'floor'] };
  function forced(r, c) { return CORNER_WALLS[c].some(function (w) { return r.walls[w] === 'none'; }); }
  function radii(r, ring, rad) {
    var o = {};
    ['tl', 'tr', 'br', 'bl'].forEach(function (c) { o[c] = r[ring][c] && !forced(r, c) ? rad : 0; });
    return o;
  }

  // ---------------------------------------------------------- drawing
  // World millimetres, with the SVG's y running down: svg y = -(world y).
  var NS = ' vector-effect="non-scaling-stroke"';
  function roomSvg(r, dim) {
    var X = function (u) { return r.x + u; }, Y = function (v) { return -(r.y + v); };
    var b = inner(r), col = r.color, edge = shade(col, -0.3), live = r.id === S.sel;
    var s = '<g class="rm" data-room="' + r.id + '"' + (dim ? ' opacity=".28"' : '') + '>';
    s += '<path d="' + rr(X(0), Y(r.h), X(r.w), Y(0), radii(r, 'outer', 8)) + '" fill="' + col + '" stroke="' + edge + '"' + NS + '/>';
    var back = r.walls.back === 'none';
    s += '<path d="' + rr(X(b.x0), Y(b.y1), X(b.x1), Y(b.y0), radii(r, 'inner', 5)) + '" fill="' + (back ? '#fff' : shade(col, 0.55)) + '"'
      + (back ? ' stroke="' + edge + '" stroke-dasharray="3 3"' + NS : '') + '/>';
    var dash = ' stroke="' + edge + '" stroke-width="1.2" stroke-dasharray="4 3"' + NS;
    var ln = function (a, b2, c, d) { s += '<line x1="' + a + '" y1="' + b2 + '" x2="' + c + '" y2="' + d + '"' + dash + '/>'; };
    if (r.walls.left === 'none') ln(X(0), Y(0), X(0), Y(r.h));
    if (r.walls.right === 'none') ln(X(r.w), Y(0), X(r.w), Y(r.h));
    if (r.walls.ceiling === 'none') ln(X(0), Y(r.h), X(r.w), Y(r.h));
    if (r.walls.floor === 'none') ln(X(0), Y(0), X(r.w), Y(0));
    r.ops.forEach(function (o, i) {
      if (r.walls[o.wall] === 'none') return;
      var tag = live ? ' data-op="' + i + '"' : '';
      boxes(r, o).forEach(function (q) {
        var x0 = X(q.x0), x1 = X(q.x1), y0 = Y(q.y1), y1 = Y(q.y0), w = x1 - x0, h = y1 - y0;
        var st = tag + ' fill="#fff" stroke="' + edge + '" stroke-width=".9"' + NS;
        if (o.wall !== 'back') { s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + h + '"' + st + '/>'; return; }
        if (o.shape === 'round') s += '<ellipse cx="' + (x0 + w / 2) + '" cy="' + (y0 + h / 2) + '" rx="' + w / 2 + '" ry="' + h / 2 + '"' + st + '/>';
        else if (o.shape === 'arch') s += '<path d="M' + x0 + ',' + y1 + 'V' + (y0 + w / 2) + 'A' + w / 2 + ',' + w / 2 + ' 0 0 1 ' + x1 + ',' + (y0 + w / 2) + 'V' + y1 + 'Z"' + st + '/>';
        else s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + h + '" rx="' + o.r + '"' + st + '/>';
        for (var c = 1; c < o.cols; c++) s += '<line x1="' + (x0 + w * c / o.cols) + '" y1="' + y0 + '" x2="' + (x0 + w * c / o.cols) + '" y2="' + y1 + '" stroke="' + col + '" stroke-width="' + o.bar * 0.5 + '" pointer-events="none"/>';
        for (var q2 = 1; q2 < o.rows; q2++) s += '<line x1="' + x0 + '" y1="' + (y0 + h * q2 / o.rows) + '" x2="' + x1 + '" y2="' + (y0 + h * q2 / o.rows) + '" stroke="' + col + '" stroke-width="' + o.bar * 0.5 + '" pointer-events="none"/>';
      });
    });
    return s + '</g>';
  }
  function renderSvg() {
    var s = '<line x1="-600" y1="0" x2="1000" y2="0" stroke="#14181A" stroke-width="1.2"' + NS + '/>';
    ROOMS.forEach(function (r) { if (r.id !== S.sel) s += roomSvg(r, S.sel != null); });
    var r = R();
    if (r) {
      s += roomSvg(r, false);
      s += '<path d="' + rr(r.x - 1.6, -(r.y + r.h + 1.6), r.x + r.w + 1.6, -(r.y - 1.6), { tl: 9.6, tr: 9.6, br: 9.6, bl: 9.6 })
        + '" fill="none" stroke="#0B6E72" stroke-width="1.2" stroke-dasharray="4 3"' + NS + ' pointer-events="none"/>';
      var p = S.pick != null ? r.ops[S.pick] : null;
      if (p && r.walls[p.wall] !== 'none') boxes(r, p).forEach(function (q) {
        s += '<rect x="' + (r.x + q.x0 - 1) + '" y="' + (-(r.y + q.y1) - 1) + '" width="' + (q.x1 - q.x0 + 2) + '" height="' + (q.y1 - q.y0 + 2)
          + '" fill="none" stroke="#0B6E72" stroke-width="2"' + NS + ' pointer-events="none"/>';
      });
    }
    svg.innerHTML = s;
  }

  // ---------------------------------------------------------- glyphs
  function g(body) { return '<svg viewBox="0 0 16 16" aria-hidden="true">' + body + '</svg>'; }
  function weightGlyph(k, v) {
    if (k === 'none') return g('<path d="' + (v ? 'M8 1.5V14.5' : 'M1.5 8H14.5') + '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2.4"/>');
    var t = k === 'thick' ? 5 : 1.6;
    return g(v ? '<rect x="' + (8 - t / 2) + '" y="1" width="' + t + '" height="14"/>' : '<rect x="1" y="' + (8 - t / 2) + '" width="14" height="' + t + '"/>');
  }
  function shapeGlyph(sh) {
    if (sh === 'round') return g('<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/>');
    if (sh === 'arch') return g('<path d="M4 14V7.5a4 4 0 0 1 8 0V14z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>');
    return g('<rect x="3" y="3" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>');
  }
  var ANCHOR_GLYPH = {
    centre: g('<rect x="4.5" y="4.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.2"/>'),
    floor: g('<rect x="4.5" y="3" width="7" height="10" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1 13.6h14" stroke="currentColor" stroke-width="1.6"/>'),
  };
  var PLUS = g('<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" fill="none"/>');

  // ---------------------------------------------------------- the room's controls
  function selector(r, wall) {
    var v = wall === 'left' || wall === 'right';
    var names = { thick: 'Thick, 3 mm', thin: 'Thin, 1.5 mm', none: 'No wall' };
    return '<div class="panel strip' + (v ? ' v' : '') + '" data-el="sel-' + wall + '">' + ['thick', 'thin', 'none'].map(function (k) {
      return '<button type="button" class="m-btn' + (r.walls[wall] === k ? ' on' : '') + '" data-act="wall" data-wall="' + wall + '" data-v="' + k + '" title="' + WALL_NAME[wall] + ': ' + names[k] + '" aria-label="' + WALL_NAME[wall] + ': ' + names[k] + '">' + weightGlyph(k, v) + '</button>';
    }).join('') + '</div>';
  }
  function tabs(r, wall) {
    if (r.walls[wall] === 'none') return '<div class="nowall" data-el="tabs-' + wall + '">No wall, so no openings</div>';
    var dir = { ceiling: 'up', left: 'side-l', right: 'side-r' }[wall] || 'down';
    var h = '';
    r.ops.forEach(function (o, i) {
      if (o.wall !== wall) return;
      var name = 'Opening ' + (i + 1) + ': ' + SHAPE_NAME[o.shape].toLowerCase() + ', ' + o.w + ' × ' + o.h + ' mm';
      h += '<button type="button" class="tab' + (i === S.pick ? ' picked' : '') + '" data-act="pick" data-i="' + i + '" aria-pressed="' + (i === S.pick) + '" title="' + name + '" aria-label="' + name + '">' + shapeGlyph(o.shape) + '</button>';
    });
    var add = 'Add an opening to the ' + WALL_NAME[wall].toLowerCase();
    h += '<button type="button" class="tab add" data-act="add" data-wall="' + wall + '" title="' + add + '" aria-label="' + add + '">' + PLUS + '</button>';
    return '<div class="tabs ' + dir + '" data-el="tabs-' + wall + '">' + h + '</div>';
  }
  // The picked opening's panel: today's two-column form, or shaped by the way
  // it opens, wide and short above or below the room, narrow and tall beside it.
  function tile(r) {
    var o = r.ops[S.pick], wallish = onWall(o);
    var side = o.wall === 'left' || o.wall === 'right';
    var form = V().tile === 'shape' ? (side ? 'narrow' : 'wide') : 'std';
    var xl = side ? 'Depth' : 'Across', yl = wallish ? 'Up' : 'Depth';
    var field = function (label, k, opts) {
      opts = opts || {};
      return '<span class="f" title="' + (opts.title || label) + '"><label>' + label + '</label><input data-ok="' + k + '" value="' + o[k] + '" aria-label="' + (opts.title || label) + '">' + (opts.unit === '' ? '' : '<span>mm</span>') + '</span>';
    };
    var seg = function (k, vals, glyph, names) {
      return '<span class="m-seg">' + vals.map(function (v) {
        return '<button type="button" class="m-btn' + (o[k] === v ? ' on' : '') + '" data-act="set" data-k="' + k + '" data-v="' + v + '" aria-pressed="' + (o[k] === v) + '" title="' + names[v] + '" aria-label="' + names[v] + '">' + glyph(v) + '</button>';
      }).join('') + '</span>';
    };
    var title = '<span>Opening ' + (S.pick + 1) + '</span>';
    var wallSel = function (cls) {
      return '<select data-act="wallto" aria-label="Wall"' + (cls ? ' class="' + cls + '"' : '') + '>' + WALLS.map(function (w) {
        return '<option value="' + w + '"' + (w === o.wall ? ' selected' : '') + '>' + WALL_NAME[w] + '</option>';
      }).join('') + '</select>';
    };
    var close = '<button type="button" class="x" data-act="unpick" title="Close (Esc)" aria-label="Close">×</button>';
    var shapeSeg = seg('shape', SHAPES, shapeGlyph, SHAPE_NAME);
    var anchorSeg = wallish ? seg('anchor', ['centre', 'floor'], function (v) { return ANCHOR_GLYPH[v]; }, { centre: 'Centre of the wall', floor: 'Floor (doorway)' }) : '';
    var panes = '<span class="f" title="Panes across × panes up"><label>Panes</label><input data-ok="cols" class="s" value="' + o.cols + '" aria-label="Panes across">×<input data-ok="rows" class="s" value="' + o.rows + '" aria-label="Panes up"></span>';
    var copy = '<button type="button" class="m-chip" data-act="copy">copy</button>', remove = '<button type="button" class="m-chip del" data-act="remove">remove</button>';
    var fields = [field(xl, 'x')];
    if (!(wallish && o.anchor === 'floor')) fields.push(field(yl, 'y'));
    fields.push(field('W', 'w', { title: 'Width' }), field('H', 'h', { title: 'Height' }), panes);
    if (o.cols > 1 || o.rows > 1) fields.push(field('Bar', 'bar', { title: 'Bar width' }));
    fields.push(field('Copies', 'count', { unit: '' }));
    if (o.count > 1) fields.push(field('Gap', 'pitch', { title: 'Spacing, centre to centre' }));
    if (o.shape === 'rect') fields.push(field('R', 'r', { title: 'Corner radius' }));

    var open = ' data-el="tile" role="group" aria-label="Opening ' + (S.pick + 1) + '"';
    if (form === 'wide') return '<div class="panel tile wide"' + open + '><div class="head">' + title + wallSel() + shapeSeg + anchorSeg
      + '<span class="sp"></span>' + copy + remove + close + '</div><div class="grid2r">' + fields.join('') + '</div></div>';
    if (form === 'narrow') return '<div class="panel tile narrow"' + open + '><div class="head">' + title + '<span class="sp"></span>' + close + '</div>'
      + wallSel('wallsel') + '<div class="seg-col">' + shapeSeg + anchorSeg + '</div><div class="grid1">' + fields.join('') + '</div><div class="acts">' + copy + remove + '</div></div>';
    // The standard panel: two columns, blanks keeping the rows lined up.
    var grid = field(xl, 'x') + (wallish && o.anchor === 'floor' ? '<span></span>' : field(yl, 'y')) + field('W', 'w', { title: 'Width' }) + field('H', 'h', { title: 'Height' }) + panes
      + (o.cols > 1 || o.rows > 1 ? field('Bar', 'bar', { title: 'Bar width' }) : '<span></span>') + field('Copies', 'count', { unit: '' })
      + (o.count > 1 ? field('Gap', 'pitch', { title: 'Spacing, centre to centre' }) : '<span></span>') + (o.shape === 'rect' ? field('R', 'r', { title: 'Corner radius' }) : '');
    return '<div class="panel tile"' + open + '><div class="head">' + title + wallSel() + close + '</div>'
      + '<div class="seg-row">' + shapeSeg + anchorSeg + '</div><div class="grid">' + grid + '</div><div class="acts">' + copy + remove + '</div></div>';
  }
  function ident(r) {
    var dim = function (k) { return '<span class="dim"><b>' + k.toUpperCase() + '</b><input data-k="' + k + '" value="' + r[k] + '" aria-label="' + { w: 'Width', h: 'Height', d: 'Depth' }[k] + '"><span>mm</span></span>'; };
    return '<div class="panel ident" data-el="ident" role="group" aria-label="Room">'
      + '<div class="top"><input type="text" data-k="name" value="' + r.name + '" aria-label="Name"><label class="swatch"><input type="color" data-k="color" value="' + r.color + '" aria-label="Colour">colour</label></div>'
      + '<div class="dims">' + dim('w') + dim('h') + dim('d') + '</div>'
      + '<div class="where">x ' + r.x + ' mm, floor ' + (Math.round(r.y / 72) + 1) + '</div>'
      + '<div class="acts">'
      + '<button type="button" class="m-chip" data-act="mock" title="Move left" aria-label="Move left">◀</button><button type="button" class="m-chip" data-act="mock" title="Move right" aria-label="Move right">▶</button><span class="sp"></span>'
      + '<button type="button" class="m-chip" data-act="mock" title="Duplicate">duplicate</button><button type="button" class="m-chip del" data-act="mock" title="Delete">delete</button>'
      + '<button type="button" class="m-chip" data-act="mock" title="Download STL">stl</button><button type="button" class="m-chip" data-act="mock" title="More" aria-label="More">⋯</button>'
      + '</div></div>';
  }
  function dots(r) {
    var h = '';
    ['outer', 'inner'].forEach(function (ring) {
      ['tl', 'tr', 'br', 'bl'].forEach(function (c) {
        var f = forced(r, c), on = r[ring][c] && !f;
        var name = (ring === 'outer' ? 'Outer' : 'Inner') + ' corner: ' + (on ? 'rounded' : 'square');
        h += '<button type="button" class="dot' + (on ? ' on' : '') + '" data-el="dot-' + ring + '-' + c + '" data-act="corner" data-ring="' + ring + '" data-c="' + c + '"'
          + (f ? ' disabled' : '') + ' title="' + name + '" aria-label="' + name + '"></button>';
      });
    });
    return h;
  }

  function buildJig(anim) {
    var r = R();
    if (!r) { jig.innerHTML = ''; return; }
    var picked = S.pick != null ? r.ops[S.pick] : null;
    if (picked && r.walls[picked.wall] === 'none') { S.pick = null; picked = null; }
    var fold = V().fold && picked;
    var h = '';
    if (!fold) h += ident(r) + dots(r);
    if (!fold || picked.wall === 'back') h += '<span class="backlabel" data-el="label-back">Back wall</span>';
    WALLS.forEach(function (w) { if (!fold || w === picked.wall) h += selector(r, w) + tabs(r, w); });
    if (picked) h += tile(r);
    jig.innerHTML = h;
    var B = roomBox(r);
    place(r, B);
    if (anim) {
      var cx = (B.l + B.r) / 2, cy = (B.t + B.b) / 2;
      Array.prototype.forEach.call(jig.children, function (el) {
        var x = el.offsetLeft + el.offsetWidth / 2, y = el.offsetTop + el.offsetHeight / 2;
        el.style.setProperty('--fx', Math.round((cx - x) * 0.6) + 'px');
        el.style.setProperty('--fy', Math.round((cy - y) * 0.6) + 'px');
      });
      jig.classList.remove('anim'); void jig.offsetWidth; jig.classList.add('anim');
    } else jig.classList.remove('anim');
  }

  // Docks everything around room box B (view pixels) and returns the box
  // that takes in what `mode` counts: 'all'; 'notile', laid out as if no
  // panel were open; 'focus', the room, the picked opening's wall and its panel.
  function place(r, B, mode) {
    mode = mode || 'all';
    var cx = (B.l + B.r) / 2, cy = (B.t + B.b) / 2, k = (B.r - B.l) / r.w;
    var el = function (n) { return jig.querySelector('[data-el="' + n + '"]'); };
    var W = function (e) { return e ? e.offsetWidth : 0; }, H = function (e) { return e ? e.offsetHeight : 0; };
    var at = function (e, x, y) { if (e) { e.style.left = Math.round(x) + 'px'; e.style.top = Math.round(y) + 'px'; } return { l: x, t: y, r: x + W(e), b: y + H(e) }; };
    var tileEl = el('tile'), pw = tileEl && mode !== 'notile' ? r.ops[S.pick].wall : null;
    var wide = tileEl && tileEl.classList.contains('wide');

    // Ceiling: its selector, its tabs above it, the panel above them.
    var sc = el('sel-ceiling'), tc = el('tabs-ceiling');
    var rsc = at(sc, cx - W(sc) / 2, B.t - GAP - H(sc));
    var rtc = at(tc, cx - W(tc) / 2, rsc.t - 4 - H(tc));
    var stackL = Math.min(rsc.l, rtc.l), stackR = Math.max(rsc.r, rtc.r);
    if (pw === 'ceiling') {
      var rt = at(tileEl, wide ? cx - W(tileEl) / 2 : rtc.l, rtc.t + 1 - H(tileEl));
      stackL = Math.min(stackL, rt.l); stackR = Math.max(stackR, rt.r);
    }

    // Floor, then the back wall under it, each with its tabs and panel below.
    var sf = el('sel-floor'), tf = el('tabs-floor');
    var rsf = at(sf, cx - W(sf) / 2, B.b + GAP);
    var rtf = at(tf, rsf.l, rsf.b + 4);
    var bottom = sf ? rtf.b : B.b;
    if (pw === 'floor') bottom = at(tileEl, wide ? cx - W(tileEl) / 2 : rtf.l, rtf.b - 1).b;
    var lb = el('label-back'), sb = el('sel-back'), tb = el('tabs-back');
    var bx = cx - W(sb) / 2;
    var rlb = at(lb, bx, sf ? bottom + 16 : B.b + GAP);
    var rsb = at(sb, bx, rlb.b + 4);
    var rtb = at(tb, bx, rsb.b + 4);
    if (pw === 'back') at(tileEl, wide ? cx - W(tileEl) / 2 : rtb.l, rtb.b - 1);

    // Left and right: the selector upright beside the wall, its tabs upright
    // beside it, the panel opening sideways from them.
    var sl = el('sel-left'), tl = el('tabs-left');
    var rsl = at(sl, B.l - GAP - W(sl), cy - H(sl) / 2);
    var rtl = at(tl, rsl.l - 6 - W(tl), rsl.t);
    if (pw === 'left') at(tileEl, rtl.l + 1 - W(tileEl), rtl.t);
    var sr = el('sel-right'), tr = el('tabs-right');
    var rsr = at(sr, B.r + GAP, cy - H(sr) / 2);
    var rtr = at(tr, rsr.r + 6, rsr.t);
    if (pw === 'right') at(tileEl, rtr.r - 1, rtr.t);

    // The room card, top left or top right of the ceiling's stack.
    var id = el('ident');
    if (id) at(id, S.side === 'left' ? stackL - 14 - W(id) : stackR + 14, B.t - 20 - H(id));

    // Corner dots: the outer ring just outside each corner, the inner just inside.
    var b = inner(r);
    var pos = {
      outer: { tl: [B.l, B.t], tr: [B.r, B.t], br: [B.r, B.b], bl: [B.l, B.b] },
      inner: { tl: [B.l + b.x0 * k, B.b - b.y1 * k], tr: [B.l + b.x1 * k, B.b - b.y1 * k], br: [B.l + b.x1 * k, B.b - b.y0 * k], bl: [B.l + b.x0 * k, B.b - b.y0 * k] },
    };
    var dir = { tl: [-1, -1], tr: [1, -1], br: [1, 1], bl: [-1, 1] };
    ['outer', 'inner'].forEach(function (ring) {
      ['tl', 'tr', 'br', 'bl'].forEach(function (c) {
        var d = el('dot-' + ring + '-' + c);
        if (!d) return;
        var off = ring === 'outer' ? 7 : -9, p = pos[ring][c];
        d.style.left = Math.round(p[0] + dir[c][0] * off) + 'px';
        d.style.top = Math.round(p[1] + dir[c][1] * off) + 'px';
      });
    });

    var u = { l: B.l, t: B.t, r: B.r, b: B.b };
    var fw = S.pick != null ? r.ops[S.pick].wall : null;
    Array.prototype.forEach.call(jig.children, function (e) {
      var n = e.dataset.el;
      if (mode === 'notile' && n === 'tile') return;
      if (mode === 'focus' && !(n === 'tile' || n === 'sel-' + fw || n === 'tabs-' + fw || (fw === 'back' && n === 'label-back'))) return;
      u.l = Math.min(u.l, e.offsetLeft); u.t = Math.min(u.t, e.offsetTop);
      u.r = Math.max(u.r, e.offsetLeft + e.offsetWidth); u.b = Math.max(u.b, e.offsetTop + e.offsetHeight);
    });
    return u;
  }

  // ---------------------------------------------------------- camera
  function roomBox(r) {
    return { l: (r.x - cam.x) * cam.s, t: (cam.y - (r.y + r.h)) * cam.s, r: (r.x + r.w - cam.x) * cam.s, b: (cam.y - r.y) * cam.s };
  }
  function fitShelf() {
    var x0 = Infinity, x1 = -Infinity, y1 = 0, vh = viewH();
    ROOMS.forEach(function (r) { x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    var m = 40, s = Math.min((VW - 2 * m) / (x1 - x0), (vh - 2 * m) / y1);
    return { x: (x0 + x1) / 2 - VW / 2 / s, y: y1 / 2 + vh / 2 / s, s: s };
  }
  // The scale at which the room and what `mode` counts just fit. The room
  // card's overhang depends on the scale, so it is settled in a few rounds.
  function fitScale(r, mode) {
    var s = Math.max(cam.s, 0.5), vh = viewH();
    for (var i = 0; i < 7; i++) {
      var B = { l: 0, t: 0, r: r.w * s, b: r.h * s }, u = place(r, B, mode);
      s = clamp(Math.min((VW - 2 * PAD - (B.l - u.l) - (u.r - B.r)) / r.w, (vh - 2 * PAD - (B.t - u.t) - (u.b - B.b)) / r.h), 0.3, 9);
    }
    return s;
  }
  function centerOn(r, s, mode) {
    var B = { l: 0, t: 0, r: r.w * s, b: r.h * s }, u = place(r, B, mode), vh = viewH();
    var offX = (VW - (u.r - u.l)) / 2 - u.l, offY = (vh - (u.b - u.t)) / 2 - u.t;
    return { x: r.x - offX / s, y: r.y + r.h + offY / s, s: s };
  }
  // The zoom the room has with no panel open and every control unwrapped.
  function noTileScale(r) {
    var p = S.pick;
    S.pick = null; buildJig(false);
    var s = fitScale(r, 'all');
    S.pick = p; buildJig(false);
    return s;
  }
  function fitTarget(r) {
    if (S.pick == null || !V().keep) return centerOn(r, fitScale(r, 'all'), 'all');
    // Keep the zoom and slide just far enough to show the room, the wall
    // being worked on and its panel; zoom out only if even those do not fit.
    var s = Math.min(noTileScale(r), fitScale(r, 'focus'));
    return centerOn(r, s, 'focus');
  }

  // The view keeps its real pixel size; the stage holding it is scaled down
  // as a whole when the column is narrower than that.
  var fitBox = $('ot-fit'), lastSize = '';
  function fitStage() {
    var natW = VW + 2, natH = stage.offsetHeight;
    var avail = fitBox.closest('.ot-split').clientWidth - 40;
    K = Math.min(1, avail / natW);
    stage.style.width = natW + 'px';
    stage.style.transform = K < 1 ? 'scale(' + K + ')' : '';
    fitBox.style.width = Math.floor(natW * K) + 'px';
    fitBox.style.height = Math.ceil(natH * K) + 'px';
  }
  function apply() {
    var vh = viewH();
    view.style.width = VW + 'px'; view.style.height = vh + 'px';
    if (lastSize !== VW + 'x' + vh) { lastSize = VW + 'x' + vh; fitStage(); }
    svg.setAttribute('viewBox', [cam.x, -cam.y, VW / cam.s, vh / cam.s].join(' '));
    var r = R();
    if (r && jig.firstChild) place(r, roomBox(r));
    $('ot-pct').textContent = Math.round(cam.s / SHELF_S * 100) + '%';
    $('ot-fitbtn').classList.toggle('is-paused', S.manual);
    $('ot-readout').innerHTML = r ? 'room on screen: <b' + (r.h * cam.s < 100 ? ' class="is-lost"' : '') + '>' + Math.round(r.w * cam.s) + ' × ' + Math.round(r.h * cam.s) + ' px</b>' : 'whole shelf';
  }
  var anim = null;
  function stopAnim() { if (anim && anim.raf) cancelAnimationFrame(anim.raf); anim = null; }
  function animateTo(t) {
    stopAnim();
    var vh = viewH();
    var f = { s: cam.s, cx: cam.x + VW / 2 / cam.s, cy: cam.y - vh / 2 / cam.s };
    var to = { s: t.s, cx: t.x + VW / 2 / t.s, cy: t.y - vh / 2 / t.s };
    var t0 = performance.now(), D = 420;
    anim = {};
    (function step(now) {
      var k = clamp((now - t0) / D, 0, 1), e = 1 - Math.pow(1 - k, 3);
      var s = Math.exp(Math.log(f.s) + (Math.log(to.s) - Math.log(f.s)) * e);
      cam.s = s; cam.x = f.cx + (to.cx - f.cx) * e - VW / 2 / s; cam.y = f.cy + (to.cy - f.cy) * e + vh / 2 / s;
      apply();
      if (k < 1 && anim) anim.raf = requestAnimationFrame(step); else anim = null;
    })(t0);
  }
  function refit(instant) {
    if (S.manual) { apply(); return; }
    var r = R(), t = r ? fitTarget(r) : fitShelf();
    if (instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { stopAnim(); cam = t; apply(); } else animateTo(t);
  }
  function zoomAt(px, py, f) {
    stopAnim(); S.manual = true;
    var wx = cam.x + px / cam.s, wy = cam.y - py / cam.s;
    cam.s = clamp(cam.s * f, 0.3, 12);
    cam.x = wx - px / cam.s; cam.y = wy + py / cam.s;
    apply();
  }
  function rebuild(a) { renderSvg(); buildJig(a); }
  function select(id) { S.sel = id; S.pick = null; S.manual = false; rebuild(true); refit(); }
  function deselect() { S.sel = null; S.pick = null; S.manual = false; rebuild(false); refit(); }
  function closeTile() { S.pick = null; S.manual = false; rebuild(false); refit(); }

  // ---------------------------------------------------------- measuring
  // Every panel the test room has, opened in turn, at both view sizes and
  // with the room card on either side: the room's size on screen, how far
  // the zoom moves from the no-panel view, and how many of the room's 12
  // controls (13 with the panel) are wholly in view without panning.
  var STATES = [['none', null], ['left', 2], ['right', 3], ['ceiling', 5], ['floor', 6], ['back', 0]];
  function measure() {
    var keep = { sel: S.sel, pick: S.pick, side: S.side, variant: S.variant, manual: S.manual, VW: VW, VH: VH, cam: cam };
    var out = {};
    Object.keys(VARIANTS).forEach(function (v) {
      out[v] = {};
      Object.keys(SIZES).forEach(function (size) {
        out[v][size] = {};
        ['left', 'right'].forEach(function (side) {
          var rows = {};
          S.variant = v; S.side = side; S.sel = TEST_ROOM; S.manual = false; VW = SIZES[size][0]; VH = SIZES[size][1];
          var r = R(), s0 = null;
          STATES.forEach(function (st) {
            S.pick = st[1]; renderSvg(); buildJig(false);
            var t = fitTarget(r);
            if (s0 == null) s0 = t.s;
            cam = t; place(r, roomBox(r));
            var vh = viewH(), n = 0, all = 12 + (st[1] != null ? 1 : 0);
            Array.prototype.forEach.call(jig.children, function (e) {
              if (/^dot-/.test(e.dataset.el)) return;
              if (e.offsetLeft >= -1 && e.offsetTop >= -1 && e.offsetLeft + e.offsetWidth <= VW + 1 && e.offsetTop + e.offsetHeight <= vh + 1) n++;
            });
            rows[st[0]] = { w: Math.round(r.w * t.s), h: Math.round(r.h * t.s), jump: t.s / s0, seen: n, all: all };
          });
          out[v][size][side] = rows;
        });
      });
    });
    S.sel = keep.sel; S.pick = keep.pick; S.side = keep.side; S.variant = keep.variant; S.manual = keep.manual; VW = keep.VW; VH = keep.VH; cam = keep.cam;
    return out;
  }
  // Per idea and view size: the room at its smallest across every panel and
  // both card sides, the biggest zoom change, the fewest controls in view.
  function summary(M, v, size) {
    var worst = null, jump = 1, seen = 1;
    ['left', 'right'].forEach(function (side) {
      STATES.forEach(function (st) {
        var x = M[v][size][side][st[0]];
        if (!worst || x.h < worst.h) worst = x;
        jump = Math.max(jump, x.jump, 1 / x.jump);
        seen = Math.min(seen, x.seen / x.all);
      });
    });
    return { worst: worst, jump: jump, seen: seen };
  }

  // ---------------------------------------------------------- the report
  var M = null, current = 'summary';
  function sz(x) { return x.w + ' × ' + x.h; }
  function at(v, size, st) { return sz(M[v][size].left[st]); }
  function lost(v, st) { var x = M[v].laptop.left[st]; return x.all - x.seen; }
  function fewest(v) { var x = summary(M, v, 'laptop'); return Math.round(x.seen * 13); }
  // A wide room's size in the whole-shelf view at that view size.
  function overview(size) {
    var w = VW, h = VH, sel = S.sel;
    VW = SIZES[size][0]; VH = SIZES[size][1]; S.sel = null;
    var s = fitShelf().s;
    VW = w; VH = h; S.sel = sel;
    return Math.round(120 * s) + ' × ' + Math.round(72 * s);
  }

  var ORDER = ['panShape', 'pan', 'focus', 'shape', 'tall', 'base'];
  var INFO = {
    panShape: {
      name: 'Keep the zoom, shaped panel', tone: 'is-best',
      what: 'Opening a panel never zooms. The view slides just far enough to show the room, the wall you are working on, its tabs and the panel. The panel also changes shape with the way it opens: wide and short when it drops below the floor or back wall or rises above the ceiling, narrow and tall when it opens beside a side wall. So the view slides less, and more of the other controls stay in view.',
      pros: function () { return ['The room never shrinks when a panel opens. It keeps the size it has unwrapped', 'Every control stays unwrapped, and anything that slides out of view is one pan away', 'The panel stays joined to its tab', 'Of the ideas that keep the zoom, it moves the view the least']; },
      cons: function () { return ['Two panel layouts to build and test instead of one', 'The view slides when a panel opens, though it never zooms. The ceiling panel slides it furthest: ' + lost('panShape', 'ceiling') + ' of 13 controls go out of view, the room card among them']; },
      verdict: function () { return 'Best. The room keeps its size in every case, nothing folds away, and the shaped panel keeps the most controls on screen while you edit.'; },
    },
    pan: {
      name: 'Keep the zoom, standard panel', tone: '',
      what: 'The same rule as the winner, with one standard two-column panel, 250 px wide, whichever way it opens. Opening it never zooms, and the view slides to show the room, that wall and the panel.',
      pros: function () { return ['The room keeps its size for the side, ceiling and floor panels', 'Only one panel layout', 'Every control stays unwrapped']; },
      cons: function () { return ['The back wall\'s panel hangs below both the floor and back-wall controls, so even the room, that wall and its panel don\'t fit at the kept zoom. The room shrinks there', 'The tall panel pushes the view further, so fewer controls stay in view: ' + fewest('pan') + ' of 13 at worst']; },
      verdict: function () { return 'Second, and the cheapest fix. It only falls short on the back wall, where the room shrinks to ' + at('pan', 'laptop', 'back') + ' on the laptop view and ' + at('pan', 'small', 'back') + ' on the small one.'; },
    },
    focus: {
      name: 'Focus on one wall', tone: '',
      what: 'Opening a panel folds the room card and the other four walls away. Only the room, the wall you are working on, its tabs and the panel stay. Close the panel and everything unwraps again. The zoom is kept, as in the two ideas above.',
      pros: function () { return ['The room never shrinks, at either view size', 'Nothing else competes for attention while you edit an opening']; },
      cons: function () { return ['It goes against the point of unwrapping: ' + lost('focus', 'floor') + ' of the 13 controls fold away while a panel is open', 'To go from an opening on one wall to one on another, you have to close the panel first', 'Controls fold and unfold every time a panel opens and closes']; },
      verdict: function () { return 'Keeps the room big, but gives up the thing the unwrapping was for. Worth keeping in reserve for phones, where nothing else fits.'; },
    },
    shape: {
      name: 'Shaped panel, zoom to fit', tone: '',
      what: 'Every control stays in view, and the view zooms out to fit whatever is open. The panel is shaped by the way it opens, so it costs much less than the standard one.',
      pros: function () { return ['Every control is always in view, with no panning']; },
      cons: function () { return ['The room still shrinks, and the zoom moves every time a panel opens', 'The wide ceiling panel pushes the room card sideways, and the room collapses to ' + at('shape', 'laptop', 'ceiling'), 'On the small view, almost every panel collapses the room']; },
      verdict: function () { return 'Better than zoom-to-fit with the standard panel under the floor and back wall (' + at('shape', 'laptop', 'floor') + ' rather than ' + at('base', 'laptop', 'floor') + '). But the ceiling panel still collapses the room, and on the small view almost every panel does.'; },
    },
    tall: {
      name: 'Taller front view', tone: 'is-poor',
      what: 'The front view grows ' + TALL + ' px taller while a room is unwrapped and shrinks back when it folds. Standard panel, zoom to fit.',
      pros: function () { return ['Nothing about the controls changes']; },
      cons: function () { return ['The page jumps under the pointer and pushes everything below it down', 'A laptop window has no ' + TALL + ' px to spare, so in practice the page would scroll', 'A side panel opposite the room card still collapses the room, and the floor panel leaves it at ' + at('tall', 'laptop', 'floor')]; },
      verdict: function () { return 'Doesn\'t solve it. With nothing open the room is bigger (' + at('tall', 'laptop', 'none') + '), but the extra height is used up as soon as a panel opens.'; },
    },
    base: {
      name: 'Zoom to fit, standard panel', tone: 'is-poor',
      what: 'Where this started: the standard panel next to its tabs, and the view zooming out to fit everything that is open.',
      pros: function () { return ['Every control is always in view']; },
      cons: function () { return ['The room shrinks to a postage stamp, ' + at('base', 'laptop', 'floor') + ', under the floor, back-wall and opposite-side panels']; },
      verdict: function () { return 'The baseline the others are measured against.'; },
    },
  };

  function rank(i) { return '<span class="ot-rank' + (i === 0 ? ' is-best' : '') + '">' + (i + 1) + '</span>'; }
  function kept(x, ref) { return x.h >= ref.h * 0.95 ? 'is-kept' : x.h < 100 ? 'is-lost' : ''; }
  function bullets(list) { return '<ul class="bullets">' + list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }

  // Each idea's worst case, drawn: the room at its smallest inside the
  // outline of the room with nothing open, all to one scale.
  function renderFigs() {
    var ref = M.base.laptop.left.none, r = ROOMS.filter(function (x) { return x.id === TEST_ROOM; })[0];
    var rx = ref.w / r.w * 8;
    $('ot-figs').innerHTML = ORDER.map(function (v, i) {
      var w = summary(M, v, 'laptop').worst, full = w.h >= ref.h * 0.95;
      var x = (ref.w - w.w) / 2, y = (ref.h - w.h) / 2;
      var label = INFO[v].name + ': the room is ' + sz(w) + ' px at worst' + (full ? ', its full size' : '');
      return '<li><button type="button" class="ot-fig' + (i === 0 ? ' is-best' : '') + '" data-tab="' + v + '" aria-label="' + label + '">'
        + '<svg viewBox="-8 -8 ' + (ref.w + 16) + ' ' + (ref.h + 16) + '" aria-hidden="true">'
        + '<rect class="ot-frame" x="0" y="0" width="' + ref.w + '" height="' + ref.h + '" rx="' + rx + '"/>'
        + '<svg x="' + x + '" y="' + y + '" width="' + w.w + '" height="' + w.h + '" viewBox="' + r.x + ' ' + (-(r.y + r.h)) + ' ' + r.w + ' ' + r.h + '">' + roomSvg(r, false) + '</svg>'
        + '</svg>'
        + '<span class="ot-fig-name">' + rank(i) + '<span>' + INFO[v].name + '</span></span>'
        + '<span class="ot-fig-size' + (w.h < 100 ? ' is-lost' : '') + '">' + sz(w) + ' px' + (full ? ', full size' : '') + '</span>'
        + '</button></li>';
    }).join('');
  }
  function renderTabs() {
    var tab = function (key, html) {
      return '<button type="button" class="ot-tab" role="tab" data-tab="' + key + '" aria-selected="' + (current === key) + '" aria-controls="ot-report">' + html + '</button>';
    };
    $('ot-tabs').innerHTML = tab('summary', 'Summary') + ORDER.map(function (v, i) { return tab(v, rank(i) + INFO[v].name); }).join('');
  }
  function renderReport() {
    var b = $('ot-report');
    if (current === 'summary') {
      var rows = ORDER.map(function (v, i) {
        var L = summary(M, v, 'laptop'), Sm = summary(M, v, 'small');
        return '<tr data-tab="' + v + '"><td>' + (i + 1) + '</td><td class="ot-idea">' + INFO[v].name + '</td>'
          + '<td class="' + kept(L.worst, M.base.laptop.left.none) + '">' + sz(L.worst) + '</td>'
          + '<td class="' + kept(Sm.worst, M.base.small.left.none) + '">' + sz(Sm.worst) + '</td>'
          + '<td>' + (L.jump < 1.02 ? '<span class="is-kept">none</span>' : '×' + L.jump.toFixed(1)) + '</td>'
          + '<td>' + Math.round(L.seen * 100) + '%</td></tr>';
      }).join('');
      b.innerHTML = '<h2>Summary, best first</h2>'
        + '<p>Each idea was measured with every panel of the test room open in turn (left, right, ceiling, floor and back wall), with the room card on either side. The table shows the worst case. With nothing open the room is ' + at('base', 'laptop', 'none') + ' px on the 760 × 600 view and ' + at('base', 'small', 'none') + ' px on the 560 × 460 one.</p>'
        + '<div class="ot-table-wrap"><table class="ot-table"><tr><th></th><th></th><th colspan="2">Smallest room</th><th></th><th></th></tr>'
        + '<tr><th>#</th><th>Idea</th><th>760 × 600</th><th>560 × 460</th><th>Zoom</th><th>In view</th></tr>' + rows + '</table></div>'
        + '<p class="ot-key">Smallest room is the room\'s size on screen, in pixels, with the worst panel open, on each size of front view. Zoom is how far the zoom moves when a panel opens. In view is how many of the room\'s controls are fully on screen without panning, at worst.</p>'
        + '<h3>Recommendation</h3><p class="notice is-best">Take idea 1, ' + INFO[ORDER[0]].name.toLowerCase() + '. ' + INFO[ORDER[0]].verdict() + '</p>'
        + '<h3>Also decided</h3><p>While an opening\'s panel is open, a click anywhere else on the front view only closes the panel and zooms back to the room, even if it lands on another room. Picking another room takes a second, deliberate click.</p>'
        + '<h3>Found along the way</h3><p>On the 560 × 460 view, every idea leaves the room at about ' + at('panShape', 'small', 'none') + ' px even with nothing open. That is smaller than the room in the whole-shelf view (' + overview('small') + '). The cause is the 330 px room card beside the ceiling\'s controls, not the opening\'s panel. On the 760 × 600 view the unwrapped room is ' + at('panShape', 'laptop', 'none') + ' against ' + overview('laptop') + ' in the overview, so there it holds. The room card is the next thing to look at, and it matters most on phones.</p>';
      return;
    }
    var info = INFO[current], i = ORDER.indexOf(current);
    var table = function (size) {
      var ref = M.base[size].left.none;
      return '<div class="ot-table-wrap"><table class="ot-table"><tr><th>Panel open</th><th>Card left</th><th>Card right</th><th>Zoom</th><th>Controls in view</th></tr>' + STATES.map(function (st) {
        var a = M[current][size].left[st[0]], c = M[current][size].right[st[0]];
        var j = Math.max(a.jump, 1 / a.jump, c.jump, 1 / c.jump);
        return '<tr><td>' + (st[0] === 'none' ? 'nothing' : st[0]) + '</td><td class="' + kept(a, ref) + '">' + sz(a) + '</td><td class="' + kept(c, ref) + '">' + sz(c) + '</td><td>'
          + (j < 1.02 ? '–' : '×' + j.toFixed(1)) + '</td><td>' + Math.min(a.seen, c.seen) + ' of ' + a.all + '</td></tr>';
      }).join('') + '</table></div>';
    };
    b.innerHTML = '<h2>' + rank(i) + ' ' + info.name + '</h2><p>' + info.what + '</p>'
      + '<p class="notice ' + info.tone + '">' + info.verdict() + '</p>'
      + '<div class="ot-pc"><div><h3>For</h3>' + bullets(info.pros()) + '</div><div><h3>Against</h3>' + bullets(info.cons()) + '</div></div>'
      + '<h3>Room on screen, 760 × 600 view</h3>' + table('laptop')
      + '<h3>Room on screen, 560 × 460 view</h3>' + table('small');
  }
  function show(tab) {
    current = tab;
    S.variant = tab === 'summary' ? ORDER[0] : tab;
    $('ot-vname').textContent = INFO[S.variant].name;
    renderTabs(); renderReport();
    S.manual = false;
    rebuild(false);
    refit();
  }

  // ---------------------------------------------------------- input
  // A press on empty paper may pan; a click on the drawing picks a room, or
  // one of the selected room's openings. While an opening's panel is open, a
  // click anywhere else on the drawing only closes it: going to another room
  // takes a second, deliberate click.
  var pan = null;
  svg.addEventListener('pointerdown', function (e) {
    var gEl = e.target.closest('[data-room]'), oEl = e.target.closest('[data-op]');
    pan = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, room: gEl ? +gEl.dataset.room : null, op: oEl ? +oEl.dataset.op : null, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', function (e) {
    if (!pan || pan.room != null) return;
    var dx = (e.clientX - pan.x) / K, dy = (e.clientY - pan.y) / K;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    if (!pan.moved) { stopAnim(); S.manual = true; }
    pan.moved = true;
    cam.x = pan.cx - dx / cam.s; cam.y = pan.cy + dy / cam.s;
    apply();
  });
  svg.addEventListener('pointerup', function () {
    if (!pan) return;
    var p = pan; pan = null;
    if (p.moved) return;
    if (p.op != null && p.room === S.sel) { S.pick = p.op; S.manual = false; rebuild(false); refit(); return; }
    if (S.pick != null) { closeTile(); return; }
    if (p.room != null && p.room !== S.sel) select(p.room);
    else if (p.room == null && S.sel != null) deselect();
  });
  svg.addEventListener('pointercancel', function () { pan = null; });
  view.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    var rc = view.getBoundingClientRect();
    zoomAt((e.clientX - rc.left) / K, (e.clientY - rc.top) / K, Math.exp(-e.deltaY * 0.01));
  }, { passive: false });
  $('ot-zin').addEventListener('click', function () { zoomAt(VW / 2, viewH() / 2, 1.25); });
  $('ot-zout').addEventListener('click', function () { zoomAt(VW / 2, viewH() / 2, 1 / 1.25); });
  $('ot-fitbtn').addEventListener('click', function () { S.manual = false; refit(); });

  function newOpening(r, wall) {
    var side = wall === 'left' || wall === 'right';
    var o = wall === 'ceiling' ? op('ceiling', 'round', { w: 30, h: 30, cols: 2, rows: 2 })
      : wall === 'floor' ? op('floor', 'rect', { w: 30, h: 30, r: 2 })
        : op(wall, 'rect', { y: 2, w: side ? 24 : 34, h: side ? 24 : 30, cols: 2, rows: 2 });
    var taken = r.ops.filter(function (p) { return p.wall === wall; });
    var clear = function (x) { return taken.every(function (p) { return Math.abs(p.x - x) >= (p.w + o.w) / 2 + 4; }); };
    for (var k = 0; k < 12; k++) {
      if (clear(k * (o.w + 6))) { o.x = k * (o.w + 6); break; }
      if (clear(-k * (o.w + 6))) { o.x = -k * (o.w + 6); break; }
    }
    return o;
  }
  var flashEl = $('ot-flash'), flashT;
  function flash(msg) {
    flashEl.textContent = msg; flashEl.classList.add('show');
    clearTimeout(flashT); flashT = setTimeout(function () { flashEl.classList.remove('show'); }, 1400);
  }

  jig.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  jig.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), r = R();
    if (!b || !r || b.tagName === 'SELECT') return;
    var a = b.dataset.act, o = S.pick != null ? r.ops[S.pick] : null;
    if (a === 'wall') r.walls[b.dataset.wall] = b.dataset.v;
    else if (a === 'pick') S.pick = S.pick === +b.dataset.i ? null : +b.dataset.i;
    else if (a === 'add') { r.ops.push(newOpening(r, b.dataset.wall)); S.pick = r.ops.length - 1; }
    else if (a === 'unpick') S.pick = null;
    else if (a === 'set') { o[b.dataset.k] = b.dataset.v; if (b.dataset.k === 'anchor' && b.dataset.v === 'floor') o.y = 0; }
    else if (a === 'copy') { var c = JSON.parse(JSON.stringify(o)); c.x = o.x + o.w + 6; r.ops.splice(S.pick + 1, 0, c); S.pick++; }
    else if (a === 'remove') { r.ops.splice(S.pick, 1); S.pick = null; }
    else if (a === 'corner') {
      var ring = b.dataset.ring, to = !r[ring][b.dataset.c];
      if (e.shiftKey) ['tl', 'tr', 'br', 'bl'].forEach(function (c2) { r[ring][c2] = to; });
      else r[ring][b.dataset.c] = to;
    } else if (a === 'mock') { flash('“' + (b.title || b.textContent) + '” is not part of this mock-up'); return; }
    else return;
    S.manual = false;
    rebuild(false);
    refit();
  });
  jig.addEventListener('change', function (e) {
    var r = R(), t = e.target;
    if (t.dataset.act === 'wallto') {
      var o = r.ops[S.pick];
      o.wall = t.value;
      if (!onWall(o)) o.anchor = 'centre';
    }
    rebuild(false);
    refit();
  });
  jig.addEventListener('input', function (e) {
    var r = R(), t = e.target;
    if (t.dataset.ok != null) { var v = parseFloat(t.value); if (!isNaN(v)) r.ops[S.pick][t.dataset.ok] = v; }
    else if (t.dataset.k != null) {
      if (t.dataset.k === 'name' || t.dataset.k === 'color') r[t.dataset.k] = t.value;
      else { var n = parseFloat(t.value); if (!isNaN(n) && n >= 20) r[t.dataset.k] = n; }
    } else return;
    renderSvg(); apply();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.pick != null) closeTile();
  });
  document.querySelector('.ot-opts').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.size) { VW = SIZES[b.dataset.size][0]; VH = SIZES[b.dataset.size][1]; }
    if (b.dataset.side) S.side = b.dataset.side;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) {
      x.classList.toggle('is-on', x.dataset.size ? SIZES[x.dataset.size][0] === VW : x.dataset.side === S.side);
    });
    S.manual = false;
    SHELF_S = fitShelf().s;
    rebuild(false);
    refit(true);
  });
  function onTab(e) { var b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); }
  $('ot-tabs').addEventListener('click', onTab);
  $('ot-figs').addEventListener('click', onTab);
  $('ot-report').addEventListener('click', onTab);
  window.addEventListener('resize', function () { fitStage(); });

  // Measure everything, then open the test room on its floor panel. The
  // panels' sizes depend on the type, so wait for the web fonts first: a
  // measurement taken in the fallback face gives different numbers.
  function start() {
    cam = fitShelf(); SHELF_S = cam.s;
    M = measure();
    S.sel = TEST_ROOM; S.pick = 6;
    S.variant = ORDER[0];
    $('ot-vname').textContent = INFO[S.variant].name;
    renderFigs(); renderTabs(); renderReport();
    rebuild(false);
    refit(true);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
  else start();
}());
