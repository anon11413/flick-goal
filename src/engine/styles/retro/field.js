// Flick Goal — RETRO style: flat football field in broadcast perspective, for both layouts.
//  * FIELD layout (try/field-posts): turf with mowing stripes, end zones with team paint and
//    words, yard lines / numbers / hashes, pylons, far wall per theme, near team area, and past
//    the end line an apron, photographers and the end-zone stands packed with a crowd.
//  * ENDLESS layout (V2_SPEC §5.8): turf, 5-yard lines and hashes tiled forever from originX,
//    yard numbers counting up forever (10, 20, ... 140, ...), a painted START line, no end zones,
//    no pylons, no net, no stands.
// Pure drawing (ctx + projection from engine/field.js).

import { CONFIG } from '../../../config.js';
import { mixColor, withAlpha, circlePath, roundRectPath, hash } from '../../paint.js';
import {
  quadPath, groundFrame, FIELD_FONT, FIELD_LEN_YD, BORDER, endlessLineXs, endlessNumberAt,
} from '../../field.js';
import { CROWD, SKIN_TONES } from '../../themes.js';

const TAU = Math.PI * 2;

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
 * FIELD layout: the whole 100-yard field whose end line is fv.endX (turf, out-of-bounds, far wall,
 * end zones, lines, hashes, numbers, pylons, behind-end-line apron + photographers + stands,
 * optional kick-spot line). fv = { w, h, k, camX, gy, endX, spot?: {x, alpha, color}, detail? },
 * pr = fieldProjection(fv). Returns pr.
 */
