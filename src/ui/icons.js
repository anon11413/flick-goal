// Inline SVG icon strings (no image files). All 24x24, fill = currentColor unless multicolor.
// Use with h('span.ic', { html: ICONS.play }) or icon('play').

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

// Procedural gear path (8 rounded-ish teeth) with an evenodd hole.
function gearPath() {
  const cx = 12, cy = 12, teeth = 8, rOut = 10.4, rIn = 7.8, hole = 3.3;
  let d = '';
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 4 === 1 || i % 4 === 2) ? rOut : rIn;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(2) + ' ' + (cy + Math.sin(a) * r).toFixed(2);
  }
  d += 'Z';
  d += `M${cx + hole} ${cy}A${hole} ${hole} 0 1 0 ${cx - hole} ${cy}A${hole} ${hole} 0 1 0 ${cx + hole} ${cy}Z`;
  return d;
}

export const ICONS = {
  play: svg('<path d="M8 4.8v14.4a1.2 1.2 0 0 0 1.84 1.02l11.3-7.2a1.2 1.2 0 0 0 0-2.04L9.84 3.78A1.2 1.2 0 0 0 8 4.8z" fill="currentColor"/>'),
  pause: svg('<rect x="5.5" y="4" width="4.6" height="16" rx="1.6" fill="currentColor"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.6" fill="currentColor"/>'),
  replay: svg('<path d="M12 4.5a7.5 7.5 0 1 1-7.3 9.2" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M3.2 5.2l1.6 5.6 5.4-2.2z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'),
  store: svg('<path d="M4 8.5h16l-1.2 10.6a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z" fill="currentColor"/><path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="8.5" cy="11" r="1.3" fill="#fff"/><circle cx="15.5" cy="11" r="1.3" fill="#fff"/>'),
  gear: svg(`<path d="${gearPath()}" fill="currentColor" fill-rule="evenodd"/>`),
  soundOn: svg('<path d="M3.5 9.2h3.6L12 5v14l-4.9-4.2H3.5a1 1 0 0 1-1-1V10.2a1 1 0 0 1 1-1z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>'),
  soundOff: svg('<path d="M3.5 9.2h3.6L12 5v14l-4.9-4.2H3.5a1 1 0 0 1-1-1V10.2a1 1 0 0 1 1-1z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M15.5 9.3l5.4 5.4M20.9 9.3l-5.4 5.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  noAds: svg('<circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" stroke-width="2.4"/><text x="12" y="15.6" text-anchor="middle" font-size="9.5" font-weight="900" font-family="Arial, sans-serif" fill="currentColor">AD</text><path d="M5.4 5.4l13.2 13.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  gift: svg('<rect x="3.2" y="9" width="17.6" height="4.4" rx="1.2" fill="currentColor"/><path d="M4.8 13.4h14.4v6a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6z" fill="currentColor"/><rect x="10.6" y="9" width="2.8" height="12" fill="#fff" opacity=".9"/><path d="M12 9c-1.2-3.4-5.8-5-6.4-2.4C5.1 8.8 9.4 9 12 9zm0 0c1.2-3.4 5.8-5 6.4-2.4.5 2.2-3.8 2.4-6.4 2.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  home: svg('<path d="M3.2 11.2 12 3.8l8.8 7.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.6 10.4V19a1.6 1.6 0 0 0 1.6 1.6h3.2v-5.4h3.2v5.4h3.2a1.6 1.6 0 0 0 1.6-1.6v-8.6L12 5.2z" fill="currentColor"/>'),
  back: svg('<path d="M15 4.5 7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10.5" rx="2.4" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.4"/>'),
  // TV with a cut-out play triangle (evenodd) so it reads on any button color.
  ad: svg('<path fill="currentColor" fill-rule="evenodd" d="M5.7 4.5h12.6a3.2 3.2 0 0 1 3.2 3.2v8.6a3.2 3.2 0 0 1-3.2 3.2H5.7a3.2 3.2 0 0 1-3.2-3.2V7.7a3.2 3.2 0 0 1 3.2-3.2zM9.6 8.6v6.8l5.8-3.4z"/>'),
  restore: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><path d="M20.4 3.6v5.6h-5.6z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
  vibrate: svg('<rect x="7.5" y="3" width="9" height="18" rx="2.2" fill="currentColor"/><rect x="9.3" y="5.4" width="5.4" height="10.8" rx=".8" fill="#fff" opacity=".85"/><path d="M4 8v8M20 8v8M1.8 10v4M22.2 10v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  trash: svg('<path d="M4 6.5h16M9.5 6.5V4.6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M5.8 8.5h12.4l-1 11.2a1.6 1.6 0 0 1-1.6 1.5H8.4a1.6 1.6 0 0 1-1.6-1.5z" fill="currentColor"/>'),
  star: svg('<path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
  crown: svg('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.8 10.5H4.8z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'),
  football: svg('<ellipse cx="12" cy="12" rx="10" ry="6.4" transform="rotate(-35 12 12)" fill="currentColor"/><path d="M8.6 15.4l6.8-6.8M10 11.6l1.4 1.4M11.6 10l1.4 1.4M13.2 8.4l1.4 1.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>'),
  stadium: svg('<path d="M4 20V11M20 20V11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M8 20v-8h8v8M8 12V4.5M16 12V4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="8.5" r="2.3" fill="currentColor"/><circle cx="20" cy="8.5" r="2.3" fill="currentColor"/>'),
  coins: svg('<ellipse cx="12" cy="17" rx="8" ry="3.2" fill="currentColor"/><ellipse cx="12" cy="12.6" rx="8" ry="3.2" fill="currentColor" stroke="#fff" stroke-width="1.2"/><ellipse cx="12" cy="8.2" rx="8" ry="3.2" fill="currentColor" stroke="#fff" stroke-width="1.2"/>'),
  info: svg('<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 11v6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="7.3" r="1.6" fill="#fff"/>'),
  // v2: game modes + aim slider upgrade
  goalpost: svg('<path d="M12 21.5v-9M5.5 12.5h13M5.5 12.5V3M18.5 12.5V3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 21.5h6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
  infinity: svg('<path d="M12 12c-2-3-3.6-4.6-6-4.6a4.6 4.6 0 0 0 0 9.2c2.4 0 4-1.6 6-4.6s3.6-4.6 6-4.6a4.6 4.6 0 0 1 0 9.2c-2.4 0-4-1.6-6-4.6z" fill="none" stroke="currentColor" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round"/>'),
  swap: svg('<path d="M4.5 8.5h13.5M14.5 4.5l4 4-4 4M19.5 15.5H6M9.5 11.5l-4 4 4 4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  flag: svg('<path d="M6 21.5V3" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M6.8 3.6c3.8-1.8 6.4 1.9 11.4.2v9.4c-5 1.7-7.6-2-11.4-.2z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'),
  slider: svg('<rect x="2.5" y="9" width="19" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="10" y="10.4" width="6" height="3.2" rx="1.6" fill="currentColor" opacity=".45"/><rect x="12" y="5" width="3.2" height="14" rx="1.6" fill="currentColor"/>'),
  // Multicolor gold coin (used everywhere coins appear).
  coin: svg(
    '<circle cx="12" cy="12" r="11" fill="#F5A300"/>' +
    '<circle cx="12" cy="11.2" r="10.2" fill="#FFC83D"/>' +
    '<circle cx="12" cy="11.2" r="7" fill="#FFD95E" stroke="#E89400" stroke-width="1.6"/>' +
    '<path d="M12 6.9l1.35 2.75 3.02.44-2.19 2.13.52 3.01L12 13.8l-2.7 1.43.52-3.01-2.19-2.13 3.02-.44z" fill="#E89400"/>' +
    '<path d="M5.2 8.2a7.6 7.6 0 0 1 4-3.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".7"/>'
  ),
};

/** Returns an icon SVG string ('' for unknown names). */
export function icon(name) {
  return ICONS[name] || '';
}
