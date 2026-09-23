// Flick Goal — PRO style: the football field in broadcast perspective, stylized realism, for both
// layouts. Same geometry as the retro field (engine/field.js projection, so gameplay framing is
// identical 1:1), with a pro finish:
//  * turf: mowing stripes, sky sheen on the far turf, aerial-perspective darkening toward the
//    camera, contact shadow under the far wall, stadium light pools (night), and a device-pixel
//    grain pattern anchored to the world (skipped in the low tier);
//  * painted lines / numbers / hashes that pick up the grain (reads as worn chalk);
//  * FIELD: end zones with shaded team paint and camera-readable words, shaded pylons, the far
//    wall per theme (padded wall, LED ribbon board, snow cap, neon strip), the apron past the end
//    line with photographers, and the end-zone stands with a crowd drawn from a pre-rendered
//    sprite atlas (shaded fans, one drawImage each; built once per theme, never mid-flight);
//  * ENDLESS (V2_SPEC §5.8): turf, 5-yard lines, hashes and numbers forever from originX, the
//    START line, no end zones / pylons / net / stands.
// Pure drawing (ctx + frame f). Gradients are cached unit gradients (paint.js); no per-frame
// shadowBlur or filters.

import {
  mixColor, withAlpha, memo, softSpot, fillPathV, fillRectV, fillPathH, circlePath, roundRectPath,
  hash, wrap, cachedSprite, textWidth,
} from '../../paint.js';
import {
  quadPath, quadSub, barPainter, groundFrame, FIELD_FONT, FIELD_LEN_YD, BORDER, endlessLineXs, endlessNumberAt,
} from '../../field.js';
import { CROWD, SKIN_TONES, THEMES } from '../../themes.js';
import { lightOf } from './lights.js';
import { defaultMakeCanvas } from '../../layers.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function surfaceStyle(surface, pal) {
  return memo('pro:surf', surface, pal.ground + pal.groundDark + pal.line, pal.zone || pal.accent, () => {
    switch (surface) {
      case 'snow':
        return {
          line: mixColor(pal.line, '#23476B', 0.3), lineA: 0.88,
          side: mixColor(pal.groundDark, '#8FA9C4', 0.4),
          zone: mixColor(pal.zone || pal.accent, '#FFFFFF', 0.22), pylon: '#FF7A1A',
        };
      case 'sand':
        return {
          line: '#FFFFFF', lineA: 0.9,
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
          line: '#FFFFFF', lineA: 0.9,
          side: mixColor(pal.groundDark, '#0E3A1C', 0.34),
          zone: pal.zone || pal.accent, pylon: '#FF7A1A',
        };
    }
  });
}

const fieldOf = (themeId) => (THEMES[themeId] || THEMES.day).field;

// ---------------------------------------------------------------- turf grain pattern
// A device-pixel tile of tiny blades and specks used as a repeating pattern (one per context).
const GRAIN = new WeakMap();
const GRAIN_MUL = { grass: 0.6, snow: 0.35, sand: 0.45, neon: 0.45 };
function grainFor(ctx, f) {
  const d = f.edpr || 1;
  const g = GRAIN.get(ctx);
  if (g && (g.d === d || f.inFlight)) return g.pat ? g : null;
  if (f.inFlight) return null; // never build mid-flight
  const T = Math.max(64, Math.round(150 * d));
  let cv = null;
  try { cv = f.makeCanvas ? f.makeCanvas(T, T) : null; } catch (_) { cv = null; }
  let rec = { d, pat: null, T };
  if (cv) {
    try {
      const c = cv.getContext('2d');
      let seed = 20240917;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      c.lineCap = 'round';
      const blade = (x, y, len, lean) => {
        for (const ox of [0, -T, T]) {
          for (const oy of [0, -T, T]) {
            const X = x + ox;
            const Y = y + oy;
            if (X < -8 * d || X > T + 8 * d || Y < -8 * d || Y > T + 8 * d) continue;
            c.moveTo(X, Y);
            c.lineTo(X + lean, Y - len);
          }
        }
      };
      const passes = [['rgba(0,0,0,0.13)', 900], ['rgba(255,255,255,0.11)', 700], ['rgba(0,0,0,0.08)', 500], ['rgba(255,255,255,0.07)', 400]];
      passes.forEach(([col, n], pi) => {
        c.strokeStyle = col;
        c.lineWidth = d * (0.55 + pi * 0.12);
        c.beginPath();
        for (let i = 0; i < n; i++) blade(rnd() * T, rnd() * T, (0.9 + rnd() * 2.2) * d, (rnd() - 0.5) * 1.6 * d);
        c.stroke();
      });
      c.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 260; i++) c.fillRect(rnd() * T, rnd() * T, d * 0.9, d * 0.9);
      rec = { d, pat: ctx.createPattern(cv, 'repeat') || null, T };
    } catch (_) { rec = { d, pat: null, T }; }
  }
  GRAIN.set(ctx, rec);
  return rec.pat ? rec : null;
}

/** Grain over the screen band y0..y1 (css px), anchored to the world at the play line. */
function drawGrain(ctx, f, y0, y1, alpha) {
  if (f.lowQ || !(alpha > 0.01) || !(y1 > y0)) return;
  const gr = grainFor(ctx, f);
  if (!gr) return;
  const d = f.edpr || 1;
  let e = 0;
  let fy = 0;
  try {
    const m = ctx.getTransform && ctx.getTransform();
    if (m && Number.isFinite(m.e) && Number.isFinite(m.f)) { e = m.e; fy = m.f; }
  } catch (_) { /* stub */ }
  const Y0 = Math.max(0, y0) * d + fy;
  const Y1 = Math.min(f.h, y1) * d + fy;
  if (!(Y1 > Y0)) return;
  const offX = wrap(-f.camX * f.k * d + e, gr.T);
  const offY = wrap(f.gy * d + fy, gr.T);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(offX, offY);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gr.pat;
  ctx.fillRect(-offX, Y0 - offY, f.w * d + gr.T, Y1 - Y0);
  ctx.restore();
}

// ---------------------------------------------------------------- crowd sprite atlas
// One strip of shaded fans (24 variants) per crowd palette, painted once and drawn with one
// drawImage per fan. Built lazily outside flight; missing -> flat vector fans.
const ATLAS = new Map();
const FAN_W = 10; // cell size in fan units (feet at the bottom centre)
const FAN_H = 17;
const FAN_S = 4; // atlas px per fan unit
const FAN_N = 24;
function crowdAtlas(surface, f) {
  const key = surface;
  let a = ATLAS.get(key);
  if (a !== undefined) return a;
  if (f.inFlight) return null;
  let cv = null;
  try { cv = (f.makeCanvas && f.makeCanvas(FAN_W * FAN_S * FAN_N, FAN_H * FAN_S)) || defaultMakeCanvas(FAN_W * FAN_S * FAN_N, FAN_H * FAN_S); } catch (_) { cv = null; }
  a = null;
  if (cv) {
    try {
      const c = cv.getContext('2d');
      c.scale(FAN_S, FAN_S);
      paintFans(c, surface);
      a = cv;
    } catch (_) { a = null; }
  }
  ATLAS.set(key, a);
  return a;
}

