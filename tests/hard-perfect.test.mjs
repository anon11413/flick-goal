// v2/hard-perfect: progressive PERFECT window (ported from try/hard-perfect), checked in BOTH
// modes (FIELD GOAL slides every solved shot onto the end line; ENDLESS tees far down the field).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createGame } from '../src/engine/game.js';
import {
  makeRng, simulateShot, solveShot, isPerfectCross, measurePerfect,
} from '../src/engine/physics.js';
import { perfectFrac, perfectDwell, dwell, params, checkSchedule } from '../src/engine/difficulty.js';

const STEP = 1 / CONFIG.sim.hz;
const DC = CONFIG.difficulty;
const S = CONFIG.scoring;
const E = CONFIG.economy;
const MODES = ['field', 'endless'];
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

function setup(seed, mode) {
  const game = createGame({ rng: makeRng(seed) });
  game.setViewport(390, 844);
  const events = [];
  for (const n of ['runStart', 'shotStart', 'flick', 'score', 'miss']) game.on(n, (p) => events.push({ n, p }));
  if (mode) game.idle({ mode });
  return { game, events };
}

function stepUntil(game, pred, maxSec = 20) {
  for (let i = 0, max = Math.ceil(maxSec / STEP); i < max; i++) {
    if (pred()) return;
    game.step(STEP);
  }
  if (!pred()) throw new Error('condition not reached; phase=' + game.phase);
}

/** Aim, tap at `t` (a function of the shot band), wait for the score / miss; returns the score payload or null. */
function kick(game, events, tOf) {
  stepUntil(game, () => game.phase === 'aim', 10);
  game.world.marker.t = tOf(game.world.shot.band);
  const scores = events.filter((e) => e.n === 'score').length;
  assert.ok(game.tap(), 'tap accepted');
  stepUntil(game, () => events.filter((e) => e.n === 'score').length > scores || game.phase === 'miss', 8);
  return game.phase === 'miss' ? null : events.filter((e) => e.n === 'score').pop().p;
}

/** A sim flick at rail t is a PERFECT goal (clean + crossing within the perfect window). */
function simPerfect(shot, t) {
  const r = simulateShot(shot, t);
  return r.clean && isPerfectCross(shot, r.crossY);
}

// ---------------------------------------------------------------- schedule

test('hard-perfect config profile: 3-coin perfect, 3..6 streak points, dwell floor 0.035 s', () => {
  assert.equal(E.coinsPerGoal + E.coinsPerPerfectBonus, 3);
  assert.equal(S.perfectBasePoints, 3);
  assert.equal(S.perfectMaxPoints, 6);
  assert.equal(DC.perfectDwellMin, 0.035);
  assert.ok(checkSchedule(500).ok, JSON.stringify(checkSchedule(500).failures.slice(0, 5)));
});

test('perfect window: nominal fraction shrinks asymptotically, dwell floor never below 0.035 s', () => {
  close(perfectFrac(0), DC.perfect.start);
  close(perfectFrac(1e6), DC.perfect.asym, 1e-6);
  for (let n = 1; n <= 1000; n++) {
    assert.ok(n > 100 ? perfectFrac(n) <= perfectFrac(n - 1) : perfectFrac(n) < perfectFrac(n - 1), `perfectFrac not shrinking at ${n}`);
    assert.ok(perfectDwell(n) <= perfectDwell(n - 1), `perfectDwell not tightening at ${n}`);
    assert.ok(perfectDwell(n) >= 0.035, `perfect dwell floor ${perfectDwell(n)} at n=${n}`);
    assert.ok(perfectDwell(n) < dwell(n), 'perfect strip fits inside the band');
  }
  assert.ok(perfectFrac(40) < 0.08 && perfectFrac(0) <= 0.25, 'much tighter than v2/standard (0.4)');
  const p = params(7);
  close(p.perfectFrac, perfectFrac(7));
  close(p.perfectDwell, perfectDwell(7));
});

// ---------------------------------------------------------------- solver

