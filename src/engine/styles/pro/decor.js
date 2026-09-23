// Flick Goal — PRO style: stylized-realism stadium decor per base theme (ported from
// try/pro-graphics skins.js): sun / moon with bloom and light shafts, shaded soft clouds, hazy
// hills, the stadium bowl packed with a crowd (roof shadow, aisles, LED ad boards, aerial haze),
// the big scoreboard, floodlight towers with volumetric beams and dust motes, snowy mountains and
// pines, palms and a glittering sea, the neon skyline and grid mountains.
// It stands on the far wall of the field (view.groundY = f.proj.farY) and parallaxes forever, so
// FIELD and ENDLESS share it. Static pieces are painted once into cached layers (f.layers, keys
// prefixed 'pro:') and blitted; with no cache (tests) they are drawn directly.
// view = { camX, camY, k, w, h, groundY, lo, postX }.

import {
  mixColor, withAlpha, memo, softSpot, fillPathV, fillPathH, fillPathR, fillRectV, curAlpha,
  roundRectPath, circlePath, hash, wrap, clamp01,
} from '../../paint.js';
import { warmLayer } from './warm.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);


// ---------------------------------------------------------------- stadium scene helpers
// view = { camX, camY, k, w, h, groundY } — camX/camY world coords of the view's
// bottom-left corner, k css px per world unit, groundY screen y of world y = 0.
// cache (optional) = { layer(ctx, key, w, h, draw, x, y) }: blits a pre-rendered w x h layer
// whose content is draw(c, palette) at the origin. Absent -> drawn directly.

function layer(ctx, cache, key, w, h, x, y, pal, draw) {
  if (cache) cache.layer(ctx, key, w, h, draw, x, y);
  else {
    ctx.save();
    ctx.translate(x, y);
    draw(ctx, pal);
    ctx.restore();
  }
}

/** Repeat a horizontally tiling layer with parallax factor par; fn(x0) per visible tile. */
function tiles(view, par, tile, fn, pad = 0) {
  const scroll = view.camX * view.k * par;
  const off = wrap(scroll, tile);
  const base = Math.round((scroll - off) / tile);
  const n = Math.ceil(view.w / tile) + 1;
  for (let t = -1; t <= n; t++) {
    const x0 = t * tile - off;
    if (x0 - pad > view.w + 2 || x0 + tile + pad < -2) continue;
    fn(x0, base + t);
  }
}

/**
 * Tiny twinkling dots in a handful of alpha buckets: one path + fill per bucket instead of a
 * globalAlpha switch and fillRect per dot. dots = flat [x, y, size, alpha, ...].
 */
function dotBuckets(ctx, dots, levels = 4) {
  const ga = curAlpha(ctx);
  for (let b = 0; b < levels; b++) {
    const lo = b / levels;
    const hi = (b + 1) / levels;
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < dots.length; i += 4) {
      const a = dots[i + 3];
      if (a <= lo || a > hi) continue;
      ctx.rect(dots[i], dots[i + 1], dots[i + 2], dots[i + 2]);
      any = true;
    }
    if (!any) continue;
    ctx.globalAlpha = ga * (lo + hi) / 2;
    ctx.fill();
  }
  ctx.globalAlpha = ga;
}

/** Current canvas scale (1 for stub contexts). Used to keep blur radii resolution-independent. */
function ctxScale(ctx) {
  try {
    const m = ctx.getTransform && ctx.getTransform();
    return m && Number.isFinite(m.a) && m.a > 0 ? m.a : 1;
  } catch (_) {
    return 1;
  }
}

const SSC_KEYS = ['pro:ssc150', 'pro:ssc190', 'pro:ssc230'];
const SUN_DISC = [0, '#FFFDF0', 0.55, '#FFE68F', 0.82, '#FFD54A', 1, '#FFE38A'];
const MOON_DISC = [0, '#FFFBEA', 1, '#E9DDB4'];
const NEON_HORIZON = [0, 'rgba(255,43,214,0)', 1, 'rgba(255,43,214,0.35)'];

function glow(ctx, x, y, r, color, a) {
  softSpot(ctx, x, y, r, r, color, a);
}

/** Soft light shafts fanning out of (x, y). spread < TAU limits the fan around dir. */
function rays(ctx, x, y, len, n, time, color, a, spread = TAU, dir = 0) {
  if (!(len > 1)) return;
  ctx.beginPath();
  const spin = spread >= TAU ? time * 0.018 : 0;
  for (let i = 0; i < n; i++) {
    const c = dir - spread / 2 + ((i + 0.5) * spread) / n + Math.sin(time * 0.3 + i * 1.7) * 0.035 + spin;
    const hw = 0.03 + 0.04 * hash(i * 4.1 + 2);
    ctx.moveTo(x, y);
    ctx.arc(x, y, len, c - hw, c + hw);
    ctx.closePath();
  }
  fillPathR(ctx, x, y, len, memo('rays', color, a, 0, () => [0, withAlpha(color, a), 0.35, withAlpha(color, a * 0.4), 1, withAlpha(color, 0)]));
}

/** Disc filled with a vertical gradient, sliced by horizontal gaps (retro sun). */
function slicedSun(ctx, x, y, r, top, bottom, gaps) {
  ctx.save();
  ctx.beginPath();
  let yy = y - r - 1;
  for (const [gy, gh] of gaps) {
    if (gy > yy) ctx.rect(x - r - 1, yy, 2 * r + 2, gy - yy);
    yy = gy + gh;
  }
  if (y + r + 1 > yy) ctx.rect(x - r - 1, yy, 2 * r + 2, y + r + 1 - yy);
  ctx.clip();
  circlePath(ctx, x, y, r);
  fillPathV(ctx, y - r, y + r, memo('v2', top, bottom, 0, () => [0, top, 1, bottom]));
  ctx.restore();
}

function hazeBand(ctx, view, color, height, a) {
  const y1 = view.groundY + 2;
  const y0 = y1 - height;
  if (y1 < 0 || y0 > view.h) return;
  fillRectV(ctx, 0, y0, view.w, height, memo('haze', color, a, 0, () => [0, withAlpha(color, 0), 1, withAlpha(color, a)]));
}

// ---------------------------------------------------------------- clouds
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
}

/** A shaded, soft-edged cloud sprite in a (4.2s x 2.8s) box; the cloud centre is at (2.1s, 1.5s). */
function cloudSprite(c, s, lit, shade, rim) {
  const x = s * 2.1;
  const y = s * 1.5;
  const sc = ctxScale(c);
  // soft halo
  c.save();
  c.shadowColor = withAlpha(lit, 0.55);
  c.shadowBlur = s * 0.35 * sc;
  cloud(c, x, y, s);
  const g = c.createLinearGradient(0, y - s * 1.25, 0, y + s * 0.95);
  g.addColorStop(0, lit);
  g.addColorStop(0.5, mixColor(lit, shade, 0.2));
  g.addColorStop(1, shade);
  c.fillStyle = g;
  c.fill('nonzero');
  c.restore();
  // inner puff highlights (lit from above)
  c.save();
  cloud(c, x, y, s);
  c.clip();
  c.fillStyle = withAlpha(lit, 0.9);
  c.beginPath();
  c.arc(x + s * 0.2, y - s * 0.62, s * 0.55, 0, TAU);
  c.moveTo(x - s * 0.3, y - s * 0.1);
  c.arc(x - s * 0.3, y - s * 0.1, s * 0.6, 0, TAU);
  c.fill();
  // underside occlusion
  c.fillStyle = withAlpha(shade, 0.35);
  c.fillRect(x - s * 2, y + s * 0.62, s * 4, s * 0.4);
  if (rim) {
    c.fillStyle = withAlpha(rim, 0.55);
    c.fillRect(x - s * 2, y + s * 0.8, s * 4, s * 0.14);
  }
  c.restore();
}

