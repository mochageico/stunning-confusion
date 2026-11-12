// "Open My sky zoomed into this constellation" (CONSTELLATION_SKY_PLAN.md, stage 3).
//
// navigateTo() takes only a screen name, so a caller that wants My sky open on
// one constellation (the review summary's "1 new star appeared in The
// Shepherd") leaves the constellation id here first, then navigates:
//
//   setSkyFocus('the-shepherd'); navigateTo('mySky');
//
// My sky reads it once when it opens (takeSkyFocus) and clears it. Kept outside
// the app state on purpose (like toastStore): no screen redraws for it.

let pending: string | null = null;

export function setSkyFocus(constellationId: string | null) {
  pending = constellationId;
}

/** The constellation to open zoomed into, once; null when the sky should open on the whole sky. */
export function takeSkyFocus(): string | null {
  const id = pending;
  pending = null;
  return id;
}
