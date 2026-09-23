// Test helpers: a validating stub 2D context and a stub canvas factory (no DOM needed).

/**
 * Stub 2D context: every method is a no-op that records its call; gradient / pattern factories
 * return objects with addColorStop. Throws on non-finite geometry and negative radii so NaN bugs
 * in draw code are caught. ctx.__calls = { n, byName }.
 */
export function stubCtx() {
  const calls = { n: 0, byName: {} };
  const state = { globalAlpha: 1 };
  const gradient = () => ({
    addColorStop(o, c) {
      if (!(o >= 0 && o <= 1)) throw new Error('bad stop ' + o);
      if (typeof c !== 'string') throw new Error('bad color');
    },
  });
  function record(name, args) {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`non-finite arg to ${name}: ${args}`);
    }
    if ((name === 'arc' || name === 'ellipse') && args.slice(2, name === 'arc' ? 3 : 4).some((v) => v < 0)) {
      throw new Error(`negative radius in ${name}`);
    }
    calls.n++;
    calls.byName[name] = (calls.byName[name] || 0) + 1;
  }
  const handler = {
    get(_, prop) {
      if (prop === '__calls') return calls;
      if (prop in state) return state[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return (...args) => { record(prop, args); return gradient(); };
      }
      if (prop === 'createPattern') return (...args) => { record(prop, []); return { setTransform() {} }; };
      if (prop === 'measureText') return (s) => { record(prop, []); return { width: String(s).length * 8 }; };
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return (...args) => { record(prop, args); return undefined; };
    },
    set(_, prop, value) {
      if (prop === 'lineWidth' || prop === 'globalAlpha') {
        if (!Number.isFinite(value)) throw new Error(`non-finite ${String(prop)}`);
      }
      state[prop] = value;
      return true;
    },
  };
  return new Proxy({}, handler);
}

/** Stub canvas + a counter of offscreen canvases created through the factory. */
export function stubCanvas(w = 390, h = 844) {
  const ctx = stubCtx();
  return { ctx, canvas: { getContext: () => ctx, clientWidth: w, clientHeight: h, style: {}, width: w, height: h } };
}

/** Offscreen canvas factory for renderer tests (counts creations and sizes). */
export function canvasFactory() {
  const made = [];
  const create = (w, h) => {
    const ctx = stubCtx();
    const c = { width: w, height: h, getContext: () => ctx };
    made.push(c);
    return c;
  };
  return { create, made };
}
