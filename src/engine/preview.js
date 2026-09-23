// Flick Goal — store previews drawn through the REAL style code (V2_SPEC.md §5.7), so every
// stadium / ball card shows exactly what the game will draw with that style.
//  * drawStadiumPreview: a synthetic frame (fixed camera, FIELD layout by default: end zone +
//    post on the end line on the right, a ball in flight toward it) painted with the stadium's
//    style functions in the renderer's order (sky, background, field, net, post, tee, ball).
//  * drawBallPreview: the style's own ball skin (retro flat / pro shaded).
//  * drawAimSliderPreview: the Aim Slider store card (slider + guide dots, animated by time).

import { CONFIG } from '../config.js';
import { fieldProjection } from './field.js';
import { basePalette, palKeyOf, THEMES } from './themes.js';
import { stadiumInfo } from './stadiums.js';
import { getStyle } from './styles/index.js';
import { directLayers } from './layers.js';
import { railGeometry, drawRailTrack, drawGuideDots } from './aimDraw.js';
import { solveShot, makeRng } from './physics.js';

const TAU = Math.PI * 2;

/**
 * Mini scene for store cards (w x h css px, caller applied dpr). opts.mode 'field' | 'endless',
 * opts.time animation clock, opts.style forces an art style (QA).
 */
export function drawStadiumPreview(ctx, stadiumId, w, h, { mode = 'field', time = 1.3, style: forceStyle = null } = {}, cfg = CONFIG) {
  const info = stadiumInfo(stadiumId, cfg);
  const style = getStyle(forceStyle || info.style);
  const themeId = info.theme;
  const pal = basePalette(themeId, 0);
  const k = w / 300;
  const gy = Math.round(h * 0.7);
  const endX = 0;
  const camX = endX - (w * 0.74) / k;
  const camY = -(h - gy) / k;
  const sx = (x) => (x - camX) * k;
  const sy = (y) => h - (y - camY) * k;
  const endless = mode === 'endless';
  const fv = {
    w, h, k, camX, gy, endX: endless ? null : endX, originX: endX - 40 * cfg.field.yard, mode: endless ? 'endless' : 'field',
    tilt: 0.22, detail: w >= 200 ? 1 : 0.2,
    spot: null,
  };
  const proj = fieldProjection(fv, cfg);
  const f = {
    cfg, time, dt: 0, w, h, dpr: 1, edpr: 1, k, camX, camY, viewW: w / k, sx, sy, gy,
    mode: fv.mode, fieldEnd: fv.endX, originX: fv.originX, proj, fv, spot: null,
    pal, palKey: palKeyOf(themeId, 0), theme: THEMES[themeId], themeId, styleId: style.id,
    lowQ: true, phase: 'idle', inFlight: false, postX: sx(0),
    layers: directLayers(pal), makeCanvas: () => null, world: null, preview: true,
  };
  // post sized to the card: crossbar ~30 % of the card height above the grass, top below the badge
  const top = Math.max(40, (gy - h * 0.14) / k);
  const bar = Math.max(20, (h * 0.3) / k);
  const post = { x: 0, bar, top };
  const R = cfg.physics.ballRadius;
  const teeX = -(0.56 * w) / k;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  style.drawSky(ctx, f);
  // decor is authored for phone-sized views: draw it at phone scale, shrunk into the card
  const s = Math.max(0.3, Math.min(1, w / 300));
  ctx.save();
  ctx.scale(s, s);
  const fd = {
    ...f, w: w / s, h: h / s, k: w / 320, camX: 0, camY: 0,
    proj: { ...proj, farY: proj.farY / s },
  };
  style.drawBackground(ctx, fd);
  ctx.restore();
  ctx.globalAlpha = 1;
  style.drawField(ctx, f);
  ctx.globalAlpha = 1;
  if (!endless) style.drawNet(ctx, post, f, { t: 9, y: 0, amp: 0 });
  style.drawPostShadow(ctx, post, f, 1);
  const bx = -(0.44 * w) / k; // ball in flight toward the post
  const st = { X: sx(bx), Y: sy(0.34 * h / k + R), r: Math.max(3, h * 0.075), rot: -0.6, sx: 1, sy: 1, angle: 0, lift: 0, alpha: 1, wx: bx, wy: 0.34 * h / k };
  style.drawBallShadow(ctx, st, f);
  style.drawPost(ctx, post, 'far', f, 1);
  style.drawTee(ctx, teeX, f, 1);
  style.drawBall(ctx, 'classic', st, f);
  style.drawPost(ctx, post, 'near', f, 1);
  style.drawFront(ctx, f);
  style.drawFinish(ctx, f);
  ctx.restore();
}

