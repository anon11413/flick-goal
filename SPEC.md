# Flick Goal — Build Spec (v1.0)

One-tap American-football field-goal flick arcade game, portrait, Flappy Hoops look.
Two engineers build in parallel **without talking**. This file plus `src/config.js` is the whole contract.
GAME_DESIGN.md / MATH.md are background; where they differ, **this file wins** (numbers below were validated by simulation: every generated shot is hittable, solver averages ~1.3 tries, ~3 ms/shot).

Hard rules for both sides
- No build step. Native ES modules, vanilla JS, `<script type="module" src="src/main.js">`. No CDNs, no web fonts, no image files (procedural canvas / inline SVG only). Must run from any static server, GitHub Pages sub-path (use **relative** URLs only), and later Capacitor.
- Never call `window.alert/confirm/prompt`. No console errors, no unhandled promise rejections (every async path `.catch`es).
- Every `localStorage` access in try/catch (only `save.js` touches storage).
- `src/config.js` is frozen shared data. Read it, never mutate it. Only the engine engineer may *add* keys (never rename/remove keys listed here).
- Do not git commit. Put node_modules / temp files in the scratch dir, never in the repo.
- `npm test` = `node --test "tests/*.test.mjs"` (package.json exists, `"type":"module"`).

---

## 1. Files and owners

| File | Owner | Notes |
|---|---|---|
| `src/config.js` | **written (shared)** | all tunables, catalog ids, products, flags |
| `package.json` | **written (shared)** | test script only |
| `src/engine/difficulty.js` | Engine | pure |
| `src/engine/physics.js` | Engine | pure: mapping, integration, collisions, band solver, `solveShot` |
| `src/engine/game.js` | Engine | pure (no DOM): run state machine, camera, events |
| `src/engine/render.js` | Engine | canvas 2D only (gets canvas from main.js) |
| `src/engine/skins.js` | Engine | pure canvas draw fns for ball skins + stadium themes + previews |
| `tests/difficulty.test.mjs`, `tests/physics.test.mjs`, `tests/game.test.mjs`, `tests/skins.test.mjs` | Engine | |
| `index.html`, `styles.css`, `manifest.webmanifest`, `icon.svg` | Shell | |
| `src/main.js` | Shell | boot, rAF loop, router wiring, input, audio/haptic hooks |
| `src/ui/dom.js` (helpers `h()`, `$`), `src/ui/icons.js` (inline SVG strings), `src/ui/screens.js` (router + menu/pause/gameover/settings), `src/ui/hud.js`, `src/ui/store.js`, `src/ui/dialogs.js` (confirm, toast), `src/ui/fx.js` (coin fly, popups) | Shell | internal split is the shell's choice; only `main.js` wires them |
| `src/economy/save.js`, `src/economy/shop.js` | Shell | pure (injectable storage / clock) |
| `src/platform/monetization.js` | Shell | Mock provider only |
| `src/platform/audio.js` | Shell | WebAudio synth + haptics |
| `src/economy/runCoins.js` | Shell | pure: per-run 2x-coins ledger |
| `tests/save.test.mjs`, `tests/shop.test.mjs`, `tests/runCoins.test.mjs` | Shell | |

The old single-file prototype in `index.html` is replaced entirely by the shell (its good bits — post layering, camera follow, flat palette — are re-specified below).

---

## 2. Units and coordinate systems

- **World**: units `u`, **y-up**, ground at `y = 0`. The first tee of a run is at `x = 0`. Ball resting on ground has `y = R` (`R = physics.ballRadius = 16`).
- **Stage**: the portrait game rectangle `#stage` (CSS px, origin top-left). Canvas fills it.
- `k0 = cssW / view.worldWidth` (css px per world unit at zoom 1). With camera `{x, y, zoom}` = world coords of the view's **bottom-left** corner:
  - `k = k0 * zoom`, `viewW = worldWidth / zoom`, `viewH = cssH / k`
  - `screenX = (wx - cam.x) * k`, `screenY = cssH - (wy - cam.y) * k`
- Angles: radians, measured from +x toward +y (up). Launch velocity `vx = P cos θ`, `vy = P sin θ`.

---

## 3. Boot and fixed-timestep loop (main.js owns requestAnimationFrame)

```js
import { CONFIG } from './config.js';
import { createGame } from './engine/game.js';
import { createRenderer } from './engine/render.js';
const STEP = 1 / CONFIG.sim.hz;
const game = createGame();                       // Math.random rng
const renderer = createRenderer(canvas, game, { debug });
// on resize (ResizeObserver on #stage + 'orientationchange'):
renderer.resize(cssW, cssH, Math.min(devicePixelRatio || 1, CONFIG.view.maxDpr));
game.setViewport(cssW, cssH);
renderer.setSkin(save.data.equipped.ball); renderer.setTheme(save.data.equipped.stadium);
game.idle();
let acc = 0, last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, CONFIG.sim.maxFrameDt); last = now;
  let alpha = 1;
  if (!simPaused) {                               // simPaused = screen is 'paused' (or overlay ad during play)
    acc += dt; let n = 0;
    while (acc >= STEP && n < CONFIG.sim.maxStepsPerFrame) { game.step(STEP); acc -= STEP; n++; }
    if (n === CONFIG.sim.maxStepsPerFrame) acc = 0;
    alpha = acc / STEP;
  }
  renderer.draw(alpha, simPaused ? 0 : dt);
  hud.update(game.hud());                        // shell polls continuous values
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```
- The game is stepped on **every** screen except `paused` (menu shows the idle scene; game over shows the ball settling).
- `game.step(dt)` is only ever called with `STEP`. The engine never reads wall-clock time. Slow-mo is internal (engine scales its own physics dt).
- Engine keeps previous-step copies of ball + camera; `renderer.draw(alpha)` interpolates `prev + (cur - prev) * alpha`.

---

## 4. Engine public API (exact)

