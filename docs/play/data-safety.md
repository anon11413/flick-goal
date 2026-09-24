# Data safety form: draft answers

Play Console -> **Policy -> App content -> Data safety**. Google requires this for every app, **including
data collected by SDKs inside it** (AdMob, RevenueCat). A privacy policy URL must be entered first.

Sources (re-check them on the day you submit; SDK disclosures change):
- AdMob / Google Mobile Ads SDK: https://developers.google.com/admob/android/privacy/play-data-disclosure
- RevenueCat: https://www.revenuecat.com/docs/platform-resources/google-platform-resources/google-plays-data-safety
- Google's definitions: https://support.google.com/googleplay/android-developer/answer/10787469

Key definitions: data that stays **only on the phone** (the game save) is **not "collected"**.
Sending data to a **service provider** that processes it for you (RevenueCat) is **not "sharing"**.
AdMob data goes to Google as an ad network, so Google's guidance is to declare it as **collected and shared**.

## Section 1: Data collection and security

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (AdMob, Google Play and RevenueCat all use TLS) |
| Do you provide a way for users to request that their data is deleted? | **Yes**: by email to your contact address (the app has no accounts; the privacy policy explains how, section 7) |

## Section 2: Data types

| Data type (Play category) | Collected | Shared | Processed ephemerally? | Required or optional | Purposes | Who |
|---|---|---|---|---|---|---|
| **Location -> Approximate location** | Yes | Yes | No | Required | Advertising or marketing; Analytics; Fraud prevention, security and compliance | AdMob (derived from IP address) |
| **App activity -> App interactions** | Yes | Yes | No | Required | Advertising or marketing; Analytics; Fraud prevention, security and compliance | AdMob (app launches, taps, ad / video views) |
| **App info and performance -> Diagnostics** | Yes | Yes | No | Required | Analytics; Fraud prevention, security and compliance | AdMob (SDK performance / crash data) |
| **Device or other IDs** | Yes | Yes | No | Required | Advertising or marketing; Analytics; Fraud prevention, security and compliance | AdMob (advertising ID, app set ID) |
| **Financial info -> Purchase history** | Yes | No | No | Optional (only when the player buys something) | App functionality; Analytics | RevenueCat (verifies Google Play purchases, restores No Ads) |

Everything else: **No** (no name, email, user IDs from accounts, contacts, precise location, photos, audio,
files, messages, calendar, health, web history, search history, installed apps, crash logs of our own,
other user-generated content).

Notes:
- If AdMob's page lists additional items on the day you fill this in (for example "Other app performance
  data" or "Crash logs"), add them exactly as AdMob lists them.
- "Required": the app cannot turn AdMob's collection off per user. EEA / UK players can refuse
  personalised ads in the consent form, but ads (and the SDK) still run. "No Ads" only removes interstitials,
  so the rewarded-ad SDK stays active; keep "Required".
- RevenueCat also receives a random anonymous app user ID it generates. It is not a device ID and not linked to
  an account; RevenueCat's own guidance lists only **Purchase history** for the Data safety form.

## Section 3: Security practices shown on the listing

- Data is encrypted in transit: **Yes**
- You can request that data be deleted: **Yes**
- Committed to follow the Play Families Policy: **No** (only if you target children, decision D1)
- Independent security review: **No**

## Related declaration: Advertising ID

Play Console -> App content -> **Advertising ID**: "Does your app use advertising ID?" **Yes**, purposes
**Advertising or marketing** and **Analytics**. (The manifest declares `com.google.android.gms.permission.AD_ID`;
play-services-ads adds it anyway.)
