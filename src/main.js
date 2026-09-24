// Flick Goal — boot, fixed-timestep loop, screen routing, input, and engine<->shell wiring.
// The engine (src/engine/*) is pure simulation + canvas drawing; everything DOM lives here and in src/ui/*.

import { CONFIG } from './config.js';
import { createGame } from './engine/game.js';
import { createRenderer } from './engine/render.js';
import { themePalette } from './engine/skins.js';
import { createSaveManager } from './economy/save.js';
import { createShop } from './economy/shop.js';
import { createRunCoins } from './economy/runCoins.js';
import { createMonetization } from './platform/monetization.js';
import { createAudio, createHaptics } from './platform/audio.js';
import { $, shade, isShown, fmtTime, fmtNum } from './ui/dom.js';
import { createDialogs } from './ui/dialogs.js';
import { createFx } from './ui/fx.js';
import { createHud } from './ui/hud.js';
import { createStore } from './ui/store.js';
import { createRouter, createMenu, createPaused, createGameOver, createSettings } from './ui/screens.js';
import { createDevState, isDevRun, nextBest } from './dev.js';
import { createDevPanel } from './ui/devPanel.js';
import { sliderMode, hintFor, describeAim, AIM_SLIDER_ID } from './aimAssist.js';
import { isMode, normalizeMode, otherMode, calloutVisible, nextCalloutState, newBadgeVisible } from './modes.js';
import { purchaseErrorText, pendingText, restoreText, rewardedFailText } from './ui/iapText.js';

const STEP = 1 / CONFIG.sim.hz;
// URL flags (?qa ?debug ?ads=off ?mode ?style ?gfx ?round ?dev ...) exist only in the dev build
// profile; release builds (web-release, android-*) ignore the query string completely.
const SEARCH = CONFIG.allowUrlFlags ? location.search : '';
const params = new URLSearchParams(SEARCH);
const debug = CONFIG.debug || params.get('debug') === '1';
const qa = debug || params.has('qa') || params.has('smoke');
// QA switch: ?ads=off previews the game exactly as it runs with monetization.mode = 'off'.
const monCfg = params.get('ads') === 'off'
  ? { ...CONFIG, monetization: { ...CONFIG.monetization, mode: 'off' } }
  : CONFIG;
// Developer "start round" (?round=N, ?dev=1, Settings version 5x tap); inert when cfg.dev.enabled is false.
const dev = createDevState({ cfg: CONFIG, search: SEARCH });

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const stage = $('#stage');
const canvas = $('#game');
const uiRoot = $('#ui');
const fxLayer = $('#fx');
const overlay = $('#overlay');
const metaTheme = document.querySelector('meta[name="theme-color"]');

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
const save = createSaveManager({ cfg: CONFIG });
const shop = createShop({ save, cfg: CONFIG });
const audio = createAudio({ cfg: CONFIG, enabled: save.data.settings.sound });
const haptics = createHaptics({ cfg: CONFIG, enabled: save.data.settings.haptics });
const mon = createMonetization({ cfg: monCfg, shop, save, root: overlay });
const dialogs = createDialogs({ root: overlay, onClick: () => haptics.pulse('tap') });
// Full-screen ads / store sheets: silence the game while they are up; ads follow the Sound setting.
mon.onBusyChange((b) => { if (b) audio.suspend(); else if (!document.hidden) audio.resume(); });
mon.setMuted(!save.data.settings.sound);
const fx = createFx({ layer: fxLayer, stage });

// QA: ?mode=field|endless sets the saved mode at boot.
if (isMode(params.get('mode'))) save.update((d) => { d.mode = params.get('mode'); });

const game = createGame({ cfg: CONFIG });
const renderer = createRenderer(canvas, game, { cfg: CONFIG, debug });
// QA / debug only: ?style=retro|pro renders the equipped theme in that art style (not saved).
if (params.get('style') === 'retro' || params.get('style') === 'pro') renderer.setStyleOverride(params.get('style'));
// Graphics quality (adaptive pro styles): ?gfx=high|low forces a tier, else the developer override.
const gfxParam = params.get('gfx') === 'high' || params.get('gfx') === 'low' ? params.get('gfx') : null;
const applyGfx = () => renderer.setQuality(gfxParam || dev.gfx());
applyGfx();

const sfx = (name) => audio.play(name);
const haptic = (name) => haptics.pulse(name);

