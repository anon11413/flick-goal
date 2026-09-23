// Flick Goal — football-field geometry shared by every art style (pure math + path building).
//
// Broadcast side view: the camera stands on the near sideline looking across the field. World x
// runs along the field; depth z runs across it: z = 0 is the play line the ball, tee and post
// stand on (between the hashes), +z recedes toward the far sideline, -z comes toward the camera.
// A ground point (x, z) projects with a pinhole model around a vanishing point at the view centre:
// s(z) = D / (D + z); screenX = vpx + (X - vpx) * s; screenY = gy + Hh * (s - 1), so yard lines
// converge like a real broadcast shot while the play line itself (z = 0) keeps the exact world
// scale k used for ball and post.
//
// Layouts (V2_SPEC §3, §5.8):
//  * FIELD: a 100-yard field whose END LINE is at fv.endX (the goal post), end zones, the kicking
//    net and the end-zone stands behind it (geometry = game.js backstop()).
//  * ENDLESS: turf, yard lines and numbers tiled forever from fv.originX (yard 0), no end zones.

import { CONFIG } from '../config.js';

export const FIELD_FONT = '"Arial Rounded MT Bold","SF Pro Rounded",ui-rounded,"Nunito","Segoe UI",system-ui,sans-serif';
export const FIELD_LEN_YD = 100;
export const WALL_GAP = 48;   // depth of the far bench area between the far sideline and the wall
export const WALL_H = 16;     // far wall height (world units)
export const BORDER = 12;     // white sideline border width (depth units)
export const TEE_H = 9;       // tee height (world units)

/**
 * Projection helpers for a field view. fv = { w, h, k, camX, gy, vpx?, tilt?, camDist? }
 * (k = css px per world unit on the play line, camX = world x of the view's left edge,
 * gy = screen y of the play line). Returns { pt(x, z) -> [sx, sy], s(z), D, Hh, k, vpx, W,
 * wallZ, wallBase, farY, xMin, xMax } where farY is the screen y of the top of the far stadium
 * wall (theme decor stands on it) and [xMin, xMax] the world-x range covering the screen on the
 * narrowest (far) row.
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
  const xMin = fv.camX + (vpx - vpx / sW) / k - 30;
  const xMax = fv.camX + (vpx + (fv.w - vpx) / sW) / k + 30;
  return { pt, s, D, Hh, k, vpx, W, wallZ, wallBase, farY, xMin, xMax };
}

/** Path of the ground quad x0..x1 x z0..z1. */
export function quadPath(ctx, pr, x0, x1, z0, z1) {
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
 * Local affine frame for text/shapes painted flat on the turf at (x, z) (1 unit = 1 world unit).
 * 'near' = upright for the camera; 'far' = facing the far sideline (upside down).
 */
export function groundFrame(ctx, pr, x, z, facing = 'near') {
  const [px, py] = pr.pt(x, z);
  const sc = pr.s(z);
  const dz = (sc * sc) / pr.D; // -ds/dz
  const ax = pr.k * sc;
  const cx = (px - pr.vpx) * dz / sc; // == (X - vpx) * s^2 / D
  const cy = pr.Hh * dz;
  if (facing === 'far') ctx.transform(-ax, 0, -cx, -cy, px, py);
  else ctx.transform(ax, 0, cx, cy, px, py);
}

/** Screen y of the depth row that reaches the bottom of the view (clamped), as a depth z. */
export function nearDepth(pr, fv) {
  const sBot = 1 + (fv.h + 30 - fv.gy) / Math.max(1e-3, pr.Hh);
  return Math.max(-pr.D * 0.72, Math.min(-pr.W, sBot > 0.05 ? pr.D / sBot - pr.D : -pr.W));
}

/** FIELD layout x positions for an end line at E: goal lines, far end line, far goal line. */
export function fieldMarks(E, cfg = CONFIG) {
  const U = cfg.field.yard;
  const ez = cfg.field.endZoneYards * U;
  const G = E - ez;
  const Efar = E - (FIELD_LEN_YD * U + 2 * ez);
  return { E, G, Efar, Gfar: Efar + ez, U };
}

/**
 * End-zone stands geometry behind the end line at E (matches game.js backstop()):
 * { SX (front wall x), wallH, rise, rows, ROW, backX, topH, backH }.
 */
export function standsGeometry(E, cfg = CONFIG) {
  const F = cfg.field;
  const ROW = 14;
  const rows = Math.max(1, Math.round(F.standsDepth / ROW));
  const SX = E + F.standsOffset;
  return {
    SX, ROW, rows, rise: F.standsRise, wallH: F.standsWallH,
    backX: SX + rows * ROW, topH: F.standsWallH + rows * ROW * F.standsRise, backH: F.standsBackH,
  };
}

// ---------------------------------------------------------------- ENDLESS layout helpers
/**
 * World x of every 5-yard line of the endless field inside [xMin, xMax], anchored at originX
 * (x = originX + 5 U j, j may be negative). Returns [{ x, j }] in increasing x.
 */
export function endlessLineXs(xMin, xMax, originX = 0, cfg = CONFIG) {
  const step = 5 * cfg.field.yard;
  const out = [];
  if (!(xMax >= xMin) || !Number.isFinite(xMin) || !Number.isFinite(xMax)) return out;
  const j0 = Math.ceil((xMin - originX) / step - 1e-9);
  const j1 = Math.floor((xMax - originX) / step + 1e-9);
  for (let j = j0; j <= j1 && out.length < 400; j++) out.push({ x: originX + j * step, j });
  return out;
}

/** Yard number painted at world x on the endless field: round((x - originX) / U) (>= 0). */
export function endlessNumberAt(x, originX = 0, cfg = CONFIG) {
  return Math.max(0, Math.round((x - originX) / cfg.field.yard));
}
