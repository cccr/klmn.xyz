'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSite, loadPage } = require('./harness');

buildSite();

function page() { return loadPage('games/11dots/index.html'); }

// The engine is pure, so one page serves every engine test; the solver runs
// once per rule and is cached on it.
const P = page();
const E = P.window.elevenDots;
const { RED, BLUE, START, RULES, pos, fmt, moveText, mv } = E || {};

test.after(() => P.window.close());

// ── Graph and state ──────────────────────────────────────────────────────

test('the board has 14 edges and every edge runs both ways', () => {
  let degree = 0;
  for (let i = 0; i < E.N; i++) for (let j = 0; j < E.N; j++) {
    assert.equal(E.ADJ[i] >> j & 1, E.ADJ[j] >> i & 1, `${E.NAMES[i]}-${E.NAMES[j]}`);
    degree += E.ADJ[i] >> j & 1;
  }
  assert.equal(degree / 2, 14);
});

test('B, J and F have the neighbours the rules give them', () => {
  assert.deepEqual([E.letters(E.ADJ[1]), E.letters(E.ADJ[9]), E.letters(E.ADJ[5])], ['ACD', 'HIK', 'DEGH']);
});

test('there are 18,480 positions and the start position round-trips', () => {
  assert.equal(E.STATES.length, 18480);
  assert.deepEqual(E.unkey(START), { red: E.maskOf('ABC'), blue: E.maskOf('IJK'), turn: RED });
  assert.equal(fmt(pos('ABD', 'HIJ', BLUE)), 'R:ABD B:HIJ Blue');
});

// ── Rules ────────────────────────────────────────────────────────────────

test('from the start Red has exactly one move, B→D', () => {
  assert.deepEqual(E.moves(START, 'lose').map(moveText), ['B→D']);
});

test('no move jumps a gap or lands on a stone', () => {
  for (const s of E.STATES) {
    const { red, blue } = E.unkey(s);
    for (const m of E.steps(s)) {
      assert.ok(E.ADJ[m.from] >> m.to & 1, `jump ${moveText(m)} in ${fmt(s)}`);
      assert.ok(!((red | blue) >> m.to & 1), `occupied ${moveText(m)} in ${fmt(s)}`);
    }
  }
});

test('a filled goal wins for its side', () => {
  assert.deepEqual([E.winner(pos('IJK', 'ABD', BLUE)), E.winner(pos('DEF', 'ABC', RED)), E.winner(START)],
                   [RED, BLUE, null]);
});

test('a side with no move loses, draws or passes, by rule', () => {
  const s = pos('ABC', 'DEF', RED); // Red's only exit, B→D, is blocked
  assert.equal(E.steps(s).length, 0);
  assert.equal(E.terminal(s, 'lose'), 'L');
  assert.equal(E.terminal(s, 'draw'), 'D');
  assert.equal(E.terminal(s, 'pass'), null);
  assert.deepEqual(E.moves(s, 'pass').map(moveText), ['pass']);
  assert.equal(E.moves(s, 'pass')[0].next, pos('ABC', 'DEF', BLUE));
});

// ── Solver ───────────────────────────────────────────────────────────────

for (const rule of ['lose', 'pass', 'draw']) {
  test(`the solution under "${rule}" is consistent in every position`, () => {
    assert.deepEqual(E.checkSolution(E.solution(rule)), []);
  });
}

test('Red wins in 1, and Blue to move there loses in 2', () => {
  const S = E.solution('lose');
  assert.deepEqual(E.valueOf(S, pos('HIK', 'ABD', RED)), { v: 1, d: 1 });
  assert.deepEqual(E.valueOf(S, pos('HIK', 'ABD', BLUE)), { v: -1, d: 2 });
});

test('Red wins in 3: G→H, any reply, H→J', () => {
  assert.deepEqual(E.valueOf(E.solution('lose'), pos('GIK', 'ABD', RED)), { v: 1, d: 3 });
});

