# Flick Goal on Google Play: owner guide

This takes you from "no accounts" to "live on Google Play, earning from ads and purchases", step by step.
Everything in the code already works with **test IDs**. You only create accounts, paste your IDs into **one block**
of `src/config.js`, and click through Google's consoles.

- Background and sources: `docs/MONETIZATION_PLAN.md`
- Other files in this folder: `privacy-policy.html` (draft policy), `app-ads.txt` (template),
  `store-listing.md` (texts + graphics), `data-safety.md`, `content-rating.md`, `iap-products.md`,
  `graphics/` (icon 512, feature graphic) and `screenshots/` (6 phone screenshots).

Order matters in a few places (for example, Play only lets you create products after a first upload), so follow
the steps in order. Plan for **3-4 weeks** in total: new personal Play accounts must run a **14-day closed test**
before production.

---

## The one block you edit: `src/config.js` -> `store`

```js
store: {
  androidAppId: 'com.flickgoal.game',          // package name (PERMANENT after the first upload)
  admob: {
    appId: 'ca-app-pub-3940256099942544~3347511713',          // Google TEST app id -> yours (has '~')
    rewarded: 'ca-app-pub-3940256099942544/5224354917',       // TEST -> your rewarded unit (has '/')
    interstitial: 'ca-app-pub-3940256099942544/1033173712',   // TEST -> your interstitial unit
    testDeviceIds: [],                        // optional: your phone, see step 9.3
    tagForChildDirectedTreatment: false, tagForUnderAgeOfConsent: false,
    maxAdContentRating: 'ParentalGuidance',
    umpDebugGeography: 0, umpTestDeviceIds: [], // consent-form testing (debug APKs only)
  },
  revenuecat: {
    googleApiKey: '',       // RevenueCat PUBLIC Google key "goog_..." (never a secret "sk_" key)
    testStoreApiKey: '',    // optional RevenueCat Test Store key "test_..." (debug APKs only)
    noAdsEntitlement: 'no_ads',
  },
  privacyPolicyUrl: '',     // https link to your hosted privacy policy (adds a Settings row)
},
```

Everything here is a **public** client ID and safe in this public repository. **Never** put keystores,
passwords, RevenueCat secret keys (`sk_...`) or service-account JSON files in the repo.

Safety rails already built in:
- **Debug APKs always show Google test ads**, whatever the block says.
- Release builds come in two ad modes: **test** (Google test ads, for internal / closed testing) and
  **live** (your real units). A live build **refuses to build** while the block still has test IDs, has no
  RevenueCat key or no privacy-policy link (`scripts/android-config.mjs`).
- Release builds ignore the Test Store key, turn developer tools off and ignore URL flags such as `?qa`.

---

## Step 1. Decide (5 minutes)

| # | Decision | Default in the code |
|---|---|---|
| D1 | Target audience | **13+, not designed for children**. If you include under-13s the Families policy applies (see content-rating.md). |
| D2 | Package name | **`com.flickgoal.game`**. It can never change once uploaded. To change it now, edit it in `capacitor.config.json` (`appId`), `src/config.js` (`store.androidAppId`) and `android/app/build.gradle` (`applicationId`); `npm test` checks they agree. |
| D3 | Prices | No Ads $2.99; 1,500 / 5,000 / 10,000 / 22,000 coins for $0.99 / $2.99 / $4.99 / $9.99 (iap-products.md) |
| D4 | Ad frequency | Interstitial at most every 3rd game over, never in the first session, at least 2 min apart, never right after a video (`src/config.js` -> `monetization`) |

## Step 2. Create the accounts

1. **Google Play Console**: https://play.google.com/console, one-time $25, identity verification.
   A **personal** account created after 13 Nov 2023 must run a closed test with **12+ testers for 14 days** before
   production (step 12). An **organization** account (needs a D-U-N-S number) is exempt.
2. Play Console -> **Setup -> Payments profile**: create the merchant account (needed to sell anything).
   Then **enroll in the 15% service-fee tier** (Play Console -> Setup -> Payments / "Service fee": the lower fee
   applies only after you enroll).
