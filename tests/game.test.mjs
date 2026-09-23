import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createGame, PHASES } from '../src/engine/game.js';
import { makeRng, postReach } from '../src/engine/physics.js';

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
  // Fresh attempt: the post stays on the end line, the new ball is teed d in front of it.
  const next = game.world.shot;
  assert.notEqual(next, shot);
  assert.ok(Math.abs(next.postX - shot.postX) < 1e-9, 'post stays on the end line');
  assert.ok(Math.abs(game.world.post.x - game.world.fieldEnd) < 1e-9);
  assert.ok(Math.abs(next.postX - next.teeX - next.d) < 1e-9, 'tee is d in front of the end line');
  assert.equal(game.world.ball.x, next.teeX);
  assert.equal(game.world.ball.y, R);
  assert.equal(game.world.swoop, null, 'swoop finished before aiming');
  assert.equal(game.world.oldBall, null, 'previous ball gone once aiming');
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
  const end = game.world.fieldEnd;
  const madeBefore = game.hud().made;
  assert.equal(game.continueRun(), true);
  assert.ok(events.some((e) => e.n === 'continue'));
  assert.equal(game.phase, 'intro');
  assert.equal(game.hud().score, score);
  assert.equal(game.hud().streak, 0);
  const cs = game.world.shot;
  assert.equal(cs.made, madeBefore, 'continue = fresh attempt at the same difficulty');
  assert.ok(Math.abs(cs.postX - end) < 1e-9, 'same end line');
  assert.ok(Math.abs(cs.postX - cs.teeX - cs.d) < 1e-9);
  const teeX = cs.teeX;
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
          // after the shot is resolved a ball may sail clean over the end-zone stands
          // ("out of the stadium"); the camera stops chasing it only then
          const w = game.world;
          const outX = w.post.x + CONFIG.field.standsOffset + CONFIG.field.standsDepth;
          if (w.ball.x - R > outX) {
            assert.ok(['miss', 'over', 'settle'].includes(game.phase), 'only a resolved shot can leave the stadium');
            continue;
          }
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

