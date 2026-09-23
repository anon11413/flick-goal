// Flick Goal — PRO style effects (ported from try/pro-graphics render.js).
//  * onFx: pro-only juice on top of the core reactions — turf / snow / sand chunks and a soft
//    puff off the tee on the flick, dust puffs on ground bounces and landings, bloom glows on
//    post hits, goals (big bloom + extra sparkle on a PERFECT), coins and continues.
//  * drawEffects: two-sided shaded confetti with a specular glint, rolling puffs, sparks and
//    stars with an additive glow pass, rings, and additive bloom sprites. One composite switch
//    per pass; all soft sprites are cached unit gradients (paint.softSpot).

import { mixColor, withAlpha, softSpot, memo } from '../../paint.js';
import { lightOf } from './lights.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;

function darkOf(c) {
  return memo('pro:cdark', c, 0, 0, () => mixColor(c, '#1A1030', 0.38));
}

function puffs(api, x, n, color, strength = 1) {
  for (let i = 0; i < n; i++) {
    const dir = i % 2 ? 1 : -1;
    api.addParticle({
      kind: 'puff', x: x + api.rand(-8, 8), y: api.rand(1, 6), vx: dir * api.rand(40, 170) * strength, vy: api.rand(25, 100) * strength,
      g: 180, drag: 3.2, life: api.rand(0.45, 0.8), max: 0.8, size: api.rand(6, 11), color, a: api.rand(0.35, 0.6),
    });
  }
}

/** Pro-only extras for engine events (api = render.js fx api, f = last frame). */
export function onFx(name, e, api, f) {
  const L = lightOf(f && f.themeId);
  const pal = f && f.pal;
  switch (name) {
    case 'flick': {
      const p = api.ballPos();
      const g = pal ? pal.ground : '#5CC858';
      const gd = pal ? pal.groundDark : '#4DB84A';
      for (let i = 0; i < 8; i++) {
        const c = i % 3 === 0 ? g : gd;
        api.addParticle({
          kind: 'chunk', x: p.x + api.rand(-6, 6), y: 4, vx: api.rand(-70, 90), vy: api.rand(90, 250), g: 900, drag: 1,
          life: api.rand(0.35, 0.55), max: 0.55, size: api.rand(2.5, 5), color: c, dark: mixColor(c, '#000000', 0.35),
          rot: api.rand(0, TAU), vr: api.rand(-12, 12),
        });
      }
      puffs(api, p.x, 5, L.dust, 0.8);
      api.addGlow(p.x, p.y, 26, '#FFFFFF', 0.35, 0.18);
      break;
    }
    case 'bounce': {
      const p = api.ballPos();
      if (e && e.kind === 'ground') {
        if (e.impact > 140) puffs(api, p.x, Math.min(10, 3 + Math.floor(e.impact / 120)), L.dust);
      } else {
        api.addGlow(p.x, p.y, 34, '#FFF6B0', 0.55, 0.22);
      }
      break;
    }
    case 'score': {
      const w = f && f.world;
      const bp = api.ballPos();
      const x = w && w.post ? w.post.x : bp.x;
      const s = w && w.shot;
      const y = s ? (s.bar + s.top) / 2 : bp.y;
      if (e && e.perfect) {
        api.sparkle(x, y, 10, '#FFFFFF');
        api.addGlow(x, y, 170, '#FFF1B0', 0.85, 0.55);
        api.addGlow(x, y, 70, '#FFFFFF', 0.9, 0.3);
      } else {
        api.addGlow(x, y, 100, '#FFF6D8', 0.55, 0.4);
      }
      break;
    }
    case 'coin': {
      const pk = f && f.world && f.world.pickup;
      const p = pk || api.ballPos();
      api.addGlow(p.x, p.y, 46, '#FFE45C', 0.7, 0.3);
      break;
    }
    case 'net': {
      const p = api.ballPos();
      puffs(api, p.x, 3, L.dust, 0.5);
      break;
    }
    case 'land':
      if (e && Number.isFinite(e.x)) puffs(api, e.x, 8, L.dust);
      break;
    case 'continue': {
      const w = f && f.world;
      if (w) api.addGlow(w.teeX, f.cfg ? f.cfg.physics.ballRadius : 10, 90, '#FFFFFF', 0.6, 0.45);
      break;
    }
    default:
      break;
  }
}

