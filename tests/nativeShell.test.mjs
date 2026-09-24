// Android shell: hardware Back button decisions + App pause / resume wiring (fake @capacitor/app).
import test from 'node:test';
import assert from 'node:assert/strict';
import './fakes/fakeCapacitor.js';
import { backAction, createNativeShell } from '../src/platform/nativeShell.js';

const Fake = globalThis.FakeCapacitor;
const quiet = { info() {}, warn() {}, error() {}, log() {} };
const tick = () => new Promise((r) => setTimeout(r, 0));

test('backAction: one decision per screen state', () => {
  assert.equal(backAction({ route: 'playing' }), 'pause');
  assert.equal(backAction({ route: 'paused' }), 'resume');
  assert.equal(backAction({ route: 'store' }), 'back');
  assert.equal(backAction({ route: 'settings' }), 'back');
  assert.equal(backAction({ route: 'gameover' }), 'home');
  assert.equal(backAction({ route: 'menu' }), 'exitPrompt');
  assert.equal(backAction({ route: 'unknown' }), 'ignore');
});

test('backAction: overlays win over the screen (loading > native busy > dialog > flow busy)', () => {
  assert.equal(backAction({ route: 'gameover', loading: true, busy: true }), 'cancelLoading');
  assert.equal(backAction({ route: 'playing', busy: true, dialogOpen: true }), 'ignore');
  assert.equal(backAction({ route: 'menu', dialogOpen: true, flowBusy: true }), 'closeDialog');
  assert.equal(backAction({ route: 'gameover', flowBusy: true }), 'ignore');
});

function setup(stateOverrides = {}, { confirm = true } = {}) {
  const App = Fake.createApp();
  let exitCalls = 0;
  App.exitApp = () => { exitCalls++; return Promise.resolve(); };
  const cap = Fake.makeCapacitor({ App });
  const calls = [];
  let state = { loading: false, busy: false, dialogOpen: false, flowBusy: false, route: 'menu', ...stateOverrides };
  const record = (name) => () => { calls.push(name); };
  const shell = createNativeShell({
    cap,
    state: () => state,
    actions: {
      cancelLoading: record('cancelLoading'),
      closeDialog: record('closeDialog'),
      pause: record('pause'),
      resume: record('resume'),
      back: record('back'),
      home: record('home'),
      confirmExit: async () => { calls.push('confirmExit'); return confirm; },
    },
    onPause: record('onPause'),
    onResume: record('onResume'),
    log: quiet,
  });
  return { App, shell, calls, setState: (s) => { state = { ...state, ...s }; }, exits: () => exitCalls };
}

test('native shell is inactive on the web (no window.Capacitor / no App plugin)', () => {
  const shell = createNativeShell({ cap: null, state: () => ({}), actions: {}, log: quiet });
  assert.equal(shell.active, false);
  const noApp = createNativeShell({ cap: Fake.makeCapacitor({}), state: () => ({}), actions: {}, log: quiet });
  assert.equal(noApp.active, false);
  const webCap = Fake.makeCapacitor({ App: Fake.createApp() }, 'web');
  assert.equal(createNativeShell({ cap: webCap, state: () => ({}), actions: {}, log: quiet }).active, false);
});

test('hardware Back: pauses a run, resumes, goes back, and routes game over to Home', async () => {
  const t = setup({ route: 'playing' });
  assert.equal(t.shell.active, true);
  await tick(); // listeners attach asynchronously (Capacitor returns a Promise of the handle)
  t.App.emit('backButton', { canGoBack: false });
  t.setState({ route: 'paused' });
  t.App.emit('backButton', {});
  t.setState({ route: 'store' });
  t.App.emit('backButton', {});
  t.setState({ route: 'gameover' });
  t.App.emit('backButton', {});
  await tick();
  assert.deepEqual(t.calls, ['pause', 'resume', 'back', 'home']);
});

test('hardware Back on the menu asks first; quitting calls App.exitApp once, cancelling never', async () => {
  const yes = setup({ route: 'menu' }, { confirm: true });
  assert.equal(await yes.shell.handleBack(), 'exitPrompt');
  assert.deepEqual(yes.calls, ['confirmExit']);
  assert.equal(yes.exits(), 1);

  const no = setup({ route: 'menu' }, { confirm: false });
  await no.shell.handleBack();
  assert.equal(no.exits(), 0);
});

test('hardware Back closes an open dialog (the quit prompt itself too) and ignores native busy', async () => {
  const t = setup({ route: 'menu', dialogOpen: true });
  assert.equal(await t.shell.handleBack(), 'closeDialog');
  t.setState({ dialogOpen: false, busy: true, route: 'gameover' });
  assert.equal(await t.shell.handleBack(), 'ignore');
  t.setState({ busy: true, loading: true });
  assert.equal(await t.shell.handleBack(), 'cancelLoading');
  assert.deepEqual(t.calls, ['closeDialog', 'cancelLoading']);
});

test('App pause / resume events reach the game', async () => {
  const t = setup();
  await tick();
  t.App.emit('pause');
  t.App.emit('resume');
  assert.deepEqual(t.calls, ['onPause', 'onResume']);
  t.shell.dispose();
  t.App.emit('pause');
  assert.deepEqual(t.calls, ['onPause', 'onResume']);
});
