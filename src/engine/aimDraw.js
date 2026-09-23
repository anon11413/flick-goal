// Flick Goal — screen-space aim cues (pure canvas; no DOM), shared by the in-game renderer and
// the store's Aim Slider card:
//  * the power SLIDER ("rail"): track, green sweet band (from physics), edge brackets, needle;
//  * the launch-angle GUIDE DOTS (try/no-slider): a short row of dots from the ball along the
//    launch angle; dot spacing shows strength vs the shot's ideal power on an S-curve
//    (engine/guide.js): bunched = too weak, evenly spaced = right, stretched = too strong.
// Which cues show is decided per shot by the aim-assist mode (src/aimAssist.js).

import { CONFIG } from '../config.js';
import { withAlpha, roundRectPath } from './paint.js';
import { guideLayout } from './guide.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const BAND = '#6BFFB0';
// v2/hard-perfect: the exact PERFECT strip - a warm white core with a gold outline + glow.
export const PERF_CORE = '#FFF7D1';
export const PERF_EDGE = '#FFB800';
export const PERF_GLOW = '#FFE45C';

/**
 * Rail placement for a ball at screen point `ball` in a w x h css-px view: the rail starts at
 * ball + (offsetX, offsetY) and runs up-right at angleDeg, shifted to stay inside the view.
 * Returns { x0, y0, x1, y1, L, ang, th }.
 */
export function railGeometry(ball, w, h, cfg = CONFIG) {
  const RL = cfg.rail;
  const th = RL.thickness;
  const L = clamp(RL.lengthFrac * w, RL.minLen, RL.maxLen);
  const ang = RL.angleDeg * DEG;
  const ux = Math.cos(ang);
  const uy = -Math.sin(ang);
  let x0 = ball.x + RL.offsetX;
  let y0 = ball.y + RL.offsetY;
  let x1 = x0 + ux * L;
  let y1 = y0 + uy * L;
  const m = RL.edgeMargin + th / 2;
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  let dx = 0;
  let dy = 0;
  if (maxX + m > w) dx = w - m - maxX;
  if (minX + dx - m < 0) dx = m - minX;
  if (maxY + m > h) dy = h - m - maxY;
  if (minY + dy - m < 0) dy = m - minY;
  x0 += dx; y0 += dy; x1 += dx; y1 += dy;
  return { x0, y0, x1, y1, L, ang, th };
}

/**
 * The power slider. shot = solved shot (band, bandAlpha), t = marker position [0, 1],
 * A = alpha. opts = { accent, lockColor, locked, markerPop, time }.
 */
