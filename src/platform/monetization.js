// Monetization adapter: ONE provider-agnostic Ads + IAP API for the game UI.
//
// Providers (chosen by selectProviders(): build profile + platform + config):
//   ads:  'admob'       native Android with the AdMob plugin      (src/platform/admob.js)
//         'mock'        web dev profile: in-DOM "TEST AD" placeholders (below)
//         null          off (web release build, monetization.mode 'off')
//   iap:  'revenuecat'  native Android with the Purchases plugin and a RevenueCat key (src/platform/revenuecat.js)
//         'mock'        web dev profile: in-DOM "TEST PURCHASE" sheet (below)
//         null          off (web release build, no RevenueCat key yet, mode 'off')
//
// Contract: every promise RESOLVES (never rejects). While an ad / consent form / purchase sheet is
// open, `busy` is true and main.js pauses the simulation and blocks game taps. Rewarded ads grant
// ONLY when `rewarded === true` (the reward event fired); a closed / failed / missing ad grants nothing.

import { CONFIG } from '../config.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { getCapacitor, isNative, platformOf, nativePlugin, listen } from './native.js';
import { createAdMobAdsProvider } from './admob.js';
import { createRevenueCatIapProvider, revenueCatApiKey } from './revenuecat.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Which providers run in this build. Pure (tests call it with fake Capacitor objects).
 * -> { ads: 'admob'|'mock'|null, iap: 'revenuecat'|'mock'|null, apiKey, native }
 */
export function selectProviders({ cfg = CONFIG, build = cfg.build, cap = null } = {}) {
  const profile = (build && build.profile) || 'dev';
  const off = !cfg.monetization || cfg.monetization.mode === 'off';
  const native = isNative(cap) && platformOf(cap) === 'android';
  const out = { ads: null, iap: null, apiKey: '', native };
  if (off) return out;
  if (native) {
    if (nativePlugin(cap, 'AdMob')) out.ads = 'admob';
    const key = revenueCatApiKey(cfg, build);
    if (key && nativePlugin(cap, 'Purchases')) { out.iap = 'revenuecat'; out.apiKey = key; }
    return out;
  }
  if (profile === 'dev') { out.ads = 'mock'; out.iap = 'mock'; }
  return out;
}

