// Flick Goal — art-style registry (V2_SPEC.md §3, §5.3).
// A style paints every scene (sky, decor, field for both layouts, posts, net, tee, coin, ball,
// effects) through the interface documented in V2_SPEC.md §5.3. The equipped stadium picks it.
//
// Registration hook: registerStyle(style) adds or replaces a style at runtime (tests, tools).
// Engineer B's pro style is src/engine/styles/pro/index.js (default export), imported here.

import retro from './retro/index.js';
import pro from './pro/index.js';

/** Every function a style must provide (checked by tests/style-contract.test.mjs). */
export const STYLE_FUNCTIONS = Object.freeze([
  'drawSky', 'drawBackground', 'drawField', 'drawNet', 'drawPostShadow', 'drawPost', 'drawTee',
  'drawCoin', 'drawTrail', 'drawBallShadow', 'drawBall', 'drawEffects', 'drawFront', 'drawFinish',
  'onFx', 'lightFor', 'previewBall',
]);

const registry = new Map([
  ['retro', retro],
  ['pro', pro],
]);

export const STYLE_IDS = Object.freeze(['retro', 'pro']);

/** Style object for an id ('retro' | 'pro'); unknown -> retro. */
export function getStyle(id) {
  return registry.get(id) || registry.get('retro');
}

/** Add / replace a style. Returns false (and changes nothing) when it misses interface functions. */
export function registerStyle(style) {
  if (!style || typeof style.id !== 'string') return false;
  for (const fn of STYLE_FUNCTIONS) if (typeof style[fn] !== 'function') return false;
  if (!style.balls || typeof style.balls !== 'object') return false;
  registry.set(style.id, style);
  return true;
}

/** Live view of every registered style (id -> style). */
export const STYLES = new Proxy({}, {
  get: (_, id) => registry.get(id),
  has: (_, id) => registry.has(id),
  ownKeys: () => Array.from(registry.keys()),
  getOwnPropertyDescriptor: (_, id) => (registry.has(id) ? { enumerable: true, configurable: true, value: registry.get(id) } : undefined),
});