export function drawRailTrack(ctx, geom, shot, t, A, opts = {}, cfg = CONFIG) {
  if (!(A > 0.01) || !shot || !shot.band) return;
  const RL = cfg.rail;
  const { x0, y0, L, ang, th } = geom;
  const band = shot.band;
  const markerPop = opts.markerPop || 0;
  const time = opts.time || 0;
  ctx.save();
  ctx.globalAlpha = A;
  ctx.translate(x0, y0);
  ctx.rotate(-ang);
  // shadow + track
  roundRectPath(ctx, -th / 2, -th / 2 + 5, L + th, th, th / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fill();
  roundRectPath(ctx, -th / 2, -th / 2, L + th, th, th / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  // direction chevrons (low/short -> high/long)
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let x = 22; x < L - 10; x += 30) {
    ctx.moveTo(x - 3, -5);
    ctx.lineTo(x + 2, 0);
    ctx.lineTo(x - 3, 5);
  }
  ctx.stroke();
  // sweet band (computed from physics): its fill fades with difficulty, the edges never do
  const ba = clamp(Number.isFinite(shot.bandAlpha) ? shot.bandAlpha : 1, 0, 1);
  const lo = band.lo * L;
  const hi = band.hi * L;
  if (ba > 0.01) {
    const pulse = 0.85 + 0.15 * Math.sin(time * 6);
    roundRectPath(ctx, lo - 5, -th / 2 - 5, hi - lo + 10, th + 10, (th + 10) / 2);
    ctx.fillStyle = withAlpha(BAND, 0.3 * ba * pulse);
    ctx.fill();
    roundRectPath(ctx, lo, -th / 2 + 4, hi - lo, th - 8, (th - 8) / 2);
    ctx.fillStyle = withAlpha(BAND, ba);
    ctx.fill();
  }
  if (Number.isFinite(band.perfLo) && Number.isFinite(band.perfHi)) drawPerfectStrip(ctx, band, L, th, time);
  // band edge brackets: fixed opacity, poking out above and below the track
  const eh = th / 2 + 6;
  ctx.lineCap = 'round';
  ctx.lineWidth = 6.5;
  ctx.strokeStyle = 'rgba(8,40,28,0.4)';
  ctx.beginPath();
  ctx.moveTo(lo, -eh); ctx.lineTo(lo, eh);
  ctx.moveTo(hi, -eh); ctx.lineTo(hi, eh);
  ctx.stroke();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = BAND;
  ctx.stroke();
  // marker: a slim needle so the green band stays visible on both sides of it
  const mx = clamp(t, 0, 1) * L;
  const nw = RL.markerWidth * (1 + 0.3 * markerPop);
  const nh = (th + 2 * RL.markerOverhang) * (1 + 0.25 * markerPop);
  const mcol = opts.locked && opts.lockColor ? opts.lockColor : (opts.accent || '#FF8A3D');
  roundRectPath(ctx, mx - nw / 2, -nh / 2 + 3, nw, nh, nw / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  roundRectPath(ctx, mx - nw / 2, -nh / 2, nw, nh, nw / 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = mcol;
  ctx.stroke();
  // pointer cap above the track (rail-local "up" is -y)
  const cy = -nh / 2 - 2;
  ctx.beginPath();
  ctx.moveTo(mx - 8, cy - 10);
  ctx.lineTo(mx + 8, cy - 10);
  ctx.lineTo(mx, cy);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.fillStyle = mcol;
  ctx.fill();
  ctx.restore();
}

/**
 * v2/hard-perfect: the exact sim-measured PERFECT window (physics.measurePerfect) on the rail
 * (rail-local coords: x along the track, track centred on y = 0). Unlike the green fill it never
 * fades. Everything gold stays strictly inside [perfLo, perfHi] so what looks gold IS perfect: the
 * pulsing glow only extends above / below the track and the edge stroke is inset.
 */
function drawPerfectStrip(ctx, band, L, th, time) {
  const plo = band.perfLo * L;
  const phi = band.perfHi * L;
  const pw = Math.max(0.5, phi - plo);
  roundRectPath(ctx, plo, -th / 2 - 3, pw, th + 6, Math.min(pw / 2, 4));
  ctx.fillStyle = withAlpha(PERF_GLOW, 0.3 + 0.12 * Math.sin(time * 7));
  ctx.fill();
  roundRectPath(ctx, plo, -th / 2 + 3, pw, th - 6, Math.min(pw / 2, (th - 6) / 2));
  ctx.fillStyle = PERF_CORE;
  ctx.fill();
  if (pw > 3) {
    roundRectPath(ctx, plo + 1, -th / 2 + 4, pw - 2, th - 8, Math.min((pw - 2) / 2, (th - 8) / 2));
    ctx.lineWidth = 2;
    ctx.strokeStyle = PERF_EDGE;
    ctx.stroke();
  }
  // small gold star under the track marks the spot (the needle's cap sits above it)
  const cx = (plo + phi) / 2;
  const cy = th / 2 + 10;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 2.8 : 6.5;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(80,50,0,0.35)';
  ctx.stroke();
  ctx.fillStyle = PERF_EDGE;
  ctx.fill();
}

/**
 * Launch-angle guide dots from `anchor` (screen point) for rail position t. Not a trajectory
 * preview: spacing encodes strength vs the ideal power. markerPop (0..1) pops the dots on flick.
 */
export function drawGuideDots(ctx, shot, anchor, t, A, markerPop = 0, cfg = CONFIG) {
  if (!(A > 0.001) || !shot) return;
  const RL = cfg.rail;
  const { angle, dots } = guideLayout(shot, t, cfg);
  const pop = 1 + 0.35 * markerPop;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  ctx.save();
  ctx.globalAlpha = A;
  for (const dot of dots) {
    const px = anchor.x + ca * dot.d;
    const py = anchor.y - sa * dot.d;
    const rr = dot.r * pop;
    // drop shadow, soft dark rim, white dot
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.arc(px, py + 1.8, rr + RL.guideOutline, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,28,50,0.42)';
    ctx.beginPath();
    ctx.arc(px, py, rr + RL.guideOutline, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(px, py, rr, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
