// Flick Goal — difficulty curves (pure, no DOM).
//
// Every curve is a clamped exponential toward an asymptote (MATH.md):
//   curve(n) = asym - (asym - start) * exp(-n / scale)
// so difficulty ramps quickly early and then flattens. This keeps the two
// "always beatable" constraints true for EVERY n (see checkSchedule):
//   1. dwell  D(n) = W(n) / v(n) >= D_min           (never a sub-frame tap)
//   2. clock  L(n) >= tau_r + T(n)/2 + D_min         (T/2 = 1/v on a unit rail)
// `n` is always the number of goals MADE this run (not points).

import { CONFIG } from '../config.js';

/** Clamped exponential curve. p = {start, asym, scale}. */
export function curve(p, n) {
  const k = Math.max(0, Number(n) || 0);
  return p.asym - (p.asym - p.start) * Math.exp(-k / p.scale);
}

/** v(n): marker speed along the rail, rail-lengths per second. */
export function speed(n, cfg = CONFIG) { return curve(cfg.difficulty.speed, n); }

/** W(n): target sweet-band width, fraction of the rail. */
export function bandWidth(n, cfg = CONFIG) { return curve(cfg.difficulty.band, n); }

/** L(n): base shot clock in seconds (the solver may extend it per shot). */
export function shotClock(n, cfg = CONFIG) { return curve(cfg.difficulty.clock, n); }

/** Mean tee -> post distance in world units (solver adds +-jitter). */
export function distance(n, cfg = CONFIG) { return curve(cfg.difficulty.distance, n); }

/** Upright length above the crossbar (the goal window height). */
export function gap(n, cfg = CONFIG) { return curve(cfg.difficulty.gap, n); }

/** Allowed crossbar heights: posts start low and get taller over the first shots. */
export function barRange(n, cfg = CONFIG) {
  const b = cfg.difficulty.barHeight;
  const k = Math.max(0, Number(n) || 0);
  const min = b.min;
  return { min, max: min + b.range * Math.min(1, k / b.rampShots) };
}

/** Opacity of the sweet-band glow on the rail (fades as the player improves). */
export function bandAlpha(n, cfg = CONFIG) { return curve(cfg.difficulty.bandAlpha, n); }

/**
 * v2/hard-perfect: nominal PERFECT window for goal count n, as a fraction of gap/2 (perfect iff
 * clean and |h - hc| <= perfectFrac(n) * gap / 2). Shrinks asymptotically with goals made. The
 * solver may widen a shot's window so the rail strip keeps at least perfectDwell(n) of dwell.
 */
export function perfectFrac(n, cfg = CONFIG) { return curve(cfg.difficulty.perfect, n); }

/** v2/hard-perfect: minimum seconds the marker spends inside the PERFECT strip on one pass. */
export function perfectDwell(n, cfg = CONFIG) {
  return Math.max(cfg.difficulty.perfectDwellMin, curve(cfg.difficulty.perfectDwell, n));
}

/** D(n) = W(n) / v(n): seconds the marker spends inside the band on one pass. */
export function dwell(n, cfg = CONFIG) { return bandWidth(n, cfg) / speed(n, cfg); }

/** Every difficulty parameter for goal count n. */
export function params(n, cfg = CONFIG) {
  const br = barRange(n, cfg);
  return {
    n,
    speed: speed(n, cfg),
    band: bandWidth(n, cfg),
    clock: shotClock(n, cfg),
    distance: distance(n, cfg),
    gap: gap(n, cfg),
    barMin: br.min,
    barMax: br.max,
    bandAlpha: bandAlpha(n, cfg),
    dwell: dwell(n, cfg),
    perfectFrac: perfectFrac(n, cfg),
    perfectDwell: perfectDwell(n, cfg),
  };
}

/**
 * Verify the always-beatable schedule for n in [0, maxN]. Never throws.
 * Rules (SPEC §4.1):
 *   dwell:  W(n) * widthTolLo / v(n) >= dwellMin   (worst accepted measured band)
 *   clock:  L(n) >= reaction + 1 / v(n) + dwellMin
 *   perfect: perfectDwell(n) >= perfectDwellMin, and it fits inside the band's dwell
 *   monotone: speed & distance non-decreasing; band, clock, gap, bandAlpha, perfectFrac,
 *             perfectDwell non-increasing
 * @returns {{ok: boolean, failures: Array<{n: number, rule: string}>}}
 */
export function checkSchedule(maxN = 500, cfg = CONFIG) {
  const failures = [];
  try {
    const d = cfg.difficulty;
    const tolLo = cfg.mapping.widthTolLo;
    const EPS = 1e-12;
    let prev = null;
    for (let n = 0; n <= maxN; n++) {
      const p = params(n, cfg);
      if (!(p.band * tolLo / p.speed >= d.dwellMin)) failures.push({ n, rule: 'dwell' });
      if (!(p.clock >= d.reaction + 1 / p.speed + d.dwellMin)) failures.push({ n, rule: 'clock' });
      if (!(p.speed > 0 && p.band > 0 && p.band <= 1)) failures.push({ n, rule: 'range' });
      if (!(p.perfectDwell >= d.perfectDwellMin)) failures.push({ n, rule: 'perfectDwell' });
      if (!(p.perfectDwell <= p.band * tolLo / p.speed)) failures.push({ n, rule: 'perfectDwell:band' });
      if (!(p.perfectFrac > 0 && p.perfectFrac < 1)) failures.push({ n, rule: 'range:perfect' });
      if (prev) {
        if (p.speed < prev.speed - EPS) failures.push({ n, rule: 'monotone:speed' });
        if (p.distance < prev.distance - EPS) failures.push({ n, rule: 'monotone:distance' });
        if (p.band > prev.band + EPS) failures.push({ n, rule: 'monotone:band' });
        if (p.clock > prev.clock + EPS) failures.push({ n, rule: 'monotone:clock' });
        if (p.gap > prev.gap + EPS) failures.push({ n, rule: 'monotone:gap' });
        if (p.bandAlpha > prev.bandAlpha + EPS) failures.push({ n, rule: 'monotone:bandAlpha' });
        if (p.perfectFrac > prev.perfectFrac + EPS) failures.push({ n, rule: 'monotone:perfectFrac' });
        if (p.perfectDwell > prev.perfectDwell + EPS) failures.push({ n, rule: 'monotone:perfectDwell' });
      }
      prev = p;
    }
  } catch (err) {
    failures.push({ n: -1, rule: 'exception: ' + (err && err.message) });
  }
  return { ok: failures.length === 0, failures };
}
