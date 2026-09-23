// In-run HUD: big score, shot clock bar, pause button, coin pill, popups, first-shot hint.
// update(hud) runs every frame but only touches the DOM when a value actually changed.

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
  const hint = h('div.hud-hint', h('span.hud-hint-dot'), 'TAP when the marker is in the ', h('b', 'GREEN'));

  const el = h('section.screen.hud', { dataset: { screen: 'hud' } },
    h('div.topbar', pauseBtn, h('div.topbar-mid'), pill.el),
    h('div.hud-center', score, clock),
    hint);

  let lastScore = -1;
  let lastClock = -1;
  let lastState = '';

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
    fx.popText('+' + e.points, sp.x + Math.max(44, score.offsetWidth / 2 + 26), sp.y - 6, 'plus');
  }

  function onClockLow() {
    replayClass(clock, 'shake', 400);
  }

  function showHint(v) {
    el.classList.toggle('show-hint', !!v);
  }

  function reset() {
    lastScore = -1;
    lastClock = -1;
    lastState = '';
    showHint(false);
  }

  return { el, pill, update, onScore, onClockLow, showHint, reset };
}
