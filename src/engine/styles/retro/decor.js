// Flick Goal — RETRO style: flat stadium decor per base theme (sky props, parallax hills /
// stands / towers / trees / palms / mountains), standing on the far wall of the field.
// view = { camX, camY, k, w, h, groundY } - camX/camY world coords of the view's bottom-left
// corner, k css px per world unit, groundY screen y the decor stands on (the far wall top).

import { mixColor, withAlpha, circlePath, hash, wrap } from '../../paint.js';

const TAU = Math.PI * 2;


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
  // lamp heads stay below the HUD band (score, clock, pills): shorter towers on small screens
  const safeTop = Math.max(124, view.h * 0.17);
  const hgt = Math.max(30, Math.min(view.h * 0.42, 330, view.groundY - 30 - 22 - safeTop));
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

/** Retro decor painters keyed by base theme id. */
export const RETRO_DECOR = Object.freeze({
  day: decorDay, night: decorNight, snow: decorSnow, sunset: decorSunset, arcade: decorArcade,
});

/** Paint the decor of base theme `themeId` (unknown -> day). */
export function drawRetroDecor(ctx, themeId, view, pal, time) {
  (RETRO_DECOR[themeId] || decorDay)(ctx, view, pal, time);
}
