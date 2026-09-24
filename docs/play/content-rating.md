# Content rating (IARC questionnaire) notes

Play Console -> **Policy -> App content -> Content rating -> Start questionnaire**.
The questionnaire is run by IARC and produces the ratings for every region (ESRB, PEGI, USK, ClassInd, ...).
Answer for what the app actually contains; below are the answers that match Flick Goal v2.

| Question area | Answer | Why |
|---|---|---|
| Category | **Game** | |
| Violence (any kind, cartoon or realistic) | **No** | A football is kicked at goal posts; no characters are hurt. |
| Blood / gore | No | |
| Fear / horror | No | |
| Sexuality / nudity | No | |
| Language (profanity, crude humour) | No | |
| Controlled substances (drugs, alcohol, tobacco) | No | |
| Gambling: real-money gambling | No | |
| Simulated gambling (casino, betting, slot machines) | **No** | Coins are earned by playing / gifts / purchase and spent on cosmetic items at fixed prices. No random loot boxes, no wheels, no chance-based rewards bought with money. |
| Does the game include randomised items that can be bought ("loot boxes")? | **No** | Every store item has a fixed coin price. |
| Users can interact / communicate (chat, UGC) | **No** | No chat, no accounts, no user-generated content. |
| Shares the user's location with other users | No | |
| Allows users to purchase digital goods | **Yes** | Coin packs and No Ads (Google Play Billing). |
| Unrestricted internet / web browsing | No | Only the privacy-policy link opens the phone's browser. |
| Ads | The app shows ads (declared separately under App content -> Ads) | |

Expected outcome: the lowest age ratings (e.g. **ESRB Everyone, PEGI 3, USK 0**) with the interactive
element **"In-App Purchases"** (and in some regions "Includes random items" must stay **absent**, as there are none).

Related App content declarations (same page in Play Console):

- **Ads:** Yes, the app contains ads.
- **Advertising ID:** Yes, used for **Advertising** and **Analytics** (AdMob). Also required because the manifest
  declares `com.google.android.gms.permission.AD_ID`.
- **Target audience and content:** decision D1 in docs/MONETIZATION_PLAN.md. Default: **13-15, 16-17, 18+**
  (not designed for children). The code ships `tagForChildDirectedTreatment: false` and ads capped at
  `ParentalGuidance`. If you add any age group under 13, the Families policy applies: set
  `tagForChildDirectedTreatment: true`, `maxAdContentRating: 'General'` in src/config.js, only
  Families-certified ad SDKs (AdMob is), and a neutral age screen for mixed audiences.
  Google may ask whether the app "unintentionally appeals to children" (cartoon art); answer honestly and
  add the store-listing note it suggests if needed.
- **Data safety:** see data-safety.md.
- **Government app:** No. **Financial features:** None. **Health:** None. **News app:** No.
- **App access:** All functionality is available without special access (no login).
