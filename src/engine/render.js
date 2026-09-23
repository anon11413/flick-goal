// Flick Goal — canvas renderer CORE (V2_SPEC.md §5).
//
// Two independent axes build every scene:
//  * layout = the game mode (world.mode): 'field' (end zone, net, stands, fresh attempts) or
//    'endless' (turf and yard lines forever, chained posts);
//  * style  = the equipped stadium's art style: 'retro' (flat) or 'pro' (stylized realism),
//    a module in engine/styles/ implementing the style interface (§5.3).
// The core owns everything style-agnostic: canvas + dpr, camera interpolation, the per-frame
// frame object `f`, event juice state (particles, rings, glows, shake, flash, squash, trail,
// net ripple, post tween), palette crossfade on tier change, the aim cues (slider + guide dots,
// aimDraw.js) with the slider tutorial / upgrade latch, FIELD overlays (tee label, attempt banner,
// swoop streaks, ghost ball), the mode wipe, flash, debug, and — for adaptive styles — the layer
// cache (layers.js) and the adaptive quality monitor (quality.js).
//
// Draws game.world with interpolation (alpha) between fixed sim steps. Cosmetic effects are
// driven by game events and advanced with the real frame delta, so they freeze while paused.
// Touches nothing in the DOM except the canvas it was given (plus detached offscreen canvases
// for adaptive styles' layer caches).

import { CONFIG } from '../config.js';
import { withAlpha, mixPalette, roundRectPath } from './paint.js';
import { fieldProjection, TEE_H } from './field.js';
import { ballMeta, basePalette, palKeyOf, THEMES } from './themes.js';
import { stadiumInfo } from './stadiums.js';
import { getStyle } from './styles/index.js';
import { createLayers, defaultMakeCanvas } from './layers.js';
import { createQualityMonitor } from './quality.js';
import { railGeometry, drawRailTrack, drawGuideDots } from './aimDraw.js';
import { railFade } from '../aimAssist.js';
import { checkSchedule, dwell } from './difficulty.js';
import { TEE_ROT } from './game.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const easeOutBack = (u) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
};
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const UI_FONT = '"Arial Rounded MT Bold","SF Pro Rounded",ui-rounded,"Nunito","Segoe UI",system-ui,sans-serif';
const POST_TWEEN = 0.4; // s: FIELD post telescopes to the new attempt's bar / upright heights
const WIPE_TIME = 0.35; // s: mode wipe (modeChange / endless camera cut)
const CONFETTI = ['#FFD21F', '#FF5A5F', '#39D98A', '#4FC3F7', '#FFFFFF', '#B388FF', '#FF8A3D', '#FF7BC8'];
const MAX_PARTICLES = 420;
const AIM_MODES = new Set(['full', 'fade', 'off']);

/**
 * createRenderer(canvas, game, { cfg, debug, createCanvas })
 * createCanvas(w, h): optional offscreen canvas factory (tests); default = DOM canvases.
 */
