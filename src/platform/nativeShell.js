// Native (Android app) shell: hardware / gesture Back button, and app pause / resume for the game.
// Web builds never create it (no window.Capacitor), so browsers keep their normal Back behaviour.
//
// Registering a @capacitor/app "backButton" listener replaces Android's default Back (WebView history /
// close the app), so every screen decides here:
//
//   state                                   Back does
//   --------------------------------------  -----------------------------------------------------
//   "Loading video..." overlay              cancel it (same as its Cancel button)
//   ad / purchase / consent form busy       nothing (the native sheet handles its own Back)
//   in-game dialog open (incl. this quit    close it like Cancel / tapping outside
//     prompt, reward popup, pending notice)
//   another button flow still running       nothing
//   playing                                 pause
//   paused                                  resume
//   store / settings                        back one screen (store -> game over when it came from there)
//   game over                               Home (a natural break: may show a due interstitial)
//   menu                                    in-game "Quit Flick Goal?" dialog -> App.exitApp()
//
// The page-visibility handler in main.js already pauses the run when the app goes to the background;
// the App "pause" / "resume" events are forwarded as well, because Android can report them without a
// visibilitychange (e.g. the Google Play purchase sheet or a full-screen ad covering the activity).

import { nativePlugin, listen, call } from './native.js';

/**
 * Pure decision for one Back press.
 * @returns 'cancelLoading' | 'ignore' | 'closeDialog' | 'pause' | 'resume' | 'back' | 'home' | 'exitPrompt'
 */
export function backAction({ loading = false, busy = false, dialogOpen = false, flowBusy = false, route = '' } = {}) {
  if (loading) return 'cancelLoading';
  if (busy) return 'ignore';            // a native ad / purchase sheet / consent form is up
  if (dialogOpen) return 'closeDialog'; // before flowBusy: e.g. the free-gift popup runs inside a flow
  if (flowBusy) return 'ignore';        // an async button flow (interstitial check, restore) is finishing
  switch (route) {
    case 'playing': return 'pause';
    case 'paused': return 'resume';
    case 'store':
    case 'settings': return 'back';
    case 'gameover': return 'home';
    case 'menu': return 'exitPrompt';
    default: return 'ignore';
  }
}

/**
 * createNativeShell({ cap, state, actions, onPause, onResume, log }) -> { active, handleBack, dispose }
 *   cap      window.Capacitor (null on the web -> inactive, nothing is registered)
 *   state()  -> { loading, busy, dialogOpen, flowBusy, route }
 *   actions  { cancelLoading, closeDialog, pause, resume, back, home, confirmExit: () => Promise<boolean> }
 */
export function createNativeShell({ cap, state, actions, onPause, onResume, log = console } = {}) {
  const App = nativePlugin(cap, 'App');
  if (!App) return { active: false, handleBack: () => 'ignore', dispose() {} };

  let exiting = false;
  let prompting = false;

  async function handleBack() {
    let s;
    try { s = state(); } catch (e) { log.warn('back: state', e); return 'ignore'; }
    const act = prompting && !s.dialogOpen ? 'ignore' : backAction(s);
    try {
      switch (act) {
        case 'cancelLoading': actions.cancelLoading(); break;
        case 'closeDialog': actions.closeDialog(); break;
        case 'pause': actions.pause(); break;
        case 'resume': actions.resume(); break;
        case 'back': actions.back(); break;
        case 'home': actions.home(); break;
        case 'exitPrompt': {
          prompting = true;
          let ok = false;
          try { ok = await actions.confirmExit(); } finally { prompting = false; }
          if (ok && !exiting) {
            exiting = true;
            const r = await call(App, 'exitApp');
            if (!r.ok) { exiting = false; log.warn('exitApp failed', r.error); }
          }
          break;
        }
        default: break;
      }
    } catch (e) {
      log.error('back button', e);
    }
    return act;
  }

  const removers = [
    listen(App, 'backButton', () => { handleBack(); }),
    listen(App, 'pause', () => { try { if (onPause) onPause(); } catch (e) { log.error(e); } }),
    listen(App, 'resume', () => { try { if (onResume) onResume(); } catch (e) { log.error(e); } }),
  ];

  return {
    active: true,
    handleBack,
    dispose() { for (const r of removers) r(); },
  };
}
