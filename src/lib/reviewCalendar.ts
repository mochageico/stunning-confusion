import { QueueItem } from '../types';

// ============================================================================
// MEMORY CALENDAR — RECURRING REVIEW PROJECTION
// ----------------------------------------------------------------------------
// Pure logic, no React/Firestore -- mirrors recitation.ts's shape. Projects
// which verses will be due each future day, and which phase (Daily/Weekly/
// Monthly) they'll be in, by simulating the "assume every review succeeds"
// case forward from each item's real current state.
//
// This deliberately does NOT try to predict misses (impossible to know in
// advance) -- it projects the recurring pattern the same way a tool like
// Anki previews future review load. Every graduation threshold and cycle
// length below is copied EXACTLY from handleReviewCompleted's success path
// in useAppState.ts (~L3334-3394) so this projection never disagrees with
// what the real spaced-repetition engine would actually do.
// ============================================================================

export type RetentionPhase = 'daily' | 'weekly' | 'monthly';

export interface CalendarPlanSettings {
  dailyPhaseWeeks: number;
  weeklyPhaseMonths: number;
  monthlyPhaseYears: number;
  learningDays: string[];
  newVersesPace: number;
  sabbathEnabled: boolean;
  sabbathDay: string;
}

export interface CalendarDayProjection {
  date: Date;
  isLearningDay: boolean;
  isSabbath: boolean;
  /** Verses projected due this day, with the phase they'd be reviewed in. */
  dueReviews: { item: QueueItem; phase: RetentionPhase }[];
  /** Flat ongoing Learning-phase count -- not date-scheduled, same value every day (see module doc on HomeScreen/getMemoryLoadForecast for why). */
  learningCount: number;
  /** New verses projected to be pulled into Learning this day (count only -- which specific verses depends on queue order at pull time, unknowable in advance). */
  newVersesPulled: number;
}

// Duplicated from useAppState.ts's private DAY_ABBREVS/advancePastSabbath
// rather than imported -- src/lib must not depend on the mega state-hook
// file (the hook/screens depend on src/lib, never the reverse; same
// direction recitation.ts already established). Kept in sync by hand; both
// are tiny and change rarely (Sabbath support was a one-time addition).
const DAY_ABBREVS = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']; // index matches Date.getDay()

const advancePastSabbath = (date: Date, sabbathEnabled: boolean, sabbathDay: string): Date => {
  if (!sabbathEnabled) return date;
  const result = new Date(date);
  while (DAY_ABBREVS[result.getDay()] === sabbathDay) {
    result.setDate(result.getDate() + 1);
  }
  return result;
};

const addDays = (date: Date, days: number, sabbathEnabled: boolean, sabbathDay: string): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return advancePastSabbath(result, sabbathEnabled, sabbathDay);
};

// Chapter review-day anchoring ("Snap-to-Grid" -- see QueueItem.
// chapterReviewAnchorDay in types.ts and the matching helpers in
// useAppState.ts, duplicated here for the same src/lib-must-not-import-the-
// state-hook reason as DAY_ABBREVS/advancePastSabbath above). Nth future
// occurrence of `weekday` on/after `from`; n=1 is the very next one.
const nextOccurrenceOfWeekday = (from: Date, weekday: string, sabbathEnabled: boolean, sabbathDay: string): Date => {
  const result = new Date(from);
  result.setHours(0, 0, 0, 0);
  let scanned = 0;
  while (DAY_ABBREVS[result.getDay()] !== weekday && scanned < 7) {
    result.setDate(result.getDate() + 1);
    scanned++;
  }
  return advancePastSabbath(result, sabbathEnabled, sabbathDay);
};

const nthOccurrenceOfWeekday = (from: Date, weekday: string, n: number, sabbathEnabled: boolean, sabbathDay: string): Date => {
  const first = nextOccurrenceOfWeekday(from, weekday, sabbathEnabled, sabbathDay);
  if (n <= 1) return first;
  const result = new Date(first);
  result.setDate(result.getDate() + (n - 1) * 7);
  return advancePastSabbath(result, sabbathEnabled, sabbathDay);
};