export function createRenderer(canvas, game, { cfg = CONFIG, debug = false, createCanvas = null } = {}) {
  const ctx = canvas.getContext('2d');
  const V = cfg.view;
  const R = cfg.physics.ballRadius;

  let cssW = Math.max(1, canvas.clientWidth || 390);
  let cssH = Math.max(1, canvas.clientHeight || 844);
  let dpr = 1;
  let skinId = 'classic';
  let stadiumId = 'day';
  let themeId = 'day';
  let styleId = 'retro';
  let styleOverride = null;
  let style = getStyle('retro');
  let time = 0;
  let phaseNow = 'idle';
  let lastFrame = null; // last built frame (style onFx hooks read its palette)

  // palette crossfade (tier changes)
  let curTier = 0;
  let palFrom = basePalette(themeId, 0);
  let palTo = palFrom;
  let palT = 1;
  let palKeyFrom = palKeyOf(themeId, 0);
  let palKeyTo = palKeyFrom;
  let warmTier = 0; // dev start round: tier a run will open at, pre-warmed on the menu

  // adaptive quality (only while the style is adaptive)
  const quality = createQualityMonitor();
  let lowQ = false;

  // aim assist: 'full' | 'fade' | 'off', latched per shot (V2_SPEC §6.3)
  let aimPending = 'full';
  let aimLatched = 'full';
  let aimShotRef = null;
  let aimTimeSeen = 0;
  let lastRailAlpha = 0;
  let lastDotsAlpha = 0;

  // juice state
  const particles = [];
  const rings = [];
  const glows = [];
  let shakeAmp = 0;
  let shakeDur = 0;
  let shakeT = 0;
  let flash = 0;
  let flashColor = '#FFFFFF';
  let squash = null; // {along, across, t, dur, angle|null}
  let markerPop = 0;
  let lockColor = null;
  const trail = [];
  let fxAcc = 0;
  const postShow = { ref: null, bar: 0, top: 0, fromBar: 0, fromTop: 0, t: 1 };
  let bannerT = 99;
  let bannerOn = false;
  let lastShot = null;
  const netFx = { t: 9, y: 0, amp: 0 };
  let wipeT = WIPE_TIME;

  if (debug) {
    const chk = checkSchedule(500, cfg);
    console.assert(chk.ok, '[flick-goal] difficulty schedule violations', chk.failures);
  }

  // ------------------------------------------------------------------ layers (adaptive styles)
  const makeCanvas = (w, h) => {
    try { return createCanvas ? createCanvas(w, h) : defaultMakeCanvas(w, h); } catch (_) { return null; }
  };
  const bgScale = () => (lowQ ? 1 : Math.min(dpr, 2));
  const edpr = () => (lowQ ? Math.min(dpr, 2) : dpr);
  const palState = { from: palFrom, to: palTo, keyFrom: palKeyFrom, keyTo: palKeyTo, t: 1, lowQ: false };
  const layers = createLayers({
    makeCanvas,
    getScale: bgScale,
    getPhase: () => phaseNow,
    getPalState: () => {
      palState.from = palFrom; palState.to = palTo; palState.keyFrom = palKeyFrom; palState.keyTo = palKeyTo;
      palState.t = palT; palState.lowQ = lowQ;
      return palState;
    },
    viewSize: () => ({ w: cssW, h: cssH }),
    promoteBitmaps: !createCanvas,
    debug,
  });
  const calmPhase = () => phaseNow === 'idle' || phaseNow === 'intro' || phaseNow === 'miss' || phaseNow === 'over';

  // ------------------------------------------------------------------ juice helpers
  function ballPos() {
    const b = game.world.ball;
    return { x: b.x, y: b.y };
  }
  function addParticle(p) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
  }
  function addGlow(x, y, r, color, a, dur) {
    if (glows.length > 24) glows.shift();
    glows.push({ x, y, r, color, a, t: 0, dur: Math.max(0.05, dur || 0.4) });
  }
  function shake(px, dur) {
    if (px >= shakeAmp * (1 - shakeT / Math.max(shakeDur, 1e-6))) {
      shakeAmp = px;
      shakeDur = dur;
      shakeT = 0;
    }
  }
  function doFlash(a, color = '#FFFFFF') {
    flash = Math.max(flash, a);
    flashColor = color;
  }
  function setSquash(along, across, dur, angle = null) {
    squash = { along, across, t: 0, dur, angle };
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function ring(x, y, dur, r0, r1, color, w, t0 = 0) {
    rings.push({ x, y, t: t0, dur, r0, r1, color, w });
  }
  function confetti(x, y, n, spread = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0.15, Math.PI - 0.15);
      const sp = rand(220, 620) * spread;
      addParticle({
        kind: 'rect', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.9 + 80, g: 900, drag: 1.6,
        life: rand(0.9, 1.7), max: 1.7, size: rand(5, 9), color: CONFETTI[i % CONFETTI.length],
        rot: rand(0, TAU), vr: rand(-12, 12),
      });
    }
  }
  function sparks(x, y, n, color = '#FFF6B0') {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(150, 420);
      addParticle({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 600, drag: 3, life: rand(0.2, 0.4), max: 0.4, size: rand(2, 3.5), color });
    }
  }
  function dust(x, n, color) {
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      addParticle({
        kind: 'circle', x: x + rand(-8, 8), y: 2, vx: dir * rand(40, 160), vy: rand(30, 110), g: 250, drag: 3,
        life: rand(0.35, 0.6), max: 0.6, size: rand(4, 8), color, grow: true,
      });
    }
  }
  function puffs(x, n, color, strength = 1) {
    for (let i = 0; i < n; i++) {
      addParticle({
        kind: 'circle', x: x + rand(-10, 10), y: rand(2, 8), vx: rand(-90, 90) * strength, vy: rand(20, 90) * strength, g: 120, drag: 2.5,
        life: rand(0.4, 0.8), max: 0.8, size: rand(5, 10) * strength, color, grow: true,
      });
    }
  }
  function starBurst(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.1, 0.1);
      const sp = rand(380, 520);
      addParticle({ kind: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, drag: 4, life: 0.6, max: 0.6, size: rand(7, 11), color: i % 2 ? '#FFFFFF' : '#FFE45C', rot: rand(0, TAU), vr: rand(-6, 6) });
    }
  }
  function sparkle(x, y, n, color = '#FFE45C') {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(60, 240);
      addParticle({ kind: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: -60, drag: 3, life: rand(0.35, 0.6), max: 0.6, size: rand(4, 7), color, rot: rand(0, TAU), vr: rand(-8, 8) });
    }
  }
  /** Juice API handed to style.onFx(name, e, api, f). */
  const fxApi = {
    confetti, sparks, dust, puffs, starBurst, sparkle, addParticle, addGlow, ring, shake,
    flash: doFlash, squash: setSquash, rand, ballPos,
  };
  function styleFx(name, e) {
    try {
      style.onFx(name, e, fxApi, lastFrame || { pal: palTo, themeId, mode: game.world.mode, cfg, time });
    } catch (err) {
      if (debug) console.warn('[flick-goal] style fx failed', name, err);
    }
  }

  // ------------------------------------------------------------------ events
  const unsubs = [
    game.on('flick', (e) => {
      const b = game.world.ball;
      setSquash(1.25, 0.8, 0.2, Math.atan2(b.vy, b.vx));
      markerPop = 1;
      lockColor = e.inBand ? '#39D98A' : '#FF5A5F';
      trail.length = 0;
      styleFx('flick', e);
    }),
    game.on('bounce', (e) => {
      const p = ballPos();
      if (e.kind === 'ground') {
        if (e.impact > 140) setSquash(0.72, 1.28, 0.2, Math.PI / 2);
      } else {
        const b = game.world.ball;
        setSquash(0.7, 1.3, 0.18, Math.atan2(b.vy, b.vx));
        sparks(p.x, p.y, 10);
        shake(5, 0.15);
      }
      styleFx('bounce', e);
    }),
    game.on('score', (e) => {
      const w = game.world;
      const x = w.post ? w.post.x : ballPos().x;
      const s = w.shot;
      const y = s ? (s.bar + s.top) / 2 : ballPos().y;
      if (e.perfect) {
        confetti(x, y, 60, 1.15);
        starBurst(x, y, 10);
        ring(x, y, 0.45, 10, 130, '#FFFFFF', 6);
        ring(x, y, 0.5, 6, 90, '#FFE45C', 4, -0.08);
        doFlash(0.25);
        shake(8, 0.25);
      } else {
        confetti(x, y, 24);
        ring(x, y, 0.35, 8, 70, '#FFFFFF', 4);
        doFlash(0.1);
        shake(4, 0.15);
      }
      if (e.doink) sparks(ballPos().x, ballPos().y, 8, '#FFFFFF');
      styleFx('score', e);
    }),
    game.on('coin', (e) => {
      const pk = game.world.pickup;
      const p = pk || ballPos();
      sparkle(p.x, p.y, 12);
      ring(p.x, p.y, 0.3, 6, 40, '#FFD54F', 4);
      styleFx('coin', e);
    }),
    game.on('net', (e) => {
      netFx.t = 0;
      netFx.y = e.y;
      netFx.amp = clamp((e.impact || 0) / 700, 0.25, 1);
      const b = game.world.ball;
      setSquash(0.8, 1.15, 0.16, Math.atan2(b.vy, b.vx));
      styleFx('net', e);
    }),
    game.on('land', (e) => styleFx('land', e)),
    game.on('miss', (e) => {
      shake(10, 0.3);
      doFlash(0.14, '#FF5A5F');
      styleFx('miss', e);
    }),
    game.on('runStart', (e) => {
      trail.length = 0;
      lockColor = null;
      if (e && e.cut) wipeT = 0;
      styleFx('runStart', e);
    }),
    game.on('continue', (e) => {
      trail.length = 0;
      lockColor = null;
      ring(game.world.teeX, R, 0.5, 10, 120, '#FFFFFF', 5);
      styleFx('continue', e);
    }),
    game.on('modeChange', (e) => {
      wipeT = 0;
      postShow.ref = null;
      trail.length = 0;
      particles.length = 0;
      rings.length = 0;
      glows.length = 0;
      styleFx('modeChange', e);
    }),
  ];

  // ------------------------------------------------------------------ update
  function update(dt) {
    if (dt <= 0) return;
    time += dt;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      const d = Math.exp(-(p.drag || 0) * dt);
      p.vx *= d;
      p.vy = p.vy * d - (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += (p.vr || 0) * dt;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t >= rings[i].dur) rings.splice(i, 1);
    }
    for (let i = glows.length - 1; i >= 0; i--) {
      glows[i].t += dt;
      if (glows[i].t >= glows[i].dur) glows.splice(i, 1);
    }
    if (shakeT < shakeDur) shakeT += dt;
    netFx.t += dt;
    flash = Math.max(0, flash - dt * 1.6);
    if (squash) {
      squash.t += dt;
      if (squash.t >= squash.dur) squash = null;
    }
    markerPop = Math.max(0, markerPop - dt / 0.2);
    if (palT < 1) palT = Math.min(1, palT + dt / 0.8);
    if (wipeT < WIPE_TIME) wipeT = Math.min(WIPE_TIME, wipeT + dt);
  }

  function currentPalette() {
    return palT >= 1 ? palTo : mixPalette(palFrom, palTo, easeInOut(palT));
  }

  // ------------------------------------------------------------------ ball state
  function teeLift(meta) {
    if (meta.shape === 'round') return 1.05 * R + TEE_H - R;
    const s = Math.sin(TEE_ROT);
    const c = Math.cos(TEE_ROT);
    const half = Math.sqrt((1.3 * R * s) ** 2 + (0.85 * R * c) ** 2);
    return half + TEE_H - R;
  }

  function liftAmount(w, meta) {
    const L = teeLift(meta);
    switch (w.phase) {
      case 'idle':
      case 'aim':
        return L;
      case 'intro':
        if (w.freshBall) return L; // a fresh ball is teed up before the camera arrives
        return L * easeInOut(clamp(w.introT / (cfg.timing.introTime * 0.85), 0, 1));
      case 'fly':
        return L * clamp(1 - w.flightTime / 0.08, 0, 1);
      case 'miss':
      case 'over':
        return w.flightTime === 0 && w.flight && !w.lastFlick ? L : 0;
      default:
        return 0;
    }
  }

  /** Interpolated ball state in screen space (V2_SPEC §5.3 `st`). */
  function ballState(w, f, a, meta) {
    const b = w.ball;
    const wx = lerp(b.px, b.x, a);
    const wy = lerp(b.py, b.y, a);
    const lift = liftAmount(w, meta);
    const st = {
      X: f.sx(wx), Y: f.sy(wy + lift), r: R * f.k, rot: -lerp(b.prot, b.rot, a),
      sx: 1, sy: 1, angle: 0, lift, alpha: 1, wx, wy,
    };
    if (squash) {
      const u = clamp(squash.t / squash.dur, 0, 1);
      const e = (1 - u) * (1 - u);
      st.sx = 1 + (squash.along - 1) * e;
      st.sy = 1 + (squash.across - 1) * e;
      st.angle = squash.angle === null ? Math.atan2(b.vy, b.vx) : squash.angle;
    }
    return st;
  }

  function spawnSkinFx(w, dt, meta) {
    if (meta.fx === 'none' || dt <= 0) return;
    const b = w.ball;
    const moving = (w.phase === 'fly' || w.phase === 'settle' || w.phase === 'miss') && Math.hypot(b.vx, b.vy) > 150;
    if (!moving) { fxAcc = 0; return; }
    fxAcc += dt * 45;
    while (fxAcc >= 1) {
      fxAcc -= 1;
      const x = b.x + rand(-6, 6);
      const y = b.y + rand(-6, 6);
      const bvx = -b.vx * 0.08;
      const bvy = -b.vy * 0.08;
      switch (meta.fx) {
        case 'fire':
          addParticle({ kind: 'circle', x, y, vx: bvx + rand(-30, 30), vy: bvy + rand(20, 90), g: -120, drag: 2, life: rand(0.25, 0.45), max: 0.45, size: rand(4, 7), color: Math.random() < 0.5 ? '#FFB020' : '#FF5A1F' });
          break;
        case 'sparkle':
          addParticle({ kind: 'star', x, y, vx: bvx + rand(-40, 40), vy: bvy + rand(-40, 40), g: 0, drag: 2, life: rand(0.3, 0.55), max: 0.55, size: rand(3, 6), color: Math.random() < 0.5 ? '#FFFFFF' : meta.trail, rot: rand(0, TAU), vr: rand(-6, 6) });
          break;
        case 'frost':
          addParticle({ kind: 'circle', x, y, vx: bvx + rand(-30, 30), vy: bvy + rand(-60, 0), g: 120, drag: 1.5, life: rand(0.4, 0.7), max: 0.7, size: rand(1.5, 3.5), color: Math.random() < 0.5 ? '#FFFFFF' : '#B8F1FF' });
          break;
        case 'pixel':
          addParticle({ kind: 'square', x, y, vx: bvx, vy: bvy, g: 0, drag: 2, life: rand(0.25, 0.45), max: 0.45, size: rand(3, 6), color: Math.random() < 0.5 ? meta.trail : '#FFFFFF' });
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------------ FIELD: post tween, ghost ball, labels
  /** FIELD: the post stays on the end line; a new attempt telescopes it to the new heights. */
  function displayPost(w, dt) {
    const p = w.post;
    if (!p) return null;
    if (postShow.ref !== p) {
      if (postShow.ref === null) {
        postShow.bar = postShow.fromBar = p.bar;
        postShow.top = postShow.fromTop = p.top;
        postShow.t = 1;
      } else {
        postShow.fromBar = postShow.bar;
        postShow.fromTop = postShow.top;
        postShow.t = 0;
      }
      postShow.ref = p;
    }
    if (postShow.t < 1) postShow.t = Math.min(1, postShow.t + dt / POST_TWEEN);
    const e = easeInOut(postShow.t);
    postShow.bar = lerp(postShow.fromBar, p.bar, e);
    postShow.top = lerp(postShow.fromTop, p.top, e);
    return { x: p.x, bar: postShow.bar, top: postShow.top };
  }

  /** FIELD: the previous ball stays where it came to rest and fades while the camera swoops away. */
  function ghostState(w, f) {
    const g = w.oldBall;
    if (!g || !w.swoop) return null;
    const u = clamp(w.swoop.t / w.swoop.dur, 0, 1);
    const A = 1 - easeInOut(u);
    if (A <= 0.01) return null;
    const X = f.sx(g.x);
    const Y = f.sy(g.y);
    const r = R * f.k;
    if (X < -3 * r || X > cssW + 3 * r || Y < -3 * r || Y > cssH + 3 * r) return null;
    return { X, Y, r, rot: -g.rot, sx: 1, sy: 1, angle: 0, lift: 0, alpha: A, wx: g.x, wy: g.y };
  }

  /** Camera-swoop speed streaks (screen space) while the view pans to the next attempt. */
  function drawSwoopStreaks(w, f) {
    const sw = w.swoop;
    if (!sw) return;
    const c = w.cam;
    const vx = (c.x - c.px) * cfg.sim.hz * f.k;
    const sp = Math.abs(vx);
    if (sp < 400) return;
    const A = clamp((sp - 400) / 1600, 0, 1) * 0.5;
    const len = clamp(sp * 0.09, 30, 180);
    const dir = vx > 0 ? -1 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    const top = cssH * 0.2;
    const band = Math.max(40, f.gy - top - 20);
    for (let i = 0; i < 9; i++) {
      const y = top + ((i * 0.618 + 0.13) % 1) * band;
      const x = ((i * 0.37 + time * 1.9 * (0.6 + (i % 3) * 0.2)) % 1) * (cssW + len) - len / 2;
      ctx.strokeStyle = withAlpha('#FFFFFF', A * (0.5 + (i % 2) * 0.5));
      ctx.lineWidth = 2 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dir * len, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** FIELD: small "38 YD FG" pill painted under the tee while aiming. */
  function drawTeeLabel(w, f, alpha) {
    if (alpha <= 0.01 || !w.yards) return;
    const txt = `${w.yards} YD FG`;
    const X = f.sx(w.teeX);
    const G = f.gy;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `900 13px ${UI_FONT}`;
    const tw = ctx.measureText(txt).width;
    const pw = tw + 20;
    const ph = 22;
    const cx = clamp(X, pw / 2 + 8, cssW - pw / 2 - 8);
    const cy = G + 22;
    if (cy + ph < cssH) {
      ctx.fillStyle = 'rgba(20,28,50,0.72)';
      ctx.beginPath();
      const px = clamp(X, cx - pw / 2 + 10, cx + pw / 2 - 10);
      ctx.moveTo(px - 6, cy - ph / 2 + 1);
      ctx.lineTo(px, cy - ph / 2 - 6);
      ctx.lineTo(px + 6, cy - ph / 2 + 1);
      ctx.closePath();
      ctx.fill();
      roundRectPath(ctx, cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, cx, cy + 0.5);
    }
    ctx.restore();
  }

  /** FIELD: broadcast-style attempt banner, shown while the camera swoops to a fresh attempt. */
  function drawAttemptBanner(w, pal) {
    if (!bannerOn || !w.yards) return;
    const intro = cfg.timing.introTime;
    const total = (cfg.timing.swoopTime ?? 0.5) + intro + 0.35;
    if (bannerT > total) return;
    const inU = clamp(bannerT / 0.28, 0, 1);
    const outU = clamp((bannerT - (total - 0.25)) / 0.25, 0, 1);
    const A = Math.min(1, inU * 2) * (1 - outU);
    if (A <= 0.01) return;
    const slide = (1 - easeOutBack(inU)) * -cssW * 0.6 + easeOutCubic(outU) * cssW * 0.35;
    const cx = cssW / 2 + slide;
    const cy = Math.max(cssH * 0.3, 232);
    const bw = Math.min(250, cssW * 0.66);
    const bh = 58;
    const d = edpr();
    ctx.save();
    ctx.globalAlpha = A;
    ctx.translate(cx, cy);
    ctx.transform(1, 0, -0.2, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-bw / 2 + 4, -bh / 2 + 6, bw, bh);
    ctx.fillStyle = 'rgba(20,28,50,0.86)';
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.fillStyle = pal.accent;
    ctx.fillRect(-bw / 2, -bh / 2, 9, bh);
    ctx.fillStyle = pal.zone || pal.accent;
    ctx.fillRect(-bw / 2 + 9, bh / 2 - 5, bw - 9, 5);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.translate(cx, cy);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD54F';
    ctx.font = `900 12px ${UI_FONT}`;
    ctx.fillText('FIELD GOAL ATTEMPT', 4, -14);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 27px ${UI_FONT}`;
    ctx.fillText(`${w.yards} YARDS`, 4, 9);
    ctx.restore();
  }

  // ------------------------------------------------------------------ aim cues (screen space)
  function railAlpha(w) {
    switch (w.phase) {
      case 'intro': return w.swoop ? 0 : easeInOut(clamp(w.introT / cfg.timing.introTime, 0, 1));
      case 'aim': return 1;
      case 'fly': return clamp(1 - w.flightTime / cfg.rail.fadeOut, 0, 1);
      default: return 0;
    }
  }

  /** Latch the aim-assist mode for the shot on screen (new shot, or menu / game over). */
  function latchAim(w) {
    if (w.shot !== aimShotRef) {
      aimShotRef = w.shot;
      aimLatched = aimPending;
      aimTimeSeen = 0;
    } else if (w.phase === 'idle' || w.phase === 'over') {
      aimLatched = aimPending;
    }
  }

  /**
   * Slider (faded by the aim-assist mode: tutorial / upgrade) + guide dots (always, at the
   * intro / flight fade alpha). The guide stays frozen at the tee in flight while it fades.
   */
  function drawAim(w, ballScreen, a, pal, f, meta) {
    lastRailAlpha = 0;
    lastDotsAlpha = 0;
    const A = railAlpha(w);
    if (A <= 0.001 || !w.shot) return;
    if (w.phase === 'aim') aimTimeSeen = w.phaseTime;
    else if (w.phase === 'intro') aimTimeSeen = 0;
    const mk = w.marker;
    const t = mk.locked ? mk.t : lerp(mk.pt, mk.t, a);
    const railA = A * railFade(aimLatched, aimTimeSeen, cfg);
    if (railA > 0.01) {
      const geom = railGeometry(ballScreen, cssW, cssH, cfg);
      drawRailTrack(ctx, geom, w.shot, t, railA, {
        accent: pal.accent, lockColor, locked: mk.locked, markerPop, time,
      }, cfg);
      lastRailAlpha = railA;
    }
    const anchor = w.phase === 'fly'
      ? { x: f.sx(w.teeX), y: f.sy(R + teeLift(meta)) }
      : ballScreen;
    drawGuideDots(ctx, w.shot, anchor, t, A, markerPop, cfg);
    lastDotsAlpha = A;
  }

  // ------------------------------------------------------------------ debug
  function drawDebug(w, f) {
    const s = w.shot;
    if (!s) return;
    const PH = cfg.physics;
    const P = { x: f.sx(s.postX), bar: f.sy(s.bar), top: f.sy(s.top) };
    ctx.save();
    ctx.strokeStyle = 'rgba(40,220,100,0.95)';
    ctx.fillStyle = 'rgba(80,255,140,0.18)';
    ctx.lineWidth = 2;
    const o = PH.uprightOffset * f.k;
    ctx.fillRect(P.x - o, P.top, 2 * o, P.bar - P.top);
    ctx.strokeRect(P.x - o, P.top, 2 * o, P.bar - P.top);
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    const vx = s.powerC * Math.cos(s.thetaC);
    const vy = s.powerC * Math.sin(s.thetaC);
    for (let i = 0; i <= 60; i++) {
      const x = s.teeX + ((s.d + 80) * i) / 60;
      const tau = (x - s.teeX) / vx;
      const y = R + vy * tau - 0.5 * PH.gravity * tau * tau;
      if (i === 0) ctx.moveTo(f.sx(x), f.sy(y)); else ctx.lineTo(f.sx(x), f.sy(y));
      if (y < 0) break;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const q = getQuality();
    const lines = [
      `n ${s.made}  v ${s.speed.toFixed(3)}  W ${s.targetWidth.toFixed(3)}/${s.band.width.toFixed(3)}`,
      `D ${(s.band.width / s.speed).toFixed(3)}s (sched ${dwell(s.made, cfg).toFixed(3)})  L ${s.clock.toFixed(2)}s`,
      `band [${s.band.lo.toFixed(3)}, ${s.band.hi.toFixed(3)}]  s ${s.s.toFixed(2)}  fallback ${s.fallback}`,
      `phase ${w.phase}  mode ${w.mode}  cam z ${w.cam.zoom.toFixed(2)}  tier ${w.tier}`,
      `style ${styleId}/${themeId}  aim ${aimLatched}  q ${q.tier}  layers ${q.layersBuilt}/${q.layersBuiltInFlight}`,
    ];
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(6, 64, 300, lines.length * 15 + 8);
    ctx.fillStyle = '#FFFFFF';
    lines.forEach((l, i) => ctx.fillText(l, 12, 78 + i * 15));
    ctx.restore();
  }

  // ------------------------------------------------------------------ size + quality
  function applySize() {
    const d = edpr();
    canvas.width = Math.max(1, Math.round(cssW * d));
    canvas.height = Math.max(1, Math.round(cssH * d));
    if (canvas.style) {
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
    }
  }

  function resize(w, h, ratio) {
    const nw = Math.max(1, Math.round(Number(w) || 1));
    const nh = Math.max(1, Math.round(Number(h) || 1));
    const nd = clamp(Number(ratio) || 1, 1, V.maxDpr);
    if (nw !== cssW || nh !== cssH || nd !== dpr) layers.clear();
    cssW = nw;
    cssH = nh;
    dpr = nd;
    applySize();
    quality.reset();
  }

  function setLow(on) {
    on = !!on && style.adaptive;
    if (on === lowQ) return;
    lowQ = on;
    layers.clear();
    applySize();
    quality.reset();
  }

  function setQuality(mode) {
    const forced = quality.setMode(mode);
    if (forced === true && style.adaptive) setLow(true);
    else if (forced === false) setLow(false);
  }

  function getQuality() {
    return {
      mode: quality.mode,
      tier: lowQ ? 'low' : 'high',
      pending: quality.wantLow && !lowQ && style.adaptive,
      median: quality.stats.median,
      longShare: quality.stats.longShare,
      layersBuilt: layers.stats.built,
      layersBuiltInFlight: layers.stats.inFlight,
      xfade: palT,
      adaptive: !!style.adaptive,
    };
  }

  // ------------------------------------------------------------------ frame
  function draw(alpha = 1, frameDt = 0) {
    const adaptive = !!style.adaptive;
    const timing = adaptive && quality.timing && !lowQ;
    const t0 = timing ? nowMs() : 0;
    const built0 = layers.stats.built;
    const w = game.world;
    phaseNow = w.phase;
    if (adaptive && quality.wantLow && !lowQ && calmPhase()) setLow(true);
    const dt = clamp(Number(frameDt) || 0, 0, 0.1);
    const a = clamp(Number(alpha), 0, 1) || 0;
    drawFrame(w, dt, a);
    if (timing) quality.sample(nowMs() - t0, Number(frameDt) || 0, layers.stats.built !== built0, lowQ);
  }

  function drawFrame(w, dt, a) {
    update(dt);
    latchAim(w);

    if (w.tier !== curTier) {
      palFrom = currentPalette();
      palKeyFrom = palKeyTo;
      palTo = basePalette(themeId, w.tier);
      palKeyTo = palKeyOf(themeId, w.tier);
      palT = 0;
      curTier = w.tier;
    }
    const pal = currentPalette();
    const d = edpr();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.globalAlpha = 1;
    if (style.adaptive) layers.touchPending(ctx);

    const c = w.cam;
    const zoom = lerp(c.pzoom, c.zoom, a);
    const k = (cssW / V.worldWidth) * zoom;
    const camX = lerp(c.px, c.x, a);
    const camY = lerp(c.py, c.y, a);
    const gy = cssH - (0 - camY) * k;
    const mode = w.mode === 'endless' ? 'endless' : 'field';
    const f = {
      cfg, time, dt, w: cssW, h: cssH, dpr, edpr: d,
      k, camX, camY, viewW: cssW / k,
      sx: (x) => (x - camX) * k,
      sy: (y) => cssH - (y - camY) * k,
      gy,
      mode,
      fieldEnd: null,
      originX: Number.isFinite(w.originX) ? w.originX : 0,
      proj: null,
      fv: null,
      spot: null,
      pal,
      palKey: palT >= 1 ? palKeyTo : palKeyFrom + '>' + palKeyTo,
      theme: THEMES[themeId],
      themeId,
      styleId,
      lowQ,
      phase: w.phase,
      inFlight: w.phase === 'fly' || w.phase === 'settle',
      postX: null,
      layers,
      makeCanvas,
      world: w,
      preview: false,
    };
    lastFrame = f;
    style.drawSky(ctx, f);
    if (!w.shot) return;

    const meta = ballMeta(skinId);

    // trail samples (world space)
    const b = w.ball;
    if (w.phase === 'fly' || w.phase === 'settle' || w.phase === 'miss' || w.phase === 'over') {
      if (dt > 0 && Math.hypot(b.vx, b.vy) > 80 && !b.rolling) {
        trail.push({ x: lerp(b.px, b.x, a), y: lerp(b.py, b.y, a) });
        if (trail.length > 14) trail.shift();
      } else if (dt > 0 && trail.length) {
        trail.shift();
      }
    } else if (trail.length) {
      trail.length = 0;
    }
    spawnSkinFx(w, dt, meta);

    // field view + projection (shared by every style)
    const teeA = w.phase === 'idle' || w.phase === 'intro' || w.phase === 'aim' ? 1
      : w.phase === 'fly' ? clamp(1 - w.flightTime / 0.4, 0, 1) : 0;
    const endX = mode === 'field' ? (Number.isFinite(w.fieldEnd) ? w.fieldEnd : (w.post ? w.post.x : 0)) : null;
    f.fieldEnd = endX;
    f.spot = { x: w.teeX, alpha: teeA, color: themeId === 'arcade' ? '#FFFFFF' : '#3D8BFF' };
    f.fv = { w: cssW, h: cssH, k, camX, gy, endX, originX: f.originX, mode, spot: f.spot, detail: 1 };
    f.proj = fieldProjection(f.fv, cfg);
    f.postX = w.post ? f.sx(w.post.x) : null;

    // screen shake
    let ox = 0;
    let oy = 0;
    if (shakeT < shakeDur) {
      const e = 1 - shakeT / shakeDur;
      const amp = shakeAmp * e * e;
      ox = Math.sin(time * 83.3) * amp;
      oy = Math.cos(time * 71.9) * amp * 0.8;
    }
    ctx.save();
    ctx.translate(ox, oy);

    style.drawBackground(ctx, f);
    ctx.globalAlpha = 1;
    style.drawField(ctx, f);
    ctx.globalAlpha = 1;

    let post;
    let pop = 1;
    if (mode === 'field') {
      post = displayPost(w, dt);
      style.drawNet(ctx, post, f, netFx);
    } else {
      post = w.post;
      pop = w.phase === 'idle' ? 1 : easeOutBack(clamp(w.shotAge / 0.42, 0, 1));
    }
    const oldPost = mode === 'endless' ? w.oldPost : null;
    if (oldPost) style.drawPostShadow(ctx, oldPost, f, 1);
    style.drawPostShadow(ctx, post, f, pop);
    const st = ballState(w, f, a, meta);
    style.drawBallShadow(ctx, st, f);
    if (oldPost) style.drawPost(ctx, oldPost, 'far', f, 1);
    style.drawPost(ctx, post, 'far', f, pop);
    if (mode === 'field') {
      const g = ghostState(w, f);
      if (g) {
        style.drawBallShadow(ctx, g, f);
        style.drawBall(ctx, skinId, g, f);
      }
    }
    style.drawTee(ctx, w.teeX, f, teeA);
    style.drawCoin(ctx, w.pickup, f);
    style.drawTrail(ctx, trail, skinId, f);
    style.drawBall(ctx, skinId, st, f);
    if (oldPost) style.drawPost(ctx, oldPost, 'near', f, 1);
    style.drawPost(ctx, post, 'near', f, pop);
    fxView.particles = particles;
    fxView.rings = rings;
    fxView.glows = glows;
    style.drawEffects(ctx, fxView, f);
    ctx.globalAlpha = 1;
    style.drawFront(ctx, f);
    ctx.restore();
    ctx.globalAlpha = 1;
    style.drawFinish(ctx, f);
    ctx.globalAlpha = 1;

    // screen-space overlays
    if (mode === 'field') {
      drawSwoopStreaks(w, f);
      if (w.shot !== lastShot) {
        lastShot = w.shot;
        bannerT = 0;
        bannerOn = !!w.swoop;
      } else if (dt > 0) {
        bannerT += dt;
      }
      const labelA = w.phase === 'aim' ? 1
        : w.phase === 'intro' && !w.swoop ? easeInOut(clamp(w.introT / cfg.timing.introTime, 0, 1))
          : w.phase === 'fly' ? clamp(1 - w.flightTime / 0.25, 0, 1) : 0;
      drawTeeLabel(w, f, labelA);
    } else {
      lastShot = w.shot;
      bannerOn = false;
    }
    if (wipeT < WIPE_TIME) {
      const u = clamp(wipeT / WIPE_TIME, 0, 1);
      ctx.fillStyle = withAlpha(pal.skyTop, 1 - easeOutCubic(u));
      ctx.fillRect(0, 0, cssW, cssH);
    }
    drawAim(w, { x: st.X, y: st.Y }, a, pal, f, meta);
    if (mode === 'field') drawAttemptBanner(w, pal);

    if (flash > 0.001) {
      ctx.fillStyle = withAlpha(flashColor, flash);
      ctx.fillRect(0, 0, cssW, cssH);
    }
    if (debug) drawDebug(w, f);
    if (style.adaptive) prewarm(dt);
  }
  const fxView = { particles, rings, glows };

  function prewarm(dt) {
    const nextTier = curTier + 1;
    const pkN = palKeyOf(themeId, nextTier);
    const jobs = [[palKeyTo, palTo]];
    const pkW = warmTier > 0 && phaseNow === 'idle' ? palKeyOf(themeId, warmTier) : palKeyTo;
    if (pkW !== palKeyTo) jobs.push([pkW, basePalette(themeId, warmTier)]);
    if (palT >= 1 && pkN !== palKeyTo && pkN !== pkW) jobs.push([pkN, basePalette(themeId, nextTier)]);
    layers.prewarm(dt, jobs);
  }

  // ------------------------------------------------------------------ public setters
  function setSkin(id) {
    skinId = ballMeta(id).id === id ? id : 'classic';
  }

  function snapTier(t) {
    curTier = Math.floor(Number(t) || 0);
    palFrom = palTo = basePalette(themeId, curTier);
    palKeyFrom = palKeyTo = palKeyOf(themeId, curTier);
    palT = 1;
  }

  function applyStyle(nextStyle, nextTheme) {
    const changed = nextStyle !== styleId || nextTheme !== themeId;
    styleId = nextStyle;
    themeId = nextTheme;
    style = getStyle(styleId);
    if (changed) {
      layers.clear();
      quality.reset();
      if (!style.adaptive) {
        quality.clearWant();
        setLow(false); // retro always runs at full dpr
      } else if (quality.mode === 'low') {
        setLow(true);
      }
    }
    snapTier(game.world ? game.world.tier : 0);
  }

  /** Catalog stadium id ('day', 'pro_night', ...) or base theme id; unknown -> retro day. */
  function setTheme(id) {
    const info = stadiumInfo(id, cfg);
    stadiumId = info.id;
    applyStyle(styleOverride || info.style, info.theme);
  }

  /** QA only (?style=): render the equipped theme in another style without owning it. */
  function setStyleOverride(sid) {
    styleOverride = sid === 'retro' || sid === 'pro' ? sid : null;
    setTheme(stadiumId);
  }

  /** 'full' | 'fade' | 'off' for the next shot (latched when it appears; §6.3). */
  function setAimAssist(mode) {
    aimPending = AIM_MODES.has(mode) ? mode : 'off';
    const w = game.world;
    if (w && (w.phase === 'idle' || w.phase === 'over' || !w.shot)) aimLatched = aimPending;
  }

  function setWarmTier(t) {
    warmTier = Math.max(0, Math.floor(Number(t) || 0));
  }

  function debugState() {
    return {
      style: styleId,
      theme: themeId,
      stadium: stadiumId,
      mode: game.world ? game.world.mode : 'field',
      aimAssist: aimLatched,
      aimPending,
      railAlpha: lastRailAlpha,
      dotsAlpha: lastDotsAlpha,
      quality: getQuality(),
      wipe: wipeT < WIPE_TIME,
    };
  }

  function destroy() {
    for (const u of unsubs) {
      try { u(); } catch (_) { /* ignore */ }
    }
    unsubs.length = 0;
    particles.length = 0;
    rings.length = 0;
    glows.length = 0;
    trail.length = 0;
    layers.clear();
  }

  resize(cssW, cssH, 1);
  return {
    resize,
    draw,
    setSkin,
    setTheme,
    setStyleOverride,
    setAimAssist,
    get aimAssist() { return aimLatched; },
    setQuality,
    getQuality,
    setWarmTier,
    debugState,
    destroy,
  };
}

export default createRenderer;
