// RevenueCat purchases provider (@revenuecat/purchases-capacitor 13.x through Capacitor.Plugins.Purchases,
// Google Play Billing 8 underneath). docs/MONETIZATION_PLAN.md §1.6, §5.5, §5.6.
//
// Products: one-time products fetched with getProducts({ type: 'NON_SUBSCRIPTION' }) (the plugin
// defaults to SUBSCRIPTION, which would find nothing). RevenueCat acknowledges / consumes Play
// purchases itself: no_ads must be marked NON-consumable in the RevenueCat dashboard (and be the only
// product on the `no_ads` entitlement); coin packs stay consumable.
//
// Exactly-once coins: every coin transaction in customerInfo.nonSubscriptionTransactions is keyed
// on RevenueCat's transactionIdentifier (NOT the Google order id the purchase result carries) and
// credited through shop.creditPurchase(), which checks + records + credits in ONE save.update.
// reconcile() is the single entry point for the purchase result, the customer-info listener, launch,
// resume and restore, so duplicate events, an app killed mid-purchase and pending payments that
// complete later are all credited exactly once. The first purchase-history read of a save is its
// baseline: everything visible then is history and never credited (a reinstall never refills coins),
// EXCEPT transactions purchased within cfg.monetization.iapBaselineCreditWindowMs before it: those are
// most likely paid purchases that were never credited (receipt post failed / app killed, then the app
// data was wiped); Billing 8 only re-surfaces UNCONSUMED purchases to a fresh install anyway.
//
// Every public promise resolves. Tests drive it with a fake Purchases object (tests/fakes/fakeCapacitor.js).

import { call } from './native.js';

/** RevenueCat PURCHASES_ERROR_CODE values (they arrive as strings). */
export const RC_ERR = Object.freeze({
  CANCELLED: '1',
  STORE_PROBLEM: '2',
  NOT_ALLOWED: '3',
  NOT_AVAILABLE: '5',
  ALREADY_PURCHASED: '6',
  NETWORK: '10',
  IN_PROGRESS: '15',
  PENDING: '20',
  CONFIGURATION: '23',
  OFFLINE: '35',
});

const EPOCH_SLACK_MS = 5 * 60 * 1000;

/**
 * The RevenueCat public SDK key for this build, or '' (purchases hidden). Release builds use ONLY
 * the Google key and never a Test Store key ("test_..."); other builds prefer the Test Store key.
 */
export function revenueCatApiKey(cfg, build) {
  const rc = (cfg && cfg.store && cfg.store.revenuecat) || {};
  const google = typeof rc.googleApiKey === 'string' ? rc.googleApiKey.trim() : '';
  const test = typeof rc.testStoreApiKey === 'string' ? rc.testStoreApiKey.trim() : '';
  const bad = (k) => !k || /^sk_/i.test(k); // never a secret key
  if (build && build.profile === 'android-release') return bad(google) || /^test_/i.test(google) ? '' : google;
  if (!bad(test)) return test;
  return bad(google) ? '' : google;
}

