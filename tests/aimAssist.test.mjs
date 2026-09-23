import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { sliderMode, railFade, hintFor, AIM_MODES, describeAim } from '../src/aimAssist.js';

test('config: slider tutorial = 2 kicks, fade ~1.4 s into the aim', () => {
  assert.equal(CONFIG.aim.tutorialKicks, 2);
  assert.ok(Math.abs(CONFIG.aim.fadeDelay + CONFIG.aim.fadeTime - 1.4) < 1e-9);
  assert.deepEqual(AIM_MODES, ['full', 'fade', 'off']);
});

test('sliderMode: tutorial state machine (kick 1 full, kick 2 fade, kick 3+ off)', () => {
  assert.deepEqual(sliderMode({ kicks: 0 }), { mode: 'full', reason: 'tutorial' });
  assert.deepEqual(sliderMode({ kicks: 1 }), { mode: 'fade', reason: 'tutorial' });
  for (const k of [2, 3, 10, 999]) assert.deepEqual(sliderMode({ kicks: k }), { mode: 'off', reason: 'default' });
  assert.deepEqual(sliderMode({ kicks: -3 }), { mode: 'full', reason: 'tutorial' });
  assert.deepEqual(sliderMode({ kicks: 'junk' }), { mode: 'full', reason: 'tutorial' });
  assert.deepEqual(sliderMode(), { mode: 'full', reason: 'tutorial' });
});

test('sliderMode precedence: dev force > owned-and-ON > tutorial > off', () => {
  // upgrade owned + ON: slider every kick
  for (const k of [0, 1, 2, 50]) assert.deepEqual(sliderMode({ owned: true, on: true, kicks: k }), { mode: 'full', reason: 'upgrade' });
  // owned but switched OFF: the tutorial still runs, then dots only
  assert.deepEqual(sliderMode({ owned: true, on: false, kicks: 0 }), { mode: 'full', reason: 'tutorial' });
  assert.deepEqual(sliderMode({ owned: true, on: false, kicks: 1 }), { mode: 'fade', reason: 'tutorial' });
  assert.deepEqual(sliderMode({ owned: true, on: false, kicks: 5 }), { mode: 'off', reason: 'default' });
  // not owned: the ON setting alone does nothing
  assert.deepEqual(sliderMode({ owned: false, on: true, kicks: 5 }), { mode: 'off', reason: 'default' });
  // developer force beats everything
  assert.deepEqual(sliderMode({ devForce: 'on', kicks: 9 }), { mode: 'full', reason: 'dev' });
  assert.deepEqual(sliderMode({ devForce: 'off', owned: true, on: true, kicks: 0 }), { mode: 'off', reason: 'dev' });
  assert.deepEqual(sliderMode({ devForce: 'default', kicks: 1 }), { mode: 'fade', reason: 'tutorial' });
});

test('railFade: full = 1, off = 0, fade holds then eases to 0 by ~1.4 s', () => {
  assert.equal(railFade('full', 0), 1);
  assert.equal(railFade('full', 10), 1);
  assert.equal(railFade('off', 0), 0);
  assert.equal(railFade('bogus', 0), 0);
  assert.equal(railFade('fade', 0), 1);
  assert.equal(railFade('fade', 0.29), 1, 'readable at first');
  const mid = railFade('fade', 0.85);
  assert.ok(mid > 0.4 && mid < 0.6, `~0.5 near 0.85 s (${mid})`);
  assert.equal(railFade('fade', 1.4), 0);
  assert.equal(railFade('fade', 5), 0);
  let prev = 2;
  for (let t = 0; t <= 1.5; t += 0.05) {
    const v = railFade('fade', t);
    assert.ok(v <= prev + 1e-12 && v >= 0 && v <= 1, `monotone at ${t}`);
    prev = v;
  }
});

test('hintFor: rail on kick 1, fade on kick 2, dots on kick 3, dots on first-of-run until kick 6', () => {
  const H = (o) => hintFor({ made: 0, startMade: 0, totalGoals: 0, ...o });
  assert.equal(H({ ...sliderMode({ kicks: 0 }), kicks: 0 }), 'rail');
  assert.equal(H({ ...sliderMode({ kicks: 1 }), kicks: 1 }), 'fade');
  assert.equal(H({ ...sliderMode({ kicks: 2 }), kicks: 2, made: 1 }), 'dots', 'first slider-less kick ever, even mid-run');
  assert.equal(H({ ...sliderMode({ kicks: 3 }), kicks: 3, made: 2 }), null, 'mid-run afterwards: no hint');
  for (const k of [3, 4, 5]) assert.equal(H({ ...sliderMode({ kicks: k }), kicks: k }), 'dots', `first shot of a run, kick ${k}`);
  assert.equal(H({ ...sliderMode({ kicks: 6 }), kicks: 6 }), null);
  assert.equal(H({ ...sliderMode({ kicks: 40 }), kicks: 40 }), null);
  // upgrade: no hint unless the player is still new (totalGoals < 3) on a run's first shot
  const up = sliderMode({ owned: true, on: true, kicks: 20 });
  assert.equal(H({ ...up, kicks: 20, totalGoals: 50 }), null);
  assert.equal(H({ ...up, kicks: 20, totalGoals: 1 }), 'rail');
  assert.equal(H({ ...up, kicks: 20, totalGoals: 1, made: 3 }), null);
  // dev start round: the first shot of the run is made === startMade
  assert.equal(H({ ...sliderMode({ kicks: 4 }), kicks: 4, made: 29, startMade: 29 }), 'dots');
  // dev forced
  assert.equal(H({ ...sliderMode({ devForce: 'on', kicks: 30 }), kicks: 30, totalGoals: 99 }), null);
});

test('describeAim for the developer read-out', () => {
  assert.equal(describeAim({ mode: 'fade', reason: 'tutorial' }), 'FADE (tutorial)');
});