// ---------------------------------------------------------------------------
// Wallet view: pills show (coins - pending) so the counter ticks up as flying coins land.
// Coins are always credited to the save immediately (quitting never loses them).
// ---------------------------------------------------------------------------
let router = null;
const wallet = (() => {
  const pills = new Map();
  let pending = 0;
  const displayed = () => Math.max(0, shop.coins() - pending);
  const refresh = () => { const v = displayed(); for (const p of pills.values()) p.set(v); };
  const activePill = () => {
    const r = router && router.current;
    const key = r === 'playing' || r === 'paused' ? 'hud' : r;
    const p = pills.get(key);
    return p && isShown(p.el) ? p : null;
  };
  function hold(amount) {
    pending += Math.max(0, amount | 0);
    refresh();
  }
  /** Animate `amount` pending coins from a stage point into the visible pill. */
  function fly(from, count, amount) {
    amount = Math.max(0, amount | 0);
    const p = activePill();
    const n = Math.max(1, Math.min(8, Math.round(count) || 1));
    const per = Math.floor(amount / n);
    let left = amount;
    fx.coinFly({
      from,
      target: p && p.target,
      count: n,
      onEach: (i) => {
        const give = i === n - 1 ? left : Math.min(per, left);
        left -= give;
        pending = Math.max(0, pending - give);
        refresh();
        if (p) p.bump();
      },
    });
  }
  return {
    register(name, pill) { pills.set(name, pill); pill.set(displayed()); },
    displayed,
    refresh,
    hold,
    fly,
    /** Credit now + fly (game coins, 2x coins). */
    credit(amount, source, from, count) {
      if (!(amount > 0)) return;
      pending += amount;
      if (!shop.addCoins(amount, source)) { pending -= amount; refresh(); return; }
      fly(from, count, amount);
    },
    /** Coins already credited elsewhere (IAP, rewarded): hold + fly. */
    flyFrom(from, count, amount) {
      hold(amount);
      fly(from || { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, count, amount);
    },
  };
})();
shop.on(() => wallet.refresh());

// ---------------------------------------------------------------------------
// Theme chrome (letterbox, panel tint, status-bar color) follows stadium + score tier.
// ---------------------------------------------------------------------------
let tier = 0;
function applyThemeChrome() {
  let pal = null;
  try { pal = themePalette(shop.equipped('stadium'), tier); } catch { pal = null; }
  const bg = (pal && pal.uiBg) || CONFIG.ui.themeColor;
  const top = (pal && pal.skyTop) || bg;
  const root = document.documentElement.style;
  root.setProperty('--theme', bg);
  root.setProperty('--letterbox', shade(bg, 0.45));
  // Light stadiums (snow, pastel tiers): white buttons need a coloured drop + ring to stand out.
  const light = pal ? luminance(pal.ground) > 0.72 || luminance(pal.skyBottom) > 0.82 : false;
  document.documentElement.classList.toggle('light-theme', light);
  root.setProperty('--btn-shadow', light ? shade(bg, 0.72) : 'rgba(0, 0, 0, .15)');
  if (metaTheme) metaTheme.setAttribute('content', top);
}

/** Relative luminance (0..1) of a #RRGGBB colour. */
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

// ---------------------------------------------------------------------------
// Run bookkeeping
// ---------------------------------------------------------------------------
const runCoins = createRunCoins(); // 2x offer only ever doubles coins not doubled yet (survives Continue)
let run = { bestAtRunStart: 0, bestYardsAtRunStart: 0, result: null };
let storeReturn = 'menu';
let calloutThisVisit = false; // the one-time Endless callout is showing on this menu visit
let calloutCountDue = true;   // count a callout "show" once per app launch and once per return from a run
let lastModeSwitchAt = -1e9;  // performance.now() of the last chip / callout switch

// ---------------------------------------------------------------------------
// Aim slider: tutorial (kicks 1-2) + Aim Slider upgrade + developer force (src/aimAssist.js).
// The mode for the NEXT shot is recomputed whenever an input changes; the renderer latches it
// when that shot appears, so the kick in flight never changes its slider.
// ---------------------------------------------------------------------------
let aim = { mode: 'full', reason: 'tutorial' };
const aimSliderOwned = () => shop.isOwned('upgrade', AIM_SLIDER_ID);
function computeAim() {
  aim = sliderMode({
    devForce: dev.sliderForce(),
    owned: aimSliderOwned(),
    on: save.data.settings.aimSlider !== false,
    kicks: save.data.tutorial.kicks,
  });
  renderer.setAimAssist(aim.mode);
  return aim;
}

// ---------------------------------------------------------------------------
// Game mode (FIELD GOAL / ENDLESS): saved choice, switched from the menu chip without a run.
// ---------------------------------------------------------------------------
const currentMode = () => normalizeMode(save.data.mode);
function applyUiPatch(event) {
  const patch = nextCalloutState(save.data, event);
  if (patch) save.update((d) => { Object.assign(d.ui, patch); });
}
/** Switch mode between runs (menu chip, callout, developer panel). Never starts a run. */
function setMode(m, { quiet = false } = {}) {
  const mode = normalizeMode(m);
  const changed = mode !== save.data.mode;
  save.update((d) => {
    d.mode = mode;
    const patch = nextCalloutState(d, 'switch');
    if (patch) Object.assign(d.ui, patch);
  });
  calloutThisVisit = false;
  lastModeSwitchAt = performance.now();
  if (changed || game.mode !== mode) {
    if (game.phase === 'idle' || game.phase === 'over' || router.current !== 'playing') game.idle({ mode });
    tier = 0;
    applyThemeChrome();
  }
  if (!quiet) {
    sfx('whoosh');
    haptic('tap');
  }
  if (router && router.current === 'menu') menu.refresh();
  return mode;
}
let flowBusy = false; // guards async button flows (ads / interstitials)

// ---------------------------------------------------------------------------
// App facade used by the screens
// ---------------------------------------------------------------------------
const app = {
  cfg: CONFIG,
  stage,
  save,
  shop,
  mon,
  dialogs,
  fx,
  wallet,
  sfx,
  haptic,
  hapticsSupported: haptics.supported,
  qa,
  lastResult: () => (run.result
    ? { ...run.result, coinsTotal: runCoins.total(), doublable: runCoins.doublable() }
    : null),

  isSoundOn: () => save.data.settings.sound,
  setSound(v) {
    save.update((d) => { d.settings.sound = !!v; });
    audio.setEnabled(!!v);
    mon.setMuted(!v);
    if (v) { audio.unlock(); sfx('click'); }
  },
  toggleSound() { app.setSound(!save.data.settings.sound); return save.data.settings.sound; },
  isHapticsOn: () => save.data.settings.haptics,
  setHaptics(v) {
    save.update((d) => { d.settings.haptics = !!v; });
    haptics.setEnabled(!!v);
    if (v) haptic('buy');
  },

  startRun,
  pause,
  resume,
  quitToMenu,
  goHome,
  playAgain,
  continueRun,
  doubleCoins,
  claimGift,
  buyNoAds,
  restorePurchases,
  showPrivacyOptions,
  showPurchaseResult,
  resetProgress,

  // modes (menu chip)
  currentMode,
  bestFor: (m) => (save.data.best && save.data.best[normalizeMode(m)]) | 0,
  toggleMode: () => setMode(otherMode(currentMode())),
  setMode: (m) => setMode(m),
  newBadgeVisible: () => newBadgeVisible(save.data),
  calloutVisible: () => calloutThisVisit && !save.data.ui.calloutDone && !save.data.ui.endlessTried,
  onMenuEnter() {
    calloutThisVisit = calloutVisible(save.data);
    // Store / Settings round trips don't use up the one-time callout: a "visit" is the app launch
    // or coming back from a run (game over / pause -> Home).
    if (calloutThisVisit && calloutCountDue) {
      applyUiPatch('menuVisit');
      calloutCountDue = false;
    }
  },

  // Aim Slider upgrade
  aimSliderOwned,
  isAimSliderOn: () => shop.upgradeActive(AIM_SLIDER_ID),
  setAimSlider(v) {
    shop.setUpgradeActive(AIM_SLIDER_ID, !!v);
    computeAim();
  },
  onUpgradeChange() {
    computeAim();
    settings.refresh();
  },

  // developer panel
  devAddCoins(btn) {
    if (!shop.addCoins(10000, 'dev')) return;
    sfx('gift');
    haptic('buy');
    if (btn && btn.isConnected) fx.confettiAt(btn, 24, 0.8);
    dialogs.toast('+10,000 coins', { kind: 'ok', ms: 1200 });
  },
  devResetTutorial() {
    save.update((d) => {
      d.tutorial.kicks = 0;
      d.ui = { endlessTried: false, calloutShows: 0, calloutDone: false };
    });
    computeAim();
    sfx('click');
    dialogs.toast('Tutorial reset: next kick shows the slider', { kind: 'info' });
  },
  aimReadout: () => `Tutorial kicks: ${save.data.tutorial.kicks} · next kick: ${describeAim(aim)}`,

  openStore(tab) {
    if (router.current !== 'store') storeReturn = router.current === 'gameover' ? 'gameover' : 'menu';
    sfx('whoosh');
    router.show('store', { tab });
  },
  openSettings() {
    sfx('whoosh');
    router.show('settings');
  },
  back() {
    sfx('click');
    if (router.current === 'store') router.show(storeReturn === 'gameover' && game.phase === 'over' ? 'gameover' : 'menu');
    else router.show('menu');
  },
  onBack() { app.back(); },
  onEquip(kind, id) {
    if (kind === 'ball') renderer.setSkin(id);
    else if (kind === 'stadium') { renderer.setTheme(id); applyThemeChrome(); }
  },
};

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
// The HUD pause button ignores clicks for a moment after the HUD appears, so the click that
// follows the tap which started/continued the run can't land on it (touch compat click).
const hud = createHud({ stage, fx, onPause: () => { if (sinceRoute() >= 250) pause(); } });
wallet.register('hud', hud.pill);
const menu = createMenu(app);
const paused = createPaused(app);
const gameover = createGameOver(app);
const store = createStore(app);
const settings = createSettings(app);
router = createRouter({
  ui: uiRoot,
  screens: { menu, hud, paused, gameover, store, settings },
});
createDevPanel({ app, dev, game, router, screens: { menu, hud, gameover, settings } });
// Pre-warm a dev start round's palette-tier layers on the menu (adaptive styles) and follow the
// developer slider / graphics overrides.
const warmDevTier = () => renderer.setWarmTier(Math.floor(dev.startMade() / CONFIG.scoring.tierEvery));
warmDevTier();
dev.onChange(() => { warmDevTier(); applyGfx(); computeAim(); });
let routeAt = performance.now();
router.onChange(() => { routeAt = performance.now(); });
/** ms since the current route was shown (input grace periods). */
function sinceRoute() { return performance.now() - routeAt; }
const MENU_TAP_GRACE = 300;     // ms: taps right after arriving on the menu don't start a run
const MODE_SWITCH_GRACE = 350;  // ms: menu taps right after a mode switch don't start a run
const GAMEOVER_GRACE = 650;     // ms: Game Over buttons / Space ignore input while the card pops in

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function startRun() {
  if (flowBusy) return;
  sfx('whoosh');
  haptic('tap');
  game.newRun({ startMade: dev.startMade(), mode: currentMode() });
  calloutCountDue = true;
  router.show('playing');
}

function pause() {
  if (router.current !== 'playing') return;
  router.show('paused');
}

function resume() {
  if (router.current !== 'paused') return;
  sfx('click');
  router.show('playing');
}

function recordBest(hudState) {
  if (isDevRun(hudState)) return; // dev start-round runs never touch Best
  const m = normalizeMode(hudState.mode);
  save.update((d) => {
    if (hudState.score > d.best[m]) d.best[m] = hudState.score;
    if (m === 'endless' && (hudState.yards | 0) > d.bestYards) d.bestYards = hudState.yards | 0;
  });
}

function quitToMenu() {
  if (router.current !== 'paused') return;
  recordBest(game.hud());
  game.idle();
  tier = 0;
  applyThemeChrome();
  router.show('menu');
}

async function goHome() {
  if (flowBusy) return;
  flowBusy = true;
  try {
    await mon.maybeInterstitial(save);
  } finally {
    flowBusy = false;
  }
  game.idle();
  tier = 0;
  applyThemeChrome();
  router.show('menu');
}

async function playAgain() {
  if (flowBusy || router.current !== 'gameover') return;
  flowBusy = true;
  try {
    await mon.maybeInterstitial(save);
  } finally {
    flowBusy = false;
  }
  startRun();
}

async function continueRun() {
  if (flowBusy || !run.result || !run.result.canContinue) return;
  flowBusy = true;
  gameover.setBusy(true);
  let res = { rewarded: false };
  try {
    res = await mon.ads.showRewarded('continue');
  } finally {
    flowBusy = false;
    gameover.setBusy(false);
  }
  if (!res.rewarded) {
    const msg = rewardedFailText(res, 'continue');
    if (msg) dialogs.toast(msg, { kind: 'warn', ms: 2400 });
    gameover.refresh();
    return;
  }
  if (game.continueRun()) {
    sfx('whoosh');
    router.show('playing');
  } else {
    run.result.canContinue = false;
    gameover.refresh();
  }
}

async function doubleCoins(btn) {
  if (flowBusy || !run.result || runCoins.doublable() <= 0) return;
  flowBusy = true;
  gameover.setBusy(true);
  let res = { rewarded: false };
  try {
    res = await mon.ads.showRewarded('double_coins');
  } finally {
    flowBusy = false;
    gameover.setBusy(false);
  }
  if (!res.rewarded) {
    const msg = rewardedFailText(res, 'double your coins');
    if (msg) dialogs.toast(msg, { kind: 'warn', ms: 2400 });
    gameover.refresh();
    return;
  }
  const amount = runCoins.applyDouble();
  if (amount <= 0) return;
  const from = btn && btn.isConnected && isShown(btn) ? gameover.doubleOrigin() : null;
  sfx('gift');
  gameover.refresh();
  wallet.credit(amount, 'double', from || gameover.doubleOrigin(), Math.min(8, amount));
}

async function claimGift(btn) {
  if (flowBusy) return;
  const st = shop.giftStatus();
  if (!st.ready) {
    sfx('click');
    dialogs.toast(`Next free gift in ${fmtTime(st.msLeft)}`);
    return;
  }
  flowBusy = true;
  try {
    const r = shop.claimGift();
    if (!r.ok) return;
    wallet.hold(r.amount);
    sfx('gift');
    haptic('buy');
    menu.refresh();
    const pos = await dialogs.rewardPopup({ title: 'FREE GIFT!', amount: r.amount, subtitle: 'Come back in 4 hours for more', stage });
    sfx('coin');
    wallet.fly(pos || { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, 8, r.amount);
  } finally {
    flowBusy = false;
  }
}

/**
 * Feedback for a finished mon.iap.purchase() (menu No Ads button and the store). Coins / No Ads are
 * already granted when res.ok. `from` = stage point the coins fly from. Returns true on success.
 */
function showPurchaseResult(res, from) {
  if (res && res.ok) {
    sfx('buy');
    haptic('buy');
    if (res.coins > 0) {
      wallet.flyFrom(from || null, 8, res.coins);
      dialogs.toast(`+${fmtNum(res.coins)} coins!`, { kind: 'ok', ms: 1600 });
    }
    if (res.noAds) {
      fx.confetti(stage.clientWidth / 2, stage.clientHeight * 0.4, 44, 1.1);
      dialogs.toast('Ads removed — thank you!', { kind: 'ok' });
    }
    return true;
  }
  if (res && res.pending) {
    const t = pendingText(res.productId);
    dialogs.confirmDialog({ title: t.title, message: t.message, okText: 'OK', cancelText: null, iconName: 'coin' });
    return false;
  }
  const msg = purchaseErrorText(res);
  if (msg) dialogs.toast(msg, { kind: res && res.restored ? 'ok' : 'warn', ms: 2600 });
  return false;
}

async function buyNoAds() {
  if (flowBusy) return;
  flowBusy = true;
  try {
    showPurchaseResult(await mon.iap.purchase('no_ads'));
  } finally {
    flowBusy = false;
    menu.refresh();
  }
}

async function restorePurchases() {
  if (flowBusy) return;
  flowBusy = true;
  try {
    const r = await mon.iap.restore();
    if (r.coins > 0) wallet.flyFrom(null, 6, r.coins);
    const t = restoreText(r);
    if (t) dialogs.toast(t.text, { kind: t.kind, ms: 4200 });
  } finally {
    flowBusy = false;
    settings.refresh();
    menu.refresh();
  }
}

/** Settings "Privacy & ad choices" (Google UMP privacy options form; shown only when required). */
async function showPrivacyOptions() {
  if (flowBusy) return;
  flowBusy = true;
  try {
    await mon.privacy.show();
  } finally {
    flowBusy = false;
    settings.refresh();
  }
}

// Coins credited outside a purchase flow (a pending payment completed, the app was closed while
// Google Play charged, a restore): tell the player.
mon.iap.onGrant((g) => {
  if (!(g && g.coins > 0)) return;
  wallet.flyFrom(null, 8, g.coins);
  sfx('gift');
  dialogs.toast(`Purchase complete: +${fmtNum(g.coins)} coins`, { kind: 'ok', ms: 2600 });
});
// Provider state changed (consent finished, store prices loaded, No Ads synced): refresh the screen.
mon.onChange(() => {
  if (!router) return;
  const r = router.current;
  if (r === 'menu') menu.refresh();
  else if (r === 'settings') settings.refresh();
  else if (r === 'store' && store.refresh) store.refresh();
  else if (r === 'gameover') gameover.refresh();
});

async function resetProgress() {
  const ok = await dialogs.confirmDialog({
    title: 'Reset progress?',
    message: 'Reset all coins, skins and best score? This cannot be undone.',
    okText: 'RESET',
    cancelText: 'Cancel',
    danger: true,
    iconName: 'trash',
  });
  if (!ok) return;
  save.reset();
  shop.refresh();
  audio.setEnabled(save.data.settings.sound);
  haptics.setEnabled(save.data.settings.haptics);
  renderer.setSkin(CONFIG.defaults.ball);
  renderer.setTheme(CONFIG.defaults.stadium);
  computeAim();
  settings.refresh();
  tier = 0;
  applyThemeChrome();
  wallet.refresh();
  menu.refresh();
  sfx('thud');
  dialogs.toast('Progress reset');
}

// ---------------------------------------------------------------------------
// Engine events -> feedback, economy, screens
// ---------------------------------------------------------------------------
game.on('runStart', (e) => {
  const mode = normalizeMode(e && e.mode);
  run = { bestAtRunStart: app.bestFor(mode), bestYardsAtRunStart: save.data.bestYards | 0, result: null };
  runCoins.reset();
  save.update((d) => { d.stats.gamesPlayed += 1; });
  if (mode === 'endless') applyUiPatch('endlessRun');
  hud.reset();
  hud.setMode(mode);
  computeAim();
  tier = 0;
  applyThemeChrome();
});

game.on('shotStart', (e) => {
  // Aim hints: slider tutorial (kick 1 rail, kick 2 fade), first slider-less kick, first shot of a
  // run for newer players (V2_SPEC §6.4). A dev start-round run's first shot is made === startMade.
  hud.showHint(hintFor({
    mode: aim.mode,
    reason: aim.reason,
    kicks: save.data.tutorial.kicks,
    made: e.made,
    startMade: game.hud().startMade,
    totalGoals: save.data.stats.totalGoals,
    cfg: CONFIG,
  }));
});

game.on('flick', () => {
  hud.showHint(null);
  sfx('flick');
  haptic('flick');
  // Tutorial progress counts real kicks (not timeouts), shared by both modes; dev runs don't count.
  if (!isDevRun(game.hud())) {
    save.update((d) => { d.tutorial.kicks = Math.min(999, (d.tutorial.kicks | 0) + 1); });
  }
  computeAim();
});

game.on('bounce', (e) => {
  if (e.kind === 'ground') {
    if ((e.impact || 0) > 140) sfx('thud');
  } else {
    sfx('bounce');
    haptic('tap');
  }
});

game.on('net', (e) => {
  if ((e.impact || 0) > 140) sfx('thud');
});

game.on('score', (e) => {
  sfx(e.perfect ? 'perfect' : 'goal');
  haptic(e.perfect ? 'perfect' : 'goal');
  hud.onScore(e);
  if (e.coins > 0) wallet.credit(e.coins, 'goal', { x: e.sx, y: e.sy }, e.coins);
  save.update((d) => {
    d.stats.totalGoals += 1;
    if (e.perfect) d.stats.totalPerfects += 1;
    if (e.streak > d.stats.bestStreak) d.stats.bestStreak = e.streak;
  });
});

game.on('coin', (e) => {
  sfx('coin');
  haptic('coin');
  wallet.credit(e.amount, 'pickup', { x: e.sx, y: e.sy }, e.amount);
});

game.on('tier', (e) => {
  tier = e.tier | 0;
  applyThemeChrome();
});

game.on('land', () => sfx('thud'));

game.on('clockLow', () => {
  sfx('tick');
  hud.onClockLow();
});

game.on('miss', () => {
  sfx('fail');
  haptic('fail');
  hud.showHint(null);
});

game.on('gameover', (e) => {
  mon.onGameOver();
  const devRun = isDevRun(e); // dev start-round run: no Best update, no NEW BEST
  const mode = normalizeMode(e.mode);
  const newBest = !devRun && e.score > run.bestAtRunStart && e.score > 0;
  const yards = mode === 'endless' ? e.yards | 0 : 0;
  const farthest = !devRun && mode === 'endless' && yards > 0 && yards > run.bestYardsAtRunStart;
  save.update((d) => {
    d.best[mode] = nextBest(d.best[mode], e);
    if (!devRun && yards > d.bestYards) d.bestYards = yards;
    d.stats.bestStreak = Math.max(d.stats.bestStreak, e.bestStreak | 0);
  });
  runCoins.setEarned(e.coinsRun | 0);
  run.result = {
    score: e.score,
    made: e.made,
    perfects: e.perfects,
    coinsRun: e.coinsRun | 0,
    reason: e.reason,
    canContinue: !!e.canContinue,
    best: save.data.best[mode],
    newBest,
    startMade: e.startMade | 0,
    mode,
    yards,
    farthest,
  };
  if (router.current === 'playing' || router.current === 'paused') {
    router.show('gameover', { fresh: true });
    if (newBest) setTimeout(() => sfx('newbest'), 380);
  }
});

game.on('continue', () => {
  hud.reset();
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const unlockAudio = () => audio.unlock();
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('touchend', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);

const NON_GAME = 'button, a, input, select, textarea, [data-no-tap], .modal, .toast, #rotate';
const overlayOpen = () => dialogs.isOpen() || mon.isBusy() || overlay.querySelector('.modal, .mock-ad, .sheet-wrap');

// Phone turned sideways: the "Turn your phone upright" overlay (CSS) covers the game.
// Pause the run, freeze the sim, and ignore all game input until it is upright again.
const rotateMq = typeof matchMedia === 'function'
  ? matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)')
  : null;
const isRotated = () => !!(rotateMq && rotateMq.matches);
if (rotateMq) {
  const onRotate = () => { if (rotateMq.matches) pause(); else lastFrame = performance.now(); };
  if (rotateMq.addEventListener) rotateMq.addEventListener('change', onRotate);
  else if (rotateMq.addListener) rotateMq.addListener(onRotate);
}

// Listen on the document so taps on the desktop letterbox also flick.
// In-run taps fire on pointerdown (lowest latency). The menu's tap-to-play fires on 'click'
// instead: starting the run on pointerdown would let that same tap's click land on the
// HUD pause button that appears under the finger.
document.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return; // left mouse / touch / pen only
  if (isRotated()) return;
  if (fromUi(e) || overlayOpen()) return;
  const r = router.current;
  if (r === 'playing') {
    e.preventDefault();
    game.tap();
  }
}, { passive: false });

/** True when the event started on a UI control. Uses the dispatch-time path, because a
 *  button handler may replace its own content (e.g. the sound icon) and detach e.target. */
function fromUi(e) {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
  for (const n of path) {
    if (n && n.nodeType === 1 && n.matches(NON_GAME)) return true;
  }
  return false;
}

// Capture phase: runs before any button handler can change the DOM under the pointer.
document.addEventListener('click', (e) => {
  if (router.current !== 'menu' || isRotated() || flowBusy) return;
  if (fromUi(e) || overlayOpen()) return;
  if (sinceRoute() < MENU_TAP_GRACE) return; // e.g. a double-tap on Back / Home
  if (performance.now() - lastModeSwitchAt < MODE_SWITCH_GRACE) return; // quick second tap near the chip
  startRun();
}, true);

// UI click feedback + drop focus after pointer clicks so Space/Enter keep driving the game.
stage.addEventListener('click', (e) => {
  // dispatch-time path: a handler may have replaced the element under the pointer (chip label)
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
  const b = path.find((n) => n && n.nodeType === 1 && n.tagName === 'BUTTON')
    || (e.target && e.target.closest && e.target.closest('button'));
  if (!b) return;
  sfx('click');
  haptic('tap');
  if (e.detail > 0) setTimeout(() => { if (document.activeElement === b) b.blur(); }, 0);
});

stage.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

document.addEventListener('keydown', (e) => {
  if (overlayOpen()) return; // dialogs / sheets handle their own keys
  if (isRotated()) return;
  const r = router.current;
  const isAction = e.code === 'Space' || e.key === ' ' || e.key === 'Enter';
  if (isAction) {
    if (r === 'playing') {
      e.preventDefault();
      if (!e.repeat) game.tap();
      return;
    }
    const b = e.target && e.target.closest && e.target.closest('button');
    if (b && isShown(b)) return; // keyboard users: let the focused button activate
    if (e.repeat) return;
    if (r === 'menu') { e.preventDefault(); startRun(); }
    else if (r === 'gameover') { e.preventDefault(); if (sinceRoute() >= GAMEOVER_GRACE) playAgain(); }
    else if (r === 'paused') { e.preventDefault(); resume(); }
    return;
  }
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (r === 'playing') { e.preventDefault(); pause(); }
    else if (r === 'paused') { e.preventDefault(); resume(); }
    else if (e.key === 'Escape' && (r === 'store' || r === 'settings')) { e.preventDefault(); app.back(); }
  }
});