/**
 * Drifting cloud field. Every cloud shares one parallax offset, so the whole tile of clouds is
 * pre-rendered as a single layer and blitted (usually twice) instead of once per cloud.
 */
function drawClouds(ctx, view, pal, time, cache, { count = 5, alpha = 0.95, lit = '#FFFFFF', shade = null, rim = null, key = 'pro:cl' } = {}) {
  const tile = Math.round(Math.max(520, view.w * 1.5));
  const off = view.camX * view.k * 0.2 - time * 7;
  const vy = view.camY * view.k * 0.12;
  const clouds = [];
  let top = Infinity;
  let bottom = -Infinity;
  let minDy = -Infinity;
  for (let i = 0; i < count; i++) {
    const s = Math.round(18 + hash(i * 9.1) * 22);
    const y = view.h * (0.24 + hash(i * 3.3) * 0.3);
    clouds.push([hash(i * 1.7) * tile, y, s]);
    top = Math.min(top, y - s * 1.5);
    bottom = Math.max(bottom, y + s * 1.3);
    // Cloud lanes stay below the HUD band (score + shot clock), so the clock bar and hint
    // never sit on top of a white cloud.
    minDy = Math.max(minDy, view.h * 0.2 + s * 1.3 - y);
  }
  top = Math.floor(top);
  const H = Math.ceil(bottom - top);
  const dy = Math.max(vy, minDy);
  const draw = (c, p) => {
    const sh = shade || mixColor(p.skyTop, '#FFFFFF', 0.55);
    for (const [cx, cy, s] of clouds) {
      for (const ox of [0, -tile, tile]) {
        const x = cx + ox;
        if (x + s * 2.1 < 0 || x - s * 2.1 > tile) continue;
        c.save();
        c.translate(x - s * 2.1, cy - top - s * 1.5);
        cloudSprite(c, s, lit, sh, rim);
        c.restore();
      }
    }
  };
  const x0 = wrap(-off, tile) - 80;
  ctx.save();
  ctx.globalAlpha = curAlpha(ctx) * alpha;
  for (const x of [x0 - tile, x0, x0 + tile]) {
    if (x > view.w || x + tile < 0) continue;
    layer(ctx, cache, key, tile, H, x, top + dy, pal, draw);
  }
  ctx.restore();
}

function drawHills(ctx, view, color, par, amp, base, seed, topColor = null) {
  const off = view.camX * view.k * par;
  const y0 = view.groundY + 2;
  if (y0 - base - amp > view.h || y0 < -4) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, y0);
  for (let x = 0; x <= view.w + 8; x += 8) {
    const u = (x + off) / 120;
    const y = y0 - base - amp * (0.55 + 0.45 * Math.sin(u + seed) * Math.sin(u * 0.37 + seed * 2));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(view.w + 8, y0);
  ctx.closePath();
  if (topColor) fillPathV(ctx, y0 - base - amp, y0, memo('v2', topColor, color, 0, () => [0, topColor, 1, color]));
  else ctx.fill();
}

function drawStars(ctx, view, count, time, color = '#FFFFFF') {
  const off = view.camX * view.k * 0.05;
  const vy = view.camY * view.k * 0.05;
  ctx.fillStyle = color;
  const dots = [];
  for (let i = 0; i < count; i++) {
    const x = wrap(hash(i * 1.37) * view.w * 1.3 - off, view.w * 1.3);
    const y = hash(i * 2.71) * view.h * 0.62 + vy;
    const tw = 0.5 + 0.5 * Math.sin(time * 2.2 + i * 1.9);
    const s = 1 + hash(i * 4.2) * 1.8;
    dots.push(x, y, s, 0.45 + 0.55 * tw);
    if (i % 9 === 0) {
      // a few bright stars get a soft cross glint
      ctx.globalAlpha = 0.35 * tw;
      ctx.fillRect(x - 3.5, y + s / 2 - 0.35, 7 + s, 0.7);
      ctx.fillRect(x + s / 2 - 0.35, y - 3.5, 0.7, 7 + s);
    }
  }
  ctx.globalAlpha = 1;
  dotBuckets(ctx, dots, 4);
}

// ---------------------------------------------------------------- stadium stands
const CROWD = ['#F4F6F8', '#F2C94C', '#EB5757', '#2F80ED', '#27AE60', '#9B51E0', '#F2994A', '#3A4150', '#CFD6DE', '#56CCF2'];
const SKIN_TONES = ['#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#FFDBAC'];
const STAND_TILE = 420;

