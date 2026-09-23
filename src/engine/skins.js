// Flick Goal — procedural ball skins and stadium themes (pure canvas; no DOM).
//
// Every draw function only uses the ctx it is given, so the shell can reuse them
// for store previews and Node tests can run them against a stub context.
// Ball draw functions draw at the origin with the long axis along +x
// (football ellipse ~1.3r x 0.85r, round balls ~1.05r). Colors are flat, with
// one shade crescent + one highlight that stay screen-aligned (light from top-left).

import { CONFIG } from '../config.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- color utils
function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
/** Mix two #rrggbb colors (u = 0 -> a, 1 -> b). */
export function mixColor(a, b, u) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u);
}
/** '#rrggbb' + alpha -> 'rgba(...)'. */
export function withAlpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}
/** Blend every color key of two palettes. */
export function mixPalette(p, q, u) {
  const out = {};
  for (const k of Object.keys(p)) out[k] = q[k] ? mixColor(p[k], q[k], u) : p[k];
  return out;
}

function hash(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
const wrap = (v, m) => ((v % m) + m) % m;

// ---------------------------------------------------------------- shape helpers
function ellipsePath(ctx, rx, ry, x = 0, y = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU);
}
function circlePath(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.01, r), 0, TAU);
}
function polyPath(ctx, cx, cy, rad, n, rot) {
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

const FOOT = { rx: 1.3, ry: 0.85 };

function shapePath(ctx, r, shape) {
  if (shape.round) circlePath(ctx, 0, 0, 1.05 * r);
  else ellipsePath(ctx, shape.rx * r, shape.ry * r);
}

/** Flat lighting that stays screen-aligned: shade crescent bottom-right, highlight top-left. */
function light(ctx, r, rot, shape, shade, hi, shadeAlpha = 0.7, hiAlpha = 0.9) {
  ctx.save();
  shapePath(ctx, r, shape);
  ctx.clip();
  ctx.rotate(-rot);
  const ext = shape.round ? 1.05 * r : shape.rx * r;
  if (shade) {
    ctx.globalAlpha = shadeAlpha;
    ctx.fillStyle = shade;
    // Crescent = big disc minus an up-left offset copy (even-odd fill), clipped to the ball.
    ctx.beginPath();
    ctx.ellipse(0, 0, ext * 1.6, ext * 1.6, 0, 0, TAU);
    ctx.ellipse(-ext * 0.14, -ext * 0.2, ext * 1.02, ext * 0.98, 0, 0, TAU);
    ctx.fill('evenodd');
  }
  if (hi) {
    ctx.globalAlpha = hiAlpha;
    ctx.fillStyle = hi;
    ctx.beginPath();
    ctx.ellipse(-r * 0.42, -r * 0.46, r * 0.36, r * 0.15, -0.35, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = hiAlpha * 0.9;
    circlePath(ctx, -r * 0.02, -r * 0.62, r * 0.07);
    ctx.fill();
  }
  ctx.restore();
}

function outline(ctx, r, shape, color, w = 0.1) {
  shapePath(ctx, r, shape);
  ctx.lineWidth = Math.max(1, r * w);
  ctx.strokeStyle = color;
  ctx.stroke();
}

function laces(ctx, r, color, under = null) {
  ctx.lineCap = 'round';
  const draw = (col, extra) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, r * 0.13 + extra);
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, 0);
    ctx.lineTo(r * 0.5, 0);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.1 + extra);
    ctx.beginPath();
    for (const x of [-0.36, -0.12, 0.12, 0.36]) {
      ctx.moveTo(r * x, -r * 0.2);
      ctx.lineTo(r * x, r * 0.2);
    }
    ctx.stroke();
  };
  if (under) draw(under, r * 0.08);
  draw(color, 0);
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
function footballSkin({ base, shade, hi, lace, laceUnder, rim, stripes, pattern, shape = FOOT, after }) {
  return (ctx, r, time, rot = 0) => {
    shapePath(ctx, r, shape);
    ctx.fillStyle = base;
    ctx.fill();
    if (pattern || stripes) {
      clipShape(ctx, r, shape, () => {
        if (pattern) pattern(ctx, r, time);
        if (stripes) tipStripes(ctx, r, stripes);
      });
    }
    light(ctx, r, rot, shape, shade, hi);
    if (lace) laces(ctx, r, lace, laceUnder);
    if (after) after(ctx, r, time, rot);
    outline(ctx, r, shape, rim);
  };
}

const ROUND = { round: true };
const RUGBY = { rx: 1.22, ry: 0.95 };

function drawSoccer(ctx, r, time, rot = 0) {
  const rr = 1.05 * r;
  circlePath(ctx, 0, 0, rr);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  clipShape(ctx, r, ROUND, () => {
    const ink = '#2E3A59';
    ctx.fillStyle = ink;
    polyPath(ctx, 0, 0, rr * 0.36, 5, -Math.PI / 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, r * 0.08);
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
  });
  light(ctx, r, rot, ROUND, '#C9D2E3', '#FFFFFF', 0.85, 0.5);
  outline(ctx, r, ROUND, '#2E3A59', 0.09);
}

