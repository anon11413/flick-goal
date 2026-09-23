# Flick Goal v2 — Build Plan (V2_SPEC)

Status: Engineer A delivered (see §15 for the as-built interface); pro style pending (Engineer B). Branch `v2/standard` (worktree `C:\Users\ashau\flick-goal-branches\v2-standard`, created from `full-game@1267f6f`).
Readers: **Engineer A** (gameplay, UI, core renderer, retro style) builds first. **Engineer B** (pro style) builds afterwards against what A delivers. The two engineers do not talk: this file is the contract. When A has to deviate from an interface described here, A **must** update §5 of this file (and list the deviation in §15 "As-built notes") before handing over.

Precedence: this file > `SPEC.md` (v1 base contract, still valid for everything not changed here) > `GAME_DESIGN.md` / `MATH.md`.

Hard rules (unchanged from v1): no build step, vanilla ES modules, no CDNs / web fonts / image files, relative URLs, no `alert/confirm/prompt`, no console errors or unhandled rejections, every storage access in try/catch, `npm test` = `node --test "tests/*.test.mjs"`. Scratch files (Playwright scripts, screenshots, node_modules) go in `C:\Users\ashau\AppData\Local\Temp\claude\C--Users-ashau\1253b867-0bcb-4c01-b567-66bcca9f92db\scratchpad\v2\<stage>\`, never in the repo. Never push. Commit only when your own instructions allow it. The PC is low on RAM: run one headless browser at a time and close it promptly.

---

## 1. Owner decisions (IDs used in the acceptance checklist, §13)

| ID | Decision |
|---|---|
| D1 | **Aim slider = tutorial + paid upgrade.** Kick 1 ever: full slider + hint "TAP when the marker is in the GREEN". Kick 2 ever: slider shown, then fades away during that aim, hint "Now aim with the dots — evenly spaced = right power". Kick 3+: guide dots only (try/no-slider's S-curve spacing, readability work and slower sweep, same curve for everyone). Tutorial progress is per player (in the save), shared by both modes, not consumed by dev runs. Store upgrade "Aim Slider" 10,000 coins (config): once owned the slider is always shown and can be switched ON/OFF (Settings row only when owned; store card USE / IN USE). try/hard-perfect's free Settings toggle is dropped. |
| D2 | **Two modes.** FIELD GOAL (default) = try/field-posts gameplay and look. ENDLESS = the chained v1 mechanic presented on an endless on-field look (turf, yard lines forever, running "140 YDS" counter, no end zone, no net, background stands continue). Menu stays one tap: tap anywhere plays the current mode. A mode chip under BEST switches mode without starting a run, bouncy animation, NEW badge until Endless is tried, one-time bouncing callout "NEW: Endless mode! Tap to switch" for returning players. Mode persists. Separate BEST per mode. Same difficulty curves (keyed on goals made). Dev start round works in both. |
| D3 | **Retro vs Pro graphics as stadiums.** Every stadium exists as RETRO (flat, field-posts look) and PRO (pro-graphics stylized realism, re-authored for the new on-field layout and for the endless field). Store STADIUMS tab has two labelled sections (RETRO, PRO GRAPHICS + HD badge). Retro Day Game free; retro prices as today; PRO priced higher, one cheap PRO hook. Card previews use the real renderer of each style. The ball is drawn in the equipped stadium's style (all 15 skins in both styles). Keep pro-graphics' performance architecture (pre-rendered layers built only between kicks, adaptive quality). Retro stays as fast as today. |
| D4 | **Keep** the developer Start round (dev.js, devPanel.js, touch unlock). **Add** to DEVELOPER: "+10,000 coins", "Reset tutorial", "Slider: default / force on / force off", mode quick switch. Everything else from v1 keeps working in both modes. |
| D5 | **Save:** new key `flickgoal.save2`, versioned, one-time import from `flickgoal.save` (never write the v1 key), shared by both v2 branches, try/catch everywhere, tolerant of unknown ids. |
| D6 | **Quality bar:** commercial-grade mobile game, Flappy-Hoops-clean UI, zero console errors, tests green incl. always-beatable guarantees for BOTH modes, 360x640 to 430x932 and desktop. |

---

## 2. Integration strategy (git)

Source branches and what v2 takes from each:

| Branch | Taken into v2/standard | How |
|---|---|---|
| `full-game` | base (v1 + dev start round) | v2/standard already starts here |
| `try/field-posts` | everything: engine field model (fieldEnd, fresh attempts, swoop, backstop/net/stands), yard snapping, field drawing, tests | `git merge --no-ff` (conflict-free) |
| `try/no-slider` | `src/engine/guide.js`, `tests/guide.test.mjs`, guide-dot drawing (`drawAim`/`drawGuide`), `difficulty.speed {0.40, 0.95, 16}`, `rail.guide*` config, hint copy + CSS | `git merge --no-ff`; one conflict hunk |
| `try/pro-graphics` | art + perf architecture (layer cache, prewarm, adaptive quality, pro balls, pro decor, lighting moods, pro FX, render tests) | **not merged.** A ports the style-agnostic core parts (layer cache, quality monitor, paint helpers); B ports the art into `src/engine/styles/pro/**`, reading sources with `git show try/pro-graphics:<path>` |
| `try/hard-perfect` | nothing in v2/standard | used later for `v2/hard-perfect` (Appendix A) |

### 2.1 Merge steps (Engineer A, phase A0)

Verified by a trial merge in a scratch worktree: field-posts merges with no conflicts; no-slider then conflicts in **one hunk** of `src/engine/render.js` (inside `draw()`), everything else auto-merges; after resolving, **all 102 tests pass** and the build boots with zero console errors (dots render over the field view).

```bash
cd C:/Users/ashau/flick-goal-branches/v2-standard
git merge --no-ff try/field-posts -m "Merge try/field-posts into v2/standard"
git merge --no-ff try/no-slider      # CONFLICT in src/engine/render.js
```
Resolution of the render.js hunk: keep the HEAD (field-posts) block entirely (swoop streaks, banner bookkeeping, tee label, attempt banner) and replace its single line
`drawRail(w, { x: ballScreen.x, y: ballScreen.y }, a, pal);` with no-slider's
`drawAim(w, { x: ballScreen.x, y: ballScreen.y }, a, pal, T, skin);`. Then `npm test` (expect 102 pass) and commit the merge (message e.g. "Merge try/no-slider into v2/standard").

Semantic hot-spots that auto-merged but must be revisited during the refactor (not bugs today, but they are replaced by v2 logic):
- `src/config.js`: no-slider's `rail.visible: false` (delete it in A3: replaced by aim-assist modes, §6), no-slider's slower `difficulty.speed` (keep), field-posts' `timing.settleMax: 0.15` + `field.*` + `timing.swoopTime` (keep for FIELD; ENDLESS gets its own `endless.settleMax`, §8.3).
- `src/main.js`: no-slider's `guideHintShown` / `showHintThisRun` rule (replaced by `aimAssist.hintFor`, §6.4); field-posts' `net` sfx (keep).
- `src/ui/hud.js`: no-slider's `CONFIG.rail.visible ? … : …` hint (replaced by three hint variants, §9.3).
- `SPEC.md` / `PLAYTEST.md`: both branches' paragraphs auto-merged side by side. Leave SPEC.md as the v1 base contract plus a pointer line at the top: "v2: see V2_SPEC.md (wins where they differ)". Rewrite PLAYTEST.md for v2 in phase A4.
- `tests/difficulty.test.mjs`: carries no-slider's spot values (v 0.40 at n = 0). Keep.

### 2.2 Before refactoring: record the retro performance baseline

On the merged tree (before any render refactor), A records the number of 2D-context calls of a standard frame (see §11.1 "retro budget") and hard-codes it in `tests/render.test.mjs`. This is the "retro stays as fast as today" guard.

### 2.3 Phases and commits

| Phase | Owner | Content | Commit (if allowed) |
|---|---|---|---|
| A0 | A | merges §2.1, baseline §2.2 | 2 merge commits |
| A1 | A | engine modes (`game.js`), `field.js` extraction, engine tests | "Engine: FIELD GOAL + ENDLESS modes" |
| A2 | A | renderer split: core + `styles/retro` + `styles/pro` stub, `layers.js`, `quality.js`, `paint.js`, `themes.js`, `preview.js`, `aimDraw.js`, skins facade, style contract tests | "Renderer: layout x style architecture, retro style" |
| A3 | A | save v2 + import, catalog/shop upgrades, aim assist, UI (menu chip, HUD, game over, store, settings, dev panel), QA flags | "v2 gameplay/UI: aim tutorial + upgrade, modes, store sections, save v2" |
| A4 | A | Playwright pass (§11.2), docs (PLAYTEST.md, §15 as-built notes) | "v2 docs + fixes" |
| B1 | B | `src/engine/styles/pro/**` port + `tests/style-pro.test.mjs` + PLAYTEST "Pro graphics" subsection | "Pro graphics style for field + endless layouts" |

---

## 3. Target architecture

Two independent axes:
- **Mode (layout) axis** — `'field' | 'endless'`. Owned by the engine (`game.js`); the renderer reads `world.mode`.
- **Style axis** — `'retro' | 'pro'`. Chosen by the equipped stadium (catalog entry `style`). Owned by the renderer (`render.js` picks a style module); the engine never knows about style.

Any stadium can be played in any mode: 5 themes x 2 styles x 2 modes = 20 scene variants, all built from the same geometry (`field.js`) and the same palettes (`themes.js`).

### 3.1 File map and ownership

| Path | Owner | Role |
|---|---|---|
| `src/config.js` | A | + keys in §8.3 |
| `src/engine/difficulty.js`, `physics.js`, `guide.js` | A | unchanged from the merge (solver is mode-agnostic) |
| `src/engine/game.js` | A | + mode axis (§4) |
| `src/engine/field.js` | A | **new**, pure geometry: projection, ground frames, field constants, yard helpers, endless helpers, backstop geometry constants (moved out of field-posts `skins.js` / `game.js`) |
| `src/engine/themes.js` | A | **new**, base theme data: `THEMES = {day, night, snow, sunset, arcade}` with `name`, `palettes` (field-posts palettes incl. `zone`), `field` descriptor (`surface`, `wall`, `lights`, `words`), `crowd` colours |
| `src/engine/paint.js` | A | **new**, colour/path/gradient helpers ported from try/pro-graphics `skins.js` (superset of v1): `mixColor` (memoised), `withAlpha`, `mixPalette`, `memo`, `cachedGradient`, `fillPathV/H/R`, `fillRectV`, `softSpot`, `roundRectPath`, `hash`, `wrap`, `circlePath`, `ellipsePath` |
| `src/engine/skins.js` | A | **facade** kept for existing imports: re-exports paint helpers; `BALL_META`; `BALL_SKINS` (compat); stadium registry helpers; `drawBall`, `drawBallPreview`, `themePalette`, `drawStadiumPreview` (delegates to `preview.js`) |
| `src/engine/layers.js` | A | **new**, offscreen layer cache + palette crossfade blits + prewarm + bitmap promotion/touch (port of pro-graphics `render.js` "offscreen caches" section) |
| `src/engine/quality.js` | A | **new**, adaptive quality monitor (port of pro-graphics "adaptive quality" section) |
| `src/engine/aimDraw.js` | A | **new**, pure screen-space aim cue drawing: `railGeometry`, `drawRailTrack`, `drawGuideDots` (moved out of render.js; used by the game and by the store's Aim Slider card) |
| `src/engine/preview.js` | A | **new**, store previews drawn through the real style code (§5.7) |
| `src/engine/render.js` | A | **core**: canvas/dpr, camera interpolation, frame object, event juice state, trail, tier crossfade, style dispatch, aim cues, field overlays (tee label, banner, swoop streaks, ghost ball), mode wipe, flash, debug, quality + layers wiring |
| `src/engine/styles/index.js` | A | `STYLES = { retro, pro }`, `getStyle(id)` |
| `src/engine/styles/retro/*.js` | A | retro style (field-posts art): `index.js`, `balls.js`, `decor.js`, `field.js`, `props.js`, `fx.js` |
| `src/engine/styles/pro/index.js` | A creates a **stub** (re-exports retro with `id: 'pro'`), B replaces |
| `src/engine/styles/pro/**` | **B** | pro style (pro-graphics art re-authored for both layouts) |
| `src/aimAssist.js` | A | **new**, pure slider/tutorial/hint rules (§6) |
| `src/modes.js` | A | **new**, pure mode helpers: `MODES`, `otherMode`, `calloutVisible`, `nextCalloutState` (§9.1) |
| `src/dev.js` | A | + slider force + gfx override (§9.6) |
| `src/economy/save.js` | A | v2 schema + import (§7) |
| `src/economy/shop.js` | A | + `upgrade` kind, stadium style info (§8.2) |
| `src/main.js`, `src/ui/*`, `styles.css`, `index.html` | A | UI (§9) |
| `tests/*` | A (B adds `tests/style-pro.test.mjs`) | §11 |

B may only touch `src/engine/styles/pro/**`, `tests/style-pro.test.mjs` and the "Pro graphics" subsection of `PLAYTEST.md`. If B finds the interface lacking, B may add **optional** hooks to `render.js` (called only when the style defines them, retro unaffected, all tests green) and must list them in §15.

---

## 4. Engine: modes (`src/engine/game.js`, Engineer A)

The solver (`physics.solveShot`) is unchanged and translation-invariant, so the always-beatable guarantees hold for any tee position in both modes. Difficulty keys on `made` in both modes.

### 4.1 API changes

```js
createGame({ rng, cfg })          // unchanged
game.idle({ mode } = {})          // mode: 'field' | 'endless'; default = current mode (initially cfg.modes.default)
                                  // rebuilds the attract scene for that mode; emits 'modeChange' {mode} when it changed
game.newRun({ startMade = 0, mode } = {})   // mode default = current mode; sets world.mode for the run
game.continueRun()                // per-mode behaviour, §4.3
game.mode                         // getter: 'field' | 'endless'
game.hud()                        // + { mode, yards, attemptYards }
```
- `yards` (ENDLESS): `Math.max(0, Math.floor((world.teeX - world.originX) / cfg.field.yard))` = ground gained this run (the HUD counter). 0 in FIELD.
- `attemptYards` (FIELD): `world.yards` (the "32 YD FG" length). 0 in ENDLESS.
- Events: `runStart` payload becomes `{ startMade, mode, cut }` (`cut: true` when the camera was snapped instead of eased, see 4.3), `gameover` adds `{ mode, yards }`, new `modeChange {mode}`. `net` (field-posts) stays.
- `world` additions: `mode`, `originX` (x of the run's first tee; 0 in both modes), existing field-posts fields (`fieldEnd`, `yards`, `swoop`, `oldBall`, `freshBall`, `oldPost`).

### 4.2 FIELD GOAL mode = try/field-posts behaviour, unchanged
Fresh attempt every shot (`solvePlaced` + `shiftShot` onto `world.fieldEnd`), swoop, ghost ball, net + stands backstop (`backstop()` only in `freeStep` after resolution), `postGoalBox` framing post + net, `stadiumBackX`, `timing.settleMax` (0.15) + `SETTLE_CAP`. `idle({mode:'field'})` sets `fieldEnd` from the idle shot (field-posts `idle()`).

### 4.3 ENDLESS mode = v1 chained mechanic
Port the v1 (`full-game`) code paths behind `if (world.mode === 'endless')`:
- `beginShot(teeX, {keepOldPost})` = v1: `solveShot({ teeX, made, rng })` (no shift, no fieldEnd), `world.oldPost = keepOldPost ? previous post : null`, ball glides onto the tee (v1 `glide`), no swoop, `freshBall = false`, `world.yards` unused.
- `nextShot()` = v1: `teeX = Math.max(ball.x, post.x + cfg.endless.nextTeeGap)` (60), keep old post. The ball must clear the post and land beyond it; a doink that bounces back is still teed past the post.
- `stepSettle` = v1: next shot when the ball rests or `settleT >= cfg.endless.settleMax` (0.8).
- `postGoalBox` = v1 ball-centred box; `clampBallInView` never released (`stadiumBackX()` returns `Infinity`); **no `backstop()`**, no net, no stands physics.
- `idle({mode:'endless'})`: tee x = 0, `originX = 0`, one solved post (made 0), `oldPost = null`, `fieldEnd = null`.
- `newRun({mode:'endless'})`: `originX = 0`. If the ball is within `cfg.endless.cutDist` (300 u) of x = 0 (menu case) the ball glides onto the tee (v1). Otherwise (game over far down the field) teleport the ball to the tee at x = 0, `snapCamera()`, and emit `runStart {cut: true}`; the renderer covers the cut with the mode wipe (§5.6).
- `continueRun()` in ENDLESS = v1: same tee (`world.shot.teeX`), new `solveShot` at the same `made`, glide if within `cfg.endless.continueCutDist` (400) else teleport + snap. `yards` does not reset.
- Pickups, scoring, tiers, clock, marker, miss rules, dev `startMade`: identical to FIELD.

### 4.4 Mode switching
`idle({mode})` is the only way to switch between runs; `newRun({mode})` may also switch (it calls the same scene reset first). Switching resets `fieldEnd` (FIELD) or `originX` (ENDLESS). The engine emits `modeChange` only when the mode actually changes.

---

## 5. Rendering architecture (Engineer A core + retro; Engineer B pro)

### 5.1 Renderer public API

```js
createRenderer(canvas, game, { cfg, debug, createCanvas })   // createCanvas: optional offscreen factory (tests)
renderer.resize(cssW, cssH, dpr)
renderer.draw(alpha, frameDt)
renderer.setSkin(ballId)                  // unknown -> 'classic'
renderer.setTheme(stadiumId)              // catalog stadium id ('day', 'pro_night', ...); unknown -> 'day'
                                          // resolves { style, theme } via the stadium registry, clears layers on change
renderer.setStyleOverride(styleId|null)   // QA only (?style=), render-style override without ownership
renderer.setAimAssist(mode)               // 'full' | 'fade' | 'off' — latched at the next shot (§6.3)
renderer.aimAssist                        // getter: mode latched for the current shot
renderer.setQuality('auto'|'high'|'low')  // pro-graphics semantics; retro ignores (always full dpr)
renderer.getQuality()                     // { mode, tier, pending, median, longShare, layersBuilt, layersBuiltInFlight, xfade }
renderer.setWarmTier(tier)                // pro-graphics dev pre-warm (main.js keeps calling it)
renderer.debugState()                     // { style, theme, mode, aimAssist, railAlpha, dotsAlpha, quality } for Playwright
renderer.destroy()
```

### 5.2 Frame object (built by the core once per frame, passed to every style call)

```js
f = {
  cfg, time, dt,                     // renderer clock (s), frame dt (0 while paused)
  w, h, dpr, edpr,                   // css size, device ratio, effective ratio used for the backing store
  k, camX, camY, viewW,              // interpolated camera (css px per world unit, bottom-left world corner)
  sx(x), sy(y),                      // world -> screen (css px)
  gy,                                // screen y of the play line (sy(0))
  mode,                              // 'field' | 'endless' (world.mode)
  fieldEnd, originX,                 // FIELD end line x / ENDLESS yard origin
  proj,                              // field.fieldProjection(fv, cfg) for this frame (pt, s, farY, wallBase, xMin, xMax, ...)
  fv,                                // the view record the projection was built from (+ spot, detail)
  spot,                              // { x: teeX, alpha, color } kick-spot line
  pal, palKey,                       // crossfaded palette and its cache identity
  theme, themeId,                    // THEMES[themeId] (base theme data)
  styleId,                           // 'retro' | 'pro'
  lowQ,                              // low quality tier active (pro only; retro always false)
  phase, inFlight,                   // world.phase; phase is 'fly' | 'settle'
  postX,                             // screen x of the current post (decor keeps props clear of it)
  layers,                            // layer API (§5.5); styles that do not cache ignore it
  makeCanvas(w, h),                  // offscreen canvas factory (null-safe)
  world,                             // read-only game.world
}
```

### 5.3 Style interface

Each style module default-exports an object. Every function receives the main `ctx` (css-px transform already applied, shake translation applied for world-anchored parts) and the frame `f`. All must be pure drawing (no DOM, no timers) and must tolerate any theme id and both modes.

```js
export default {
  id: 'retro',                            // 'retro' | 'pro'
  adaptive: false,                        // true => core runs quality.js and may cap dpr at 2 (pro)
  // --- scene, in draw order ---
  drawSky(ctx, f),
  drawBackground(ctx, f),                 // theme decor standing on the far wall (groundY = f.proj.farY), parallax, continues forever
  drawField(ctx, f),                      // turf + markings for f.mode:
                                          //   field: field-posts drawField (end zone(s), numbers, hashes, pylons, far wall,
                                          //          team area, behind-end-line apron + photographers + end-zone stands, kick spot)
                                          //   endless: infinite turf (§5.8)
  drawNet(ctx, post, f, netFx),           // FIELD only (core never calls it in ENDLESS). netFx = {t, y, amp}
  drawPostShadow(ctx, post, f, pop),      // may be a no-op (retro)
  drawPost(ctx, post, part, f, pop),      // part 'far' (base, stem, far upright, crossbar [+ ENDLESS base disc]) | 'near'
  drawTee(ctx, x, f, alpha),
  drawCoin(ctx, pickup, f),
  drawTrail(ctx, trail, skinId, f),       // trail = [{x, y}] world
  drawBallShadow(ctx, st, f),             // st = ballState (below)
  drawBall(ctx, skinId, st, f),           // uses this style's ball skins; st.alpha for the ghost ball
  drawEffects(ctx, fx, f),                // fx = { particles, rings, glows } (world units)
  drawFront(ctx, f),                      // near-camera overlays (pro foreground strip, theme front fx); retro no-op
  drawFinish(ctx, f),                     // screen-space finishing (pro vignette); retro no-op
  // --- hooks ---
  onFx(name, e, api, f),                  // style-specific extra juice for game events (see 5.4)
  // --- assets ---
  balls,                                  // { [skinId]: { draw(ctx, r, time, rot, light) } } — keys = catalog ball ids
  lightFor(themeId),                      // light mood passed to ball draws (retro: null)
  previewBall(ctx, skinId, size, time),   // store ball card
};
```
`ballState st = { X, Y, r, rot, sx, sy, angle, lift, alpha }` is computed by the core (field-posts `drawBallAndShadow` / pro-graphics `ballState` math: interpolation, squash/stretch, tee lift).

### 5.4 Core responsibilities (render.js)

- Event subscriptions and juice **state**: particles, rings, glows, shake, flash, squash, markerPop, lockColor, trail, timers, netFx, post telescoping tween (`displayPost`), banner clock, mode wipe. Particle physics update is core (`update(dt)`).
- **Core vs style juice rule:** every event reaction that is identical in field-posts `render.js` and pro-graphics `render.js` stays in the core; anything that differs moves into `style.onFx(name, e, api, f)`. (Examples: squash/markerPop/lockColor/shake/flash/rings/confetti are core; pro's turf chunks, puffs, glows and retro's white land dust are style.) `api` = `{ confetti, sparks, dust, puffs, starBurst, sparkle, addParticle, addGlow, ring, shake, flash, squash, rand }`.
- Skin trail FX (`spawnSkinFx` for fire / sparkle / frost / pixel skins): core.
- Palette crossfade on tier change (0.8 s): core; `f.pal` is the mixed palette, the layer API crossfades cached layers itself.
- Overlays in screen space after the world: FIELD only — swoop streaks, tee label ("32 YD FG"), attempt banner; both modes — aim cues (§6.3), mode wipe, flash, debug overlay.
- Ghost ball (FIELD swoop): core calls `style.drawBall` with `st.alpha`.
- ENDLESS: the old post (`world.oldPost`) is drawn like the current one; post pop-in uses v1 `shotAge` easeOutBack. FIELD: posts use field-posts' telescoping tween (`pop = 1`).

Draw order (both styles):
```
update(dt); tier crossfade; setTransform(edpr); layers.touchPending(); style.drawSky
if (!world.shot) return
build f (camera, proj, spot, …); trail samples; spawnSkinFx
save; translate(shake)
  style.drawBackground → style.drawField
  FIELD: style.drawNet(post)
  style.drawPostShadow(oldPost?) ; style.drawPostShadow(post)
  st = ballState(); style.drawBallShadow(st)
  oldPost? drawPost(oldPost,'far') ; drawPost(post,'far')
  FIELD: ghost ball
  style.drawTee ; style.drawCoin ; style.drawTrail ; style.drawBall(st)
  oldPost? drawPost(oldPost,'near') ; drawPost(post,'near')
  style.drawEffects ; style.drawFront
restore
style.drawFinish
FIELD: swoop streaks, tee label ; aim cues ; FIELD: attempt banner ; mode wipe ; flash ; debug
layers.prewarm()
```

### 5.5 Layers and quality (A ports, B uses)

`src/engine/layers.js` exports `createLayers({ getPhase, makeCanvas, bgScale, debug })` with exactly the pro-graphics semantics: `layer(c, key, w, h, draw, x, y)` where `draw(c, pal)` paints a `w x h` tile at the origin; entries keyed by layer key -> palette key -> size slot; crossfades between `palKeyFrom`/`palKeyTo`; **never builds while `phase` is `fly` or `settle` when an older layer can stand in**; `prewarm()` builds at most one missing layer per ~0.1 s in calm phases (idle, intro, miss, over; never aim, never flight), including the next tier and the dev warm tier; ImageBitmap promotion + one-time off-screen touch; eviction past 90 layers; `clear()` on theme/size/quality change; `stats` (`built`, `inFlight`). Keys must be prefixed by the style id (`'pro:stands'`) so styles never collide.

`src/engine/quality.js` exports the pro-graphics monitor (rolling 90-frame window, median draw ms > 5 or long-frame share rule, two strikes, switch to low only at a calm phase, `setQuality` override). The core runs it only while the active style has `adaptive: true`; the low tier sets `f.lowQ = true`, caps the backing store at 2x dpr and layer scale at 1x (pro-graphics behaviour). Retro: no monitoring, full dpr, `lowQ` always false.

A direct (non-caching) layer API is also exported, `directLayers(pal)` (a factory bound to a palette, §15), which draws `draw(c, pal)` straight onto the target inside a clipped translate; previews use it (pro-graphics decor already supports "cache absent -> drawn directly").

### 5.6 Mode wipe
On `modeChange`, and on `runStart` with `cut: true`, the core draws a full-screen fill in `pal.skyTop` fading from alpha 1 to 0 over 0.35 s (ease-out) above the world and below the aim cues. Cosmetic only (frameDt-driven).

### 5.7 Previews (`src/engine/preview.js`, A)

```js
drawStadiumPreview(ctx, stadiumId, w, h, { mode = 'field', time = 1.3 } = {})
drawBallPreview(ctx, skinId, size, time = 0, styleId = 'retro')
drawAimSliderPreview(ctx, w, h, time)          // store Aim Slider card (aimDraw.js rail + dots)
```
`drawStadiumPreview` builds a synthetic frame (fixed camera, `mode: 'field'`, post at x = 0 on the end line with bar 90 / top 250, tee 230 u in front with the classic ball, `fv.tilt = 0.22`, `detail` by size as field-posts does), uses `directLayers`, `lowQ = true` for pro, and calls the same style functions in the §5.4 order (sky, background, field, net, post, tee, ball). So every card is drawn by the real renderer code of its style. The store caches finished preview canvases per `(stadiumId, w, h, dpr)` in a module-level Map and draws PRO previews one per animation frame after the grid appears (placeholder = palette sky gradient), so opening the tab never hitches.

### 5.8 ENDLESS field look (both styles; A authors retro, B authors pro)
Geometry from `field.js` (same projection, borders, far wall, team area, hash depth as FIELD):
- Turf, 5-yard mowing stripes and 5-yard lines tiled forever in both directions, anchored at `originX` (x = originX + 5·U·j). No end zones, no goal lines, no pylons, no photographers, no end-zone stands, **no net**.
- Hash marks every yard, sideline borders and the near team area continuous.
- Yard numbers every 10 yd for x > originX, painted as `Math.round((x - originX) / U)` (10, 20, … 140, … 1000), near side upright, far side upside down, no arrows; numbers wider than 3 digits are x-scaled to fit 6 yd.
- Start line at `originX`: goal-line-width line plus the word "START" painted near-side at 45 % alpha.
- Post on the turf at the play line with a painted team-colour **base disc**: ellipse via `groundFrame` of radius `endless.discRadius` (22 u) in `pal.zone` (retro α 0.85), 2 u white rim, drawn in `drawPostShadow` (as built, §15: so the ball shadow lies on top); the padded base as in FIELD.
- Background: theme decor on the far wall (stands/crowd parallax) continues exactly as in FIELD.
- `field.js` helpers: `endlessLineXs(xMin, xMax, originX, cfg)` and `endlessNumberAt(x, originX, cfg)`.

### 5.9 Skins facade and registry (`src/engine/skins.js`, A)
```js
export * from './paint.js';
export const BALL_META      // { [id]: { id, name, shape: 'football'|'round', trail, fx } } (v1 metadata)
export const BALL_SKINS     // compat: { [id]: { ...BALL_META[id], draw: retro draw } }
export function stadiumInfo(stadiumId) // -> { id, style: 'retro'|'pro', theme: 'day'|... } (unknown -> day/retro)
export function styleOf(stadiumId), themeOf(stadiumId)
export function themePalette(stadiumId, tier)   // accepts catalog ids AND base theme ids
export function drawBall(ctx, id, x, y, r, rot, time, sx = 1, sy = 1, styleId = 'retro', light = null)
export { drawBallPreview, drawStadiumPreview } from './preview.js'
export const STADIUM_THEMES // compat alias of THEMES (base themes)
```
The retro ball skins are the field-posts / v1 skins (field-posts did not change them); the pro ball skins are pro-graphics' (`draw(ctx, r, time, rot, light)` with a light mood).

---

## 6. Aim slider: tutorial + upgrade (D1)

### 6.1 Pure rules (`src/aimAssist.js`, A)

```js
export const AIM_MODES = ['full', 'fade', 'off'];

/** Slider mode for the NEXT shot. */
export function sliderMode({ devForce = 'default', owned = false, on = true, kicks = 0 }) {
  if (devForce === 'on') return { mode: 'full', reason: 'dev' };
  if (devForce === 'off') return { mode: 'off', reason: 'dev' };
  if (owned && on) return { mode: 'full', reason: 'upgrade' };
  if (kicks <= 0) return { mode: 'full', reason: 'tutorial' };
  if (kicks === 1) return { mode: 'fade', reason: 'tutorial' };
  return { mode: 'off', reason: 'default' };
}

