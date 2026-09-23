// PRO art style (V2_SPEC.md §10, §11.1): try/pro-graphics' render tests ported to the v2 PRO
// stadiums in BOTH layouts (FIELD + ENDLESS): full runs with sane geometry, cached layers blitted,
// bounded offscreen canvases, no gradient churn, every ball skin under every light, quality tiers
// (forced + adaptive), zero layer builds in flight (incl. a mid-flight tier change), the dev start
// round pre-warm, registration of the real style, previews through directLayers, the crowd atlas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createGame } from '../src/engine/game.js';
import { createRenderer } from '../src/engine/render.js';
import { makeRng } from '../src/engine/physics.js';
import { THEMES } from '../src/engine/themes.js';
import { getStyle, STYLES, STYLE_FUNCTIONS, registerStyle } from '../src/engine/styles/index.js';
import { drawStadiumPreview, drawBallPreview } from '../src/engine/preview.js';
import { LIGHTS, lightOf } from '../src/engine/styles/pro/lights.js';
import { stubCtx } from './_stub.mjs';

const STEP = 1 / CONFIG.sim.hz;
const THEME_IDS = Object.keys(THEMES);
const MODES = ['field', 'endless'];
const BALL_IDS = CONFIG.catalog.balls.map((b) => b.id);
const proId = (theme) => CONFIG.catalog.stadiums.find((s) => s.style === 'pro' && s.theme === theme).id;

function setup({ seed = 3, w = 390, h = 844, dpr = 3, stadium = 'pro_day', mode = 'field' } = {}) {
  const stats = { canvases: 0, maxCanvasPx: 0 };
  const ctx = stubCtx();
  const canvas = { width: w, height: h, clientWidth: w, clientHeight: h, style: {}, getContext: () => ctx };
  const game = createGame({ rng: makeRng(seed) });
  game.setViewport(w, h);
  const renderer = createRenderer(canvas, game, {
    cfg: CONFIG,
    createCanvas: (cw, ch) => {
      assert.ok(Number.isInteger(cw) && Number.isInteger(ch) && cw > 0 && ch > 0, `bad offscreen size ${cw}x${ch}`);
      stats.canvases++;
      stats.maxCanvasPx = Math.max(stats.maxCanvasPx, cw * ch);
      const c2 = stubCtx();
      return { width: cw, height: ch, style: {}, getContext: () => c2 };
    },
  });
  renderer.resize(w, h, dpr);
  renderer.setTheme(stadium);
  game.idle({ mode });
  return { game, renderer, stats, ctx, canvas };
}
const calls = (ctx, name) => ctx.__calls.byName[name] || 0;
const gradients = (ctx) => calls(ctx, 'createLinearGradient') + calls(ctx, 'createRadialGradient');

/** Play one in-band shot, a frame per sim step, until the next shot aims (or game over). */
function playShot(game, renderer) {
  let guard = 0;
  while (game.phase !== 'aim') {
    game.step(STEP);
    renderer.draw(1, STEP);
    if (++guard > 3000) throw new Error('never reached aim');
  }
  game.world.marker.t = game.world.shot.band.tBest;
  assert.equal(game.tap(), true);
  guard = 0;
  while (game.phase !== 'aim' && game.phase !== 'over') {
    game.step(STEP);
    renderer.draw(0.5, STEP);
    if (++guard > 4000) throw new Error('shot never resolved');
  }
}

