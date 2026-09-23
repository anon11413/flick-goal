// Flick Goal — aim slider rules: first-kick tutorial + the Aim Slider upgrade (pure, no DOM).
//
// The power slider (rail track, green band, needle) is a teaching aid in v2:
//   kick 1 ever  -> 'full'  slider + hint "TAP when the marker is in the GREEN"
//   kick 2 ever  -> 'fade'  slider shown, then fades away during the aim (hint: aim with the dots)
//   kick 3+      -> 'off'   guide dots only
// The permanent "Aim Slider" store upgrade brings it back on every kick while switched ON.
// The launch-angle guide dots are drawn in every mode (the slider teaches the dots).
// See V2_SPEC.md §6. main.js computes the mode for the next shot and hands it to the renderer.

import { CONFIG } from './config.js';

export const AIM_MODES = ['full', 'fade', 'off'];
export const AIM_SLIDER_ID = 'aim_slider';

const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

/**
 * Slider mode for the NEXT shot. Precedence: dev force > owned-and-ON > tutorial > off.
 * An owner who switches the slider OFF during their first two kicks still gets the tutorial.
 * @returns {{ mode: 'full'|'fade'|'off', reason: 'dev'|'upgrade'|'tutorial'|'default' }}
 */
export function sliderMode({ devForce = 'default', owned = false, on = true, kicks = 0 } = {}) {
  if (devForce === 'on') return { mode: 'full', reason: 'dev' };
  if (devForce === 'off') return { mode: 'off', reason: 'dev' };
  if (owned && on) return { mode: 'full', reason: 'upgrade' };
  const k = Math.max(0, Math.floor(Number(kicks) || 0));
  if (k <= 0) return { mode: 'full', reason: 'tutorial' };
  if (k === 1) return { mode: 'fade', reason: 'tutorial' };
  return { mode: 'off', reason: 'default' };
}

/**
 * Rail (track / band / needle) alpha multiplier while aiming. aimTime = seconds since aiming
 * started (sim time; 0 during intro). The guide dots are never faded by this.
 */
export function railFade(mode, aimTime, cfg = CONFIG) {
  if (mode === 'full') return 1;
  if (mode !== 'fade') return 0;
  const a = cfg.aim || {};
  const delay = Number.isFinite(a.fadeDelay) ? a.fadeDelay : 0.3;
  const dur = Math.max(1e-3, Number.isFinite(a.fadeTime) ? a.fadeTime : 1.1);
  const u = ((Number(aimTime) || 0) - delay) / dur;
  return u <= 0 ? 1 : u >= 1 ? 0 : 1 - easeInOut(u);
}

/**
 * Which first-shot hint to show for a shot: 'rail' | 'fade' | 'dots' | null.
 * mode/reason = sliderMode() for this shot, kicks = kicks taken before it, made/startMade =
 * the run's goals at shotStart (first shot of a run when equal), totalGoals = lifetime goals.
 */
export function hintFor({ mode, reason, kicks = 0, made = 0, startMade = 0, totalGoals = 0, cfg = CONFIG } = {}) {
  const a = cfg.aim || {};
  const tutorialKicks = Number.isFinite(a.tutorialKicks) ? a.tutorialKicks : 2;
  const until = Number.isFinite(a.dotsHintUntilKick) ? a.dotsHintUntilKick : 6;
  const firstOfRun = made === startMade;
  if (mode === 'fade') return 'fade';
  if (mode === 'full') return reason === 'tutorial' || (firstOfRun && totalGoals < 3) ? 'rail' : null;
  if (kicks === tutorialKicks) return 'dots'; // first slider-less kick ever
  return firstOfRun && kicks < until ? 'dots' : null;
}

/** Human label for the dev read-out ("FADE (tutorial)"). */
export function describeAim({ mode, reason }) {
  return `${String(mode || 'off').toUpperCase()} (${reason || 'default'})`;
}