/** Rail (track/band/needle) alpha multiplier while aiming; dots are never faded by this. */
export function railFade(mode, aimTime, cfg) {
  if (mode === 'full') return 1;
  if (mode === 'off') return 0;
  const u = (aimTime - cfg.aim.fadeDelay) / cfg.aim.fadeTime;   // 0.3 s hold, then 1.1 s fade
  return u <= 0 ? 1 : u >= 1 ? 0 : 1 - easeInOut(u);
}

/** First-shot hint for a shot: 'rail' | 'fade' | 'dots' | null. */
export function hintFor({ mode, reason, kicks, made, startMade, totalGoals, cfg }) {
  const firstOfRun = made === startMade;
  if (mode === 'fade') return 'fade';
  if (mode === 'full') return reason === 'tutorial' || (firstOfRun && totalGoals < 3) ? 'rail' : null;
  if (kicks === cfg.aim.tutorialKicks) return 'dots';                       // first slider-less kick ever
  return firstOfRun && kicks < cfg.aim.dotsHintUntilKick ? 'dots' : null;
}
```
Precedence (documented decision): dev force > owned-and-ON > tutorial > off. An owner who switches the slider OFF during their first two kicks still gets the tutorial.

### 6.2 Counting kicks (main.js)
- `save.tutorial.kicks` counts **flicks** (a kick is a flick; a shot that times out without a flick does not count, so the first real kick still gets the full slider).
- On `flick`: if `!isDevRun(game.hud())` → `save.update(d => { d.tutorial.kicks = Math.min(999, d.tutorial.kicks + 1); })`. Dev runs never consume tutorial kicks. Continues count normally. Both modes share the counter.
- After updating (and at boot, `runStart`, `continue`, upgrade purchase/toggle, dev force change, save external change) main recomputes `sliderMode(...)` and calls `renderer.setAimAssist(mode)`, and keeps `pending = {mode, reason}` for `hintFor` at the next `shotStart`.
- Imported v1 players start at `kicks = 0` too (decision: two kicks cost nothing and teach the new dots).

### 6.3 Renderer behaviour
- `setAimAssist(mode)` stores a pending mode; the renderer **latches** it when a new `world.shot` object appears, or immediately while the phase is `idle` / `over`. This keeps the rail of the kick in flight from changing mid-fade.
- Aim cues (core, via `aimDraw.js`), per frame, with `A = railAlpha(w)` (existing intro fade-in / flight fade-out):
  - rail track (track, green band, perfect core, brackets, needle, chevrons) alpha = `A * railFade(latched, aimTime)` where `aimTime = world.phaseTime` in `aim` (0 in intro, frozen at the flick value in fly). Skip drawing when < 0.01.
  - guide dots (no-slider `drawGuide`, S-curve spacing via `guide.js`) always at alpha `A`, in every mode (the slider teaches the dots).
- `debugState().railAlpha` / `.dotsAlpha` expose the last drawn values for tests.

### 6.4 Hints (HUD)
`hud.showHint(kind)` with kind `'rail' | 'fade' | 'dots' | null` (three variants in one element, CSS-swapped):
- `rail`: "TAP when the marker is in the **GREEN**" (existing v1 markup).
- `fade`: bold "Now aim with the dots" + small "Evenly spaced = right power" (no-slider dots glyph).
- `dots`: bold "TAP when the dots are evenly spaced" + small "Bunched = too weak · stretched = too strong" (no-slider markup).
Shown on `shotStart` using `hintFor`, hidden on `flick` / `miss` (as today).

### 6.5 The upgrade
- Catalog `upgrades: [{ id: 'aim_slider', name: 'Aim Slider', price: 10000 }]` (`upgrades.aimSliderPrice` is the price source; config-tunable).
- Buying sets `owned.upgrades += 'aim_slider'` and `settings.aimSlider = true` (ON).
- Store card (UPGRADES tab, §9.4): locked → price + progress; owned & ON → "IN USE" (tap turns it OFF, toast "Aim Slider off: aim with the dots"); owned & OFF → "USE" (tap turns it ON).
- Settings row "Aim slider" (icon `slider`, sub-label "On: slider every kick" / "Off: aim with the dots") appears only when owned.
- try/hard-perfect's free toggle, `settings.showRail` and `?rail=` are **not** ported.

---

## 7. Save v2 (`src/economy/save.js`, A) (D5)

### 7.1 Schema (key `flickgoal.save2`, `SAVE_VERSION = 2`)
```js
{
  v: 2,
  coins: 0,
  best: { field: 0, endless: 0 },
  bestYards: 0,                                  // ENDLESS farthest run (yards), non-dev runs only
  owned: { balls: ['classic'], stadiums: ['day'], upgrades: [] },
  equipped: { ball: 'classic', stadium: 'day' },
  settings: { sound: true, haptics: true, aimSlider: true },
  mode: 'field',
  tutorial: { kicks: 0 },
  ui: { endlessTried: false, calloutShows: 0, calloutDone: false },
  noAds: false,
  lastGiftAt: 0, lastRewardedCoinsAt: 0, adCounter: 0,
  stats: { gamesPlayed: 0, totalGoals: 0, totalPerfects: 0, bestStreak: 0 },
  importedV1: false,
}
```

### 7.2 Loading and import
```
raw = storage.getItem('flickgoal.save2')
if raw === null:
   v1 = storage.getItem('flickgoal.save')            // read only
   data = v1 !== null ? importV1(v1) : defaultSave()  // importV1 never throws; garbage -> defaults
   data.importedV1 = (v1 parsed to an object)
