import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import {
  curve, speed, bandWidth, shotClock, distance, gap, barRange, bandAlpha, dwell, params, checkSchedule,
} from '../src/engine/difficulty.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test('checkSchedule(1000) passes every always-beatable rule', () => {
  const r = checkSchedule(1000);
  assert.equal(r.ok, true, JSON.stringify(r.failures.slice(0, 5)));
  assert.deepEqual(r.failures, []);
});

test('spot values at n = 0 match the design table', () => {
  close(speed(0), 0.4);
  close(bandWidth(0), 0.28);
  close(shotClock(0), 7.0);
  close(distance(0), CONFIG.difficulty.distance.start);
  close(gap(0), CONFIG.difficulty.gap.start);
  close(bandAlpha(0), CONFIG.difficulty.bandAlpha.start);
  close(dwell(0), 0.28 / 0.4);
  assert.deepEqual(barRange(0), { min: 50, max: 50 });
});

test('curves approach their asymptotes', () => {
  close(speed(1e6), CONFIG.difficulty.speed.asym, 1e-6);
  close(bandWidth(1e6), CONFIG.difficulty.band.asym, 1e-6);
  close(shotClock(1e6), CONFIG.difficulty.clock.asym, 1e-6);
  const br = barRange(1000);
  assert.equal(br.max, CONFIG.difficulty.barHeight.min + CONFIG.difficulty.barHeight.range);
});

test('curves are monotone in the right direction', () => {
  for (let n = 1; n <= 400; n++) {
    assert.ok(speed(n) >= speed(n - 1));
    assert.ok(distance(n) >= distance(n - 1));
    assert.ok(bandWidth(n) <= bandWidth(n - 1));
    assert.ok(shotClock(n) <= shotClock(n - 1));
    assert.ok(gap(n) <= gap(n - 1));
    assert.ok(bandAlpha(n) <= bandAlpha(n - 1));
  }
});

test('MATH.md hard constraints hold for every n (dwell D >= D_min, clock covers worst phase)', () => {
  const d = CONFIG.difficulty;
  for (let n = 0; n <= 1000; n++) {
    const D = (bandWidth(n) * CONFIG.mapping.widthTolLo) / speed(n);
    assert.ok(D >= d.dwellMin, `dwell ${D} at n=${n}`);
    assert.ok(dwell(n) >= d.dwellMin);
    assert.ok(shotClock(n) >= d.reaction + 1 / speed(n) + d.dwellMin, `clock at n=${n}`);
  }
});

test('params() bundles every curve', () => {
  const p = params(12);
  assert.equal(p.n, 12);
  close(p.speed, speed(12));
  close(p.band, bandWidth(12));
  close(p.dwell, bandWidth(12) / speed(12));
  assert.ok(p.barMax >= p.barMin);
  close(curve({ start: 1, asym: 3, scale: 2 }, 0), 1);
});

test('checkSchedule reports failures instead of throwing on a broken schedule', () => {
  const bad = JSON.parse(JSON.stringify(CONFIG));
  bad.difficulty.speed.asym = 5; // far too fast for the band
  const r = checkSchedule(200, bad);
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.rule === 'dwell'));
});

test('hidden rail: the aim window is more generous than the base slider version', () => {
  assert.equal(CONFIG.rail.visible, false);
  // ~0.7 s inside the sweet band per pass on the first shot, still >= 0.35 s by goal 5
  assert.ok(dwell(0) >= 0.65, `dwell(0) = ${dwell(0)}`);
  assert.ok(dwell(5) >= 0.35, `dwell(5) = ${dwell(5)}`);
  // the slower sweep must never exceed the base (visible-rail) speed curve, and late shots
  // keep at least ~15% more time in the window than the base 1.10 asymptote gave
  for (let n = 0; n <= 200; n++) {
    const base = 1.10 - (1.10 - 0.50) * Math.exp(-n / 16);
    assert.ok(speed(n) <= base + 1e-12, `n=${n}`);
  }
  assert.ok(dwell(1e6) >= 1.15 * (CONFIG.difficulty.band.asym / 1.10), `dwell(inf) = ${dwell(1e6)}`);
});
