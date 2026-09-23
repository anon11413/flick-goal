// Flick Goal — RETRO style: flat props drawn in world space through the frame's camera:
// goal posts (+ the ENDLESS painted base disc), kicking net (FIELD), tee, coin pickup, ball
// shadow, ball and trail. Every function takes the main ctx and the frame `f` (render.js §5.2).

import { mixColor, withAlpha, roundRectPath } from '../../paint.js';
import { groundFrame, TEE_H } from '../../field.js';
import { ballMeta } from '../../themes.js';
import { RETRO_BALLS } from './balls.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function ribbon(ctx, x, y, k, color, phase, time) {
  const wv = Math.sin(time * 9 + phase);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + 2 * k);
  ctx.quadraticCurveTo(x + 10 * k, y + (2 + wv * 3) * k, x + (19 + wv * 2) * k, y + (6 + wv * 2) * k);
  ctx.quadraticCurveTo(x + 10 * k, y + (9 - wv * 2) * k, x, y + 13 * k);
  ctx.closePath();
  ctx.fill();
}

/**
 * ENDLESS only: the painted team-colour disc under a post standing on the open field (drawn
 * with the post shadows, so the ball's shadow lies on top of it). pop scales it with the post.
 */
export function drawPostShadow(ctx, post, f, pop = 1) {
  if (!post || f.mode !== 'endless') return;
  const X = f.sx(post.x);
  if (X < -120 || X > f.w + 120) return;
  const r = ((f.cfg.endless && f.cfg.endless.discRadius) || 22) * Math.max(0.001, Math.min(1.2, pop));
  const pal = f.pal;
  ctx.save();
  groundFrame(ctx, f.proj, post.x, 0, 'near');
  ctx.beginPath();
  ctx.ellipse(0, 0, r + 2, r + 2, 0, 0, TAU);
  ctx.fillStyle = withAlpha('#FFFFFF', 0.9);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r, 0, 0, TAU);
  ctx.fillStyle = withAlpha(pal.zone || pal.accent, 0.85);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.55, r * 0.55, 0, 0, TAU);
  ctx.fillStyle = withAlpha('#FFFFFF', 0.16);
  ctx.fill();
  ctx.restore();
}

/** part: 'far' (base, stem, far upright, crossbar) or 'near' (near upright). */
export function drawPost(ctx, post, part, f, pop = 1) {
  if (!post) return;
  const PH = f.cfg.physics;
  const pal = f.pal;
  const k = f.k;
  const X = f.sx(post.x);
  const G = f.sy(0);
  const B = f.sy(post.bar);
  const Tp = f.sy(post.top);
  if (X < -80 || X > f.w + 80) return;
  const o = PH.uprightOffset * k;
  ctx.save();
  if (pop < 1) {
    ctx.translate(X, G);
    ctx.scale(Math.max(0.001, pop), Math.max(0.001, pop));
    ctx.translate(-X, -G);
  }
  ctx.lineCap = 'round';
  const post1 = pal.post;
  if (part === 'far') {
    // padded base
    ctx.fillStyle = mixColor(pal.accent, '#000000', 0.12);
    roundRectPath(ctx, X - 10 * k, G - 40 * k, 20 * k, 40 * k + 4, 6 * k);
    ctx.fill();
    ctx.fillStyle = withAlpha('#FFFFFF', 0.35);
    ctx.fillRect(X - 6 * k, G - 34 * k, 3 * k, 28 * k);
    // stem
    ctx.strokeStyle = post1;
    ctx.lineWidth = Math.max(3, 2 * PH.stemRadius * k);
    ctx.beginPath();
    ctx.moveTo(X, G - 36 * k);
    ctx.lineTo(X, B);
    ctx.stroke();
    // far upright (darker, thinner -> depth)
    ctx.strokeStyle = mixColor(post1, '#000000', 0.2);
    ctx.lineWidth = Math.max(2.5, 7.5 * k);
    ctx.beginPath();
    ctx.moveTo(X - o, B);
    ctx.lineTo(X - o, Tp);
    ctx.stroke();
    ribbon(ctx, X - o, Tp, k, mixColor(pal.accent, '#000000', 0.15), 0, f.time);
    // crossbar
    ctx.strokeStyle = post1;
    ctx.lineWidth = Math.max(3, 2 * PH.crossbarRadius * k);
    ctx.beginPath();
    ctx.moveTo(X - o, B);
    ctx.lineTo(X + o, B);
    ctx.stroke();
    ctx.strokeStyle = withAlpha('#FFFFFF', 0.55);
    ctx.lineWidth = Math.max(1, 2.2 * k);
    ctx.beginPath();
    ctx.moveTo(X - o * 0.6, B - 2 * k);
    ctx.lineTo(X + o * 0.6, B - 2 * k);
    ctx.stroke();
  } else {
    ctx.strokeStyle = post1;
    ctx.lineWidth = Math.max(3, 9.5 * k);
    ctx.beginPath();
    ctx.moveTo(X + o, B);
    ctx.lineTo(X + o, Tp);
    ctx.stroke();
    ctx.strokeStyle = withAlpha('#FFFFFF', 0.55);
    ctx.lineWidth = Math.max(1, 2.4 * k);
    ctx.beginPath();
    ctx.moveTo(X + o - 2 * k, B - 4 * k);
    ctx.lineTo(X + o - 2 * k, Tp + 6 * k);
    ctx.stroke();
    ribbon(ctx, X + o, Tp, k, pal.accent, 1.7, f.time);
  }
  ctx.restore();
}

