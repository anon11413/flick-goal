// Flick Goal — adaptive graphics quality monitor (ported from try/pro-graphics render.js).
//
// Rolling window of draw() times and frame intervals. If the median draw time exceeds Q_LOW_MS,
// or the share of long frames is high while draws are not trivially cheap, for two checks in a
// row (~1.5 s apart), the monitor asks for the LOW tier; the renderer switches at the next calm
// phase (never mid-aim, never mid-flight). setMode('high' | 'low') forces a tier, 'auto' decides.
// The core only runs it while the active style is adaptive (pro); retro never samples.

export const Q_WIN = 90;          // frames in the rolling window
export const Q_LOW_MS = 5;        // median draw() ms that marks the device as struggling
export const Q_GAP_S = 0.021;     // a frame interval above this counts as a long frame
export const Q_GAP_SHARE = 0.25;  // share of long frames that also trips it...
export const Q_GAP_MS = 2.5;      // ...while the median draw is at least this

export function createQualityMonitor() {
  const qDraw = new Float64Array(Q_WIN);
  const qGap = new Uint8Array(Q_WIN);
  let n = 0;
  let i = 0;
  let skip = 30;
  let evalN = 0;
  let strikes = 0;
  let mode = 'auto';
  let wantLow = false;
  const stats = { median: 0, longShare: 0 };

  function reset() {
    n = 0;
    i = 0;
    evalN = 0;
    strikes = 0;
    skip = 60; // ignore the first frames after a (re)size / theme / quality switch (layer builds)
  }

  /** Feed one frame. isLow = low tier already active. built = a layer was built this frame. */
  function sample(ms, dt, built, isLow) {
    if (mode !== 'auto' || isLow || wantLow || !(dt > 0)) return;
    if (skip > 0) { skip--; return; }
    if (built) return;
    qDraw[i] = ms;
    qGap[i] = dt > Q_GAP_S ? 1 : 0;
    i = (i + 1) % Q_WIN;
    if (n < Q_WIN) n++;
    if (n < Q_WIN || ++evalN < 45) return;
    evalN = 0;
    const sorted = Array.from(qDraw).sort((a, b) => a - b);
    let gaps = 0;
    for (let j = 0; j < Q_WIN; j++) gaps += qGap[j];
    stats.median = sorted[Q_WIN >> 1];
    stats.longShare = gaps / Q_WIN;
    const slow = stats.median > Q_LOW_MS || (stats.longShare >= Q_GAP_SHARE && stats.median >= Q_GAP_MS);
    strikes = slow ? strikes + 1 : 0;
    if (strikes >= 2) wantLow = true;
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
