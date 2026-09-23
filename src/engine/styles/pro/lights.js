// Flick Goal — PRO style: lighting mood per base theme (ported from try/pro-graphics skins.js).
//  ball     - screen-space direction TO the key light + rim light colour / strength for the ball
//  casts    - cast-shadow projections on the turf: dx/dy = screen px per px of height, a = strength
//             (soft = back-lit: one blurred wedge toward the camera instead of hard rods)
//  shadow   - tinted shadow colour / alpha;  vignette colour / alpha;  grain = turf grain strength
//  dust     - colour of kick / landing puffs;  fg = foreground strip style;  lineGlow = neon paint
//  key      - key light colour (highlights on props);  pool = stadium light pools on the turf
//  sheen    - strength of the sky reflection on the far turf;  near = darkening toward the camera

const LIGHT = (o) => Object.freeze(o);

export const LIGHTS = Object.freeze({
  day: LIGHT({
    ball: Object.freeze({ x: -0.62, y: -0.78, rim: '#FFFFFF', rimA: 0.32 }),
    casts: Object.freeze([Object.freeze({ dx: 0.5, dy: 0.13, a: 1 })]),
    shadow: '#0C3A18', shadowA: 0.2, vignette: '#08223A', vignetteA: 0.2, grain: 1,
    dust: '#E9E2C0', fg: 'grass', key: '#FFF6DC', pool: 0, sheen: 0.28, near: 0.16,
  }),
  night: LIGHT({
    ball: Object.freeze({ x: -0.25, y: -0.97, rim: '#A8D4FF', rimA: 0.55 }),
    casts: Object.freeze([Object.freeze({ dx: 0.42, dy: 0.1, a: 0.65 }), Object.freeze({ dx: -0.42, dy: 0.1, a: 0.65 })]),
    shadow: '#020A14', shadowA: 0.3, vignette: '#01020C', vignetteA: 0.34, grain: 1,
    dust: '#CFE8D6', fg: 'grass', key: '#FFF4C2', pool: 0.2, sheen: 0.12, near: 0.3,
  }),
  snow: LIGHT({
    ball: Object.freeze({ x: 0.45, y: -0.89, rim: '#D6F0FF', rimA: 0.5 }),
    casts: Object.freeze([Object.freeze({ dx: -0.34, dy: 0.09, a: 0.8 })]),
    shadow: '#3A6696', shadowA: 0.17, vignette: '#2A4868', vignetteA: 0.14, grain: 0.45,
    dust: '#FFFFFF', fg: 'snow', key: '#FFFFFF', pool: 0, sheen: 0.22, near: 0.12,
  }),
  sunset: LIGHT({
    ball: Object.freeze({ x: 0.7, y: -0.55, rim: '#FFB35C', rimA: 0.8 }),
    casts: Object.freeze([Object.freeze({ dx: 0.04, dy: 0.22, a: 0.8, soft: true })]),
    shadow: '#6A2440', shadowA: 0.22, vignette: '#3A0A2A', vignetteA: 0.28, grain: 0.8,
    dust: '#F4DCA0', fg: 'sand', key: '#FFE2B0', pool: 0, sheen: 0.3, near: 0.2,
  }),
  arcade: LIGHT({
    ball: Object.freeze({ x: 0, y: -1, rim: '#FF2BD6', rimA: 0.75 }),
    casts: Object.freeze([Object.freeze({ dx: 0, dy: 0.24, a: 0.8 })]),
    shadow: '#000000', shadowA: 0.35, vignette: '#04000E', vignetteA: 0.45, grain: 0.7,
    dust: '#7DF9FF', fg: 'neon', lineGlow: true, key: '#FFFFFF', pool: 0, sheen: 0.18, near: 0.3,
  }),
});

/** Lighting mood of a base theme id (unknown -> day). */
export const lightOf = (themeId) => LIGHTS[themeId] || LIGHTS.day;
