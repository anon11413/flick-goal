import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { MODES, otherMode, normalizeMode, calloutVisible, nextCalloutState, newBadgeVisible, isMode } from '../src/modes.js';
import { defaultSave } from '../src/economy/save.js';

const withUi = (ui = {}, games = 0) => {
  const d = defaultSave();
  d.ui = { ...d.ui, ...ui };
  d.stats.gamesPlayed = games;
  return d;
};

test('modes: labels, otherMode, normalizeMode', () => {
  assert.equal(MODES.field.label, 'FIELD GOAL');
  assert.equal(MODES.endless.label, 'ENDLESS');
  assert.equal(otherMode('field'), 'endless');
  assert.equal(otherMode('endless'), 'field');
  assert.equal(otherMode('junk'), 'endless');
  assert.equal(normalizeMode('endless'), 'endless');
  assert.equal(normalizeMode('x'), CONFIG.modes.default);
  assert.equal(CONFIG.modes.default, 'field');
  assert.ok(isMode('field') && isMode('endless') && !isMode('x'));
});

test('callout: only for returning players who never tried Endless, at most 3 menu visits', () => {
  const min = CONFIG.modes.calloutMinGames;
  assert.equal(calloutVisible(withUi({}, 0)), false, 'brand-new player: no callout');
  assert.equal(calloutVisible(withUi({}, min - 1)), false);
  assert.equal(calloutVisible(withUi({}, min)), true);
  assert.equal(calloutVisible(withUi({ endlessTried: true }, 9)), false);
  assert.equal(calloutVisible(withUi({ calloutDone: true }, 9)), false);
  assert.equal(calloutVisible(withUi({ calloutShows: CONFIG.modes.calloutMaxShows }, 9)), false);
  assert.equal(calloutVisible(null), false);
});

test('callout bookkeeping: menu visits count, switching or an endless run dismisses it for good', () => {
  let d = withUi({}, 5);
  let visits = 0;
  for (let i = 0; i < 6; i++) {
    const patch = nextCalloutState(d, 'menuVisit');
    if (patch) { visits++; d = { ...d, ui: { ...d.ui, ...patch } }; }
  }
  assert.equal(visits, CONFIG.modes.calloutMaxShows, 'shown on exactly 3 menu visits');
  assert.equal(calloutVisible(d), false);

  d = withUi({}, 5);
  const sw = nextCalloutState(d, 'switch');
  assert.deepEqual(sw, { calloutDone: true });
  d = { ...d, ui: { ...d.ui, ...sw } };
  assert.equal(calloutVisible(d), false);
  assert.equal(nextCalloutState(d, 'switch'), null);
  assert.equal(nextCalloutState(d, 'menuVisit'), null);

  d = withUi({}, 0);
  assert.equal(newBadgeVisible(d), true);
  const er = nextCalloutState(d, 'endlessRun');
  assert.deepEqual(er, { endlessTried: true, calloutDone: true });
  d = { ...d, ui: { ...d.ui, ...er } };
  assert.equal(newBadgeVisible(d), false);
  assert.equal(nextCalloutState(d, 'endlessRun'), null);
  assert.equal(nextCalloutState(d, 'nope'), null);
});