### 4.1 `src/engine/difficulty.js` (pure; `cfg` defaults to `CONFIG`)
```js
export function curve(p, n)          // p = {start, asym, scale}: asym - (asym - start) * Math.exp(-n / scale)
export function speed(n, cfg)        // v(n) rail-lengths/s      = curve(cfg.difficulty.speed, n)
export function bandWidth(n, cfg)    // W(n) fraction of rail    = curve(cfg.difficulty.band, n)
export function shotClock(n, cfg)    // L(n) seconds             = curve(cfg.difficulty.clock, n)
export function distance(n, cfg)     // mean tee->post distance  = curve(cfg.difficulty.distance, n)
export function gap(n, cfg)          // upright length above bar = curve(cfg.difficulty.gap, n)
export function barRange(n, cfg)     // {min, max}: min = barHeight.min, max = min + range * Math.min(1, n / rampShots)
export function bandAlpha(n, cfg)    // curve(cfg.difficulty.bandAlpha, n)
export function dwell(n, cfg)        // bandWidth / speed
export function params(n, cfg)       // {n, speed, band, clock, distance, gap, barMin, barMax, bandAlpha, dwell}
export function checkSchedule(maxN = 500, cfg) // {ok, failures: [{n, rule}]}; never throws
```
`checkSchedule` rules for every integer n in [0, maxN]:
1. `bandWidth(n) * mapping.widthTolLo / speed(n) >= difficulty.dwellMin` (0.105·0.96/1.10 = 0.0916 ≥ 0.09 ✓)
2. `shotClock(n) >= reaction + 1 / speed(n) + dwellMin` (MATH.md constraint 2)
3. all curves monotone in the right direction.
`n` is always **goals made this run** (`made`), not points.

### 4.2 `src/engine/physics.js` (pure)
Types: `Ball = {x, y, vx, vy}`; `Post = {x, bar, top}` (world; `bar` = crossbar height, `top` = upright tip height).
```js
export function makeRng(seed)                        // mulberry32; returns () => float in [0,1)
export function mapRail(shot, t, cfg)                // -> {angle, power}; §6.1
export function launchVelocity(angle, power)         // -> {vx, vy}
export function crossingHeight(x0, y0, angle, power, xTarget, g) // analytic y at x = xTarget, or null if vx <= 1
export function stepBall(ball, dt, g)                // exact const-accel: x += vx dt; y += vy dt - g dt²/2; vy -= g dt
export function postColliders(post, cfg)             // -> [{kind:'bar'|'tip'|'stem', ax, ay, bx, by, r}] (capsules; tips have a==b)
export function collideCapsule(ball, c, ballR, restitution) // push-out + reflect if approaching; -> null | {kind, nx, ny, impact}
export function stepFlight(ball, post, dt, cfg)      // ONE fixed step used by BOTH game.js and the solver:
                                                     //  x0,y0 = ball; stepBall; collide all postColliders (restitutionPost);
                                                     //  crossed = (x0 < post.x && ball.x >= post.x) ? {y: lerp(y0, y, u)} : null
                                                     //  -> {collisions: [{kind, impact}], crossed}
export function simulateShot(shot, t, cfg)           // from (shot.teeX, R) with mapRail(shot,t); loop stepFlight at dt = 1/cfg.sim.hz
                                                     // until crossed | ball.y <= R (ground) | maxFlightTime
                                                     // -> {goal, clean, crossY, time}; goal = crossed && bar < crossY < top; clean = goal && no collision before crossing
export function measureBand(shot, cfg)               // §6.3 -> null | {lo, hi, width, tBest, perfLo, perfHi}
export function solveShot({ teeX, made, rng }, cfg)  // §6.2 -> Shot (always returns a valid shot)
```
`Shot`:
```js
{ teeX, teeY /* = R */, postX, bar, top, gap, d,
  thetaC, powerC, tStar, s,                     // mapping parameters
  band: {lo, hi, width, tBest, perfLo, perfHi}, // rail fractions, computed from physics
  targetWidth /* W(made) */, speed /* v(made) */, clock /* per-shot seconds */, bandAlpha,
  apex /* nominal apex y */, pickup: null | {x, y, value}, made, fallback: false|true }
```

### 4.3 `src/engine/game.js` (pure, no DOM)
```js
export const PHASES = ['idle', 'intro', 'aim', 'fly', 'settle', 'miss', 'over'];
export function createGame({ rng = Math.random, cfg = CONFIG } = {}) // -> Game
```
`Game`:
| member | contract |
|---|---|
| `on(event, fn) -> unsubscribe()` | synchronous emit during `step/tap/newRun/continueRun`; handlers must be cheap; a throwing handler is caught + `console.error`'d, never breaks the sim |
| `off(event, fn)` | |
| `setViewport(cssW, cssH)` | required before the first `step`; call on every resize |
| `idle()` | attract scene for menus: tee at x=0 with ball, one solved post (made=0), no rail, no clock. Phase `idle`. |
| `newRun()` | reset score/made/streak/coinsRun/continues, tee x=0, `solveShot`, phase `intro`, emits `runStart` |
| `tap() -> boolean` | only in `aim`: freezes marker t, launches `mapRail(shot, t)`, phase `fly`, emits `flick`. Otherwise returns false (no-op) |
| `step(dt)` | advance one fixed step |
| `continueRun() -> boolean` | only in `over` and `continuesUsed < economy.continuesPerRun`: ball back on the missed shot's tee, **new** `solveShot` at same `made`, score/streak kept (streak reset to 0), phase `intro`, emits `continue`; else false |
| `hud()` | `{phase, score, made, streak, coinsRun, clock, clockMax, clock01, canContinue}` — clock in seconds (full value during `intro`); `clock01 = clock/clockMax` |
| `worldToScreen(x, y) -> {x, y}` | css px in stage using current camera |
| `phase` (getter) | current phase string |
| `world` (getter) | engine-internal state for render.js and engine tests only. **Shell must not read it.** Minimum shape: `{shot, marker: {t, dir, locked}, ball: {x, y, vx, vy, rot, px, py, prot, sx, sy}, cam: {x, y, zoom, px, py, pzoom}, pickup, time, tier}` (`p*` = previous-step values for interpolation) |

### 4.4 `src/engine/render.js`
```js
export function createRenderer(canvas, game, { cfg = CONFIG, debug = false } = {}) // -> Renderer
Renderer.resize(cssW, cssH, dpr)  // sets canvas.width/height = round(css*dpr), style size in css px
Renderer.draw(alpha, frameDt)     // alpha ∈ [0,1] interpolation; frameDt real s (0 while paused) for particles/shake/tweens
Renderer.setSkin(ballId)          // unknown id -> 'classic'
Renderer.setTheme(stadiumId)      // unknown id -> 'day'
Renderer.destroy()                // unsubscribes from game
```
The renderer subscribes to game events itself for particles/shake/flash. It never touches the DOM besides the canvas.

