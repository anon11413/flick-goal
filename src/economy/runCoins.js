// Per-run coin ledger for the Game Over "2x COINS" offer (pure, no DOM).
//
// A run can be continued after Game Over, so "2x" must only ever double coins that have not
// been doubled yet: after 2x -> Continue -> more goals, the next Game Over offers 2x on the
// coins earned since the last doubling, and the card shows every coin actually credited.

export function createRunCoins() {
  let earned = 0;         // coins earned by play this run (goals, perfects, pickups)
  let bonus = 0;          // coins credited by 2x rewards this run
  let doubledThrough = 0; // `earned` value covered by the last 2x

  return {
    /** New run: forget everything. */
    reset() { earned = 0; bonus = 0; doubledThrough = 0; },
    /** Sync with the engine's cumulative run coins (never decreases within a run). */
    setEarned(n) { earned = Math.max(earned, Math.max(0, Math.floor(Number(n) || 0))); },
    /** Coins a 2x reward would add right now (0 = hide the offer). */
    doublable() { return Math.max(0, earned - doubledThrough); },
    /** Record a granted 2x; returns the amount to credit. */
    applyDouble() {
      const amount = Math.max(0, earned - doubledThrough);
      bonus += amount;
      doubledThrough = earned;
      return amount;
    },
    /** Everything credited this run (shown on the Game Over card). */
    total() { return earned + bonus; },
    get earned() { return earned; },
    get bonus() { return bonus; },
  };
}

export default createRunCoins;
