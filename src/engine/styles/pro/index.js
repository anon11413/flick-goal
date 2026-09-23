// Flick Goal — PRO art style: STUB (Engineer B replaces this whole directory).
//
// Until the real pro style lands, PRO stadiums play end-to-end with the retro drawing (so they
// are selectable, purchasable and equip correctly), and store previews carry a clearly marked
// "PRO ART PENDING" tag so nobody mistakes the placeholder for the finished look.
// The interface every style implements is documented in V2_SPEC.md §5.3 / §15.

import retro from '../retro/index.js';
import { roundRectPath } from '../../paint.js';

const pro = {
  ...retro,
  id: 'pro',
  // true => the core runs the adaptive quality monitor (engine/quality.js) for this style and may
  // cap the backing store at 2x dpr in the low tier (f.lowQ). Kept on so the pipeline is live.
  adaptive: true,

  drawFinish(ctx, f) {
    // Placeholder marker, store previews only (f.preview is set by engine/preview.js).
    if (!f.preview) return;
    const s = Math.max(0.6, Math.min(1, f.w / 176));
    const txt = 'PRO ART PENDING';
    ctx.save();
    ctx.font = `900 ${Math.round(9 * s)}px system-ui, sans-serif`;
    const tw = (ctx.measureText && ctx.measureText(txt).width) || txt.length * 6 * s;
    const pw = tw + 10 * s;
    const ph = 14 * s;
    const x = 5 * s;
    const y = f.h - ph - 5 * s;
    roundRectPath(ctx, x, y, pw, ph, ph / 2);
    ctx.fillStyle = 'rgba(20,28,50,0.72)';
    ctx.fill();
    ctx.fillStyle = '#FFD21F';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, x + 5 * s, y + ph / 2 + 0.5);
    ctx.restore();
  },
};

export default Object.freeze(pro);
