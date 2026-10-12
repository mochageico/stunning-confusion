import { QueueItem } from '../types';
import { computeDailyPull } from './groupPlanScheduler';
import { CalendarPlanSettings, isDayPaused } from './reviewCalendar';
import { STAGE_ORDER, StagePlan, VerseStage, roadEstimates, stageCounts, verseStage } from './stageProgress';

// ============================================================================
// LOOKING AHEAD
// ----------------------------------------------------------------------------
// Where the verses already on your list will be at a future date: the time
// switch on My Verses' strip, and each chapter's "all learned" date on By book.
//
// Two promises, both stated in the UI:
//   - only verses already on the list. It never assumes you'll add more.
//   - every review goes well, the same assumption the Memory Calendar makes.
//
// Waiting verses start when the real daily pull would start them. That pull
// is simulated with computeDailyPull, day by day, exactly as
// getMemoryCalendarProjection does it (learning days, Sabbath, Pause Reviews,
// group plans' weekly budgets), so the calendar and this forecast agree.
// ============================================================================

export type ForecastPlan = StagePlan & CalendarPlanSettings;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_ABBREVS = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']; // index matches Date.getDay()
/** Far enough for a long Waiting list; past it a verse counts as "not started in the window". */
export const PULL_WINDOW_DAYS = 2 * 365;

const startOfDay = (d: Date) => {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/**
 * The day each waiting verse would start learning, in pull order. A verse
 * missing from the map doesn't start within the window (no learning days, a
 * pace of 0, an open-ended pause, or a list longer than two years of pulls).
 */
export function projectStartDates(queue: QueueItem[], plan: CalendarPlanSettings, today: Date = new Date()): Map<string, Date> {
  const out = new Map<string, Date>();
  const day0 = startOfDay(today);
  let simQueue = queue;
  let remaining = queue.filter((q) => q.status === 'queued').length;
  if (remaining === 0 || plan.learningDays.length === 0) return out;

  for (let i = 1; i <= PULL_WINDOW_DAYS && remaining > 0; i++) {
    const date = addDays(day0, i);
    const abbrev = DAY_ABBREVS[date.getDay()];
    const isSabbath = plan.sabbathEnabled && abbrev === plan.sabbathDay;
    if (isSabbath || !plan.learningDays.includes(abbrev)) continue;
    if (isDayPaused(date, false, plan.pausedAt, plan.pausedUntil)) continue;

    const { verseIds } = computeDailyPull(
      simQueue,
      { newVersesPace: plan.newVersesPace, learningDays: plan.learningDays },
      plan.joinedPlans || [],
      plan.memberships || [],
      date
    );
    if (verseIds.length === 0) continue;
    const pulled = new Set(verseIds);
    const iso = date.toISOString();
    simQueue = simQueue.map((q) => (pulled.has(q.verseId) ? { ...q, status: 'learning' as const, dateStarted: iso } : q));
    for (const id of verseIds) out.set(id, date);
    remaining -= verseIds.length;
  }
  return out;
}

/** Rough length of a whole stage, matching stageProgress's road estimates. */
const stageLengthDays = (stage: VerseStage, plan: StagePlan): number => {
  if (stage === 'daily') return plan.dailyPhaseWeeks * 7;
  if (stage === 'weekly') return Math.round(plan.weeklyPhaseMonths * (365 / 12));
  if (stage === 'monthly') return Math.round(plan.monthlyPhaseYears * 365);
  return 0;
};

/**
 * When the verse reaches each stop still ahead of it. A waiting verse follows
 * the whole road from its projected start: Learning that day, Daily the next
 * (practices only need an hour between them), then each stage's full length.
 */
export function futureArrivals(item: QueueItem, plan: StagePlan, startDate: Date | undefined, today: Date = new Date()): Partial<Record<VerseStage, Date>> {
  if (item.status !== 'queued') return roadEstimates(item, plan, today);
  if (!startDate) return {};
  const out: Partial<Record<VerseStage, Date>> = { learning: startDate };
  let cursor = addDays(startDate, 1);
  for (const stage of ['daily', 'weekly', 'monthly', 'complete'] as VerseStage[]) {
    out[stage] = cursor;
    cursor = addDays(cursor, stageLengthDays(stage, plan));
  }
  return out;
}

/** The stage a verse will be in on `date`, if every review goes well. */
export function stageOn(item: QueueItem, plan: StagePlan, date: Date, startDate: Date | undefined, today: Date = new Date()): VerseStage {
  let stage = verseStage(item);
  const arrivals = futureArrivals(item, plan, startDate, today);
  for (const s of STAGE_ORDER) {
    const at = arrivals[s];
    if (at && at.getTime() <= date.getTime() && STAGE_ORDER.indexOf(s) > STAGE_ORDER.indexOf(stage)) stage = s;
  }
  return stage;
}

/** Verse counts per stage on `date`. Today's date gives today's counts. */
export function forecastCounts(
  queue: QueueItem[],
  plan: ForecastPlan,
  date: Date,
  starts: Map<string, Date>,
  today: Date = new Date()
): Record<VerseStage, number> {
  if (date.getTime() <= today.getTime()) return stageCounts(queue);
  const out: Record<VerseStage, number> = { waiting: 0, learning: 0, daily: 0, weekly: 0, monthly: 0, complete: 0 };
  for (const item of queue) out[stageOn(item, plan, date, starts.get(item.verseId), today)]++;
  return out;
}

/** Learned means past Learning: in review or Complete. */
export const learnedCount = (c: Record<VerseStage, number>) => c.daily + c.weekly + c.monthly + c.complete;

/**
 * When every one of these verses (say, a chapter's) will be learned. 'done'
 * when they all already are; null when one of them doesn't start in the window.
 */
export function allLearnedBy(items: QueueItem[], plan: StagePlan, starts: Map<string, Date>, today: Date = new Date()): Date | 'done' | null {
  let last: Date | null = null;
  for (const item of items) {
    const stage = verseStage(item);
    if (stage !== 'waiting' && stage !== 'learning') continue;
    const daily = futureArrivals(item, plan, starts.get(item.verseId), today).daily;
    if (!daily) return null;
    if (!last || daily.getTime() > last.getTime()) last = daily;
  }
  return last ?? 'done';
}

export type Horizon = 'now' | 'm1' | 'm3' | 'y1';

export const HORIZON_LABEL: Record<Horizon, string> = { now: 'Now', m1: '1 month', m3: '3 months', y1: '1 year' };

export function horizonDate(h: Horizon, today: Date = new Date()): Date {
  const d = new Date(today);
  if (h === 'm1') d.setMonth(d.getMonth() + 1);
  if (h === 'm3') d.setMonth(d.getMonth() + 3);
  if (h === 'y1') d.setFullYear(d.getFullYear() + 1);
  return d;
}