// ---------------------------------------------------------------------------
// Mock provider: obvious in-DOM placeholders. Safe to ship to testers, never to production.
// ---------------------------------------------------------------------------
function createMockProvider({ cfg, root, onBusy }) {
  const m = cfg.monetization;

  function adOverlay({ rewarded, placement }) {
    return new Promise((resolve) => {
      onBusy(1);
      const duration = rewarded ? m.mockRewardedMs : m.mockAdSkipAfterMs;
      const bar = h('div.mock-ad-bar', h('i'));
      const status = h('div.mock-ad-status', rewarded ? 'Reward in 2s…' : 'You can skip in 2s…');
      const skip = h('button.mock-ad-skip', { type: 'button', hidden: true }, '✕ Skip');
      const noReward = rewarded ? h('button.mock-ad-link', { type: 'button' }, 'Close (no reward)') : null;
      const card = h('div.mock-ad-card', { attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Test ad' } },
        h('div.mock-ad-badge', 'TEST AD'),
        h('div.mock-ad-title', 'TEST AD — placeholder'),
        h('div.mock-ad-sub', rewarded ? `rewarded: ${placement}` : `interstitial${placement ? ': ' + placement : ''}`),
        h('div.mock-ad-art', { html: icon('ad') }),
        bar,
        status,
        h('div.mock-ad-actions', skip, noReward),
      );
      const el = h('div.mock-ad', { dataset: { noTap: '' } }, card);
      root.appendChild(el);
      requestAnimationFrame(() => el.classList.add('in'));

      const fill = bar.firstChild;
      fill.style.transitionDuration = duration + 'ms';
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.transform = 'scaleX(1)'; }));

      let done = false;
      const timers = [];
      const finish = (result, delay = 0) => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        const close = () => {
          el.classList.remove('in');
          el.classList.add('out');
          setTimeout(() => { el.remove(); onBusy(-1); resolve(result); }, 180);
        };
        if (delay) setTimeout(close, delay); else close();
      };

      let left = Math.ceil(duration / 1000);
      const countdown = setInterval(() => {
        left -= 1;
        if (left > 0) status.textContent = rewarded ? `Reward in ${left}s…` : `You can skip in ${left}s…`;
      }, 1000);
      timers.push(countdown);

      if (rewarded) {
        timers.push(setTimeout(() => {
          clearInterval(countdown);
          status.textContent = 'Reward granted ✓';
          status.classList.add('ok');
          if (noReward) noReward.hidden = true;
          finish({ rewarded: true, shown: true }, 400);
        }, duration));
        noReward.addEventListener('click', () => finish({ rewarded: false, shown: true }));
      } else {
        timers.push(setTimeout(() => {
          clearInterval(countdown);
          status.textContent = 'Thanks for supporting Flick Goal!';
          skip.hidden = false;
          skip.focus({ preventScroll: true });
        }, duration));
        skip.addEventListener('click', () => finish({ shown: true }));
      }
    });
  }

  function purchaseSheet(product) {
    return new Promise((resolve) => {
      onBusy(1);
      const buyBtn = h('button.sheet-buy', { type: 'button' }, `Buy ${product.priceString}`);
      const cancelBtn = h('button.sheet-cancel', { type: 'button' }, 'Cancel');
      const sheet = h('div.sheet', { attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Test purchase' } },
        h('div.sheet-grip'),
        h('div.sheet-warn', 'TEST PURCHASE — no real money'),
        h('div.sheet-row',
          h('div.sheet-icon', { html: product.grants && product.grants.noAds ? icon('noAds') : icon('coin') }),
          h('div.sheet-info',
            h('div.sheet-title', product.title),
            h('div.sheet-desc', product.description)),
          h('div.sheet-price', product.priceString)),
        h('div.sheet-actions', cancelBtn, buyBtn),
      );
      const el = h('div.sheet-wrap', { dataset: { noTap: '' } }, sheet);
      root.appendChild(el);
      requestAnimationFrame(() => el.classList.add('in'));
      buyBtn.focus({ preventScroll: true });

      let done = false;
      const close = (result) => {
        if (done) return;
        done = true;
        el.classList.remove('in');
        el.classList.add('out');
        setTimeout(() => { el.remove(); onBusy(-1); resolve(result); }, 220);
      };
      cancelBtn.addEventListener('click', () => close({ ok: false, cancelled: true }));
      // Backdrop dismiss: only a tap that both starts and ends on the backdrop, and not in the
      // first moments after opening (the 2nd tap of a double-tap on a pack must not cancel).
      const openedAt = performance.now();
      let downOnBackdrop = false;
      el.addEventListener('pointerdown', (e) => {
        downOnBackdrop = e.target === el && performance.now() - openedAt > 350;
      });
      el.addEventListener('click', (e) => {
        if (e.target === el && downOnBackdrop) close({ ok: false, cancelled: true });
        downOnBackdrop = false;
      });
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close({ ok: false, cancelled: true }); } });
      buyBtn.addEventListener('click', () => {
        if (done) return;
        buyBtn.disabled = true;
        cancelBtn.disabled = true;
        buyBtn.classList.add('loading');
        buyBtn.textContent = 'Processing…';
        wait(m.mockPurchaseDelayMs).then(() => close({ ok: true }));
      });
    });
  }

  return {
    ads: {
      kind: 'mock',
      init: () => Promise.resolve(),
      rewardedState: () => 'ready',
      interstitialReady: () => true,
      showRewarded: (placement) => adOverlay({ rewarded: true, placement }),
      showInterstitial: (placement) => adOverlay({ rewarded: false, placement }),
      privacyRequired: () => false,
      showPrivacyOptions: () => Promise.resolve({ ok: false }),
      onPause() {},
      onResume() {},
      setMuted() {},
      onChange: () => () => {},
    },
    iap: {
      kind: 'mock',
      purchaseSheet,
    },
  };
}

function publicProduct(p, shop) {
  const coins = p.grants && p.grants.coins ? Math.floor(p.grants.coins) : 0;
  const out = { id: p.id, type: p.type, title: p.title, description: p.description, priceString: p.priceString, available: true, coins };
  if (p.tag) out.tag = p.tag;
  if (shop && typeof shop.productCoins === 'function') out.coins = shop.productCoins(p.id);
  return out;
}

