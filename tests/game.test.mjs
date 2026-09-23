import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createGame, PHASES } from '../src/engine/game.js';
import { makeRng } from '../src/engine/physics.js';

const STEP = 1 / CONFIG.sim.hz;
const R = CONFIG.physics.ballRadius;

function setup(seed = 1) {
  const game = createGame({ rng: makeRng(seed) });
  game.setViewport(390, 844);
  const events = [];
  const names = ['runStart', 'shotStart', 'flick', 'bounce', 'score', 'coin', 'tier', 'land', 'clockLow', 'miss', 'gameover', 'continue'];
  for (const n of names) game.on(n, (p) => events.push({ n, p }));
  return { game, events };
}

function stepUntil(game, pred, maxSec = 20) {
  const max = Math.ceil(maxSec / STEP);
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    game.step(STEP);
  }
  if (pred()) return max;
  throw new Error('condition not reached; phase=' + game.phase);
}

/** Ball circle + margin must be inside the camera view (css px). */
function assertBallVisible(game, label) {
  const w = game.world;
  const { cssW, cssH } = game.viewport;
  const p = game.worldToScreen(w.ball.x, w.ball.y);
  const k = (cssW / CONFIG.view.worldWidth) * w.cam.zoom;
  const r = R * k;
  assert.ok(p.x - r >= -0.5 && p.x + r <= cssW + 0.5, `${label}: ball x ${p.x} off-screen`);
  assert.ok(p.y - r >= -0.5 && p.y + r <= cssH + 0.5, `${label}: ball y ${p.y} off-screen`);
}

test('PHASES contract', () => {
  assert.deepEqual(PHASES, ['idle', 'intro', 'aim', 'fly', 'settle', 'miss', 'over']);
});

test('idle scene: tee at x=0, solved post, no clock running, tap ignored', () => {
  const { game, events } = setup();
  game.idle();
  assert.equal(game.phase, 'idle');
  assert.equal(game.world.ball.x, 0);
  assert.ok(game.world.shot && game.world.post);
  assert.equal(game.tap(), false);
  for (let i = 0; i < 240; i++) game.step(STEP);
  assert.equal(game.phase, 'idle');
  assert.equal(events.length, 0);
  const h = game.hud();
  assert.equal(h.score, 0);
  assert.equal(h.clock01, 1);
});

test('tap in the sweet band scores, then the next shot starts', () => {
  const { game, events } = setup(1);
  game.newRun();
  assert.equal(events[0].n, 'runStart');
  assert.equal(game.phase, 'intro');
  assert.equal(game.tap(), false, 'taps ignored during intro');
  stepUntil(game, () => game.phase === 'aim');
  const ss = events.find((e) => e.n === 'shotStart');
  assert.ok(ss && ss.p.band.width > 0 && ss.p.made === 0);
  const shot = game.world.shot;
  game.world.marker.t = shot.band.tBest;
  assert.equal(game.tap(), true);
  assert.equal(game.phase, 'fly');
  const flick = events.find((e) => e.n === 'flick');
  assert.equal(flick.p.inBand, true);
  stepUntil(game, () => events.some((e) => e.n === 'score'), 5);
  const sc = events.find((e) => e.n === 'score').p;
  assert.equal(sc.made, 1);
  assert.equal(sc.doink, false);
  assert.equal(sc.perfect, true, 'tBest is the window centre -> perfect');
  assert.equal(sc.streak, 1);
  assert.equal(sc.points, 2);
  assert.equal(sc.score, 2);
  assert.equal(sc.coins, CONFIG.economy.coinsPerGoal + CONFIG.economy.coinsPerPerfectBonus);
  assert.ok(Number.isFinite(sc.sx) && Number.isFinite(sc.sy));
  const shotsBefore = events.filter((e) => e.n === 'shotStart').length;
  stepUntil(game, () => events.filter((e) => e.n === 'shotStart').length > shotsBefore, 6);
  assert.ok(events.some((e) => e.n === 'land'));
  assert.equal(game.phase, 'aim');
  assert.ok(game.world.shot.teeX > shot.postX, 'next tee is past the old post');
  assert.equal(game.world.ball.x, game.world.shot.teeX);
  assert.equal(game.world.ball.y, R);
  assert.ok(game.world.oldPost, 'old post kept for drawing');
  assert.equal(game.hud().made, 1);
});