### 4.5 `src/engine/skins.js` (pure; only uses a passed ctx)
```js
export const BALL_SKINS      // { [id]: { id, shape: 'football'|'round', trail: '#rrggbb', fx: 'none'|'fire'|'sparkle'|'frost'|'pixel', draw(ctx, r, time) } }
                             // draw at origin, long axis along +x; football ellipse ≈ rx 1.3r, ry 0.85r; round ≈ radius 1.05r
export const STADIUM_THEMES  // { [id]: { id, decor: 'clouds'|'night'|'snow'|'sunset'|'arcade', palettes: Palette[] (≥4, one per tier), drawDecor(ctx, view, palette, time) } }
export function drawBall(ctx, id, x, y, r, rot, time, sx = 1, sy = 1) // sx/sy = squash-stretch along velocity
export function drawBallPreview(ctx, id, size, time = 0)   // draws centered in a size×size css-px box (caller already applied dpr transform)
export function drawStadiumPreview(ctx, id, w, h)          // mini sky+field+post scene
export function themePalette(id, tier)                     // palettes[tier % palettes.length] (unknown id -> 'day')
// Palette = { skyTop, skyBottom, ground, groundDark, line, post, accent, uiBg }   (uiBg = solid color the shell may use for panels)
```
Key sets of `BALL_SKINS` / `STADIUM_THEMES` **must equal** the ids in `CONFIG.catalog.balls` / `.stadiums` (tested in `tests/skins.test.mjs`). The shell imports `drawBallPreview`, `drawStadiumPreview`, `themePalette` for store cards and panel colors.

---

## 5. Game phases and event contract