function drawBasketball(ctx, r, time, rot = 0) {
  const rr = 1.05 * r;
  circlePath(ctx, 0, 0, rr);
  ctx.fillStyle = '#FF8A3D';
  ctx.fill();
  light(ctx, r, rot, ROUND, '#E0661C', '#FFC08F');
  clipShape(ctx, r, ROUND, () => {
    ctx.strokeStyle = '#5A2A0A';
    ctx.lineWidth = Math.max(1, r * 0.09);
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
  outline(ctx, r, ROUND, '#5A2A0A', 0.09);
}

function drawPixel(ctx, r, time) {
  // Chunky 8-bit football on a centred cell grid: dark rim, light top rows,
  // shaded bottom rows, white pixel laces and a blinking sparkle pixel.
  const c = r * 0.2;
  const rx = 1.3 * r;
  const ry = 0.85 * r;
  const inside = (i, j) => ((i * c) ** 2) / (rx * rx) + ((j * c) ** 2) / (ry * ry) <= 1.0;
  const nx = Math.ceil(rx / c) + 1;
  const ny = Math.ceil(ry / c) + 1;
  for (let j = -ny; j <= ny; j++) {
    for (let i = -nx; i <= nx; i++) {
      if (!inside(i, j)) continue;
      const edge = !inside(i + 1, j) || !inside(i - 1, j) || !inside(i, j + 1) || !inside(i, j - 1);
      let col = '#B3602E';
      if (edge) col = '#4A220E';
      else if (j <= -3) col = '#D98A4E';
      else if (j >= 2) col = '#8E4520';
      if (!edge && j === 0 && Math.abs(i) <= 2) col = '#FFFFFF';
      if (!edge && Math.abs(j) === 1 && (i === -2 || i === 0 || i === 2)) col = '#FFFFFF';
      if (!edge && Math.abs(i) >= 4 && Math.abs(i) <= 4 && Math.abs(j) <= 2) col = '#FFFFFF'; // tip stripes
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
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = c;
    ellipsePath(ctx, s * r * 1.2, s * r * 0.8, x * r, y * r);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < 12; i++) {
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
}

function neonAfter(ctx, r, time) {
  const pulse = 0.65 + 0.35 * Math.sin(time * 5);
  ctx.save();
  ctx.globalAlpha = 0.3 * pulse;
  ellipsePath(ctx, 1.3 * r, 0.85 * r);
  ctx.strokeStyle = '#00F0FF';
  ctx.lineWidth = r * 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ellipsePath(ctx, 1.02 * r, 0.62 * r);
  ctx.strokeStyle = '#FF2BD6';
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.stroke();
  ellipsePath(ctx, 1.3 * r, 0.85 * r);
  ctx.strokeStyle = '#00F0FF';
  ctx.lineWidth = Math.max(1.5, r * 0.16);
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
  ctx.strokeStyle = '#B7BECC';
  ctx.lineWidth = Math.max(1, r * 0.05);
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

export const BALL_SKINS = Object.freeze({
  classic: def('classic', 'Classic', 'football', '#FFFFFF', 'none', footballSkin({
    base: '#A5552B', shade: '#7E3B1C', hi: '#D08050', lace: '#FFFFFF', rim: '#5C2A12',
  })),
  retro: def('retro', 'Retro', 'football', '#FFE0B2', 'none', footballSkin({
    base: '#D98A3D', shade: '#B06A28', hi: '#F2B36F', lace: '#FFFFFF', rim: '#6E3B12', stripes: '#FFFFFF',
  })),
  pro: def('pro', 'Pro White', 'football', '#FFFFFF', 'none', footballSkin({
    base: '#F7F7F2', shade: '#D9DCE3', hi: '#FFFFFF', lace: '#8B4513', rim: '#8A93A8', stripes: '#2E3A59', pattern: proSeams,
  })),
  soccer: def('soccer', 'Soccer', 'round', '#FFFFFF', 'none', drawSoccer),
  basketball: def('basketball', 'Hoops', 'round', '#FF9E40', 'none', drawBasketball),
  rugby: def('rugby', 'Rugby', 'football', '#FF5A5F', 'none', footballSkin({
    base: '#FAFAF5', shade: '#D8DCE6', hi: '#FFFFFF', rim: '#2E3A59', pattern: rugbyPattern, shape: RUGBY, after: rugbySeam,
  })),
  candy: def('candy', 'Candy', 'football', '#FF7BC8', 'sparkle', footballSkin({
    base: '#FF6FB5', shade: '#E0438F', hi: '#FFD1EA', lace: '#FFFFFF', laceUnder: '#B0206A', rim: '#A8195E', pattern: candyPattern,
  })),
  watermelon: def('watermelon', 'Melon', 'football', '#6BE36B', 'none', footballSkin({
    base: '#3CB043', shade: '#2A8A33', hi: '#9BE89B', lace: '#F4FFE8', laceUnder: '#FF5A6E', rim: '#16572A', pattern: melonPattern,
  })),
  camo: def('camo', 'Camo', 'football', '#A4B06A', 'none', footballSkin({
    base: '#6B7B3A', shade: '#4E5A28', hi: '#A9B47A', lace: '#EDE8CF', rim: '#2F3418', pattern: camoPattern,
  })),
  neon: def('neon', 'Neon', 'football', '#00F0FF', 'sparkle', footballSkin({
    base: '#1A1033', shade: '#0E0820', hi: '#5B3AA8', lace: '#39FF88', rim: '#00F0FF', after: neonAfter,
  })),
  ice: def('ice', 'Ice', 'football', '#B8F1FF', 'frost', footballSkin({
    base: '#BDEBFF', shade: '#8ED0F0', hi: '#FFFFFF', lace: '#FFFFFF', laceUnder: '#5FB6E0', rim: '#4FA9D8', pattern: icePattern,
  })),
  fire: def('fire', 'Fire', 'football', '#FF8A00', 'fire', footballSkin({
    base: '#E8401C', shade: '#B82A10', hi: '#FFB36B', lace: '#FFF2B0', laceUnder: '#B82A10', rim: '#7A1A06', pattern: firePattern,
  })),
  pixel: def('pixel', 'Pixel', 'football', '#7CFF6B', 'pixel', drawPixel),
  galaxy: def('galaxy', 'Galaxy', 'football', '#B388FF', 'sparkle', footballSkin({
    base: '#24104F', shade: '#150838', hi: '#8E6FE0', lace: '#E9DEFF', rim: '#0B0426', pattern: galaxyPattern,
  })),
  gold: def('gold', 'Gold', 'football', '#FFD54F', 'sparkle', footballSkin({
    base: '#FFC83D', shade: '#E09B00', hi: '#FFF3B8', lace: '#8A5A00', rim: '#9C6A00', stripes: '#F0A800', after: goldAfter,
  })),
});

/**
 * Draw a ball. sx/sy scale is applied before rotation (in the caller's frame),
 * so a caller can pre-rotate to the velocity direction for squash & stretch.
 * rot is canvas radians (clockwise-positive). Unknown id -> classic.
 */
export function drawBall(ctx, id, x, y, r, rot, time, sx = 1, sy = 1) {
  const skin = BALL_SKINS[id] || BALL_SKINS.classic;
  ctx.save();
  ctx.translate(x, y);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  ctx.rotate(rot || 0);
  skin.draw(ctx, r, time || 0, rot || 0);
  ctx.restore();
}

/** Store-card preview centred in a size x size css-px box (caller applied dpr). */
export function drawBallPreview(ctx, id, size, time = 0) {
  const skin = BALL_SKINS[id] || BALL_SKINS.classic;
  const round = skin.shape === 'round';
  const r = round ? size * 0.34 : size * 0.3;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(size / 2, size * 0.88, size * 0.3, size * 0.06, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  drawBall(ctx, id, size / 2, size * 0.47, r, round ? 0.25 : -0.5, time);
}

// ---------------------------------------------------------------- stadium decor
// view = { camX, camY, k, w, h, groundY } — camX/camY world coords of the view's
// bottom-left corner, k css px per world unit, groundY screen y of world y = 0.

function cloud(ctx, x, y, s) {
  // One path (union of puffs + flat base) filled once, so translucent clouds have no seams.
  ctx.beginPath();
  const puff = (cx, cy, r) => {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
  };
  puff(x, y, s);
  puff(x + s * 0.95, y + s * 0.18, s * 0.78);
  puff(x - s * 0.9, y + s * 0.24, s * 0.66);
  puff(x + s * 0.3, y - s * 0.5, s * 0.72);
  ctx.rect(x - s * 0.9, y + s * 0.2, s * 1.85, s * 0.72);
  ctx.fill('nonzero');
}

function drawClouds(ctx, view, color, time, count = 5, alpha = 0.9) {
  const tile = Math.max(520, view.w * 1.5);
  const off = view.camX * view.k * 0.2 - time * 7;
  const vy = view.camY * view.k * 0.12;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const x = wrap(hash(i * 1.7) * tile - off, tile) - 80;
    // Cloud lanes start below the HUD band (score + shot clock), so the clock bar and hint
    // never sit on top of a white cloud.
    const s = 18 + hash(i * 9.1) * 22;
    const y = Math.max(view.h * 0.2 + s * 1.3, view.h * (0.24 + hash(i * 3.3) * 0.3) + vy);
    cloud(ctx, x, y, s);
    if (x + tile < view.w + 120) cloud(ctx, x + tile, y, s);
  }
  ctx.globalAlpha = 1;
}

function drawHills(ctx, view, color, par, amp, base, seed) {
  const off = view.camX * view.k * par;
  ctx.fillStyle = color;
  ctx.beginPath();
  const y0 = view.groundY + 2;
  ctx.moveTo(0, y0);
  for (let x = 0; x <= view.w + 8; x += 8) {
    const u = (x + off) / 120;
    const y = y0 - base - amp * (0.55 + 0.45 * Math.sin(u + seed) * Math.sin(u * 0.37 + seed * 2));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(view.w + 8, y0);
  ctx.closePath();
  ctx.fill();
}

/** Distant stadium bowl: stepped stands with light specks, parallaxing slowly. */
function drawStands(ctx, view, color, rows, specks, par, height) {
  const off = view.camX * view.k * par;
  const tile = 420;
  const y0 = view.groundY + 1;
  for (let t = -1; t <= Math.ceil(view.w / tile) + 1; t++) {
    const x0 = t * tile - wrap(off, tile);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y0 - height * 0.75);
    ctx.quadraticCurveTo(x0 + tile * 0.5, y0 - height * 1.1, x0 + tile, y0 - height * 0.75);
    ctx.lineTo(x0 + tile, y0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rows;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let r = 1; r <= 3; r++) {
      const y = y0 - height * 0.18 * r;
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + tile, y);
    }
    ctx.stroke();
    if (specks) {
      ctx.fillStyle = specks;
      for (let i = 0; i < 26; i++) {
        const sx = x0 + hash(i * 2.9 + 1) * tile;
        const sy = y0 - hash(i * 5.7 + 2) * height * 0.62 - 4;
        ctx.fillRect(sx, sy, 2.5, 2.5);
      }
    }
  }
}

function decorDay(ctx, view, pal, time) {
  // Flat, solid sun (no pale halo): left of centre, below the HUD band.
  const sx = view.w * 0.16, sy = view.h * 0.27 + view.camY * view.k * 0.08;
  ctx.fillStyle = '#FFE38A';
  circlePath(ctx, sx, sy, 31);
  ctx.fill();
  ctx.fillStyle = '#FFD54A';
  circlePath(ctx, sx, sy, 25);
  ctx.fill();
  drawClouds(ctx, view, '#FFFFFF', time, 6, 0.92);
  drawHills(ctx, view, mixColor(pal.ground, pal.skyBottom, 0.55), 0.18, 34, 28, 1.3);
  drawStands(ctx, view, mixColor(pal.skyBottom, pal.groundDark, 0.5), mixColor(pal.skyBottom, '#FFFFFF', 0.25), withAlpha(pal.accent, 0.55), 0.35, 60);
}

function lightTower(ctx, x, yBase, hgt, glow, t) {
  ctx.fillStyle = '#1A2238';
  ctx.fillRect(x - 3, yBase - hgt, 6, hgt);
  ctx.fillRect(x - 22, yBase - hgt - 22, 44, 24);
  ctx.save();
  ctx.globalAlpha = 0.1 + 0.02 * Math.sin(t * 2 + x);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.moveTo(x - 20, yBase - hgt - 4);
  ctx.lineTo(x + 20, yBase - hgt - 4);
  ctx.lineTo(x + 140, yBase);
  ctx.lineTo(x - 140, yBase);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = glow;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      circlePath(ctx, x - 15 + i * 10, yBase - hgt - 16 + j * 10, 3.6);
      ctx.fill();
    }
  }
}

function drawStars(ctx, view, count, time, color = '#FFFFFF') {
  const off = view.camX * view.k * 0.05;
  const vy = view.camY * view.k * 0.05;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = wrap(hash(i * 1.37) * view.w * 1.3 - off, view.w * 1.3);
    const y = hash(i * 2.71) * view.h * 0.62 + vy;
    ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 2.2 + i * 1.9));
    const s = 1 + hash(i * 4.2) * 1.8;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
}

