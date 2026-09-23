// Flick Goal — RETRO art style: the flat try/field-posts look for both layouts (FIELD + ENDLESS).
// Implements the style interface of V2_SPEC.md §5.3; drawn every frame, no layer caches, no
// adaptive quality (retro must stay as fast as the v1 renderer).

import { THEMES } from '../../themes.js';
import { drawRetroDecor } from './decor.js';
import { drawFieldLayout, drawEndlessLayout } from './field.js';
import {
  drawPost, drawPostShadow, drawNet, drawTee, drawCoin, drawTrail, drawBallShadow, drawBall,
} from './props.js';
import { drawEffects, onFx } from './fx.js';
import { RETRO_BALLS, previewRetroBall } from './balls.js';

const fieldOf = (themeId) => (THEMES[themeId] || THEMES.day).field;

const retro = {
  id: 'retro',
  adaptive: false,

  drawSky(ctx, f) {
    const g = ctx.createLinearGradient(0, 0, 0, f.h);
    g.addColorStop(0, f.pal.skyTop);
    g.addColorStop(1, f.pal.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, f.w, f.h);
  },

  drawBackground(ctx, f) {
    ctx.save();
    drawRetroDecor(ctx, f.themeId, { camX: f.camX, camY: f.camY, k: f.k, w: f.w, h: f.h, groundY: f.proj.farY }, f.pal, f.time);
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  drawField(ctx, f) {
    ctx.save();
    if (f.mode === 'endless') drawEndlessLayout(ctx, fieldOf(f.themeId), f.pal, f.fv, f.proj, f.time, f.cfg);
    else drawFieldLayout(ctx, fieldOf(f.themeId), f.pal, f.fv, f.proj, f.time, f.cfg);
    ctx.restore();
  },

  drawNet,
  drawPostShadow,
  drawPost,
  drawTee,
  drawCoin,
  drawTrail,
  drawBallShadow,
  drawBall,
  drawEffects,
  drawFront() {},
  drawFinish() {},

  onFx,

  balls: RETRO_BALLS,
  lightFor() { return null; },
  previewBall: previewRetroBall,
};

export default Object.freeze(retro);
