// Tiny DOM helpers shared by every UI module. No framework, no globals.

/**
 * Hyperscript: h('button.btn.round', { onclick, dataset: {x: 1}, html: '<svg…>' }, child, 'text')
 * - tag may carry `#id` and `.class` suffixes
 * - props: `class`, `style` (string or object), `dataset`, `html` (innerHTML, trusted strings only),
 *   `text`, `on*` handlers, `attrs` (raw attributes); anything else is set as a property/attribute.
 * - children: nodes, strings, numbers, arrays, null/false (skipped)
 */
export function h(tag, props, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  if (m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '#') el.id = part.slice(1);
      else el.classList.add(part.slice(1));
    }
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText += v;
        else for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'attrs') for (const [ak, av] of Object.entries(v)) el.setAttribute(ak, av === true ? '' : av);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Set textContent only when it changed (avoids layout churn in per-frame updates). */
export function setText(el, text) {
  const s = String(text);
  if (el.textContent !== s) el.textContent = s;
}

/** 1234 -> "1,234" */
export function fmtNum(n) {
  return Math.max(0, Math.floor(Number(n) || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Milliseconds -> "h:mm:ss" (or "m:ss" under an hour). */
export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p2 = (x) => String(x).padStart(2, '0');
  return hh > 0 ? `${hh}:${p2(mm)}:${p2(ss)}` : `${mm}:${p2(ss)}`;
}

/**
 * Restart a CSS animation class on an element (e.g. 'bump', 'shake').
 * Removing + forcing reflow + re-adding replays the keyframes.
 */
export function replayClass(el, cls, ms = 600) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // reflow
  el.classList.add(cls);
  clearTimeout(el['_t_' + cls]);
  el['_t_' + cls] = setTimeout(() => el.classList.remove(cls), ms);
}

/** Center of an element in coordinates relative to `root` (the #stage). */
export function centerIn(el, root) {
  const r = el.getBoundingClientRect();
  const s = root.getBoundingClientRect();
  return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
}

/** True when the element is rendered (not display:none up the tree). */
export function isShown(el) {
  return !!el && el.isConnected && el.getClientRects().length > 0;
}

/**
 * Create a DPR-crisp canvas of css size w x h. Returns {canvas, ctx, dpr}.
 * The ctx transform is set so callers draw in css px.
 */
export function dprCanvas(w, h, maxDpr = 3) {
  const dpr = Math.min((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1, maxDpr);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx, dpr };
}

/** Darken/lighten a #rrggbb color by factor f (<1 darker, >1 lighter). */
export function shade(hex, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v) => {
    const out = f < 1 ? v * f : v + (255 - v) * (f - 1);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
