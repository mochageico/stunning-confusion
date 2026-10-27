// Day math the review engine schedules with: the user's logical "today",
// Sabbath skipping, weekday anchors, and counting Sabbath/paused days in a
// range. Pure -- no React, no Firestore -- so useAppState, reviewCalendar and
// forecast all share one copy instead of each keeping its own.

// Sabbath support: a plan can designate one weekday as a full day off from
// both learning and review. The engine treats it as not existing for
// scheduling purposes -- due dates never land on it, and time spent on it
// doesn't count as elapsed when detecting silently-missed review cycles.
export const DAY_ABBREVS = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']; // index matches Date.getDay()

export const DAY_FULL_NAMES: Record<string, string> = {
  Su: 'Sundays',
  M: 'Mondays',
  T: 'Tuesdays',
  W: 'Wednesdays',
  Th: 'Thursdays',
  F: 'Fridays',
  S: 'Saturdays',
};

// "What day is it, logically, right now" -- lets a user whose day-start-hour
// is 1am/2am (MemoryPlan.dayStartHour) have their "today" not flip over at
// real midnight. Every place that asks "what day/weekday is it" for
// scheduling or notification-limit purposes should use this instead of a
// bare `new Date()` -- genuine event TIMESTAMPS (createdAt/updatedAt/etc.)
// must keep using real `new Date()`, never this. At dayStartHour=0 (the
// default) this returns exactly `new Date()`, so existing behavior is
// unchanged unless a user opts into a later day-start hour.
export const getLogicalDate = (dayStartHour: number, base: Date = new Date()): Date => {
  if (!dayStartHour) return base;
  return new Date(base.getTime() - dayStartHour * 60 * 60 * 1000);
};

// Days are keyed in LOCAL time, not UTC (toISOString): for anyone west of
// Greenwich, an evening practice session's UTC date is already "tomorrow",
// which would shift the activity grid and break streaks at the day
// boundary. Pure/pair with getLogicalDate -- pass a logical date in, get a
// stable per-logical-day string key out.
export const localDayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const advancePastSabbath = (date: Date, sabbathEnabled: boolean, sabbathDay: string): Date => {
  if (!sabbathEnabled) return date;
  const result = new Date(date);
  while (DAY_ABBREVS[result.getDay()] === sabbathDay) {
    result.setDate(result.getDate() + 1);
  }
  return result;
};

// Finds the next date (today counts) whose day-of-week matches `weekday`,
// then nudges off the Sabbath if it happens to land there. Used by manual
// memory-status overrides to let a batch's weekly/monthly review cycle
// consistently land on a chosen weekday -- a phase's due date always
// recurs by a fixed number of days from wherever it first starts (7 for
// weekly, 30 for monthly), so picking which day the FIRST one lands on is
// all that's needed; no scheduling-engine changes required.
export const nextOccurrenceOfWeekday = (from: Date, weekday: string, sabbathEnabled: boolean, sabbathDay: string): Date => {
  const result = new Date(from);
  result.setHours(0, 0, 0, 0);
  let scanned = 0;
  while (DAY_ABBREVS[result.getDay()] !== weekday && scanned < 7) {
    result.setDate(result.getDate() + 1);
    scanned++;
  }
  return advancePastSabbath(result, sabbathEnabled, sabbathDay);
};

// Chapter review-day anchoring ("Snap-to-Grid" -- see QueueItem.
// chapterReviewAnchorDay in types.ts): the Nth future occurrence of
// `weekday` on/after `from` (n=1 is the very next one). Weekday is
// invariant under a +7 shift, so jumping whole weeks from the first
// occurrence keeps this exactly on the anchor day for any n -- this is what
// lets Monthly reuse the same weekday as Weekly by just asking for n=4.
export const nthOccurrenceOfWeekday = (
  from: Date,
  weekday: string,
  n: number,
  sabbathEnabled: boolean,
  sabbathDay: string
): Date => {
  const first = nextOccurrenceOfWeekday(from, weekday, sabbathEnabled, sabbathDay);
  if (n <= 1) return first;
  const result = new Date(first);
  result.setDate(result.getDate() + (n - 1) * 7);
  return advancePastSabbath(result, sabbathEnabled, sabbathDay);
};

// Shared iteration cap for the day-by-day scans below, so a corrupted or
// mistyped date (e.g. a garbled year from a date picker, or a stale due-date
// far in the past) can't turn a bounded loop into a multi-million-iteration
// scan that hangs the JS thread for a very long time -- past the cap, the
// range is treated as unreasonable and scanning just stops early.
export const MAX_LEARNING_DAY_SCAN = 18250; // ~50 years

export const countSabbathDaysInRange = (from: Date, to: Date, sabbathDay: string): number => {
  let count = 0;
  const cursor = new Date(from);
  cursor.setDate(cursor.getDate() + 1);
  let scanned = 0;
  while (cursor <= to && scanned < MAX_LEARNING_DAY_SCAN) {
    if (DAY_ABBREVS[cursor.getDay()] === sabbathDay) count++;
    cursor.setDate(cursor.getDate() + 1);
    scanned++;
  }
  return count;
};

// Pause support: like Sabbath, but a date range instead of a single weekday
// (see MemoryPlan.pausedAt/pausedUntil in types.ts). Counts the overlap
// between [from, to] and the paused window [pausedAt, pausedUntil] -- an
// open-ended pause (pausedUntil === null) treats every day from pausedAt
// through `to` as paused, so an indefinite pause excludes all elapsed time
// for as long as it's active.
export const countPausedDaysInRange = (from: Date, to: Date, pausedAt: string | null, pausedUntil: string | null): number => {
  if (!pausedAt) return 0;
  const pauseStart = new Date(pausedAt);
  const pauseEnd = pausedUntil ? new Date(pausedUntil) : to;
  const rangeStart = pauseStart > from ? pauseStart : from;
  const rangeEnd = pauseEnd < to ? pauseEnd : to;
  if (rangeStart >= rangeEnd) return 0;
  return Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 3600 * 1000));
};

// Whole days from `from` to `to` that count as scheduled time: Sabbath and
// paused days don't. How overdue a review is, for both the old missed-cycle
// count (missPolicy.ts) and the ladder's late reviews (ladder.ts).
export const scheduledDaysBetween = (
  from: Date,
  to: Date,
  sabbathEnabled: boolean,
  sabbathDay: string,
  pausedAt: string | null,
  pausedUntil: string | null
): number => {
  const rawElapsedDays = Math.floor((to.getTime() - from.getTime()) / (24 * 3600 * 1000));
  const sabbathDaysElapsed = sabbathEnabled ? countSabbathDaysInRange(from, to, sabbathDay) : 0;
  const pausedDaysElapsed = countPausedDaysInRange(from, to, pausedAt, pausedUntil);
  return Math.max(0, rawElapsedDays - sabbathDaysElapsed - pausedDaysElapsed);
};
