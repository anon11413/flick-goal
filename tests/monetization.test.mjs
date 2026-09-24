// Monetization: AdMob ads provider, RevenueCat purchases provider, adapter selection + interstitial
// policy, the exactly-once coin ledger and the player-facing texts. Real plugin SDKs are replaced
// by fakes (tests/fakes/fakeCapacitor.js) that mirror their documented / source-verified behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import './fakes/fakeCapacitor.js';
import { CONFIG } from '../src/config.js';
import { createSaveManager, memoryStorage, migrate } from '../src/economy/save.js';
import { createShop } from '../src/economy/shop.js';
import { createAdMobAdsProvider, GOOGLE_TEST_IDS, forceTestAds } from '../src/platform/admob.js';
import { createRevenueCatIapProvider, revenueCatApiKey } from '../src/platform/revenuecat.js';
import { createMonetization, selectProviders } from '../src/platform/monetization.js';
import { purchaseErrorText, restoreText, rewardedFailText, pendingText, NO_AD_TEXT } from '../src/ui/iapText.js';

const Fake = globalThis.FakeCapacitor;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info() {}, warn() {}, error() {}, log() {} };

const DEBUG = { profile: 'android-debug', adMode: 'test' };
const RELEASE_LIVE = { profile: 'android-release', adMode: 'live' };

function cfgFor({ build = DEBUG, googleApiKey = 'goog_fake_public', testStoreApiKey = '', mon = {}, admob = {} } = {}) {
  return {
    ...CONFIG,
    build,
    store: {
      ...CONFIG.store,
      admob: { ...CONFIG.store.admob, ...admob },
      revenuecat: { ...CONFIG.store.revenuecat, googleApiKey, testStoreApiKey },
    },
    monetization: {
      ...CONFIG.monetization,
      rewardedLoadTimeoutMs: 120,
      loadTimeoutMs: 150,
      preloadRetryMs: [60000],
      rewardGraceMs: 40,
      showTimeoutMs: 400,
      resumeWatchdogMs: 40,
      consentTimeoutMs: 150,
      readyTimeoutMs: 1500,
      resumeSyncMinGapMs: 0,
      ...mon,
    },
  };
}

function newSave(storage = memoryStorage()) {
  const save = createSaveManager({ storage, listen: () => {} });
  const shop = createShop({ save });
  return { save, shop, storage };
}

function admobSetup({ behavior, build = DEBUG, admob, mon, win = null } = {}) {
  const AdMob = Fake.createAdMob({ behavior });
  const cfg = cfgFor({ build, admob, mon });
  const busy = { n: 0, max: 0 };
  const loading = { shown: 0, hidden: 0, cancel: null };
  const p = createAdMobAdsProvider({
    AdMob, cfg, build,
    onBusy: (d) => { busy.n += d; busy.max = Math.max(busy.max, busy.n); },
    hooks: { showLoading: (cancel) => { loading.shown++; loading.cancel = cancel; return () => { loading.hidden++; }; } },
    log: quiet,
    win,
  });
  return { AdMob, cfg, p, busy, loading };
}
const names = (AdMob) => AdMob.calls.map((c) => c.name);
const callOf = (AdMob, name) => AdMob.calls.find((c) => c.name === name);
async function untilReady(p, ms = 300) {
  const t0 = Date.now();
  while (p.rewardedState() !== 'ready' && Date.now() - t0 < ms) await sleep(5);
}

// ============================================================================ AdMob: consent + init
test('ads: consent NOT required -> initialize after consent info, then preload with Google test units', async () => {
  const { AdMob, p } = admobSetup();
  await p.init();
  const n = names(AdMob);
  assert.ok(n.indexOf('requestConsentInfo') < n.indexOf('initialize'), 'consent info before initialize');
  assert.ok(!n.includes('showConsentForm'));
  const init = callOf(AdMob, 'initialize').args;
  assert.equal(init.tagForChildDirectedTreatment, false);
  assert.equal(init.maxAdContentRating, 'ParentalGuidance');
  await untilReady(p);
  const prep = callOf(AdMob, 'prepareRewardVideoAd').args;
  assert.equal(prep.adId, GOOGLE_TEST_IDS.rewarded);
  assert.equal(prep.isTesting, true);
  assert.equal(callOf(AdMob, 'prepareInterstitial').args.adId, GOOGLE_TEST_IDS.interstitial);
  assert.equal(p.rewardedState(), 'ready');
  assert.equal(p.privacyRequired(), false);
  p.dispose();
});