// Has any OTHER verse of this book+chapter already established a shared
// review-anchor weekday in the REAL (non-simulated) queue?
const findChapterReviewAnchor = (book: string, chapter: number, queue: QueueItem[]): string | undefined =>
  queue.find((q) => q.book === book && q.chapter === chapter && q.chapterReviewAnchorDay)?.chapterReviewAnchorDay;

const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

interface ProjectedOccurrence {
  date: Date;
  phase: RetentionPhase;
}

// Window is capped well under a year of daily/weekly/monthly cycles; this is
// just a safety valve against an unexpected infinite loop, not a real limit.
const MAX_ITERATIONS_PER_ITEM = 500;

/**
 * Projects every future occurrence of ONE reviewing item within
 * [today, windowEnd], assuming every review succeeds (see module doc).
 *
 * Chapter review-day anchoring: resolved in three tiers, cheapest/most
 * authoritative first --
 *   1. the item's own `chapterReviewAnchorDay`, if a real graduation already set it;
 *   2. a real sibling verse of the same book+chapter that's already anchored
 *      (`fullQueue`, the actual current queue, not this simulation);
 *   3. if neither exists, this item's OWN simulated Daily->Weekly transition
 *      self-anchors to whatever weekday that lands on, for the rest of this
 *      item's own projected occurrences. Not shared with other simulated
 *      items in the same run -- a real cross-item shared simulation would
 *      catch that, but this is a preview, not a guarantee (see module doc),
 *      and that's a much bigger rewrite for a rare edge case (two chunks of
 *      an unanchored chapter both graduating within the same ~60-day window).
 * Once resolved (any tier), the anchor is fixed for the rest of this item's
 * simulated Weekly/Monthly occurrences, mirroring handleReviewCompleted
 * (useAppState.ts) never overwriting an already-set chapterReviewAnchorDay.
 */
function projectItemOccurrences(item: QueueItem, plan: CalendarPlanSettings, fullQueue: QueueItem[], today: Date, windowEnd: Date): ProjectedOccurrence[] {
  if (item.status !== 'reviewing' || !item.nextReviewDueDate) return [];

  const occurrences: ProjectedOccurrence[] = [];
  const dailyGraduationDays = plan.dailyPhaseWeeks * 7 + (item.dailyPhaseExtensionDays || 0);
  const weeklyGraduationReviews = Math.round(plan.weeklyPhaseMonths * (52 / 12));
  const monthlyGraduationReviews = plan.monthlyPhaseYears * 12;

  let phase = item.retentionPhase as RetentionPhase;
  let streak = item.currentStreakCount;
  let refresherActive = item.refresherActive || false;
  const refresherTarget = item.refresherTargetUnits || 1;
  const refresherReturnPhase = item.refresherReturnPhase || 'weekly';
  const refresherReturnProgress = item.refresherReturnProgress || 1;

  let anchor: string | undefined = item.chapterReviewAnchorDay || findChapterReviewAnchor(item.book, item.chapter, fullQueue);

  // Schedules n weeks out (1 for Weekly, 4 for Monthly) from the day after
  // `from`, locked to `anchor` -- mirrors nthOccurrenceOfWeekday(tomorrow,
  // anchor, n, ...) in useAppState.ts, "tomorrow" here being the day after
  // this simulated review rather than real-world today.
  const anchoredAdvance = (from: Date, n: number): Date => {
    const dayAfter = addDays(from, 1, false, '');
    return nthOccurrenceOfWeekday(dayAfter, anchor!, n, plan.sabbathEnabled, plan.sabbathDay);
  };

  // An already-overdue item (real due date in the past) is due TODAY, not on
  // its stale original date -- matches computeDayReviewLoad's own "isToday"
  // due-check (`!due || due <= date`). Every SUBSEQUENT projected occurrence
  // cascades forward from today rather than the stale date, which also
  // matches how nextDueDateISO always computes real due dates relative to
  // actual completion time, not the theoretical due date.
  let due = startOfDay(new Date(item.nextReviewDueDate));
  if (due < today) due = new Date(today);

  let iterations = 0;
  while (due <= windowEnd && iterations < MAX_ITERATIONS_PER_ITEM) {
    iterations++;
    occurrences.push({ date: due, phase });

    if (refresherActive) {
      streak += 1;
      if (streak >= refresherTarget) {
        // Refresher clears -- resume the original phase at its saved
        // progress, re-anchoring the same way a real graduation does.
        phase = refresherReturnPhase;
        streak = refresherReturnProgress;
        refresherActive = false;
        if (!anchor) anchor = DAY_ABBREVS[due.getDay()];
        due = anchoredAdvance(due, refresherReturnPhase === 'monthly' ? 4 : 1);
      } else {
        // Refresher cadence matches the CURRENT phase field, which
        // applyMissToItem already set to 'daily' or 'weekly' for the
        // refresher's duration (never the eventual return phase) -- mirrors
        // handleReviewCompleted's `retentionPhase === 'weekly' ? 7 : 1`.
        due = addDays(due, phase === 'weekly' ? 7 : 1, plan.sabbathEnabled, plan.sabbathDay);
      }
      continue;
    }

    streak += 1;
    if (phase === 'daily') {
      if (streak >= dailyGraduationDays) {
        phase = 'weekly';
        streak = 1;
        if (!anchor) anchor = DAY_ABBREVS[due.getDay()]; // tier 3: self-anchor
        due = anchoredAdvance(due, 1);
      } else {
        due = addDays(due, 1, plan.sabbathEnabled, plan.sabbathDay);
      }
    } else if (phase === 'weekly') {
      if (streak >= weeklyGraduationReviews) {
        phase = 'monthly';
        streak = 1;
        if (!anchor) anchor = DAY_ABBREVS[due.getDay()];
        due = anchoredAdvance(due, 4);
      } else if (anchor) {
        due = anchoredAdvance(due, 1);
      } else {
        due = addDays(due, 7, plan.sabbathEnabled, plan.sabbathDay);
      }
    } else {
      // monthly
      if (streak >= monthlyGraduationReviews) break; // graduates to 'retained' -- stops recurring, matching the real engine
      due = anchor ? anchoredAdvance(due, 4) : addDays(due, 30, plan.sabbathEnabled, plan.sabbathDay);
    }
  }

  return occurrences;
}

