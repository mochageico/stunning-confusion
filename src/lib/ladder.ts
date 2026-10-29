// The review ladder's pure math (REVIEW_LADDER_PLAN.md Part 1 §1, §3, §4):
// the steps a passage climbs, how many reviews each step takes at a
// thoroughness setting, the short catch-up after a join, when the next
// review is due, what one review's grades do to the passage, and how far a
// late passage moves back. Nothing here reads React state or Firestore;
// passages.ts and the review engine build on it.
import type { ReviewGrade } from '../types';
import { getLogicalDate, nthOccurrenceOfWeekday, scheduledDaysBetween } from './logicalDate';
import { nextDueDateISO, type ReviewClock } from './retention';

export type LadderGroup = 'settling' | 'steady' | 'kept' | 'secure';

export interface LadderStepInfo {
  label: string;
  intervalDays: number;
  /** Reviews to move up at Standard thoroughness. null at the top: it stays for good. */
  baseReviews: number | null;
  group: LadderGroup;
  /** Theme palette key for the step's color. The top step also sets `top`. */
  colorToken: 'stageDaily' | 'stageWeekly' | 'stageComplete' | 'stageTop';
  /** The every-6-months step ("halo and glint"). */
  top?: true;
}

// Weekly and longer steps are whole weeks (4 weeks, not 30 days) so they
// keep the chapter's review weekday. 6 months is 26 weeks.
export const LADDER: readonly LadderStepInfo[] = [
  { label: 'Every day', intervalDays: 1, baseReviews: 7, group: 'settling', colorToken: 'stageDaily' },
  { label: 'Every 2 days', intervalDays: 2, baseReviews: 4, group: 'settling', colorToken: 'stageDaily' },
  { label: 'Every 4 days', intervalDays: 4, baseReviews: 4, group: 'settling', colorToken: 'stageDaily' },
  { label: 'Every week', intervalDays: 7, baseReviews: 8, group: 'steady', colorToken: 'stageWeekly' },
  { label: 'Every 2 weeks', intervalDays: 14, baseReviews: 6, group: 'steady', colorToken: 'stageWeekly' },
  { label: 'Every 4 weeks', intervalDays: 28, baseReviews: 12, group: 'kept', colorToken: 'stageComplete' },
  { label: 'Every 8 weeks', intervalDays: 56, baseReviews: 6, group: 'kept', colorToken: 'stageComplete' },
  { label: 'Every 6 months', intervalDays: 182, baseReviews: null, group: 'secure', colorToken: 'stageTop', top: true },
];

export const TOP_STEP = LADDER.length - 1;
/** The first step on the chapter's weekday (Every week). */
export const FIRST_WEEKLY_STEP = 3;

export const LADDER_GROUPS: Record<LadderGroup, { name: string; description: string }> = {
  settling: { name: 'Settling', description: 'Reviewed every 1–4 days' },
  steady: { name: 'Steady', description: 'Reviewed every 1–2 weeks' },
  kept: { name: 'Kept', description: 'Reviewed every 4–8 weeks' },
  secure: { name: 'Secure', description: 'Reviewed every 6 months, for good' },
};

export type Thoroughness = 0.5 | 1 | 1.5 | 2;

export const THOROUGHNESS_PRESETS: readonly { value: Thoroughness; label: string }[] = [
  { value: 0.5, label: 'Light' },
  { value: 1, label: 'Standard' },
  { value: 1.5, label: 'Thorough' },
  { value: 2, label: 'Intense' },
];

export const DEFAULT_THOROUGHNESS: Thoroughness = 1;

/** Every step needs at least this many reviews, whatever the thoroughness. */
export const MIN_STEP_REVIEWS = 2;

/**
 * The short catch-up after a verse joins a passage: reviews needed at Every
 * day, Every 2 days and Every 4 days (~2 weeks), then the passage lands at
 * Every week. The same at every thoroughness.
 */
export const CATCH_UP_REVIEWS: readonly number[] = [3, 2, 2];

/** Where a passage sits on the ladder. `reviews` counts reviews done at `step`. */
export interface LadderState {
  step: number;
  reviews: number;
  catchUp?: true;
}

const clampStep = (step: number) => Math.min(TOP_STEP, Math.max(0, Math.floor(step)));

export const stepInfo = (step: number): LadderStepInfo => LADDER[clampStep(step)];

/** Reviews to move up from `step` at a thoroughness, outside a catch-up. null at the top. */
export const stepReviewCount = (step: number, thoroughness: Thoroughness = DEFAULT_THOROUGHNESS): number | null => {
  const base = stepInfo(step).baseReviews;
  if (base === null) return null;
  return Math.max(MIN_STEP_REVIEWS, Math.round(base * thoroughness));
};

/** Reviews this passage needs at its current step to move up, catch-up included. */
export const reviewsToMoveUp = (state: LadderState, thoroughness: Thoroughness = DEFAULT_THOROUGHNESS): number | null => {
  if (state.catchUp && state.step < CATCH_UP_REVIEWS.length) return CATCH_UP_REVIEWS[state.step];
  return stepReviewCount(state.step, thoroughness);
};

/** Days from the first review at Every day to arriving at Every 6 months, with no slips. */
export const daysToTop = (thoroughness: Thoroughness = DEFAULT_THOROUGHNESS): number =>
  LADDER.reduce((sum, s, step) => sum + s.intervalDays * (stepReviewCount(step, thoroughness) ?? 0), 0);

