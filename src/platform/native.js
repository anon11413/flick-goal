// Tiny helpers for Capacitor native plugins WITHOUT a bundler.
//
// Inside the Android app, the Capacitor bridge injects `window.Capacitor` with one proxy per native
// plugin under `Capacitor.Plugins.<Id>` (every method returns a Promise; `addListener(event, cb)` is
// exposed too). `registerPlugin` lives in @capacitor/core's JS, which this no-build game does not
// load, so plugins are read from `Capacitor.Plugins` directly. On the web there is no
// window.Capacitor and every helper here reports "not native".
//
// Plugin ids: 'AdMob' (@capacitor-community/admob), 'Purchases' (@revenuecat/purchases-capacitor),
// 'App' (@capacitor/app).

/** window.Capacitor (or the injected object in tests), else null. */
export function getCapacitor(win) {
  try {
    const w = win !== undefined ? win : (typeof window !== 'undefined' ? window : null);
    const cap = w && w.Capacitor;
    return cap && typeof cap === 'object' ? cap : null;
  } catch {
    return null;
  }
}

/** True inside the native Android / iOS shell. */
export function isNative(cap) {
  try {
    return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  } catch {
    return false;
  }
}

/** 'android' | 'ios' | 'web'. */
export function platformOf(cap) {
  try {
    return cap && typeof cap.getPlatform === 'function' ? String(cap.getPlatform()) : 'web';
  } catch {
    return 'web';
  }
}

/** The native plugin proxy `Capacitor.Plugins[name]` when it is installed, else null. */
export function nativePlugin(cap, name) {
  try {
    if (!isNative(cap)) return null;
    if (typeof cap.isPluginAvailable === 'function' && !cap.isPluginAvailable(name)) return null;
    const p = cap.Plugins && cap.Plugins[name];
    return p && typeof p === 'object' ? p : null;
  } catch {
    return null;
  }
}

/** Normalize a plugin rejection into { code: string, message: string }. */
export function errorInfo(err) {
  if (err && typeof err === 'object') {
    const code = err.code != null ? String(err.code) : '';
    const message = err.message != null ? String(err.message) : String(err.errorMessage || '');
    return { code, message };
  }
  return { code: '', message: String(err == null ? '' : err) };
}

/** A promise that rejects with {code:'timeout'} after ms (never, when ms is falsy). */
export function withTimeout(promise, ms, code = 'timeout') {
  if (!(ms > 0)) return Promise.resolve(promise);
  let t = 0;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject({ code, message: `timed out after ${ms} ms` }), ms); }),
  ]);
}

/**
 * Call a plugin method and never reject: resolves { ok: true, value } or { ok: false, error: {code, message} }.
 * A missing method resolves { ok: false, error: { code: 'unimplemented' } }.
 */
export async function call(plugin, method, options, timeoutMs = 0) {
  try {
    const fn = plugin && plugin[method];
    if (typeof fn !== 'function') return { ok: false, error: { code: 'unimplemented', message: `${method} missing` } };
    const value = await withTimeout(options === undefined ? fn.call(plugin) : fn.call(plugin, options), timeoutMs);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: errorInfo(err) };
  }
}

/**
 * plugin.addListener(event, cb) -> a remover function (sync). Capacitor returns a Promise of a
 * handle with remove(); older shapes return the handle directly. Never throws.
 */
export function listen(plugin, event, cb) {
  let handle = null;
  let removed = false;
  try {
    if (plugin && typeof plugin.addListener === 'function') {
      const r = plugin.addListener(event, cb);
      if (r && typeof r.then === 'function') {
        r.then((h) => { handle = h; if (removed && h && h.remove) h.remove(); }).catch(() => {});
      } else {
        handle = r;
      }
    }
  } catch { /* plugin without events */ }
  return () => {
    removed = true;
    try { if (handle && typeof handle.remove === 'function') handle.remove(); } catch { /* ignore */ }
  };
}
