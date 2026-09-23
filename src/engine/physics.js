// Flick Goal — physics, rail mapping and the sweet-band solver (pure, no DOM).
//
// World: y-UP, ground at y = 0, ball radius R rests at y = R.
// The SAME fixed-step function (stepFlight) drives both the live game and the
// solver, at the same dt (1 / cfg.sim.hz). A band measured here is therefore
// exact: any tap inside [band.lo, band.hi] is a clean goal in the real game.

import { CONFIG } from '../config.js';
import { bandWidth, speed, shotClock, distance, gap, barRange, bandAlpha } from './difficulty.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;

/** mulberry32 seeded PRNG. Returns () => float in [0, 1). */
export function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rail position t in [0,1] -> launch {angle, power}. Angle and power are
 * COUPLED and both increase with t (t=0 low/short, t=1 high/long).
 * (thetaC, powerC) is the exact window-center solution at t = tStar; `s`
 * scales how fast the trajectory changes along the rail (solved per shot).
 */
export function mapRail(shot, t, cfg = CONFIG) {
  const m = cfg.mapping;
  const u = (t - shot.tStar) * shot.s;
  const angle = clamp(shot.thetaC + u * m.kTheta, m.thetaMinDeg * DEG, m.thetaMaxDeg * DEG);
  const power = clamp(shot.powerC * (1 + u * m.kPower), m.powerMinFrac * shot.powerC, m.powerMaxFrac * shot.powerC);
  return { angle, power };
}

export function launchVelocity(angle, power) {
  return { vx: power * Math.cos(angle), vy: power * Math.sin(angle) };
}

/** Analytic height of the ballistic arc at x = xTarget, or null if it never gets there. */
export function crossingHeight(x0, y0, angle, power, xTarget, g) {
  const vx = power * Math.cos(angle);
  if (vx <= 1) return null;
  const tau = (xTarget - x0) / vx;
  if (tau < 0) return null;
  return y0 + power * Math.sin(angle) * tau - 0.5 * g * tau * tau;
}

/** Exact constant-acceleration step (no integration drift vs. the analytic arc). */
export function stepBall(ball, dt, g) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt - 0.5 * g * dt * dt;
  ball.vy -= g * dt;
  return ball;
}

/**
 * Solid parts of a field-goal post at x = P (capsules; circles have a == b).
 * These are ALWAYS active regardless of ball height (fixes the prototype's
 * crossbar-gap bug). Uprights between bar and top are not solid: the ball
 * passes between them in depth.
 */
export function postColliders(post, cfg = CONFIG) {
  const p = cfg.physics;
  const x = post.x;
  const o = p.uprightOffset;
  return [
    { kind: 'bar', ax: x - p.crossbarHalf, ay: post.bar, bx: x + p.crossbarHalf, by: post.bar, r: p.crossbarRadius },
    { kind: 'tip', ax: x - o, ay: post.top, bx: x - o, by: post.top, r: p.tipRadius },
    { kind: 'tip', ax: x + o, ay: post.top, bx: x + o, by: post.top, r: p.tipRadius },
    { kind: 'stem', ax: x, ay: 0, bx: x, by: post.bar, r: p.stemRadius },
  ];
}

/**
 * Ball vs capsule. Pushes the ball out along the contact normal and reflects the
 * normal velocity component (tangential kept) if approaching.
 * @returns {null | {kind, nx, ny, impact}} impact = approach speed along the normal (u/s)
 */
