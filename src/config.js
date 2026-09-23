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
  version: '1.0.0',
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

  // ---- Aim rail (screen space, css px; drawn by render.js, anchored to the ball) ----
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
    fadeOut: 0.15,         // s after flick
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
    speed:    { start: 0.50, asym: 1.10, scale: 16 },   // rail-lengths / s
    band:     { start: 0.28, asym: 0.105, scale: 20 },  // W(n), fraction of rail
    clock:    { start: 7.0, asym: 2.0, scale: 14 },     // L(n) seconds
    distance: { start: 230, asym: 400, scale: 18, jitter: 30 }, // tee -> post, u
    gap:      { start: 165, asym: 120, scale: 22 },     // upright length above bar, u
    barHeight: { min: 50, range: 150, rampShots: 15 },  // bar in [min, min + range*min(1,n/ramp)]
    bandAlpha: { start: 0.95, asym: 0.45, scale: 30 },  // sweet-band fill opacity (edges are always drawn)
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
    settleMax: 0.8,        // max seconds from first landing to next shot setup
    clockLowFrac: 0.25,    // 'clockLow' event threshold
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

  // ---- Catalog (ids MUST match skins.js BALL_SKINS / STADIUM_THEMES keys) ----
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
      { id: 'day',    name: 'Day Game',     price: 0 },
      { id: 'night',  name: 'Night Lights', price: 300 },
      { id: 'snow',   name: 'Snow Bowl',    price: 500 },
      { id: 'sunset', name: 'Beach Sunset', price: 600 },
      { id: 'arcade', name: 'Neon Arcade',  price: 800 },
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

  // ---- Save ----
  save: { key: 'flickgoal.save', version: 1 },

  // ---- UI ----
  ui: { themeColor: '#4FC3F7' },

  // ---- Developer "start round" option (src/dev.js, src/ui/devPanel.js) ----
  // enabled: false removes every dev access path (?round, ?dev, Settings version 5x tap) for release.
  dev: { enabled: true, maxRound: 200 },
});

export default CONFIG;
