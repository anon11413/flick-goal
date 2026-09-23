import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createGame } from '../src/engine/game.js';
import { makeRng, solveShot, yardsOf } from '../src/engine/physics.js';
import * as D from '../src/engine/difficulty.js';
import { createDevState, clampRound, isDevRun, nextBest, DEV_KEY } from '../src/dev.js';

const STEP = 1 / CONFIG.sim.hz;

function setup(seed = 7) {
  const game = createGame({ rng: makeRng(seed) });
  game.setViewport(390, 844);
  const events = [];
  for (const n of ['runStart', 'shotStart', 'score', 'tier', 'miss', 'gameover', 'continue']) game.on(n, (p) => events.push({ n, p }));
  return { game, events };
}

function stepUntil(game, pred, maxSec = 20) {
  for (let i = 0, max = Math.ceil(maxSec / STEP); i < max; i++) {
    if (pred()) return;
    game.step(STEP);
  }
  if (!pred()) throw new Error('condition not reached; phase=' + game.phase);
}

/** Schedule-driven parameters of the current shot (everything keyed off `made`). */
function difficultyOf(shot) {
  return { made: shot.made, speed: shot.speed, band: shot.targetWidth, bandAlpha: shot.bandAlpha, gap: shot.gap };
}

function assertShotMatchesSchedule(shot, n, label) {
  const dj = CONFIG.difficulty.distance.jitter;
  assert.equal(shot.made, n, label + ': made');
  assert.equal(shot.speed, D.speed(n), label + ': speed');
  assert.equal(shot.targetWidth, D.bandWidth(n), label + ': band width');
  assert.ok(shot.clock >= D.shotClock(n) - 1e-12, label + ': clock >= L(n)');
  assert.ok(Math.abs(shot.d - D.distance(n)) <= dj + 1e-9, label + `: distance ${shot.d} ~ ${D.distance(n)}`);
  const br = D.barRange(n);
  assert.ok(shot.bar >= br.min - 1e-9 && shot.bar <= br.max + 1e-9, label + ': bar height in range');
}

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

// ---------------------------------------------------------------- engine

test('newRun({startMade:N}) builds the exact shot the solver makes for N goals (same seed)', () => {
  for (const n of [4, 29, 49, 99]) {
    const { game } = setup(11);
    game.newRun({ startMade: n });
    const expected = solveShot({ teeX: 0, made: n, rng: makeRng(11) });
    const s = game.world.shot;
    for (const k of ['made', 'speed', 'targetWidth', 'clock', 'd', 'bar', 'top', 'gap', 'bandAlpha', 'postX']) {
      assert.equal(s[k], expected[k], `N=${n} ${k}`);
    }
    assert.deepEqual(s.band, expected.band, `N=${n} band`);
    assertShotMatchesSchedule(s, n, `dev N=${n}`);
  }
});

test('dev start matches a natural run after N goals: same difficulty parameters', () => {
  const N = 10;
  // Natural run: score N goals (tap the band centre each shot).
  const nat = setup(3);
  nat.game.newRun();
  while (nat.game.hud().made < N) {
    const before = nat.game.hud().made;
    stepUntil(nat.game, () => nat.game.phase === 'aim');
    nat.game.world.marker.t = nat.game.world.shot.band.tBest;
    assert.equal(nat.game.tap(), true);
    stepUntil(nat.game, () => nat.game.hud().made > before || nat.game.phase === 'over');
    assert.equal(nat.game.hud().made, before + 1, 'natural run keeps scoring');
  }
  stepUntil(nat.game, () => nat.game.phase === 'aim');
  const natShot = nat.game.world.shot;

  // Dev run: start at round N + 1.
  const dev = setup(3);
  dev.game.newRun({ startMade: N });
  stepUntil(dev.game, () => dev.game.phase === 'aim');
  const devShot = dev.game.world.shot;

  assert.deepEqual(difficultyOf(devShot), difficultyOf(natShot));
  assertShotMatchesSchedule(natShot, N, 'natural');
  assertShotMatchesSchedule(devShot, N, 'dev');
  const ssDev = dev.events.find((e) => e.n === 'shotStart').p;
  const ssNat = nat.events.filter((e) => e.n === 'shotStart').pop().p;
  assert.equal(ssDev.made, ssNat.made);
  assert.equal(ssDev.speed, ssNat.speed);
});

