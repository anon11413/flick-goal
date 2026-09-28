# Handoff: Flick Goal sign-ups (ads + purchases), 2026-09-28

Read this first when you pick up the Flick Goal store setup again. The full plan is in `OWNER_GUIDE.md` in this
folder; this note says **where we stopped** and **who does what next**.

## Where we are

- Code: done. Branch **v2/hard-perfect** (the release version), worktree
  `C:\Users\ashau\flick-goal-branches\v2-hard-perfect`, last commit `307364a` (monetization merged). The game runs
  on Google **test** ad IDs and has no RevenueCat key yet. Every real ID goes into one block: `src/config.js` ->
  `store`.
- Accounts:

| Service | Status |
|---|---|
| Google Play Console | Owner already has a paid account. **Unknown: Personal or Organization?** (Personal = 14-day closed test with 12+ testers before going live.) Payments profile: not checked yet. |
| **AdMob** | **Account created on 2026-09-26** (signed up in the owner's Chrome with the Google account that was already signed in). Home page shows the "Welcome to AdMob!" checklist, 0/4. Red banner: **"Payment setup incomplete"**, which the owner still has to fix. |
| RevenueCat | Not started |
| Google Cloud (service account) | Not started |
| GitHub upload-key secrets (OWNER_GUIDE step 3) | Not started |

## Next steps

### The owner's manual parts (identity, terms, bank, tax: Claude never types these)

1. **AdMob payment details**: the **Fix it** button on the red banner, or "Add payment details" in the checklist.
   Individual account, legal name and address as on the ID, phone, tax form (W-9 in the US), bank (can come later).
   Until this is done AdMob won't review apps, so no real ads.
2. **RevenueCat**: https://app.revenuecat.com -> "Sign up with Google" with the same Google account. About 1 minute.
3. **Google Cloud**: open https://console.cloud.google.com with the same account and accept the terms. No card or
   free trial needed. About 1 minute.
4. **Play Console payments profile** (Setup -> Payments profile), if one doesn't exist yet: name, address, bank.
5. Answer the question: is the Play Console account **Personal** or **Organization**?
6. Confirm that the Google account used for AdMob is the one that owns Play Console (check the round icon in the
   top right).

Items 1 and 4 only matter for getting paid. They can wait until the end; items 2 and 3 are needed before Claude
can do the setup.

### Claude's part (in Claude in Chrome, once the owner says "go")

In OWNER_GUIDE order:
- AdMob: add the app **Flick Goal** (Android, "not listed yet"), a **Rewarded** unit (reward 1 / "reward") and an
  **Interstitial** unit, plus the GDPR and US-states consent messages (step 7).
- RevenueCat: project **Flick Goal**, the Google Play app `com.flickgoal.game`, 5 products (`no_ads`
  non-consumable, 4 coin packs consumable), entitlement `no_ads` (step 8).
- Google Cloud: service account + JSON key for RevenueCat (upload the key only in the RevenueCat dashboard; never
  save or commit it), and invite it in Play Console -> Users and permissions.
- Play Console: create the app, store listing and app content (steps 5-6), products after the first AAB upload.
- Paste the public IDs into `src/config.js` -> `store`, commit, push from WSL (see memory `flick-goal-release-line`).
- Write the owner a clean step-by-step tutorial of every click.

## How the browser works here

- Claude in Chrome runs on the owner's **other device** (Linux, "Browser 1"), not on
  this PC. It was the only connected browser, so no browser choice was needed.
- The AdMob tab was `admob.google.com/v2/home`. Tab IDs don't carry over: call `tabs_context_mcp` again.
- The owner has authorized Claude to do the setup in Chrome **only when they say go**, and will change passwords
  afterwards. Claude never enters passwords, bank, tax or ID details, and never accepts terms for the owner.
- AdMob rule: never tap or watch the owner's own live ads; test builds keep test ads.

## Owner preferences

Plain words, one step at a time, say exactly where to click and what the owner will see.