test('perfect strip: dwell >= 0.035 s for every n in 0..200, and every tap inside it is PERFECT (near and far tees)', () => {
  const rng = makeRng(424242);
  let minDwell = Infinity;
  for (let n = 0; n <= 200; n++) {
    for (let k = 0; k < 3; k++) {
      // k = 2: a tee far down an ENDLESS field (float magnitudes like a long run)
      const teeX = k === 2 ? 20000 + rng() * 40000 : rng() * 5000;
      const shot = solveShot({ teeX, made: n, rng: makeRng(Math.floor(rng() * 2 ** 31)) });
      const b = shot.band;
      const D = (b.perfHi - b.perfLo) / shot.speed;
      minDwell = Math.min(minDwell, D);
      assert.ok(D >= 0.035, `n ${n}: perfect dwell ${D}`);
      assert.ok(D >= perfectDwell(n) * (1 - 1e-6), `n ${n}: dwell ${D} < floor ${perfectDwell(n)}`);
      assert.ok(shot.perfectTol >= perfectFrac(n) * shot.gap / 2 - 1e-9, `n ${n}: window narrower than nominal`);
      assert.ok(b.perfLo >= b.lo && b.perfHi <= b.hi && b.perfLo <= b.tBest && b.tBest <= b.perfHi, `n ${n}: strip inside band`);
      for (let i = 0; i <= 24; i++) {
        const t = b.perfLo + ((b.perfHi - b.perfLo) * i) / 24;
        assert.equal(simPerfect(shot, t), true, `n ${n}: hole in perfect strip at ${t}`);
      }
      // The strip matches the true window: just outside it (still in the clean band) is a plain goal.
      if (b.perfLo - 2e-3 > b.lo) assert.equal(simPerfect(shot, b.perfLo - 2e-3), false, `n ${n}: perfect below strip`);
      if (b.perfHi + 2e-3 < b.hi) assert.equal(simPerfect(shot, b.perfHi + 2e-3), false, `n ${n}: perfect above strip`);
    }
  }
  assert.ok(minDwell >= DC.perfectDwellMin);
});

test('perfect gets progressively harder: the strip dwell shrinks with goals made', () => {
  const avgDwell = (n) => {
    let sum = 0;
    for (let seed = 0; seed < 12; seed++) {
      const shot = solveShot({ teeX: 0, made: n, rng: makeRng(seed * 31 + 7) });
      sum += (shot.band.perfHi - shot.band.perfLo) / shot.speed;
    }
    return sum / 12;
  };
  const d = [0, 5, 15, 40, 120].map(avgDwell);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] < d[i - 1], `dwell not shrinking: ${d.map((x) => x.toFixed(3))}`);
  // v2's aim sweep is slower than v1's, so early strips are a bit longer in seconds than on
  // try/hard-perfect (0.235 s vs 0.188 s at n = 0) but the same share of the green band (~1/3,
  // v2/standard: ~0.6); from ~15 goals the dwell floor binds and the seconds match exactly.
  assert.ok(d[0] < 0.26 && d[0] < 0.4 * dwell(0), 'perfect is much harder than v2/standard from the first kick');
  assert.ok(d[d.length - 1] < 0.045, 'late-game perfect is a ~2-3 frame window');
});

test('measurePerfect edges are exact: bisected to the sim predicate', () => {
  const shot = solveShot({ teeX: 0, made: 30, rng: makeRng(9) });
  const p = measurePerfect(shot, shot.band, shot.perfectTol);
  assert.equal(p.perfLo, shot.band.perfLo);
  assert.equal(p.perfHi, shot.band.perfHi);
  assert.equal(simPerfect(shot, p.perfLo - 1e-6), false);
  assert.equal(simPerfect(shot, p.perfHi + 1e-6), false);
});

// ---------------------------------------------------------------- real game, both modes