function decorNight(ctx, view, pal, time) {
  drawStars(ctx, view, 60, time);
  // Moon sits right of the logo / score and below the coin pill.
  const mx = view.w * 0.86;
  const my = view.h * 0.2 + view.camY * view.k * 0.05;
  ctx.fillStyle = '#FFF6D5';
  circlePath(ctx, mx, my, 24);
  ctx.fill();
  ctx.fillStyle = pal.skyTop;
  circlePath(ctx, mx + 10, my - 6, 21);
  ctx.fill();
  const par = 0.3;
  const tile = 380;
  const off = view.camX * view.k * par;
  const hgt = Math.min(view.h * 0.42, 330);
  for (let t = -1; t <= Math.ceil(view.w / tile) + 1; t++) {
    lightTower(ctx, t * tile - wrap(off, tile) + 90, view.groundY - 30, hgt, '#FFF4C2', time);
  }
  drawStands(ctx, view, mixColor(pal.skyTop, '#000000', 0.35), mixColor(pal.skyTop, '#FFFFFF', 0.12), withAlpha(pal.accent, 0.8), 0.35, 70);
}

function pine(ctx, x, y, s, green, snow) {
  for (let i = 0; i < 3; i++) {
    const w = s * (1 - i * 0.22);
    const top = y - s * (0.7 + i * 0.55);
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.6, y - s * i * 0.55);
    ctx.lineTo(x + w * 0.6, y - s * i * 0.55);
    ctx.lineTo(x, top - s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = snow;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.22, top + s * 0.12);
    ctx.lineTo(x + w * 0.22, top + s * 0.12);
    ctx.lineTo(x, top - s * 0.3);
    ctx.closePath();
    ctx.fill();
  }
}

function decorSnow(ctx, view, pal, time) {
  drawClouds(ctx, view, '#FFFFFF', time, 4, 0.7);
  drawHills(ctx, view, mixColor(pal.ground, pal.skyBottom, 0.35), 0.15, 40, 30, 2.1);
  const par = 0.35;
  const tile = 300;
  const off = view.camX * view.k * par;
  for (let t = -1; t <= Math.ceil(view.w / tile) + 1; t++) {
    const x0 = t * tile - wrap(off, tile);
    for (let i = 0; i < 4; i++) {
      pine(ctx, x0 + 30 + i * 70 + hash(i) * 20, view.groundY + 2, 22 + hash(i * 3 + 1) * 16, '#2F6B4F', '#FFFFFF');
    }
  }
  // falling snow (screen space, drifting with the camera a little)
  ctx.fillStyle = '#FFFFFF';
  const offS = view.camX * view.k * 0.3;
  for (let i = 0; i < 60; i++) {
    const sp = 25 + hash(i * 7.3) * 45;
    const x = wrap(hash(i * 1.9) * view.w + Math.sin(time * 0.9 + i) * 14 - offS, view.w);
    const y = wrap(hash(i * 3.7) * view.h + time * sp, view.h);
    ctx.globalAlpha = 0.55 + hash(i) * 0.45;
    circlePath(ctx, x, y, 1.2 + hash(i * 5.1) * 2.2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function palm(ctx, x, y, s, color) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.14;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + s * 0.35, y - s * 0.9, x + s * 0.15, y - s * 1.7);
  ctx.stroke();
  ctx.fillStyle = color;
  const tx = x + s * 0.15;
  const ty = y - s * 1.7;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i - 2.5) * 0.62;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + Math.cos(a) * s * 0.7, ty + Math.sin(a) * s * 0.7 - s * 0.15, tx + Math.cos(a) * s * 1.05, ty + Math.sin(a) * s * 1.05 + s * 0.35);
    ctx.quadraticCurveTo(tx + Math.cos(a) * s * 0.5, ty + Math.sin(a) * s * 0.5 + s * 0.05, tx, ty);
    ctx.fill();
  }
}

function decorSunset(ctx, view, pal, time) {
  const sunX = view.w * 0.62 - view.camX * view.k * 0.03;
  const sunY = view.groundY - view.h * 0.2;
  const sr = Math.min(view.w * 0.2, 90);
  ctx.fillStyle = mixColor(pal.accent, '#FFE27A', 0.55);
  circlePath(ctx, sunX, sunY, sr);
  ctx.fill();
  ctx.fillStyle = pal.skyBottom;
  for (let i = 0; i < 4; i++) {
    const y = sunY + sr * (0.2 + i * 0.2);
    ctx.fillRect(sunX - sr, y, sr * 2, 3 + i * 1.6);
  }
  // birds
  ctx.strokeStyle = withAlpha('#3A1C3A', 0.55);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const x = wrap(hash(i * 3.3) * view.w + time * 12 - view.camX * view.k * 0.15, view.w + 60) - 30;
    const y = view.h * (0.14 + hash(i * 1.1) * 0.18) + Math.sin(time * 2 + i) * 4;
    const f = 4 + 2 * Math.sin(time * 7 + i);
    ctx.beginPath();
    ctx.moveTo(x - 7, y - f);
    ctx.quadraticCurveTo(x - 3, y - 1, x, y);
    ctx.quadraticCurveTo(x + 3, y - 1, x + 7, y - f);
    ctx.stroke();
  }
  // sea band sitting on the horizon
  const seaH = 26;
  ctx.fillStyle = mixColor(pal.skyTop, '#2E4A8A', 0.6);
  ctx.fillRect(0, view.groundY - seaH, view.w, seaH + 2);
  ctx.fillStyle = withAlpha('#FFFFFF', 0.35);
  for (let i = 0; i < 7; i++) {
    const x = wrap(hash(i * 5.5) * view.w - view.camX * view.k * 0.25, view.w);
    ctx.fillRect(x, view.groundY - seaH + 6 + (i % 3) * 6, 26 + hash(i) * 30, 2);
  }
  const tile = 340;
  const off = view.camX * view.k * 0.45;
  const col = mixColor(pal.skyTop, '#1A0A1F', 0.62);
  for (let t = -1; t <= Math.ceil(view.w / tile) + 1; t++) {
    const x0 = t * tile - wrap(off, tile);
    palm(ctx, x0 + 60, view.groundY + 2, 58, col);
    palm(ctx, x0 + 250, view.groundY + 2, 44, col);
  }
}

