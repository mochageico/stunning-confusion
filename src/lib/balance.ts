// "Balance my review days": a passage on Every week or longer can sit a few
// days either side of the day its ladder step lands it on, so no one day gets
// too heavy. Pure, like ladder.ts: nothing here reads React state or Firestore.
//
// - The window grows with the step (a day is 14% of a week, under 4% of four
//   weeks), so a shift never costs real spacing and is never a missed review
//   (lateness is free for less than one interval). Every day / 2 days / 4 days
//   never move.
// - A shifted passage keeps `scheduledDue`, the day its step landed it on. The
//   next due date counts from that day when the review was done ahead of it,
//   so an early review can't pull the weekly weekday forward.
// - A review inside the window counts, not only on the due day.
// - Leveling only moves a passage off its day when that day would run past the
//   daily review limit, and only to a lighter day. Nothing moves otherwise.
import type { QueueItem } from '../types';
import { DAY_ABBREVS, getLogicalDate, localDayKey } from './logicalDate';
import { REVIEW_SECONDS_PER_VERSE, type ReviewClock } from './retention';
import { isDayPaused } from './reviewCalendar';

/** Days either side of its scheduled day, by ladder step (Every day .. Every 6 months). */
export const BALANCE_WINDOW: readonly number[] = [0, 0, 0, 1, 1, 2, 3, 7];

export const balanceWindow = (step: number): number => BALANCE_WINDOW[Math.min(Math.max(Math.round(step), 0), BALANCE_WINDOW.length - 1)];

/** Present on a settings object = "Balance my review days" is on. */
export interface BalanceSettings {
  /** The daily review time limit, in minutes. */
  capMinutes: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local noon of a day key. */
const keyDate = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

const shiftDays = (d: Date, n: number): Date => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

/** Seconds of review due on each day (a day key), leaving out the verses in `skip`. */
export const dayLoads = (queue: readonly QueueItem[], skip: ReadonlySet<string> = new Set()): Map<string, number> => {
  const loads = new Map<string, number>();
  for (const q of queue) {
    if (q.status !== 'reviewing' || !q.nextReviewDueDate || skip.has(q.verseId)) continue;
    const k = localDayKey(new Date(q.nextReviewDueDate));
    loads.set(k, (loads.get(k) ?? 0) + REVIEW_SECONDS_PER_VERSE);
  }
  return loads;
};

/**
 * Where a passage's next review should sit. `anchor` is the day its step
 * landed it on. Stays there unless that day would run past the limit; then
 * the lightest day inside the window that is lighter than the anchor (nearest
 * the anchor on a tie, a later day before an earlier one). Never today or
 * earlier, a Sabbath, or a paused day.
 */
export const levelDue = (a: {
  anchor: string;
  step: number;
  verses: number;
  loads: ReadonlyMap<string, number>;
  capMinutes: number;
  clock: ReviewClock;
  now: Date;
}): { due: string; scheduledDue?: string } => {
  const w = balanceWindow(a.step);
  const stay = { due: a.anchor };
  if (w === 0 || !(a.capMinutes > 0)) return stay;
  const cap = a.capMinutes * 60;
  const cost = a.verses * REVIEW_SECONDS_PER_VERSE;
  const anchorDate = new Date(a.anchor);
  const anchorLoad = a.loads.get(localDayKey(anchorDate)) ?? 0;
  if (anchorLoad + cost <= cap) return stay;

  const todayKey = localDayKey(getLogicalDate(a.clock.dayStartHour, a.now));
  let best: { date: Date; load: number; dist: number; k: number } | null = null;
  for (let k = -w; k <= w; k++) {
    if (k === 0) continue;
    const date = shiftDays(anchorDate, k);
    const key = localDayKey(date);
    if (key <= todayKey) continue;
    if (a.clock.sabbathEnabled && DAY_ABBREVS[date.getDay()] === a.clock.sabbathDay) continue;
    if (isDayPaused(date, false, a.clock.pausedAt, a.clock.pausedUntil)) continue;
    const load = a.loads.get(key) ?? 0;
    if (load >= anchorLoad) continue;
    const dist = Math.abs(k);
    if (!best || load < best.load || (load === best.load && (dist < best.dist || (dist === best.dist && k > best.k)))) {
      best = { date, load, dist, k };
    }
  }
  return best ? { due: best.date.toISOString(), scheduledDue: a.anchor } : stay;
};

type Scheduled = Pick<QueueItem, 'nextReviewDueDate' | 'scheduledDue' | 'ladderStep'>;

/**
 * The day this passage's current review was scheduled for (a day key): its
 * `scheduledDue` when that is a real shift (inside the window of the due
 * date), otherwise the due date itself. Null with no due date.
 */
export const scheduledDayOf = (item: Scheduled): string | null => {
  if (!item.nextReviewDueDate) return null;
  const dueKey = localDayKey(new Date(item.nextReviewDueDate));
  if (!item.scheduledDue) return dueKey;
  const schedKey = localDayKey(new Date(item.scheduledDue));
  const apart = Math.abs(Math.round((keyDate(schedKey).getTime() - keyDate(dueKey).getTime()) / DAY_MS));
  return apart <= balanceWindow(item.ladderStep ?? 0) ? schedKey : dueKey;
};

/** The first day this review counts: its scheduled day less the window. Null while it has no window. */
export const earliestCreditDay = (item: Scheduled): string | null => {
  const w = balanceWindow(item.ladderStep ?? 0);
  const sched = scheduledDayOf(item);
  if (w === 0 || !sched) return null;
  return localDayKey(shiftDays(keyDate(sched), -w));
};

/** A review done today falls inside the window ahead of its scheduled day (not yet due, but it counts). */
export const creditsEarly = (item: Scheduled, todayKey: string): boolean => {
  const first = earliestCreditDay(item);
  return first !== null && first <= todayKey;
};
