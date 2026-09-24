// AdMob ads provider (@capacitor-community/admob 8.x through Capacitor.Plugins.AdMob).
//
// Order of operations (Google's, not the plugin README's): consent info (UMP) -> consent form if
// required -> AdMob.initialize() only when canRequestAds -> preload one rewarded + one interstitial.
//
// Plugin facts this code relies on (checked in the plugin's Android sources, docs/MONETIZATION_PLAN.md §1.3):
//  - prepareRewardVideoAd / prepareInterstitial resolve when loaded and REJECT on load failure.
//  - showRewardVideoAd() resolves ONLY when the reward is earned; closing the ad early leaves it
//    pending forever, and a failure to show only fires an event. So a show is never awaited on its
//    own: it finishes on the Dismissed / FailedToShow events, and the reward counts only when the
//    Reward event (or the reward-item resolve) happened.
//  - showInterstitial() resolves as soon as the ad is SHOWN; the end is the Dismissed event.
//
// The provider never touches the DOM (the adapter passes hooks.showLoading) and every public
// promise resolves. Pure enough for Node tests with a fake AdMob object (tests/fakes/fakeCapacitor.js).

import { call, listen } from './native.js';

/** Google's official sample ids (https://developers.google.com/admob/android/test-ads). */
export const GOOGLE_TEST_IDS = Object.freeze({
  appId: 'ca-app-pub-3940256099942544~3347511713',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
});
export const TEST_PUBLISHER = '3940256099942544';

const EV = {
  rLoaded: 'onRewardedVideoAdLoaded',
  rFailedToLoad: 'onRewardedVideoAdFailedToLoad',
  rShowed: 'onRewardedVideoAdShowed',
  rFailedToShow: 'onRewardedVideoAdFailedToShow',
  rDismissed: 'onRewardedVideoAdDismissed',
  rReward: 'onRewardedVideoAdReward',
  rImpression: 'onRewardedVideoAdImpression',
  iLoaded: 'interstitialAdLoaded',
  iFailedToLoad: 'interstitialAdFailedToLoad',
  iShowed: 'interstitialAdShowed',
  iFailedToShow: 'interstitialAdFailedToShow',
  iDismissed: 'interstitialAdDismissed',
  iImpression: 'interstitialAdImpression',
};
export const ADMOB_EVENTS = EV;

/** True when this build must use Google's test units (everything except a release build with adMode 'live'). */
export function forceTestAds(build) {
  return !(build && build.profile === 'android-release' && build.adMode === 'live');
}

/**
 * createAdMobAdsProvider({ AdMob, cfg, build, onBusy(delta), hooks: { showLoading(onCancel) -> hide() }, now, log, win })
 * win: optional event target for the 'online' event (consent retry); defaults to the global window.
 */
