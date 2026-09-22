# Flick Goal — Game Design

Arcade flick-to-hoop (Flappy Hoops / Flappy Basketball), football themed. One shot at a time. A diagonal aim slider oscillates; tap to lock; ball flicks; score or miss.

## Core loop

1. Ball sits on a tee / last landing.
2. Diagonal **aim rail** appears (power + angle coupled on one axis).
3. Marker slides along the rail (ping-pong).
4. Player taps **Flick** (or anywhere) to freeze the marker.
5. Ball follows a ballistic arc from locked aim.
6. If it passes through the hoop: score +1, hoop “swallows” the ball, next setup.
7. If miss or time-out: life lost / run ends (choose one mode).
8. Repeat; oscillator speed up, sweet-spot narrower — always still hittable.

## Controls

- Primary: tap / click / space to lock aim.
- No analog stick. One button, one rail.
- Optional later: slight left/right bias if we split angle vs power (v2). v1 is **one diagonal slider**.

## Aim rail (the “up or down directional thing”)

- Rail is a **thick diagonal bar** from bottom-left to top-right of the shot UI (or mirrored per level for variety).
- Marker travels **along the diagonal**, not free 2D.
- Position `t ∈ [0, 1]` maps to:
  - **angle** `θ = θ_min + t * (θ_max - θ_min)`
  - **power** `P = P_min + ease(t) * (P_max - P_min)`  
  Coupled so the **perfect t*** sends the ball through the hoop center.

Why diagonal: reads as both “up/down” and “strength,” matches “football flick.”

### Perfect band

- Hoop has inner radius `R`.
- Physics maps `t` → impact error `e(t)` at hoop plane.
- **Sweet spot** is `{ t : |e(t)| ≤ R_effective }` with width `W` on the rail.
- Visual: glowing band on the rail (can fade as difficulty rises so player relies more on timing).

## Ball motion

- Projectile: `x(τ) = x0 + (P cos θ) τ`, `y(τ) = y0 + (P sin θ) τ - ½ g τ²`
- Optional tiny spin / squash on release.
- Collision: hoop ring (score if centerline through cylinder), backboard bounce (optional v2).
- Always 2D side-or-iso view; camera locked per shot.

## Transitions (success)

1. Ball crosses hoop plane → freeze last 2 frames.
2. **Swish**: hoop squash, particles, ball scale → 0 into net (120–180 ms).
3. Camera ease to next tee/hoop (200–280 ms).
4. New rail fades in; marker starts from a **random phase** (not always the same end).
5. Shot clock starts when marker is visible.

Miss: ball exits, brief slow-mo, “next” or game over.

## Shot clock

Each shot has time limit `L(n)` (score `n`).
Must be **always possible**: at least one full sweet-spot dwell occurs inside `L(n)` after a human reaction floor.

See `MATH.md`.

## Modes

- **Endless**: speed/narrow until miss.
- **Campaign** (later): set pieces, moving hoops, wind.

## Feel targets

| Beat | Feel |
|------|------|
| 1–10 | Generous band, readable glow, slow slide |
| 11–25 | Faster, band still visible |
| 26–50 | Tight; glow optional |
| 50+ | Near `W_min` / `v_max` asymptote — hard, never frame-perfect |

## Assets to sketch

- Rail + marker + sweet band
- Ball arc + hoop
- Success swallow
- Fail / clock
- HUD (score, streak, clock)
