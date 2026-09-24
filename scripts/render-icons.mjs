#!/usr/bin/env node
// Renders the Android launcher icons, splash icon, Google Play hi-res icon and feature graphic from
// the game's icon artwork (same drawing as icon.svg), with headless Chrome. Run it again only if the
// artwork changes; the PNGs it writes are committed.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node scripts/render-icons.mjs
//   (or with playwright-core installed next to it; uses the installed Chrome: channel 'chrome')
//
// Writes:
//   android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png            legacy (API 24-25), rounded square
//   android/app/src/main/res/mipmap-*/ic_launcher_round.png                          legacy round
//   android/app/src/main/res/mipmap-*/ic_launcher_{foreground,background,monochrome}.png   adaptive layers (108dp)
//   android/app/src/main/res/drawable-*/splash_icon.png                              splash (288dp, icon in the 192dp circle)
//   docs/play/graphics/icon-512.png, docs/play/graphics/feature-graphic-1024x500.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureRGBA } from './png-rgba.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pwPath = process.env.PLAYWRIGHT_CORE;
const { chromium } = await import(pwPath ? pathToFileURL(pwPath).href : 'playwright-core');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const PLAY = path.join(ROOT, 'docs', 'play', 'graphics');

const SKY = '#4FC3F7';
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// ---- artwork (512 x 512 space, same shapes as icon.svg) ----
const scene = {
  sky: `<rect x="-600" y="-600" width="1712" height="1712" fill="${SKY}"/>`,
  sun: '<circle cx="400" cy="120" r="150" fill="#6FD0F9"/>',
  grass: '<path d="M-600 404h1712v700H-600z" fill="#46C46E"/><path d="M-600 404h1712v20H-600z" fill="#3AAE5F"/>',
  post: `<g stroke-linecap="round" fill="none">
    <path d="M318 404V300" stroke="#E0A800" stroke-width="22"/>
    <path d="M250 300h136" stroke="#FFD21F" stroke-width="22"/>
    <path d="M250 300V132M386 300V132" stroke="#FFD21F" stroke-width="22"/>
    <path d="M244 300V140" stroke="#fff" stroke-opacity=".45" stroke-width="5"/>
  </g>
  <path d="M250 122l-22 16 22 6z M386 122l-22 16 22 6z" fill="#FF8A3D"/>`,
  trail: '<path d="M98 372C132 266 190 212 262 196" stroke="#fff" stroke-opacity=".55" stroke-width="12" stroke-linecap="round" stroke-dasharray="2 26" fill="none"/>',
  ball: `<g transform="translate(300 210) rotate(-32)">
    <ellipse cx="0" cy="8" rx="78" ry="50" fill="#000" opacity=".12"/>
    <ellipse cx="0" cy="0" rx="78" ry="50" fill="#9C4A1E"/>
    <ellipse cx="-6" cy="-10" rx="58" ry="26" fill="#B65B27"/>
    <path d="M-58 -30c8 20 8 40 0 60M58 -30c-8 20-8 40 0 60" stroke="#fff" stroke-width="8" stroke-linecap="round" fill="none"/>
    <path d="M-30 0h60" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
    <path d="M-18 -11v22M-6 -11v22M6 -11v22M18 -11v22" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
  </g>`,
};
// Content scaled about the centre so it fits inside the adaptive-icon safe circle (66 of 108 dp).
const zoom = (s, inner) => `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">${inner}</g>`;
const svg = (inner, { clip = null } = {}) => {
  const defs = clip === 'round'
    ? '<defs><clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath></defs>'
    : clip === 'rrect'
      ? '<defs><clipPath id="c"><rect width="512" height="512" rx="112"/></clipPath></defs>'
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}<g${clip ? ' clip-path="url(#c)"' : ''}>${inner}</g></svg>`;
};
const ADAPT = 0.78;   // adaptive layers (content inside the 66dp safe circle)
const bgLayer = scene.sky + zoom(ADAPT, scene.sun + scene.grass);
const fgLayer = zoom(ADAPT, scene.post + scene.trail + scene.ball);
const full = (s) => scene.sky + zoom(s, scene.sun + scene.grass + scene.post + scene.trail + scene.ball);

async function shot(page, html, size, out, { transparent = true, w = size, h = size } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg,.art{display:block;width:${w}px;height:${h}px}
  </style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--mute-audio'] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  let n = 0;
  for (const [d, k] of Object.entries(DENS)) {
    const legacy = Math.round(48 * k);
    const layer = Math.round(108 * k);
    const splash = Math.round(288 * k);
    const dir = path.join(RES, `mipmap-${d}`);
    // Legacy icons (Android 7.x): the original rounded-square icon and a round version.
    await shot(page, svg(full(1), { clip: 'rrect' }), legacy, path.join(dir, 'ic_launcher.png'));
    await shot(page, svg(full(0.86), { clip: 'round' }), legacy, path.join(dir, 'ic_launcher_round.png'));
    // Adaptive layers (Android 8+): 108dp, the launcher masks them (circle, squircle, ...).
    await shot(page, svg(bgLayer), layer, path.join(dir, 'ic_launcher_background.png'), { transparent: false });
    await shot(page, svg(fgLayer), layer, path.join(dir, 'ic_launcher_foreground.png'));
    // Android 13 themed icons: a one-colour silhouette of the foreground.
    await shot(page, `<div class="art" style="filter:brightness(0) invert(1)">${svg(fgLayer)}</div>`, layer, path.join(dir, 'ic_launcher_monochrome.png'));
    // Splash icon (288dp box, the system shows the central 192dp circle).
    const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 288" width="288" height="288">
      <defs><clipPath id="s"><circle cx="144" cy="144" r="96"/></clipPath></defs>
      <circle cx="144" cy="150" r="98" fill="#000" opacity=".12"/>
      <g clip-path="url(#s)"><svg x="48" y="48" width="192" height="192" viewBox="0 0 512 512">${full(0.86)}</svg></g>
      <circle cx="144" cy="144" r="93" fill="none" stroke="#fff" stroke-width="6"/></svg>`;
    await shot(page, splashSvg, splash, path.join(RES, `drawable-${d}`, 'splash_icon.png'));
    n += 6;
  }

  // Google Play hi-res icon: 512 x 512, full opaque square (Play applies its own rounded mask), saved as
  // a 32-bit PNG with alpha as Play asks (the screenshot is 24-bit RGB; ensureRGBA adds the alpha channel).
  await shot(page, svg(full(0.9)), 512, path.join(PLAY, 'icon-512.png'), { transparent: false });
  ensureRGBA(path.join(PLAY, 'icon-512.png'));

  // Feature graphic 1024 x 500 (no alpha). Kept free of small text; the key art sits in the middle.
  const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500" width="1024" height="500">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2FA8E6"/><stop offset="1" stop-color="#8ADCFB"/></linearGradient>
      <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4CCB73"/><stop offset="1" stop-color="#2E9E55"/></linearGradient>
    </defs>
    <rect width="1024" height="500" fill="url(#sky)"/>
    <circle cx="880" cy="70" r="190" fill="#fff" opacity=".13"/>
    <circle cx="880" cy="70" r="120" fill="#fff" opacity=".12"/>
    <g fill="#fff" opacity=".85"><ellipse cx="170" cy="92" rx="70" ry="22"/><ellipse cx="215" cy="78" rx="48" ry="26"/><ellipse cx="600" cy="60" rx="58" ry="16"/><ellipse cx="640" cy="50" rx="36" ry="20"/></g>
    <path d="M0 392h1024v108H0z" fill="url(#turf)"/>
    <path d="M0 392h1024v10H0z" fill="#3AAE5F"/>
    <g stroke="#fff" stroke-opacity=".5" stroke-width="4"><path d="M120 402l-60 98M330 402l-30 98M540 402v98M750 402l30 98M960 402l60 98"/></g>
    <g transform="translate(640 20) scale(0.74)">
      <g stroke-linecap="round" fill="none">
        <path d="M318 500V300" stroke="#E0A800" stroke-width="24"/>
        <path d="M200 300h236" stroke="#FFD21F" stroke-width="24"/>
        <path d="M200 300V40M436 300V40" stroke="#FFD21F" stroke-width="24"/>
        <path d="M193 300V50" stroke="#fff" stroke-opacity=".45" stroke-width="6"/>
      </g>
      <path d="M200 28l-24 18 24 7z M436 28l-24 18 24 7z" fill="#FF8A3D"/>
    </g>
    <path d="M560 380C620 250 720 190 850 150" stroke="#fff" stroke-opacity=".6" stroke-width="10" stroke-linecap="round" stroke-dasharray="2 24" fill="none"/>
    <g transform="translate(866 142) rotate(-28) scale(.62)">
      <ellipse cx="0" cy="8" rx="78" ry="50" fill="#000" opacity=".12"/>
      <ellipse cx="0" cy="0" rx="78" ry="50" fill="#9C4A1E"/>
      <ellipse cx="-6" cy="-10" rx="58" ry="26" fill="#B65B27"/>
      <path d="M-58 -30c8 20 8 40 0 60M58 -30c-8 20-8 40 0 60" stroke="#fff" stroke-width="8" stroke-linecap="round" fill="none"/>
      <path d="M-30 0h60" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
      <path d="M-18 -11v22M-6 -11v22M6 -11v22M18 -11v22" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
    </g>
  </svg>`;
  const logo = `<div style="position:absolute;left:70px;top:88px;transform:rotate(-4deg);transform-origin:left center;
      font:900 132px/0.86 'Arial Rounded MT Bold','Segoe UI Black','Segoe UI',system-ui,sans-serif;color:#fff;
      text-shadow:0 9px 0 rgba(0,0,0,.2);letter-spacing:1px">
      <div>FLICK</div><div style="color:#FFD21F">GOAL</div>
      <div style="margin-top:26px;font-size:34px;line-height:1;color:#fff;text-shadow:0 4px 0 rgba(0,0,0,.18);letter-spacing:.5px">One tap. Split the uprights.</div>
    </div>`;
  await shot(page, `<div style="position:relative;width:1024px;height:500px">${fg}${logo}</div>`, 0, path.join(PLAY, 'feature-graphic-1024x500.png'), { transparent: false, w: 1024, h: 500 });
  n += 2;
  console.log(`render-icons: ${n} PNGs written`);
} finally {
  await browser.close();
}
