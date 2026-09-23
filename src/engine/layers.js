// Flick Goal — offscreen layer cache for static scenery (ported from try/pro-graphics render.js).
//
// A style paints static scenery (stands, towers, mountains, crowd strips, turf tiles...) through
// layers.layer(c, key, w, h, draw, x, y): draw(c, pal) paints a w x h tile at the origin once per
// (key, palette, size); later frames just blit it. Semantics (V2_SPEC §5.5):
//  * entries keyed by layer key -> palette key -> size slot; keys must be prefixed by the style
//    id ('pro:stands') so styles never collide;
//  * during a tier change the old and new palette layers cross-dissolve (one blit swap in low);
//  * NEVER builds while the ball is in flight / settling when an older layer can stand in;
//    prewarm() builds at most one missing layer per ~0.1 s in calm phases (idle, intro, miss,
//    over; never aim, never flight), incl. the next tier and the dev warm tier;
//  * finished canvases are promoted to ImageBitmaps and uploaded once off-screen (touchPending);
//  * eviction past MAX_LAYERS entries; clear() on theme / size / quality change;
//  * stats: { built, inFlight } (layers built while in flight: must stay 0).
// directLayers(pal) is the non-caching variant (store previews, tests): it paints straight onto
// the target inside a clipped translate.

import { memo } from './paint.js';

export const MAX_LAYERS = 90;
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

/** Default offscreen canvas factory (null when no canvas implementation exists). */
export function defaultMakeCanvas(w, h) {
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch (_) { /* fall through */ }
  return null;
}

/**
 * createLayers({ makeCanvas, getScale, getPhase, getPalState, viewSize, promoteBitmaps, debug })
 *  - makeCanvas(w, h) -> canvas | null
 *  - getScale() -> backing scale for layer canvases (min(dpr, 2); 1 in the low tier)
 *  - getPhase() -> world.phase
 *  - getPalState() -> { from, to, keyFrom, keyTo, t (crossfade 0..1), lowQ }
 *  - viewSize() -> { w, h } css px (off-screen blits are skipped)
 */
