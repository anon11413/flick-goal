import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import {
  SAVE_VERSION, memoryStorage, safeStorage, defaultSave, migrate, importV1, createSaveManager,
} from '../src/economy/save.js';

const KEY = CONFIG.save.key;
const V1KEY = CONFIG.save.importKey;

function throwingStorage() {
  const boom = () => { throw new Error('storage disabled'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

/** Memory storage that records every setItem / removeItem key. */
function spyStorage() {
  const inner = memoryStorage();
  const writes = [];
  return {
    writes,
    getItem: (k) => inner.getItem(k),
    setItem: (k, v) => { writes.push(String(k)); inner.setItem(k, v); },
    removeItem: (k) => { writes.push('remove:' + String(k)); inner.removeItem(k); },
  };
}

const V1_SAVE = {
  v: 1,
  coins: 1234,
  best: 17,
  owned: { balls: ['classic', 'neon', 'fire'], stadiums: ['day', 'night'] },
  equipped: { ball: 'neon', stadium: 'night' },
  settings: { sound: false, haptics: true, showRail: true },
  noAds: true,
  lastGiftAt: 1000,
  lastRewardedCoinsAt: 2000,
  adCounter: 4,
  stats: { gamesPlayed: 12, totalGoals: 80, totalPerfects: 20, bestStreak: 5 },
};

test('keys: v2 save key, v1 import key, schema version 2', () => {
  assert.equal(KEY, 'flickgoal.save2');
  assert.equal(V1KEY, 'flickgoal.save');
  assert.equal(SAVE_VERSION, 2);
  assert.equal(CONFIG.save.version, 2);
});

test('defaultSave has the v2 schema', () => {
  const d = defaultSave();
  assert.equal(d.v, SAVE_VERSION);
  assert.equal(d.coins, CONFIG.economy.startingCoins);
  assert.deepEqual(d.best, { field: 0, endless: 0 });
  assert.equal(d.bestYards, 0);
  assert.deepEqual(d.owned, { balls: ['classic'], stadiums: ['day'], upgrades: [] });
  assert.deepEqual(d.equipped, { ball: 'classic', stadium: 'day' });
  assert.deepEqual(d.settings, { sound: true, haptics: true, aimSlider: true });
  assert.equal(d.mode, 'field');
  assert.deepEqual(d.tutorial, { kicks: 0 });
  assert.deepEqual(d.ui, { endlessTried: false, calloutShows: 0, calloutDone: false });
  assert.equal(d.noAds, false);
  assert.equal(d.lastGiftAt, 0);
  assert.equal(d.lastRewardedCoinsAt, 0);
  assert.equal(d.adCounter, 0);
  assert.deepEqual(d.stats, { gamesPlayed: 0, totalGoals: 0, totalPerfects: 0, bestStreak: 0 });
  assert.equal(d.importedV1, false);
});

test('memory storage roundtrip through the save manager', () => {
  const storage = memoryStorage();
  const a = createSaveManager({ storage });
  assert.equal(a.persisted, true);
  a.update((d) => {
    d.coins = 321;
    d.best.field = 17;
    d.best.endless = 9;
    d.bestYards = 140;
    d.owned.balls.push('neon');
    d.owned.upgrades.push('aim_slider');
    d.equipped.ball = 'neon';
    d.settings.sound = false;
    d.settings.aimSlider = false;
    d.mode = 'endless';
    d.tutorial.kicks = 2;
    d.ui.endlessTried = true;
  });
  assert.ok(storage.getItem(KEY), 'written under the v2 key');
  assert.equal(storage.getItem(V1KEY), null, 'never the v1 key');

  const b = createSaveManager({ storage });
  assert.equal(b.data.coins, 321);
  assert.deepEqual(b.data.best, { field: 17, endless: 9 });
  assert.equal(b.data.bestYards, 140);
  assert.deepEqual(b.data.owned.balls, ['classic', 'neon']);
  assert.deepEqual(b.data.owned.upgrades, ['aim_slider']);
  assert.equal(b.data.equipped.ball, 'neon');
  assert.equal(b.data.settings.sound, false);
  assert.equal(b.data.settings.aimSlider, false);
  assert.equal(b.data.mode, 'endless');
  assert.equal(b.data.tutorial.kicks, 2);
  assert.equal(b.data.ui.endlessTried, true);
});

test('import: a v1 save is imported once when the v2 key is absent; the v1 key is never written', () => {
  const storage = spyStorage();
  const v1raw = JSON.stringify(V1_SAVE);
  storage.setItem(V1KEY, v1raw);
  storage.writes.length = 0;
  const s = createSaveManager({ storage, now: () => 1e12 });
  assert.equal(s.imported, true);
  const d = s.data;
  assert.equal(d.importedV1, true);
  assert.equal(d.coins, 1234);
  assert.deepEqual(d.owned.balls, ['classic', 'neon', 'fire']);
  assert.deepEqual(d.owned.stadiums, ['day', 'night']);
  assert.deepEqual(d.owned.upgrades, []);
  assert.deepEqual(d.equipped, { ball: 'neon', stadium: 'night' });
  assert.deepEqual(d.best, { field: 17, endless: 17 }, 'v1 best counts for both modes');
  assert.deepEqual(d.settings, { sound: false, haptics: true, aimSlider: true });
  assert.equal(d.noAds, true);
  assert.equal(d.lastGiftAt, 1000);
  assert.equal(d.lastRewardedCoinsAt, 2000);
  assert.equal(d.adCounter, 4);
  assert.deepEqual(d.stats, V1_SAVE.stats);
  assert.equal(d.tutorial.kicks, 0, 'imported players get the slider tutorial too');
  assert.equal(d.mode, 'field');
  // play: several writes, none to the v1 key
  s.update((x) => { x.coins += 5; });
  s.update((x) => { x.best.field = 30; });
  s.reset();
  assert.ok(storage.writes.length >= 3);
  assert.ok(storage.writes.every((k) => k === KEY), `writes: ${storage.writes}`);
  assert.equal(storage.getItem(V1KEY), v1raw, 'v1 save byte-identical');

  // second launch: the v2 key exists, so no second import (reset progress stays reset)
  const again = createSaveManager({ storage });
  assert.equal(again.imported, false);
  assert.equal(again.data.coins, 0);
  assert.equal(again.data.noAds, true, 'reset keeps No Ads');
});

test('import: garbage / missing v1 data -> defaults; imported equipped must be owned', () => {
  for (const raw of ['garbage', '{bad', '[]', 'null', '42']) {
    const storage = memoryStorage();
    storage.setItem(V1KEY, raw);
    const s = createSaveManager({ storage });
    assert.equal(s.data.coins, 0, raw);
    assert.deepEqual(s.data.best, { field: 0, endless: 0 });
  }
  const d = importV1({ coins: 5, owned: { balls: ['classic'] }, equipped: { ball: 'gold', stadium: 'arcade' } });
  assert.deepEqual(d.equipped, { ball: 'classic', stadium: 'day' });
  assert.deepEqual(importV1(null), defaultSave());
  // no v1 save at all -> a fresh v2 save
  const fresh = createSaveManager({ storage: memoryStorage() });
  assert.equal(fresh.imported, false);
  assert.equal(fresh.data.importedV1, false);
});

test('throwing storage still works in memory and reports persisted === false', () => {
  const s = createSaveManager({ storage: throwingStorage() });
  assert.equal(s.persisted, false);
  assert.deepEqual(s.data, defaultSave());
  const out = s.update((d) => { d.coins += 50; });
  assert.equal(out.coins, 50);
  assert.equal(s.data.coins, 50);
  assert.equal(s.persisted, false);
  assert.doesNotThrow(() => s.reset());
});

test('safeStorage falls back to (volatile) memory storage outside the browser', () => {
  const st = safeStorage();
  assert.equal(st.volatile, true);
  assert.equal(createSaveManager({ storage: st }).persisted, false, 'memory fallback is not persistent');
  st.setItem('k', 'v');
  assert.equal(st.getItem('k'), 'v');
  st.removeItem('k');
  assert.equal(st.getItem('k'), null);
});

test('migrate: null / garbage / non-objects -> defaults', () => {
  for (const raw of [null, undefined, 'garbage', '{not json', 42, true, [], '[]', '"str"', 'null']) {
    assert.deepEqual(migrate(raw), defaultSave(), `input ${JSON.stringify(raw)}`);
  }
});

test('migrate: corrupt JSON in storage loads defaults without throwing', () => {
  const storage = memoryStorage();
  storage.setItem(KEY, '{"coins": 12, "owned": ');
  const s = createSaveManager({ storage });
  assert.deepEqual(s.data, defaultSave());
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), defaultSave());
});

test('migrate: coerces wrong types', () => {
  const m = migrate({
    v: 2,
    coins: -5,
    best: { field: '12', endless: -3 },
    bestYards: 'x',
    owned: 'nope',
    equipped: 7,
    settings: { sound: 'yes', haptics: false, aimSlider: 1 },
    mode: 'banana',
    tutorial: { kicks: 5000 },
    ui: { endlessTried: 'yes', calloutShows: 2.6, calloutDone: true },
    noAds: 'true',
    lastGiftAt: NaN,
    lastRewardedCoinsAt: -1,
    adCounter: 2.7,
    stats: { gamesPlayed: Infinity, totalGoals: 3.9, totalPerfects: null, bestStreak: '4' },
  });
  assert.equal(m.v, SAVE_VERSION);
  assert.equal(m.coins, 0);
  assert.deepEqual(m.best, { field: 12, endless: 0 });
  assert.equal(m.bestYards, 0);
  assert.deepEqual(m.owned, { balls: ['classic'], stadiums: ['day'], upgrades: [] });
  assert.deepEqual(m.equipped, { ball: 'classic', stadium: 'day' });
  assert.deepEqual(m.settings, { sound: true, haptics: false, aimSlider: true });
  assert.equal(m.mode, 'field');
  assert.equal(m.tutorial.kicks, 999);
  assert.deepEqual(m.ui, { endlessTried: false, calloutShows: 2, calloutDone: true });
  assert.equal(m.noAds, false, 'only a real boolean true grants noAds');
  assert.equal(m.lastGiftAt, 0);
  assert.equal(m.lastRewardedCoinsAt, 0);
  assert.equal(m.adCounter, 2);
  assert.deepEqual(m.stats, { gamesPlayed: 0, totalGoals: 3, totalPerfects: 0, bestStreak: 4 });
});

test('migrate: coins are floored integers', () => {
  assert.equal(migrate({ v: 2, coins: 99.99 }).coins, 99);
  assert.equal(migrate({ v: 2, coins: '250' }).coins, 250);
  assert.equal(migrate({ v: 2, coins: 1e400 }).coins, 0);
  assert.equal(migrate({ coins: 99.99 }).coins, 99, 'v1-shaped objects are imported');
});

test('migrate: unknown ids and unknown top-level keys are preserved; duplicates removed; defaults owned', () => {
  const m = migrate({
    v: 2,
    owned: { balls: ['neon', 'unicorn', 'neon', 5, 'gold', 'x'.repeat(80)], stadiums: ['moon', 'night', 'pro_night'], upgrades: ['aim_slider', 'turbo'] },
    equipped: { ball: 'unicorn', stadium: 'pro_night' },
    siblingField: { perfectStreak: 3 },
  });
  assert.deepEqual(m.owned.balls, ['classic', 'neon', 'unicorn', 'gold']);
  assert.deepEqual(m.owned.stadiums, ['day', 'moon', 'night', 'pro_night']);
  assert.deepEqual(m.owned.upgrades, ['aim_slider', 'turbo']);
  assert.equal(m.equipped.ball, 'classic', 'equipped must be a KNOWN item');
  assert.equal(m.equipped.stadium, 'pro_night');
  assert.deepEqual(m.siblingField, { perfectStreak: 3 }, 'unknown top-level keys survive');
  // survives a roundtrip through the manager
  const storage = memoryStorage();
  storage.setItem(KEY, JSON.stringify(m));
  const s = createSaveManager({ storage });
  s.update((d) => { d.coins += 1; });
  const back = JSON.parse(storage.getItem(KEY));
  assert.ok(back.owned.balls.includes('unicorn'));
  assert.deepEqual(back.siblingField, { perfectStreak: 3 });
});

test('migrate: equipped-but-not-owned falls back to defaults', () => {
  const m = migrate({
    v: 2,
    owned: { balls: ['classic', 'fire'], stadiums: ['day'] },
    equipped: { ball: 'galaxy', stadium: 'arcade' },
  });
  assert.equal(m.equipped.ball, 'classic');
  assert.equal(m.equipped.stadium, 'day');
});

test('migrate: accepts a JSON string and keeps valid data', () => {
  const src = { ...defaultSave(), coins: 77, noAds: true, best: { field: 5, endless: 8 } };
  const m = migrate(JSON.stringify(src));
  assert.equal(m.coins, 77);
  assert.equal(m.noAds, true);
  assert.deepEqual(m.best, { field: 5, endless: 8 });
});

test('reset wipes progress but keeps noAds, settings, timers, tutorial, ui and mode', () => {
  const storage = memoryStorage();
  const s = createSaveManager({ storage });
  s.update((d) => {
    d.coins = 999;
    d.best = { field: 40, endless: 22 };
    d.bestYards = 300;
    d.noAds = true;
    d.settings.sound = false;
    d.settings.haptics = false;
    d.owned.balls.push('fire');
    d.owned.upgrades.push('aim_slider');
    d.equipped.ball = 'fire';
    d.lastGiftAt = 123456;
    d.stats.gamesPlayed = 9;
    d.tutorial.kicks = 7;
    d.ui = { endlessTried: true, calloutShows: 2, calloutDone: true };
    d.mode = 'endless';
  });
  const r = s.reset();
  assert.equal(r, s.data);
  assert.equal(s.data.coins, CONFIG.economy.startingCoins);
  assert.deepEqual(s.data.best, { field: 0, endless: 0 });
  assert.equal(s.data.bestYards, 0);
  assert.equal(s.data.noAds, true);
  assert.deepEqual(s.data.settings, { sound: false, haptics: false, aimSlider: true });
  assert.deepEqual(s.data.owned.balls, ['classic']);
  assert.deepEqual(s.data.owned.upgrades, []);
  assert.equal(s.data.equipped.ball, 'classic');
  assert.equal(s.data.stats.gamesPlayed, 0);
  assert.equal(s.data.lastGiftAt, 123456);
  assert.equal(s.data.tutorial.kicks, 7);
  assert.deepEqual(s.data.ui, { endlessTried: true, calloutShows: 2, calloutDone: true });
  assert.equal(s.data.mode, 'endless');
  const again = createSaveManager({ storage });
  assert.equal(again.data.noAds, true);
  assert.equal(again.data.coins, CONFIG.economy.startingCoins);
});

test('migrate clamps future timestamps to now (corrupt save / clock set back)', () => {
  const now = 1_700_000_000_000;
  const d = migrate({ v: 2, lastGiftAt: 1e20, lastRewardedCoinsAt: now + 5000 }, CONFIG, now);
  assert.equal(d.lastGiftAt, now);
  assert.equal(d.lastRewardedCoinsAt, now);
  assert.equal(migrate({ v: 2, lastGiftAt: now - 10 }, CONFIG, now).lastGiftAt, now - 10);
  assert.equal(importV1({ lastGiftAt: 1e20 }, CONFIG, now).lastGiftAt, now);
});

test('a save from a newer version is used in memory but never overwritten', () => {
  const storage = memoryStorage();
  const future = JSON.stringify({ v: 3, coins: 321, best: { field: 12, endless: 4 }, futureField: { x: 1 } });
  storage.setItem(KEY, future);
  const s = createSaveManager({ storage });
  assert.equal(s.readOnly, true);
  assert.equal(s.data.coins, 321);
  assert.equal(s.data.best.field, 12);
  s.update((d) => { d.coins += 5; });
  assert.equal(s.data.coins, 326, 'still playable in memory');
  assert.equal(storage.getItem(KEY), future, 'newer save left untouched');
  assert.equal(s.persisted, false);
});

test('two tabs: a storage event on the v2 key is ingested so coins are not overwritten', () => {
  const storage = memoryStorage();
  const hooks = [];
  const listen = (k, fn) => { hooks.push({ k, fn }); };
  const a = createSaveManager({ storage, listen });
  const b = createSaveManager({ storage, listen });
  let changed = 0;
  b.onExternalChange(() => { changed++; });
  a.update((d) => { d.coins += 100; });
  hooks[1].fn(storage.getItem(KEY));
  assert.equal(changed, 1);
  b.update((d) => { d.coins += 1; });
  assert.equal(JSON.parse(storage.getItem(KEY)).coins, 101);
  assert.equal(hooks[0].k, KEY, 'listens on the v2 key only');
  assert.equal(b.ingest(''), false);
});