export function drawFieldLayout(ctx, fd, pal, fv, pr, time = 0, cfg = CONFIG) {
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

const SKIN = SKIN_TONES;

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

// ---------------------------------------------------------------- ENDLESS layout
/**
 * ENDLESS field: the same turf, borders, far wall, team area and hashes as the FIELD layout,
 * tiled forever from fv.originX (yard 0). 5-yard stripes + lines, yard numbers every 10 yd
 * counting up without end, a painted START line at originX, optional kick-spot line.
 */
export function drawEndlessLayout(ctx, fd, pal, fv, pr, time = 0, cfg = CONFIG) {
  const U = cfg.field.yard;
  const W = pr.W;
  const O = Number.isFinite(fv.originX) ? fv.originX : 0;
  const st = surfaceStyle(fd.surface, pal);
  const detail = fv.detail ?? 1;
  if (pr.farY > fv.h + 2) return pr; // whole field below the view (camera following a high ball)
  ctx.fillStyle = st.side;
  ctx.fillRect(-2, pr.wallBase - 1, fv.w + 4, fv.h - pr.wallBase + 3);
  drawFarWall(ctx, pr, fv, fd.wall, pal, st, time);
  const xa = pr.xMin;
  const xb = pr.xMax;
  if (!(xb > xa)) return pr;

  // turf + 5-yard mowing stripes anchored at the origin
  quadPath(ctx, pr, xa, xb, -W, W);
  ctx.fillStyle = pal.ground;
  ctx.fill();
  ctx.fillStyle = pal.groundDark;
  const step = 5 * U;
  const s0 = Math.floor((xa - O) / step);
  const s1 = Math.ceil((xb - O) / step);
  for (let j = s0; j <= s1; j++) {
    if (((j % 2) + 2) % 2 === 0) continue;
    const x0 = O + j * step;
    const x1 = x0 + step;
    if (x1 < xa || x0 > xb) continue;
    quadPath(ctx, pr, Math.max(x0, xa), Math.min(x1, xb), -W, W);
    ctx.fill();
  }
  if (detail > 0.3) drawSurfaceFx(ctx, pr, fd, pal, st, xa, xb, U);

  // lines: 5-yard lines (the START line at the origin is goal-line width)
  const glow = fd.surface === 'neon';
  const lineFill = withAlpha(st.line, st.lineA);
  const marks = endlessLineXs(xa - 4, xb + 4, O, cfg);
  if (glow) {
    ctx.fillStyle = withAlpha(st.line, 0.18);
    for (const m of marks) {
      const hw = m.j === 0 ? 1.9 : 1.05;
      quadPath(ctx, pr, m.x - hw * 3, m.x + hw * 3, -W, W);
      ctx.fill();
    }
    ctx.strokeStyle = withAlpha(st.line, 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil((xa - O) / U) * U + O; x <= xb; x += U) {
      const a = pr.pt(x, -W);
      const c = pr.pt(x, W);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(c[0], c[1]);
    }
    for (let z = -W + 40; z < W; z += 40) {
      const a = pr.pt(xa, z);
      const c = pr.pt(xb, z);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(c[0], c[1]);
    }
    ctx.stroke();
  }
  ctx.fillStyle = lineFill;
  for (const m of marks) {
    const hw = m.j === 0 ? 1.9 : 1.05;
    quadPath(ctx, pr, m.x - hw, m.x + hw, -W, W);
    ctx.fill();
  }
  // sideline borders, continuous
  quadPath(ctx, pr, xa, xb, W, W + BORDER);
  ctx.fill();
  quadPath(ctx, pr, xa, xb, -W - BORDER, -W);
  ctx.fill();

  // near-side team area, continuous
  if (detail > 0.3) {
    const zA = -W - BORDER - 10;
    const zB = -W - BORDER - 70;
    quadPath(ctx, pr, xa, xb, zB, zA);
    ctx.fillStyle = withAlpha(pal.zone || pal.accent, glow ? 0.16 : 0.2);
    ctx.fill();
    ctx.fillStyle = withAlpha(glow ? (pal.zone || pal.accent) : '#FFD54F', 0.9);
    for (let x = Math.floor(xa / 12) * 12; x < xb; x += 12) {
      quadPath(ctx, pr, x, x + 7, zA - 3, zA);
      ctx.fill();
    }
    ctx.fillStyle = lineFill;
    quadPath(ctx, pr, xa, xb, zB - 3, zB);
    ctx.fill();
  }

  // hash marks every yard (skipping the 5-yard lines)
  if (detail > 0.3) {
    const hz = cfg.field.hashDepth;
    ctx.fillStyle = withAlpha(st.line, st.lineA * 0.9);
    const y0 = Math.ceil((xa - O) / U);
    const y1 = Math.floor((xb - O) / U);
    for (let yd = y0; yd <= y1 && yd - y0 < 600; yd++) {
      if (yd % 5 === 0) continue;
      const x = O + yd * U;
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

  // yard numbers every 10 yards past the start, counting up forever (no arrows)
  if (detail > 0.3) {
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
    // "START" painted across the near half, just before the start line
    if (O > xa - 40 && O < xb + 40) {
      ctx.save();
      groundFrame(ctx, pr, O - 3.2 * U, -W * 0.45, 'near');
      ctx.rotate(-Math.PI / 2);
      ctx.font = `900 30px ${FIELD_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = withAlpha(glow ? st.line : '#FFFFFF', 0.45);
      ctx.fillText('START', 0, 0);
      ctx.restore();
    }
  }

  // kick-spot line (broadcast-style graphic across the field)
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
  return pr;
}

/**
 * Any-length yard number painted in the current ground frame (units = world units), digits
 * 17 u apart; numbers wider than maxW are squeezed horizontally to fit (1000+ yards).
 */
function paintBigNumber(ctx, n, fill, glow, maxW) {
  const F = 24;
  const str = String(Math.max(0, Math.floor(n)));
  const gap = 17;
  const width = gap * str.length;
  const q = Math.min(1, maxW / Math.max(1, width));
  ctx.font = `900 ${F}px ${FIELD_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (q < 1) ctx.scale(q, 1);
  const x0 = -((str.length - 1) * gap) / 2;
  if (glow) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = withAlpha(glow, 0.5);
    for (let i = 0; i < str.length; i++) ctx.strokeText(str[i], x0 + i * gap, 0);
  }
  ctx.fillStyle = fill;
  for (let i = 0; i < str.length; i++) ctx.fillText(str[i], x0 + i * gap, 0);
}

/** Shared surface palette (line colour, out-of-bounds, zone paint) for other retro modules. */
export { surfaceStyle };
