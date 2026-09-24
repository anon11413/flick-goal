// In-DOM dialogs and toasts. The game never uses window.alert / confirm / prompt.

import { h, fmtNum } from './dom.js';
import { icon } from './icons.js';

/**
 * createDialogs({root, onClick}) -> { confirmDialog, toast, rewardPopup, isOpen }
 * root: overlay container inside #stage. onClick: called on every dialog button press (sfx/haptic).
 */
export function createDialogs({ root, onClick = () => {} } = {}) {
  let openCount = 0;
  let toastEl = null;
  let toastTimer = 0;

  function trapFocus(container, e) {
    if (e.key !== 'Tab') return;
    const f = Array.from(container.querySelectorAll('button:not([disabled])'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!container.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }

  /** Generic modal shell; `build(close)` returns the card content. Resolves with close(value). */
  function modal({ className = '', label = 'Dialog', build, cancelValue = false, initialFocus }) {
    return new Promise((resolve) => {
      openCount++;
      const prevFocus = document.activeElement;
      let done = false;
      const close = (value) => {
        if (done) return;
        done = true;
        wrap.classList.remove('in');
        wrap.classList.add('out');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(() => {
          wrap.remove();
          openCount = Math.max(0, openCount - 1);
          if (prevFocus && prevFocus.focus && prevFocus.isConnected) {
            try { prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
          }
          resolve(value);
        }, 170);
      };
      const card = h('div.dialog' + (className ? '.' + className : ''), {
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
      });
      const content = build(close, card);
      if (content) card.appendChild(content);
      const wrap = h('div.modal', { dataset: { noTap: '' } }, card);
      wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(cancelValue); });
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelValue); }
        else trapFocus(card, e);
      }
      document.addEventListener('keydown', onKey, true);
      root.appendChild(wrap);
      requestAnimationFrame(() => wrap.classList.add('in'));
      const focusEl = (initialFocus && initialFocus(card)) || card.querySelector('button');
      if (focusEl) setTimeout(() => { try { focusEl.focus({ preventScroll: true }); } catch { /* ignore */ } }, 30);
    });
  }

  /** confirmDialog({title, message, okText, cancelText (null = OK only), danger}) -> Promise<boolean> */
  function confirmDialog({ title = 'Are you sure?', message = '', okText = 'OK', cancelText = 'Cancel', danger = false, iconName = null, iconHtml = null } = {}) {
    return modal({
      label: title,
      className: danger ? 'danger' : '',
      build: (close) => {
        const ok = h('button.btn.pill' + (danger ? '.red' : '.green'), { type: 'button', onclick: () => { onClick(); close(true); } }, okText);
        // cancelText: null -> a single-button notice (OK only)
        const cancel = cancelText == null ? null : h('button.btn.pill.white', { type: 'button', onclick: () => { onClick(); close(false); } }, cancelText);
        return h('div.dialog-body',
          iconHtml || iconName ? h('div.dialog-icon', { html: iconHtml || icon(iconName) }) : null,
          h('div.dialog-title', title),
          message ? h('div.dialog-msg', message) : null,
          h('div.dialog-actions', cancel, ok));
      },
      initialFocus: (card) => card.querySelector(danger ? '.btn.white' : '.btn.green'),
    });
  }

  /**
   * Reward popup: big "+35" with a coin and a COLLECT button.
   * Resolves with the stage-relative center of the coin icon (for a coin-fly origin).
   */
  function rewardPopup({ title = 'FREE GIFT!', amount = 0, subtitle = '', iconName = 'gift', stage } = {}) {
    let coinEl = null;
    return modal({
      label: title,
      className: 'reward',
      cancelValue: null,
      build: (close) => {
        coinEl = h('span.reward-coin', { html: icon('coin') });
        const collect = h('button.btn.pill.gold.big', {
          type: 'button',
          onclick: () => { onClick(); close(centerOf(coinEl, stage)); },
        }, 'COLLECT');
        return h('div.dialog-body',
          h('div.reward-rays'),
          h('div.dialog-icon.bounce', { html: icon(iconName) }),
          h('div.dialog-title', title),
          h('div.reward-amount', coinEl, h('span', '+' + fmtNum(amount))),
          subtitle ? h('div.dialog-msg', subtitle) : null,
          h('div.dialog-actions', collect));
      },
    }).then((pos) => pos || centerOf(coinEl, stage));
  }

  function centerOf(el, stage) {
    if (!el || !stage || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
  }

  /** toast(text, {ms, action: {label, onClick}, kind: 'info'|'warn'|'ok'}) */
  function toast(text, { ms = 1800, action = null, kind = 'info' } = {}) {
    if (toastEl) {
      const old = toastEl;
      old.classList.remove('in');
      setTimeout(() => old.remove(), 200);
    }
    clearTimeout(toastTimer);
    const btn = action
      ? h('button.toast-action', {
        type: 'button',
        onclick: () => { onClick(); hide(); try { action.onClick(); } catch (e) { console.error(e); } },
      }, action.label)
      : null;
    const el = h('div.toast.' + kind, { attrs: { role: 'status', 'aria-live': 'polite' }, dataset: { noTap: '' } },
      h('span', text), btn);
    toastEl = el;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    function hide() {
      if (toastEl !== el) return;
      el.classList.remove('in');
      toastEl = null;
      setTimeout(() => el.remove(), 220);
    }
    toastTimer = setTimeout(hide, action ? Math.max(ms, 3200) : ms);
    return hide;
  }

  return {
    confirmDialog,
    rewardPopup,
    toast,
    isOpen: () => openCount > 0,
  };
}