3. **AdMob**: https://admob.google.com, sign in with the same Google account. Fill in payments and **tax info**.
   Google mails a **PIN** once you earn $10; you must enter it to get paid.
4. **RevenueCat**: https://app.revenuecat.com (free up to $2,500 tracked revenue per month, then 1%).
   Create a Project called **Flick Goal**.

## Step 3. Make the upload key and add it to GitHub (once)

Google Play signs the app for users with its own key ("Play App Signing"). You sign uploads with an **upload key**.
If you ever lose it, Play Console -> Setup -> App signing -> **Request upload key reset** (takes a few days).

**Option A: Git Bash on this PC (no Java needed).** Run these outside the repo folder, e.g. in `~/keys`:

```bash
mkdir -p ~/keys && cd ~/keys
openssl req -x509 -newkey rsa:2048 -nodes -keyout upload.key -out upload.crt -days 10000 -subj "/CN=Flick Goal upload"
openssl pkcs12 -export -inkey upload.key -in upload.crt -name upload -out upload-keystore.p12
#   -> type a strong password twice (this is the keystore AND key password)
base64 -w0 upload-keystore.p12 > upload-keystore.b64
rm upload.key          # the private key now lives only inside the .p12
```

**Option B: any computer with Java / Android Studio.**

```bash
keytool -genkeypair -v -keystore upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload-keystore.jks > upload-keystore.b64     # PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("upload-keystore.jks")) | Set-Clipboard
```
(Android Studio: Build -> Generate Signed Bundle -> Create new... gives the same file.)

**Back it up now**: the `.p12` / `.jks` file, its password and the alias `upload` go into your password manager
plus one offline copy (USB stick). Never commit them (`.gitignore` already blocks `*.p12 *.jks *.keystore *.b64`).

**Add 4 secrets**: GitHub -> repository `anon11413/flick-goal` -> **Settings -> Secrets and variables ->
Actions -> New repository secret**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the whole content of `upload-keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | the key password (Option A: the same password; Option B: what you typed for the key) |

or with the GitHub CLI: `gh secret set ANDROID_KEYSTORE_BASE64 < upload-keystore.b64` (and `gh secret set NAME` for the others).
Then delete `upload-keystore.b64`.

## Step 4. First build on GitHub (no Android Studio needed)

The workflow `.github/workflows/android.yml` builds on GitHub's servers:
- **Every push** of code: runs the tests, builds a **debug APK** (Google test ads), and, once the 4 secrets exist,
  a signed **release AAB** with test ads.
- **A tag `v*`** (e.g. `git tag v2.0.0 && git push origin v2.0.0`): the release AAB uses **live** ads.
- **Actions tab -> "Android build" -> Run workflow**: pick `test` or `live` (this button appears once the workflow
  file is on the repository's default branch).

The build number (`versionCode`) is `1000 + run number`, so every build is higher than the last. The version name
comes from `CONFIG.version` in `src/config.js` (bump it for each Play release, e.g. `2.0.1`).

Open the finished run -> **Artifacts** -> download `flick-goal-debug-apk` (a zip with `app-debug.apk`) or
`flick-goal-release-aab-...` (the `app-release.aab` for Play).

**Try the debug APK on your phone:** copy `app-debug.apk` to the phone (USB, Google Drive...), open it, allow
"Install unknown apps" for that app, install. You get the real Android app with Google **test** ads ("Test Ad" label).
Coin packs stay hidden until the RevenueCat key is set (step 8).

## Step 5. Create the app in Play Console

1. Play Console -> **Create app**: name **Flick Goal**, language, **Game**, **Free**, confirm the declarations.
2. **Policy -> App content** (answers in `content-rating.md` and `data-safety.md`):
   - Privacy policy: URL from step 6
   - **Ads: Yes**
   - **Advertising ID: Yes** -> Advertising, Analytics
   - App access: all functionality available without login
   - **Target audience**: 13+ (decision D1)
   - **Content rating** questionnaire (IARC): content-rating.md
   - **Data safety**: data-safety.md
   - Government apps: No; Financial features: None; Health: No
3. **Store presence -> Main store listing**: texts from `store-listing.md`, icon `graphics/icon-512.png`, feature
   graphic `graphics/feature-graphic-1024x500.png`, phone screenshots from `screenshots/`. Category Game -> Sports.
   Contact email: your support address. **Website: `https://anon11413.github.io/`** (needed for app-ads.txt).
