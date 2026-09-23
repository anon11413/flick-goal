// Flick Goal — adaptive graphics quality monitor (ported from try/pro-graphics render.js).
//
// Rolling window of draw() times and frame intervals. The device counts as struggling when
//  * the median draw time exceeds Q_LOW_MS (JS-side cost), or
//  * the share of long frame intervals is high (Q_JANK_SHARE) whatever draw() costs: most of a
//    canvas frame's cost can sit outside draw() (the GPU process rasterizing the recorded ops),
//    so a cheap draw with janky intervals is still a slow device, or
//  * the long-frame share is moderate while draws are not trivially cheap (Q_GAP_SHARE + Q_GAP_MS).
// Two slow checks in a row (~0.5 s apart once the 1.5 s window is full), or jank that lasts four
// checks (longer than the window, so one burst cannot do it), ask for the LOW tier; a very slow
// first check (median > 3 x Q_LOW_MS or nearly every frame long) asks at once. The renderer
// switches at the next calm phase (never mid-aim, never mid-flight). setMode('high' | 'low')
// forces a tier, 'auto' decides.
// The core only runs it while the active style is adaptive (pro); retro never samples.

export const Q_WIN = 90;          // frames in the rolling window (~1.5 s)
export const Q_EVERY = 30;        // frames between checks once the window is full
export const Q_SKIP = 30;         // frames ignored after a reset (resize / theme / quality switch)...
export const Q_SKIP_S = 0.5;      // ...or this many seconds, whichever ends first
export const Q_FILL_S = 1.5;      // early very-slow check once this much time has been sampled
export const Q_JANK_SHARE = 0.3;  // long-frame share that trips on its own (cost outside draw())
export const Q_LOW_MS = 5;        // median draw() ms that marks the device as struggling
export const Q_GAP_S = 0.021;     // a frame interval above this counts as a long frame
export const Q_GAP_SHARE = 0.25;  // share of long frames that also trips it...
export const Q_GAP_MS = 2.5;      // ...while the median draw is at least this

export function createQualityMonitor() {
  const qDraw = new Float64Array(Q_WIN);
  const qGap = new Uint8Array(Q_WIN);
  let n = 0;
  let i = 0;
  let skip = Q_SKIP;
  let skipT = 0;   // s spent skipping (the skip also ends after Q_SKIP_S on slow devices)
  let fillT = 0;   // s of samples while the window fills
  let early = false;
  let evalN = 0;
  let strikes = 0;
  let jankStrikes = 0;
  let mode = 'auto';
  let wantLow = false;
  const stats = { median: 0, longShare: 0 };

  function reset() {
    n = 0;
    i = 0;
    evalN = 0;
    strikes = 0;
    jankStrikes = 0;
    skip = Q_SKIP; // ignore the first frames after a (re)size / theme / quality switch (layer builds)
    skipT = 0;
    fillT = 0;
    early = false;
  }

  /** Median draw ms and long-frame share over the newest `count` samples. */
  function measure(count) {
    const d = [];
    let gaps = 0;
    for (let j = 0; j < count; j++) {
      const k = (i - 1 - j + Q_WIN) % Q_WIN;
      d.push(qDraw[k]);
      gaps += qGap[k];
    }
    d.sort((a, b) => a - b);
    stats.median = d[count >> 1];
    stats.longShare = gaps / count;
  }

  /** Feed one frame. isLow = low tier already active. built = a layer was built this frame. */
  function sample(ms, dt, built, isLow) {
    if (mode !== 'auto' || isLow || wantLow || !(dt > 0)) return;
    if (skip > 0 && skipT < Q_SKIP_S) { skip--; skipT += dt; return; }
    if (built) return;
    qDraw[i] = ms;
    qGap[i] = dt > Q_GAP_S ? 1 : 0;
    i = (i + 1) % Q_WIN;
    if (n < Q_WIN) {
      n++;
      fillT += dt;
      // a slow device (say 12 fps) would need 8 s to fill the window: after Q_FILL_S of samples
      // one early check can already flag a very slow device
      if (!early && fillT >= Q_FILL_S && n >= 12) {
        early = true;
        measure(n);
        if (stats.median > 3 * Q_LOW_MS || stats.longShare >= 0.8) wantLow = true;
      }
      return;
    }
    if (++evalN < Q_EVERY) return;
    evalN = 0;
    measure(Q_WIN);
    const slow = stats.median > Q_LOW_MS || (stats.longShare >= Q_GAP_SHARE && stats.median >= Q_GAP_MS);
    const janky = stats.longShare >= Q_JANK_SHARE;
    const verySlow = stats.median > 3 * Q_LOW_MS || stats.longShare >= 0.8;
    strikes = slow ? strikes + 1 : 0;
    // jank alone must outlast the window (a burst stays in the 90-frame window for 3 checks)
    jankStrikes = janky ? jankStrikes + 1 : 0;
    if (strikes >= 2 || jankStrikes >= 4 || verySlow) wantLow = true;
  }

  /** 'auto' | 'high' | 'low'. Returns the forced tier (true = low, false = high) or null for auto. */
  function setMode(m) {
    mode = m === 'high' || m === 'low' ? m : 'auto';
    if (mode === 'high') { wantLow = false; return false; }
    if (mode === 'low') { wantLow = true; return true; }
    reset();
    return null;
  }

  return {
    sample,
    reset,
    setMode,
    /** Forget a pending / applied low request (e.g. switching to a non-adaptive style). */
    clearWant() { wantLow = false; },
    get mode() { return mode; },
    get wantLow() { return wantLow; },
    get timing() { return mode === 'auto' && !wantLow; },
    stats,
  };
}
