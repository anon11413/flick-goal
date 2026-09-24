// Player-facing texts for purchase / restore / rewarded-ad results. Pure (Node tests import it).

export const NO_AD_TEXT = 'No ad available right now. Try again in a moment.';
export const COINS_NOT_RESTORABLE = 'Coin packs are used up when bought, so they can’t be restored.';

/**
 * Toast for a failed / unfinished purchase, or null when nothing should be said (cancel, busy).
 * Pending payments get a dialog instead (see pendingText).
 */
export function purchaseErrorText(res) {
  if (!res || res.ok || res.cancelled || res.pending) return null;
  switch (res.error) {
    case 'busy': return null;
    case 'already_owned': return res.restored ? 'No Ads restored ✓' : 'No Ads is already active';
    case 'owned_elsewhere': return 'You already own No Ads. Tap Restore Purchases in Settings.';
    case 'still_processing': return 'Your last purchase is still being processed. Try again in a moment.';
    case 'network': return 'No connection. Try again.';
    case 'store_unavailable': return 'Store unavailable. Check your connection.';
    case 'unavailable': return 'This item isn’t available right now.';
    case 'not_allowed': return 'Purchases are disabled on this device.';
    case 'disabled': return 'Purchases aren’t available in this version.';
    default: return 'Purchase failed. You were not charged.';
  }
}

/** { title, message } for a payment Google Play marked PENDING (cash / bank / slow card). */
export function pendingText(productId) {
  const noAds = productId === 'no_ads';
  return {
    title: 'Payment pending',
    message: noAds
      ? 'No Ads turns on automatically once Google Play confirms your payment.'
      : 'Your coins will be added automatically once Google Play confirms your payment.',
  };
}

/** { text, kind } toast for a Restore Purchases result. */
export function restoreText(res) {
  if (!res || !res.ok) {
    if (res && res.error === 'busy') return null;
    return { text: 'Restore failed. Check your connection and try again.', kind: 'warn' };
  }
  if (res.noAds) return { text: `No Ads restored ✓ ${COINS_NOT_RESTORABLE}`, kind: 'ok' };
  return { text: `Nothing to restore. ${COINS_NOT_RESTORABLE}`, kind: 'info' };
}

/**
 * Toast after a rewarded ad that did not reward, or null. `what` finishes "Watch the full video to …".
 */
export function rewardedFailText(res, what) {
  if (!res || res.rewarded) return null;
  if (res.error === 'no_ad' || res.error === 'show_failed') return NO_AD_TEXT;
  if (res.shown) return `Watch the full video to ${what}`;
  return null; // cancelled / busy / disabled: the player already knows
}
