// Flick Goal — single shared source of truth for every tunable.
// Pure data only (no DOM, no side effects) so Node tests can import it.
// Owner: spec author / engine engineer. Shell engineer reads it, never writes it.
// Units: world units ("u"), seconds, u/s, u/s^2. World is y-UP, ground at y = 0.
// UI/rail sizes marked "css px" are screen-space CSS pixels.

const HOUR = 60 * 60 * 1000;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

export const CONFIG = deepFreeze({
  version: '2.0.0',
  debug: false, // main.js also enables debug with ?debug=1

  // ---- Fixed-timestep simulation (main.js owns requestAnimationFrame) ----
  sim: {
    hz: 120,               // game.step(1/hz) is the only dt the engine ever receives
    maxFrameDt: 0.1,       // clamp real frame delta (tab switches, hitches)
    maxStepsPerFrame: 12,  // spiral-of-death guard; accumulator is dropped past this
  },

  // ---- Camera / view ----
  view: {
    worldWidth: 400,       // world units across the stage width at zoom 1
    zoomMin: 0.45,
    zoomMax: 1.15,         // >1 lets the first (short) shots fill tall phones
    groundPad: 90,         // world units of ground shown below y=0 when ground is framed
    framePadX: 50,         // horizontal padding around tee / post in the aim frame
    framePadTop: 70,       // padding above post top / nominal apex
    ballMargin: 28,        // hard clamp: ball circle + this margin always inside the view
    camRate: 5.5,          // exponential ease rate (1/s) for aim/intro framing
    camRateFly: 8.0,       // ease rate while the ball is flying / settling
    maxDpr: 3,             // renderer caps devicePixelRatio
    hudReserve: 0.18,      // top fraction of the stage kept clear for the HUD in aim framing
    slackBelow: 0.62,      // share of spare vertical space placed below the ground: centres tee + post mid-screen
  },

  // ---- Aim rail (screen space, css px; drawn by engine/aimDraw.js, anchored to the ball) ----
  // The rail position t always ping-pongs on [0,1] in the engine (it drives angle + power,
  // see `mapping`). Whether the track (sweet band, edge brackets, needle) is drawn is decided
  // per shot by the aim-assist mode (src/aimAssist.js: slider tutorial + Aim Slider upgrade);
  // the launch-angle guide dots from the ball are always drawn.
  rail: {
    offsetX: 34,           // rail start = ball screen pos + (offsetX, offsetY); sits right of the ball so the
    offsetY: 6,            // launch-angle dots (drawn from the ball) never sit under the track
    angleDeg: 36,          // up-right; t=0 at start (low/short), t=1 at end (high/long)
    lengthFrac: 0.58,      // of stage width, clamped to [minLen, maxLen] (longer rail = wider band in px)
    minLen: 150,
    maxLen: 260,
    thickness: 26,
    markerWidth: 6,        // needle marker width (css px); slim so the sweet band stays visible around it
    markerOverhang: 8,     // needle sticks out this far above / below the track
    edgeMargin: 12,        // whole rail shifted to stay this far inside the stage
    fadeOut: 0.15,         // s after flick (track and guide)
    // launch-angle guide (engine/guide.js): a short row of dots from the ball along the launch
    // angle. Dot spacing shows strength vs the shot's ideal power on an S-curve centred on it:
    // bunched = too weak, evenly spaced = right, stretched = too strong (NOT a trajectory preview).
    guideDots: 5,
    guideStart: 26,        // first dot distance from the ball centre (css px)
    guideSpacing: 13,      // dot spacing at the ideal power (css px)
    guideSpread: 0.30,     // spacing ranges over guideSpacing * (1 +- spread): ~9.1 .. 16.9 px
    guideSoft: 0.07,       // power-ratio width of the S-curve (smaller = row changes faster near ideal)
    guideRadius: 4.4,      // first dot radius; each next dot is guideRadiusStep smaller
    guideRadiusStep: 0.5,
    guideOutline: 1.3,     // soft dark rim so the white dots read on light themes (snow, sky)
  },

  // ---- Physics ----
  physics: {
    gravity: 1500,         // u/s^2
    ballRadius: 16,        // collision radius; football drawn ~1.3r x 0.85r
    crossbarHalf: 11,      // crossbar capsule from (x-11,bar) to (x+11,bar)
    crossbarRadius: 5,
    uprightOffset: 11,     // pseudo-3D uprights at x-11 (far) and x+11 (near); tips collide
    tipRadius: 5,
    stemRadius: 4,         // stem capsule from (x,0) to (x,bar)
    restitutionPost: 0.55,
    restitutionGround: 0.3,
    groundFriction: 900,   // u/s^2 rolling decel once settled on the ground
    restSpeed: 120,        // |vy| below this on ground contact => stop bouncing, start rolling
    maxFlightTime: 6,      // s; failsafe miss
    passMissMargin: 40,    // ball.x > post.x + this without a goal => miss ('over'/'short')
    backMissDistance: 200, // ball.x < tee.x - this => miss ('post')
  },

  // ---- Rail -> (angle, power) mapping and shot solver (see SPEC.md §6) ----
  mapping: {
    kTheta: 0.15,          // rad of launch angle per (s * rail length)
    kPower: 0.40,          // fractional power change per (s * rail length)
    thetaMinDeg: 12,
    thetaMaxDeg: 75,
    powerMinFrac: 0.55,    // P(t) clamped to [0.55, 1.5] * Pc
    powerMaxFrac: 1.5,
    thetaCMinDeg: 34,      // nominal (center) solution angle range
    thetaCMaxDeg: 60,
    powerCMin: 450,
    powerCMax: 1150,
    apexMax: 560,          // nominal trajectory apex (world y) limit
    s0: 2.5,               // initial scale guess
    iterations: 6,         // s <- s * measuredW / targetW
    widthTolLo: 0.96,      // accept measured band width in [0.96, 1.06] * W(n)
    widthTolHi: 1.06,
    samples: 1000,         // analytic samples over t in [0,1]
    bisectIters: 14,       // sim-based edge refinement
    interiorChecks: 9,     // sim checks inside the refined band
    tStarEdge: 0.06,       // tStar in [W/2 + edge, 1 - W/2 - edge]
    bandLimit: 0.04,       // band must lie inside [0.04, 0.96]
    maxTries: 40,
    analyticPad: 5,        // analytic prefilter: bar+R+pad <= h <= top-R-pad
    clearMargin: 0.25,     // band edges: continuous parabola must clear every collider by this (u)
    clearStep: 0.5,        // x sampling step (u) of that continuous clearance test near the post
  },

  // ---- Difficulty curves (MATH.md, adjusted). n = goals made this run ----
  // curve(n) = asym - (asym - start) * exp(-n / scale)
  difficulty: {
    speed:    { start: 0.40, asym: 0.95, scale: 16 },   // rail-lengths / s (base 0.50 -> 1.10; slower: no visible band)
    band:     { start: 0.28, asym: 0.105, scale: 20 },  // W(n), fraction of rail
    clock:    { start: 7.0, asym: 2.0, scale: 14 },     // L(n) seconds
    distance: { start: 230, asym: 400, scale: 18, jitter: 30 }, // tee -> post, u
    gap:      { start: 165, asym: 120, scale: 22 },     // upright length above bar, u
    barHeight: { min: 50, range: 150, rampShots: 15 },  // bar in [min, min + range*min(1,n/ramp)]
    bandAlpha: { start: 0.95, asym: 0.45, scale: 30 },  // sweet-band fill opacity when the slider is shown (edges are always drawn)
    reaction: 0.12,        // tau_r
    dwellMin: 0.09,        // D_min, seconds (hard)
    clockMargin: 0.15,     // added to per-shot worst-case clock bound
  },

  // ---- Scoring ----
  scoring: {
    perfectFrac: 0.4,      // perfect if clean and |h - hc| <= perfectFrac * gap/2
    perfectMaxPoints: 4,   // perfect points = min(1 + streak, 4); normal goal = 1
    tierEvery: 10,         // background palette shifts every 10 points
  },

  // ---- Coin pickups (in-world) ----
  pickups: {
    chance: 0.4,           // per shot, from shot index >= fromShot
    fromShot: 1,
    radius: 14,
    value: 2,
    pathFracMin: 0.35,     // placed on the nominal (tStar) trajectory at x = tee + f*d
    pathFracMax: 0.7,
  },

  // ---- Engine timing ----
  timing: {
    introTime: 0.45,       // camera ease + rail fade-in before clock starts
    missDelay: 0.9,        // sim seconds from miss to 'gameover'
    slowmoScale: 0.35,
    slowmoTime: 0.5,
    settleMax: 0.15,       // seconds from the first landing (after a goal) to the swoop to the next attempt
    clockLowFrac: 0.25,    // 'clockLow' event threshold
    swoopTime: 0.5,        // camera swoop to a fresh attempt (after a goal / continue / play again), before introTime
  },

  // ---- Aim slider: tutorial + Aim Slider upgrade (src/aimAssist.js, V2_SPEC §6) ----
  aim: {
    fadeDelay: 0.3,        // kick 2 (tutorial): slider fully visible this long after aiming starts (s)
    fadeTime: 1.1,         // ...then fades to 0 over this (s)  => gone ~1.4 s into the aim
    tutorialKicks: 2,      // kicks 1-2 ever are the slider tutorial (1 = full slider, 2 = fading slider)
    dotsHintUntilKick: 6,  // "evenly spaced" dots hint on the first shot of a run while kicks < this
  },

  // ---- Game modes (V2_SPEC §4, §9.1) ----
  modes: {
    default: 'field',      // 'field' (FIELD GOAL: fresh attempts on the end line) | 'endless' (chained kicks)
    calloutMinGames: 3,    // the one-time "NEW: Endless mode!" callout shows for players with >= this many games
    calloutMaxShows: 3,    // ...on at most this many menu visits
  },

  // ---- ENDLESS mode (chained v1 mechanic on an endless field) ----
  endless: {
    nextTeeGap: 60,        // next tee = max(where the ball stopped, post.x + this): always past the post
    settleMax: 0.8,        // s after a goal before the next shot starts (v1 settle cap)
    cutDist: 300,          // newRun: ball farther than this from x = 0 => teleport + camera cut (mode wipe)
    continueCutDist: 400,  // continue: ball farther than this from the tee => teleport + snap
    discRadius: 22,        // painted team-colour disc under endless posts (world units)
  },

  // ---- Graphics (pro style adaptive quality; retro always runs at full dpr) ----
  gfx: { defaultQuality: 'auto' },

  // ---- Football field (broadcast side view; see SPEC.md §8.1) ----
  // The post always stands on the END LINE at world x = world.fieldEnd; every shot is a
  // fresh field-goal attempt teed up `d` world units in front of it (d snapped to whole yards).
  field: {
    yard: 7.5,             // world units per yard: d 200..430 u reads as 27..57 yd attempts
    endZoneYards: 10,      // painted end zone in front of the end line (goal line = end line - 10 yd)
    halfWidth: 200,        // sideline distance from the play line (~26.7 yd), depth units
    hashDepth: 23,         // hash marks ~3 yd either side of the play line (NFL hashes)
    camDist: 700,          // pseudo-perspective: camera distance to the play line (depth units)
    tilt: 0.45,            // depth foreshortening at the play line (screen px per depth unit / k)
    // Behind the end line (post-resolution only; the solver never sees these, see SPEC.md §8.1):
    netOffset: 70,         // kicking net this far behind the post (> physics.passMissMargin + post reach)
    netAbove: 110,         // net top = post top + this
    netBottomFrac: 0.5,    // net hangs down to this fraction of the crossbar height (poles reach the ground)
    netHalf: 15,           // pseudo-3D half-width of the net between its poles (like the uprights)
    standsOffset: 135,     // end-zone stands start this far behind the post (padded wall, then crowd)
    standsWallH: 16,       // front wall height of the end-zone stands
    standsRise: 0.45,      // seating rise per unit of depth behind the wall
    standsDepth: 490,      // seating depth; top row = standsWallH + depth * rise (stays below the view's eye height)
    standsBackH: 34,       // facade above the top row; a ball clearing it has left the stadium
  },

  // ---- Economy ----
  economy: {
    startingCoins: 0,
    coinsPerGoal: 1,
    coinsPerPerfectBonus: 1,
    gift: { cooldownMs: 4 * HOUR, min: 25, max: 50, step: 5 },
    rewardedCoins: 25,
    rewardedCoinsCooldownMs: 3 * 60 * 1000,
    continuesPerRun: 1,
  },

  // ---- Catalog ----
  // Ball ids MUST match the ball skins of every style (styles/*/balls.js). Stadium ids are
  // "<style>_<theme>" for PRO and the bare theme id for RETRO (v1 ids stay valid); every
  // stadium names its art style ('retro' | 'pro') and base theme (engine/themes.js).
  catalog: {
    balls: [
      { id: 'classic',    name: 'Classic',    price: 0 },
      { id: 'retro',      name: 'Retro',      price: 100 },
      { id: 'pro',        name: 'Pro White',  price: 150 },
      { id: 'soccer',     name: 'Soccer',     price: 150 },
      { id: 'basketball', name: 'Hoops',      price: 200 },
      { id: 'rugby',      name: 'Rugby',      price: 200 },
      { id: 'candy',      name: 'Candy',      price: 250 },
      { id: 'watermelon', name: 'Melon',      price: 300 },
      { id: 'camo',       name: 'Camo',       price: 300 },
      { id: 'neon',       name: 'Neon',       price: 400 },
      { id: 'ice',        name: 'Ice',        price: 400 },
      { id: 'fire',       name: 'Fire',       price: 500 },
      { id: 'pixel',      name: 'Pixel',      price: 500 },
      { id: 'galaxy',     name: 'Galaxy',     price: 750 },
      { id: 'gold',       name: 'Gold',       price: 1000 },
    ],
    stadiums: [
      { id: 'day',        name: 'Day Game',     price: 0,    style: 'retro', theme: 'day' },
      { id: 'night',      name: 'Night Lights', price: 300,  style: 'retro', theme: 'night' },
      { id: 'snow',       name: 'Snow Bowl',    price: 500,  style: 'retro', theme: 'snow' },
      { id: 'sunset',     name: 'Beach Sunset', price: 600,  style: 'retro', theme: 'sunset' },
      { id: 'arcade',     name: 'Neon Arcade',  price: 800,  style: 'retro', theme: 'arcade' },
      // PRO GRAPHICS: Pro Day is the cheap hook (reachable in the first sessions); the rest step
      // above the priciest retro stadium.
      { id: 'pro_day',    name: 'Day Game',     price: 400,  style: 'pro',   theme: 'day' },
      { id: 'pro_night',  name: 'Night Lights', price: 1200, style: 'pro',   theme: 'night' },
      { id: 'pro_snow',   name: 'Snow Bowl',    price: 1500, style: 'pro',   theme: 'snow' },
      { id: 'pro_sunset', name: 'Beach Sunset', price: 1800, style: 'pro',   theme: 'sunset' },
      { id: 'pro_arcade', name: 'Neon Arcade',  price: 2400, style: 'pro',   theme: 'arcade' },
    ],
    // Permanent upgrades (no equip). The Aim Slider shows the power slider on every kick.
    upgrades: [
      { id: 'aim_slider', name: 'Aim Slider',   price: 10000 },
    ],
  },
  defaults: { ball: 'classic', stadium: 'day' },

  // ---- IAP products (display prices are placeholders; real ones come from the store) ----
  products: [
    { id: 'no_ads',     type: 'nonconsumable', title: 'No Ads',      description: 'Remove all forced ads forever', priceString: '$2.99', grants: { noAds: true } },
    { id: 'coins_500',  type: 'consumable',    title: 'Coin Stack',  description: '500 coins',  priceString: '$0.99', grants: { coins: 500 } },
    { id: 'coins_1500', type: 'consumable',    title: 'Coin Bag',    description: '1,500 coins', priceString: '$2.99', grants: { coins: 1500 }, tag: 'POPULAR' },
    { id: 'coins_5000', type: 'consumable',    title: 'Coin Vault',  description: '5,000 coins', priceString: '$7.99', grants: { coins: 5000 }, tag: 'BEST VALUE' },
  ],

  // ---- Monetization (placeholders only until owner approval) ----
  monetization: {
    mode: 'mock',                    // 'mock' | 'off'. 'off' hides ALL ad/IAP UI
    interstitialEvery: 3,            // every N game-overs...
    minGamesBeforeInterstitial: 2,   // ...but never before this many games played
    mockAdSkipAfterMs: 2000,
    mockRewardedMs: 2000,
    mockPurchaseDelayMs: 600,
  },

  // ---- Audio / haptics ----
  audio: { masterVolume: 0.6 },
  haptics: {
    tap: 8, flick: 12, goal: 18, perfect: [20, 40, 30], coin: 6, fail: [50, 30, 50], buy: 20,
  },

  // ---- Save (v2 key; the v1 key is only ever READ, once, to import a v1 player) ----
  save: { key: 'flickgoal.save2', version: 2, importKey: 'flickgoal.save' },

  // ---- UI ----
  ui: { themeColor: '#4FC3F7' },

  // ---- Developer "start round" option (src/dev.js, src/ui/devPanel.js) ----
  // enabled: false removes every dev access path (?round, ?dev, Settings version 5x tap) for release.
  dev: { enabled: true, maxRound: 200 },
});

export default CONFIG;