test('registry: the real PRO style replaced the stub (adaptive, own balls, own lights)', () => {
  const pro = getStyle('pro');
  const retro = getStyle('retro');
  assert.equal(pro.id, 'pro');
  assert.equal(pro.adaptive, true);
  assert.equal(STYLES.pro, pro);
  for (const fn of STYLE_FUNCTIONS) assert.equal(typeof pro[fn], 'function', fn);
  assert.notEqual(pro.balls, retro.balls, 'pro ships its own shaded skins');
  for (const id of BALL_IDS) assert.notEqual(pro.balls[id].draw, retro.balls[id].draw, id);
  for (const fn of ['drawField', 'drawBackground', 'drawPost', 'drawNet', 'drawEffects', 'drawFinish']) {
    assert.notEqual(pro[fn], retro[fn], `${fn} is pro art, not the retro stub`);
  }
  assert.deepEqual(Object.keys(LIGHTS).sort(), [...THEME_IDS].sort());
  for (const th of THEME_IDS) {
    const L = pro.lightFor(th);
    assert.ok(Number.isFinite(L.x) && Number.isFinite(L.y) && typeof L.rim === 'string', th);
  }
  assert.equal(lightOf('nope'), LIGHTS.day);
  assert.equal(registerStyle(pro), true, 're-registering the pro style validates');
});

for (const mode of MODES) {
  test(`${mode}: every PRO stadium draws a run (menu, aim, flight, goal, tier fade); layers cached and bounded`, () => {
    for (const theme of THEME_IDS) {
      const { game, renderer, stats, ctx } = setup({ stadium: proId(theme), mode });
      assert.equal(renderer.debugState().style, 'pro');
      for (let i = 0; i < 20; i++) renderer.draw(1, 1 / 60);
      game.newRun();
      playShot(game, renderer);
      game.world.tier = 1; // palette tier change: cached layers cross-dissolve
      for (let i = 0; i < 70; i++) renderer.draw(1, 1 / 60);
      playShot(game, renderer);
      assert.ok(calls(ctx, 'drawImage') > 0, `${theme}/${mode}: cached layers are blitted`);
      assert.ok(stats.canvases > 0 && stats.canvases < 60, `${theme}/${mode}: ${stats.canvases} offscreen canvases`);
      assert.ok(stats.maxCanvasPx <= 2048 * 2048, `${theme}/${mode}: largest offscreen canvas ${stats.maxCanvasPx}px`);
      assert.equal(renderer.getQuality().layersBuiltInFlight, 0);
      renderer.destroy();
    }
  });

  test(`${mode}: steady-state PRO frames reuse cached gradients (no per-frame gradient churn)`, () => {
    for (const theme of THEME_IDS) {
      const { renderer, ctx } = setup({ stadium: proId(theme), mode });
      for (let i = 0; i < 90; i++) renderer.draw(1, 1 / 60);
      const g0 = gradients(ctx);
      for (let i = 0; i < 60; i++) renderer.draw(1, 1 / 60);
      const n = gradients(ctx) - g0;
      assert.ok(n <= 6, `${theme}/${mode}: created ${n} gradients in 60 settled frames`);
      renderer.destroy();
    }
  });
}

test('every ball skin renders in game under every PRO stadium light, in both layouts', () => {
  for (const theme of THEME_IDS) {
    for (const mode of MODES) {
      const { renderer, ctx } = setup({ seed: 7, stadium: proId(theme), mode });
      for (const id of BALL_IDS) {
        renderer.setSkin(id);
        const n0 = ctx.__calls.n;
        renderer.draw(1, 1 / 60);
        assert.ok(ctx.__calls.n > n0 + 50, `${theme}/${mode}/${id}`);
      }
      renderer.destroy();
    }
    for (const id of BALL_IDS) drawBallPreview(stubCtx(), id, 72, 0.4, 'pro');
  }
});

