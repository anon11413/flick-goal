// Fake Capacitor native plugins (AdMob, Purchases, App) for tests. NO real SDK, no network.
//
// Works in two places:
//  - Node tests:  import './fakes/fakeCapacitor.js'; then globalThis.FakeCapacitor.createAdMob(...)
//  - Browser:     injected as a classic script before the game loads (Playwright addInitScript),
//                 then FakeCapacitor.install(window) makes the game think it runs in the Android app.
// Deliberately no import / export syntax so the same file runs as a classic script.
//
// The fakes mirror the real plugin behaviour the game code depends on (docs/MONETIZATION_PLAN.md §1):
//  - AdMob: prepare* resolves on load / rejects on no-fill; showRewardVideoAd resolves ONLY when the
//    reward is earned (never when the ad is closed early); events carry the plugin's event names.
//  - Purchases: error codes are strings; getProducts defaults to SUBSCRIPTION unless type is given;
//    customerInfo.nonSubscriptionTransactions use RevenueCat ids while the purchase result's
//    transaction carries the Google order id (a DIFFERENT id).
(function (root) {
  'use strict';

  function emitter() {
    const map = new Map();
    return {
      add(ev, cb) {
        if (!map.has(ev)) map.set(ev, new Set());
        map.get(ev).add(cb);
        return { remove() { const s = map.get(ev); if (s) s.delete(cb); } };
      },
      emit(ev, data) {
        const s = map.get(ev);
        if (s) for (const cb of Array.from(s)) { try { cb(data); } catch (e) { console.error(e); } }
      },
      count(ev) { const s = map.get(ev); return s ? s.size : 0; },
    };
  }
  const later = (ms, fn) => setTimeout(fn, ms);
  const never = () => new Promise(() => {});

  // ---------------------------------------------------------------- AdMob
  function createAdMob(opts) {
    const o = opts || {};
    const ev = emitter();
    const calls = [];
    const b = Object.assign({
      consent: { status: 'NOT_REQUIRED', isConsentFormAvailable: false, canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' },
      consentAfterForm: { status: 'OBTAINED', isConsentFormAvailable: true, canRequestAds: true, privacyOptionsRequirementStatus: 'REQUIRED' },
      consentFail: false,
      prepare: 'ok',            // 'ok' | 'nofill' | 'hang'
      prepareInterstitial: 'ok',
      prepareDelayMs: 5,
      rewarded: 'reward',       // 'reward' | 'skip' | 'late_reward' | 'fail_show' | 'reject'
      interstitial: 'ok',       // 'ok' | 'fail_show'
      adMs: 20,                 // how long the fake ad "plays"
    }, o.behavior || {});
    const rec = (name, args) => { calls.push({ name, args }); if (o.onCall) o.onCall(name, args); };
    const prep = (kind, args) => {
      rec(kind === 'rewarded' ? 'prepareRewardVideoAd' : 'prepareInterstitial', args);
      const mode = kind === 'rewarded' ? b.prepare : b.prepareInterstitial;
      if (mode === 'hang') return never();
      return new Promise((resolve, reject) => later(b.prepareDelayMs, () => {
        if (mode === 'nofill') {
          ev.emit(kind === 'rewarded' ? 'onRewardedVideoAdFailedToLoad' : 'interstitialAdFailedToLoad', { code: 3, message: 'No fill.' });
          reject({ code: '3', message: 'No fill.' });
        } else {
          ev.emit(kind === 'rewarded' ? 'onRewardedVideoAdLoaded' : 'interstitialAdLoaded', { adUnitId: args && args.adId });
          resolve({ adUnitId: args && args.adId });
        }
      }));
    };
    const api = {
      calls,
      behavior: b,
      emit: (name, data) => ev.emit(name, data),
      listenerCount: (name) => ev.count(name),
      addListener(name, cb) { return Promise.resolve(ev.add(name, cb)); },
      requestConsentInfo(args) {
        rec('requestConsentInfo', args);
        if (b.consentFail) return Promise.reject({ code: '1', message: 'offline' });
        return Promise.resolve(Object.assign({}, b.consent));
      },
      showConsentForm() {
        rec('showConsentForm');
        b.consent = Object.assign({}, b.consentAfterForm);
        return Promise.resolve(Object.assign({}, b.consentAfterForm));
      },
      showPrivacyOptionsForm() { rec('showPrivacyOptionsForm'); return Promise.resolve(); },
      resetConsentInfo() { rec('resetConsentInfo'); return Promise.resolve(); },
      initialize(args) { rec('initialize', args); return Promise.resolve(); },
      setApplicationMuted(args) { rec('setApplicationMuted', args); return Promise.resolve(); },
      prepareRewardVideoAd(args) { return prep('rewarded', args); },
      prepareInterstitial(args) { return prep('interstitial', args); },
      showRewardVideoAd(args) {
        rec('showRewardVideoAd', args);
        const mode = b.rewarded;
        if (mode === 'reject') return Promise.reject({ code: '0', message: 'Ad not prepared' });
        if (o.onShow) o.onShow('rewarded', mode);
        return new Promise((resolve) => {
          later(1, () => {
            if (mode === 'fail_show') { ev.emit('onRewardedVideoAdFailedToShow', { code: 1, message: 'Failed to show' }); return; }
            ev.emit('onRewardedVideoAdShowed');
            ev.emit('onRewardedVideoAdImpression', { valueMicros: 12000, currencyCode: 'USD' });
            later(b.adMs, () => {
              if (mode === 'reward') {
                ev.emit('onRewardedVideoAdReward', { type: 'coins', amount: 1 });
                resolve({ type: 'coins', amount: 1 }); // resolves ONLY on reward
                later(2, () => ev.emit('onRewardedVideoAdDismissed'));
              } else if (mode === 'late_reward') {
                ev.emit('onRewardedVideoAdDismissed');
                later(5, () => { ev.emit('onRewardedVideoAdReward', { type: 'coins', amount: 1 }); resolve({ type: 'coins', amount: 1 }); });
              } else {
                ev.emit('onRewardedVideoAdDismissed'); // closed early: the promise never settles
              }
            });
          });
        });
      },
      showInterstitial(args) {
        rec('showInterstitial', args);
        if (o.onShow) o.onShow('interstitial', b.interstitial);
        return new Promise((resolve) => {
          later(1, () => {
            if (b.interstitial === 'fail_show') { ev.emit('interstitialAdFailedToShow', { code: 1 }); resolve(); return; }
            ev.emit('interstitialAdShowed');
            resolve(); // resolves when SHOWN
            later(b.adMs, () => ev.emit('interstitialAdDismissed'));
          });
        });
      },
    };
    return api;
  }

  // ---------------------------------------------------------------- Purchases (RevenueCat)
  const DEFAULT_PRICES = { no_ads: '€3.19', coins_small: '€1.09', coins_medium: '€3.19', coins_large: '€5.49', coins_mega: '€10.99' };
  function createPurchases(opts) {
    const o = opts || {};
    const calls = [];
    const listeners = [];
    let n = 0;
    const clock = o.now || (() => Date.now());
    const prices = Object.assign({}, DEFAULT_PRICES, o.prices || {});
    const st = {
      txs: (o.history || []).slice(),    // RevenueCat transactions already on this store account
      noAds: !!o.noAdsOwned,             // the account owns the no_ads entitlement
      pending: [],
    };
    const b = Object.assign({
      purchase: 'ok',                    // 'ok' | 'cancel' | 'pending' | 'error' | 'network' | 'already'
      listenerBeforeResult: true,        // the listener fires with the new info BEFORE the purchase resolves
      txInResult: true,                  // the purchase result's customerInfo already lists the new transaction
      getProducts: 'ok',                 // 'ok' | 'fail' | 'empty'
      restore: 'ok',                     // 'ok' | 'fail'
    }, o.behavior || {});
    const rec = (name, args) => { calls.push({ name, args }); if (o.onCall) o.onCall(name, args); };
    const iso = (t) => new Date(t).toISOString();
    function ci(hide) {
      const txs = st.txs.filter((t) => t !== hide).map((t) => Object.assign({}, t));
      const active = {};
      const all = {};
      if (st.noAds) {
        const e = { identifier: 'no_ads', isActive: true, productIdentifier: 'no_ads' };
        active.no_ads = e;
        all.no_ads = e;
      }
      return {
        entitlements: { active, all },
        activeSubscriptions: [],
        allPurchasedProductIdentifiers: txs.map((t) => t.productIdentifier),
        nonSubscriptionTransactions: txs,
        requestDate: iso(clock()),
        originalAppUserId: '$RCAnonymousID:fake',
      };
    }
    function newTx(productId) {
      n += 1;
      const t = clock();
      const tx = { transactionIdentifier: 'rc_' + productId + '_' + n + '_' + t, productIdentifier: productId, purchaseDate: iso(t), purchaseDateMillis: t };
      st.txs.push(tx);
      if (productId === 'no_ads') st.noAds = true;
      return tx;
    }
    const fire = () => { const info = ci(); for (const cb of listeners.slice()) { try { cb(info); } catch (e) { console.error(e); } } };
    const api = {
      calls,
      behavior: b,
      state: st,
      customerInfo: () => ci(),
      /** Simulate Google Play confirming a pending payment later. */
      completePending() {
        const p = st.pending.shift();
        if (!p) return null;
        const tx = newTx(p);
        fire();
        return tx;
      },
      /** Simulate a purchase that finished on the store while the app was dead (JS never saw it). */
      addTransaction(productId) { return newTx(productId); },
      fireListeners: fire,
      configure(args) { rec('configure', args); return Promise.resolve(); },
      setLogLevel(args) { rec('setLogLevel', args); return Promise.resolve(); },
      addCustomerInfoUpdateListener(cb) {
        rec('addCustomerInfoUpdateListener');
        if (typeof cb === 'function') {
          listeners.push(cb);
          later(0, () => { try { cb(ci()); } catch (e) { console.error(e); } }); // cached value right away
        }
        return Promise.resolve('cb-' + listeners.length);
      },
      getProducts(args) {
        rec('getProducts', args);
        if (b.getProducts === 'fail') return Promise.reject({ code: '10', message: 'Network error' });
        const type = (args && args.type) || 'SUBSCRIPTION'; // the real default
        if (type !== 'NON_SUBSCRIPTION' || b.getProducts === 'empty') return Promise.resolve({ products: [] });
        const ids = (args && args.productIdentifiers) || [];
        return Promise.resolve({
          products: ids.filter((id) => prices[id]).map((id) => ({
            identifier: id, title: id + ' (Flick Goal)', description: id, price: 1, priceString: prices[id], currencyCode: 'EUR', productCategory: 'NON_SUBSCRIPTION', productType: id === 'no_ads' ? 'NON_CONSUMABLE' : 'CONSUMABLE',
          })),
        });
      },
      purchaseStoreProduct(args) {
        rec('purchaseStoreProduct', args);
        const id = args && args.product && args.product.identifier;
        const mode = b.purchase;
        return new Promise((resolve, reject) => later(5, () => {
          if (!id) return reject({ code: '5', message: 'product missing' });
          if (mode === 'cancel') return reject({ code: '1', message: 'Purchase was cancelled.', userCancelled: true });
          if (mode === 'pending') { st.pending.push(id); return reject({ code: '20', message: 'The payment is pending.' }); }
          if (mode === 'network') return reject({ code: '10', message: 'Network error.' });
          if (mode === 'error') return reject({ code: '2', message: 'There was a problem with the store.' });
          if (mode === 'already') return reject({ code: '6', message: 'This product is already active for the user.' });
          const tx = newTx(id);
          if (b.listenerBeforeResult) fire();
          resolve({
            productIdentifier: id,
            customerInfo: ci(b.txInResult ? null : tx),
            transaction: { transactionIdentifier: 'GPA.3312-' + n, productIdentifier: id, purchaseDate: tx.purchaseDate },
          });
        }));
      },
      getCustomerInfo() { rec('getCustomerInfo'); return Promise.resolve({ customerInfo: ci() }); },
      restorePurchases() {
        rec('restorePurchases');
        if (b.restore === 'fail') return Promise.reject({ code: '10', message: 'Network error.' });
        return Promise.resolve({ customerInfo: ci() });
      },
      syncPurchases() { rec('syncPurchases'); return Promise.resolve(); },
    };
    return api;
  }

  // ---------------------------------------------------------------- App
  function createApp() {
    const ev = emitter();
    return {
      emit: (name, data) => ev.emit(name, data),
      addListener(name, cb) { return Promise.resolve(ev.add(name, cb)); },
      exitApp() { return Promise.resolve(); },
    };
  }

  /** window.Capacitor as the Android bridge would inject it, with the given plugin fakes. */
  function makeCapacitor(plugins, platform) {
    const Plugins = Object.assign({}, plugins || {});
    return {
      Plugins,
      isNativePlatform: () => (platform || 'android') !== 'web',
      getPlatform: () => platform || 'android',
      isPluginAvailable: (name) => !!Plugins[name],
    };
  }

  function install(win, opts) {
    const o = opts || {};
    const plugins = {
      AdMob: o.AdMob || createAdMob(o.admob),
      Purchases: o.Purchases || createPurchases(o.purchases),
      App: o.App || createApp(),
    };
    win.Capacitor = makeCapacitor(plugins, o.platform);
    return plugins;
  }

  root.FakeCapacitor = { createAdMob, createPurchases, createApp, makeCapacitor, install, DEFAULT_PRICES };
})(typeof globalThis !== 'undefined' ? globalThis : window);
