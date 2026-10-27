// How one verse's result in a review round becomes a grade: clean, stumble
// or blank (REVIEW_LADDER_PLAN.md Part 1 §4). Recited, typed, Keep going and
// First words results grade by accuracy; Find the wrong word by misses per
// verse; a self-check by the user's own answer, with the every-other rule
// and the spot check keeping it honest. Pure -- ladder.ts turns a passage's
// grades into an outcome.
import type { ReviewGrade } from '../types';

/** "Accuracy needed for clean", in percent. */
export const DEFAULT_CLEAN_PCT = 90;
export const CLEAN_PCT_OPTIONS: readonly number[] = [85, 90, 95, 100];

/** Under this share of words right, a recalled verse is a blank. */
export const BLANK_BELOW_ACCURACY = 0.5;

export interface RecallResult {
  /** Share of words right, 0..1. First words passes the share of its hidden words only. */
  accuracy: number;
  /** The user revealed the verse. */
  revealed?: boolean;
  /** The user asked for a hint. */
  hinted?: boolean;
}

// Accuracy is a word share, so 9/10 can come out a hair under 0.9.
const EPSILON = 1e-9;

/**
 * Recite, type, Keep going and First words: at or above the clean setting
 * is clean, below it a stumble, under 50% or revealed a blank. A requested
 * hint makes it a stumble at best.
 */
export const gradeRecall = (r: RecallResult, cleanPct: number = DEFAULT_CLEAN_PCT): ReviewGrade => {
  if (r.revealed || r.accuracy < BLANK_BELOW_ACCURACY - EPSILON) return 'blank';
  if (r.hinted) return 'stumble';
  return r.accuracy * 100 >= cleanPct - EPSILON ? 'clean' : 'stumble';
};

/** What Find the wrong word counts against the user. */
export interface SwapTally {
  /** Planted swaps not found. */
  unfound: number;
  /** Correct words wrongly flagged. */
  wrongFlags: number;
  /** Found swaps whose replacement the user said they didn't know. */
  unknownReplacements: number;
}

export const swapMisses = (t: SwapTally): number => t.unfound + t.wrongFlags + t.unknownReplacements;

/**
 * Find the wrong word grades by misses per verse instead of accuracy:
 * under 0.5 is clean, 0.5 to 1 a stumble, over 1 a blank. With "Find the
 * wrong word can count as a clean review" off, the best it gives is a
 * stumble.
 */
export const gradeSwap = (misses: number, verses: number, swapCanBeClean = true): ReviewGrade => {
  const perVerse = misses / Math.max(1, verses);
  if (perVerse > 1 + EPSILON) return 'blank';
  if (perVerse >= 0.5 - EPSILON || !swapCanBeClean) return 'stumble';
  return 'clean';
};

export type SelfCheckAnswer = 'gotIt' | 'stumbled' | 'blanked';

export const gradeSelfCheck = (answer: SelfCheckAnswer): ReviewGrade =>
  answer === 'gotIt' ? 'clean' : answer === 'stumbled' ? 'stumble' : 'blank';

/**
 * Every other review: a self-check can hold or drop a passage but can't
 * move it up twice in a row. Pass the result as passageOutcome's
 * `canMoveUp` for a self-checked review.
 */
export const canSelfCheckMoveUp = (lastSelfChecked: boolean | undefined): boolean => !lastSelfChecked;

/**
 * Which "Got it" verse to spot check: one at random, every time. null when
 * nothing was Got it. `rand` is Math.random's shape so a check can pin it.
 */
export const pickSpotCheck = (answers: readonly SelfCheckAnswer[], rand: () => number = Math.random): number | null => {
  const gotIt = answers.flatMap((a, i) => (a === 'gotIt' ? [i] : []));
  if (gotIt.length === 0) return null;
  return gotIt[Math.min(gotIt.length - 1, Math.floor(rand() * gotIt.length))];
};

/** Words of the verse before shown as the spot check's running start. */
export const SPOT_CHECK_LEAD_WORDS = 3;

/**
 * The spot check's lead-in: the last words of the verse before, "…in Christ
 * Jesus." null when there is no verse before (the passage starts the
 * chapter) or it has no words.
 */
export const spotCheckLeadIn = (previousVerseText: string | null | undefined, words = SPOT_CHECK_LEAD_WORDS): string | null => {
  const all = (previousVerseText ?? '').trim().split(/\s+/).filter(Boolean);
  if (all.length === 0) return null;
  const tail = all.slice(-words).join(' ');
  return all.length > words ? `…${tail}` : tail;
};

/**
 * A missed spot check holds the whole review, whatever the passage's size:
 * pass the result as passageOutcome's `canMoveUp` (with the every-other
 * rule). Stumbles and blanks still apply.
 */
export const spotCheckCanMoveUp = (passed: boolean): boolean => passed;