function decorArcade(ctx, view, pal, time) {
  drawStars(ctx, view, 45, time, '#FFFFFF');
  const sx = view.w * 0.5 - view.camX * view.k * 0.03;
  const sy = view.groundY - view.h * 0.2;
  const sr = Math.min(view.w * 0.22, 100);
  const g = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
  g.addColorStop(0, '#FFE600');
  g.addColorStop(1, '#FF2BD6');
  ctx.fillStyle = g;
  circlePath(ctx, sx, sy, sr);
  ctx.fill();
  ctx.fillStyle = pal.skyBottom;
  for (let i = 0; i < 6; i++) {
    const y = sy + sr * (0.05 + i * 0.16);
    ctx.fillRect(sx - sr, y, sr * 2, 2 + i * 1.4);
  }
  // wireframe mountains
  const tile = 260;
  const off = view.camX * view.k * 0.3;
  ctx.strokeStyle = '#00F0FF';
  ctx.lineWidth = 2;
  ctx.fillStyle = mixColor(pal.skyBottom, '#000000', 0.35);
  for (let t = -1; t <= Math.ceil(view.w / tile) + 1; t++) {
    const x0 = t * tile - wrap(off, tile);
    const peaks = [[0, 0], [60, 70], [110, 30], [170, 95], [220, 40], [260, 0]];
    ctx.beginPath();
    ctx.moveTo(x0, view.groundY);
    for (const [px, ph] of peaks) ctx.lineTo(x0 + px, view.groundY - ph);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    for (let i = 1; i < peaks.length - 1; i++) {
      ctx.moveTo(x0 + peaks[i][0], view.groundY - peaks[i][1]);
      ctx.lineTo(x0 + peaks[i][0] + 12, view.groundY);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = withAlpha('#FF2BD6', 0.75);
  ctx.fillRect(0, view.groundY - 2, view.w, 3);
}

// zone = painted end-zone (team) colour; optional so older palettes keep working.
function P(skyTop, skyBottom, ground, groundDark, line, post, accent, uiBg, zone = accent) {
  return Object.freeze({ skyTop, skyBottom, ground, groundDark, line, post, accent, uiBg, zone });
}

export const STADIUM_THEMES = Object.freeze({
  day: {
    id: 'day', name: 'Day Game', decor: 'clouds',
    palettes: [
      P('#4FC3F7', '#B3E5FC', '#5CC858', '#4DB84A', '#FFFFFF', '#FFD21F', '#FF8A3D', '#4FC3F7', '#2459B8'),
      P('#26C6DA', '#B2F0F7', '#57C46A', '#48B35C', '#FFFFFF', '#FFD21F', '#FF6B6B', '#1FB5C9', '#D23C3C'),
      P('#9C7BEA', '#D9CCFF', '#5CC870', '#4DB862', '#FFFFFF', '#FFD21F', '#FF8A3D', '#8E6FE0', '#4A33B8'),
      P('#FF8FA3', '#FFD6DE', '#63C95C', '#54B94E', '#FFFFFF', '#FFD21F', '#7C4DFF', '#F77A91', '#2E6FD8'),
      P('#FFB74D', '#FFE3B8', '#6AC955', '#5AB948', '#FFFFFF', '#FFFFFF', '#E0457B', '#F5A23A', '#C72E6A'),
    ],
    drawDecor: decorDay,
    field: { surface: 'grass', wall: 'pads', words: ['FLICK', 'GOAL'] },
  },
  night: {
    id: 'night', name: 'Night Lights', decor: 'night',
    palettes: [
      P('#0E1B4D', '#2D4C8F', '#2E9E5B', '#278A4F', '#FFFFFF', '#FFD21F', '#FF4FA0', '#1F2F66', '#C2185B'),
      P('#2A0F4F', '#5A2D8C', '#2E9E68', '#27885A', '#FFFFFF', '#FFD21F', '#39D98A', '#3B1C6B', '#6A1B9A'),
      P('#062F3F', '#1A6B7A', '#2FA05E', '#288A51', '#FFFFFF', '#FFE45C', '#FF8A3D', '#0D4658', '#E0661B'),
      P('#3A0B26', '#7A2446', '#2E9A5A', '#27854E', '#FFFFFF', '#FFD21F', '#4FC3F7', '#5A1638', '#1565C0'),
    ],
    drawDecor: decorNight,
    field: { surface: 'grass', wall: 'board', lights: true, words: ['FLICK', 'GOAL'] },
  },
  snow: {
    id: 'snow', name: 'Snow Bowl', decor: 'snow',
    palettes: [
      P('#7CC6F0', '#DDF1FF', '#F2F8FF', '#DCEAF7', '#8EB9DA', '#FFD21F', '#FF5A5F', '#5DB6E6', '#D84343'),
      P('#A99BE8', '#E6E0FF', '#F4F4FF', '#E0E0F5', '#9A93CF', '#FFD21F', '#FF6FB5', '#8F80DD', '#7E3FB0'),
      P('#F59BB0', '#FFE3EA', '#FAF6F8', '#EDE0E6', '#C99AAB', '#FFD21F', '#5A7DFF', '#E97F98', '#3F5FD6'),
      P('#7D93AD', '#D5E0EC', '#EEF3F8', '#D6E0EA', '#92A7BD', '#FFD21F', '#FF8A3D', '#6A819C', '#E0762E'),
    ],
    drawDecor: decorSnow,
    field: { surface: 'snow', wall: 'snow', words: ['FLICK', 'GOAL'] },
  },
  sunset: {
    id: 'sunset', name: 'Beach Sunset', decor: 'sunset',
    palettes: [
      P('#FF6F61', '#FFC37A', '#F2D48C', '#E6C274', '#FFFFFF', '#FFFFFF', '#FF3D6E', '#FF7A59', '#1E88A8'),
      P('#D94F8C', '#FF9E7A', '#EFD08F', '#E2BD76', '#FFFFFF', '#FFE45C', '#7C4DFF', '#D9578F', '#6A3FC4'),
      P('#6A3FA0', '#F0788A', '#E8CB8E', '#D9B874', '#FFFFFF', '#FFD21F', '#FF8A3D', '#7A4AAE', '#E0457B'),
      P('#FF9A3C', '#FFE08A', '#F4D98F', '#E8C677', '#FFFFFF', '#FFFFFF', '#E0457B', '#F58B2E', '#2E7D9A'),
    ],
    drawDecor: decorSunset,
    field: { surface: 'sand', wall: 'none', words: ['BEACH', 'GOAL'] },
  },
  arcade: {
    id: 'arcade', name: 'Neon Arcade', decor: 'arcade',
    palettes: [
      P('#12072E', '#3A0CA3', '#1B0F3F', '#25145A', '#00F0FF', '#FFE600', '#FF2BD6', '#2A0E6B', '#FF2BD6'),
      P('#07122E', '#0C4DA3', '#0F1B3F', '#14275A', '#FF2BD6', '#39FF88', '#00F0FF', '#0E2A6B', '#00F0FF'),
      P('#2E0721', '#A30C6E', '#3F0F2E', '#5A1442', '#39FF88', '#00F0FF', '#FFE600', '#6B0E4A', '#FFE600'),
      P('#0A2E07', '#0CA36B', '#0F3F24', '#145A33', '#FFE600', '#FF2BD6', '#00F0FF', '#0E6B45', '#FF2BD6'),
    ],
    drawDecor: decorArcade,
    field: { surface: 'neon', wall: 'neon', words: ['FLICK', 'GOAL'] },
  },
});

/** Palette for a stadium at a score tier (unknown id -> 'day'). */
export function themePalette(id, tier = 0) {
  const th = STADIUM_THEMES[id] || STADIUM_THEMES.day;
  const n = th.palettes.length;
  const i = ((Math.floor(Number(tier) || 0) % n) + n) % n;
  return th.palettes[i];
}

// ---------------------------------------------------------------- football field (broadcast side view)
// The camera stands on the near sideline looking across the field. World x runs
// along the field toward the end line; depth z runs across it: z = 0 is the play
// line the ball, tee and post stand on (the middle of the field, between the
// hashes), +z recedes toward the far sideline, -z comes toward the camera.
// A ground point (x, z) projects with a pinhole model around a vanishing point at
// the view centre: s(z) = D / (D + z); screenX = vpx + (X - vpx) * s; screenY =
// gy + Hh * (s - 1), so yard lines converge like a real broadcast shot while the
// play line itself (z = 0) keeps the exact world scale k used for ball and post.

const FIELD_FONT = '"Arial Rounded MT Bold","SF Pro Rounded",ui-rounded,"Nunito","Segoe UI",system-ui,sans-serif';
const FIELD_LEN_YD = 100;
const WALL_GAP = 48;   // depth of the far bench area between the far sideline and the wall
const WALL_H = 16;     // wall height (world units)
const BORDER = 12;     // white sideline border width (depth units)

/**
 * Projection helpers for a field view. fv = { w, h, k, camX, gy, vpx?, tilt?, camDist? }
 * (k = css px per world unit on the play line, camX = world x of the view's left
 * edge, gy = screen y of the play line). Returns { pt(x, z) -> [sx, sy], s(z), D, Hh,
 * xMin, xMax, farY } where farY is the screen y of the top of the far stadium wall
 * (theme decor stands on it).
 */
export function fieldProjection(fv, cfg = CONFIG) {
  const F = cfg.field;
  const D = fv.camDist || F.camDist;
  const tilt = fv.tilt ?? F.tilt;
  const k = fv.k;
  const Hh = tilt * D * k;
  const vpx = fv.vpx ?? fv.w / 2;
  const W = F.halfWidth;
  const s = (z) => D / (D + z);
  const pt = (x, z) => {
    const sc = D / (D + z);
    return [vpx + ((x - fv.camX) * k - vpx) * sc, fv.gy + Hh * (sc - 1)];
  };
  const wallZ = W + BORDER + WALL_GAP;
  const sW = s(wallZ);
  const wallBase = fv.gy + Hh * (sW - 1);
  const farY = wallBase - WALL_H * k * sW;
  // World-x range that covers the screen on the narrowest (far) row.
  const xMin = fv.camX + (vpx - vpx / sW) / k - 30;
  const xMax = fv.camX + (vpx + (fv.w - vpx) / sW) / k + 30;
  return { pt, s, D, Hh, k, vpx, W, wallZ, wallBase, farY, xMin, xMax };
}

function quadPath(ctx, pr, x0, x1, z0, z1) {
  const a = pr.pt(x0, z0);
  const b = pr.pt(x1, z0);
  const c = pr.pt(x1, z1);
  const d = pr.pt(x0, z1);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.lineTo(d[0], d[1]);
  ctx.closePath();
}

/**
 * Local affine frame for text/shapes painted flat on the turf at (x, z).
 * readable 'near' = upright for the camera; 'far' = facing the far sideline (upside down).
 */
function groundFrame(ctx, pr, x, z, facing = 'near') {
  const [px, py] = pr.pt(x, z);
  const sc = pr.s(z);
  const dz = (sc * sc) / pr.D; // -ds/dz
  const ax = pr.k * sc;
  const cx = (px - pr.vpx) * dz / sc; // == (X - vpx) * s^2 / D
  const cy = pr.Hh * dz;
  if (facing === 'far') ctx.transform(-ax, 0, -cx, -cy, px, py);
  else ctx.transform(ax, 0, cx, cy, px, py);
}

function surfaceStyle(surface, pal) {
  switch (surface) {
    case 'snow':
      return {
        line: mixColor(pal.line, '#23476B', 0.3), lineA: 0.9,
        side: mixColor(pal.groundDark, '#8FA9C4', 0.4),
        zone: mixColor(pal.zone || pal.accent, '#FFFFFF', 0.28), pylon: '#FF7A1A',
      };
    case 'sand':
      return {
        line: '#FFFFFF', lineA: 0.92,
        side: mixColor(pal.groundDark, '#A77C45', 0.3),
        zone: pal.zone || pal.accent, pylon: '#FF7A1A',
      };
    case 'neon':
      return {
        line: pal.line, lineA: 0.95,
        side: mixColor(pal.ground, '#000000', 0.45),
        zone: mixColor(pal.zone || pal.accent, pal.ground, 0.72), zoneGlow: pal.zone || pal.accent, pylon: pal.zone || pal.accent,
      };
    default:
      return {
        line: '#FFFFFF', lineA: 0.92,
        side: mixColor(pal.groundDark, '#0E3A1C', 0.3),
        zone: pal.zone || pal.accent, pylon: '#FF7A1A',
      };
  }
}

/** Far stadium wall (pads / LED board / snow-capped / neon strip) behind the far bench area. */
function drawFarWall(ctx, pr, fv, kind, pal, st, time) {
  if (kind === 'none') return;
  const top = pr.farY;
  const base = pr.wallBase;
  const hgt = base - top;
  if (hgt <= 0.5) return;
  const zone = pal.zone || pal.accent;
  const sW = pr.s(pr.wallZ);
  const panelEvery = 110;
  const panelW = 70;
  const x0 = Math.floor(pr.xMin / panelEvery) * panelEvery;
  const sxOf = (x) => pr.vpx + ((x - fv.camX) * pr.k - pr.vpx) * sW;
  if (kind === 'neon') {
    ctx.fillStyle = mixColor(pal.ground, '#000000', 0.55);
    ctx.fillRect(0, top, fv.w, hgt + 1);
    ctx.fillStyle = withAlpha(zone, 0.9);
    ctx.fillRect(0, top, fv.w, Math.max(1, hgt * 0.14));
    ctx.fillStyle = withAlpha(pal.line, 0.55);
    for (let x = x0; x < pr.xMax; x += panelEvery) {
      const a = sxOf(x);
      const b = sxOf(x + panelW);
      ctx.fillRect(a, top + hgt * 0.45, b - a, Math.max(1, hgt * 0.16));
    }
    return;
  }
  if (kind === 'board') {
    ctx.fillStyle = '#141A2E';
    ctx.fillRect(0, top, fv.w, hgt + 1);
    // LED ribbon board with a slow scrolling glint
    const ry = top + hgt * 0.22;
    const rh = Math.max(1.5, hgt * 0.46);
    ctx.fillStyle = mixColor(pal.accent, '#141A2E', 0.35);
    ctx.fillRect(0, ry, fv.w, rh);
    ctx.fillStyle = withAlpha('#FFFFFF', 0.55);
    for (let x = x0; x < pr.xMax; x += panelEvery) {
      const a = sxOf(x + ((time * 30) % panelEvery));
      ctx.fillRect(a, ry + rh * 0.35, Math.max(2, 34 * pr.k * sW), Math.max(1, rh * 0.3));
    }
    ctx.fillStyle = withAlpha('#FFFFFF', 0.15);
    ctx.fillRect(0, top, fv.w, Math.max(1, hgt * 0.1));
    return;
  }
  // padded wall in the team colour with sponsor-style panels
  ctx.fillStyle = mixColor(zone, '#000000', 0.22);
  ctx.fillRect(0, top, fv.w, hgt + 1);
  ctx.fillStyle = withAlpha('#FFFFFF', 0.2);
  for (let x = x0; x < pr.xMax; x += panelEvery) {
    const a = sxOf(x);
    const b = sxOf(x + panelW);
    ctx.fillRect(a, top + hgt * 0.28, b - a, Math.max(1, hgt * 0.44));
  }
  ctx.fillStyle = mixColor(zone, '#FFFFFF', 0.25);
  ctx.fillRect(0, top, fv.w, Math.max(1, hgt * 0.16));
  if (kind === 'snow') {
    // snow cap with a few drips
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, top - Math.max(1, hgt * 0.22), fv.w, Math.max(1.5, hgt * 0.38));
    for (let x = x0; x < pr.xMax; x += 37) {
      const a = sxOf(x + hash(x * 0.37) * 20);
      const r = Math.max(0.8, (2 + hash(x) * 3) * pr.k * sW);
      circlePath(ctx, a, top + hgt * 0.14, r);
      ctx.fill();
    }
  }
}

/** Painted end zone at x in [xa, xb] (xb = end line), team colour, diagonal stripes + words. */
function drawEndZone(ctx, pr, xa, xb, st, words, detail = 1) {
  const W = pr.W;
  quadPath(ctx, pr, xa, xb, -W, W);
  ctx.fillStyle = st.zone;
  ctx.fill();
  ctx.save();
  quadPath(ctx, pr, xa, xb, -W, W);
  ctx.clip();
  // diagonal stripes painted on the turf (world-space diagonals -> perspective)
  ctx.fillStyle = withAlpha('#000000', 0.1);
  const step = 26;
  for (let z = -W - (xb - xa); z < W + (xb - xa); z += step * 2) {
    const a = pr.pt(xa, z);
    const b = pr.pt(xa, z + step);
    const c = pr.pt(xb, z + step + (xb - xa));
    const d = pr.pt(xb, z + (xb - xa));
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fill();
  }
  // words, readable from the camera: near half and far half
  const inset = 7;
  const span = Math.max(10, xb - xa - inset * 2);
  const cx = (xa + xb) / 2;
  const list = [[words[0], -W * 0.5, 62], [words[1] || words[0], W * 0.52, 58]];
  for (const [word, zc, F] of list) {
    if (!word || detail <= 0.3) continue;
    ctx.save();
    groundFrame(ctx, pr, cx, zc, 'near');
    ctx.font = `900 ${F}px ${FIELD_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const m = typeof ctx.measureText === 'function' ? ctx.measureText(word) : null;
    const tw = (m && m.width) || F * 0.62 * word.length;
    const q = Math.min(1, span / Math.max(1, tw));
    ctx.scale(q, 1);
    if (st.zoneGlow) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = withAlpha(st.zoneGlow, 0.9);
      ctx.strokeText(word, 0, F * 0.04);
      ctx.fillStyle = withAlpha('#FFFFFF', 0.85);
    } else {
      ctx.fillStyle = withAlpha('#000000', 0.16);
      ctx.fillText(word, 0, F * 0.1);
      ctx.fillStyle = withAlpha('#FFFFFF', 0.92);
    }
    ctx.fillText(word, 0, F * 0.04);
    ctx.restore();
  }
  ctx.restore();
  if (st.zoneGlow) {
    ctx.lineWidth = Math.max(1, 1.6 * pr.k);
    ctx.strokeStyle = withAlpha(st.zoneGlow, 0.8);
    quadPath(ctx, pr, xa + 3, xb - 3, -W + 3, W - 3);
    ctx.stroke();
  }
}

function pylon(ctx, pr, x, z, color) {
  const [px, py] = pr.pt(x, z);
  const sc = pr.s(z) * pr.k;
  const w = Math.max(1.5, 5 * sc);
  const h = Math.max(3, 15 * sc);
  ctx.fillStyle = withAlpha('#000000', 0.18);
  ctx.fillRect(px - w / 2 + w * 0.4, py - h * 0.1, w, h * 0.2);
  ctx.fillStyle = color;
  ctx.fillRect(px - w / 2, py - h, w, h);
  ctx.fillStyle = withAlpha('#FFFFFF', 0.35);
  ctx.fillRect(px - w / 2, py - h, w * 0.35, h);
}

/**
 * Draw the whole field for stadium `themeId` (turf, out-of-bounds, far wall, end
 * zone(s), yard lines, hashes, numbers, pylons, optional kick-spot line).
 * fv = { w, h, k, camX, gy, endX, vpx?, tilt?, camDist?, spot?: {x, alpha}, detail?: 0..1 }.
 * Returns the projection (its farY is where theme decor should stand).
 */
export function drawField(ctx, themeId, pal, fv, time = 0, cfg = CONFIG) {
  const th = STADIUM_THEMES[themeId] || STADIUM_THEMES.day;
  const fd = th.field || { surface: 'grass', wall: 'pads', words: ['FLICK', 'GOAL'] };
  const pr = fieldProjection(fv, cfg);
  const U = cfg.field.yard;
  const W = pr.W;
  const E = fv.endX;
  const G = E - cfg.field.endZoneYards * U; // goal line
  const Efar = E - (FIELD_LEN_YD + 2 * cfg.field.endZoneYards) * U;
  const Gfar = Efar + cfg.field.endZoneYards * U;
  const st = surfaceStyle(fd.surface, pal);
  const detail = fv.detail ?? 1;
  const xa = Math.max(pr.xMin, Efar);
  const xb = Math.min(pr.xMax, E);
  const k = pr.k;

  // 1. out-of-bounds base (everything from the far wall down), then the wall
  if (pr.farY > fv.h + 2) {
    // whole field below the view (camera following a high ball): only the raised
    // end-zone stands can still reach up into it
    if (E + cfg.field.standsOffset < pr.xMax) drawBehindEndLine(ctx, pr, fv, fd, pal, st, E, cfg, time, detail);
    return pr;
  }
  ctx.fillStyle = st.side;
  ctx.fillRect(-2, pr.wallBase - 1, fv.w + 4, fv.h - pr.wallBase + 3);
  drawFarWall(ctx, pr, fv, fd.wall, pal, st, time);
  if (xb <= xa) {
    // view entirely past the end line (ball flew into the stands)
    if (pr.xMin >= E) drawBehindEndLine(ctx, pr, fv, fd, pal, st, E, cfg, time, detail);
    return pr;
  }

  // 2. turf with 5-yard mowing stripes between the goal lines
  quadPath(ctx, pr, xa, xb, -W, W);
  ctx.fillStyle = pal.ground;
  ctx.fill();
  ctx.fillStyle = pal.groundDark;
  const j0 = Math.max(0, Math.floor((G - xb) / (5 * U)));
  const j1 = Math.min(19, Math.ceil((G - xa) / (5 * U)));
  for (let j = j0; j <= j1; j++) {
    if (j % 2 === 0) continue;
    const x1 = G - 5 * U * j;
    const x0 = x1 - 5 * U;
    if (x1 < xa || x0 > xb) continue;
    quadPath(ctx, pr, Math.max(x0, xa), Math.min(x1, xb), -W, W);
    ctx.fill();
  }

  // 3. surface character
  if (detail > 0.3) drawSurfaceFx(ctx, pr, fd, pal, st, xa, xb, U);

  // 4. end zones
  if (E - 10 * U < pr.xMax && E > pr.xMin) drawEndZone(ctx, pr, G, E, st, fd.words || ['FLICK'], detail);
  if (Gfar > pr.xMin && Efar < pr.xMax) drawEndZone(ctx, pr, Efar, Gfar, st, fd.words || ['FLICK'], detail);

  // 5. lines: sideline borders, end lines, goal lines, 5-yard lines
  const glow = fd.surface === 'neon';
  const lineFill = withAlpha(st.line, st.lineA);
  const lines = [];
  for (let j = 0; j <= 20; j++) {
    const x = G - 5 * U * j;
    if (x < xa - 4 || x > xb + 4) continue;
    lines.push([x, j === 0 || j === 20 ? 1.9 : 1.05]);
  }
  if (glow) {
    ctx.fillStyle = withAlpha(st.line, 0.18);
    for (const [x, hw] of lines) { quadPath(ctx, pr, x - hw * 3, x + hw * 3, -W, W); ctx.fill(); }
    // faint 1-yard grid + lengthwise grid lines for the neon look
    ctx.strokeStyle = withAlpha(st.line, 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(xa / U) * U; x <= xb; x += U) {
      const a = pr.pt(x, -W);
      const b = pr.pt(x, W);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    for (let z = -W + 40; z < W; z += 40) {
      const a = pr.pt(xa, z);
      const b = pr.pt(xb, z);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  }
  ctx.fillStyle = lineFill;
  for (const [x, hw] of lines) { quadPath(ctx, pr, x - hw, x + hw, -W, W); ctx.fill(); }
  // sideline borders + end lines (6 ft white border around the field)
  const bx0 = Math.max(pr.xMin, Efar - BORDER * 0.6);
  const bx1 = Math.min(pr.xMax, E + BORDER * 0.6);
  if (bx1 > bx0) {
    quadPath(ctx, pr, bx0, bx1, W, W + BORDER);
    ctx.fill();
    quadPath(ctx, pr, bx0, bx1, -W - BORDER, -W);
    ctx.fill();
  }
  for (const ex of [E, Efar]) {
    if (ex < pr.xMin - 10 || ex > pr.xMax + 10) continue;
    const sgn = ex === E ? 1 : -1;
    quadPath(ctx, pr, ex - sgn * 1.2, ex + sgn * BORDER * 0.6, -W - BORDER, W + BORDER);
    ctx.fill();
  }

  // near-side team area: tinted band behind a dashed restraining line
  if (detail > 0.3) {
    const zA = -W - BORDER - 10;
    const zB = -W - BORDER - 70;
    const tx0 = Math.max(pr.xMin, Efar);
    const tx1 = Math.min(pr.xMax, E + BORDER * 0.6);
    if (tx1 > tx0) {
      quadPath(ctx, pr, tx0, tx1, zB, zA);
      ctx.fillStyle = withAlpha(pal.zone || pal.accent, glow ? 0.16 : 0.2);
      ctx.fill();
      ctx.fillStyle = withAlpha(glow ? (pal.zone || pal.accent) : '#FFD54F', 0.9);
      for (let x = Math.floor(tx0 / 12) * 12; x < tx1; x += 12) {
        quadPath(ctx, pr, x, x + 7, zA - 3, zA);
        ctx.fill();
      }
      ctx.fillStyle = lineFill;
      quadPath(ctx, pr, tx0, tx1, zB - 3, zB);
      ctx.fill();
    }
  }

  // 6. hash marks every yard (inbound hashes near the play line + sideline ticks)
  if (detail > 0.3) {
    const hz = cfg.field.hashDepth;
    ctx.fillStyle = withAlpha(st.line, st.lineA * 0.9);
    const y0 = Math.max(1, Math.ceil((G - xb) / U));
    const y1 = Math.min(FIELD_LEN_YD - 1, Math.floor((G - xa) / U));
    for (let yd = y0; yd <= y1; yd++) {
      if (yd % 5 === 0) continue;
      const x = G - yd * U;
      quadPath(ctx, pr, x - 0.7, x + 0.7, hz, hz + 7);
      ctx.fill();
      quadPath(ctx, pr, x - 0.7, x + 0.7, -hz - 7, -hz);
      ctx.fill();
      quadPath(ctx, pr, x - 0.7, x + 0.7, W - 9, W - 2);
      ctx.fill();
      quadPath(ctx, pr, x - 0.7, x + 0.7, -W + 2, -W + 9);
      ctx.fill();
    }
  }

  // 7. yard numbers every 10 yards (near side upright, far side facing the far sideline)
  if (detail > 0.3) {
    const nz = W - 12 * U;
    for (let n = 10; n <= 90; n += 10) {
      const x = G - n * U;
      if (x < xa - 20 || x > xb + 20) continue;
      const lab = n <= 50 ? n : FIELD_LEN_YD - n;
      const toward = n < 50 ? 1 : n > 50 ? -1 : 0; // arrow toward the nearer goal (+x = our end zone)
      for (const facing of ['near', 'far']) {
        ctx.save();
        groundFrame(ctx, pr, x, facing === 'near' ? -nz : nz, facing);
        paintYardNumber(ctx, lab, facing === 'near' ? toward : -toward, lineFill, glow ? st.line : null);
        ctx.restore();
      }
    }
  }

  // 7b. behind the end line: apron, photographers, end-zone stands with a crowd
  drawBehindEndLine(ctx, pr, fv, fd, pal, st, E, cfg, time, detail);

  // 8. kick-spot line (broadcast-style graphic across the field)
  if (fv.spot && fv.spot.alpha > 0.01 && fv.spot.x > xa && fv.spot.x < xb) {
    const sx = fv.spot.x;
    const col = fv.spot.color || '#3D8BFF';
    ctx.fillStyle = withAlpha(col, 0.28 * fv.spot.alpha);
    quadPath(ctx, pr, sx - 4, sx + 4, -W, W);
    ctx.fill();
    ctx.fillStyle = withAlpha(col, 0.85 * fv.spot.alpha);
    quadPath(ctx, pr, sx - 1.4, sx + 1.4, -W, W);
    ctx.fill();
  }

  // 9. pylons at the corners of the end zones
  for (const x of [G, E, Gfar, Efar]) {
    if (x < pr.xMin || x > pr.xMax) continue;
    pylon(ctx, pr, x, W + 1, st.pylon);
  }
  // near pylons are drawn last (closest to the camera)
  for (const x of [G, E, Gfar, Efar]) {
    if (x < pr.xMin || x > pr.xMax) continue;
    pylon(ctx, pr, x, -W - 1, st.pylon);
  }
  return pr;
}

/** Crowd colours per surface (shirts); heads use a few skin tones. */
const CROWD = {
  grass: ['#E53935', '#FFFFFF', '#1E88E5', '#FDD835', '#43A047', '#FB8C00', '#8E24AA', '#263238'],
  snow: ['#D32F2F', '#1565C0', '#FFFFFF', '#F9A825', '#2E7D32', '#6D4C41', '#37474F', '#EC407A'],
  sand: ['#FF7043', '#26C6DA', '#FFEE58', '#FFFFFF', '#EC407A', '#66BB6A', '#AB47BC', '#29B6F6'],
  neon: ['#00F0FF', '#FF2BD6', '#39FF88', '#FFE600', '#7C4DFF', '#FFFFFF'],
};
const SKIN = ['#F1C27D', '#C68642', '#8D5524', '#FFDBAC', '#E0AC69'];

/**
 * Everything past the end line, so the camera never shows a bare void after a goal:
 * an apron (side-coloured, textured), a few photographers, then the end-zone stands
 * (padded front wall at post.x + standsOffset, seat rows rising away from the field,
 * packed with a crowd). Geometry matches game.js backstop() (wall + seat slope).
 */
function drawBehindEndLine(ctx, pr, fv, fd, pal, st, E, cfg, time, detail) {
  const F = cfg.field;
  const ax0 = E + BORDER * 0.6;
  if (ax0 > pr.xMax) return;
  const k = pr.k;
  const W = pr.W;
  const D = pr.D;
  const neon = fd.surface === 'neon';
  const zone = pal.zone || pal.accent;
  // depth at the bottom of the view (screen y = h), so near geometry reaches the edge
  const sBot = 1 + (fv.h + 30 - fv.gy) / Math.max(1e-3, pr.Hh);
  const zN = Math.max(-D * 0.72, Math.min(-W, sBot > 0.05 ? D / sBot - D : -W));
  const zF = pr.wallZ;
  const SX = E + F.standsOffset;
  const ax1 = Math.min(pr.xMax, SX);

  // apron texture: 2-yard bands (or the neon grid) out to the stands
  if (ax1 > ax0) {
    if (neon) {
      ctx.strokeStyle = withAlpha(pal.line, 0.1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(ax0 / F.yard) * F.yard; x <= ax1; x += F.yard) {
        const a = pr.pt(x, zN);
        const b = pr.pt(x, zF);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      for (let z = -W; z < zF; z += 40) {
        if (z < zN) continue;
        const a = pr.pt(ax0, z);
        const b = pr.pt(ax1, z);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = withAlpha('#000000', fd.surface === 'grass' ? 0.07 : 0.045);
      const band = 2 * F.yard;
      for (let x = Math.floor(ax0 / band) * band; x < ax1; x += band * 2) {
        const x0 = Math.max(ax0, x);
        const x1 = Math.min(ax1, x + band);
        if (x1 <= x0) continue;
        quadPath(ctx, pr, x0, x1, zN, zF);
        ctx.fill();
      }
      if (detail > 0.3 && (fd.surface === 'snow' || fd.surface === 'sand')) {
        drawSurfaceFx(ctx, pr, fd, pal, st, ax0, ax1, F.yard);
      }
    }
  }

  // photographers kneeling along the end line (near and far side, clear of the play line)
  if (detail > 0.3) {
    const spots = [[E + 16, -W - 34, 0], [E + 38, -W - 52, 1], [E + 58, -W - 30, 2], [E + 20, W + 26, 3], [E + 44, W + 34, 4]];
    for (const [x, z, i] of spots) {
      if (x < pr.xMin || x > pr.xMax || z < zN) continue;
      photographer(ctx, pr, x, z, i, time, neon ? zone : null);
    }
  }

  if (SX > pr.xMax + 20) return;
  const E3 = (x, z, y) => {
    const p = pr.pt(x, z);
    return [p[0], p[1] - y * k * pr.s(z)];
  };
  const face = (x0, x1, y0, y1, fill) => {
    // tread (x0..x1 at height y0 === y1) or riser (x0 === x1, y0..y1), across zN..zF
    const a = E3(x0, zN, y0);
    const b = E3(x1, zN, y1);
    const c = E3(x1, zF, y1);
    const d = E3(x0, zF, y0);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const riserFace = (x, y0, y1, fill) => {
    const a = E3(x, zN, y0);
    const b = E3(x, zN, y1);
    const c = E3(x, zF, y1);
    const d = E3(x, zF, y0);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const wallH = F.standsWallH;
  const wallCol = neon ? mixColor(pal.ground, '#000000', 0.55)
    : fd.wall === 'none' ? '#B98A52'
      : fd.wall === 'board' ? '#141A2E' : mixColor(zone, '#000000', 0.22);
  const seatA = neon ? mixColor(pal.ground, '#000000', 0.35)
    : fd.surface === 'sand' ? '#D2A468' : mixColor(zone, '#FFFFFF', fd.surface === 'snow' ? 0.15 : 0);
  const seatB = neon ? mixColor(pal.ground, '#000000', 0.5)
    : fd.surface === 'sand' ? '#BF9056' : mixColor(zone, '#000000', 0.25);
  const riserCol = neon ? mixColor(pal.ground, '#000000', 0.7) : mixColor(seatB, '#000000', 0.35);
  const crowd = CROWD[fd.surface] || CROWD.grass;
  const ROW = 14;
  const rise = F.standsRise;
  const rows = Math.max(1, Math.round(F.standsDepth / ROW));
  const backX = SX + rows * ROW;
  const topH = wallH + rows * ROW * rise;
  // the stands' back structure (only seen when the view is past the top row)
  riserFace(backX, 0, topH + F.standsBackH, neon ? mixColor(pal.ground, '#000000', 0.75) : mixColor(riserCol, '#000000', 0.25));
  // padded front wall (faces the field) with a team-colour cap
  riserFace(SX, 0, wallH, wallCol);
  riserFace(SX, wallH * 0.78, wallH, neon ? withAlpha(zone, 0.9) : mixColor(zone, '#FFFFFF', 0.25));
  if (!neon && fd.wall !== 'none') riserFace(SX, wallH * 0.3, wallH * 0.55, withAlpha('#FFFFFF', 0.2));
  const zStep = detail > 0.3 ? 17 : 34;
  for (let i = 0; i < rows; i++) {
    const x0 = SX + i * ROW;
    const x1 = x0 + ROW;
    const h = wallH + i * ROW * rise;
    const h1 = h + ROW * rise;
    if (E3(x0, zF, h)[0] > fv.w + 10) break;
    if (E3(x0, zN, h)[1] < -20) break;
    if (Math.max(E3(x1, zN, h1)[0], E3(x1, zF, h1)[0]) < -10) continue; // row left of the view
    face(x0, x1, h, h, i % 2 ? seatB : seatA);
    if (neon) {
      // glowing seat-row edge
      const a = E3(x0, zN, h);
      const b = E3(x0, zF, h);
      ctx.strokeStyle = withAlpha(i % 3 === 0 ? zone : pal.line, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    } else if (fd.surface === 'snow') {
      face(x0, x0 + ROW * 0.22, h, h, withAlpha('#FFFFFF', 0.85));
    }
    if (detail > 0.3) {
      // crowd on this row: far seats first so nearer fans overlap them
      const xs = x0 + ROW * 0.55;
      for (let z = zF - 8; z > zN; z -= zStep) {
        const seed = i * 131 + Math.round(z) * 7;
        if (hash(seed) < 0.12) continue; // empty seat
        const zz = z + (hash(seed + 1) - 0.5) * zStep * 0.5;
        const sc = pr.s(zz) * k;
        const bob = hash(seed + 3) < 0.3 ? Math.max(0, Math.sin(time * 5 + hash(seed + 2) * 6.3)) * 1.2 : 0;
        const [px, py] = E3(xs, zz, h + bob);
        const bw = 6.5 * sc;
        const bh = 8 * sc;
        const col = crowd[Math.floor(hash(seed + 4) * crowd.length)];
        if (bw < 0.9) {
          ctx.fillStyle = neon ? withAlpha(col, 0.8) : col;
          ctx.fillRect(px - 0.6, py - 1.4, 1.2, 1.4);
          continue;
        }
        ctx.fillStyle = neon ? withAlpha(col, 0.75) : col;
        ctx.fillRect(px - bw / 2, py - bh, bw, bh);
        ctx.fillStyle = neon ? withAlpha('#FFFFFF', 0.85) : SKIN[Math.floor(hash(seed + 5) * SKIN.length)];
        const hr = 2.6 * sc;
        ctx.fillRect(px - hr, py - bh - hr * 1.9, hr * 2, hr * 2);
        const extra = hash(seed + 6);
        if (fd.surface === 'snow' && extra < 0.5) {
          ctx.fillStyle = col === '#FFFFFF' ? '#D32F2F' : '#FFFFFF';
          ctx.fillRect(px - hr, py - bh - hr * 2.2, hr * 2, hr * 0.8); // beanie
        } else if (fd.surface === 'sand' && extra < 0.09) {
          ctx.fillStyle = crowd[Math.floor(hash(seed + 7) * crowd.length)];
          ctx.beginPath();
          ctx.ellipse(px, py - bh - hr * 2.4, 9 * sc, 5 * sc, 0, Math.PI, TAU); // beach umbrella
          ctx.fill();
        } else if ((fd.lights || neon) && extra < 0.06) {
          ctx.fillStyle = withAlpha('#FFFFFF', 0.9); // phone light
          ctx.fillRect(px + bw * 0.4, py - bh - hr * 2.6, Math.max(1, sc * 1.4), Math.max(1, sc * 2));
        }
      }
    }
    riserFace(x1, h, h1, riserCol);
  }
  // top-row facade: team colour with a light strip (neon: glowing band)
  const fH = F.standsBackH;
  riserFace(backX, topH, topH + fH, neon ? mixColor(pal.ground, '#000000', 0.6) : mixColor(zone, '#000000', 0.3));
  riserFace(backX, topH + fH * 0.55, topH + fH * 0.75, neon ? withAlpha(zone, 0.9) : withAlpha('#FFFFFF', 0.35));
  riserFace(backX, topH + fH * 0.9, topH + fH, neon ? withAlpha(pal.line, 0.9) : mixColor(zone, '#FFFFFF', 0.25));
}

/** A kneeling sideline photographer with a long lens pointed at the field (-x). */
function photographer(ctx, pr, x, z, i, time, glow) {
  const [px, py] = pr.pt(x, z);
  const sc = pr.s(z) * pr.k;
  if (sc < 0.25) return;
  const vest = glow || ['#FF6D00', '#FFD600', '#FF6D00', '#90CAF9', '#FFD600'][i % 5];
  ctx.fillStyle = withAlpha('#000000', 0.2);
  ctx.beginPath();
  ctx.ellipse(px, py, 9 * sc, 2.4 * sc, 0, 0, TAU);
  ctx.fill();
  // body (kneeling), vest, head, cap
  ctx.fillStyle = '#263238';
  roundRectPath(ctx, px - 4 * sc, py - 11 * sc, 9 * sc, 11 * sc, 2.5 * sc);
  ctx.fill();
  ctx.fillStyle = vest;
  ctx.fillRect(px - 3.6 * sc, py - 10.5 * sc, 8 * sc, 5 * sc);
  ctx.fillStyle = SKIN[i % SKIN.length];
  ctx.fillRect(px - 2.8 * sc, py - 16 * sc, 5.6 * sc, 5.4 * sc);
  ctx.fillStyle = '#1B1B1B';
  ctx.fillRect(px - 3 * sc, py - 17 * sc, 6.2 * sc, 2 * sc);
  // camera + long lens toward the field
  ctx.fillStyle = '#111111';
  ctx.fillRect(px - 5 * sc, py - 14.5 * sc, 4 * sc, 3.6 * sc);
  ctx.fillStyle = '#ECEFF1';
  ctx.fillRect(px - 13 * sc, py - 14 * sc, 8.5 * sc, 2.6 * sc);
  // occasional flash
  const ph = (time * 0.7 + i * 0.37) % 1;
  if (ph < 0.05) {
    ctx.fillStyle = withAlpha('#FFFFFF', 0.85 * (1 - ph / 0.05));
    ctx.beginPath();
    ctx.arc(px - 13 * sc, py - 12.7 * sc, 4 * sc, 0, TAU);
    ctx.fill();
  }
}

/** A yard number painted in the current ground frame (units = world units). */
function paintYardNumber(ctx, n, arrow, fill, glow) {
  const F = 24;
  ctx.font = `900 ${F}px ${FIELD_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const str = String(n);
  const tens = str.length > 1 ? str[0] : '';
  const ones = str[str.length - 1];
  if (glow) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = withAlpha(glow, 0.5);
    if (tens) ctx.strokeText(tens, -8.5, 0);
    ctx.strokeText(ones, tens ? 8.5 : 0, 0);
  }
  ctx.fillStyle = fill;
  if (tens) ctx.fillText(tens, -8.5, 0);
  ctx.fillText(ones, tens ? 8.5 : 0, 0);
  if (arrow) {
    const ax = arrow * 22;
    ctx.beginPath();
    ctx.moveTo(ax + arrow * 5, -6);
    ctx.lineTo(ax, -9.5);
    ctx.lineTo(ax, -2.5);
    ctx.closePath();
    ctx.fill();
  }
}

/** Theme character on the turf: snow cover, beach sand, neon glow, stadium light pools. */
function drawSurfaceFx(ctx, pr, fd, pal, st, xa, xb, U) {
  const W = pr.W;
  if (fd.surface === 'snow') {
    // wind-swept snow streaks and sparkles on the turf, drifts piled on both sidelines
    ctx.fillStyle = withAlpha('#FFFFFF', 0.55);
    for (let x = Math.floor(xa / 40) * 40; x < xb; x += 40) {
      for (let i = 0; i < 3; i++) {
        const z = -W + hash(x * 0.13 + i * 7.1) * 2 * W;
        const len = 10 + hash(x + i) * 18;
        quadPath(ctx, pr, x, x + len, z, z + 4);
        ctx.fill();
      }
    }
    ctx.fillStyle = withAlpha('#FFFFFF', 0.95);
    for (const zSide of [W + 14, -W - 16]) {
      for (let x = Math.floor(xa / 34) * 34; x < xb + 34; x += 34) {
        const [px, py] = pr.pt(x + hash(x * 0.71) * 14, zSide);
        const sc = pr.s(zSide) * pr.k;
        ctx.beginPath();
        ctx.ellipse(px, py, Math.max(1, (14 + hash(x) * 12) * sc), Math.max(0.6, (4 + hash(x * 3) * 4) * sc), 0, Math.PI, TAU);
        ctx.fill();
      }
    }
  } else if (fd.surface === 'sand') {
    // shell-and-footprint speckles + soft ripples in the sand
    ctx.fillStyle = withAlpha(mixColor(pal.groundDark, '#8A6433', 0.35), 0.35);
    for (let x = Math.floor(xa / U) * U; x < xb; x += U) {
      for (let i = 0; i < 3; i++) {
        const z = -W + hash(x * 0.29 + i * 3.7) * 2 * W;
        const [px, py] = pr.pt(x + hash(x + i * 9.3) * U, z);
        const r = Math.max(0.5, (0.9 + hash(x * 1.3 + i) * 1.3) * pr.k * pr.s(z));
        ctx.fillRect(px - r, py - r * 0.5, r * 2, r);
      }
    }
    ctx.strokeStyle = withAlpha('#FFFFFF', 0.22);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let z = -W + 30; z < W; z += 55) {
      const a = pr.pt(xa, z);
      const b = pr.pt(xb, z + 18);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  } else if (fd.lights) {
    // stadium light pools on the turf
    const cx = pr.vpx;
    const [, cy] = pr.pt(0, 0);
    const r = Math.max(60, pr.Hh * 1.2);
    const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 1.6);
    g.addColorStop(0, withAlpha('#FFFFFF', 0.12));
    g.addColorStop(1, withAlpha('#FFFFFF', 0));
    ctx.save();
    quadPath(ctx, pr, xa, xb, -W, W);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
    ctx.restore();
  }
}

/** Draw a simple side-view goal post (used by previews; render.js has its own layered version). */
function miniPost(ctx, x, groundY, bar, top, w, color, ribbon) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, groundY);
  ctx.lineTo(x, bar);
  ctx.moveTo(x - w * 1.6, bar);
  ctx.lineTo(x + w * 1.6, bar);
  ctx.moveTo(x - w * 1.6, bar);
  ctx.lineTo(x - w * 1.6, top);
  ctx.moveTo(x + w * 1.6, bar);
  ctx.lineTo(x + w * 1.6, top);
  ctx.stroke();
  ctx.fillStyle = ribbon;
  for (const ux of [x - w * 1.6, x + w * 1.6]) {
    ctx.beginPath();
    ctx.moveTo(ux, top);
    ctx.lineTo(ux + w * 2, top + w * 0.8);
    ctx.lineTo(ux, top + w * 1.6);
    ctx.closePath();
    ctx.fill();
  }
}

