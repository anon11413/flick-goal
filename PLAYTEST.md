# Flick Goal: playtest guide

## Run it locally

The game is static files with no build step. Serve the repo root with any static server:

```bash
cd flick-goal
python -m http.server 8765        # or: npx serve -l 8765 .
```

Open http://localhost:8765/. Don't open `index.html` straight from disk (`file://`), because browsers block ES modules loaded that way.

Unit tests (Node 18+):

```bash
npm test                          # = node --test "tests/*.test.mjs"
```

## Play on your phone (same Wi-Fi)

1. Start the server bound to all interfaces: `python -m http.server 8765 --bind 0.0.0.0`
2. Find your computer's LAN IP:
   - Windows: `ipconfig` (the "IPv4 Address" line, e.g. `192.168.1.23`)
   - macOS: `ipconfig getifaddr en0`
3. On the phone, open `http://192.168.1.23:8765/`.
4. If it doesn't load, allow Python through the Windows firewall on "Private" networks. Check that both devices are on the same network, not a guest network.
5. For the full-screen feel, use "Add to Home Screen" (iOS Safari: Share, then Add to Home Screen; Android Chrome: menu, then Install app). It then opens without browser bars, in portrait.

Tips: turn the phone sound on (the game has synthesized SFX). Vibration works on Android only, because iOS Safari has no vibration API.

## URL flags

| Flag | Effect |
|---|---|
| `?debug=1` | Debug overlay (goal window, nominal arc, band / speed / clock numbers), difficulty-schedule self-check in the console, `window.__fg` handle, and the settings footer shows the ads mode |
| `?qa` | `window.__fg` handle for console poking (`__fg.shop.addCoins(5000)`, `__fg.game`, `__fg.save.data`), plus the ads-mode footer. No overlay |
| `?smoke` | Same as `?qa` (used by the automated smoke test) |
| `?ads=off` | Runs as if `monetization.mode = 'off'`: every ad and IAP button is hidden, so you can check that the game is complete without them |

Handy console snippets (with `?qa`):

```js
__fg.shop.addCoins(5000, 'gift')          // test the store
__fg.save.update(d => { d.lastGiftAt = 0 }) // make the free gift ready again
__fg.save.reset(); location.reload()       // fresh player (keeps No Ads + settings)
localStorage.clear(); location.reload()    // truly fresh
```

## What to look for

- **Core feel.** Does the needle feel fair? The green band gets narrower and fainter as your score climbs, but its edge brackets always stay visible. Taps just outside the green can still go in off the post ("DOINK!"). This is on purpose.
- **Difficulty.** Is it too easy or too hard around score 10, 30 and 60? See `difficulty` below.
- **Economy.** Are coins earned too fast or too slow for the store prices?
- **Flow.** Menu, play, game over, continue, store, back. Nothing should ever get stuck, and no browser pop-ups should appear.

## Monetization: where the real SDKs plug in (after approval)

Everything goes through `src/platform/monetization.js`. For now it only has a **MockProvider**: obvious "TEST AD" overlays and a "TEST PURCHASE: no real money" sheet. The rest of the game only calls this adapter:

- `ads.showInterstitial(placement)` returns `{shown}`. It is called on leaving Game Over (Play Again / Home), every `interstitialEvery` game-overs, and skipped when No Ads is owned.
- `ads.showRewarded(placement)` returns `{rewarded}`. Placements: `continue`, `double_coins`, and `store_coins` (store "Watch" card).
- `iap.getProducts()`, `iap.purchase(productId)` returning `{ok}`, `iap.restore()`, `entitlements.noAds()`.

To go live, add a `NativeProvider` with the same six methods as `createMockProvider` (`init`, `showInterstitial`, `showRewarded`, `getProducts`, `purchase`, `restore`), and select it in `createMonetization()` when `cfg.monetization.mode === 'native'`:

- **Ads: AdMob** via `@capacitor-community/admob`. `AdMob.initialize()` goes in `init`. `prepareInterstitial` / `showInterstitial` go in `showInterstitial`. `prepareRewardVideoAd` / `showRewardVideoAd` go in `showRewarded`, and it resolves `{rewarded:true}` only on the reward callback.
- **IAP: RevenueCat** via `@revenuecat/purchases-capacitor` (or `cordova-plugin-purchase`). `Purchases.configure` goes in `init`. `getOfferings` goes in `getProducts`, which should use the store's localized `priceString`. `purchaseStoreProduct` goes in `purchase`. `restorePurchases` goes in `restore`: re-grant `no_ads` when `entitlements.active['no_ads']`.
- Product ids live in `config.js` (`products`): `no_ads` (non-consumable), `coins_500`, `coins_1500`, `coins_5000`. Create the same ids in App Store Connect / Play Console.
- The adapter contract: every promise **resolves** (it never rejects). `isBusy()` is true while an ad or sheet is open, and the game pauses itself during that time. Grant coins only after the store confirms the purchase.
- Before shipping, also remove the `?ads=off` URL switch in `src/main.js`, or gate it behind a debug flag.

## Tunables in `src/config.js`

All numbers live in one file. Edit it, then reload.

| Area | Key | What it does |
|---|---|---|
| Difficulty | `difficulty.speed` `{start, asym, scale}` | Needle speed in rail-lengths per second: starts at `start`, approaches `asym`; `scale` is roughly how many goals it takes to get most of the way there |
| | `difficulty.band` | Green band width as a fraction of the rail (W). Smaller is harder. Keep `band/speed >= dwellMin` |
| | `difficulty.clock` | Shot clock in seconds |
| | `difficulty.distance`, `gap`, `barHeight` | Kick distance, goal window height, crossbar height ramp |
| | `difficulty.bandAlpha` | How visible the green fill stays (0.95 fading to 0.45) |
| | `difficulty.dwellMin`, `reaction` | "Always beatable" guarantees (MATH.md). `npm test` fails if a change breaks them |
| Scoring | `scoring.perfectFrac`, `perfectMaxPoints`, `tierEvery` | PERFECT window size, streak points cap, background colour change every N points |
| Coins | `economy.coinsPerGoal`, `coinsPerPerfectBonus`, `pickups.chance`, `pickups.value` | Coin earn rate |
| | `economy.gift` `{cooldownMs, min, max, step}` | Free gift (every 4 h, 25-50 coins) |
| | `economy.rewardedCoins`, `rewardedCoinsCooldownMs` | "Watch ad for coins" amount and cooldown |
| | `economy.continuesPerRun` | Continues per run (via rewarded ad) |
| Store | `catalog.balls[]`, `catalog.stadiums[]` (`price`) | Skin prices (ids must match `src/engine/skins.js`) |
| IAP | `products[]` (`priceString`, `grants`) | Placeholder prices and what each pack grants |
| Ads | `monetization.mode` (`'mock'` or `'off'`), `interstitialEvery`, `minGamesBeforeInterstitial` | Ad frequency |
| Feel | `physics.gravity`, `restitutionPost`, `timing.introTime`, `timing.missDelay` | Arc weight, post bounciness, pacing |
| Look | `view.zoomMax`, `view.slackBelow`, `view.hudReserve` | Camera framing (how big and how centred the action is) |
| | `rail.lengthFrac`, `rail.thickness`, `rail.markerWidth` | Aim rail size and needle width |
| Haptics | `haptics.*` | Vibration patterns (ms) |
