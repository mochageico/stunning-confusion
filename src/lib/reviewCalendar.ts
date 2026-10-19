import { QueueItem, GroupPlan, GroupPlanMembership } from '../types';
import { computeDailyPull } from './groupPlanScheduler';
import { advancePastSabbath, DAY_ABBREVS, nthOccurrenceOfWeekday } from './logicalDate';

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
  // Joined group plans, so the projection matches what the real pull will
  // do. Without these the calendar assumed every learning day pulls exactly
  // newVersesPace of your own verses, which is wrong for anyone in a study
  // plan and badly wrong on an 'additive' membership, where the real pull
  // deliberately exceeds the personal pace. Optional: callers with no group
  // plans (and the layout lab) can leave them out.
  joinedPlans?: GroupPlan[];
  memberships?: GroupPlanMembership[];
  // Settings -> Pause Reviews. A paused day has no reviews and no pull, and
  // anything that came due during the pause lands on the first day back --
  // the real engine never moves a due date for a pause, it just stops
  // treating it as due (see isPauseInEffect).
  pausedAt?: string | null;
  pausedUntil?: string | null;
}

/**
 * Whether Pause Reviews is in effect at `at`. An indefinite pause (pausedUntil
 * null) lasts until resumed manually; a dated one ends at its pausedUntil
 * instant. The one definition Home, the time estimate, the calendar and
 * Listen all share, so none of them can show reviews the others hide.
 */
export function isPauseInEffect(pausedAt: string | null | undefined, pausedUntil: string | null | undefined, at: Date = new Date()): boolean {
  if (!pausedAt) return false;
  return !pausedUntil || new Date(pausedUntil) > at;
}

/**
 * Whether a whole calendar day counts as paused. Today follows the pause
 * exactly as it stands right now (matching Home); a future day is paused
 * only if the pause still holds at its end, so the day you come back on
 * shows its reviews.
 */
export function isDayPaused(date: Date, isToday: boolean, pausedAt: string | null | undefined, pausedUntil: string | null | undefined): boolean {
  if (isToday) return isPauseInEffect(pausedAt, pausedUntil);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return isPauseInEffect(pausedAt, pausedUntil, endOfDay);
}

export interface CalendarDayProjection {
  date: Date;
  isLearningDay: boolean;
  isSabbath: boolean;
  /** Verses projected due this day, with the phase they'd be reviewed in. */
  dueReviews: { item: QueueItem; phase: RetentionPhase }[];
  /** Flat ongoing Learning-phase count -- not date-scheduled, same value every day (see module doc on HomeScreen/getMemoryLoadForecast for why). */
  learningCount: number;
  /** New verses projected to be pulled into Learning this day. */
  newVersesPulled: number;
  /**
   * WHICH verses that pull would take, in pull order. Previously this was a
   * count only, on the grounds that the specific verses depend on queue
   * order at pull time -- but the pull is deterministic given queue order
   * and the scheduler, so running the real computeDailyPull forward names
   * them exactly.
   */
  newVerseItems: QueueItem[];
}

const addDays = (date: Date, days: number, sabbathEnabled: boolean, sabbathDay: string): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
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

  const pausedByIndex = Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    return isDayPaused(date, i === 0, plan.pausedAt, plan.pausedUntil);
  });
  // Reviews start from the first unpaused day in the window: anything due
  // before then (overdue, or due mid-pause) is due that day instead. No
  // unpaused day at all (an open-ended pause) means no reviews to show.
  const firstActiveIndex = pausedByIndex.indexOf(false);
  const firstActiveDay = new Date(today);
  firstActiveDay.setDate(firstActiveDay.getDate() + Math.max(firstActiveIndex, 0));

  // Precompute every reviewing item's occurrences once, then bucket by date
  // -- cheaper than re-scanning all items for every single day.
  const occurrencesByDateKey = new Map<string, { item: QueueItem; phase: RetentionPhase }[]>();
  (firstActiveIndex === -1 ? [] : reviewingItems).forEach((item) => {
    projectItemOccurrences(item, plan, queue, firstActiveDay, windowEnd).forEach(({ date, phase }) => {
      const key = date.toDateString();
      const bucket = occurrencesByDateKey.get(key) || [];
      bucket.push({ item, phase });
      occurrencesByDateKey.set(key, bucket);
    });
  });

  // Forward simulation of the real daily pull. `simQueue` starts as the
  // actual queue and is mutated day by day exactly as triggerDailyPull would
  // mutate it (status -> 'learning', dateStarted set), so each subsequent
  // day's computeDailyPull sees a truthful history. That history matters:
  // a plan's remaining weekly budget is derived from what was pulled in the
  // previous 7 days, so a naive per-day call would let every plan re-spend
  // its full weekly allowance every single learning day.
  const byId = new Map(queue.map((item) => [item.verseId, item]));
  let simQueue = queue;

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
    // A paused day pulls nothing either -- triggerDailyPull refuses to.
    let newVerseItems: QueueItem[] = [];
    if (i > 0 && isLearningDay && !pausedByIndex[i]) {
      const { verseIds } = computeDailyPull(
        simQueue,
        { newVersesPace: plan.newVersesPace, learningDays: plan.learningDays },
        plan.joinedPlans || [],
        plan.memberships || [],
        date
      );
      newVerseItems = verseIds.map((id) => byId.get(id)).filter((item): item is QueueItem => !!item);

      if (verseIds.length > 0) {
        const pulled = new Set(verseIds);
        const startedISO = date.toISOString();
        simQueue = simQueue.map((item) =>
          pulled.has(item.verseId) ? { ...item, status: 'learning' as const, dateStarted: startedISO } : item
        );
      }
    }
    cumulativeNewVerses += newVerseItems.length;

    return {
      date,
      isLearningDay,
      isSabbath,
      dueReviews: occurrencesByDateKey.get(date.toDateString()) || [],
      learningCount: baseLearningCount + cumulativeNewVerses,
      newVersesPulled: newVerseItems.length,
      newVerseItems,
    };
  });
}