else:
   readOnly = rawVersion(raw) > 2
   data = migrate(raw)                               // a v:1-shaped object here is run through importV1 too
persist() writes ONLY 'flickgoal.save2'
```
`importV1` copies: coins (floored, capped at `MAX_COINS`), owned balls + stadiums (v1 ids are the retro ids), equipped (if owned), `best` into **both** `best.field` and `best.endless` (documented decision: both modes have identical difficulty per kick, ENDLESS is the v1 mechanic, and the player keeps the BEST they remember in the default mode), `settings.sound/haptics`, `noAds`, `lastGiftAt`, `lastRewardedCoinsAt` (clamped to now), `adCounter`, `stats.*`. Everything else takes defaults (`tutorial.kicks = 0`, `mode 'field'`, no upgrades).

### 7.3 Tolerance rules
- Every storage call in try/catch; memory fallback as v1 (`persisted === false`).
- Numbers coerced as v1. `mode` must be `'field'|'endless'` else `'field'`. `tutorial.kicks` integer in [0, 999].
- **Unknown owned ids are preserved** (strings ≤ 64 chars, max 200 per list), so a newer or sibling build's purchases survive this build writing the save; the UI only lists catalog ids. Equipped ids must be known **and** owned, else defaults. Defaults are always owned.
- Unknown top-level keys are preserved shallowly (sibling-branch fields survive).
- `v > 2`: used in memory, never written (`readOnly`).
- Cross-tab `storage` events listened on `flickgoal.save2` only.
- `reset()`: wipes coins, owned (incl. upgrades), equipped, bests, bestYards, stats; keeps `noAds`, `settings`, gift/rewarded timers, `tutorial`, `ui`, `mode`.
- The v1 key is never written or removed (tested with a spy storage).

---

## 8. Catalog, shop, config

### 8.1 Catalog (`src/config.js`)
```js
catalog: {
  balls: [ /* unchanged 15 */ ],
  stadiums: [
    { id: 'day',        name: 'Day Game',     price: 0,    style: 'retro', theme: 'day' },
    { id: 'night',      name: 'Night Lights', price: 300,  style: 'retro', theme: 'night' },
    { id: 'snow',       name: 'Snow Bowl',    price: 500,  style: 'retro', theme: 'snow' },
    { id: 'sunset',     name: 'Beach Sunset', price: 600,  style: 'retro', theme: 'sunset' },
    { id: 'arcade',     name: 'Neon Arcade',  price: 800,  style: 'retro', theme: 'arcade' },
    { id: 'pro_day',    name: 'Day Game',     price: 400,  style: 'pro',   theme: 'day' },     // the PRO hook
    { id: 'pro_night',  name: 'Night Lights', price: 1200, style: 'pro',   theme: 'night' },
    { id: 'pro_snow',   name: 'Snow Bowl',    price: 1500, style: 'pro',   theme: 'snow' },
    { id: 'pro_sunset', name: 'Beach Sunset', price: 1800, style: 'pro',   theme: 'sunset' },
    { id: 'pro_arcade', name: 'Neon Arcade',  price: 2400, style: 'pro',   theme: 'arcade' },
  ],
  upgrades: [ { id: 'aim_slider', name: 'Aim Slider', price: 10000 } ],
},
defaults: { ball: 'classic', stadium: 'day' },
```
Pricing rationale: a typical early run earns ~15-25 coins plus gifts (25-50 / 4 h); Pro Day at 400 is reachable in the first sessions (cheaper than retro Snow) so players see HD early; the rest step above the most expensive retro stadium; the 10,000-coin slider is the long-term goal (or a Coin Vault IAP). UI display name for PRO stadiums = `name + ' HD'` in dialogs and toasts; cards show the plain name with an HD ribbon.

### 8.2 Shop (`src/economy/shop.js`)
- `KINDS.upgrade = { catalog: 'upgrades', owned: 'upgrades' }` (no equip).
- `items('stadium')` rows add `style`, `theme`; `items('upgrade')` rows `{ id, name, price, owned, active }`.
- `buy('upgrade', id)` → same results as balls; on success also `settings.aimSlider = true`; emits `owned` then `upgrade`.
- `upgradeActive(id)`, `setUpgradeActive(id, bool)` (only when owned; emits `{type:'upgrade', id, active}`).
- `addCoins(n, 'dev')` accepted source for the dev button.

### 8.3 New / changed config keys
```js
version: '2.0.0',
aim: {
  fadeDelay: 0.3,          // kick 2: slider fully visible this long after aiming starts (s)
  fadeTime: 1.1,           // then fades to 0 over this (s)  => gone ~1.4 s into the aim
  tutorialKicks: 2,        // kicks 1-2 are the slider tutorial (1 full, 2 fade)
  dotsHintUntilKick: 6,    // dots hint on the first shot of a run while kicks < this
},
modes: {
  default: 'field',
  calloutMinGames: 3,      // "returning player" = gamesPlayed >= this
  calloutMaxShows: 3,      // callout shown on at most this many menu visits
},
endless: {
  nextTeeGap: 60,          // next tee >= post.x + this (v1)
  settleMax: 0.8,          // v1 settle cap (s)
  cutDist: 300,            // newRun: ball farther from x=0 => teleport + wipe
  continueCutDist: 400,    // continue: ball farther from the tee => teleport + snap
  discRadius: 22,          // painted base disc under endless posts (world units)
},
gfx: { defaultQuality: 'auto' },
save: { key: 'flickgoal.save2', version: 2, importKey: 'flickgoal.save' },
```
Remove `rail.visible` (replaced by aim modes). Keep every field-posts `field.*` / `timing.*` key and no-slider `rail.guide*` key and `difficulty.speed {start 0.40, asym 0.95, scale 16}`.

---

## 9. UI (Engineer A)

### 9.1 Menu: mode chip + NEW badge + callout (D2)
Layout inside `.menu-main`: logo, BEST pill, **mode block**, PLAY button, TAP TO PLAY, bottom row (unchanged).
- Mode block `div.mode-wrap[data-no-tap]` = optional callout (in flow, above) + chip.
- Chip `button.mode-chip` (≥ 44 px tall, 40 px on containers ≤ 680 px tall): white pill, ink text 16px/900, button drop shadow like other white buttons (and the `.light-theme` ring). Left icon 24 px: `goalpost` (orange) for FIELD GOAL, `infinity` (sky blue) for ENDLESS. Label "FIELD GOAL" / "ENDLESS". Right: `swap` icon (two arrows) in a 28 px `--soft` circle, so it reads as a control. `aria-label="Game mode: Field Goal. Tap to switch to Endless."`.
- NEW badge `span.mode-new` (red pill "NEW", 11 px, top-right, gentle wiggle) while `!ui.endlessTried`. `endlessTried` becomes true when a run starts in ENDLESS.
- Tap chip → `app.toggleMode()`: `save.mode = other`, `ui.calloutDone = true`, `game.idle({mode})` (scene swaps behind with the wipe), chip `.switching` animation (scale .9 → 1.12 → 1 over 320 ms, `--ease-bounce`; old label slides up out, new slides up in), BEST shows the new mode's best, sfx `whoosh`, haptic `tap`. It never starts a run (it is a `button` inside `[data-no-tap]`, so `fromUi` blocks both the capture-phase menu click and pointerdown). Reduced motion: no animation.
- Callout `button.mode-callout` (gold `#FFD21F` pill, ink 14 px/900, down arrow toward the chip, bounce translateY 0 → -6 px, 1 s loop): "NEW: Endless mode! Tap to switch". Tapping it = tapping the chip. Visible when `calloutVisible(save)`:
  `!ui.calloutDone && !ui.endlessTried && stats.gamesPlayed >= modes.calloutMinGames && ui.calloutShows < modes.calloutMaxShows`.
  Each time the menu route is entered with the callout visible, `ui.calloutShows += 1` (so it appears on at most 3 menu visits). Imported v1 players qualify immediately (their `gamesPlayed` is imported); new players after 3 games.
