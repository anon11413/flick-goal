import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import {
  SAVE_VERSION, memoryStorage, safeStorage, defaultSave, migrate, createSaveManager,
} from '../src/economy/save.js';

const KEY = CONFIG.save.key;

function throwingStorage() {
  const boom = () => { throw new Error('storage disabled'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

test('defaultSave has the v1 schema', () => {
  const d = defaultSave();
  assert.equal(d.v, SAVE_VERSION);
  assert.equal(d.v, CONFIG.save.version);
  assert.equal(d.coins, CONFIG.economy.startingCoins);
  assert.equal(d.best, 0);
  assert.deepEqual(d.owned, { balls: ['classic'], stadiums: ['day'] });
  assert.deepEqual(d.equipped, { ball: 'classic', stadium: 'day' });
  assert.deepEqual(d.settings, { sound: true, haptics: true });
  assert.equal(d.noAds, false);
  assert.equal(d.lastGiftAt, 0);
  assert.equal(d.lastRewardedCoinsAt, 0);
  assert.equal(d.adCounter, 0);
  assert.deepEqual(d.stats, { gamesPlayed: 0, totalGoals: 0, totalPerfects: 0, bestStreak: 0 });
});

test('memory storage roundtrip through the save manager', () => {
  const storage = memoryStorage();
  const a = createSaveManager({ storage });
  assert.equal(a.persisted, true);
  a.update((d) => {
    d.coins = 321;
    d.best = 17;
    d.owned.balls.push('neon');
    d.equipped.ball = 'neon';
    d.settings.sound = false;
  });
  assert.ok(storage.getItem(KEY), 'written under the configured key');

  const b = createSaveManager({ storage });
  assert.equal(b.data.coins, 321);
  assert.equal(b.data.best, 17);
  assert.deepEqual(b.data.owned.balls, ['classic', 'neon']);
  assert.equal(b.data.equipped.ball, 'neon');
  assert.equal(b.data.settings.sound, false);
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
  // and the normalized save was written back
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), defaultSave());
});

test('migrate: coerces wrong types', () => {
  const m = migrate({
    v: 'x',
    coins: -5,
    best: '12',
    owned: 'nope',
    equipped: 7,
    settings: { sound: 'yes', haptics: false },
    noAds: 'true',
    lastGiftAt: NaN,
    lastRewardedCoinsAt: -1,
    adCounter: 2.7,
    stats: { gamesPlayed: Infinity, totalGoals: 3.9, totalPerfects: null, bestStreak: '4' },
  });
  assert.equal(m.v, SAVE_VERSION);
  assert.equal(m.coins, 0);
  assert.equal(m.best, 12);
  assert.deepEqual(m.owned, { balls: ['classic'], stadiums: ['day'] });
  assert.deepEqual(m.equipped, { ball: 'classic', stadium: 'day' });
  assert.deepEqual(m.settings, { sound: true, haptics: false });
  assert.equal(m.noAds, false, 'only a real boolean true grants noAds');
  assert.equal(m.lastGiftAt, 0);
  assert.equal(m.lastRewardedCoinsAt, 0);
  assert.equal(m.adCounter, 2);
  assert.deepEqual(m.stats, { gamesPlayed: 0, totalGoals: 3, totalPerfects: 0, bestStreak: 4 });
});

test('migrate: coins are floored integers', () => {
  assert.equal(migrate({ coins: 99.99 }).coins, 99);
  assert.equal(migrate({ coins: '250' }).coins, 250);
  assert.equal(migrate({ coins: 1e400 }).coins, 0);
});

test('migrate: unknown ids dropped, duplicates removed, defaults always owned', () => {
  const m = migrate({
    owned: { balls: ['neon', 'unicorn', 'neon', 5, 'gold'], stadiums: ['moon', 'night'] },
    equipped: { ball: 'gold', stadium: 'night' },
  });
  assert.deepEqual(m.owned.balls, ['classic', 'neon', 'gold']);
  assert.deepEqual(m.owned.stadiums, ['day', 'night']);
  assert.deepEqual(m.equipped, { ball: 'gold', stadium: 'night' });
});

test('migrate: equipped-but-not-owned falls back to defaults', () => {
  const m = migrate({
    owned: { balls: ['classic', 'fire'], stadiums: ['day'] },
    equipped: { ball: 'galaxy', stadium: 'arcade' },
  });
  assert.equal(m.equipped.ball, 'classic');
  assert.equal(m.equipped.stadium, 'day');
});

test('migrate: accepts a JSON string and keeps valid data', () => {
  const src = { ...defaultSave(), coins: 77, noAds: true, best: 5 };
  const m = migrate(JSON.stringify(src));
  assert.equal(m.coins, 77);
  assert.equal(m.noAds, true);
  assert.equal(m.best, 5);
});

test('reset keeps noAds and settings (and gift timers), wipes the rest', () => {
  const storage = memoryStorage();
  const s = createSaveManager({ storage });
  s.update((d) => {
    d.coins = 999;
    d.best = 40;
    d.noAds = true;
    d.settings.sound = false;
    d.settings.haptics = false;
    d.owned.balls.push('fire');
    d.equipped.ball = 'fire';
    d.lastGiftAt = 123456;
    d.stats.gamesPlayed = 9;
  });
  const r = s.reset();
  assert.equal(r, s.data);
  assert.equal(s.data.coins, CONFIG.economy.startingCoins);
  assert.equal(s.data.best, 0);
  assert.equal(s.data.noAds, true);
  assert.deepEqual(s.data.settings, { sound: false, haptics: false });
  assert.deepEqual(s.data.owned.balls, ['classic']);
  assert.equal(s.data.equipped.ball, 'classic');
  assert.equal(s.data.stats.gamesPlayed, 0);
  assert.equal(s.data.lastGiftAt, 123456);
  // persisted
  const again = createSaveManager({ storage });
  assert.equal(again.data.noAds, true);
  assert.equal(again.data.coins, CONFIG.economy.startingCoins);
});

test('migrate clamps future timestamps to now (corrupt save / clock set back)', async () => {
  const { migrate } = await import('../src/economy/save.js');
  const now = 1_700_000_000_000;
  const d = migrate({ lastGiftAt: 1e20, lastRewardedCoinsAt: now + 5000 }, CONFIG, now);
  assert.equal(d.lastGiftAt, now);
  assert.equal(d.lastRewardedCoinsAt, now);
  assert.equal(migrate({ lastGiftAt: now - 10 }, CONFIG, now).lastGiftAt, now - 10);
});

test('a save from a newer version is used in memory but never overwritten', () => {
  const storage = memoryStorage();
  const key = CONFIG.save.key;
  const future = JSON.stringify({ v: 99, coins: 321, best: 12, futureField: { x: 1 } });
  storage.setItem(key, future);
  const s = createSaveManager({ storage });
  assert.equal(s.readOnly, true);
  assert.equal(s.data.coins, 321);
  assert.equal(s.data.best, 12);
  s.update((d) => { d.coins += 5; });
  assert.equal(s.data.coins, 326, 'still playable in memory');
  assert.equal(storage.getItem(key), future, 'newer save left untouched');
  assert.equal(s.persisted, false);
});

test('two tabs: a storage event from the other tab is ingested so coins are not overwritten', () => {
  const storage = memoryStorage();
  const key = CONFIG.save.key;
  const hooks = [];
  const listen = (k, fn) => { hooks.push({ k, fn }); };
  const a = createSaveManager({ storage, listen });
  const b = createSaveManager({ storage, listen });
  let changed = 0;
  b.onExternalChange(() => { changed++; });
  a.update((d) => { d.coins += 100; });
  // the browser fires 'storage' in every OTHER tab after a write
  hooks[1].fn(storage.getItem(key));
  assert.equal(changed, 1);
  b.update((d) => { d.coins += 1; });
  assert.equal(JSON.parse(storage.getItem(key)).coins, 101);
  assert.equal(hooks[0].k, key);
  assert.equal(b.ingest(''), false);
});
