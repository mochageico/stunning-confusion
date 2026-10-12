import { QueueItem, ReviewLog } from '../types';
import { ALL_BIBLE_BOOKS } from '../data';

// ============================================================================
// WHERE EACH VERSE IS ON THE ROAD
// ----------------------------------------------------------------------------
// Pure logic behind My Verses' stage list, the road, and the verse page: which
// stage a verse is in, how far through that stage it is, and roughly when it
// moves up. Thresholds are copied from handleReviewCompleted's success path in
// useAppState.ts (the same numbers reviewCalendar.ts copies), so "Week 3 of 7"
// here and the engine's own promotion never disagree.
//
// Every date ahead is an estimate that assumes each review goes well -- the
// same promise the Memory Calendar makes. Sabbath skips and chapter anchor
// days can move the real date by a few days; the copy says "about" for that.
// ============================================================================

export type VerseStage = 'waiting' | 'learning' | 'daily' | 'weekly' | 'monthly' | 'complete';

export const STAGE_ORDER: VerseStage[] = ['waiting', 'learning', 'daily', 'weekly', 'monthly', 'complete'];

export const STAGE_LABEL: Record<VerseStage, string> = {
  waiting: 'Waiting',
  learning: 'Learning',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  complete: 'Complete',
};

export interface StagePlan {
  dailyPhaseWeeks: number;
  weeklyPhaseMonths: number;
  monthlyPhaseYears: number;
  masteryTouches: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/** Monthly reviews land on the 4th occurrence of the anchor weekday, so a "month" is 28 days. */
const CYCLE_DAYS: Record<'daily' | 'weekly' | 'monthly', number> = { daily: 1, weekly: 7, monthly: 28 };

export const verseStage = (item: QueueItem): VerseStage => {
  if (item.status === 'retained') return 'complete';
  if (item.status === 'queued') return 'waiting';
  if (item.status === 'learning' || item.retentionPhase === 'none') return 'learning';
  // A verse on a refresher is shown in the stage it will return to: the
  // refresher is a detour, not a step back down the road.
  if (item.refresherActive && item.refresherReturnPhase) return item.refresherReturnPhase;
  return item.retentionPhase;
};

/** Review counts that move a verse out of each stage (engine thresholds). */
export const stageTargets = (plan: StagePlan, dailyExtensionDays = 0) => ({
  daily: plan.dailyPhaseWeeks * 7 + dailyExtensionDays,
  weekly: Math.round(plan.weeklyPhaseMonths * (52 / 12)),
  monthly: plan.monthlyPhaseYears * 12,
});

export interface StageProgress {
  stage: VerseStage;
  /** How far through the current stage, 0-1. */
  fraction: number;
  /** "Week 3 of 7", "Month 5 of 6", "Year 2 of 5", "2 of 3 practices". Empty for waiting/complete. */
  position: string;
  /** Good reviews (or practices) still needed before it moves up. */
  remaining: number;
  /** Estimated day it moves up, if every review goes well. Null when unknown or on hold. */
  movesUpOn: Date | null;
  /** Set while a missed review has it on a refresher. Its place in `stage` is kept, not lost. */
  refresher: { remaining: number; unit: 'day' | 'week'; via: 'daily' | 'weekly' } | null;
  /** Arrived in this stage recently (within its first cycle, or the last 7 days for Daily). */
  justMovedUp: boolean;
  /** Learning only: practices banked out of those needed, for the dots. */
  steps?: { done: number; total: number };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Where a reviewing verse sits inside daily/weekly/monthly, given its streak there. */
function positionIn(phase: 'daily' | 'weekly' | 'monthly', streak: number, plan: StagePlan, dailyExtensionDays: number) {
  const target = stageTargets(plan, dailyExtensionDays)[phase];
  const done = clamp(streak, 0, target);
  const fraction = target > 0 ? done / target : 0;
  let position: string;
  if (phase === 'daily') {
    const weeks = Math.max(1, Math.ceil(target / 7));
    position = `Week ${clamp(Math.ceil(done / 7), 1, weeks)} of ${weeks}`;
  } else if (phase === 'weekly') {
    const months = Math.max(1, plan.weeklyPhaseMonths);
    position = `Month ${clamp(Math.ceil((done * months) / Math.max(1, target)), 1, months)} of ${months}`;
  } else {
    const years = Math.max(1, plan.monthlyPhaseYears);
    position = `Year ${clamp(Math.ceil(done / 12), 1, years)} of ${years}`;
  }
  return { target, fraction, position, remaining: Math.max(0, target - streak) };
}

export function stageProgress(item: QueueItem, plan: StagePlan, today: Date = new Date()): StageProgress {
  const stage = verseStage(item);
  const base: StageProgress = { stage, fraction: 0, position: '', remaining: 0, movesUpOn: null, refresher: null, justMovedUp: false };

  if (stage === 'waiting') return base;
  if (stage === 'complete') return { ...base, fraction: 1 };

  if (stage === 'learning') {
    const total = Math.max(1, plan.masteryTouches);
    const done = clamp(item.touchLogs?.length || 0, 0, total);
    return {
      ...base,
      fraction: done / total,
      position: `${done} of ${total} ${total === 1 ? 'practice' : 'practices'}`,
      remaining: total - done,
      steps: { done, total },
    };
  }

  const next = item.nextReviewDueDate ? new Date(item.nextReviewDueDate) : null;

  if (item.refresherActive && item.refresherReturnPhase) {
    const held = positionIn(stage as 'weekly' | 'monthly', item.refresherReturnProgress || 1, plan, 0);
    const via = item.refresherReturnPhase === 'monthly' ? 'weekly' : 'daily';
    return {
      ...base,
      fraction: held.fraction,
      position: held.position,
      remaining: held.remaining,
      refresher: {
        remaining: Math.max(0, (item.refresherTargetUnits || 1) - item.currentStreakCount),
        unit: via === 'weekly' ? 'week' : 'day',
        via,
      },
    };
  }

  const phase = stage as 'daily' | 'weekly' | 'monthly';
  const p = positionIn(phase, item.currentStreakCount, plan, item.dailyPhaseExtensionDays || 0);
  // The review that brings the streak up to target is the one that moves it
  // up, so it lands (remaining - 1) cycles after the next due date.
  const movesUpOn = next && p.remaining > 0 ? addDays(next, (p.remaining - 1) * CYCLE_DAYS[phase]) : null;
  const justMovedUp =
    phase === 'daily'
      ? !!item.dateStarted && today.getTime() - new Date(item.dateStarted).getTime() < 7 * DAY_MS
      : item.currentStreakCount <= 1;

  return { ...base, fraction: p.fraction, position: p.position, remaining: p.remaining, movesUpOn, justMovedUp };
}

/** Rough length of a whole stage, for estimating the stops after the next one. */
const stageLengthDays = (stage: VerseStage, plan: StagePlan): number => {
  if (stage === 'daily') return plan.dailyPhaseWeeks * 7;
  if (stage === 'weekly') return Math.round(plan.weeklyPhaseMonths * (365 / 12));
  if (stage === 'monthly') return Math.round(plan.monthlyPhaseYears * 365);
  return 0;
};

/**
 * Estimated arrival at each stop still ahead of the verse, if every review
 * goes well. Waiting verses get none: nothing is scheduled until they start.
 */
export function roadEstimates(item: QueueItem, plan: StagePlan, today: Date = new Date()): Partial<Record<VerseStage, Date>> {
  const progress = stageProgress(item, plan, today);
  const out: Partial<Record<VerseStage, Date>> = {};
  if (progress.stage === 'waiting' || progress.stage === 'complete') return out;

  let cursor: Date | null;
  if (progress.stage === 'learning') {
    // Practices only need an hour between them, so Daily is a day or so away.
    cursor = addDays(today, progress.remaining > 0 ? 1 : 0);
  } else if (progress.refresher) {
    const unitDays = progress.refresher.unit === 'week' ? 7 : 1;
    const back = addDays(today, progress.refresher.remaining * unitDays);
    cursor = addDays(back, progress.remaining * CYCLE_DAYS[progress.stage as 'weekly' | 'monthly']);
  } else {
    cursor = progress.movesUpOn;
  }
  if (!cursor) return out;

  const ahead = STAGE_ORDER.slice(STAGE_ORDER.indexOf(progress.stage) + 1);
  for (const stage of ahead) {
    out[stage] = cursor;
    cursor = addDays(cursor, stageLengthDays(stage, plan));
  }
  return out;
}

const LOG_STAGE: Record<ReviewLog['stage'], VerseStage> = {
  learning: 'learning',
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  retained: 'complete',
};

/**
 * When the verse reached each stop it has passed, read from its review log.
 * The log only goes back to 2026-09-26, so older verses have gaps -- a stop
 * with no entry here simply shows no date.
 */
export function arrivalDates(item: QueueItem): Partial<Record<VerseStage, Date>> {
  const out: Partial<Record<VerseStage, Date>> = {};
  const rank = (s: VerseStage) => STAGE_ORDER.indexOf(s);
  let prev: ReviewLog | null = null;
  for (const log of item.reviewLogs || []) {
    if (log.refresher) continue;
    const stage = LOG_STAGE[log.stage];
    if (log.result === 'placed') {
      out[stage] = new Date(log.at);
    } else if (!prev) {
      // The first entry only marks an arrival when it's the very start.
      if (stage === 'learning') out.learning = new Date(log.at);
    } else if (rank(stage) > rank(LOG_STAGE[prev.stage])) {
      // The review that moved it up was the last one in the stage before.
      out[stage] = new Date(prev.at);
    }
    prev = log;
  }
  const current = verseStage(item);
  if (prev && rank(current) > rank(LOG_STAGE[prev.stage]) && !out[current]) out[current] = new Date(prev.at);
  // Moving up to Daily stamps dateStarted, which predates the log for older verses.
  if (!out.daily && item.dateStarted && rank(current) >= rank('daily')) out.daily = new Date(item.dateStarted);
  return out;
}

// ----------------------------------------------------------------------------
// Grouping for the lists
// ----------------------------------------------------------------------------

export interface StageGroup {
  key: string;
  book: string;
  chapter: number;
  verses: number[];
  translationId: string;
  items: QueueItem[];
  progress: StageProgress;
}

const BOOK_INDEX = new Map(ALL_BIBLE_BOOKS.map((b, i) => [b.name.toLowerCase(), i]));
export const bookIndex = (book: string) => BOOK_INDEX.get(book.toLowerCase()) ?? 999;

export const canonicalCompare = (a: QueueItem, b: QueueItem) =>
  bookIndex(a.book) - bookIndex(b.book) ||
  a.chapter - b.chapter ||
  a.verseNumber - b.verseNumber ||
  (a.translationId || '').localeCompare(b.translationId || '');

/** Two neighbouring verses share a row only when nothing about their progress differs. */
const progressSignature = (p: StageProgress, item: QueueItem) =>
  [p.stage, p.position, p.remaining, p.refresher ? `r${p.refresher.remaining}` : '', item.nextReviewDueDate?.slice(0, 10) ?? '', item.origin || 'individual'].join('|');

export const referenceFor = (book: string, chapter: number, verses: number[]) =>
  `${book} ${chapter}:${verses[0]}${verses.length > 1 ? `-${verses[verses.length - 1]}` : ''}`;

/**
 * Every verse except Waiting ones (My Verses keeps its own drag-to-reorder
 * list for those), grouped into runs of neighbouring verses at the same point
 * on the road, then bucketed by stage. Review stages list the verse closest to
 * moving up first; Learning keeps queue order; Complete reads in Bible order.
 */
export function groupByStage(queue: QueueItem[], plan: StagePlan, today: Date = new Date()): Record<VerseStage, StageGroup[]> {
  const out: Record<VerseStage, StageGroup[]> = { waiting: [], learning: [], daily: [], weekly: [], monthly: [], complete: [] };
  const sorted = queue.filter((i) => i.status !== 'queued').sort(canonicalCompare);

  let current: StageGroup | null = null;
  let currentSig = '';
  for (const item of sorted) {
    const progress = stageProgress(item, plan, today);
    const sig = progressSignature(progress, item);
    const translationId = item.translationId || 'ESV';
    const last = current?.items[current.items.length - 1];
    const joins =
      current &&
      last &&
      sig === currentSig &&
      item.book === last.book &&
      item.chapter === last.chapter &&
      translationId === current.translationId &&
      item.verseNumber === last.verseNumber + 1;
    if (joins && current) {
      current.verses.push(item.verseNumber);
      current.items.push(item);
    } else {
      current = {
        key: `${translationId}_${item.book}_${item.chapter}_${item.verseNumber}`,
        book: item.book,
        chapter: item.chapter,
        verses: [item.verseNumber],
        translationId,
        items: [item],
        progress,
      };
      currentSig = sig;
      out[progress.stage].push(current);
    }
  }

  const minOrder = (g: StageGroup) => Math.min(...g.items.map((i) => i.orderIndex));
  out.learning.sort((a, b) => minOrder(a) - minOrder(b));
  for (const stage of ['daily', 'weekly', 'monthly'] as const) {
    // Refreshers last within their stage: they aren't moving up until they're back.
    out[stage].sort((a, b) => Number(!!a.progress.refresher) - Number(!!b.progress.refresher) || a.progress.remaining - b.progress.remaining);
  }
  return out;
}

/** Verse count per stage, for the strip across the top of My Verses. */
export function stageCounts(queue: QueueItem[]): Record<VerseStage, number> {
  const out: Record<VerseStage, number> = { waiting: 0, learning: 0, daily: 0, weekly: 0, monthly: 0, complete: 0 };
  for (const item of queue) out[verseStage(item)]++;
  return out;
}
