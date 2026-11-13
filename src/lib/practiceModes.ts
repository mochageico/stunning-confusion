// ============================================================================
// PRACTICE MODES
// ----------------------------------------------------------------------------
// One list of the practice pop-up's modes, in menu order, and the rules for
// which modes fit a set of verses. The pop-up's mode menu (useRecall.ts) and
// the Practice page's mode list (PracticeScreen.tsx, FREE_PRACTICE_PLAN.md)
// both read it, so a mode can't show in one place and not the other.
//
// `counts`: whether the mode can credit a review. It only ever does for
// verses that are due (the review engine's due gate); everything else is
// side practice. The Practice page groups the list by this.
// ============================================================================

import type { LearnMode } from '../components/practice/useRecall';
import { MIN_JIGSAW_VERSES, type DrillVerse } from './drills';
import { gapFits } from './spotGap';
import { formatLabel } from './formatNames';
import { referencesFit } from './referenceQuiz';

export interface PracticeModeInfo {
  id: LearnMode;
  label: string;
  counts: boolean;
}

export const PRACTICE_MODES: readonly PracticeModeInfo[] = [
  { id: 'recite', label: 'Recall', counts: true },
  { id: 'buildUp', label: 'Build up', counts: false },
  { id: 'jigsaw', label: 'Order', counts: false },
  { id: 'scramble', label: 'Scramble', counts: false },
  { id: 'spotSwap', label: formatLabel('findWrongWord'), counts: true },
  { id: 'outline', label: formatLabel('firstWords'), counts: true },
  { id: 'openings', label: formatLabel('openings'), counts: true },
  // FREE_PRACTICE_PLAN.md stage 4: multiple choice on verse numbers.
  { id: 'references', label: 'References', counts: false },
  { id: 'putInOrder', label: formatLabel('putInOrder'), counts: false },
  { id: 'whichSection', label: formatLabel('whichSection'), counts: false },
  { id: 'teachIt', label: formatLabel('teachIt'), counts: false },
];

/** Whether a mode has something to work with in these verses. */
export function modeFits(id: LearnMode, verses: DrillVerse[], sectionDrillsReady: boolean): boolean {
  if (verses.length === 0) return false;
  switch (id) {
    case 'jigsaw':
      return verses.length >= MIN_JIGSAW_VERSES;
    case 'spotSwap':
      return gapFits(verses);
    case 'openings':
      return verses.length >= 2;
    case 'references':
      return referencesFit(verses);
    case 'putInOrder':
    case 'whichSection':
      return sectionDrillsReady;
    default:
      return true;
  }
}

/** The modes that fit these verses, in menu order. */
export const availableModes = (verses: DrillVerse[], sectionDrillsReady: boolean): PracticeModeInfo[] =>
  PRACTICE_MODES.filter((m) => modeFits(m.id, verses, sectionDrillsReady));
