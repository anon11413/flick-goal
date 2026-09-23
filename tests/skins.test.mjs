import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import {
  BALL_SKINS, STADIUM_THEMES, drawBall, drawBallPreview, drawStadiumPreview, themePalette, mixColor, withAlpha,
  drawField, fieldProjection,
} from '../src/engine/skins.js';

/**
 * Stub 2D context: every method is a no-op that records its call; gradient
 * factories return objects with addColorStop. Throws on non-finite geometry so
 * NaN bugs in draw code are caught.
 */
function stubCtx() {
  const calls = { n: 0, byName: {} };
  const state = {};
  const gradient = () => ({ addColorStop(o, c) { if (!(o >= 0 && o <= 1)) throw new Error('bad stop'); if (typeof c !== 'string') throw new Error('bad color'); } });
  const handler = {
    get(_, prop) {
      if (prop === '__calls') return calls;
      if (prop in state) return state[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return (...args) => { record(prop, args); return gradient(); };
      }
      return (...args) => { record(prop, args); return undefined; };
    },
    set(_, prop, value) {
      if (prop === 'lineWidth' || prop === 'globalAlpha') {
        if (!Number.isFinite(value)) throw new Error(`non-finite ${String(prop)}`);
      }
      state[prop] = value;
      return true;
    },
  };
  function record(name, args) {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`non-finite arg to ${name}: ${args}`);
    }
    if ((name === 'arc' || name === 'ellipse') && args.slice(2, name === 'arc' ? 3 : 4).some((v) => v < 0)) {
      throw new Error(`negative radius in ${name}`);
    }
    calls.n++;
    calls.byName[name] = (calls.byName[name] || 0) + 1;
  }
  return new Proxy({}, handler);
}

test('BALL_SKINS keys equal the catalog ball ids', () => {
  const ids = CONFIG.catalog.balls.map((b) => b.id).sort();
  assert.deepEqual(Object.keys(BALL_SKINS).sort(), ids);
  assert.ok(ids.length >= 12);
});

test('STADIUM_THEMES keys equal the catalog stadium ids', () => {
  const ids = CONFIG.catalog.stadiums.map((s) => s.id).sort();
  assert.deepEqual(Object.keys(STADIUM_THEMES).sort(), ids);
  assert.ok(ids.length >= 5);
});

test('skin metadata is well formed', () => {
  for (const [id, s] of Object.entries(BALL_SKINS)) {
    assert.equal(s.id, id);
    assert.ok(['football', 'round'].includes(s.shape), id);
    assert.match(s.trail, /^#[0-9A-Fa-f]{6}$/, id);
    assert.ok(['none', 'fire', 'sparkle', 'frost', 'pixel'].includes(s.fx), id);
    assert.equal(typeof s.draw, 'function');
  }
  for (const [id, t] of Object.entries(STADIUM_THEMES)) {
    assert.equal(t.id, id);
    assert.ok(['clouds', 'night', 'snow', 'sunset', 'arcade'].includes(t.decor), id);
    assert.ok(t.palettes.length >= 4, id);
    for (const p of t.palettes) {
      for (const key of ['skyTop', 'skyBottom', 'ground', 'groundDark', 'line', 'post', 'accent', 'uiBg']) {
        assert.match(p[key], /^#[0-9A-Fa-f]{6}$/, `${id}.${key}`);
      }
    }
    assert.equal(typeof t.drawDecor, 'function');
  }
});

test('every ball draw runs against a stub ctx without throwing', () => {
  for (const id of Object.keys(BALL_SKINS)) {
    for (const [r, rot, time] of [[16, 0, 0], [8, 1.3, 2.5], [40, -2, 10], [1, 3, 0.1]]) {
      const ctx = stubCtx();
      BALL_SKINS[id].draw(ctx, r, time, rot);
      assert.ok(ctx.__calls.n > 3, id);
      drawBall(ctx, id, 10, 20, r, rot, time, 1.2, 0.8);
      drawBallPreview(ctx, id, 64, time);
    }
  }
  drawBall(stubCtx(), 'no-such-ball', 0, 0, 16, 0, 0); // falls back to classic
});

test('every stadium decor + preview draws against a stub ctx without throwing', () => {
  for (const id of Object.keys(STADIUM_THEMES)) {
    for (let tier = 0; tier < 6; tier++) {
      const ctx = stubCtx();
      const pal = themePalette(id, tier);
      for (const view of [
        { camX: 0, camY: 0, k: 1, w: 390, h: 844, groundY: 700 },
        { camX: 12345.6, camY: 500, k: 0.45, w: 360, h: 640, groundY: 1200 },
        { camX: -300, camY: -90, k: 1.2, w: 430, h: 932, groundY: -50 },
      ]) {
        STADIUM_THEMES[id].drawDecor(ctx, view, pal, tier * 3.7);
      }
      assert.ok(ctx.__calls.n > 10);
    }
    drawStadiumPreview(stubCtx(), id, 96, 64);
    drawStadiumPreview(stubCtx(), id, 320, 180);
  }
  drawStadiumPreview(stubCtx(), 'nope', 96, 64);
});

test('themePalette cycles tiers and falls back to day', () => {
  const day = STADIUM_THEMES.day.palettes;
  assert.equal(themePalette('day', 0), day[0]);
  assert.equal(themePalette('day', day.length), day[0]);
  assert.equal(themePalette('day', 1), day[1]);
  assert.equal(themePalette('unknown', 0), day[0]);
  assert.equal(themePalette('night', -1), STADIUM_THEMES.night.palettes[STADIUM_THEMES.night.palettes.length - 1]);
});

test('color helpers', () => {
  assert.equal(mixColor('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mixColor('#FF0000', '#0000FF', 0), '#ff0000');
  assert.equal(withAlpha('#FFFFFF', 0.5), 'rgba(255,255,255,0.5)');
});

test('every stadium has a field style and an end-zone colour per palette', () => {
  for (const [id, t] of Object.entries(STADIUM_THEMES)) {
    assert.ok(t.field && ['grass', 'snow', 'sand', 'neon'].includes(t.field.surface), id);
    assert.ok(Array.isArray(t.field.words) && t.field.words.length >= 1, id);
    for (const p of t.palettes) assert.match(p.zone, /^#[0-9A-Fa-f]{6}$/, `${id}.zone`);
  }
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

test('drawField runs for every stadium / tier / view against a stub ctx', () => {
  for (const id of Object.keys(STADIUM_THEMES)) {
    for (let tier = 0; tier < 5; tier++) {
      const pal = themePalette(id, tier);
      for (const fv of [
        { w: 390, h: 844, k: 1.1, camX: -60, gy: 560, endX: 280, spot: { x: 0, alpha: 1 } },
        { w: 360, h: 640, k: 0.45, camX: -500, gy: 470, endX: 0, spot: { x: -430, alpha: 0.5 } },
        { w: 430, h: 932, k: 0.8, camX: 250, gy: 1400, endX: 300 }, // ground below the view
        { w: 390, h: 844, k: 0.7, camX: 12345, gy: -80, endX: 100 }, // looking far past the end line
        { w: 96, h: 64, k: 0.32, camX: -222, gy: 45, endX: 0, tilt: 0.22, detail: 0.2 },
      ]) {
        const ctx = stubCtx();
        const pr = drawField(ctx, id, pal, fv, tier * 1.3);
        assert.ok(Number.isFinite(pr.farY));
        if (fv.gy < fv.h && fv.camX < 1000) assert.ok(ctx.__calls.n > 20, `${id} draws the field`);
      }
    }
  }
});
