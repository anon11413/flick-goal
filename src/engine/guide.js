// Flick Goal — launch-angle guide geometry (pure, no DOM).
//
// The guide is a short row of dots from the ball along the launch angle for rail
// position t. Its dot SPACING shows kick strength relative to the shot's ideal power:
// bunched = too weak, evenly spaced = right, stretched = too strong. The spacing curve
// is an S-curve (tanh) centred on the ideal power, so the row visibly changes length
// inside the scoring window even late in a run, and settles at the ends of the sweep.
// It is NOT a trajectory preview: it never shows where the ball will land.

import { CONFIG } from '../config.js';
import { mapRail } from './physics.js';

/** Dot spacing (css px) for power ratio pf = power / shot.powerC. */
export function guideSpacing(pf, cfg = CONFIG) {
  const RL = cfg.rail;
  return RL.guideSpacing * (1 + RL.guideSpread * Math.tanh((pf - 1) / RL.guideSoft));
}

/**
 * Guide layout for rail position t.
 * @returns {{angle: number, spacing: number, dots: Array<{d: number, r: number}>}}
 *   d = distance from the ball centre, r = dot radius (before any pop scale)
 */
export function guideLayout(shot, t, cfg = CONFIG) {
  const RL = cfg.rail;
  const { angle, power } = mapRail(shot, t, cfg);
  const spacing = guideSpacing(power / shot.powerC, cfg);
  const dots = [];
  for (let i = 0; i < RL.guideDots; i++) {
    dots.push({ d: RL.guideStart + i * spacing, r: Math.max(1.5, RL.guideRadius - i * RL.guideRadiusStep) });
  }
  return { angle, spacing, dots };
}

/** Screen-space offset (css px, y down) of the last dot's centre from the ball. */
export function guideTip(shot, t, cfg = CONFIG) {
  const { angle, dots } = guideLayout(shot, t, cfg);
  const d = dots[dots.length - 1].d;
  return { x: Math.cos(angle) * d, y: -Math.sin(angle) * d, len: d };
}