test('every tap inside the band is a goal across a long run (many seeds)', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const { game, events } = setup(seed);
    game.newRun();
    const rng = makeRng(seed * 31);
    for (let shotN = 0; shotN < 25; shotN++) {
      stepUntil(game, () => game.phase === 'aim', 8);
      const b = game.world.shot.band;
      game.world.marker.t = b.lo + (b.hi - b.lo) * rng();
      const scores = events.filter((e) => e.n === 'score').length;
      assert.ok(game.tap());
      stepUntil(game, () => events.filter((e) => e.n === 'score').length > scores || game.phase === 'miss', 6);
      assert.notEqual(game.phase, 'miss', `seed ${seed} shot ${shotN} missed inside the band`);
      const last = events.filter((e) => e.n === 'score').pop().p;
      assert.equal(last.doink, false, 'band taps are clean');
    }
    assert.equal(game.hud().made, 25);
    assert.ok(game.hud().score >= 25);
    assert.ok(events.some((e) => e.n === 'tier'));
    assert.ok(game.hud().coinsRun >= 25);
  }
});

test('tap outside the band misses, then gameover after ~missDelay', () => {
  const { game, events } = setup(2);
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  game.world.marker.t = 0; // lowest, weakest kick
  game.tap();
  stepUntil(game, () => game.phase === 'miss', 6);
  const miss = events.find((e) => e.n === 'miss').p;
  assert.ok(['short', 'post', 'over'].includes(miss.reason));
  assert.equal(miss.score, 0);
  const n = stepUntil(game, () => game.phase === 'over', 3);
  const secs = n * STEP;
  assert.ok(Math.abs(secs - CONFIG.timing.missDelay) < 0.05, `over after ${secs}s`);
  const go = events.find((e) => e.n === 'gameover').p;
  assert.equal(go.score, 0);
  assert.equal(go.canContinue, true);
  assert.equal(game.hud().canContinue, true);
  assert.ok(!events.some((e) => e.n === 'score'));
});

test('tap far above the band sails over or clangs', () => {
  const { game, events } = setup(4);
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  game.world.marker.t = 1;
  game.tap();
  stepUntil(game, () => game.phase === 'miss', 8);
  const miss = events.find((e) => e.n === 'miss').p;
  assert.ok(['over', 'post', 'short'].includes(miss.reason));
});

test('clock expiry -> miss {reason: clock}; clockLow fires first', () => {
  const { game, events } = setup(3);
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  const clock = game.hud().clock;
  assert.ok(clock >= CONFIG.difficulty.clock.start - 1e-9);
  stepUntil(game, () => game.phase === 'miss', clock + 1);
  const miss = events.find((e) => e.n === 'miss').p;
  assert.equal(miss.reason, 'clock');
  assert.ok(events.findIndex((e) => e.n === 'clockLow') < events.findIndex((e) => e.n === 'miss'));
  assert.equal(game.hud().clock, 0);
  stepUntil(game, () => game.phase === 'over', 2);
  assert.equal(events.find((e) => e.n === 'gameover').p.reason, 'clock');
});

test('continueRun works once per run, keeps score, resets streak', () => {
  const { game, events } = setup(5);
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  game.world.marker.t = game.world.shot.band.tBest;
  game.tap();
  stepUntil(game, () => game.phase === 'aim', 8);
  const score = game.hud().score;
  assert.ok(score >= 1);
  assert.equal(game.continueRun(), false, 'only in over');
  game.world.marker.t = 0;
  game.tap();
  stepUntil(game, () => game.phase === 'over', 8);
  const teeX = game.world.shot.teeX;
  assert.equal(game.continueRun(), true);
  assert.ok(events.some((e) => e.n === 'continue'));
  assert.equal(game.phase, 'intro');
  assert.equal(game.hud().score, score);
  assert.equal(game.hud().streak, 0);
  assert.equal(game.world.shot.teeX, teeX, 'same tee');
  stepUntil(game, () => game.phase === 'aim');
  assert.equal(game.world.ball.x, teeX);
  stepUntil(game, () => game.phase === 'over', 20); // let the clock run out
  const go = events.filter((e) => e.n === 'gameover').pop().p;
  assert.equal(go.canContinue, false);
  assert.equal(game.hud().canContinue, false);
  assert.equal(game.continueRun(), false, 'second continue refused');
  game.newRun();
  assert.equal(game.hud().score, 0);
  stepUntil(game, () => game.phase === 'aim');
  game.world.marker.t = 0;
  game.tap();
  stepUntil(game, () => game.phase === 'over', 8);
  assert.equal(game.hud().canContinue, true, 'newRun resets continues');
});

test('camera hard clamp keeps the ball on screen for t = 0 and t = 1 flights', () => {
  for (const vp of [[390, 844], [360, 640], [430, 932], [600, 700]]) {
    for (const t of [0, 1, 0.5]) {
      for (let seed = 1; seed <= 4; seed++) {
        const { game } = setup(seed * 17);
        game.setViewport(vp[0], vp[1]);
        game.newRun();
        stepUntil(game, () => game.phase === 'aim');
        game.world.marker.t = t;
        game.tap();
        for (let i = 0; i < 4 * CONFIG.sim.hz; i++) {
          game.step(STEP);
          if (game.phase === 'intro') break;
          assertBallVisible(game, `vp ${vp} t ${t} seed ${seed} step ${i} phase ${game.phase}`);
        }
      }
    }
  }
});