/** One tile of the stadium bowl: roof canopy, tiered crowd, aisles, LED ad boards, aerial haze. */
function standsTile(c, W, H, sh, o) {
  const yE = H - sh * 0.75;
  const yC = H - sh * 1.1;
  const bowl = () => {
    c.beginPath();
    c.moveTo(0, H);
    c.lineTo(0, yE);
    c.quadraticCurveTo(W / 2, yC, W, yE);
    c.lineTo(W, H);
    c.closePath();
  };
  bowl();
  let g = c.createLinearGradient(0, yC, 0, H);
  g.addColorStop(0, o.structTop);
  g.addColorStop(1, o.struct);
  c.fillStyle = g;
  c.fill();
  c.save();
  bowl();
  c.clip();
  const crowd = CROWD.map((col) => mixColor(col, o.crowdTo, o.crowdMix));
  if (o.accent) crowd.push(mixColor(o.accent, o.crowdTo, o.crowdMix * 0.8), mixColor(o.accent, o.crowdTo, o.crowdMix * 0.8));
  const skin = SKIN_TONES.map((col) => mixColor(col, o.crowdTo, o.crowdMix));
  const boardH = Math.max(7, sh * 0.13);
  const yTop = H - sh * 0.98;
  const rowH = 4.4;
  // Rows are collected first and filled once per colour (a few dozen fills instead of
  // thousands of fillStyle switches), which keeps the one-off tile build cheap.
  const walls = [];
  const seats = [];
  const shirts = crowd.map(() => []);
  const heads = skin.map(() => []);
  let row = 0;
  for (let y = H - boardH - 2; y > yTop; y -= rowH, row++) {
    if (row % 6 === 5) { walls.push(y); continue; }
    seats.push(y);
    for (let x = 0.8 + (row % 2) * 1.75; x < W - 1; x += 3.5) {
      const hsh = hash(x * 0.37 + row * 17.3);
      if (hsh < 0.1) continue; // empty seat
      shirts[Math.floor(hsh * 997) % crowd.length].push(x, y);
      heads[Math.floor(hsh * 131) % skin.length].push(x, y);
    }
  }
  c.fillStyle = o.seat;
  c.beginPath();
  for (const y of seats) c.rect(0, y - rowH + 0.8, W, rowH - 0.5);
  c.fill();
  const batch = (list, col, dx, dy, w, h) => {
    if (!list.length) return;
    c.fillStyle = col;
    c.beginPath();
    for (let i = 0; i < list.length; i += 2) c.rect(list[i] + dx, list[i + 1] + dy, w, h);
    c.fill();
  };
  shirts.forEach((l, i) => batch(l, crowd[i], 0, -2.5, 2.7, 2.3));
  heads.forEach((l, i) => batch(l, skin[i], 0.5, -3.9, 1.7, 1.5));
  c.fillStyle = o.wall;
  c.beginPath();
  for (const y of walls) c.rect(0, y - 2.4, W, 2.2);
  c.fill();
  c.fillStyle = o.wallShade;
  c.beginPath();
  for (const y of walls) c.rect(0, y - 0.2, W, 1.4);
  c.fill();
  // aisles
  for (let x = 34; x < W; x += 70) {
    c.fillStyle = o.wall;
    c.fillRect(x, yTop, 3, H - boardH - yTop);
    c.fillStyle = o.wallShade;
    c.fillRect(x + 3, yTop, 1, H - boardH - yTop);
  }
  // roof shadow over the upper rows, light from the field on the lower rows
  g = c.createLinearGradient(0, yC, 0, yC + sh * 0.55);
  g.addColorStop(0, withAlpha(o.shadow, o.shadowA));
  g.addColorStop(1, withAlpha(o.shadow, 0));
  c.fillStyle = g;
  c.fillRect(0, yC, W, sh * 0.55);
  if (o.lit > 0) {
    g = c.createLinearGradient(0, H - sh * 0.7, 0, H);
    g.addColorStop(0, withAlpha(o.litColor, 0));
    g.addColorStop(1, withAlpha(o.litColor, o.lit));
    c.fillStyle = g;
    c.fillRect(0, H - sh * 0.7, W, sh * 0.7);
  }
  // aerial perspective
  c.fillStyle = withAlpha(o.fog, o.fogA);
  c.fillRect(0, 0, W, H);
  // LED ad boards at field level
  const by = H - boardH;
  g = c.createLinearGradient(0, by, 0, H);
  g.addColorStop(0, o.boardTop);
  g.addColorStop(1, o.board);
  c.fillStyle = g;
  c.fillRect(0, by, W, boardH);
  for (let i = 0; i < 7; i++) {
    const x = 8 + i * 60;
    c.fillStyle = withAlpha(i % 2 ? o.boardHi : '#FFFFFF', o.boardA);
    c.fillRect(x, by + boardH * 0.28, 22 + (i % 3) * 6, boardH * 0.42);
    c.fillStyle = withAlpha('#FFFFFF', o.boardA * 0.5);
    c.fillRect(x + 32 + (i % 3) * 6, by + boardH * 0.36, 10, boardH * 0.26);
  }
  c.fillStyle = withAlpha('#FFFFFF', 0.4);
  c.fillRect(0, by, W, 1);
  c.restore();
  // roof canopy along the bowl rim
  c.lineCap = 'butt';
  c.lineWidth = 5;
  c.strokeStyle = o.roof;
  c.beginPath();
  c.moveTo(0, yE);
  c.quadraticCurveTo(W / 2, yC, W, yE);
  c.stroke();
  c.lineWidth = 1.2;
  c.strokeStyle = o.roofHi;
  c.beginPath();
  c.moveTo(0, yE - 2.3);
  c.quadraticCurveTo(W / 2, yC - 2.3, W, yE - 2.3);
  c.stroke();
}

function drawStands(ctx, view, pal, cache, key, sh, par, opts) {
  const H = Math.ceil(sh * 1.12 + 6);
  const y = view.groundY + 1 - H;
  if (y > view.h || y + H < 0) return;
  tiles(view, par, STAND_TILE, (x0) => {
    layer(ctx, cache, key, STAND_TILE, H, x0, y, pal, (c, p) => standsTile(c, STAND_TILE, H, sh, opts(p)));
  });
}

/** Big screen scoreboard standing behind the stands (sparse tile, same parallax as the stands). */
function scoreboardTile(c, W, H, p, night) {
  const bx = 4;
  const bw = 96;
  const bh = 46;
  const frame = night ? '#141A2A' : mixColor('#2A3142', p.skyBottom, 0.25);
  c.fillStyle = mixColor(frame, '#000000', 0.2);
  c.fillRect(bx + 18, bh, 5, H - bh);
  c.fillRect(bx + bw - 23, bh, 5, H - bh);
  roundRectPath(c, bx, 0, bw, bh, 4);
  c.fillStyle = frame;
  c.fill();
  const g = c.createLinearGradient(0, 4, 0, bh - 4);
  g.addColorStop(0, mixColor(p.uiBg, '#000000', night ? 0.35 : 0.55));
  g.addColorStop(1, mixColor(p.uiBg, '#000000', night ? 0.6 : 0.75));
  c.save();
  if (night) {
    c.shadowColor = withAlpha(p.uiBg, 0.9);
    c.shadowBlur = 10 * ctxScale(c);
  }
  c.fillStyle = g;
  c.fillRect(bx + 4, 4, bw - 8, bh - 8);
  c.restore();
  // "HOME 7 | 3 AWAY" in chunky LED blocks
  const led = night ? '#FFE9A8' : '#FFE08A';
  c.fillStyle = withAlpha(led, night ? 0.95 : 0.8);
  c.fillRect(bx + 10, 10, 22, 4);
  c.fillRect(bx + bw - 32, 10, 22, 4);
  c.fillStyle = withAlpha(p.accent, 0.95);
  c.fillRect(bx + 14, 19, 12, 18);
  c.fillRect(bx + bw - 26, 19, 12, 18);
  c.fillStyle = withAlpha('#FFFFFF', 0.5);
  c.fillRect(bx + bw / 2 - 1, 12, 2, 24);
  c.fillStyle = withAlpha('#FFFFFF', 0.18);
  c.fillRect(bx + 4, 4, bw - 8, 3);
  if (!night) {
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = withAlpha(p.skyBottom, 0.25);
    c.fillRect(bx, 0, bw, H);
    c.restore();
  }
}

