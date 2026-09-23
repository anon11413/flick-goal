// Screen router + Menu, Paused, Game Over and Settings screens.
// Screens are presentational: every action calls back into `app` (wired in main.js).

import { h, setText, fmtNum, fmtTime, replayClass, centerIn } from './dom.js';
import { icon } from './icons.js';
import { createCoinPill } from './hud.js';
import { MODES, otherMode } from '../modes.js';

// Which sections are visible for each route (paused overlays the HUD).
const ROUTES = {
  menu: ['menu'],
  playing: ['hud'],
  paused: ['hud', 'paused'],
  gameover: ['gameover'],
  store: ['store'],
  settings: ['settings'],
};

/**
 * createRouter({ ui, screens: { [sectionName]: {el, enter?, leave?, tick?} } })
 * -> { show(route, opts), current, previous, tick(now), onChange(fn) }
 */
export function createRouter({ ui, screens }) {
  let current = null;
  let previous = null;
  const active = new Set();
  const listeners = new Set();
  for (const s of Object.values(screens)) {
    ui.appendChild(s.el);
    s.el.setAttribute('aria-hidden', 'true');
  }

  function show(route, opts = {}) {
    const want = new Set(ROUTES[route] || []);
    previous = current;
    current = route;
    ui.dataset.screen = route;
    for (const [name, s] of Object.entries(screens)) {
      const on = want.has(name);
      const was = active.has(name);
      if (on && !was) {
        active.add(name);
        s.el.classList.add('active');
        s.el.setAttribute('aria-hidden', 'false');
        replayEnter(s.el);
        if (s.enter) s.enter(opts);
      } else if (!on && was) {
        active.delete(name);
        s.el.classList.remove('active', 'enter');
        s.el.setAttribute('aria-hidden', 'true');
        if (s.leave) s.leave();
      } else if (on && was && s.reenter) {
        s.reenter(opts);
      }
    }
    // drop focus from buttons that just got hidden so Space/Enter go to the game
    const f = document.activeElement;
    if (f && f !== document.body && f.closest && f.closest('.screen:not(.active)')) f.blur();
    for (const fn of listeners) { try { fn(route, previous); } catch (e) { console.error(e); } }
  }

  function replayEnter(el) {
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
  }

  function tick(now) {
    for (const name of active) {
      const s = screens[name];
      if (s.tick) s.tick(now);
    }
  }

  return {
    show,
    tick,
    get current() { return current; },
    get previous() { return previous; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// ---------- small building blocks ----------
let popIndex = 0;
/** Mark an element for the staggered bouncy entrance (see .screen.enter .pop in CSS). */
function pop(el, i = popIndex++) {
  el.classList.add('pop');
  el.style.setProperty('--i', i);
  return el;
}

function roundBtn(name, label, onclick, extraCls = '') {
  const cls = extraCls ? '.' + extraCls.trim().split(/\s+/).join('.') : '';
  return h('button.btn.round' + cls, {
    type: 'button', html: icon(name), onclick, attrs: { 'aria-label': label, title: label },
  });
}

function toggleRow(label, iconName, getValue, onToggle, subLabel = null) {
  const knob = h('span.switch', h('i'));
  const sub = subLabel ? h('small.set-sub', '') : null;
  const row = h('button.set-row', {
    type: 'button',
    attrs: { role: 'switch', 'aria-label': label },
    onclick: () => { onToggle(!getValue()); sync(); },
  }, h('span.set-ic', { html: icon(iconName) }), h('span.set-label', h('span', label), sub), knob);
  function sync() {
    const v = !!getValue();
    row.setAttribute('aria-checked', v ? 'true' : 'false');
    row.classList.toggle('on', v);
    if (sub) setText(sub, subLabel(v));
  }
  sync();
  return { el: row, sync };
}

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Menu mode chip (V2_SPEC §9.1): shows the current mode, tapping it switches mode (bouncy
 * animation) WITHOUT starting a run. A red NEW badge shows until Endless was tried, and a one-time
 * gold callout above it invites returning players. Lives inside [data-no-tap] so the menu's
 * tap-to-play never sees these taps.
 */
function createModeChip(app) {
  const ic = h('span.mode-ic');
  const labels = h('span.mode-labels');
  const badge = h('span.mode-new', 'NEW');
  const chip = h('button.mode-chip', { type: 'button', onclick: (e) => doSwitch(e) },
    ic, labels, h('span.mode-swap', { html: icon('swap') }), badge);
  const callout = h('button.mode-callout', { type: 'button', onclick: (e) => { if (!callout.classList.contains('gone')) doSwitch(e); } },
    h('span.mode-callout-new', 'NEW:'), ' Endless mode! Tap to switch');
  callout.hidden = true;
  const el = h('div.mode-wrap', { dataset: { noTap: '' } }, callout, chip);
  let current = null;
  let busyT = 0;
  let switching = false;      // inside doSwitch: the refresh triggered by the mode change must not repaint
  let calloutShown = false;   // the callout was visible at some point during this menu visit

  function paint(mode, animate) {
    const m = MODES[mode] || MODES.field;
    ic.innerHTML = icon(m.icon);
    ic.className = 'mode-ic ' + m.id;
    chip.dataset.mode = m.id;
    const next = MODES[otherMode(m.id)];
    chip.setAttribute('aria-label', `Game mode: ${m.short}. Tap to switch to ${next.short}.`);
    const lab = h('span.mode-label', m.label);
    if (animate && !REDUCED_MOTION && labels.firstChild) {
      const old = Array.from(labels.children);
      for (const o of old) { o.classList.add('out'); setTimeout(() => o.remove(), 320); }
      lab.classList.add('in');
      labels.appendChild(lab);
      replayClass(chip, 'switching', 340);
    } else {
      labels.replaceChildren(lab);
    }
    current = m.id;
  }

  function doSwitch(e) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - busyT < 250) return; // double taps don't flip twice
    busyT = now;
    // app.toggleMode() refreshes the menu (BEST, badge); the label is painted here, once, so the
    // old label slides out while the new one slides in.
    switching = true;
    let mode;
    try { mode = app.toggleMode(); } finally { switching = false; }
    paint(mode, true);
    refresh();
    // pointer clicks: drop focus so Space / Enter keep starting runs instead of re-switching
    if (e && e.detail > 0) setTimeout(() => { const a = document.activeElement; if (a === chip || a === callout) a.blur(); }, 0);
  }

  function refresh() {
    const mode = app.currentMode();
    if (!switching && mode !== current) paint(mode, false);
    badge.hidden = !app.newBadgeVisible();
    // Once shown on this visit, a dismissed callout keeps its space (faded out, not clickable)
    // until the menu is left: the chip must not jump up under a finger that taps again.
    const vis = app.calloutVisible();
    if (vis) calloutShown = true;
    callout.hidden = !vis && !calloutShown;
    callout.classList.toggle('gone', !vis && calloutShown);
    callout.tabIndex = vis ? 0 : -1;
    callout.setAttribute('aria-hidden', vis ? 'false' : 'true');
  }

  /** New menu visit: a callout dismissed on the last visit no longer reserves space. */
  function newVisit() { calloutShown = false; }

  return { el, chip, callout, refresh, newVisit };
}

// ---------------------------------------------------------------------------
// MENU
// ---------------------------------------------------------------------------
export function createMenu(app) {
  const { mon, shop } = app;
  popIndex = 0;
  const pill = createCoinPill({ onClick: mon.enabled ? () => { app.sfx('click'); app.openStore('coins'); } : null });
  app.wallet.register('menu', pill);

  const best = h('span.best-num', '0');
  const modeChip = createModeChip(app);
  const playBtn = h('button.btn.play-big', {
    type: 'button', html: icon('play'), attrs: { 'aria-label': 'Play' },
    onclick: () => app.startRun(),
  });
  const soundBtn = roundBtn(app.isSoundOn() ? 'soundOn' : 'soundOff', 'Sound', () => {
    const on = app.toggleSound();
    soundBtn.innerHTML = icon(on ? 'soundOn' : 'soundOff');
  }, 'c-blue');
  const noAdsBtn = mon.enabled ? roundBtn('noAds', 'Remove ads', () => app.buyNoAds(), 'c-red') : null;
  const giftBadge = h('span.badge', '!');
  // The label ("FREE!" / countdown) is the gift's call to action, so tapping it claims too.
  const giftLabel = h('span.btn-label.gift-label', { onclick: () => app.claimGift(giftBtn) }, '');
  const giftBtn = h('button.btn.round.c-purple.gift', {
    type: 'button', html: icon('gift'), attrs: { 'aria-label': 'Free gift' },
    onclick: () => app.claimGift(giftBtn),
  });
  giftBtn.appendChild(giftBadge);
  const giftWrap = h('div.btn-stack', giftBtn, giftLabel);

  const el = h('section.screen.menu', { dataset: { screen: 'menu' } },
    h('div.topbar', h('div.topbar-left'), h('div.topbar-mid'), pop(pill.el, 0)),
    h('div.menu-main',
      pop(h('div.logo', h('div.logo-bob', h('span.logo-l1', 'FLICK'), h('span.logo-l2', 'GOAL'))), 1),
      pop(h('div.best', h('span.best-ic', { html: icon('crown') }), h('span', 'BEST'), best), 2),
      pop(modeChip.el, 2),
      pop(h('div.play-wrap', playBtn), 3),
      pop(h('div.tap-to-play', h('span', 'TAP TO PLAY')), 4)),
    pop(h('div.menu-row', { dataset: { noTap: '' } },
      h('div.btn-stack', roundBtn('store', 'Store', () => { app.sfx('click'); app.openStore(); }, 'c-orange'), h('span.btn-label', '')),
      h('div.btn-stack', roundBtn('gear', 'Settings', () => { app.sfx('click'); app.openSettings(); }, 'c-ink'), h('span.btn-label', '')),
      h('div.btn-stack', soundBtn, h('span.btn-label', '')),
      noAdsBtn ? h('div.btn-stack.noads-stack', noAdsBtn, h('span.btn-label', '')) : null,
      giftWrap), 5),
  );

  let lastGiftText = null;
  function updateGift(force) {
    const st = shop.giftStatus();
    const text = st.ready ? 'FREE!' : fmtTime(st.msLeft);
    if (force || text !== lastGiftText) {
      lastGiftText = text;
      setText(giftLabel, text);
      giftBtn.classList.toggle('ready', st.ready);
      giftLabel.classList.toggle('ready', st.ready);
    }
  }

  function refresh() {
    setText(best, fmtNum(app.bestFor(app.currentMode())));
    modeChip.refresh();
    pill.set(app.wallet.displayed());
    soundBtn.innerHTML = icon(app.isSoundOn() ? 'soundOn' : 'soundOff');
    if (noAdsBtn) noAdsBtn.parentElement.hidden = shop.hasNoAds();
    updateGift(true);
  }

  let lastTick = 0;
  return {
    el,
    pill,
    modeChip,
    enter() {
      modeChip.newVisit();
      if (app.onMenuEnter) app.onMenuEnter();
      refresh();
    },
    tick(now) {
      if (now - lastTick > 250) { lastTick = now; updateGift(false); }
    },
    refresh,
  };
}

// ---------------------------------------------------------------------------
// PAUSED
// ---------------------------------------------------------------------------
export function createPaused(app) {
  const soundBtn = roundBtn(app.isSoundOn() ? 'soundOn' : 'soundOff', 'Sound', () => {
    const on = app.toggleSound();
    soundBtn.innerHTML = icon(on ? 'soundOn' : 'soundOff');
  }, 'c-blue');
  const el = h('section.screen.paused.dim', { dataset: { screen: 'paused' } },
    h('div.center-col',
      pop(h('div.title-xl', 'PAUSED'), 0),
      pop(h('button.btn.pill.big.white.c-green', { type: 'button', onclick: () => app.resume() },
        h('span.btn-ic', { html: icon('play') }), 'RESUME'), 1),
      pop(h('div.row-gap',
        roundBtn('home', 'Home', () => app.quitToMenu(), 'c-orange'),
        soundBtn), 2)));
  return {
    el,
    enter() { soundBtn.innerHTML = icon(app.isSoundOn() ? 'soundOn' : 'soundOff'); },
  };
}

// ---------------------------------------------------------------------------
// GAME OVER
// ---------------------------------------------------------------------------
const REASON_TITLES = {
  clock: "TIME'S UP!",
  short: 'NO GOOD!',
  over: 'TOO HIGH!',
  post: 'OFF THE POST!',
};

export function createGameOver(app) {
  const { mon } = app;
  const pill = createCoinPill({ onClick: mon.enabled ? () => { app.sfx('click'); app.openStore('coins'); } : null });
  app.wallet.register('gameover', pill);

  const title = h('div.go-title', 'NO GOOD!');
  const scoreNum = h('div.go-score', '0');
  const bestNum = h('span', '0');
  const coinsNum = h('span', '+0');
  const coinsRow = h('div.go-coins', h('span.coin-ic', { html: icon('coin') }), coinsNum);
  const modeIc = h('span.go-mode-ic');
  const modeLabel = h('span', 'FIELD GOAL');
  const modeTag = h('div.go-mode', modeIc, modeLabel);
  const distNum = h('span.go-dist-num', '0');
  const farChip = h('span.go-far', 'FARTHEST!');
  const distRow = h('div.go-dist', h('span.go-dist-ic', { html: icon('flag') }), distNum, h('span', 'YDS'), farChip);
  const card = h('div.go-card',
    modeTag,
    h('div.go-label', 'SCORE'),
    scoreNum,
    h('div.go-best', h('span.best-ic', { html: icon('crown') }), 'BEST ', bestNum),
    distRow,
    coinsRow);

  const continueBtn = h('button.btn.pill.green.go-continue', { type: 'button', onclick: () => app.continueRun() },
    h('span.btn-ic', { html: icon('ad') }), h('span', 'CONTINUE'));
  const doubleBtn = h('button.btn.pill.gold.go-double', { type: 'button', onclick: () => app.doubleCoins(doubleBtn) },
    h('span.btn-ic', { html: icon('ad') }), h('span', '2x COINS'));
  const adRow = h('div.go-adrow', continueBtn, doubleBtn);
  const playBtn = h('button.btn.pill.big.white.c-orange.go-play', { type: 'button', onclick: () => app.playAgain() },
    h('span.btn-ic', { html: icon('replay') }), h('span.go-play-txt', 'PLAY AGAIN'));
  // On short screens (container query) Home / PLAY AGAIN / Store share one row.
  const homeBtn = roundBtn('home', 'Home', () => app.goHome(), 'c-orange go-home');
  const storeBtn = roundBtn('store', 'Store', () => { app.sfx('click'); app.openStore(); }, 'c-purple go-store');

  const el = h('section.screen.gameover.dim', { dataset: { screen: 'gameover' } },
    h('div.topbar', h('div.topbar-left'), h('div.topbar-mid'), pop(pill.el, 0)),
    h('div.center-col.go-col',
      pop(title, 0),
      pop(card, 1),
      pop(adRow, 2),
      pop(h('div.go-bottom', playBtn, h('div.row-gap', homeBtn, storeBtn)), 3)));

  // Input grace: buttons are inert while the card pops in, so a tap (or a held Space) that
  // was meant for the last shot can't trigger Continue / Play Again by accident.
  let lockTimer = 0;
  function lockInput(ms) {
    clearTimeout(lockTimer);
    el.classList.add('locked');
    lockTimer = setTimeout(() => el.classList.remove('locked'), ms);
  }

  let countRaf = 0;
  function countUp(to) {
    cancelAnimationFrame(countRaf);
    const start = performance.now();
    const dur = Math.min(900, 250 + to * 25);
    const stepFn = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setText(scoreNum, Math.round(to * e));
      if (k < 1) countRaf = requestAnimationFrame(stepFn);
    };
    if (to <= 0) setText(scoreNum, 0);
    else countRaf = requestAnimationFrame(stepFn);
  }

  function render(r, animate) {
    // A new best gets a celebratory headline instead of the miss reason.
    setText(title, r.newBest ? 'NEW BEST!' : (REASON_TITLES[r.reason] || 'GAME OVER'));
    title.classList.toggle('is-best', !!r.newBest);
    if (animate) countUp(r.score); else setText(scoreNum, r.score);
    setText(bestNum, fmtNum(r.best));
    card.classList.toggle('is-best', !!r.newBest);
    const m = MODES[r.mode] || MODES.field;
    modeIc.innerHTML = icon(m.icon);
    modeIc.className = 'go-mode-ic ' + m.id;
    setText(modeLabel, m.label);
    card.dataset.mode = m.id;
    distRow.hidden = m.id !== 'endless';
    setText(distNum, fmtNum(r.yards | 0));
    farChip.hidden = !r.farthest;
    const total = r.coinsTotal != null ? r.coinsTotal : r.coinsRun;
    setText(coinsNum, '+' + fmtNum(total));
    coinsRow.hidden = total <= 0;
    continueBtn.hidden = !(mon.enabled && r.canContinue);
    doubleBtn.hidden = !(mon.enabled && (r.doublable != null ? r.doublable : r.coinsRun) > 0);
    adRow.hidden = continueBtn.hidden && doubleBtn.hidden;
    pill.set(app.wallet.displayed());
  }

  return {
    el,
    pill,
    coinsEl: coinsRow,
    enter(opts = {}) {
      const r = app.lastResult();
      if (!r) return;
      render(r, !!opts.fresh);
      if (opts.fresh) lockInput(opts.grace || 650);
      if (opts.fresh && r.newBest) {
        setTimeout(() => {
          app.fx.confettiAt(title, 36, 1);
          replayClass(title, 'bump', 400);
        }, 420);
      }
    },
    leave() { cancelAnimationFrame(countRaf); clearTimeout(lockTimer); el.classList.remove('locked'); },
    refresh() { const r = app.lastResult(); if (r) render(r, false); },
    setBusy(b) {
      continueBtn.disabled = b;
      doubleBtn.disabled = b;
    },
    doubleOrigin() { return centerIn(coinsRow, app.stage); },
  };
}

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
export function createSettings(app) {
  const { mon, cfg } = app;
  const sound = toggleRow('Sound', 'soundOn', () => app.isSoundOn(), (v) => app.setSound(v));
  const haptics = app.hapticsSupported
    ? toggleRow('Vibration', 'vibrate', () => app.isHapticsOn(), (v) => app.setHaptics(v))
    : null;
  // Aim Slider upgrade switch: only shown once the upgrade is owned (bought in the store).
  const aimSlider = toggleRow('Aim slider', 'slider', () => app.isAimSliderOn(), (v) => app.setAimSlider(v),
    (on) => (on ? 'On: slider every kick' : 'Off: aim with the dots'));
  aimSlider.el.classList.add('aim-row');
  const restore = mon.enabled
    ? h('button.set-row.action', { type: 'button', onclick: () => app.restorePurchases() },
      h('span.set-ic', { html: icon('restore') }), h('span.set-label', 'Restore Purchases'), h('span.set-chev', { html: icon('back') }))
    : null;
  const reset = h('button.set-row.action.danger', { type: 'button', onclick: () => app.resetProgress() },
    h('span.set-ic', { html: icon('trash') }), h('span.set-label', 'Reset Progress'), h('span.set-chev', { html: icon('back') }));

  const el = h('section.screen.settings', { dataset: { screen: 'settings' } },
    h('div.topbar.store-top',
      h('button.btn.round.sm', { type: 'button', html: icon('back'), attrs: { 'aria-label': 'Back' }, onclick: () => app.back() }),
      h('div.store-title', 'SETTINGS'),
      h('div.topbar-spacer')),
    h('div.settings-body',
      pop(h('div.set-card', sound.el, haptics ? haptics.el : null, aimSlider.el), 0),
      restore ? pop(h('div.set-card', restore), 1) : null,
      pop(h('div.set-card', reset), 2),
      pop(h('div.set-about',
        h('div.set-logo', 'FLICK GOAL'),
        h('div.version', app.qa ? `v${cfg.version} · ads: ${mon.mode}` : `v${cfg.version}`)), 3)));

  function syncAll() {
    sound.sync();
    if (haptics) haptics.sync();
    aimSlider.el.hidden = !app.aimSliderOwned();
    aimSlider.sync();
  }
  return {
    el,
    enter() { syncAll(); },
    refresh: syncAll,
  };
}
