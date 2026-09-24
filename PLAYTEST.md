# Flick Goal v2: playtest guide

## Run it locally

The game is static files with no build step. Serve the repo root with any static server:

```bash
cd flick-goal
python -m http.server 8765        # or: npx serve -l 8765 .
```

Open http://localhost:8765/. Don't open `index.html` straight from disk (`file://`), because browsers block ES modules loaded that way.

Unit tests (Node 18+; the Capacitor / Android tooling needs Node 22+):

```bash
npm test                          # = node --test "tests/*.test.mjs"
```

## Test v2 on your phone (step by step)

The v2 builds live in the branch worktrees next to the main repo (`C:\Users\ashau\flick-goal-branches\v2-standard`, later `v2-hard-perfect`). Serve the **branches folder**, so one server covers every build:

1. On the PC: `python devserver.py 8766 C:\Users\ashau\flick-goal-branches` (the no-cache dev server from the scratchpad; `python -m http.server 8766 --bind 0.0.0.0 --directory C:\Users\ashau\flick-goal-branches` also works, but the phone may then keep old files: reload twice after an update).
2. Find the PC's LAN IP with `ipconfig` (the "IPv4 Address", e.g. `192.168.1.23`).
3. On the phone (same Wi-Fi) open `http://192.168.1.23:8766/v2-standard/`.
4. Allow Python through the Windows firewall on "Private" networks if the page doesn't load.
5. "Add to Home Screen" gives the full-screen feel (portrait, no browser bars).
6. For a first-time player, clear the site's data in the phone browser (or `localStorage.clear()` from a `?qa` console). To replay only the slider tutorial use Settings → DEVELOPER → **Reset tutorial** (see Developer options).
7. Quick checklist on the phone: first kick = slider, second kick = slider fades, third = dots only; the mode button under BEST switches FIELD GOAL / ENDLESS without starting a run (double-tap it too); Store → STADIUMS → buy **Pro Day (HD)** after DEVELOPER **+10,000 coins** and play both modes; Store → UPGRADES → Aim Slider; Settings → Aim slider row.

All v2 builds on the same address share the `flickgoal.save2` save, so coins, items and BESTs carry over between v2/standard and v2/hard-perfect (see "Shared between v2 builds" below). The old `try/*` builds keep their own `flickgoal.save`.

## Play on your phone (same Wi-Fi, main repo)

1. Start the server bound to all interfaces: `python -m http.server 8765 --bind 0.0.0.0`
2. Find your computer's LAN IP:
   - Windows: `ipconfig` (the "IPv4 Address" line, e.g. `192.168.1.23`)
   - macOS: `ipconfig getifaddr en0`
3. On the phone, open `http://192.168.1.23:8765/`.
4. If it doesn't load, allow Python through the Windows firewall on "Private" networks. Check that both devices are on the same network, not a guest network.
5. For the full-screen feel, use "Add to Home Screen" (iOS Safari: Share, then Add to Home Screen; Android Chrome: menu, then Install app). It then opens without browser bars, in portrait.

Tips: turn the phone sound on (the game has synthesized SFX). Vibration works on Android only, because iOS Safari has no vibration API.

## What's new in v2

