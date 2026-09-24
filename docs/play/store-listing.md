# Google Play store listing (draft)

Play Console -> **Grow users -> Store presence -> Main store listing**. Limits: app name 30 characters,
short description 80, full description 4,000. The counts below were checked by `tests/android-build.test.mjs`
(it reads the text between the ``` fences).

## App name (max 30)

```text
Flick Goal
```

## Short description (max 80)

```text
One-tap field goal kicking. Time the flick, split the uprights, beat your best!
```

## Full description (max 4000)

```text
Line it up. Time the tap. Split the uprights.

Flick Goal is a one-tap football kicking game you can play with one thumb. Your aim swings back and forth: tap at just the right moment and watch the kick sail through the posts. Every goal pushes the next kick farther back and the clock gets tighter. How long can your streak last?

TWO WAYS TO PLAY
• FIELD GOAL: classic field goals. Every make moves the kick farther out and the shot clock gets shorter.
• ENDLESS: keep kicking down an endless field. Rack up the yards and chase your farthest drive.

EASY TO LEARN, HARD TO PUT DOWN
• One tap per kick. No complicated controls.
• Hit PERFECT kicks for bonus points and bigger coin rewards.
• Build streaks, beat your best score and set new distance records.
• Quick runs that fit a coffee break, or a whole evening.

UNLOCK YOUR STYLE
• Collect footballs: classic, retro, pro white, neon, camo, candy, watermelon and more.
• Play in beautiful stadiums: day games, night lights, snow bowls, beach sunsets and a neon arcade.
• Go PRO GRAPHICS with realistic lighting, turf and cheering crowds.
• Earn the AIM SLIDER upgrade to see the green zone on every kick.

FREE TO PLAY
• Earn coins every run, grab a free gift every few hours and watch an optional video for extra coins.
• Continue a run or double your coins with an optional video.
• Coin packs are available if you want to unlock things faster, and a one-time "No Ads" purchase removes the ads between games.

PLAYS YOUR WAY
• Works offline (ads and purchases need a connection).
• Sound and vibration toggles.
• Your progress is saved on your phone, no account needed.

Flick Goal contains ads and optional in-app purchases.
```

## Other listing fields

| Field | Value |
|---|---|
| App category | **Game -> Sports** (alternative: Casual) |
| Tags | Sports, Casual, Arcade, Football (pick up to 5 that Play offers) |
| Contact email | **your support address** (required, shown publicly; not filled in here on purpose) |
| Website | `https://anon11413.github.io/` (needed for app-ads.txt, see OWNER_GUIDE Step 6) |
| Privacy policy | the URL where you host docs/play/privacy-policy.html |
| Contains ads | Yes |
| In-app purchases | Yes (shown automatically once products exist) |

## Graphics (in this folder)

| Asset | File | Play requirement |
|---|---|---|
| App icon | `graphics/icon-512.png` | 512 x 512, 32-bit PNG (with alpha), up to 1 MB |
| Feature graphic | `graphics/feature-graphic-1024x500.png` | 1024 x 500 PNG / JPEG, no alpha |
| Phone screenshots | `screenshots/01-...jpg` to `06-...jpg` (1080 x 1920) | 2-8 screenshots, 16:9 / 9:16, 320-3840 px per side |

Screenshots were rendered from the real game (FIELD GOAL + ENDLESS, PRO + RETRO stadiums, menu, game over,
store) by `scripts/play-screenshots.mjs`; icons and the feature graphic by `scripts/render-icons.mjs`.
7-inch / 10-inch tablet screenshots are optional (the game is portrait and phone-first).