4. **Testing -> Internal testing -> Create new release**: upload `app-release.aab` (test ads) from step 4.
   Accept **Play App Signing** when asked. Add yourself as a tester (email list), save, roll out, and open the
   **opt-in link** on your phone to install from Play.

## Step 6. Privacy policy, website and app-ads.txt (GitHub Pages)

Your user site `anon11413/anon11413.github.io` is served at `https://anon11413.github.io/`.

1. Open `docs/play/privacy-policy.html`, replace `[DEVELOPER NAME]`, `[YOUR CONTACT EMAIL]` and `[DATE]`, read it once.
2. Copy it into the site repo as **`flick-goal/privacy.html`** and push. Check that
   `https://anon11413.github.io/flick-goal/privacy.html` opens.
3. Paste that URL into Play Console (App content -> Privacy policy) **and** into `src/config.js` ->
   `store.privacyPolicyUrl` (the game then shows a "Privacy Policy" row in Settings; Google requires the link inside the app too).
4. **app-ads.txt** (after step 7 gives you your publisher ID): copy `docs/play/app-ads.txt`, replace
   `pub-XXXXXXXXXXXXXXXX` with the line AdMob shows under **Apps -> app-ads.txt**, and put it at the **root** of the
   site repo: `https://anon11413.github.io/app-ads.txt`. AdMob only looks at the root of the developer website from
   your Play listing (a file in a sub-folder is never read). AdMob verifies it within about 24 h of the app going live.

## Step 7. AdMob: app, ad units, consent message

1. AdMob -> **Apps -> Add app** -> Android -> "Is the app listed on a supported app store?" **No** (for now) ->
   name **Flick Goal**. Copy the **App ID** (`ca-app-pub-...~...`).
2. **Ad units -> Add ad unit**:
   - **Rewarded**: name "Rewarded - continue / coins", reward amount **1**, reward item **reward** (the game decides
     the real reward). Copy the ID (`ca-app-pub-.../...`).
   - **Interstitial**: name "Interstitial - game over". Copy the ID.
3. **Privacy & messaging -> GDPR (European regulations)**: create a message for Flick Goal and **publish** it. Also
   create the **US state regulations** message (recommended). Without the GDPR message, players in the EEA / UK get
   **no ads at all**. The game already shows Google's consent form and a "Privacy & ad choices" row in Settings.
4. Paste the three IDs into `src/config.js` -> `store.admob` (`appId`, `rewarded`, `interstitial`). Commit + push.
   Debug APKs keep showing test ads; only release builds with ad mode **live** use your units.
5. After the app is live on Play (step 13): AdMob -> Apps -> Flick Goal -> **App settings -> link to the store
   listing**. AdMob then reviews the app ("app readiness", usually 2-3 days, limited ads until approved).

**AdMob rules that can get your account banned (read once):**
- **Never tap or watch your own live ads.** Test with test ads or a registered test device (step 9.3).
- Don't ask friends or testers to click or watch ads to support you.
- Keep internal and closed-test builds on **test** ads (the default for pushes).

## Step 8. Products: Play Console + RevenueCat

1. After the first AAB is uploaded (step 5.4), Play Console -> **Monetize with Play -> Products -> One-time
   products**. Create the 5 products from `iap-products.md` with **exactly** these IDs: `no_ads`, `coins_small`,
   `coins_medium`, `coins_large`, `coins_mega`, each with one **Buy** option, USD price, multi-quantity **off**, and
   **Activate** them.