test('a stuck Red loses, draws, or takes the passed position\'s value', () => {
  const s = pos('ABC', 'DEF', RED);
  assert.deepEqual(E.valueOf(E.solution('lose'), s), { v: -1, d: 0 });
  assert.equal(E.valueOf(E.solution('draw'), s).v, 0);
  const p = E.solution('pass'), after = E.valueOf(p, s ^ 1), mine = E.valueOf(p, s);
  assert.equal(mine.v, after.v === 0 ? 0 : -after.v);
  if (mine.v !== 0) assert.equal(mine.d, after.d + 1);
});

test('the start position is a draw under every rule', () => {
  for (const rule of RULES) assert.equal(E.valueOf(E.solution(rule), START).v, 0, rule);
});

// ── Analysis and CPU ─────────────────────────────────────────────────────

test('rated moves sort wins fastest-first, then draws, then losses slowest-first', () => {
  const sorted = [{ v: -1, d: 4 }, { v: 1, d: 7 }, { v: 0, d: 0 }, { v: 1, d: 3 }, { v: -1, d: 9 }]
    .sort(E.cmpRated).map(E.valText);
  assert.deepEqual(sorted, ['W3', 'W7', 'D', 'L9', 'L4']);
});

test('the winning step is rated first', () => {
  const r = E.rated(E.solution('lose'), pos('HIK', 'ABD', RED));
  assert.deepEqual([moveText(r[0]), E.valText(r[0]), r.length], ['H→J', 'W1', 6]);
});

test('a forced pass is one safe move out of one', () => {
  assert.deepEqual(E.safety(E.solution('pass'), pos('ABC', 'DEF', RED)), { safe: 1, total: 1 });
});

test('the best line for a win in 3 is G→H, a reply, H→J', () => {
  const line = E.bestLine(E.solution('lose'), pos('GIK', 'ABD', RED));
  assert.deepEqual([line.length, moveText(line[0]), moveText(line[2])], [3, 'G→H', 'H→J']);
});

test('reachable positions add up', () => {
  const c = E.stats(E.solution('lose'));
  assert.ok(c.total > 1);
  assert.equal(c.W + c.D + c.L, c.total);
});

test('the CPU takes the fastest win', () => {
  assert.equal(moveText(E.cpuMove(E.solution('lose'), pos('GIK', 'ABD', RED))), 'G→H');
});

test('the CPU keeps a drawn position drawn', () => {
  for (const rule of RULES) {
    const S = E.solution(rule);
    const s = E.STATES.find((x) => !E.terminal(x, rule) && E.valueOf(S, x).v === 0);
    for (let seed = 1; seed <= 5; seed++) assert.equal(E.cpuMove(S, s, E.lcg(seed)).v, 0, `${rule} ${fmt(s)}`);
  }
});

// ── Game ─────────────────────────────────────────────────────────────────

test('a fresh game is at the start and not over', () => {
  const g = new E.Game('lose');
  assert.deepEqual([g.cursor, g.state === START, g.status().over], [0, true, false]);
});

test('play rejects illegal and stale moves', () => {
  const g = new E.Game('lose'), m = mv(START, 'lose', 'BD');
  assert.deepEqual([g.play({ next: 12345 }), g.play(m), g.play(m), g.cursor], [false, true, false, 1]);
});

test('nothing can be played once the game is over', () => {
  const g = new E.Game('lose', pos('HIK', 'ABD', RED));
  assert.equal(g.play(mv(g.state, 'lose', 'HJ')), true);
  assert.deepEqual(g.status(), { over: true, result: 'red', reason: 'goal' });
  assert.equal(g.legal().length, 0);
  assert.equal(g.play({ next: pos('HIJ', 'ABD', RED) }), false);
});

test('a stuck side ends the game under lose and draw', () => {
  const s = pos('ABC', 'DEF', RED);
  assert.deepEqual(new E.Game('lose', s).status(), { over: true, result: 'blue', reason: 'stuck' });
  assert.deepEqual(new E.Game('draw', s).status(), { over: true, result: 'draw', reason: 'stuck' });
});