test('quality tiers: forced low caps the backing store at 2x DPR and draws less; high restores it', () => {
  for (const mode of MODES) {
    const { game, renderer, canvas, ctx } = setup({ stadium: 'pro_night', mode });
    for (let i = 0; i < 30; i++) renderer.draw(1, 1 / 60);
    assert.equal(renderer.getQuality().tier, 'high');
    assert.equal(canvas.width, 1170);
    let n0 = ctx.__calls.n;
    renderer.draw(1, 1 / 60);
    const highCalls = ctx.__calls.n - n0;
    const pat0 = calls(ctx, 'createPattern');
    renderer.setQuality('low');
    assert.equal(renderer.getQuality().tier, 'low');
    assert.equal(renderer.getQuality().mode, 'low');
    assert.equal(canvas.width, 780);
    assert.equal(canvas.height, 1688);
    for (let i = 0; i < 30; i++) renderer.draw(1, 1 / 60);
    n0 = ctx.__calls.n;
    renderer.draw(1, 1 / 60);
    assert.ok(ctx.__calls.n - n0 < highCalls, `${mode}: low tier is lighter (${ctx.__calls.n - n0} vs ${highCalls})`);
    assert.equal(calls(ctx, 'createPattern'), pat0, 'no turf grain in the low tier');
    game.newRun();
    playShot(game, renderer);
    renderer.setQuality('high');
    assert.equal(renderer.getQuality().tier, 'high');
    assert.equal(canvas.width, 1170);
    playShot(game, renderer);
    renderer.setQuality('auto');
    assert.equal(renderer.getQuality().mode, 'auto');
    renderer.destroy();
  }
});

test('auto quality on a PRO stadium: cheap frames stay high; slow frames drop to low only at a calm moment', () => {
  const realPerf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let clock = 0;
  let step = 0.05;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => (clock += step) }, configurable: true, writable: true });
  try {
    for (const mode of MODES) {
      step = 0.05;
      const { game, renderer } = setup({ stadium: 'pro_sunset', mode });
      for (let i = 0; i < 400; i++) renderer.draw(1, 1 / 60);
      assert.equal(renderer.getQuality().tier, 'high', 'fast device keeps the full tier');
      game.newRun();
      let guard = 0;
      while (game.phase !== 'aim') { game.step(STEP); renderer.draw(1, STEP); if (++guard > 3000) throw new Error('no aim'); }
      step = 8;
      for (let i = 0; i < 400; i++) renderer.draw(1, 1 / 60);
      const q = renderer.getQuality();
      assert.equal(q.tier, 'high', 'never switches while the player is aiming');
      assert.equal(q.pending, true, 'the switch is pending');
      game.idle({ mode });
      renderer.draw(1, 1 / 60);
      assert.equal(renderer.getQuality().tier, 'low', 'switches at the next calm moment');
      renderer.setTheme('sunset');
      assert.equal(renderer.getQuality().tier, 'high', 'retro never runs the low tier');
      renderer.destroy();
    }
  } finally {
    if (realPerf) Object.defineProperty(globalThis, 'performance', realPerf);
  }
});

for (const mode of MODES) {
  test(`${mode}: no cached layer is built while the ball is in flight, even across a tier change`, () => {
    for (const theme of THEME_IDS) {
      const { game, renderer } = setup({ seed: 11, stadium: proId(theme), mode });
      for (let i = 0; i < 240; i++) renderer.draw(1, 1 / 60);
      game.newRun();
      for (let s = 0; s < 4; s++) {
        let guard = 0;
        while (game.phase !== 'aim') { game.step(STEP); renderer.draw(1, STEP); if (++guard > 4000) throw new Error('no aim'); }
        game.world.marker.t = game.world.shot.band.tBest;
        assert.equal(game.tap(), true);
        guard = 0;
        while (game.phase === 'fly' && guard < 12) { game.step(STEP); renderer.draw(1, STEP); guard++; }
        if (game.phase === 'fly') game.world.tier += 1; // palette tier flips mid-flight
        guard = 0;
        while (game.phase !== 'aim' && game.phase !== 'over') { game.step(STEP); renderer.draw(1, STEP); if (++guard > 4000) throw new Error('stuck'); }
      }
      assert.equal(renderer.getQuality().layersBuiltInFlight, 0, `${theme}/${mode}: layers built mid-flight`);
      renderer.destroy();
    }
  });

  test(`${mode}: dev start round opens on its tier palette, pre-warmed on the menu, no mid-flight builds`, () => {
    for (const theme of THEME_IDS) {
      const { game, renderer } = setup({ seed: 13, stadium: proId(theme), mode });
      const startMade = 29; // round 30
      renderer.setWarmTier(Math.floor(startMade / CONFIG.scoring.tierEvery));
      for (let i = 0; i < 600; i++) renderer.draw(1, 1 / 60);
      game.newRun({ startMade });
      assert.equal(game.world.tier, Math.floor(startMade / CONFIG.scoring.tierEvery));
      renderer.draw(1, 1 / 60);
      assert.equal(renderer.getQuality().xfade, 1, `${theme}/${mode}: no cross-dissolve up from the menu tier`);
      playShot(game, renderer);
      playShot(game, renderer);
      assert.equal(renderer.getQuality().layersBuiltInFlight, 0, `${theme}/${mode}: layers built mid-flight`);
      game.newRun();
      renderer.draw(1, 1 / 60);
      assert.ok(renderer.getQuality().xfade < 1, `${theme}/${mode}: a normal restart fades back to tier 0`);
      renderer.destroy();
    }
  });
}