// One board every SB_PERIOD px of parallax scroll. SB_X keeps it just off the right edge in the
// opening framing (where the tee, aim rail, menu buttons and post already fill the scene); it
// drifts into view with parallax as the camera pans to longer kicks.
const SB_PERIOD = 1180;
const SB_X = 420;
const SB_W = 104;
function drawScoreboard(ctx, view, pal, cache, key, sh, night) {
  const H = Math.ceil(sh * 0.9 + 52);
  const y = view.groundY + 1 - sh * 0.9 - 50;
  const draw = (c, p) => scoreboardTile(c, SB_W, H, p, night);
  warmLayer(ctx, view, cache, key, SB_W, H, pal, draw); // it may first scroll into view mid-flight
  if (y > view.h || y + H < 0) return;
  tiles(view, 0.35, SB_PERIOD, (x0) => {
    const bx = x0 + SB_X;
    // Keep the busy panel from sitting right behind the uprights: fade it out near the post.
    // (layer() is still called when it is off-screen or faded out, so the renderer knows about
    // the layer and can pre-build it; the cache culls the blit itself.)
    let a = 1;
    if (Number.isFinite(view.postX)) {
      const d = Math.abs(bx + SB_W / 2 - view.postX);
      a = clamp01((d - 70) / 80);
      a = a * a * (3 - 2 * a);
    }
    if (a <= 0.01 && !cache) return;
    const ga = curAlpha(ctx);
    ctx.globalAlpha = ga * a;
    layer(ctx, cache, key, SB_W, H, bx, y, pal, draw);
    ctx.globalAlpha = ga;
  });
}

// ---------------------------------------------------------------- day
function decorDay(ctx, view, pal, time, cache) {
  // Sun: left of centre, below the HUD band, with bloom and slow light shafts.
  const sx = view.w * 0.16;
  const sy = view.h * 0.27 + view.camY * view.k * 0.08;
  if (view.lo) glow(ctx, sx, sy, 90, '#FFF6D0', 0.55);
  else {
    glow(ctx, sx, sy, 170, '#FFF6D0', 0.55);
    rays(ctx, sx, sy, Math.max(view.w, view.h) * 0.8, 9, time, '#FFFBE8', 0.14);
  }
  drawClouds(ctx, view, pal, time, cache, { count: 6, alpha: 0.96, key: 'pro:dcl' });
  // The sun is emissive: it burns through any cloud drifting across it, with a bloom halo.
  glow(ctx, sx, sy, 62, '#FFF8DC', 0.6);
  circlePath(ctx, sx, sy, 31);
  fillPathR(ctx, sx, sy, 31, SUN_DISC, -6 / 31, -7 / 31, 2 / 31);
  const fog = mixColor(pal.skyBottom, '#FFFFFF', 0.3);
  drawHills(ctx, view, mixColor(pal.ground, pal.skyBottom, 0.8), 0.08, 22, 50, 0.4, mixColor(pal.skyBottom, '#FFFFFF', 0.2));
  drawHills(ctx, view, mixColor(pal.ground, pal.skyBottom, 0.5), 0.18, 34, 28, 1.3, mixColor(pal.ground, pal.skyBottom, 0.7));
  hazeBand(ctx, view, fog, 90, 0.55);
  drawScoreboard(ctx, view, pal, cache, 'pro:dsb', 64, false);
  drawStands(ctx, view, pal, cache, 'pro:dst', 64, 0.35, (p) => ({
    struct: mixColor(p.skyBottom, p.groundDark, 0.55),
    structTop: mixColor(p.skyBottom, '#FFFFFF', 0.15),
    seat: mixColor(p.accent, '#3A4150', 0.55),
    crowdTo: mixColor(p.skyBottom, '#FFFFFF', 0.2),
    crowdMix: 0.35,
    accent: p.accent,
    wall: mixColor(p.skyBottom, '#FFFFFF', 0.45),
    wallShade: withAlpha('#1B2A3A', 0.25),
    shadow: '#1B2A3A',
    shadowA: 0.45,
    lit: 0,
    fog: mixColor(p.skyBottom, '#FFFFFF', 0.25),
    fogA: 0.22,
    board: mixColor(p.accent, '#000000', 0.35),
    boardTop: p.accent,
    boardHi: '#FFE45C',
    boardA: 0.8,
    roof: mixColor(p.skyBottom, '#2A3142', 0.55),
    roofHi: withAlpha('#FFFFFF', 0.75),
  }));
}

// ---------------------------------------------------------------- night
function towerTile(c, W, H, hgt, p) {
  const cx = W / 2;
  const col = '#141B30';
  const edge = mixColor(col, p.skyBottom, 0.5);
  c.lineCap = 'round';
  c.strokeStyle = col;
  c.lineWidth = 1.8;
  c.beginPath();
  c.moveTo(cx - 7, H - 2);
  c.lineTo(cx - 2.5, 30);
  c.moveTo(cx + 7, H - 2);
  c.lineTo(cx + 2.5, 30);
  c.stroke();
  // lattice braces
  c.lineWidth = 0.9;
  c.beginPath();
  let left = true;
  for (let y = H - 4; y > 34; y -= 13) {
    const u = (H - y) / (H - 30);
    const hw = 7 - 4.5 * u;
    const y2 = y - 13;
    const u2 = (H - y2) / (H - 30);
    const hw2 = 7 - 4.5 * u2;
    if (left) { c.moveTo(cx - hw, y); c.lineTo(cx + hw2, y2); } else { c.moveTo(cx + hw, y); c.lineTo(cx - hw2, y2); }
    left = !left;
  }
  c.stroke();
  c.strokeStyle = withAlpha(edge, 0.8);
  c.lineWidth = 0.8;
  c.beginPath();
  c.moveTo(cx + 7.8, H - 2);
  c.lineTo(cx + 3.2, 30);
  c.stroke();
  // lamp head
  roundRectPath(c, cx - 22, 8, 44, 24, 3);
  c.fillStyle = col;
  c.fill();
  c.fillStyle = edge;
  c.fillRect(cx - 22, 8, 44, 1.5);
  c.fillStyle = '#0A0F1E';
  c.beginPath();
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const x = cx - 15 + i * 10;
      const y = 14 + j * 10;
      c.moveTo(x + 4.4, y);
      c.arc(x, y, 4.4, 0, TAU);
    }
  }
  c.fill();
}