test('threefold repetition ends the game on the third occurrence', () => {
  const g = new E.Game('lose'), loop = ['BD', 'JH', 'DB', 'HJ'];
  for (const t of loop) g.play(mv(g.state, g.rule, t));
  assert.equal(g.status().over, false);
  for (const t of loop) g.play(mv(g.state, g.rule, t));
  assert.equal(g.count(START), 3);
  assert.deepEqual(g.status(), { over: true, result: 'draw', reason: 'repetition' });
});

test('playing after undo drops the moves that were undone', () => {
  const g = new E.Game('lose');
  for (const t of ['BD', 'JH', 'DE']) g.play(mv(g.state, g.rule, t));
  g.undo();
  g.play(mv(g.state, g.rule, 'DF'));
  assert.deepEqual([g.history.length, g.cursor, g.moves.map(moveText)], [4, 3, ['B→D', 'J→H', 'D→F']]);
});

test('loading a line mid-history replaces what came after', () => {
  const g = new E.Game('lose');
  for (const t of ['BD', 'JH', 'DE']) g.play(mv(g.state, g.rule, t));
  g.jump(1);
  const jh = mv(g.state, g.rule, 'JH');
  g.load([jh, mv(jh.next, g.rule, 'DG')]);
  assert.deepEqual([g.cursor, g.moves.map(moveText)], [3, ['B→D', 'J→H', 'D→G']]);
});

test('leaving the pass rule cuts history back to before the first pass', () => {
  const g = new E.Game('pass', pos('ABC', 'DEF', RED));
  g.play(mv(g.state, 'pass', 'pass'));
  g.play(mv(g.state, 'pass', 'DG'));
  assert.ok(g.setRule('draw'));
  assert.deepEqual([g.history.length, g.cursor, g.status()],
                   [1, 0, { over: true, result: 'draw', reason: 'stuck' }]);
});

test('a CPU against CPU game always ends', () => {
  for (const rule of RULES) {
    const g = new E.Game(rule), S = E.solution(rule), rnd = E.lcg(7);
    let plies = 0;
    while (!g.status().over) {
      assert.ok(++plies <= 3000, `${rule}: no end after 3000 plies`);
      g.play(E.cpuMove(S, g.state, rnd));
    }
  }
});

// ── The page ─────────────────────────────────────────────────────────────

test('clicking B then D moves Red\'s stone', () => {
  const { window, doc, click } = page();
  const hits = doc.querySelectorAll('.dots-hit');
  click(hits[1]);
  assert.deepEqual([...doc.querySelectorAll('#hints text')].map((t) => t.textContent), ['D']);
  click(hits[3]);
  assert.equal(fmt(window.elevenDots.game().state), 'R:ACD B:IJK Blue');
  window.close();
});

test('the board ignores clicks on the CPU\'s turn', () => {
  const { window, doc, click } = page();
  const hits = doc.querySelectorAll('.dots-hit');
  click(hits[1]); click(hits[3]);                 // Blue (CPU) to move now
  click(hits[9]); click(hits[7]);                 // try to move Blue's J→H by hand
  assert.equal(window.elevenDots.game().cursor, 1);
  window.close();
});

test('⏭ goes back to live play so the CPU replies', async () => {
  const { window, doc, $, click } = page();
  const hits = doc.querySelectorAll('.dots-hit');
  $('speed').value = 20;                          // 100 ms per CPU move
  click(hits[1]); click(hits[3]);
  click($('back')); click($('last'));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(window.elevenDots.game().cursor, 2);
  window.close();
});

test('the findings show a draw under all three rules', () => {
  const { doc, window } = page();
  const cards = [...doc.querySelectorAll('#findings .dots-card')];
  assert.equal(cards.length, 3);
  for (const c of cards) assert.match(c.querySelector('.dots-result').textContent, /^Draw/);
  window.close();
});

test('the rule and player switches mark the chosen button', () => {
  const { doc, $, click, window } = page();
  click(doc.querySelector('#rule button[data-v="pass"]'));
  assert.equal(doc.querySelector('#rule .is-on').textContent, 'pass');
  assert.equal(window.elevenDots.game().rule, 'pass');
  assert.equal($('p0').querySelector('.is-on').textContent, 'Human');
  window.close();
});
