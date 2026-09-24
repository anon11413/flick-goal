#!/usr/bin/env node
// Google Play phone screenshots (1080 x 1920, 9:16) rendered from the REAL game in headless Chrome.
//
//   1. serve the folder that CONTAINS this repo folder, e.g.  python -m http.server 8793
//   2. PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node scripts/play-screenshots.mjs http://localhost:8793/<repo-folder>/
//
// Writes docs/play/screenshots/0N-*.jpg. Each shot starts from a seeded save (coins, bests, owned
// stadiums) so no tutorial hints, "NEW" callouts or test placeholders appear. Shots: FIELD GOAL + ENDLESS,
// PRO + RETRO stadiums, menu, game over, store. One browser, closed at the end.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pwPath = process.env.PLAYWRIGHT_CORE;
const { chromium } = await import(pwPath ? pathToFileURL(pwPath).href : 'playwright-core');
const BASE = process.argv[2] || 'http://localhost:8793/v2-standard/';
const OUT = path.join(ROOT, 'docs', 'play', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ALL_STADIUMS = ['day', 'night', 'snow', 'sunset', 'arcade', 'pro_day', 'pro_night', 'pro_snow', 'pro_sunset', 'pro_arcade'];
function seed({ mode, stadium, ball = 'classic', slider = false }) {
  return {
    v: 2,
    coins: 3450,
    best: { field: 21, endless: 14 },
    bestYards: 58,
    mode,
    owned: { balls: ['classic', 'retro', 'pro', 'soccer', 'neon'], stadiums: ALL_STADIUMS, upgrades: slider ? ['aim_slider'] : [] },
    equipped: { ball, stadium },
    settings: { sound: false, haptics: true, aimSlider: true },
    tutorial: { kicks: 60 },
    ui: { endlessTried: true, calloutShows: 3, calloutDone: true },
    stats: { gamesPlayed: 1, totalGoals: 80, totalPerfects: 20, bestStreak: 9 },
    adState: { sessions: 0, lastInterstitialAt: 0, lastRewardedAt: 0 },
  };
}

const problems = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--mute-audio'] });
try {
  async function open(save) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    await ctx.addInitScript((s) => {
      try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('flickgoal.save2', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } } catch { /* ignore */ }
    }, save);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(BASE + (BASE.includes('?') ? '&' : '?') + 'qa', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__flickGoalBooted && window.__fg, null, { timeout: 15000 });
    await sleep(1200);
    return { ctx, page };
  }
  const ev = (page, fn, arg) => page.evaluate(fn, arg);
  const center = (page) => ev(page, () => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.72 }; });
  async function waitAim(page) { await page.waitForFunction(() => window.__fg.game.phase === 'aim', null, { timeout: 15000, polling: 16 }); }
  /** Tap when the marker is inside the sweet band. */
  async function goal(page) {
    await waitAim(page);
    const made0 = await ev(page, () => window.__fg.game.hud().made);
    await ev(page, () => new Promise((resolve) => {
      const g = window.__fg.game;
      (function poll() {
        if (g.phase !== 'aim') return resolve();
        const { marker, shot: s } = g.world;
        const tp = marker.t + (marker.dir || 1) * s.speed * 0.035;
        const m = s.band.width * 0.3;
        if (tp > s.band.lo + m && tp < s.band.hi - m) return resolve();
        requestAnimationFrame(poll);
      })();
    }));
    const c = await center(page);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForFunction((m0) => window.__fg.game.hud().made > m0 || ['miss', 'over'].includes(window.__fg.game.phase), made0, { timeout: 8000, polling: 16 });
  }
  async function miss(page) {
    await waitAim(page);
    await ev(page, () => new Promise((resolve) => {
      const g = window.__fg.game;
      (function poll() {
        if (g.phase !== 'aim') return resolve();
        const { marker, shot: s } = g.world;
        const tp = marker.t + (marker.dir || 1) * s.speed * 0.035;
        if (tp < s.band.lo - 0.15 || tp > s.band.hi + 0.15) return resolve();
        requestAnimationFrame(poll);
      })();
    }));
    const c = await center(page);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForFunction(() => window.__fg.router.current === 'gameover', null, { timeout: 15000 });
  }
  async function play(page, goals) {
    await page.locator('.play-big').first().tap();
    await page.waitForFunction(() => window.__fg.router.current === 'playing', null, { timeout: 8000 });
    for (let i = 0; i < goals; i++) await goal(page);
  }
  /** Screenshot while aiming, with the marker part-way across the rail. */
  async function aimShot(page, name) {
    await waitAim(page);
    await sleep(900);
    await snap(page, name);
  }
  async function snap(page, name) {
    const f = path.join(OUT, name + '.jpg');
    await page.screenshot({ path: f, type: 'jpeg', quality: 88 });
    console.log('shot', path.relative(ROOT, f));
  }

  // 1. FIELD GOAL, PRO day stadium, Aim Slider on
  let { ctx, page } = await open(seed({ mode: 'field', stadium: 'pro_day', ball: 'classic', slider: true }));
  await play(page, 4);
  await aimShot(page, '01-field-pro-aim-slider');
  await ctx.close();

  // 2. ENDLESS, PRO sunset stadium
  ({ ctx, page } = await open(seed({ mode: 'endless', stadium: 'pro_sunset', ball: 'pro' })));
  await play(page, 5);
  await aimShot(page, '02-endless-pro-sunset');
  await ctx.close();

  // 3. FIELD GOAL, RETRO night stadium
  ({ ctx, page } = await open(seed({ mode: 'field', stadium: 'night', ball: 'neon' })));
  await play(page, 3);
  await aimShot(page, '03-field-retro-night');
  await ctx.close();

  // 4. Menu, PRO night stadium
  ({ ctx, page } = await open(seed({ mode: 'field', stadium: 'pro_night', ball: 'classic' })));
  await snap(page, '04-menu-pro-night');
  await ctx.close();

  // 5. Game over with a new best (ENDLESS, RETRO sunset)
  const s5 = seed({ mode: 'endless', stadium: 'sunset', ball: 'soccer' });
  s5.best.endless = 3;
  ({ ctx, page } = await open(s5));
  await play(page, 5);
  await miss(page);
  await sleep(1600);
  await snap(page, '05-endless-gameover-new-best');
  await ctx.close();

  // 6. Store: stadiums tab scrolled to the PRO stadiums (some owned, some with prices)
  const s6 = seed({ mode: 'field', stadium: 'pro_day', ball: 'classic' });
  s6.owned.stadiums = ['day', 'night', 'pro_day', 'pro_night'];
  ({ ctx, page } = await open(s6));
  await page.locator('.menu .btn.round[aria-label="Store"]').first().tap();
  await page.waitForFunction(() => window.__fg.router.current === 'store');
  await page.locator('.tab[data-tab="stadiums"]').first().tap();
  await sleep(600);
  await ev(page, () => {
    const heads = Array.from(document.querySelectorAll('.store-section'));
    const pro = heads.find((el) => /PRO/.test(el.textContent)) || heads[heads.length - 1];
    if (pro) pro.scrollIntoView({ block: 'start' });
  });
  await sleep(900);
  await snap(page, '06-store-stadiums');
  await ctx.close();
} finally {
  await browser.close();
}
if (problems.length) {
  console.error('console / page errors:\n  ' + problems.join('\n  '));
  process.exit(1);
}