export function collideCapsule(ball, c, ballR, restitution) {
  const abx = c.bx - c.ax;
  const aby = c.by - c.ay;
  const ab2 = abx * abx + aby * aby;
  let u = ab2 > 0 ? ((ball.x - c.ax) * abx + (ball.y - c.ay) * aby) / ab2 : 0;
  u = clamp(u, 0, 1);
  const cx = c.ax + abx * u;
  const cy = c.ay + aby * u;
  const dx = ball.x - cx;
  const dy = ball.y - cy;
  const rr = ballR + c.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return null;
  let nx;
  let ny;
  const d = Math.sqrt(d2);
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else {
    // Degenerate: centre exactly on the segment — push back against the motion.
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 1e-9) { nx = -ball.vx / sp; ny = -ball.vy / sp; } else { nx = 0; ny = 1; }
  }
  ball.x = cx + nx * rr;
  ball.y = cy + ny * rr;
  const vn = ball.vx * nx + ball.vy * ny;
  let impact = 0;
  if (vn < 0) {
    ball.vx -= (1 + restitution) * vn * nx;
    ball.vy -= (1 + restitution) * vn * ny;
    impact = -vn;
  }
  return { kind: c.kind, nx, ny, impact };
}

/**
 * ONE fixed simulation step used by BOTH game.js and the solver.
 * Integrates, resolves post collisions and reports a left->right crossing of x = post.x.
 * @returns {{collisions: Array<{kind, impact, nx, ny}>, crossed: null | {y}}}
 */
export function stepFlight(ball, post, dt, cfg = CONFIG) {
  const p = cfg.physics;
  const x0 = ball.x;
  const y0 = ball.y;
  stepBall(ball, dt, p.gravity);
  const collisions = [];
  const cols = post ? (post._cols || postColliders(post, cfg)) : [];
  for (let i = 0; i < cols.length; i++) {
    const hit = collideCapsule(ball, cols[i], p.ballRadius, p.restitutionPost);
    if (hit) collisions.push(hit);
  }
  let crossed = null;
  if (post && x0 < post.x && ball.x >= post.x) {
    const span = ball.x - x0;
    const u = span > 1e-12 ? (post.x - x0) / span : 1;
    crossed = { y: lerp(y0, ball.y, u) };
  }
  return { collisions, crossed };
}

function postOf(shot) {
  return { x: shot.postX, bar: shot.bar, top: shot.top };
}

/**
 * Horizontal reach of the post's solid parts: once the ball centre is more than
 * this far past post.x, nothing on the post can touch it any more.
 */
export function postReach(cfg = CONFIG) {
  const p = cfg.physics;
  return Math.max(p.uprightOffset, p.crossbarHalf) + Math.max(p.tipRadius, p.crossbarRadius) + p.ballRadius;
}

function simulateWithPost(shot, post, t, cfg) {
  const p = cfg.physics;
  const R = p.ballRadius;
  const dt = 1 / cfg.sim.hz;
  const reach = postReach(cfg);
  const { angle, power } = mapRail(shot, t, cfg);
  const v = launchVelocity(angle, power);
  const ball = { x: shot.teeX, y: R, vx: v.vx, vy: v.vy };
  let collided = false;
  let crossY = null;
  let time = 0;
  const maxSteps = Math.ceil(p.maxFlightTime * cfg.sim.hz) + 1;
  for (let i = 0; i < maxSteps; i++) {
    const r = stepFlight(ball, post, dt, cfg);
    time += dt;
    if (r.collisions.length) collided = true;
    if (crossY === null && r.crossed) {
      crossY = r.crossed.y;
      if (!(crossY > shot.bar && crossY < shot.top)) return { goal: false, clean: false, crossY, time };
    }
    if (crossY !== null) {
      // A goal is CLEAN only if the ball clears the whole post untouched
      // (a clang off the near upright right after the plane is still a doink).
      if (collided) return { goal: true, clean: false, crossY, time };
      if (ball.x > post.x + reach || ball.y <= R) return { goal: true, clean: true, crossY, time };
    } else if (ball.y <= R) {
      break;
    }
  }
  return { goal: crossY !== null, clean: false, crossY, time };
}

/**
 * Simulate a flick from (shot.teeX, R) at rail position t with the exact game
 * step. goal = crossed x = postX (left->right) with bar < y < top; clean = goal
 * and no post contact until the ball is past the post's reach (game.js uses the
 * identical rule for DOINK vs clean). Stops once resolved, on the ground, or at
 * maxFlightTime.
 * @returns {{goal, clean, crossY, time}}
 */
