# Flick Goal: monetization and Google Play plan

Status: research + design only. No game code has been changed yet.
Researched: 2026-09-23 against current official docs and the npm registry, and by reading the plugins' shipped source (`npm pack`).
Branch: `v2/standard` (this work is later merged into `v2/hard-perfect`).

Goal: real AdMob ads that pay, real Google Play purchases for coins and No Ads, a working Restore Purchases, and an app that is ready for Google Play. It must all work now with **test IDs**. Switching to real IDs means editing **one config block** (section 5.2). The web build (GitHub Pages, local testing) keeps working without the native SDKs.

---

## 1. Verified facts (with sources)

### 1.1 Versions to pin (npm registry, 2026-09-23)

| Package | Version to pin | Notes |
|---|---|---|
| `@capacitor/core` | **8.5.2** | latest stable (Capacitor 9 is still `9.0.0-alpha.7` on `next`) |
| `@capacitor/cli` (dev) | **8.5.2** | `engines.node >= 22.0.0` |
| `@capacitor/android` | **8.5.2** | peer `@capacitor/core ^8.5.0`. Native defaults: minSdk 24, compileSdk 36, targetSdk 36, AGP 8.13.0, Java 21 |
| `@capacitor/app` | **8.1.1** | peer `@capacitor/core >=8.0.0`. Provides back button, pause/resume, exitApp |
| `@capacitor-community/admob` | **8.1.0** (published 2026-08-14) | for Capacitor 8 (README: "If you use Capacitor 7: `npm install @capacitor-community/admob@7`"). Android uses `play-services-ads 25.4.+` (GMA SDK "Legacy") and `user-messaging-platform 4.0.0` |
| `@revenuecat/purchases-capacitor` | **13.6.0** (2026-09-17) | peer `@capacitor/core >=8.0.0`. Uses purchases-hybrid-common 19.0.0 → purchases-android 10.21.1 → **Play Billing Library 8.3.0** |
| System Bars | bundled in `@capacitor/core` 8 | `SystemBars` core plugin, no extra package (replaces `@capacitor/status-bar` for edge-to-edge/immersive) |

