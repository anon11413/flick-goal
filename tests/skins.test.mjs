import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import {
  BALL_SKINS, BALL_META, STADIUM_THEMES, THEMES, drawBall, drawBallPreview, drawStadiumPreview, themePalette,
  mixColor, withAlpha, drawField, fieldProjection, stadiumInfo, styleOf, themeOf, stadiumDisplayName,
  drawAimSliderPreview,
} from '../src/engine/skins.js';
import { endlessLineXs, endlessNumberAt } from '../src/engine/field.js';
import { drawRetroDecor } from '../src/engine/styles/retro/decor.js';
import { stubCtx } from './_stub.mjs';

test('BALL_SKINS / BALL_META keys equal the catalog ball ids', () => {
  const ids = CONFIG.catalog.balls.map((b) => b.id).sort();
  assert.deepEqual(Object.keys(BALL_SKINS).sort(), ids);
  assert.deepEqual(Object.keys(BALL_META).sort(), ids);
  assert.ok(ids.length >= 12);
});

test('base themes: five themes, every catalog stadium resolves to one of them', () => {
  assert.deepEqual(Object.keys(STADIUM_THEMES).sort(), ['arcade', 'day', 'night', 'snow', 'sunset']);
  assert.equal(STADIUM_THEMES, THEMES);
  for (const s of CONFIG.catalog.stadiums) {
    const info = stadiumInfo(s.id);
    assert.equal(info.id, s.id);
    assert.ok(THEMES[info.theme], s.id);
    assert.ok(['retro', 'pro'].includes(info.style), s.id);
    assert.equal(info.style, s.style, s.id);
    assert.equal(themeOf(s.id), s.theme);
    assert.equal(styleOf(s.id), s.style);
  }
  // every theme exists in both styles
  for (const th of Object.keys(THEMES)) {
    for (const st of ['retro', 'pro']) {
      assert.ok(CONFIG.catalog.stadiums.some((s) => s.theme === th && s.style === st), `${th} ${st}`);
    }
  }
  assert.deepEqual(stadiumInfo('nope'), { id: 'day', style: 'retro', theme: 'day', name: 'Day Game' });
  assert.equal(stadiumInfo('night').style, 'retro');
  assert.equal(stadiumDisplayName('pro_night'), 'Night Lights HD');
  assert.equal(stadiumDisplayName('night'), 'Night Lights');
});