export function simulateShot(shot, t, cfg = CONFIG) {
  const post = postOf(shot);
  post._cols = postColliders(post, cfg);
  return simulateWithPost(shot, post, t, cfg);
}

function segDist2(px, py, c) {
  const abx = c.bx - c.ax;
  const aby = c.by - c.ay;
  const ab2 = abx * abx + aby * aby;
  let u = ab2 > 0 ? ((px - c.ax) * abx + (py - c.ay) * aby) / ab2 : 0;
  u = clamp(u, 0, 1);
  const dx = px - (c.ax + abx * u);
  const dy = py - (c.ay + aby * u);
  return dx * dx + dy * dy;
}

/**
 * Continuous clearance test for the solver: does the ideal parabola for rail t
 * cross the goal window while staying strictly clear (by `clearMargin`) of every
 * post collider until it is past the post's reach?
 *
 * Why: stepBall is exact, so every discrete game position lies ON this parabola.
 * If the whole parabola is clear, no fixed step can ever register a contact, so
 * the live game is guaranteed a clean goal. (The discrete sim alone is slightly
 * non-monotone within ~1u of grazing a tip, which could leave hairline holes.)
 */
export function pathClear(shot, t, cfg = CONFIG, cols = null) {
  const p = cfg.physics;
  const R = p.ballRadius;
  const g = p.gravity;
  const { angle, power } = mapRail(shot, t, cfg);
  const vx = power * Math.cos(angle);
  const vy = power * Math.sin(angle);
  if (vx <= 1) return false;
  const P = shot.postX;
  const tauP = (P - shot.teeX) / vx;
  const h = R + vy * tauP - 0.5 * g * tauP * tauP;
  if (!(h > shot.bar && h < shot.top)) return false;
  const colliders = cols || postColliders({ x: P, bar: shot.bar, top: shot.top }, cfg);
  const margin = (cfg.mapping.clearMargin ?? 0.25);
  const reach = postReach(cfg) + 2;
  const x0 = Math.max(shot.teeX, P - reach);
  const x1 = P + reach; // the sim resolves "clean" once the ball is past postX + postReach
  const dx = cfg.mapping.clearStep ?? 0.5;
  for (let x = x0; x <= x1 + 1e-9; x += dx) {
    const tau = (x - shot.teeX) / vx;
    const y = R + vy * tau - 0.5 * g * tau * tau;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const rr = R + c.r + margin;
      if (segDist2(x, y, c) <= rr * rr) return false;
    }
  }
  return true;
}

/**
 * Measure the sweet band of a shot from the real physics (SPEC §6.3).
 * Edges are refined on the continuous clearance predicate (pathClear), and the
 * interior is cross-checked with the exact discrete simulation.
 * @returns {null | {lo, hi, width, tBest, perfLo, perfHi}}
 */