- **Two modes.** FIELD GOAL (default): every kick is a fresh field-goal attempt on the end line ("32 YD FG"), with the end zone, the kicking net and the stands behind it, and a camera swoop between kicks. ENDLESS: the original chained game. The next tee is where the ball stopped, the field and its yard numbers go on forever, and a "140 YDS" counter shows how far you've got. The counter is the ground gained, the same yards the painted field numbers show, so it climbs about 80 to 120 yards per goal and a good run reaches four figures (intended: it always matches the field). Both modes use the same difficulty (it depends on goals made).
- **Switching mode.** Tapping anywhere on the menu still starts a run straight away in the current mode. The white **mode button** under BEST switches FIELD GOAL / ENDLESS without starting a run. It has a red NEW badge until you've played Endless once. Returning players (3+ games) see a one-time bouncing "NEW: Endless mode! Tap to switch" bubble on up to 3 menu visits (a visit = opening the app or coming back from a run; Store / Settings round trips don't count). Dismissing it fades it out in place, so the mode button never jumps under your finger, and a quick second tap right after switching never starts a run. Each mode has its own BEST, and Game Over shows which mode you played (plus YDS and a FARTHEST! tag in Endless).
- **Aim slider tutorial.** Your very first kick shows the full power slider (track, green zone, needle). On your second kick the slider fades out about 1.4 s into the aim ("Now aim with the dots"). From the third kick on only the guide dots show: **bunched = too weak, evenly spaced = right, stretched = too strong**. Progress is saved per player and shared by both modes. Developer start-round runs don't use it up.
- **Aim Slider upgrade.** Store → UPGRADES → AIM SLIDER, 10,000 coins. Once bought, the slider shows on every kick. Switch it off and on again on the store card (IN USE / USE) or in Settings ("Aim slider", shown only once owned).
- **RETRO and PRO stadiums.** Store → STADIUMS has two sections: RETRO (the flat look; Day Game is free) and PRO GRAPHICS (HD). Prices: Day 400, Night 1,200, Snow 1,500, Sunset 1,800, Arcade 2,400. The ball is drawn in the equipped stadium's style. PRO stadiums use the HD art in both modes (see "Pro graphics" below).
- **New save.** v2 saves under `flickgoal.save2`. On the first launch it copies coins, owned items, the equipped ball and stadium, your best (into both modes), settings and No Ads from the old save once. The old save is never changed, so older builds on the same address keep their own progress.
- **Shared between v2 builds.** v2/standard and v2/hard-perfect on the same address use the same `flickgoal.save2`: coins, items, the tutorial and both BESTs carry over when you switch builds. This is on purpose, so you don't have to earn things twice. But v2/hard-perfect scores perfects higher (3 to 6 points, against 2 to 4 in v2/standard), so a hard-perfect run can set the BEST you then see in v2/standard. To compare the two builds fairly, note the BEST before you switch, or use Settings → Reset Progress (or a private browser tab) for each build.
- **v2/standard: the PERFECT core on the slider is a close guide, not exact** (unchanged from v1). The faint white core inside the green is estimated from the ideal arc. A tap right at its edge can very rarely score a normal goal instead of PERFECT (QA sampling: 4 of 1,914 taps inside the core). The green zone itself is exact: a tap inside it is always a goal. v2/hard-perfect's gold strip is measured from the real simulation and is exact.

## URL flags

| Flag | Effect |
|---|---|
| `?debug=1` | Debug overlay (goal window, nominal arc, band / speed / clock numbers, mode, style, aim mode, graphics tier), difficulty-schedule self-check in the console, `window.__fg` handle, and the settings footer shows the ads mode |
| `?qa` | `window.__fg` handle for console poking (`__fg.shop.addCoins(5000)`, `__fg.game`, `__fg.save.data`, `__fg.aim`, `__fg.debugState()`), plus the ads-mode footer. No overlay |
| `?smoke` | Same as `?qa` (used by the automated browser tests) |
| `?mode=field` / `?mode=endless` | Sets (and saves) the game mode at boot |
| `?slider=on` / `off` / `default` | Developer slider force for every kick (turns developer mode on). `default` = tutorial + upgrade rules |
| `?style=retro` / `?style=pro` | QA only: draws the equipped stadium's theme in that art style without owning it (not saved) |
| `?gfx=high` / `?gfx=low` | Forces the graphics tier of PRO stadiums (otherwise adaptive). Retro always runs at full quality |
| `?round=N` | Developer start round (1 to 200): runs begin at kick N, as if N-1 goals were made. Also turns developer mode on. See below |
| `?dev=1` | Developer mode on (Settings shows the DEVELOPER section); `?dev=0` turns it off |
| `?ads=off` | Runs as if `monetization.mode = 'off'`: every ad and IAP button is hidden, so you can check that the game is complete without them |

