// Renderer core: aim-assist latching + fade, retro performance budget, layers / quality units,
// style switching and the mode wipe (V2_SPEC.md §5, §6.3, §11.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createGame } from '../src/engine/game.js';
import { createRenderer } from '../src/engine/render.js';
import { makeRng } from '../src/engine/physics.js';
import { createLayers, directLayers, MAX_LAYERS } from '../src/engine/layers.js';
import { createQualityMonitor, Q_WIN } from '../src/engine/quality.js';
import { stubCanvas, stubCtx, canvasFactory } from './_stub.mjs';

const STEP = 1 / CONFIG.sim.hz;
/**
 * ctx calls of a standard retro aim frame (day, FIELD, 390x844, dpr 3, seed 3, slider off) on the
 * merged field-posts + no-slider tree BEFORE the v2 renderer split (V2_SPEC §2.2).
 */
const RETRO_BASELINE_CALLS = 2653;

function rig({ seed = 3, w = 390, h = 844, dpr = 3, stadium = 'day', mode = 'field' } = {}) {
  const game = createGame({ rng: makeRng(seed) });
  game.setViewport(w, h);
  const { canvas, ctx } = stubCanvas(w, h);
  const fac = canvasFactory();
  const r = createRenderer(canvas, game, { cfg: CONFIG, createCanvas: fac.create });
  r.resize(w, h, dpr);
  r.setTheme(stadium);
  game.idle({ mode });
  return { game, r, ctx, canvas, fac };
}

function toAim(game, r, frames = 0) {
  let guard = 0;
  while (game.phase !== 'aim' && guard++ < 2000) { game.step(STEP); r.draw(1, 1 / 60); }
  for (let i = 0; i < frames; i++) { game.step(STEP); r.draw(1, 1 / 60); }
}

/** Advance sim + renderer by `sec` seconds of aiming at 60 fps (2 sim steps per frame). */
function aimFor(game, r, sec) {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) { game.step(STEP); game.step(STEP); r.draw(1, 1 / 60); }
}

test('aim assist: the mode is latched per shot (applied at the next shot, never mid-flight)', () => {
  const { game, r } = rig();
  r.setAimAssist('full');
  game.newRun();
  toAim(game, r, 2);
  assert.equal(r.aimAssist, 'full');
  assert.ok(r.debugState().railAlpha > 0.9, 'kick 1: full slider');
  game.world.marker.t = game.world.shot.band.tBest;
  game.tap();
  r.setAimAssist('fade'); // main.js does this right after the flick
  game.step(STEP);
  r.draw(1, 1 / 60);
  assert.equal(r.aimAssist, 'full', 'the kick in flight keeps its slider');
  assert.equal(r.debugState().aimPending, 'fade');
  toAim(game, r, 1);
  assert.equal(r.aimAssist, 'fade', 'latched when the next shot appeared');
});

test('aim assist: fade mode shows the slider at first and fades it to 0 by ~1.4 s; dots stay', () => {
  const { game, r } = rig();
  r.setAimAssist('fade');
  game.newRun();
  toAim(game, r);
  aimFor(game, r, 0.15);
  const early = r.debugState();
  assert.ok(early.railAlpha > 0.95, `readable at first (${early.railAlpha})`);
  assert.ok(early.dotsAlpha > 0.95);
  aimFor(game, r, 0.7);
  const mid = r.debugState().railAlpha;
  assert.ok(mid > 0.05 && mid < 0.95, `fading (${mid})`);
  aimFor(game, r, 0.75);
  const late = r.debugState();
  assert.ok(late.railAlpha < 0.02, `gone ~1.6 s into the aim (${late.railAlpha})`);
  assert.ok(late.dotsAlpha > 0.95, 'guide dots never fade with the slider');
});

test('aim assist: off = dots only; full = slider every frame of the aim', () => {
  for (const [mode, expectRail] of [['off', false], ['full', true]]) {
    const { game, r } = rig({ seed: 5 });
    r.setAimAssist(mode);
    game.newRun();
    toAim(game, r);
    aimFor(game, r, 2);
    const s = r.debugState();
    assert.equal(s.aimAssist, mode);
    if (expectRail) assert.ok(s.railAlpha > 0.95, mode);
    else assert.equal(s.railAlpha, 0, mode);
    assert.ok(s.dotsAlpha > 0.95, mode);
  }
  const { r } = rig();
  r.setAimAssist('bogus');
  assert.equal(r.aimAssist, 'off');
});

for (const mode of ['field', 'endless']) {
  test(`retro budget (${mode}): an aim frame creates no offscreen canvases and stays within 1.15x the v1 ctx calls`, () => {
    const { game, r, ctx, fac } = rig({ mode });
    r.setAimAssist('off');
    game.newRun();
    toAim(game, r, 30);
    const samples = [];
    for (let i = 0; i < 10; i++) {
      game.step(STEP);
      const before = ctx.__calls.n;
      r.draw(0.5, 1 / 60);
      samples.push(ctx.__calls.n - before);
    }
    const worst = Math.max(...samples);
    assert.ok(worst <= 1.15 * RETRO_BASELINE_CALLS, `${mode}: ${worst} ctx calls > 1.15 x ${RETRO_BASELINE_CALLS}`);
    assert.equal(fac.made.length, 0, 'retro never allocates offscreen canvases');
    assert.equal(r.getQuality().tier, 'high');
    assert.equal(r.getQuality().adaptive, false);
  });
}