function decorNight(ctx, view, pal, time, cache) {
  drawStars(ctx, view, 60, time);
  // Moon sits right of the logo / score and below the coin pill.
  const mx = view.w * 0.86;
  const my = view.h * 0.2 + view.camY * view.k * 0.05;
  glow(ctx, mx, my, view.lo ? 70 : 110, '#DDE6FF', 0.35);
  ctx.save();
  circlePath(ctx, mx, my, 24);
  ctx.clip();
  circlePath(ctx, mx, my, 25);
  fillPathR(ctx, mx, my, 26, MOON_DISC, -8 / 26, -6 / 26, 2 / 26);
  ctx.fillStyle = 'rgba(160,140,100,0.22)';
  ctx.beginPath();
  ctx.arc(mx - 12, my + 6, 4, 0, TAU);
  ctx.moveTo(mx - 4 + 2.5, my + 14);
  ctx.arc(mx - 4, my + 14, 2.5, 0, TAU);
  ctx.moveTo(mx - 15 + 2, my - 6);
  ctx.arc(mx - 15, my - 6, 2, 0, TAU);
  ctx.fill();
  // terminator: the dark limb is sky-tinted, not a hard cut-out
  ctx.beginPath();
  ctx.rect(mx - 26, my - 32, 64, 60);
  fillPathR(ctx, mx + 12, my - 7, 24, memo('moonT', pal.skyTop, 0, 0, () => [0, withAlpha(pal.skyTop, 0.97), 0.8, withAlpha(pal.skyTop, 0.9), 1, withAlpha(pal.skyTop, 0)]), 0, 0, 14 / 24);
  ctx.restore();

  const par = 0.3;
  const tile = 380;
  // Shorter than the old sideline view's towers: the far wall (the decor's ground) sits higher on
  // screen, so this keeps the lamp heads below the HUD band (score, clock, distance pill). The
  // height depends on the view size only, so the cached tower tile keeps one size while the
  // camera moves (a size change would mean a new layer build, possibly mid-flight).
  const base = view.groundY - 30;
  const hgt = Math.round(clamp(view.h * 0.22, 90, 330));
  const TW = 60;
  const TH = Math.ceil(hgt + 40);
  const heads = [];
  const seeds = [];
  tiles(view, par, tile, (x0, idx) => {
    const tx = x0 + 90;
    if (tx < -200 || tx > view.w + 200) return;
    heads.push(tx);
    seeds.push(idx);
    layer(ctx, cache, 'pro:ntw', TW, TH, tx - TW / 2, base - hgt - 30, pal, (c, p) => towerTile(c, TW, TH, hgt, p));
  }, 200);
  const glowCol = '#FFF4C2';
  // volumetric floodlight beams + dust motes (additive)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  heads.forEach((tx, hi) => {
    const seed = seeds[hi] * 7.31;
    const ty = base - hgt - 10;
    const bottom = view.groundY + 4;
    if (bottom <= ty) return;
    ctx.beginPath();
    ctx.moveTo(tx - 21, ty);
    ctx.lineTo(tx + 21, ty);
    ctx.lineTo(tx + 175, bottom);
    ctx.lineTo(tx - 175, bottom);
    ctx.closePath();
    ctx.moveTo(tx - 12, ty);
    ctx.lineTo(tx + 12, ty);
    ctx.lineTo(tx + 85, bottom);
    ctx.lineTo(tx - 85, bottom);
    ctx.closePath();
    fillPathV(ctx, ty, bottom, memo('beam', glowCol, 0, 0, () => [0, withAlpha(glowCol, 0.16), 1, withAlpha(glowCol, 0.025)]));
    if (view.lo) return;
    ctx.fillStyle = '#FFFBEA';
    const motes = [];
    for (let i = 0; i < 18; i++) {
      const u = wrap(hash(i * 3.3 + seed) + time * (0.02 + 0.02 * hash(i + seed)), 1);
      const v = hash(i * 7.1 + seed) * 2 - 1;
      const x = tx + v * (18 + 150 * u) + Math.sin(time * 0.8 + i) * 4;
      const y = ty + u * (bottom - ty);
      const s = 0.8 + hash(i * 5.7) * 1.2;
      motes.push(x, y, s, (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(time * 3 + i * 2.1))) * (1 - u * 0.6));
    }
    dotBuckets(ctx, motes, 3);
  });
  ctx.restore();
  // lamp heads: hot lamps with bloom and a horizontal lens streak
  for (const tx of heads) {
    const hy = base - hgt - 10;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, tx, hy, view.lo ? 40 : 64, glowCol, 0.42 + 0.04 * Math.sin(time * 2 + tx));
    if (!view.lo) {
      ctx.beginPath();
      ctx.rect(tx - 80, hy - 1, 160, 2);
      fillPathH(ctx, tx - 80, tx + 80, memo('streak', glowCol, 0, 0, () => [0, withAlpha(glowCol, 0), 0.5, withAlpha(glowCol, 0.5), 1, withAlpha(glowCol, 0)]));
    }
    ctx.restore();
    ctx.fillStyle = '#FFFDF2';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const x = tx - 15 + i * 10;
        const y = base - hgt - 16 + j * 10;
        ctx.moveTo(x + 3.4, y);
        ctx.arc(x, y, 3.4, 0, TAU);
      }
    }
    ctx.fill();
  }
  hazeBand(ctx, view, mixColor(pal.skyBottom, glowCol, 0.35), 80, 0.45);
  drawScoreboard(ctx, view, pal, cache, 'pro:nsb', 72, true);
  drawStands(ctx, view, pal, cache, 'pro:nst', 72, 0.35, (p) => ({
    struct: mixColor(p.skyTop, '#000000', 0.45),
    structTop: mixColor(p.skyTop, '#000000', 0.2),
    seat: mixColor(p.skyTop, '#000000', 0.35),
    crowdTo: mixColor(p.skyTop, '#000000', 0.3),
    crowdMix: 0.5,
    accent: p.accent,
    wall: mixColor(p.skyTop, '#FFFFFF', 0.12),
    wallShade: 'rgba(0,0,0,0.35)',
    shadow: '#000000',
    shadowA: 0.5,
    lit: 0.22,
    litColor: '#FFF4C2',
    fog: p.skyBottom,
    fogA: 0.12,
    board: mixColor(p.accent, '#000000', 0.5),
    boardTop: mixColor(p.accent, '#FFFFFF', 0.1),
    boardHi: '#FFFFFF',
    boardA: 0.9,
    roof: mixColor(p.skyTop, '#000000', 0.55),
    roofHi: withAlpha(glowCol, 0.6),
  }));
  // camera flashes popping in the crowd
  const sh = 72;
  const standOff = view.camX * view.k * 0.35;
  for (let i = 0; i < 30; i++) {
    const ph = wrap(time * (0.25 + 0.35 * hash(i * 2.9)) + hash(i * 6.1), 1);
    if (ph > 0.06) continue;
    const a = 1 - ph / 0.06;
    const x = wrap(hash(i * 3.7) * 1260 - standOff, 1260) - 60;
    if (x < -10 || x > view.w + 10) continue;
    const y = view.groundY - sh * 0.16 - hash(i * 9.1) * sh * 0.55;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, x, y, 9, '#FFFFFF', 0.8 * a);
    ctx.restore();
    ctx.fillStyle = withAlpha('#FFFFFF', a);
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
}

// ---------------------------------------------------------------- snow
function pineShape(c, x, y, s, lit, dark, snow, snowShade) {
  c.fillStyle = mixColor(dark, '#000000', 0.3);
  c.fillRect(x - s * 0.06, y - s * 0.25, s * 0.12, s * 0.27);
  for (let i = 0; i < 3; i++) {
    const w = s * (1 - i * 0.22);
    const yb = y - s * i * 0.55;
    const top = y - s * (0.7 + i * 0.55) - s * 0.3;
    c.fillStyle = lit;
    c.beginPath();
    c.moveTo(x - w * 0.6, yb);
    c.lineTo(x, yb + s * 0.06);
    c.lineTo(x, top);
    c.closePath();
    c.fill();
    c.fillStyle = dark;
    c.beginPath();
    c.moveTo(x, yb + s * 0.06);
    c.lineTo(x + w * 0.6, yb);
    c.lineTo(x, top);
    c.closePath();
    c.fill();
    // snow load: bright on the lit side, blue in shade
    const st = y - s * (0.7 + i * 0.55) + s * 0.12;
    c.fillStyle = snow;
    c.beginPath();
    c.moveTo(x - w * 0.24, st);
    c.lineTo(x, st + s * 0.05);
    c.lineTo(x, top);
    c.closePath();
    c.fill();
    c.fillStyle = snowShade;
    c.beginPath();
    c.moveTo(x, st + s * 0.05);
    c.lineTo(x + w * 0.24, st);
    c.lineTo(x, top);
    c.closePath();
    c.fill();
    c.fillStyle = withAlpha(snow, 0.85);
    c.fillRect(x - w * 0.55, yb - s * 0.05, w * 0.5, s * 0.05);
  }
}