/** Mini sky + decor + field + post scene for store cards (w x h css px). */
export function drawStadiumPreview(ctx, id, w, h) {
  const th = STADIUM_THEMES[id] || STADIUM_THEMES.day;
  const pal = themePalette(th.id, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, pal.skyTop);
  g.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Same broadcast field as the game: end zone + post on the right, tee side on the left.
  const k = w / 300;
  const gy = Math.round(h * 0.7);
  const endX = 0;
  const fv = { w, h, k, camX: endX - (w * 0.74) / k, gy, endX, tilt: 0.22, detail: w >= 200 ? 1 : 0.2 };
  const pr = fieldProjection(fv);
  ctx.save();
  // Decor is authored for phone-sized views; scale it down into the card.
  const s = Math.max(0.3, Math.min(1, w / 300));
  ctx.scale(s, s);
  th.drawDecor(ctx, { camX: 0, camY: 0, k: w / 320, w: w / s, h: h / s, groundY: pr.farY / s }, pal, 1.3);
  ctx.restore();
  ctx.save();
  drawField(ctx, th.id, pal, fv, 1.3);
  ctx.restore();
  const groundY = gy;
  const pw = Math.max(2, h * 0.045);
  // kicking net behind the uprights (same offset as in game)
  const nx = w * 0.74 + CONFIG.field.netOffset * k;
  const nh = Math.max(3, CONFIG.field.netHalf * k);
  const nTop = h * 0.2; // below the store card lock badge
  const nBot = groundY - h * 0.15;
  ctx.strokeStyle = th.id === 'arcade' ? withAlpha(pal.zone || pal.accent, 0.6) : withAlpha('#FFFFFF', 0.5);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = 0; i <= 3; i++) {
    ctx.moveTo(nx - nh + (2 * nh * i) / 3, nTop);
    ctx.lineTo(nx - nh + (2 * nh * i) / 3, nBot);
  }
  for (let y = nTop; y <= nBot; y += Math.max(3, h * 0.035)) {
    ctx.moveTo(nx - nh, y);
    ctx.lineTo(nx + nh, y);
  }
  ctx.stroke();
  ctx.strokeStyle = th.id === 'arcade' ? pal.line : '#2E3440';
  ctx.lineWidth = Math.max(1, pw * 0.45);
  ctx.beginPath();
  ctx.moveTo(nx + nh, groundY);
  ctx.lineTo(nx + nh, nTop);
  ctx.stroke();
  miniPost(ctx, w * 0.74, groundY, groundY - h * 0.3, h * 0.12, pw, pal.post, pal.accent);
  drawBall(ctx, 'classic', w * 0.3, groundY - h * 0.34, h * 0.075, -0.6, 0);
  ctx.restore();
}
