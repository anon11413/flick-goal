// Store screen: BALLS / STADIUMS (RETRO + PRO GRAPHICS sections) / UPGRADES (Aim Slider) / COINS.
// Previews are drawn by the engine's real style code (engine/preview.js) into dpr-crisp canvases:
// ball cards in the equipped stadium's art style, stadium cards in their own style. Finished
// stadium previews are cached per (id, size, dpr); uncached PRO previews are drawn one per
// animation frame after the grid appears (a palette sky placeholder shows until then).

import { h, clear, fmtNum, fmtTime, replayClass, dprCanvas, setText, centerIn } from './dom.js';
import { icon } from './icons.js';
import { createCoinPill } from './hud.js';
import {
  drawBallPreview, drawStadiumPreview, drawAimSliderPreview, themePalette, styleOf, stadiumDisplayName,
} from '../engine/skins.js';

const TABS = [
  { id: 'balls', label: 'BALLS', kind: 'ball', iconName: 'football' },
  { id: 'stadiums', label: 'STADIUMS', kind: 'stadium', iconName: 'stadium' },
  { id: 'upgrades', label: 'UPGRADES', kind: 'upgrade', iconName: 'slider' },
  { id: 'coins', label: 'COINS', kind: null, iconName: 'coins' },
];
const AIM_SLIDER = 'aim_slider';
const STADIUM_W = 176;
const STADIUM_H = 112;

/** Finished stadium preview canvases: `${id}|${w}x${h}@${dpr}` -> canvas (module-level cache). */
const previewCache = new Map();

/**
 * app: { cfg, stage, shop, mon, dialogs, fx, sfx(name), haptic(name), wallet, onBack(),
 *        onEquip(kind, id), onUpgradeChange(id) }
 */
