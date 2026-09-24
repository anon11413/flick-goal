// Coin wallet, cosmetic catalog (balls / stadiums), permanent upgrades (Aim Slider), timed free
// gift and rewarded-coin cooldown. Pure: depends only on a save manager and injectable clock / rng.

import { CONFIG } from '../config.js';
import { MAX_TX_IDS } from './save.js';

const KINDS = {
  ball: { catalog: 'balls', owned: 'balls', equipped: 'ball' },
  stadium: { catalog: 'stadiums', owned: 'stadiums', equipped: 'stadium' },
  // permanent upgrades: bought once, never equipped; each can be switched on / off (settings)
  upgrade: { catalog: 'upgrades', owned: 'upgrades', equipped: null },
};

/** Settings flag that switches an owned upgrade on / off. */
const UPGRADE_SETTING = { aim_slider: 'aimSlider' };

export function createShop({ save, cfg = CONFIG, now = () => Date.now(), rng = Math.random } = {}) {
  if (!save) throw new Error('createShop: save manager required');
  const listeners = new Set();

  function emit(evt) {
    const payload = { ...evt, coins: save.data.coins };
    for (const fn of Array.from(listeners)) {
      try { fn(payload); } catch (err) { console.error('shop listener failed', err); }
    }
  }

  const kindInfo = (kind) => KINDS[kind] || null;
  const catalogItem = (kind, id) => {
    const k = kindInfo(kind);
    const list = k ? cfg.catalog[k.catalog] : null;
    return Array.isArray(list) ? list.find((it) => it.id === id) || null : null;
  };

  function coins() { return save.data.coins; }

  /** Credit coins. Accepts positive finite numbers (floored). Returns true when credited. */
  function addCoins(amount, source = 'other') {
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n <= 0) return false;
    save.update((d) => { d.coins += n; });
    emit({ type: 'coins', delta: n, source });
    return true;
  }

  function spendCoins(amount) {
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n < 0) return false;
    if (save.data.coins < n) return false;
    if (n === 0) return true;
    save.update((d) => { d.coins -= n; });
    emit({ type: 'coins', delta: -n, source: 'spend' });
    return true;
  }

  function isOwned(kind, id) {
    const k = kindInfo(kind);
    const list = k && save.data.owned ? save.data.owned[k.owned] : null;
    return Array.isArray(list) && list.includes(id);
  }

  function equipped(kind) {
    const k = kindInfo(kind);
    return k && k.equipped ? save.data.equipped[k.equipped] : null;
  }

  /** Owned AND switched on (upgrades only). */
  function upgradeActive(id) {
    if (!isOwned('upgrade', id)) return false;
    const flag = UPGRADE_SETTING[id];
    return flag ? save.data.settings[flag] !== false : true;
  }

  /** Switch an owned upgrade on / off. Returns false when it is not owned. */
  function setUpgradeActive(id, active) {
    if (!isOwned('upgrade', id)) return false;
    const flag = UPGRADE_SETTING[id];
    if (!flag) return false;
    const v = !!active;
    if (save.data.settings[flag] !== v) {
      save.update((d) => { d.settings[flag] = v; });
      emit({ type: 'upgrade', id, active: v });
    }
    return true;
  }

  function items(kind) {
    const k = kindInfo(kind);
    const list = k ? cfg.catalog[k.catalog] : null;
    if (!Array.isArray(list)) return [];
    if (kind === 'upgrade') {
      return list.map((it) => ({
        id: it.id, name: it.name, price: it.price, owned: isOwned(kind, it.id), active: upgradeActive(it.id),
      }));
    }
    const eq = equipped(kind);
    return list.map((it) => {
      const row = {
        id: it.id,
        name: it.name,
        price: it.price,
        owned: isOwned(kind, it.id),
        equipped: it.id === eq,
      };
      if (kind === 'stadium') {
        row.style = it.style === 'pro' ? 'pro' : 'retro';
        row.theme = it.theme || it.id;
      }
      return row;
    });
  }

  function buy(kind, id) {
    const item = catalogItem(kind, id);
    if (!item) return { ok: false, reason: 'unknown' };
    if (isOwned(kind, id)) return { ok: false, reason: 'owned' };
    const have = save.data.coins;
    if (have < item.price) return { ok: false, reason: 'insufficient', need: item.price - have };
    const k = kindInfo(kind);
    const flag = kind === 'upgrade' ? UPGRADE_SETTING[id] : null;
    save.update((d) => {
      d.coins -= item.price;
      if (!Array.isArray(d.owned[k.owned])) d.owned[k.owned] = [];
      d.owned[k.owned].push(id);
      if (flag) d.settings[flag] = true; // a fresh upgrade starts switched ON
    });
    emit({ type: 'coins', delta: -item.price, source: 'buy' });
    emit({ type: 'owned', kind, id });
    if (kind === 'upgrade') emit({ type: 'upgrade', id, active: upgradeActive(id) });
    return { ok: true };
  }

  function equip(kind, id) {
    const item = catalogItem(kind, id);
    if (!item) return { ok: false, reason: 'unknown' };
    if (!kindInfo(kind).equipped) return { ok: false, reason: 'unknown' };
    if (!isOwned(kind, id)) return { ok: false, reason: 'locked' };
    const k = kindInfo(kind);
    if (save.data.equipped[k.equipped] !== id) {
      save.update((d) => { d.equipped[k.equipped] = id; });
      emit({ type: 'equip', kind, id });
    }
    return { ok: true };
  }

  // ---- timers ----
  // A timestamp in the future (device clock corrected backwards, corrupt save) is pulled back
  // to "now" and written back, so the wait is at most one cooldown and then counts down normally.
  function cooldown(field, ms) {
    let last = save.data[field];
    if (!last) return { ready: true, msLeft: 0 };
    const t = now();
    if (last > t) {
      save.update((d) => { d[field] = t; });
      last = t;
    }
    const left = Math.max(0, Math.min(ms, last + ms - t));
    return { ready: left <= 0, msLeft: left };
  }

  function giftStatus() {
    return cooldown('lastGiftAt', cfg.economy.gift.cooldownMs);
  }

  function claimGift() {
    const st = giftStatus();
    if (!st.ready) return { ok: false, msLeft: st.msLeft };
    const g = cfg.economy.gift;
    const step = Math.max(1, g.step || 1);
    const steps = Math.max(0, Math.floor((g.max - g.min) / step));
    const r = Math.min(0.999999, Math.max(0, Number(rng()) || 0));
    const amount = g.min + step * Math.floor(r * (steps + 1));
    save.update((d) => { d.lastGiftAt = now(); });
    addCoins(amount, 'gift');
    return { ok: true, amount };
  }

  function rewardedCoinsStatus() {
    return cooldown('lastRewardedCoinsAt', cfg.economy.rewardedCoinsCooldownMs);
  }

  function grantRewardedCoins() {
    const st = rewardedCoinsStatus();
    if (!st.ready) return { ok: false, msLeft: st.msLeft };
    const amount = cfg.economy.rewardedCoins;
    save.update((d) => { d.lastRewardedCoinsAt = now(); });
    addCoins(amount, 'rewarded');
    return { ok: true, amount };
  }

  function hasNoAds() { return save.data.noAds === true; }

  function setNoAds(v) {
    const val = v === true;
    if (save.data.noAds !== val) {
      save.update((d) => { d.noAds = val; });
      emit({ type: 'noAds', value: val });
    }
  }

  /** Apply the grants of an IAP product (called by the monetization adapter after a successful purchase). */
  function applyProduct(productId) {
    const p = (cfg.products || []).find((it) => it.id === productId);
    if (!p || !p.grants) return { ok: false };
    const out = { ok: true };
    if (p.grants.coins) {
      addCoins(p.grants.coins, 'iap');
      out.coins = p.grants.coins;
    }
    if (p.grants.noAds) {
      setNoAds(true);
      out.noAds = true;
    }
    return out;
  }

  // ---- In-app purchase ledger (exactly-once coin grants; see src/platform/revenuecat.js) ----
  const product = (id) => (cfg.products || []).find((it) => it.id === id) || null;
  /** Coins a product grants (0 for No Ads / unknown ids). */
  function productCoins(productId) {
    const p = product(productId);
    const n = p && p.grants ? Math.floor(Number(p.grants.coins)) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const ledger = (d) => {
    if (!d.iap || typeof d.iap !== 'object') d.iap = { since: 0, done: [], doneT: [], through: 0, orphans: [], synced: false };
    const l = d.iap;
    if (!Array.isArray(l.done)) l.done = [];
    if (!Array.isArray(l.doneT)) l.doneT = [];
    if (l.doneT.length > l.done.length) l.doneT.length = l.done.length;
    while (l.doneT.length < l.done.length) l.doneT.push(0);
    if (!(Number(l.through) >= 0)) l.through = 0;
    if (!Array.isArray(l.orphans)) l.orphans = [];
    return l;
  };
  const MAX_DONE = MAX_TX_IDS;
  /**
   * Record a processed transaction id with its purchase time. When the list is full, the entry with the
   * OLDEST purchase time is dropped and `through` is raised to that time: every transaction purchased
   * at or before `through` counts as processed forever (reconcile skips it), so pruning an id can never
   * make it creditable again.
   */
  const pushDone = (l, id, t) => {
    const tt = Math.floor(Number(t));
    l.done.push(id);
    l.doneT.push(Number.isFinite(tt) && tt > 0 ? tt : now()); // unknown purchase time: the time we saw it
    while (l.done.length > MAX_DONE) {
      let k = 0;
      for (let i = 1; i < l.doneT.length; i++) if (l.doneT[i] < l.doneT[k]) k = i;
      l.through = Math.max(Number(l.through) || 0, l.doneT[k] || 0);
      l.done.splice(k, 1);
      l.doneT.splice(k, 1);
    }
  };
  function iapState() { return ledger(save.data); }
  /** Processed = in the ledger, or purchased at / before the pruning floor (pass the purchase time t). */
  function hasProcessed(txId, t) {
    if (typeof txId !== 'string') return false;
    const l = iapState();
    if (l.done.includes(txId)) return true;
    const tt = Number(t);
    return Number.isFinite(tt) && tt > 0 && l.through > 0 && tt <= l.through;
  }

  /**
   * Credit a coin pack for ONE store transaction, exactly once: the "already processed?" check, the
   * ledger entry and the coins happen in a single save.update, so racing callers (purchase result +
   * customer-info listener + launch sync) can never double-credit. Returns the coins credited (0 when
   * the transaction was already processed or the product grants no coins). t = purchase time (ms).
   */
  function creditPurchase({ txId, productId, t }) {
    const amount = productCoins(productId);
    if (typeof txId !== 'string' || !txId || amount <= 0) return 0;
    let credited = 0;
    save.update((d) => {
      const l = ledger(d);
      if (l.done.includes(txId)) return;
      const tt = Number(t);
      if (Number.isFinite(tt) && tt > 0 && l.through > 0 && tt <= l.through) return;
      pushDone(l, txId, t);
      d.coins += amount;
      credited = amount;
    });
    if (credited) emit({ type: 'coins', delta: credited, source: 'iap', productId, txId });
    return credited;
  }

  /**
   * Record transaction ids as processed WITHOUT crediting (ledger baseline, orphan matches).
   * Accepts ids or { id, t } entries (t = purchase time, ms).
   */
  function markProcessed(txIds) {
    const list = (Array.isArray(txIds) ? txIds : [txIds])
      .map((x) => (typeof x === 'string' ? { id: x, t: 0 } : x && typeof x === 'object' ? { id: x.id, t: x.t } : null))
      .filter((x) => x && typeof x.id === 'string' && x.id);
    if (!list.length) return 0;
    let n = 0;
    save.update((d) => {
      const l = ledger(d);
      for (const x of list) if (!l.done.includes(x.id)) { pushDone(l, x.id, x.t); n++; }
    });
    return n;
  }

  /** Set the ledger epoch once (store server time of the first purchase-history read). */
  function setIapEpoch(since) {
    const t = Math.floor(Number(since));
    if (!Number.isFinite(t) || t <= 0 || iapState().since > 0) return false;
    save.update((d) => { ledger(d).since = t; });
    return true;
  }

  function setIapSynced() {
    if (iapState().synced === true) return;
    save.update((d) => { ledger(d).synced = true; });
  }

  /**
   * Fallback credit straight from a purchase result whose store transaction is not visible yet:
   * credits once per order id and remembers an orphan {p, t, o} so the matching store transaction,
   * when it shows up, is recorded without a second credit (see resolveOrphan).
   */
  function creditOrphan({ productId, t, orderId }) {
    const amount = productCoins(productId);
    if (amount <= 0) return 0;
    const o = typeof orderId === 'string' ? orderId : '';
    let credited = 0;
    save.update((d) => {
      const l = ledger(d);
      if (o && l.orphans.some((x) => x.o === o)) return;
      l.orphans.push({ p: productId, t: Math.max(0, Math.floor(Number(t)) || 0), o });
      if (l.orphans.length > 50) l.orphans.splice(0, l.orphans.length - 50);
      d.coins += amount;
      credited = amount;
    });
    if (credited) emit({ type: 'coins', delta: credited, source: 'iap', productId, txId: null });
    return credited;
  }

  /**
   * A store transaction that matches an orphan credit (same product, purchase time within windowMs):
   * mark it processed and drop the orphan, WITHOUT crediting. Returns true when one matched.
   */
  function resolveOrphan({ txId, productId, t, windowMs = 10 * 60 * 1000 }) {
    if (typeof txId !== 'string' || !txId) return false;
    const l0 = iapState();
    if (l0.done.includes(txId) || !l0.orphans.length) return false;
    let hit = false;
    save.update((d) => {
      const l = ledger(d);
      const tt = Number(t) || 0;
      let i = -1;
      let best = Infinity;
      l.orphans.forEach((x, k) => {
        const dt = Math.abs((x.t || 0) - tt);
        if (x.p === productId && dt <= windowMs && dt < best) { best = dt; i = k; }
      });
      if (i < 0) return;
      l.orphans.splice(i, 1);
      pushDone(l, txId, t);
      hit = true;
    });
    return hit;
  }

  /** Tell listeners the whole save changed (e.g. after save.reset()). */
  function refresh() {
    emit({ type: 'reset' });
  }

  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    coins, addCoins, spendCoins, items, isOwned, equipped, buy, equip, upgradeActive, setUpgradeActive,
    giftStatus, claimGift, rewardedCoinsStatus, grantRewardedCoins,
    applyProduct, hasNoAds, setNoAds, refresh, on,
    productCoins, iapState, hasProcessed, creditPurchase, markProcessed, setIapEpoch, setIapSynced,
    creditOrphan, resolveOrphan,
  };
}