test('dev start state: score = made = N, streak 0, coins 0, tier from score, continue available', () => {
  const { game, events } = setup(5);
  game.newRun({ startMade: 29 });
  const h = game.hud();
  assert.equal(h.made, 29);
  assert.equal(h.score, 29);
  assert.equal(h.streak, 0);
  assert.equal(h.coinsRun, 0);
  assert.equal(h.startMade, 29);
  assert.equal(game.startMade, 29);
  assert.equal(game.world.made, 29);
  assert.equal(game.world.tier, Math.floor(29 / CONFIG.scoring.tierEvery));
  assert.equal(events[0].n, 'runStart');
  assert.equal(events[0].p.startMade, 29);
  const tierEv = events.find((e) => e.n === 'tier');
  assert.ok(tierEv && tierEv.p.tier === 2, 'tier event so the shell recolours');

  // miss -> game over carries startMade, continue still offered and keeps it
  stepUntil(game, () => game.phase === 'aim');
  stepUntil(game, () => game.phase === 'over', 30);
  const go = events.find((e) => e.n === 'gameover').p;
  assert.equal(go.startMade, 29);
  assert.equal(go.score, 29);
  assert.equal(go.canContinue, true);
  assert.equal(game.continueRun(), true);
  assert.equal(game.hud().startMade, 29);
  assert.equal(game.world.shot.made, 29);
});

test('field posts: a dev start from the menu is a round-R attempt on the menu end line, framed after the swoop', () => {
  const R = CONFIG.physics.ballRadius;
  const U = CONFIG.field.yard;
  const dj = CONFIG.difficulty.distance.jitter;
  for (const n of [0, 9, 29, 49, 99]) {
    const { game } = setup(17);
    game.idle();
    const end = game.world.fieldEnd;
    game.newRun({ startMade: n });
    const w = game.world;
    const s = w.shot;
    assert.equal(w.fieldEnd, end, `N=${n}: same end line as the menu`);
    assert.ok(Math.abs(s.postX - end) < 1e-9, `N=${n}: post on the end line`);
    assert.ok(Math.abs(s.teeX - (end - s.d)) < 1e-9, `N=${n}: tee d in front of the post`);
    assert.equal(w.yards, yardsOf(s.d), `N=${n}: yard label from the attempt length`);
    assert.ok(Math.abs(s.d / U - Math.round(s.d / U)) < 1e-9, `N=${n}: whole yards`);
    assert.ok(Math.abs(s.d - D.distance(n)) <= dj + U / 2 + 1e-9, `N=${n}: ${w.yards} yd ~ schedule ${D.distance(n) / U}`);
    // Swoop iff the menu ball is far from the new tee (the same rule as a natural next attempt).
    assert.equal(!!w.swoop, Math.abs(s.teeX) > 120, `N=${n}: swoop iff far`);
    stepUntil(game, () => game.phase === 'aim', 5);
    assert.equal(w.swoop, null);
    assert.equal(w.ball.x, s.teeX, `N=${n}: ball teed up`);
    const vp = game.viewport;
    for (const [x, y] of [[s.teeX, R], [s.postX, s.top]]) {
      const p = game.worldToScreen(x, y);
      assert.ok(p.x > 0 && p.x < vp.cssW && p.y > 0 && p.y < vp.cssH, `N=${n}: (${x}, ${y}) on screen at aim start`);
    }
  }
});

test('startMade is clamped to [0, maxRound - 1]', () => {
  const max = CONFIG.dev.maxRound - 1;
  const cases = [[-5, 0], [0, 0], [12.7, 12], ['abc', 0], [null, 0], [1000, max], [max, max]];
  for (const [inp, want] of cases) {
    const { game } = setup(2);
    game.newRun({ startMade: inp });
    assert.equal(game.startMade, want, `startMade(${inp})`);
    assert.equal(game.hud().made, want);
    assert.equal(game.world.shot.made, want);
  }
});

test('newRun() with no args is unchanged: made 0, no tier event, first shot = solver(made 0)', () => {
  const { game, events } = setup(9);
  game.newRun();
  const h = game.hud();
  assert.equal(h.score, 0);
  assert.equal(h.made, 0);
  assert.equal(h.startMade, 0);
  assert.equal(game.world.tier, 0);
  assert.deepEqual(events.map((e) => e.n), ['runStart']);
  const expected = solveShot({ teeX: 0, made: 0, rng: makeRng(9) });
  assert.equal(game.world.shot.d, expected.d);
  assert.equal(game.world.shot.clock, expected.clock);
  // a later plain newRun() resets a dev start
  game.newRun({ startMade: 40 });
  game.newRun();
  assert.equal(game.hud().made, 0);
  assert.equal(game.startMade, 0);
});

// ---------------------------------------------------------------- best score