export function measureBand(shot, cfg = CONFIG) {
  const m = cfg.mapping;
  const p = cfg.physics;
  const R = p.ballRadius;
  const g = p.gravity;
  const N = m.samples;
  const hc = (shot.bar + shot.top) / 2;
  const hLo = shot.bar + R + m.analyticPad;
  const hHi = shot.top - R - m.analyticPad;
  const post = postOf(shot);
  post._cols = postColliders(post, cfg);
  const clean = (t) => pathClear(shot, t, cfg, post._cols);
  const simClean = (t) => simulateWithPost(shot, post, t, cfg).clean;

  // 1. Analytic prefilter over the rail.
  const hs = new Float64Array(N + 1);
  const ok = new Uint8Array(N + 1);
  let iBest = -1;
  let bestErr = Infinity;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const { angle, power } = mapRail(shot, t, cfg);
    const h = crossingHeight(shot.teeX, R, angle, power, shot.postX, g);
    if (h === null) { hs[i] = NaN; continue; }
    hs[i] = h;
    ok[i] = h >= hLo && h <= hHi ? 1 : 0;
    const e = Math.abs(h - hc);
    if (e < bestErr) { bestErr = e; iBest = i; }
  }
  if (iBest < 0 || !ok[iBest]) return null;
  const tBest = iBest / N;
  if (!clean(tBest) || !simClean(tBest)) return null;

  // 2. Contiguous analytic run around the best sample.
  let a = iBest;
  while (a > 0 && ok[a - 1]) a--;
  let b = iBest;
  while (b < N && ok[b + 1]) b++;

  // 3. Refine each edge by bisection on the real simulation predicate.
  const step = 1 / N;
  const findBad = (t0, dir) => {
    // Walk outward from the analytic edge until the sim is NOT clean (or the rail ends).
    let t = clamp(t0, 0, 1);
    for (let k = 0; k < 60; k++) {
      if (!clean(t)) return t;
      if ((dir < 0 && t <= 0) || (dir > 0 && t >= 1)) return null; // clean to the rail end
      t = clamp(t + dir * step, 0, 1);
    }
    return null;
  };
  const bisect = (good, bad) => {
    for (let k = 0; k < m.bisectIters; k++) {
      const mid = (good + bad) / 2;
      if (clean(mid)) good = mid; else bad = mid;
    }
    return good;
  };
  const badLo = findBad((a - 1) / N, -1);
  const lo = badLo === null ? 0 : bisect(tBest, badLo);
  const badHi = findBad((b + 1) / N, 1);
  const hi = badHi === null ? 1 : bisect(tBest, badHi);
  if (!(hi > lo) || !simClean(lo) || !simClean(hi)) return null;

  // 4. Interior verification.
  for (let j = 1; j <= m.interiorChecks; j++) {
    const t = lo + ((hi - lo) * j) / (m.interiorChecks + 1);
    if (!clean(t) || !simClean(t)) return null;
  }

  // 5. Perfect sub-band (analytic |h - hc| <= perfectFrac * gap/2) around tBest.
  const pTol = cfg.scoring.perfectFrac * (shot.top - shot.bar) / 2;
  const isPerf = (i) => Number.isFinite(hs[i]) && Math.abs(hs[i] - hc) <= pTol;
  let pa = iBest;
  while (pa > 0 && isPerf(pa - 1)) pa--;
  let pb = iBest;
  while (pb < N && isPerf(pb + 1)) pb++;
  const perfLo = clamp(pa / N, lo, hi);
  const perfHi = clamp(pb / N, lo, hi);

  return { lo, hi, width: hi - lo, tBest, perfLo, perfHi };
}

function buildShot(teeX, made, d, bar, gp, thetaC, powerC, tStar, cfg) {
  const R = cfg.physics.ballRadius;
  const g = cfg.physics.gravity;
  const vy = powerC * Math.sin(thetaC);
  return {
    teeX, teeY: R, postX: teeX + d, bar, top: bar + gp, gap: gp, d,
    thetaC, powerC, tStar, s: cfg.mapping.s0,
    band: null,
    targetWidth: bandWidth(made, cfg), speed: speed(made, cfg), clock: 0, bandAlpha: bandAlpha(made, cfg),
    apex: R + (vy * vy) / (2 * g), pickup: null, made, fallback: false,
  };
}

function solvePower(d, hc, thetaC, cfg) {
  const R = cfg.physics.ballRadius;
  const g = cfg.physics.gravity;
  const c = Math.cos(thetaC);
  const den = 2 * c * c * (d * Math.tan(thetaC) - (hc - R));
  if (den <= 0) return null;
  return Math.sqrt((g * d * d) / den);
}

function iterateScale(shot, W, cfg) {
  const m = cfg.mapping;
  shot.s = m.s0;
  for (let i = 0; i < m.iterations; i++) {
    const b = measureBand(shot, cfg);
    if (!b) break;
    shot.s *= b.width / W;
  }
  return measureBand(shot, cfg);
}

