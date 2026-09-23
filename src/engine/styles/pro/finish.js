// Flick Goal — PRO style: sky and screen finishing (ported from try/pro-graphics render.js).
//  * drawSky: three-stop sky gradient (cached per palette, unit gradient).
//  * drawFront: theme front particles (snowflakes / sunset pollen) and the blurred near-camera
//    foreground strip (grass blades / snow drift / sand tufts / neon tufts), a pre-rendered
//    layer tile ('pro:fg-*') that scrolls a bit faster than the field (depth). Low tier: no strip.
//  * drawFinish: soft theme-tinted vignette (one cached gradient per size + mood).

import { mixColor, withAlpha, memo, fillRectV, cachedGradient, wrap } from '../../paint.js';
import { lightOf } from './lights.js';
import { PRO_FRONT } from './decor.js';
import { warmLayer } from './warm.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const FG_W = 480;
const FG_H = 64;
const WARM = Object.freeze({ warm: true });
const COLD = Object.freeze({ warm: false });
const FG_KEYS = { grass: 'pro:fg-grass', snow: 'pro:fg-snow', sand: 'pro:fg-sand', neon: 'pro:fg-neon' };

export function drawSky(ctx, f) {
  const pal = f.pal;
  fillRectV(ctx, 0, 0, f.w, f.h, memo('pro:sky', pal.skyTop, pal.skyBottom, 0, () => [
    0, pal.skyTop, 0.5, mixColor(pal.skyTop, pal.skyBottom, 0.62), 1, pal.skyBottom,
  ]));
}

/** Near-camera foreground strip tile (blur baked in once, inside the layer build). */
function fgTile(c, W, H, p, style) {
  let seed = 777;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let s = 1;
  try {
    const m = c.getTransform && c.getTransform();
    if (m && Number.isFinite(m.a) && m.a > 0) s = m.a;
  } catch (_) { /* stub */ }
  try { c.filter = `blur(${(1.1 * s).toFixed(2)}px)`; } catch (_) { /* unsupported */ }
  if (style === 'snow') {
    const g = c.createLinearGradient(0, H * 0.3, 0, H);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(1, mixColor(p.groundDark, '#8FB2D6', 0.35));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x <= W; x += 12) c.lineTo(x, H - 16 - 12 * (0.5 + 0.5 * Math.sin((x / W) * TAU * 3 + 0.7) * Math.sin((x / W) * TAU * 2)));
    c.lineTo(W, H);
    c.closePath();
    c.fill();
    c.strokeStyle = withAlpha(mixColor(p.groundDark, '#8FB2D6', 0.5), 0.45);
    c.lineWidth = 2.2;
    c.beginPath();
    for (let x = 0; x <= W; x += 12) {
      const y = H - 13 - 12 * (0.5 + 0.5 * Math.sin((x / W) * TAU * 3 + 0.7) * Math.sin((x / W) * TAU * 2));
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 26; i++) c.fillRect(rnd() * W, H - 4 - rnd() * 10, 1.1, 1.1);
  } else {
    const sand = style === 'sand';
    const neon = style === 'neon';
    const back = neon ? mixColor(p.groundDark, '#000000', 0.5) : sand ? mixColor('#7A5A2E', p.groundDark, 0.4) : mixColor(p.groundDark, '#0A2A10', 0.45);
    const mid = neon ? mixColor(p.ground, '#000000', 0.3) : sand ? mixColor('#9C7A45', p.ground, 0.35) : mixColor(p.groundDark, '#0A2A10', 0.2);
    const tip = neon ? p.line : sand ? '#F4E0B0' : mixColor(p.ground, '#FFFFFF', 0.35);
    if (sand) {
      c.fillStyle = mixColor(p.ground, '#B08850', 0.25);
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) c.lineTo(x, H - 10 - 6 * Math.sin((x / W) * TAU * 4));
      c.lineTo(W, H);
      c.closePath();
      c.fill();
    }
    const blades = sand ? 60 : 170;
    for (let pass = 0; pass < 2; pass++) {
      c.fillStyle = pass ? mid : back;
      c.beginPath();
      for (let i = 0; i < blades; i++) {
        let x = rnd() * W;
        if (sand) x = Math.floor(rnd() * 8) * (W / 8) + rnd() * 26;
        const h = (pass ? 16 : 26) + rnd() * (pass ? 26 : 34);
        const wdt = 2.2 + rnd() * 2.4;
        const lean = (rnd() - 0.5) * 22;
        for (const ox of [0, -W, W]) {
          const X = x + ox;
          if (X < -30 || X > W + 30) continue;
          c.moveTo(X - wdt / 2, H);
          c.quadraticCurveTo(X + lean * 0.2, H - h * 0.6, X + lean, H - h);
          c.quadraticCurveTo(X + lean * 0.25 + wdt * 0.3, H - h * 0.55, X + wdt / 2, H);
          c.closePath();
        }
      }
      c.fill();
    }
    c.strokeStyle = withAlpha(tip, neon ? 0.7 : 0.35);
    c.lineWidth = 0.9;
    c.beginPath();
    for (let i = 0; i < 50; i++) {
      const x = rnd() * W;
      const h = 22 + rnd() * 28;
      const lean = (rnd() - 0.5) * 16;
      c.moveTo(x + lean * 0.5, H - h * 0.55);
      c.quadraticCurveTo(x + lean * 0.8, H - h * 0.85, x + lean, H - h);
    }
    c.stroke();
  }
  try { c.filter = 'none'; } catch (_) { /* unsupported */ }
}

export function drawFront(ctx, f) {
  const view = { camX: f.camX, camY: f.camY, k: f.k, w: f.w, h: f.h };
  const front = PRO_FRONT[f.themeId];
  if (front) {
    ctx.save();
    front(ctx, view, f.pal, f.time);
    ctx.restore();
  }
  if (f.lowQ || f.preview) return;
  const style = lightOf(f.themeId).fg || 'grass';
  const key = FG_KEYS[style] || FG_KEYS.grass;
  const draw = (c, p) => fgTile(c, FG_W, FG_H, p, style);
  warmLayer(ctx, f.inFlight ? COLD : WARM, f.layers, key, FG_W, FG_H, f.pal, draw);
  // the strip only shows once the near sideline is well above the bottom of the view
  const a = clamp((f.h - f.gy - 150) / 120, 0, 1);
  if (a <= 0) return;
  const y = f.h - FG_H + 10;
  const off = wrap(f.camX * f.k * 1.3, FG_W);
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = a * (style === 'snow' ? 0.9 : 0.92);
  for (let x = -off; x < f.w; x += FG_W) {
    f.layers.layer(ctx, key, FG_W, FG_H, draw, x, y);
  }
  ctx.globalAlpha = ga;
}

export function drawFinish(ctx, f) {
  const L = lightOf(f.themeId);
  const w = f.w;
  const h = f.h;
  const A = f.preview ? L.vignetteA * 0.6 : L.vignetteA;
  const key = memo('pro:vigk', w * 100000 + h, L, A, () => `pro:vig|${w}x${h}|${L.vignette}|${A}`);
  const g = cachedGradient(ctx, key, () => {
    const cx = w / 2;
    const cy = h * 0.46;
    const gr = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.42, cx, cy, Math.hypot(w / 2, h * 0.56) * 1.02);
    gr.addColorStop(0, withAlpha(L.vignette, 0));
    gr.addColorStop(0.55, withAlpha(L.vignette, A * 0.35));
    gr.addColorStop(1, withAlpha(L.vignette, A));
    return gr;
  });
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
