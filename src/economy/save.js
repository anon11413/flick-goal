// Versioned local save. Pure module: storage and config are injectable so Node tests can run it.
// This is the ONLY module that touches localStorage, and every access is wrapped in try/catch
// (private mode, disabled storage, quota errors, sandboxed iframes all degrade to memory-only).

import { CONFIG } from '../config.js';

export const SAVE_VERSION = 1;
/** Sanity cap for a corrupt / tampered balance (keeps the UI and arithmetic sane). */
export const MAX_COINS = 999999999;

/** In-memory Storage-like object (used in tests and when localStorage is unavailable). */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
  };
}

/**
 * window.localStorage when a probe write/remove succeeds, else memoryStorage(). Never throws.
 * The fallback is flagged `volatile` so the save manager reports persisted === false.
 */
export function safeStorage() {
  const fallback = () => Object.assign(memoryStorage(), { volatile: true });
  try {
    const ls = typeof window !== 'undefined' ? window.localStorage : null;
    if (!ls) return fallback();
    const probe = '__flickgoal_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return fallback();
  }
}

export function defaultSave(cfg = CONFIG) {
  const d = cfg.defaults;
  return {
    v: SAVE_VERSION,
    coins: Math.max(0, Math.floor(cfg.economy.startingCoins || 0)),
    best: 0,
    owned: { balls: [d.ball], stadiums: [d.stadium] },
    equipped: { ball: d.ball, stadium: d.stadium },
    settings: { sound: true, haptics: true },
    noAds: false,
    lastGiftAt: 0,
    lastRewardedCoinsAt: 0,
    adCounter: 0,
    stats: { gamesPlayed: 0, totalGoals: 0, totalPerfects: 0, bestStreak: 0 },
  };
}

// ---- coercion helpers ----
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const toInt = (v, dflt = 0) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
};
/** Timestamps: finite, >= 0, and never in the future (a corrupt save or a clock that was
 *  corrected backwards must not lock the gift / rewarded-coin timers for days). */
const toTime = (v, now) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!(typeof n === 'number' && Number.isFinite(n) && n >= 0)) return 0;
  return Number.isFinite(now) ? Math.min(n, now) : n;
};
const toBool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);

function cleanIds(list, catalog, mustHave) {
  const valid = new Set(catalog.map((it) => it.id));
  const out = [];
  if (Array.isArray(list)) {
    for (const id of list) {
      if (typeof id === 'string' && valid.has(id) && !out.includes(id)) out.push(id);
    }
  }
  if (!out.includes(mustHave)) out.unshift(mustHave);
  return out;
}

/**
 * Normalize anything (object, JSON string, garbage) into a valid v1 save. Never throws.
 * - bad JSON / non-object -> defaults
 * - numbers coerced (finite, >= 0; integers for counters)
 * - unknown catalog ids dropped; defaults always owned; equipped must be owned
 * - timestamps clamped to <= now
 */
export function migrate(raw, cfg = CONFIG, now = Date.now()) {
  const base = defaultSave(cfg);
  let src = raw;
  try {
    if (typeof src === 'string') src = JSON.parse(src);
  } catch {
    return base;
  }
  if (!isObj(src)) return base;

  try {
    // Future versions would transform here: if (src.v === 1) { ...upgrade to 2... }
    const owned = isObj(src.owned) ? src.owned : {};
    const equipped = isObj(src.equipped) ? src.equipped : {};
    const settings = isObj(src.settings) ? src.settings : {};
    const stats = isObj(src.stats) ? src.stats : {};

    const balls = cleanIds(owned.balls, cfg.catalog.balls, cfg.defaults.ball);
    const stadiums = cleanIds(owned.stadiums, cfg.catalog.stadiums, cfg.defaults.stadium);

    return {
      v: SAVE_VERSION,
      coins: Math.min(MAX_COINS, toInt(src.coins, base.coins)),
      best: toInt(src.best, 0),
      owned: { balls, stadiums },
      equipped: {
        ball: balls.includes(equipped.ball) ? equipped.ball : cfg.defaults.ball,
        stadium: stadiums.includes(equipped.stadium) ? equipped.stadium : cfg.defaults.stadium,
      },
      settings: {
        sound: toBool(settings.sound, true),
        haptics: toBool(settings.haptics, true),
      },
      noAds: src.noAds === true,
      lastGiftAt: toTime(src.lastGiftAt, now),
      lastRewardedCoinsAt: toTime(src.lastRewardedCoinsAt, now),
      adCounter: toInt(src.adCounter, 0),
      stats: {
        gamesPlayed: toInt(stats.gamesPlayed, 0),
        totalGoals: toInt(stats.totalGoals, 0),
        totalPerfects: toInt(stats.totalPerfects, 0),
        bestStreak: toInt(stats.bestStreak, 0),
      },
    };
  } catch {
    return base;
  }
}

