// Flick Goal — PRO style: shaded ball skins (ported from try/pro-graphics skins.js).
// Every skin draws at the origin with the long axis along +x (football ~1.3r x 0.85r, round
// ~1.05r) and is lit by the stadium's key light: draw(ctx, r, time, rot, light) where rot is the
// canvas rotation the caller applied (so the lighting stays screen-aligned while the texture
// spins) and light = { x, y, rim, rimA } (screen-space direction TO the light + rim colour).
// Form shading, specular, rim light, pebble grain, raised laces, env reflections for glossy /
// metal skins. Gradients are unit gradients cached per context (paint.js), none built per frame.

import {
  withAlpha, mixColor, memo, rGrad, fillRectV, hash, wrap, circlePath, ellipsePath, polyPath,
} from '../../paint.js';
import { BALL_META } from '../../themes.js';

const TAU = Math.PI * 2;

const FOOT = { rx: 1.3, ry: 0.85 };
const ROUND = { round: true };
const RUGBY = { rx: 1.22, ry: 0.95 };

function shapePath(ctx, r, shape) {
  if (shape.round) circlePath(ctx, 0, 0, 1.05 * r);
  else ellipsePath(ctx, shape.rx * r, shape.ry * r);
}
function extents(r, shape) {
  return shape.round ? [1.05 * r, 1.05 * r] : [shape.rx * r, shape.ry * r];
}

// ---------------------------------------------------------------- ball lighting
/** Default key light: screen-space unit vector pointing TO the light (top-left), soft white rim. */
export const DEFAULT_LIGHT = Object.freeze({ x: -0.6, y: -0.8, rim: '#FFFFFF', rimA: 0.3 });

/** Screen-space light -> the ball's local (rotated) frame. rot = the ctx rotation applied to the ball. */
function localLight(lt, rot) {
  const L = lt || DEFAULT_LIGHT;
  const c = Math.cos(rot || 0);
  const s = Math.sin(rot || 0);
  let x = Number(L.x);
  let y = Number(L.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) { x = DEFAULT_LIGHT.x; y = DEFAULT_LIGHT.y; }
  const m = Math.hypot(x, y);
  x /= m; y /= m;
  return {
    x: c * x + s * y,
    y: -s * x + c * y,
    rim: L.rim || '#FFFFFF',
    rimA: Number.isFinite(L.rimA) ? L.rimA : 0.3,
  };
}

/** Soft form shading: lit core toward the light, falling off into a shade-coloured terminator. */
function bodyShade(ctx, r, shape, ll, shade, hi, k = 1, clipped = false) {
  const [ex, ey] = extents(r, shape);
  ctx.save();
  if (!clipped) {
    shapePath(ctx, r, shape);
    ctx.clip();
  }
  ctx.scale(1, ey / ex); // work in a circle space so the falloff follows the silhouette
  ctx.rotate(Math.atan2(ll.y, ll.x)); // light along +x: one cached gradient serves every angle
  const R = ex * 1.28;
  ctx.translate(ex * 0.22, 0);
  ctx.scale(R, R);
  // inner circle sits at +0.28 ex from the outer centre (toward the light), radius 0
  ctx.fillStyle = rGrad(ctx, memo('body', hi, shade, k, () => [
    0, withAlpha(hi, 0.5 * k), 0.3, withAlpha(hi, 0), 0.55, withAlpha(shade, 0),
    0.86, withAlpha(shade, 0.72 * k), 1, withAlpha(shade, 0.95 * Math.min(1, k)),
  ]), 0.28 / 1.28, 0, 0);
  ctx.fillRect(-1.4, -1.4, 2.8, 2.8);
  ctx.restore();
}

