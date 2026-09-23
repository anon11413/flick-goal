// Flick Goal — colour, gradient and path helpers shared by every art style (pure canvas; no DOM).
//
// Ported from try/pro-graphics skins.js (a superset of the v1 helpers):
//  * mixColor / withAlpha are memoised (they run many times per frame with the same arguments;
//    no key strings are built per call).
//  * memo(tag, a, b, c, make) returns a stable object per key, so identity-keyed caches hit.
//  * Gradients are built once per context in a unit space and mapped with translate/scale at
//    paint time (fillPathV / fillRectV / fillPathH / fillPathR / softSpot), so colour stops are
//    not re-parsed every frame. The fill helpers leave fillStyle set to the gradient.

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- color utils
export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

let MIX_MEMO = new Map();
let ALPHA_MEMO = new Map();
let mixN = 0;
let alphaN = 0;
/** Mix two #rrggbb colors (u = 0 -> a, 1 -> b). Memoised. */
export function mixColor(a, b, u) {
  let ma = MIX_MEMO.get(a);
  if (ma === undefined) { ma = new Map(); MIX_MEMO.set(a, ma); }
  let mb = ma.get(b);
  if (mb === undefined) { mb = new Map(); ma.set(b, mb); }
  let v = mb.get(u);
  if (v === undefined) {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    v = rgbToHex(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u);
    if (++mixN > 6000) { MIX_MEMO = new Map(); mixN = 0; }
    mb.set(u, v);
  }
  return v;
}
/** '#rrggbb' + alpha -> 'rgba(...)'. Memoised. */
export function withAlpha(hex, a) {
  const aa = Math.max(0, Math.min(1, a));
  let m = ALPHA_MEMO.get(hex);
  if (m === undefined) { m = new Map(); ALPHA_MEMO.set(hex, m); }
  let v = m.get(aa);
  if (v === undefined) {
    const [r, g, b] = hexToRgb(hex);
    v = `rgba(${r},${g},${b},${aa})`;
    if (++alphaN > 6000) { ALPHA_MEMO = new Map(); alphaN = 0; }
    m.set(aa, v);
  }
  return v;
}
/** Blend every color key of two palettes. */
export function mixPalette(p, q, u) {
  const out = {};
  for (const k of Object.keys(p)) out[k] = q[k] ? mixColor(p[k], q[k], u) : p[k];
  return out;
}

/**
 * Stable-identity memo for derived values (gradient stop lists, colour sets):
 * memo(tag, a, b, c, make) returns the same object for the same (tag, a, b, c).
 */
let MEMO = new Map();
let memoN = 0;
export function memo(tag, a, b, c, make) {
  let m1 = MEMO.get(tag);
  if (m1 === undefined) { m1 = new Map(); MEMO.set(tag, m1); }
  let m2 = m1.get(a);
  if (m2 === undefined) { m2 = new Map(); m1.set(a, m2); }
  let m3 = m2.get(b);
  if (m3 === undefined) { m3 = new Map(); m2.set(b, m3); }
  let v = m3.get(c);
  if (v === undefined) {
    v = make();
    if (++memoN > 4000) { MEMO = new Map(); memoN = 0; }
    m3.set(c, v);
  }
  return v;
}