function pineTile(c, W, H, p, far) {
  const fog = mixColor(p.skyBottom, '#FFFFFF', 0.2);
  const hz = far ? 0.55 : 0.08;
  const lit = mixColor('#3E8A64', fog, hz);
  const dark = mixColor('#1F4F3A', fog, hz);
  const snow = mixColor('#FFFFFF', fog, hz * 0.5);
  const snowShade = mixColor('#B9D3EC', fog, hz);
  const n = far ? 8 : 4;
  for (let rep = -1; rep <= 1; rep++) {
    for (let i = 0; i < n; i++) {
      const s = far ? 11 + hash(i * 5.3 + 7) * 7 : 22 + hash(i * 3 + 1) * 16;
      const x = rep * W + (far ? 12 + i * (W / n) + hash(i * 2.2) * 14 : 30 + i * 70 + hash(i) * 20);
      if (x < -s || x > W + s) continue;
      pineShape(c, x, H - 2, s, lit, dark, snow, snowShade);
    }
  }
}

const PEAKS = [[0, 40], [70, 92], [140, 58], [230, 118], [300, 64], [380, 100], [450, 50], [540, 110], [600, 62], [640, 40]];
function mountainTile(c, W, H, p) {
  const fog = mixColor(p.skyBottom, '#FFFFFF', 0.25);
  const body = mixColor(mixColor(p.skyTop, '#5C7894', 0.5), fog, 0.45);
  const g = c.createLinearGradient(0, H - 120, 0, H);
  g.addColorStop(0, body);
  g.addColorStop(1, mixColor(body, fog, 0.6));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(0, H);
  for (const [x, h] of PEAKS) c.lineTo(x, H - h);
  c.lineTo(W, H);
  c.closePath();
  c.fill();
  // shaded faces (light from the upper left)
  c.fillStyle = withAlpha(mixColor(body, '#1E3350', 0.5), 0.35);
  c.beginPath();
  for (let i = 1; i < PEAKS.length - 1; i++) {
    const [px, ph] = PEAKS[i];
    if (ph < PEAKS[i - 1][1] || ph < PEAKS[i + 1][1]) continue;
    const [nx, nh] = PEAKS[i + 1];
    c.moveTo(px, H - ph);
    c.lineTo(nx, H - nh);
    c.lineTo(px + (nx - px) * 0.25, H);
    c.closePath();
  }
  c.fill();
  // snow caps
  c.fillStyle = withAlpha(mixColor('#FFFFFF', fog, 0.3), 0.92);
  c.beginPath();
  for (let i = 1; i < PEAKS.length - 1; i++) {
    const [px, ph] = PEAKS[i];
    if (ph < PEAKS[i - 1][1] || ph < PEAKS[i + 1][1]) continue;
    const [lx, lh] = PEAKS[i - 1];
    const [rx, rh] = PEAKS[i + 1];
    const f = 0.34;
    const ax = px + (lx - px) * f;
    const ay = H - (ph + (lh - ph) * f);
    const bx = px + (rx - px) * f;
    const by = H - (ph + (rh - ph) * f);
    c.moveTo(px, H - ph);
    c.lineTo(ax, ay);
    c.lineTo(ax + (px - ax) * 0.3, ay + 6);
    c.lineTo(px - 2, ay - 2);
    c.lineTo(px + (bx - px) * 0.45, by + 5);
    c.lineTo(bx, by);
    c.closePath();
  }
  c.fill();
  c.save();
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = withAlpha(fog, 0.25);
  c.fillRect(0, 0, W, H);
  c.restore();
}