test('interpolation fields are kept (prev-step copies)', () => {
  const { game } = setup(9);
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  game.tap();
  const b = game.world.ball;
  game.step(STEP);
  assert.notEqual(b.px, b.x);
  game.step(STEP);
  const c = game.world.cam;
  for (const k of ['x', 'y', 'zoom', 'px', 'py', 'pzoom']) assert.ok(Number.isFinite(c[k]));
});

test('pickups are collected by flying through them and emit coin', () => {
  let found = false;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    const { game, events } = setup(seed);
    game.newRun();
    for (let shotN = 0; shotN < 12 && !found; shotN++) {
      stepUntil(game, () => game.phase === 'aim', 8);
      const pk = game.world.pickup;
      const shot = game.world.shot;
      // tStar is the nominal trajectory the pickup sits on.
      game.world.marker.t = pk ? shot.tStar : shot.band.tBest;
      game.tap();
      stepUntil(game, () => game.phase === 'settle' || game.phase === 'miss', 6);
      if (pk) {
        const coin = events.find((e) => e.n === 'coin');
        assert.ok(coin, 'coin event');
        assert.equal(coin.p.amount, CONFIG.pickups.value);
        assert.ok(game.world.pickup.collected);
        found = true;
      }
    }
  }
  assert.ok(found, 'no pickup encountered');
});

test('a throwing handler never breaks the simulation', () => {
  const { game } = setup(1);
  const orig = console.error;
  let logged = 0;
  console.error = () => { logged++; };
  try {
    game.on('runStart', () => { throw new Error('boom'); });
    game.on('shotStart', () => { throw new Error('boom'); });
    game.newRun();
    stepUntil(game, () => game.phase === 'aim');
  } finally {
    console.error = orig;
  }
  assert.ok(logged >= 2);
  const unsub = game.on('flick', () => {});
  unsub();
});

test('difficulty ramps with goals made (speed up, band narrower, distance longer)', () => {
  const { game, events } = setup(8);
  game.newRun();
  const starts = [];
  for (let i = 0; i < 30; i++) {
    stepUntil(game, () => game.phase === 'aim', 8);
    starts.push(events.filter((e) => e.n === 'shotStart').pop().p);
    game.world.marker.t = game.world.shot.band.tBest;
    game.tap();
    stepUntil(game, () => game.phase === 'intro' || game.phase === 'miss', 8);
  }
  assert.ok(starts[29].speed > starts[0].speed);
  assert.ok(starts[29].band.width < starts[0].band.width);
  assert.ok(starts[29].clock < starts[0].clock);
});

test('marker is frozen during intro and starts well outside the band', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { game } = setup(seed);
    game.newRun();
    for (let shotNo = 0; shotNo < 25; shotNo++) {
      assert.equal(game.phase, 'intro');
      const t0 = game.world.marker.t;
      const { band, speed } = game.world.shot;
      const gap = Math.max(0.08, speed * 0.2) - 1e-9;
      assert.ok(t0 < band.lo - gap || t0 > band.hi + gap, `seed ${seed} shot ${shotNo}: start ${t0} too close to band`);
      stepUntil(game, () => game.phase === 'aim', 3);
      assert.equal(game.world.marker.t, t0, 'marker must not move during intro');
      game.world.marker.t = band.tBest;
      game.tap();
      stepUntil(game, () => game.phase === 'intro' || game.phase === 'miss', 8);
      if (game.phase === 'miss') break;
    }
  }
});

test('a short miss that rolls into the post bounces off the stem (no pass-through)', async () => {
  const { solveShot, postColliders } = await import('../src/engine/physics.js');
  const { game, events } = setup(3);
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  // Repro from review: this shot + t = 0.15 lands short and rolls toward the stem.
  const shot = solveShot({ teeX: 0, made: 0, rng: makeRng(262) });
  const post = { x: shot.postX, bar: shot.bar, top: shot.top };
  post._cols = postColliders(post);
  const w = game.world;
  w.shot = shot;
  w.post = post;
  w.teeX = shot.teeX;
  w.marker.t = 0.15;
  assert.equal(game.tap(), true);
  const minD = R + CONFIG.physics.stemRadius - 0.01;
  let rolledNearStem = false;
  for (let i = 0; i < 6 / STEP; i++) {
    game.step(STEP);
    const b = w.ball;
    if (b.y <= R + 0.5) {
      const d = Math.abs(b.x - post.x);
      assert.ok(d >= minD, `ball overlapped the stem on the ground (d=${d.toFixed(2)})`);
      if (d < minD + 2) rolledNearStem = true;
    }
  }
  assert.ok(rolledNearStem || events.some((e) => e.n === 'bounce' && e.p.kind === 'stem'), 'scenario should reach the stem');
});