function paintFans(c, surface) {
  const crowd = CROWD[surface] || CROWD.grass;
  const neon = surface === 'neon';
  for (let i = 0; i < FAN_N; i++) {
    c.save();
    c.translate(i * FAN_W + FAN_W / 2, FAN_H);
    const shirt = crowd[(i * 5 + 1) % crowd.length];
    const skin = neon ? '#F4E9FF' : SKIN_TONES[(i * 3 + 2) % SKIN_TONES.length];
    const armsUp = i % 4 === 1;
    const lit = mixColor(shirt, '#FFFFFF', 0.28);
    const dark = mixColor(shirt, '#000000', 0.34);
    // raised arms (cheering) behind the torso
    if (armsUp) {
      c.strokeStyle = dark;
      c.lineCap = 'round';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(-3.2, -8.5);
      c.lineTo(-4.6, -15.2);
      c.moveTo(3.2, -8.5);
      c.lineTo(4.4, -15.4);
      c.stroke();
      c.fillStyle = skin;
      c.beginPath();
      c.arc(-4.6, -15.4, 0.9, 0, TAU);
      c.arc(4.4, -15.6, 0.9, 0, TAU);
      c.fill();
    }
    // torso: rounded shoulders, lit left / shaded right
    roundRectPath(c, -4.2, -9.6, 8.4, 9.6, 2.6);
    c.save();
    c.clip();
    c.fillStyle = neon ? withAlpha(shirt, 0.85) : shirt;
    c.fillRect(-5, -10, 10, 10);
    c.fillStyle = neon ? withAlpha(dark, 0.7) : dark;
    c.fillRect(1.2, -10, 4, 10);
    c.fillStyle = lit;
    c.fillRect(-4.2, -9.6, 1.4, 9.6);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(-5, -2.2, 10, 2.2);
    c.restore();
    // head
    c.fillStyle = skin;
    c.beginPath();
    c.arc(0, -12.1, 2.55, 0, TAU);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.beginPath();
    c.arc(0.9, -12, 2.1, -1.2, 1.9);
    c.fill();
    // hair / caps / beanies
    const hat = i % 3;
    if (surface === 'snow' && hat !== 2) {
      c.fillStyle = i % 2 ? '#FFFFFF' : '#D32F2F';
      c.beginPath();
      c.arc(0, -12.6, 2.7, Math.PI, TAU);
      c.fill();
      c.fillStyle = i % 2 ? '#D32F2F' : '#FFFFFF';
      c.fillRect(-2.7, -12.9, 5.4, 1);
    } else if (hat === 0) {
      c.fillStyle = mixColor(crowd[(i * 7 + 3) % crowd.length], '#000000', 0.15);
      c.beginPath();
      c.arc(0, -12.9, 2.6, Math.PI, TAU);
      c.fill();
      c.fillRect(-3.8, -13.2, 3, 0.9);
    } else if (hat === 1) {
      c.fillStyle = ['#2B1B10', '#4A2F1B', '#1B1B1B', '#C9A15B'][i % 4];
      c.beginPath();
      c.arc(0, -12.7, 2.6, Math.PI * 1.05, Math.PI * 1.95);
      c.fill();
    }
    if (neon) {
      c.fillStyle = withAlpha(shirt, 0.35);
      c.fillRect(-4.6, -10, 9.2, 0.8);
    }
    c.restore();
  }
}

// ---------------------------------------------------------------- far wall, end zone, pylons
function drawFarWall(ctx, pr, f, kind, pal, L) {
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
  const sxOf = (x) => pr.vpx + ((x - f.camX) * pr.k - pr.vpx) * sW;
  const W = f.w;
  if (kind === 'neon') {
    ctx.fillStyle = mixColor(pal.ground, '#000000', 0.6);
    ctx.fillRect(0, top, W, hgt + 1);
    ctx.fillStyle = withAlpha(zone, 0.95);
    ctx.fillRect(0, top, W, Math.max(1, hgt * 0.14));
    if (!f.lowQ) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      fillRectV(ctx, 0, top - hgt * 0.8, W, hgt * 0.8, memo('pro:nwg', zone, 0, 0, () => [0, withAlpha(zone, 0), 1, withAlpha(zone, 0.28)]));
      ctx.restore();
    }
    ctx.fillStyle = withAlpha(pal.line, 0.6);
    for (let x = x0; x < pr.xMax; x += panelEvery) {
      const a = sxOf(x);
      const b = sxOf(x + panelW);
      ctx.fillRect(a, top + hgt * 0.45, b - a, Math.max(1, hgt * 0.16));
    }
    return;
  }
  if (kind === 'board') {
    fillRectV(ctx, 0, top, W, hgt + 1, BOARD_BODY);
    const ry = top + hgt * 0.2;
    const rh = Math.max(1.5, hgt * 0.5);
    const acc = pal.accent;
    fillRectV(ctx, 0, ry, W, rh, memo('pro:led', acc, 0, 0, () => [0, mixColor(acc, '#FFFFFF', 0.25), 0.5, mixColor(acc, '#141A2E', 0.2), 1, mixColor(acc, '#141A2E', 0.5)]));
    ctx.fillStyle = withAlpha('#FFFFFF', 0.6);
    for (let x = x0; x < pr.xMax; x += panelEvery) {
      const a = sxOf(x + ((f.time * 30) % panelEvery));
      ctx.fillRect(a, ry + rh * 0.35, Math.max(2, 34 * pr.k * sW), Math.max(1, rh * 0.3));
    }
    if (!f.lowQ) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      fillRectV(ctx, 0, ry - hgt, W, hgt, memo('pro:ledg', acc, 0, 0, () => [0, withAlpha(acc, 0), 1, withAlpha(acc, 0.22)]));
      ctx.restore();
    }
    ctx.fillStyle = withAlpha('#FFFFFF', 0.18);
    ctx.fillRect(0, top, W, Math.max(1, hgt * 0.08));
    return;
  }
  // padded wall in the team colour: vertical cushion shading + sponsor panels + lit cap
  fillRectV(ctx, 0, top, W, hgt + 1, memo('pro:pad', zone, 0, 0, () => [
    0, mixColor(zone, '#FFFFFF', 0.18), 0.35, mixColor(zone, '#000000', 0.12), 1, mixColor(zone, '#000000', 0.42),
  ]));
  ctx.fillStyle = withAlpha('#FFFFFF', 0.2);
  for (let x = x0; x < pr.xMax; x += panelEvery) {
    const a = sxOf(x);
    const b = sxOf(x + panelW);
    ctx.fillRect(a, top + hgt * 0.3, b - a, Math.max(1, hgt * 0.4));
  }
  ctx.fillStyle = withAlpha('#000000', 0.2);
  for (let x = x0; x < pr.xMax; x += panelEvery) {
    const a = sxOf(x + panelEvery - 1);
    ctx.fillRect(a, top, Math.max(0.6, 1.2 * sW), hgt);
  }
  ctx.fillStyle = withAlpha(L.key, 0.45);
  ctx.fillRect(0, top, W, Math.max(1, hgt * 0.12));
  if (kind === 'snow') {
    // snow cap: bright crest, blue-shaded underside, a few drips
    const capH = Math.max(1.5, hgt * 0.42);
    fillRectV(ctx, 0, top - hgt * 0.22, W, capH, SNOW_CAP);
    ctx.fillStyle = '#FFFFFF';
    for (let x = x0; x < pr.xMax; x += 37) {
      const a = sxOf(x + hash(x * 0.37) * 20);
      const r = Math.max(0.8, (2 + hash(x) * 3) * pr.k * sW);
      circlePath(ctx, a, top + hgt * 0.16, r);
      ctx.fill();
    }
  }
}
const BOARD_BODY = [0, '#1B2340', 1, '#0C1020'];
const SNOW_CAP = [0, '#FFFFFF', 0.55, '#F4FAFF', 1, '#B9D3EC'];