2. RevenueCat -> Project Flick Goal -> **Apps & providers -> + Google Play**: package `com.flickgoal.game`.
   - Upload **service account credentials** (lets RevenueCat check purchases with Google). Follow
     https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials : in Google Cloud enable the
     *Google Play Android Developer API* and *Google Play Developer Reporting API*, create a service account + JSON key,
     then in Play Console -> **Users and permissions** invite the service-account email with *View app information*,
     *View financial data*, *Manage orders and subscriptions*. Upload the JSON **only in the RevenueCat dashboard**
     and delete your local copy (never commit it). It can take up to 36 h to become valid.
   - **Product catalog -> Products**: add / import the 5 products. Mark **`no_ads` as Non-consumable**; the 4 coin
     packs stay **Consumable**.
   - **Product catalog -> Entitlements -> + New**: identifier **`no_ads`**, attach **only** the `no_ads` product.
   - Project settings -> **Restore behavior**: keep the default for anonymous users ("Transfer to new App User ID").
   - **API keys**: copy the **Public app-specific key** for the Google Play app (`goog_...`) into
     `src/config.js` -> `store.revenuecat.googleApiKey`. Commit + push. The store's COINS tab now appears in the app.
3. Optional, to test purchases in a **debug APK before Play is ready**: RevenueCat -> Apps & providers -> **Test
   Store**, add the same 5 products + the `no_ads` entitlement, copy its key (`test_...`) into
   `store.revenuecat.testStoreApiKey`. The debug APK then shows RevenueCat's fake purchase dialog. Release builds
   never use this key.

## Step 9. Test everything (internal testing track)

### 9.1 Purchases with license testers (free test cards)
1. Play Console -> **Settings (the gear, account level) -> License testing**: add your Google account and your
   testers' Gmail addresses, "License response: RESPOND_NORMALLY".
2. Install the app **from the internal-testing opt-in link** (step 5.4) on a phone signed in with a license-tester
   account. The Google Play sheet then offers test cards; nothing is charged.
3. Check:
   - Buy each coin pack with **"Test card, always approves"**: coins arrive **exactly once**. Force-close the app
     right after paying and reopen: still exactly once.
   - **"Slow test card, approves after a few minutes"**: the game says "Payment pending"; the coins arrive by
     themselves a few minutes later (keep the app open or reopen it).
   - **"Test card, always declines"**: a friendly error, no coins.
   - Cancel the Google sheet: nothing happens (no message).
   - Buy **No Ads**: interstitials stop, the store shows OWNED. Uninstall, reinstall from Play with the same account:
     No Ads is back automatically. Settings -> **Restore Purchases**: "No Ads restored"; on an account without
     purchases: "Nothing to restore" plus the note that coin packs can't be restored.
   - RevenueCat dashboard -> turn on **View sandbox data**: the test transactions are listed.

### 9.2 Ads (Google test ads)
Internal / closed builds use test ads. Check on the phone:
- Continue, 2x coins and free coins give their reward **only after the whole video**; closing early gives nothing.
- Airplane mode: tapping a video button says "No ad available right now" and Game Over keeps working.
- Interstitials: never in the first session (first app launch), then at most every 3rd game over, never within
  2 min of the previous one, never right after a video; never after buying No Ads.
- Android **Back button**: pauses a run, resumes, goes back from Store / Settings, goes Home from Game Over, and on
  the menu asks "Quit Flick Goal?".

### 9.3 Testing your REAL ad units safely (optional, before production)
Register your phone as an AdMob **test device**, then real units show test ads on it:
- Easiest: AdMob -> **Settings -> Test devices -> Add test device**, platform Android, and the phone's
  **advertising ID** (phone Settings -> Google -> Ads, or Settings -> Privacy -> Ads). Can take up to 24 h.
