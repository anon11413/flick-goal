// Build profile (pure data). This committed copy is the DEV profile used by local testing and the
// GitHub Pages playtest build. Packaging scripts overwrite THIS FILE ONLY in their copied output
// (www/src/build-profile.js), never in the repo. See docs/MONETIZATION_PLAN.md §3.
//
//   profile   'dev'             local / Pages playtests: mock ads + mock purchases, dev tools, ?qa ?round ... flags
//             'web-release'     a public web build: monetization off, dev tools off, URL flags ignored
//             'android-debug'   debug APK: AdMob with Google TEST ads always, RevenueCat Test Store key if set,
//                               dev tools on, URL flags ignored
//             'android-release' store AAB: dev tools off, URL flags ignored, RevenueCat Google key only
//   adMode    'test' | 'live'   release builds only: 'test' keeps Google's test ad units (closed testing),
//                               'live' uses your real AdMob units from src/config.js (store.admob)
export const BUILD = Object.freeze({ profile: 'dev', adMode: 'test' });

export default BUILD;
