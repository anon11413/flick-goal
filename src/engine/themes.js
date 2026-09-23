// Flick Goal — style-agnostic scene data: the five base stadium themes (palettes per score tier,
// field descriptor, crowd colours) and the ball metadata (name, shape, trail colour, trail fx).
// Pure data (no drawing). Every art style (styles/retro, styles/pro) paints these same themes;
// a catalog stadium = one base theme x one style (see skins.js stadiumInfo()).

// zone = painted end-zone (team) colour.
function P(skyTop, skyBottom, ground, groundDark, line, post, accent, uiBg, zone = accent) {
  return Object.freeze({ skyTop, skyBottom, ground, groundDark, line, post, accent, uiBg, zone });
}

/** Crowd colours per surface (shirts); heads use SKIN_TONES. */
export const CROWD = Object.freeze({
  grass: ['#E53935', '#FFFFFF', '#1E88E5', '#FDD835', '#43A047', '#FB8C00', '#8E24AA', '#263238'],
  snow: ['#D32F2F', '#1565C0', '#FFFFFF', '#F9A825', '#2E7D32', '#6D4C41', '#37474F', '#EC407A'],
  sand: ['#FF7043', '#26C6DA', '#FFEE58', '#FFFFFF', '#EC407A', '#66BB6A', '#AB47BC', '#29B6F6'],
  neon: ['#00F0FF', '#FF2BD6', '#39FF88', '#FFE600', '#7C4DFF', '#FFFFFF'],
});
export const SKIN_TONES = Object.freeze(['#F1C27D', '#C68642', '#8D5524', '#FFDBAC', '#E0AC69']);

/**
 * Base themes. `field` describes the field look every style must honour:
 *  surface 'grass' | 'snow' | 'sand' | 'neon', wall 'pads' | 'board' | 'snow' | 'neon' | 'none',
 *  lights (stadium light pools), words (end-zone words, FIELD layout).
 */
export const THEMES = Object.freeze({
  day: Object.freeze({
    id: 'day', name: 'Day Game', decor: 'clouds',
    palettes: [
      P('#4FC3F7', '#B3E5FC', '#5CC858', '#4DB84A', '#FFFFFF', '#FFD21F', '#FF8A3D', '#4FC3F7', '#2459B8'),
      P('#26C6DA', '#B2F0F7', '#57C46A', '#48B35C', '#FFFFFF', '#FFD21F', '#FF6B6B', '#1FB5C9', '#D23C3C'),
      P('#9C7BEA', '#D9CCFF', '#5CC870', '#4DB862', '#FFFFFF', '#FFD21F', '#FF8A3D', '#8E6FE0', '#4A33B8'),
      P('#FF8FA3', '#FFD6DE', '#63C95C', '#54B94E', '#FFFFFF', '#FFD21F', '#7C4DFF', '#F77A91', '#2E6FD8'),
      P('#FFB74D', '#FFE3B8', '#6AC955', '#5AB948', '#FFFFFF', '#FFFFFF', '#E0457B', '#F5A23A', '#C72E6A'),
    ],
    field: Object.freeze({ surface: 'grass', wall: 'pads', words: ['FLICK', 'GOAL'] }),
  }),
  night: Object.freeze({
    id: 'night', name: 'Night Lights', decor: 'night',
    palettes: [
      P('#0E1B4D', '#2D4C8F', '#2E9E5B', '#278A4F', '#FFFFFF', '#FFD21F', '#FF4FA0', '#1F2F66', '#C2185B'),
      P('#2A0F4F', '#5A2D8C', '#2E9E68', '#27885A', '#FFFFFF', '#FFD21F', '#39D98A', '#3B1C6B', '#6A1B9A'),
      P('#062F3F', '#1A6B7A', '#2FA05E', '#288A51', '#FFFFFF', '#FFE45C', '#FF8A3D', '#0D4658', '#E0661B'),
      P('#3A0B26', '#7A2446', '#2E9A5A', '#27854E', '#FFFFFF', '#FFD21F', '#4FC3F7', '#5A1638', '#1565C0'),
    ],
    field: Object.freeze({ surface: 'grass', wall: 'board', lights: true, words: ['FLICK', 'GOAL'] }),
  }),
  snow: Object.freeze({
    id: 'snow', name: 'Snow Bowl', decor: 'snow',
    palettes: [
      P('#7CC6F0', '#DDF1FF', '#F2F8FF', '#DCEAF7', '#8EB9DA', '#FFD21F', '#FF5A5F', '#5DB6E6', '#D84343'),
      P('#A99BE8', '#E6E0FF', '#F4F4FF', '#E0E0F5', '#9A93CF', '#FFD21F', '#FF6FB5', '#8F80DD', '#7E3FB0'),
      P('#F59BB0', '#FFE3EA', '#FAF6F8', '#EDE0E6', '#C99AAB', '#FFD21F', '#5A7DFF', '#E97F98', '#3F5FD6'),
      P('#7D93AD', '#D5E0EC', '#EEF3F8', '#D6E0EA', '#92A7BD', '#FFD21F', '#FF8A3D', '#6A819C', '#E0762E'),
    ],
    field: Object.freeze({ surface: 'snow', wall: 'snow', words: ['FLICK', 'GOAL'] }),
  }),
  sunset: Object.freeze({
    id: 'sunset', name: 'Beach Sunset', decor: 'sunset',
    palettes: [
      P('#FF6F61', '#FFC37A', '#F2D48C', '#E6C274', '#FFFFFF', '#FFFFFF', '#FF3D6E', '#FF7A59', '#1E88A8'),
      P('#D94F8C', '#FF9E7A', '#EFD08F', '#E2BD76', '#FFFFFF', '#FFE45C', '#7C4DFF', '#D9578F', '#6A3FC4'),
      P('#6A3FA0', '#F0788A', '#E8CB8E', '#D9B874', '#FFFFFF', '#FFD21F', '#FF8A3D', '#7A4AAE', '#E0457B'),
      P('#FF9A3C', '#FFE08A', '#F4D98F', '#E8C677', '#FFFFFF', '#FFFFFF', '#E0457B', '#F58B2E', '#2E7D9A'),
    ],
    field: Object.freeze({ surface: 'sand', wall: 'none', words: ['BEACH', 'GOAL'] }),
  }),
  arcade: Object.freeze({
    id: 'arcade', name: 'Neon Arcade', decor: 'arcade',
    palettes: [
      P('#12072E', '#3A0CA3', '#1B0F3F', '#25145A', '#00F0FF', '#FFE600', '#FF2BD6', '#2A0E6B', '#FF2BD6'),
      P('#07122E', '#0C4DA3', '#0F1B3F', '#14275A', '#FF2BD6', '#39FF88', '#00F0FF', '#0E2A6B', '#00F0FF'),
      P('#2E0721', '#A30C6E', '#3F0F2E', '#5A1442', '#39FF88', '#00F0FF', '#FFE600', '#6B0E4A', '#FFE600'),
      P('#0A2E07', '#0CA36B', '#0F3F24', '#145A33', '#FFE600', '#FF2BD6', '#00F0FF', '#0E6B45', '#FF2BD6'),
    ],
    field: Object.freeze({ surface: 'neon', wall: 'neon', words: ['FLICK', 'GOAL'] }),
  }),
});