Handy console snippets (with `?qa`):

```js
__fg.shop.addCoins(10000, 'dev')           // test the store / Aim Slider
__fg.save.update(d => { d.lastGiftAt = 0 }) // make the free gift ready again
__fg.save.update(d => { d.tutorial.kicks = 0 }) // replay the slider tutorial
__fg.save.reset(); location.reload()       // fresh progress (keeps No Ads, settings, tutorial, mode)
localStorage.removeItem('flickgoal.save2'); location.reload() // re-run the one-time v1 import
localStorage.clear(); location.reload()    // truly fresh player
```

## Developer options

**On the phone:** open Settings and tap the logo / version block at the bottom **5 times** quickly. A "Developer mode ON" toast appears, and a **DEVELOPER** section shows up in Settings. Tap it 5 times again to turn developer mode off.

The DEVELOPER card has:

- **Start round** (-/+ and quick chips 1 … 100). Round R plays exactly like a normal run that already made R-1 goals (needle speed, window size, shot clock, distance, post heights, PERFECT window). Works in both modes. Score starts at R-1, streak and run coins at 0; Continue is available. Dev runs **never change BEST** (either mode) and never use up the slider tutorial; Game Over shows "DEV RUN · started R30". A **DEV · R30** badge shows on the menu and in the HUD.
- **MODE**: FIELD GOAL / ENDLESS, same as the menu button (never starts a run).
- **AIM SLIDER**: DEFAULT (tutorial + upgrade rules) / ON (slider every kick) / OFF (dots only). Takes effect from the next kick.
- **GRAPHICS (PRO STADIUMS)**: AUTO / HIGH / LOW quality tier for PRO stadiums.
- **+10,000 coins** and **Reset tutorial** (the next kick shows the full slider again, and the NEW badge / Endless bubble come back).
- A read-out line: "Tutorial kicks: 1 · next kick: FADE (tutorial)".

These settings live in their own localStorage key (`flickgoal.dev`), separate from the game save, and stay set across reloads. The background colour follows the score, so a dev start at round R shows the colour for score R-1. For release, set `dev.enabled: false` in `src/config.js`: that removes every way in (URL flags, the tap unlock and the section).

## What to look for

- **Slider tutorial.** Clear `localStorage`, then play: kick 1 has the slider and "TAP when the marker is in the GREEN"; kick 2's slider is readable for a moment then fades while the dots stay; kick 3 has only the dots and the "evenly spaced" hint. Does the handover from slider to dots feel natural? Is 1.4 s the right fade (`aim.fadeDelay` + `aim.fadeTime`)?
- **Dots only.** Play past score 15 in either mode, where the window gets narrow. Does reading the dots stay fair?
- **Mode button.** It should read as a button, switch with a bounce, and never start a run. Tapping anywhere else on the menu should start a run immediately.
- **Endless.** The field numbers keep counting up (10, 20 … 140 …), posts stand on the grass on a painted team-colour circle, the old post stays behind as you move on, and there's no end zone or net. After a game over far down the field, Play Again cuts back to the START line with a quick colour wipe.
- **Field Goal.** Fresh attempts, "32 YD FG" label, banner + camera swoop between kicks, the net catching the ball.
- **Economy.** Are coins earned fast enough for Pro Day (400) early on, and does 10,000 for the Aim Slider feel like a fair long-term goal?
- **Flow.** Menu, play, game over, continue, store, back, in both modes. Nothing should ever get stuck, and no browser pop-ups should appear.

## Pro graphics

The five PRO (HD) stadiums are the try/pro-graphics look, redrawn for the v2 on-field layouts. The field, post, tee and camera sit exactly where they do in RETRO, so a kick plays the same in either style. Only the art changes.

