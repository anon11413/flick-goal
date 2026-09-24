// Browser check of the REAL game UI running as if inside the Android app, with FAKE native plugins
// (tests/fakes/fakeCapacitor.js injected as window.Capacitor: AdMob, Purchases, App). No real SDK,
// no network, no money. Not part of `npm test` (needs Chrome + playwright-core).
//
// Usage:
//   python -m http.server 8793   (in the folder that CONTAINS this repo folder), then
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tests/e2e/native-monetization.e2e.mjs \
//       http://localhost:8793/<repo-folder>/ [shotsDir]
//
// Flows: consent form (EEA) -> interstitial after N game overs -> Continue via rewarded ->
// 2x coins closed early (no reward) -> no fill ("No ad available") -> store COINS tab with localized
// prices -> buy a coin pack (exactly once, even with duplicate store events) -> pending payment
// completed later -> buy No Ads -> Settings: Privacy & ad choices + Restore Purchases -> Android Back
// button on every screen (store, quit prompt, settings, playing / paused, game over).
// Fails (exit 1) on any console error, page error, unhandled rejection or failed check.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pwPath = process.env.PLAYWRIGHT_CORE;
const { chromium } = await import(pwPath ? pathToFileURL(pwPath).href : 'playwright-core');
const FAKE = path.resolve(HERE, '..', 'fakes', 'fakeCapacitor.js');
const BASE = process.argv[2] || 'http://localhost:8793/v2-standard/';
const SHOTS = path.resolve(process.argv[3] || path.join(HERE, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });

