// Flick Goal — RETRO style: flat procedural ball skins (the v1 / field-posts look).
// Every skin draws at the origin with the long axis along +x (football ellipse ~1.3r x 0.85r,
// round balls ~1.05r). Colours are flat, with one shade crescent + one highlight that stay
// screen-aligned (light from top-left). draw(ctx, r, time, rot, light) - `light` is ignored.

import { circlePath, ellipsePath, polyPath, hash, wrap } from '../../paint.js';
import { BALL_META } from '../../themes.js';

const TAU = Math.PI * 2;

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

const SKINS = Object.freeze({
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

/** Retro ball skins keyed by catalog ball id: { draw(ctx, r, time, rot, light) }. */
export const RETRO_BALLS = Object.freeze(Object.fromEntries(Object.keys(BALL_META).map((id) => {
  const s = SKINS[id] || SKINS.classic;
  return [id, Object.freeze({ id, draw: (ctx, r, time = 0, rot = 0) => s.draw(ctx, r, time, rot) })];
})));

/** Retro store-card ball preview centred in a size x size css-px box. */
export function previewRetroBall(ctx, id, size, time = 0) {
  const meta = BALL_META[id] || BALL_META.classic;
  const skin = RETRO_BALLS[meta.id] || RETRO_BALLS.classic;
  const round = meta.shape === 'round';
  const r = round ? size * 0.34 : size * 0.3;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(size / 2, size * 0.88, size * 0.3, size * 0.06, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  const rot = round ? 0.25 : -0.5;
  ctx.save();
  ctx.translate(size / 2, size * 0.47);
  ctx.rotate(rot);
  skin.draw(ctx, r, time, rot);
  ctx.restore();
}