/** "Loading video…" overlay with Cancel, shown while a rewarded ad that was not preloaded loads. */
function loadingOverlay(root, onCancel) {
  const cancel = h('button.btn.pill.white.sm.ad-loading-cancel', { type: 'button' }, 'Cancel');
  const el = h('div.ad-loading', { dataset: { noTap: '' }, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Loading video' } },
    h('div.ad-loading-card', h('div.spinner'), h('div.ad-loading-text', 'Loading video…'), cancel));
  cancel.addEventListener('click', () => onCancel());
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  return () => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 180);
  };
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------
/**
 * createMonetization({ cfg, shop, save, root, onBusyChange, win, now, log })
 * win: the window whose `Capacitor` is used (tests pass { Capacitor: fake }); defaults to the real one.
 */
export function createMonetization({ cfg = CONFIG, shop, save, root, onBusyChange, win, now = () => Date.now(), log = console } = {}) {
  const build = cfg.build || { profile: 'dev', adMode: 'test' };
  const cap = getCapacitor(win);
  const sel = selectProviders({ cfg, build, cap });
  const m = cfg.monetization;

  // ---- busy (reference counted: consent form, loading overlay, ad, purchase sheet) ----
  let open = 0;
  let busy = false;
  const busyListeners = new Set();
  if (typeof onBusyChange === 'function') busyListeners.add(onBusyChange);
  const onBusy = (d) => {
    open = Math.max(0, open + d);
    const b = open > 0;
    if (b === busy) return;
    busy = b;
    for (const fn of Array.from(busyListeners)) { try { fn(b); } catch (e) { log.error(e); } }
  };

  // ---- providers ----
  const mock = (sel.ads === 'mock' || sel.iap === 'mock') && root ? createMockProvider({ cfg, root, onBusy }) : null;
  const hooks = { showLoading: root ? (onCancel) => loadingOverlay(root, onCancel) : null };
  let adsP = null;
  if (sel.ads === 'admob') {
    adsP = createAdMobAdsProvider({ AdMob: nativePlugin(cap, 'AdMob'), cfg, build, onBusy, hooks, now, log });
  } else if (sel.ads === 'mock' && mock) {
    adsP = mock.ads;
  }
  let rcP = null;
  if (sel.iap === 'revenuecat' && shop) {
    rcP = createRevenueCatIapProvider({ Purchases: nativePlugin(cap, 'Purchases'), cfg, build, shop, apiKey: sel.apiKey, onBusy, now, log });
  }
  const mockIap = sel.iap === 'mock' && mock ? mock.iap : null;
  const adsEnabled = !!adsP;
  const iapEnabled = !!(rcP || mockIap);
  const enabled = adsEnabled || iapEnabled;
  const mode = !enabled ? 'off' : (sel.ads === 'admob' || sel.iap === 'revenuecat') ? 'native' : 'mock';

  // One cold start = one session (no interstitial in the first session).
  if (save && enabled) {
    try { save.update((d) => { d.adState.sessions = (d.adState.sessions | 0) + 1; }); } catch (e) { log.warn(e); }
  }

  const changeListeners = new Set();
  const notify = () => {
    for (const fn of Array.from(changeListeners)) { try { fn(); } catch (e) { log.error(e); } }
  };
  if (adsP && adsP.onChange) adsP.onChange(notify);
  if (rcP) rcP.onChange(notify);

  const settle = (p) => Promise.resolve().then(p).catch((err) => { log.warn('monetization:', err); });
  const ready = Promise.race([
    Promise.all([settle(() => adsP && adsP.init()), settle(() => rcP && rcP.init())]),
    wait(m.readyTimeoutMs || 15000),
  ]).then(() => { notify(); return true; });

  // App lifecycle (native): pause / resume drive ad watchdogs, retries and purchase re-checks.
  const App = nativePlugin(cap, 'App');
  if (App) {
    listen(App, 'pause', () => onPause());
    listen(App, 'resume', () => onResume());
  }
  function onPause() {
    if (adsP) adsP.onPause();
  }
  function onResume() {
    if (adsP) adsP.onResume();
    if (rcP) rcP.onResume();
  }

  const noAds = () => !!(shop && shop.hasNoAds());
  let rewardedThisGameOver = false;
  const record = (field) => {
    if (!save) return;
    try { save.update((d) => { d.adState[field] = now(); }); } catch (e) { log.warn(e); }
  };

  const ads = {
    /** Interstitial (only through maybeInterstitial in the game). Resolves { shown }. */
    async showInterstitial(placement = 'gameover') {
      if (!adsP || noAds() || busy) return { shown: false };
      let r;
      try { r = await adsP.showInterstitial(placement); } catch (e) { log.warn(e); r = { shown: false }; }
      if (r && r.shown) record('lastInterstitialAt');
      return { shown: !!(r && r.shown) };
    },
    /**
     * Rewarded ad. Resolves { rewarded, shown, error? }; grant ONLY when rewarded === true.
     * error: 'no_ad' (nothing loaded in time / no fill / ads unavailable), 'cancelled' (user left the
     * loading overlay), 'show_failed', 'busy', 'disabled'.
     */
    async showRewarded(placement) {
      if (!adsP) return { rewarded: false, shown: false, error: 'disabled' };
      if (busy) return { rewarded: false, shown: false, error: 'busy' };
      let r;
      try { r = await adsP.showRewarded(placement); } catch (e) { log.warn(e); r = { rewarded: false, shown: false, error: 'show_failed' }; }
      const out = { rewarded: !!(r && r.rewarded), shown: !!(r && r.shown) };
      if (r && r.error) out.error = r.error;
      if (out.shown) {
        rewardedThisGameOver = true;
        record('lastRewardedAt');
      }
      return out;
    },
    /** 'ready' | 'loading' | 'unavailable' (ads can't be requested this session: hide the buttons). */
    rewardedState() {
      if (!adsP) return 'unavailable';
      try { return adsP.rewardedState(); } catch { return 'unavailable'; }
    },
    /** Rewarded buttons should be shown (a tap either plays an ad or explains why none is available). */
    rewardedAvailable() { return ads.rewardedState() !== 'unavailable'; },
    isRewardedReady() { return ads.rewardedState() === 'ready' && !busy; },
  };

  // ---- purchases ----
  const productDef = (id) => (cfg.products || []).find((p) => p.id === id) || null;
  const iap = {
    get enabled() { return iapEnabled; },
    get isMock() { return !!mockIap; },
    /** 'ready' | 'loading' | 'error' | 'idle' */
    productsState() {
      if (mockIap) return 'ready';
      return rcP ? rcP.productsState() : 'error';
    },
    /** Current product list (sync): { id, title, description, coins, priceString|null, available, tag? } */
    products() {
      if (mockIap) return (cfg.products || []).map((p) => publicProduct(p, shop));
      return rcP ? rcP.products() : [];
    },
    /** Resolves the product list, (re)fetching store prices when the last fetch failed. */
    async getProducts() {
      if (rcP && (rcP.productsState() === 'error' || rcP.productsState() === 'idle')) {
        try { await rcP.fetchProducts(); } catch (e) { log.warn(e); }
      }
      return iap.products();
    },
    /**
     * Buy a product. Resolves { ok, productId, coins?, noAds?, cancelled?, pending?, error? }.
     * Coins / No Ads are already granted when ok (real store: exactly once per transaction).
     * error: 'busy' | 'unknown_product' | 'already_owned' | 'network' | 'unavailable' | 'store_unavailable'
     *        | 'not_allowed' | 'still_processing' | 'failed' | 'disabled'
     */
    async purchase(productId) {
      const product = productDef(productId);
      if (!iapEnabled) return { ok: false, productId, error: 'disabled' };
      if (!product) return { ok: false, productId, error: 'unknown_product' };
      if (busy) return { ok: false, productId, error: 'busy' };
      if (product.grants && product.grants.noAds && noAds()) return { ok: false, productId, error: 'already_owned' };
      if (rcP) {
        try { return await rcP.purchase(productId); } catch (e) { log.warn(e); return { ok: false, productId, error: 'failed' }; }
      }
      try {
        const r = await mockIap.purchaseSheet(publicProduct(product, shop));
        if (!r || !r.ok) return { ok: false, productId, cancelled: !!(r && r.cancelled) };
        const g = shop ? shop.applyProduct(productId) : { ok: false };
        const out = { ok: true, productId };
        if (g.coins) out.coins = g.coins;
        if (g.noAds) out.noAds = true;
        return out;
      } catch (e) {
        log.warn(e);
        return { ok: false, productId, error: 'failed' };
      }
    },
    /**
     * Restore non-consumables (No Ads) for this store account. User action only.
     * Resolves { ok, noAds, restored: ['no_ads']?, coins?, error? }. Coin packs are consumables and are
     * never restorable on Google Play (they are used up when bought).
     */
    async restore() {
      if (!iapEnabled) return { ok: false, noAds: false, restored: [], error: 'disabled' };
      if (busy) return { ok: false, noAds: noAds(), restored: [], error: 'busy' };
      if (rcP) {
        try { return await rcP.restore(); } catch (e) { log.warn(e); return { ok: false, noAds: noAds(), restored: [], error: 'failed' }; }
      }
      // Mock: nothing to query; "restores" what the local save already owns.
      await wait(250);
      return { ok: true, noAds: noAds(), restored: noAds() ? ['no_ads'] : [] };
    },
    /** fn({ productId, coins, source: 'background' }) for coins credited outside a purchase flow. */
    onGrant(fn) { return rcP ? rcP.onGrant(fn) : () => {}; },
  };

  // ---- privacy options (Google UMP; Settings row only when required) ----
  const privacy = {
    required() { try { return !!(adsP && adsP.privacyRequired()); } catch { return false; } },
    async show() {
      if (!privacy.required() || busy) return { ok: false };
      try { return await adsP.showPrivacyOptions(); } catch (e) { log.warn(e); return { ok: false }; } finally { notify(); }
    },
  };

  /**
   * Interstitial policy, called when leaving Game Over (Play Again / Home). Shows one only when ALL hold:
   * ads on, no No Ads, gamesPlayed >= minGamesBeforeInterstitial, the game-over counter reached
   * interstitialEvery, not the first session, interstitialMinGapMs since the last one, no rewarded ad
   * in this game over and afterRewardedGapMs since the last rewarded ad, and one is already loaded.
   * The counter waits at the threshold while a gap rule blocks, so the next eligible game over shows it.
   */
  async function maybeInterstitial(saveArg = save) {
    const s = saveArg || save;
    if (!adsP || noAds() || !s || busy) return { shown: false };
    const t = now();
    let due = false;
    try {
      s.update((d) => {
        if (d.stats.gamesPlayed < m.minGamesBeforeInterstitial) return;
        d.adCounter = Math.min(m.interstitialEvery, (d.adCounter | 0) + 1);
        if (d.adCounter < m.interstitialEvery) return;
        const a = d.adState;
        if ((a.sessions | 0) < (m.minSessionsBeforeInterstitial || 0)) return;
        if (a.lastInterstitialAt && t - a.lastInterstitialAt < m.interstitialMinGapMs) return;
        if (rewardedThisGameOver) return;
        if (a.lastRewardedAt && t - a.lastRewardedAt < m.afterRewardedGapMs) return;
        if (!adsP.interstitialReady()) return;
        due = true;
      });
    } catch (e) {
      log.warn('maybeInterstitial', e);
    }
    if (!due) return { shown: false };
    const r = await ads.showInterstitial('gameover');
    if (r.shown) {
      try { s.update((d) => { d.adCounter = 0; }); } catch (e) { log.warn(e); }
    }
    return r;
  }

  return {
    mode,
    enabled,
    adsEnabled,
    iapEnabled,
    providers: { ads: adsP ? adsP.kind : null, iap: rcP ? 'revenuecat' : mockIap ? 'mock' : null },
    ready,
    ads,
    iap,
    privacy,
    entitlements: { noAds },
    maybeInterstitial,
    /** A new game over began (a rewarded ad in the previous one no longer blocks the interstitial). */
    onGameOver() { rewardedThisGameOver = false; },
    onPause,
    onResume,
    setMuted(v) { try { if (adsP) adsP.setMuted(!!v); } catch { /* ignore */ } },
    isBusy: () => busy,
    onBusyChange(fn) { busyListeners.add(fn); return () => busyListeners.delete(fn); },
    /** fn() when provider state changes (consent / privacy row, store prices, No Ads). */
    onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); },
    dispose() { if (adsP && adsP.dispose) adsP.dispose(); },
  };
}