function finishShot(shot, b, rng, cfg) {
  const dcfg = cfg.difficulty;
  const v = shot.speed;
  shot.band = b;
  // True worst-case wait on a ping-pong rail is 2*max(lo, 1-hi)/v (SPEC §6.2).
  const worst = dcfg.reaction + (2 * Math.max(b.lo, 1 - b.hi)) / v + b.width / v + dcfg.clockMargin;
  shot.clock = Math.max(shotClock(shot.made, cfg), worst);
  const pk = cfg.pickups;
  shot.pickup = null;
  if (shot.made >= pk.fromShot && rng() < pk.chance) {
    const f = lerp(pk.pathFracMin, pk.pathFracMax, rng());
    const x = shot.teeX + shot.d * f;
    const y = crossingHeight(shot.teeX, shot.teeY, shot.thetaC, shot.powerC, x, cfg.physics.gravity);
    if (y !== null && y > shot.teeY + pk.radius) shot.pickup = { x, y, value: pk.value };
  }
  return shot;
}

/**
 * Generate a shot that is guaranteed hittable (SPEC §6.2): the physics band has
 * width ~W(made), sits fully inside the rail, and its dwell is >= dwellMin.
 * Always returns a Shot.
 */
export function solveShot({ teeX = 0, made = 0, rng = Math.random } = {}, cfg = CONFIG) {
  const m = cfg.mapping;
  const dcfg = cfg.difficulty;
  const R = cfg.physics.ballRadius;
  const W = bandWidth(made, cfg);
  const v = speed(made, cfg);
  const br = barRange(made, cfg);
  const gp = gap(made, cfg);

  for (let tries = 0; tries < m.maxTries; tries++) {
    const d = distance(made, cfg) + (rng() * 2 - 1) * dcfg.distance.jitter;
    const bar = br.min + rng() * (br.max - br.min);
    const top = bar + gp;
    const hc = (bar + top) / 2;
    const thetaC = lerp(m.thetaCMinDeg, m.thetaCMaxDeg, rng()) * DEG;
    const powerC = solvePower(d, hc, thetaC, cfg);
    if (powerC === null || powerC < m.powerCMin || powerC > m.powerCMax) continue;
    const vy = powerC * Math.sin(thetaC);
    const apex = R + (vy * vy) / (2 * cfg.physics.gravity);
    if (apex > m.apexMax) continue;
    const tStar = lerp(W / 2 + m.tStarEdge, 1 - W / 2 - m.tStarEdge, rng());
    const shot = buildShot(teeX, made, d, bar, gp, thetaC, powerC, tStar, cfg);
    const b = iterateScale(shot, W, cfg);
    if (
      b &&
      b.width >= W * m.widthTolLo && b.width <= W * m.widthTolHi &&
      b.lo >= m.bandLimit && b.hi <= 1 - m.bandLimit &&
      b.width / v >= dcfg.dwellMin
    ) {
      return finishShot(shot, b, rng, cfg);
    }
  }

  // Fallback (never expected; asserted by tests): a known-friendly layout.
  const d = dcfg.distance.start;
  const gp0 = dcfg.gap.start;
  const bar = dcfg.barHeight.min;
  const thetaC = 45 * DEG;
  const powerC = solvePower(d, bar + gp0 / 2, thetaC, cfg);
  const shot = buildShot(teeX, made, d, bar, gp0, thetaC, powerC, 0.5, cfg);
  shot.fallback = true;
  let b = iterateScale(shot, W, cfg);
  if (!(b && b.width >= W * 0.8 && b.width <= W * 1.3)) {
    shot.s = m.s0;
    b = measureBand(shot, cfg);
  }
  if (!b) b = { lo: 0.4, hi: 0.6, width: 0.2, tBest: 0.5, perfLo: 0.45, perfHi: 0.55 };
  return finishShot(shot, b, rng, cfg);
}
