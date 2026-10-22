// ============================================================================
// FORMAT NAMES
// ----------------------------------------------------------------------------
// One table of the review and practice formats' user-facing names. The names
// are working names (MIXED_REVIEW_PLAN.md, "Names are not final") and the user
// expects to rename some, so every screen that shows a format's name reads it
// from here: a rename is a one-line change.
//
// `counts` is the locked counting rule: a format counts as a review when it
// brings words out of memory. The others are labeled "Practice" and never
// credit a review on their own.
//
// New copy: check it against the banned-jargon list in the memory note
// "three-concept naming" (no "queue", "phase", "graduate", "rhythm"...).
// ============================================================================

export type FormatId =
  | 'recite'
  | 'keepGoing'
  | 'firstWords'
  | 'findWrongWord'
  | 'putInOrder'
  | 'whichSection'
  | 'teachIt'
  | 'scramble';

export const FORMATS: Record<FormatId, { label: string; counts: boolean }> = {
  recite: { label: 'Recite', counts: true },
  // Today's "Pick up the thread".
  keepGoing: { label: 'Keep going', counts: true },
  // Outline mode.
  firstWords: { label: 'First words', counts: true },
  // Today's "Spot the swap".
  findWrongWord: { label: 'Find the wrong word', counts: true },
  putInOrder: { label: 'Put in order', counts: false },
  whichSection: { label: 'Which section', counts: false },
  teachIt: { label: 'Teach-It', counts: false },
  scramble: { label: 'Scramble', counts: false },
};

/** Names that aren't formats but sit beside them. */
export const MIX_NAMES = {
  /** The session that mixes formats section by section. */
  mixedReview: 'Mixed review',
  /** The option on Recite that runs verses last to first, each verse forward. */
  lastToFirst: 'Last to first',
  /** The tag on a format that counts as a review. */
  countsTag: 'Counts',
  /** The tag on a format that doesn't. Not "warm-up". */
  practiceTag: 'Practice',
} as const;

export const formatLabel = (id: FormatId): string => FORMATS[id].label;

/** "Counts" or "Practice", for the tag beside a format's name. */
export const formatTag = (id: FormatId): string => (FORMATS[id].counts ? MIX_NAMES.countsTag : MIX_NAMES.practiceTag);