/** Painted end zone at x in [xa, xb], team paint with shading + stripes + words. */
function drawEndZone(ctx, pr, xa, xb, st, words, f, detail = 1) {
  const W = pr.W;
  quadPath(ctx, pr, xa, xb, -W, W);
  ctx.fillStyle = st.zone;
  ctx.fill();
  ctx.save();
  quadPath(ctx, pr, xa, xb, -W, W);
  ctx.clip();
  // paint picks up the light: lighter toward the far sideline, deeper near the camera
  const yF = pr.pt(xa, W)[1];
  const yN = pr.pt(xa, -W)[1];
  quadPath(ctx, pr, xa, xb, -W, W);
  fillPathV(ctx, yF, yN, ZONE_SHADE);
  ctx.fillStyle = withAlpha('#000000', 0.08);
  const step = 26;
  ctx.beginPath();
  for (let z = -W - (xb - xa); z < W + (xb - xa); z += step * 2) {
    const a = pr.pt(xa, z);
    const b = pr.pt(xa, z + step);
    const c = pr.pt(xb, z + step + (xb - xa));
    const d = pr.pt(xb, z + (xb - xa));
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
  }
  ctx.fill();
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
    const m = { width: textWidth(ctx, word) };
    const tw = (m && m.width) || F * 0.62 * word.length;
    const q = Math.min(1, span / Math.max(1, tw));
    ctx.scale(q, 1);
    const lo = f && f.lowQ; // low tier: one text pass fewer per word
    if (st.zoneGlow) {
      if (!lo) {
        ctx.lineWidth = 5;
        ctx.strokeStyle = withAlpha(st.zoneGlow, 0.35);
        ctx.strokeText(word, 0, F * 0.04);
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = withAlpha(st.zoneGlow, 0.95);
      ctx.strokeText(word, 0, F * 0.04);
      ctx.fillStyle = withAlpha('#FFFFFF', 0.88);
    } else {
      // painted letters: dark bleed edge, white paint, sun-side sheen
      if (!lo) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = withAlpha(mixColor(st.zone, '#000000', 0.5), 0.35);
        ctx.strokeText(word, 0, F * 0.08);
      }
      ctx.fillStyle = withAlpha('#FFFFFF', 0.93);
    }
    ctx.fillText(word, 0, F * 0.04);
    if (!st.zoneGlow && !lo) {
      ctx.fillStyle = withAlpha(st.zone, 0.12);
      ctx.fillText(word, 0, F * 0.16);
    }
    ctx.restore();
  }
  ctx.restore();
  if (st.zoneGlow) {
    ctx.lineWidth = Math.max(1, 1.6 * pr.k);
    ctx.strokeStyle = withAlpha(st.zoneGlow, 0.85);
    quadPath(ctx, pr, xa + 3, xb - 3, -W + 3, W - 3);
    ctx.stroke();
  }
}
const ZONE_SHADE = [0, 'rgba(255,255,255,0.14)', 0.45, 'rgba(255,255,255,0)', 1, 'rgba(0,0,0,0.16)'];

function pylon(ctx, pr, x, z, color, L) {
  const [px, py] = pr.pt(x, z);
  const sc = pr.s(z) * pr.k;
  const w = Math.max(1.5, 5 * sc);
  const h = Math.max(3, 15 * sc);
  softSpot(ctx, px + w * 0.6, py, w * 1.6, Math.max(1, w * 0.45), L.shadow, L.shadowA * 2.6);
  ctx.beginPath();
  ctx.rect(px - w / 2, py - h, w, h);
  fillPathH(ctx, px - w / 2, px + w / 2, memo('pro:pyl', color, 0, 0, () => [
    0, mixColor(color, '#FFFFFF', 0.45), 0.35, color, 1, mixColor(color, '#000000', 0.35),
  ]));
  ctx.fillStyle = withAlpha('#FFFFFF', 0.55);
  ctx.fillRect(px - w / 2, py - h, w, Math.max(0.6, h * 0.08));
}

// ---------------------------------------------------------------- turf finishing
/** Sky sheen on the far turf, contact shadow under the far wall, darkening toward the camera. */
function turfLight(ctx, pr, f, pal, L) {
  const yFar = pr.pt(pr.xMin, pr.W)[1];
  const yN = f.gy;
  const W = f.w + 4;
  if (L.sheen > 0 && yN > yFar) {
    const sheen = memo('pro:sheen', pal.skyBottom, L.sheen, 0, () => [
      0, withAlpha(pal.skyBottom, L.sheen), 0.55, withAlpha(pal.skyBottom, L.sheen * 0.22), 1, withAlpha(pal.skyBottom, 0),
    ]);
    fillRectV(ctx, -2, yFar, W, (yN - yFar) * 1.1, sheen);
  }
  const lip = memo('pro:lip', L.shadow, L.shadowA, 0, () => [0, withAlpha(L.shadow, 0.34), 1, withAlpha(L.shadow, 0)]);
  fillRectV(ctx, -2, pr.wallBase, W, Math.max(4, 16 * pr.k * pr.s(pr.wallZ)), lip);
  if (!f.lowQ && L.near > 0) {
    const y0 = yN + (f.h - yN) * 0.2;
    if (f.h > y0) {
      fillRectV(ctx, -2, y0, W, f.h - y0 + 2, memo('pro:near', L.shadow, L.near, 0, () => [0, withAlpha(L.shadow, 0), 1, withAlpha(L.shadow, L.near)]));
    }
  }
}

