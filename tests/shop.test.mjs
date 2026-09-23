import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createSaveManager, memoryStorage } from '../src/economy/save.js';
import { createShop } from '../src/economy/shop.js';

const HOUR = 3600 * 1000;

function setup({ coins = 0, t = 1_700_000_000_000, rng = () => 0.5 } = {}) {
  const save = createSaveManager({ storage: memoryStorage() });
  if (coins) save.update((d) => { d.coins = coins; });
  const clock = { t };
  const shop = createShop({ save, now: () => clock.t, rng });
  return { save, shop, clock };
}

const price = (kind, id) =>
  CONFIG.catalog[kind === 'ball' ? 'balls' : 'stadiums'].find((i) => i.id === id).price;

test('items() reflect owned / equipped state', () => {
  const { shop } = setup();
  const balls = shop.items('ball');
  assert.equal(balls.length, CONFIG.catalog.balls.length);
  const classic = balls.find((b) => b.id === 'classic');
  assert.deepEqual(classic, { id: 'classic', name: 'Classic', price: 0, owned: true, equipped: true });
  assert.ok(balls.filter((b) => b.id !== 'classic').every((b) => !b.owned && !b.equipped));
  assert.equal(shop.items('stadium').length, CONFIG.catalog.stadiums.length);
  assert.deepEqual(shop.items('hat'), []);
});

test('buy: success deducts coins and grants ownership (does not auto-equip)', () => {
  const { shop, save } = setup({ coins: 1000 });
  const p = price('ball', 'neon');
  assert.deepEqual(shop.buy('ball', 'neon'), { ok: true });
  assert.equal(shop.coins(), 1000 - p);
  assert.ok(shop.isOwned('ball', 'neon'));
  assert.equal(shop.equipped('ball'), 'classic');
  assert.ok(save.data.owned.balls.includes('neon'));
});

test('buy: owned / insufficient / unknown', () => {
  const { shop } = setup({ coins: 100 });
  assert.deepEqual(shop.buy('ball', 'classic'), { ok: false, reason: 'owned' });
  const p = price('ball', 'gold');
  assert.deepEqual(shop.buy('ball', 'gold'), { ok: false, reason: 'insufficient', need: p - 100 });
  assert.equal(shop.coins(), 100, 'no coins spent on failure');
  assert.equal(shop.isOwned('ball', 'gold'), false);
  assert.deepEqual(shop.buy('ball', 'unicorn'), { ok: false, reason: 'unknown' });
  assert.deepEqual(shop.buy('hat', 'classic'), { ok: false, reason: 'unknown' });
  assert.deepEqual(shop.buy('stadium', 'night'), { ok: false, reason: 'insufficient', need: price('stadium', 'night') - 100 });
});

test('buy: exact balance works and a second buy reports owned', () => {
  const p = price('stadium', 'night');
  const { shop } = setup({ coins: p });
  assert.equal(shop.buy('stadium', 'night').ok, true);
  assert.equal(shop.coins(), 0);
  assert.equal(shop.buy('stadium', 'night').reason, 'owned');
});

test('equip: locked / unknown / success persists', () => {
  const { shop, save } = setup({ coins: 5000 });
  assert.deepEqual(shop.equip('ball', 'fire'), { ok: false, reason: 'locked' });
  assert.deepEqual(shop.equip('ball', 'nope'), { ok: false, reason: 'unknown' });
  shop.buy('ball', 'fire');
  assert.deepEqual(shop.equip('ball', 'fire'), { ok: true });
  assert.equal(shop.equipped('ball'), 'fire');
  assert.equal(save.data.equipped.ball, 'fire');
  const fire = shop.items('ball').find((b) => b.id === 'fire');
  assert.equal(fire.equipped, true);
  shop.buy('stadium', 'snow');
  shop.equip('stadium', 'snow');
  assert.equal(shop.equipped('stadium'), 'snow');
});

test('addCoins / spendCoins validation', () => {
  const { shop } = setup();
  assert.equal(shop.addCoins(0, 'goal'), false);
  assert.equal(shop.addCoins(-5, 'goal'), false);
  assert.equal(shop.addCoins(NaN, 'goal'), false);
  assert.equal(shop.addCoins(3.7, 'goal'), true);
  assert.equal(shop.coins(), 3);
  assert.equal(shop.spendCoins(5), false);
  assert.equal(shop.spendCoins(2), true);
  assert.equal(shop.coins(), 1);
});

test('gift: ready at start, 4h cooldown, then ready again', () => {
  const { shop, clock } = setup();
  assert.deepEqual(shop.giftStatus(), { ready: true, msLeft: 0 });
  const r = shop.claimGift();
  assert.equal(r.ok, true);
  assert.equal(shop.coins(), r.amount);

  const st = shop.giftStatus();
  assert.equal(st.ready, false);
  assert.equal(st.msLeft, CONFIG.economy.gift.cooldownMs);
  assert.equal(CONFIG.economy.gift.cooldownMs, 4 * HOUR);

  const again = shop.claimGift();
  assert.equal(again.ok, false);
  assert.equal(again.msLeft, 4 * HOUR);
  assert.equal(shop.coins(), r.amount, 'no double claim');

  clock.t += 4 * HOUR - 1000;
  assert.equal(shop.giftStatus().ready, false);
  assert.equal(shop.giftStatus().msLeft, 1000);
  clock.t += 1000;
  assert.equal(shop.giftStatus().ready, true);
  assert.equal(shop.claimGift().ok, true);
});

