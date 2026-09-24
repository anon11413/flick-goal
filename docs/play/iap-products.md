# In-app products for Play Console and RevenueCat

The product IDs below are already in the game (`src/config.js` -> `products`). Create them with **exactly these
IDs**. Google Play **never lets an ID be changed or reused**, even after deleting the product. The number of coins a
pack gives comes from `src/config.js` (`grants.coins`), so it can be retuned later without new Play products.

## Play Console: Monetize with Play -> Products -> One-time products

Create each product with one **"Buy" purchase option**. Set the price in USD and let Play convert it to other
currencies (the game always shows Google's localized price). Then **Activate** it.

| Product ID | Name (shown by Google) | Description | Price (USD) | Play type | Multi-quantity |
|---|---|---|---|---|---|
| `no_ads` | No Ads | Removes the ads between games forever. Optional reward videos stay available. | **$2.99** | one-time product | Off |
| `coins_small` | 1,500 Coins | A stack of 1,500 coins for balls, stadiums and upgrades. | **$0.99** | one-time product | Off |
| `coins_medium` | 5,000 Coins | A bag of 5,000 coins. | **$2.99** | one-time product | Off |
| `coins_large` | 10,000 Coins | A chest of 10,000 coins: exactly the Aim Slider. | **$4.99** | one-time product | Off |
| `coins_mega` | 22,000 Coins | A vault of 22,000 coins: nearly the whole store. | **$9.99** | one-time product | Off |

- Play has no "consumable" switch: whether a purchase is used up is decided by the app / RevenueCat (below).
- Leave **multi-quantity off** (the game grants one pack per purchase).
- Product creation unlocks only after an app bundle with the BILLING permission has been uploaded to any track
  (the RevenueCat SDK adds that permission). Upload the first AAB to **Internal testing** first.

## RevenueCat: Product catalog

Project "Flick Goal" -> **Product catalog -> Products -> + New** (or Import from Google Play), for the Play app:

| Product ID | RevenueCat type | Attached to entitlement |
|---|---|---|
| `no_ads` | **Non-consumable** | **`no_ads`** (the only product attached to it) |
| `coins_small` | Consumable | none |
| `coins_medium` | Consumable | none |
| `coins_large` | Consumable | none |
| `coins_mega` | Consumable | none |

Why this matters:
- RevenueCat **consumes** Google Play one-time purchases unless the product is marked **non-consumable**. If
  `no_ads` stays consumable, Google lets the player buy it again and Restore cannot find it.
- Products attached to an entitlement unlock it **forever**, so a coin pack attached to `no_ads` would remove ads
  for anyone who bought coins. Attach **only** `no_ads`.
- Create the entitlement: **Product catalog -> Entitlements -> + New**, identifier **`no_ads`** (must match
  `store.revenuecat.noAdsEntitlement` in src/config.js).
- Offerings are **not used**: the game asks for the products by ID. You do not need to build an offering.

## How the game uses them

| Situation | What happens |
|---|---|
| Buy a coin pack | Coins are added once per RevenueCat transaction (a save ledger prevents doubles, even if the app is killed mid-purchase). |
| Payment pending (cash / bank / carrier) | "Payment pending" message; the coins arrive automatically when Google confirms. |
| Buy No Ads | Interstitials stop at once; the menu No Ads button hides; the store shows OWNED. |
| Reinstall / new phone, same Google account | No Ads comes back automatically on launch (and with Settings -> Restore Purchases). |
| Restore Purchases | Restores No Ads. Coin packs are used up when bought, so Google Play can't restore them (the message says so). |
| Refund of No Ads (release builds) | When RevenueCat reports the entitlement inactive, No Ads is removed again. With Google real-time developer notifications connected (OWNER_GUIDE Step 8) RevenueCat learns about it right away; without them only after the player's next purchase sync. |
| Tap "Buy No Ads" when Google already owns it but this install doesn't know yet | The game restores automatically ("No Ads restored"). If the purchase belongs to another Google account, it says "You already own No Ads. Tap Restore Purchases in Settings." |
| Paid for coins, but the app crashed / had no connection, then the player cleared app data or reinstalled | Coin purchases from the last 48 h that RevenueCat still reports are credited once on the next launch (older ones count as history, so a reinstall never refills coins). Anything older: refund it in Play Console -> Order management. |

## Economy reference (for re-pricing)

Aim Slider 10,000 coins; PRO stadiums 400 / 1,200 / 1,500 / 1,800 / 2,400; the whole store about 24,700 coins.
A run earns about 15-25 coins; the free gift 25-50 every 4 h; the free-coins video 25 every 3 min.