/** Night: floodlight pools on the turf, anchored to the world (one soft spot each). */
function lightPools(ctx, pr, f, L, xa, xb) {
  if (!(L.pool > 0)) return;
  const period = 380;
  for (let x = Math.floor(xa / period) * period + 190; x < xb + period; x += period) {
    const [px, py] = pr.pt(x, 40);
    if (px < -400 || px > f.w + 400) continue;
    softSpot(ctx, px, py, 330 * pr.k, 150 * pr.k, L.key, L.pool, 0.35);
  }
}

// ---------------------------------------------------------------- FIELD layout
export function drawProFieldLayout(ctx, f) {
  const cfg = f.cfg;
  const pr = f.proj;
  const fv = f.fv;
  const fd = fieldOf(f.themeId);
  const pal = f.pal;
  const L = lightOf(f.themeId);
  const U = cfg.field.yard;
  const W = pr.W;
  const E = fv.endX;
  const G = E - cfg.field.endZoneYards * U;
  const Efar = E - (FIELD_LEN_YD + 2 * cfg.field.endZoneYards) * U;
  const Gfar = Efar + cfg.field.endZoneYards * U;
  const st = surfaceStyle(fd.surface, pal);
  const detail = fv.detail ?? 1;
  const xa = Math.max(pr.xMin, Efar);
  const xb = Math.min(pr.xMax, E);

  if (pr.farY > fv.h + 2) {
    if (E + cfg.field.standsOffset < pr.xMax) drawBehindEndLine(ctx, pr, f, fd, pal, st, L, E, detail, true);
    return;
  }
  fillRectV(ctx, -2, pr.wallBase - 1, fv.w + 4, fv.h - pr.wallBase + 3, memo('pro:side', st.side, 0, 0, () => [
    0, mixColor(st.side, '#000000', 0.12), 0.25, st.side, 1, mixColor(st.side, '#000000', 0.08),
  ]));
  drawFarWall(ctx, pr, f, fd.wall, pal, L);
  if (xb <= xa) {
    if (pr.xMin >= E) {
      drawBehindEndLine(ctx, pr, f, fd, pal, st, L, E, detail, false);
      drawGrain(ctx, f, pr.wallBase, f.h, L.grain * 0.5);
      turfLight(ctx, pr, f, pal, L);
      drawBehindEndLine(ctx, pr, f, fd, pal, st, L, E, detail, true);
    }
    return;
  }

  // turf with 5-yard mowing stripes
  quadPath(ctx, pr, xa, xb, -W, W);
  ctx.fillStyle = pal.ground;
  ctx.fill();
  ctx.fillStyle = pal.groundDark;
  const j0 = Math.max(0, Math.floor((G - xb) / (5 * U)));
  const j1 = Math.min(19, Math.ceil((G - xa) / (5 * U)));
  ctx.beginPath();
  for (let j = j0; j <= j1; j++) {
    if (j % 2 === 0) continue;
    const x1 = G - 5 * U * j;
    const x0 = x1 - 5 * U;
    if (x1 < xa || x0 > xb) continue;
    quadSub(ctx, pr, Math.max(x0, xa), Math.min(x1, xb), -W, W);
  }
  ctx.fill();
  if (detail > 0.3) drawSurfaceFx(ctx, pr, fd, pal, st, xa, xb, U, f);

  if (E - 10 * U < pr.xMax && E > pr.xMin) drawEndZone(ctx, pr, G, E, st, fd.words || ['FLICK'], f, detail);
  if (Gfar > pr.xMin && Efar < pr.xMax) drawEndZone(ctx, pr, Efar, Gfar, st, fd.words || ['FLICK'], f, detail);

  const glow = fd.surface === 'neon';
  const lineFill = withAlpha(st.line, st.lineA);
  const lines = [];
  for (let j = 0; j <= 20; j++) {
    const x = G - 5 * U * j;
    if (x < xa - 4 || x > xb + 4) continue;
    lines.push([x, j === 0 || j === 20 ? 1.9 : 1.05]);
  }
  if (glow) neonGrid(ctx, pr, st, lines, xa, xb, U, 0);
  ctx.fillStyle = lineFill;
  let bp = barPainter(ctx, pr);
  for (const [x, hw] of lines) bp.bar(x - hw, x + hw, -W, W, f.lowQ ? 2 : 4);
  for (const ex of [E, Efar]) {
    if (ex < pr.xMin - 10 || ex > pr.xMax + 10) continue;
    const sgn = ex === E ? 1 : -1;
    bp.bar(ex - sgn * 1.2, ex + sgn * BORDER * 0.6, -W - BORDER, W + BORDER, f.lowQ ? 4 : 8);
  }
  bp.done();
  const bx0 = Math.max(pr.xMin, Efar - BORDER * 0.6);
  const bx1 = Math.min(pr.xMax, E + BORDER * 0.6);
  if (bx1 > bx0) {
    quadPath(ctx, pr, bx0, bx1, W, W + BORDER);
    ctx.fill();
    quadPath(ctx, pr, bx0, bx1, -W - BORDER, -W);
    ctx.fill();
  }
  if (detail > 0.3) {
    teamArea(ctx, pr, pal, glow, lineFill, Math.max(pr.xMin, Efar), Math.min(pr.xMax, E + BORDER * 0.6));
    const hz = cfg.field.hashDepth;
    ctx.fillStyle = withAlpha(st.line, st.lineA * 0.9);
    const y0 = Math.max(1, Math.ceil((G - xb) / U));
    const y1 = Math.min(FIELD_LEN_YD - 1, Math.floor((G - xa) / U));
    bp = barPainter(ctx, pr);
    for (let yd = y0; yd <= y1; yd++) {
      if (yd % 5 === 0) continue;
      hashes(bp, G - yd * U, hz, W, f.lowQ);
    }
    bp.done();
    const nz = W - 12 * U;
    for (let n = 10; n <= 90; n += 10) {
      const x = G - n * U;
      if (x < xa - 20 || x > xb + 20) continue;
      const lab = n <= 50 ? n : FIELD_LEN_YD - n;
      const toward = n < 50 ? 1 : n > 50 ? -1 : 0;
      for (const facing of ['near', 'far']) {
        ctx.save();
        groundFrame(ctx, pr, x, facing === 'near' ? -nz : nz, facing);
        paintYardNumber(ctx, lab, facing === 'near' ? toward : -toward, lineFill, glow ? st.line : null);
        ctx.restore();
      }
    }
  }

  // apron texture behind the end line, then the shared turf light + grain over everything painted
  drawBehindEndLine(ctx, pr, f, fd, pal, st, L, E, detail, false);
  lightPools(ctx, pr, f, L, pr.xMin, pr.xMax);
  drawGrain(ctx, f, pr.wallBase, f.h, L.grain * GRAIN_MUL[fd.surface]);
  turfLight(ctx, pr, f, pal, L);

  // past the end line: photographers + end-zone stands with the crowd
  drawBehindEndLine(ctx, pr, f, fd, pal, st, L, E, detail, true);
  kickSpot(ctx, pr, fv, xa, xb);
  for (const x of [G, E, Gfar, Efar]) {
    if (x < pr.xMin || x > pr.xMax) continue;
    pylon(ctx, pr, x, W + 1, st.pylon, L);
  }
  for (const x of [G, E, Gfar, Efar]) {
    if (x < pr.xMin || x > pr.xMax) continue;
    pylon(ctx, pr, x, -W - 1, st.pylon, L);
  }
}

