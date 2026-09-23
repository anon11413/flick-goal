// Flick Goal — game-mode helpers for the menu mode chip + one-time Endless callout (pure, no DOM).
// See V2_SPEC.md §9.1. The engine owns the actual mode (game.idle({ mode })); the save
// remembers the player's choice (save.data.mode) and the callout bookkeeping (save.data.ui).

import { CONFIG } from './config.js';

export const MODES = Object.freeze({
  field: Object.freeze({ id: 'field', label: 'FIELD GOAL', short: 'Field Goal', icon: 'goalpost' }),
  endless: Object.freeze({ id: 'endless', label: 'ENDLESS', short: 'Endless', icon: 'infinity' }),
});

export const isMode = (m) => m === 'field' || m === 'endless';

/** The other mode (unknown -> 'endless', so a bad value toggles back to a valid one). */
export function otherMode(m) {
  return m === 'endless' ? 'field' : 'endless';
}

/** Valid mode or the configured default. */
export function normalizeMode(m, cfg = CONFIG) {
  if (isMode(m)) return m;
  const d = cfg.modes && cfg.modes.default;
  return isMode(d) ? d : 'field';
}

const uiOf = (save) => (save && save.ui) || {};

/**
 * The one-time "NEW: Endless mode! Tap to switch" callout: only for returning players
 * (gamesPlayed >= calloutMinGames) who never tried Endless nor dismissed it, on at most
 * calloutMaxShows menu visits.
 */
export function calloutVisible(save, cfg = CONFIG) {
  const ui = uiOf(save);
  const m = cfg.modes || {};
  const games = (save && save.stats && save.stats.gamesPlayed) | 0;
  return !ui.calloutDone && !ui.endlessTried
    && games >= (m.calloutMinGames ?? 3)
    && (ui.calloutShows | 0) < (m.calloutMaxShows ?? 3);
}

/**
 * Callout bookkeeping for an event. Returns the patch to apply to save.ui (or null):
 *  'menuVisit' - the menu was entered while the callout is visible: count the show
 *  'switch'    - the player switched mode (chip or callout): dismiss for good
 *  'endlessRun'- a run started in ENDLESS: Endless tried (NEW badge + callout gone)
 */
export function nextCalloutState(save, event, cfg = CONFIG) {
  const ui = uiOf(save);
  switch (event) {
    case 'menuVisit':
      return calloutVisible(save, cfg) ? { calloutShows: (ui.calloutShows | 0) + 1 } : null;
    case 'switch':
      return ui.calloutDone ? null : { calloutDone: true };
    case 'endlessRun':
      return ui.endlessTried ? null : { endlessTried: true, calloutDone: true };
    default:
      return null;
  }
}

/** The NEW badge on the mode chip shows until the player has started an Endless run. */
export function newBadgeVisible(save) {
  return !uiOf(save).endlessTried;
}