/** Days a catch-up takes, from the join to landing at Every week. */
export const catchUpDays = (): number =>
  CATCH_UP_REVIEWS.reduce((sum, n, step) => sum + n * LADDER[step].intervalDays, 0);

const make = (step: number, reviews: number, catchUp: boolean): LadderState =>
  catchUp && step < CATCH_UP_REVIEWS.length ? { step, reviews, catchUp: true } : { step, reviews };

/**
 * When the review after this one is due. Every day / 2 days / 4 days count
 * days from today; Every week and longer land on the chapter's weekday
 * (`anchorDay`), the same way weekly and monthly do today. A due date never
 * lands on the Sabbath. Pause doesn't move due dates; nothing is due while
 * paused, and paused days don't count as late (see lateness).
 */
export const nextDue = (step: number, anchorDay: string | undefined, clock: ReviewClock, now: Date = new Date()): string => {
  const { intervalDays } = stepInfo(step);
  if (clampStep(step) < FIRST_WEEKLY_STEP || !anchorDay) return nextDueDateISO(intervalDays, clock, now);
  const tomorrow = new Date(getLogicalDate(clock.dayStartHour, now));
  tomorrow.setDate(tomorrow.getDate() + 1);
  return nthOccurrenceOfWeekday(tomorrow, anchorDay, intervalDays / 7, clock.sabbathEnabled, clock.sabbathDay).toISOString();
};

export type PassageOutcome = 'up' | 'held' | 'forgiven' | 'back' | 'down';

/**
 * Stumbles scale with the passage: up to 1 in 6 verses is forgiven (none
 * under 6 verses, 2 at 12), and it takes about 1 in 4 to move back (never
 * fewer than 3). In between holds.
 */
export const forgivableStumbles = (size: number): number => Math.floor(size / 6);
export const stumblesToMoveBack = (size: number): number => Math.max(3, Math.ceil(size / 4));

/**
 * One review's outcome from its verses' grades (Part 1 §4 table, with the
 * stumble limits scaled by size). A blank beats stumbles: one penalty per
 * review. `size` is the passage's verse
 * count when it differs from the grades given (a partly covered passage).
 * `canMoveUp: false` keeps the penalties but turns a move up into a hold:
 * a partly covered passage at day's end, or a self-check right after a
 * self-check.
 */
export const passageOutcome = (
  grades: readonly ReviewGrade[],
  opts: { size?: number; canMoveUp?: boolean } = {}
): PassageOutcome => {
  const size = opts.size ?? grades.length;
  const canMoveUp = opts.canMoveUp ?? true;
  if (grades.length === 0) return 'held';
  if (grades.includes('blank')) return 'down';
  const stumbles = grades.filter((g) => g === 'stumble').length;
  if (stumbles >= stumblesToMoveBack(size)) return 'back';
  if (!canMoveUp) return 'held';
  if (stumbles === 0) return 'up';
  return stumbles <= forgivableStumbles(size) ? 'forgiven' : 'held';
};

/**
 * Moves a passage by one review's outcome. Up and forgiven count a review
 * and move up a step once the step's count is reached (the top step just
 * keeps counting). Back one never goes below the start of the step. Down a
 * step lands at the start of the step below; Every day is the floor. A
 * catch-up ends when the passage lands at Every week.
 */
export const applyOutcome = (
  state: LadderState,
  outcome: PassageOutcome,
  thoroughness: Thoroughness = DEFAULT_THOROUGHNESS
): LadderState => {
  const step = clampStep(state.step);
  const reviews = Math.max(0, state.reviews);
  const catchUp = !!state.catchUp;
  switch (outcome) {
    case 'up':
    case 'forgiven': {
      const need = reviewsToMoveUp({ step, reviews, catchUp: catchUp || undefined }, thoroughness);
      if (need === null || reviews + 1 < need) return make(step, reviews + 1, catchUp);
      return make(step + 1, 0, catchUp);
    }
    case 'held':
      return make(step, reviews, catchUp);
    case 'back':
      return make(step, Math.max(0, reviews - 1), catchUp);
    case 'down':
      return make(Math.max(0, step - 1), 0, catchUp);
  }
};

/**
 * How late a passage is and where that leaves it ("Late reviews move you
 * back"). Each full interval overdue is one missed review, counted in
 * scheduled days (Sabbath and paused days don't count); less than one
 * interval late is free. Each missed review moves the passage back one,
 * never below the start of its step. Today's review is then graded on top.
 */
export const lateness = (
  state: LadderState,
  dueISO: string | null | undefined,
  clock: ReviewClock,
  now: Date = new Date()
): { missed: number; state: LadderState } => {
  if (!dueISO) return { missed: 0, state };
  // Whole calendar days: a review due at 9pm yesterday is one day late at
  // 8am today, not zero.
  const due = new Date(dueISO);
  due.setHours(0, 0, 0, 0);
  const today = new Date(getLogicalDate(clock.dayStartHour, now));
  today.setHours(0, 0, 0, 0);
  const days = scheduledDaysBetween(due, today, clock.sabbathEnabled, clock.sabbathDay, clock.pausedAt, clock.pausedUntil);
  const missed = Math.floor(days / stepInfo(state.step).intervalDays);
  if (missed === 0) return { missed, state };
  return { missed, state: make(clampStep(state.step), Math.max(0, state.reviews - missed), !!state.catchUp) };
};