/**
 * FIELD only: kicking net behind the uprights (world x = post.x + field.netOffset), drawn in the
 * same pseudo-3D as the post: far pole, mesh, near pole. netFx = { t, y, amp } ripples it.
 */
export function drawNet(ctx, post, f, netFx) {
  if (!post) return;
  const F = f.cfg.field;
  const pal = f.pal;
  const k = f.k;
  const X = f.sx(post.x + F.netOffset);
  const o = F.netHalf * k;
  if (X + o < -20 || X - o > f.w + 20) return;
  const G = f.sy(0);
  const top = post.top + F.netAbove;
  const bot = post.bar * F.netBottomFrac;
  const Tp = f.sy(top);
  const Bt = f.sy(bot);
  const neon = f.themeId === 'arcade';
  const pole = neon ? mixColor(pal.line, '#000000', 0.35) : '#2E3440';
  const mesh = neon ? withAlpha(pal.zone || pal.accent, 0.55) : withAlpha('#FFFFFF', 0.4);
  const fx = netFx || { t: 9, y: 0, amp: 0 };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = mixColor(pole, '#000000', 0.25);
  ctx.lineWidth = Math.max(1.5, 3.2 * k);
  ctx.beginPath();
  ctx.moveTo(X - o, G);
  ctx.lineTo(X - o, Tp - 6 * k);
  ctx.stroke();
  const rip = fx.t < 1.2 ? fx.amp * Math.exp(-fx.t * 4.5) : 0;
  const dxAt = (y) => {
    if (rip <= 0.001) return 0;
    const d = (y - fx.y) / 70;
    return rip * 16 * k * Math.exp(-d * d) * Math.cos(fx.t * 22);
  };
  ctx.strokeStyle = mesh;
  ctx.lineWidth = Math.max(0.6, 0.8 * k);
  ctx.beginPath();
  const cols = 6;
  const stepY = 12;
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    const bow = Math.sin(Math.PI * u);
    const x0 = X - o + 2 * o * u;
    for (let y = bot; y <= top; y += stepY / 2) {
      const sx = x0 + dxAt(y) * bow;
      const sy = f.sy(y);
      if (y === bot) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
  }
  for (let y = bot + stepY; y < top; y += stepY) {
    const sy = f.sy(y);
    if (sy > f.h + 4 || sy < -4) continue;
    const d = dxAt(y);
    ctx.moveTo(X - o, sy);
    ctx.quadraticCurveTo(X + d, sy + 1.5 * k, X + o, sy);
  }
  ctx.stroke();
  ctx.fillStyle = withAlpha(neon ? pal.zone || pal.accent : '#1E2330', 0.7);
  ctx.fillRect(X - o, Bt - 2.5 * k, 2 * o, 3.5 * k);
  ctx.strokeStyle = neon ? withAlpha(pal.line, 0.9) : withAlpha('#FFFFFF', 0.85);
  ctx.lineWidth = Math.max(1, 1.8 * k);
  ctx.beginPath();
  ctx.moveTo(X - o, Tp);
  ctx.lineTo(X + o, Tp);
  ctx.stroke();
  ctx.strokeStyle = pole;
  ctx.lineWidth = Math.max(2, 4.2 * k);
  ctx.beginPath();
  ctx.moveTo(X + o, G);
  ctx.lineTo(X + o, Tp - 6 * k);
  ctx.stroke();
  ctx.fillStyle = mixColor(pal.accent, '#000000', 0.12);
  roundRectPath(ctx, X + o - 5 * k, G - 22 * k, 10 * k, 22 * k + 2, 3 * k);
  ctx.fill();
  ctx.restore();
}