- Node: Capacitor 8 needs **Node 22+** ([environment setup](https://capacitorjs.com/docs/getting-started/environment-setup), [Capacitor 8 upgrade guide](https://capacitorjs.com/docs/updating/8-0)). This PC has Node 24.18.0.
- Capacitor 8 Android: minSdk 24, compile/target 36, AGP 8.13.0, Gradle 8.14.3, Kotlin 2.2.20 ([upgrade guide](https://capacitorjs.com/docs/updating/8-0)). The `build.gradle` files of both plugins set `JavaVersion.VERSION_21`, so CI needs **JDK 21**. The GitHub `ubuntu-24.04` runner defaults to JDK 17 ([runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)), so the workflow must pick 21 itself.
- Sources: `npm view <pkg> version peerDependencies engines`, and the `android/build.gradle` inside each tarball. RevenueCat versions table: [purchases-capacitor VERSIONS.md](https://github.com/RevenueCat/purchases-capacitor/blob/main/VERSIONS.md).

### 1.2 Using plugins without a bundler (checked in the `@capacitor/android` 8.5.2 source)

- At page load, the Android bridge injects `window.Capacitor = { Plugins: {} }` plus one proxy per native plugin (`JSExport.getPluginJS`). Every native method is exposed as `window.Capacitor.Plugins.<Id>.<method>(options)` and returns a Promise (`nativePromise`). `addListener(event, cb)` is also exposed.
- The bridge (`native-bridge.js`) defines `Capacitor.isNativePlatform()`, `Capacitor.getPlatform()`, `Capacitor.isPluginAvailable(name)`, `nativePromise` and `nativeCallback`.
- **`registerPlugin` is not defined by the bridge**. It lives in `@capacitor/core` JS, which we don't bundle. So we use `window.Capacitor.Plugins.AdMob`, `.Purchases` and `.App` directly, after checking `Capacitor.isPluginAvailable('AdMob')` and the others. The plugin IDs are `'AdMob'` (admob `index.js`), `'Purchases'` (RevenueCat `index.js`) and `'App'`.
- RevenueCat's `addCustomerInfoUpdateListener` is a `RETURN_CALLBACK` method. Through the proxy it is `Plugins.Purchases.addCustomerInfoUpdateListener(cb)`: `nativeCallback` accepts a function as its first argument. The native side calls `cb(customerInfo)` on every update, and also right away with the last cached value.
- Enum values come in as plain strings, so the code uses string literals (listed below).

### 1.3 AdMob plugin API (`@capacitor-community/admob` 8.1.0; read from `definitions.d.ts` and the Android sources)

- **Init:** `AdMob.initialize({ initializeForTesting?, testingDevices?, tagForChildDirectedTreatment?, tagForUnderAgeOfConsent?, maxAdContentRating? })`. It calls `MobileAds.setRequestConfiguration(...)` and then `MobileAds.initialize`. `maxAdContentRating` takes `'General' | 'ParentalGuidance' | 'Teen' | 'MatureAudience'` (G / PG / T / MA).
- **Consent (UMP):**
  - `requestConsentInfo({ debugGeography?, testDeviceIdentifiers?, tagForUnderAgeOfConsent? })` returns `{ status: 'NOT_REQUIRED'|'OBTAINED'|'REQUIRED'|'UNKNOWN', isConsentFormAvailable, canRequestAds, privacyOptionsRequirementStatus: 'NOT_REQUIRED'|'REQUIRED'|'UNKNOWN' }`.
  - `showConsentForm()` wraps `UserMessagingPlatform.loadAndShowConsentFormIfRequired` and returns the same info.
  - `showPrivacyOptionsForm()` and `resetConsentInfo()` also exist.
  - Debug geography: `1` = EEA, `3` = US regulated state, `4` = other, `0` = disabled.
- **Rewarded:** `prepareRewardVideoAd({ adId, isTesting?, npa?, immersiveMode?, ssv? })` resolves `{adUnitId}` on load and **rejects** on load failure (no fill, network). `showRewardVideoAd({adId?})` then shows it.
  - Events: `onRewardedVideoAdLoaded`, `onRewardedVideoAdFailedToLoad`, `onRewardedVideoAdShowed`, `onRewardedVideoAdFailedToShow`, `onRewardedVideoAdDismissed`, **`onRewardedVideoAdReward`** (payload `{type, amount}`), and `onRewardedVideoAdImpression` (revenue data).
- **Critical source finding:** on Android, the `showRewardVideoAd` promise **resolves only when the reward is earned**. If the user closes the ad early, the promise **never settles**. A failure to show fires only the `FailedToShow` event and does not reject the call either (`RewardedAdCallbackAndListeners.kt`, `AdRewardExecutor.java`). So the provider must never `await` that promise alone. It finishes on `Dismissed` / `FailedToShow`, and grants only if `Reward` fired (section 5.4).
- **Interstitial:** `prepareInterstitial({adId, immersiveMode?})` and `showInterstitial({adId?})`. The show call resolves **as soon as the ad is shown**, not when it closes, so the end is detected with `interstitialAdDismissed` or `interstitialAdFailedToShow`. Other events: `interstitialAdLoaded`, `interstitialAdFailedToLoad`, `interstitialAdShowed`, `interstitialAdImpression`.
- **Test mode:** when `isTesting: true`, the plugin replaces the ad unit with Google's test unit, unless the device is registered as a test device (`AdViewIdHelper.getFinalAdId`).
- **App ID** (README "Android configuration"): add to `android/app/src/main/AndroidManifest.xml` under `<application>`:
  ```xml
  <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="@string/admob_app_id"/>
  ```
  and add `<string name="admob_app_id">ca-app-pub-…~…</string>` to `res/values/strings.xml`. Without an App ID the GMA SDK crashes at startup, so the test App ID must be there from day one.
- README: SSV callbacks fire only for production ads, never for test ads.

### 1.4 Google test IDs ([test ads](https://developers.google.com/admob/android/test-ads), [quick start](https://developers.google.com/admob/android/quick-start))

| What | ID |
|---|---|
| Sample **App ID** (Android) | `ca-app-pub-3940256099942544~3347511713` |
| Rewarded | `ca-app-pub-3940256099942544/5224354917` |
| Interstitial | `ca-app-pub-3940256099942544/1033173712` |
| Rewarded interstitial (not used) | `ca-app-pub-3940256099942544/5354046379` |

- **Test devices:** the SDK logs `Use RequestConfiguration.Builder.setTestDeviceIds(Arrays.asList("<ID>")) to get test ads on this device.` Pass that ID in `testingDevices` with `initializeForTesting: true`. Emulators are test devices automatically. Registration can take 15 min to 24 h.
- Google says to replace the demo IDs before publishing and to remove test-device code before release.
- **UMP test devices** use a *hashed* ID from logcat and `debugGeography` ([UMP guide](https://developers.google.com/admob/android/privacy)).

### 1.5 UMP consent flow ([AdMob Android privacy](https://developers.google.com/admob/android/privacy))

- Call `requestConsentInfoUpdate` **on every app launch**, then `loadAndShowConsentFormIfRequired`.
- Request ads only when `canRequestAds()` is true. It is always false until the consent info has been requested.
- If `getPrivacyOptionsRequirementStatus()` is REQUIRED, the app must offer a visible privacy options entry point that calls `showPrivacyOptionsForm()`.
- UMP SDK version: 4.0.0 (the plugin pins it).
- The [quick start](https://developers.google.com/admob/android/quick-start) says to set consent flags and get consent **before** `MobileAds.initialize()`. Initialization may already preload ads.
  - The plugin README calls `initialize()` first, but we deliberately follow Google's order: consent first, then `initialize()`. The plugin's consent methods don't depend on `initialize`: `AdConsentExecutor` uses `UserMessagingPlatform` directly.
- Google requires a **Google-certified CMP** for ads served in the EEA and UK (since 2024-01-16) and Switzerland (since 2024-07-31). Google's own Privacy & messaging (UMP, CMP ID 300) is certified ([AdMob help 13554116](https://support.google.com/admob/answer/13554116)).
  - The UMP form only exists after the owner **creates a GDPR message in AdMob → Privacy & messaging**. Without it, EEA/UK users get `canRequestAds = false`, which means no ads and no revenue there.

### 1.6 RevenueCat Capacitor SDK (13.6.0; types from `purchases-typescript-internal-esm` 19.0.0)

- `Purchases.configure({ apiKey, appUserID?: null, ... })`: call it **once**, early. Use the **public app-specific SDK key** only, never a secret key ([configuring the SDK](https://www.revenuecat.com/docs/getting-started/configuring-sdk)). A null `appUserID` gives an anonymous ID.
- `getProducts({ productIdentifiers: [...], type: 'NON_SUBSCRIPTION' })` returns `{ products: PurchasesStoreProduct[] }`. **The type defaults to `SUBSCRIPTION`** (source: `val type = call.getString("type") ?: "SUBSCRIPTION"`), so one-time products must pass `'NON_SUBSCRIPTION'`. Product fields: `identifier`, `title`, `description`, `price`, **`priceString`** (localized), `currencyCode`, `productCategory`.
- `purchaseStoreProduct({ product })`: pass the product object exactly as `getProducts` returned it. The native side reads `identifier` and `productCategory`. It returns `{ productIdentifier, customerInfo, transaction }`.
  - `transaction.transactionIdentifier` is the **Google orderId** here (`StoreTransactionMapper.kt`: `orderId ?: …`).
- `getOfferings()` and `purchasePackage({ aPackage })` exist too. We don't need them (section 5.5).
- `restorePurchases()` returns `{ customerInfo }`. Call it **only from a user action**. For programmatic, prompt-free restore at launch, RevenueCat recommends `syncPurchases()` ([restoring purchases](https://www.revenuecat.com/docs/getting-started/restoring-purchases)).
- `getCustomerInfo()` returns `{ customerInfo }`. The customer info listener is described in 1.2.
- `CustomerInfo` fields:
  - `entitlements.active[<id>]`
  - `allPurchasedProductIdentifiers`
  - **`nonSubscriptionTransactions: [{ transactionIdentifier, productIdentifier, purchaseDate (ISO), purchaseDateMillis }]`**. Here **`transactionIdentifier` is RevenueCat's own transaction id, not the Google orderId**: `TransactionMapper.kt` maps `Transaction.transactionIdentifier`, which comes from backend `"id"` (purchases-android `Transaction.kt`). The two ID spaces differ, so dedupe must key on the RevenueCat ID (section 5.6).
- **Errors** reject with `code` as a string plus `message` and `data`/`userInfo`:
  - `'1'` PURCHASE_CANCELLED, `'2'` STORE_PROBLEM, `'3'` PURCHASE_NOT_ALLOWED, `'5'` PRODUCT_NOT_AVAILABLE_FOR_PURCHASE, `'6'` PRODUCT_ALREADY_PURCHASED, `'10'` NETWORK, `'15'` OPERATION_ALREADY_IN_PROGRESS, **`'20'` PAYMENT_PENDING**, `'23'` CONFIGURATION, `'35'` OFFLINE_CONNECTION.
  - Source: `generated/error-codes.d.ts`, and the plugin's `rejectWithErrorContainer` (`call.reject(message, code.toString(), info)`).
- **Consumables vs non-consumables on Google Play:**
  - The RevenueCat SDK acknowledges or consumes purchases automatically, unless `purchasesAreCompletedBy: MY_APP`, which we won't use.
  - In the RevenueCat dashboard, a Play one-time product is **consumed unless it is marked "non-consumable"**. Non-consumable support needs Android SDK ≥ 7.11.0; we ship 10.21.1 ([Google Play product setup](https://www.revenuecat.com/docs/getting-started/entitlements/android-products), [non-subscriptions](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)). So `no_ads` **must** be marked non-consumable, or Google will let the user buy it again.
  - "Logic for keeping track of consumable redemptions must be handled outside of RevenueCat" ([non-subscriptions](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)).
  - Products attached to an entitlement unlock it **forever**, consumable or not ([entitlements](https://www.revenuecat.com/docs/getting-started/entitlements)), so **coin packs must NOT be attached to the `no_ads` entitlement**.
- **Pending purchases:** Google returns PENDING for cash, bank or carrier payments. RevenueCat passes this on as `PAYMENT_PENDING_ERROR`. When the payment completes, CustomerInfo updates through the listener or the next `getCustomerInfo` ([RC community on PAYMENT_PENDING](https://community.revenuecat.com/sdks-51/understanding-payment-pending-error-2162), [Google Play edge cases](https://www.revenuecat.com/blog/engineering/google-play-edge-cases/)). Google: grant only when the state is PURCHASED ([Play Billing integrate](https://developer.android.com/google/play/billing/integrate)).
- **Consumables can't be restored on Google Play** with Billing Library 8+, because Google removed the ability to query consumed purchases ([restoring purchases](https://www.revenuecat.com/docs/getting-started/restoring-purchases)).
- **Test Store:** a RevenueCat-hosted fake store with its own **Test API key**. The app shows a modal to simulate success, failure or cancel, with no Play Console needed ([Test Store](https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store)). It needs Capacitor SDK ≥ 11.2.6. "Never submit an app … configured with a Test Store API key", and a release build that starts with one shows an alert and crashes ([RC blog/search result](https://www.revenuecat.com/blog/company/revenuecat-test-store)). **Debug builds only.**
- Android manifest: set the activity `launchMode` to `standard` or `singleTop`. Otherwise purchases that go through a bank app can be cancelled when the app is backgrounded ([Capacitor install](https://www.revenuecat.com/docs/getting-started/installation/capacitor)). **Checked:** the Capacitor 8.5.2 Android template (`@capacitor/cli` `assets/android-template.tar.gz`) ships `android:launchMode="singleTask"`, so we **change it to `singleTop`**. The template's `configChanges` already includes `density`, `allowBackup="true"` is set, and `variables.gradle` has min 24 / compile 36 / target 36.
- Pricing: free up to $2,500 monthly tracked revenue, then 1% of tracked revenue ([pricing](https://www.revenuecat.com/pricing/)).
- Data safety: RevenueCat collects **Purchase history**, for the purposes "App functionality" and "Analytics" ([RC: Google Play's Data Safety](https://www.revenuecat.com/docs/platform-resources/google-platform-resources/google-plays-data-safety)).

### 1.7 Google Play requirements (as of 2026-09-23)

| Topic | Fact | Source |
|---|---|---|
| Target API | "Starting August 31 2026: New apps and app updates must target **Android 16 (API level 36)** or higher". Extension possible to 2026-11-01. Capacitor 8 targets 36. | [target-sdk](https://developer.android.com/google/play/requirements/target-sdk) |
| Play Billing Library | "By Aug 31, 2026, all new apps and updates … must use Billing Library **version 8** or later". RevenueCat 13.6.0 uses PBL 8.3.0. | [deprecation FAQ](https://developer.android.com/google/play/billing/deprecation-faq) |
| Android 16 large screens | For targetSdk 36, `screenOrientation` is **ignored on displays with sw ≥ 600dp**, *except games* (`android:appCategory="game"`). We set `appCategory="game"` so portrait lock keeps working on tablets. Edge-to-edge opt-out is also gone, so safe-area insets must be handled. | [Android 16 behavior changes](https://developer.android.com/about/versions/16/behavior-changes-16) |
| AD_ID | Apps targeting Android 13+ that use the advertising ID must declare `com.google.android.gms.permission.AD_ID`. **play-services-ads already declares it** and it merges into our manifest. Play Console → App content → **Advertising ID** declaration: answer "Yes, for advertising". | [Advertising ID](https://support.google.com/googleplay/android-developer/answer/6048248) |
| Data safety | Every published app must fill it in, **including data collected by SDKs**. Sending data to a "service provider" is not "sharing". A privacy policy URL is needed before the form can be submitted. | [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469) |
| AdMob data (for the form) | Collected & shared: **IP address** (approximate location), **user product interactions** (app launches, taps, video views), **diagnostics**, **device or other IDs** (ad ID, app set ID). Purposes: advertising, analytics, fraud prevention. Encrypted in transit (TLS). | [AdMob Play data disclosure](https://developers.google.com/admob/android/privacy/play-data-disclosure) |
| Privacy policy | Every app needs a privacy policy link in Play Console **and** inside the app. It must fully disclose data use, including by SDKs. | [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311) |
| Contains ads | Declare it under App content → Ads. The store listing shows a "Contains ads" label. | [Prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455) |
| Content rating | The IARC questionnaire is mandatory, and unrated apps are removed. Ads must not be much more mature than the app, so `maxAdContentRating` G/PG fits. | [Content ratings](https://support.google.com/googleplay/android-developer/answer/9898843) |
| Families | If the target audience **includes children**: only Families Self-Certified ad SDKs, no personalized ads, apps targeting only children must not request AD_ID (API 33+), no interstitials on app launch, rewarded ads closeable within 5 s, and mixed audiences need a neutral age screen. **Recommendation: target 13+ (see decision D1).** | [Families policy](https://support.google.com/googleplay/android-developer/answer/9893335) |
| AAB + signing | New apps must ship **Android App Bundles** with **Play App Signing**. Google holds the app signing key; we keep an **upload key**, which can be reset if lost (Play Console → Setup → App signing). Key validity of 25+ years is recommended. | [App signing](https://developer.android.com/studio/publish/app-signing) |
| New personal accounts | Personal accounts created after 2023-11-13 must run a **closed test with ≥ 12 testers opted in continuously for ≥ 14 days** before applying for production. Testers who drop out early don't count. Third-party guides say Google now also checks that testers actually used the app. | [testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465) |
| One-time products | IDs must start with a lowercase letter or digit and may use `a-z 0-9 _ .`. **IDs can never be changed or reused, even after deletion.** A payments profile (merchant) is required, and the app needs the BILLING permission (the RevenueCat SDK adds it). New model: one-time product plus "buy purchase options". PBL ≤ 7 needs a backwards-compatible option, and the first one is marked automatically. | [Create in-app product](https://support.google.com/googleplay/android-developer/answer/1153481), [one-time products overview](https://support.google.com/googleplay/android-developer/answer/16430488), [RC product IDs](https://www.revenuecat.com/docs/getting-started/entitlements/android-products) |
| Service fee | 15% on the first $1M/year for developers **enrolled** in the 15% tier, 30% above that. | [Service fees](https://support.google.com/googleplay/android-developer/answer/112622) |
| Developer verification | Google Play apps are registered automatically. The regional rollout (BR/ID/SG/TH) starts 2026-09-30 and goes global in 2027. It doesn't affect this Play-distributed app. | [developer verification](https://developer.android.com/developer-verification) |

### 1.8 app-ads.txt ([AdMob help 9363762](https://support.google.com/admob/answer/9363762))

- The app's store listing must include a **developer website**. AdMob's crawler reads `app-ads.txt` from the **root** of that domain, and probes up to one subdomain level.
  - Example: a developer site of `http://help.example.com/game` is checked at `help.example.com/app-ads.txt` and `example.com/app-ads.txt`. **Paths are dropped**, so a file under `/flick-goal/` is never read.
- Line format (IAB): `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`. The first three fields are required. `f08c47fec0942fa0` is Google's TAG ID; **AdMob shows the exact line to copy under Apps → app-ads.txt**.
- Crawling and verification can take up to 24 h, and it can be re-checked manually in AdMob.
- **Our case:** the owner already has a public user site repo **`anon11413/anon11413.github.io`**, served from `main` at `https://anon11413.github.io/` (checked with `gh api`). So:
  - Put `app-ads.txt` at the root of that repo, served at `https://anon11413.github.io/app-ads.txt`.
  - Set the Play listing's developer website to `https://anon11413.github.io/`.
  - Hosting it in the `flick-goal` repo would not work: that is a project site under a path, and Pages isn't even enabled for it.

### 1.9 How AdMob pays, and invalid-traffic rules

- **Revenue model:** advertisers pay per impression or click. Earnings are reported as eCPM (earnings per 1,000 impressions). Rewarded video usually has the highest eCPM, then interstitial. Every paid impression fires the plugin's `...AdImpression` event with `valueMicros` and `currencyCode` (optional local logging only).
- **App readiness:** a new AdMob app must be **listed in a supported store and linked** in AdMob. Until it is reviewed, which typically takes 2 to 3 days, ad serving may be limited ([app readiness](https://support.google.com/admob/answer/10564477)). Real revenue therefore starts after the production listing is live and linked.
- **Payments** ([thresholds](https://support.google.com/admob/answer/2772208), [payments timeline](https://support.google.com/admob/answer/2772140)):
  - The USD payment threshold is **$100**, and you can only choose a payment method once earnings reach it.
  - Identity, address and **PIN** verification are needed (PIN letter at $10).
  - Tax info is needed from $0.
  - Last month's finalized earnings post by the **3rd**. Payment details must be changed by the **20th**, and payment is issued **on or around the 21st** if the balance is above the threshold and there are no holds. Below the threshold, earnings roll over to the next month.
- **Invalid traffic** ([AdMob invalid traffic](https://support.google.com/admob/answer/3342054)): forbidden are clicking or viewing your **own live ads**, encouraging clicks, automated traffic, repeated clicks, and layouts that cause accidental clicks. The publisher is responsible even for third-party invalid traffic. Penalties: limited ad serving, withheld earnings, **account disabled**. Owner rules:
  1. Never tap real ads on your own phone. Always use **test ad units or a registered test device**. Debug builds force test units (section 5.2).
  2. Don't ask friends or closed-test testers to watch or click ads "to support you".
  3. Keep closed-testing builds on test ad units (`ad_mode=test`, section 7).
  4. The rewarded disclosure must state the reward before the user opts in, skipping must not block normal use, and no text may pressure the user to click ([rewarded policy](https://support.google.com/admob/answer/7313578)).
- **Interstitial placement** ([disallowed](https://support.google.com/admob/answer/6201362), [recommended](https://support.google.com/admob/answer/6201350)):
  - Not on app launch or exit.
  - Not after every user action. The Back button counts as a user action, and the limit is at most one interstitial per two user actions.
  - Games should place them at natural breaks. Game over → Play Again / Home qualifies.
  - Some interstitials can't be closed for 5 s (12 s for high-engagement video).

---

## 2. Decisions and deviations from the brief

- Everything in the fixed tech decisions is kept: Capacitor 8, the community AdMob plugin, RevenueCat, and access through `window.Capacitor`.
- The research changes these details:
  1. **Rewarded completion** is event-based (Dismissed / FailedToShow plus the Reward flag), because `showRewardVideoAd()` hangs when the user skips.
  2. **Consent before `AdMob.initialize()`**, following Google's order and not the plugin README's.
  3. **Coin dedupe keys on the RevenueCat transaction ID** from `customerInfo.nonSubscriptionTransactions`. The purchase result's `transactionIdentifier` is a different ID (the Google orderId).
  4. **The ledger has an epoch.** Coin transactions older than the save's `iap.since` are never granted automatically, so an old RevenueCat history never refills a fresh save.
  5. **`getProducts` rather than Offerings.** It needs fewer dashboard steps, and `config.js` stays the single source of product IDs. Offerings can come later if prices or the lineup should be changed remotely.
  6. **Product IDs are tier names** (`coins_small`…), not amounts. Play IDs can never be reused, and the coin amount granted comes from `config.js`, so it can be retuned without new Play products.
  7. **`android:appCategory="game"`** keeps portrait lock on tablets under targetSdk 36.
  8. **`launchMode="singleTop"`**, as RevenueCat requires.
  9. **Restore at launch uses `syncPurchases()` once per install**, not `restorePurchases()`, following RevenueCat's guidance.
  10. **RevenueCat Test Store key for debug builds** allows full purchase testing before any Play Console product exists. A release-build guard stops it from ever shipping.

**Owner decisions needed** (defaults in bold):
- D1 target audience: **13+, not designed for children**. If children are included, the Families policy applies: `tagForChildDirectedTreatment: true`, G rating, remove AD_ID if the app targets only children, and a neutral age screen for mixed audiences.
- D2 appId: **`com.flickgoal.game`**. It is permanent once uploaded to Play.
- D3 prices: see section 4.
- D4 ad frequency: **every 3 game overs, not in the first session, at least 2 min apart**.

---

## 3. Build profiles and what each one does

The default build profile is committed as `src/build-profile.js`. `scripts/build-web.mjs` overwrites it only in the copied `www/` output.

| Profile | Where | Ads | IAP | Dev tools / URL flags |
|---|---|---|---|---|
| `dev` (committed default) | local, GitHub Pages playtests | **mock** (today's behavior) | mock | on (`?qa ?debug ?round ?ads=off ?mode`) |
| `web-release` | a public web build, if ever made | off | off | off |
| `android-debug` | CI debug APK | AdMob, **forced Google test units** (`isTesting: true`) | RevenueCat **Test Store key** if set, else Google key (license tester) | `cfg.dev` on, URL flags ignored (native has no query string) |
| `android-release` | CI signed AAB | AdMob. `ad_mode=test` → test units, `ad_mode=live` → real units | RevenueCat **Google public key** (Test Store key rejected) | **all off**: `dev.enabled=false`, mock off, `?round/?ads/?qa/?debug` ignored |

`src/build-profile.js` (pure data):

```js
export const BUILD = { profile: 'dev', adMode: 'test' };
```

`config.js` imports it, which keeps it pure, and derives from it:
- `dev.enabled = BUILD.profile === 'dev' || BUILD.profile === 'android-debug'`
- `allowUrlFlags = BUILD.profile === 'dev'`

`main.js` reads `?ads=off`, `?qa`, `?debug`, `?round` and `?mode` only when `CONFIG.allowUrlFlags` is set.

---

## 4. Product catalog

Economy context (config.js):
- A run earns about 15 to 25 coins. The gift gives 25 to 50 every 4 h, and the rewarded ad gives 25 every 3 min.
- Catalog prices: Aim Slider 10,000; PRO stadiums 400 / 1,200 / 1,500 / 1,800 / 2,400 (7,300 total); retro stadiums 2,200 total; balls 5,200 total. **Everything together: 24,700 coins.**
- Design: each bigger pack gives more coins per dollar. The $4.99 pack equals the Aim Slider in one purchase, and $9.99 buys about 90% of the catalog.

| Play/RC product ID | Type (RevenueCat) | Grants | Base price (USD) | Coins per $ | Store tag |
|---|---|---|---|---|---|
| `no_ads` | **non-consumable**, attached to entitlement **`no_ads`** | removes interstitials forever | $2.99 | n/a | n/a |
| `coins_small` | consumable (not attached to any entitlement) | 1,500 | $0.99 | 1,515 | n/a |
| `coins_medium` | consumable | 5,000 | $2.99 | 1,672 (+10%) | POPULAR |
| `coins_large` | consumable | 10,000 | $4.99 | 2,004 (+32%) | "AIM SLIDER" |
| `coins_mega` | consumable | 22,000 | $9.99 | 2,202 (+45%) | BEST VALUE |

- Play converts the USD base price into local prices, and the app always shows the store's `priceString`.
- Leave **multi-quantity off**: the grant code assumes a quantity of 1.
- Titles and descriptions in Play Console can be edited later, but the **IDs are permanent**.
- The existing mock IDs (`coins_500/1500/5000`) exist only in the mock and are replaced in config.

---

## 5. Integration design

### 5.1 Files

```
package.json                   + deps (exact pins, §1.1); scripts: build:web, cap:sync, android:config
capacitor.config.json          appId, appName, webDir "www", plugins.SystemBars {hidden:true, insetsHandling:"css"}
src/build-profile.js           NEW (committed default 'dev'; overwritten in www/ by the build script)
src/config.js                  + BUILD import; `store` block (THE one block, §5.2); products → new ids; monetization timing
src/platform/native.js         NEW: tiny helpers: isNative(), plugin(name) → window.Capacitor.Plugins[name] | null,
                               call(pluginFn, opts, timeoutMs) → never-rejecting {ok, value, error:{code,message}}
src/platform/monetization.js   keep adapter + MockProvider; add provider selection matrix (§5.3)
src/platform/admobProvider.js  NEW: AdMobAdsProvider (consent, init, preload, show rewarded/interstitial)
src/platform/revenuecatProvider.js NEW: RevenueCatIapProvider (configure, products, purchase, restore, reconcile)
src/platform/nativeShell.js    NEW: back button, pause/resume, exit dialog, immersive (SystemBars.hide)
src/economy/save.js            + additive fields `iap`, `adState` (§5.6); KNOWN_KEYS; reset() keeps them
src/economy/shop.js            + creditPurchase({txId, productId}) (atomic ledger + coins), hasProcessed(txId)
src/main.js                    gate URL flags; await mon.ready for store prices; wire nativeShell; privacy row
src/ui/screens.js              Settings: "Privacy & ad choices" row (only when required); restore explainer
src/ui/store.js                localized prices, loading/pending/unavailable states, no "Test mode" footer on native
src/ui/dialogs.js              reuse confirmDialog for exit + pending purchase message
scripts/build-web.mjs          NEW: copy index.html, styles.css, icon.svg, manifest.webmanifest, src/ → www/; write www/src/build-profile.js
scripts/android-config.mjs     NEW: reads src/config.js (Node ESM) → writes android res/values/admob.xml (admob_app_id),
                               verifies capacitor.config.json appId, applies versionCode/versionName, guards release (§7)
android/                       generated once by `npx cap add android`, then committed (manifest edits below)
.github/workflows/android.yml  NEW (§7)
store/app-ads.txt              template for the owner to copy to anon11413.github.io
store/privacy-policy.html      draft privacy policy for the owner to review and host
tests/monetization.test.mjs    NEW: fake AdMob/Purchases objects → reward/skip/no-fill/timeout, ledger dedupe, pending, restore
```

**Android manifest edits** (made once after `cap add android`, then committed):
- `<application android:appCategory="game" ...>`
- AdMob `APPLICATION_ID` meta-data → `@string/admob_app_id`. The value is generated into `res/values/admob.xml` by `scripts/android-config.mjs`.
- Main activity: `android:screenOrientation="portrait"` and `android:launchMode="singleTop"` (the template has `singleTask`). `density` is already in the template's `configChanges`.
- Leave AD_ID to the merge from play-services-ads (D1 = 13+). Don't add `tools:node="remove"`.

### 5.2 The ONE config block (owner edits only this)

In `src/config.js`:

```js
// ====================== STORE / MONETIZATION IDS: THE ONLY BLOCK TO EDIT FOR GO-LIVE ======================
// Public client IDs only (safe in a public repo). NEVER put RevenueCat *secret* keys, keystores,
// passwords or service-account JSON here. Debug builds ALWAYS use Google test ad units regardless.
store: {
  androidAppId: 'com.flickgoal.game',          // must match capacitor.config.json "appId" (script checks). Permanent once on Play.
  admob: {
    appId: 'ca-app-pub-3940256099942544~3347511713',              // TEST app id → replace with yours (has '~')
    rewarded: 'ca-app-pub-3940256099942544/5224354917',           // TEST → your rewarded unit (has '/')
    interstitial: 'ca-app-pub-3940256099942544/1033173712',       // TEST → your interstitial unit
    testDeviceIds: [],                        // your phone's id from logcat, for testing real units safely
    tagForChildDirectedTreatment: false,      // D1: true only if the audience includes children
    tagForUnderAgeOfConsent: false,
    maxAdContentRating: 'ParentalGuidance',   // 'General' | 'ParentalGuidance' | 'Teen'
  },
  revenuecat: {
    googleApiKey: '',       // RevenueCat → Apps → Play Store app → Public SDK key ("goog_…")
    testStoreApiKey: '',    // RevenueCat Test Store key: DEBUG builds only (release build refuses it)
    noAdsEntitlement: 'no_ads',
  },
},
```

- `scripts/android-config.mjs` copies `store.admob.appId` into `android/app/src/main/res/values/admob.xml` during every CI build. The App ID therefore lives only in `config.js`.
- `capacitor.config.json` holds the `appId`, which the CLI needs. The script fails if it differs from `store.androidAppId`.

### 5.3 Provider selection (`createMonetization`)

```
native = window.Capacitor?.isNativePlatform?.() && Capacitor.getPlatform() === 'android'
ads  = native && isPluginAvailable('AdMob')     ? AdMobAdsProvider
     : BUILD.profile==='dev' && mode!=='off'    ? MockProvider.ads
     : null (off)
iap  = native && isPluginAvailable('Purchases') && key(profile) ? RevenueCatIapProvider
     : BUILD.profile==='dev' && mode!=='off'    ? MockProvider.iap
     : null (off)
key(profile) = profile==='android-debug' ? (testStoreApiKey || googleApiKey) : googleApiKey
```

- `mon.enabled` stays true when either side is on. Add `mon.adsEnabled` and `mon.iapEnabled`, so the UI hides only what is unavailable. Example: IAP off because no key is set yet, while ads still work.
- The adapter contract doesn't change: every promise **resolves**, and `busy` pauses the simulation.
- New adapter members:
  - `mon.ready`: a promise that resolves when consent, init and the first product fetch have settled, with a timeout.
  - `ads.rewardedState()`: `'ready' | 'loading' | 'unavailable'`.
  - `privacy.required()` and `privacy.show()`.
  - `iap.onChange(fn)` fires on entitlement or coin grants from background reconciliation.

### 5.4 Ads flows (AdMobAdsProvider)

**Startup**, in the background after `boot()`. It never blocks the first frame:
1. `AdMob.requestConsentInfo({ tagForUnderAgeOfConsent })`, with a 10 s timeout. In debug builds, add `debugGeography` and `testDeviceIdentifiers` from config when set.
2. If `status === 'REQUIRED' && isConsentFormAvailable`, call `AdMob.showConsentForm()`. The busy flag is on while it shows, and the game is still on the menu.
3. Save `privacyOptionsRequirementStatus`. When it is REQUIRED, Settings shows a **"Privacy & ad choices"** row that calls `AdMob.showPrivacyOptionsForm()` and then re-reads the consent info.
4. If `canRequestAds`, call `AdMob.initialize({ tagForChildDirectedTreatment, tagForUnderAgeOfConsent, maxAdContentRating, initializeForTesting: testDeviceIds.length>0, testingDevices })` **once**, then preload one rewarded ad and one interstitial.
5. If consent can't be obtained (form error, offline), ads stay `unavailable` for this session and are retried on the next launch and on `resume`. The game is fully playable without them.

**Preload:**
- `prepareRewardVideoAd({ adId, isTesting: forceTest, immersiveMode: true })`. Same for the interstitial.
- `forceTest` = `profile==='android-debug' || adMode==='test'`.
- On load failure, retry with backoff (30 s, 60 s, 120 s, max 5 min). Also retry when the app resumes.
- Reload a cached ad after 55 min (conservative, to avoid stale ads).
- Only one load per format at a time.

**`showRewarded(placement)`**:
1. If a full-screen ad is already showing (busy), return `{rewarded:false, error:'busy'}`.
2. If not loaded: set busy, show the in-DOM overlay "Loading video…" (with a Cancel button), and wait up to **`rewardedLoadTimeoutMs` = 8000** for the in-flight load, or start one.
   - On timeout or failure, return `{rewarded:false, error:'no_ad'}`.
   - The caller shows the toast **"No ad available right now. Try again in a moment."** and the button re-enables. The game over screen stays fully usable (Play Again / Home always work).
3. Before calling show, register one-shot listeners: `onRewardedVideoAdReward` → `earned = true`, `onRewardedVideoAdDismissed` → finish, `onRewardedVideoAdFailedToShow` → finish(error `'show_failed'`).
4. Call `showRewardVideoAd({adId})` **without awaiting it for completion**. A rejection there, such as "not prepared", finishes with `'show_failed'`.
5. **Finish** = remove the listeners, then wait a **400 ms grace** after Dismissed in case Reward arrives late, then resolve `{rewarded: earned}`.
   - Watchdog: if the App plugin reports `resume` and no Dismissed arrives within 3 s, finish with the current `earned`.
   - Then record `adState.lastRewardedAt = now`, clear busy, and start preloading the next ad.
6. The caller grants **only** when `rewarded === true`: Continue, 2x coins, or `store_coins`. A close, failure or no-fill grants nothing.
   - Existing toasts: "Watch the full video to continue" is shown **only** when the ad was shown but skipped. On `no_ad`, show the friendly no-ad toast instead.

**`maybeInterstitial(save)`**. It shows an ad only if **all** of these hold:
- ads on and No Ads **not** owned
- `adState.sessions >= 2` (never in the first session). `sessions` increments once per cold start.
- `stats.gamesPlayed >= minGamesBeforeInterstitial` (3)
- `++adCounter >= interstitialEvery` (3)
- `now - adState.lastInterstitialAt >= interstitialMinGapMs` (120 000)
- **no rewarded ad in this game over**, and `now - adState.lastRewardedAt >= afterRewardedGapMs` (90 000)
- an interstitial is **already loaded**. We never wait for one and never show a spinner. If it isn't loaded, skip silently and load one.

If the interstitial is skipped for the rewarded or gap rules, the counter stays at the threshold, so the next eligible game over shows it. Showing one resets the counter and sets `lastInterstitialAt`.

Show: busy on → `showInterstitial()` → finish on `interstitialAdDismissed` or `interstitialAdFailedToShow`, with a 3 s resume watchdog → busy off → preload.

It only runs from Play Again or Home after a game over (natural breaks). Never on launch, never on Back-to-exit, never mid-run.

**Other:**
- Mute the game's WebAudio while an ad is showing: busy → `audio.suspend()`.
- Optional: call `AdMob.setApplicationMuted({muted: !sound})` when the Sound setting changes.
- Optional: log `...AdImpression` `valueMicros` to the console in debug builds, to see eCPM while testing.
- Rewarded SSV is **future work**. Coins are local, so a client-side grant on the `Reward` event is acceptable now. SSV needs a server endpoint, and callbacks don't fire for test ads.

### 5.5 Purchase flows (RevenueCatIapProvider)

**Startup**, in the background:
1. `Purchases.configure({ apiKey: key(profile) })` once. Use `setLogLevel({level:'DEBUG'})` in debug builds only.
2. `addCustomerInfoUpdateListener(ci => reconcile(ci))`
3. **First native launch** (`save.iap.synced !== true`): `syncPurchases()` → `synced = true`. This quietly restores No Ads after a reinstall on the same Google account.
4. `getCustomerInfo()` → `reconcile(ci)`
5. `getProducts({ productIdentifiers: products.map(p=>p.id), type: 'NON_SUBSCRIPTION' })`, cached. Retry each time the COINS tab opens if the last fetch failed.

**Store UI states:**
- Loading: skeleton price "…".
- Loaded: the store's `priceString`.
- Product missing or offline: price shows "Unavailable" and the button is disabled, with the line "Store unavailable. Check your connection." and a tap to retry.
- The mock "Test mode, purchases are simulated" footer shows only for the mock provider.

**`purchase(productId)`:**
1. Guards: busy, unknown product, No Ads already owned (as today).
2. Busy on, and the pack button shows a spinner. The Google sheet is native.
3. `purchaseStoreProduct({ product: storeProducts[id] })`
4. On **success**: `reconcile(result.customerInfo, { justBought: result })`. This returns `{coins, noAds}` and runs the confetti/coin fly.
5. On **error**:

| Code | Behavior |
|---|---|
| `'1'` cancelled | silent |
| `'20'` pending | dialog: "Payment pending. Your coins will be added automatically once Google Play confirms the payment." |
| `'6'` already purchased (no_ads) | `getCustomerInfo()`, then reconcile, then toast "No Ads restored" |
| `'15'` in progress | silent |
| `'10'`/`'35'` network or offline | toast "No connection. Try again." |
| `'5'` not available | toast "This item isn't available right now" |
| `'3'` not allowed | toast "Purchases are disabled on this device" |
| other | toast "Purchase failed. You were not charged." |

The busy flag is always cleared in a `finally` block.

**`restore()`**, only from the user's Restore button (Settings and Store):
1. `restorePurchases()` → `reconcile(ci)`.
2. Result messages:
   - `no_ads` active: "No Ads restored ✓"
   - else: "No purchases to restore for this Google account."
   - Always add the explainer line: "Coin packs are used up when bought, so Google Play can't restore them."
3. On error: "Restore failed. Check your connection."

### 5.6 Exactly-once coin grants: the ledger

Additive save fields (the save stays at `v: 2` and `flickgoal.save2`, and `KNOWN_KEYS` is extended). `reset()` **keeps** both new fields, and `migrate()` validates them.

```js
iap: {
  since: <ms>,      // ledger epoch: set once when the field is first created (fresh install / first run of this build)
  done: [ids],      // RevenueCat transactionIdentifiers already credited (strings ≤ 64 chars, keep last 500)
  orphans: [{ p, t, o }], // rare fallback: credited from a purchase result without a matching RC tx yet (productId, purchaseMs, orderId)
  synced: false,    // first-launch syncPurchases done
},
adState: { sessions: 0, lastInterstitialAt: 0, lastRewardedAt: 0 },
```

**`reconcile(customerInfo, {justBought}?)`** is the single entry point, used by the purchase result, the listener, launch and restore:
1. **No Ads:** if `customerInfo.entitlements.active.no_ads` exists, call `shop.setNoAds(true)`.
   - If a *successful* CustomerInfo positively lacks it while the local flag is true, the purchase was refunded or revoked: set it false. Only do this on native release builds with the Google key, **never** when a Test Store key is in use.
   - Offline, the local flag is the cache.
2. **Coins:** for each `tx` in `customerInfo.nonSubscriptionTransactions` where `tx.productIdentifier` is a coin pack, `tx.transactionIdentifier` is not in `done`, and `tx.purchaseDateMillis >= iap.since - 5 min`:
   - If an `orphan` matches (same product, `|t - purchaseDateMillis| < 2 min`), move it to `done` **without** crediting.
   - Otherwise call `shop.creditPurchase({ txId, productId })`. In one `save.update`, it checks `done` again, pushes the ID and adds the coins, so it is atomic and idempotent. Emit `{type:'coins', source:'iap'}`.
3. **Fallback** (should not happen): if `justBought` is a coin pack and step 2 credited nothing for that product, call `getCustomerInfo()` once and repeat. If it is still missing, credit from `justBought` and store an `orphan`, so the later RevenueCat transaction isn't credited twice.

**Why this handles every edge case:**
- **Listener and purchase result race:** the same RevenueCat ID appears in both, and `done` is checked inside one synchronous `save.update`.
- **App killed after Google charged but before JS granted:** RevenueCat's SDK finishes and consumes the purchase on the next start or foreground. CustomerInfo then contains the transaction and `reconcile` credits it on launch.
- **Pending → completed later:** the listener or the next launch brings the transaction and it is credited once.
- **Reinstall or cleared data:** the fresh save gets `since = now`. Consumed purchases can't be queried on Google Play anyway. If RevenueCat still links an old history, the epoch stops old transactions from refilling coins. **No Ads comes back** through `syncPurchases()` (entitlement).
- **Multi-tab or sibling builds on the web:** not relevant on native. The ledger lives in the shared save, and unknown keys are preserved by older builds.
- **Test Store to Google key switch:** Test Store transactions sit under a different RevenueCat app, so they never appear for the Google key.

### 5.7 Native shell (`nativeShell.js`, native only)

- **Immersive:** `capacitor.config.json` → `plugins.SystemBars: { hidden: true, insetsHandling: "css" }`, plus `SystemBars.hide()` on resume through `Capacitor.Plugins.SystemBars`.
  - CSS: `--sat: max(env(safe-area-inset-top,0px), var(--safe-area-inset-top,0px))` and the same for the other edges. Android WebView < 140 misreports `env()` ([SystemBars](https://capacitorjs.com/docs/apis/system-bars)).
  - Full-screen ads use `immersiveMode: true`.
- **Back button** (`App.addListener('backButton', …)`; adding the listener turns off the default back behavior):

| Current state | Back does |
|---|---|
| ad or purchase busy | ignore |
| dialog, sheet or reward popup open | close it (cancel) |
| `playing` | pause |
| `paused` | resume |
| `store` / `settings` | `app.back()` |
| `gameover` | same as Home (goes through `maybeInterstitial`, a natural break) |
| `menu` | in-DOM `confirmDialog({title:'Quit Flick Goal?'})`, then `App.exitApp()` |

- **Pause/resume:** `App.addListener('pause')` → `pause()` + `audio.suspend()`. `resume` → `audio.resume()`, ad preload retry, `getCustomerInfo()` → reconcile (a pending payment may have completed), re-hide the system bars.
- The existing `visibilitychange` handler stays as a backup.

### 5.8 Tests (runnable here, no device needed)

`tests/monetization.test.mjs` injects fake `AdMob` / `Purchases` objects into the providers (constructor parameter), so no `window` is needed. Cases:
- reward then dismiss → rewarded
- dismiss without reward → not rewarded
- late reward within the grace window
- FailedToShow
- load reject → `no_ad`
- load timeout
- interstitial eligibility matrix (first session, gap, after-rewarded, No Ads)
- ledger: duplicate listener plus result, killed-mid-purchase recovery, pending then complete, epoch filter, orphan match
- restore messages
- `getProducts` passes `NON_SUBSCRIPTION`
- error-code mapping

The browser smoke test (dev profile, mock) must still pass unchanged, and a `web-release` smoke test checks that all ad/IAP UI is hidden.

---

## 6. Repo hygiene

`.gitignore` additions:

```
node_modules/
www/
android/app/build/
android/build/
android/.gradle/
android/local.properties
android/app/src/main/assets/public/
android/app/src/main/assets/capacitor.config.json
android/app/src/main/assets/capacitor.plugins.json
*.jks
*.keystore
*.p12
*.pem
*service-account*.json
revenuecat-key.json
.env*
```

- `android/` itself **is committed**, because it holds the manifest edits.
- `npx cap add android` / `cap sync` work without the Android SDK, so they can run on this PC.
- **No Gradle runs here.**

---

## 7. GitHub Actions build (`.github/workflows/android.yml`)

- **Triggers:**
  - `workflow_dispatch` with inputs `build: debug|release` (default debug) and `ad_mode: test|live` (default test).
  - `push` of tags `v*`, which builds a release with `ad_mode=live`.
  - No `pull_request_target`. Forks never see secrets.
- **Runner:** `ubuntu-latest`, which has Android SDK platforms 34 to 37 and build-tools 36 (`ANDROID_HOME` is set).
- **Steps:**
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` (Node 22, npm cache)
  3. `actions/setup-java@v4` (temurin **21**, gradle cache)
  4. `npm ci`
  5. `node scripts/build-web.mjs --profile android-${build} --ads ${ad_mode}`, which writes `www/` and `www/src/build-profile.js`
  6. `npx cap sync android`
  7. `node scripts/android-config.mjs --profile … --version-code $((1000 + GITHUB_RUN_NUMBER)) --version-name $(config version)`, which writes `admob.xml` and bumps `versionCode` (it must increase on every Play upload)
  8. **Guards** (fail the job):
     - release with `revenuecat.googleApiKey` empty or a Test Store key selected
     - release with `ad_mode=live` while `store.admob.*` still has the test publisher `3940256099942544`
     - `appId` mismatch
  9. Debug: `cd android && ./gradlew assembleDebug`, then upload `app-debug.apk` (retention 14 days).
  10. Release:
      - Decode `secrets.ANDROID_KEYSTORE_BASE64` to `$RUNNER_TEMP/upload.p12`.
      - `./gradlew bundleRelease`. `android/app/build.gradle` gets a `signingConfigs.release` that reads `System.getenv('ANDROID_KEYSTORE_PATH')`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, and is used only when the path is set.
      - Upload `app-release.aab` with retention 7 days. Artifacts of a public repo can be downloaded by other signed-in users. An AAB isn't secret, but keep the retention short, and **never** upload the keystore.
      - `rm` the decoded keystore in an `always()` step.
- **Secrets** (repo → Settings → Secrets → Actions): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Nothing else is secret: AdMob IDs and the RevenueCat public key live in `config.js`.
- **Future (optional):** auto-upload to the Play internal track with a Play service account JSON stored as a secret.
- **Upload key without a JDK on this PC.** Git Bash ships OpenSSL, and AGP on JDK 21 reads PKCS#12:
  ```bash
  openssl req -x509 -newkey rsa:2048 -nodes -keyout upload.key -out upload.crt -days 10000 -subj "/CN=Flick Goal upload"
  openssl pkcs12 -export -inkey upload.key -in upload.crt -name upload -out upload-keystore.p12   # prompts for a password
  base64 -w0 upload-keystore.p12 > upload-keystore.b64      # paste into ANDROID_KEYSTORE_BASE64
  ```
  - 10,000 days is about 27 years, above the recommended 25 years.
  - Keep `upload-keystore.p12`, its password and the alias `upload` **outside the repo**, in a password manager plus an offline backup. Then delete `upload.key` and `upload.b64`.
  - If the key is lost, Play Console → App signing → request an upload key reset.
  - Alternative: run `keytool -genkeypair` on any machine that has a JDK.

---

## 8. OWNER CHECKLIST (numbered, in order)

**A. Decide**
1. Confirm D1 (target audience 13+), D2 (`com.flickgoal.game`, permanent), D3 (pack prices and amounts), and D4 (ad frequency).

**B. Accounts**
2. Create a **Google Play Console** developer account ($25 one-time, identity verification). A personal account created after 2023-11-13 triggers the closed-test rule in step 22. An organization account needs a D-U-N-S number but is exempt from that rule.
3. Play Console → **Payments profile / merchant account** (needed to sell in-app products). Enroll in the **15% service fee tier**.
4. Create an **AdMob** account with the same Google account. Add the payments profile and tax info (PIN verification comes by mail at $10 of earnings).
5. Create a **RevenueCat** account (free up to $2.5k/month tracked revenue) and create a Project named "Flick Goal".

**C. AdMob setup**
6. AdMob → Apps → **Add app** → Android → "not published yet" → name "Flick Goal". Copy the **App ID** (`ca-app-pub-…~…`).
7. Create ad units: **Rewarded** ("Rewarded – continue/coins"; set reward 1 "reward", since the app decides amounts) and **Interstitial** ("Interstitial – game over"). Copy both IDs (`…/…`).
8. AdMob → **Privacy & messaging** → create a **European regulations (GDPR) message** for the app, and a **US state regulations** message (recommended). Publish them. Without these, EEA/UK users get no ads.
9. Paste the App ID and unit IDs into `src/config.js → store.admob` (section 5.2). Debug builds keep using test ads automatically.
10. To test real units safely: install a debug build, copy the test-device ID from logcat, and put it in `store.admob.testDeviceIds`. **Never tap real ads on your own phone.**

**D. Play Console app**
11. Create the app "Flick Goal" (Game → Casual/Sports, Free, contains ads).
12. **App content:**
    - Privacy policy URL (step 18)
    - **Ads: Yes**
    - **Advertising ID: Yes → Advertising, Analytics** (AdMob)
    - **Target audience: 13+** (D1)
    - Content rating questionnaire (IARC; no violence, "Users can interact": No, in-app purchases: Yes)
    - **Data safety** (step 19)
    - Government apps: No
    - Financial features: None
13. **Play App Signing:** accepted by default on the first AAB upload. The upload key comes from section 7. Add the 4 GitHub secrets.
14. Run the workflow **Android build → release, ad_mode=test**. Download `app-release.aab` and upload it to **Internal testing** (this also unlocks product creation, because the build has the BILLING permission).
15. **Monetize → Products → One-time products.** Create them, each with one "buy" purchase option. Set the price in USD and let Play convert the others:
    - `no_ads`: "No Ads", $2.99
    - `coins_small`: "1,500 Coins", $0.99
    - `coins_medium`: "5,000 Coins", $2.99
    - `coins_large`: "10,000 Coins", $4.99
    - `coins_mega`: "22,000 Coins", $9.99
    - Activate each one. **Multi-quantity: off.**
16. Play Console → Settings → **License testing**: add your own Google account and your testers' accounts (test purchases are free).

**E. RevenueCat**
17. RevenueCat → Project → **Apps & providers → add Google Play app**, package `com.flickgoal.game`.
    - **Service account credentials:** follow [the guide](https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials).
      - In Google Cloud, enable the *Google Play Android Developer API* and the *Google Play Developer Reporting API* (Pub/Sub is optional).
      - Create a service account with the roles *Pub/Sub Editor* and *Monitoring Viewer*, and create a JSON key.
      - In Play Console → Users & permissions, invite the service account email with: View app information (read-only), View financial data, Manage orders and subscriptions, Manage store presence.
      - Upload the JSON **only in the RevenueCat dashboard. Never commit it.** It can take up to 36 h to become valid.
    - **Product catalog → Products → import/add** the 5 product IDs. Mark **`no_ads` as Non-consumable** and keep the 4 coin packs **Consumable**.
    - **Entitlements → New `no_ads`** → attach **only** the `no_ads` product.
    - Project settings → restore behavior: keep **"Transfer to new App User ID"** (the default for anonymous apps; check it).
    - Copy the **Public SDK key** (`goog_…`) into `store.revenuecat.googleApiKey`.
    - Optional: create a **Test Store** (Apps & providers → Test configuration), add the same 5 products and the entitlement there, and paste its key into `store.revenuecat.testStoreApiKey`. This allows purchase testing in debug APKs before Play is set up. The release guard blocks it from shipping.

**F. Website, privacy, app-ads.txt**
18. Review and edit `store/privacy-policy.html`, which will be drafted. It must name AdMob (ads, advertising ID, IP-based approximate location, diagnostics), RevenueCat (purchase history, anonymous ID), local-only game data, a contact email, and a children's statement.
    - Publish it in the `anon11413.github.io` repo as `/flick-goal/privacy.html`, which serves at `https://anon11413.github.io/flick-goal/privacy.html`.
    - Enter it in Play Console. The app's Settings screen links to it.
19. **Data safety form:**
    - Data collected: *Location → Approximate* (AdMob, from IP); *App activity → App interactions*; *App info and performance → Diagnostics*; *Device or other IDs*; *Financial info → Purchase history* (RevenueCat, App functionality + Analytics).
    - AdMob data is **shared** for Advertising and **collected** for Advertising, Analytics and Fraud prevention.
    - All data encrypted in transit: Yes.
    - Users can request deletion: via contact email (no account system).
    - Re-check against AdMob's and RevenueCat's current disclosure pages at submission time.
20. Play store listing → **Developer website = `https://anon11413.github.io/`**, plus a contact email.
21. Add **`app-ads.txt`** to the **root** of the `anon11413.github.io` repo with the line AdMob shows under Apps → app-ads.txt, e.g. `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`. Verify that `https://anon11413.github.io/app-ads.txt` loads. AdMob verifies within 24 h of the app being published (it can be re-checked manually).

**G. Testing and launch**
22. **Closed testing** (required for a new personal account):
    - Create a Closed testing track, add **≥ 12 testers** (Google Group or email list), and share the opt-in link.
    - Every tester must stay opted in for **14 consecutive days** and actually play.
    - Use `ad_mode=test` builds on this track.
23. Purchase tests with license testers: buy each pack. Coins must arrive exactly once, even if you kill the app right after paying. Also test:
    - "Slow test card, approves after a few minutes": pending → coins arrive later.
    - Declined card → error.
    - Buying No Ads, uninstalling, reinstalling: No Ads comes back automatically. Restore button: "No Ads restored".
    - Check the transactions in RevenueCat (enable **View sandbox data**).
24. Ads tests on a debug build:
    - Rewarded Continue / 2x / free coins grant only after the full video.
    - Closing early grants nothing.
    - Airplane mode shows "No ad available right now".
    - An interstitial appears at most every 3rd game over, never in the first session, and never right after a rewarded ad.
    - Buying No Ads stops interstitials, while rewarded ads stay available.
    - Test the EEA consent form with `debugGeography` and the Settings "Privacy & ad choices" row.
25. After 14 days: Dashboard → **Apply for production**.
    - Build **release with `ad_mode=live`** (the guard makes sure real IDs are in place).
    - Upload to Production and roll out.
    - AdMob → Apps → **link the app to its Play listing** → app readiness review (2 to 3 days, with limited serving until then).
26. **Money:** AdMob pays around the 21st of the month once the balance is ≥ $100 (and only after the PIN, identity and address checks). Google Play pays in-app revenue (minus the 15% fee) through the payments profile. RevenueCat bills 1% only above $2.5k/month.

---

## 9. Open questions and risks

- The RevenueCat Test Store "release build crashes" claim comes from RevenueCat's blog and search result text. Either way, the release guard makes it impossible to ship that key.
- RevenueCat's default *transfer behavior* setting wasn't confirmed in its docs (step 17 says to check it).
- The admob plugin still uses the GMA "Legacy" SDK 25.4.x. The plugin's next major moves to the GMA Next-Gen SDK, so pin 8.1.0 and re-check on the next major.
- The Capacitor template's `launchMode` is `singleTask` (checked) and must be changed to `singleTop` after `cap add android` (RevenueCat requirement).
- Android Auto Backup (on by default) may restore the WebView save and the RevenueCat anonymous ID together after a reinstall. That is consistent with the ledger either way.
- Prices, amounts and ad frequency are proposals (D3/D4). Tune them once closed-test data comes in.