/** Version number of a raw save (string or object), or 0 when unknown / unparsable. */
export function rawVersion(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const v = o && typeof o === 'object' ? Number(o.v) : 0;
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/** Default cross-tab listener: the 'storage' event fires in OTHER tabs when one tab writes. */
function windowStorageEvents(key, fn) {
  try {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
    const h = (e) => { if (e && e.key === key && typeof e.newValue === 'string') fn(e.newValue); };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  } catch {
    return () => {};
  }
}

/**
 * createSaveManager({storage, cfg, now, listen}) -> { data, update(fn), reset(), ingest(raw),
 *   onExternalChange(fn), persisted, readOnly }
 * `data` is the live object: read it anywhere, mutate it only inside update().
 *
 * Multi-tab safety: when another tab/window writes the save, its 'storage' event is ingested
 * (listen(key, fn) is injectable for tests), so this tab's next write builds on the other tab's
 * coins/purchases instead of overwriting them. update() applies deltas to the live data.
 *
 * Forward compatibility: a save written by a NEWER build (v > SAVE_VERSION, e.g. a cached old
 * PWA opening a newer save) is used in memory but never written back, so its extra fields survive.
 */
export function createSaveManager({ storage, cfg = CONFIG, now = () => Date.now(), listen = windowStorageEvents } = {}) {
  const store = storage || safeStorage();
  const key = (cfg.save && cfg.save.key) || 'flickgoal.save';
  let persisted = false;
  let readOnly = false;
  const externalListeners = new Set();

  let raw = null;
  try {
    raw = store.getItem(key);
  } catch {
    raw = null;
  }
  readOnly = rawVersion(raw) > SAVE_VERSION;
  let data = migrate(raw, cfg, now());

  function persist() {
    if (readOnly) {
      persisted = false;
      return false;
    }
    try {
      store.setItem(key, JSON.stringify(data));
      persisted = !store.volatile; // memory fallback: works for this session only
    } catch {
      persisted = false;
    }
    return persisted;
  }
  persist(); // write back the normalized form (also tells us if storage works)

  /** Adopt a save written elsewhere (another tab). Does not write it back. */
  function ingest(nextRaw) {
    if (typeof nextRaw !== 'string' || !nextRaw) return false;
    if (rawVersion(nextRaw) > SAVE_VERSION) readOnly = true;
    data = migrate(nextRaw, cfg, now());
    for (const fn of Array.from(externalListeners)) {
      try { fn(data); } catch (err) { console.error('save listener failed', err); }
    }
    return true;
  }
  try { listen(key, ingest); } catch { /* no cross-tab sync available */ }

  return {
    get data() { return data; },
    get persisted() { return persisted; },
    get readOnly() { return readOnly; },
    ingest,
    /** fn(data) after another tab changed the save. Returns an unsubscribe function. */
    onExternalChange(fn) {
      if (typeof fn !== 'function') return () => {};
      externalListeners.add(fn);
      return () => externalListeners.delete(fn);
    },
    /** Mutate via callback, then persist. Returns the live data object. */
    update(mutator) {
      if (typeof mutator === 'function') mutator(data);
      persist();
      return data;
    },
    /**
     * Wipe progress. Keeps purchases (noAds), settings, and the gift / rewarded timers
     * (so a reset cannot be used to farm free gifts).
     */
    reset() {
      const keep = {
        noAds: data.noAds,
        settings: { ...data.settings },
        lastGiftAt: data.lastGiftAt,
        lastRewardedCoinsAt: data.lastRewardedCoinsAt,
      };
      data = Object.assign(defaultSave(cfg), keep);
      persist();
      return data;
    },
  };
}
