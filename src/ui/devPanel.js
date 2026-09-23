// Developer UI: hidden Settings unlock (tap the logo / version block 5x), the DEVELOPER settings
// section (start round stepper + quick chips; v2: mode switch, slider force, graphics quality,
// +10,000 coins, reset tutorial, tutorial read-out), "DEV · R<n>" badges on the menu and HUD, and
// the "DEV RUN" tag on Game Over. Everything is attached to the existing screens from outside.
// Does nothing at all when cfg.dev.enabled is false.

import { h, setText } from './dom.js';

const CHIPS = [1, 5, 10, 20, 30, 50, 75, 100];
const UNLOCK_TAPS = 5;
const TAP_GAP_MS = 1500; // taps further apart than this restart the count

const CSS = `
.dev-badge {
  position: absolute; left: calc(var(--sal) + 12px); z-index: 2;
  padding: 4px 10px; border-radius: 999px; background: rgba(12, 34, 64, .42);
  color: #FFD21F; font-size: 12px; font-weight: 900; letter-spacing: .06em; line-height: 1.2;
  text-shadow: 0 1px 0 rgba(0, 0, 0, .25); pointer-events: none; white-space: nowrap;
}
.dev-badge[hidden], .dev-section[hidden], .dev-go-tag[hidden] { display: none !important; }
.menu .dev-badge { top: calc(var(--sat) + 10px + 13px); }
.hud .dev-badge { top: calc(var(--sat) + 10px + 54px); }
.dev-go-tag {
  display: table; margin: 10px auto 0; padding: 3px 10px; border-radius: 999px;
  background: #EEF1F6; color: #7b849b; font-size: 12px; font-weight: 900; letter-spacing: .06em;
}
.dev-section { display: flex; flex-direction: column; gap: 8px; flex: none; }
.dev-head { font-size: 14px; font-weight: 900; letter-spacing: .14em; padding: 0 6px; text-shadow: 0 2px 0 rgba(0, 0, 0, .18); }
.dev-card { padding: 14px 14px 12px; color: var(--ink); }
.dev-row { display: flex; align-items: center; gap: 10px; }
.dev-row .set-label { font-size: 18px; font-weight: 900; }
.dev-stepper { display: flex; align-items: center; gap: 6px; flex: none; }
.dev-step, .dev-chip {
  border: 0; margin: 0; cursor: pointer; font-family: inherit; font-weight: 900; color: var(--ink);
  background: var(--soft); box-shadow: 0 3px 0 rgba(0, 0, 0, .12);
}
.dev-step { width: 44px; height: 44px; border-radius: 50%; font-size: 26px; line-height: 1; display: flex; align-items: center; justify-content: center; }
.dev-step:active, .dev-chip:active { transform: translateY(2px); box-shadow: 0 1px 0 rgba(0, 0, 0, .12); }
.dev-step:disabled { opacity: .4; cursor: default; }
.dev-val { min-width: 48px; text-align: center; font-size: 26px; font-weight: 900; color: var(--accent); font-variant-numeric: tabular-nums; }
.dev-chips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
.dev-chip { height: 44px; border-radius: 999px; font-size: 17px; }
.dev-chip.on { background: var(--green); color: #fff; box-shadow: 0 3px 0 rgba(0, 0, 0, .18); text-shadow: 0 1px 0 rgba(0, 0, 0, .18); }
.dev-note { margin-top: 10px; font-size: 12px; font-weight: 800; color: #7b849b; line-height: 1.35; }
.dev-sep { height: 2px; background: #f0f2f7; margin: 14px -14px 12px; }
.dev-sub { font-size: 13px; font-weight: 900; letter-spacing: .08em; color: #99a1b7; margin: 0 0 6px; }
.dev-seg { display: flex; gap: 6px; margin-bottom: 12px; }
.dev-seg .dev-chip { flex: 1; font-size: 14px; letter-spacing: .02em; }
.dev-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dev-btns .dev-chip { font-size: 15px; }
.dev-readout { margin-top: 10px; font-size: 13px; font-weight: 900; color: var(--ink); background: var(--soft); border-radius: 12px; padding: 8px 10px; font-variant-numeric: tabular-nums; }
/* The whole logo + version block is the unlock target: a 13px label alone is too small to hit
   5x in a row on a phone. manipulation stops fast taps being read as a double-tap zoom. */
.set-about { touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: default; user-select: none; -webkit-user-select: none; }
`;