function starPath(ctx, x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i / 10) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** fx = { particles, rings, glows } in world units (render.js core state). */
export function drawEffects(ctx, fx, f) {
  const { particles, rings, glows } = fx;
  const W = f.w;
  const H = f.h;
  const k = f.k;
  // additive glow pass for bright particles (stars / sparks)
  if (!f.lowQ) {
    let any = false;
    for (const p of particles) {
      if (p.kind !== 'star' && p.kind !== 'spark') continue;
      const X = f.sx(p.x);
      const Y = f.sy(p.y);
      if (X < -40 || X > W + 40 || Y < -40 || Y > H + 40) continue;
      if (!any) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; any = true; }
      const u = clamp(p.life / p.max, 0, 1);
      const gr = p.kind === 'star' ? p.size * 2.2 : p.size * 3;
      softSpot(ctx, X, Y, gr, gr, p.color, 0.45 * u);
    }
    if (any) ctx.restore();
  }
  for (const p of particles) {
    const X = f.sx(p.x);
    const Y = f.sy(p.y);
    if (X < -40 || X > W + 40 || Y < -40 || Y > H + 40) continue;
    const u = clamp(p.life / p.max, 0, 1);
    switch (p.kind) {
      case 'rect':
      case 'chunk': {
        const fl = Math.cos(p.rot * 1.7);
        const a = Math.min(1, u * 2.5);
        ctx.globalAlpha = a;
        ctx.fillStyle = fl >= 0 ? p.color : (p.dark || darkOf(p.color));
        const cr = Math.cos(p.rot);
        const sr = Math.sin(p.rot);
        const hx = p.size / 2;
        const hy = p.size * 0.3 * fl;
        ctx.beginPath();
        ctx.moveTo(X - hx * cr + hy * sr, Y - hx * sr - hy * cr);
        ctx.lineTo(X + hx * cr + hy * sr, Y + hx * sr - hy * cr);
        ctx.lineTo(X + hx * cr - hy * sr, Y + hx * sr + hy * cr);
        ctx.lineTo(X - hx * cr - hy * sr, Y - hx * sr + hy * cr);
        ctx.closePath();
        ctx.fill();
        if (fl > 0.86 && p.kind === 'rect') {
          ctx.globalAlpha = a * (fl - 0.86) * 5;
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        }
        break;
      }
      case 'puff': {
        const s = p.size * (1.9 - u * 0.9);
        ctx.globalAlpha = 1;
        softSpot(ctx, X, Y, s, s * 0.8, p.color, (p.a || 0.5) * u);
        break;
      }
      case 'circle': {
        ctx.globalAlpha = u;
        const s = p.grow ? p.size * (1.6 - u * 0.6) : p.size * u;
        if (p.grow) {
          // core dust puffs read as soft powder in pro
          ctx.globalAlpha = 1;
          softSpot(ctx, X, Y, s * 1.3, s * 1.05, typeof p.color === 'string' && p.color[0] === '#' ? p.color : '#FFFFFF', 0.7 * u);
          break;
        }
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(X, Y, Math.max(0.5, s), 0, TAU);
        ctx.fill();
        break;
      }
      case 'square':
        ctx.globalAlpha = u;
        ctx.fillStyle = p.color;
        ctx.fillRect(X - p.size / 2, Y - p.size / 2, p.size, p.size);
        break;
      case 'spark': {
        ctx.globalAlpha = u;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        const l = 0.03;
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(X - p.vx * l * k, Y + p.vy * l * k);
        ctx.stroke();
        break;
      }
      case 'star':
        ctx.globalAlpha = u;
        ctx.fillStyle = p.color;
        starPath(ctx, X, Y, p.size * (0.5 + 0.5 * u), p.rot || 0);
        ctx.fill();
        break;
      default:
        break;
    }
  }
  ctx.globalAlpha = 1;
  for (const g of rings) {
    if (g.t < 0) continue;
    const u = clamp(g.t / g.dur, 0, 1);
    const e = 1 - (1 - u) * (1 - u);
    ctx.strokeStyle = withAlpha(g.color, 1 - u);
    ctx.lineWidth = Math.max(1, g.w * (1 - u * 0.7));
    ctx.beginPath();
    ctx.arc(f.sx(g.x), f.sy(g.y), lerp(g.r0, g.r1, e), 0, TAU);
    ctx.stroke();
  }
  if (glows && glows.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const g of glows) {
      const u = clamp(g.t / g.dur, 0, 1);
      const big = g.r > 120;
      if (f.lowQ && big) continue; // low tier: no big blooms
      const r = g.r * k * (0.7 + 0.5 * (1 - (1 - u) * (1 - u)));
      softSpot(ctx, f.sx(g.x), f.sy(g.y), r, r, g.color, g.a * (1 - u) * (1 - u));
    }
    ctx.restore();
  }
}