const problems = [];
const failures = [];
const log = (...a) => console.log('[native]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => { if (cond) log('ok  -', msg); else { failures.push(msg); log('FAIL-', msg); } };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--mute-audio'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();

  // The committed config ships an EMPTY RevenueCat key (purchases hidden until the owner adds one):
  // give this test run a fake public key, exactly as the owner would.
  await page.route('**/src/config.js', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace("googleApiKey: '',", "googleApiKey: 'goog_fake_public_key',");
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/javascript' } });
  });
  await page.addInitScript({ path: FAKE });
  await page.addInitScript(() => {
    window.__rejections = [];
    window.addEventListener('unhandledrejection', (e) => window.__rejections.push(String(e.reason && (e.reason.stack || e.reason))));
    // A returning player (2nd app session) with a few games played: interstitials are allowed.
    try {
      if (!localStorage.getItem('flickgoal.save2')) {
        localStorage.setItem('flickgoal.save2', JSON.stringify({ v: 2, coins: 0, stats: { gamesPlayed: 3, totalGoals: 3, totalPerfects: 0, bestStreak: 1 }, tutorial: { kicks: 20 }, adState: { sessions: 1, lastInterstitialAt: 0, lastRewardedAt: 0 } }));
      }
    } catch { /* ignore */ }
    // A visible stand-in for the native full-screen ad (the real one is drawn by Android above the WebView).
    const onShow = (kind) => {
      const el = document.createElement('div');
      el.className = 'fake-native-ad';
      el.textContent = `FAKE NATIVE ${kind.toUpperCase()} AD`;
      el.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font:900 22px sans-serif';
      document.documentElement.appendChild(el);
      setTimeout(() => el.remove(), 400);
    };
    window.__fake = window.FakeCapacitor.install(window, {
      admob: {
        onShow,
        behavior: {
          adMs: 350,
          consent: { status: 'REQUIRED', isConsentFormAvailable: true, canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED' },
        },
      },
    });
  });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.stack || e.message}`));
  page.on('dialog', (d) => { problems.push(`native dialog: ${d.message()}`); d.dismiss().catch(() => {}); });

  await page.goto(BASE + (BASE.includes('?') ? '&' : '?') + 'qa&mode=field', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__flickGoalBooted && window.__fg, null, { timeout: 15000 });
  await page.evaluate(() => window.__fg.mon.ready);
  await sleep(700);

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const route = () => ev(() => window.__fg.router.current);
  const waitFor = (fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout, polling: 16 });
  const tap = async (sel) => { const l = page.locator(sel).first(); await l.waitFor({ state: 'visible', timeout: 8000 }); await l.tap(); };
  const shot = async (name) => { const f = path.join(SHOTS, name + '.png'); await page.screenshot({ path: f }); log('shot', f); };
  const calls = (plugin, name) => ev(([p, n]) => window.__fake[p].calls.filter((c) => c.name === n).length, [plugin, name]);
  const toastText = () => ev(() => { const t = document.querySelector('.toast'); return t ? t.textContent : ''; });

  /** Tap inside the sweet band (a goal earns coins, so the 2x offer appears). */
  async function scoreGoal() {
    await waitFor(() => window.__fg.game.phase === 'aim', null, 12000);
    const made0 = await ev(() => window.__fg.game.hud().made);
    await ev(() => new Promise((resolve) => {
      const g = window.__fg.game;
      (function poll() {
        if (g.phase !== 'aim') return resolve();
        const { marker, shot: s } = g.world;
        const tp = marker.t + (marker.dir || 1) * s.speed * 0.035;
        const m = s.band.width * 0.3;
        if (tp > s.band.lo + m && tp < s.band.hi - m) return resolve();
        requestAnimationFrame(poll);
      })();
    }));
    const b = await ev(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.72 }; });
    await page.touchscreen.tap(b.x, b.y);
    await waitFor((m0) => window.__fg.game.hud().made > m0 || ['miss', 'over'].includes(window.__fg.game.phase), made0, 8000);
  }

  async function missToGameOver() {
    await waitFor(() => window.__fg.game.phase === 'aim', null, 12000);
    await ev(() => new Promise((resolve) => {
      const g = window.__fg.game;
      (function poll() {
        if (g.phase !== 'aim') return resolve();
        const { marker, shot: s } = g.world;
        const tp = marker.t + (marker.dir || 1) * s.speed * 0.035;
        if (tp < s.band.lo - 0.15 || tp > s.band.hi + 0.15) return resolve();
        requestAnimationFrame(poll);
      })();
    }));
    const b = await ev(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.72 }; });
    await page.touchscreen.tap(b.x, b.y);
    await waitFor(() => window.__fg.router.current === 'gameover', null, 12000);
    await sleep(900);
  }

  // ---- boot: native providers, consent form before AdMob.initialize, privacy row required
  const info = await ev(() => ({ mode: window.__fg.mon.mode, providers: window.__fg.mon.providers, sessions: window.__fg.save.data.adState.sessions }));
  check(info.mode === 'native' && info.providers.ads === 'admob' && info.providers.iap === 'revenuecat', `native providers selected (${JSON.stringify(info.providers)})`);
  check(info.sessions === 2, `second app session counted (${info.sessions})`);
  const order = await ev(() => window.__fake.AdMob.calls.map((c) => c.name));
  check(order.indexOf('showConsentForm') >= 0 && order.indexOf('showConsentForm') < order.indexOf('initialize'), 'UMP consent form shown before AdMob.initialize');
  check((await calls('Purchases', 'configure')) === 1 && (await calls('Purchases', 'syncPurchases')) === 1, 'RevenueCat configured once + silent first-launch sync');
  check(await route() === 'menu', 'menu after boot');

  // ---- interstitial every 3rd game over (not before), leaving via Play Again
  await tap('.play-big');
  for (let i = 1; i <= 3; i++) {
    await missToGameOver();
    if (i === 3) await shot('native-01-gameover');
    await tap('.go-play');
    if (i === 3) {
      await page.locator('.fake-native-ad').waitFor({ state: 'attached', timeout: 4000 });
      await shot('native-02-interstitial');
    }
    await waitFor(() => window.__fg.router.current === 'playing', null, 8000);
    const n = await calls('AdMob', 'showInterstitial');
    check(n === (i === 3 ? 1 : 0), `game over #${i}: interstitials shown = ${n}`);
  }

  // ---- Continue via rewarded ad (reward event)
  await missToGameOver();
  check(await page.locator('.go-continue').isVisible(), 'Continue button visible');
  await tap('.go-continue');
  await waitFor(() => window.__fg.router.current === 'playing', null, 8000);
  check((await calls('AdMob', 'showRewardVideoAd')) === 1, 'Continue played a rewarded ad and resumed the run');
  for (let i = 0; i < 3 && (await ev(() => window.__fg.game.hud().made)) < 1; i++) await scoreGoal();

  // ---- 2x coins: ad closed early -> no reward, friendly message, buttons still work
  await missToGameOver();
  const canDouble = await page.locator('.go-double').isVisible();
  if (canDouble) {
    // this ad is closed early, and every later load finds no fill
    await ev(() => { window.__fake.AdMob.behavior.rewarded = 'skip'; window.__fake.AdMob.behavior.prepare = 'nofill'; });
    const c0 = await ev(() => window.__fg.shop.coins());
    await tap('.go-double');
    await waitFor(() => document.querySelector('.toast'), null, 6000);
    const t = await toastText();
    check(/Watch the full video/.test(t), `closed early -> "${t}"`);
    check((await ev(() => window.__fg.shop.coins())) === c0, 'closed early -> no coins');
    // ---- no fill: the next load fails -> "No ad available right now", no soft-lock
    await sleep(300);
    await tap('.go-double');
    await page.locator('.ad-loading').waitFor({ state: 'attached', timeout: 3000 });
    await shot('native-03-loading-video');
    await waitFor(() => /No ad available/.test((document.querySelector('.toast') || {}).textContent || ''), null, 12000);
    check(true, 'no fill -> "No ad available right now"');
    await shot('native-04-no-ad-toast');
    check(await ev(() => !window.__fg.mon.isBusy()), 'not busy after no-fill');
    await ev(() => { window.__fake.AdMob.behavior.prepare = 'ok'; window.__fake.AdMob.behavior.rewarded = 'reward'; });
  } else {
    check(false, '2x coins button visible (coins earned this run)');
  }
  await tap('.gameover .go-home');
  await waitFor(() => window.__fg.router.current === 'menu', null, 8000);

  // ---- store COINS tab: localized prices from the store
  await tap('.menu .btn.round[aria-label="Store"]');
  await waitFor(() => window.__fg.router.current === 'store');
  await tap('.tab[data-tab="coins"]');
  await sleep(600);
  const prices = await ev(() => Array.from(document.querySelectorAll('.pack .pack-price')).map((e) => e.textContent));
  check(JSON.stringify(prices) === JSON.stringify(['€1.09', '€3.19', '€5.49', '€10.99']), `localized pack prices ${JSON.stringify(prices)}`);
  const noAdsPrice = await ev(() => (document.querySelector('.iap-card.noads .btn') || {}).textContent);
  check(noAdsPrice === '€3.19', `localized No Ads price (${noAdsPrice})`);
  check(!(await ev(() => /Test mode/.test(document.querySelector('.coins-tab').textContent))), 'no "Test mode" note on the real store');
  await shot('native-05-store-coins');

  // ---- buy a coin pack: exactly once even with duplicate store events
  const before = await ev(() => window.__fg.shop.coins());
  await tap('.pack[data-id="coins_medium"]');
  await waitFor((b) => window.__fg.shop.coins() >= b + 5000, before, 8000);
  await ev(() => { window.__fake.Purchases.fireListeners(); window.__fake.Purchases.fireListeners(); });
  await sleep(800);
  const after = await ev(() => window.__fg.shop.coins());
  check(after - before === 5000, `coins_medium credited exactly once (+${after - before})`);
  await shot('native-06-bought-pack');

  // ---- pending payment -> dialog, then Google confirms later -> coins arrive once
  await ev(() => { window.__fake.Purchases.behavior.purchase = 'pending'; });
  await sleep(300);
  await tap('.pack[data-id="coins_small"]');
  await page.locator('.modal').waitFor({ state: 'visible', timeout: 5000 });
  check(/Payment pending/.test(await ev(() => document.querySelector('.modal').textContent)), 'pending payment dialog');
  await shot('native-07-pending');
  await tap('.modal .btn.green');
  const b2 = await ev(() => window.__fg.shop.coins());
  await ev(() => { window.__fake.Purchases.behavior.purchase = 'ok'; window.__fake.Purchases.completePending(); });
  await waitFor((b) => window.__fg.shop.coins() >= b + 1500, b2, 5000);
  await sleep(1500);
  check((await ev(() => window.__fg.shop.coins())) - b2 === 1500, 'pending purchase credited once when completed');

  // ---- buy No Ads -> OWNED
  await tap('.iap-card.noads .btn');
  await waitFor(() => window.__fg.shop.hasNoAds(), null, 8000);
  await sleep(900);
  check(await page.locator('.iap-card.noads .iap-owned').isVisible(), 'No Ads card shows OWNED');
  await shot('native-08-store-noads-owned');

  // ---- Settings: privacy options row + Restore Purchases
  await tap('.store .store-top .btn.round');
  await waitFor(() => window.__fg.router.current === 'menu');
  await sleep(400);
  check(!(await page.locator('.noads-stack').isVisible()), 'menu No Ads button hidden once owned');
  await tap('.menu .btn.round[aria-label="Settings"]');
  await waitFor(() => window.__fg.router.current === 'settings');
  await sleep(600);
  check(await page.locator('.privacy-row').isVisible(), '"Privacy & ad choices" row shown (consent required region)');
  await tap('.privacy-row');
  await sleep(300);
  check((await calls('AdMob', 'showPrivacyOptionsForm')) === 1, 'privacy options form opened');
  await tap('.restore-row');
  await waitFor(() => /restored/.test((document.querySelector('.toast') || {}).textContent || ''), null, 6000);
  const rt = await toastText();
  check(/No Ads restored/.test(rt) && /Coin packs/.test(rt), `restore toast: "${rt}"`);
  await sleep(350);
  await shot('native-09-settings-restore');

  // ---- nothing to restore on a fresh account
  await ev(() => { window.__fake.Purchases.state.noAds = false; });
  await sleep(400);
  await tap('.restore-row');
  await waitFor(() => /Nothing to restore/.test((document.querySelector('.toast') || {}).textContent || ''), null, 6000);
  check(true, 'restore without purchases -> "Nothing to restore" + coin-pack note');
  await sleep(350);
  await shot('native-10-settings-nothing-to-restore');

  // ---- clean COINS tab (no toast) for review
  await tap('.settings .store-top .btn.round');
  await waitFor(() => window.__fg.router.current === 'menu');
  await tap('.menu .btn.round[aria-label="Store"]');
  await tap('.tab[data-tab="coins"]');
  await waitFor(() => !document.querySelector('.toast'), null, 8000);
  await sleep(500);
  await shot('native-11-store-coins-clean');

  // ---- Android Back button (@capacitor/app "backButton"): back a screen, pause / resume, quit prompt
  const back = () => ev(() => window.__fake.App.emit('backButton', { canGoBack: false }));
  await ev(() => { window.__exits = 0; window.__fake.App.exitApp = () => { window.__exits++; return Promise.resolve(); }; });
  await back();
  await waitFor(() => window.__fg.router.current === 'menu', null, 4000);
  check(true, 'Back in the store -> menu');
  await sleep(400);
  await back();
  await page.locator('.modal').waitFor({ state: 'visible', timeout: 4000 });
  check(/Quit Flick Goal\?/.test(await ev(() => document.querySelector('.modal').textContent)), 'Back on the menu -> "Quit Flick Goal?" dialog');
  await sleep(300);
  await shot('native-12-back-quit-dialog');
  await back();
  await waitFor(() => !document.querySelector('.modal'), null, 4000);
  check((await ev(() => window.__exits)) === 0 && (await route()) === 'menu', 'Back again closes the dialog, app keeps running');
  await back();
  await page.locator('.modal').waitFor({ state: 'visible', timeout: 4000 });
  await tap('.modal .btn.green');
  await waitFor(() => window.__exits === 1, null, 4000);
  check(true, 'QUIT -> App.exitApp()');
  await waitFor(() => !document.querySelector('.modal'), null, 4000);
  await tap('.menu .btn.round[aria-label="Settings"]');
  await waitFor(() => window.__fg.router.current === 'settings');
  await back();
  await waitFor(() => window.__fg.router.current === 'menu', null, 4000);
  check(true, 'Back in Settings -> menu');
  await sleep(400);
  await tap('.play-big');
  await waitFor(() => window.__fg.router.current === 'playing', null, 6000);
  await sleep(300);
  await back();
  await waitFor(() => window.__fg.router.current === 'paused', null, 4000);
  check(true, 'Back while playing -> paused');
  await back();
  await waitFor(() => window.__fg.router.current === 'playing', null, 4000);
  check(true, 'Back while paused -> resumed');
  await missToGameOver();
  await back();
  await waitFor(() => window.__fg.router.current === 'menu', null, 10000);
  check(true, 'Back on Game Over -> Home');

  const rej = await ev(() => window.__rejections);
  problems.push(...rej.map((r) => 'unhandledrejection: ' + r));
  await ctx.close();
} finally {
  await browser.close();
}

console.log('\n==== NATIVE HARNESS RESULT ====');
console.log('console/page errors:', problems.length);
for (const p of problems) console.log('  ', p);
console.log('check failures:', failures.length);
for (const f of failures) console.log('  ', f);
process.exit(problems.length || failures.length ? 1 : 0);