export function createStore(app) {
  const { cfg, shop, mon, dialogs, fx, stage } = app;
  let tab = 'balls';
  let ballCanvases = [];   // [{ctx, id, size, style}] redrawn for animated skins
  let lastAnim = 0;
  let rewardedBtn = null;
  let rewardedLabel = null;
  let products = null;
  let pendingPreviews = []; // [{ id, ctx, w, h }] PRO stadium previews to draw, one per frame
  let sliderCanvas = null;  // { ctx, w, h } animated Aim Slider card
  let lastSliderAnim = 0;

  const pill = createCoinPill();
  app.wallet.register('store', pill);

  const backBtn = h('button.btn.round.sm', { type: 'button', html: icon('back'), attrs: { 'aria-label': 'Back' }, onclick: () => app.onBack() });
  const tabBtns = {};
  const tabsEl = h('div.tabs', { attrs: { role: 'tablist' } },
    TABS.filter((t) => t.id !== 'coins' || mon.enabled).map((t) => {
      const b = h('button.tab', {
        type: 'button',
        attrs: { role: 'tab', 'aria-label': t.label },
        dataset: { tab: t.id },
        onclick: () => { if (tab !== t.id) { app.sfx('click'); setTab(t.id); } },
      }, h('span.tab-ic', { html: icon(t.iconName) }), h('span.tab-label', t.label));
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
    if (!tabBtns[id]) id = 'balls';
    tab = id;
    for (const [k, b] of Object.entries(tabBtns)) {
      b.classList.toggle('active', k === id);
      b.setAttribute('aria-selected', k === id ? 'true' : 'false');
    }
    render();
    body.scrollTop = 0;
  }

  const ballStyle = () => styleOf(shop.equipped('stadium'));
  const displayName = (kind, it) => (kind === 'stadium' ? stadiumDisplayName(it.id) : it.name);

  // ---------------- cosmetic grids ----------------
  function priceTag(price) {
    return h('span.price', h('span.price-ic', { html: icon('coin') }), fmtNum(price));
  }

  function skyPlaceholder(ctx, id, w, hgt) {
    const pal = themePalette(id, 0);
    const g = ctx.createLinearGradient(0, 0, 0, hgt);
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(1, pal.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hgt);
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, hgt * 0.62, w, hgt * 0.38);
  }

  /** Draw (or blit from cache) a stadium preview into ctx; returns false when deferred. */
  function paintStadium(ctx, id, w, hgt, defer) {
    const dpr = Math.min((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1, 3);
    const key = `${id}|${w}x${hgt}@${dpr}`;
    const hit = previewCache.get(key);
    if (hit) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(hit, 0, 0);
      ctx.restore();
      return true;
    }
    if (defer) {
      skyPlaceholder(ctx, id, w, hgt);
      pendingPreviews.push({ id, ctx, w, hgt });
      return false;
    }
    const { canvas: off, ctx: octx } = dprCanvas(w, hgt);
    if (!octx) return false;
    try {
      drawStadiumPreview(octx, id, w, hgt);
    } catch (err) {
      console.warn('preview failed', id, err);
      skyPlaceholder(octx, id, w, hgt);
    }
    previewCache.set(key, off);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    return true;
  }

  function drawPreview(kind, id, w, hgt, style) {
    const { canvas, ctx } = dprCanvas(w, hgt);
    canvas.className = 'card-canvas';
    if (ctx) {
      try {
        if (kind === 'ball') {
          drawBallPreview(ctx, id, w, 0, style);
          ballCanvases.push({ ctx, id, size: w, style });
        } else {
          paintStadium(ctx, id, w, hgt, style === 'pro');
        }
      } catch (err) {
        console.warn('preview failed', id, err);
      }
    }
    return canvas;
  }

  function card(kind, it) {
    const state = it.equipped ? 'equipped' : it.owned ? 'owned' : 'locked';
    const affordable = shop.coins() >= it.price;
    const foot = state === 'equipped'
      ? h('span.card-state.eq', h('span.mini-ic', { html: icon('check') }), 'IN USE')
      : state === 'owned'
        ? h('span.card-state.use', 'USE')
        : priceTag(it.price);
    const preview = kind === 'ball'
      ? drawPreview('ball', it.id, 64, 64, ballStyle())
      : drawPreview('stadium', it.id, STADIUM_W, STADIUM_H, it.style);
    const pro = kind === 'stadium' && it.style === 'pro';
    const c = h('button.card.' + state + (state === 'locked' && !affordable ? '.poor' : '') + (pro ? '.pro' : ''), {
      type: 'button',
      dataset: { id: it.id },
      attrs: { 'aria-label': `${displayName(kind, it)}${state === 'locked' ? `, ${it.price} coins` : state === 'equipped' ? ', in use' : ', owned'}` },
    },
    h('div.card-preview', preview,
      pro ? h('span.hd-ribbon', 'HD') : null,
      state === 'locked' ? h('span.card-lock', { html: icon('lock') }) : null),
    h('div.card-name', it.name),
    foot,
    state === 'equipped' ? h('span.card-badge', { html: icon('check') }) : null);
    c.addEventListener('click', () => onCard(kind, it, c));
    return c;
  }

  function renderGrid(kind) {
    ballCanvases = [];
    const list = shop.items(kind);
    const grid = h('div.grid' + (kind === 'stadium' ? '.grid-wide' : ''));
    for (const it of list) grid.appendChild(card(kind, it));
    return grid;
  }

  function sectionHead(title, sub, badge) {
    return h('div.store-section',
      h('div.store-section-title', h('span', title), badge ? h('span.hd-badge', badge) : null),
      h('div.store-section-sub', sub));
  }

  function renderStadiums() {
    ballCanvases = [];
    pendingPreviews = [];
    const list = shop.items('stadium');
    const wrap = h('div.stadiums-tab');
    const retro = list.filter((it) => it.style !== 'pro');
    const pro = list.filter((it) => it.style === 'pro');
    wrap.appendChild(sectionHead('RETRO', 'Classic flat look'));
    const g1 = h('div.grid.grid-wide.retro-grid');
    for (const it of retro) g1.appendChild(card('stadium', it));
    wrap.appendChild(g1);
    wrap.appendChild(sectionHead('PRO GRAPHICS', 'Realistic lighting, turf & crowds', 'HD'));
    const g2 = h('div.grid.grid-wide.pro-grid');
    for (const it of pro) g2.appendChild(card('stadium', it));
    wrap.appendChild(g2);
    return wrap;
  }

  async function onCard(kind, it, cardEl) {
    const cur = shop.items(kind).find((x) => x.id === it.id) || it;
    const name = displayName(kind, cur);
    if (cur.equipped) {
      app.sfx('click');
      replayClass(cardEl, 'bump', 320);
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
      needCoins(cardEl, cur.price - shop.coins());
      return;
    }
    app.sfx('click');
    const ok = await dialogs.confirmDialog({
      title: `Buy ${name}?`,
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
      const fresh = body.querySelector(`.card[data-id="${cur.id}"]`);
      if (fresh) {
        replayClass(fresh, 'bump', 320);
        fx.confettiAt(fresh, 30, 0.9);
        if (typeof fresh.scrollIntoView === 'function') {
          try { fresh.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* old WebViews */ }
        }
      }
      dialogs.toast(`${name} unlocked!`, { kind: 'ok', ms: 1400 });
    } else if (r.reason === 'insufficient') {
      replayClass(cardEl, 'shake', 320);
      dialogs.toast(`Need ${fmtNum(r.need)} more coins`, { kind: 'warn' });
    }
  }

  function needCoins(cardEl, need) {
    app.sfx('fail');
    app.haptic('fail');
    replayClass(cardEl, 'shake', 320);
    dialogs.toast(`Need ${fmtNum(need)} more coins`, {
      kind: 'warn',
      action: mon.enabled ? { label: 'Get coins', onClick: () => setTab('coins') } : null,
    });
  }

  /** Static preview image for the confirm dialog (canvas -> data URL is fine; it's same-origin). */
  function previewHtml(kind, id) {
    try {
      const w = kind === 'ball' ? 72 : 120, hgt = kind === 'ball' ? 72 : 76;
      const { canvas, ctx } = dprCanvas(w, hgt);
      if (kind === 'ball') drawBallPreview(ctx, id, w, 0, ballStyle());
      else if (kind === 'upgrade') drawAimSliderPreview(ctx, w, hgt, 0.6);
      else drawStadiumPreview(ctx, id, w, hgt);
      return `<img alt="" src="${canvas.toDataURL('image/png')}" style="width:${w}px;height:${hgt}px;border-radius:12px">`;
    } catch {
      return icon(kind === 'ball' ? 'football' : kind === 'upgrade' ? 'slider' : 'stadium');
    }
  }

  // ---------------- upgrades tab (Aim Slider hero card) ----------------
  function renderUpgrades() {
    const it = shop.items('upgrade').find((u) => u.id === AIM_SLIDER);
    const wrap = h('div.upgrades-tab');
    if (!it) return wrap;
    const W = 320;
    const H = 150;
    const { canvas, ctx } = dprCanvas(W, H);
    canvas.className = 'hero-canvas';
    if (ctx) {
      try { drawAimSliderPreview(ctx, W, H, 0); } catch (err) { console.warn('slider preview failed', err); }
      sliderCanvas = { ctx, w: W, h: H };
    }
    const coins = shop.coins();
    let action;
    if (!it.owned) {
      const frac = Math.max(0, Math.min(1, coins / it.price));
      action = h('div.hero-buy',
        h('span.price.big', h('span.price-ic', { html: icon('coin') }), fmtNum(it.price)),
        h('div.hero-progress', { attrs: { 'aria-label': `${fmtNum(Math.min(coins, it.price))} of ${fmtNum(it.price)} coins` } },
          h('i', { style: { width: `${(frac * 100).toFixed(1)}%` } })),
        h('div.hero-progress-label', `${fmtNum(Math.min(coins, it.price))} / ${fmtNum(it.price)}`));
    } else if (it.active) {
      action = h('div.hero-owned', h('span.card-state.eq.hero-state', h('span.mini-ic', { html: icon('check') }), 'IN USE'),
        h('span.hero-hint', 'Tap to switch it off'));
    } else {
      action = h('div.hero-owned', h('span.card-state.use.hero-state', 'USE'), h('span.hero-hint', 'Off: aiming with the dots · tap to switch on'));
    }
    const hero = h('button.card.hero-card.' + (it.owned ? (it.active ? 'equipped' : 'owned') : 'locked') + (!it.owned && coins < it.price ? '.poor' : ''), {
      type: 'button',
      dataset: { id: it.id },
      attrs: { 'aria-label': it.owned ? `Aim Slider, ${it.active ? 'in use, tap to switch off' : 'owned, tap to use'}` : `Aim Slider, ${it.price} coins` },
    },
    h('div.hero-preview', canvas, !it.owned ? h('span.card-lock', { html: icon('lock') }) : null),
    h('div.hero-title', 'AIM SLIDER'),
    h('div.hero-text', 'See the power slider with the green zone on every kick. Switch it on or off any time.'),
    action,
    it.owned && it.active ? h('span.card-badge', { html: icon('check') }) : null);
    hero.addEventListener('click', () => onUpgrade(it, hero));
    wrap.appendChild(hero);
    wrap.appendChild(h('div.fine.hero-fine', 'Your first two kicks always show the slider.'));
    return wrap;
  }

  async function onUpgrade(it, heroEl) {
    const cur = shop.items('upgrade').find((x) => x.id === it.id) || it;
    if (cur.owned) {
      app.sfx('click');
      app.haptic('tap');
      shop.setUpgradeActive(cur.id, !cur.active);
      if (app.onUpgradeChange) app.onUpgradeChange(cur.id);
      dialogs.toast(cur.active ? 'Aim Slider off: aim with the dots' : 'Aim Slider on: slider every kick', { kind: 'info', ms: 1600 });
      render();
      return;
    }
    if (shop.coins() < cur.price) {
      needCoins(heroEl, cur.price - shop.coins());
      return;
    }
    app.sfx('click');
    const ok = await dialogs.confirmDialog({
      title: 'Buy Aim Slider?',
      message: `${fmtNum(cur.price)} coins`,
      okText: 'BUY',
      cancelText: 'Not now',
      iconHtml: previewHtml('upgrade', cur.id),
    });
    if (!ok) return;
    const r = shop.buy('upgrade', cur.id);
    if (r.ok) {
      app.sfx('buy');
      app.haptic('buy');
      if (app.onUpgradeChange) app.onUpgradeChange(cur.id);
      render();
      const fresh = body.querySelector('.hero-card');
      if (fresh) {
        replayClass(fresh, 'bump', 320);
        fx.confettiAt(fresh, 40, 1);
      }
      dialogs.toast('Aim Slider unlocked! Switch it off any time in Settings.', { kind: 'ok', ms: 2200 });
    } else if (r.reason === 'insufficient') {
      needCoins(heroEl, r.need);
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
    sliderCanvas = null;
    pendingPreviews = [];
    ballCanvases = [];
    el.dataset.tab = tab;
    if (tab === 'balls') body.appendChild(renderGrid('ball'));
    else if (tab === 'stadiums') body.appendChild(renderStadiums());
    else if (tab === 'upgrades') body.appendChild(renderUpgrades());
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
    pendingPreviews = [];
    sliderCanvas = null;
  }

  /** Every frame while visible: deferred previews, animated balls / slider (~24 fps), countdowns. */
  function tick(nowMs) {
    if (pendingPreviews.length) {
      const job = pendingPreviews.shift();
      if (job.ctx.canvas && job.ctx.canvas.isConnected) {
        try { paintStadium(job.ctx, job.id, job.w, job.hgt, false); } catch { /* ignore */ }
      }
    }
    if (tab === 'balls' && ballCanvases.length && nowMs - lastAnim > 42) {
      lastAnim = nowMs;
      const t = nowMs / 1000;
      for (const c of ballCanvases) {
        try {
          c.ctx.clearRect(0, 0, c.size, c.size);
          drawBallPreview(c.ctx, c.id, c.size, t, c.style);
        } catch { /* ignore */ }
      }
    }
    if (tab === 'upgrades' && sliderCanvas && nowMs - lastSliderAnim > 42) {
      lastSliderAnim = nowMs;
      try { drawAimSliderPreview(sliderCanvas.ctx, sliderCanvas.w, sliderCanvas.h, nowMs / 1000); } catch { /* ignore */ }
    }
    if (tab === 'coins') updateRewarded(false);
  }

  shop.on((e) => {
    if (e.type === 'noAds' || e.type === 'reset' || e.type === 'upgrade') {
      if (el.classList.contains('active')) render();
    }
    if (e.type === 'coins' && el.classList.contains('active') && tab === 'upgrades') render();
    if (e.type === 'reset') applyBg();
  });

  applyBg();
  return { el, enter, leave, tick, setTab, refresh: render, get tab() { return tab; } };
}