test('each shot is a fresh field-goal attempt on the same end line, in whole yards, getting longer', () => {
  const U = CONFIG.field.yard;
  for (let seed = 1; seed <= 4; seed++) {
    const { game, events } = setup(seed * 7);
    game.newRun();
    const end = game.world.fieldEnd;
    assert.ok(Number.isFinite(end));
    const yards = [];
    for (let i = 0; i < 40; i++) {
      stepUntil(game, () => game.phase === 'aim', 8);
      const w = game.world;
      const s = w.shot;
      assert.ok(Math.abs(s.postX - end) < 1e-9, 'post on the end line');
      assert.ok(Math.abs(w.post.x - end) < 1e-9);
      assert.equal(w.fieldEnd, end, 'end line never moves');
      assert.ok(Math.abs(s.d / U - Math.round(s.d / U)) < 1e-9, `d ${s.d} is whole yards`);
      assert.equal(w.yards, Math.round(s.d / U));
      assert.ok(w.yards >= 20 && w.yards <= 62, `attempt length ${w.yards} yd`);
      if (s.pickup) assert.ok(s.pickup.x > s.teeX && s.pickup.x < s.postX, 'pickup between tee and post');
      yards.push(w.yards);
      w.marker.t = s.band.tBest;
      game.tap();
      stepUntil(game, () => game.phase === 'intro' || game.phase === 'miss', 8);
      assert.equal(game.phase, 'intro', 'tBest always scores');
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    assert.ok(avg(yards.slice(-10)) > avg(yards.slice(0, 5)) + 8, `attempts get longer: ${yards.join(' ')}`);
    assert.equal(events.filter((e) => e.n === 'score').length, 40);
  }
});

test('camera swoop to the next attempt: timed, frozen clock + marker, taps ignored, lands on the aim frame', () => {
  const { game, events } = setup(11);
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  game.world.marker.t = game.world.shot.band.tBest;
  game.tap();
  stepUntil(game, () => game.phase === 'intro', 8);
  const w = game.world;
  assert.ok(w.swoop, 'swoop starts after a goal');
  assert.ok(w.oldBall, 'previous ball kept while the camera leaves it');
  assert.equal(w.ball.x, w.shot.teeX, 'fresh ball already teed up');
  assert.equal(w.freshBall, true);
  const t0 = w.marker.t;
  let n = 0;
  while (game.phase === 'intro') {
    assert.equal(game.tap(), false, 'taps ignored while swooping');
    assert.equal(w.marker.t, t0, 'marker frozen');
    assert.equal(game.hud().clock01, 1, 'clock frozen');
    game.step(STEP);
    n++;
    assert.ok(n < 5 / STEP);
  }
  const secs = n * STEP;
  const want = CONFIG.timing.swoopTime + CONFIG.timing.introTime;
  assert.ok(Math.abs(secs - want) < 0.03, `intro with swoop lasted ${secs}s (want ${want})`);
  assert.equal(game.phase, 'aim');
  assert.equal(w.swoop, null);
  assert.equal(w.oldBall, null);
  // The ball and the post are framed on screen when aiming starts.
  const vp = game.viewport;
  for (const [x, y] of [[w.shot.teeX, R], [w.shot.postX, w.shot.top]]) {
    const p = game.worldToScreen(x, y);
    assert.ok(p.x > 0 && p.x < vp.cssW && p.y > 0 && p.y < vp.cssH, `(${x}, ${y}) on screen at aim start`);
  }
  assert.equal(events.filter((e) => e.n === 'shotStart').length, 2);
});

test('newRun from the menu glides the ball (no swoop); from game over it swoops to a fresh ball', () => {
  const { game } = setup(21);
  game.idle();
  const end = game.world.fieldEnd;
  assert.equal(game.world.ball.x, 0);
  assert.ok(Math.abs(game.world.post.x - end) < 1e-9);
  game.newRun();
  assert.equal(game.world.swoop, null, 'menu -> play: ball glides onto the tee');
  assert.equal(game.world.fieldEnd, end, 'same field as the menu');
  stepUntil(game, () => game.phase === 'aim');
  game.world.marker.t = 1;
  game.tap();
  stepUntil(game, () => game.phase === 'over', 10);
  for (let i = 0; i < 120; i++) game.step(STEP);
  const old = { x: game.world.ball.x, y: game.world.ball.y };
  game.newRun();
  const far = Math.hypot(old.x - game.world.shot.teeX, old.y - R) > 120;
  assert.equal(!!game.world.swoop, far, 'swoop iff the old ball is away from the new tee');
  if (far) assert.deepEqual([game.world.oldBall.x, game.world.oldBall.y], [old.x, old.y], 'old ball fades where it lay');
  assert.equal(game.world.fieldEnd, end);
  stepUntil(game, () => game.phase === 'aim', 3);
  assert.equal(game.world.ball.x, game.world.shot.teeX);
});

test('net + stands sit past every pre-resolution rule, so the solver guarantees are untouched', () => {
  const F = CONFIG.field;
  const P = CONFIG.physics;
  assert.ok(F.netOffset - R > P.passMissMargin, 'net is past the pass-miss line');
  assert.ok(F.netOffset - R > postReach(CONFIG), 'net is past the post reach (goal resolves first)');
  assert.ok(F.standsOffset > F.netOffset);
  const topH = F.standsWallH + F.standsDepth * F.standsRise;
  const eye = F.tilt * F.camDist; // pseudo-3D eye height: seats above it would render upside down
  assert.ok(topH < eye, `stands top ${topH} below eye height ${eye}`);
});

test('after a goal the kicking net catches the ball and the next attempt follows quickly', () => {
  let worst = 0;
  let goals = 0;
  let nets = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const { game } = setup(seed * 29);
    game.on('net', () => nets++);
    game.newRun();
    for (let shot = 0; shot < 12; shot++) {
      stepUntil(game, () => game.phase === 'aim');
      const band = game.world.shot.band;
      game.world.marker.t = band.lo + (band.hi - band.lo) * (0.1 + 0.8 * ((shot * 7) % 10) / 10);
      assert.equal(game.tap(), true);
      let t = 0;
      let maxRel = -Infinity;
      while (game.phase !== 'intro') {
        assert.notEqual(game.phase, 'over', 'in-band taps always score');
        game.step(STEP);
        t += STEP;
        maxRel = Math.max(maxRel, game.world.ball.x - game.world.post.x);
        assert.ok(t < 4, 'goal -> next attempt within 4 s');
      }
      goals++;
      worst = Math.max(worst, t);
      assert.ok(maxRel < CONFIG.field.standsOffset, `ball stopped before the stands (${maxRel.toFixed(1)})`);
    }
  }
  assert.ok(nets >= goals * 0.8, `net catches most goals (${nets}/${goals})`);
  assert.ok(worst < 2.2, `shot -> swoop start at most ${worst.toFixed(2)} s`);
});