/** Specular hot-spot + glint on the lit side, thin rim light on the far side. */
function specRim(ctx, r, shape, ll, { spec = 0.85, rim = 1, glint = 1 } = {}, clipped = false) {
  const [ex, ey] = extents(r, shape);
  ctx.save();
  if (!clipped) {
    shapePath(ctx, r, shape);
    ctx.clip();
  }
  // rim: crescent left over when the silhouette is shifted toward the light
  if (rim > 0 && ll.rimA > 0) {
    ctx.globalAlpha = Math.min(1, ll.rimA * rim);
    ctx.fillStyle = ll.rim;
    ctx.beginPath();
    ctx.ellipse(0, 0, ex * 1.6, ex * 1.6, 0, 0, TAU);
    ctx.ellipse(ll.x * ex * 0.11, ll.y * ey * 0.14, ex, ey, 0, 0, TAU);
    ctx.fill('evenodd');
  }
  if (spec > 0) {
    const hx = ll.x * ex * 0.42;
    const hy = ll.y * ey * 0.5;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(ex * 0.46, ex * 0.46 * (shape.round ? 0.72 : 0.5));
    ctx.fillStyle = rGrad(ctx, memo('spec', spec, 0, 0, () => [0, `rgba(255,255,255,${0.75 * spec})`, 0.45, `rgba(255,255,255,${0.22 * spec})`, 1, 'rgba(255,255,255,0)']));
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    if (glint > 0) {
      ctx.globalAlpha = Math.min(1, 0.9 * spec * glint);
      ctx.fillStyle = '#FFFFFF';
      ellipsePath(ctx, r * 0.11, r * 0.055, hx - ll.x * r * 0.06, hy - ll.y * r * 0.02);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Screen-aligned environment reflection for metallic / glossy skins. */
function envReflect(ctx, r, shape, rot, top, bottom, a = 1, clipped = false) {
  const [ex] = extents(r, shape);
  ctx.save();
  if (!clipped) {
    shapePath(ctx, r, shape);
    ctx.clip();
  }
  ctx.rotate(-rot);
  fillRectV(ctx, -ex * 1.4, -ex, ex * 2.8, ex * 2, memo('env', top, bottom, a, () => [
    0, withAlpha(top, 0.3 * a), 0.44, withAlpha(top, 0), 0.54, withAlpha(bottom, 0.38 * a),
    0.72, withAlpha(bottom, 0.1 * a), 1, withAlpha(top, 0.18 * a),
  ]));
  ctx.restore();
}

// Pebble grain: fixed unit-disc sample table, drawn in the ball frame (rotates with the ball).
const GRAIN = [];
for (let i = 0; i < 72; i++) {
  const a = hash(i * 3.17 + 0.5) * TAU;
  const d = Math.sqrt(hash(i * 7.91 + 1.3)) * 0.93;
  GRAIN.push([Math.cos(a) * d, Math.sin(a) * d]);
}
function grain(ctx, r, shape, dark, darkA, lite, liteA, density = 1) {
  if (r < 20) return; // sub-pixel at in-game sizes (r <= ~18 px); shows on close-ups and store cards
  const [ex, ey] = extents(r, shape);
  const n = Math.min(GRAIN.length, Math.round(GRAIN.length * density));
  const dr = Math.max(0.35, r * 0.03);
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass ? lite : dark;
    ctx.globalAlpha = pass ? liteA : darkA;
    ctx.beginPath();
    for (let i = pass; i < n; i += 2) {
      const x = GRAIN[i][0] * ex;
      const y = GRAIN[i][1] * ey;
      ctx.moveTo(x + dr, y);
      ctx.arc(x, y, dr, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function outline(ctx, r, shape, color, w = 0.075) {
  shapePath(ctx, r, shape);
  ctx.lineWidth = Math.max(1, r * w);
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Centre seam with stitch ticks running tip to tip (under the laces). */
function seam(ctx, r, color) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(0.8, r * 0.045);
  ctx.beginPath();
  ctx.moveTo(-1.12 * r, 0.02 * r);
  ctx.quadraticCurveTo(-0.8 * r, 0, -0.55 * r, 0);
  ctx.moveTo(0.55 * r, 0);
  ctx.quadraticCurveTo(0.8 * r, 0, 1.12 * r, 0.02 * r);
  ctx.stroke();
  if (r >= 7) {
    ctx.lineWidth = Math.max(0.6, r * 0.03);
    ctx.beginPath();
    for (const s of [-1, 1]) {
      for (let x = 0.64; x < 1.05; x += 0.12) {
        ctx.moveTo(s * x * r, -0.06 * r);
        ctx.lineTo(s * (x + 0.04) * r, 0.06 * r);
      }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Raised laces: soft drop shadow, optional under-colour, lace, top highlight, stitch holes. */
function laces(ctx, r, color, under = null) {
  ctx.lineCap = 'round';
  const set = (col, dx, dy, extra) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, r * 0.13 + extra);
    ctx.beginPath();
    ctx.moveTo(-r * 0.5 + dx, dy);
    ctx.lineTo(r * 0.5 + dx, dy);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.1 + extra);
    ctx.beginPath();
    for (const x of [-0.36, -0.12, 0.12, 0.36]) {
      ctx.moveTo(r * x + dx, -r * 0.2 + dy);
      ctx.lineTo(r * x + dx, r * 0.2 + dy);
    }
    ctx.stroke();
  };
  set('rgba(20,8,0,0.32)', r * 0.025, r * 0.06, r * 0.02);
  if (under) set(under, 0, 0, r * 0.08);
  set(color, 0, 0, 0);
  if (r >= 6) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(0.6, r * 0.035);
    ctx.beginPath();
    ctx.moveTo(-r * 0.44, -r * 0.03);
    ctx.lineTo(r * 0.44, -r * 0.03);
    for (const x of [-0.36, -0.12, 0.12, 0.36]) {
      ctx.moveTo(r * (x - 0.02), -r * 0.16);
      ctx.lineTo(r * (x - 0.02), -r * 0.05);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(30,12,0,0.45)';
    ctx.beginPath();
    const hr = Math.max(0.4, r * 0.035);
    for (const x of [-0.36, -0.12, 0.12, 0.36]) {
      for (const y of [-0.24, 0.24]) {
        ctx.moveTo(r * x + hr, r * y);
        ctx.arc(r * x, r * y, hr, 0, TAU);
      }
    }
    ctx.fill();
  }
}

function tipStripes(ctx, r, color, at = 0.8, w = 0.15) {
  ctx.fillStyle = color;
  ctx.fillRect(-r * (at + w / 2), -r * 2, r * w, r * 4);
  ctx.fillRect(r * (at - w / 2), -r * 2, r * w, r * 4);
}

function clipShape(ctx, r, shape, fn) {
  ctx.save();
  shapePath(ctx, r, shape);
  ctx.clip();
  fn();
  ctx.restore();
}

// ---------------------------------------------------------------- ball skins
// Draw fns: (ctx, r, time, rot = 0, light = DEFAULT_LIGHT). rot is the rotation the caller applied,
// so the lighting can be kept screen-aligned while the texture spins.
function footballSkin({
  base, shade, hi, lace, laceUnder, rim, stripes, pattern, shape = FOOT, after,
  grainDark = null, grainLite = '#FFFFFF', grainA = 0.14, grainDensity = 1, seamCol = null,
  shadeK = 1, spec = 0.8, rimK = 1, metal = null,
}) {
  return (ctx, r, time, rot = 0, lt) => {
    const ll = localLight(lt, rot);
    shapePath(ctx, r, shape);
    ctx.fillStyle = base;
    ctx.fill();
    // One clip for every interior layer (texture, form shading, laces, highlights).
    ctx.save();
    ctx.clip();
    if (pattern) pattern(ctx, r, time);
    if (stripes) tipStripes(ctx, r, stripes);
    if (grainDark) grain(ctx, r, shape, grainDark, grainA, grainLite, grainA * 0.8, grainDensity);
    bodyShade(ctx, r, shape, ll, shade, hi, shadeK, true);
    if (metal) envReflect(ctx, r, shape, rot, metal[0], metal[1], metal[2], true);
    if (seamCol) seam(ctx, r, seamCol);
    if (lace) laces(ctx, r, lace, laceUnder);
    specRim(ctx, r, shape, ll, { spec, rim: rimK }, true);
    ctx.restore();
    if (after) after(ctx, r, time, rot);
    outline(ctx, r, shape, rim);
  };
}

function drawSoccer(ctx, r, time, rot = 0, lt) {
  const ll = localLight(lt, rot);
  const rr = 1.05 * r;
  circlePath(ctx, 0, 0, rr);
  ctx.fillStyle = '#FAFBFD';
  ctx.fill();
  clipShape(ctx, r, ROUND, () => {
    const ink = '#26314D';
    ctx.fillStyle = ink;
    polyPath(ctx, 0, 0, rr * 0.36, 5, -Math.PI / 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, r * 0.07);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rr * 0.36, Math.sin(a) * rr * 0.36);
      ctx.lineTo(Math.cos(a) * rr * 0.72, Math.sin(a) * rr * 0.72);
      ctx.stroke();
      const b = a + Math.PI / 5;
      polyPath(ctx, Math.cos(b) * rr * 1.0, Math.sin(b) * rr * 1.0, rr * 0.34, 5, b + Math.PI);
      ctx.fill();
    }
    // panel seams between the white hexagons
    ctx.strokeStyle = 'rgba(38,49,77,0.25)';
    ctx.lineWidth = Math.max(0.6, r * 0.03);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * TAU + Math.PI / 5;
      ctx.moveTo(Math.cos(a) * rr * 0.3, Math.sin(a) * rr * 0.3);
      ctx.lineTo(Math.cos(a) * rr * 0.68, Math.sin(a) * rr * 0.68);
    }
    ctx.stroke();
  });
  bodyShade(ctx, r, ROUND, ll, '#7D8AA8', '#FFFFFF', 0.95);
  specRim(ctx, r, ROUND, ll, { spec: 0.9 });
  outline(ctx, r, ROUND, '#26314D', 0.07);
}

function drawBasketball(ctx, r, time, rot = 0, lt) {
  const ll = localLight(lt, rot);
  const rr = 1.05 * r;
  circlePath(ctx, 0, 0, rr);
  ctx.fillStyle = '#F57C2E';
  ctx.fill();
  clipShape(ctx, r, ROUND, () => {
    grain(ctx, r, ROUND, '#7A2E05', 0.22, '#FFC08F', 0.16, 1);
  });
  bodyShade(ctx, r, ROUND, ll, '#A8400C', '#FFC08F', 1);
  clipShape(ctx, r, ROUND, () => {
    ctx.strokeStyle = '#3E1C06';
    ctx.lineWidth = Math.max(1, r * 0.085);
    ctx.beginPath();
    ctx.moveTo(-rr, 0);
    ctx.lineTo(rr, 0);
    ctx.moveTo(0, -rr);
    ctx.lineTo(0, rr);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-rr * 1.28, 0, rr * 0.95, -1.2, 1.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rr * 1.28, 0, rr * 0.95, Math.PI - 1.2, Math.PI + 1.2);
    ctx.stroke();
  });
  specRim(ctx, r, ROUND, ll, { spec: 0.45 });
  outline(ctx, r, ROUND, '#4A2208', 0.07);
}

function drawPixel(ctx, r, time, rot = 0, lt) {
  // Chunky 8-bit football on a centred cell grid. Each cell is lit from its ellipse normal,
  // quantised to four tones, so the pixel ball shades like the others without losing its grid.
  const ll = localLight(lt, rot);
  const c = r * 0.2;
  const rx = 1.3 * r;
  const ry = 0.85 * r;
  const inside = (i, j) => ((i * c) ** 2) / (rx * rx) + ((j * c) ** 2) / (ry * ry) <= 1.0;
  const nx = Math.ceil(rx / c) + 1;
  const ny = Math.ceil(ry / c) + 1;
  const tones = ['#7A3A1B', '#A5552B', '#C46E3A', '#E39A5C'];
  const rimCol = ll.rimA > 0.2 ? mixColor('#A5552B', ll.rim, Math.min(0.75, ll.rimA)) : '#4A220E';
  const hxI = Math.round((ll.x * 0.5 * rx) / c);
  const hyI = Math.round((ll.y * 0.55 * ry) / c);
  for (let j = -ny; j <= ny; j++) {
    for (let i = -nx; i <= nx; i++) {
      if (!inside(i, j)) continue;
      const edge = !inside(i + 1, j) || !inside(i - 1, j) || !inside(i, j + 1) || !inside(i, j - 1);
      const px = (i * c) / rx;
      const py = (j * c) / ry;
      const d = px * ll.x + py * ll.y;
      let col;
      if (edge) col = d < -0.45 ? rimCol : '#4A220E';
      else col = tones[d > 0.45 ? 3 : d > 0.05 ? 2 : d > -0.4 ? 1 : 0];
      if (!edge && j === 0 && Math.abs(i) <= 2) col = '#FFFFFF';
      if (!edge && Math.abs(j) === 1 && (i === -2 || i === 0 || i === 2)) col = '#FFFFFF';
      if (!edge && Math.abs(i) === 4 && Math.abs(j) <= 2) col = '#FFFFFF'; // tip stripes
      if (!edge && i === hxI && j === hyI) col = '#FFE7C7';
      ctx.fillStyle = col;
      ctx.fillRect(i * c - c / 2, j * c - c / 2, c + 0.4, c + 0.4);
    }
  }
  if (Math.sin(time * 6) > 0) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-3 * c - c / 2, -2 * c - c / 2, c, c);
  }
}

