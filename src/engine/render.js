// Flick Goal — canvas renderer (world, posts, ball, rail, juice).
//
// Draws game.world with interpolation (alpha) between fixed sim steps. All
// cosmetic effects (particles, shake, flash, squash, trail) are driven by game
// events and advanced with the real frame delta, so they freeze while paused.
// Touches nothing in the DOM except the canvas it was given.

import { CONFIG } from '../config.js';
import {
  BALL_SKINS, STADIUM_THEMES, drawBall, themePalette, mixPalette, mixColor, withAlpha, roundRectPath,
} from './skins.js';
import { checkSchedule, dwell } from './difficulty.js';
import { guideLayout } from './guide.js';
import { TEE_ROT } from './game.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const easeOutBack = (u) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
};
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

const CONFETTI = ['#FFD21F', '#FF5A5F', '#39D98A', '#4FC3F7', '#FFFFFF', '#B388FF', '#FF8A3D', '#FF7BC8'];
const BAND = '#6BFFB0';
const TEE_H = 9; // world units
const MAX_PARTICLES = 420;

export function createRenderer(canvas, game, { cfg = CONFIG, debug = false } = {}) {
  const ctx = canvas.getContext('2d');
  const V = cfg.view;
  const PH = cfg.physics;
  const RL = cfg.rail;
  const R = PH.ballRadius;

  let cssW = Math.max(1, canvas.clientWidth || 390);
  let cssH = Math.max(1, canvas.clientHeight || 844);
  let dpr = 1;
  let skinId = 'classic';
  let themeId = 'day';
  let time = 0;

  // palette crossfade (tier changes)
  let curTier = 0;
  let palFrom = themePalette(themeId, 0);
  let palTo = palFrom;
  let palT = 1;

  // juice state
  const particles = [];
  const rings = [];
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

  if (debug) {
    const chk = checkSchedule(500, cfg);
    console.assert(chk.ok, '[flick-goal] difficulty schedule violations', chk.failures);
  }

  // ------------------------------------------------------------------ helpers
  function ballPos() {
    const b = game.world.ball;
    return { x: b.x, y: b.y };
  }
  function addParticle(p) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
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

  // ------------------------------------------------------------------ events
  const unsubs = [
    game.on('flick', (e) => {
      const b = game.world.ball;
      setSquash(1.25, 0.8, 0.2, Math.atan2(b.vy, b.vx));
      markerPop = 1;
      lockColor = e.inBand ? '#39D98A' : '#FF5A5F';
      trail.length = 0;
      const p = ballPos();
      for (let i = 0; i < 6; i++) {
        addParticle({ kind: 'rect', x: p.x + rand(-6, 6), y: 4, vx: rand(-60, 60), vy: rand(80, 220), g: 900, drag: 1, life: 0.45, max: 0.45, size: rand(3, 5), color: palTo.groundDark, rot: rand(0, TAU), vr: rand(-10, 10) });
      }
    }),
    game.on('bounce', (e) => {
      const p = ballPos();
      if (e.kind === 'ground') {
        if (e.impact > 140) {
          setSquash(0.72, 1.28, 0.2, Math.PI / 2);
          dust(p.x, Math.min(10, 3 + Math.floor(e.impact / 120)), withAlpha('#FFFFFF', 0.85));
        }
      } else {
        const b = game.world.ball;
        setSquash(0.7, 1.3, 0.18, Math.atan2(b.vy, b.vx));
        sparks(p.x, p.y, 10);
        shake(5, 0.15);
      }
    }),
    game.on('score', (e) => {
      const w = game.world;
      const x = w.post ? w.post.x : ballPos().x;
      const s = w.shot;
      const y = s ? (s.bar + s.top) / 2 : ballPos().y;
      if (e.perfect) {
        confetti(x, y, 60, 1.15);
        starBurst(x, y, 10);
        rings.push({ x, y, t: 0, dur: 0.45, r0: 10, r1: 130, color: '#FFFFFF', w: 6 });
        rings.push({ x, y, t: -0.08, dur: 0.5, r0: 6, r1: 90, color: '#FFE45C', w: 4 });
        doFlash(0.25);
        shake(8, 0.25);
      } else {
        confetti(x, y, 24);
        rings.push({ x, y, t: 0, dur: 0.35, r0: 8, r1: 70, color: '#FFFFFF', w: 4 });
        doFlash(0.1);
        shake(4, 0.15);
      }
      if (e.doink) sparks(ballPos().x, ballPos().y, 8, '#FFFFFF');
    }),
    game.on('coin', () => {
      const pk = game.world.pickup;
      const p = pk || ballPos();
      sparkle(p.x, p.y, 12);
      rings.push({ x: p.x, y: p.y, t: 0, dur: 0.3, r0: 6, r1: 40, color: '#FFD54F', w: 4 });
    }),
    game.on('land', (e) => {
      dust(e.x, 8, withAlpha('#FFFFFF', 0.9));
    }),
    game.on('miss', () => {
      shake(10, 0.3);
      doFlash(0.14, '#FF5A5F');
    }),
    game.on('runStart', () => {
      trail.length = 0;
      lockColor = null;
    }),
    game.on('continue', () => {
      trail.length = 0;
      lockColor = null;
      rings.push({ x: game.world.teeX, y: R, t: 0, dur: 0.5, r0: 10, r1: 120, color: '#FFFFFF', w: 5 });
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
    if (shakeT < shakeDur) shakeT += dt;
    flash = Math.max(0, flash - dt * 1.6);
    if (squash) {
      squash.t += dt;
      if (squash.t >= squash.dur) squash = null;
    }
    markerPop = Math.max(0, markerPop - dt / 0.2);
    if (palT < 1) palT = Math.min(1, palT + dt / 0.8);
  }

  function currentPalette() {
    return palT >= 1 ? palTo : mixPalette(palFrom, palTo, easeInOut(palT));
  }

  // ------------------------------------------------------------------ drawing: world pieces
  function drawSky(pal) {
    const g = ctx.createLinearGradient(0, 0, 0, cssH);
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(1, pal.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  function drawField(pal, T) {
    const gy = T.sy(0);
    if (gy > cssH + 30) return;
    const top = Math.max(gy, -30);
    const bottom = cssH + 30;
    ctx.fillStyle = pal.ground;
    ctx.fillRect(-30, top, cssW + 60, bottom - top);
    // Skewed alternating stripes suggest depth; yard lines every 160 u.
    const skew = 0.32;
    const hgt = bottom - gy;
    const stripe = 80;
    const x0 = Math.floor((T.cx - 40 - hgt * skew / T.k) / stripe) * stripe;
    const x1 = T.cx + T.viewW + stripe * 2;
    ctx.fillStyle = pal.groundDark;
    for (let x = x0; x < x1; x += stripe) {
      if (((Math.round(x / stripe) % 2) + 2) % 2 === 0) continue;
      const a = T.sx(x);
      const b = T.sx(x + stripe);
      ctx.beginPath();
      ctx.moveTo(a, gy);
      ctx.lineTo(b, gy);
      ctx.lineTo(b + hgt * skew, bottom);
      ctx.lineTo(a + hgt * skew, bottom);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = withAlpha(pal.line, 0.45);
    ctx.lineWidth = Math.max(1.5, 3 * T.k);
    ctx.beginPath();
    const y0 = Math.floor(x0 / 160) * 160;
    for (let x = y0; x < x1; x += 160) {
      const a = T.sx(x);
      ctx.moveTo(a, gy + 6);
      ctx.lineTo(a + hgt * skew, bottom);
    }
    ctx.stroke();
    // grass lip
    ctx.fillStyle = withAlpha(pal.line, 0.35);
    ctx.fillRect(-30, gy, cssW + 60, Math.max(3, 5 * T.k));
    ctx.fillStyle = withAlpha('#000000', 0.06);
    ctx.fillRect(-30, gy + Math.max(3, 5 * T.k), cssW + 60, Math.max(2, 4 * T.k));
  }

  function ribbon(x, y, k, color, phase) {
    const wv = Math.sin(time * 9 + phase);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + 2 * k);
    ctx.quadraticCurveTo(x + 10 * k, y + (2 + wv * 3) * k, x + (19 + wv * 2) * k, y + (6 + wv * 2) * k);
    ctx.quadraticCurveTo(x + 10 * k, y + (9 - wv * 2) * k, x, y + 13 * k);
    ctx.closePath();
    ctx.fill();
  }

  /** layer: 'far' (base, stem, far upright, crossbar) or 'near' (near upright). */
  function drawPost(post, layer, pal, T, pop = 1) {
    if (!post) return;
    const k = T.k;
    const X = T.sx(post.x);
    const G = T.sy(0);
    const B = T.sy(post.bar);
    const Tp = T.sy(post.top);
    if (X < -80 || X > cssW + 80) return;
    const o = PH.uprightOffset * k;
    ctx.save();
    if (pop < 1) {
      ctx.translate(X, G);
      ctx.scale(Math.max(0.001, pop), Math.max(0.001, pop));
      ctx.translate(-X, -G);
    }
    ctx.lineCap = 'round';
    const post1 = pal.post;
    if (layer === 'far') {
      // padded base
      ctx.fillStyle = mixColor(pal.accent, '#000000', 0.12);
      roundRectPath(ctx, X - 10 * k, G - 40 * k, 20 * k, 40 * k + 4, 6 * k);
      ctx.fill();
      ctx.fillStyle = withAlpha('#FFFFFF', 0.35);
      ctx.fillRect(X - 6 * k, G - 34 * k, 3 * k, 28 * k);
      // stem
      ctx.strokeStyle = post1;
      ctx.lineWidth = Math.max(3, 2 * PH.stemRadius * k);
      ctx.beginPath();
      ctx.moveTo(X, G - 36 * k);
      ctx.lineTo(X, B);
      ctx.stroke();
      // far upright (darker, thinner -> depth)
      ctx.strokeStyle = mixColor(post1, '#000000', 0.2);
      ctx.lineWidth = Math.max(2.5, 7.5 * k);
      ctx.beginPath();
      ctx.moveTo(X - o, B);
      ctx.lineTo(X - o, Tp);
      ctx.stroke();
      ribbon(X - o, Tp, k, mixColor(pal.accent, '#000000', 0.15), 0);
      // crossbar
      ctx.strokeStyle = post1;
      ctx.lineWidth = Math.max(3, 2 * PH.crossbarRadius * k);
      ctx.beginPath();
      ctx.moveTo(X - o, B);
      ctx.lineTo(X + o, B);
      ctx.stroke();
      ctx.strokeStyle = withAlpha('#FFFFFF', 0.55);
      ctx.lineWidth = Math.max(1, 2.2 * k);
      ctx.beginPath();
      ctx.moveTo(X - o * 0.6, B - 2 * k);
      ctx.lineTo(X + o * 0.6, B - 2 * k);
      ctx.stroke();
    } else {
      ctx.strokeStyle = post1;
      ctx.lineWidth = Math.max(3, 9.5 * k);
      ctx.beginPath();
      ctx.moveTo(X + o, B);
      ctx.lineTo(X + o, Tp);
      ctx.stroke();
      ctx.strokeStyle = withAlpha('#FFFFFF', 0.55);
      ctx.lineWidth = Math.max(1, 2.4 * k);
      ctx.beginPath();
      ctx.moveTo(X + o - 2 * k, B - 4 * k);
      ctx.lineTo(X + o - 2 * k, Tp + 6 * k);
      ctx.stroke();
      ribbon(X + o, Tp, k, pal.accent, 1.7);
    }
    ctx.restore();
  }

  function drawTee(x, pal, T, alpha) {
    if (alpha <= 0) return;
    const k = T.k;
    const X = T.sx(x);
    const G = T.sy(0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = withAlpha('#000000', 0.15);
    ctx.beginPath();
    ctx.ellipse(X, G + 1, 12 * k, 3 * k, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.moveTo(X - 9 * k, G - TEE_H * k);
    ctx.lineTo(X + 9 * k, G - TEE_H * k);
    ctx.lineTo(X + 4 * k, G);
    ctx.lineTo(X - 4 * k, G);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = withAlpha('#FFFFFF', 0.4);
    ctx.fillRect(X - 7 * k, G - TEE_H * k, 14 * k, 2 * k);
    ctx.restore();
  }

  function drawCoin(pk, T) {
    if (!pk || pk.collected) return;
    const k = T.k;
    const bob = Math.sin(time * 3) * 3;
    const X = T.sx(pk.x);
    const Y = T.sy(pk.y + bob);
    const r = cfg.pickups.radius * k;
    // glow
    ctx.fillStyle = withAlpha('#FFE45C', 0.18 + 0.1 * Math.sin(time * 5));
    ctx.beginPath();
    ctx.arc(X, Y, r * 1.7, 0, TAU);
    ctx.fill();
    const sx = Math.max(0.18, Math.abs(Math.cos(time * 3.2)));
    ctx.save();
    ctx.translate(X, Y);
    ctx.scale(sx, 1);
    ctx.fillStyle = '#E09B00';
    ctx.beginPath();
    ctx.arc(0, r * 0.12, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FFC83D';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#FFE7A0';
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#FFF6D0';
    ctx.fillRect(-r * 0.12, -r * 0.4, r * 0.24, r * 0.8);
    ctx.restore();
  }

  function drawTrail(T, skin) {
    if (trail.length < 2) return;
    const n = trail.length;
    const r = R * T.k;
    ctx.lineCap = 'round';
    for (let i = 1; i < n; i++) {
      const u = i / (n - 1);
      ctx.strokeStyle = withAlpha(skin.trail, 0.45 * u);
      ctx.lineWidth = Math.max(1, r * 1.5 * u);
      ctx.beginPath();
      ctx.moveTo(T.sx(trail[i - 1].x), T.sy(trail[i - 1].y));
      ctx.lineTo(T.sx(trail[i].x), T.sy(trail[i].y));
      ctx.stroke();
    }
  }

  function teeLift(skin) {
    if (skin.shape === 'round') return 1.05 * R + TEE_H - R;
    const s = Math.sin(TEE_ROT);
    const c = Math.cos(TEE_ROT);
    const half = Math.sqrt((1.3 * R * s) ** 2 + (0.85 * R * c) ** 2);
    return half + TEE_H - R;
  }

  function liftAmount(w, skin) {
    const L = teeLift(skin);
    switch (w.phase) {
      case 'idle':
      case 'aim':
        return L;
      case 'intro':
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

  function drawBallAndShadow(w, T, a, skin) {
    const b = w.ball;
    const bx = lerp(b.px, b.x, a);
    const byRaw = lerp(b.py, b.y, a);
    const lift = liftAmount(w, skin);
    const by = byRaw + lift;
    const rot = lerp(b.prot, b.rot, a);
    const k = T.k;
    const r = R * k;
    // ground shadow
    const G = T.sy(0);
    if (G < cssH + 20) {
      const hgt = Math.max(0, byRaw - R);
      const s = clamp(1 - hgt / 520, 0.25, 1);
      ctx.fillStyle = withAlpha('#000000', 0.2 * s);
      ctx.beginPath();
      ctx.ellipse(T.sx(bx), G + 1, 1.25 * r * s, 0.3 * r * s, 0, 0, TAU);
      ctx.fill();
    }
    const X = T.sx(bx);
    const Y = T.sy(by);
    ctx.save();
    ctx.translate(X, Y);
    if (squash) {
      const u = clamp(squash.t / squash.dur, 0, 1);
      const e = (1 - u) * (1 - u);
      const along = 1 + (squash.along - 1) * e;
      const across = 1 + (squash.across - 1) * e;
      const ang = squash.angle === null ? Math.atan2(b.vy, b.vx) : squash.angle;
      ctx.rotate(-ang);
      ctx.scale(along, across);
      ctx.rotate(ang);
    }
    drawBall(ctx, skinId, 0, 0, r, -rot, time);
    ctx.restore();
    return { x: X, y: Y, r };
  }

  function drawParticles(T) {
    for (const p of particles) {
      const X = T.sx(p.x);
      const Y = T.sy(p.y);
      if (X < -40 || X > cssW + 40 || Y < -40 || Y > cssH + 40) continue;
      const u = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = p.kind === 'rect' ? Math.min(1, u * 2.5) : u;
      ctx.fillStyle = p.color;
      switch (p.kind) {
        case 'rect': {
          ctx.save();
          ctx.translate(X, Y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.rot * 1.7));
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
          ctx.restore();
          break;
        }
        case 'circle': {
          const s = p.grow ? p.size * (1.6 - u * 0.6) : p.size * u;
          ctx.beginPath();
          ctx.arc(X, Y, Math.max(0.5, s), 0, TAU);
          ctx.fill();
          break;
        }
        case 'square':
          ctx.fillRect(X - p.size / 2, Y - p.size / 2, p.size, p.size);
          break;
        case 'spark': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          const l = 0.03;
          ctx.beginPath();
          ctx.moveTo(X, Y);
          ctx.lineTo(X - p.vx * l * T.k, Y + p.vy * l * T.k);
          ctx.stroke();
          break;
        }
        case 'star':
          starPath(X, Y, p.size * (0.5 + 0.5 * u), p.rot || 0);
          ctx.fill();
          break;
        default:
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  function starPath(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i / 10) * TAU - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawRings(T) {
    for (const g of rings) {
      if (g.t < 0) continue;
      const u = clamp(g.t / g.dur, 0, 1);
      const e = 1 - (1 - u) * (1 - u);
      ctx.strokeStyle = withAlpha(g.color, 1 - u);
      ctx.lineWidth = Math.max(1, g.w * (1 - u * 0.7));
      ctx.beginPath();
      ctx.arc(T.sx(g.x), T.sy(g.y), lerp(g.r0, g.r1, e), 0, TAU);
      ctx.stroke();
    }
  }

  function spawnSkinFx(w, dt, skin) {
    if (skin.fx === 'none' || dt <= 0) return;
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
      switch (skin.fx) {
        case 'fire':
          addParticle({ kind: 'circle', x, y, vx: bvx + rand(-30, 30), vy: bvy + rand(20, 90), g: -120, drag: 2, life: rand(0.25, 0.45), max: 0.45, size: rand(4, 7), color: Math.random() < 0.5 ? '#FFB020' : '#FF5A1F' });
          break;
        case 'sparkle':
          addParticle({ kind: 'star', x, y, vx: bvx + rand(-40, 40), vy: bvy + rand(-40, 40), g: 0, drag: 2, life: rand(0.3, 0.55), max: 0.55, size: rand(3, 6), color: Math.random() < 0.5 ? '#FFFFFF' : skin.trail, rot: rand(0, TAU), vr: rand(-6, 6) });
          break;
        case 'frost':
          addParticle({ kind: 'circle', x, y, vx: bvx + rand(-30, 30), vy: bvy + rand(-60, 0), g: 120, drag: 1.5, life: rand(0.4, 0.7), max: 0.7, size: rand(1.5, 3.5), color: Math.random() < 0.5 ? '#FFFFFF' : '#B8F1FF' });
          break;
        case 'pixel':
          addParticle({ kind: 'square', x, y, vx: bvx, vy: bvy, g: 0, drag: 2, life: rand(0.25, 0.45), max: 0.45, size: rand(3, 6), color: Math.random() < 0.5 ? skin.trail : '#FFFFFF' });
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------------ rail (screen space)
  function railAlpha(w) {
    switch (w.phase) {
      case 'intro': return easeInOut(clamp(w.introT / cfg.timing.introTime, 0, 1));
      case 'aim': return 1;
      case 'fly': return clamp(1 - w.flightTime / RL.fadeOut, 0, 1);
      default: return 0;
    }
  }

  /**
   * Aim cues: the rail track (only when `rail.visible`) and the launch-angle guide dots.
   * The guide is always drawn; with the rail hidden it is the player's only aim cue.
   */
  function drawAim(w, ballScreen, a, pal, T, skin) {
    const A = railAlpha(w);
    if (A <= 0.001 || !w.shot) return;
    const mk = w.marker;
    const t = mk.locked ? mk.t : lerp(mk.pt, mk.t, a);
    if (RL.visible) drawRailTrack(w, ballScreen, t, A, pal);
    // in flight the guide stays frozen at the tee (the kick that was taken) while it fades out
    const anchor = w.phase === 'fly'
      ? { x: T.sx(w.teeX), y: T.sy(R + teeLift(skin)) }
      : ballScreen;
    drawGuide(w.shot, anchor, t, A);
  }

  /**
   * Launch-angle guide: a short row of dots from the ball along the launch angle for rail
   * position t. Dot spacing shows strength vs the shot's ideal power (guide.js): bunched =
   * too weak, evenly spaced = right, stretched = too strong. Not a trajectory preview.
   */
  function drawGuide(shot, anchor, t, A) {
    const { angle, dots } = guideLayout(shot, t, cfg);
    const pop = 1 + 0.35 * markerPop;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    ctx.save();
    ctx.globalAlpha = A;
    for (const dot of dots) {
      const px = anchor.x + ca * dot.d;
      const py = anchor.y - sa * dot.d;
      const rr = dot.r * pop;
      // drop shadow, soft dark rim, white dot
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.arc(px, py + 1.8, rr + RL.guideOutline, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(20,28,50,0.42)';
      ctx.beginPath();
      ctx.arc(px, py, rr + RL.guideOutline, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRailTrack(w, ballScreen, t, A, pal) {
    const shot = w.shot;
    const band = shot.band;
    const th = RL.thickness;
    const L = clamp(RL.lengthFrac * cssW, RL.minLen, RL.maxLen);
    const ang = RL.angleDeg * DEG;
    const ux = Math.cos(ang);
    const uy = -Math.sin(ang);
    let x0 = ballScreen.x + RL.offsetX;
    let y0 = ballScreen.y + RL.offsetY;
    let x1 = x0 + ux * L;
    let y1 = y0 + uy * L;
    const m = RL.edgeMargin + th / 2;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    let dx = 0;
    let dy = 0;
    if (maxX + m > cssW) dx = cssW - m - maxX;
    if (minX + dx - m < 0) dx = m - minX;
    if (maxY + m > cssH) dy = cssH - m - maxY;
    if (minY + dy - m < 0) dy = m - minY;
    x0 += dx; y0 += dy; x1 += dx; y1 += dy;

    const mk = w.marker;

    ctx.save();
    ctx.globalAlpha = A;
    ctx.translate(x0, y0);
    ctx.rotate(-ang);
    // shadow + track
    roundRectPath(ctx, -th / 2, -th / 2 + 5, L + th, th, th / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fill();
    roundRectPath(ctx, -th / 2, -th / 2, L + th, th, th / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    // direction chevrons (low/short -> high/long)
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 22; x < L - 10; x += 30) {
      ctx.moveTo(x - 3, -5);
      ctx.lineTo(x + 2, 0);
      ctx.lineTo(x - 3, 5);
    }
    ctx.stroke();
    // sweet band (computed from physics) — its fill fades with difficulty, but the
    // edges are always drawn at a fixed, readable opacity so the target never vanishes.
    const ba = clamp(shot.bandAlpha, 0, 1);
    const lo = band.lo * L;
    const hi = band.hi * L;
    if (ba > 0.01) {
      const pulse = 0.85 + 0.15 * Math.sin(time * 6);
      roundRectPath(ctx, lo - 5, -th / 2 - 5, hi - lo + 10, th + 10, (th + 10) / 2);
      ctx.fillStyle = withAlpha(BAND, 0.3 * ba * pulse);
      ctx.fill();
      roundRectPath(ctx, lo, -th / 2 + 4, hi - lo, th - 8, (th - 8) / 2);
      ctx.fillStyle = withAlpha(BAND, ba);
      ctx.fill();
      const plo = band.perfLo * L;
      const phi = band.perfHi * L;
      if (phi - plo > 2) {
        roundRectPath(ctx, plo, -th / 2 + 7.5, phi - plo, th - 15, (th - 15) / 2);
        ctx.fillStyle = withAlpha('#F0FFF6', Math.min(1, ba * 1.2));
        ctx.fill();
      }
    }
    // band edge brackets: fixed opacity, poking out above and below the track
    const eh = th / 2 + 6;
    ctx.lineCap = 'round';
    ctx.lineWidth = 6.5;
    ctx.strokeStyle = 'rgba(8,40,28,0.4)';
    ctx.beginPath();
    ctx.moveTo(lo, -eh); ctx.lineTo(lo, eh);
    ctx.moveTo(hi, -eh); ctx.lineTo(hi, eh);
    ctx.stroke();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = BAND;
    ctx.stroke();
    // marker: a slim needle (~8px) so the green band stays visible on both sides of it
    const mx = t * L;
    const nw = RL.markerWidth * (1 + 0.3 * markerPop);
    const nh = (th + 2 * RL.markerOverhang) * (1 + 0.25 * markerPop);
    const mcol = mk.locked && lockColor ? lockColor : pal.accent;
    roundRectPath(ctx, mx - nw / 2, -nh / 2 + 3, nw, nh, nw / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    roundRectPath(ctx, mx - nw / 2, -nh / 2, nw, nh, nw / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = mcol;
    ctx.stroke();
    // pointer cap above the track (rail-local "up" is -y)
    const cy = -nh / 2 - 2;
    ctx.beginPath();
    ctx.moveTo(mx - 8, cy - 10);
    ctx.lineTo(mx + 8, cy - 10);
    ctx.lineTo(mx, cy);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = mcol;
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------ debug
  function drawDebug(w, T) {
    const s = w.shot;
    if (!s) return;
    const P = { x: T.sx(s.postX), bar: T.sy(s.bar), top: T.sy(s.top) };
    ctx.save();
    ctx.strokeStyle = 'rgba(40,220,100,0.95)';
    ctx.fillStyle = 'rgba(80,255,140,0.18)';
    ctx.lineWidth = 2;
    const o = PH.uprightOffset * T.k;
    ctx.fillRect(P.x - o, P.top, 2 * o, P.bar - P.top);
    ctx.strokeRect(P.x - o, P.top, 2 * o, P.bar - P.top);
    // tStar trajectory
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    const vx = s.powerC * Math.cos(s.thetaC);
    const vy = s.powerC * Math.sin(s.thetaC);
    for (let i = 0; i <= 60; i++) {
      const x = s.teeX + ((s.d + 80) * i) / 60;
      const tau = (x - s.teeX) / vx;
      const y = R + vy * tau - 0.5 * PH.gravity * tau * tau;
      if (i === 0) ctx.moveTo(T.sx(x), T.sy(y)); else ctx.lineTo(T.sx(x), T.sy(y));
      if (y < 0) break;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const lines = [
      `n ${s.made}  v ${s.speed.toFixed(3)}  W ${s.targetWidth.toFixed(3)}/${s.band.width.toFixed(3)}`,
      `D ${(s.band.width / s.speed).toFixed(3)}s (sched ${dwell(s.made, cfg).toFixed(3)})  L ${s.clock.toFixed(2)}s`,
      `band [${s.band.lo.toFixed(3)}, ${s.band.hi.toFixed(3)}]  s ${s.s.toFixed(2)}  fallback ${s.fallback}`,
      `phase ${w.phase}  cam z ${w.cam.zoom.toFixed(2)}  tier ${w.tier}`,
    ];
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(6, 64, 290, lines.length * 15 + 8);
    ctx.fillStyle = '#FFFFFF';
    lines.forEach((l, i) => ctx.fillText(l, 12, 78 + i * 15));
    ctx.restore();
  }

  // ------------------------------------------------------------------ public
  function resize(w, h, ratio) {
    cssW = Math.max(1, Math.round(Number(w) || 1));
    cssH = Math.max(1, Math.round(Number(h) || 1));
    dpr = clamp(Number(ratio) || 1, 1, V.maxDpr);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    if (canvas.style) {
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
    }
  }

  function draw(alpha = 1, frameDt = 0) {
    const w = game.world;
    const dt = clamp(Number(frameDt) || 0, 0, 0.1);
    const a = clamp(Number(alpha), 0, 1) || 0;
    update(dt);

    if (w.tier !== curTier) {
      palFrom = currentPalette();
      palTo = themePalette(themeId, w.tier);
      palT = 0;
      curTier = w.tier;
    }
    const pal = currentPalette();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    drawSky(pal);
    if (!w.shot) return;

    const c = w.cam;
    const zoom = lerp(c.pzoom, c.zoom, a);
    const k = (cssW / V.worldWidth) * zoom;
    const cx = lerp(c.px, c.x, a);
    const cy = lerp(c.py, c.y, a);
    const T = {
      k, cx, cy, viewW: cssW / k,
      sx: (x) => (x - cx) * k,
      sy: (y) => cssH - (y - cy) * k,
    };
    const skin = BALL_SKINS[skinId] || BALL_SKINS.classic;
    const theme = STADIUM_THEMES[themeId] || STADIUM_THEMES.day;

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
    spawnSkinFx(w, dt, skin);

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

    // theme decor (parallax)
    ctx.save();
    theme.drawDecor(ctx, { camX: cx, camY: cy, k, w: cssW, h: cssH, groundY: T.sy(0) }, pal, time);
    ctx.restore();
    ctx.globalAlpha = 1;

    drawField(pal, T);

    const pop = w.phase === 'idle' ? 1 : easeOutBack(clamp(w.shotAge / 0.42, 0, 1));
    if (w.oldPost) {
      drawPost(w.oldPost, 'far', pal, T);
    }
    drawPost(w.post, 'far', pal, T, pop);
    const teeA = w.phase === 'idle' || w.phase === 'intro' || w.phase === 'aim' ? 1
      : w.phase === 'fly' ? clamp(1 - w.flightTime / 0.4, 0, 1) : 0;
    drawTee(w.teeX, pal, T, teeA);
    drawCoin(w.pickup, T);
    drawTrail(T, skin);
    const ballScreen = drawBallAndShadow(w, T, a, skin);
    if (w.oldPost) drawPost(w.oldPost, 'near', pal, T);
    drawPost(w.post, 'near', pal, T, pop);
    drawParticles(T);
    drawRings(T);
    ctx.restore();

    drawAim(w, { x: ballScreen.x, y: ballScreen.y }, a, pal, T, skin);

    if (flash > 0.001) {
      ctx.fillStyle = withAlpha(flashColor, flash);
      ctx.fillRect(0, 0, cssW, cssH);
    }
    if (debug) drawDebug(w, T);
  }

  function setSkin(id) {
    skinId = BALL_SKINS[id] ? id : 'classic';
  }

  function setTheme(id) {
    themeId = STADIUM_THEMES[id] ? id : 'day';
    curTier = game.world ? game.world.tier : 0;
    palFrom = palTo = themePalette(themeId, curTier);
    palT = 1;
  }

  function destroy() {
    for (const u of unsubs) {
      try { u(); } catch (_) { /* ignore */ }
    }
    unsubs.length = 0;
    particles.length = 0;
    rings.length = 0;
    trail.length = 0;
  }

  resize(cssW, cssH, 1);
  return { resize, draw, setSkin, setTheme, destroy };
}

export default createRenderer;