function decorSnow(ctx, view, pal, time, cache) {
  // Diffuse winter sun behind thin cloud.
  const sx = view.w * 0.78;
  const sy = view.h * 0.31 + view.camY * view.k * 0.06;
  glow(ctx, sx, sy, view.lo ? 80 : 150, '#FFFFFF', 0.5);
  if (!view.lo) rays(ctx, sx, sy, Math.max(view.w, view.h) * 0.7, 7, time, '#FFFFFF', 0.12);
  glow(ctx, sx, sy, 26, '#FFFFFF', 0.9);
  drawClouds(ctx, view, pal, time, cache, { count: 4, alpha: 0.8, key: 'pro:scl', shade: mixColor(pal.skyTop, '#FFFFFF', 0.45) });
  const MW = 640;
  const MH = 130;
  const my = view.groundY - MH - 20;
  if (my < view.h && my + MH > 0) {
    tiles(view, 0.06, MW, (x0) => layer(ctx, cache, 'pro:smt', MW, MH, x0, my, pal, (c, p) => mountainTile(c, MW, MH, p)));
  }
  hazeBand(ctx, view, mixColor(pal.skyBottom, '#FFFFFF', 0.5), 70, 0.5);
  drawHills(ctx, view, mixColor(pal.ground, pal.skyBottom, 0.35), 0.15, 40, 30, 2.1, mixColor(pal.ground, '#FFFFFF', 0.4));
  const FH = 40;
  tiles(view, 0.25, 240, (x0) => layer(ctx, cache, 'pro:spf', 240, FH, x0, view.groundY - 14 - FH, pal, (c, p) => pineTile(c, 240, FH, p, true)));
  hazeBand(ctx, view, mixColor(pal.skyBottom, '#FFFFFF', 0.4), 36, 0.35);
  const PH = 86;
  tiles(view, 0.35, 300, (x0) => layer(ctx, cache, 'pro:spn', 300, PH, x0, view.groundY + 4 - PH, pal, (c, p) => pineTile(c, 300, PH, p, false)));
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

/** Near-camera snowflakes (drawn in front of the field): big, soft, fast. */
function frontSnow(ctx, view, pal, time) {
  const off = view.camX * view.k * 0.9;
  for (let i = 0; i < 12; i++) {
    const sp = 70 + hash(i * 3.9) * 60;
    const x = wrap(hash(i * 2.2) * view.w + Math.sin(time * 0.7 + i) * 22 - off, view.w + 40) - 20;
    const y = wrap(hash(i * 5.5) * view.h + time * sp, view.h + 40) - 20;
    const r = 2.6 + hash(i * 8.8) * 3;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    circlePath(ctx, x, y, r * 1.9);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    circlePath(ctx, x, y, r);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- beach sunset
function palmShape(c, x, y, s, col, rim) {
  const tx = x + s * 0.15;
  const ty = y - s * 1.7;
  c.strokeStyle = col;
  c.lineCap = 'round';
  c.lineWidth = s * 0.14;
  c.beginPath();
  c.moveTo(x, y);
  c.quadraticCurveTo(x + s * 0.35, y - s * 0.9, tx, ty);
  c.stroke();
  // trunk rings + sun-side rim
  c.strokeStyle = withAlpha(rim, 0.55);
  c.lineWidth = Math.max(0.8, s * 0.025);
  c.beginPath();
  c.moveTo(x + s * 0.07, y - 2);
  c.quadraticCurveTo(x + s * 0.42, y - s * 0.9, tx + s * 0.07, ty);
  c.stroke();
  c.strokeStyle = withAlpha('#000000', 0.25);
  c.lineWidth = Math.max(0.6, s * 0.02);
  c.beginPath();
  for (let i = 1; i < 9; i++) {
    const u = i / 9;
    const bx = (1 - u) * (1 - u) * x + 2 * (1 - u) * u * (x + s * 0.35) + u * u * tx;
    const by = (1 - u) * (1 - u) * y + 2 * (1 - u) * u * (y - s * 0.9) + u * u * ty;
    c.moveTo(bx - s * 0.07, by);
    c.lineTo(bx + s * 0.07, by - s * 0.02);
  }
  c.stroke();
  c.fillStyle = col;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i - 2.5) * 0.62;
    c.beginPath();
    c.moveTo(tx, ty);
    c.quadraticCurveTo(tx + Math.cos(a) * s * 0.7, ty + Math.sin(a) * s * 0.7 - s * 0.15, tx + Math.cos(a) * s * 1.05, ty + Math.sin(a) * s * 1.05 + s * 0.35);
    c.quadraticCurveTo(tx + Math.cos(a) * s * 0.5, ty + Math.sin(a) * s * 0.5 + s * 0.05, tx, ty);
    c.fill();
  }
  // lit frond ridges
  c.strokeStyle = withAlpha(rim, 0.6);
  c.lineWidth = Math.max(0.7, s * 0.022);
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i - 2.5) * 0.62;
    c.moveTo(tx, ty);
    c.quadraticCurveTo(tx + Math.cos(a) * s * 0.66, ty + Math.sin(a) * s * 0.66 - s * 0.16, tx + Math.cos(a) * s * 0.98, ty + Math.sin(a) * s * 0.98 + s * 0.3);
  }
  c.stroke();
  c.fillStyle = mixColor(col, '#000000', 0.3);
  c.beginPath();
  c.arc(tx - s * 0.04, ty + s * 0.05, s * 0.06, 0, TAU);
  c.arc(tx + s * 0.06, ty + s * 0.07, s * 0.055, 0, TAU);
  c.fill();
}

function palmTile(c, W, H, p) {
  const col = mixColor(p.skyTop, '#1A0A1F', 0.62);
  const rim = mixColor(p.accent, '#FFD9A0', 0.6);
  for (let rep = -1; rep <= 1; rep++) {
    palmShape(c, rep * W + 60, H - 2, 58, col, rim);
    palmShape(c, rep * W + 250, H - 2, 44, col, rim);
  }
}

function streakCloud(c, W, H, lit, body) {
  // Long tapered bank lit from below by the low sun; soft edges baked in with a one-off blur.
  const sc = ctxScale(c);
  c.save();
  try { c.filter = `blur(${(1.3 * sc).toFixed(2)}px)`; } catch (_) { /* unsupported */ }
  c.beginPath();
  const n = 8;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const taper = Math.pow(Math.sin(Math.PI * (0.06 + u * 0.88)), 0.8);
    const cx = W * (0.1 + 0.8 * u);
    const rx = W * 0.1 * (0.55 + 0.45 * taper);
    const ry = H * (0.12 + 0.2 * taper) * (0.85 + 0.3 * hash(i * 3.1 + W));
    const cy = H * (0.56 - 0.06 * taper);
    c.moveTo(cx + rx, cy);
    c.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  }
  fillPathV(c, H * 0.2, H * 0.85, [0, withAlpha(body, 0.8), 0.55, withAlpha(mixColor(body, lit, 0.45), 0.9), 1, withAlpha(lit, 0.95)]);
  c.restore();
}

function decorSunset(ctx, view, pal, time, cache) {
  const sunX = view.w * 0.62 - view.camX * view.k * 0.03;
  const sunY = view.groundY - view.h * 0.2;
  const sr = Math.min(view.w * 0.2, 90);
  const sunTop = mixColor('#FFF3B0', pal.accent, 0.15);
  const sunBot = mixColor(pal.accent, '#FFB35C', 0.35);
  glow(ctx, sunX, sunY, sr * (view.lo ? 2.2 : 3.4), mixColor(pal.accent, '#FFD08A', 0.6), 0.5);
  if (!view.lo) rays(ctx, sunX, sunY, view.h * 0.8, 11, time, '#FFE9C0', 0.16, Math.PI * 1.1, -Math.PI / 2);
  const gaps = [];
  for (let i = 0; i < 4; i++) gaps.push([sunY + sr * (0.2 + i * 0.2), 3 + i * 1.6]);
  slicedSun(ctx, sunX, sunY, sr, sunTop, sunBot, gaps);
  glow(ctx, sunX, sunY - sr * 0.35, sr * 0.9, '#FFF6D8', 0.14);
  // streaky clouds lit from below
  const vy = view.camY * view.k * 0.1;
  for (let i = 0; i < 3; i++) {
    const W = 150 + i * 40;
    const H = 30;
    const x = wrap(hash(i * 6.1) * (view.w + W) - view.camX * view.k * 0.12 - time * 4, view.w + W) - W;
    const y = view.h * (0.3 + i * 0.07) + vy;
    const draw = (c, p) => streakCloud(c, W, H, mixColor('#FFD08A', p.accent, 0.25), mixColor(p.skyTop, '#6A2A6A', 0.35));
    warmLayer(ctx, view, cache, SSC_KEYS[i], W, H, pal, draw);
    layer(ctx, cache, SSC_KEYS[i], W, H, x, y, pal, draw);
  }
  // birds
  ctx.strokeStyle = withAlpha('#3A1C3A', 0.6);
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
  // sea band sitting on the horizon, with a distant island and the sun's glitter path
  const seaH = 26;
  const top = view.groundY - seaH;
  const ix = wrap(view.w * 0.2 - view.camX * view.k * 0.04, view.w + 200) - 100;
  ctx.fillStyle = mixColor(pal.skyTop, '#3A1A4A', 0.45);
  ctx.beginPath();
  ctx.moveTo(ix - 70, top + 1);
  ctx.quadraticCurveTo(ix - 30, top - 14, ix, top - 12);
  ctx.quadraticCurveTo(ix + 40, top - 9, ix + 90, top + 1);
  ctx.closePath();
  ctx.fill();
  const sea = mixColor(pal.skyTop, '#2E4A8A', 0.6);
  fillRectV(ctx, 0, top, view.w, seaH + 2, memo('sea', sea, pal.skyBottom, 0, () => [0, mixColor(sea, pal.skyBottom, 0.45), 1, mixColor(sea, '#101030', 0.25)]));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let j = 0; j < 7; j++) {
    const y = top + 2 + j * 3.4;
    const wdt = sr * (0.35 + j * 0.13) * (0.75 + 0.25 * Math.sin(time * 2.1 + j * 1.3));
    ctx.fillStyle = withAlpha(mixColor(sunTop, sunBot, j / 7), 0.45 - j * 0.04);
    ctx.fillRect(sunX - wdt / 2 + Math.sin(time * 1.3 + j) * 3, y, wdt, 1.6);
  }
  ctx.restore();
  ctx.fillStyle = withAlpha('#FFFFFF', 0.3);
  for (let i = 0; i < 7; i++) {
    const x = wrap(hash(i * 5.5) * view.w - view.camX * view.k * 0.25, view.w);
    ctx.fillRect(x, top + 6 + (i % 3) * 6, 26 + hash(i) * 30, 1.5);
  }
  hazeBand(ctx, view, mixColor(pal.skyBottom, '#FFE0B0', 0.3), 50, 0.3);
  const PT = 340;
  const PHh = 175;
  tiles(view, 0.45, PT, (x0) => layer(ctx, cache, 'pro:spm', PT, PHh, x0, view.groundY + 4 - PHh, pal, (c, p) => palmTile(c, PT, PHh, p)));
}