- The rest of the screen stays tap-to-play in the current mode (Space/Enter too).
- Must fit at 360x640 with the compact rules (verify the play button, TAP TO PLAY and bottom row stay fully visible and the callout never overlaps the play button).

### 9.2 Per-mode BEST and game over
- Menu BEST = `save.best[mode]`. `run.bestAtRunStart = save.best[mode]`.
- `gameover`: `d.best[e.mode] = nextBest(d.best[e.mode], e)`; ENDLESS non-dev: `d.bestYards = max(d.bestYards, e.yards)`. `quitToMenu` records per mode.
- Game Over card: small mode tag at the top ("FIELD GOAL" / "ENDLESS" with icon), SCORE, "BEST n" (this mode), ENDLESS adds a row with a flag icon "140 YDS" and a gold "FARTHEST!" chip when it beat `bestYards` (non-dev). NEW BEST logic unchanged per mode.

### 9.3 HUD
- ENDLESS: `div.hud-dist` pill under the clock bar: flag icon + "140 YDS", counts up over 400 ms when `hud().yards` changes, bump on change. Hidden in FIELD (FIELD keeps the in-canvas "32 YD FG" tee label and banner).
- Hints: three variants (§6.4).

### 9.4 Store
- Tabs: BALLS · STADIUMS · UPGRADES · COINS (COINS hidden when monetization is off). Tab icons hide below 520 px container width (as built, §15); labels shrink to `clamp(12px, 3.6cqw, 15px)`; the four labels must fit at 360 px.
- BALLS: ball previews drawn in the **equipped stadium's style** (`drawBallPreview(ctx, id, size, t, styleOf(equipped))`); the confirm dialog preview too.
- STADIUMS: section header "RETRO" (sub "Classic flat look"), 2-column grid of the 5 retro cards; section header "PRO GRAPHICS" + `span.hd-badge` "HD" (sub "Realistic lighting, turf & crowds"), grid of the 5 pro cards, each with an "HD" ribbon on the preview. Card states and buy flow as v1; equipping a stadium calls `renderer.setTheme(id)` (style switches, ball style follows) and `applyThemeChrome()`.
- UPGRADES: one hero card, full width: animated canvas (`drawAimSliderPreview`, 24 fps while visible: rail with sweeping needle, green band, guide dots), title "AIM SLIDER", text "See the power slider with the green zone on every kick. Switch it on or off any time.", state: locked → price pill 10,000 + progress bar "1,240 / 10,000" (tap: confirm "Buy Aim Slider? 10,000 coins" or shake + "Need N more coins" + Get coins action); owned → "IN USE" (green, check) / "USE" (sky) toggling as §6.5; fine print "Your first two kicks always show the slider."
- Buying an upgrade: sfx `buy`, confetti on the card, toast "Aim Slider unlocked! Switch it off any time in Settings."

