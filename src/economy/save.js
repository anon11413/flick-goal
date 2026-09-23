// Versioned local save (v2). Pure module: storage and config are injectable so Node tests can run it.
// This is the ONLY module that touches the save in localStorage, and every access is wrapped in
// try/catch (private mode, disabled storage, quota errors, sandboxed iframes all degrade to memory).
//
// v2 (V2_SPEC §7) lives under its own key ('flickgoal.save2'): v2 is a different game shape and
// shares the http origin with older builds. When the v2 key is absent, a v1 save
// ('flickgoal.save') is imported ONCE (coins, owned items, equipped, best, settings, No Ads,
// timers, stats). The v1 key is only ever read, never written or removed.

import { CONFIG } from '../config.js';

export const SAVE_VERSION = 2;
/** Sanity cap for a corrupt / tampered balance (keeps the UI and arithmetic sane). */
export const MAX_COINS = 999999999;
const MAX_KICKS = 999;
const MAX_ID_LEN = 64;
const MAX_IDS = 200;
/** Top-level keys this build owns; anything else in a save is preserved as-is (sibling builds). */
const KNOWN_KEYS = new Set([
  'v', 'coins', 'best', 'bestYards', 'owned', 'equipped', 'settings', 'mode', 'tutorial', 'ui', 'noAds',
  'lastGiftAt', 'lastRewardedCoinsAt', 'adCounter', 'stats', 'importedV1',
]);

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

const saveKey = (cfg) => (cfg.save && cfg.save.key) || 'flickgoal.save2';
const importKey = (cfg) => (cfg.save && cfg.save.importKey) || 'flickgoal.save';
const defaultMode = (cfg) => {
  const m = cfg.modes && cfg.modes.default;
  return m === 'endless' ? 'endless' : 'field';
};