export const THEME_IDS = Object.freeze(Object.keys(THEMES));

/** Base theme id or 'day'. */
export const themeIdOf = (id) => (THEMES[id] ? id : 'day');

/** Palette index for a tier (cycles; negative tiers wrap). */
export function tierIndex(themeId, tier) {
  const n = THEMES[themeIdOf(themeId)].palettes.length;
  return ((Math.floor(Number(tier) || 0) % n) + n) % n;
}

/** Palette of a BASE theme at a score tier (unknown id -> 'day'). */
export function basePalette(themeId, tier = 0) {
  const th = THEMES[themeIdOf(themeId)];
  return th.palettes[tierIndex(th.id, tier)];
}

/** Cache identity of a (theme, tier) palette: 'day:0'. Styles key cached layers with it. */
export function palKeyOf(themeId, tier) {
  const id = themeIdOf(themeId);
  return `${id}:${tierIndex(id, tier)}`;
}

/**
 * Ball metadata shared by every style (the catalog ball ids). trail = trail colour,
 * fx = trail particles ('none' | 'fire' | 'sparkle' | 'frost' | 'pixel'), shape = collision
 * look ('football' ~1.3r x 0.85r, 'round' ~1.05r) used for the tee lift.
 */
export const BALL_META = Object.freeze({
  classic: Object.freeze({ id: 'classic', name: 'Classic', shape: 'football', trail: '#FFFFFF', fx: 'none' }),
  retro: Object.freeze({ id: 'retro', name: 'Retro', shape: 'football', trail: '#FFE0B2', fx: 'none' }),
  pro: Object.freeze({ id: 'pro', name: 'Pro White', shape: 'football', trail: '#FFFFFF', fx: 'none' }),
  soccer: Object.freeze({ id: 'soccer', name: 'Soccer', shape: 'round', trail: '#FFFFFF', fx: 'none' }),
  basketball: Object.freeze({ id: 'basketball', name: 'Hoops', shape: 'round', trail: '#FF9E40', fx: 'none' }),
  rugby: Object.freeze({ id: 'rugby', name: 'Rugby', shape: 'football', trail: '#FF5A5F', fx: 'none' }),
  candy: Object.freeze({ id: 'candy', name: 'Candy', shape: 'football', trail: '#FF7BC8', fx: 'sparkle' }),
  watermelon: Object.freeze({ id: 'watermelon', name: 'Melon', shape: 'football', trail: '#6BE36B', fx: 'none' }),
  camo: Object.freeze({ id: 'camo', name: 'Camo', shape: 'football', trail: '#A4B06A', fx: 'none' }),
  neon: Object.freeze({ id: 'neon', name: 'Neon', shape: 'football', trail: '#00F0FF', fx: 'sparkle' }),
  ice: Object.freeze({ id: 'ice', name: 'Ice', shape: 'football', trail: '#B8F1FF', fx: 'frost' }),
  fire: Object.freeze({ id: 'fire', name: 'Fire', shape: 'football', trail: '#FF8A00', fx: 'fire' }),
  pixel: Object.freeze({ id: 'pixel', name: 'Pixel', shape: 'football', trail: '#7CFF6B', fx: 'pixel' }),
  galaxy: Object.freeze({ id: 'galaxy', name: 'Galaxy', shape: 'football', trail: '#B388FF', fx: 'sparkle' }),
  gold: Object.freeze({ id: 'gold', name: 'Gold', shape: 'football', trail: '#FFD54F', fx: 'sparkle' }),
});

export const ballMeta = (id) => BALL_META[id] || BALL_META.classic;