test('ads: consent REQUIRED -> form shown (busy) BEFORE initialize; privacy options row becomes required', async () => {
  const { AdMob, p, busy } = admobSetup({
    behavior: { consent: { status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' } },
  });
  await p.init();
  const n = names(AdMob);
  assert.ok(n.indexOf('showConsentForm') > n.indexOf('requestConsentInfo'));
  assert.ok(n.indexOf('showConsentForm') < n.indexOf('initialize'), 'form before initialize');
  assert.equal(busy.max, 1, 'busy while the form is up');
  assert.equal(busy.n, 0);
  assert.equal(p.privacyRequired(), true);
  const r = await p.showPrivacyOptions();
  assert.equal(r.ok, true);
  assert.ok(names(AdMob).includes('showPrivacyOptionsForm'));
  p.dispose();
});

test('ads: consent denied (canRequestAds false) -> never initialized, rewarded unavailable, show -> no_ad', async () => {
  const { AdMob, p } = admobSetup({
    behavior: {
      consent: { status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' },
      consentAfterForm: { status: 'OBTAINED', isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' },
    },
  });
  await p.init();
  assert.ok(!names(AdMob).includes('initialize'));
  assert.equal(p.rewardedState(), 'unavailable');
  const r = await p.showRewarded('continue');
  assert.deepEqual(r, { rewarded: false, shown: false, error: 'no_ad' });
  assert.equal(p.interstitialReady(), false);
  p.dispose();
});

test('ads: consent info fails (offline) -> unavailable, retried on resume', async () => {
  const { AdMob, p } = admobSetup({ behavior: { consentFail: true } });
  await p.init();
  assert.equal(p.rewardedState(), 'unavailable');
  AdMob.behavior.consentFail = false;
  p.onResume();
  await sleep(40);
  await untilReady(p);
  assert.ok(names(AdMob).includes('initialize'));
  assert.equal(p.rewardedState(), 'ready');
  p.dispose();
});

test('ads: release + live uses the configured units without test mode; release + test keeps test units', async () => {
  assert.equal(forceTestAds(DEBUG), true);
  assert.equal(forceTestAds({ profile: 'android-release', adMode: 'test' }), true);
  assert.equal(forceTestAds(RELEASE_LIVE), false);
  const real = { rewarded: 'ca-app-pub-1111111111111111/2222222222', interstitial: 'ca-app-pub-1111111111111111/3333333333' };
  const { AdMob, p } = admobSetup({ build: RELEASE_LIVE, admob: real });
  await p.init();
  await untilReady(p);
  const prep = callOf(AdMob, 'prepareRewardVideoAd').args;
  assert.equal(prep.adId, real.rewarded);
  assert.equal(prep.isTesting, false);
  p.dispose();
});

// ============================================================================ AdMob: rewarded
test('rewarded: reward event then dismiss -> rewarded; the next ad is preloaded', async () => {
  const { AdMob, p, busy } = admobSetup();
  await p.init();
  await untilReady(p);
  const before = AdMob.calls.filter((c) => c.name === 'prepareRewardVideoAd').length;
  const r = await p.showRewarded('continue');
  assert.deepEqual(r, { rewarded: true, shown: true });
  assert.equal(busy.n, 0, 'busy cleared');
  await sleep(20);
  assert.equal(AdMob.calls.filter((c) => c.name === 'prepareRewardVideoAd').length, before + 1, 'preloaded again');
  p.dispose();
});

test('rewarded: closed early (dismiss, show() never settles) -> resolves NOT rewarded', async () => {
  const { p } = admobSetup({ behavior: { rewarded: 'skip' } });
  await p.init();
  await untilReady(p);
  const t0 = Date.now();
  const r = await p.showRewarded('continue');
  assert.deepEqual(r, { rewarded: false, shown: true });
  assert.ok(Date.now() - t0 < 300, 'finished on the dismissed event, not a timeout');
  p.dispose();
});

test('rewarded: a reward arriving just after dismiss (grace window) still counts', async () => {
  const { p } = admobSetup({ behavior: { rewarded: 'late_reward' } });
  await p.init();
  await untilReady(p);
  const r = await p.showRewarded('double_coins');
  assert.equal(r.rewarded, true);
  p.dispose();
});

test('rewarded: failed to show -> not rewarded, error show_failed; rejected show too', async () => {
  const a = admobSetup({ behavior: { rewarded: 'fail_show' } });
  await a.p.init();
  await untilReady(a.p);
  assert.deepEqual(await a.p.showRewarded('x'), { rewarded: false, shown: false, error: 'show_failed' });
  a.p.dispose();
  const b = admobSetup({ behavior: { rewarded: 'reject' } });
  await b.p.init();
  await untilReady(b.p);
  assert.deepEqual(await b.p.showRewarded('x'), { rewarded: false, shown: false, error: 'show_failed' });
  b.p.dispose();
});

test('rewarded: no fill -> "Loading video" overlay, then no_ad (friendly), nothing granted, busy cleared', async () => {
  const { p, loading, busy } = admobSetup({ behavior: { prepare: 'nofill' } });
  await p.init();
  await sleep(20);
  assert.equal(p.rewardedState(), 'loading', 'buttons stay visible: a tap retries and explains');
  const r = await p.showRewarded('continue');
  assert.deepEqual(r, { rewarded: false, shown: false, error: 'no_ad' });
  assert.equal(loading.shown, 1);
  assert.equal(loading.hidden, 1);
  assert.equal(busy.n, 0);
  p.dispose();
});

test('rewarded: a load that never answers times out -> no_ad within rewardedLoadTimeoutMs', async () => {
  const { p } = admobSetup({ behavior: { prepare: 'hang' } });
  await p.init();
  const t0 = Date.now();
  const r = await p.showRewarded('continue');
  assert.equal(r.error, 'no_ad');
  assert.ok(Date.now() - t0 < 400);
  p.dispose();
});

test('rewarded: Cancel on the loading overlay -> cancelled (no toast needed), nothing granted', async () => {
  const { p, loading } = admobSetup({ behavior: { prepare: 'hang' } });
  await p.init();
  const pr = p.showRewarded('continue');
  await sleep(10);
  loading.cancel();
  assert.deepEqual(await pr, { rewarded: false, shown: false, error: 'cancelled' });
  p.dispose();
});

test('rewarded: no dismissed event but the app resumed -> watchdog finishes (never soft-locks)', async () => {
  const { AdMob, p } = admobSetup({ behavior: { rewarded: 'skip', adMs: 100000 } });
  await p.init();
  await untilReady(p);
  const pr = p.showRewarded('continue');
  await sleep(10);
  p.onPause();      // the ad activity covered the game
  AdMob.emit('onRewardedVideoAdReward', { type: 'coins', amount: 1 });
  p.onResume();     // back in the game, but the plugin lost the dismissed event
  const r = await pr;
  assert.deepEqual(r, { rewarded: true, shown: true });
  p.dispose();
});

// ============================================================================ selection
test('selectProviders: web dev -> mock; web release -> off; Android -> AdMob + RevenueCat (key needed)', () => {
  const dev = cfgFor({ build: { profile: 'dev', adMode: 'test' } });
  assert.deepEqual(selectProviders({ cfg: dev, cap: null }), { ads: 'mock', iap: 'mock', apiKey: '', native: false });
  const web = cfgFor({ build: { profile: 'web-release', adMode: 'test' } });
  assert.deepEqual(selectProviders({ cfg: web, cap: null }), { ads: null, iap: null, apiKey: '', native: false });
  const cap = Fake.makeCapacitor({ AdMob: Fake.createAdMob(), Purchases: Fake.createPurchases() });
  const s = selectProviders({ cfg: cfgFor(), cap });
  assert.equal(s.ads, 'admob');
  assert.equal(s.iap, 'revenuecat');
  assert.equal(s.apiKey, 'goog_fake_public');
  const noKey = selectProviders({ cfg: cfgFor({ googleApiKey: '' }), cap });
  assert.equal(noKey.ads, 'admob');
  assert.equal(noKey.iap, null, 'no RevenueCat key yet: purchases hidden, never mock on a phone');
  const off = cfgFor({ mon: { mode: 'off' } });
  assert.deepEqual(selectProviders({ cfg: off, cap }), { ads: null, iap: null, apiKey: '', native: true });
  const iosCap = Fake.makeCapacitor({ AdMob: Fake.createAdMob() }, 'ios');
  assert.equal(selectProviders({ cfg: cfgFor(), cap: iosCap }).ads, null, 'Android only for now');
});

test('revenueCatApiKey: release uses only the Google key; debug prefers the Test Store key; never a secret key', () => {
  assert.equal(revenueCatApiKey(cfgFor({ googleApiKey: 'goog_x', testStoreApiKey: 'test_y' }), DEBUG), 'test_y');
  assert.equal(revenueCatApiKey(cfgFor({ googleApiKey: 'goog_x', testStoreApiKey: 'test_y' }), RELEASE_LIVE), 'goog_x');
  assert.equal(revenueCatApiKey(cfgFor({ googleApiKey: '', testStoreApiKey: 'test_y' }), RELEASE_LIVE), '');
  assert.equal(revenueCatApiKey(cfgFor({ googleApiKey: 'test_z' }), RELEASE_LIVE), '');
  assert.equal(revenueCatApiKey(cfgFor({ googleApiKey: 'sk_secret' }), DEBUG), '');
});

// ============================================================================ adapter: interstitial policy
async function adapter({ storage = memoryStorage(), admobBehavior, purchases, cfg = cfgFor(), now } = {}) {
  const { save, shop } = newSave(storage);
  const AdMob = Fake.createAdMob({ behavior: admobBehavior });
  const Purchases = purchases || Fake.createPurchases();
  const cap = Fake.makeCapacitor({ AdMob, Purchases, App: Fake.createApp() });
  const mon = createMonetization({ cfg, shop, save, root: null, win: { Capacitor: cap }, now, log: quiet });
  await mon.ready;
  return { mon, save, shop, AdMob, Purchases, cap, storage };
}
async function interstitialReady(mon, AdMob) {
  const t0 = Date.now();
  while (!AdMob.calls.some((c) => c.name === 'prepareInterstitial') && Date.now() - t0 < 300) await sleep(5);
  await sleep(20);
}

test('interstitial: never in the first session; every N game overs after that; resets after showing', async () => {
  const storage = memoryStorage();
  const clock = { t: 1_800_000_000_000 };
  const a = await adapter({ storage, now: () => clock.t });
  assert.equal(a.save.data.adState.sessions, 1);
  a.save.update((d) => { d.stats.gamesPlayed = 10; });
  await interstitialReady(a.mon, a.AdMob);
  for (let i = 0; i < 4; i++) assert.equal((await a.mon.maybeInterstitial()).shown, false, 'first session');
  assert.equal(a.save.data.adCounter, CONFIG.monetization.interstitialEvery, 'counter waits at the threshold');
  a.mon.dispose();

  const b = await adapter({ storage, now: () => clock.t }); // second cold start
  assert.equal(b.save.data.adState.sessions, 2);
  await interstitialReady(b.mon, b.AdMob);
  assert.equal((await b.mon.maybeInterstitial()).shown, true, 'due right away in session 2');
  assert.equal(b.save.data.adCounter, 0);
  assert.equal(b.save.data.adState.lastInterstitialAt, clock.t);
  // min gap: counter reaches N again but the gap blocks
  for (let i = 0; i < CONFIG.monetization.interstitialEvery; i++) {
    b.mon.onGameOver();
    assert.equal((await b.mon.maybeInterstitial()).shown, false);
  }
  clock.t += CONFIG.monetization.interstitialMinGapMs;
  await sleep(30); // the next interstitial preloads after each show
  b.mon.onGameOver();
  assert.equal((await b.mon.maybeInterstitial()).shown, true, 'shown once the gap passed');
  b.mon.dispose();
});

test('interstitial: never right after a rewarded ad, never for No Ads owners, never waits for a load', async () => {
  const storage = memoryStorage();
  const clock = { t: 1_800_000_000_000 };
  const seed = newSave(storage);
  seed.save.update((d) => { d.adState.sessions = 5; d.stats.gamesPlayed = 10; d.adCounter = 2; });
  const a = await adapter({ storage, now: () => clock.t });
  await interstitialReady(a.mon, a.AdMob);
  await untilReady({ rewardedState: () => a.mon.ads.rewardedState() });
  const rw = await a.mon.ads.showRewarded('double_coins');
  assert.equal(rw.rewarded, true);
  assert.equal((await a.mon.maybeInterstitial()).shown, false, 'rewarded in this game over');
  a.mon.onGameOver();
  assert.equal((await a.mon.maybeInterstitial()).shown, false, 'within afterRewardedGapMs');
  clock.t += CONFIG.monetization.afterRewardedGapMs + 1;
  a.shop.setNoAds(true);
  assert.equal((await a.mon.maybeInterstitial()).shown, false, 'No Ads suppresses interstitials');
  assert.equal((await a.mon.ads.showInterstitial()).shown, false);
  const rw2 = await a.mon.ads.showRewarded('store_coins');
  assert.equal(rw2.rewarded, true, 'rewarded stays available (optional, user-initiated) with No Ads');
  a.mon.dispose();

  // nothing loaded (no fill) -> skipped silently without waiting
  const storage2 = memoryStorage();
  const seed2 = newSave(storage2);
  seed2.save.update((d) => { d.adState.sessions = 5; d.stats.gamesPlayed = 10; d.adCounter = 2; });
  const b = await adapter({ storage: storage2, admobBehavior: { prepareInterstitial: 'nofill' } });
  await sleep(30);
  const t0 = Date.now();
  assert.equal((await b.mon.maybeInterstitial()).shown, false);
  assert.ok(Date.now() - t0 < 50, 'no spinner, no wait');
  assert.equal(b.save.data.adCounter, CONFIG.monetization.interstitialEvery, 'still due next time');
  b.mon.dispose();
});

// ============================================================================ RevenueCat
function rcSetup({ storage = memoryStorage(), purchases, build = DEBUG, apiKey = 'goog_fake_public' } = {}) {
  const { save, shop } = newSave(storage);
  const Purchases = purchases || Fake.createPurchases();
  const busy = { n: 0 };
  const p = createRevenueCatIapProvider({ Purchases, cfg: cfgFor({ build }), build, shop, apiKey, onBusy: (d) => { busy.n += d; }, log: quiet });
  const grants = [];
  p.onGrant((g) => grants.push(g));
  return { p, save, shop, Purchases, storage, busy, grants };
}

test('iap: products fetched as NON_SUBSCRIPTION one-time products; localized prices shown', async () => {
  const { p, Purchases } = rcSetup();
  await p.init();
  const gp = Purchases.calls.find((c) => c.name === 'getProducts').args;
  assert.equal(gp.type, 'NON_SUBSCRIPTION');
  assert.deepEqual(gp.productIdentifiers, CONFIG.products.map((x) => x.id));
  assert.equal(p.productsState(), 'ready');
  const list = p.products();
  assert.equal(list.find((x) => x.id === 'coins_small').priceString, '€1.09');
  assert.equal(list.find((x) => x.id === 'coins_mega').coins, 22000);
  assert.ok(list.every((x) => x.available));
  const cfgCall = Purchases.calls.find((c) => c.name === 'configure').args;
  assert.equal(cfgCall.apiKey, 'goog_fake_public');
});

test('iap: store unreachable -> products unavailable (no fake prices), retry succeeds', async () => {
  const Purchases = Fake.createPurchases({ behavior: { getProducts: 'fail' } });
  const { p } = rcSetup({ purchases: Purchases });
  await p.init();
  assert.equal(p.productsState(), 'error');
  assert.ok(p.products().every((x) => x.priceString === null && !x.available));
  const r = await p.purchase('coins_small');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'store_unavailable');
  Purchases.behavior.getProducts = 'ok';
  await p.fetchProducts();
  assert.equal(p.productsState(), 'ready');
});

test('iap: purchase grants the exact coins ONCE (listener + result duplicates, relaunch)', async () => {
  const storage = memoryStorage();
  const Purchases = Fake.createPurchases(); // listener fires before the result, both list the tx
  const a = rcSetup({ storage, purchases: Purchases });
  await a.p.init();
  const r = await a.p.purchase('coins_medium');
  assert.equal(r.ok, true);
  assert.equal(r.coins, 5000);
  assert.equal(a.shop.coins(), 5000);
  assert.equal(a.busy.n, 0);
  assert.deepEqual(a.grants, [], 'the purchase flow reports it, not a background toast');
  Purchases.fireListeners();
  Purchases.fireListeners();
  await a.p.onResume();
  await sleep(10);
  assert.equal(a.shop.coins(), 5000, 'duplicate events never double-credit');
  // relaunch on the same save + same store account
  const b = rcSetup({ storage, purchases: Purchases });
  await b.p.init();
  await sleep(10);
  assert.equal(b.shop.coins(), 5000, 'relaunch does not re-credit');
  const r2 = await b.p.purchase('coins_small');
  assert.equal(r2.coins, 1500);
  assert.equal(b.shop.coins(), 6500);
});

test('iap: new transaction missing from the purchase result -> asks again, still exactly once', async () => {
  const Purchases = Fake.createPurchases({ behavior: { listenerBeforeResult: false, txInResult: false } });
  const { p, shop } = rcSetup({ purchases: Purchases });
  await p.init();
  const r = await p.purchase('coins_large');
  assert.equal(r.coins, 10000);
  assert.equal(shop.coins(), 10000);
  Purchases.fireListeners();
  await sleep(5);
  assert.equal(shop.coins(), 10000);
});

test('iap: orphan fallback (RevenueCat tx visible only later) is matched, never double-credited', async () => {
  const Purchases = Fake.createPurchases({ behavior: { listenerBeforeResult: false, txInResult: false } });
  const { p, shop } = rcSetup({ purchases: Purchases });
  await p.init();
  // hide the transaction from every read during the purchase
  const realGet = Purchases.getCustomerInfo;
  const hidden = Purchases.state.txs.length;
  Purchases.getCustomerInfo = () => Promise.resolve({ customerInfo: { ...Purchases.customerInfo(), nonSubscriptionTransactions: Purchases.state.txs.slice(0, hidden) } });
  const r = await p.purchase('coins_small');
  assert.equal(r.coins, 1500);
  assert.equal(shop.iapState().orphans.length, 1);
  Purchases.getCustomerInfo = realGet;
  Purchases.fireListeners(); // the real transaction shows up now
  await sleep(5);
  assert.equal(shop.coins(), 1500);
  assert.equal(shop.iapState().orphans.length, 0);
});

test('iap: cancel is silent and grants nothing', async () => {
  const Purchases = Fake.createPurchases({ behavior: { purchase: 'cancel' } });
  const { p, shop, busy } = rcSetup({ purchases: Purchases });
  await p.init();
  const r = await p.purchase('coins_mega');
  assert.deepEqual(r, { ok: false, productId: 'coins_mega', cancelled: true });
  assert.equal(shop.coins(), 0);
  assert.equal(busy.n, 0);
  assert.equal(purchaseErrorText(r), null);
});

test('iap: pending payment -> message, no coins; completed later -> credited once in the background', async () => {
  const Purchases = Fake.createPurchases({ behavior: { purchase: 'pending' } });
  const { p, shop, grants } = rcSetup({ purchases: Purchases });
  await p.init();
  const r = await p.purchase('coins_medium');
  assert.equal(r.pending, true);
  assert.equal(shop.coins(), 0);
  assert.match(pendingText('coins_medium').message, /automatically/);
  Purchases.completePending();
  await sleep(5);
  assert.equal(shop.coins(), 5000);
  assert.deepEqual(grants, [{ productId: 'coins_medium', coins: 5000, source: 'background' }]);
  Purchases.fireListeners();
  await p.onResume();
  await sleep(5);
  assert.equal(shop.coins(), 5000);
});

test('iap: app killed after Google charged -> credited on the next launch, once', async () => {
  const storage = memoryStorage();
  const Purchases = Fake.createPurchases();
  const a = rcSetup({ storage, purchases: Purchases });
  await a.p.init();
  Purchases.addTransaction('coins_large'); // finished on the store, JS never saw the result
  const b = rcSetup({ storage, purchases: Purchases });
  await b.p.init();
  await sleep(5);
  assert.equal(b.shop.coins(), 10000);
  assert.deepEqual(b.grants.map((g) => g.coins), [10000]);
  const c = rcSetup({ storage, purchases: Purchases });
  await c.p.init();
  await sleep(5);
  assert.equal(c.shop.coins(), 10000);
});

test('iap: fresh install on an account with old coin purchases -> history is never re-credited', async () => {
  const old = Date.now() - 30 * 86400000;
  const Purchases = Fake.createPurchases({
    history: [{ transactionIdentifier: 'rc_old_1', productIdentifier: 'coins_mega', purchaseDate: new Date(old).toISOString(), purchaseDateMillis: old }],
  });
  const { p, shop } = rcSetup({ purchases: Purchases });
  await p.init();
  await sleep(5);
  assert.equal(shop.coins(), 0);
  assert.ok(shop.iapState().since > 0, 'ledger epoch set');
  assert.ok(shop.hasProcessed('rc_old_1'));
});

test('iap: launch syncs entitlements (reinstall on the same Google account brings No Ads back)', async () => {
  const storage = memoryStorage();
  const Purchases = Fake.createPurchases({ noAdsOwned: true });
  const a = rcSetup({ storage, purchases: Purchases });
  assert.equal(a.shop.hasNoAds(), false);
  await a.p.init();
  assert.equal(a.shop.hasNoAds(), true);
  assert.equal(Purchases.calls.filter((c) => c.name === 'syncPurchases').length, 1, 'silent sync on the first launch');
  assert.ok(Purchases.calls.some((c) => c.name === 'getCustomerInfo'));
  assert.ok(!Purchases.calls.some((c) => c.name === 'restorePurchases'), 'restore is user-initiated only');
  const b = rcSetup({ storage, purchases: Purchases });
  await b.p.init();
  assert.equal(Purchases.calls.filter((c) => c.name === 'syncPurchases').length, 1, 'once per install');
});

test('iap: restore with the No Ads entitlement / without / failing', async () => {
  const withEnt = rcSetup({ purchases: Fake.createPurchases() });
  await withEnt.p.init();
  withEnt.Purchases.state.noAds = true; // bought on another device
  const r1 = await withEnt.p.restore();
  assert.deepEqual({ ok: r1.ok, noAds: r1.noAds, restored: r1.restored }, { ok: true, noAds: true, restored: ['no_ads'] });
  assert.equal(withEnt.shop.hasNoAds(), true);
  assert.match(restoreText(r1).text, /No Ads restored/);
  assert.match(restoreText(r1).text, /Coin packs/);

  const none = rcSetup({ purchases: Fake.createPurchases() });
  await none.p.init();
  const r2 = await none.p.restore();
  assert.deepEqual({ ok: r2.ok, noAds: r2.noAds, restored: r2.restored }, { ok: true, noAds: false, restored: [] });
  assert.match(restoreText(r2).text, /^Nothing to restore/);
  assert.match(restoreText(r2).text, /can’t be restored/);

  const fail = rcSetup({ purchases: Fake.createPurchases({ behavior: { restore: 'fail' } }) });
  await fail.p.init();
  const r3 = await fail.p.restore();
  assert.equal(r3.ok, false);
  assert.match(restoreText(r3).text, /Restore failed/);
});

test('iap: No Ads purchase sets the entitlement; buying it again is blocked; "already purchased" restores', async () => {
  const { p, shop } = rcSetup();
  await p.init();
  const r = await p.purchase('no_ads');
  assert.deepEqual(r, { ok: true, productId: 'no_ads', noAds: true });
  assert.equal(shop.hasNoAds(), true);
  assert.equal((await p.purchase('no_ads')).error, 'already_owned');

  const Purchases = Fake.createPurchases({ behavior: { purchase: 'already' } });
  const b = rcSetup({ purchases: Purchases });
  await b.p.init();
  Purchases.state.noAds = true; // owned on the store, not yet synced here
  b.shop.setNoAds(false);
  const r2 = await b.p.purchase('no_ads');
  assert.equal(r2.restored, true);
  assert.equal(b.shop.hasNoAds(), true);
  assert.equal(purchaseErrorText(r2), 'No Ads restored ✓');
});

test('iap: error codes map to friendly texts', () => {
  assert.equal(purchaseErrorText({ ok: false, error: 'network' }), 'No connection. Try again.');
  assert.equal(purchaseErrorText({ ok: false, error: 'failed' }), 'Purchase failed. You were not charged.');
  assert.equal(purchaseErrorText({ ok: false, error: 'busy' }), null);
  assert.equal(purchaseErrorText({ ok: false, pending: true }), null);
  assert.equal(rewardedFailText({ rewarded: false, shown: false, error: 'no_ad' }, 'continue'), NO_AD_TEXT);
  assert.equal(rewardedFailText({ rewarded: false, shown: true }, 'continue'), 'Watch the full video to continue');
  assert.equal(rewardedFailText({ rewarded: false, shown: false, error: 'cancelled' }, 'continue'), null);
  assert.equal(rewardedFailText({ rewarded: true, shown: true }, 'continue'), null);
});

test('iap: network / store errors from the purchase sheet', async () => {
  const Purchases = Fake.createPurchases({ behavior: { purchase: 'network' } });
  const { p, shop } = rcSetup({ purchases: Purchases });
  await p.init();
  assert.equal((await p.purchase('coins_small')).error, 'network');
  Purchases.behavior.purchase = 'error';
  assert.equal((await p.purchase('coins_small')).error, 'failed');
  assert.equal(shop.coins(), 0);
});

// ============================================================================ adapter end to end (fake plugins)
test('adapter: Android build wires AdMob + RevenueCat; rewarded grants only on the reward event', async () => {
  const a = await adapter();
  assert.equal(a.mon.mode, 'native');
  assert.equal(a.mon.adsEnabled, true);
  assert.equal(a.mon.iapEnabled, true);
  assert.deepEqual(a.mon.providers, { ads: 'admob', iap: 'revenuecat' });
  await untilReady({ rewardedState: () => a.mon.ads.rewardedState() });
  assert.equal((await a.mon.ads.showRewarded('continue')).rewarded, true);
  a.AdMob.behavior.rewarded = 'skip';
  await untilReady({ rewardedState: () => a.mon.ads.rewardedState() });
  assert.deepEqual(await a.mon.ads.showRewarded('continue'), { rewarded: false, shown: true });
  assert.ok(a.save.data.adState.lastRewardedAt > 0);
  const buy = await a.mon.iap.purchase('coins_small');
  assert.equal(buy.coins, 1500);
  assert.equal(a.shop.coins(), 1500);
  assert.equal(a.mon.isBusy(), false);
  a.mon.dispose();
});

test('adapter: no RevenueCat key -> purchases disabled (no dead buttons), ads still on', async () => {
  const a = await adapter({ cfg: cfgFor({ googleApiKey: '' }) });
  assert.equal(a.mon.iapEnabled, false);
  assert.equal(a.mon.adsEnabled, true);
  assert.deepEqual(await a.mon.iap.purchase('coins_small'), { ok: false, productId: 'coins_small', error: 'disabled' });
  assert.equal((await a.mon.iap.restore()).ok, false);
  a.mon.dispose();
});

test('adapter: web release build -> everything off and inert', async () => {
  const { save, shop } = newSave();
  const mon = createMonetization({ cfg: cfgFor({ build: { profile: 'web-release', adMode: 'test' } }), shop, save, root: null, win: {}, log: quiet });
  await mon.ready;
  assert.equal(mon.enabled, false);
  assert.equal(mon.ads.rewardedState(), 'unavailable');
  assert.deepEqual(await mon.maybeInterstitial(), { shown: false });
  assert.equal(save.data.adState.sessions, 0);
});

// ============================================================================ save fields
test('save: iap ledger + adState are additive, validated, and survive a progress reset', () => {
  const m = migrate({
    v: 2, coins: 5,
    iap: { since: 123, done: ['a', 'a', 7, 'b', 'x'.repeat(300)], orphans: [{ p: 'coins_small', t: 9, o: 'GPA.1' }, { bad: 1 }], synced: 'yes' },
    adState: { sessions: 3, lastInterstitialAt: 9e15, lastRewardedAt: -5 },
  }, CONFIG, 1000);
  assert.deepEqual(m.iap, { since: 123, done: ['a', 'b'], doneT: [0, 0], through: 0, orphans: [{ p: 'coins_small', t: 9, o: 'GPA.1' }], synced: false });
  assert.deepEqual(m.adState, { sessions: 3, lastInterstitialAt: 1000, lastRewardedAt: 0 });
  const fresh = migrate({ v: 2 });
  assert.deepEqual(fresh.iap, { since: 0, done: [], doneT: [], through: 0, orphans: [], synced: false });

  const { save, shop } = newSave();
  shop.setIapEpoch(50);
  shop.creditPurchase({ txId: 'rc_1', productId: 'coins_small' });
  save.update((d) => { d.adState.sessions = 4; });
  save.reset();
  assert.equal(save.data.coins, 0, 'reset wipes coins');
  assert.deepEqual(save.data.iap.done, ['rc_1'], 'but keeps the ledger (no re-credit after a reset)');
  assert.equal(save.data.iap.doneT.length, 1);
  assert.equal(save.data.adState.sessions, 4);
  assert.equal(shop.creditPurchase({ txId: 'rc_1', productId: 'coins_small' }), 0);
});

// ============================================================================ review fixes
test('ads: consent info fails at launch -> retried in the background (no resume needed) and on "online"', async () => {
  const { AdMob, p } = admobSetup({ behavior: { consentFail: true }, mon: { preloadRetryMs: [40] } });
  await p.init();
  assert.equal(p.rewardedState(), 'unavailable');
  await sleep(60); // still offline: a background retry must not flip the buttons to "loading"
  assert.equal(p.rewardedState(), 'unavailable');
  assert.ok(names(AdMob).filter((n) => n === 'requestConsentInfo').length >= 2, 'retried on the backoff');
  AdMob.behavior.consentFail = false;
  await sleep(80);
  await untilReady(p);
  assert.equal(p.rewardedState(), 'ready');
  assert.ok(!names(AdMob).includes('showConsentForm'), 'a background retry never pops the form mid-game');
  p.dispose();

  const listeners = {};
  const win = { addEventListener: (n, fn) => { listeners[n] = fn; }, removeEventListener: (n) => { delete listeners[n]; } };
  const b = admobSetup({ behavior: { consentFail: true }, mon: { preloadRetryMs: [60000] }, win });
  await b.p.init();
  assert.equal(typeof listeners.online, 'function');
  b.AdMob.behavior.consentFail = false;
  listeners.online();
  await untilReady(b.p);
  assert.equal(b.p.rewardedState(), 'ready');
  b.p.dispose();
  assert.equal(listeners.online, undefined, 'listener removed on dispose');
});

test('ads: background retry that finds a required consent form defers it to the next resume', async () => {
  const { AdMob, p } = admobSetup({
    behavior: { consentFail: true, consent: { status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' } },
    mon: { preloadRetryMs: [30] },
  });
  await p.init();
  AdMob.behavior.consentFail = false;
  await sleep(80);
  assert.ok(!names(AdMob).includes('showConsentForm'));
  p.onResume();
  await sleep(40);
  assert.ok(names(AdMob).includes('showConsentForm'), 'form shown on resume');
  p.dispose();
});

test('iap: more than 500 coin purchases never re-credit pruned ledger ids (reconcile, relaunch)', async () => {
  const storage = memoryStorage();
  let clock = Date.now();
  const Purchases = Fake.createPurchases({ now: () => (clock += 1000) });
  const a = rcSetup({ storage, purchases: Purchases });
  await a.p.init();
  const N = 505;
  for (let i = 0; i < N; i++) Purchases.addTransaction('coins_small');
  const expected = N * a.shop.productCoins('coins_small');
  a.p.reconcile(Purchases.customerInfo(), { fresh: true });
  assert.equal(a.shop.coins(), expected);
  assert.equal(a.shop.iapState().done.length, 500);
  assert.ok(a.shop.iapState().through > 0, 'pruning raised the floor');
  a.p.reconcile(Purchases.customerInfo(), { fresh: true });
  Purchases.fireListeners();
  await sleep(5);
  assert.equal(a.shop.coins(), expected, 'second reconcile credits nothing');
  const b = rcSetup({ storage, purchases: Purchases });
  await b.p.init();
  await sleep(5);
  assert.equal(b.shop.coins(), expected, 'relaunch credits nothing');
  Purchases.addTransaction('coins_medium');
  b.p.reconcile(Purchases.customerInfo(), { fresh: true });
  assert.equal(b.shop.coins(), expected + b.shop.productCoins('coins_medium'), 'a new purchase still pays once');
});

test('save: pruning an oversized ledger raises the floor', () => {
  const done = Array.from({ length: 503 }, (_, i) => 'tx' + i);
  const doneT = done.map((_, i) => 1000 + i);
  const m = migrate({ v: 2, iap: { since: 5, done, doneT, through: 0 } }, CONFIG, 1e13);
  assert.equal(m.iap.done.length, 500);
  assert.equal(m.iap.done[0], 'tx3');
  assert.equal(m.iap.through, 1002);
});

test('iap: fresh save credits a paid-but-never-credited purchase from the last 48 h, not older history', async () => {
  const recent = Date.now() - 60 * 1000;
  const old = Date.now() - 30 * 86400000;
  const Purchases = Fake.createPurchases({
    history: [
      { transactionIdentifier: 'rc_recent', productIdentifier: 'coins_mega', purchaseDate: new Date(recent).toISOString(), purchaseDateMillis: recent },
      { transactionIdentifier: 'rc_old', productIdentifier: 'coins_small', purchaseDate: new Date(old).toISOString(), purchaseDateMillis: old },
    ],
  });
  const { p, shop, grants, storage } = rcSetup({ purchases: Purchases });
  await p.init();
  await sleep(5);
  const mega = shop.productCoins('coins_mega');
  assert.equal(shop.coins(), mega);
  assert.deepEqual(grants, [{ productId: 'coins_mega', coins: mega, source: 'background' }]);
  assert.ok(shop.hasProcessed('rc_recent') && shop.hasProcessed('rc_old'));
  const b = rcSetup({ storage, purchases: Purchases });
  await b.p.init();
  await sleep(5);
  assert.equal(b.shop.coins(), mega, 'still once');
});

test('iap: buying No Ads that Google already owns but RevenueCat does not show -> automatic restore', async () => {
  const Purchases = Fake.createPurchases({ behavior: { purchase: 'already' } });
  const a = rcSetup({ purchases: Purchases });
  await a.p.init();
  const realRestore = Purchases.restorePurchases;
  Purchases.restorePurchases = () => { Purchases.state.noAds = true; return realRestore.call(Purchases); };
  const r = await a.p.purchase('no_ads');
  assert.deepEqual({ error: r.error, restored: r.restored }, { error: 'already_owned', restored: true });
  assert.equal(a.shop.hasNoAds(), true);
  assert.equal(purchaseErrorText(r), 'No Ads restored ✓');
  assert.equal(a.busy.n, 0);

  const P2 = Fake.createPurchases({ behavior: { purchase: 'already' } });
  const b = rcSetup({ purchases: P2 });
  await b.p.init();
  const r2 = await b.p.purchase('no_ads'); // owned by another store / RevenueCat user: restore finds nothing
  assert.equal(r2.error, 'owned_elsewhere');
  assert.equal(b.shop.hasNoAds(), false);
  assert.match(purchaseErrorText(r2), /Restore Purchases/);
});

test('iap: "already purchased" coin pack (unconsumed) is synced and credited once', async () => {
  const Purchases = Fake.createPurchases({ behavior: { purchase: 'already' } });
  const { p, shop } = rcSetup({ purchases: Purchases });
  await p.init();
  Purchases.syncPurchases = () => { Purchases.addTransaction('coins_small'); return Promise.resolve(); };
  const r = await p.purchase('coins_small');
  assert.deepEqual(r, { ok: true, productId: 'coins_small', coins: shop.productCoins('coins_small') });
  Purchases.fireListeners();
  await sleep(5);
  assert.equal(shop.coins(), shop.productCoins('coins_small'));
});
