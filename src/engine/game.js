// Flick Goal — run state machine, camera and gameplay events (pure, no DOM).
//
// Phases: idle | intro | aim | fly | settle | miss | over  (SPEC §5)
// The shell calls step(1 / CONFIG.sim.hz) from a fixed-timestep loop; the engine
// never reads wall-clock time. All flight physics uses physics.stepFlight at the
// same dt the solver used, so a tap inside the measured band always scores.

import { CONFIG } from '../config.js';
import { solveShot, mapRail, launchVelocity, stepFlight, postColliders, postReach } from './physics.js';

export const PHASES = ['idle', 'intro', 'aim', 'fly', 'settle', 'miss', 'over'];

/** Resting orientation of the ball on the tee (world radians, CCW, y-up). */
export const TEE_ROT = 1.15;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

export function createGame({ rng = Math.random, cfg = CONFIG } = {}) {
  const P = cfg.physics;
  const TM = cfg.timing;
  const V = cfg.view;
  const R = P.ballRadius;
  const reach = postReach(cfg);
  const listeners = new Map();

  // ---- viewport ----
  let cssW = 390;
  let cssH = 844;
  let k0 = cssW / V.worldWidth;
  let viewportSet = false;

  // ---- run state ----
  let phase = 'idle';
  let score = 0;
  let made = 0;
  let streak = 0;
  let coinsRun = 0;
  let perfects = 0;
  let bestStreak = 0;
  let continuesUsed = 0;
  let startMade = 0; // dev "start round": goals pre-counted at run start (0 = normal run)
  let clock = 0;
  let clockMax = 0;
  let clockLowSent = false;
  let missReason = null;
  let settleT = 0;
  let missT = 0;
  let glide = null; // {x, y, rot} ball position at the start of intro (eases onto the tee)
  let lastBox = null;

  // Engine-internal world; render.js and engine tests read it (shell must not).
  const world = {
    phase: 'idle',
    shot: null,
    post: null,       // {x, bar, top} current post (colliders cached in _cols)
    oldPost: null,    // previous post, drawn while it scrolls away (not collidable)
    teeX: 0,
    marker: { t: 0, pt: 0, dir: 1, locked: false },
    ball: { x: 0, y: R, vx: 0, vy: 0, rot: TEE_ROT, px: 0, py: R, prot: TEE_ROT, sx: 1, sy: 1, rolling: false, resting: true },
    cam: { x: 0, y: 0, zoom: 1, px: 0, py: 0, pzoom: 1 },
    pickup: null,     // {x, y, value, collected}
    time: 0,
    tier: 0,
    phaseTime: 0,     // sim seconds in the current phase
    shotAge: 0,       // sim seconds since the current post appeared (pop-in)
    introT: 0,
    flightTime: 0,    // sim seconds since the flick (0 on the tee)
    flight: { collided: false, scored: false, pending: null, reachedPost: false, crossedAbove: false, landed: false },
    score: 0,
    made: 0,
    streak: 0,
    lastFlick: null,  // {t, inBand, angle, power}
  };

  // ------------------------------------------------------------------ events
  function on(evt, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => off(evt, fn);
  }
  function off(evt, fn) {
    const set = listeners.get(evt);
    if (set) set.delete(fn);
  }
  function emit(evt, payload) {
    const set = listeners.get(evt);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        // A broken handler must never break the simulation.
        console.error('[flick-goal] "' + evt + '" handler threw:', err);
      }
    }
  }

  // ------------------------------------------------------------------ camera
  const viewW = (z) => V.worldWidth / z;
  const viewH = (z) => cssH / (k0 * z);

  /** Zoom that fits box B (SPEC §7). */
  function fitZoom(B) {
    const bw = Math.max(1, B.maxX - B.minX);
    const bh = Math.max(1, B.maxY - B.minY);
    return clamp(Math.min(V.worldWidth / bw, ((cssH / k0) * (1 - V.hudReserve)) / bh), V.zoomMin, V.zoomMax);
  }

  /** Camera x/y framing box B at zoom z. */
  function frameAt(B, z) {
    const bh = Math.max(1, B.maxY - B.minY);
    const availH = viewH(z) * (1 - V.hudReserve);
    // Keep the ground in view when the box fits, and push part of the spare
    // height below the ground so the action sits mid-screen (Flappy Hoops look).
    const y = bh <= availH ? B.minY - (availH - bh) * V.slackBelow : B.maxY - availH;
    return { x: (B.minX + B.maxX) / 2 - viewW(z) / 2, y, zoom: z };
  }

  function aimBox() {
    const s = world.shot;
    return {
      minX: s.teeX - V.framePadX,
      maxX: s.postX + V.framePadX,
      minY: -V.groundPad,
      maxY: Math.max(s.top, s.apex) + V.framePadTop,
    };
  }

  function currentBox() {
    const b = world.ball;
    switch (phase) {
      case 'idle':
      case 'intro':
      case 'aim':
        return aimBox();
      case 'fly':
        if (!world.flight.scored) {
          const a = aimBox();
          const m = R + 60;
          return {
            minX: Math.min(a.minX, b.x - m),
            maxX: Math.max(a.maxX, b.x + m),
            minY: Math.min(a.minY, b.y - m),
            maxY: Math.max(a.maxY, b.y + m),
          };
        }
        return postGoalBox();
      case 'settle':
        return postGoalBox();
      default:
        return lastBox || aimBox();
    }
  }

  function postGoalBox() {
    const b = world.ball;
    return { minX: b.x - 200, maxX: b.x + 200, minY: -V.groundPad, maxY: Math.max(b.y + 120, 380) };
  }

  function clampBallInView() {
    const b = world.ball;
    const c = world.cam;
    const m = R + V.ballMargin;
    const w = viewW(c.zoom);
    const h = viewH(c.zoom);
    if (b.x + m > c.x + w) c.x = b.x + m - w;
    if (b.x - m < c.x) c.x = b.x - m;
    if (b.y + m > c.y + h) c.y = b.y + m - h;
    if (b.y - m < c.y) c.y = b.y - m;
  }

  function updateCamera(dt) {
    if (!world.shot) return;
    const B = currentBox();
    if (phase !== 'miss' && phase !== 'over') lastBox = B;
    const c = world.cam;
    const rate = phase === 'idle' || phase === 'intro' || phase === 'aim' ? V.camRate : V.camRateFly;
    const f = 1 - Math.exp(-rate * dt);
    c.zoom += (fitZoom(B) - c.zoom) * f;
    // Position target is derived at the CURRENT (eased) zoom so zooming stays smooth.
    const tgt = frameAt(B, c.zoom);
    c.x += (tgt.x - c.x) * f;
    c.y += (tgt.y - c.y) * f;
    if (phase === 'fly' || phase === 'settle' || phase === 'miss' || phase === 'over') clampBallInView();
  }

  function snapCamera() {
    if (!world.shot) return;
    const B = currentBox();
    const tgt = frameAt(B, fitZoom(B));
    const c = world.cam;
    c.x = c.px = tgt.x;
    c.y = c.py = tgt.y;
    c.zoom = c.pzoom = tgt.zoom;
  }

  function worldToScreen(x, y) {
    const c = world.cam;
    const k = k0 * c.zoom;
    return { x: (x - c.x) * k, y: cssH - (y - c.y) * k };
  }

  // ------------------------------------------------------------------ helpers
  function setPhase(p) {
    phase = p;
    world.phase = p;
    world.phaseTime = 0;
  }

  function syncStats() {
    world.score = score;
    world.made = made;
    world.streak = streak;
  }

  function resetRunStats() {
    score = 0;
    made = 0;
    streak = 0;
    coinsRun = 0;
    perfects = 0;
    bestStreak = 0;
    continuesUsed = 0;
    startMade = 0;
    world.tier = 0;
    syncStats();
  }

  /**
   * Dev "start round": begin the run as if `n` goals were already made. Every difficulty system
   * keys off `made` (solver, clock, pickups) and the tier off `score`, so this matches a natural
   * run that has made n goals. Clamped to [0, maxRound - 1]; streak / coins stay at 0.
   */
  function applyStartMade(n) {
    const maxRound = (cfg.dev && cfg.dev.maxRound) || 200;
    startMade = clamp(Math.floor(Number(n) || 0), 0, Math.max(0, maxRound - 1));
    if (!startMade) return;
    made = startMade;
    score = startMade;
    world.tier = Math.floor(score / cfg.scoring.tierEvery);
    syncStats();
  }

  function resetFlight() {
    const f = world.flight;
    f.collided = false;
    f.scored = false;
    f.pending = null;
    f.reachedPost = false;
    f.crossedAbove = false;
    f.landed = false;
    world.flightTime = 0;
    world.lastFlick = null;
  }

  function placeBallOnTee(teeX) {
    const b = world.ball;
    b.x = b.px = teeX;
    b.y = b.py = R;
    b.vx = 0;
    b.vy = 0;
    b.rot = b.prot = TEE_ROT;
    b.rolling = false;
    b.resting = true;
  }

  /**
   * Marker start position for a shot: outside the band by at least ~0.2 s of travel,
   * so the first pass into the green is never a surprise the moment aiming begins.
   * (The marker is frozen during intro, so this is where it sits while the rail fades in.)
   */
  function pickMarkerStart(shot) {
    const b = shot.band;
    const m = world.marker;
    const gap = Math.max(0.08, shot.speed * 0.2);
    let t = 0;
    for (let i = 0; i < 64; i++) {
      t = rng();
      if (t < b.lo - gap || t > b.hi + gap) break;
    }
    if (t >= b.lo - gap && t <= b.hi + gap) t = b.lo > 1 - b.hi ? 0 : 1; // deterministic fallback: farther end
    m.t = m.pt = t;
    m.dir = rng() < 0.5 ? -1 : 1;
    m.locked = false;
  }

  /** Install a freshly solved shot and enter `intro`. */
  function beginShot(teeX, { keepOldPost = false } = {}) {
    const shot = solveShot({ teeX, made, rng }, cfg);
    world.oldPost = keepOldPost ? world.post : null;
    world.shot = shot;
    world.teeX = shot.teeX;
    const post = { x: shot.postX, bar: shot.bar, top: shot.top };
    post._cols = postColliders(post, cfg);
    world.post = post;
    world.pickup = shot.pickup ? { x: shot.pickup.x, y: shot.pickup.y, value: shot.pickup.value, collected: false } : null;
    world.shotAge = 0;
    world.introT = 0;
    pickMarkerStart(shot);
    resetFlight();
    clockMax = shot.clock;
    clock = clockMax;
    clockLowSent = false;
    missReason = null;
    settleT = 0;
    missT = 0;
    const b = world.ball;
    b.vx = 0;
    b.vy = 0;
    b.rolling = false;
    b.resting = true;
    glide = { x: b.x, y: b.y, rot: nearestAngle(b.rot, TEE_ROT) };
    b.rot = b.prot = glide.rot;
    setPhase('intro');
  }

  function nearestAngle(from, target) {
    // Returns an angle equal to `target` (mod 2π) closest to `from` — used so the
    // ball never visibly spins several turns while easing back onto the tee.
    return from + (((target - from) % TAU) + TAU + Math.PI) % TAU - Math.PI;
  }

  function moveMarker(dt) {
    const m = world.marker;
    if (m.locked || !world.shot) return;
    const v = world.shot.speed;
    let t = m.t + m.dir * v * dt;
    // Ping-pong with exact reflection at the ends.
    for (let i = 0; i < 4 && (t > 1 || t < 0); i++) {
      if (t > 1) { t = 2 - t; m.dir = -1; }
      if (t < 0) { t = -t; m.dir = 1; }
    }
    m.t = clamp(t, 0, 1);
  }

  // ------------------------------------------------------------------ ball physics
  const SPIN_MIN = 8;
  const SPIN_MAX = 14;

  function spinBall(dt) {
    const b = world.ball;
    if (b.rolling) {
      b.rot -= (b.vx / R) * dt * 0.6;
      return;
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (sp < 1) return;
    const pc = world.shot ? world.shot.powerC : 900;
    const spin = clamp(SPIN_MIN + ((sp / pc) - 0.6) * (SPIN_MAX - SPIN_MIN), SPIN_MIN, SPIN_MAX);
    b.rot -= spin * dt * Math.sign(b.vx || 1); // end-over-end tumble in the travel direction
  }

  function emitBounces(collisions) {
    for (const c of collisions) {
      world.flight.collided = true;
      emit('bounce', { kind: c.kind, impact: c.impact });
    }
  }

  /** Ground contact response. Returns impact speed if a bounce happened. */
  function groundContact() {
    const b = world.ball;
    if (b.y > R) return 0;
    b.y = R;
    if (b.vy >= 0) return 0;
    const impact = -b.vy;
    if (impact < P.restSpeed) {
      b.vy = 0;
      b.rolling = true;
    } else {
      b.vy = impact * P.restitutionGround;
      b.vx *= 0.6;
    }
    return impact;
  }

  /** A ball rolling on the ground bounces off the post stem instead of passing through it. */
  function rollIntoStem(prevX) {
    const post = world.post;
    if (!post) return;
    const b = world.ball;
    const minD = R + P.stemRadius;
    if (Math.abs(b.x - post.x) >= minD) return;
    const side = Math.sign(prevX - post.x) || -Math.sign(b.vx) || -1; // side the ball came from
    b.x = post.x + side * minD;
    if (b.vx * side < 0) {
      const impact = Math.abs(b.vx);
      b.vx = -b.vx * P.restitutionPost;
      b.resting = false;
      if (impact > 20) emit('bounce', { kind: 'stem', impact });
    }
  }

  /** Free ball motion after the shot is resolved (post-goal, miss, over). */
  function freeStep(dt) {
    const b = world.ball;
    if (b.resting) return;
    if (b.rolling) {
      const s = Math.sign(b.vx);
      const nv = b.vx - s * P.groundFriction * dt;
      if (Math.abs(b.vx) < 6 || Math.sign(nv) !== s) {
        b.vx = 0;
        b.resting = true;
      } else {
        b.vx = nv;
      }
      const prevX = b.x;
      b.x += b.vx * dt;
      b.y = R;
      rollIntoStem(prevX);
      spinBall(dt);
      return;
    }
    const r = stepFlight(b, world.post, dt, cfg);
    if (r.collisions.length) {
      for (const c of r.collisions) emit('bounce', { kind: c.kind, impact: c.impact });
    }
    const impact = groundContact();
    if (impact > 0) {
      emit('bounce', { kind: 'ground', impact });
      if (!world.flight.landed) {
        world.flight.landed = true;
        if (world.flight.scored) emit('land', { x: b.x });
      }
    }
    spinBall(dt);
  }

  // ------------------------------------------------------------------ outcomes
  function goal(y) {
    const s = world.shot;
    const f = world.flight;
    f.scored = true;
    const hc = (s.bar + s.top) / 2;
    const clean = !f.collided;
    const perfect = clean && Math.abs(y - hc) <= (cfg.scoring.perfectFrac * (s.top - s.bar)) / 2;
    let points;
    if (perfect) {
      streak += 1;
      points = Math.min(1 + streak, cfg.scoring.perfectMaxPoints);
      perfects += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
      points = 1;
    }
    made += 1;
    score += points;
    const coins = cfg.economy.coinsPerGoal + (perfect ? cfg.economy.coinsPerPerfectBonus : 0);
    coinsRun += coins;
    syncStats();
    const sp = worldToScreen(s.postX, y);
    emit('score', {
      points, score, made, perfect, streak, doink: !clean, coins, coinsRun, sx: sp.x, sy: sp.y,
    });
    const tier = Math.floor(score / cfg.scoring.tierEvery);
    if (tier !== world.tier) {
      world.tier = tier;
      emit('tier', { tier });
    }
  }

  function doMiss(reason) {
    missReason = reason;
    missT = 0;
    world.ball.resting = world.ball.resting && reason === 'clock';
    setPhase('miss');
    emit('miss', { reason, score });
  }

  function checkPickup() {
    const pk = world.pickup;
    if (!pk || pk.collected) return;
    const b = world.ball;
    const r = R + cfg.pickups.radius;
    const dx = b.x - pk.x;
    const dy = b.y - pk.y;
    if (dx * dx + dy * dy < r * r) {
      pk.collected = true;
      coinsRun += pk.value;
      const sp = worldToScreen(pk.x, pk.y);
      emit('coin', { amount: pk.value, coinsRun, sx: sp.x, sy: sp.y });
    }
  }

  // ------------------------------------------------------------------ phase steps
  function stepIntro(dt) {
    world.introT += dt;
    // The marker stays put while the rail fades in: taps only count from 'aim', so a marker
    // sweeping through the (visible) band during intro would eat the player's tap.
    const b = world.ball;
    const u = clamp(world.introT / (TM.introTime * 0.85), 0, 1);
    const e = easeInOut(u);
    if (glide) {
      const dist = Math.abs(glide.x - world.teeX);
      const hop = Math.min(80, dist * 0.35) * Math.sin(Math.PI * e);
      b.x = lerp(glide.x, world.teeX, e);
      b.y = lerp(glide.y, R, e) + hop;
      b.rot = lerp(glide.rot, TEE_ROT, e);
    }
    if (world.introT >= TM.introTime) {
      placeBallOnTee(world.teeX);
      b.px = b.x; // keep interpolation continuous (already equal after the glide)
      glide = null;
      clock = clockMax;
      setPhase('aim');
      const band = world.shot.band;
      emit('shotStart', {
        made, score, clock, speed: world.shot.speed, band: { lo: band.lo, hi: band.hi, width: band.width },
      });
    }
  }

  function stepAim(dt) {
    moveMarker(dt);
    clock = Math.max(0, clock - dt);
    if (!clockLowSent && clockMax > 0 && clock / clockMax < TM.clockLowFrac) {
      clockLowSent = true;
      emit('clockLow', { clock });
    }
    if (clock <= 0) doMiss('clock');
  }

  function stepFly(dt) {
    const b = world.ball;
    const f = world.flight;
    const post = world.post;
    const s = world.shot;
    world.flightTime += dt;

    if (f.scored && !f.pending) {
      // Goal resolved: the ball keeps flying and lands; no miss rules.
      freeStep(dt);
      checkPickup();
      if (f.landed || world.flightTime > P.maxFlightTime) {
        settleT = 0;
        setPhase('settle');
      }
      return;
    }

    // Pre-resolution: EXACTLY the solver's step (physics.simulateShot).
    const r = stepFlight(b, post, dt, cfg);
    emitBounces(r.collisions);
    if (!f.scored && r.crossed) {
      f.reachedPost = true;
      const y = r.crossed.y;
      if (y > s.bar && y < s.top) {
        // Through the uprights. Miss rules are off from here; the score is
        // finalized once the ball clears the post (clean) or touches it (doink).
        f.scored = true;
        f.pending = { y };
      } else if (y >= s.top) {
        f.crossedAbove = true;
      }
    }
    checkPickup();
    spinBall(dt);

    if (f.pending) {
      if (f.collided || b.x > post.x + reach || b.y <= R || world.flightTime > P.maxFlightTime) {
        const y = f.pending.y;
        f.pending = null;
        goal(y);
        if (b.y <= R) {
          const impact = groundContact();
          if (impact > 0) emit('bounce', { kind: 'ground', impact });
          f.landed = true;
          emit('land', { x: b.x });
        }
      }
      return;
    }
    if (f.scored) return;

    if (b.y <= R) {
      const reason = f.collided ? 'post' : 'short';
      const impact = groundContact();
      if (impact > 0) emit('bounce', { kind: 'ground', impact });
      f.landed = true;
      doMiss(reason);
      return;
    }
    if (b.x > post.x + P.passMissMargin) {
      doMiss(f.crossedAbove ? 'over' : f.collided ? 'post' : 'short');
      return;
    }
    if (b.x < s.teeX - P.backMissDistance || world.flightTime > P.maxFlightTime) {
      doMiss('post');
    }
  }

  function stepSettle(dt) {
    settleT += dt;
    freeStep(dt);
    if (world.ball.resting || settleT >= TM.settleMax) nextShot();
  }

  function nextShot() {
    const b = world.ball;
    const post = world.post;
    // The next tee is where the ball came to rest — but never behind the post it
    // just went through (a doink can bounce back), so the old post stays behind.
    const minTee = post ? post.x + 60 : b.x;
    beginShot(Math.max(b.x, minTee), { keepOldPost: true });
  }

  function stepMiss(dt) {
    missT += dt;
    const sdt = missT < TM.slowmoTime ? dt * TM.slowmoScale : dt;
    freeStep(sdt);
    if (missT >= TM.missDelay) {
      setPhase('over');
      emit('gameover', {
        score, made, perfects, bestStreak, coinsRun, reason: missReason,
        canContinue: continuesUsed < cfg.economy.continuesPerRun,
        startMade,
      });
    }
  }

  // ------------------------------------------------------------------ public API
  function setViewport(w, h) {
    const nw = Math.max(1, Number(w) || 0);
    const nh = Math.max(1, Number(h) || 0);
    cssW = nw;
    cssH = nh;
    k0 = cssW / V.worldWidth;
    if (!viewportSet) {
      viewportSet = true;
      snapCamera();
    } else if (world.shot) {
      // Keep the camera valid for the new aspect; the ease takes over next step.
      if (phase === 'fly' || phase === 'settle' || phase === 'miss' || phase === 'over') clampBallInView();
    }
  }

  function idle() {
    resetRunStats();
    lastBox = null;
    const shot = solveShot({ teeX: 0, made: 0, rng }, cfg);
    world.shot = shot;
    world.teeX = 0;
    const post = { x: shot.postX, bar: shot.bar, top: shot.top };
    post._cols = postColliders(post, cfg);
    world.post = post;
    world.oldPost = null;
    world.pickup = null;
    world.shotAge = 0;
    world.introT = 0;
    world.marker.t = world.marker.pt = 0;
    world.marker.locked = true;
    resetFlight();
    placeBallOnTee(0);
    glide = null;
    clock = clockMax = shot.clock;
    clockLowSent = false;
    setPhase('idle');
    snapCamera();
  }

  /** Start a run. opts.startMade (dev "start round" - 1) pre-counts goals; omitted = normal run. */
  function newRun({ startMade: sm = 0 } = {}) {
    const wasFar = !world.shot || Math.hypot(world.ball.x, world.ball.y - R) > 300;
    resetRunStats();
    applyStartMade(sm);
    lastBox = null;
    world.oldPost = null;
    // Nearby ball glides back onto the tee during intro; a far one teleports.
    if (wasFar) placeBallOnTee(0);
    beginShot(0);
    world.oldPost = null;
    if (wasFar) snapCamera();
    emit('runStart', { startMade });
    if (world.tier) emit('tier', { tier: world.tier }); // started past a tier: shell recolours too
  }

  function tap() {
    if (phase !== 'aim') return false;
    const s = world.shot;
    const m = world.marker;
    m.locked = true;
    const t = m.t;
    const { angle, power } = mapRail(s, t, cfg);
    const v = launchVelocity(angle, power);
    const b = world.ball;
    // Launch from exactly the solver's start state.
    b.x = s.teeX;
    b.y = R;
    b.vx = v.vx;
    b.vy = v.vy;
    b.rolling = false;
    b.resting = false;
    resetFlight();
    const inBand = t >= s.band.lo && t <= s.band.hi;
    world.lastFlick = { t, inBand, angle, power };
    setPhase('fly');
    emit('flick', { t, angle, power, inBand });
    return true;
  }

  function continueRun() {
    if (phase !== 'over' || continuesUsed >= cfg.economy.continuesPerRun) return false;
    continuesUsed += 1;
    streak = 0;
    syncStats();
    const teeX = world.shot ? world.shot.teeX : 0;
    const b = world.ball;
    const far = Math.hypot(b.x - teeX, b.y - R) > 400;
    if (far) placeBallOnTee(teeX);
    lastBox = null;
    beginShot(teeX);
    if (far) snapCamera();
    emit('continue', {});
    return true;
  }

  function step(dt) {
    if (!world.shot) idle();
    const b = world.ball;
    const c = world.cam;
    const m = world.marker;
    b.px = b.x;
    b.py = b.y;
    b.prot = b.rot;
    c.px = c.x;
    c.py = c.y;
    c.pzoom = c.zoom;
    m.pt = m.t;
    world.time += dt;
    world.phaseTime += dt;
    world.shotAge += dt;

    switch (phase) {
      case 'idle': break;
      case 'intro': stepIntro(dt); break;
      case 'aim': stepAim(dt); break;
      case 'fly': stepFly(dt); break;
      case 'settle': stepSettle(dt); break;
      case 'miss': stepMiss(dt); break;
      case 'over': freeStep(dt); break;
      default: break;
    }
    updateCamera(dt);
  }

  function hud() {
    const cm = clockMax > 0 ? clockMax : 1;
    const c = phase === 'intro' || phase === 'idle' ? clockMax : clock;
    return {
      phase,
      score,
      made,
      streak,
      coinsRun,
      clock: c,
      clockMax,
      clock01: clamp(c / cm, 0, 1),
      canContinue: phase === 'over' && continuesUsed < cfg.economy.continuesPerRun,
      startMade,
    };
  }

  const game = {
    on,
    off,
    setViewport,
    idle,
    newRun,
    tap,
    step,
    continueRun,
    hud,
    worldToScreen,
    get phase() { return phase; },
    get startMade() { return startMade; },
    get world() { return world; },
    get viewport() { return { cssW, cssH, k0 }; },
  };
  return game;
}

export default createGame;