### 9.5 Settings
Rows: Sound, Vibration, **Aim slider** (only when owned), Restore Purchases, Reset Progress, about/version (dev unlock target unchanged).

### 9.6 Developer panel additions (D4)
Inside the existing DEVELOPER card (`src/ui/devPanel.js`), below Start round:
- **Mode**: segmented [FIELD GOAL | ENDLESS] → `app.setMode(m)` (same path as the chip, no run started).
- **Slider**: segmented [DEFAULT | ON | OFF] → `dev.setSliderForce(v)` (persisted in `flickgoal.dev` as `slider`), recompute aim assist.
- **Graphics**: segmented [AUTO | HIGH | LOW] → `renderer.setQuality(v)` (persisted in `flickgoal.dev` as `gfx`; ignored by retro).
- Buttons: **+10,000 coins** (`shop.addCoins(10000, 'dev')` + coin fly) and **Reset tutorial** (sets `tutorial.kicks = 0`, `ui = {endlessTried: false, calloutShows: 0, calloutDone: false}`; toast "Tutorial reset: next kick shows the slider").
- Read-out line: "Tutorial kicks: 1 · next kick: FADE (tutorial)".
`dev.js` additions: `sliderForce()`, `setSliderForce('default'|'on'|'off')`, `gfx()`, `setGfx()`. `?slider=on|off|default` sets the force and turns developer mode on (like `?round`). `flickgoal.dev` stays the shared key; old builds that rewrite it drop the new fields (dev-only, acceptable).