export function createLayers({
  makeCanvas = defaultMakeCanvas, getScale = () => 1, getPhase = () => 'idle', getPalState,
  viewSize = () => ({ w: 1e9, h: 1e9 }), promoteBitmaps = true, debug = false,
} = {}) {
  const layers = new Map();
  const order = [];
  const lastUsed = new Map();
  const toTouch = [];
  const stats = { built: 0, inFlight: 0, maxBuildMs: 0 };
  const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let warmT = 0;

  const inFlight = () => { const p = getPhase(); return p === 'fly' || p === 'settle'; };
  const calm = () => { const p = getPhase(); return p === 'idle' || p === 'intro' || p === 'miss' || p === 'over'; };
  const slotOf = (w, h) => memo('slot', w, h, 0, () => `${w}x${h}`);

  function promote(entry) {
    if (!promoteBitmaps || typeof createImageBitmap !== 'function') return;
    try {
      createImageBitmap(entry.img).then((bm) => {
        if (entry.dead) { if (bm.close) bm.close(); return; }
        entry.img = bm;
        toTouch.push(entry);
        if (toTouch.length > 16) toTouch.shift();
      }).catch(() => { /* keep the canvas */ });
    } catch (_) { /* keep the canvas */ }
  }
  function retire(entry) {
    if (!entry) return;
    entry.dead = true;
    if (entry.img && typeof entry.img.close === 'function') {
      try { entry.img.close(); } catch (_) { /* ignore */ }
    }
  }
  function slotMap(key, pk, create) {
    let byPk = layers.get(key);
    if (!byPk) {
      if (!create) return null;
      byPk = new Map();
      layers.set(key, byPk);
    }
    let bySlot = byPk.get(pk);
    if (!bySlot) {
      if (!create) return null;
      bySlot = new Map();
      byPk.set(pk, bySlot);
    }
    return bySlot;
  }
  function hasLayer(key, pk, w, h) {
    const m = slotMap(key, pk, false);
    return !!m && m.has(slotOf(w, h));
  }
  function getEntry(key, pk, pal, w, h, draw, build = true) {
    const slot = slotOf(w, h);
    const m = slotMap(key, pk, true);
    let e = m.get(slot);
    if (e === undefined) {
      if (!build) return null;
      const s = getScale();
      e = false;
      const cv = makeCanvas(Math.max(1, Math.ceil(w * s)), Math.max(1, Math.ceil(h * s)));
      if (cv) {
        try {
          const t0 = clock();
          const c = cv.getContext('2d');
          c.scale(s, s);
          draw(c, pal);
          stats.maxBuildMs = Math.max(stats.maxBuildMs, clock() - t0);
          e = { img: cv, dead: false };
          stats.built++;
          if (inFlight()) stats.inFlight++;
          promote(e);
        } catch (err) {
          if (debug) console.warn('[flick-goal] layer failed', key, err);
          e = false;
        }
      }
      m.set(slot, e);
      order.push([key, pk, slot]);
      if (order.length > MAX_LAYERS) {
        const [k0, p0, s0] = order.shift();
        const m0 = slotMap(k0, p0, false);
        if (m0) {
          retire(m0.get(s0));
          m0.delete(s0);
        }
      }
    }
    return e || null;
  }
  function getLayer(key, pk, pal, w, h, draw, build = true) {
    const e = getEntry(key, pk, pal, w, h, draw, build);
    return e ? e.img : null;
  }

  /** Blit (building if needed) the cached layer `key` at (x, y), size w x h css px. */
  function layer(c, key, w, h, draw, x, y) {
    if (!(w > 0 && h > 0)) return;
    const P = getPalState();
    let byKey = lastUsed.get(key);
    if (!byKey) { byKey = new Map(); lastUsed.set(key, byKey); }
    const slot = slotOf(w, h);
    let rec = byKey.get(slot);
    if (rec) rec.draw = draw;
    else {
      rec = { key, w, h, draw, shown: null };
      byKey.set(slot, rec);
    }
    const vs = viewSize();
    if (x > vs.w + 2 || y > vs.h + 2 || x + w < -2 || y + h < -2 || !(c.globalAlpha > 0.004)) return;
    const fading = P.t < 1 && P.keyFrom !== P.keyTo;
    const eA = getEntry(key, P.keyTo, P.to, w, h, draw, !inFlight());
    let A = eA ? eA.img : null;
    if (!A) {
      const eB = (fading && getEntry(key, P.keyFrom, P.from, w, h, draw, false)) || rec.shown;
      if (eB && !eB.dead) { c.drawImage(eB.img, x, y, w, h); return; }
      A = getLayer(key, P.keyTo, P.to, w, h, draw, true);
      if (!A) return;
    } else {
      rec.shown = eA;
    }
    if (fading && P.lowQ) {
      const B = P.t < 0.5 ? getLayer(key, P.keyFrom, P.from, w, h, draw, false) : null;
      c.drawImage(B || A, x, y, w, h);
    } else if (fading) {
      const B = getLayer(key, P.keyFrom, P.from, w, h, draw, false);
      if (B) c.drawImage(B, x, y, w, h);
      const ga = c.globalAlpha;
      c.globalAlpha = ga * easeInOut(P.t);
      c.drawImage(A, x, y, w, h);
      c.globalAlpha = ga;
    } else {
      c.drawImage(A, x, y, w, h);
    }
  }

  /**
   * Amortised warm-up while nothing is in flight: at most one layer build per ~0.1 s.
   * jobs = [[palKey, palette], ...] in priority order (current tier first).
   */
  function prewarm(dt, jobs) {
    warmT += dt;
    if (warmT < 0.1 || !lastUsed.size || !calm()) return;
    warmT = 0;
    for (const [pk, pal] of jobs) {
      for (const byKey of lastUsed.values()) {
        for (const e of byKey.values()) {
          if (!hasLayer(e.key, pk, e.w, e.h)) {
            getLayer(e.key, pk, pal, e.w, e.h, e.draw);
            return;
          }
        }
      }
    }
  }

  /** Upload one freshly promoted bitmap by drawing it into a corner pixel the sky then covers. */
  function touchPending(ctx) {
    if (!toTouch.length || inFlight()) return;
    const e = toTouch.shift();
    if (!e || e.dead || !e.img) return;
    try { ctx.drawImage(e.img, 0, 0, 1, 1); } catch (_) { /* ignore */ }
  }

  function clear() {
    for (const byPk of layers.values()) {
      for (const bySlot of byPk.values()) for (const e of bySlot.values()) retire(e);
    }
    layers.clear();
    order.length = 0;
    lastUsed.clear();
    toTouch.length = 0;
    warmT = -1; // let the fresh scene settle for a second before pre-warming
  }

  return {
    layer, prewarm, touchPending, clear, hasLayer, stats,
    get count() { return order.length; },
  };
}

/** Non-caching layer API: draw(c, pal) straight onto the target inside a clipped translate. */
export function directLayers(pal) {
  return {
    stats: { built: 0, inFlight: 0 },
    layer(c, key, w, h, draw, x, y) {
      if (!(w > 0 && h > 0)) return;
      c.save();
      c.beginPath();
      c.rect(x, y, w, h);
      c.clip();
      c.translate(x, y);
      try { draw(c, pal); } finally { c.restore(); }
    },
    prewarm() {},
    touchPending() {},
    clear() {},
    count: 0,
  };
}