```
idle --newRun()--> intro --(introTime 0.45s)--> aim --tap()--> fly
fly --goal crossed--> (emit score, keep flying) --ground--> settle --(rest | settleMax)--> intro (next shot)
aim --clock<=0--> miss ; fly --miss rule--> miss
miss --(missDelay 0.9s sim, slow-mo first 0.5s)--> over (emit gameover)
over --continueRun()--> intro ;  over/any --newRun()--> intro ;  any --idle()--> idle
```
- `intro`: camera eases to the new shot frame, rail fades in, **marker frozen** at its start position, tap ignored and clock frozen (a marker sweeping through the visible band while taps are ignored would eat the player's tap). At end → phase `aim`, marker starts moving, clock starts, emit `shotStart`.
- Marker: ping-pong on [0,1] at `shot.speed`; start t uniform in [0,1] **outside** `[band.lo-gap, band.hi+gap]` with `gap = max(0.08, 0.2·speed)` (≈0.2 s of travel; re-draw until valid, fallback = the farther rail end), random direction.
- Free ball after resolution (settle / miss / over): a ball **rolling** on the ground collides with the stem (reflects `vx` with `restitutionPost`, emits `bounce {kind:'stem'}`), so short misses never roll through the post.
- Miss rules (first that applies, evaluated each fly step; a goal already scored this flight disables them):
  - clock reaches 0 in `aim` → reason `'clock'`
  - ball touches ground (`y <= R`) before scoring → `'short'` if it never reached `post.x`, else `'post'` if any collision happened this flight, else `'short'`
  - `ball.x > post.x + passMissMargin` without a goal → `'over'` if it crossed above `top`, `'post'` if collided, else `'short'`
  - `ball.x < teeX - backMissDistance` or flight time > `maxFlightTime` → `'post'`
- After a goal the flight continues; first ground contact bounces (`restitutionGround`, vx *= 0.6), contact with `|vy| < restSpeed` → roll with `groundFriction` → rest. Next tee = rest x (or current x at `settleMax`). Emit `land` on first ground contact.

Events (`game.on(name, fn)`; payload objects; `sx, sy` are stage css px via `worldToScreen`):

| event | payload | when / shell use |
|---|---|---|
| `runStart` | `{}` | `newRun()`; shell: gamesPlayed++, remember bestAtRunStart |
| `shotStart` | `{made, score, clock, speed, band: {lo, hi, width}}` | rail interactive, clock running |
| `flick` | `{t, angle, power, inBand: boolean}` | tap accepted; sfx `flick`, haptic `flick` |
| `bounce` | `{kind: 'bar'|'tip'|'stem'|'ground', impact}` | impact = normal speed u/s; sfx `bounce` (post kinds) / `thud` (ground) |
| `score` | `{points, score, made, perfect, streak, doink, coins, coinsRun, sx, sy}` | goal crossed; `coins` = coins awarded for this goal (already added to coinsRun); shell adds `coins` to wallet |
| `coin` | `{amount, coinsRun, sx, sy}` | pickup collected; shell adds `amount` to wallet + coin-fly from (sx,sy) |
| `tier` | `{tier}` | score crossed a `tierEvery` boundary (`tier = floor(score / tierEvery)`); shell may tint panels with `themePalette(equippedStadium, tier).uiBg` |
| `land` | `{x}` | first ground contact after a goal |
| `clockLow` | `{clock}` | once per shot when `clock01 < timing.clockLowFrac`; sfx `tick` |
| `miss` | `{reason: 'clock'|'short'|'over'|'post', score}` | sfx `fail`, haptic `fail` |
| `gameover` | `{score, made, perfects, bestStreak, coinsRun, reason, canContinue}` | phase `over`; shell shows Game Over |
| `continue` | `{}` | after `continueRun()` |

Scoring per goal:
- `h` = crossing height; `hc = (bar+top)/2`; `clean` = no collision this flight before crossing; `doink = !clean`.
- `perfect = clean && |h - hc| <= scoring.perfectFrac * gap / 2`.
- `perfect` → `streak += 1`, `points = min(1 + streak, perfectMaxPoints)`; else `streak = 0`, `points = 1`.
- `coins = coinsPerGoal + (perfect ? coinsPerPerfectBonus : 0)`. `made += 1`, `score += points`.
- Pickup: collected when `dist(ball, pickup) < R + pickups.radius` during `fly`; `coinsRun += value`.

---

## 6. Rail mapping and the sweet-band solver (engine)

### 6.1 Mapping t → (angle, power) — coupled, per-shot parameters
```
u      = (t - shot.tStar) * shot.s
angle  = clamp(thetaC + u * kTheta,          thetaMinDeg°, thetaMaxDeg°)      // kTheta = 0.15 rad
power  = clamp(powerC * (1 + u * kPower),    powerMinFrac*powerC, powerMaxFrac*powerC)  // kPower = 0.40
```
Both increase with t: t=0 end of the rail = low/short, t=1 = high/long. `(thetaC, powerC)` is an exact solution through the window center at `t = tStar`; `s` scales how fast trajectories change along the rail and is solved so the **physics** band has width W(n).

### 6.2 `solveShot({teeX, made, rng})`
```
W = bandWidth(made); v = speed(made)
repeat up to mapping.maxTries:
  d    = distance(made) + (rng()*2-1) * distance.jitter ;  postX = teeX + d
  bar  = barMin + rng() * (barMax - barMin)   (barRange(made));  top = bar + gap(made);  hc = (bar+top)/2
  thetaC = lerp(thetaCMinDeg, thetaCMaxDeg, rng()) in radians
  den  = 2 cos²(thetaC) * (d tan(thetaC) - (hc - R));  if den <= 0: continue
  powerC = sqrt(g d² / den);   if powerC ∉ [powerCMin, powerCMax]: continue
  apex = R + (powerC sin thetaC)² / (2g);  if apex > apexMax: continue
  tStar = lerp(W/2 + tStarEdge, 1 - W/2 - tStarEdge, rng())
  s = s0;  repeat mapping.iterations: b = measureBand(shot); if !b break; s *= b.width / W
  b = measureBand(shot)
  accept iff b && W*widthTolLo <= b.width <= W*widthTolHi && b.lo >= bandLimit && b.hi <= 1-bandLimit
             && b.width / v >= dwellMin
  clock = max(shotClock(made), reaction + 2*max(b.lo, 1-b.hi)/v + b.width/v + clockMargin)   // true worst-case wait on a ping-pong rail
  pickup (if made >= fromShot && rng() < chance): on the tStar trajectory at x = teeX + d*lerp(pathFracMin, pathFracMax, rng())
  return shot
fallback (never expected; tests assert it doesn't happen for 2000 seeded shots across made ∈ [0,200]):
  d = distance.start, bar = barHeight.min, gap = gap.start, thetaC = 45°, tStar = 0.5, same s iteration,
  accept with widthTol [0.8, 1.3]; set fallback = true. If still failing: s = s0, band from measureBand, fallback = true.
```
Note (corrects MATH.md): on a ping-pong rail the worst wait to re-enter a band `[lo,hi]` is `2·max(lo, 1-hi)/v`, not `T/2`; the per-shot clock formula above guarantees a full band pass after reaction for any start phase.

### 6.3 `measureBand(shot)` — computed from the real physics
1. Analytic prefilter: for `i = 0..samples` (t = i/samples): `h = crossingHeight(teeX, R, mapRail(t), postX, g)`; ok_i = `bar + R + analyticPad <= h <= top - R - analyticPad`. `iBest` = index with h closest to `hc`. If `!ok[iBest]` or `!simulateShot(shot, tBest).clean` → null.
2. Expand from `iBest` to the contiguous ok run `[a, b]`.
3. Refine each edge with `bisectIters` bisection using the predicate `simulateShot(shot, t).clean` (low edge between `(a-1)/samples` and `tBest`; high edge between `tBest` and `(b+1)/samples`, clamped to [0,1]).
4. Verify `interiorChecks` evenly spaced interior points are clean via `simulateShot`; any failure → null.
5. Perfect sub-band: contiguous run around `tBest` where analytic `|h - hc| <= perfectFrac * gap/2` → `perfLo, perfHi` (clamped inside [lo,hi]).
Because `stepFlight` is the exact function the game uses at the same dt, a tap inside `[lo, hi]` is **always** a clean goal.

### 6.4 Collision geometry (post at x = P)
- Crossbar capsule `(P-11, bar)–(P+11, bar)`, r 5. Upright tips: circles `(P-11, top)` and `(P+11, top)`, r 5. Stem capsule `(P, 0)–(P, bar)`, r 4.
- **Always active** regardless of ball y (fixes the prototype's crossbar-gap bug). Restitution `restitutionPost`; tangential velocity kept.
- Goal = ball center crosses `x = P` left→right with `bar < y < top` (interpolated between steps). Uprights between bar and top are not solid (ball passes between them in depth).
- Integration is exact per step (`stepBall`), so the sim matches the analytic arc until a collision.

---

## 7. Camera (engine, inside game.js; sim-stepped and interpolated)

Fit a world box B into the stage:
```
availH(z) = viewH(z) * (1 - hudReserve)          // aim/intro/idle only; fly uses full viewH
z = clamp(min(worldWidth / B.w, (cssH / k0) * (1 - hudReserve) / B.h), zoomMin, zoomMax)
target.x = B.cx - viewW(z)/2
target.y = (B.h <= availH(z)) ? B.minY : B.maxY - availH(z)     // keep ground in view when possible
ease: c += (target - c) * (1 - exp(-rate * dt))  for x, y, zoom   (rate = camRate in idle/intro/aim, camRateFly otherwise)
```
Boxes:
- `idle / intro / aim`: `minX = teeX - framePadX`, `maxX = postX + framePadX`, `minY = -groundPad`, `maxY = max(top, shot.apex) + framePadTop`.
- `fly` before resolution: union of the aim box and the ball circle ± (R + 60).
- after a goal (`fly` post-score, `settle`): `{minX: ball.x - 200, maxX: ball.x + 200, minY: -groundPad, maxY: max(ball.y + 120, 380)}`.
- `miss / over`: keep last box.
Vertical placement when the box fits: `target.y = B.minY - (availH(z) - B.h) · slackBelow` — `slackBelow = 0.62` puts most of the spare height below the ground so tee + post sit mid-screen (tall phones: post top ≈ 40 %, ground ≈ 67 % of the height). `zoomMax = 1.15` lets the short early shots fill the frame.
**Hard clamp (every step in fly/settle/miss/over, after easing):** shift `cam.x/cam.y` (not zoom) so the ball circle plus `ballMargin` lies fully inside the view. This guarantees high arcs (extreme t=1 apex ≈ 860 u) never leave the screen; ground may temporarily scroll out.
Worst-case aim zoom ≈ 0.75 (d ≈ 430) → ball ≈ 10 css px radius on a 360 px phone; early shots zoom in up to `zoomMax` (1.15).

---

## 8. Rendering and juice (engine)

Look: Flappy Hoops — flat saturated colors, almost no gradients, big soft shapes, crisp dpr canvas.
Draw order: sky (palette skyTop→skyBottom, crossfade 0.8 s on tier change) → theme decor (clouds/stars+light towers/snowfall/sun+palms/neon grid; parallax 0.2–0.4) → field (flat ground, alternating stripe every 80 u, yard line every 160 u) → far upright + stem + crossbar (post color `#FFD21F`, white highlight, orange ribbons on tips) → pickup coin (gold, spinning via scaleX = cos) → trail (skin.trail, 14 pts, tapering) → ball (`drawBall`, tee drawn under it in idle/intro/aim) → near upright → particles → **rail (screen space)** → flash overlay → debug overlay.

**Branch `try/no-slider`: `rail.visible = false`.** None of the track / band / brackets / needle / chevrons below is drawn. The launch-angle guide dots are the only aim cue (`engine/guide.js`): `rail.guideDots` (5) white dots from the ball along `mapRail(shot, t).angle`, first at `guideStart` (26 px), spacing `guideSpacing · (1 + guideSpread · tanh((pf − 1) / guideSoft))` with `pf = power / powerC` (13 px at the ideal power, 9.1–16.9 px overall), radius `guideRadius − i·guideRadiusStep` with a soft dark rim (`guideOutline`) so they read on every theme. The S-curve is steepest at the ideal kick, so the scoring window is visible as the row opening up: the last dot moves a median of ~19 px across the clean window late in a run (≥ 5 px on every shot, tested in `tests/guide.test.mjs`; a linear spacing gave ~5 px median). Tell: bunched = too weak, evenly spaced = right, stretched = too strong. The dots fade in over `introTime`; on the flick they pop (×1.35, 0.2 s) and stay frozen at the tee while fading out over `rail.fadeOut`. It is not a trajectory preview. The mechanic is unchanged (t ping-pongs, tap locks t, same solver/band guarantees); `difficulty.speed` is 0.40 → 0.95 (base 0.50 → 1.10) so the sweep is slower without a visible band. First-shot hint: "TAP when the dots are evenly spaced / Bunched = too weak · stretched = too strong", shown to new players and once per page load for everyone. Set `rail.visible = true` to restore the rail described next.

Rail (screen space, `CONFIG.rail`): start = ball screen pos + (offsetX, offsetY); direction `angleDeg` up-right; length = clamp(lengthFrac·cssW, minLen, maxLen); whole rail shifted to stay `edgeMargin` inside the stage. Track: rounded, thickness 26, `rgba(0,0,0,.22)` with 3 px white outline. Band `[lo,hi]`: bright green `#6BFFB0` fill at opacity `shot.bandAlpha` (fades 0.95 → 0.45 with difficulty); perfect core `[perfLo,perfHi]` whiter at the same alpha ×1.2; **band edge brackets** (3.5 px green lines with a dark outline, poking out above and below the track) are always drawn at full opacity, so the target never disappears. Marker: a slim white **needle** (`rail.markerWidth` 6 px, track height + 2·`markerOverhang`) with an accent outline and a small pointer cap, so the band stays visible on both sides of it even at the narrowest band (~19 px on a 360 px phone); it turns green/red on lock and pops on tap. Rail length = `clamp(0.58·cssW, 150, 260)`.
Note (doinks): the band shows only **clean** goals. Taps just outside it can still score as a DOINK off the crossbar / upright tips (measured: the scoring part of the rail is ~1.3–1.9× the band). This is intentional forgiveness (it only helps the player); `difficulty.band` is tuned with it in mind. Also a short 5-dot launch-angle indicator from the ball. Rail fades in over `introTime`, out over `rail.fadeOut` after flick.

Juice (render-time, driven by events): squash/stretch (flick: stretch 1.25/0.8 along velocity decaying 0.2 s; bounce/land: squash 0.7/1.3), ball spin in flight 8–14 rad/s by power, trail, confetti on goal (24 flat rects in accent colors), perfect: 60 confetti + expanding white ring + star burst + flash (α 0.25), post hit sparks, landing dust, coin pickup sparkle. Screen shake: goal 4 px/0.15 s, perfect 8 px/0.25 s, post 5 px, miss 10 px/0.3 s. Background palette shifts per tier (score / 10). Particles/shake use `frameDt` (cosmetic, not simulated).

Debug (`debug` option, from `?debug=1`): top-left text `n v W(target/measured) D L clock s fallback`, draws the goal window rect and the tStar trajectory. `console.assert(checkSchedule().ok)` at startup in debug.

---

## 9. Economy (shell)

### 9.1 Save schema v1 — key `CONFIG.save.key` = `"flickgoal.save"`
```js
{
  v: 1,
  coins: 0,
  best: 0,
  owned:    { balls: ['classic'], stadiums: ['day'] },
  equipped: { ball: 'classic', stadium: 'day' },
  settings: { sound: true, haptics: true },
  noAds: false,
  lastGiftAt: 0,              // ms epoch; 0 => gift ready on first launch
  lastRewardedCoinsAt: 0,     // ms epoch
  adCounter: 0,               // game-overs since last interstitial
  stats: { gamesPlayed: 0, totalGoals: 0, totalPerfects: 0, bestStreak: 0 }
}
```
### 9.2 `src/economy/save.js`
```js
export const SAVE_VERSION = 1;
export function memoryStorage()                      // {getItem, setItem, removeItem} in-memory
export function safeStorage()                        // window.localStorage if a probe write/remove succeeds (try/catch), else memoryStorage()
export function defaultSave(cfg = CONFIG)
export function migrate(raw, cfg = CONFIG, now = Date.now())  // never throws; non-object/bad JSON -> defaults; coerce numbers (>=0, finite, integers for coins,
                                                     // coins capped at MAX_COINS); timestamps clamped to <= now;
                                                     // drop ids not in catalog; always own + fallback-equip defaults; equipped must be owned
export function createSaveManager({ storage = safeStorage(), cfg = CONFIG, now, listen } = {})
  // -> { data (getter, live object — read-only outside update), update(mutator) -> data (mutate then persist),
  //      reset() -> data (defaults but KEEPS noAds and settings), ingest(raw), onExternalChange(fn), persisted, readOnly }
  // persist = storage.setItem(key, JSON.stringify(data)) in try/catch
  // Multi-tab: listen(key, ingest) defaults to the window 'storage' event, so a write in another tab is adopted
  //   (main.js then refreshes shop / skins / menu) and this tab's next write builds on it instead of overwriting it.
  // Forward-compat: a save with v > SAVE_VERSION is used in memory but never written back (readOnly).
```
### 9.3 `src/economy/shop.js`
`kind` is `'ball' | 'stadium'` (catalog lists `cfg.catalog.balls` / `cfg.catalog.stadiums`, save lists `owned.balls` / `owned.stadiums`).
```js
export function createShop({ save, cfg = CONFIG, now = () => Date.now(), rng = Math.random })
  // -> {
  coins(),                          // save.data.coins
  addCoins(amount, source),         // integer > 0 only; source: 'goal'|'pickup'|'double'|'gift'|'rewarded'|'iap'
  spendCoins(amount) -> boolean,
  items(kind) -> [{id, name, price, owned, equipped}],
  isOwned(kind, id), equipped(kind) -> id,
  buy(kind, id) -> {ok, reason?: 'unknown'|'owned'|'insufficient', need?: number},   // need = price - coins
  equip(kind, id) -> {ok, reason?: 'unknown'|'locked'},
  giftStatus() -> {ready, msLeft},           // a lastGiftAt in the future is pulled back to now() and saved (wait <= one cooldown)
  claimGift() -> {ok, amount?, msLeft?},     // amount = random multiple of gift.step in [gift.min, gift.max]; sets lastGiftAt = now()
  rewardedCoinsStatus() -> {ready, msLeft},
  grantRewardedCoins() -> {ok, amount?},     // economy.rewardedCoins; respects cooldown
  applyProduct(productId) -> {ok, coins?, noAds?},   // grants from cfg.products[].grants
  hasNoAds(), setNoAds(bool),
  on(fn) -> unsubscribe                      // fn({type: 'coins'|'owned'|'equip'|'noAds', kind?, id?, coins})
}
```
Run coins are credited **as they happen** (`score.coins`, `coin.amount`) so quitting never loses them. Game over "2x coins" is tracked by `src/economy/runCoins.js` (`createRunCoins`): it doubles only coins not doubled yet, so after 2x → Continue → more goals the next Game Over shows the real total (`earned + bonus`) and offers 2x on the coins earned since the last doubling.

---

## 10. Monetization adapter (shell) — `src/platform/monetization.js`

```js
export function createMonetization({ cfg = CONFIG, shop, root /* #stage element */ })
// -> {
mode,                         // cfg.monetization.mode: 'mock' | 'off'
enabled,                      // mode !== 'off'  (UI hides ALL ad/IAP buttons when false)
ads: {
  showInterstitial(placement) -> Promise<{shown: boolean}>,     // resolves {shown:false} if off or shop.hasNoAds()
  showRewarded(placement)     -> Promise<{rewarded: boolean}>,  // placements: 'continue' | 'double_coins' | 'store_coins'
  isRewardedReady(placement)  -> boolean,
},
iap: {
  getProducts() -> Promise<Product[]>,   // Product = {id, type, title, description, priceString, tag?}
  purchase(productId) -> Promise<{ok: boolean, productId, cancelled?: boolean, error?: string}>,  // on ok, grant applied via shop.applyProduct
  restore() -> Promise<{ok: boolean, restored: string[]}>,     // mock: re-grants 'no_ads' if save says owned
},
entitlements: { noAds() -> boolean },
maybeInterstitial(save) -> Promise<{shown}>  // policy: enabled && !noAds && stats.gamesPlayed >= minGamesBeforeInterstitial
                                             //   && ++adCounter >= interstitialEvery -> show, adCounter = 0 (persist via save.update)
}
```
- All promises **resolve** (never reject). While an ad/sheet is open `main.js` sets `simPaused = true` and blocks game taps.
- MockProvider UI (DOM, inside `root`, z-index above everything): dark overlay + white card "TEST AD — placeholder", subtitle `interstitial` / `rewarded: <placement>`, 2 s progress bar. Interstitial: close "✕ Skip" appears after `mockAdSkipAfterMs`. Rewarded: completes after `mockRewardedMs` ("Reward granted ✓" 400 ms → resolves `{rewarded:true}`); a "Close (no reward)" link is available immediately → `{rewarded:false}`. Purchase: bottom sheet "TEST PURCHASE — no real money", product title + price, [Buy] [Cancel], resolves after `mockPurchaseDelayMs`.
- Code comments must mark the real plug-in points: AdMob via `@capacitor-community/admob` (interstitial/rewarded ids), IAP via RevenueCat `@revenuecat/purchases-capacitor` (or `cordova-plugin-purchase`), provider selected in `createMonetization` by mode (future `'native'`). Provider interface: `{init(), showInterstitial(p), showRewarded(p), getProducts(), purchase(id), restore()}`.

---

## 11. Audio and haptics (shell) — `src/platform/audio.js`
```js
export function createAudio({ cfg = CONFIG, enabled = true } = {})
  // -> { unlock() (create/resume AudioContext on first user gesture; safe to call repeatedly),
  //      play(name), setEnabled(bool), isEnabled(), suspend(), resume() }
  // names: 'flick','bounce','thud','goal','perfect','coin','fail','tick','click','buy','gift','whoosh','newbest'
  // all synthesized (oscillators + noise buffers + envelopes); no-op if AudioContext missing or not unlocked
export function createHaptics({ cfg = CONFIG, enabled = true } = {})
  // -> { pulse(name) (navigator.vibrate(cfg.haptics[name]) guarded by typeof check + try/catch), setEnabled, isEnabled, supported }
```
Event → feedback wiring in `main.js`: flick→`flick`/flick; bounce(post kinds)→`bounce`; bounce(ground)/land→`thud`; score→`perfect`|`goal` + haptic; coin→`coin`; clockLow→`tick`; miss→`fail`; buttons→`click`/tap.

---

## 12. Screens, transitions, DOM (shell)

### 12.1 State diagram
```
BOOT ──> MENU
MENU ──Play / tap background / Space──> PLAYING        (game.newRun())
MENU ──Store──> STORE ──Back──> (previous: MENU or GAMEOVER)
MENU ──Settings──> SETTINGS ──Back──> MENU
PLAYING ──pause btn / Esc / P / visibilitychange hidden / window blur──> PAUSED
PAUSED ──Resume──> PLAYING ;  PAUSED ──Home──> MENU     (game.idle())
PLAYING ──game 'gameover'──> GAMEOVER   (≈0.9 s after miss; show after that event, panel tweens in)
GAMEOVER ──Continue (rewarded ok)──> PLAYING             (game.continueRun())
GAMEOVER ──Play Again / Space──> [maybeInterstitial] ──> PLAYING (game.newRun())
GAMEOVER ──Home──> [maybeInterstitial] ──> MENU (game.idle())
GAMEOVER ──Store──> STORE
Overlays on top of any screen: CONFIRM DIALOG, TOAST, MOCK AD, PURCHASE SHEET, GIFT/REWARD popup.
```
Router: `showScreen(name)` where name ∈ `'menu'|'playing'|'paused'|'gameover'|'store'|'settings'`; each screen is a `<section data-screen>` toggled with a bouncy tween-in (scale .85→1.05→1, 260 ms, `cubic-bezier(.34,1.56,.64,1)`); children stagger 40 ms.

### 12.2 DOM skeleton (index.html)
```html
<div id="stage">                         <!-- portrait rect -->
  <canvas id="game"></canvas>            <!-- passed to createRenderer -->
  <div id="ui"> sections: menu, hud(playing), paused, gameover, store, settings </div>
  <div id="overlay"></div>               <!-- dialogs, toasts, mock ads -->
</div>
```
`#stage`: `position:fixed; left:50%; transform:translateX(-50%); height:100dvh (100vh fallback); width:min(100vw, 100dvh*9/16)`; body background = darker shade of the theme (letterbox). Canvas absolute inset 0. `#ui` inset 0 with `padding: env(safe-area-inset-*)` + 12 px; `pointer-events:none` except interactive elements.

### 12.3 Screens
- **Menu** (idle scene visible behind, no dim): logo "FLICK GOAL" (two lines, 64–72 px, weight 900, white, 0 6px 0 rgba(0,0,0,.18) shadow, slight tilt/bob animation); "BEST 23" under it; coin pill top-right; giant white circular PLAY button (≥96 px) with colored ▶, plus pulsing "TAP TO PLAY" in a dark pill (pulse never below 0.82 opacity); the button row is `data-no-tap` and the gift's "FREE!" / countdown label is itself clickable (claims the gift); on light stadiums (`.light-theme`) white buttons get a coloured ring + drop and pills get darker; bottom row of round white 56 px buttons with colored icons: Store (cart), Settings (gear), Sound (speaker on/off), No Ads (hidden if owned or `!monetization.enabled`), Free Gift (bounces + red "!" badge when ready; else shows `h:mm:ss` countdown label updated each second; claim → "+35" popup + coin fly).
- **HUD** (playing): score top-center (80 px, weight 900, white, shadow; pops 1→1.25→1 on score); clock bar under score (56% width, 12 px, solid dark track `rgba(12,34,64,.5)` with a 2 px white outline; fill green → gold below 50 % → red + pulse below 25 %; full during intro; clouds are kept below the HUD band); pause circle top-left (44 px, hidden while paused, ignores clicks for 250 ms after the HUD appears); coin pill top-right (pulses on credit). Popups center-upper from `score` events: "PERFECT!" (+ "x{points}" — the multiplier actually applied, capped by `perfectMaxPoints` — when streak ≥ 2), "DOINK!" when doink, "+{points}" near score; coin fly: gold coin DOM element from (sx, sy) to the coin pill (450 ms, ease-in), then pill count updates.
- **Paused**: dim `rgba(0,0,0,.35)`, "PAUSED", big Resume, Home, sound toggle.
- **Game Over**: title by reason — clock "TIME'S UP!", short "NO GOOD!", over "TOO HIGH!", post "OFF THE POST!" — replaced by a gold **"NEW BEST!"** headline (+ gold card ring, confetti, sfx `newbest`) when `score > bestAtRunStart`; card with big score, "BEST n"; coin row "+{coins credited this run incl. 2x}". Buttons: **Continue** (▶ ad icon; only if `canContinue && monetization.enabled`), **2x Coins** (only while there are un-doubled run coins && enabled), big **PLAY AGAIN**, round Home + Store. Buttons (and Space/Enter) are inert for 650 ms after the screen appears. On short containers (≤ 640 px tall) the layout compacts and Home / PLAY AGAIN / Store share one row. On `gameover`: `save.best = max(best, score)`, stats updated.
- **Store**: solid `themePalette(equipped stadium, 0).uiBg` background, header (back 44 px, "STORE", coin pill), tabs BALLS / STADIUMS / COINS (COINS hidden when monetization off). Grid: 3 columns (2 below 340 px), cards white r 18 with `<canvas>` preview (`drawBallPreview` 64 px / `drawStadiumPreview` 96×64, dpr-scaled). States: locked (price pill with coin icon + lock badge; preview stays full colour), owned (tap to equip, "USE"), equipped (green check badge, accent border). Tap locked → confirm dialog "Buy Neon for 400?" → `shop.buy` → success: sfx `buy`, confetti, auto-equip, `renderer.setSkin/setTheme`; insufficient: card shake (CSS keyframes 300 ms) + toast "Need 150 more coins" (+ "Get coins" button to COINS tab when enabled). COINS tab: No Ads card (hidden/"OWNED" if owned), 3 coin packs (priceString, tag ribbons), "Watch ad for +25" card with cooldown countdown, "Restore Purchases" text button.
- **Settings**: toggles Sound, Haptics (hidden if unsupported), Restore Purchases (only if enabled), Reset Progress (red; DOM confirm "Reset all coins, skins and best score?" → `save.reset()`, refresh UI, `renderer.setSkin('classic')`, `setTheme('day')`), version text `v{CONFIG.version}` (+ `· ads: {mode}` only with `?debug=1` / `?qa`).
- **Dialogs/Toasts** (`dialogs.js`): `confirmDialog({title, message, okText, cancelText, danger}) -> Promise<boolean>`, `toast(text, {ms=1800})`. Focus-trapped, Esc = cancel.

### 12.4 Style tokens (styles.css)
`--sky:#4FC3F7; --accent:#FF8A3D; --green:#39D98A; --red:#FF5A5F; --gold:#FFC83D; --ink:#2E3A59; --white:#fff; --shadow:0 6px 0 rgba(0,0,0,.15)`.
Font stack (no web fonts): `"Arial Rounded MT Bold","SF Pro Rounded",ui-rounded,"Nunito","Segoe UI",system-ui,sans-serif`, weights 800–900, text-shadow `0 4px 0 rgba(0,0,0,.18)`. Buttons: white fill, colored icon/label, radius 999, bottom 6 px shadow, `:active` translateY(4px) + shadow 2 px. Tap targets ≥ 44 px. Readable at 360 px width.

---

## 13. Input (main.js)
- `pointerdown` on the document (not from `button, [data-no-tap], .modal, .toast, #rotate`, checked on the dispatch-time `composedPath()`) → `playing`: `game.tap()` (lowest latency). `preventDefault` to kill double-tap zoom.
- Menu tap-to-play fires on **click** (capture phase), not pointerdown — otherwise the same tap's compat click lands on the HUD pause button that appears under the finger — and is ignored for 300 ms after arriving on the menu (double-taps on Back / Home).
- Keys: Space/Enter → tap in playing, Play in menu, Play Again in game over (after the 650 ms grace); Esc/P → pause/resume, Back from store/settings.
- Phone rotated to landscape (`(orientation: landscape) and (max-height: 500px) and (pointer: coarse)` — the "Turn your phone upright" overlay): pause the run, freeze the sim, ignore all game input until upright.
- Purchase sheet backdrop closes only on a tap that starts and ends on the backdrop, and not within 350 ms of opening.
- First `pointerdown`/`keydown` anywhere → `audio.unlock()`.
- `visibilitychange` (hidden) / `blur` while playing → PAUSED; also `audio.suspend()`; resume on visible.
- Taps during `intro` are ignored by the engine (no queuing).

## 14. Mobile / PWA (shell)
- `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`, `theme-color` = `CONFIG.ui.themeColor`, `apple-mobile-web-app-capable`, `<link rel="manifest" href="manifest.webmanifest">`, `<link rel="icon" href="icon.svg" type="image/svg+xml">`.
- Stage: 9:16 portrait column on desktop / mouse; on touch devices (`pointer: coarse`) it fills 100vw down to a 3:4 aspect, so in-browser phone viewports (360×560, 375×553) get no side bars.
- CSS: `html,body{height:100%;overflow:hidden;overscroll-behavior:none;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}`.
- manifest: name "Flick Goal", short_name "Flick Goal", `start_url: "./"`, `scope: "./"`, display `standalone`, orientation `portrait`, background/theme colors, icons: `icon.svg` (`sizes:"any"`, purpose `any maskable`).
- icon.svg: rounded-square sky-blue tile, yellow goal post, brown football mid-flight with white laces.
- No service worker in v1 (avoids stale-cache during iteration).

## 15. Tests (`node --test`)
Engine:
- `difficulty.test.mjs`: `checkSchedule(1000).ok`; spot values n=0 (v .5, W .28, L 7); monotonicity.
- `physics.test.mjs`: `stepBall` matches analytic parabola to 1e-6 after 1 s; `solveShot` with `makeRng(seed)` for seeds 0..9 × made ∈ {0,1,2,5,10,20,40,80,200} (≥2000 shots total across the suite): never `fallback`, width within tolerance, `width/speed >= dwellMin`, band inside [0.04,0.96], `simulateShot(tBest/lo+1e-3/hi-1e-3).clean === true`, `simulateShot(lo-0.02)` and `(hi+0.02)` not clean, clock ≥ worst-case bound; `postColliders` crossbar collision fires for a ball arriving at y = bar from any direction (regression for the gap bug).
- `game.test.mjs`: headless `createGame({rng: makeRng(1)})`, `setViewport(390, 844)`, `newRun()`, step to `aim`, set `world.marker.t = shot.band.tBest`, `tap()`, step → `score` event with `perfect` plausible and next `shotStart`; tapping at t outside band → `miss` then `gameover` after ~missDelay; clock expiry → `miss {reason:'clock'}`; `continueRun()` works once then returns false; camera hard clamp keeps ball inside view for t = 0 and t = 1 flights.
- `skins.test.mjs`: key sets equal catalog ids; every `draw` runs against a stub ctx (object whose methods are no-ops) without throwing.
Shell:
- `save.test.mjs`: memory storage roundtrip; throwing storage (every method throws) → still works, `persisted === false`; `migrate` on `null`, `"garbage"`, wrong types, unknown ids, equipped-not-owned; `reset` keeps noAds+settings; future timestamps clamped; newer-version save never overwritten; cross-tab `ingest` keeps both tabs' coins.
- `shop.test.mjs`: buy success/owned/insufficient/unknown; equip locked; gift ready at start, cooldown 4 h with injected `now`, amount range/step with injected rng; rewarded cooldown; `applyProduct('no_ads'|'coins_500')`; change listener fires; gift / rewarded cooldown recover from a timestamp in the future (clock set back).
- `runCoins.test.mjs`: 2x → Continue → 2x ledger (total and doublable amounts).
- `game.test.mjs` also covers: marker frozen during intro and starting ≥ 0.2 s from the band; a rolling ball bounces off the stem.

## 16. Acceptance checklist
- Menu → Play → multiple goals (PERFECT popups, coins fly, tier color shifts) → miss → Game Over → Continue (mock ad) → miss → 2x coins → Play Again (interstitial every 3rd per policy) → Home. Store buy/equip ball + stadium visibly applies in game and persists across reload. Gift claim + countdown. Settings reset via DOM dialog. `mode:'off'` hides all ad/IAP UI and everything else still works.
- Identical game speed at 60/120/144 Hz; no page scroll/zoom/selection; works at 360×640 and 430×932 and letterboxed on desktop; no console errors; `npm test` green.