- **What to look at (FIELD GOAL):** textured turf with mowing stripes, a sky sheen on the far grass, and the grass darkening toward the camera. The end zone has shaded team paint and big painted words. The goal post is shaded metal on a foam pad, with flags and a shadow cast on the turf by the stadium light. The kicking net has metal poles, a two-layer mesh and a ripple when the ball hits it. Past the end line are photographers and the end-zone stands, full of shaded fans (some cheering with their arms up, caps and beanies). Behind the far wall is the stadium bowl with its crowd, LED boards and scoreboard, plus each theme's sky: sun rays and clouds, floodlight towers and a moon, snowy mountains and pines, palms and a glittering sea, the neon skyline.
- **What to look at (ENDLESS):** the same finish on the endless field. The posts stand on a shaded team-colour circle with a white rim, the yard numbers keep counting, and the stadium bowl keeps scrolling behind.
- **Balls:** all 15 skins are shaded and lit by the stadium's light (a warm backlight at sunset, a pink rim in the neon arcade). Fast kicks get a soft motion smear. The store's BALLS tab shows the shaded skins while a PRO stadium is equipped.
- **Effects:** turf chunks and a dust puff when you kick, glows on goals and post hits, a big bloom and extra sparkle on a PERFECT, two-sided confetti that catches the light, and snowflakes or pollen drifting in front of the camera.
- **Speed:** static scenery is drawn once into image layers and reused. Nothing is ever built while the ball is in the air; the next score tier's colours are prepared on the menu and between kicks. Most of a canvas frame's cost is not the JavaScript but the browser's GPU process turning the drawing into pixels, so the PRO art avoids the expensive kinds of drawing: field lines, hash marks and grids are plain rectangles, the sun, lamps, photographers, stars and glows are small pre-drawn images, confetti is rectangles, and the shaded ball is painted on a small side canvas. On a slow phone the game quietly switches to a lighter "low" tier at the next calm moment, never mid-kick: when the drawing code is slow, when frames keep arriving late (even if the code itself is fast), or within about 2 s on a very slow device. The low tier drops the turf grain, sun rays, big blooms, the blurred grass strip, the second net layer and the sideline tick marks, and renders at 2x instead of 3x. `?gfx=high` or `?gfx=low` forces a tier; so does the Developer "Graphics" switch. RETRO stadiums never switch tiers.
- **Measured on this PC** (headless Chrome, 390x844 at 3x, auto-play with the galaxy ball, forced HIGH tier; share of frames slower than 21 ms, the build before this fix pass → now, interleaved in one session): FIELD day 4-27% → 2-11%, night 12-57% → 2-13%, snow 5-42% → 2-16%, sunset 18-27% → 5%, arcade 48-85% → 9-28%; ENDLESS arcade 68% → 3%, the other themes 2-8% → 1-3%. GPU-process time per frame on arcade FIELD: aiming 12.8 → 7.9 ms, camera swoop 14.2 → 7-9 ms. RETRO in the same runs: 1-3%. The PC was busy with other work, so read these as ranges. `renderer.draw` itself went up (median about 3-4 ms, from about 2 ms), mostly the ball's side canvas. At 4x CPU slowdown the PRO low tier now runs about as fast as RETRO (median frame about 41-46 ms vs 40-48 ms). Both are limited by the on-field layout; the old sideline layout of try/pro-graphics reached 18 ms.
- **Please check on a real phone:** does the turf texture read as grass (not rain) at arm's length? Are the fans in the end-zone stands readable when the ball flies in? Does any stadium feel too dark at the bottom of the screen?

## Web vs Android app

The same `src/` code runs in three places. What each one shows is decided by the **build profile**
(`src/build-profile.js`; the committed copy is `dev`, and only the packaged `www/` copy is rewritten):

