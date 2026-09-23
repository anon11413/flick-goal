import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunCoins } from '../src/economy/runCoins.js';

test('2x coins then Continue: second Game Over shows the real total and offers 2x on new coins only', () => {
  const r = createRunCoins();
  r.setEarned(8);
  assert.equal(r.doublable(), 8);
  assert.equal(r.applyDouble(), 8);
  assert.equal(r.total(), 16);
  assert.equal(r.doublable(), 0, 'offer hidden after doubling');
  // continue, 3 more goals: engine coinsRun is cumulative (16)
  r.setEarned(16);
  assert.equal(r.total(), 24, 'card shows coins actually credited (8 + 8 bonus + 8)');
  assert.equal(r.doublable(), 8, 'only the coins earned since the last 2x');
  assert.equal(r.applyDouble(), 8);
  assert.equal(r.total(), 32);
  r.reset();
  assert.equal(r.total(), 0);
  assert.equal(r.doublable(), 0);
});

test('setEarned ignores garbage and never goes backwards', () => {
  const r = createRunCoins();
  r.setEarned(5);
  r.setEarned('x');
  r.setEarned(-3);
  r.setEarned(2);
  assert.equal(r.earned, 5);
});
