// Flick Goal — facade over the v2 art modules (kept so existing imports keep working).
//
// v2 split the old monolithic skins.js (V2_SPEC.md §3.1):
//   paint.js   colour / gradient / path helpers        themes.js  base themes + BALL_META
//   field.js   field geometry (projection, layouts)   stadiums.js catalog stadium -> style + theme
//   styles/    art styles (retro, pro)                preview.js store previews via real styles
// This module re-exports the shared pieces and offers style-aware ball drawing.

import { CONFIG } from '../config.js';
import { THEMES, BALL_META, basePalette } from './themes.js';
import { stadiumInfo, styleOf, themeOf, stadiumDisplayName } from './stadiums.js';
import { getStyle } from './styles/index.js';
import { RETRO_BALLS } from './styles/retro/balls.js';
import { fieldProjection } from './field.js';
import { drawFieldLayout, drawEndlessLayout } from './styles/retro/field.js';

export * from './paint.js';
export { BALL_META, THEMES } from './themes.js';
export { stadiumInfo, styleOf, themeOf, stadiumDisplayName } from './stadiums.js';
export { drawBallPreview, drawStadiumPreview, drawAimSliderPreview } from './preview.js';
export { fieldProjection } from './field.js';

/** Compat: base themes (keys are the BASE theme ids, not the catalog stadium ids). */
export const STADIUM_THEMES = THEMES;

/** Compat: { [ballId]: { ...BALL_META[id], draw: retro draw } }. */
export const BALL_SKINS = Object.freeze(Object.fromEntries(Object.keys(BALL_META).map((id) => [
  id, Object.freeze({ ...BALL_META[id], draw: RETRO_BALLS[id].draw }),
])));

/**
 * Palette of a stadium at a score tier. Accepts catalog stadium ids ('pro_night') AND base theme
 * ids ('night'); unknown -> day.
 */
export function themePalette(id, tier = 0) {
  return basePalette(THEMES[id] ? id : stadiumInfo(id).theme, tier);
}

/**
 * Draw a ball in an art style. sx/sy scale is applied before rotation (in the caller's frame),
 * so a caller can pre-rotate for squash & stretch. rot is canvas radians (clockwise-positive).
 * Unknown id -> classic; unknown style -> retro. light = the style's light mood (pro) or null.
 */
export function drawBall(ctx, id, x, y, r, rot, time, sx = 1, sy = 1, styleId = 'retro', light = null) {
  const style = getStyle(styleId);
  const skin = (style.balls && style.balls[id]) || (style.balls && style.balls.classic) || RETRO_BALLS.classic;
  ctx.save();
  ctx.translate(x, y);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  ctx.rotate(rot || 0);
  skin.draw(ctx, r, time || 0, rot || 0, light);
  ctx.restore();
}

/** Compat: retro field drawing for a view (fv.mode 'endless' paints the endless layout). */
export function drawField(ctx, themeId, pal, fv, time = 0, cfg = CONFIG) {
  const th = THEMES[themeId] || THEMES[themeOf(themeId)] || THEMES.day;
  const pr = fieldProjection(fv, cfg);
  if (fv.mode === 'endless') return drawEndlessLayout(ctx, th.field, pal, fv, pr, time, cfg);
  return drawFieldLayout(ctx, th.field, pal, fv, pr, time, cfg);
}

export { styleOf as stadiumStyle };
export const stadiumName = stadiumDisplayName;
export { getStyle };
