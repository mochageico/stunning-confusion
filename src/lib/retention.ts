// The review engine's pure scheduling math: when a verse is due, the next
// due date after a cycle, whether a touch is spaced far enough apart, and how
// long a day's practice is expected to take. useAppState wraps these with the
// active plan's settings; nothing here reads React state or Firestore.
import type { QueueItem } from '../types';
import { isDayPaused } from './reviewCalendar';
import { advancePastSabbath, DAY_ABBREVS, getLogicalDate, nthOccurrenceOfWeekday } from './logicalDate';

/** The active plan's settings that move due dates around. */
export interface ReviewClock {
  dayStartHour: number;
  sabbathEnabled: boolean;
  sabbathDay: string;
  pausedAt: string | null;
  pausedUntil: string | null;
}

export type LoadSensitivity = 'low' | 'medium' | 'high';

// Due-ness is calendar-day granularity, not exact-clock-time -- a review
// whose nextReviewDueDate falls anywhere on today's calendar date is due
// NOW, not only once the clock reaches that same time-of-day. Reviews are
// never day-gated (see project philosophy); comparing exact timestamps
// silently reintroduced a day-boundary-like gate (a verse graduated at
// 9pm wouldn't show as due again until 9pm the next day), which is what
// caused Home's Due Reviews to disagree with the Memory Calendar (which
// already compared by date, not exact time). Also treats any date whose
// day has already fully passed as due, matching the old "overdue" case.
export function isReviewDue(dueDateISO: string | null | undefined, referenceDate: Date = new Date()): boolean {
  if (!dueDateISO) return true;
  const due = new Date(dueDateISO);
  return due.toDateString() === referenceDate.toDateString() || due.getTime() < referenceDate.getTime();
}

// Has any OTHER verse of this book+chapter already established a shared
// review-anchor weekday? Undefined if no chunk of this chapter has ever
// graduated out of Daily review.
export const findChapterReviewAnchor = (book: string, chapter: number, queue: QueueItem[]): string | undefined =>
  queue.find((q) => q.book === book && q.chapter === chapter && q.chapterReviewAnchorDay)?.chapterReviewAnchorDay;

// setDate + sabbath-adjustment + toISOString for the many places
// handleReviewCompleted schedules a next-due date, so a sabbath day never
// ends up as a scheduled due date.
export const nextDueDateISO = (days: number, clock: ReviewClock, now: Date = new Date()): string => {
  const d = getLogicalDate(clock.dayStartHour, now);
  // getLogicalDate hands back `now` itself at dayStartHour 0 -- copy before
  // moving it so a caller's date is never changed underneath it.
  const shifted = new Date(d);
  shifted.setDate(shifted.getDate() + days);
  return advancePastSabbath(shifted, clock.sabbathEnabled, clock.sabbathDay).toISOString();
};

/** A learning touch only counts if the last one was at least an hour ago. */
export const isTouchSpaced = (item: QueueItem, now: number = Date.now()): boolean => {
  if (!item.touchLogs || item.touchLogs.length === 0) return true;
  const lastTouch = item.touchLogs[item.touchLogs.length - 1];
  const lastTime = new Date(lastTouch.timestamp).getTime();
  const ONE_HOUR = 60 * 60 * 1000;
  return now - lastTime >= ONE_HOUR;
};

// A quick spaced-repetition review (you already know the verse, you're
// just confirming recall) is fast -- flat per-verse, not tiered by phase.
// A fresh Learning-phase touch is real, unhurried practice, so it costs
// much more per verse. (2026-07: the old 30/45/60s daily/weekly/monthly
// tiering plus 120s/learning verse was making the estimate feel wildly
// inflated in practice -- simplified to these two flat numbers, then
// trimmed again from 25s/180s after the estimate still read long against
// real practice sessions.)
export const REVIEW_SECONDS_PER_VERSE = 15;
export const LEARNING_SECONDS_PER_VERSE = 90;