const ciOf = (v) => (v && typeof v === 'object' && v.customerInfo && typeof v.customerInfo === 'object' ? v.customerInfo : v);
function ms(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v) {
    const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * createRevenueCatIapProvider({ Purchases, cfg, build, shop, apiKey, onBusy(delta), now, log })
 */
export function createRevenueCatIapProvider({ Purchases, cfg, build, shop, apiKey, onBusy = () => {}, now = () => Date.now(), log = console } = {}) {
  const m = cfg.monetization;
  const entId = (cfg.store && cfg.store.revenuecat && cfg.store.revenuecat.noAdsEntitlement) || 'no_ads';
  const debugBuild = !build || build.profile !== 'android-release';
  // Taking No Ads away again (refund / revoke) only on release builds with the Google key.
  const revokeAllowed = !!build && build.profile === 'android-release' && !/^test_/i.test(apiKey || '');
  const catalog = (cfg.products || []).slice();
  const productIds = catalog.map((p) => p.id);

  let configured = false;
  let initPromise = null;
  let baselinePromise = null;
  let productsState = 'idle';       // 'idle' | 'loading' | 'ready' | 'error'
  let productsPromise = null;
  const storeProducts = new Map();  // id -> store product object (passed back to purchaseStoreProduct as-is)
  let busy = false;
  let inflight = null;              // { productId, coins } while a purchase sheet is open
  let lastResumeSync = 0;
  let lastNoAds = null;
  const grantListeners = new Set();
  const changeListeners = new Set();

  const notify = () => {
    for (const fn of Array.from(changeListeners)) { try { fn(); } catch (e) { log.error(e); } }
  };
  const emitGrant = (g) => {
    for (const fn of Array.from(grantListeners)) { try { fn(g); } catch (e) { log.error(e); } }
  };

  // ---------------------------------------------------------------- reconcile (THE ledger entry point)
  function coinTransactions(ci) {
    const list = ci && Array.isArray(ci.nonSubscriptionTransactions) ? ci.nonSubscriptionTransactions : [];
    const out = [];
    for (const tx of list) {
      if (!tx || typeof tx !== 'object') continue;
      const id = typeof tx.transactionIdentifier === 'string' ? tx.transactionIdentifier : '';
      const productId = typeof tx.productIdentifier === 'string' ? tx.productIdentifier : '';
      if (!id || shop.productCoins(productId) <= 0) continue;
      out.push({ id, productId, t: ms(tx.purchaseDateMillis) || ms(tx.purchaseDate) });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  function noAdsFrom(ci) {
    const ent = ci && ci.entitlements;
    const active = !!(ent && ent.active && ent.active[entId]);
    const known = !!(ent && ent.all && ent.all[entId]);
    return { active, knownInactive: known && !active };
  }

  /**
   * Apply one CustomerInfo: No Ads entitlement + exactly-once coin credits.
   * fresh = it came from a direct request (launch / resume / purchase / restore), not the listener cache.
   * Returns { credited: [{ txId, productId, coins }], noAds (local flag after this), entitled (store says No Ads) }.
   */
  function reconcile(ci, { fresh = false } = {}) {
    const credited = [];
    if (!ci || typeof ci !== 'object') return { credited, noAds: shop.hasNoAds(), entitled: false };
    const txs = coinTransactions(ci);
    const ledger = shop.iapState();
    const credit = (tx) => {
      const coins = shop.creditPurchase({ txId: tx.id, productId: tx.productId, t: tx.t });
      if (coins > 0) credited.push({ txId: tx.id, productId: tx.productId, coins });
    };
    if (!(ledger.since > 0)) {
      // First purchase-history read for this save: history is never credited, except very recent
      // transactions (paid but most likely never credited, see the header).
      const epoch = ms(ci.requestDate) || ms(ci.requestDateMillis) || now();
      const win = Math.max(0, Number(m.iapBaselineCreditWindowMs) || 0);
      const recent = (tx) => win > 0 && tx.t > 0 && tx.t >= epoch - win;
      shop.markProcessed(txs.filter((tx) => !recent(tx)).map((tx) => ({ id: tx.id, t: tx.t })));
      shop.setIapEpoch(epoch);
      for (const tx of txs) if (recent(tx) && !shop.hasProcessed(tx.id, tx.t)) credit(tx);
    } else {
      const floor = ledger.since - EPOCH_SLACK_MS;
      for (const tx of txs) {
        if (shop.hasProcessed(tx.id, tx.t)) continue; // in the ledger, or at / before its pruning floor
        if (tx.t && tx.t < floor) continue;            // older than this save's ledger (never credited)
        if (shop.resolveOrphan({ txId: tx.id, productId: tx.productId, t: tx.t })) continue;
        credit(tx);
      }
    }
    const na = noAdsFrom(ci);
    if (na.active) shop.setNoAds(true);
    else if (fresh && revokeAllowed && na.knownInactive && shop.hasNoAds()) shop.setNoAds(false); // refunded / revoked
    // Credits for the product being bought right now belong to that purchase flow; others are
    // "background" grants (pending payment completed, app killed mid-purchase, restore).
    for (const c of credited) {
      if (inflight && inflight.productId === c.productId) inflight.coins += c.coins;
      else emitGrant({ productId: c.productId, coins: c.coins, source: 'background' });
    }
    if (lastNoAds !== shop.hasNoAds()) { lastNoAds = shop.hasNoAds(); notify(); }
    return { credited, noAds: shop.hasNoAds(), entitled: na.active };
  }

  async function fetchCustomerInfo() {
    const r = await call(Purchases, 'getCustomerInfo', undefined, 15000);
    if (!r.ok) return null;
    return reconcile(ciOf(r.value), { fresh: true });
  }

  /** The ledger baseline must exist before any purchase (else that purchase would count as history). */
  function ensureBaseline() {
    if (shop.iapState().since > 0) return Promise.resolve(true);
    if (!baselinePromise) {
      baselinePromise = fetchCustomerInfo().then(() => shop.iapState().since > 0).finally(() => { baselinePromise = null; });
    }
    return baselinePromise;
  }

  // ---------------------------------------------------------------- products
  function fetchProducts() {
    if (productsPromise) return productsPromise;
    productsState = 'loading';
    notify();
    productsPromise = call(Purchases, 'getProducts', { productIdentifiers: productIds, type: 'NON_SUBSCRIPTION' }, 15000)
      .then((r) => {
        const list = r.ok && r.value && Array.isArray(r.value.products) ? r.value.products : (r.ok && Array.isArray(r.value) ? r.value : []);
        for (const sp of list) {
          if (sp && typeof sp.identifier === 'string' && productIds.includes(sp.identifier)) storeProducts.set(sp.identifier, sp);
        }
        productsState = storeProducts.size ? 'ready' : 'error';
        if (!r.ok) log.warn('[iap] getProducts failed', r.error && r.error.message);
        else if (!storeProducts.size) log.warn('[iap] no products found: check the ids in Play Console / RevenueCat');
      })
      .finally(() => { productsPromise = null; notify(); });
    return productsPromise;
  }

  function products() {
    return catalog.map((p) => {
      const sp = storeProducts.get(p.id);
      const out = {
        id: p.id,
        type: p.type,
        title: p.title,
        description: p.description,
        coins: shop.productCoins(p.id),
        priceString: sp && typeof sp.priceString === 'string' ? sp.priceString : null,
        available: !!sp,
      };
      if (p.tag) out.tag = p.tag;
      return out;
    });
  }

  // ---------------------------------------------------------------- init
  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const c = await call(Purchases, 'configure', { apiKey, appUserID: null }, 15000);
      if (!c.ok) {
        productsState = 'error';
        log.warn('[iap] configure failed', c.error && c.error.message);
        notify();
        return false;
      }
      configured = true;
      if (debugBuild) call(Purchases, 'setLogLevel', { level: 'DEBUG' });
      try {
        // RETURN_CALLBACK method: the bridge passes a lone function argument through as the callback.
        const fn = Purchases.addCustomerInfoUpdateListener;
        if (typeof fn === 'function') {
          const r = fn.call(Purchases, (info) => { try { reconcile(ciOf(info)); } catch (e) { log.error(e); } });
          if (r && typeof r.catch === 'function') r.catch(() => {});
        }
      } catch (e) { log.warn('[iap] listener', e); }
      const productsLoad = fetchProducts();
      if (!shop.iapState().synced) {
        // First launch of this install: silent sync restores No Ads after a reinstall (no prompt).
        const s = await call(Purchases, 'syncPurchases', undefined, 20000);
        if (s.ok) shop.setIapSynced();
      }
      await fetchCustomerInfo();
      await productsLoad;
      return true;
    })().catch((e) => { log.warn('[iap] init', e); return false; });
    return initPromise;
  }

  // ---------------------------------------------------------------- purchase
  function failure(productId, error) {
    const code = error && error.code;
    if (code === RC_ERR.CANCELLED) return { ok: false, productId, cancelled: true };
    if (code === RC_ERR.PENDING) return { ok: false, productId, pending: true };
    if (code === RC_ERR.IN_PROGRESS) return { ok: false, productId, error: 'busy' };
    if (code === RC_ERR.NETWORK || code === RC_ERR.OFFLINE || code === 'timeout') return { ok: false, productId, error: 'network' };
    if (code === RC_ERR.NOT_AVAILABLE) return { ok: false, productId, error: 'unavailable' };
    if (code === RC_ERR.NOT_ALLOWED) return { ok: false, productId, error: 'not_allowed' };
    return { ok: false, productId, error: 'failed', code: code || '' };
  }

  async function purchase(productId) {
    const p = catalog.find((x) => x.id === productId);
    if (!p) return { ok: false, productId, error: 'unknown_product' };
    if (busy) return { ok: false, productId, error: 'busy' };
    if (!configured) return { ok: false, productId, error: 'unavailable' };
    const isNoAds = !!(p.grants && p.grants.noAds);
    if (isNoAds && shop.hasNoAds()) return { ok: false, productId, error: 'already_owned' };
    busy = true;
    onBusy(1);
    try {
      if (!(await ensureBaseline())) return { ok: false, productId, error: 'network' };
      if (!storeProducts.has(productId)) await fetchProducts();
      const sp = storeProducts.get(productId);
      if (!sp) return { ok: false, productId, error: productsState === 'error' ? 'store_unavailable' : 'unavailable' };

      inflight = { productId, coins: 0 };
      const r = await call(Purchases, 'purchaseStoreProduct', { product: sp });
      if (!r.ok) {
        if (r.error && r.error.code === RC_ERR.ALREADY_PURCHASED) {
          // Google already owns it but this RevenueCat user doesn't show it (reinstall whose silent sync
          // failed, another RevenueCat user): the player tapped Buy, so restoring is a user action.
          const rec = await fetchCustomerInfo();
          if (isNoAds) {
            if (rec && rec.entitled) return { ok: false, productId, error: 'already_owned', restored: true };
            const rr = await call(Purchases, 'restorePurchases', undefined, 30000);
            const rec2 = rr.ok ? reconcile(ciOf(rr.value), { fresh: true }) : null;
            if (rec2 && rec2.entitled) return { ok: false, productId, error: 'already_owned', restored: true };
            return { ok: false, productId, error: 'owned_elsewhere' };
          }
          // An unconsumed coin pack of this product: hand it to RevenueCat (it credits + consumes it).
          if (inflight.coins <= 0) {
            const sy = await call(Purchases, 'syncPurchases', undefined, 20000);
            if (sy.ok) await fetchCustomerInfo();
          }
          if (inflight.coins > 0) return { ok: true, productId, coins: inflight.coins };
          return { ok: false, productId, error: 'still_processing' };
        }
        return failure(productId, r.error);
      }
      const res = r.value || {};
      reconcile(ciOf(res), { fresh: true });
      const out = { ok: true, productId };
      if (isNoAds) {
        shop.setNoAds(true); // the store confirmed the payment
        out.noAds = true;
      } else {
        if (inflight.coins <= 0) {
          // RevenueCat's transaction not visible in the result yet: ask once more.
          await fetchCustomerInfo();
        }
        if (inflight.coins <= 0) {
          const tx = res.transaction || {};
          const t = ms(tx.purchaseDateMillis) || ms(tx.purchaseDate) || now();
          inflight.coins += shop.creditOrphan({ productId, t, orderId: typeof tx.transactionIdentifier === 'string' ? tx.transactionIdentifier : '' });
        }
        out.coins = inflight.coins;
      }
      return out;
    } finally {
      inflight = null;
      busy = false;
      onBusy(-1);
      notify();
    }
  }

  // ---------------------------------------------------------------- restore (user action only)
  async function restore() {
    if (busy) return { ok: false, error: 'busy', restored: [] };
    if (!configured) return { ok: false, error: 'unavailable', restored: [] };
    busy = true;
    onBusy(1);
    try {
      const r = await call(Purchases, 'restorePurchases', undefined, 30000);
      if (!r.ok) return { ok: false, error: failure('', r.error).error === 'network' ? 'network' : 'failed', restored: [] };
      const rec = reconcile(ciOf(r.value), { fresh: true });
      const coins = rec.credited.reduce((s, c) => s + c.coins, 0);
      // "restored" = the STORE account owns it (a local-only flag is kept but not reported as restored)
      return { ok: true, noAds: !!rec.entitled, restored: rec.entitled ? ['no_ads'] : [], coins };
    } finally {
      busy = false;
      onBusy(-1);
    }
  }

  /** App came back: a pending payment may have completed; retry a failed product fetch. */
  function onResume() {
    if (!configured || busy) return;
    const t = now();
    if (t - lastResumeSync < (m.resumeSyncMinGapMs || 0)) return;
    lastResumeSync = t;
    fetchCustomerInfo();
    if (productsState === 'error') fetchProducts();
  }

  return {
    kind: 'revenuecat',
    init,
    reconcile,
    products,
    productsState: () => productsState,
    fetchProducts,
    purchase,
    restore,
    onResume,
    isBusy: () => busy,
    onGrant(fn) { grantListeners.add(fn); return () => grantListeners.delete(fn); },
    onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); },
  };
}