export function drawTee(ctx, x, f, alpha) {
  if (!(alpha > 0)) return;
  const k = f.k;
  const X = f.sx(x);
  const G = f.sy(0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = withAlpha('#000000', 0.15);
  ctx.beginPath();
  ctx.ellipse(X, G + 1, 12 * k, 3 * k, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.pal.accent;
  ctx.beginPath();
  ctx.moveTo(X - 9 * k, G - TEE_H * k);
  ctx.lineTo(X + 9 * k, G - TEE_H * k);
  ctx.lineTo(X + 4 * k, G);
  ctx.lineTo(X - 4 * k, G);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha('#FFFFFF', 0.4);
  ctx.fillRect(X - 7 * k, G - TEE_H * k, 14 * k, 2 * k);
  ctx.restore();
}

export function drawCoin(ctx, pk, f) {
  if (!pk || pk.collected) return;
  const k = f.k;
  const time = f.time;
  const bob = Math.sin(time * 3) * 3;
  const X = f.sx(pk.x);
  const Y = f.sy(pk.y + bob);
  const r = f.cfg.pickups.radius * k;
  ctx.fillStyle = withAlpha('#FFE45C', 0.18 + 0.1 * Math.sin(time * 5));
  ctx.beginPath();
  ctx.arc(X, Y, r * 1.7, 0, TAU);
  ctx.fill();
  const sx = Math.max(0.18, Math.abs(Math.cos(time * 3.2)));
  ctx.save();
  ctx.translate(X, Y);
  ctx.scale(sx, 1);
  ctx.fillStyle = '#E09B00';
  ctx.beginPath();
  ctx.arc(0, r * 0.12, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#FFC83D';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#FFE7A0';
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = '#FFF6D0';
  ctx.fillRect(-r * 0.12, -r * 0.4, r * 0.24, r * 0.8);
  ctx.restore();
}

export function drawTrail(ctx, trail, skinId, f) {
  if (!trail || trail.length < 2) return;
  const n = trail.length;
  const r = f.cfg.physics.ballRadius * f.k;
  const col = ballMeta(skinId).trail;
  ctx.lineCap = 'round';
  for (let i = 1; i < n; i++) {
    const u = i / (n - 1);
    ctx.strokeStyle = withAlpha(col, 0.45 * u);
    ctx.lineWidth = Math.max(1, r * 1.5 * u);
    ctx.beginPath();
    ctx.moveTo(f.sx(trail[i - 1].x), f.sy(trail[i - 1].y));
    ctx.lineTo(f.sx(trail[i].x), f.sy(trail[i].y));
    ctx.stroke();
  }
}

/** Ground shadow under the ball (st.wx / st.wy = world position without the tee lift). */
export function drawBallShadow(ctx, st, f) {
  const G = f.gy;
  if (!(G < f.h + 20)) return;
  const R = f.cfg.physics.ballRadius;
  const hgt = Math.max(0, st.wy - R);
  const s = clamp(1 - hgt / 520, 0.25, 1);
  const a = st.alpha == null ? 1 : st.alpha;
  ctx.fillStyle = withAlpha('#000000', 0.2 * s * a);
  ctx.beginPath();
  ctx.ellipse(f.sx(st.wx), G + 1, 1.25 * st.r * s, 0.3 * st.r * s, 0, 0, TAU);
  ctx.fill();
}

/**
 * Ball at screen (st.X, st.Y), radius st.r, canvas rotation st.rot; squash & stretch st.sx
 * (along) / st.sy (across) the axis st.angle; st.alpha for the fading ghost ball.
 */
export function drawBall(ctx, skinId, st, f) {
  const skin = RETRO_BALLS[skinId] || RETRO_BALLS.classic;
  ctx.save();
  if (st.alpha != null && st.alpha < 1) ctx.globalAlpha = Math.max(0, st.alpha);
  ctx.translate(st.X, st.Y);
  if ((st.sx != null && st.sx !== 1) || (st.sy != null && st.sy !== 1)) {
    const ang = st.angle || 0;
    ctx.rotate(-ang);
    ctx.scale(st.sx, st.sy);
    ctx.rotate(ang);
  }
  ctx.rotate(st.rot || 0);
  skin.draw(ctx, st.r, f.time || 0, st.rot || 0);
  ctx.restore();
}
