// WebAudio-synthesized SFX (no audio files) + guarded haptics.
// The AudioContext is created lazily inside the first user gesture (unlock()) so autoplay
// policies on iOS/Android/Chrome never block it. Everything is a silent no-op when WebAudio is missing.
//
// Capacitor note: haptics can later switch to @capacitor/haptics (Haptics.impact) inside
// createHaptics().pulse without touching callers.

import { CONFIG } from '../config.js';

const MIN_GAP = { coin: 0.03, bounce: 0.05, thud: 0.06, tick: 0.08, click: 0.03 };

export function createAudio({ cfg = CONFIG, enabled = true } = {}) {
  let on = !!enabled;
  let ctx = null;
  let master = null;
  let noise = null;
  let unlocked = false;
  const lastAt = Object.create(null);

  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

  function unlock() {
    if (!AC) return;
    try {
      if (!ctx) {
        ctx = new AC({ latencyHint: 'interactive' });
        master = ctx.createGain();
        master.gain.value = (cfg.audio && cfg.audio.masterVolume) || 0.6;
        // gentle limiter so stacked sounds never clip
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.knee.value = 8;
        comp.ratio.value = 6;
        comp.attack.value = 0.002;
        comp.release.value = 0.12;
        master.connect(comp);
        comp.connect(ctx.destination);
        noise = makeNoise(ctx);
        // iOS: play a 1-sample silent buffer inside the gesture to fully unlock output.
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      }
      if (ctx.state === 'suspended' && !document.hidden) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      unlocked = true;
    } catch {
      ctx = null;
    }
  }

  function suspend() {
    if (!ctx || ctx.state !== 'running') return;
    try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
  }

  function resume() {
    if (!ctx || !unlocked || ctx.state === 'running') return;
    try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
  }

  // ---------- synthesis primitives ----------
  function env(g, t, peak, attack, decay) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Oscillator voice with optional pitch sweep. */
  function tone({ type = 'sine', f0 = 440, f1 = null, at = 0, attack = 0.005, dur = 0.15, gain = 0.3, curve = 'exp', detune = 0 }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1 != null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + attack + dur);
    }
    env(g, t, gain, attack, dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  /** Filtered noise burst with optional filter sweep. */
  function hiss({ at = 0, attack = 0.004, dur = 0.12, gain = 0.25, type = 'bandpass', f0 = 1200, f1 = null, q = 1 }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
    const g = ctx.createGain();
    env(g, t, gain, attack, dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    const off = Math.random() * 0.5;
    src.start(t, off);
    src.stop(t + attack + dur + 0.05);
  }

  const N = (semi) => 523.25 * Math.pow(2, semi / 12); // semitones from C5

  const SOUNDS = {
    flick() { // leather "thwack" + air
      tone({ type: 'sine', f0: 190, f1: 55, dur: 0.12, gain: 0.55 });
      hiss({ type: 'bandpass', f0: 2600, f1: 700, q: 0.9, dur: 0.16, gain: 0.3 });
      hiss({ type: 'highpass', f0: 5000, dur: 0.03, gain: 0.18 });
    },
    bounce() { // metallic "doink" off the post
      tone({ type: 'sine', f0: 610, f1: 560, dur: 0.42, gain: 0.3 });
      tone({ type: 'sine', f0: 1570, f1: 1480, dur: 0.25, gain: 0.12 });
      tone({ type: 'triangle', f0: 305, dur: 0.18, gain: 0.14 });
    },
    thud() {
      tone({ type: 'sine', f0: 130, f1: 48, dur: 0.14, gain: 0.45 });
      hiss({ type: 'lowpass', f0: 700, dur: 0.07, gain: 0.2 });
    },
    goal() { // bright rising triad
      [0, 4, 7].forEach((s, i) => tone({ type: 'triangle', f0: N(s), at: i * 0.06, dur: 0.18, gain: 0.26 }));
      tone({ type: 'sine', f0: N(12), at: 0.18, dur: 0.3, gain: 0.16 });
      hiss({ type: 'highpass', f0: 6000, dur: 0.18, gain: 0.08, at: 0.02 });
    },
    perfect() { // bigger arpeggio + sparkle
      [0, 4, 7, 12, 16].forEach((s, i) => tone({ type: 'triangle', f0: N(s), at: i * 0.05, dur: 0.22, gain: 0.24 }));
      [19, 24].forEach((s, i) => tone({ type: 'sine', f0: N(s), at: 0.25 + i * 0.07, dur: 0.35, gain: 0.12 }));
      tone({ type: 'square', f0: N(12), at: 0.25, dur: 0.12, gain: 0.05 });
      hiss({ type: 'highpass', f0: 7000, dur: 0.35, gain: 0.08, at: 0.05 });
    },
    coin() { // classic two-note coin
      tone({ type: 'square', f0: 988, dur: 0.05, gain: 0.08 });
      tone({ type: 'square', f0: 1319, at: 0.055, dur: 0.18, gain: 0.08 });
      tone({ type: 'sine', f0: 2637, at: 0.055, dur: 0.12, gain: 0.05 });
    },
    fail() { // descending buzz
      tone({ type: 'sawtooth', f0: 330, f1: 110, dur: 0.45, gain: 0.14, curve: 'lin' });
      tone({ type: 'square', f0: 220, f1: 82, dur: 0.5, gain: 0.07, detune: 12, curve: 'lin' });
      hiss({ type: 'lowpass', f0: 900, f1: 200, dur: 0.3, gain: 0.1 });
    },
    tick() {
      tone({ type: 'square', f0: 1760, dur: 0.025, gain: 0.07 });
      tone({ type: 'sine', f0: 880, dur: 0.04, gain: 0.1 });
    },
    click() { // bubbly UI pop
      tone({ type: 'sine', f0: 520, f1: 980, dur: 0.07, gain: 0.22 });
    },
    buy() { // register "ka-ching"
      tone({ type: 'square', f0: 1319, dur: 0.06, gain: 0.07 });
      tone({ type: 'square', f0: 1760, at: 0.06, dur: 0.2, gain: 0.07 });
      [0, 4, 7, 12].forEach((s, i) => tone({ type: 'triangle', f0: N(s), at: 0.12 + i * 0.045, dur: 0.2, gain: 0.18 }));
    },
    gift() { // magical rising sweep
      hiss({ type: 'bandpass', f0: 800, f1: 6000, q: 3, dur: 0.4, gain: 0.12 });
      [0, 7, 12, 16, 19, 24].forEach((s, i) => tone({ type: 'sine', f0: N(s), at: 0.08 + i * 0.05, dur: 0.25, gain: 0.16 }));
    },
    whoosh() {
      hiss({ type: 'bandpass', f0: 500, f1: 2400, q: 1.4, attack: 0.05, dur: 0.18, gain: 0.14 });
    },
    newbest() { // fanfare
      const seq = [[-5, 0], [0, 0.11], [4, 0.22], [7, 0.33], [12, 0.46]];
      seq.forEach(([s, at]) => {
        tone({ type: 'triangle', f0: N(s), at, dur: 0.2, gain: 0.22 });
        tone({ type: 'square', f0: N(s), at, dur: 0.12, gain: 0.04 });
      });
      tone({ type: 'sine', f0: N(16), at: 0.46, dur: 0.5, gain: 0.14 });
    },
  };

  function play(name) {
    if (!on || !ctx || !unlocked || ctx.state !== 'running') return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name] || 0.02;
    if (lastAt[name] != null && now - lastAt[name] < gap) return;
    lastAt[name] = now;
    try { fn(); } catch { /* never let audio break the game */ }
  }

  return {
    unlock,
    play,
    setEnabled(v) { on = !!v; },
    isEnabled: () => on,
    suspend,
    resume,
    get unlocked() { return unlocked; },
  };
}

function makeNoise(ctx) {
  const len = Math.floor(ctx.sampleRate * 1);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function createHaptics({ cfg = CONFIG, enabled = true } = {}) {
  let on = !!enabled;
  const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return {
    supported,
    pulse(name) {
      if (!on || !supported) return;
      const pattern = cfg.haptics && cfg.haptics[name];
      if (pattern == null) return;
      try { navigator.vibrate(pattern); } catch { /* ignore */ }
    },
    setEnabled(v) { on = !!v; },
    isEnabled: () => on,
  };
}