test('a ball dropping into the end-zone stands is caught by the crowd; one clearing the facade leaves the stadium', () => {
  const F = CONFIG.field;
  const { game } = setup(5);
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  game.world.marker.t = 0;
  game.tap();
  stepUntil(game, () => game.phase === 'miss', 6);
  const w = game.world;
  const b = w.ball;
  const sx = w.post.x + F.standsOffset;
  Object.assign(b, { x: sx + 120, y: 260, vx: 60, vy: 0, rolling: false, resting: false });
  stepUntil(game, () => b.resting, 4);
  const seat = F.standsWallH + (b.x - sx) * F.standsRise;
  assert.ok(b.x > sx && b.y >= seat, `caught in the seats at (${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
  assertBallVisible(game, 'caught ball on screen');
  // a low ball is stopped by the padded front wall
  Object.assign(b, { x: sx - 60, y: R + 2, vx: 400, vy: 0, rolling: false, resting: false });
  for (let i = 0; i < 60; i++) game.step(STEP);
  assert.ok(b.x <= sx - R + 1e-6, 'front wall stops a low ball');
  // a ball high over the top-row facade flies out of the stadium
  const back = sx + F.standsDepth;
  Object.assign(b, { x: back - 40, y: 700, vx: 500, vy: 100, rolling: false, resting: false });
  for (let i = 0; i < 60; i++) game.step(STEP);
  assert.ok(b.x > back, 'cleared the stands');
});

// ---------------------------------------------------------------- v2: FIELD GOAL + ENDLESS modes
const U = CONFIG.field.yard;

function setupMode(seed, mode) {
  const s = setup(seed);
  const extra = [];
  s.game.on('modeChange', (p) => extra.push(p));
  s.game.on('net', (p) => extra.push({ net: p }));
  if (mode) s.game.idle({ mode });
  return { ...s, extra };
}

/** Aim, tap at `t` (a function of the shot band), wait for the score / miss. Returns the phase. */
function kick(game, events, tOf, label) {
  stepUntil(game, () => game.phase === 'aim', 10);
  const b = game.world.shot.band;
  game.world.marker.t = tOf(b);
  const scores = events.filter((e) => e.n === 'score').length;
  assert.ok(game.tap(), label + ': tap accepted');
  stepUntil(game, () => events.filter((e) => e.n === 'score').length > scores || game.phase === 'miss', 8);
  return game.phase;
}

test('modes: default FIELD; idle({mode}) switches + emits modeChange only on change; newRun({mode}) too', () => {
  const { game, extra, events } = setupMode(1);
  game.idle();
  assert.equal(game.mode, 'field');
  assert.equal(game.world.mode, 'field');
  assert.ok(Number.isFinite(game.world.fieldEnd));
  game.idle({ mode: 'field' });
  assert.equal(extra.filter((e) => e.mode).length, 0, 'no modeChange without a change');
  game.idle({ mode: 'endless' });
  assert.deepEqual(extra.filter((e) => e.mode), [{ mode: 'endless' }]);
  assert.equal(game.world.mode, 'endless');
  assert.equal(game.world.fieldEnd, null);
  assert.equal(game.world.originX, 0);
  assert.equal(game.world.ball.x, 0);
  assert.equal(game.world.oldPost, null);
  assert.equal(game.phase, 'idle');
  game.idle({ mode: 'bogus' });
  assert.equal(game.mode, 'endless', 'unknown modes are ignored');
  game.newRun({ mode: 'field' });
  assert.equal(game.mode, 'field');
  assert.equal(extra.filter((e) => e.mode).length, 2);
  const rs = events.find((e) => e.n === 'runStart').p;
  assert.equal(rs.mode, 'field');
  assert.equal(rs.cut, false);
  assert.equal(game.hud().mode, 'field');
  assert.equal(game.hud().yards, 0);
  assert.ok(game.hud().attemptYards > 0);
});

test('ENDLESS: chained v1 mechanic - next tee = max(rest, post + 60), old post kept, yards counter', () => {
  const { game, events, extra } = setupMode(2, 'endless');
  game.newRun();
  assert.equal(game.world.mode, 'endless');
  assert.equal(game.hud().attemptYards, 0);
  let prevTee = game.world.teeX;
  assert.equal(prevTee, 0);
  for (let i = 0; i < 12; i++) {
    const post = { ...game.world.post };
    assert.notEqual(kick(game, events, (b) => b.tBest, 'shot ' + i), 'miss');
    stepUntil(game, () => game.world.teeX !== prevTee && game.phase === 'intro', 6);
    const w = game.world;
    assert.ok(w.teeX >= post.x + CONFIG.endless.nextTeeGap - 1e-9, 'tee is past the post it just cleared');
    assert.ok(w.teeX > prevTee, 'tees strictly advance');
    assert.ok(w.oldPost && Math.abs(w.oldPost.x - post.x) < 1e-9, 'old post kept on screen');
    assert.equal(w.fieldEnd, null);
    assert.equal(game.hud().yards, Math.floor((w.teeX - w.originX) / U + 1e-9));
    prevTee = w.teeX;
  }
  assert.ok(game.hud().yards > 100, 'yards ' + game.hud().yards);
  assert.equal(extra.filter((e) => e.net).length, 0, 'no kicking net in ENDLESS');
});

test('ENDLESS: no net / stands - a goal keeps flying past the net line; camera never releases the ball', () => {
  const { game, events } = setupMode(5, 'endless');
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  game.world.marker.t = game.world.shot.band.hi - 1e-3;
  game.tap();
  const post = game.world.post;
  let maxX = -Infinity;
  for (let i = 0; i < 1200 && game.phase !== 'intro'; i++) {
    game.step(STEP);
    maxX = Math.max(maxX, game.world.ball.x);
    if (game.phase === 'fly' || game.phase === 'settle') assertBallVisible(game, 'endless flight step ' + i);
  }
  assert.ok(events.some((e) => e.n === 'score'));
  assert.ok(maxX > post.x + CONFIG.field.netOffset + CONFIG.physics.ballRadius, 'ball went past the (absent) net line: ' + maxX);
  assert.equal(game.world.flight.netHit, false);
});

test('always beatable in BOTH modes: 60 shots at tBest / band edges never miss (8 seeds)', () => {
  const taps = [(b) => b.tBest, (b) => b.lo + 1e-3, (b) => b.hi - 1e-3];
  for (const mode of ['field', 'endless']) {
    for (let seed = 1; seed <= 8; seed++) {
      const { game, events } = setupMode(seed, mode);
      game.newRun({ mode });
      for (let i = 0; i < 60; i++) {
        const ph = kick(game, events, taps[i % 3], mode + ' seed ' + seed + ' shot ' + i);
        assert.notEqual(ph, 'miss', mode + ' seed ' + seed + ' shot ' + i + ' missed');
      }
      assert.equal(game.hud().made, 60, mode + ' seed ' + seed);
    }
  }
});

test('ENDLESS numeric stability: a shot teed ~50,000 u down the field still scores at tBest', () => {
  const { game, events } = setupMode(9, 'endless');
  game.newRun();
  kick(game, events, (b) => b.tBest, 'first');
  stepUntil(game, () => game.phase === 'settle', 6);
  const b = game.world.ball;
  b.x = b.px = 50000;
  b.y = b.py = CONFIG.physics.ballRadius;
  b.vx = b.vy = 0;
  b.rolling = false;
  b.resting = true;
  stepUntil(game, () => game.phase === 'intro', 3);
  assert.ok(game.world.teeX >= 50000);
  for (let i = 0; i < 3; i++) {
    assert.notEqual(kick(game, events, (bb) => bb.tBest, 'far ' + i), 'miss');
  }
  assert.ok(game.hud().yards > 6000);
});

test('ENDLESS continue: same tee, new shot at the same made; yards keep counting', () => {
  const { game, events } = setupMode(3, 'endless');
  game.newRun();
  kick(game, events, (b) => b.tBest, 'goal');
  stepUntil(game, () => game.phase === 'aim', 8);
  const tee = game.world.teeX;
  const yards = game.hud().yards;
  const made = game.hud().made;
  const shot = game.world.shot;
  game.world.marker.t = 0;
  game.tap();
  stepUntil(game, () => game.phase === 'over', 8);
  const go = events.find((e) => e.n === 'gameover').p;
  assert.equal(go.mode, 'endless');
  assert.equal(go.yards, yards);
  assert.ok(game.continueRun());
  assert.equal(game.world.teeX, tee);
  assert.notEqual(game.world.shot, shot);
  assert.equal(game.world.shot.made, made);
  assert.equal(game.hud().yards, yards);
  assert.equal(events.find((e) => e.n === 'continue').p.mode, 'endless');
  assert.notEqual(kick(game, events, (b) => b.tBest, 'after continue'), 'miss');
});

test('ENDLESS newRun from far down the field: camera cut (runStart.cut), ball back at x = 0', () => {
  const { game, events } = setupMode(4, 'endless');
  game.newRun();
  const first = events.find((e) => e.n === 'runStart').p;
  assert.equal(first.cut, false, 'from the menu tee: glide, no cut');
  for (let i = 0; i < 4; i++) kick(game, events, (b) => b.tBest, 'g' + i);
  stepUntil(game, () => game.phase === 'aim', 8);
  game.world.marker.t = 0;
  game.tap();
  stepUntil(game, () => game.phase === 'over', 8);
  assert.ok(game.world.ball.x > CONFIG.endless.cutDist);
  events.length = 0;
  game.newRun();
  const rs = events.find((e) => e.n === 'runStart').p;
  assert.equal(rs.cut, true);
  assert.equal(rs.mode, 'endless');
  assert.equal(game.world.teeX, 0);
  assert.equal(game.world.ball.x, 0);
  assert.equal(game.world.oldPost, null);
  assert.equal(game.hud().yards, 0);
  assert.equal(game.hud().made, 0);
});

test('FIELD gameover carries mode + yards (0)', () => {
  const { game, events } = setupMode(6, 'field');
  game.newRun();
  stepUntil(game, () => game.phase === 'aim');
  game.world.marker.t = 0;
  game.tap();
  stepUntil(game, () => game.phase === 'over', 8);
  const go = events.find((e) => e.n === 'gameover').p;
  assert.equal(go.mode, 'field');
  assert.equal(go.yards, 0);
});