export function defaultSave(cfg = CONFIG) {
  const d = cfg.defaults;
  return {
    v: SAVE_VERSION,
    coins: Math.max(0, Math.floor(cfg.economy.startingCoins || 0)),
    best: { field: 0, endless: 0 },
    bestYards: 0,
    owned: { balls: [d.ball], stadiums: [d.stadium], upgrades: [] },
    equipped: { ball: d.ball, stadium: d.stadium },
    settings: { sound: true, haptics: true, aimSlider: true },
    mode: defaultMode(cfg),
    tutorial: { kicks: 0 },
    ui: { endlessTried: false, calloutShows: 0, calloutDone: false },
    noAds: false,
    lastGiftAt: 0,
    lastRewardedCoinsAt: 0,
    adCounter: 0,
    stats: { gamesPlayed: 0, totalGoals: 0, totalPerfects: 0, bestStreak: 0 },
    importedV1: false,
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

/**
 * Owned-id list: strings (<= 64 chars, deduped, at most 200). Ids this build does not know are
 * KEPT, so purchases made in a newer or sibling build survive this build writing the save (the
 * UI only lists catalog ids). `mustHave` (the default item) is always owned.
 */
function cleanIds(list, mustHave) {
  const out = [];
  if (Array.isArray(list)) {
    for (const id of list) {
      if (typeof id === 'string' && id && id.length <= MAX_ID_LEN && !out.includes(id)) out.push(id);
      if (out.length >= MAX_IDS) break;
    }
  }
  if (mustHave && !out.includes(mustHave)) out.unshift(mustHave);
  return out;
}

const catalogHas = (cfg, list, id) => Array.isArray(cfg.catalog[list]) && cfg.catalog[list].some((it) => it.id === id);

/** Equipped id must be a known catalog item AND owned, else the default. */
function cleanEquipped(id, owned, cfg, list, dflt) {
  return typeof id === 'string' && owned.includes(id) && catalogHas(cfg, list, id) ? id : dflt;
}

function cleanStats(stats) {
  const s = isObj(stats) ? stats : {};
  return {
    gamesPlayed: toInt(s.gamesPlayed, 0),
    totalGoals: toInt(s.totalGoals, 0),
    totalPerfects: toInt(s.totalPerfects, 0),
    bestStreak: toInt(s.bestStreak, 0),
  };
}

/** Is this parsed object a v1 save (from flickgoal.save or an old build)? */
function looksV1(o) {
  return isObj(o) && (Number(o.v) === 1 || (o.v === undefined && typeof o.best !== 'object'));
}

function parse(raw) {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/**
 * Import a v1 save (object or JSON string) into a fresh v2 save. Never throws; garbage -> defaults.
 * Copies coins, owned balls + stadiums (v1 stadium ids are the retro ids), equipped (if owned),
 * best into BOTH modes (difficulty per kick is identical; ENDLESS is the v1 mechanic), sound /
 * haptics, No Ads, gift / rewarded timers, ad counter and stats. Tutorial, mode and upgrades
 * start fresh (imported players also get the two-kick slider tutorial: it teaches the new dots).
 */
export function importV1(raw, cfg = CONFIG, now = Date.now()) {
  const base = defaultSave(cfg);
  const src = parse(raw);
  if (!isObj(src)) return base;
  try {
    const owned = isObj(src.owned) ? src.owned : {};
    const equipped = isObj(src.equipped) ? src.equipped : {};
    const settings = isObj(src.settings) ? src.settings : {};
    const balls = cleanIds(owned.balls, cfg.defaults.ball);
    const stadiums = cleanIds(owned.stadiums, cfg.defaults.stadium);
    const best = toInt(src.best, 0);
    return {
      ...base,
      coins: Math.min(MAX_COINS, toInt(src.coins, base.coins)),
      best: { field: best, endless: best },
      owned: { balls, stadiums, upgrades: [] },
      equipped: {
        ball: cleanEquipped(equipped.ball, balls, cfg, 'balls', cfg.defaults.ball),
        stadium: cleanEquipped(equipped.stadium, stadiums, cfg, 'stadiums', cfg.defaults.stadium),
      },
      settings: { ...base.settings, sound: toBool(settings.sound, true), haptics: toBool(settings.haptics, true) },
      noAds: src.noAds === true,
      lastGiftAt: toTime(src.lastGiftAt, now),
      lastRewardedCoinsAt: toTime(src.lastRewardedCoinsAt, now),
      adCounter: toInt(src.adCounter, 0),
      stats: cleanStats(src.stats),
      importedV1: true,
    };
  } catch {
    return base;
  }
}

/**
 * Normalize anything (object, JSON string, garbage) into a valid v2 save. Never throws.
 * - bad JSON / non-object -> defaults; a v1-shaped object -> importV1
 * - numbers coerced (finite, >= 0; integers for counters); timestamps clamped to <= now
 * - unknown owned ids and unknown top-level keys preserved; defaults always owned;
 *   equipped must be known and owned
 */
export function migrate(raw, cfg = CONFIG, now = Date.now()) {
  const base = defaultSave(cfg);
  const src = parse(raw);
  if (!isObj(src)) return base;
  if (looksV1(src)) return importV1(src, cfg, now);

  try {
    const owned = isObj(src.owned) ? src.owned : {};
    const equipped = isObj(src.equipped) ? src.equipped : {};
    const settings = isObj(src.settings) ? src.settings : {};
    const best = isObj(src.best) ? src.best : {};
    const tutorial = isObj(src.tutorial) ? src.tutorial : {};
    const ui = isObj(src.ui) ? src.ui : {};

    const balls = cleanIds(owned.balls, cfg.defaults.ball);
    const stadiums = cleanIds(owned.stadiums, cfg.defaults.stadium);
    const upgrades = cleanIds(owned.upgrades, null);

    const extra = {};
    for (const k of Object.keys(src)) if (!KNOWN_KEYS.has(k)) extra[k] = src[k];

    return {
      ...extra,
      v: SAVE_VERSION,
      coins: Math.min(MAX_COINS, toInt(src.coins, base.coins)),
      best: { field: toInt(best.field, 0), endless: toInt(best.endless, 0) },
      bestYards: toInt(src.bestYards, 0),
      owned: { balls, stadiums, upgrades },
      equipped: {
        ball: cleanEquipped(equipped.ball, balls, cfg, 'balls', cfg.defaults.ball),
        stadium: cleanEquipped(equipped.stadium, stadiums, cfg, 'stadiums', cfg.defaults.stadium),
      },
      settings: {
        sound: toBool(settings.sound, true),
        haptics: toBool(settings.haptics, true),
        aimSlider: toBool(settings.aimSlider, true),
      },
      mode: src.mode === 'field' || src.mode === 'endless' ? src.mode : defaultMode(cfg),
      tutorial: { kicks: Math.min(MAX_KICKS, toInt(tutorial.kicks, 0)) },
      ui: {
        endlessTried: toBool(ui.endlessTried, false),
        calloutShows: toInt(ui.calloutShows, 0),
        calloutDone: toBool(ui.calloutDone, false),
      },
      noAds: src.noAds === true,
      lastGiftAt: toTime(src.lastGiftAt, now),
      lastRewardedCoinsAt: toTime(src.lastRewardedCoinsAt, now),
      adCounter: toInt(src.adCounter, 0),
      stats: cleanStats(src.stats),
      importedV1: src.importedV1 === true,
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
 *   onExternalChange(fn), persisted, readOnly, imported }
 * `data` is the live object: read it anywhere, mutate it only inside update().
 *
 * Multi-tab safety: when another tab/window writes the v2 save, its 'storage' event is ingested
 * (listen(key, fn) is injectable for tests), so this tab's next write builds on the other tab's
 * coins/purchases instead of overwriting them. update() applies deltas to the live data.
 *
 * Forward compatibility: a save written by a NEWER build (v > SAVE_VERSION) is used in memory
 * but never written back, so its extra fields survive.
 */
export function createSaveManager({ storage, cfg = CONFIG, now = () => Date.now(), listen = windowStorageEvents } = {}) {
  const store = storage || safeStorage();
  const key = saveKey(cfg);
  const v1Key = importKey(cfg);
  let persisted = false;
  let readOnly = false;
  let imported = false;
  const externalListeners = new Set();

  const read = (k) => {
    try { return store.getItem(k); } catch { return null; }
  };

  let data;
  const raw = read(key);
  if (raw === null || raw === undefined) {
    // First v2 launch: import a v1 player once (read only), else a fresh save.
    const v1 = v1Key && v1Key !== key ? read(v1Key) : null;
    data = v1 !== null && v1 !== undefined ? importV1(v1, cfg, now()) : defaultSave(cfg);
    imported = data.importedV1 === true;
  } else {
    readOnly = rawVersion(raw) > SAVE_VERSION;
    data = migrate(raw, cfg, now());
  }

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
    /** True when this session imported a v1 save (first v2 launch of a v1 player). */
    get imported() { return imported; },
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
     * Wipe progress: coins, owned items (incl. upgrades), equipped, bests, farthest run, stats.
     * Keeps purchases (No Ads), settings, the gift / rewarded timers (a reset cannot farm free
     * gifts), the slider tutorial progress, the mode-callout bookkeeping and the chosen mode.
     */
    reset() {
      const keep = {
        noAds: data.noAds,
        settings: { ...data.settings },
        lastGiftAt: data.lastGiftAt,
        lastRewardedCoinsAt: data.lastRewardedCoinsAt,
        tutorial: { ...data.tutorial },
        ui: { ...data.ui },
        mode: data.mode,
        importedV1: data.importedV1,
      };
      data = Object.assign(defaultSave(cfg), keep);
      persist();
      return data;
    },
  };
}