export function createAdMobAdsProvider({ AdMob, cfg, build, onBusy = () => {}, hooks = {}, now = () => Date.now(), log = console, win } = {}) {
  const m = cfg.monetization;
  const ids = (cfg.store && cfg.store.admob) || {};
  const testAds = forceTestAds(build);
  const debugBuild = !build || build.profile !== 'android-release';
  const unitId = (fmt) => (testAds || !ids[fmt] ? GOOGLE_TEST_IDS[fmt] : ids[fmt]);
  const backoff = Array.isArray(m.preloadRetryMs) && m.preloadRetryMs.length ? m.preloadRetryMs : [30000];
  const hardTimeoutMs = m.adHardTimeoutMs || 5 * 60 * 1000;

  let disposed = false;
  let initPromise = null;
  let initSettled = false;
  let consent = 'unknown';          // 'unknown' | 'NOT_REQUIRED' | 'OBTAINED' | 'REQUIRED' | 'UNKNOWN' | 'error'
  let canRequestAds = false;
  let privacyRequired = false;
  let initialized = false;
  let initializing = null;
  let refreshing = null;
  let quiet = false;                // a background consent retry is running (buttons keep their state)
  let consentFails = 0;
  let consentRetry = 0;
  let formDeferred = false;         // a background retry found a consent form to show: shown on resume
  let current = null;               // the full-screen ad being shown
  let muted = null;
  const removers = [];
  const changeListeners = new Set();
  const formats = {
    rewarded: { status: 'idle', loadedAt: 0, fails: 0, retry: 0, waiters: new Set() },
    interstitial: { status: 'idle', loadedAt: 0, fails: 0, retry: 0, waiters: new Set() },
  };

  const notify = () => {
    for (const fn of Array.from(changeListeners)) { try { fn(); } catch (e) { log.error(e); } }
  };
  const canLoad = () => !disposed && initialized && canRequestAds;
  const isFresh = (f) => f.status === 'ready' && now() - f.loadedAt < m.adMaxAgeMs;

  // ---------------------------------------------------------------- events (registered once)
  function on(event, fn) { removers.push(listen(AdMob, event, fn)); }
  function registerListeners() {
    on(EV.rShowed, () => { if (current && current.fmt === 'rewarded') current.showed = true; });
    on(EV.rReward, () => {
      if (!current || current.fmt !== 'rewarded') return;
      current.earned = true;
      if (current.dismissed) current.finish(); // late reward inside the grace window
    });
    on(EV.rDismissed, () => onDismissed('rewarded'));
    on(EV.rFailedToShow, () => onFailedToShow('rewarded'));
    on(EV.iShowed, () => { if (current && current.fmt === 'interstitial') current.showed = true; });
    on(EV.iDismissed, () => onDismissed('interstitial'));
    on(EV.iFailedToShow, () => onFailedToShow('interstitial'));
    if (debugBuild) {
      const imp = (fmt) => (info) => {
        try { log.info(`[ads] ${fmt} impression`, info && info.valueMicros != null ? `${info.valueMicros / 1e6} ${info.currencyCode || ''}` : ''); } catch { /* ignore */ }
      };
      on(EV.rImpression, imp('rewarded'));
      on(EV.iImpression, imp('interstitial'));
    }
  }
  function onDismissed(fmt) {
    const op = current;
    if (!op || op.fmt !== fmt) return;
    op.dismissed = true;
    if (fmt === 'rewarded' && !op.earned) op.later(() => op.finish(), m.rewardGraceMs);
    else op.finish();
  }
  function onFailedToShow(fmt) {
    const op = current;
    if (!op || op.fmt !== fmt) return;
    op.finish(op.showed ? undefined : 'show_failed');
  }

  // ---------------------------------------------------------------- consent + init
  function consentOptions() {
    const o = { tagForUnderAgeOfConsent: !!ids.tagForUnderAgeOfConsent };
    if (debugBuild) {
      if (ids.umpDebugGeography) o.debugGeography = ids.umpDebugGeography;
      if (Array.isArray(ids.umpTestDeviceIds) && ids.umpTestDeviceIds.length) o.testDeviceIdentifiers = ids.umpTestDeviceIds.slice();
    }
    return o;
  }

  function applyInfo(info) {
    const i = info && typeof info === 'object' ? info : {};
    consent = typeof i.status === 'string' ? i.status : 'UNKNOWN';
    canRequestAds = i.canRequestAds === true;
    privacyRequired = i.privacyOptionsRequirementStatus === 'REQUIRED';
    if (!canRequestAds) {
      // consent withdrawn: drop cached ads, stop retries
      for (const f of Object.values(formats)) { clearTimeout(f.retry); f.status = 'idle'; }
    }
  }

  /**
   * Consent info failed (offline / UMP error): retry in the background on the preload backoff and as
   * soon as the device comes back online, so ads return without leaving the app. A background retry
   * never pops the consent form mid-game: a form it finds is shown on the next resume.
   */
  function scheduleConsentRetry() {
    clearTimeout(consentRetry);
    if (disposed) return;
    const wait = backoff[Math.min(Math.max(0, consentFails - 1), backoff.length - 1)];
    consentRetry = setTimeout(retryConsentNow, wait);
    if (consentRetry && typeof consentRetry.unref === 'function') consentRetry.unref();
  }
  function retryConsentNow() {
    clearTimeout(consentRetry);
    if (disposed || consent !== 'error' || refreshing || current) return;
    quiet = true;
    refreshConsent({ showForm: false }).finally(() => { quiet = false; notify(); });
  }
  const onOnline = () => retryConsentNow();
  const eventTarget = win !== undefined ? win : (typeof window !== 'undefined' ? window : null);

  /** Request consent info (every launch), show the form when required, then initialize + preload. */
  function refreshConsent({ showForm = true } = {}) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const r = await call(AdMob, 'requestConsentInfo', consentOptions(), m.consentTimeoutMs);
      if (disposed) return;
      if (!r.ok) {
        consent = 'error'; // offline / UMP error: no ads for now, retried in the background / on resume
        consentFails += 1;
        log.warn('[ads] consent info failed', r.error && r.error.message);
        scheduleConsentRetry();
        notify();
        return;
      }
      consentFails = 0;
      clearTimeout(consentRetry);
      let info = r.value || {};
      formDeferred = !showForm && info.status === 'REQUIRED' && !!info.isConsentFormAvailable && info.canRequestAds !== true;
      if (showForm && info.status === 'REQUIRED' && info.isConsentFormAvailable) {
        onBusy(1);
        try {
          const f = await call(AdMob, 'showConsentForm');
          if (f.ok && f.value && typeof f.value === 'object') info = f.value;
          else {
            const again = await call(AdMob, 'requestConsentInfo', consentOptions(), m.consentTimeoutMs);
            if (again.ok && again.value) info = again.value;
          }
        } finally {
          onBusy(-1);
        }
      }
      if (disposed) return;
      applyInfo(info);
      if (canRequestAds) await initializeOnce();
      notify();
      if (canLoad()) { load('rewarded'); load('interstitial'); }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  function initializeOnce() {
    if (initialized) return Promise.resolve(true);
    if (initializing) return initializing;
    const devices = Array.isArray(ids.testDeviceIds) ? ids.testDeviceIds.filter((s) => typeof s === 'string' && s) : [];
    initializing = call(AdMob, 'initialize', {
      initializeForTesting: devices.length > 0,
      testingDevices: devices,
      tagForChildDirectedTreatment: !!ids.tagForChildDirectedTreatment,
      tagForUnderAgeOfConsent: !!ids.tagForUnderAgeOfConsent,
      maxAdContentRating: ids.maxAdContentRating || 'ParentalGuidance',
    }, m.consentTimeoutMs).then((r) => {
      initialized = r.ok;
      if (!r.ok) log.warn('[ads] initialize failed', r.error && r.error.message);
      if (r.ok && muted !== null) call(AdMob, 'setApplicationMuted', { muted });
      return r.ok;
    }).finally(() => { initializing = null; });
    return initializing;
  }

  function init() {
    if (!initPromise) {
      registerListeners();
      try { if (eventTarget && typeof eventTarget.addEventListener === 'function') eventTarget.addEventListener('online', onOnline); } catch { /* ignore */ }
      initPromise = refreshConsent({ showForm: true })
        .catch((e) => log.warn('[ads] init', e))
        .then(() => { initSettled = true; notify(); return state(); });
    }
    return initPromise;
  }

  // ---------------------------------------------------------------- preload
  async function load(fmt) {
    const f = formats[fmt];
    if (!canLoad() || !f) return;
    if (f.status === 'loading' || isFresh(f)) return;
    if (current && current.fmt === fmt) return; // never replace the ad on screen
    clearTimeout(f.retry);
    f.status = 'loading';
    const method = fmt === 'rewarded' ? 'prepareRewardVideoAd' : 'prepareInterstitial';
    const r = await call(AdMob, method, { adId: unitId(fmt), isTesting: testAds, immersiveMode: true }, m.loadTimeoutMs);
    if (disposed) return;
    if (r.ok) {
      f.status = 'ready';
      f.loadedAt = now();
      f.fails = 0;
    } else {
      f.status = 'failed';
      f.fails += 1;
      const wait = backoff[Math.min(f.fails - 1, backoff.length - 1)];
      f.retry = setTimeout(() => { if (f.status === 'failed') load(fmt); }, wait);
    }
    for (const w of Array.from(f.waiters)) w();
    notify();
  }

  /** Resolve true once `fmt` is loaded, false on failure / timeout. Starts a load when none runs. */
  function waitReady(fmt, timeoutMs) {
    const f = formats[fmt];
    if (isFresh(f)) return Promise.resolve(true);
    if (f.status === 'ready') f.status = 'idle'; // stale
    if (f.status !== 'loading') {
      clearTimeout(f.retry);
      load(fmt);
    }
    if (isFresh(f)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let t = 0;
      const done = (v) => { clearTimeout(t); f.waiters.delete(w); resolve(v); };
      const w = () => { if (f.status === 'ready') done(true); else if (f.status !== 'loading') done(false); };
      f.waiters.add(w);
      t = setTimeout(() => done(isFresh(f)), timeoutMs);
      if (f.status !== 'loading') w();
    });
  }

  // ---------------------------------------------------------------- show
  function runShow(fmt) {
    return new Promise((resolve) => {
      const timers = [];
      const op = {
        fmt, earned: false, showed: false, dismissed: false, paused: false, finished: false,
        later(fn, ms) { timers.push(setTimeout(fn, ms)); },
        finish(error) {
          if (op.finished) return;
          op.finished = true;
          timers.forEach(clearTimeout);
          if (current === op) current = null;
          const shown = op.showed || op.dismissed;
          const out = fmt === 'rewarded' ? { rewarded: op.earned, shown } : { shown };
          if (error) out.error = error;
          resolve(out);
        },
      };
      current = op;
      op.later(() => { if (!op.showed && !op.dismissed) op.finish('show_failed'); }, m.showTimeoutMs);
      op.later(() => op.finish(), hardTimeoutMs);
      const method = fmt === 'rewarded' ? 'showRewardVideoAd' : 'showInterstitial';
      Promise.resolve()
        .then(() => AdMob[method]({ adId: unitId(fmt) }))
        .then((v) => {
          // Android: this resolves only when the reward was earned (with the reward item).
          if (fmt === 'rewarded' && v && typeof v === 'object' && ('amount' in v || 'type' in v)) {
            op.earned = true;
            if (op.dismissed) op.finish();
          }
        }, () => { if (!op.showed && !op.dismissed) op.finish('show_failed'); });
    });
  }

  let showing = false;
  async function showRewarded() {
    if (showing || current) return { rewarded: false, shown: false, error: 'busy' };
    if (!canLoad()) return { rewarded: false, shown: false, error: 'no_ad' };
    showing = true;
    onBusy(1);
    try {
      if (!isFresh(formats.rewarded)) {
        let cancel = null;
        const cancelled = new Promise((r) => { cancel = () => r('cancel'); });
        let hide = null;
        try { hide = hooks.showLoading ? hooks.showLoading(() => cancel()) : null; } catch { hide = null; }
        const got = await Promise.race([waitReady('rewarded', m.rewardedLoadTimeoutMs), cancelled]);
        try { if (hide) hide(); } catch { /* ignore */ }
        if (got === 'cancel') return { rewarded: false, shown: false, error: 'cancelled' };
        if (!got || disposed) return { rewarded: false, shown: false, error: 'no_ad' };
      }
      formats.rewarded.status = 'idle'; // an ad object is single-use
      return await runShow('rewarded');
    } finally {
      showing = false;
      onBusy(-1);
      load('rewarded');
    }
  }

  async function showInterstitial() {
    if (showing || current) return { shown: false, error: 'busy' };
    if (!canLoad() || !isFresh(formats.interstitial)) {
      load('interstitial');
      return { shown: false, error: 'no_ad' }; // never wait for an interstitial
    }
    showing = true;
    onBusy(1);
    try {
      formats.interstitial.status = 'idle';
      return await runShow('interstitial');
    } finally {
      showing = false;
      onBusy(-1);
      load('interstitial');
    }
  }

  function rewardedState() {
    if (disposed) return 'unavailable';
    if (!initSettled || (refreshing && !quiet) || initializing) return isFresh(formats.rewarded) ? 'ready' : 'loading';
    if (!canLoad()) return 'unavailable';
    return isFresh(formats.rewarded) ? 'ready' : 'loading';
  }

  // ---------------------------------------------------------------- privacy options (Settings row)
  async function showPrivacyOptions() {
    if (!privacyRequired || showing) return { ok: false };
    onBusy(1);
    let r;
    try {
      r = await call(AdMob, 'showPrivacyOptionsForm');
    } finally {
      onBusy(-1);
    }
    await refreshConsent({ showForm: false });
    return { ok: !!(r && r.ok) };
  }

  // ---------------------------------------------------------------- lifecycle
  function onPause() {
    if (current) current.paused = true;
  }
  function onResume() {
    const op = current;
    if (op && op.paused) {
      // our activity is back: the ad closed. Dismissed normally follows at once; finish anyway.
      op.later(() => op.finish(), m.resumeWatchdogMs);
      return;
    }
    if (current || disposed || !initSettled) return;
    if (consent === 'error' || formDeferred || (canRequestAds && !initialized)) {
      clearTimeout(consentRetry);
      refreshConsent({ showForm: true });
      return;
    }
    for (const fmt of Object.keys(formats)) {
      const f = formats[fmt];
      if (f.status === 'failed' || (f.status === 'ready' && !isFresh(f))) {
        if (f.status === 'ready') f.status = 'idle';
        clearTimeout(f.retry);
        load(fmt);
      }
    }
  }

  function setMuted(v) {
    muted = !!v;
    if (initialized) call(AdMob, 'setApplicationMuted', { muted });
  }

  function state() {
    return { consent, canRequestAds, privacyRequired, initialized, testAds, rewarded: formats.rewarded.status, interstitial: formats.interstitial.status };
  }

  function dispose() {
    disposed = true;
    clearTimeout(consentRetry);
    try { if (eventTarget && typeof eventTarget.removeEventListener === 'function') eventTarget.removeEventListener('online', onOnline); } catch { /* ignore */ }
    for (const f of Object.values(formats)) clearTimeout(f.retry);
    for (const r of removers.splice(0)) r();
    if (current) current.finish('disposed');
  }

  return {
    kind: 'admob',
    init,
    state,
    rewardedState,
    interstitialReady: () => canLoad() && isFresh(formats.interstitial),
    showRewarded,
    showInterstitial,
    privacyRequired: () => privacyRequired,
    showPrivacyOptions,
    onPause,
    onResume,
    setMuted,
    onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); },
    isBusy: () => showing || !!current,
    dispose,
  };
}