- Or: connect the phone with USB debugging, run `adb logcat | grep "setTestDeviceIds"` while the app starts, and put
  the ID it prints into `store.admob.testDeviceIds`. (adb comes from Google's small "SDK Platform-Tools" zip.)
Then build release with ad mode **live** (Actions -> Run workflow -> live) and install it. Remove the test device
ID from `testDeviceIds` before production (the build warns you).

### 9.4 The EEA consent form (optional)
On a debug APK, set `store.admob.umpDebugGeography: 1` (pretend EEA) and put the **hashed** device ID that the UMP
SDK prints in logcat ("Use new ConsentDebugSettings.Builder().addTestDeviceHashedId(...)") into
`umpTestDeviceIds`. The consent form appears at launch, and Settings shows "Privacy & ad choices". Set both back
to `0` / `[]` afterwards.

## Step 10. Closed testing (required for new personal accounts)

1. Play Console -> **Testing -> Closed testing -> Create track**, upload the latest AAB (test ads).
2. Add **at least 12 testers** (an email list or a Google Group) and share the **opt-in link**.
3. Every tester must **stay opted in for 14 days in a row** and actually play (Google checks engagement). Testers who
   leave early don't count.
4. Use this time to fix what testers report. Don't ask testers to click ads.

## Step 11. Production

1. Dashboard -> **Apply for production** (after the 14 days) and answer Google's questions about the test.
2. Make sure `src/config.js` has your real AdMob IDs, the RevenueCat Google key and the privacy-policy URL, and bump
   `version` (e.g. `2.0.1`).
3. Build with **live** ads: push a tag (`git tag v2.0.1 && git push origin v2.0.1`) or Actions -> Run workflow ->
   `live`. The build fails with a clear message if anything is still a test value.
4. Play Console -> **Production -> Create new release**, upload that AAB, write release notes, start the rollout
   (a staged rollout, e.g. 20%, is a good idea).
5. AdMob: link the app to its Play listing (step 7.5). Check app-ads.txt shows "Authorized" in AdMob a day later.

## Step 12. Getting paid

- **Ads (AdMob):** earnings for a month are finalized in the first days of the next month; payment is issued
  around the **21st** once your balance is at least **$100** (below that it rolls over), after the PIN, identity,
  address and tax checks. Earnings typically start after the app is live and linked (step 7.5).
- **Purchases (Google Play):** Google pays your payments profile monthly, minus its service fee (15% on the first
  $1M per year once enrolled).
- **RevenueCat:** free until $2,500 monthly tracked revenue, then 1%.

---

## Where to change things later

| What | Where |
|---|---|
| AdMob IDs, RevenueCat key, privacy URL | `src/config.js` -> `store` |
| Coin amounts per pack, product list | `src/config.js` -> `products` (IDs must stay the same; prices are set in Play Console) |
| Ad frequency / timing | `src/config.js` -> `monetization` |
| Audience flags (child-directed, ad rating) | `src/config.js` -> `store.admob` |
| Version name | `src/config.js` -> `version` (version code is automatic) |
| App name | `capacitor.config.json` `appName` and `android/app/src/main/res/values/strings.xml` |
| Icons / splash / feature graphic | edit the art in `scripts/render-icons.mjs`, then run it (see PLAYTEST.md) |
| Store screenshots | `scripts/play-screenshots.mjs` (see PLAYTEST.md) |

## Troubleshooting

| Problem | Fix |
|---|---|
| Workflow: "release with --ads live, but store.admob still has Google's TEST ids" | Paste your AdMob IDs (step 7.4) or build with ad mode test. |
| Workflow: release AAB skipped | The 4 signing secrets are missing or misspelled (step 3). |
| Play: "You uploaded an APK or Android App Bundle that was signed in debug mode" | Upload `app-release.aab`, not the debug APK. |
| Play: "Version code 10xx has already been used" | Run the workflow again (new run number) or use the `version_code` input with a higher number. |
| Play: "APK signed with the wrong key" | The AAB was signed with a different upload key than the first upload: use the original key or request an upload key reset. |
| Store shows no coin packs in the app | `store.revenuecat.googleApiKey` is empty, the products aren't active in Play, or the service-account credentials aren't valid yet (up to 36 h). Install from the Play testing link, not a sideloaded APK. |
| Prices show "Unavailable" | Products not active, the phone's Play account can't buy (country / payment profile), or offline. Tap to retry. |
| No ads in the EEA / UK | Publish the GDPR message in AdMob -> Privacy & messaging (step 7.3). |
| New AdMob app shows few real ads | Normal until the app is live and linked (app readiness review). |
| Debug APK won't install over the old one | Uninstall the old one first (debug and Play-installed builds are signed with different keys). |
