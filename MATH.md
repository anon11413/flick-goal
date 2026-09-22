# Difficulty math (always beatable)

## State at score n (n = 0,1,2,…)

| Symbol | Meaning |
|--------|---------|
| `v(n)` | Marker speed along rail, in rail-lengths per second (period `T = 2/v` for ping-pong 0→1→0) |
| `W(n)` | Sweet-spot width as fraction of rail length, `W ∈ (0,1]` |
| `D(n) = W(n) / v(n)` | Dwell time while marker is inside the band (one pass) |
| `L(n)` | Shot clock seconds |
| `φ` | Random start phase on the rail |
| `τ_r` | Min human reaction we honor (use **0.12 s** — skilled tap, not casual 0.25) |

Ping-pong: marker hits the band **twice per full cycle** (up and down), period `T(n) = 2 / v(n)` for a unit-length rail at speed `v`.

Worst-case wait until **start of a dwell**: just missed the band → wait almost `T/2 - D` then a dwell of `D`.

## Hard constraints (never break)

1. **Hittable dwell:** `D(n) ≥ D_min` with `D_min = 0.080 s` (5 frames @ 60fps). Never require sub-frame taps.
2. **Clock covers worst phase:**  
   `L(n) ≥ τ_r + (T(n)/2) + D_min`  
   i.e. player can always wait for the next pass after reacting.
3. **Physics always has a solution:** hoop placement + `θ(t), P(t)` such that some `t*` maps through hoop center, and the set `{t: |e(t)|≤R}` has measure `W(n)`.

If (1)+(2)+(3) hold, **every shot is theoretically winnable** regardless of random phase.

## Curves (asymptotic, not raw exponential)

Raw exponential speed will violate `D_min`. Use **clamped exponential toward a floor/ceiling**.

```
v(n) = v_max - (v_max - v_0) * exp(-n / n_v)
W(n) = W_min + (W_0 - W_min) * exp(-n / n_w)
L(n) = max(L_min, L_0 - n * L_step)   # or also exponential to L_min
```

Suggested constants (tune in playtest):

| | start | asymptote | scale |
|--|-------|-----------|--------|
| v | 0.55 /s | 2.4 /s | n_v = 18 |
| W | 0.22 | 0.055 | n_w = 22 |
| L | 8.0 s | 2.4 s | L_min from constraint (2) |

Then `D(n) = W/v`:

- n=0: D ≈ 0.22/0.55 ≈ **400 ms**
- n→∞: D ≈ 0.055/2.4 ≈ **23 ms** ← **TOO TIGHT**, violates D_min

**Fix:** define `v_max` from W_min:

`v_max = W_min / D_min = 0.055 / 0.080 ≈ 0.69 /s` if we keep W_min=0.055.

That is too slow for “hard.” Better: **raise W_min** or **lower D_min slightly** or **slow v_max**.

Playable hard end:

- `W_min = 0.10` (10% of rail)
- `D_min = 0.090 s`
- `v_max = W_min / D_min ≈ 1.11 /s`  
  Full ping-pong period T = 2/v ≈ **1.8 s** at max — frantic but fair.

`L_min = 0.12 + 1.8/2 + 0.09 ≈ **1.11 s`** → set **L_min = 1.6 s** with margin.

### Recommended schedule

```
v_0=0.50, v_max=1.10, n_v=16
W_0=0.28, W_min=0.10, n_w=20
L_0=7.0,  L_min=1.8,  n_L=14     # L(n)= L_min + (L_0-L_min)*exp(-n/n_L)
```

Verify each n in code:

```
assert W(n)/v(n) >= 0.09
assert L(n) >= 0.12 + 1.0/v(n) + 0.09
```

(`T/2 = 1/v` for unit rail.)

## Ensuring a physics solution every shot

Hoop at `(H_x, H_y)`, tee at origin.

Solve for `t*` such that trajectory hits hoop center. Invert:

Want `θ*, P*` that hit. Then set mapping `t → (θ,P)` so `t=0.5` is not always perfect (varies per shot).

**Construction (guaranteed hit):**

1. Pick hoop in an annulus where min power and max power can both reach (range check).
2. Compute one valid pair `(θ*, P*)` via binomial aim:  
   `θ* = atan2(H_y + g d² / (2 P²) …)` or pick `P*` first in `[P_min,P_max]`, solve `θ*`.
3. Place sweet band **centered on t*** where `map(t*)=(θ*,P*)`.
4. Width `W(n)` in t-space; clamp band to `[0,1]` — if clamp would shrink band, **nudge hoop** or **shift map** so band fits fully on rail.

Range check for hoop:

Distance `d`. Need `P_min` can reach with 45° and `P_max` isn’t forced overshoot-only.

`d ≤ P_max² / g` (approx 45°) and `d ≥` short-arc min.

Randomize hoop in that legal rectangle **before** placing the band.

## Why not pure exponential

`v ∝ r^n` or `W ∝ r^{-n}` eventually `D < 1 frame` → unbeatable. Asymptotes keep a skill ceiling.

Linear `v = v_0 + α n` also crosses `D_min` at finite n — **clamp** the same way.

## Implementation order

1. Fixed `v,W,L` — prove loop.
2. Plug formulas + asserts in debug overlay (show D, next dwell, clock).
3. Playtest n_v, n_w until 20 feels medium and 40+ feels brutal.