function injectStyle() {
  if (document.getElementById('dev-panel-css')) return;
  const st = document.createElement('style');
  st.id = 'dev-panel-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/**
 * createDevPanel({ app, dev, game, router, screens: { menu, hud, gameover, settings } })
 * `dev` is the createDevState() instance from src/dev.js.
 */
export function createDevPanel({ app, dev, game, router, screens }) {
  if (!dev || !dev.available) return { sync() {} };
  injectStyle();
  const badgeText = (round) => `DEV · R${round}`;

  // ---- menu + HUD badges, Game Over tag
  const menuBadge = h('div.dev-badge', { attrs: { 'aria-label': 'Developer start round' } });
  const hudBadge = h('div.dev-badge', { attrs: { 'aria-label': 'Developer run' } });
  const goTag = h('div.dev-go-tag');
  menuBadge.hidden = hudBadge.hidden = goTag.hidden = true;
  screens.menu.el.appendChild(menuBadge);
  screens.hud.el.appendChild(hudBadge);
  const goCard = screens.gameover.el.querySelector('.go-card');
  if (goCard) goCard.appendChild(goTag);

  // ---- settings: DEVELOPER section
  const val = h('span.dev-val', '1');
  const minus = h('button.dev-step', { type: 'button', attrs: { 'aria-label': 'Previous round' }, onclick: () => dev.setStartRound(dev.storedRound() - 1) }, '−');
  const plus = h('button.dev-step', { type: 'button', attrs: { 'aria-label': 'Next round' }, onclick: () => dev.setStartRound(dev.storedRound() + 1) }, '+');
  const chips = CHIPS.map((n) => h('button.dev-chip', { type: 'button', dataset: { round: String(n) }, onclick: () => dev.setStartRound(n) }, String(n)));
  const note = h('div.dev-note');
  // v2 controls
  const seg = (name, options, onPick) => {
    const btns = options.map(([v, label]) => h('button.dev-chip', { type: 'button', dataset: { v, seg: name }, onclick: () => { onPick(v); sync(); } }, label));
    return { el: h('div.dev-seg', ...btns), btns };
  };
  const modeSeg = seg('mode', [['field', 'FIELD GOAL'], ['endless', 'ENDLESS']], (v) => app.setMode && app.setMode(v));
  const sliderSeg = seg('slider', [['default', 'DEFAULT'], ['on', 'ON'], ['off', 'OFF']], (v) => dev.setSliderForce(v));
  const gfxSeg = seg('gfx', [['auto', 'AUTO'], ['high', 'HIGH'], ['low', 'LOW']], (v) => dev.setGfx(v));
  const addCoins = h('button.dev-chip.dev-coins', { type: 'button', onclick: () => app.devAddCoins && app.devAddCoins(addCoins) }, '+10,000 coins');
  const resetTut = h('button.dev-chip.dev-reset-tut', { type: 'button', onclick: () => { if (app.devResetTutorial) app.devResetTutorial(); sync(); } }, 'Reset tutorial');
  const readout = h('div.dev-readout');
  const section = h('div.dev-section', { dataset: { noTap: '' } },
    h('div.dev-head', 'DEVELOPER'),
    h('div.set-card.dev-card',
      h('div.dev-row', h('span.set-label', 'Start round'), h('div.dev-stepper', minus, val, plus)),
      h('div.dev-chips', ...chips),
      note,
      h('div.dev-sep'),
      h('div.dev-sub', 'MODE'), modeSeg.el,
      h('div.dev-sub', 'AIM SLIDER'), sliderSeg.el,
      h('div.dev-sub', 'GRAPHICS (PRO STADIUMS)'), gfxSeg.el,
      h('div.dev-btns', addCoins, resetTut),
      readout));
  section.hidden = true;
  const body = screens.settings.el.querySelector('.settings-body');
  const about = body && body.querySelector('.set-about');
  if (body) body.insertBefore(section, about || null);

  // ---- hidden unlock: tap the logo/version block 5x. Counted on pointerup rather than click:
  // mobile browsers can drop the click for quick repeated taps on non-button elements.
  const target = screens.settings.el.querySelector('.set-about') || screens.settings.el.querySelector('.version');
  let taps = 0;
  let lastTap = 0;
  // The unlocking tap's own (synthesized) click arrives after the DEVELOPER section appeared and
  // shifted the layout: swallow clicks briefly so it can't land on a freshly revealed control.
  let swallowUntil = 0;
  screens.settings.el.addEventListener('click', (e) => {
    if (performance.now() < swallowUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  if (target) {
    target.addEventListener('pointerup', (e) => {
      if (e.button > 0) return;
      const now = performance.now();
      taps = now - lastTap > TAP_GAP_MS ? 1 : taps + 1;
      lastTap = now;
      if (taps < UNLOCK_TAPS) {
        const left = UNLOCK_TAPS - taps;
        if (taps >= 2) app.dialogs.toast(`${left} more tap${left === 1 ? '' : 's'}…`, { kind: 'info' });
        return;
      }
      taps = 0;
      swallowUntil = performance.now() + 450;
      const on = dev.toggle();
      app.sfx('click');
      app.dialogs.toast(on ? 'Developer mode ON' : 'Developer mode OFF', { kind: on ? 'ok' : 'info' });
    });
  }

  function sync() {
    const on = dev.enabled();
    const r = dev.storedRound();
    section.hidden = !on;
    setText(val, String(r));
    minus.disabled = r <= 1;
    plus.disabled = r >= dev.maxRound;
    for (const c of chips) c.classList.toggle('on', Number(c.dataset.round) === r);
    const curMode = app.currentMode ? app.currentMode() : 'field';
    for (const b of modeSeg.btns) b.classList.toggle('on', b.dataset.v === curMode);
    for (const b of sliderSeg.btns) b.classList.toggle('on', b.dataset.v === dev.storedSlider());
    for (const b of gfxSeg.btns) b.classList.toggle('on', b.dataset.v === dev.storedGfx());
    if (app.aimReadout) setText(readout, app.aimReadout());
    setText(note, r > 1
      ? `Runs start at kick #${r}, as if ${r - 1} goal${r === 2 ? ' was' : 's were'} made. Dev runs never change Best. Tap the version 5x to turn developer mode off.`
      : 'Round 1 = normal game. Tap the version 5x to turn developer mode off.');

    const menuRound = dev.startRound();
    menuBadge.hidden = !(menuRound > 1);
    if (menuRound > 1) setText(menuBadge, badgeText(menuRound));

    const sm = game.startMade | 0;
    hudBadge.hidden = !(sm > 0);
    if (sm > 0) setText(hudBadge, badgeText(sm + 1));

    const res = router.current === 'gameover' ? app.lastResult() : null;
    const rs = res ? res.startMade | 0 : 0;
    goTag.hidden = !(rs > 0);
    if (rs > 0) setText(goTag, `DEV RUN · started R${rs + 1}`);
  }

  dev.onChange(sync);
  router.onChange(sync);
  game.on('runStart', sync);
  game.on('flick', sync);
  game.on('modeChange', sync);
  sync();
  return { sync };
}
