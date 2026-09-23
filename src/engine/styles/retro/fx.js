// Flick Goal — RETRO style: flat particle / ring rendering and the retro-only event juice.
// Particle state and physics live in the core renderer (render.js); styles only draw them.
// Particle kinds: 'rect' (confetti / turf bits), 'circle' (dust, fire, frost), 'square' (pixel),
// 'spark' (streak along velocity), 'star'.

import { withAlpha } from '../../paint.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;

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

/** fx = { particles, rings, glows } in world units (see render.js). */
export function drawEffects(ctx, fx, f) {
  const { particles, rings, glows } = fx;
  for (const p of particles) {
    const X = f.sx(p.x);
    const Y = f.sy(p.y);
    if (X < -40 || X > f.w + 40 || Y < -40 || Y > f.h + 40) continue;
    const u = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = p.kind === 'rect' ? Math.min(1, u * 2.5) : u;
    ctx.fillStyle = p.color;
    switch (p.kind) {
      case 'rect': {
        ctx.save();
        ctx.translate(X, Y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 1.7));
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        ctx.restore();
        break;
      }
      case 'circle': {
        const s = p.grow ? p.size * (1.6 - u * 0.6) : p.size * u;
        ctx.beginPath();
        ctx.arc(X, Y, Math.max(0.5, s), 0, TAU);
        ctx.fill();
        break;
      }
      case 'square':
        ctx.fillRect(X - p.size / 2, Y - p.size / 2, p.size, p.size);
        break;
      case 'spark': {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        const l = 0.03;
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(X - p.vx * l * f.k, Y + p.vy * l * f.k);
        ctx.stroke();
        break;
      }
      case 'star':
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
  // Glows are a pro-style effect; retro only spawns none but draws any as flat soft discs.
  if (glows && glows.length) {
    for (const g of glows) {
      const u = clamp(g.t / g.dur, 0, 1);
      const a = g.a * (1 - u);
      if (a <= 0.01) continue;
      ctx.fillStyle = withAlpha(g.color, a * 0.5);
      ctx.beginPath();
      ctx.arc(f.sx(g.x), f.sy(g.y), Math.max(0.5, g.r * f.k), 0, TAU);
      ctx.fill();
    }
  }
}

/**
 * Retro-only extra juice for engine events (the shared reactions - squash, shake, flash,
 * confetti, rings, sparks - are in the core). api = render.js fx api, f = last frame.
 */
export function onFx(name, e, api, f) {
  const pal = f && f.pal;
  switch (name) {
    case 'flick': {
      const p = api.ballPos();
      const col = pal ? pal.groundDark : '#4DB84A';
      for (let i = 0; i < 6; i++) {
        api.addParticle({
          kind: 'rect', x: p.x + api.rand(-6, 6), y: 4, vx: api.rand(-60, 60), vy: api.rand(80, 220), g: 900, drag: 1,
          life: 0.45, max: 0.45, size: api.rand(3, 5), color: col, rot: api.rand(0, TAU), vr: api.rand(-10, 10),
        });
      }
      break;
    }
    case 'bounce':
      if (e && e.kind === 'ground' && e.impact > 140) {
        const p = api.ballPos();
        api.dust(p.x, Math.min(10, 3 + Math.floor(e.impact / 120)), withAlpha('#FFFFFF', 0.85));
      }
      break;
    case 'land':
      if (e) api.dust(e.x, 8, withAlpha('#FFFFFF', 0.9));
      break;
    default:
      break;
  }
}
