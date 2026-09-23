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

const STEP = 1 / CONFIG.sim.hz;
const params = new URLSearchParams(location.search);
const debug = CONFIG.debug || params.get('debug') === '1';
const qa = debug || params.has('qa') || params.has('smoke');
// QA switch: ?ads=off previews the game exactly as it runs with monetization.mode = 'off'.
// (Remove or gate this before real ad SDKs ship.)
const monCfg = params.get('ads') === 'off'
  ? { ...CONFIG, monetization: { ...CONFIG.monetization, mode: 'off' } }
  : CONFIG;
// Developer "start round" (?round=N, ?dev=1, Settings version 5x tap); inert when cfg.dev.enabled is false.
const dev = createDevState({ cfg: CONFIG, search: location.search });

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
const mon = createMonetization({ cfg: monCfg, shop, root: overlay });
const dialogs = createDialogs({ root: overlay, onClick: () => haptics.pulse('tap') });
const fx = createFx({ layer: fxLayer, stage });

const game = createGame({ cfg: CONFIG });
const renderer = createRenderer(canvas, game, { cfg: CONFIG, debug });

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
let run = { bestAtRunStart: 0, result: null };
let showHintThisRun = false;
// With the rail hidden the aim cue is new even to veterans: teach the guide once per page load.
let guideHintShown = false;
let storeReturn = 'menu';
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
  resetProgress,

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
let routeAt = performance.now();
router.onChange(() => { routeAt = performance.now(); });
/** ms since the current route was shown (input grace periods). */
function sinceRoute() { return performance.now() - routeAt; }
const MENU_TAP_GRACE = 300;     // ms: taps right after arriving on the menu don't start a run
const GAMEOVER_GRACE = 650;     // ms: Game Over buttons / Space ignore input while the card pops in

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function startRun() {
  if (flowBusy) return;
  sfx('whoosh');
  haptic('tap');
  game.newRun({ startMade: dev.startMade() });
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

function recordBest(score) {
  if (isDevRun(game.hud())) return; // dev start-round runs never touch Best
  if (score > save.data.best) save.update((d) => { d.best = score; });
}

function quitToMenu() {
  if (router.current !== 'paused') return;
  recordBest(game.hud().score);
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
    dialogs.toast('Watch the full video to continue', { kind: 'warn' });
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
    dialogs.toast('Watch the full video to double your coins', { kind: 'warn' });
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

async function buyNoAds() {
  if (flowBusy) return;
  flowBusy = true;
  try {
    const r = await mon.iap.purchase('no_ads');
    if (r.ok) {
      sfx('buy');
      haptic('buy');
      fx.confetti(stage.clientWidth / 2, stage.clientHeight * 0.4, 44, 1.1);
      dialogs.toast('Ads removed — thank you!', { kind: 'ok' });
    } else if (r.error === 'already_owned') {
      dialogs.toast('No Ads is already active');
    }
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
    if (r.ok && r.restored.length) dialogs.toast('Purchases restored: No Ads', { kind: 'ok' });
    else dialogs.toast(r.ok ? 'Nothing to restore' : 'Restore failed', { kind: r.ok ? 'info' : 'warn' });
  } finally {
    flowBusy = false;
  }
}

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
game.on('runStart', () => {
  run = { bestAtRunStart: save.data.best, result: null };
  runCoins.reset();
  save.update((d) => { d.stats.gamesPlayed += 1; });
  showHintThisRun = save.data.stats.totalGoals < 3 || (!CONFIG.rail.visible && !guideHintShown);
  hud.reset();
  tier = 0;
  applyThemeChrome();
});

game.on('shotStart', (e) => {
  // First shot of a normal run only. A dev start-round run begins at made > 0 (like a natural
  // run at that point), so it neither shows nor uses up the once-per-load guide hint.
  const show = showHintThisRun && e.made === 0;
  if (show) guideHintShown = true;
  hud.showHint(show);
});

game.on('flick', () => {
  hud.showHint(false);
  sfx('flick');
  haptic('flick');
});

game.on('bounce', (e) => {
  if (e.kind === 'ground') {
    if ((e.impact || 0) > 140) sfx('thud');
  } else {
    sfx('bounce');
    haptic('tap');
  }
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
  hud.showHint(false);
});

game.on('gameover', (e) => {
  const devRun = isDevRun(e); // dev start-round run: no Best update, no NEW BEST
  const newBest = !devRun && e.score > run.bestAtRunStart && e.score > 0;
  save.update((d) => {
    d.best = nextBest(d.best, e);
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
    best: save.data.best,
    newBest,
    startMade: e.startMade | 0,
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
  startRun();
}, true);

// UI click feedback + drop focus after pointer clicks so Space/Enter keep driving the game.
stage.addEventListener('click', (e) => {
  const b = e.target && e.target.closest && e.target.closest('button');
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
  } else {
    audio.resume();
    lastFrame = performance.now();
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
  applyThemeChrome();
  wallet.refresh();
  if (router.current === 'menu') menu.refresh();
  else if (router.current === 'store' && store.refresh) store.refresh();
});

function boot() {
  resize();
  renderer.setSkin(save.data.equipped.ball);
  renderer.setTheme(save.data.equipped.stadium);
  applyThemeChrome();
  game.idle();
  router.show('menu');
  lastFrame = performance.now();
  requestAnimationFrame(frame);
  document.documentElement.classList.add('booted');
  window.__flickGoalBooted = true;
  setTimeout(() => { const b = $('#boot'); if (b) b.remove(); }, 600); // after the fade-out
  if (!save.persisted) console.info('Flick Goal: storage unavailable — progress will not be saved this session.');
  if (qa) {
    window.__fg = { game, shop, save, mon, router, renderer, audio, CONFIG, fmtNum, dev };
  }
}

boot();