test('style switching: pro stadium -> pro style (adaptive), quality low caps dpr at 2, retro restores full dpr', () => {
  const { game, r, canvas } = rig({ stadium: 'day' });
  assert.equal(r.debugState().style, 'retro');
  assert.equal(canvas.width, 390 * 3);
  r.setTheme('pro_night');
  assert.equal(r.debugState().style, 'pro');
  assert.equal(r.debugState().theme, 'night');
  r.setQuality('low');
  assert.equal(r.getQuality().tier, 'low');
  assert.equal(canvas.width, 390 * 2, 'low tier caps the backing store at 2x');
  r.setTheme('snow');
  assert.equal(r.debugState().style, 'retro');
  assert.equal(r.getQuality().tier, 'high', 'retro always runs at full quality');
  assert.equal(canvas.width, 390 * 3);
  r.setQuality('auto');
  r.setStyleOverride('pro');
  assert.equal(r.debugState().style, 'pro', 'QA override renders pro without owning it');
  r.setStyleOverride(null);
  assert.equal(r.debugState().style, 'retro');
  r.setTheme('garbage');
  assert.deepEqual([r.debugState().style, r.debugState().theme, r.debugState().stadium], ['retro', 'day', 'day']);
  game.newRun();
  toAim(game, r, 3);
});

test('mode wipe: a modeChange covers the scene swap briefly', () => {
  const { game, r } = rig();
  for (let i = 0; i < 5; i++) r.draw(1, 1 / 60);
  assert.equal(r.debugState().wipe, false);
  game.idle({ mode: 'endless' });
  r.draw(1, 1 / 60);
  assert.equal(r.debugState().wipe, true);
  assert.equal(r.debugState().mode, 'endless');
  for (let i = 0; i < 30; i++) r.draw(1, 1 / 60);
  assert.equal(r.debugState().wipe, false);
});

// ---------------------------------------------------------------- layers + quality units
function layerRig(phase = 'idle') {
  const st = { phase };
  const fac = canvasFactory();
  const pal = { skyTop: '#000000' };
  const P = { from: pal, to: pal, keyFrom: 'day:0', keyTo: 'day:0', t: 1, lowQ: false };
  const L = createLayers({
    makeCanvas: fac.create, getScale: () => 2, getPhase: () => st.phase, getPalState: () => P,
    viewSize: () => ({ w: 390, h: 844 }), promoteBitmaps: false,
  });
  return { L, st, fac, P };
}

test('layers: a layer is built once and blitted afterwards', () => {
  const { L, fac } = layerRig();
  let draws = 0;
  const draw = () => { draws++; };
  const c = stubCtx();
  for (let i = 0; i < 5; i++) L.layer(c, 'pro:stands', 200, 80, draw, 10, 500);
  assert.equal(draws, 1);
  assert.equal(fac.made.length, 1);
  assert.equal(fac.made[0].width, 400, 'scaled by getScale()');
  assert.equal(c.__calls.byName.drawImage, 5);
  assert.equal(L.stats.built, 1);
  L.layer(c, 'pro:stands', 200, 80, draw, 5000, 500); // off-screen: no blit, no build
  assert.equal(c.__calls.byName.drawImage, 5);
});

test('layers: never built in flight when an older palette layer can stand in; prewarm only when calm', () => {
  const { L, st, P } = layerRig('idle');
  const c = stubCtx();
  const draw = () => {};
  L.layer(c, 'pro:crowd', 100, 50, draw, 0, 0);
  // tier change mid-flight: the new palette's layer must NOT be built now
  st.phase = 'fly';
  P.keyFrom = 'day:0';
  P.keyTo = 'day:1';
  P.t = 0.2;
  L.layer(c, 'pro:crowd', 100, 50, draw, 0, 0);
  assert.equal(L.stats.built, 1);
  assert.equal(L.stats.inFlight, 0);
  // prewarm refuses in flight / while aiming, builds in a calm phase
  L.prewarm(1, [['day:1', {}]]);
  st.phase = 'aim';
  L.prewarm(1, [['day:1', {}]]);
  assert.equal(L.stats.built, 1);
  st.phase = 'intro';
  L.prewarm(1, [['day:1', {}]]);
  L.prewarm(1, [['day:1', {}]]);
  assert.equal(L.stats.built, 2);
  assert.ok(L.hasLayer('pro:crowd', 'day:1', 100, 50));
  assert.equal(L.stats.inFlight, 0);
  L.clear();
  assert.equal(L.count, 0);
});

test('layers: eviction past MAX_LAYERS; directLayers paints straight through a clip', () => {
  const { L } = layerRig();
  const c = stubCtx();
  for (let i = 0; i < MAX_LAYERS + 10; i++) L.layer(c, 'pro:k' + i, 10, 10, () => {}, 0, 0);
  assert.equal(L.count, MAX_LAYERS);
  const d = directLayers({});
  const c2 = stubCtx();
  let painted = 0;
  d.layer(c2, 'pro:x', 50, 20, () => { painted++; }, 3, 4);
  assert.equal(painted, 1);
  assert.equal(c2.__calls.byName.clip, 1);
});

test('quality monitor: slow medians trip low after two checks; forced modes; reset', () => {
  const q = createQualityMonitor();
  for (let i = 0; i < 60 + Q_WIN + 100; i++) q.sample(9, 1 / 60, false, false);
  assert.equal(q.wantLow, true);
  const fast = createQualityMonitor();
  for (let i = 0; i < 400; i++) fast.sample(1, 1 / 60, false, false);
  assert.equal(fast.wantLow, false);
  assert.equal(fast.setMode('low'), true);
  assert.equal(fast.wantLow, true);
  assert.equal(fast.setMode('high'), false);
  assert.equal(fast.wantLow, false);
  assert.equal(fast.setMode('auto'), null);
  assert.equal(fast.mode, 'auto');
  const built = createQualityMonitor();
  for (let i = 0; i < 400; i++) built.sample(9, 1 / 60, true, false);
  assert.equal(built.wantLow, false, 'frames that built a layer are not the steady-state cost');
});