/** Store-card ball preview centred in a size x size box, in an art style ('retro' | 'pro'). */
export function drawBallPreview(ctx, skinId, size, time = 0, styleId = 'retro') {
  getStyle(styleId).previewBall(ctx, skinId, size, time);
}

// ---------------------------------------------------------------- Aim Slider card
let demoShot = null;
function aimDemoShot(cfg) {
  if (!demoShot) {
    demoShot = solveShot({ teeX: 0, made: 2, rng: makeRng(11) }, cfg);
  }
  return demoShot;
}

/**
 * Aim Slider store card: a ball on its tee, the power slider with the green band and a needle
 * sweeping back and forth, and the guide dots it teaches (w x h css px).
 */
export function drawAimSliderPreview(ctx, w, h, time = 0, cfg = CONFIG) {
  const shot = aimDemoShot(cfg);
  const pal = basePalette('day', 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, pal.skyTop);
  g.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const gy = h * 0.82;
  ctx.fillStyle = pal.ground;
  ctx.fillRect(0, gy, w, h - gy);
  ctx.fillStyle = pal.groundDark;
  for (let x = -((time * 20) % 40); x < w; x += 80) ctx.fillRect(x, gy, 40, h - gy);
  // ball on a tee at the left
  const r = Math.max(6, h * 0.075);
  const bx = w * 0.16;
  const by = gy - r * 1.35;
  ctx.fillStyle = pal.accent;
  ctx.beginPath();
  ctx.moveTo(bx - r * 0.7, gy - r * 0.55);
  ctx.lineTo(bx + r * 0.7, gy - r * 0.55);
  ctx.lineTo(bx + r * 0.3, gy);
  ctx.lineTo(bx - r * 0.3, gy);
  ctx.closePath();
  ctx.fill();
  getStyle('retro').drawBall(ctx, 'classic', { X: bx, Y: by, r, rot: -1.15, sx: 1, sy: 1, angle: 0, alpha: 1 }, { time, cfg });
  // needle ping-pongs over the rail; slow down while it crosses the band so it reads
  const u = (time * 0.45) % 2;
  const t = u < 1 ? u : 2 - u;
  // rail sized to fit between the ball and the card top (no clamp shift), like in game
  const RL = cfg.rail;
  const margin = 10;
  const fitLen = Math.max(60, (by + RL.offsetY - margin - RL.thickness / 2) / Math.sin(RL.angleDeg * Math.PI / 180));
  const L = Math.min(w * 0.62, fitLen);
  const railCfg = { ...cfg, rail: { ...RL, lengthFrac: L / w, minLen: L, maxLen: L, edgeMargin: margin } };
  const geom = railGeometry({ x: bx, y: by }, w, h, railCfg);
  const inBand = t >= shot.band.lo && t <= shot.band.hi;
  drawRailTrack(ctx, geom, { ...shot, bandAlpha: 0.95 }, t, 1, {
    accent: pal.accent, lockColor: '#39D98A', locked: inBand, markerPop: 0, time,
  }, railCfg);
  drawGuideDots(ctx, shot, { x: bx, y: by }, t, 1, 0, cfg);
  // tiny sparkle when the needle is in the green
  if (inBand) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const px = geom.x0 + Math.cos(geom.ang) * t * geom.L;
    const py = geom.y0 - Math.sin(geom.ang) * t * geom.L - geom.th;
    ctx.beginPath();
    ctx.arc(px, py - 4, 2.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