// Auto-pause when the app goes to the background.
let lastFrame = performance.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    audio.suspend();
    mon.onPause();
  } else {
    if (!mon.isBusy()) audio.resume();
    lastFrame = performance.now();
    mon.onResume();
  }
});
window.addEventListener('blur', () => pause());
window.addEventListener('pagehide', () => pause());

// ---------------------------------------------------------------------------
// Resize (ResizeObserver + orientation + visual viewport) and DPR-crisp canvas
// ---------------------------------------------------------------------------
let lastSize = '';
function resize() {
  const r = stage.getBoundingClientRect();
  const w = r.width, hgt = r.height;
  if (!(w > 0 && hgt > 0)) return;
  const dpr = Math.min((window.devicePixelRatio || 1), CONFIG.view.maxDpr);
  const key = `${w}x${hgt}@${dpr}`;
  if (key === lastSize) return;
  lastSize = key;
  renderer.resize(w, hgt, dpr);
  game.setViewport(w, hgt);
}
if (typeof ResizeObserver === 'function') new ResizeObserver(() => resize()).observe(stage);
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Fixed-timestep loop: identical simulation speed at 60 / 90 / 120 / 144 Hz.
// ---------------------------------------------------------------------------
let acc = 0;
let errors = 0;
const isSimPaused = () => router.current === 'paused' || mon.isBusy() || isRotated();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (!(dt > 0)) dt = 0;
  dt = Math.min(dt, CONFIG.sim.maxFrameDt);
  try {
    const simPaused = isSimPaused();
    let alpha = 1;
    if (!simPaused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < CONFIG.sim.maxStepsPerFrame) {
        game.step(STEP);
        acc -= STEP;
        n++;
      }
      if (n === CONFIG.sim.maxStepsPerFrame) acc = 0;
      alpha = acc / STEP;
    }
    renderer.draw(alpha, simPaused ? 0 : dt);
    hud.update(game.hud());
    router.tick(now);
  } catch (err) {
    if (errors++ < 5) console.error('frame error', err);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Another tab / window changed the save (coins, purchases, equips): adopt it everywhere.
save.onExternalChange(() => {
  shop.refresh();
  audio.setEnabled(save.data.settings.sound);
  haptics.setEnabled(save.data.settings.haptics);
  renderer.setSkin(save.data.equipped.ball);
  renderer.setTheme(save.data.equipped.stadium);
  computeAim();
  applyThemeChrome();
  wallet.refresh();
  if (router.current === 'menu') {
    if (game.mode !== currentMode()) game.idle({ mode: currentMode() });
    menu.refresh();
  } else if (router.current === 'store' && store.refresh) store.refresh();
  else if (router.current === 'settings') settings.refresh();
});

function boot() {
  resize();
  renderer.setSkin(save.data.equipped.ball);
  renderer.setTheme(save.data.equipped.stadium);
  applyThemeChrome();
  game.idle({ mode: currentMode() });
  computeAim();
  router.show('menu');
  lastFrame = performance.now();
  requestAnimationFrame(frame);
  document.documentElement.classList.add('booted');
  window.__flickGoalBooted = true;
  setTimeout(() => { const b = $('#boot'); if (b) b.remove(); }, 600); // after the fade-out
  if (!save.persisted) console.info('Flick Goal: storage unavailable — progress will not be saved this session.');
  if (qa) {
    window.__fg = {
      game, shop, save, mon, router, renderer, audio, CONFIG, fmtNum, dev, hud, app,
      get aim() { return { ...aim }; },
      debugState: () => renderer.debugState(),
    };
  }
}

boot();
