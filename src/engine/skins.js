// Flick Goal — procedural ball skins and stadium themes (pure canvas; no DOM).
//
// Every draw function only uses the ctx it is given, so the shell can reuse them
// for store previews and Node tests can run them against a stub context.
// Ball draw functions draw at the origin with the long axis along +x
// (football ellipse ~1.3r x 0.85r, round balls ~1.05r). Colors are flat, with
// one shade crescent + one highlight that stay screen-aligned (light from top-left).

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

function P(skyTop, skyBottom, ground, groundDark, line, post, accent, uiBg) {
  return Object.freeze({ skyTop, skyBottom, ground, groundDark, line, post, accent, uiBg });
}

export const STADIUM_THEMES = Object.freeze({
  day: {
    id: 'day', name: 'Day Game', decor: 'clouds',
    palettes: [
      P('#4FC3F7', '#B3E5FC', '#5CC858', '#4DB84A', '#FFFFFF', '#FFD21F', '#FF8A3D', '#4FC3F7'),
      P('#26C6DA', '#B2F0F7', '#57C46A', '#48B35C', '#FFFFFF', '#FFD21F', '#FF6B6B', '#1FB5C9'),
      P('#9C7BEA', '#D9CCFF', '#5CC870', '#4DB862', '#FFFFFF', '#FFD21F', '#FF8A3D', '#8E6FE0'),
      P('#FF8FA3', '#FFD6DE', '#63C95C', '#54B94E', '#FFFFFF', '#FFD21F', '#7C4DFF', '#F77A91'),
      P('#FFB74D', '#FFE3B8', '#6AC955', '#5AB948', '#FFFFFF', '#FFFFFF', '#E0457B', '#F5A23A'),
    ],
    drawDecor: decorDay,
  },
  night: {
    id: 'night', name: 'Night Lights', decor: 'night',
    palettes: [
      P('#0E1B4D', '#2D4C8F', '#2E9E5B', '#278A4F', '#FFFFFF', '#FFD21F', '#FF4FA0', '#1F2F66'),
      P('#2A0F4F', '#5A2D8C', '#2E9E68', '#27885A', '#FFFFFF', '#FFD21F', '#39D98A', '#3B1C6B'),
      P('#062F3F', '#1A6B7A', '#2FA05E', '#288A51', '#FFFFFF', '#FFE45C', '#FF8A3D', '#0D4658'),
      P('#3A0B26', '#7A2446', '#2E9A5A', '#27854E', '#FFFFFF', '#FFD21F', '#4FC3F7', '#5A1638'),
    ],
    drawDecor: decorNight,
  },
  snow: {
    id: 'snow', name: 'Snow Bowl', decor: 'snow',
    palettes: [
      P('#7CC6F0', '#DDF1FF', '#F2F8FF', '#DCEAF7', '#8EB9DA', '#FFD21F', '#FF5A5F', '#5DB6E6'),
      P('#A99BE8', '#E6E0FF', '#F4F4FF', '#E0E0F5', '#9A93CF', '#FFD21F', '#FF6FB5', '#8F80DD'),
      P('#F59BB0', '#FFE3EA', '#FAF6F8', '#EDE0E6', '#C99AAB', '#FFD21F', '#5A7DFF', '#E97F98'),
      P('#7D93AD', '#D5E0EC', '#EEF3F8', '#D6E0EA', '#92A7BD', '#FFD21F', '#FF8A3D', '#6A819C'),
    ],
    drawDecor: decorSnow,
  },
  sunset: {
    id: 'sunset', name: 'Beach Sunset', decor: 'sunset',
    palettes: [
      P('#FF6F61', '#FFC37A', '#F2D48C', '#E6C274', '#FFFFFF', '#FFFFFF', '#FF3D6E', '#FF7A59'),
      P('#D94F8C', '#FF9E7A', '#EFD08F', '#E2BD76', '#FFFFFF', '#FFE45C', '#7C4DFF', '#D9578F'),
      P('#6A3FA0', '#F0788A', '#E8CB8E', '#D9B874', '#FFFFFF', '#FFD21F', '#FF8A3D', '#7A4AAE'),
      P('#FF9A3C', '#FFE08A', '#F4D98F', '#E8C677', '#FFFFFF', '#FFFFFF', '#E0457B', '#F58B2E'),
    ],
    drawDecor: decorSunset,
  },
  arcade: {
    id: 'arcade', name: 'Neon Arcade', decor: 'arcade',
    palettes: [
      P('#12072E', '#3A0CA3', '#1B0F3F', '#25145A', '#00F0FF', '#FFE600', '#FF2BD6', '#2A0E6B'),
      P('#07122E', '#0C4DA3', '#0F1B3F', '#14275A', '#FF2BD6', '#39FF88', '#00F0FF', '#0E2A6B'),
      P('#2E0721', '#A30C6E', '#3F0F2E', '#5A1442', '#39FF88', '#00F0FF', '#FFE600', '#6B0E4A'),
      P('#0A2E07', '#0CA36B', '#0F3F24', '#145A33', '#FFE600', '#FF2BD6', '#00F0FF', '#0E6B45'),
    ],
    drawDecor: decorArcade,
  },
});

/** Palette for a stadium at a score tier (unknown id -> 'day'). */
export function themePalette(id, tier = 0) {
  const th = STADIUM_THEMES[id] || STADIUM_THEMES.day;
  const n = th.palettes.length;
  const i = ((Math.floor(Number(tier) || 0) % n) + n) % n;
  return th.palettes[i];
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
  const groundY = Math.round(h * 0.74);
  ctx.save();
  // Decor is authored for phone-sized views; scale it down into the card.
  const s = Math.max(0.3, Math.min(1, w / 300));
  ctx.scale(s, s);
  th.drawDecor(ctx, { camX: 0, camY: 0, k: w / 320, w: w / s, h: h / s, groundY: groundY / s }, pal, 1.3);
  ctx.restore();
  ctx.fillStyle = pal.ground;
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = pal.groundDark;
  const stripe = Math.max(8, w / 8);
  for (let x = 0, i = 0; x < w + stripe; x += stripe, i++) {
    if (i % 2) ctx.fillRect(x, groundY, stripe, h - groundY);
  }
  ctx.fillStyle = withAlpha(pal.line, 0.5);
  ctx.fillRect(0, groundY, w, Math.max(1, h * 0.025));
  const pw = Math.max(2, h * 0.045);
  miniPost(ctx, w * 0.7, groundY, groundY - h * 0.3, h * 0.14, pw, pal.post, pal.accent);
  drawBall(ctx, 'classic', w * 0.3, groundY - h * 0.34, h * 0.075, -0.6, 0);
  ctx.restore();
}