test('real game, BOTH modes: every tap inside the gold strip is PERFECT; streak scales points, perfect pays 3 coins', () => {
  for (const mode of MODES) {
    for (let seed = 1; seed <= 4; seed++) {
      const { game, events } = setup(seed, mode);
      game.newRun({ mode });
      const rng = makeRng(seed * 977);
      for (let shotN = 0; shotN < 30; shotN++) {
        // exactly on the edges, plus random interior points
        const u = shotN % 5 === 0 ? 0 : shotN % 5 === 1 ? 1 : rng();
        const sc = kick(game, events, (b) => b.perfLo + (b.perfHi - b.perfLo) * u);
        const label = `${mode} seed ${seed} shot ${shotN}`;
        assert.ok(sc, label + ': missed');
        assert.equal(events.filter((e) => e.n === 'flick').pop().p.inPerfect, true, label + ': flick.inPerfect');
        assert.equal(sc.perfect, true, label + ': perfect-strip tap was not PERFECT');
        const streak = shotN + 1;
        assert.equal(sc.streak, streak);
        assert.equal(sc.points, Math.min(S.perfectBasePoints + streak - 1, S.perfectMaxPoints));
        assert.equal(sc.coins, E.coinsPerGoal + E.coinsPerPerfectBonus
          + Math.min((streak - 1) * E.coinsPerPerfectStreak, E.perfectStreakCoinCap));
        assert.ok(sc.coins <= 3, 'a perfect pays at most 3 coins');
      }
      assert.equal(game.hud().made, 30);
    }
  }
});

test('real game, BOTH modes: a clean tap outside the gold strip is a plain goal and resets the streak', () => {
  for (const mode of MODES) {
    const { game, events } = setup(5, mode);
    game.newRun({ mode });
    assert.equal(kick(game, events, (b) => b.tBest).perfect, true, mode);
    const sc = kick(game, events, (b) => (b.perfHi + 2e-3 < b.hi ? (b.perfHi + b.hi) / 2 : (b.lo + b.perfLo) / 2));
    assert.ok(sc, mode + ': missed');
    assert.equal(events.filter((e) => e.n === 'flick').pop().p.inPerfect, false);
    assert.equal(sc.perfect, false, mode);
    assert.equal(sc.doink, false);
    assert.equal(sc.streak, 0);
    assert.equal(sc.points, 1);
    assert.equal(sc.coins, E.coinsPerGoal);
  }
});

test('always beatable in BOTH modes with the new window: band edges still score (plain goals)', () => {
  for (const mode of MODES) {
    for (let seed = 1; seed <= 4; seed++) {
      const { game, events } = setup(seed, mode);
      game.newRun({ mode });
      for (let i = 0; i < 40; i++) {
        const sc = kick(game, events, i % 2 ? (b) => b.lo + 1e-3 : (b) => b.hi - 1e-3);
        assert.ok(sc, `${mode} seed ${seed} shot ${i} missed`);
      }
    }
  }
});

// ---------------------------------------------------------------- dev start round, both modes

test('dev start round, BOTH modes: same progressive PERFECT window as a natural run at that many goals', () => {
  const N = 12;
  for (const mode of MODES) {
    const nat = setup(21, mode);
    nat.game.newRun({ mode });
    for (let i = 0; i < N; i++) assert.ok(kick(nat.game, nat.events, (b) => b.tBest), `${mode}: natural kick ${i}`);
    stepUntil(nat.game, () => nat.game.phase === 'aim');
    const natShot = nat.game.world.shot;

    const dev = setup(21, mode);
    dev.game.newRun({ mode, startMade: N });
    stepUntil(dev.game, () => dev.game.phase === 'aim');
    const devShot = dev.game.world.shot;

    assert.equal(devShot.made, N);
    assert.equal(natShot.made, N);
    assert.equal(devShot.perfectNominalTol, natShot.perfectNominalTol, mode);
    close(devShot.perfectNominalTol, perfectFrac(N) * devShot.gap / 2);
    for (const s of [devShot, natShot]) {
      const d = (s.band.perfHi - s.band.perfLo) / s.speed;
      assert.ok(d >= perfectDwell(N) - 1e-6, `${mode}: dwell ${d} >= perfectDwell(${N})`);
    }
  }
});

test('dev start round, BOTH modes: a PERFECT on the first dev kick pays the base 3 points / 3 coins', () => {
  for (const mode of MODES) {
    const { game, events } = setup(8, mode);
    game.newRun({ mode, startMade: 39 });
    const sc = kick(game, events, (b) => (b.perfLo + b.perfHi) / 2);
    assert.ok(sc, mode + ': scored');
    assert.equal(sc.perfect, true);
    assert.equal(sc.streak, 1);
    assert.equal(sc.points, S.perfectBasePoints);
    assert.equal(sc.coins, E.coinsPerGoal + E.coinsPerPerfectBonus);
    assert.equal(sc.made, 40);
    assert.equal(sc.score, 39 + S.perfectBasePoints);
  }
});
