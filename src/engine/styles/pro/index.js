// Flick Goal — PRO art style: the try/pro-graphics stylized-realism look re-authored for the v2
// on-field layouts (FIELD: end zone, net, stands past the end line, photographers; ENDLESS:
// the endless field). Implements the style interface of V2_SPEC.md §5.3 / §15.
//
// Performance model (pro-graphics architecture, V2_SPEC §5.5):
//  * static scenery (clouds, stadium bowl + crowd, scoreboard, towers, mountains, pines, palms,
//    skyline, foreground strip) is painted once per palette tier / size into cached layers
//    (f.layers, keys 'pro:*') and blitted; the core never builds a layer mid-flight and pre-warms
//    the next tier in calm phases; the field itself is vector geometry in perspective (it changes
//    with every camera move) finished with cached unit gradients and a device-pixel grain pattern;
//  * the end-zone crowd is one drawImage per fan from a pre-rendered sprite atlas;
//  * no per-frame shadowBlur / ctx.filter (only inside one-off layer builds);
//  * adaptive: the core runs the quality monitor; f.lowQ drops grain, light shafts, big blooms,
//    the foreground strip and layer crossfades, and caps the backing store at 2x.

import { PRO_DECOR } from './decor.js';
import { drawProFieldLayout, drawProEndlessLayout } from './field.js';
import {
  drawPost, drawPostShadow, drawNet, drawTee, drawCoin, drawTrail, drawBallShadow, drawBall,
} from './props.js';
import { drawEffects, onFx } from './fx.js';
import { drawSky, drawFront, drawFinish } from './finish.js';
import { PRO_BALLS, previewProBall } from './balls.js';
import { lightOf } from './lights.js';

const pro = {
  id: 'pro',
  adaptive: true,

  drawSky,

  drawBackground(ctx, f) {
    const view = {
      camX: f.camX, camY: f.camY, k: f.k, w: f.w, h: f.h, groundY: f.proj.farY,
      lo: !!f.lowQ, postX: Number.isFinite(f.postX) ? f.postX : null, warm: !f.inFlight && !f.preview,
    };
    ctx.save();
    (PRO_DECOR[f.themeId] || PRO_DECOR.day)(ctx, view, f.pal, f.time, f.layers);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },

  drawField(ctx, f) {
    ctx.save();
    if (f.mode === 'endless') drawProEndlessLayout(ctx, f);
    else drawProFieldLayout(ctx, f);
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
  drawFront,
  drawFinish,

  onFx,

  balls: PRO_BALLS,
  lightFor(themeId) { return lightOf(themeId).ball; },
  previewBall(ctx, skinId, size, time = 0) { previewProBall(ctx, skinId, size, time); },
};

export default Object.freeze(pro);
