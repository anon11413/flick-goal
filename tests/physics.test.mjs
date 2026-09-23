import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import {
  makeRng, mapRail, launchVelocity, crossingHeight, stepBall, postColliders, collideCapsule,
  stepFlight, simulateShot, measureBand, solveShot, pathClear,
} from '../src/engine/physics.js';
import { bandWidth, speed } from '../src/engine/difficulty.js';

const R = CONFIG.physics.ballRadius;
const g = CONFIG.physics.gravity;
const M = CONFIG.mapping;
const DC = CONFIG.difficulty;

test('makeRng is deterministic and in [0,1)', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(makeRng(1)(), makeRng(2)());
});

test('stepBall matches the analytic parabola to 1e-6 after 1 s', () => {
  const ball = { x: 0, y: R, vx: 400, vy: 900 };
  const dt = 1 / CONFIG.sim.hz;
  for (let i = 0; i < CONFIG.sim.hz; i++) stepBall(ball, dt, g);
  assert.ok(Math.abs(ball.x - 400) < 1e-6);
  assert.ok(Math.abs(ball.y - (R + 900 - 0.5 * g)) < 1e-6);
  assert.ok(Math.abs(ball.vy - (900 - g)) < 1e-6);
});

test('crossingHeight agrees with integration and rejects vertical shots', () => {
  const ang = 0.8;
  const pw = 900;
  const v = launchVelocity(ang, pw);
  const ball = { x: 0, y: R, vx: v.vx, vy: v.vy };
  const dt = 1 / CONFIG.sim.hz;
  for (let i = 0; i < 30; i++) stepBall(ball, dt, g);
  assert.ok(Math.abs(crossingHeight(0, R, ang, pw, ball.x, g) - ball.y) < 1e-6);
  assert.equal(crossingHeight(0, R, Math.PI / 2, 900, 100, g), null);
});

test('mapRail couples angle and power, both increasing with t', () => {
  const shot = { tStar: 0.5, s: 2, thetaC: 0.8, powerC: 900 };
  const a = mapRail(shot, 0.3);
  const b = mapRail(shot, 0.5);
  const c = mapRail(shot, 0.7);
  assert.ok(a.angle < b.angle && b.angle < c.angle);
  assert.ok(a.power < b.power && b.power < c.power);
  assert.equal(b.angle, 0.8);
  assert.equal(b.power, 900);
  const lo = mapRail({ ...shot, s: 100 }, 0);
  assert.ok(lo.angle >= (M.thetaMinDeg * Math.PI) / 180 - 1e-12);
  assert.ok(lo.power >= M.powerMinFrac * 900 - 1e-9);
});

test('crossbar collides for a ball arriving at y = bar from ANY direction (gap-bug regression)', () => {
  const post = { x: 500, bar: 120, top: 280 };
  const cols = postColliders(post);
  assert.equal(cols.length, 4);
  assert.deepEqual(cols.map((c) => c.kind).sort(), ['bar', 'stem', 'tip', 'tip']);
  const dt = 1 / CONFIG.sim.hz;
  const reach = R + CONFIG.physics.crossbarRadius;
  for (let deg = 0; deg < 360; deg += 15) {
    if (deg === 270) continue; // straight up from below is the stem's job (covered next)
    const a = (deg * Math.PI) / 180;
    const start = reach + 2;
    const ball = { x: post.x + Math.cos(a) * start, y: post.bar + Math.sin(a) * start, vx: 0, vy: 0 };
    const sp = 600;
    ball.vx = -Math.cos(a) * sp;
    ball.vy = -Math.sin(a) * sp + (g * dt) / 2; // cancel gravity drift over the step
    const r = stepFlight(ball, post, dt);
    const kinds = r.collisions.map((c) => c.kind);
    assert.ok(kinds.includes('bar') || kinds.includes('stem'), `no hit from ${deg}deg: ${kinds}`);
    if (deg !== 255 && deg !== 285) assert.ok(kinds.includes('bar'), `no bar hit from ${deg}deg: ${kinds}`);
    assert.ok(r.collisions.some((c) => c.impact > 0), `no impact from ${deg}deg`);
  }
  // A ball at exactly bar height beside the bar end is solid (the old bug disabled it by ball y).
  const side = { x: post.x - 11 - reach + 1, y: post.bar, vx: 300, vy: 0 };
  const hit = collideCapsule(side, cols[0], R, 0.5);
  assert.ok(hit && hit.kind === 'bar' && hit.impact > 0);
  assert.ok(side.vx < 0, 'reflected');
  // Falling onto the bar from above bounces up.
  const top = { x: post.x, y: post.bar + reach + 1, vx: 50, vy: -400 };
  const r2 = stepFlight(top, post, dt);
  assert.ok(r2.collisions.some((c) => c.kind === 'bar'));
  assert.ok(top.vy > 0);
});