| Where | How to run | Ads | Purchases | Dev tools / URL flags |
|---|---|---|---|---|
| Local web / GitHub Pages playtests (`dev`) | static server, as above | mock "TEST AD" overlays | mock "TEST PURCHASE" sheet | on (`?qa ?round ?ads=off ?mode ...`) |
| Public web build (`web-release`) | `npm run build:web -- --profile web-release`, serve `www/` | none | none (all ad / purchase buttons hidden) | off |
| Android debug APK (`android-debug`) | GitHub Actions artifact `flick-goal-debug-apk` | real AdMob SDK, **always Google test ads** | RevenueCat (Test Store key if set, else the Google key) | developer panel on, URL flags ignored |
| Android release AAB (`android-release`) | GitHub Actions artifact `flick-goal-release-aab-...` | AdMob: `test` ad mode = Google test ads, `live` = your units | RevenueCat Google key | all off |

The web build never loads a native SDK: inside the Android app the plugins come from `window.Capacitor`
(no bundler), and outside it the game falls back to the mock (dev) or to nothing (release).

### Android project (Capacitor 8, Android only)

- `npm install` once (Node 22+), then `npm run build:web` (copies `index.html`, `styles.css`, `icon.svg`,
  `manifest.webmanifest` and `src/` into `www/`; tests / docs are never copied) and `npx cap sync android`.
  `npm run build:android-debug` / `build:android-release` chain build:web + cap sync + `scripts/android-config.mjs`
  (writes the AdMob app id from `src/config.js` into `android/app/src/main/res/values/admob.xml`, sets the version,
  and blocks release builds that would ship test IDs).
- **Gradle / the Android SDK are not run on this PC**: the APK / AAB are built by `.github/workflows/android.yml`
  on GitHub (JDK 21, Android SDK 36). Push code, open the Actions run, download the artifact.
- `android/` is committed (manifest edits: portrait, `appCategory="game"`, `singleTop`, AdMob app id meta-data,
  AD_ID; immersive full screen in `MainActivity.java`; icons + splash). `www/`, `node_modules/`, build outputs and
  the files `cap sync` regenerates are git-ignored.
- **Back button** (Android only, `src/platform/nativeShell.js`): pauses a run, resumes, goes back from Store /
  Settings, goes Home from Game Over, closes an open dialog, and on the menu asks "Quit Flick Goal?".
- Browser check of the Android flows with fake plugins (consent, ads, purchases, restore, Back button):
  `PLAYWRIGHT_CORE=<playwright-core/index.mjs> node tests/e2e/native-monetization.e2e.mjs http://localhost:8793/v2-standard/`
- Regenerate art (needs Chrome + playwright-core): `node scripts/render-icons.mjs` (launcher icons, splash, Play icon,
  feature graphic) and `node scripts/play-screenshots.mjs <server url>` (Play screenshots from the real game).

**Installing a debug APK:** download `flick-goal-debug-apk` from the Actions run, copy `app-debug.apk` to the
phone, open it and allow "Install unknown apps". Ads there are Google test ads ("Test Ad"). The coins tab of the
store appears once a RevenueCat key is in `src/config.js`.

**Going live** (accounts, IDs, Play Console, testing, production): `docs/play/OWNER_GUIDE.md`.

## Monetization in the code

Everything goes through `src/platform/monetization.js` (adapter; every promise resolves, `isBusy()` pauses the
game). Providers: `admob.js` (rewarded + interstitial + Google UMP consent), `revenuecat.js` (coin packs + No Ads +
restore, exactly-once coin ledger in the save) and the web mock. IDs and keys: the `store` block in `src/config.js`;
ad timing: `monetization`; products: `products` (`no_ads`, `coins_small`, `coins_medium`, `coins_large`,
`coins_mega`). Design and sources: `docs/MONETIZATION_PLAN.md`.

## Tunables in `src/config.js`

All numbers live in one file. Edit it, then reload.