test('skin metadata is well formed', () => {
  for (const [id, s] of Object.entries(BALL_SKINS)) {
    assert.equal(s.id, id);
    assert.ok(['football', 'round'].includes(s.shape), id);
    assert.match(s.trail, /^#[0-9A-Fa-f]{6}$/, id);
    assert.ok(['none', 'fire', 'sparkle', 'frost', 'pixel'].includes(s.fx), id);
    assert.equal(typeof s.draw, 'function');
  }
  for (const [id, t] of Object.entries(THEMES)) {
    assert.equal(t.id, id);
    assert.ok(t.palettes.length >= 4, id);
    for (const p of t.palettes) {
      for (const key of ['skyTop', 'skyBottom', 'ground', 'groundDark', 'line', 'post', 'accent', 'uiBg', 'zone']) {
        assert.match(p[key], /^#[0-9A-Fa-f]{6}$/, `${id}.${key}`);
      }
    }
    assert.ok(t.field && ['grass', 'snow', 'sand', 'neon'].includes(t.field.surface), id);
    assert.ok(Array.isArray(t.field.words) && t.field.words.length >= 1, id);
  }
});

test('every ball draw runs against a stub ctx in both styles without throwing', () => {
  for (const id of Object.keys(BALL_SKINS)) {
    for (const [r, rot, time] of [[16, 0, 0], [8, 1.3, 2.5], [40, -2, 10], [1, 3, 0.1]]) {
      const ctx = stubCtx();
      BALL_SKINS[id].draw(ctx, r, time, rot);
      assert.ok(ctx.__calls.n > 3, id);
      for (const style of ['retro', 'pro']) {
        drawBall(ctx, id, 10, 20, r, rot, time, 1.2, 0.8, style);
        drawBallPreview(ctx, id, 64, time, style);
      }
    }
  }
  drawBall(stubCtx(), 'no-such-ball', 0, 0, 16, 0, 0); // falls back to classic
  drawBall(stubCtx(), 'classic', 0, 0, 16, 0, 0, 1, 1, 'no-such-style');
});

test('every retro decor + every catalog stadium preview (both layouts) draws against a stub ctx', () => {
  for (const id of Object.keys(THEMES)) {
    for (let tier = 0; tier < 6; tier++) {
      const ctx = stubCtx();
      const pal = themePalette(id, tier);
      for (const view of [
        { camX: 0, camY: 0, k: 1, w: 390, h: 844, groundY: 700 },
        { camX: 12345.6, camY: 500, k: 0.45, w: 360, h: 640, groundY: 1200 },
        { camX: -300, camY: -90, k: 1.2, w: 430, h: 932, groundY: -50 },
      ]) {
        drawRetroDecor(ctx, id, view, pal, tier * 3.7);
      }
      assert.ok(ctx.__calls.n > 10);
    }
  }
  for (const s of CONFIG.catalog.stadiums) {
    for (const [w, h] of [[96, 64], [176, 112], [320, 180]]) {
      const ctx = stubCtx();
      drawStadiumPreview(ctx, s.id, w, h);
      assert.ok(ctx.__calls.n > 30, `${s.id} ${w}x${h}`);
      drawStadiumPreview(stubCtx(), s.id, w, h, { mode: 'endless', time: 3 });
    }
  }
  drawStadiumPreview(stubCtx(), 'nope', 96, 64);
  for (const t of [0, 0.4, 1.7, 5]) drawAimSliderPreview(stubCtx(), 320, 150, t);
});

test('themePalette accepts catalog ids and base theme ids, cycles tiers and falls back to day', () => {
  const day = THEMES.day.palettes;
  assert.equal(themePalette('day', 0), day[0]);
  assert.equal(themePalette('day', day.length), day[0]);
  assert.equal(themePalette('day', 1), day[1]);
  assert.equal(themePalette('unknown', 0), day[0]);
  assert.equal(themePalette('pro_day', 1), day[1]);
  assert.equal(themePalette('pro_night', 0), THEMES.night.palettes[0]);
  assert.equal(themePalette('night', -1), THEMES.night.palettes[THEMES.night.palettes.length - 1]);
});

test('color helpers', () => {
  assert.equal(mixColor('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mixColor('#FF0000', '#0000FF', 0), '#ff0000');
  assert.equal(withAlpha('#FFFFFF', 0.5), 'rgba(255,255,255,0.5)');
  assert.equal(withAlpha('#FFFFFF', 0.5), 'rgba(255,255,255,0.5)', 'memoised value is stable');
});

test('fieldProjection: play line keeps world scale, far side recedes, near side comes forward', () => {
  const fv = { w: 390, h: 844, k: 0.9, camX: -40, gy: 560, endX: 300 };
  const pr = fieldProjection(fv);
  const [x0, y0] = pr.pt(100, 0);
  assert.ok(Math.abs(x0 - (100 + 40) * 0.9) < 1e-9 && Math.abs(y0 - 560) < 1e-9, 'z = 0 is the exact world mapping');
  const far = pr.pt(100, CONFIG.field.halfWidth);
  const near = pr.pt(100, -CONFIG.field.halfWidth);
  assert.ok(far[1] < y0 && near[1] > y0);
  assert.ok(pr.farY < far[1], 'far wall top above the far sideline');
  assert.ok(pr.xMin < fv.camX && pr.xMax > fv.camX + fv.w / fv.k);
});

test('drawField (FIELD + ENDLESS layouts) runs for every theme / tier / view against a stub ctx', () => {
  for (const id of Object.keys(THEMES)) {
    for (let tier = 0; tier < 5; tier++) {
      const pal = themePalette(id, tier);
      for (const fv of [
        { w: 390, h: 844, k: 1.1, camX: -60, gy: 560, endX: 280, originX: 0, spot: { x: 0, alpha: 1 } },
        { w: 360, h: 640, k: 0.45, camX: -500, gy: 470, endX: 0, originX: 0, spot: { x: -430, alpha: 0.5 } },
        { w: 430, h: 932, k: 0.8, camX: 250, gy: 1400, endX: 300, originX: 0 }, // ground below the view
        { w: 390, h: 844, k: 0.7, camX: 12345, gy: -80, endX: 100, originX: 0 }, // far past the end line
        { w: 390, h: 844, k: 0.6, camX: 50000, gy: 600, endX: 100, originX: 0 }, // endless: 6,600+ yards
        { w: 96, h: 64, k: 0.32, camX: -222, gy: 45, endX: 0, originX: 0, tilt: 0.22, detail: 0.2 },
      ]) {
        for (const mode of ['field', 'endless']) {
          const ctx = stubCtx();
          const pr = drawField(ctx, id, pal, { ...fv, mode }, tier * 1.3);
          assert.ok(Number.isFinite(pr.farY));
          if (fv.gy < fv.h && fv.gy > 0 && (mode === 'endless' || fv.camX < 1000)) assert.ok(ctx.__calls.n > 20, `${id} ${mode} draws the field`);
        }
      }
    }
  }
});

test('endless field helpers: 5-yard lines anchored at the origin, numbers count up forever', () => {
  const U = CONFIG.field.yard;
  const xs = endlessLineXs(-100, 400, 0);
  assert.ok(xs.length > 5);
  for (const { x, j } of xs) {
    assert.ok(Math.abs(x - j * 5 * U) < 1e-9);
    assert.ok(x >= -100 - 1e-9 && x <= 400 + 1e-9);
  }
  assert.ok(xs.some((m) => m.j === 0), 'the start line is included');
  assert.equal(endlessNumberAt(10 * U, 0), 10);
  assert.equal(endlessNumberAt(140 * U, 0), 140);
  assert.equal(endlessNumberAt(1000 * U + 30, 30), 1000);
  assert.equal(endlessNumberAt(-50, 0), 0);
  assert.deepEqual(endlessLineXs(10, 5, 0), []);
  const far = endlessLineXs(50000, 50500, 0);
  assert.ok(far.length > 0 && far.every((m) => Number.isFinite(m.x)));
});
