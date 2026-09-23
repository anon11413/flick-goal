// Store screen: BALLS / STADIUMS (coin purchases, equip) and COINS (IAP + rewarded ad) tabs.
// Previews are drawn with the engine's procedural skin functions into small dpr-crisp canvases.

import { h, clear, fmtNum, fmtTime, replayClass, dprCanvas, setText, centerIn } from './dom.js';
import { icon } from './icons.js';
import { createCoinPill } from './hud.js';
import { drawBallPreview, drawStadiumPreview, themePalette } from '../engine/skins.js';

const TABS = [
  { id: 'balls', label: 'BALLS', kind: 'ball', iconName: 'football' },
  { id: 'stadiums', label: 'STADIUMS', kind: 'stadium', iconName: 'stadium' },
  { id: 'coins', label: 'COINS', kind: null, iconName: 'coins' },
];

/**
 * app: { cfg, stage, shop, mon, dialogs, fx, sfx(name), haptic(name), wallet, onBack(),
 *        onEquip(kind, id) }
 */
export function createStore(app) {
  const { cfg, shop, mon, dialogs, fx, stage } = app;
  let tab = 'balls';
  let ballCanvases = [];   // [{ctx, id, size}] redrawn for animated skins
  let lastAnim = 0;
  let rewardedBtn = null;
  let rewardedLabel = null;
  let products = null;

  const pill = createCoinPill();
  app.wallet.register('store', pill);

  const backBtn = h('button.btn.round.sm', { type: 'button', html: icon('back'), attrs: { 'aria-label': 'Back' }, onclick: () => app.onBack() });
  const tabBtns = {};
  const tabsEl = h('div.tabs', { attrs: { role: 'tablist' } },
    TABS.filter((t) => t.id !== 'coins' || mon.enabled).map((t) => {
      const b = h('button.tab', {
        type: 'button',
        attrs: { role: 'tab' },
        onclick: () => { if (tab !== t.id) { app.sfx('click'); setTab(t.id); } },
      }, h('span.tab-ic', { html: icon(t.iconName) }), h('span', t.label));
      tabBtns[t.id] = b;
      return b;
    }));
  const body = h('div.store-body');
  const el = h('section.screen.store', { dataset: { screen: 'store' } },
    h('div.topbar.store-top', backBtn, h('div.store-title', 'STORE'), pill.el),
    tabsEl,
    body);

  function applyBg() {
    let bg = cfg.ui.themeColor;
    try { bg = themePalette(shop.equipped('stadium'), 0).uiBg || bg; } catch { /* engine fallback */ }
    el.style.setProperty('--store-bg', bg);
  }

  function setTab(id) {
    if (id === 'coins' && !mon.enabled) id = 'balls';
    tab = id;
    for (const [k, b] of Object.entries(tabBtns)) {
      b.classList.toggle('active', k === id);
      b.setAttribute('aria-selected', k === id ? 'true' : 'false');
    }
    render();
    body.scrollTop = 0;
  }

  // ---------------- cosmetic grids ----------------
  function priceTag(price) {
    return h('span.price', h('span.price-ic', { html: icon('coin') }), fmtNum(price));
  }

  function drawPreview(kind, id, w, hgt) {
    const { canvas, ctx } = dprCanvas(w, hgt);
    canvas.className = 'card-canvas';
    if (ctx) {
      try {
        if (kind === 'ball') drawBallPreview(ctx, id, w, 0);
        else drawStadiumPreview(ctx, id, w, hgt);
      } catch (err) {
        console.warn('preview failed', id, err);
      }
      if (kind === 'ball') ballCanvases.push({ ctx, id, size: w });
    }
    return canvas;
  }

  function renderGrid(kind) {
    ballCanvases = [];
    const list = shop.items(kind);
    const grid = h('div.grid' + (kind === 'stadium' ? '.grid-wide' : ''));
    for (const it of list) {
      const state = it.equipped ? 'equipped' : it.owned ? 'owned' : 'locked';
      const affordable = shop.coins() >= it.price;
      const foot = state === 'equipped'
        ? h('span.card-state.eq', h('span.mini-ic', { html: icon('check') }), 'IN USE')
        : state === 'owned'
          ? h('span.card-state.use', 'USE')
          : priceTag(it.price);
      const preview = kind === 'ball' ? drawPreview('ball', it.id, 64, 64) : drawPreview('stadium', it.id, 176, 112);
      const card = h('button.card.' + state + (state === 'locked' && !affordable ? '.poor' : ''), {
        type: 'button',
        attrs: { 'aria-label': `${it.name}${state === 'locked' ? `, ${it.price} coins` : state === 'equipped' ? ', in use' : ', owned'}` },
      },
      h('div.card-preview', preview, state === 'locked' ? h('span.card-lock', { html: icon('lock') }) : null),
      h('div.card-name', it.name),
      foot,
      state === 'equipped' ? h('span.card-badge', { html: icon('check') }) : null);
      card.addEventListener('click', () => onCard(kind, it, card));
      grid.appendChild(card);
    }
    return grid;
  }

  async function onCard(kind, it, card) {
    const cur = shop.items(kind).find((x) => x.id === it.id) || it;
    if (cur.equipped) {
      app.sfx('click');
      replayClass(card, 'bump', 320);
      return;
    }
    if (cur.owned) {
      app.sfx('click');
      app.haptic('tap');
      shop.equip(kind, cur.id);
      app.onEquip(kind, cur.id);
      render();
      return;
    }
    if (shop.coins() < cur.price) {
      app.sfx('fail');
      app.haptic('fail');
      replayClass(card, 'shake', 320);
      const need = cur.price - shop.coins();
      dialogs.toast(`Need ${fmtNum(need)} more coins`, {
        kind: 'warn',
        action: mon.enabled ? { label: 'Get coins', onClick: () => setTab('coins') } : null,
      });
      return;
    }
    app.sfx('click');
    const ok = await dialogs.confirmDialog({
      title: `Buy ${cur.name}?`,
      message: `${fmtNum(cur.price)} coins`,
      okText: 'BUY',
      cancelText: 'Not now',
      iconHtml: previewHtml(kind, cur.id),
    });
    if (!ok) return;
    const r = shop.buy(kind, cur.id);
    if (r.ok) {
      app.sfx('buy');
      app.haptic('buy');
      shop.equip(kind, cur.id);
      app.onEquip(kind, cur.id);
      render();
      const fresh = body.querySelector(`.card:nth-child(${shop.items(kind).findIndex((x) => x.id === cur.id) + 1})`);
      if (fresh) {
        replayClass(fresh, 'bump', 320);
        fx.confettiAt(fresh, 30, 0.9);
      }
      dialogs.toast(`${cur.name} unlocked!`, { kind: 'ok', ms: 1400 });
    } else if (r.reason === 'insufficient') {
      replayClass(card, 'shake', 320);
      dialogs.toast(`Need ${fmtNum(r.need)} more coins`, { kind: 'warn' });
    }
  }

  /** Static preview image for the confirm dialog (canvas -> data URL is fine; it's same-origin). */
  function previewHtml(kind, id) {
    try {
      const w = kind === 'ball' ? 72 : 120, hgt = kind === 'ball' ? 72 : 76;
      const { canvas, ctx } = dprCanvas(w, hgt);
      if (kind === 'ball') drawBallPreview(ctx, id, w, 0); else drawStadiumPreview(ctx, id, w, hgt);
      return `<img alt="" src="${canvas.toDataURL('image/png')}" style="width:${w}px;height:${hgt}px">`;
    } catch {
      return icon(kind === 'ball' ? 'football' : 'stadium');
    }
  }

  // ---------------- coins tab ----------------
  function renderCoins() {
    const wrap = h('div.coins-tab');
    const list = products || cfg.products.map((p) => ({ ...p }));
    const noAdsP = list.find((p) => p.id === 'no_ads');
    if (noAdsP) {
      const owned = shop.hasNoAds();
      wrap.appendChild(h('div.iap-card.noads' + (owned ? '.owned' : ''),
        h('div.iap-ic.red', { html: icon('noAds') }),
        h('div.iap-info', h('div.iap-title', noAdsP.title), h('div.iap-desc', owned ? 'Thanks for your support!' : noAdsP.description)),
        owned
          ? h('span.iap-owned', h('span.mini-ic', { html: icon('check') }), 'OWNED')
          : h('button.btn.pill.green.sm', { type: 'button', onclick: (e) => buyProduct(noAdsP, e.currentTarget) }, noAdsP.priceString)));
    }
    const packs = list.filter((p) => p.id !== 'no_ads');
    const packGrid = h('div.pack-grid');
    packs.forEach((p, i) => {
      const coinsN = (cfg.products.find((x) => x.id === p.id) || {}).grants?.coins || 0;
      const stack = h('div.pack-art.s' + Math.min(3, i + 1), Array.from({ length: Math.min(3, i + 1) }, () => h('span', { html: icon('coin') })));
      packGrid.appendChild(h('button.pack', { type: 'button', onclick: (e) => buyProduct(p, e.currentTarget) },
        p.tag ? h('span.pack-tag', p.tag) : null,
        stack,
        h('div.pack-amount', fmtNum(coinsN)),
        h('div.pack-title', p.title),
        h('span.pack-price', p.priceString)));
    });
    wrap.appendChild(packGrid);

    // rewarded coins
    rewardedLabel = h('span', 'WATCH');
    rewardedBtn = h('button.btn.pill.gold.sm', { type: 'button', onclick: watchForCoins }, h('span.btn-ic', { html: icon('ad') }), rewardedLabel);
    wrap.appendChild(h('div.iap-card.watch',
      h('div.iap-ic.gold', { html: icon('coin') }),
      h('div.iap-info', h('div.iap-title', `+${cfg.economy.rewardedCoins} FREE COINS`), h('div.iap-desc', 'Watch a short video')),
      rewardedBtn));
    updateRewarded(true);

    wrap.appendChild(h('button.link-btn', { type: 'button', onclick: restore }, h('span.mini-ic', { html: icon('restore') }), 'Restore Purchases'));
    wrap.appendChild(h('div.fine', 'Test mode — purchases are simulated. No real money is charged.'));
    return wrap;
  }

  async function buyProduct(p, btnEl) {
    app.sfx('click');
    const res = await mon.iap.purchase(p.id);
    if (!res.ok) {
      if (!res.cancelled && res.error && res.error !== 'busy') dialogs.toast(res.error === 'already_owned' ? 'Already owned' : 'Purchase failed', { kind: 'warn' });
      return;
    }
    app.sfx('buy');
    app.haptic('buy');
    const def = cfg.products.find((x) => x.id === p.id) || {};
    if (def.grants && def.grants.coins) {
      const from = btnEl && btnEl.isConnected ? centerIn(btnEl, stage) : { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
      app.wallet.flyFrom(from, 8, def.grants.coins);
      dialogs.toast(`+${fmtNum(def.grants.coins)} coins!`, { kind: 'ok', ms: 1400 });
    }
    if (def.grants && def.grants.noAds) {
      dialogs.toast('Ads removed — thank you!', { kind: 'ok' });
      fx.confetti(stage.clientWidth / 2, stage.clientHeight * 0.35, 40, 1.1);
    }
    render();
  }

  async function watchForCoins() {
    const st = shop.rewardedCoinsStatus();
    if (!st.ready) return;
    app.sfx('click');
    const r = await mon.ads.showRewarded('store_coins');
    if (!r.rewarded) return;
    const g = shop.grantRewardedCoins();
    if (g.ok) {
      app.sfx('gift');
      const from = rewardedBtn && rewardedBtn.isConnected ? centerIn(rewardedBtn, stage) : null;
      app.wallet.flyFrom(from, 6, g.amount);
    }
    updateRewarded(true);
  }

  async function restore() {
    app.sfx('click');
    const r = await mon.iap.restore();
    if (r.ok && r.restored.length) dialogs.toast('Purchases restored: No Ads', { kind: 'ok' });
    else dialogs.toast(r.ok ? 'Nothing to restore' : 'Restore failed', { kind: r.ok ? 'info' : 'warn' });
    render();
  }

  let lastRewardedText = '';
  function updateRewarded(force) {
    if (!rewardedBtn || !rewardedBtn.isConnected) return;
    const st = shop.rewardedCoinsStatus();
    const text = st.ready ? 'WATCH' : fmtTime(st.msLeft);
    if (force || text !== lastRewardedText) {
      lastRewardedText = text;
      setText(rewardedLabel, text);
      rewardedBtn.disabled = !st.ready;
    }
  }

  // ---------------- lifecycle ----------------
  function render() {
    applyBg();
    pill.set(app.wallet.displayed());
    clear(body);
    rewardedBtn = null;
    if (tab === 'balls') body.appendChild(renderGrid('ball'));
    else if (tab === 'stadiums') body.appendChild(renderGrid('stadium'));
    else body.appendChild(renderCoins());
  }

  function enter(opts = {}) {
    if (!products && mon.enabled) {
      mon.iap.getProducts().then((list) => {
        if (Array.isArray(list) && list.length) {
          products = list;
          if (tab === 'coins') render();
        }
      }).catch(() => {});
    }
    setTab(opts.tab || tab);
  }

  function leave() {
    ballCanvases = [];
  }

  /** Called every frame while the store is visible: animate ball previews (~24 fps) and countdowns. */
  function tick(nowMs) {
    if (tab === 'balls' && ballCanvases.length && nowMs - lastAnim > 42) {
      lastAnim = nowMs;
      const t = nowMs / 1000;
      for (const c of ballCanvases) {
        try {
          c.ctx.clearRect(0, 0, c.size, c.size);
          drawBallPreview(c.ctx, c.id, c.size, t);
        } catch { /* ignore */ }
      }
    }
    if (tab === 'coins') updateRewarded(false);
  }

  shop.on((e) => {
    if (e.type === 'noAds' || e.type === 'reset') {
      if (el.classList.contains('active')) render();
    }
    if (e.type === 'reset') applyBg();
  });

  applyBg();
  return { el, enter, leave, tick, setTab, refresh: render };
}