test('collideCapsule pushes out and keeps tangential velocity', () => {
  const c = { kind: 'tip', ax: 0, ay: 0, bx: 0, by: 0, r: 5 };
  const ball = { x: 0, y: 18, vx: 100, vy: -200 };
  const hit = collideCapsule(ball, c, R, 0.5);
  assert.ok(hit);
  assert.ok(Math.abs(ball.y - (R + 5)) < 1e-9);
  assert.equal(ball.vx, 100);
  assert.ok(Math.abs(ball.vy - 100) < 1e-9);
  assert.equal(collideCapsule({ x: 0, y: 40, vx: 0, vy: 0 }, c, R, 0.5), null);
});

test('stepFlight reports a left-to-right crossing with interpolated height', () => {
  const post = { x: 100, bar: 50, top: 200 };
  const ball = { x: 95, y: 120, vx: 1200, vy: 0 };
  const r = stepFlight(ball, post, 1 / CONFIG.sim.hz);
  assert.ok(r.crossed);
  assert.ok(Math.abs(r.crossed.y - 120) < 0.2);
  const back = { x: 105, y: 120, vx: -1200, vy: 0 };
  assert.equal(stepFlight(back, post, 1 / CONFIG.sim.hz).crossed, null);
});

const MADES = [0, 1, 2, 5, 10, 20, 40, 80, 200];

function checkShot(shot, made, label) {
  const b = shot.band;
  const W = bandWidth(made);
  const v = speed(made);
  assert.equal(shot.fallback, false, `${label}: fallback`);
  assert.ok(b.width >= W * M.widthTolLo - 1e-9, `${label}: width ${b.width} < W ${W}`);
  assert.ok(b.width <= W * M.widthTolHi + 1e-9, `${label}: width ${b.width} too wide vs ${W}`);
  assert.ok(b.width / v >= DC.dwellMin, `${label}: dwell`);
  assert.ok(b.lo >= M.bandLimit && b.hi <= 1 - M.bandLimit, `${label}: band limits`);
  assert.ok(b.perfLo >= b.lo && b.perfHi <= b.hi && b.perfLo <= b.tBest && b.tBest <= b.perfHi, `${label}: perfect band`);
  assert.equal(simulateShot(shot, b.tBest).clean, true, `${label}: tBest`);
  assert.equal(simulateShot(shot, b.lo).clean, true, `${label}: lo edge`);
  assert.equal(simulateShot(shot, b.hi).clean, true, `${label}: hi edge`);
  assert.equal(simulateShot(shot, b.lo + 1e-3).clean, true, `${label}: lo+`);
  assert.equal(simulateShot(shot, b.hi - 1e-3).clean, true, `${label}: hi-`);
  assert.equal(simulateShot(shot, b.lo - 0.02).clean, false, `${label}: lo-0.02`);
  assert.equal(simulateShot(shot, b.hi + 0.02).clean, false, `${label}: hi+0.02`);
  const worst = DC.reaction + (2 * Math.max(b.lo, 1 - b.hi)) / v + b.width / v;
  assert.ok(shot.clock >= worst, `${label}: clock ${shot.clock} < ${worst}`);
  assert.ok(shot.clock >= DC.reaction + 1 / v + DC.dwellMin, `${label}: MATH.md clock`);
  assert.ok(Math.abs(shot.postX - shot.teeX - shot.d) < 1e-9);
  assert.ok(Math.abs(shot.top - shot.bar - shot.gap) < 1e-9);
  if (shot.pickup) {
    assert.ok(shot.pickup.x > shot.teeX && shot.pickup.x < shot.postX);
    assert.ok(shot.pickup.y > R);
  }
}