| Area | Key | What it does |
|---|---|---|
| Modes | `modes.default` | Mode for new players (`'field'`) |
| | `modes.calloutMinGames`, `calloutMaxShows` | Who sees the one-time "NEW: Endless mode!" bubble (3+ games) and on how many menu visits (3) |
| Endless | `endless.nextTeeGap` | Next tee at least this far past the post just cleared |
| | `endless.settleMax`, `cutDist`, `continueCutDist` | Pause after a goal; when a new run / continue cuts the camera instead of gliding |
| | `endless.discRadius` | Size of the painted circle under Endless posts |
| Aim slider | `aim.fadeDelay`, `aim.fadeTime` | Kick 2: slider fully visible for `fadeDelay` s, then fades over `fadeTime` s |
| | `aim.tutorialKicks`, `aim.dotsHintUntilKick` | Tutorial length (2 kicks); the dots hint shows on a run's first shot until this many kicks |
| Store | `catalog.balls[]`, `catalog.stadiums[]` (`price`, `style`, `theme`) | Skin prices. Stadiums: RETRO ids `day`…`arcade`, PRO ids `pro_day`…`pro_arcade` |
| | `catalog.upgrades[]` | Aim Slider price (10,000) |
| Difficulty | `difficulty.speed` `{start, asym, scale}` | Aim sweep speed in rail-lengths per second (same for everyone, slider or not) |
| | `difficulty.band` | Width of the scoring window as a fraction of the rail. Keep `band/speed >= dwellMin` |
| | `difficulty.clock` | Shot clock in seconds |
| | `difficulty.distance`, `gap`, `barHeight` | Kick distance, goal window height, crossbar height ramp |
| | `difficulty.bandAlpha` | How visible the slider's green fill stays (0.95 fading to 0.45) |
| | `difficulty.dwellMin`, `reaction` | "Always beatable" guarantees (MATH.md). `npm test` fails if a change breaks them, in both modes |
| Scoring | `scoring.perfectFrac`, `perfectMaxPoints`, `tierEvery` | PERFECT window size, streak points cap, background colour change every N points |
| Coins | `economy.coinsPerGoal`, `coinsPerPerfectBonus`, `pickups.chance`, `pickups.value` | Coin earn rate |
| | `economy.gift` `{cooldownMs, min, max, step}` | Free gift (every 4 h, 25-50 coins) |
| | `economy.rewardedCoins`, `rewardedCoinsCooldownMs` | "Watch ad for coins" amount and cooldown |
| | `economy.continuesPerRun` | Continues per run (via rewarded ad) |
| IAP | `products[]` (`priceString`, `grants`) | Placeholder prices and what each pack grants |
| Ads | `monetization.mode` (`'mock'` or `'off'`), `interstitialEvery`, `minGamesBeforeInterstitial` | Ad frequency |
| Feel | `physics.gravity`, `restitutionPost`, `timing.introTime`, `timing.missDelay`, `timing.swoopTime` | Arc weight, post bounciness, pacing, Field Goal camera swoop |
| Field | `field.yard`, `field.netOffset`, `field.standsOffset`… | Field Goal field scale, kicking net and end-zone stands |
| Look | `view.zoomMax`, `view.slackBelow`, `view.hudReserve` | Camera framing (how big and how centred the action is) |
| | `rail.guideDots`, `guideStart`, `guideSpacing`, `guideRadius`, `guideOutline` | Guide dot count, distance from the ball, spacing at the ideal power, size and dark rim |
| | `rail.guideSpread`, `guideSoft` | How much the dot spacing stretches/bunches and how quickly it changes around the ideal kick |
| | `rail.lengthFrac`, `rail.thickness`, `rail.markerWidth` | Slider size and needle width |
| Graphics | `gfx.defaultQuality` | PRO stadiums' quality tier (`'auto'`) |
| Haptics | `haptics.*` | Vibration patterns (ms) |