function neonGrid(ctx, pr, st, lines, xa, xb, U, O) {
  const W = pr.W;
  ctx.fillStyle = withAlpha(st.line, 0.16);
  let bp = barPainter(ctx, pr);
  for (const [x, hw] of lines) bp.bar(x - hw * 3.4, x + hw * 3.4, -W, W, 4);
  bp.done();
  // Thin grid: filled geometry, not a stroke. Stroking one path of dozens of translucent lines
  // makes the GPU process build a coverage mask for the whole field every frame (~1.5 ms at 3x).
  // Yard-wise lines are thin painted quads in one path; depth rows are horizontal rects.
  ctx.fillStyle = withAlpha(st.line, 0.13);
  const hw = 0.5 / Math.max(0.2, pr.k);
  bp = barPainter(ctx, pr);
  for (let x = Math.ceil((xa - O) / U) * U + O; x <= xb; x += U) bp.bar(x - hw, x + hw, -W, W, 2);
  bp.done();
  for (let z = -W + 40; z < W; z += 40) {
    const a = pr.pt(xa, z);
    const b = pr.pt(xb, z);
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    if (x1 > x0) ctx.fillRect(x0, a[1] - 0.5, x1 - x0, 1);
  }
}

/** One yard's four hash marks (bar painter, see engine/field.js barPainter). */
function hashes(bp, x, hz, W, low) {
  bp.bar(x - 0.7, x + 0.7, hz, hz + 7);
  bp.bar(x - 0.7, x + 0.7, -hz - 7, -hz);
  if (low) return; // low tier: inbound hashes only (the sideline ticks are tiny at phone size)
  bp.bar(x - 0.7, x + 0.7, W - 9, W - 2);
  bp.bar(x - 0.7, x + 0.7, -W + 2, -W + 9);
}

function teamArea(ctx, pr, pal, glow, lineFill, tx0, tx1) {
  if (!(tx1 > tx0)) return;
  const W = pr.W;
  const zA = -W - BORDER - 10;
  const zB = -W - BORDER - 70;
  quadPath(ctx, pr, tx0, tx1, zB, zA);
  ctx.fillStyle = withAlpha(pal.zone || pal.accent, glow ? 0.16 : 0.2);
  ctx.fill();
  ctx.fillStyle = withAlpha(glow ? (pal.zone || pal.accent) : '#FFD54F', 0.88);
  const bp = barPainter(ctx, pr);
  for (let x = Math.floor(tx0 / 12) * 12; x < tx1; x += 12) bp.bar(x, x + 7, zA - 3, zA);
  bp.done();
  ctx.fillStyle = lineFill;
  quadPath(ctx, pr, tx0, tx1, zB - 3, zB);
  ctx.fill();
}

function kickSpot(ctx, pr, fv, xa, xb) {
  if (!(fv.spot && fv.spot.alpha > 0.01 && fv.spot.x > xa && fv.spot.x < xb)) return;
  const W = pr.W;
  const sx = fv.spot.x;
  const col = fv.spot.color || '#3D8BFF';
  ctx.fillStyle = withAlpha(col, 0.14 * fv.spot.alpha);
  quadPath(ctx, pr, sx - 8, sx + 8, -W, W);
  ctx.fill();
  ctx.fillStyle = withAlpha(col, 0.26 * fv.spot.alpha);
  quadPath(ctx, pr, sx - 4, sx + 4, -W, W);
  ctx.fill();
  ctx.fillStyle = withAlpha(col, 0.9 * fv.spot.alpha);
  quadPath(ctx, pr, sx - 1.4, sx + 1.4, -W, W);
  ctx.fill();
}

// ---------------------------------------------------------------- behind the end line
/**
 * Past the end line: pass 'apron' (front=false) paints the textured apron (before the grain);
 * pass front=true paints photographers and the end-zone stands (padded wall at post.x +
 * standsOffset, seat rows rising away from the field, crowd sprites, facade). Geometry matches
 * game.js backstop() / field.js standsGeometry().
 */