/**
 * Projects daily memorization workload for the next `days` days: which
 * verses are due for review (with recurring Daily/Weekly/Monthly
 * projection), the ongoing Learning-phase count, and new-verse pull counts
 * on future learning days. Shares its graduation/cycle math with
 * handleReviewCompleted (useAppState.ts) and its new-verse-pace math with
 * getMemoryLoadForecast (useAppState.ts) so this never quietly disagrees
 * with either.
 */
export function getMemoryCalendarProjection(queue: QueueItem[], plan: CalendarPlanSettings, days: number): CalendarDayProjection[] {
  const today = startOfDay(new Date());
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + days - 1);

  const baseLearningCount = queue.filter((item) => item.status === 'learning').length;
  const reviewingItems = queue.filter((item) => item.status === 'reviewing');

  // Precompute every reviewing item's occurrences once, then bucket by date
  // -- cheaper than re-scanning all items for every single day.
  const occurrencesByDateKey = new Map<string, { item: QueueItem; phase: RetentionPhase }[]>();
  reviewingItems.forEach((item) => {
    projectItemOccurrences(item, plan, queue, today, windowEnd).forEach(({ date, phase }) => {
      const key = date.toDateString();
      const bucket = occurrencesByDateKey.get(key) || [];
      bucket.push({ item, phase });
      occurrencesByDateKey.set(key, bucket);
    });
  });

  let cumulativeNewVerses = 0;
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dayAbbrev = DAY_ABBREVS[date.getDay()];
    const isSabbath = plan.sabbathEnabled && dayAbbrev === plan.sabbathDay;
    const isLearningDay = !isSabbath && plan.learningDays.includes(dayAbbrev);

    // Today's own pull, if any, is already reflected in the real queue
    // (baseLearningCount) -- only project pulls for days AFTER today,
    // matching getMemoryLoadForecast's exact same convention.
    const pullsToday = i > 0 && isLearningDay ? plan.newVersesPace : 0;
    cumulativeNewVerses += pullsToday;

    return {
      date,
      isLearningDay,
      isSabbath,
      dueReviews: occurrencesByDateKey.get(date.toDateString()) || [],
      learningCount: baseLearningCount + cumulativeNewVerses,
      newVersesPulled: pullsToday,
    };
  });
}
