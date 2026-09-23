// Flick Goal — developer "start round" option (playtesting only, pure: no DOM).
//
// Round R = the R-th kick of a run. Starting at round R begins the run as if R-1 goals were
// already made (game.newRun({ startMade: R - 1 })), so every difficulty system that keys off
// `made` matches a natural run at that point.
//
// State lives in its OWN localStorage key (never in the main save), so it survives reloads and
// is shared by every build served from the same origin. Access paths (all gone when
// cfg.dev.enabled is false):
//   ?round=N   set the start round (1..maxRound) and turn developer mode on
//   ?dev=1     turn developer mode on (?dev=0 turns it off)
//   ?slider=on|off|default   force the aim slider for every kick (and turn developer mode on)
//   Settings -> tap the version label 5x   toggle developer mode (see ui/devPanel.js)
// v2 adds two persisted developer overrides (both inert while developer mode is off):
//   slider  'default' | 'on' | 'off'   aim slider force (beats the tutorial and the upgrade)
//   gfx     'auto' | 'high' | 'low'    graphics quality override for adaptive (pro) styles

import { CONFIG } from './config.js';

export const DEV_KEY = 'flickgoal.dev';
const FALLBACK = { enabled: false, maxRound: 200 };
export const SLIDER_FORCES = ['default', 'on', 'off'];
export const GFX_MODES = ['auto', 'high', 'low'];
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);

/** cfg.dev with safe defaults (a config without a `dev` block means no dev access). */
export function devConfig(cfg = CONFIG) {
  return { ...FALLBACK, ...((cfg && cfg.dev) || {}) };
}

/** Clamp a start round to 1..maxRound (anything unparsable -> 1). */
export function clampRound(n, cfg = CONFIG) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(devConfig(cfg).maxRound, Math.max(1, v));
}

/** True for a run (gameover payload / game.hud()) that did not start at round 1. */
export function isDevRun(e) {
  return !!e && (e.startMade | 0) > 0;
}

/** Best score after a run ends (`e` = gameover payload): dev runs never change it. */
export function nextBest(best, e) {
  const b = Number(best) || 0;
  return isDevRun(e) ? b : Math.max(b, Number(e && e.score) || 0);
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * createDevState({ cfg, search, storage }) ->
 *   { available, enabled(), startRound(), startMade(), setEnabled(v), toggle(), setStartRound(n), onChange(fn) }
 * startRound() is 1 whenever developer mode is off, so normal play is never affected.
 */
export function createDevState({ cfg = CONFIG, search = '', storage = defaultStorage() } = {}) {
  const dc = devConfig(cfg);
  const listeners = new Set();
  const state = { devEnabled: false, startRound: 1, slider: 'default', gfx: 'auto' };

  function load() {
    try {
      const raw = storage && storage.getItem(DEV_KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && typeof o === 'object') {
        state.devEnabled = o.devEnabled === true;
        state.startRound = clampRound(o.startRound, cfg);
        state.slider = pick(o.slider, SLIDER_FORCES, 'default');
        state.gfx = pick(o.gfx, GFX_MODES, 'auto');
      }
    } catch { /* unreadable or blocked storage: defaults */ }
  }
  function persist() {
    try { if (storage) storage.setItem(DEV_KEY, JSON.stringify(state)); } catch { /* private mode / quota */ }
  }
  function changed() {
    persist();
    for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } }
  }

  if (dc.enabled) {
    load();
    let p = null;
    try { p = new URLSearchParams(search || ''); } catch { p = null; }
    if (p) {
      let touched = false;
      if (p.has('round')) { state.devEnabled = true; state.startRound = clampRound(p.get('round'), cfg); touched = true; }
      if (p.has('slider') && SLIDER_FORCES.includes(p.get('slider'))) {
        state.slider = p.get('slider');
        if (state.slider !== 'default') state.devEnabled = true;
        touched = true;
      }
      if (p.get('dev') === '1') { state.devEnabled = true; touched = true; }
      else if (p.get('dev') === '0') { state.devEnabled = false; touched = true; }
      if (touched) persist();
    }
  }

  const enabled = () => dc.enabled && state.devEnabled;
  const startRound = () => (enabled() ? state.startRound : 1);

  function setEnabled(v) {
    if (!dc.enabled || state.devEnabled === !!v) return;
    state.devEnabled = !!v;
    changed();
  }

  return {
    available: dc.enabled,
    maxRound: dc.maxRound,
    enabled,
    startRound,
    /** Goals already "made" when a run starts: pass to game.newRun({ startMade }). */
    startMade: () => startRound() - 1,
    /** The stored round, even while developer mode is off (shown in the panel). */
    storedRound: () => state.startRound,
    setEnabled,
    toggle() { setEnabled(!state.devEnabled); return enabled(); },
    setStartRound(n) {
      if (!dc.enabled) return;
      const r = clampRound(n, cfg);
      if (r === state.startRound) return;
      state.startRound = r;
      changed();
    },
    /** Aim slider force in effect: the stored force while developer mode is on, else 'default'. */
    sliderForce: () => (enabled() ? state.slider : 'default'),
    storedSlider: () => state.slider,
    setSliderForce(v) {
      if (!dc.enabled) return;
      const s = pick(v, SLIDER_FORCES, 'default');
      if (s === state.slider) return;
      state.slider = s;
      changed();
    },
    /** Graphics quality override in effect ('auto' while developer mode is off). */
    gfx: () => (enabled() ? state.gfx : 'auto'),
    storedGfx: () => state.gfx,
    setGfx(v) {
      if (!dc.enabled) return;
      const g = pick(v, GFX_MODES, 'auto');
      if (g === state.gfx) return;
      state.gfx = g;
      changed();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