test('dev runs never update Best; normal runs do', () => {
  assert.equal(nextBest(12, { score: 40, startMade: 29 }), 12);
  assert.equal(nextBest(12, { score: 40, startMade: 0 }), 40);
  assert.equal(nextBest(50, { score: 40, startMade: 0 }), 50);
  assert.equal(isDevRun({ startMade: 1 }), true);
  assert.equal(isDevRun({ startMade: 0 }), false);
  assert.equal(isDevRun(null), false);

  // real gameover payload from a dev run
  const { game, events } = setup(4);
  game.newRun({ startMade: 49 });
  stepUntil(game, () => game.phase === 'over', 30);
  const go = events.find((e) => e.n === 'gameover').p;
  assert.equal(isDevRun(go), true);
  assert.equal(nextBest(3, go), 3);
});

// ---------------------------------------------------------------- dev state

test('clampRound: 1..maxRound, junk -> 1', () => {
  assert.equal(clampRound(0), 1);
  assert.equal(clampRound(-3), 1);
  assert.equal(clampRound('30'), 30);
  assert.equal(clampRound(7.9), 7);
  assert.equal(clampRound(5000), CONFIG.dev.maxRound);
  assert.equal(clampRound('x'), 1);
  assert.equal(clampRound(undefined), 1);
});

test('dev state: off by default, round 1, no storage writes', () => {
  const st = memStorage();
  const dev = createDevState({ storage: st });
  assert.equal(dev.enabled(), false);
  assert.equal(dev.startRound(), 1);
  assert.equal(dev.startMade(), 0);
  assert.equal(st.map.size, 0);
});

test('dev state: ?round=N enables dev mode, clamps and persists in its own key', () => {
  const st = memStorage();
  const dev = createDevState({ search: '?round=30', storage: st });
  assert.equal(dev.enabled(), true);
  assert.equal(dev.startRound(), 30);
  assert.equal(dev.startMade(), 29);
  assert.deepEqual(JSON.parse(st.map.get(DEV_KEY)), { devEnabled: true, startRound: 30 });
  assert.deepEqual([...st.map.keys()], [DEV_KEY], 'never touches the main save key');
  // survives a reload (no URL flag)
  const again = createDevState({ storage: st });
  assert.equal(again.startRound(), 30);
  assert.equal(createDevState({ search: '?round=999', storage: memStorage() }).startRound(), CONFIG.dev.maxRound);
  assert.equal(createDevState({ search: '?round=0', storage: memStorage() }).startRound(), 1);
});

test('dev state: ?dev=1 enables without changing the round; toggle / setStartRound persist + notify', () => {
  const st = memStorage({ [DEV_KEY]: JSON.stringify({ devEnabled: false, startRound: 20 }) });
  const off = createDevState({ storage: st });
  assert.equal(off.startRound(), 1, 'round only applies while dev mode is on');
  assert.equal(off.storedRound(), 20);
  const dev = createDevState({ search: '?dev=1', storage: st });
  assert.equal(dev.enabled(), true);
  assert.equal(dev.startRound(), 20);
  let calls = 0;
  dev.onChange(() => calls++);
  dev.setStartRound(50);
  dev.setStartRound(50); // no-op
  dev.setStartRound(9999);
  assert.equal(dev.startRound(), CONFIG.dev.maxRound);
  assert.equal(dev.toggle(), false);
  assert.equal(dev.startRound(), 1);
  assert.equal(calls, 3);
  assert.deepEqual(JSON.parse(st.map.get(DEV_KEY)), { devEnabled: false, startRound: CONFIG.dev.maxRound });
});

test('dev state: cfg.dev.enabled=false removes every access path', () => {
  const cfg = { ...CONFIG, dev: { ...CONFIG.dev, enabled: false } };
  const st = memStorage({ [DEV_KEY]: JSON.stringify({ devEnabled: true, startRound: 40 }) });
  const dev = createDevState({ cfg, search: '?round=30&dev=1', storage: st });
  assert.equal(dev.available, false);
  assert.equal(dev.enabled(), false);
  assert.equal(dev.startRound(), 1);
  dev.toggle();
  dev.setStartRound(10);
  assert.equal(dev.startMade(), 0);
  assert.equal(JSON.parse(st.map.get(DEV_KEY)).startRound, 40, 'storage untouched');
});

test('dev state: broken / throwing storage never throws', () => {
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  const dev = createDevState({ search: '?round=12', storage: bad });
  assert.equal(dev.startRound(), 12);
  dev.setStartRound(13);
  assert.equal(dev.startRound(), 13);
  const junk = createDevState({ storage: memStorage({ [DEV_KEY]: '{not json' }) });
  assert.equal(junk.startRound(), 1);
  const none = createDevState({ search: '?round=5', storage: null });
  assert.equal(none.startRound(), 5);
});
