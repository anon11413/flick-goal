// In-run HUD: big score, shot clock bar, ENDLESS distance pill, pause button, coin pill, popups,
// first-shot aim hints. update(hud) runs every frame but only touches the DOM when a value changed.

import { h, setText, fmtNum, replayClass, centerIn } from './dom.js';
import { icon } from './icons.js';

/** Reusable coin counter pill (menu, HUD, game over, store). */
export function createCoinPill({ onClick } = {}) {
  const num = h('span.coin-num', '0');
  const el = h(onClick ? 'button.coin-pill' : 'div.coin-pill',
    onClick ? { type: 'button', onclick: onClick, attrs: { 'aria-label': 'Coins' } } : { attrs: { 'aria-label': 'Coins' } },
    h('span.coin-ic', { html: icon('coin') }),
    num,
    onClick ? h('span.coin-plus', '+') : null);
  let value = -1;
  return {
    el,
    /** The coin icon inside the pill is the coin-fly target. */
    target: el.querySelector('.coin-ic'),
    set(n) {
      if (n === value) return;
      value = n;
      setText(num, fmtNum(n));
    },
    bump() { replayClass(el, 'bump', 320); },
  };
}

export function createHud({ stage, fx, onPause, onCoinPill }) {
  const score = h('div.hud-score', '0');
  const clockFill = h('i');
  const clock = h('div.hud-clock', clockFill);
  const pauseBtn = h('button.btn.round.sm.hud-pause', {
    type: 'button', html: icon('pause'), onclick: onPause, attrs: { 'aria-label': 'Pause' },
  });
  const pill = createCoinPill({ onClick: onCoinPill });
  // ENDLESS: running distance ("140 YDS") under the clock
  const distNum = h('span.hud-dist-num', '0');
  const dist = h('div.hud-dist', { attrs: { 'aria-label': 'Distance' } },
    h('span.hud-dist-ic', { html: icon('flag') }), distNum, h('span.hud-dist-unit', 'YDS'));
  dist.hidden = true;
  // First-shot aim hints (V2_SPEC §6.4): one element, three variants swapped by data-kind.
  //  rail: slider tutorial / upgrade   fade: the slider is fading, use the dots   dots: dots only
  const hintRail = h('span.hint-v.hint-rail', h('span.hud-hint-dot'), h('span', 'TAP when the marker is in the ', h('b', 'GREEN')));
  const dotsGlyph = () => h('span.hud-hint-dots', h('i'), h('i'), h('i'));
  const hintFade = h('span.hint-v.hint-fade', dotsGlyph(),
    h('span.hud-hint-text', h('b', 'Now aim with the dots'), h('small', 'Evenly spaced = right power')));
  const hintDots = h('span.hint-v.hint-dots', dotsGlyph(),
    h('span.hud-hint-text', h('b', 'TAP when the dots are evenly spaced'),
      h('small', 'Bunched = too weak · stretched = too strong')));
  const hint = h('div.hud-hint', { dataset: { kind: 'rail' }, attrs: { 'aria-live': 'polite' } }, hintRail, hintFade, hintDots);

  const el = h('section.screen.hud', { dataset: { screen: 'hud', mode: 'field' } },
    h('div.topbar', pauseBtn, h('div.topbar-mid'), pill.el),
    h('div.hud-center', score, clock, dist),
    hint);

  let lastScore = -1;
  let lastClock = -1;
  let lastState = '';
  let mode = 'field';
  let yardsShown = -1;
  let yardsTarget = 0;
  let yardsFrom = 0;
  let yardsT0 = 0;

  function update(s) {
    if (!s) return;
    if (s.score !== lastScore) {
      lastScore = s.score;
      setText(score, s.score);
    }
    // Clock: full during intro, live in aim, dimmed while the ball is in the air / run is over.
    let v = 1, state = 'idle';
    if (s.phase === 'intro') { v = 1; state = 'intro'; }
    else if (s.phase === 'aim') { v = s.clock01; state = s.clock01 < 0.25 ? 'low' : s.clock01 < 0.5 ? 'mid' : 'aim'; }
    else if (s.phase === 'fly' || s.phase === 'settle') { v = lastClock < 0 ? 1 : lastClock; state = 'fly'; }
    else if (s.phase === 'miss' || s.phase === 'over') { v = s.clock01 > 0 ? (lastClock < 0 ? 1 : lastClock) : 0; state = 'fly'; }
    v = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
    if (Math.abs(v - lastClock) > 0.002) {
      lastClock = v;
      clockFill.style.transform = `scaleX(${v.toFixed(4)})`;
    }
    if (state !== lastState) {
      lastState = state;
      clock.dataset.state = state;
    }
    if (mode === 'endless') updateDist(s.yards | 0);
  }

  /** Distance pill: counts up over 400 ms when the yards change, with a bump. */
  function updateDist(yards) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (yards !== yardsTarget) {
      yardsFrom = yardsShown < 0 ? yards : yardsShown;
      yardsTarget = yards;
      yardsT0 = now;
      if (yards > yardsFrom) replayClass(dist, 'bump', 360);
    }
    const u = Math.min(1, (now - yardsT0) / 400);
    const e = 1 - Math.pow(1 - u, 3);
    const v = Math.round(yardsFrom + (yardsTarget - yardsFrom) * e);
    if (v !== yardsShown) {
      yardsShown = v;
      setText(distNum, fmtNum(v));
    }
  }

  /** 'field' | 'endless': the distance pill only shows in ENDLESS. */
  function setMode(m) {
    mode = m === 'endless' ? 'endless' : 'field';
    el.dataset.mode = mode;
    dist.hidden = mode !== 'endless';
    yardsShown = -1;
    yardsTarget = 0;
    yardsFrom = 0;
    setText(distNum, '0');
  }

  function scorePos() {
    const p = centerIn(score, stage);
    return p;
  }

  /** Popups for a `score` engine event. */
  function onScore(e) {
    replayClass(score, 'pop', 360);
    const sp = scorePos();
    const w = stage.clientWidth;
    const midY = Math.max(sp.y + 110, stage.clientHeight * 0.3);
    if (e.perfect) {
      fx.popText('PERFECT!', w / 2, midY, 'perfect');
      // Show the multiplier actually applied (points are capped at scoring.perfectMaxPoints).
      if (e.streak >= 2 && e.points >= 2) setTimeout(() => fx.popText('x' + e.points, w / 2, midY + 46, 'streak'), 120);
    } else if (e.doink) {
      fx.popText('DOINK!', w / 2, midY, 'doink');
    }
    // "+N" beside the score, clear of the coin pill; on narrow screens (360 px) it goes under it
    const text = '+' + e.points;
    const halfW = 11 * text.length; // ~30 px bold digits
    let px = sp.x + Math.max(44, score.offsetWidth / 2 + 26);
    let py = sp.y - 6;
    const sr = stage.getBoundingClientRect();
    const pr = pill.el.getBoundingClientRect();
    const pillLeft = pr.width > 0 ? pr.left - sr.left : w;
    const pillBottom = pr.height > 0 ? pr.bottom - sr.top : 0;
    if (px + halfW + 8 > pillLeft && py - 18 < pillBottom) {
      px = sp.x;
      py = sp.y + score.offsetHeight / 2 + 14;
    }
    fx.popText(text, px, py, 'plus');
  }

  function onClockLow() {
    replayClass(clock, 'shake', 400);
  }

  /** kind: 'rail' | 'fade' | 'dots' to show that hint; null / false hides it. */
  function showHint(kind) {
    if (kind === true) kind = 'dots';
    if (kind === 'rail' || kind === 'fade' || kind === 'dots') {
      hint.dataset.kind = kind;
      el.classList.add('show-hint');
    } else {
      el.classList.remove('show-hint');
    }
  }

  function reset() {
    lastScore = -1;
    lastClock = -1;
    lastState = '';
    showHint(null);
  }

  return {
    el, pill, update, onScore, onClockLow, showHint, reset, setMode,
    get hintKind() { return el.classList.contains('show-hint') ? hint.dataset.kind : null; },
  };
}