/** Warm sand / pollen specks drifting through the low sun (in front of the field). */
function frontSunset(ctx, view, pal, time) {
  const off = view.camX * view.k * 0.7;
  ctx.fillStyle = '#FFE6B0';
  for (let i = 0; i < 16; i++) {
    const x = wrap(hash(i * 4.4) * view.w + Math.sin(time * 0.5 + i) * 30 - off, view.w);
    const y = wrap(hash(i * 2.6) * view.h - time * (8 + 10 * hash(i)), view.h);
    ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(time * 2 + i * 1.3));
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- neon arcade
function skylineTile(c, W, H, p) {
  const body = mixColor(p.skyBottom, '#000000', 0.6);
  const neon = [p.line, p.accent, '#FFE600'];
  let x = 0;
  let i = 0;
  while (x < W) {
    const bw = 18 + Math.floor(hash(i * 3.3) * 26);
    const bh = 26 + hash(i * 7.9) * (H - 34);
    const w = Math.min(bw, W - x);
    c.fillStyle = body;
    c.fillRect(x, H - bh, w - 1, bh);
    if (hash(i * 5.1) > 0.6) c.fillRect(x + w / 2 - 0.5, H - bh - 8, 1, 8);
    // windows
    for (let wy = H - bh + 5; wy < H - 4; wy += 5) {
      for (let wx = x + 3; wx < x + w - 4; wx += 4) {
        const hsh = hash(wx * 1.3 + wy * 7.7);
        if (hsh > 0.28) continue;
        c.fillStyle = withAlpha(neon[Math.floor(hsh * 30) % 3], 0.35 + hsh * 1.8);
        c.fillRect(wx, wy, 1.6, 2);
      }
    }
    c.fillStyle = withAlpha(neon[i % 2], 0.55);
    c.fillRect(x, H - bh, w - 1, 1);
    x += w;
    i++;
  }
  c.save();
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = withAlpha(p.skyBottom, 0.3);
  c.fillRect(0, 0, W, H);
  c.restore();
}

function gridMountainTile(c, W, H, p) {
  const peaks = [[0, 0], [60, 70], [110, 30], [170, 95], [220, 40], [260, 0]];
  const sc = ctxScale(c);
  c.fillStyle = mixColor(p.skyBottom, '#000000', 0.45);
  c.beginPath();
  c.moveTo(0, H);
  for (const [px, ph] of peaks) c.lineTo(px, H - ph);
  c.closePath();
  c.fill();
  // shaded right faces
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath();
  for (let i = 1; i < peaks.length - 1; i += 2) {
    c.moveTo(peaks[i][0], H - peaks[i][1]);
    c.lineTo(peaks[i + 1][0], H - peaks[i + 1][1]);
    c.lineTo(peaks[i][0] + 12, H);
    c.closePath();
  }
  c.fill();
  c.save();
  c.shadowColor = p.line;
  c.shadowBlur = 8 * sc;
  c.strokeStyle = p.line;
  c.lineWidth = 2;
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(0, H);
  for (const [px, ph] of peaks) c.lineTo(px, H - ph);
  c.stroke();
  c.globalAlpha = 0.4;
  c.lineWidth = 1.2;
  c.beginPath();
  for (let i = 1; i < peaks.length - 1; i++) {
    c.moveTo(peaks[i][0], H - peaks[i][1]);
    c.lineTo(peaks[i][0] + 12, H);
  }
  c.stroke();
  c.restore();
}

function decorArcade(ctx, view, pal, time, cache) {
  drawStars(ctx, view, 45, time, '#FFFFFF');
  const sx = view.w * 0.5 - view.camX * view.k * 0.03;
  const sy = view.groundY - view.h * 0.2;
  const sr = Math.min(view.w * 0.22, 100);
  glow(ctx, sx, sy, sr * (view.lo ? 2 : 3), '#FF2BD6', 0.42);
  glow(ctx, sx, sy - sr * 0.4, sr * 1.6, '#FFB000', 0.2);
  const gaps = [];
  for (let i = 0; i < 6; i++) gaps.push([sy + sr * (0.05 + i * 0.16), 2 + i * 1.4]);
  slicedSun(ctx, sx, sy, sr, '#FFE600', '#FF2BD6', gaps);
  const SW = 520;
  const SH = 92;
  tiles(view, 0.12, SW, (x0) => layer(ctx, cache, 'pro:ask', SW, SH, x0, view.groundY + 1 - SH, pal, (c, p) => skylineTile(c, SW, SH, p)));
  const MW = 260;
  const MH = 104;
  tiles(view, 0.3, MW, (x0) => layer(ctx, cache, 'pro:amt', MW, MH, x0, view.groundY + 1 - MH, pal, (c, p) => gridMountainTile(c, MW, MH, p)));
  // horizon glow line
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  fillRectV(ctx, 0, view.groundY - 34, view.w, 36, NEON_HORIZON);
  ctx.restore();
  ctx.fillStyle = withAlpha('#FF2BD6', 0.85);
  ctx.fillRect(0, view.groundY - 2, view.w, 3);
  ctx.fillStyle = 'rgba(255,220,250,0.7)';
  ctx.fillRect(0, view.groundY - 1.5, view.w, 1);
}

/** Decor painters keyed by base theme id. */
export const PRO_DECOR = Object.freeze({
  day: decorDay, night: decorNight, snow: decorSnow, sunset: decorSunset, arcade: decorArcade,
});
/** Near-camera theme particles drawn in front of the scene (drawFront). */
export const PRO_FRONT = Object.freeze({ snow: frontSnow, sunset: frontSunset });