// ---------------------------------------------------------------- cached gradients
const GRADS = new WeakMap();
const GRAD_IDS = new WeakMap();
/** Per-context cache: key -> CanvasGradient built by make() on first use. */
export function cachedGradient(ctx, key, make) {
  let m = GRADS.get(ctx);
  if (!m) {
    m = new Map();
    GRADS.set(ctx, m);
  }
  let g = m.get(key);
  if (g === undefined) {
    g = make();
    if (m.size > 320) m.delete(m.keys().next().value);
    m.set(key, g);
  }
  return g;
}
function gradFor(ctx, kind, stops, fx, fy, fr, make) {
  let ids = GRAD_IDS.get(ctx);
  if (!ids) {
    ids = { v: new WeakMap(), h: new WeakMap(), r: new Map() };
    GRAD_IDS.set(ctx, ids);
  }
  let byStops;
  if (kind === 'r') {
    const fk = fx * 1e6 + fy * 1e3 + fr;
    byStops = ids.r.get(fk);
    if (!byStops) { byStops = new WeakMap(); ids.r.set(fk, byStops); }
  } else {
    byStops = ids[kind];
  }
  let g = byStops.get(stops);
  if (g === undefined) {
    const key = kind === 'r' ? `r${fx},${fy},${fr}|${stops.join(',')}` : kind + stops.join(',');
    g = cachedGradient(ctx, key, make);
    byStops.set(stops, g);
  }
  return g;
}
/** Unit vertical gradient (0 -> 1) from flat [u0, c0, u1, c1, ...] stops. */
export function vGrad(ctx, stops) {
  return gradFor(ctx, 'v', stops, 0, 0, 0, () => {
    const g = ctx.createLinearGradient(0, 0, 0, 1);
    for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  });
}
/** Unit horizontal gradient (0 -> 1) from flat stops. */
export function hGrad(ctx, stops) {
  return gradFor(ctx, 'h', stops, 0, 0, 0, () => {
    const g = ctx.createLinearGradient(0, 0, 1, 0);
    for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  });
}
/** Unit radial gradient (centre 0,0, radius 1; optional inner circle fx,fy,fr) from flat stops. */
export function rGrad(ctx, stops, fx = 0, fy = 0, fr = 0) {
  return gradFor(ctx, 'r', stops, fx, fy, fr, () => {
    const g = ctx.createRadialGradient(fx, fy, fr, 0, 0, 1);
    for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  });
}
/** Fill the current path with a vertical gradient spanning screen y0..y1. */
export function fillPathV(ctx, y0, y1, stops) {
  const h = y1 - y0;
  if (!(Math.abs(h) > 1e-3)) return;
  ctx.translate(0, y0);
  ctx.scale(1, h);
  ctx.fillStyle = vGrad(ctx, stops);
  ctx.fill();
  ctx.scale(1, 1 / h);
  ctx.translate(0, -y0);
}
/** Fill a rect with a vertical gradient spanning its own height. */
export function fillRectV(ctx, x, y, w, h, stops) {
  if (!(h > 1e-3) || !(w > 0)) return;
  ctx.translate(0, y);
  ctx.scale(1, h);
  ctx.fillStyle = vGrad(ctx, stops);
  ctx.fillRect(x, 0, w, 1);
  ctx.scale(1, 1 / h);
  ctx.translate(0, -y);
}
/** Fill the current path with a horizontal gradient spanning screen x0..x1. */
export function fillPathH(ctx, x0, x1, stops) {
  const w = x1 - x0;
  if (!(Math.abs(w) > 1e-3)) return;
  ctx.translate(x0, 0);
  ctx.scale(w, 1);
  ctx.fillStyle = hGrad(ctx, stops);
  ctx.fill();
  ctx.scale(1 / w, 1);
  ctx.translate(-x0, 0);
}
/** Radial-gradient fill of the current path: centre (x, y), radius r, optional inner circle. */
export function fillPathR(ctx, x, y, r, stops, fx = 0, fy = 0, fr = 0) {
  if (!(r > 1e-3)) return;
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.fillStyle = rGrad(ctx, stops, fx, fy, fr);
  ctx.fill();
  ctx.scale(1 / r, 1 / r);
  ctx.translate(-x, -y);
}
/** Current globalAlpha (1 when a context does not report a finite value). */
export function curAlpha(ctx) {
  const a = ctx.globalAlpha;
  return typeof a === 'number' && Number.isFinite(a) ? a : 1;
}
// ---------------------------------------------------------------- cached sprites
// Small pre-rendered sprites (soft spots, star shapes) shared by every context. Consecutive
// drawImage calls of sprites batch into one GPU draw, while every gradient fill or concave path
// fill is a separate, costlier draw in the GPU process (goal blooms, glow passes, confetti stars
// and soft shadows add up to dozens per frame). Without a canvas implementation (node tests)
// cachedSprite returns null and callers draw vectors instead.
const SPRITES = new Map();
let spritesOk = null; // null = unknown, false = no canvas implementation
function newSpriteCanvas(w, h) {
  try {
    // a detached <canvas> first: OffscreenCanvas contexts get per-frame finalize work in Chrome
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch (_) { /* unavailable */ }
  return null;
}
/** Sprite canvas for key (w x h px, painted once by draw(c)), or null when canvases are unavailable. */
export function cachedSprite(key, w, h, draw) {
  if (spritesOk === false) return null;
  let sp = SPRITES.get(key);
  if (sp !== undefined) return sp;
  const cv = newSpriteCanvas(w, h);
  if (!cv) { spritesOk = false; return null; }
  sp = null;
  try {
    draw(cv.getContext('2d'));
    sp = cv;
    spritesOk = true;
  } catch (_) { sp = null; }
  if (SPRITES.size >= 160) SPRITES.delete(SPRITES.keys().next().value);
  SPRITES.set(key, sp);
  return sp;
}
const SPOT_PX = 96;
const SPOT_KEYS = new Map(); // color -> mid -> key (no string building per call)
function spotSprite(color, mid) {
  let byMid = SPOT_KEYS.get(color);
  if (!byMid) { byMid = new Map(); SPOT_KEYS.set(color, byMid); }
  let key = byMid.get(mid);
  if (key === undefined) { key = `spot|${color}|${mid}`; byMid.set(mid, key); }
  return cachedSprite(key, SPOT_PX, SPOT_PX, (c) => {
    const R = SPOT_PX / 2;
    const g = c.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, withAlpha(color, 1));
    g.addColorStop(0.3, withAlpha(color, mid));
    g.addColorStop(1, withAlpha(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, SPOT_PX, SPOT_PX);
  });
}

/** Soft radial spot (glow / soft shadow): one sprite (or cached gradient) per colour, strength via alpha. */
export function softSpot(ctx, x, y, rx, ry, color, a, mid = 0.42) {
  if (!(rx > 0.3) || !(ry > 0.3) || !(a > 0.003)) return;
  const ga = curAlpha(ctx);
  const sp = typeof ctx.drawImage === 'function' ? spotSprite(color, mid) : null;
  if (sp) {
    ctx.globalAlpha = ga * Math.min(1, a);
    ctx.drawImage(sp, x - rx, y - ry, rx * 2, ry * 2);
    ctx.globalAlpha = ga;
    return;
  }
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  ctx.globalAlpha = ga * Math.min(1, a);
  ctx.fillStyle = rGrad(ctx, memo('spot', color, mid, 0, () => [0, withAlpha(color, 1), 0.3, withAlpha(color, mid), 1, withAlpha(color, 0)]));
  ctx.fillRect(-1, -1, 2, 2);
  ctx.globalAlpha = ga;
  ctx.scale(1 / rx, 1 / ry);
  ctx.translate(-x, -y);
}

// ---------------------------------------------------------------- math + shape helpers
/** Deterministic pseudo-random in [0, 1) for an index (decor placement). */
export function hash(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export const wrap = (v, m) => ((v % m) + m) % m;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function ellipsePath(ctx, rx, ry, x = 0, y = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU);
}
export function circlePath(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.01, r), 0, TAU);
}
export function polyPath(ctx, cx, cy, rad, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
/** Rounded-rect path (no reliance on ctx.roundRect for older WebViews). */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------- text metrics
const TEXT_W = new Map();
/** Width of `text` in the context's current font, cached per (font, text): measureText per frame
 *  for the painted end-zone words showed up in profiles. Returns null without measureText. */
export function textWidth(ctx, text) {
  if (typeof ctx.measureText !== 'function') return null;
  const key = ctx.font + '|' + text;
  let w = TEXT_W.get(key);
  if (w === undefined) {
    const m = ctx.measureText(text);
    w = m && Number.isFinite(m.width) ? m.width : null;
    if (TEXT_W.size > 256) TEXT_W.clear();
    TEXT_W.set(key, w);
  }
  return w;
}