function drawBehindEndLine(ctx, pr, f, fd, pal, st, L, E, detail, front) {
  const F = f.cfg.field;
  const fv = f.fv;
  const ax0 = E + BORDER * 0.6;
  if (ax0 > pr.xMax) return;
  const k = pr.k;
  const W = pr.W;
  const D = pr.D;
  const neon = fd.surface === 'neon';
  const zone = pal.zone || pal.accent;
  const sBot = 1 + (fv.h + 30 - fv.gy) / Math.max(1e-3, pr.Hh);
  const zN = Math.max(-D * 0.72, Math.min(-W, sBot > 0.05 ? D / sBot - D : -W));
  const zF = pr.wallZ;
  const SX = E + F.standsOffset;
  const ax1 = Math.min(pr.xMax, SX);

  if (!front) {
    if (ax1 > ax0) {
      if (neon) {
        ctx.fillStyle = withAlpha(pal.line, 0.1);
        const hw = 0.5 / Math.max(0.2, pr.k);
        const bp = barPainter(ctx, pr);
        for (let x = Math.ceil(ax0 / F.yard) * F.yard; x <= ax1; x += F.yard) bp.bar(x - hw, x + hw, zN, zF, 2);
        bp.done();
      } else {
        ctx.fillStyle = withAlpha('#000000', fd.surface === 'grass' ? 0.07 : 0.045);
        const band = 2 * F.yard;
        ctx.beginPath();
        for (let x = Math.floor(ax0 / band) * band; x < ax1; x += band * 2) {
          const x0 = Math.max(ax0, x);
          const x1 = Math.min(ax1, x + band);
          if (x1 <= x0) continue;
          quadSub(ctx, pr, x0, x1, zN, zF);
        }
        ctx.fill();
        if (detail > 0.3 && (fd.surface === 'snow' || fd.surface === 'sand')) {
          drawSurfaceFx(ctx, pr, fd, pal, st, ax0, ax1, F.yard, f);
        }
      }
      // shadow the stands cast onto the apron (light from the field side)
      if (SX < pr.xMax + 40) {
        quadPath(ctx, pr, SX - 26, SX, zN, zF);
        const a = pr.pt(SX - 26, 0)[0];
        const b = pr.pt(SX, 0)[0];
        if (b > a + 0.5) fillPathH(ctx, a, b, memo('pro:apr', L.shadow, 0, 0, () => [0, withAlpha(L.shadow, 0), 1, withAlpha(L.shadow, 0.28)]));
      }
    }
    return;
  }

  if (detail > 0.3) {
    const spots = [[E + 16, -W - 34, 0], [E + 38, -W - 52, 1], [E + 58, -W - 30, 2], [E + 20, W + 26, 3], [E + 44, W + 34, 4]];
    for (const [x, z, i] of spots) {
      if (x < pr.xMin || x > pr.xMax || z < zN) continue;
      photographer(ctx, pr, x, z, i, f.time, neon ? zone : null, L);
    }
  }

  if (SX > pr.xMax + 20) return;
  const E3 = (x, z, y) => {
    const p = pr.pt(x, z);
    return [p[0], p[1] - y * k * pr.s(z)];
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
  const tread = (x0, x1, h, fill) => {
    const a = E3(x0, zN, h);
    const b = E3(x1, zN, h);
    const c = E3(x1, zF, h);
    const d = E3(x0, zF, h);
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
      : fd.wall === 'board' ? '#1A2138' : mixColor(zone, '#000000', 0.22);
  const seatA = neon ? mixColor(pal.ground, '#000000', 0.35)
    : fd.surface === 'sand' ? '#D2A468' : mixColor(zone, '#FFFFFF', fd.surface === 'snow' ? 0.15 : 0.05);
  const seatB = neon ? mixColor(pal.ground, '#000000', 0.5)
    : fd.surface === 'sand' ? '#BF9056' : mixColor(zone, '#000000', 0.22);
  const riserCol = neon ? mixColor(pal.ground, '#000000', 0.72) : mixColor(seatB, '#000000', 0.42);
  const shadeTo = neon ? '#000000' : L.shadow;
  const crowd = CROWD[fd.surface] || CROWD.grass;
  const atlas = detail > 0.3 ? crowdAtlas(fd.surface, f) : null;
  const ROW = 14;
  const rise = F.standsRise;
  const rows = Math.max(1, Math.round(F.standsDepth / ROW));
  const backX = SX + rows * ROW;
  const topH = wallH + rows * ROW * rise;
  riserFace(backX, 0, topH + F.standsBackH, neon ? mixColor(pal.ground, '#000000', 0.78) : mixColor(riserCol, '#000000', 0.3));
  // padded front wall: cushion shading, lit team cap, contact shadow at its foot
  riserFace(SX, 0, wallH, wallCol);
  riserFace(SX, wallH * 0.55, wallH, withAlpha('#FFFFFF', neon ? 0.04 : 0.1));
  riserFace(SX, wallH * 0.8, wallH, neon ? withAlpha(zone, 0.95) : mixColor(zone, '#FFFFFF', 0.3));
  if (!neon && fd.wall !== 'none') riserFace(SX, wallH * 0.3, wallH * 0.52, withAlpha('#FFFFFF', 0.22));
  riserFace(SX, 0, wallH * 0.12, withAlpha('#000000', 0.25));
  const zStep = detail > 0.3 ? 17 : 34;
  const time = f.time;
  const cw = FAN_W * FAN_S;
  const ch = FAN_H * FAN_S;
  for (let i = 0; i < rows; i++) {
    const x0 = SX + i * ROW;
    const x1 = x0 + ROW;
    const h = wallH + i * ROW * rise;
    const h1 = h + ROW * rise;
    if (E3(x0, zF, h)[0] > fv.w + 10) break;
    if (E3(x0, zN, h)[1] < -20) break;
    if (Math.max(E3(x1, zN, h1)[0], E3(x1, zF, h1)[0]) < -10) continue;
    // upper rows sit deeper in the roof shade
    const shade = Math.round((i / rows) * 8) / 8;
    tread(x0, x1, h, mixColor(i % 2 ? seatB : seatA, shadeTo, 0.06 + shade * 0.3));
    if (neon) {
      const a = E3(x0, zN, h);
      const b = E3(x0, zF, h);
      ctx.strokeStyle = withAlpha(i % 3 === 0 ? zone : pal.line, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    } else if (fd.surface === 'snow') {
      tread(x0, x0 + ROW * 0.22, h, withAlpha('#FFFFFF', 0.85));
    } else {
      tread(x0, x0 + ROW * 0.12, h, withAlpha(L.key, 0.16));
    }
    if (detail > 0.3) {
      const xs = x0 + ROW * 0.55;
      const shadeA = 0.35 * shade;
      for (let z = zF - 8; z > zN; z -= zStep) {
        const seed = i * 131 + Math.round(z) * 7;
        if (hash(seed) < 0.12) continue;
        const zz = z + (hash(seed + 1) - 0.5) * zStep * 0.5;
        const sc = pr.s(zz) * k;
        const bob = hash(seed + 3) < 0.3 ? Math.max(0, Math.sin(time * 5 + hash(seed + 2) * 6.3)) * 1.2 : 0;
        const [px, py] = E3(xs, zz, h + bob);
        const u = 0.72 * sc;
        const fw = FAN_W * u;
        const fh = FAN_H * u;
        if (fw < 1.3) {
          ctx.fillStyle = neon ? withAlpha(crowd[Math.floor(hash(seed + 4) * crowd.length)], 0.8) : crowd[Math.floor(hash(seed + 4) * crowd.length)];
          ctx.fillRect(px - 0.6, py - 1.4, 1.2, 1.4);
          continue;
        }
        if (atlas) {
          const v = Math.floor(hash(seed + 4) * FAN_N);
          ctx.drawImage(atlas, v * cw, 0, cw, ch, px - fw / 2, py - fh, fw, fh);
        } else {
          const col = crowd[Math.floor(hash(seed + 4) * crowd.length)];
          ctx.fillStyle = neon ? withAlpha(col, 0.75) : col;
          ctx.fillRect(px - 3.25 * sc, py - 8 * sc, 6.5 * sc, 8 * sc);
          ctx.fillStyle = neon ? withAlpha('#FFFFFF', 0.85) : SKIN_TONES[Math.floor(hash(seed + 5) * SKIN_TONES.length)];
          const hr = 2.6 * sc;
          ctx.fillRect(px - hr, py - 8 * sc - hr * 1.9, hr * 2, hr * 2);
        }
        const extra = hash(seed + 6);
        if (fd.surface === 'sand' && extra < 0.09) {
          ctx.fillStyle = crowd[Math.floor(hash(seed + 7) * crowd.length)];
          ctx.beginPath();
          ctx.ellipse(px, py - fh * 1.05, 9 * sc, 5 * sc, 0, Math.PI, TAU);
          ctx.fill();
        } else if ((fd.lights || neon) && extra < 0.06) {
          ctx.fillStyle = withAlpha('#FFFFFF', 0.9);
          ctx.fillRect(px + fw * 0.3, py - fh * 1.02, Math.max(1, sc * 1.4), Math.max(1, sc * 2));
        }
      }
      if (shadeA > 0.02) {
        // roof shade over this row's crowd (one translucent riser-shaped quad)
        const a = E3(xs, zN, h);
        const b = E3(xs, zN, h + 13);
        const c = E3(xs, zF, h + 13);
        const d = E3(xs, zF, h);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fillStyle = withAlpha(shadeTo, shadeA);
        ctx.fill();
      }
    }
    riserFace(x1, h, h1, mixColor(riserCol, shadeTo, shade * 0.3));
  }
  const fH = F.standsBackH;
  riserFace(backX, topH, topH + fH, neon ? mixColor(pal.ground, '#000000', 0.6) : mixColor(zone, '#000000', 0.34));
  riserFace(backX, topH + fH * 0.52, topH + fH * 0.78, neon ? withAlpha(zone, 0.95) : withAlpha('#FFFFFF', 0.3));
  riserFace(backX, topH + fH * 0.56, topH + fH * 0.74, neon || fd.lights ? withAlpha(L.key, 0.6) : withAlpha(pal.accent, 0.55));
  riserFace(backX, topH + fH * 0.9, topH + fH, neon ? withAlpha(pal.line, 0.9) : mixColor(zone, '#FFFFFF', 0.3));
}

/** A kneeling sideline photographer with a long lens pointed at the field (-x), shaded. */
function photographer(ctx, pr, x, z, i, time, glow, L) {
  const [px, py] = pr.pt(x, z);
  const sc = pr.s(z) * pr.k;
  if (sc < 0.25) return;
  const vest = glow || ['#FF6D00', '#FFD600', '#FF6D00', '#90CAF9', '#FFD600'][i % 5];
  const skin = SKIN_TONES[i % SKIN_TONES.length];
  softSpot(ctx, px + 2 * sc, py, 12 * sc, 3.2 * sc, L.shadow, L.shadowA * 3);
  // the figure is one cached sprite (13 draws each otherwise); vector fallback without canvases
  const sp = cachedSprite(`pro:photo|${vest}|${skin}`, PHOTO_W * PHOTO_S, PHOTO_H * PHOTO_S, (c) => {
    c.scale(PHOTO_S, PHOTO_S);
    paintPhotographer(c, PHOTO_AX, PHOTO_H, 1, vest, skin);
  });
  if (sp) ctx.drawImage(sp, px - PHOTO_AX * sc, py - PHOTO_H * sc, PHOTO_W * sc, PHOTO_H * sc);
  else paintPhotographer(ctx, px, py, sc, vest, skin);
  const ph = (time * 0.7 + i * 0.37) % 1;
  if (ph < 0.05) softSpot(ctx, px - 13 * sc, py - 12.7 * sc, 9 * sc, 9 * sc, '#FFFFFF', 0.95 * (1 - ph / 0.05));
}
// sprite box in figure units: 14 left of the feet (lens), 7 right, 18 up; 4 px per unit
const PHOTO_AX = 14;
const PHOTO_W = 21;
const PHOTO_H = 18;
const PHOTO_S = 4;
function paintPhotographer(ctx, px, py, sc, vest, skin) {
  roundRectPath(ctx, px - 4 * sc, py - 11 * sc, 9 * sc, 11 * sc, 2.5 * sc);
  fillPathH(ctx, px - 4 * sc, px + 5 * sc, BODY_STOPS);
  ctx.fillStyle = vest;
  ctx.fillRect(px - 3.6 * sc, py - 10.5 * sc, 8 * sc, 5 * sc);
  ctx.fillStyle = withAlpha('#000000', 0.22);
  ctx.fillRect(px + 1.4 * sc, py - 10.5 * sc, 3 * sc, 5 * sc);
  ctx.fillStyle = skin;
  ctx.fillRect(px - 2.8 * sc, py - 16 * sc, 5.6 * sc, 5.4 * sc);
  ctx.fillStyle = withAlpha('#000000', 0.2);
  ctx.fillRect(px + 0.8 * sc, py - 16 * sc, 2 * sc, 5.4 * sc);
  ctx.fillStyle = '#1B1B1B';
  ctx.fillRect(px - 3 * sc, py - 17 * sc, 6.2 * sc, 2 * sc);
  ctx.fillStyle = '#111111';
  ctx.fillRect(px - 5 * sc, py - 14.5 * sc, 4 * sc, 3.6 * sc);
  ctx.beginPath();
  ctx.rect(px - 13 * sc, py - 14 * sc, 8.5 * sc, 2.6 * sc);
  fillPathV(ctx, py - 14 * sc, py - 11.4 * sc, LENS_STOPS);
  ctx.fillStyle = '#222222';
  ctx.fillRect(px - 13.4 * sc, py - 14.2 * sc, 1.2 * sc, 3 * sc);
}
const BODY_STOPS = [0, '#3A4650', 0.5, '#263238', 1, '#151C20'];
const LENS_STOPS = [0, '#FFFFFF', 0.5, '#E3E7EA', 1, '#9AA4AB'];

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
    ctx.lineWidth = 3;
    ctx.strokeStyle = withAlpha(glow, 0.45);
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

/** Any-length yard number (digits 17 u apart), squeezed to maxW. */
function paintBigNumber(ctx, n, fill, glow, maxW) {
  const F = 24;
  const str = String(Math.max(0, Math.floor(n)));
  const gap = 17;
  // squeeze wide numbers; the digits left of the line must also stay clear of the 5-yard line
  const q = Math.min(1, maxW / Math.max(1, gap * str.length), (0.65 * maxW) / Math.max(1, (str.length - 1) * gap));
  ctx.font = `900 ${F}px ${FIELD_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (q < 1) ctx.scale(q, 1);
  // the yard line runs between the last two digits (as on a real field: "1|0", "14|0", "100|0"),
  // never through the middle of a digit
  const x0 = -(str.length - 1) * gap + gap / 2;
  if (glow) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = withAlpha(glow, 0.45);
    for (let i = 0; i < str.length; i++) ctx.strokeText(str[i], x0 + i * gap, 0);
  }
  ctx.fillStyle = fill;
  for (let i = 0; i < str.length; i++) ctx.fillText(str[i], x0 + i * gap, 0);
}

/** Theme character on the turf: snow cover + drifts, beach sand, (stadium light pools elsewhere). */
function drawSurfaceFx(ctx, pr, fd, pal, st, xa, xb, U, f) {
  const W = pr.W;
  if (fd.surface === 'snow') {
    ctx.fillStyle = withAlpha('#FFFFFF', 0.6);
    ctx.beginPath();
    for (let x = Math.floor(xa / 40) * 40; x < xb; x += 40) {
      for (let i = 0; i < 3; i++) {
        const z = -W + hash(x * 0.13 + i * 7.1) * 2 * W;
        const len = 10 + hash(x + i) * 18;
        quadSub(ctx, pr, x, x + len, z, z + 4);
      }
    }
    ctx.fill();
    // drifts piled on both sidelines: blue-shaded body, bright crest
    for (const zSide of [W + 14, -W - 16]) {
      const sc = pr.s(zSide) * pr.k;
      for (let x = Math.floor(xa / 34) * 34; x < xb + 34; x += 34) {
        const [px, py] = pr.pt(x + hash(x * 0.71) * 14, zSide);
        const rx = Math.max(1, (14 + hash(x) * 12) * sc);
        const ry = Math.max(0.6, (4 + hash(x * 3) * 4) * sc);
        ctx.fillStyle = '#C9DCEF';
        ctx.beginPath();
        ctx.ellipse(px + rx * 0.08, py, rx, ry, 0, Math.PI, TAU);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.ellipse(px - rx * 0.06, py - ry * 0.1, rx * 0.9, ry * 0.86, 0, Math.PI, TAU);
        ctx.fill();
      }
    }
  } else if (fd.surface === 'sand') {
    ctx.fillStyle = withAlpha(mixColor(pal.groundDark, '#8A6433', 0.35), 0.35);
    for (let x = Math.floor(xa / U) * U; x < xb; x += U) {
      for (let i = 0; i < 3; i++) {
        const z = -W + hash(x * 0.29 + i * 3.7) * 2 * W;
        const [px, py] = pr.pt(x + hash(x + i * 9.3) * U, z);
        const r = Math.max(0.5, (0.9 + hash(x * 1.3 + i) * 1.3) * pr.k * pr.s(z));
        ctx.fillRect(px - r, py - r * 0.5, r * 2, r);
      }
    }
    // wind ripples: a lit crest with a shaded trough
    ctx.lineWidth = 1.2;
    for (const [col, dz] of [[withAlpha('#8A6433', 0.14), 3], [withAlpha('#FFFFFF', 0.24), 0]]) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let z = -W + 30; z < W; z += 55) {
        const a = pr.pt(xa, z + dz);
        const b = pr.pt(xb, z + 18 + dz);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------- ENDLESS layout
export function drawProEndlessLayout(ctx, f) {
  const cfg = f.cfg;
  const pr = f.proj;
  const fv = f.fv;
  const fd = fieldOf(f.themeId);
  const pal = f.pal;
  const L = lightOf(f.themeId);
  const U = cfg.field.yard;
  const W = pr.W;
  const O = Number.isFinite(fv.originX) ? fv.originX : 0;
  const st = surfaceStyle(fd.surface, pal);
  const detail = fv.detail ?? 1;
  if (pr.farY > fv.h + 2) return;
  fillRectV(ctx, -2, pr.wallBase - 1, fv.w + 4, fv.h - pr.wallBase + 3, memo('pro:side', st.side, 0, 0, () => [
    0, mixColor(st.side, '#000000', 0.12), 0.25, st.side, 1, mixColor(st.side, '#000000', 0.08),
  ]));
  drawFarWall(ctx, pr, f, fd.wall, pal, L);
  const xa = pr.xMin;
  const xb = pr.xMax;
  if (!(xb > xa)) return;

  quadPath(ctx, pr, xa, xb, -W, W);
  ctx.fillStyle = pal.ground;
  ctx.fill();
  ctx.fillStyle = pal.groundDark;
  const step = 5 * U;
  const s0 = Math.floor((xa - O) / step);
  const s1 = Math.ceil((xb - O) / step);
  ctx.beginPath();
  for (let j = s0; j <= s1; j++) {
    if (((j % 2) + 2) % 2 === 0) continue;
    const x0 = O + j * step;
    const x1 = x0 + step;
    if (x1 < xa || x0 > xb) continue;
    quadSub(ctx, pr, Math.max(x0, xa), Math.min(x1, xb), -W, W);
  }
  ctx.fill();
  if (detail > 0.3) drawSurfaceFx(ctx, pr, fd, pal, st, xa, xb, U, f);

  const glow = fd.surface === 'neon';
  const lineFill = withAlpha(st.line, st.lineA);
  const marks = endlessLineXs(xa - 4, xb + 4, O, cfg);
  if (glow) neonGrid(ctx, pr, st, marks.map((m) => [m.x, m.j === 0 ? 1.9 : 1.05]), xa, xb, U, O);
  ctx.fillStyle = lineFill;
  const lbp = barPainter(ctx, pr);
  for (const m of marks) {
    const hw = m.j === 0 ? 1.9 : 1.05;
    lbp.bar(m.x - hw, m.x + hw, -W, W, f.lowQ ? 2 : 4);
  }
  lbp.done();
  quadPath(ctx, pr, xa, xb, W, W + BORDER);
  ctx.fill();
  quadPath(ctx, pr, xa, xb, -W - BORDER, -W);
  ctx.fill();

  if (detail > 0.3) {
    teamArea(ctx, pr, pal, glow, lineFill, xa, xb);
    const hz = cfg.field.hashDepth;
    ctx.fillStyle = withAlpha(st.line, st.lineA * 0.9);
    const y0 = Math.ceil((xa - O) / U);
    const y1 = Math.floor((xb - O) / U);
    const bp = barPainter(ctx, pr);
    for (let yd = y0; yd <= y1 && yd - y0 < 600; yd++) {
      if (yd % 5 === 0) continue;
      hashes(bp, O + yd * U, hz, W, f.lowQ);
    }
    bp.done();
    const nz = W - 12 * U;
    for (const m of marks) {
      if (m.j <= 0 || m.j % 2 !== 0) continue;
      if (m.x < xa - 30 || m.x > xb + 30) continue;
      const n = endlessNumberAt(m.x, O, cfg);
      for (const facing of ['near', 'far']) {
        ctx.save();
        groundFrame(ctx, pr, m.x, facing === 'near' ? -nz : nz, facing);
        paintBigNumber(ctx, n, lineFill, glow ? st.line : null, 7 * U);
        ctx.restore();
      }
    }
    if (O > xa - 40 && O < xb + 40) {
      ctx.save();
      groundFrame(ctx, pr, O - 3.2 * U, -W * 0.45, 'near');
      ctx.rotate(-Math.PI / 2);
      ctx.font = `900 30px ${FIELD_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = withAlpha(glow ? st.line : '#FFFFFF', 0.5);
      ctx.fillText('START', 0, 0);
      ctx.restore();
    }
  }
  lightPools(ctx, pr, f, L, xa, xb);
  drawGrain(ctx, f, pr.wallBase, f.h, L.grain * GRAIN_MUL[fd.surface]);
  turfLight(ctx, pr, f, pal, L);
  kickSpot(ctx, pr, fv, xa, xb);
}

export { surfaceStyle as proSurfaceStyle };
