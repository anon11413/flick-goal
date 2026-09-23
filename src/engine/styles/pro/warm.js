// Flick Goal — PRO style: "warm touch" for cached layers that can first scroll into view while
// the ball is in flight (the big scoreboard, the sunset streak clouds, the foreground strip).
// The layer cache only builds what is requested on screen, and it must never build in flight, so
// such a layer is requested once per palette through an empty clip while nothing is in flight:
// it gets built in a calm frame (nothing is painted) and is registered for the core's next-tier
// pre-warm. A layers.clear() (theme / size / quality change) resets the bookkeeping.

const WARMED = new WeakMap();

/** Request cache layer `key` (w x h, draw(c, pal)) off-screen-clipped, once per palette. */
export function warmLayer(ctx, view, cache, key, w, h, pal, draw) {
  if (!cache || !view || !view.warm || typeof cache.layer !== 'function') return;
  let rec = WARMED.get(cache);
  const count = Number(cache.count) || 0;
  if (!rec || count < rec.count) {
    rec = { count, keys: new Map() };
    WARMED.set(cache, rec);
  }
  rec.count = count;
  let seen = rec.keys.get(key);
  if (!seen) {
    seen = new Set();
    rec.keys.set(key, seen);
  }
  if (seen.has(pal)) return;
  if (seen.size > 12) seen.clear();
  seen.add(pal);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 0, 0);
  ctx.clip();
  ctx.globalAlpha = 1;
  cache.layer(ctx, key, w, h, draw, 0, 0);
  ctx.restore();
}
