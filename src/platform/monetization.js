// Monetization adapter: provider-agnostic Ads + IAP API with a MOCK provider only.
//
// NOTHING here talks to a real ad network or store. Real SDKs are added after owner approval:
//   - Ads: AdMob via `@capacitor-community/admob`
//       AdMob.initialize(); AdMob.prepareInterstitial({adId}); AdMob.showInterstitial();
//       AdMob.prepareRewardVideoAd({adId}); AdMob.showRewardVideoAd() -> listen 'onRewardedVideoAdReward'.
//   - IAP: RevenueCat `@revenuecat/purchases-capacitor` (or `cordova-plugin-purchase`)
//       Purchases.configure({apiKey}); Purchases.getOfferings(); Purchases.purchaseStoreProduct();
//       Purchases.restorePurchases() -> entitlements.active['no_ads'].
// A future `NativeProvider` implements the same provider interface as MockProvider:
//   { init(), showInterstitial(placement), showRewarded(placement), getProducts(), purchase(id), restore() }
// and is selected in createMonetization() by cfg.monetization.mode (e.g. 'native').
//
// Contract: every promise RESOLVES (never rejects). While an ad / purchase sheet is open,
// `busy` is true and main.js pauses the simulation and blocks game taps.

import { CONFIG } from '../config.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Mock provider: obvious in-DOM placeholders. Safe to ship to testers, never to production.
// ---------------------------------------------------------------------------
function createMockProvider({ cfg, root, onBusy }) {
  const m = cfg.monetization;
  let open = 0;
  const setBusy = (d) => {
    open = Math.max(0, open + d);
    onBusy(open > 0);
  };

  function adOverlay({ rewarded, placement }) {
    return new Promise((resolve) => {
      setBusy(1);
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
          setTimeout(() => { el.remove(); setBusy(-1); resolve(result); }, 180);
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
          finish({ rewarded: true }, 400);
        }, duration));
        noReward.addEventListener('click', () => finish({ rewarded: false }));
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
      setBusy(1);
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
        setTimeout(() => { el.remove(); setBusy(-1); resolve(result); }, 220);
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
    init: () => Promise.resolve(true),
    showInterstitial: (placement) => adOverlay({ rewarded: false, placement }),
    showRewarded: (placement) => adOverlay({ rewarded: true, placement }),
    getProducts: () => Promise.resolve(cfg.products.map(publicProduct)),
    purchase: (product) => purchaseSheet(product),
    restore: () => Promise.resolve({ ok: true }),
    isBusy: () => open > 0,
  };
}

function publicProduct(p) {
  const out = { id: p.id, type: p.type, title: p.title, description: p.description, priceString: p.priceString };
  if (p.tag) out.tag = p.tag;
  return out;
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------
export function createMonetization({ cfg = CONFIG, shop, root, onBusyChange } = {}) {
  const mode = cfg.monetization && cfg.monetization.mode === 'off' ? 'off' : 'mock';
  const enabled = mode !== 'off';
  let busy = false;
  const busyListeners = new Set();
  if (typeof onBusyChange === 'function') busyListeners.add(onBusyChange);
  const onBusy = (b) => {
    if (b === busy) return;
    busy = b;
    for (const fn of busyListeners) { try { fn(b); } catch (e) { console.error(e); } }
  };

  // Provider selection. Future: if (mode === 'native') provider = createNativeProvider(...)
  const provider = enabled && root ? createMockProvider({ cfg, root, onBusy }) : null;
  if (provider) provider.init().catch(() => {});

  const safe = (p, fallback) => Promise.resolve()
    .then(() => p())
    .catch((err) => { console.warn('monetization:', err); return fallback; });

  const noAds = () => !!(shop && shop.hasNoAds());

  const ads = {
    showInterstitial(placement = 'gameover') {
      if (!provider || noAds() || busy) return Promise.resolve({ shown: false });
      return safe(() => provider.showInterstitial(placement).then(() => ({ shown: true })), { shown: false });
    },
    showRewarded(placement) {
      if (!provider || busy) return Promise.resolve({ rewarded: false });
      return safe(() => provider.showRewarded(placement).then((r) => ({ rewarded: !!(r && r.rewarded) })), { rewarded: false });
    },
    isRewardedReady() {
      return !!provider && !busy;
    },
  };

  const iap = {
    getProducts() {
      if (!provider) return Promise.resolve([]);
      return safe(() => provider.getProducts(), []);
    },
    purchase(productId) {
      const product = (cfg.products || []).find((p) => p.id === productId);
      if (!provider) return Promise.resolve({ ok: false, productId, error: 'disabled' });
      if (!product) return Promise.resolve({ ok: false, productId, error: 'unknown_product' });
      if (busy) return Promise.resolve({ ok: false, productId, error: 'busy' });
      if (product.grants && product.grants.noAds && noAds()) {
        return Promise.resolve({ ok: false, productId, error: 'already_owned' });
      }
      return safe(() => provider.purchase(product).then((r) => {
        if (!r || !r.ok) return { ok: false, productId, cancelled: !!(r && r.cancelled), error: r && r.error };
        // Real providers: grant only after the store confirms (and the receipt is validated).
        if (shop) shop.applyProduct(productId);
        return { ok: true, productId };
      }), { ok: false, productId, error: 'provider_error' });
    },
    restore() {
      if (!provider) return Promise.resolve({ ok: false, restored: [] });
      // Mock: we can only "restore" what the local save says is owned. A native provider would
      // query the store's purchase history and re-grant non-consumables (setNoAds(true)).
      return safe(() => provider.restore().then(() => {
        const restored = [];
        if (noAds()) {
          shop.setNoAds(true);
          restored.push('no_ads');
        }
        return { ok: true, restored };
      }), { ok: false, restored: [] });
    },
  };

  /**
   * Interstitial policy (call when leaving Game Over via Play Again / Home):
   * enabled && !noAds && gamesPlayed >= minGamesBeforeInterstitial && ++adCounter >= interstitialEvery.
   */
  function maybeInterstitial(save) {
    if (!enabled || noAds() || !save) return Promise.resolve({ shown: false });
    const m = cfg.monetization;
    let due = false;
    try {
      save.update((d) => {
        if (d.stats.gamesPlayed < m.minGamesBeforeInterstitial) return;
        d.adCounter += 1;
        if (d.adCounter >= m.interstitialEvery) {
          d.adCounter = 0;
          due = true;
        }
      });
    } catch (e) {
      console.warn('maybeInterstitial', e);
    }
    return due ? ads.showInterstitial('gameover') : Promise.resolve({ shown: false });
  }

  return {
    mode,
    enabled,
    ads,
    iap,
    entitlements: { noAds },
    maybeInterstitial,
    isBusy: () => busy,
    onBusyChange(fn) { busyListeners.add(fn); return () => busyListeners.delete(fn); },
  };
}