### 9.7 QA URL flags (added)
`?mode=field|endless` (sets the saved mode at boot), `?style=retro|pro` (QA/debug only: `renderer.setStyleOverride`, not saved), `?gfx=high|low` (kept), `?slider=…` (§9.6). `window.__fg` adds `aim` (current `{mode, reason}`) and exposes `renderer.debugState()`.

---

## 10. Engineer B brief: PRO style (`src/engine/styles/pro/**`)

Goal: port try/pro-graphics' stylized realism into the §5.3 interface for **both** layouts, replacing the stub. Sources: `git show try/pro-graphics:src/engine/render.js`, `…/skins.js`, `…/tests/render.test.mjs`, plus the retro implementation in `src/engine/styles/retro/*` for the new layout geometry (`field.js` projection).

Suggested files: `index.js` (style object, `adaptive: true`), `lights.js` (pro-graphics `LIGHT` moods per theme), `balls.js` (all 15 pro skins, `draw(ctx, r, time, rot, light)`), `decor.js` (pro-graphics decor + stands/towers/mountains/palms/skyline/clouds tiles, standing on `f.proj.farY` instead of the old ground line), `field.js` (pro turf and markings in perspective for FIELD and ENDLESS), `props.js` (tube-shaded posts, cast shadows, net, tee, coin, base disc), `fx.js` (`onFx`, `drawEffects` with confetti dark faces, sparks, puffs, chunks, glows), `finish.js` (foreground strip, `drawFront` theme front FX, vignette).

Must deliver:
1. **FIELD layout in pro:** perspective turf (pro-graphics grain pattern anchored to world x and the play line, mower sheen, aerial-perspective darkening near camera), painted lines with wear, end zone paint with texture and camera-readable words, yard numbers, hashes, pylons, far wall per theme, team area, kick-spot line, the apron + photographers + **end-zone stands with crowd** past the end line (geometry must match `field.js` / `game.backstop` constants: wall at `post.x + standsOffset`, rise `standsRise`, depth `standsDepth`), kicking net with metal poles and shaded mesh + ripple (`netFx`).
2. **ENDLESS layout in pro:** §5.8 features with pro finish (grain, sheen, wear, pro base disc and pad).
3. **Balls:** all 15 skins lit by the theme light (`lightFor(themeId)`), ball shadow, trail.
4. **Perf architecture:** static scenery via `f.layers.layer(...)` (keys prefixed `pro:`), no per-frame `shadowBlur` / `ctx.filter` (only inside layer builds), cached gradients (`paint.js` helpers), no layer builds while `f.inFlight`, `f.lowQ` path (no grain/shafts/big blooms/crossfades). Previews must work with `directLayers`.
5. Tests `tests/style-pro.test.mjs`: port pro-graphics' render tests to run with the pro stadiums in **both modes** (menu → aim → flight → goal → tier fade; cached layers blitted; < 60 offscreen canvases, each ≤ 2048²; ≤ 6 gradients per 60 settled frames; every ball skin under every light; quality low/high/auto behaviour; **zero layers built in flight** incl. a mid-flight tier change; dev start round pre-warm). All existing tests stay green, including the style contract test (§11.1).

---

## 11. Tests

### 11.1 Unit tests (`node --test`)
Keep every merged test (field-posts + no-slider + v1). Update where the API changed (e.g. `STADIUM_THEMES` keys now equal the **base theme** ids; save schema v2). Add:
- `game.test.mjs` (A):
  - existing FIELD tests run unchanged (default mode `'field'`).
  - ENDLESS: next tee = `max(rest x, post.x + 60)`, the old post is kept, tees strictly advance, `hud().yards === floor((teeX - originX) / yard)`; no net/stands (a goal that flies past `post.x + netOffset` keeps flying); camera clamp never released.
  - **Always beatable in both modes:** for `mode ∈ {field, endless}` × seeds 1..8, 60 consecutive shots tapping at `band.tBest`, `band.lo + 1e-3` and `band.hi - 1e-3` all score (no miss) and the run never falls back; one ENDLESS run starting at `teeX` ≈ 50,000 u still scores at `tBest` (numeric stability).
  - ENDLESS continue: same tee, new shot, same `made`; newRun from far → `runStart.cut === true`, ball at x = 0.
  - `idle({mode})` emits `modeChange` only on change; `newRun({mode})` sets `world.mode`; `gameover` carries `mode` + `yards`.
