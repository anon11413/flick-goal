// DOM juice layered above the canvas: coin fly-to-counter, floating text, confetti bursts.
// Uses the Web Animations API when present (with timeout fallbacks, never awaiting .finished
// so a cancelled animation can't produce an unhandled rejection).

import { h, centerIn, isShown } from './dom.js';
import { icon } from './icons.js';

const CONFETTI = ['#FFC83D', '#FF5A5F', '#39D98A', '#4FC3F7', '#FF8A3D', '#B388FF', '#ffffff'];

export function createFx({ layer, stage }) {
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function run(el, keyframes, opts, done) {
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      el.remove();
      if (done) done();
    };
    if (canAnimate && !reduced) {
      try {
        const a = el.animate(keyframes, { fill: 'both', ...opts });
        a.onfinish = end;
        a.oncancel = end;
      } catch {
        /* fall through to timeout */
      }
    }
    setTimeout(end, (opts.duration || 0) + (opts.delay || 0) + 120);
  }

  /**
   * Fly `count` coins from stage point `from` to the element `target`.
   * onEach(i) is called as each coin lands; onDone() once after the last one (always called).
   */
  function coinFly({ from, target, count = 1, onEach, onDone }) {
    const n = Math.max(1, Math.min(8, Math.round(count)));
    if (!from || !target || !isShown(target)) {
      for (let i = 0; i < n; i++) if (onEach) onEach(i);
      if (onDone) onDone();
      return;
    }
    const to = centerIn(target, stage);
    let landed = 0;
    for (let i = 0; i < n; i++) {
      const el = h('div.fly-coin', { html: icon('coin') });
      el.style.left = from.x + 'px';
      el.style.top = from.y + 'px';
      layer.appendChild(el);
      const ang = Math.random() * Math.PI * 2;
      const spread = n > 1 ? 18 + Math.random() * 26 : 0;
      const mx = Math.cos(ang) * spread, my = Math.sin(ang) * spread - 14;
      const dx = to.x - from.x, dy = to.y - from.y;
      run(el, [
        { transform: 'translate(-50%,-50%) translate(0px,0px) scale(.4)', opacity: 0.2, offset: 0 },
        { transform: `translate(-50%,-50%) translate(${mx}px,${my}px) scale(1.15)`, opacity: 1, offset: 0.28 },
        { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(.7)`, opacity: 1, offset: 1 },
      ], { duration: 520, delay: i * 55, easing: 'cubic-bezier(.55,0,.75,.2)' }, () => {
        landed++;
        if (onEach) onEach(i);
        if (landed === n && onDone) onDone();
      });
    }
  }

  /** Floating text at a stage point, e.g. "+3" or "PERFECT!". cls adds a style variant. */
  function popText(text, x, y, cls = '') {
    const el = h('div.pop-text' + (cls ? '.' + cls.split(' ').join('.') : ''), text);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    layer.appendChild(el);
    run(el, [
      { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%,-60%) scale(1)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%,-140%) scale(.95)', opacity: 0 },
    ], { duration: 950, easing: 'ease-out' });
  }

  /** Flat confetti burst from a stage point. */
  function confetti(x, y, n = 28, power = 1) {
    if (reduced) return;
    for (let i = 0; i < n; i++) {
      const el = h('div.confetti');
      const w = 6 + Math.random() * 6;
      el.style.width = w + 'px';
      el.style.height = w * (0.4 + Math.random() * 0.4) + 'px';
      el.style.background = CONFETTI[i % CONFETTI.length];
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      layer.appendChild(el);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const v = (90 + Math.random() * 150) * power;
      const dx = Math.cos(a) * v, dy = Math.sin(a) * v;
      const rot = (Math.random() - 0.5) * 900;
      run(el, [
        { transform: 'translate(0px,0px) translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) translate(-50%,-50%) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx * 1.25}px,${dy + 180}px) translate(-50%,-50%) rotate(${rot}deg)`, opacity: 0 },
      ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)' });
    }
  }

  /** Confetti burst from the center of an element. */
  function confettiAt(el, n, power) {
    if (!isShown(el)) return;
    const p = centerIn(el, stage);
    confetti(p.x, p.y, n, power);
  }

  return { coinFly, popText, confetti, confettiAt };
}