test('solveShot: 2000+ seeded shots across made in [0,200] are all hittable, never fallback', () => {
  let count = 0;
  for (let seed = 0; seed < 230; seed++) {
    for (const made of MADES) {
      const rng = makeRng(seed * 7919 + made);
      const teeX = (seed % 5) * 1234.5;
      const shot = solveShot({ teeX, made, rng });
      checkShot(shot, made, `seed ${seed} made ${made}`);
      count++;
    }
  }
  assert.ok(count >= 2000, `ran ${count}`);
});

test('solveShot for every n in 0..200: band >= W(n) and scores with the real collision code', () => {
  for (let n = 0; n <= 200; n++) {
    for (const seed of [11, 222, 3333]) {
      const shot = solveShot({ teeX: 0, made: n, rng: makeRng(seed + n * 101) });
      checkShot(shot, n, `n ${n} seed ${seed}`);
    }
  }
});

test('the whole band is clean: dense scan finds no holes', () => {
  for (let seed = 0; seed < 25; seed++) {
    for (const made of MADES) {
      const shot = solveShot({ teeX: 0, made, rng: makeRng(90000 + seed * 13 + made) });
      const b = shot.band;
      const N = 300;
      for (let i = 0; i <= N; i++) {
        const t = b.lo + ((b.hi - b.lo) * i) / N;
        assert.equal(simulateShot(shot, t).clean, true, `hole at t=${t} seed ${seed} made ${made}`);
      }
    }
  }
});

test('pathClear implies a clean discrete simulation (continuous clearance guarantee)', () => {
  const rng = makeRng(5);
  let checked = 0;
  for (let k = 0; k < 40; k++) {
    const shot = solveShot({ teeX: 0, made: Math.floor(rng() * 120), rng });
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      if (pathClear(shot, t)) {
        checked++;
        assert.equal(simulateShot(shot, t).clean, true);
      }
    }
  }
  assert.ok(checked > 100);
});

test('measureBand is reproducible for a solved shot', () => {
  const shot = solveShot({ teeX: 0, made: 3, rng: makeRng(77) });
  const b = measureBand(shot);
  assert.ok(Math.abs(b.lo - shot.band.lo) < 1e-12 && Math.abs(b.hi - shot.band.hi) < 1e-12);
});

test('rail ends miss and the extreme arc stays within camera-safe heights', () => {
  for (let seed = 0; seed < 50; seed++) {
    const shot = solveShot({ teeX: 0, made: seed * 3, rng: makeRng(seed) });
    assert.equal(simulateShot(shot, 0).clean, false);
    assert.equal(simulateShot(shot, 1).clean, false);
    const hi = mapRail(shot, 1);
    const apex = R + (hi.power * Math.sin(hi.angle)) ** 2 / (2 * g);
    assert.ok(apex < 1100, `apex ${apex}`);
    assert.ok(shot.apex <= M.apexMax);
  }
});

test('solveShot distances are whole yards (tee sits on a yard mark) and read 20-60 yd', async () => {
  const { yardsOf } = await import('../src/engine/physics.js');
  const U = CONFIG.field.yard;
  for (const made of [0, 5, 20, 60, 200]) {
    for (let seed = 0; seed < 12; seed++) {
      const shot = solveShot({ teeX: 0, made, rng: makeRng(5000 + seed * 7 + made) });
      const yd = shot.d / U;
      assert.ok(Math.abs(yd - Math.round(yd)) < 1e-9, `d ${shot.d}`);
      assert.equal(yardsOf(shot.d), Math.round(yd));
      assert.ok(yardsOf(shot.d) >= 20 && yardsOf(shot.d) <= 62, `${yardsOf(shot.d)} yd`);
      assert.equal(shot.fallback, false);
    }
  }
});