- `dev.test.mjs`: start round in both modes gives the same difficulty parameters as a natural run; slider force persistence + `?slider=`.
- `aimAssist.test.mjs`: `sliderMode` truth table (incl. precedence), `railFade` values (1 at 0.29 s, ~0.5 near 0.85 s, 0 at ≥ 1.4 s), `hintFor` cases (kick 0 rail, kick 1 fade, kick 2 dots, first-of-run dots until kick 6, upgrade no hint unless totalGoals < 3).
- `modes.test.mjs`: callout visibility / counting / done rules; `otherMode`.
- `save.test.mjs`: v2 defaults; import from v1 (coins, owned, equipped, best → both modes, settings, noAds, timers, stats), import only when the v2 key is absent, garbage v1 → defaults, **v1 key never written** (spy storage records every `setItem` key), unknown ids and unknown top-level keys preserved, equipped unknown → default, `v: 3` save read-only, reset keeps tutorial/ui/mode/settings/noAds/timers, cross-tab ingest on the v2 key.
- `shop.test.mjs`: upgrade buy (insufficient / success / owned), `setUpgradeActive` only when owned, stadium rows carry `style`/`theme`, `'dev'` coin source.
- `style-contract.test.mjs` (A): for every style in `STYLES` (the pro stub, later the real pro): every interface function exists; `balls` keys equal catalog ball ids; for every theme × mode × tier 0..4 × viewports (390x844, 360x640) a full renderer frame sequence (idle, aim, fly, goal, settle, next shot; FIELD swoop; ENDLESS old post) draws against a validating stub ctx (finite args, non-negative radii — pro-graphics' `stubCtx`) without throwing; `drawStadiumPreview` for every catalog stadium; every catalog stadium resolves to an existing style and theme.
- `render.test.mjs` (A): aim assist latching (mode applied at the next shot, not mid-flight), `railAlpha` 0 in `off`, fade curve in `fade`, dots alpha unaffected; **retro budget:** a standard retro aim frame (day theme, FIELD, 390x844, dpr 3) creates **no offscreen canvases** and issues at most `1.15 ×` the ctx-call baseline recorded in §2.2 (same for an ENDLESS frame vs the same baseline); layers/quality modules unit-tested with a fake phase (no build in flight, prewarm only in calm phases).

### 11.2 Playwright (scratch dir `…\scratchpad\v2\<stage>\`, adapt `smoke/smoke.mjs` and `smoke/unlock-tap.mjs`)
Run against `http://localhost:8766/v2-standard/` (or a temporary devserver on 8790-8799). Fail on any console error/warning, page error, unhandled rejection, failed request or native dialog.
1. **Fresh player:** menu shows FIELD GOAL chip + NEW badge, no callout. Tap background → run starts (chip untouched). Kick 1: `renderer.aimAssist === 'full'`, rail hint visible, `debugState().railAlpha > 0.9`. Score it (set `marker.t = band.tBest` via `__fg`, or tap timing). Kick 2: `'fade'`, fade hint; screenshot at aim + 0.15 s (rail visible) and aim + 1.6 s (`railAlpha < 0.02`, dots visible). Kick 3: `'off'`, dots hint.
2. **Mode chip:** click the chip → route stays `menu`, phase `idle`, `save.mode === 'endless'`, chip has `.switching`, BEST shows the endless best. Reload → still ENDLESS. Play ENDLESS: `.hud-dist` visible and increases after goals; posts chain; game over card shows ENDLESS tag + YDS; per-mode bests stay separate; NEW badge gone after the first ENDLESS run.
3. **Callout:** preload a v2 save with `stats.gamesPlayed = 5` → callout visible; it disappears after 3 menu visits; with a fresh save + switch, it never appears again. Tapping the callout switches mode and does not start a run.
4. **Import:** clear storage, write a v1 save (`coins 1234`, owned `night`, equipped `night`, `best 17`, `noAds true`) to `flickgoal.save`, reload → coins 1234, Night Lights equipped, BEST 17 in both modes, No Ads button hidden; after playing a run the `flickgoal.save` string is byte-identical.
5. **Store:** STADIUMS shows RETRO and PRO GRAPHICS headers + HD badge, 5 + 5 cards, every preview canvas non-blank (pixel variance check). Dev +10,000 coins → buy Pro Day → `renderer.debugState().style === 'pro'`, ball drawn pro; UPGRADES → buy Aim Slider → IN USE, Settings shows "Aim slider", toggling OFF → next kick `aimAssist === 'off'`; ON → `'full'`.
6. **Dev panel** via the 5-tap touch unlock: Mode switch, Slider force ON/OFF/DEFAULT (next kick follows), Graphics LOW (`getQuality().tier === 'low'` on a pro stadium), Reset tutorial (next kick `'full'` + rail hint), start round 30 in both modes (DEV badge, dev run never changes BEST).
7. **Viewports** 360x640, 390x844, 430x932 (touch, dpr 3) and 1280x800 (mouse): screenshots of menu (both modes, with callout), HUD FIELD + ENDLESS, store STADIUMS + UPGRADES, game over both modes, settings with DEVELOPER; assert no horizontal overflow, chip/callout bounding boxes do not intersect the play button, bottom menu row fully inside the stage.
8. **Perf (report, not gate):** median `draw()` ms over 300 frames for retro day FIELD/ENDLESS and pro day/night FIELD/ENDLESS at 390x844 dpr 3; retro must not be slower than the merged field-posts baseline by more than 15 %; pro `layersBuiltInFlight === 0` after 10 kicks.
One headless Chrome at a time (`channel: 'chrome'`), `browser.close()` in `finally`.

---

## 12. Implementation notes for A (decisions that are easy to get wrong)

- The engine must stay DOM-free; `aimAssist.js` and `modes.js` are pure and imported by `main.js`.
- `renderer.setAimAssist` is latched per shot (§6.3). Do not compute the fade from wall-clock time; use `world.phaseTime` (sim time, freezes on pause).
- Guide dots are drawn in every aim mode; only the rail track fades.
- `difficulty.speed` stays no-slider's slower curve for everyone, including slider owners.
- The menu's capture-phase click handler must ignore the chip and callout (they are `button`s inside `[data-no-tap]`); do not stop propagation manually.
- `applyThemeChrome()` and the store background use `themePalette(equippedStadiumId, tier)` — the facade resolves pro ids to base themes.
- Style switching (`setTheme` from retro to pro or back) clears layers and resets the quality monitor; retro frames never run the monitor, and switching back to retro restores full dpr.
- `window.__fg` stays behind `?qa` / `?debug` / `?smoke`.
- Keep `CONFIG.dev.enabled: true` for playtesting; `false` still removes every dev path, including the new ones.

---

## 13. Acceptance checklist

| # | Check | Decision | Verified by |
|---|---|---|---|
| 1 | First kick ever: full slider + "TAP when the marker is in the GREEN" | D1 | PW1, aimAssist.test |
| 2 | Second kick ever: slider fades out ~1.4 s into the aim, "Now aim with the dots" hint | D1 | PW1, aimAssist.test, render.test |
| 3 | Third kick onward: dots only (S-curve spacing, slower sweep), dots hint on kick 3 | D1 | PW1, guide.test, difficulty.test |
| 4 | Tutorial counter persists, shared by both modes, dev runs don't consume it | D1 | aimAssist.test, dev.test, PW6 |
| 5 | Aim Slider upgrade 10,000 (config), always shown when owned + ON, USE / IN USE card, Settings row only when owned, no free toggle | D1 | shop.test, PW5 |
| 6 | FIELD GOAL = field-posts gameplay/look (fresh attempts, end zone, net, yard label, swoop) | D2 | game.test (field suite), PW7 screenshots |
| 7 | ENDLESS = chained mechanic, endless turf, yard numbers forever, "YDS" counter, no end zone, no net, background stands | D2 | game.test (endless suite), PW2, PW7 |
| 8 | One-tap menu; chip switches mode without starting a run, bouncy animation; NEW badge until Endless tried; one-time callout for returning players | D2 | PW2, PW3, modes.test |
| 9 | Mode persists; separate BEST per mode (menu + game over) | D2 | save.test, PW2 |
| 10 | Same difficulty in both modes; dev start round in both | D2 | dev.test, game.test |
| 11 | Every stadium in RETRO and PRO; store sections RETRO / PRO GRAPHICS + HD; prices per §8.1 | D3 | style-contract.test, PW5 |
| 12 | Card previews drawn by each style's real renderer | D3 | style-contract.test, PW5 pixel check |
| 13 | Ball drawn in the equipped stadium's style, all 15 skins in both styles | D3 | style-contract.test, style-pro.test, PW5 |
| 14 | PRO authored for the new FIELD layout and for ENDLESS | D3 | style-pro.test, PW7 screenshots |
| 15 | Pro perf: layers never built in flight, adaptive quality; retro as fast as today | D3 | style-pro.test, render.test retro budget, PW8 |
| 16 | Dev: Start round kept; +10,000 coins, Reset tutorial, Slider default/on/off, Mode switch (+ Graphics) | D4 | PW6 |
| 17 | Store balls, coins tab mock IAP / No Ads, gift, continue, 2x coins, pause, settings, mock ads work in both modes | D4 | v1 smoke flow run once per mode |
| 18 | Save key `flickgoal.save2`, one-time v1 import, v1 key never written, versioned, tolerant | D5 | save.test, PW4 |
| 19 | Zero console errors; `npm test` green; 360x640 → 430x932 + desktop | D6 | PW all, npm test |

---

## 14. Risks and open questions

- **Four store tabs at 360 px:** if the labels cannot fit legibly, the fallback (A decides and documents in §15) is to show the Aim Slider as a featured hero card at the top of the BALLS tab instead of an UPGRADES tab.
- **Pro end-zone stands cost:** the field-posts stands are drawn per frame in perspective; B should pre-render crowd strips as layers and blit them per row. If the pro FIELD frame stays above the 5 ms median on the dev PC, the low tier must drop crowd detail.
- **Mode chip on very short screens:** the menu gains ~50 px (chip) plus ~30 px (callout, temporary). The ≤ 680 px compact rules may need to shrink the play button to 96 px; verify at 360x640.
- **Imported BEST into both modes** is a product choice (§7.2); if the owner prefers ENDLESS-only, change one line in `importV1`.

---

## 15. As-built notes

### 15.1 Engineer A (v2/standard, phases A0-A4)

**Git.** A0 is two real merge commits on `v2/standard` (`Merge try/field-posts…`, `Merge try/no-slider…`, render.js hunk resolved as §2.1 says), then one feature commit for A1-A4. Retro baseline (§2.2): **2653** ctx calls for the standard aim frame (day, FIELD, 390x844, dpr 3, seed 3, slider off). The v2 renderer draws the same frame in 2650 calls (FIELD) and stays under 1.15x in ENDLESS (`tests/render.test.mjs`).

**Interface as built (what B codes against).** Everything in §5.1-§5.7 holds, with these exact details:

- **Style module**: `src/engine/styles/pro/index.js` default-exports the style object. The registry is `src/engine/styles/index.js`: `STYLE_IDS`, `STYLES`, `getStyle(id)` (unknown → retro), `STYLE_FUNCTIONS` (checked by `tests/style-contract.test.mjs`), and **`registerStyle(style)`**, a runtime registration hook that validates the interface and returns false without registering when a function is missing. B replaces the stub by editing `styles/pro/**` only; the registry already imports `./pro/index.js`.
- **The stub pro style** (`styles/pro/index.js`) = `{ ...retro, id: 'pro', adaptive: true, drawFinish }`. Its `drawFinish` paints a "PRO ART PENDING" tag on store previews only (`f.preview === true`). B's `drawFinish` replaces it (vignette), so the tag disappears on its own.
- **Style functions**: exactly the §5.3 list. `drawSky(ctx, f)` is called every frame before the `world.shot` check (so `f.proj` / `f.fv` may be null there); every other function gets a complete `f`.
- **`f` (frame)**: the §5.2 fields plus `preview` (true only in `engine/preview.js`), `fieldEnd` (FIELD end-line x, null in ENDLESS), `originX` (ENDLESS yard 0), `fv` = `{ w, h, k, camX, gy, endX, originX, mode, spot, detail }`, `proj = fieldProjection(fv)`. `f.layers` is the layer API below. `f.world` is null in previews.
- **Ball state `st`**: `{ X, Y, r, rot, sx, sy, angle, lift, alpha, wx, wy }`. `X, Y, r` are screen px (Y includes the tee lift). `rot` is the **canvas** rotation already negated (draw with `ctx.rotate(st.rot)` and pass `st.rot` to the skin). `sx, sy` are the squash along / across the axis `angle` (apply `rotate(-angle); scale(sx, sy); rotate(angle)` before `rotate(rot)`). `wx, wy` are the world position without the tee lift (for the ground shadow). `alpha` < 1 only for the FIELD ghost ball.
- **Balls**: `style.balls[id].draw(ctx, r, time, rot, light)` for all 15 catalog ids, drawn at the origin with the long axis along +x. `lightFor(themeId)` → light mood (retro: null). `previewBall(ctx, skinId, size, time)` draws a store card centred in a size x size box. Ball metadata (`shape`, `trail`, `fx`) is `BALL_META` in `engine/themes.js`. Trail colour and the fire / sparkle / frost / pixel trail particles are core.
- **ENDLESS post base disc**: retro draws it in **`drawPostShadow`** (called before the ball shadow), not in `drawPost(…,'far')` as §5.8 suggested, so the ball's shadow lies on top of the paint. `drawPostShadow` is therefore **not** a no-op in retro. B may draw the pro disc + cast shadow in `drawPostShadow` the same way. Radius `cfg.endless.discRadius`, via `groundFrame(ctx, f.proj, post.x, 0)`; the `pop` argument scales it with the post pop-in.
- **Events → `style.onFx(name, e, api, f)`**: called after the core's reaction for `flick`, `bounce`, `score`, `coin`, `net`, `land`, `miss`, `runStart`, `continue`, `modeChange`. `f` is the last built frame (outside `draw()`). `api` = `{ confetti, sparks, dust, puffs, starBurst, sparkle, addParticle, addGlow(x, y, r, color, a, dur), ring(x, y, dur, r0, r1, color, w, t0), shake, flash, squash, rand, ballPos }`. Core-owned reactions: flick squash / needle pop / lock colour; post-bounce squash + sparks + shake; ground-bounce squash; score confetti / stars / rings / flash / shake / doink sparks; coin sparkle + ring; net ripple + squash; miss shake + flash. Retro-only (`styles/retro/fx.js`): flick turf bits, ground-bounce dust, landing dust.
- **Effects**: `drawEffects(ctx, { particles, rings, glows }, f)`. Particle kinds `rect | circle | square | spark | star`; glows `{ x, y, r, color, a, t, dur }` (world units, `r` in world units).
- **Layers** (`engine/layers.js`): `createLayers({ makeCanvas, getScale, getPhase, getPalState, viewSize, promoteBitmaps, debug })` → `{ layer(c, key, w, h, draw, x, y), prewarm(dt, jobs), touchPending(ctx), clear(), hasLayer, stats: { built, inFlight }, count }`, with the pro-graphics semantics of §5.5. The core owns the palette state (`palFrom/To`, keys `'day:0'` via `palKeyOf`), prewarm jobs (current tier, dev warm tier on the menu, next tier) and calls `touchPending` / `prewarm` only while the style is `adaptive`. **`directLayers(pal)` is a factory**: it returns a non-caching API bound to that palette (previews use `directLayers(basePalette(theme, 0))`). Keys must be prefixed `'pro:'`.
- **Quality** (`engine/quality.js`): `createQualityMonitor()` → `{ sample(ms, dt, built, isLow), reset(), setMode(m), clearWant(), mode, wantLow, timing, stats }`. The core only samples while `style.adaptive`; the low tier sets `f.lowQ`, caps the backing store at 2x dpr and layer scale at 1x. Switching to a non-adaptive style (retro) drops back to full dpr. `renderer.getQuality()` adds `adaptive`.
- **Previews**: `drawStadiumPreview(ctx, stadiumId, w, h, { mode, time, style })` (the `style` option forces an art style for QA / tests). The synthetic frame: card-scaled post (bar ~30 % of the card height, top below the lock badge) on the end line at x = 0, tee 0.56 w / k in front, the classic ball in flight, decor drawn at phone scale and shrunk into the card (`drawBackground` receives a copy of `f` with `w, h, k, camX, camY, proj.farY` scaled), `lowQ: true`, `directLayers`. The store caches finished previews per `(id, w, h, dpr)` and draws uncached PRO previews one per animation frame.
- **Other modules**: `engine/stadiums.js` (`stadiumInfo`, `styleOf`, `themeOf`, `stadiumDisplayName`), `engine/themes.js` (`THEMES`, `CROWD`, `SKIN_TONES`, `BALL_META`, `basePalette`, `palKeyOf`), `engine/field.js` (`fieldProjection`, `quadPath`, `groundFrame`, `nearDepth`, `fieldMarks`, `standsGeometry`, `endlessLineXs`, `endlessNumberAt`, constants `FIELD_FONT`, `FIELD_LEN_YD`, `WALL_GAP`, `WALL_H`, `BORDER`, `TEE_H`). `standsGeometry(E)` matches `game.backstop()`. Retro's field code (`styles/retro/field.js`: `drawFieldLayout`, `drawEndlessLayout`, `surfaceStyle`) is the geometry reference for the pro field.
- **Renderer extras**: `renderer.debugState()` also returns `stadium`, `aimPending`, `wipe`. `renderer.setStyleOverride('retro' | 'pro' | null)` backs `?style=`.

**Deviations from §4-§9.**

- §4: `game.idle({ mode })` emits `modeChange` after the new scene is built. `newRun({ mode })` switches through `idle({ mode })` first (so `modeChange` precedes `runStart`). `continue` carries `{ mode }`. ENDLESS `runStart.cut` is false for the very first run of a session (nothing to cover yet).
- §6.3: rail alpha = intro/flight alpha x `railFade(latched, aimTime)`; `aimTime` is `world.phaseTime` sampled while aiming, 0 in intro, frozen in flight. During a FIELD swoop the rail and dots are hidden (alpha 0), as in field-posts.
- §6.5 / §9.4: the owned Aim Slider card shows a small sub-line ("Tap to switch it off" / "Off: aiming with the dots · tap to switch on") so it reads as a toggle. Store toggle toasts: "Aim Slider off: aim with the dots" / "Aim Slider on: slider every kick".
- §7.2: `createSaveManager()` exposes `imported` (true on the launch that imported a v1 save). `reset()` also keeps `importedV1`. A v1-shaped object found under the v2 key goes through `importV1` too.
- §9.1: the NEW badge stays until an ENDLESS **run** starts (switching alone doesn't clear it); the callout is dismissed by switching (chip or callout) or after 3 menu visits. The callout counts a visit when the menu is entered with it visible, and stays up for the rest of that visit. Chip: 46 px tall (40 px on containers ≤ 680 px tall), fixed label width so it doesn't jump when switching.
- §9.3: in ENDLESS the first-shot hint sits lower (sat + 196 px) so it never covers the distance pill.
- §9.4: four tabs fit at 360 px. **Tab icons hide below 520 px container width** (not 420): at 430 px, icons + four labels truncated. Store tab button ids: `data-tab="balls|stadiums|upgrades|coins"`. The UPGRADES tab exists (the §14 fallback was not needed).
- §9.6: the dev panel unlock now swallows clicks on the Settings screen for 450 ms after toggling. The unlocking tap's synthesized click used to land on the newly revealed DEVELOPER controls (in v1 it could silently change the start round; in v2 it switched the slider force to ON). Dev +10,000 coins shows confetti + a toast (there is no coin pill on Settings to fly to).
- §9.7: `window.__fg` also exposes `hud` (with `hintKind`) and `app`.
- §11.1: always-beatable in both modes cycles the three tap positions (tBest, lo + 1e-3, hi - 1e-3) over the 60 shots of each run (8 seeds x 2 modes). The 50,000 u stability check drops the resting ball far down the field so the next ENDLESS tee is there, then scores 3 shots at tBest.

**Not changed:** `src/engine/physics.js`, `difficulty.js`, `guide.js` (as merged). `CONFIG.rail.visible` is gone.

### 15.2 Engineer B

(record optional core hooks here)

---

## Appendix A — `v2/hard-perfect` (next step, not part of v2/standard)

Create `v2/hard-perfect` from the finished `v2/standard` commit (same save key and schema). Port from try/hard-perfect (`git diff full-game try/hard-perfect`):
- `config`: `difficulty.perfect`, `perfectDwell`, `perfectDwellMin`; `scoring.perfectBasePoints 3`, `perfectMaxPoints 6`; `economy.coinsPerPerfectBonus 2`, `coinsPerPerfectStreak 0`, `perfectStreakCoinCap 0`.
- `difficulty.js` (`perfectFrac`, `perfectDwell`, `checkSchedule` rules), `physics.js` (`isPerfectCross`, `measurePerfect`, `fitPerfect`, `perfectTol` on shots), `game.js` scoring and `inPerfect` on `flick`.
- Gold PERFECT strip in `aimDraw.drawRailTrack` (shown whenever the rail is visible, i.e. tutorial kicks and the upgrade), gold needle lock colour, streak celebrations (core part in `render.js`, extras in each style's `onFx`), HUD "N IN A ROW" / "+3 COINS" popups and CSS.
- Tests: hard-perfect's difficulty/physics/game/dev/save tests (drop the `showRail` save test).
- **Do not** port the free "Aim slider" Settings toggle, `settings.showRail`, `?rail=`, or its solo aim-dots drawing (v2 uses no-slider's guide).
- Re-run `checkSchedule` and the perfect-dwell floor tests with no-slider's slower `difficulty.speed` (slower sweep means longer dwell, so the floor only gets easier).
- Open question for the owner: with the slider hidden (kick 3+), the gold PERFECT window has no visual cue; decide whether perfect is "by feel" or the dots should hint it (for example a gold tint on the dots inside the perfect window).