test('retro dev runs are unchanged: they still cross-dissolve up from the menu tier', () => {
  const { game, renderer } = setup({ stadium: 'night' });
  for (let i = 0; i < 10; i++) renderer.draw(1, 1 / 60);
  game.newRun({ startMade: 29 });
  renderer.draw(1, 1 / 60);
  assert.ok(renderer.getQuality().xfade < 1);
  renderer.destroy();
});

test('FIELD stands: the crowd is drawn from the sprite atlas (one drawImage per fan)', () => {
  const { game, renderer, ctx } = setup({ stadium: 'pro_day', mode: 'field' });
  for (let i = 0; i < 5; i++) renderer.draw(1, 1 / 60);
  const w = game.world;
  const pin = () => { const c = w.cam; c.x = c.px = w.post.x - 60; c.y = c.py = 0; c.zoom = c.pzoom = 1.25; };
  pin();
  renderer.draw(1, 1 / 60);
  pin();
  const d0 = calls(ctx, 'drawImage');
  renderer.draw(1, 1 / 60);
  assert.ok(calls(ctx, 'drawImage') - d0 > 150, `crowd sprites blitted (${calls(ctx, 'drawImage') - d0})`);
  renderer.destroy();
});

test('PRO previews draw through directLayers (no offscreen canvases), both layouts, every card size', () => {
  for (const s of CONFIG.catalog.stadiums.filter((x) => x.style === 'pro')) {
    for (const mode of MODES) {
      for (const [w, h] of [[176, 112], [300, 190]]) {
        const ctx = stubCtx();
        drawStadiumPreview(ctx, s.id, w, h, { mode });
        assert.ok(ctx.__calls.n > 150, `${s.id} ${mode} ${w}x${h}`);
        assert.equal(calls(ctx, 'fillText') >= 0, true);
      }
    }
  }
  // the old stub marked pro previews "PRO ART PENDING"; the real style never writes that tag
  const seen = [];
  const probe = new Proxy(stubCtx(), {
    get(t, p) {
      if (p === 'fillText') return (s) => { seen.push(String(s)); };
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  drawStadiumPreview(probe, 'pro_day', 300, 190, { mode: 'field' });
  assert.ok(!seen.some((s) => /PENDING/.test(s)), 'no placeholder tag');
});

test('360x640 and 430x932 viewports draw PRO frames in both layouts', () => {
  for (const [w, h] of [[360, 640], [430, 932]]) {
    for (const mode of MODES) {
      const { game, renderer } = setup({ w, h, stadium: 'pro_arcade', mode });
      for (let i = 0; i < 10; i++) renderer.draw(1, 1 / 60);
      game.newRun();
      playShot(game, renderer);
      assert.equal(renderer.getQuality().layersBuiltInFlight, 0);
      renderer.destroy();
    }
  }
});