const sensitivityMultiplier = (sensitivity: LoadSensitivity) =>
  sensitivity === 'low' ? 0.75 : sensitivity === 'high' ? 1.5 : 1.0;

// Shared by estimateReviewMinutes (today only) and forecastMemoryLoad
// (today + future days), so both always price a "due review" the same
// way and never quietly disagree. For today, a missing due date or one
// whose calendar day is today-or-earlier counts as due; for a future day,
// only an exact due-date match counts.
export const computeDayReviewLoad = (
  queue: QueueItem[],
  date: Date,
  isToday: boolean,
  pausedAt: string | null,
  pausedUntil: string | null
) => {
  let seconds = 0;
  let count = 0;
  // Nothing is due while reviews are paused, so a paused day costs nothing
  // -- the same rule Home's review list and the calendar follow.
  if (isDayPaused(date, isToday, pausedAt, pausedUntil)) return { seconds, count };
  queue.forEach((item) => {
    if (item.status !== 'reviewing') return;
    const due = item.nextReviewDueDate ? new Date(item.nextReviewDueDate) : null;
    const isDue = isToday ? isReviewDue(item.nextReviewDueDate, date) : !!due && due.toDateString() === date.toDateString();
    if (!isDue) return;
    count += 1;
    seconds += REVIEW_SECONDS_PER_VERSE;
  });
  return { seconds, count };
};

/** Minutes today's learning + due reviews are expected to take. */
export const estimateReviewMinutes = (
  queue: QueueItem[],
  sensitivity: LoadSensitivity,
  clock: Pick<ReviewClock, 'dayStartHour' | 'pausedAt' | 'pausedUntil'>,
  now: Date = new Date()
) => {
  const learningSeconds = queue.filter((item) => item.status === 'learning').length * LEARNING_SECONDS_PER_VERSE;
  const { seconds: reviewSeconds } = computeDayReviewLoad(
    queue,
    getLogicalDate(clock.dayStartHour, now),
    true,
    clock.pausedAt,
    clock.pausedUntil
  );
  return Math.ceil(((learningSeconds + reviewSeconds) * sensitivityMultiplier(sensitivity)) / 60);
};

// Projects daily memorization workload for the next `days` days, sharing
// computeDayReviewLoad's math with estimateReviewMinutes so "today" here
// always matches Home's real today-estimate, and using the plan's actual
// learningDays instead of a fake "every other day" guess. Learning-phase
// items are treated as an ongoing cost that doesn't shrink (this doesn't
// simulate future mastery graduations); verses newly pulled on a future
// learning day join that ongoing cost starting the day they're pulled.
export const forecastMemoryLoad = (
  queue: QueueItem[],
  sensitivity: LoadSensitivity,
  learningDaysList: string[],
  pace: number,
  days: number,
  clock: Pick<ReviewClock, 'dayStartHour' | 'pausedAt' | 'pausedUntil'>,
  now: Date = new Date()
) => {
  const baseLearningCount = queue.filter((item) => item.status === 'learning').length;
  const multiplier = sensitivityMultiplier(sensitivity);
  let cumulativeNewVerses = 0;

  return Array.from({ length: days }, (_, i) => {
    const date = new Date(getLogicalDate(clock.dayStartHour, now));
    date.setDate(date.getDate() + i);
    const isLearnDay = learningDaysList.includes(DAY_ABBREVS[date.getDay()]);
    // Today's own pull, if any, is already reflected in the real queue
    // (baseLearningCount) -- only project pulls for days after today.
    if (i > 0 && isLearnDay) cumulativeNewVerses += pace;

    const { seconds: reviewSeconds, count: dueReviewCount } = computeDayReviewLoad(
      queue,
      date,
      i === 0,
      clock.pausedAt,
      clock.pausedUntil
    );
    const learningCount = baseLearningCount + cumulativeNewVerses;
    const loadMins = Math.ceil(((reviewSeconds + learningCount * LEARNING_SECONDS_PER_VERSE) * multiplier) / 60);

    return { date, isLearnDay, loadMins, versesCount: learningCount + dueReviewCount };
  });
};