function camoPattern(ctx, r) {
  const cols = ['#4B5320', '#8F9A52', '#3B3B2A', '#A7A56B'];
  for (let i = 0; i < 11; i++) {
    const x = (hash(i * 3.1) * 2.8 - 1.4) * r;
    const y = (hash(i * 7.7) * 1.8 - 0.9) * r;
    const s = (0.22 + hash(i * 5.3) * 0.28) * r;
    ctx.fillStyle = cols[i % cols.length];
    ctx.beginPath();
    ctx.ellipse(x, y, s * 1.4, s, hash(i) * 3, 0, TAU);
    ctx.ellipse(x + s * 0.8, y + s * 0.3, s * 0.9, s * 0.7, hash(i + 9) * 3, 0, TAU);
    ctx.fill();
  }
}

function candyPattern(ctx, r) {
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = r * 0.24;
  ctx.beginPath();
  for (let i = -6; i <= 6; i++) {
    const x = i * r * 0.55;
    ctx.moveTo(x - r * 1.5, -r * 1.5);
    ctx.lineTo(x + r * 1.5, r * 1.5);
  }
  ctx.stroke();
}

function melonPattern(ctx, r) {
  ctx.strokeStyle = '#1E7B34';
  ctx.lineWidth = r * 0.16;
  ctx.lineCap = 'round';
  for (let j = -2; j <= 2; j++) {
    ctx.beginPath();
    for (let k = 0; k <= 16; k++) {
      const x = -1.4 * r + (k / 16) * 2.8 * r;
      const y = j * r * 0.34 + Math.sin(k * 1.3 + j) * r * 0.06;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function galaxyPattern(ctx, r, time) {
  const neb = [['#7B2FF7', -0.5, -0.2, 0.7], ['#F107A3', 0.55, 0.25, 0.6], ['#3A86FF', 0.1, 0.45, 0.5]];
  for (const [c, x, y, s] of neb) {
    ctx.save();
    ctx.translate(x * r, y * r);
    ctx.scale(1.2, 0.8);
    ctx.scale(s * r, s * r);
    ctx.fillStyle = rGrad(ctx, memo('neb', c, 0, 0, () => [0, withAlpha(c, 0.8), 1, withAlpha(c, 0)]));
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < 14; i++) {
    const x = (hash(i * 2.3) * 2.4 - 1.2) * r;
    const y = (hash(i * 4.9) * 1.4 - 0.7) * r;
    const tw = 0.5 + 0.5 * Math.sin(time * 3 + i * 1.7);
    ctx.globalAlpha = 0.35 + 0.65 * tw;
    circlePath(ctx, x, y, r * (0.03 + 0.04 * hash(i * 8.1)));
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function icePattern(ctx, r) {
  ctx.fillStyle = '#E6F9FF';
  ctx.beginPath();
  ctx.moveTo(-1.2 * r, -0.2 * r);
  ctx.lineTo(-0.3 * r, -0.9 * r);
  ctx.lineTo(0.2 * r, -0.1 * r);
  ctx.closePath();
  ctx.moveTo(0.35 * r, -0.85 * r);
  ctx.lineTo(1.2 * r, -0.3 * r);
  ctx.lineTo(0.55 * r, 0.1 * r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8FD3F5';
  ctx.beginPath();
  ctx.moveTo(-0.9 * r, 0.8 * r);
  ctx.lineTo(-0.2 * r, 0.15 * r);
  ctx.lineTo(0.4 * r, 0.9 * r);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  ctx.moveTo(-0.7 * r, -0.5 * r);
  ctx.lineTo(-0.35 * r, -0.1 * r);
  ctx.lineTo(-0.5 * r, 0.3 * r);
  ctx.moveTo(-0.35 * r, -0.1 * r);
  ctx.lineTo(0 * r, -0.05 * r);
  ctx.moveTo(0.6 * r, 0.3 * r);
  ctx.lineTo(0.9 * r, 0.5 * r);
  ctx.stroke();
}

function firePattern(ctx, r, time) {
  // Flames licking from the trailing (-x) end toward the nose.
  const fl = (col, len, amp, ph) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-1.5 * r, -0.9 * r);
    const n = 4;
    for (let i = 0; i <= n; i++) {
      const y = -0.9 * r + (i / n) * 1.8 * r;
      const f = Math.sin(time * 14 + i * 2.1 + ph) * amp * r;
      const x = -1.5 * r + (len + (i % 2 ? 0.25 : 0)) * r + f;
      ctx.quadraticCurveTo(x - 0.4 * r, y - 0.2 * r, x, y);
    }
    ctx.lineTo(-1.5 * r, 0.9 * r);
    ctx.closePath();
    ctx.fill();
  };
  fl('#FF9F1C', 1.35, 0.12, 0);
  fl('#FFD23F', 0.8, 0.1, 1.3);
  fl('#FFF3B0', 0.35, 0.08, 2.4);
}

function neonAfter(ctx, r, time) {
  const pulse = 0.65 + 0.35 * Math.sin(time * 5);
  ctx.save();
  ctx.globalAlpha = 0.18 * pulse;
  ellipsePath(ctx, 1.3 * r, 0.85 * r);
  ctx.strokeStyle = '#00F0FF';
  ctx.lineWidth = r * 0.75;
  ctx.stroke();
  ctx.globalAlpha = 0.3 * pulse;
  ctx.lineWidth = r * 0.45;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ellipsePath(ctx, 1.02 * r, 0.62 * r);
  ctx.strokeStyle = '#FF2BD6';
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,200,245,0.8)';
  ctx.lineWidth = Math.max(0.5, r * 0.03);
  ctx.stroke();
  ellipsePath(ctx, 1.3 * r, 0.85 * r);
  ctx.strokeStyle = '#00F0FF';
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(210,255,255,0.85)';
  ctx.lineWidth = Math.max(0.6, r * 0.05);
  ctx.stroke();
  ctx.restore();
}

function goldAfter(ctx, r, time) {
  // Animated shine sweep.
  ctx.save();
  ellipsePath(ctx, 1.3 * r, 0.85 * r);
  ctx.clip();
  const x = (wrap(time * 0.7, 2) - 1) * 3.2 * r;
  ctx.rotate(0.35);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, -2 * r, r * 0.28, 4 * r);
  ctx.globalAlpha = 0.3;
  ctx.fillRect(x + r * 0.42, -2 * r, r * 0.12, 4 * r);
  ctx.restore();
}

function rugbyPattern(ctx, r) {
  ctx.fillStyle = '#FF5A5F';
  ctx.fillRect(-0.28 * r, -2 * r, 0.56 * r, 4 * r);
  ctx.fillStyle = '#2E3A59';
  ctx.fillRect(-0.44 * r, -2 * r, 0.1 * r, 4 * r);
  ctx.fillRect(0.34 * r, -2 * r, 0.1 * r, 4 * r);
  ctx.fillStyle = '#FFC83D';
  ctx.beginPath();
  ctx.moveTo(-0.9 * r, -0.2 * r);
  ctx.lineTo(-0.65 * r, 0);
  ctx.lineTo(-0.9 * r, 0.2 * r);
  ctx.closePath();
  ctx.fill();
}

function rugbySeam(ctx, r) {
  ctx.strokeStyle = 'rgba(46,58,89,0.45)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.setLineDash([r * 0.12, r * 0.1]);
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.1 * r, 0.42 * r, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.setLineDash([]);
}

function proSeams(ctx, r) {
  ctx.strokeStyle = '#A9B1C2';
  ctx.lineWidth = Math.max(1, r * 0.045);
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.18 * r, 0.5 * r, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.18 * r, 0.5 * r, 0, Math.PI * 0.1, Math.PI * 0.9);
  ctx.stroke();
}

function def(id, name, shape, trail, fx, draw) {
  return { id, name, shape, trail, fx, draw };
}

const SKINS = Object.freeze({
  classic: def('classic', 'Classic', 'football', '#FFFFFF', 'none', footballSkin({
    base: '#A5552B', shade: '#4E200B', hi: '#E8A070', lace: '#FFFFFF', rim: '#4A200C',
    grainDark: '#3A1405', grainLite: '#F0B080', grainA: 0.2, seamCol: '#4A1C08',
  })),
  retro: def('retro', 'Retro', 'football', '#FFE0B2', 'none', footballSkin({
    base: '#D98A3D', shade: '#7E4312', hi: '#FFD29A', lace: '#FFFFFF', rim: '#6E3B12', stripes: '#FFF8EC',
    grainDark: '#6E3B12', grainLite: '#FFE0B2', grainA: 0.16, seamCol: '#6E3B12',
  })),
  pro: def('pro', 'Pro White', 'football', '#FFFFFF', 'none', footballSkin({
    base: '#F7F7F2', shade: '#8E97AD', hi: '#FFFFFF', lace: '#8B4513', rim: '#7C869C', stripes: '#2E3A59', pattern: proSeams,
    grainDark: '#8E97AD', grainLite: '#FFFFFF', grainA: 0.1, shadeK: 0.85,
  })),
  soccer: def('soccer', 'Soccer', 'round', '#FFFFFF', 'none', drawSoccer),
  basketball: def('basketball', 'Hoops', 'round', '#FF9E40', 'none', drawBasketball),
  rugby: def('rugby', 'Rugby', 'football', '#FF5A5F', 'none', footballSkin({
    base: '#FAFAF5', shade: '#8C95AE', hi: '#FFFFFF', rim: '#2E3A59', pattern: rugbyPattern, shape: RUGBY, after: rugbySeam,
    grainDark: '#8C95AE', grainLite: '#FFFFFF', grainA: 0.1, grainDensity: 0.8, shadeK: 0.9,
  })),
  candy: def('candy', 'Candy', 'football', '#FF7BC8', 'sparkle', footballSkin({
    base: '#FF6FB5', shade: '#B0206A', hi: '#FFE1F1', lace: '#FFFFFF', laceUnder: '#B0206A', rim: '#A8195E', pattern: candyPattern,
    spec: 1, metal: ['#FFFFFF', '#A8195E', 0.6],
  })),
  watermelon: def('watermelon', 'Melon', 'football', '#6BE36B', 'none', footballSkin({
    base: '#3CB043', shade: '#135A20', hi: '#B8F5B8', lace: '#F4FFE8', laceUnder: '#FF5A6E', rim: '#16572A', pattern: melonPattern,
    spec: 0.9,
  })),
  camo: def('camo', 'Camo', 'football', '#A4B06A', 'none', footballSkin({
    base: '#6B7B3A', shade: '#262C12', hi: '#C9D49A', lace: '#EDE8CF', rim: '#2F3418', pattern: camoPattern,
    grainDark: '#1E220E', grainLite: '#D8DDB0', grainA: 0.16, seamCol: '#2F3418', spec: 0.55,
  })),
  neon: def('neon', 'Neon', 'football', '#00F0FF', 'sparkle', footballSkin({
    base: '#1A1033', shade: '#05020C', hi: '#7B5AD8', lace: '#39FF88', rim: '#00F0FF', after: neonAfter, spec: 0.9,
  })),
  ice: def('ice', 'Ice', 'football', '#B8F1FF', 'frost', footballSkin({
    base: '#BDEBFF', shade: '#3F8FC2', hi: '#FFFFFF', lace: '#FFFFFF', laceUnder: '#5FB6E0', rim: '#4FA9D8', pattern: icePattern,
    spec: 1, metal: ['#FFFFFF', '#5FB6E0', 0.8],
  })),
  fire: def('fire', 'Fire', 'football', '#FF8A00', 'fire', footballSkin({
    base: '#E8401C', shade: '#6E1404', hi: '#FFD08A', lace: '#FFF2B0', laceUnder: '#B82A10', rim: '#7A1A06', pattern: firePattern,
    spec: 0.8,
  })),
  pixel: def('pixel', 'Pixel', 'football', '#7CFF6B', 'pixel', drawPixel),
  galaxy: def('galaxy', 'Galaxy', 'football', '#B388FF', 'sparkle', footballSkin({
    base: '#24104F', shade: '#07021A', hi: '#A58AF0', lace: '#E9DEFF', rim: '#0B0426', pattern: galaxyPattern, spec: 0.9,
  })),
  gold: def('gold', 'Gold', 'football', '#FFD54F', 'sparkle', footballSkin({
    base: '#FFC83D', shade: '#8A5200', hi: '#FFF6C8', lace: '#8A5A00', rim: '#8C5E00', stripes: '#E8A000', after: goldAfter,
    spec: 1, shadeK: 1.1, metal: ['#FFFBE0', '#7A4A00', 1],
  })),
});


/** Pro ball skins keyed by catalog ball id: { draw(ctx, r, time, rot, light) }. */
export const PRO_BALLS = Object.freeze(Object.fromEntries(Object.keys(BALL_META).map((id) => {
  const s = SKINS[id] || SKINS.classic;
  return [id, Object.freeze({ id, draw: s.draw })];
})));

/** Store-card preview centred in a size x size box (caller applied dpr), lit by the default light. */
export function previewProBall(ctx, id, size, time = 0, light = DEFAULT_LIGHT) {
  const skin = PRO_BALLS[id] || PRO_BALLS.classic;
  const round = (BALL_META[id] || BALL_META.classic).shape === 'round';
  const r = round ? size * 0.34 : size * 0.3;
  ctx.save();
  ctx.translate(size / 2, size * 0.88);
  ctx.scale(size * 0.32, size * 0.32 * 0.2);
  ctx.fillStyle = rGrad(ctx, PREVIEW_SHADOW);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  const rot = round ? 0.25 : -0.5;
  ctx.save();
  ctx.translate(size / 2, size * 0.47);
  ctx.rotate(rot);
  skin.draw(ctx, r, time || 0, rot, light || DEFAULT_LIGHT);
  ctx.restore();
}
const PREVIEW_SHADOW = [0, 'rgba(0,0,0,0.26)', 0.55, 'rgba(0,0,0,0.12)', 1, 'rgba(0,0,0,0)'];