test('gift: amount is a multiple of step within [min, max] across the rng range', () => {
  const g = CONFIG.economy.gift;
  const seen = new Set();
  for (const r of [0, 0.0001, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99999, 0.9999999999, 1]) {
    const { shop } = setup({ rng: () => r });
    const { amount } = shop.claimGift();
    assert.ok(amount >= g.min && amount <= g.max, `amount ${amount} for rng ${r}`);
    assert.equal((amount - g.min) % g.step, 0);
    seen.add(amount);
  }
  assert.ok(seen.has(g.min) && seen.has(g.max), 'both ends reachable');
});

test('gift: a clock set backwards never locks longer than one cooldown', () => {
  const { shop, save, clock } = setup();
  save.update((d) => { d.lastGiftAt = clock.t + 100 * HOUR; });
  assert.equal(shop.giftStatus().msLeft, CONFIG.economy.gift.cooldownMs);
});

test('rewarded coins respect the cooldown', () => {
  const { shop, clock } = setup();
  assert.equal(shop.rewardedCoinsStatus().ready, true);
  assert.deepEqual(shop.grantRewardedCoins(), { ok: true, amount: CONFIG.economy.rewardedCoins });
  assert.equal(shop.coins(), CONFIG.economy.rewardedCoins);
  const st = shop.rewardedCoinsStatus();
  assert.equal(st.ready, false);
  assert.equal(st.msLeft, CONFIG.economy.rewardedCoinsCooldownMs);
  assert.equal(shop.grantRewardedCoins().ok, false);
  clock.t += CONFIG.economy.rewardedCoinsCooldownMs;
  assert.equal(shop.grantRewardedCoins().ok, true);
  assert.equal(shop.coins(), 2 * CONFIG.economy.rewardedCoins);
});

test('applyProduct grants noAds and coin packs', () => {
  const { shop, save } = setup();
  assert.equal(shop.hasNoAds(), false);
  assert.deepEqual(shop.applyProduct('no_ads'), { ok: true, noAds: true });
  assert.equal(shop.hasNoAds(), true);
  assert.equal(save.data.noAds, true);
  assert.deepEqual(shop.applyProduct('coins_500'), { ok: true, coins: 500 });
  assert.equal(shop.coins(), 500);
  assert.deepEqual(shop.applyProduct('bogus'), { ok: false });
  shop.setNoAds(false);
  assert.equal(shop.hasNoAds(), false);
});

test('change listener fires for coins / owned / equip / noAds and can unsubscribe', () => {
  const { shop } = setup({ coins: 1000 });
  const events = [];
  const off = shop.on((e) => events.push(e));
  shop.addCoins(10, 'goal');
  shop.buy('ball', 'retro');
  shop.equip('ball', 'retro');
  shop.equip('ball', 'retro'); // no-op: already equipped, no event
  shop.setNoAds(true);
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['coins', 'coins', 'owned', 'equip', 'noAds']);
  assert.equal(events[0].coins, 1010);
  assert.equal(events[0].source, 'goal');
  assert.deepEqual({ kind: events[2].kind, id: events[2].id }, { kind: 'ball', id: 'retro' });
  off();
  shop.addCoins(1, 'goal');
  assert.equal(events.length, 5);
});

test('a throwing listener does not break the shop', () => {
  const { shop } = setup();
  const orig = console.error;
  console.error = () => {};
  try {
    shop.on(() => { throw new Error('bad listener'); });
    assert.equal(shop.addCoins(5, 'goal'), true);
    assert.equal(shop.coins(), 5);
  } finally {
    console.error = orig;
  }
});

test('gift cooldown recovers when the stored timestamp is in the future (clock set back)', () => {
  const { shop, clock, save } = setup();
  assert.equal(shop.claimGift().ok, true);
  clock.t -= 48 * HOUR; // device clock corrected two days backwards
  const st = shop.giftStatus();
  assert.equal(st.ready, false);
  assert.equal(st.msLeft, CONFIG.economy.gift.cooldownMs, 'at most one cooldown');
  assert.equal(save.data.lastGiftAt, clock.t, 'future timestamp pulled back to now');
  clock.t += 2 * HOUR;
  assert.equal(shop.giftStatus().msLeft, CONFIG.economy.gift.cooldownMs - 2 * HOUR, 'countdown moves');
  clock.t += CONFIG.economy.gift.cooldownMs;
  assert.equal(shop.giftStatus().ready, true, 'ready after one cooldown, not 52h');
});

test('rewarded-coin cooldown also recovers from a future timestamp', () => {
  const { shop, clock, save } = setup();
  save.update((d) => { d.lastRewardedCoinsAt = clock.t + 1e12; });
  assert.equal(shop.rewardedCoinsStatus().msLeft, CONFIG.economy.rewardedCoinsCooldownMs);
  clock.t += CONFIG.economy.rewardedCoinsCooldownMs;
  assert.equal(shop.rewardedCoinsStatus().ready, true);
});
