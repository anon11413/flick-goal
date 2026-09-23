// Style contract (V2_SPEC.md §5.3, §11.1): every registered art style implements the full
// interface, owns a skin for every catalog ball, and draws every scene variant (5 themes x
// 2 layouts x palette tiers x phone viewports) through the real renderer without throwing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createGame } from '../src/engine/game.js';
import { createRenderer } from '../src/engine/render.js';
import { makeRng } from '../src/engine/physics.js';
import { STYLES, STYLE_IDS, STYLE_FUNCTIONS, getStyle, registerStyle } from '../src/engine/styles/index.js';
import { THEMES } from '../src/engine/themes.js';
import { stadiumInfo } from '../src/engine/stadiums.js';
import { drawStadiumPreview, drawBallPreview } from '../src/engine/preview.js';
import { stubCanvas, stubCtx, canvasFactory } from './_stub.mjs';

const STEP = 1 / CONFIG.sim.hz;
const BALL_IDS = CONFIG.catalog.balls.map((b) => b.id).sort();

test('registry: retro + pro registered, unknown -> retro, registerStyle validates', () => {
  assert.deepEqual([...STYLE_IDS], ['retro', 'pro']);
  assert.deepEqual(Object.keys(STYLES).sort(), ['pro', 'retro']);
  assert.equal(getStyle('nope').id, 'retro');
  assert.equal(registerStyle({ id: 'broken' }), false);
  assert.equal(getStyle('broken').id, 'retro');
});

for (const id of STYLE_IDS) {
  const style = getStyle(id);

  test(`style ${id}: implements the whole interface and every catalog ball`, () => {
    assert.equal(style.id, id);
    assert.equal(typeof style.adaptive, 'boolean');
    for (const fn of STYLE_FUNCTIONS) assert.equal(typeof style[fn], 'function', `${id}.${fn}`);
    assert.deepEqual(Object.keys(style.balls).sort(), BALL_IDS);
    for (const b of BALL_IDS) {
      assert.equal(typeof style.balls[b].draw, 'function');
      for (const th of Object.keys(THEMES)) {
        const ctx = stubCtx();
        style.balls[b].draw(ctx, 16, 1.2, 0.7, style.lightFor(th));
        assert.ok(ctx.__calls.n > 2, `${id}/${b} draws`);
      }
      drawBallPreview(stubCtx(), b, 64, 0.5, id);
    }
  });

  test(`style ${id}: every theme x layout x tier x viewport draws a full frame sequence`, () => {
    const fac = canvasFactory();
    for (const theme of Object.keys(THEMES)) {
      const stadium = CONFIG.catalog.stadiums.find((s) => s.theme === theme && s.style === id).id;
      for (const mode of ['field', 'endless']) {
        for (const [w, h] of [[390, 844], [360, 640]]) {
          const game = createGame({ rng: makeRng(theme.length * 7 + w) });
          game.setViewport(w, h);
          const { canvas, ctx } = stubCanvas(w, h);
          const r = createRenderer(canvas, game, { cfg: CONFIG, createCanvas: fac.create });
          r.resize(w, h, 3);
          r.setTheme(stadium);
          r.setSkin(BALL_IDS[(theme.length + w) % BALL_IDS.length]);
          assert.equal(r.debugState().style, id);
          game.idle({ mode });
          r.setAimAssist('fade');
          for (let i = 0; i < 3; i++) { game.step(STEP); r.draw(0.5, 1 / 60); }
          game.newRun();
          let sawOld = false;
          let sawSwoop = false;
          for (let tier = 0; tier < 5; tier++) {
            game.world.tier = tier;
            let guard = 0;
            while (game.phase !== 'aim' && guard++ < 600) {
              game.step(STEP);
              if (guard % 4 === 0) r.draw(0.5, 1 / 60);
              if (game.world.swoop) sawSwoop = true;
            }
            for (let i = 0; i < 6; i++) { game.step(STEP); r.draw(0.3, 1 / 60); }
            game.world.marker.t = game.world.shot.band.tBest;
            game.tap();
            guard = 0;
            const teeBefore = game.world.teeX;
            const shotBefore = game.world.shot;
            while ((game.world.shot === shotBefore || game.phase !== 'intro') && guard++ < 900) {
              game.step(STEP);
              if (guard % 5 === 0) r.draw(0.7, 1 / 60);
            }
            if (game.world.oldPost) sawOld = true;
            assert.ok(game.world.shot !== shotBefore, `${id}/${theme}/${mode} next shot`);
            if (mode === 'endless') assert.ok(game.world.teeX > teeBefore);
          }
          if (mode === 'field') assert.ok(sawSwoop, 'field swoop exercised');
          else assert.ok(sawOld, 'endless old post exercised');
          // miss + game over frames
          while (game.phase !== 'aim') game.step(STEP);
          game.world.marker.t = 0;
          game.tap();
          for (let i = 0; i < 260; i++) { game.step(STEP); if (i % 6 === 0) r.draw(0.5, 1 / 60); }
          assert.ok(ctx.__calls.n > 1000);
          r.destroy();
        }
      }
    }
    for (const c of fac.made) assert.ok(c.width <= 2048 && c.height <= 2048, 'offscreen canvases stay <= 2048 px');
  });
}

test('every catalog stadium resolves to an existing style + theme and previews through it', () => {
  for (const s of CONFIG.catalog.stadiums) {
    const info = stadiumInfo(s.id);
    assert.ok(STYLES[info.style], s.id);
    assert.ok(THEMES[info.theme], s.id);
    for (const mode of ['field', 'endless']) {
      const ctx = stubCtx();
      drawStadiumPreview(ctx, s.id, 176, 112, { mode });
      assert.ok(ctx.__calls.n > 50, `${s.id} ${mode} preview`);
    }
  }
});
