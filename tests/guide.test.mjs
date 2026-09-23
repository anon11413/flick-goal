import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { makeRng, mapRail, solveShot } from '../src/engine/physics.js';
import { guideSpacing, guideLayout, guideTip } from '../src/engine/guide.js';

// With the rail hidden (branch try/no-slider) the guide dots are the only aim cue, so the
// scoring window must be SEEABLE in them, not just hittable in time.
const RL = CONFIG.rail;
const MIN_TIP_TRAVEL = 5;   // css px the last dot moves between the clean-goal band edges (worst shot)
const MIN_MEDIAN_TRAVEL = 15; // css px, median over shots at any score

test('guide spacing: ideal power is the fixed "evenly spaced" length, monotone in power', () => {
  assert.equal(guideSpacing(1), RL.guideSpacing);
  let prev = -Infinity;
  for (let pf = 0.5; pf <= 1.6; pf += 0.01) {
    const s = guideSpacing(pf);
    assert.ok(s > prev, `pf ${pf.toFixed(2)}`);
    prev = s;
  }
  // bounded both ways; weak kicks read as a tight row (white cores never overlap)
  assert.ok(guideSpacing(0.3) >= RL.guideSpacing * (1 - RL.guideSpread) - 1e-9);
  assert.ok(guideSpacing(3) <= RL.guideSpacing * (1 + RL.guideSpread) + 1e-9);
  const minSp = RL.guideSpacing * (1 - RL.guideSpread);
  assert.ok(minSp > 2 * RL.guideRadius - RL.guideRadiusStep, `min spacing ${minSp}`);
});

test('guide: row length grows along the sweep and the dots shrink outward', () => {
  const shot = solveShot({ made: 10, rng: makeRng(7) });
  let prev = -Infinity;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const { dots } = guideLayout(shot, t);
    assert.equal(dots.length, RL.guideDots);
    for (let i = 1; i < dots.length; i++) assert.ok(dots[i].r <= dots[i - 1].r && dots[i].d > dots[i - 1].d);
    const len = dots[dots.length - 1].d;
    assert.ok(len >= prev - 1e-9, `t ${t.toFixed(2)}`);
    prev = len;
  }
});

test('guide: every scoring window is visible as dot movement, at every score', () => {
  for (const made of [0, 1, 3, 8, 15, 20, 30, 60, 100]) {
    const travel = [];
    for (let seed = 0; seed < 40; seed++) {
      const shot = solveShot({ made, rng: makeRng(1000 + seed * 13 + made) });
      const a = guideTip(shot, shot.band.lo);
      const b = guideTip(shot, shot.band.hi);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      assert.ok(d >= MIN_TIP_TRAVEL, `made ${made} seed ${seed}: tip travel ${d.toFixed(2)} px`);
      // the ideal kick sits inside the window and on the steep part of the curve
      const pfLo = mapRail(shot, shot.band.lo).power / shot.powerC;
      const pfHi = mapRail(shot, shot.band.hi).power / shot.powerC;
      assert.ok(pfLo < 1 && pfHi > 1, `made ${made} seed ${seed}: window pf ${pfLo.toFixed(3)}..${pfHi.toFixed(3)}`);
      travel.push(d);
    }
    travel.sort((x, y) => x - y);
    const med = travel[travel.length >> 1];
    assert.ok(med >= MIN_MEDIAN_TRAVEL, `made ${made}: median tip travel ${med.toFixed(2)} px`);
  }
});
