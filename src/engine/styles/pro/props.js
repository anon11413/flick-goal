// Flick Goal — PRO style props in world space (ported from try/pro-graphics render.js and
// re-authored for the on-field layouts): cylinder-shaded metal posts with a foam padded base and
// waving flags, cast shadows per stadium light, the ENDLESS painted base disc, the FIELD kicking
// net (metal poles, two-layer shaded mesh, ripple), tee, coin, trail, ball + soft shadow with a
// motion smear. Every function takes the main ctx and the frame `f` (render.js §5.2).

import {
  mixColor, withAlpha, memo, softSpot, fillPathV, fillPathH, fillPathR, cachedGradient, roundRectPath,
} from '../../paint.js';
import { groundFrame, TEE_H } from '../../field.js';
import { ballMeta } from '../../themes.js';
import { lightOf } from './lights.js';
import { PRO_BALLS } from './balls.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Cylinder shading stops (flat [u, colour, ...]) for a tube lit from the key-light side. */
function tubeStops(color, L) {
  const lf = L.ball.x > 0.05 ? 1 : 0;
  return memo('pro:tube', color, lf, L.ball.rim, () => {
    const litFirst = !lf;
    const raw = [
      [0, mixColor(color, '#000000', 0.1)],
      [0.26, mixColor(color, '#FFFFFF', 0.55)],
      [0.42, color],
      [0.78, mixColor(color, '#000000', 0.28)],
      [0.92, mixColor(color, '#000000', 0.34)],
      [1, mixColor(color, L.ball.rim, 0.55)],
    ];
    return raw.map(([u, c]) => [litFirst ? u : 1 - u, c]).sort((a, b) => a[0] - b[0]).flat();
  });
}

/** Vertical tube with round caps (ya/yb = cap centres), cylinder-shaded across. */
function vTube(ctx, x, ya, yb, wdt, color, L) {
  const r = wdt / 2;
  const top = Math.min(ya, yb);
  const bot = Math.max(ya, yb);
  ctx.beginPath();
  ctx.moveTo(x - r, bot);
  ctx.lineTo(x - r, top);
  ctx.arc(x, top, r, Math.PI, 0);
  ctx.lineTo(x + r, bot);
  ctx.arc(x, bot, r, 0, Math.PI);
  ctx.closePath();
  fillPathH(ctx, x - r, x + r, tubeStops(color, L));
}

