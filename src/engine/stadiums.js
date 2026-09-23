// Flick Goal — stadium registry: a catalog stadium id -> { art style, base theme } (pure data).
// RETRO stadiums keep the v1 ids ('day', 'night', ...); PRO stadiums are 'pro_<theme>'.
// Base theme ids ('day', ...) resolve to themselves in the retro style, so older call sites and
// saves keep working; unknown ids fall back to retro Day Game.

import { CONFIG } from '../config.js';
import { THEMES } from './themes.js';

const cache = new Map();

/** { id, style: 'retro' | 'pro', theme: base theme id, name } for a catalog stadium id. */
export function stadiumInfo(stadiumId, cfg = CONFIG) {
  const key = String(stadiumId);
  let info = cfg === CONFIG ? cache.get(key) : undefined;
  if (info) return info;
  const list = (cfg.catalog && cfg.catalog.stadiums) || [];
  const it = list.find((s) => s.id === stadiumId);
  if (it) {
    const theme = THEMES[it.theme] ? it.theme : THEMES[it.id] ? it.id : 'day';
    info = Object.freeze({ id: it.id, style: it.style === 'pro' ? 'pro' : 'retro', theme, name: it.name });
  } else if (THEMES[stadiumId]) {
    info = Object.freeze({ id: stadiumId, style: 'retro', theme: stadiumId, name: THEMES[stadiumId].name });
  } else {
    info = Object.freeze({ id: 'day', style: 'retro', theme: 'day', name: THEMES.day.name });
  }
  if (cfg === CONFIG) cache.set(key, info);
  return info;
}

export const styleOf = (stadiumId, cfg = CONFIG) => stadiumInfo(stadiumId, cfg).style;
export const themeOf = (stadiumId, cfg = CONFIG) => stadiumInfo(stadiumId, cfg).theme;

/** Display name for dialogs / toasts: PRO stadiums get an " HD" suffix. */
export function stadiumDisplayName(stadiumId, cfg = CONFIG) {
  const it = stadiumInfo(stadiumId, cfg);
  return it.style === 'pro' ? `${it.name} HD` : it.name;
}
