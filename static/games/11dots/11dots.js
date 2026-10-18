// 11 Dots — a small two-player race game, solved exactly in the browser.
//
// Red starts on A B C and Blue on I J K; a move steps one stone along an edge
// to a free dot. Each side wins by filling the other's three dots. There are
// only 18,480 positions (stone layout × side to move), so the page labels
// every one of them win / draw / loss by retrograde analysis on load and shows
// those labels on every move.
//
// Sections: Graph → State → Rules → Solver → Analysis → Game → CPU → UI.
// Everything above UI is pure and exposed as window.elevenDots for the tests.
(function () {
    'use strict';

    // ===== Graph =====
    var NAMES = 'ABCDEFGHIJK';
    var N = 11;
    var EDGES = ['AB', 'BC', 'BD', 'DE', 'DF', 'DG', 'EF', 'FG', 'EH', 'FH', 'GH', 'HJ', 'IJ', 'JK'];
    var ADJ = [];
    var POS = {
        A: [60, 60], B: [60, 160], C: [60, 260],
        D: [180, 160],
        E: [300, 60], F: [300, 160], G: [300, 260],
        H: [420, 160],
        I: [540, 60], J: [540, 160], K: [540, 260]
    };
    var RED = 0, BLUE = 1;
    var SIDE = ['Red', 'Blue'];
    var RULES = ['lose', 'pass', 'draw'];

    (function () {
        var i, a, b;
        for (i = 0; i < N; i++) ADJ.push(0);
        for (i = 0; i < EDGES.length; i++) {
            a = NAMES.indexOf(EDGES[i].charAt(0));
            b = NAMES.indexOf(EDGES[i].charAt(1));
            ADJ[a] |= 1 << b;
            ADJ[b] |= 1 << a;
        }
    })();

    function bit(c) { return 1 << NAMES.indexOf(c); }
    function maskOf(str) {
        var m = 0, i;
        for (i = 0; i < str.length; i++) m |= bit(str.charAt(i));
        return m;
    }
    function letters(m) {
        var out = '', i;
        for (i = 0; i < N; i++) if (m >> i & 1) out += NAMES.charAt(i);
        return out;
    }
    var RED_GOAL = maskOf('IJK'), BLUE_GOAL = maskOf('ABC');

    // ===== State =====
    // A position is one integer: red mask << 12 | blue mask << 1 | side to move.
    function key(red, blue, turn) { return (red << 12) | (blue << 1) | turn; }
    function unkey(s) { return { red: s >>> 12, blue: (s >>> 1) & 2047, turn: s & 1 }; }
    function pos(r, b, turn) { return key(maskOf(r), maskOf(b), turn); }
    function fmt(s) {
        var u = unkey(s);
        return 'R:' + letters(u.red) + ' B:' + letters(u.blue) + ' ' + SIDE[u.turn];
    }
    function popcount(m) { var c = 0; while (m) { m &= m - 1; c++; } return c; }

    var STATES = [], INDEX = {};
    (function () {
        var triples = [], m, i, j, t, k;
        for (m = 0; m < 2048; m++) if (popcount(m) === 3) triples.push(m);
        for (i = 0; i < triples.length; i++) for (j = 0; j < triples.length; j++) {
            if (triples[i] & triples[j]) continue;
            for (t = 0; t < 2; t++) {
                k = key(triples[i], triples[j], t);
                INDEX[k] = STATES.length;
                STATES.push(k);
            }
        }
    })();
    var START = pos('ABC', 'IJK', RED);

    // ===== Rules =====
    function winner(s) {
        var u = unkey(s), r = u.red === RED_GOAL, b = u.blue === BLUE_GOAL;
        if (r && b) return 1 - u.turn; // unreachable layout: the player who just moved wins
        return r ? RED : b ? BLUE : null;
    }

    function steps(s) {
        var u = unkey(s), own = u.turn === RED ? u.red : u.blue, occupied = u.red | u.blue;
        var out = [], i, j, free, moved;
        for (i = 0; i < N; i++) {
            if (!(own >> i & 1)) continue;
            free = ADJ[i] & ~occupied;
            for (j = 0; j < N; j++) {
                if (!(free >> j & 1)) continue;
                moved = (own & ~(1 << i)) | (1 << j);
                out.push({ from: i, to: j,
                           next: u.turn === RED ? key(moved, u.blue, BLUE) : key(u.red, moved, RED) });
            }
        }
        return out;
    }

    // The game's result for the side to move, or null while it goes on.
    // A side already on its own goal (unreachable in play) counts as having won.
    function terminal(s, rule) {
        var w = winner(s);
        if (w !== null) return w === unkey(s).turn ? 'W' : 'L';
        if (steps(s).length === 0) {
            if (rule === 'lose') return 'L';
            if (rule === 'draw') return 'D';
        }
        return null;
    }

    function moves(s, rule) {
        if (terminal(s, rule)) return [];
        var st = steps(s);
        return st.length ? st : [{ pass: true, from: -1, to: -1, next: s ^ 1 }];
    }

    function moveText(m) { return m.pass ? 'pass' : NAMES.charAt(m.from) + '→' + NAMES.charAt(m.to); }

    function mv(s, rule, text) {
        var ms = moves(s, rule), i, m;
        for (i = 0; i < ms.length; i++) {
            m = ms[i];
            if (text === 'pass' ? m.pass : NAMES.charAt(m.from) + NAMES.charAt(m.to) === text) return m;
        }
        throw new Error('no move ' + text + ' in ' + fmt(s) + ' (' + rule + ')');
    }

    // ===== Solver =====
    var VAL = { W: 1, D: 0, L: -1 };

    function solve(rule) {
        var S = STATES.length;
        var val = new Int8Array(S), dist = new Int16Array(S);
        var done = new Uint8Array(S), remaining = new Int32Array(S);
        var preds = [], queue = [], i, j, s, t, ms, q, p, list;
        for (i = 0; i < S; i++) preds.push([]);
        for (i = 0; i < S; i++) {
            s = STATES[i];
            t = terminal(s, rule);
            if (t) {
                done[i] = 1;
                val[i] = VAL[t];
                if (t !== 'D') queue.push(i);
                continue;
            }
            ms = moves(s, rule);
            remaining[i] = ms.length;
            for (j = 0; j < ms.length; j++) preds[INDEX[ms[j].next]].push(i);
        }
        // BFS from decided positions; queue order keeps dist non-decreasing,
        // so wins get the shortest distance and losses the longest resistance.
        for (q = 0; q < queue.length; q++) {
            t = queue[q];
            list = preds[t];
            for (j = 0; j < list.length; j++) {
                p = list[j];
                if (done[p]) continue;
                if (val[t] === -1) {
                    done[p] = 1; val[p] = 1; dist[p] = dist[t] + 1; queue.push(p);
                } else if (--remaining[p] === 0) {
                    done[p] = 1; val[p] = -1; dist[p] = dist[t] + 1; queue.push(p);
                }
            }
        }
        return { rule: rule, val: val, dist: dist }; // never-decided positions stay 0 = draw
    }

    var SOLUTIONS = {};
    function solution(rule) { return SOLUTIONS[rule] || (SOLUTIONS[rule] = solve(rule)); }

    function valueOf(sol, s) {
        var i = INDEX[s];
        return { v: sol.val[i], d: sol.dist[i] };
    }

    // Up to five positions whose label breaks the rules it was derived from.
    function checkSolution(sol) {
        var errs = [], i, s, t, v, d, ms, j, k, minLoss, maxWin, anyDraw, anyLoss, allWin;
        for (i = 0; i < STATES.length && errs.length < 5; i++) {
            s = STATES[i]; t = terminal(s, sol.rule); v = sol.val[i]; d = sol.dist[i];
            if (t) {
                if (v !== VAL[t] || d !== 0) errs.push('terminal ' + fmt(s));
                continue;
            }
            ms = moves(s, sol.rule);
            minLoss = Infinity; maxWin = -1; anyDraw = false; anyLoss = false; allWin = true;
            for (j = 0; j < ms.length; j++) {
                k = INDEX[ms[j].next];
                if (sol.val[k] === -1) { anyLoss = true; minLoss = Math.min(minLoss, sol.dist[k]); }
                if (sol.val[k] === 0) anyDraw = true;
                if (sol.val[k] === 1) maxWin = Math.max(maxWin, sol.dist[k]); else allWin = false;
            }
            if (v === 1) {
                if (!anyLoss || minLoss !== d - 1) errs.push('W ' + fmt(s));
            } else if (v === -1) {
                if (!allWin || maxWin !== d - 1) errs.push('L ' + fmt(s));
            } else if (anyLoss || !anyDraw) {
                errs.push('D ' + fmt(s));
            }
        }
        return errs;
    }

    // ===== Analysis =====
    function cmpRated(a, b) {
        if (a.v !== b.v) return b.v - a.v;
        if (a.v === 1) return a.d - b.d;
        if (a.v === -1) return b.d - a.d;
        return 0;
    }

    // Every legal move, with its result from the mover's point of view, best first.
    function rated(sol, s) {
        var ms = moves(s, sol.rule), out = [], i, m, r;
        for (i = 0; i < ms.length; i++) {
            m = ms[i];
            r = valueOf(sol, m.next);
            out.push({ from: m.from, to: m.to, pass: m.pass, next: m.next,
                       v: r.v === 0 ? 0 : -r.v, d: r.v === 0 ? 0 : r.d + 1 });
        }
        return out.sort(cmpRated);
    }

    function valText(r) { return r.v === 1 ? 'W' + r.d : r.v === -1 ? 'L' + r.d : 'D'; }

    function safety(sol, s) {
        var r = rated(sol, s), safe = 0, i;
        for (i = 0; i < r.length; i++) if (r[i].v === r[0].v) safe++;
        return { safe: safe, total: r.length };
    }

    function bestLine(sol, s, maxPlies) {
        var line = [], seen = {}, r;
        if (maxPlies === undefined) maxPlies = 200;
        seen[s] = true;
        while (line.length < maxPlies) {
            r = rated(sol, s);
            if (!r.length) break;
            line.push(r[0]);
            s = r[0].next;
            if (seen[s]) break;
            seen[s] = true;
        }
        return line;
    }

    // Win / draw / loss counts, for the side to move, over positions reachable from the start.
    function stats(sol) {
        var seen = {}, queue = [START], c = { W: 0, D: 0, L: 0, total: 0 }, i, v, ms, j;
        seen[START] = true;
        for (i = 0; i < queue.length; i++) {
            v = sol.val[INDEX[queue[i]]];
            c[v === 1 ? 'W' : v === -1 ? 'L' : 'D']++;
            ms = moves(queue[i], sol.rule);
            for (j = 0; j < ms.length; j++) {
                if (!seen[ms[j].next]) { seen[ms[j].next] = true; queue.push(ms[j].next); }
            }
        }
        c.total = queue.length;
        return c;
    }

    // ===== Game =====
    function Game(rule, start) {
        this.rule = rule;
        this.start = start === undefined ? START : start;
        this.reset();
    }
    Object.defineProperty(Game.prototype, 'state', {
        get: function () { return this.history[this.cursor]; }
    });
    Game.prototype.reset = function () { this.history = [this.start]; this.moves = []; this.cursor = 0; };
    Game.prototype.legal = function () { return moves(this.state, this.rule); };
    Game.prototype.count = function (s) {
        var c = 0, i;
        for (i = 0; i <= this.cursor; i++) if (this.history[i] === s) c++;
        return c;
    };
    Game.prototype.status = function () {
        var s = this.state, w = winner(s), t;
        if (w !== null) return { over: true, result: w === RED ? 'red' : 'blue', reason: 'goal' };
        t = terminal(s, this.rule);
        if (t === 'D') return { over: true, result: 'draw', reason: 'stuck' };
        if (t === 'L') return { over: true, result: unkey(s).turn === RED ? 'blue' : 'red', reason: 'stuck' };
        if (this.count(s) >= 3) return { over: true, result: 'draw', reason: 'repetition' };
        return { over: false, result: null, reason: null };
    };
    // Only a move legal in the current position is accepted, so a stale one is refused.
    Game.prototype.play = function (m) {
        var legal = null, ms, i;
        if (!m || this.status().over) return false;
        ms = this.legal();
        for (i = 0; i < ms.length; i++) if (ms[i].next === m.next) legal = ms[i];
        if (!legal) return false;
        this.history.length = this.cursor + 1;
        this.moves.length = this.cursor;
        this.history.push(legal.next);
        this.moves.push(legal);
        this.cursor++;
        return true;
    };
    Game.prototype.jump = function (i) { this.cursor = Math.max(0, Math.min(i, this.history.length - 1)); };
    Game.prototype.undo = function () { this.jump(this.cursor - 1); };
    Game.prototype.redo = function () { this.jump(this.cursor + 1); };
    Game.prototype.load = function (list) {
        var i;
        this.history.length = this.cursor + 1;
        this.moves.length = this.cursor;
        for (i = 0; i < list.length; i++) if (!this.play(list[i])) break;
    };
    // Switching rules keeps history up to the cursor, cut back further if it
    // holds a pass the new rule does not allow. Returns a notice when it cuts.
    Game.prototype.setRule = function (rule) {
        var p = -1, i;
        this.rule = rule;
        this.history.length = this.cursor + 1;
        this.moves.length = this.cursor;
        if (rule === 'pass') return null;
        for (i = 0; i < this.moves.length; i++) if (this.moves[i].pass) { p = i; break; }
        if (p < 0) return null;
        this.history.length = p + 1;
        this.moves.length = p;
        this.cursor = p;
        return 'History cut before ply ' + (p + 1) + ': passing is not allowed under “' + rule + '”.';
    };

    // ===== CPU =====
    function cpuMove(sol, s, rnd) {
        var r = rated(sol, s), draws = [], i;
        if (!r.length) return null;
        if (r[0].v !== 0) return r[0]; // fastest win or slowest loss
        for (i = 0; i < r.length; i++) if (r[i].v === 0) draws.push(r[i]);
        return draws[Math.floor((rnd || Math.random)() * draws.length)];
    }

    function lcg(seed) {
        return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    }

    // ===== UI =====
    var SVGNS = 'http://www.w3.org/2000/svg';
    var ui = { players: ['human', 'cpu'], paused: false, selected: null, timer: null,
               notice: null, treeRoot: null, expanded: {}, stones: null };
    var game = null;

    function $(id) { return document.getElementById(id); }
    function sol() { return solution(game.rule); }
    function valClass(v) { return v === 1 ? 'is-w' : v === -1 ? 'is-l' : 'is-d'; }
    function sideClass(turn) { return turn ? 'is-blue' : 'is-red'; }

    function el(tag, attrs) {
        var e = document.createElement(tag), k, i, kid;
        attrs = attrs || {};
        for (k in attrs) {
            if (!attrs.hasOwnProperty(k)) continue;
            if (k === 'class') e.className = attrs[k];
            else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
            else e.setAttribute(k, attrs[k]);
        }
        for (i = 2; i < arguments.length; i++) {
            kid = arguments[i];
            e.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
        }
        return e;
    }
    function svg(tag, attrs) {
        var e = document.createElementNS(SVGNS, tag), k;
        for (k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
        return e;
    }
    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

    function verdict(s) {
        var r = valueOf(sol(), s), turn = unkey(s).turn;
        if (r.v === 0) return 'Draw with best play';
        return SIDE[r.v === 1 ? turn : 1 - turn] + ' wins in ' + r.d + (r.d === 1 ? ' ply' : ' plies');
    }

    function statusText() {
        var st = game.status(), turn = unkey(game.state).turn, side = SIDE[turn], who;
        if (!st.over) {
            if (ui.players[turn] !== 'cpu') return side + ' to move';
            return side + ' to move · CPU ' + (ui.paused ? 'paused' : 'thinking');
        }
        who = st.result === 'red' ? 'Red' : 'Blue';
        if (st.reason === 'goal') return who + ' wins — goal reached';
        if (st.reason === 'repetition') return 'Draw — threefold repetition';
        return st.result === 'draw' ? 'Draw — ' + side + ' has no move' : who + ' wins — ' + side + ' has no move';
    }

    // Every user action cancels a pending CPU move first, so none lands late.
    function userAction() {
        clearTimeout(ui.timer);
        ui.timer = null;
        ui.notice = null;
    }

    function buildBoard() {
        var b = $('board'), i, k, side, xy, p1, p2, t, g, h, hints, stones, hits;
        function ring(mask, cls) {
            var j, p;
            for (j = 0; j < N; j++) if (mask >> j & 1) {
                p = POS[NAMES.charAt(j)];
                b.appendChild(svg('circle', { cx: p[0], cy: p[1], r: 27, 'class': 'dots-goal ' + cls }));
            }
        }
        ring(RED_GOAL, 'is-red');
        ring(BLUE_GOAL, 'is-blue');
        for (i = 0; i < EDGES.length; i++) {
            p1 = POS[EDGES[i].charAt(0)];
            p2 = POS[EDGES[i].charAt(1)];
            b.appendChild(svg('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], 'class': 'dots-edge' }));
        }
        for (i = 0; i < N; i++) {
            xy = POS[NAMES.charAt(i)];
            b.appendChild(svg('circle', { cx: xy[0], cy: xy[1], r: 6, 'class': 'dots-dot' }));
            t = svg('text', { x: xy[0] - 26, y: xy[1] - 22, 'class': 'dots-label' });
            t.textContent = NAMES.charAt(i);
            b.appendChild(t);
        }
        hints = svg('g', { id: 'hints' });
        stones = svg('g', {});
        hits = svg('g', {});
        ui.stones = [[], []];
        for (side = 0; side < 2; side++) for (k = 0; k < 3; k++) {
            g = svg('g', { 'class': 'dots-stone ' + sideClass(side) });
            g.appendChild(svg('circle', { cx: 0, cy: 0, r: 17 }));
            stones.appendChild(g);
            ui.stones[side].push({ el: g, dot: null });
        }
        for (i = 0; i < N; i++) {
            xy = POS[NAMES.charAt(i)];
            h = svg('circle', { cx: xy[0], cy: xy[1], r: 28, 'class': 'dots-hit' });
            h.addEventListener('click', onDot.bind(null, i));
            hits.appendChild(h);
        }
        b.appendChild(stones);
        b.appendChild(hints);
        b.appendChild(hits);
    }

    // Keep each stone element on its dot when it did not move, so the moved one slides.
    function placeStones() {
        var u = unkey(game.state), masks = [u.red, u.blue], side, list, mask, free, i, s, xy;
        function taken(d) {
            for (var j = 0; j < list.length; j++) if (list[j].dot === d) return true;
            return false;
        }
        for (side = 0; side < 2; side++) {
            list = ui.stones[side]; mask = masks[side]; free = [];
            for (i = 0; i < N; i++) if (mask >> i & 1 && !taken(i)) free.push(i);
            for (i = 0; i < list.length; i++) {
                s = list[i];
                if (s.dot === null || !(mask >> s.dot & 1)) s.dot = free.shift();
            }
            for (i = 0; i < list.length; i++) {
                xy = POS[NAMES.charAt(list[i].dot)];
                list[i].el.style.transform = 'translate(' + xy[0] + 'px, ' + xy[1] + 'px)';
            }
        }
    }

    function ownMask() {
        var u = unkey(game.state);
        return u.turn === RED ? u.red : u.blue;
    }

    function renderBoard() {
        var own = ownMask(), hints = $('hints'), r, i, j, m, xy, t;
        placeStones();
        if (ui.selected !== null && !(own >> ui.selected & 1)) ui.selected = null;
        for (i = 0; i < 2; i++) for (j = 0; j < 3; j++) {
            ui.stones[i][j].el.classList.toggle('is-sel', ui.stones[i][j].dot === ui.selected);
        }
        clear(hints);
        if (ui.selected === null) return;
        r = rated(sol(), game.state);
        for (i = 0; i < r.length; i++) {
            m = r[i];
            if (m.from !== ui.selected) continue;
            xy = POS[NAMES.charAt(m.to)];
            hints.appendChild(svg('circle', { cx: xy[0], cy: xy[1], r: 15, 'class': 'dots-target ' + valClass(m.v) }));
            t = svg('text', { x: xy[0], y: xy[1] + 4, 'class': 'dots-badge ' + valClass(m.v) });
            t.textContent = valText(m);
            hints.appendChild(t);
        }
    }

    function onDot(i) {
        var turn = unkey(game.state).turn, ms, j;
        if (game.status().over || ui.players[turn] === 'cpu') return;
        if (ownMask() >> i & 1) {
            ui.selected = ui.selected === i ? null : i;
            renderBoard();
            return;
        }
        if (ui.selected === null) return;
        ms = moves(game.state, game.rule);
        for (j = 0; j < ms.length; j++) {
            if (ms[j].from === ui.selected && ms[j].to === i) { playHuman(ms[j]); return; }
        }
    }

    function playHuman(m) {
        userAction();
        ui.selected = null;
        ui.paused = false;
        game.play(m);
        render();
    }

    function markSeg(id, value) {
        var bs = $(id).querySelectorAll('button'), i;
        for (i = 0; i < bs.length; i++) bs[i].classList.toggle('is-on', bs[i].getAttribute('data-v') === value);
    }

    function renderHeader() {
        markSeg('rule', game.rule);
        markSeg('p0', ui.players[0]);
        markSeg('p1', ui.players[1]);
        $('play').textContent = ui.paused ? '▶' : '❚❚';
        $('play').title = ui.paused ? 'Play' : 'Pause';
        $('play').setAttribute('aria-label', ui.paused ? 'Play' : 'Pause');
    }

    function renderStatus() {
        $('status').textContent = statusText();
        $('notice').textContent = ui.notice || '';
        $('notice').classList.toggle('hidden', !ui.notice);
    }

    function nav(i, pause) {
        userAction();
        ui.paused = pause !== false;
        ui.selected = null;
        game.jump(i);
        render();
    }

    function renderHistory() {
        var ol = $('history'), cur;
        clear(ol);
        ol.appendChild(el('li', {}, el('button', { type: 'button', 'class': game.cursor === 0 ? 'is-cur' : '',
            onclick: function () { nav(0); } }, 'start')));
        game.moves.forEach(function (m, i) {
            var turn = unkey(game.history[i]).turn;
            ol.appendChild(el('li', {}, el('button', {
                type: 'button',
                'class': sideClass(turn) + (game.cursor === i + 1 ? ' is-cur' : ''),
                onclick: function () { nav(i + 1); }
            }, (i + 1) + '. ' + moveText(m))));
        });
        cur = ol.querySelector('.is-cur');
        if (cur) ol.scrollTop = cur.offsetTop - ol.clientHeight / 2;
    }

    function lineInto(p, line, turn, n) {
        var i;
        for (i = 0; i < line.length && i < n; i++) {
            p.appendChild(el('span', { 'class': sideClass((turn + i) % 2) }, moveText(line[i])));
            p.appendChild(document.createTextNode(' '));
        }
        if (line.length > n) p.appendChild(document.createTextNode('…'));
    }

    function renderMoves() {
        var box = $('moves'), s = game.state, S = sol(), st = game.status(), turn = unkey(s).turn;
        var r, human, ul, sf, MAX = 40, line, p, end, spec, keep;
        clear(box);
        spec = el('dl', { 'class': 'spec' });
        spec.appendChild(el('dt', {}, 'to move'));
        spec.appendChild(el('dd', {}, st.over ? '—' : SIDE[turn]));
        spec.appendChild(el('dt', {}, 'verdict'));
        spec.appendChild(el('dd', {}, st.over ? statusText() : verdict(s)));
        box.appendChild(spec);
        if (st.over) return;
        r = rated(S, s);
        human = ui.players[turn] === 'human';
        ul = el('ul', { 'class': 'dots-moves' });
        r.forEach(function (m) {
            var attrs = { type: 'button', 'class': sideClass(turn) };
            if (human) attrs.onclick = function () { playHuman(m); };
            else attrs.disabled = '';
            ul.appendChild(el('li', { 'class': 'dots-row ' + valClass(m.v) },
                el('button', attrs, moveText(m)),
                el('span', { 'class': 'dots-val ' + valClass(m.v) }, valText(m)),
                el('span', { 'class': 'dots-star' }, m.v === r[0].v && m.d === r[0].d ? '★' : '')));
        });
        box.appendChild(ul);
        sf = safety(S, s);
        keep = r[0].v === 1 ? 'keep the win' : r[0].v === 0 ? 'keep the draw' : null;
        spec = el('dl', { 'class': 'spec' });
        spec.appendChild(el('dt', {}, 'safety'));
        spec.appendChild(el('dd', {}, keep ? sf.safe + '/' + sf.total + ' moves ' + keep
                                           : '0/' + sf.total + ' — every move loses'));
        box.appendChild(spec);
        line = bestLine(S, s, MAX);
        p = el('p', { 'class': 'dots-line' }, 'Best line ');
        lineInto(p, line, turn, MAX);
        end = line.length ? line[line.length - 1].next : s;
        if (line.length < MAX && !terminal(end, game.rule)) p.appendChild(document.createTextNode('↻'));
        box.appendChild(p);
    }

    function delayMs() { return Math.round(2000 / Number($('speed').value)); }

    function schedule() {
        var turn;
        clearTimeout(ui.timer);
        ui.timer = null;
        if (ui.paused) return;
        if (game.cursor < game.history.length - 1) {          // replay forward through history
            ui.timer = setTimeout(function () { game.redo(); render(); }, delayMs());
            return;
        }
        if (game.status().over) return;
        turn = unkey(game.state).turn;
        if (ui.players[turn] !== 'cpu') return;
        ui.timer = setTimeout(function () {
            var m = cpuMove(sol(), game.state);
            if (m) game.play(m);
            render();
        }, delayMs());
    }

    function renderTree() {
        var box = $('tree'), s = game.state, over = game.status().over;
        if (ui.treeRoot !== s) { ui.treeRoot = s; ui.expanded = {}; }
        clear(box);
        box.appendChild(el('p', { 'class': 'dots-root' },
            '● now · ' + (over ? statusText() : SIDE[unkey(s).turn] + ' to move · ' + verdict(s))));
        if (!over) box.appendChild(treeList(sol(), s, '', [], [s]));
    }

    function treeList(S, s, path, line, seen) {
        var ul = el('ul'), turn = unkey(s).turn;
        rated(S, s).forEach(function (m, k) {
            var p = path + '/' + k, repeat = seen.indexOf(m.next) >= 0;
            var leaf = moves(m.next, S.rule).length === 0;
            var open = !!ui.expanded[p] && !repeat && !leaf;
            var here = line.concat([m]);
            var tog = el('button', {
                type: 'button', 'class': 'dots-tog',
                title: repeat ? 'repeats a position on this path' : leaf ? 'game ends' : open ? 'collapse' : 'expand'
            }, repeat ? '↻' : leaf ? '·' : open ? '▾' : '▸');
            var label, li;
            if (repeat || leaf) tog.disabled = true;
            else tog.addEventListener('click', function () {
                if (ui.expanded[p]) delete ui.expanded[p]; else ui.expanded[p] = true;
                renderTree();
            });
            label = el('button', {
                type: 'button', 'class': 'dots-mv ' + sideClass(turn), title: 'load this position',
                onclick: function () {
                    userAction(); ui.paused = true; ui.selected = null; game.load(here); render();
                }
            }, moveText(m));
            li = el('li', {}, el('div', { 'class': 'dots-node' }, tog, label,
                el('span', { 'class': 'dots-val ' + valClass(m.v) }, valText(m))));
            if (open) li.appendChild(treeList(S, m.next, p, here, seen.concat([m.next])));
            ul.appendChild(li);
        });
        return ul;
    }

    // Plies on the best line where the side that is winning or holding the draw has exactly one good move.
    function onlyMoves(S, line) {
        var out = [], s = START;
        line.forEach(function (m, i) {
            var r = rated(S, s), sf = safety(S, s);
            if (r[0].v >= 0 && sf.safe === 1 && sf.total > 1 && out.length < 12) {
                out.push((i + 1) + '. ' + SIDE[unkey(s).turn] + ' ' + moveText(m));
            }
            s = m.next;
        });
        return out;
    }

    function showMe(rule) {
        userAction();
        game = new Game(rule);
        ui.players = ['cpu', 'cpu'];
        ui.paused = false;
        ui.selected = null;
        render();
        if ($('board').scrollIntoView) $('board').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function renderFindings() {
        var grid = el('div', { 'class': 'dots-findings' });
        RULES.forEach(function (rule) {
            var S = solution(rule), errs = checkSolution(S), r, c, line, only, card, p, spec;
            card = el('article', { 'class': 'dots-card' }, el('h3', {}, 'No move → ' + rule));
            grid.appendChild(card);
            if (errs.length) {
                card.appendChild(el('p', { 'class': 'notice notice-alert' },
                    'Solver inconsistency — results hidden (' + errs[0] + ')'));
                return;
            }
            r = valueOf(S, START); c = stats(S); line = bestLine(S, START, 400);
            card.appendChild(el('p', { 'class': 'dots-result' + (r.v === 1 ? ' is-red' : r.v === -1 ? ' is-blue' : '') },
                r.v === 1 ? 'Red (first player) wins in ' + r.d + ' plies'
                : r.v === -1 ? 'Blue (second player) wins in ' + r.d + ' plies'
                : 'Draw — neither side can force a win'));
            card.appendChild(el('p', {}, r.v === 1 ? 'Red: has a forced win — play the starred move every turn.'
                : r.v === -1 ? 'Red: cannot avoid losing; best resistance lasts ' + r.d + ' plies.'
                : 'Red: cannot force a win, but can always keep the draw.'));
            card.appendChild(el('p', {}, r.v === -1 ? 'Blue: has a forced win — play the starred move every turn.'
                : r.v === 1 ? 'Blue: cannot avoid losing; best resistance lasts ' + r.d + ' plies.'
                : 'Blue: cannot force a win either; best play cycles until a repetition.'));
            p = el('p', { 'class': 'dots-line' }, 'Best line ');
            lineInto(p, line, RED, 24);
            card.appendChild(p);
            only = onlyMoves(S, line);
            if (only.length) card.appendChild(el('p', { 'class': 'dots-note' }, 'Only moves: ' + only.join(' · ')));
            spec = el('dl', { 'class': 'spec' });
            [['reachable', c.total], ['to move wins', c.W], ['draws', c.D], ['loses', c.L]].forEach(function (row) {
                spec.appendChild(el('dt', {}, row[0]));
                spec.appendChild(el('dd', {}, String(row[1])));
            });
            card.appendChild(spec);
            card.appendChild(el('button', { type: 'button', 'class': 'btn', onclick: function () { showMe(rule); } },
                'Show me'));
        });
        clear($('findings'));
        $('findings').appendChild(grid);
    }

    function segValue(e) { return e.target && e.target.getAttribute && e.target.getAttribute('data-v'); }

    function bindControls() {
        $('rule').addEventListener('click', function (e) {
            var v = segValue(e);
            if (!v || v === game.rule) return;
            userAction();
            ui.selected = null;
            ui.notice = game.setRule(v);
            render();
        });
        [0, 1].forEach(function (side) {
            $('p' + side).addEventListener('click', function (e) {
                var v = segValue(e);
                if (!v) return;
                userAction();
                ui.players[side] = v;
                ui.selected = null;
                render();
            });
        });
        $('first').addEventListener('click', function () { nav(0); });
        $('back').addEventListener('click', function () { nav(game.cursor - 1); });
        $('last').addEventListener('click', function () { nav(game.history.length - 1, false); }); // back to live play
        $('play').addEventListener('click', function () { userAction(); ui.paused = !ui.paused; render(); });
        $('step').addEventListener('click', function () {
            userAction();
            ui.paused = true;
            ui.selected = null;
            if (game.cursor < game.history.length - 1) game.redo();
            else if (!game.status().over) game.play(cpuMove(sol(), game.state));
            render();
        });
        $('reset').addEventListener('click', function () {
            userAction();
            ui.paused = false;
            ui.selected = null;
            game.reset();
            render();
        });
        $('speed').addEventListener('input', schedule);
    }

    function render() {
        renderHeader();
        renderBoard();
        renderStatus();
        renderHistory();
        renderMoves();
        renderTree();
        schedule();
    }

    window.elevenDots = {
        NAMES: NAMES, N: N, EDGES: EDGES, ADJ: ADJ, RED: RED, BLUE: BLUE, RULES: RULES,
        STATES: STATES, START: START,
        maskOf: maskOf, letters: letters, key: key, unkey: unkey, pos: pos, fmt: fmt,
        winner: winner, steps: steps, terminal: terminal, moves: moves, moveText: moveText, mv: mv,
        solution: solution, valueOf: valueOf, checkSolution: checkSolution,
        cmpRated: cmpRated, rated: rated, valText: valText, safety: safety, bestLine: bestLine, stats: stats,
        Game: Game, cpuMove: cpuMove, lcg: lcg,
        game: function () { return game; }
    };

    if ($('board')) {
        game = new Game('lose');
        buildBoard();
        bindControls();
        renderFindings();
        render();
    }
})();