/** Horizontal tube (crossbar / net rail), lit from above. */
function hTube(ctx, xa, xb, y, wdt, color, L) {
  const r = wdt / 2;
  ctx.beginPath();
  ctx.moveTo(xa, y - r);
  ctx.lineTo(xb, y - r);
  ctx.arc(xb, y, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(xa, y + r);
  ctx.arc(xa, y, r, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
  const rim = L.ball.rim;
  fillPathV(ctx, y - r, y + r, memo('pro:htube', color, rim, 0, () => [
    0, mixColor(color, '#FFFFFF', 0.3), 0.28, mixColor(color, '#FFFFFF', 0.6), 0.5, color,
    0.85, mixColor(color, '#000000', 0.3), 1, mixColor(color, rim, 0.4),
  ]));
}

function ribbon(ctx, x, y, k, color, phase, time) {
  const wv = Math.sin(time * 9 + phase);
  ctx.beginPath();
  ctx.moveTo(x, y + 2 * k);
  ctx.quadraticCurveTo(x + 10 * k, y + (2 + wv * 3) * k, x + (19 + wv * 2) * k, y + (6 + wv * 2) * k);
  ctx.quadraticCurveTo(x + 10 * k, y + (9 - wv * 2) * k, x, y + 13 * k);
  ctx.closePath();
  fillPathV(ctx, y, y + 13 * k, memo('pro:ribbon', color, 0, 0, () => [0, mixColor(color, '#FFFFFF', 0.22), 0.55, color, 1, mixColor(color, '#000000', 0.28)]));
}

function popTransform(ctx, X, G, pop) {
  if (pop < 1) {
    ctx.translate(X, G);
    ctx.scale(Math.max(0.001, pop), Math.max(0.001, pop));
    ctx.translate(-X, -G);
  }
}

/**
 * ENDLESS base disc (painted team circle with a white rim, texture ring and soft edge) and the
 * post's cast shadow on the turf (both layouts), one per stadium light.
 */
export function drawPostShadow(ctx, post, f, pop = 1) {
  if (!post) return;
  const k = f.k;
  const X = f.sx(post.x);
  const G = f.gy;
  if (X < -300 || X > f.w + 300 || G > f.h + 40) return;
  const L = lightOf(f.themeId);
  const pal = f.pal;
  if (f.mode === 'endless' && f.proj) {
    const r = ((f.cfg.endless && f.cfg.endless.discRadius) || 22) * clamp(pop, 0.001, 1.2);
    const zone = pal.zone || pal.accent;
    ctx.save();
    groundFrame(ctx, f.proj, post.x, 0, 'near');
    softSpot(ctx, 1.5, 1.2, r + 7, r + 7, L.shadow, L.shadowA * 1.4, 0.7);
    ctx.beginPath();
    ctx.ellipse(0, 0, r + 2.2, r + 2.2, 0, 0, TAU);
    ctx.fillStyle = withAlpha('#FFFFFF', 0.92);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r, 0, 0, TAU);
    fillPathR(ctx, -r * 0.3, -r * 0.3, r * 1.45, memo('pro:disc', zone, 0, 0, () => [
      0, mixColor(zone, '#FFFFFF', 0.22), 0.6, zone, 1, mixColor(zone, '#000000', 0.25),
    ]));
    ctx.strokeStyle = withAlpha('#FFFFFF', 0.35);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.62, r * 0.62, 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = withAlpha('#FFFFFF', 0.12);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.62, r * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  const bh = G - f.sy(post.bar);
  const th = G - f.sy(post.top);
  const o = f.cfg.physics.uprightOffset * k;
  ctx.save();
  popTransform(ctx, X, G, pop);
  ctx.lineCap = 'round';
  for (const c of L.casts) {
    if (c.soft) {
      const len = c.dy * th;
      const sx = c.dx * th;
      softSpot(ctx, X + sx * 0.3, G + 2 + len * 0.3, 9 * k + 4, len * 0.34 + 3, L.shadow, L.shadowA * 1.5 * c.a);
      softSpot(ctx, X + sx * 0.75, G + 2 + len * 0.72, o * 1.35 + 6, len * 0.3 + 3, L.shadow, L.shadowA * 1.1 * c.a);
      softSpot(ctx, X, G + 3, 18 * k, 5 * k, L.shadow, L.shadowA * 2.2 * c.a);
      continue;
    }
    const P = (off, h) => [X + off + c.dx * h, G + c.dy * h];
    ctx.strokeStyle = withAlpha(L.shadow, L.shadowA * c.a * 0.8);
    ctx.lineWidth = Math.max(2, 2 * f.cfg.physics.stemRadius * k);
    ctx.beginPath();
    let p = P(0, 0); ctx.moveTo(p[0], p[1]);
    p = P(0, bh); ctx.lineTo(p[0], p[1]);
    p = P(-o, bh); ctx.moveTo(p[0], p[1]);
    p = P(o, bh); ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, 8 * k);
    ctx.beginPath();
    for (const s of [-1, 1]) {
      p = P(s * o, bh); ctx.moveTo(p[0], p[1]);
      p = P(s * o, th); ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    softSpot(ctx, X + c.dx * 14 * k, G + 3 + c.dy * 14 * k, 18 * k, 5 * k, L.shadow, L.shadowA * 2.2 * c.a);
  }
  ctx.restore();
}

/** part: 'far' (padded base, stem, far upright, crossbar) or 'near' (near upright). */
export function drawPost(ctx, post, part, f, pop = 1) {
  if (!post) return;
  const k = f.k;
  const X = f.sx(post.x);
  const G = f.gy;
  const B = f.sy(post.bar);
  const Tp = f.sy(post.top);
  if (X < -80 || X > f.w + 80) return;
  const PH = f.cfg.physics;
  const L = lightOf(f.themeId);
  const pal = f.pal;
  const o = PH.uprightOffset * k;
  ctx.save();
  popTransform(ctx, X, G, pop);
  ctx.lineCap = 'round';
  const post1 = pal.post;
  if (part === 'far') {
    const pad = mixColor(pal.accent, '#000000', 0.1);
    const bw = 20 * k;
    const bx = X - bw / 2;
    const by = G - 40 * k;
    roundRectPath(ctx, bx, by, bw, 40 * k + 4, 6 * k);
    fillPathH(ctx, bx, bx + bw, tubeStops(pad, L));
    ctx.fillStyle = withAlpha('#FFFFFF', 0.28);
    ctx.beginPath();
    ctx.ellipse(X, by + 3.5 * k, bw * 0.42, 2.4 * k, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = withAlpha('#000000', 0.14);
    ctx.fillRect(bx + 1, G - 12 * k, bw - 2, 1.2 * k);
    ctx.fillRect(bx + 1, G - 26 * k, bw - 2, 1.2 * k);
    vTube(ctx, X, G - 36 * k, B, Math.max(3, 2 * PH.stemRadius * k), post1, L);
    vTube(ctx, X - o, B, Tp, Math.max(2.5, 7.5 * k), mixColor(post1, '#000000', 0.2), L);
    ribbon(ctx, X - o, Tp, k, mixColor(pal.accent, '#000000', 0.15), 0, f.time);
    hTube(ctx, X - o, X + o, B, Math.max(3, 2 * PH.crossbarRadius * k), post1, L);
    ctx.fillStyle = mixColor(post1, '#000000', 0.25);
    ctx.beginPath();
    ctx.ellipse(X, B + 2 * k, 4.5 * k, 2.2 * k, 0, 0, TAU);
    ctx.fill();
  } else {
    vTube(ctx, X + o, B, Tp, Math.max(3, 9.5 * k), post1, L);
    ctx.fillStyle = withAlpha('#FFFFFF', 0.7);
    ctx.beginPath();
    ctx.ellipse(X + o - 1.5 * k, Tp + 1 * k, 1.6 * k, 1 * k, 0, 0, TAU);
    ctx.fill();
    ribbon(ctx, X + o, Tp, k, pal.accent, 1.7, f.time);
  }
  ctx.restore();
}

/**
 * FIELD only: kicking net behind the uprights (world x = post.x + field.netOffset): metal poles,
 * a dim back mesh and a lit front mesh (depth), a weighted bottom band, a lit top rail, ground
 * shadow, and the ripple from netFx = { t, y, amp }.
 */
export function drawNet(ctx, post, f, netFx) {
  if (!post) return;
  const F = f.cfg.field;
  const pal = f.pal;
  const L = lightOf(f.themeId);
  const k = f.k;
  const X = f.sx(post.x + F.netOffset);
  const o = F.netHalf * k;
  if (X + o < -20 || X - o > f.w + 20) return;
  const G = f.gy;
  const top = post.top + F.netAbove;
  const bot = post.bar * F.netBottomFrac;
  const Tp = f.sy(top);
  const Bt = f.sy(bot);
  const neon = f.themeId === 'arcade';
  const pole = neon ? mixColor(pal.line, '#000000', 0.35) : '#39414F';
  const meshCol = neon ? (pal.zone || pal.accent) : '#FFFFFF';
  const fx = netFx || { t: 9, y: 0, amp: 0 };
  ctx.save();
  ctx.lineCap = 'round';
  softSpot(ctx, X + o * 0.4, G + 2, o * 2.2 + 10 * k, 5 * k, L.shadow, L.shadowA * 1.6);
  vTube(ctx, X - o, G, Tp - 6 * k, Math.max(1.5, 3.2 * k), mixColor(pole, '#000000', 0.25), L);
  const rip = fx.t < 1.2 ? fx.amp * Math.exp(-fx.t * 4.5) : 0;
  const dxAt = (y) => {
    if (rip <= 0.001) return 0;
    const d = (y - fx.y) / 70;
    return rip * 16 * k * Math.exp(-d * d) * Math.cos(fx.t * 22);
  };
  // Mesh as thin axis-aligned rects (they batch into one GPU draw); stroking one path of
  // translucent lines needs a coverage mask of the whole net every frame. Overlaps at the
  // crossings read as knots. The ripple offsets each short segment of a cord.
  const mesh = (alpha, shift, lw, dim) => {
    ctx.fillStyle = withAlpha(dim ? mixColor(meshCol, '#000000', 0.35) : meshCol, alpha);
    const t = Math.max(0.5, lw * k);
    const cols = 6;
    const stepY = 12;
    const damp = dim ? 0.6 : 1;
    const yTop = f.sy(top);
    const yBot = f.sy(bot);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const bow = Math.sin(Math.PI * u) * damp;
      const x0 = X - o + 2 * o * u + shift - t / 2;
      if (rip <= 0.001) {
        ctx.fillRect(x0, yTop, t, yBot - yTop);
        continue;
      }
      for (let y = bot; y < top; y += stepY / 2) {
        const y1 = Math.min(top, y + stepY / 2);
        const a = f.sy(y1);
        ctx.fillRect(x0 + dxAt((y + y1) / 2) * bow, a, t, f.sy(y) - a + 0.3);
      }
    }
    const segs = f.lowQ ? 1 : 3;
    for (let y = bot + stepY; y < top; y += stepY) {
      const sy = f.sy(y);
      if (sy > f.h + 4 || sy < -4) continue;
      const d = dxAt(y) * damp;
      // quadratic cord (X - o, sy) -> control (X + d, sy + 1.5k) -> (X + o, sy), in segments
      let px = X - o + shift;
      let py = sy;
      for (let q = 1; q <= segs; q++) {
        const v = q / segs;
        const w0 = (1 - v) * (1 - v);
        const w1 = 2 * v * (1 - v);
        const nx = w0 * (X - o) + w1 * (X + d) + v * v * (X + o) + shift;
        const ny = sy + w1 * 1.5 * k;
        ctx.fillRect(Math.min(px, nx), (py + ny) / 2 - t / 2, Math.abs(nx - px) + 0.3, t);
        px = nx;
        py = ny;
      }
    }
  };
  if (!f.lowQ) mesh(neon ? 0.3 : 0.22, 3 * k, 0.7, true); // low tier: one mesh layer
  mesh(neon ? 0.6 : 0.5, 0, 0.85, false);
  ctx.beginPath();
  ctx.rect(X - o, Bt - 2.5 * k, 2 * o, 3.5 * k);
  fillPathV(ctx, Bt - 2.5 * k, Bt + 1 * k, neon ? memo('pro:netb', pal.zone || pal.accent, 0, 0, () => [0, pal.zone || pal.accent, 1, mixColor(pal.zone || pal.accent, '#000000', 0.5)]) : NET_BAND);
  hTube(ctx, X - o, X + o, Tp, Math.max(1.4, 2.4 * k), neon ? pal.line : '#E8ECF2', L);
  vTube(ctx, X + o, G, Tp - 6 * k, Math.max(2, 4.2 * k), pole, L);
  const pad = mixColor(pal.accent, '#000000', 0.12);
  roundRectPath(ctx, X + o - 5 * k, G - 22 * k, 10 * k, 22 * k + 2, 3 * k);
  fillPathH(ctx, X + o - 5 * k, X + o + 5 * k, tubeStops(pad, L));
  ctx.restore();
}
const NET_BAND = [0, '#2E3544', 1, '#141821'];

export function drawTee(ctx, x, f, alpha) {
  if (!(alpha > 0)) return;
  const k = f.k;
  const X = f.sx(x);
  const G = f.gy;
  const L = lightOf(f.themeId);
  const acc = f.pal.accent;
  ctx.save();
  ctx.globalAlpha = alpha;
  softSpot(ctx, X, G + 1.5, 15 * k, 3.8 * k, L.shadow, L.shadowA * 2.4);
  ctx.beginPath();
  ctx.moveTo(X - 9 * k, G - TEE_H * k);
  ctx.lineTo(X + 9 * k, G - TEE_H * k);
  ctx.lineTo(X + 4 * k, G);
  ctx.lineTo(X - 4 * k, G);
  ctx.closePath();
  fillPathH(ctx, X - 9 * k, X + 9 * k, tubeStops(acc, L));
  ctx.fillStyle = mixColor(acc, '#FFFFFF', 0.35);
  ctx.beginPath();
  ctx.ellipse(X, G - TEE_H * k, 9 * k, 1.8 * k, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = withAlpha('#000000', 0.2);
  ctx.beginPath();
  ctx.ellipse(X, G - TEE_H * k + 0.4 * k, 6 * k, 1 * k, 0, 0, TAU);
  ctx.fill();
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
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  softSpot(ctx, X, Y, r * 2.4, r * 2.4, '#FFD54F', 0.35 + 0.12 * Math.sin(time * 5));
  ctx.restore();
  const sx = Math.max(0.18, Math.abs(Math.cos(time * 3.2)));
  ctx.save();
  ctx.translate(X, Y);
  ctx.scale(sx, 1);
  ctx.fillStyle = '#B87800';
  ctx.beginPath();
  ctx.arc(0, r * 0.12, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = cachedGradient(ctx, 'pro:coinface', () => {
    const g = ctx.createRadialGradient(-0.35, -0.4, 0.1, 0, 0, 1);
    g.addColorStop(0, '#FFF1B0');
    g.addColorStop(0.5, '#FFC83D');
    g.addColorStop(1, '#E09B00');
    return g;
  });
  ctx.save();
  ctx.scale(r, r);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();
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
    ctx.strokeStyle = withAlpha(col, 0.42 * u * u + 0.04);
    ctx.lineWidth = Math.max(1, r * 1.5 * u);
    ctx.beginPath();
    ctx.moveTo(f.sx(trail[i - 1].x), f.sy(trail[i - 1].y));
    ctx.lineTo(f.sx(trail[i].x), f.sy(trail[i].y));
    ctx.stroke();
  }
}

/** Soft ground shadow: slides along each light's direction, widens and fades with height. */
export function drawBallShadow(ctx, st, f) {
  const G = f.gy;
  if (!(G < f.h + 20)) return;
  const L = lightOf(f.themeId);
  const R = f.cfg.physics.ballRadius;
  const hgt = Math.max(0, st.wy - R);
  const s = clamp(1 - hgt / 520, 0.2, 1);
  const hpx = hgt * f.k;
  const X = f.sx(st.wx);
  const A = st.alpha == null ? 1 : st.alpha;
  for (const c of L.casts) {
    const x = X + c.dx * Math.min(hpx, 400) * 0.3;
    const y = G + 1.5 + Math.min(c.dy * hpx * 0.35, 26 * f.k);
    const rx = st.r * 1.35 * (1 + (1 - s) * 0.9);
    const ry = st.r * 0.36 * (1 + (1 - s) * 0.5);
    softSpot(ctx, x, y, rx, ry, L.shadow, L.shadowA * 2.6 * c.a * Math.pow(s, 1.3) * A);
  }
  if (hgt < 30) softSpot(ctx, X, G + 1, st.r * 0.8, st.r * 0.18, L.shadow, L.shadowA * 2.4 * (1 - hgt / 30) * A);
}

/**
 * Ball at screen (st.X, st.Y), lit by the stadium light, with squash & stretch (st.sx / st.sy
 * along st.angle) and a soft motion smear at high speed (not for the ghost ball).
 */
export function drawBall(ctx, skinId, st, f) {
  const skin = PRO_BALLS[skinId] || PRO_BALLS.classic;
  const L = lightOf(f.themeId);
  const w = f.world;
  const b = w && w.ball;
  const ghost = st.alpha != null && st.alpha < 1;
  let sa = 0;
  let ang = 0;
  if (b && !ghost) {
    const flying = w.phase === 'fly' || w.phase === 'settle' || w.phase === 'miss' || w.phase === 'over';
    sa = flying && !b.rolling ? clamp((Math.hypot(b.vx, b.vy) - 650) / 900, 0, 1) : 0;
    if (sa > 0) {
      ang = Math.atan2(-b.vy, b.vx);
      const kk = st.r / f.cfg.physics.ballRadius;
      ctx.save();
      ctx.translate(st.X - b.vx * kk * 0.018, st.Y + b.vy * kk * 0.018);
      ctx.rotate(ang);
      softSpot(ctx, 0, 0, st.r * (1.6 + sa), st.r * 0.8, ballMeta(skinId).trail, 0.35 * sa);
      ctx.restore();
    }
  }
  ctx.save();
  if (ghost) ctx.globalAlpha = Math.max(0, st.alpha);
  ctx.translate(st.X, st.Y);
  if (sa > 0) {
    ctx.rotate(ang);
    ctx.scale(1 + 0.1 * sa, 1 - 0.05 * sa);
    ctx.rotate(-ang);
  }
  if ((st.sx != null && st.sx !== 1) || (st.sy != null && st.sy !== 1)) {
    const a = st.angle || 0;
    ctx.rotate(-a);
    ctx.scale(st.sx, st.sy);
    ctx.rotate(a);
  }
  // animated skins repaint every frame: their buffer is capped at 2x (busy textures, half the cost)
  const animated = ANIMATED_BALLS.has(skinId);
  const buf = f.lowQ ? null : ballBuffer(ghost ? 1 : 0, st.r, animated ? Math.min(2, f.edpr || 1) : (f.edpr || 1));
  if (buf) {
    // Paint the shaded ball on a small CPU-backed canvas and blit it: the skins' clip, lace /
    // seam strokes and stitch dots each cost a separate coverage-mask draw in the GPU process
    // (measured ~1.5 ms per ball at 3x, two balls during the FIELD swoop). Static skins are only
    // repainted when size or spin change; animated ones follow the clock.
    const tk = animated ? (f.time || 0).toFixed(3) : '';
    const key = `${skinId}|${st.r.toFixed(2)}|${(st.rot || 0).toFixed(4)}|${tk}|${f.themeId}`;
    if (buf.key !== key) {
      const c = buf.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, buf.S, buf.S);
      c.setTransform(buf.d, 0, 0, buf.d, buf.S / 2, buf.S / 2);
      c.rotate(st.rot || 0);
      skin.draw(c, st.r, f.time || 0, st.rot || 0, L.ball);
      buf.key = key;
    }
    const half = buf.S / 2 / buf.d;
    ctx.drawImage(buf.cv, -half, -half, half * 2, half * 2);
  } else {
    ctx.rotate(st.rot || 0);
    skin.draw(ctx, st.r, f.time || 0, st.rot || 0, L.ball);
  }
  ctx.restore();
}

// Skins whose look changes with time (patterns / after-effects read the clock).
const ANIMATED_BALLS = new Set(['neon', 'fire', 'pixel', 'galaxy', 'gold']);

// Two CPU-backed scratch canvases (live ball, FIELD ghost ball). willReadFrequently keeps them in
// software, so the ball's clip and strokes rasterize on the CPU instead of the GPU process.
const BALL_BUFS = [null, null];
function ballBuffer(slot, r, d) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const S = Math.ceil((r * 1.8 * 2 * d + 4) / 32) * 32; // size buckets: no resize every zoom frame
  if (!(S > 4) || S > 640) return null;
  let b = BALL_BUFS[slot];
  if (!b || b.S !== S || b.d !== d) {
    try {
      const cv = (b && b.cv) || document.createElement('canvas');
      cv.width = S;
      cv.height = S;
      const c = (b && b.ctx) || cv.getContext('2d', { willReadFrequently: true });
      if (!c) return null;
      b = { cv, ctx: c, S, d, key: '' };
      BALL_BUFS[slot] = b;
    } catch (_) {
      return null;
    }
  }
  return b;
}

