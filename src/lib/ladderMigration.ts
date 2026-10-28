// Migration to the review ladder (REVIEW_LADDER_PLAN.md stage 3). Maps each
// verse's old daily / weekly / monthly streak to a ladder step, then lets
// reconcile make each passage's members agree. Pure: nothing here reads or
// writes Firestore. Stage 4 writes `changed`; the dev dry run only shows the
// report.
import type { QueueItem } from '../types';
import {
  CATCH_UP_REVIEWS,
  DEFAULT_THOROUGHNESS,
  type LadderState,
  stepInfo,
  stepReviewCount,
  type Thoroughness,
  TOP_STEP,
} from './ladder';
import { getLogicalDate, nthOccurrenceOfWeekday } from './logicalDate';
import { passages, passageState, reconcile } from './passages';
import { findChapterReviewAnchor, nextDueDateISO, type ReviewClock } from './retention';

const isPastLearning = (q: QueueItem) => q.status === 'reviewing' || q.status === 'retained';

/**
 * Where an old streak lands, as [step, reviews counted at that step]. The
 * thresholds are the Standard counts (7 / 4 / 4 daily, 8 / 6 weekly, 12 / 6
 * monthly); what's left over carries into the step.
 */
const fromStreak = (phase: QueueItem['retentionPhase'], streak: number): LadderState => {
  const n = Math.max(0, Math.floor(streak || 0));
  if (phase === 'weekly') {
    if (n < 8) return { step: 3, reviews: n };
    if (n < 14) return { step: 4, reviews: n - 8 };
    return { step: 5, reviews: n - 14 };
  }
  if (phase === 'monthly') {
    if (n < 12) return { step: 5, reviews: n };
    if (n < 18) return { step: 6, reviews: n - 12 };
    return { step: 7, reviews: 0 };
  }
  // Daily, or a reviewing verse that never got a phase.
  if (n < 7) return { step: 0, reviews: n };
  if (n < 11) return { step: 1, reviews: n - 7 };
  if (n < 15) return { step: 2, reviews: n - 11 };
  return { step: 3, reviews: 0 };
};

/** Keeps a carried-over count short of the step's own count, so nothing jumps a step on its first review. */
const fitStep = (s: LadderState, thoroughness: Thoroughness): LadderState => {
  const count = s.catchUp && s.step < CATCH_UP_REVIEWS.length ? CATCH_UP_REVIEWS[s.step] : stepReviewCount(s.step, thoroughness);
  const reviews = count === null ? 0 : Math.min(s.reviews, count - 1);
  return s.catchUp ? { step: s.step, reviews, catchUp: true } : { step: s.step, reviews };
};

/**
 * One verse's ladder position from its old fields. `retained` is the top;
 * an active refresher counts from the phase and progress it returns to.
 */
export const mapLegacyItem = (q: QueueItem, thoroughness: Thoroughness = DEFAULT_THOROUGHNESS): LadderState => {
  if (q.status === 'retained') return { step: 7, reviews: 0 };
  if (q.refresherActive && q.refresherReturnPhase) {
    return fitStep(fromStreak(q.refresherReturnPhase, q.refresherReturnProgress ?? 0), thoroughness);
  }
  return fitStep(fromStreak(q.retentionPhase, q.currentStreakCount), thoroughness);
};

/** How the old stage reads in the report: "Daily 5", "Weekly 3", "Monthly 12", "Retained", "Refresher (Weekly 4)". */
export const legacyStageLabel = (q: QueueItem): string => {
  if (q.status === 'retained') return 'Retained';
  const phase = (p: QueueItem['retentionPhase']) => (p === 'weekly' ? 'Weekly' : p === 'monthly' ? 'Monthly' : 'Daily');
  if (q.refresherActive && q.refresherReturnPhase) return `Refresher (${phase(q.refresherReturnPhase)} ${q.refresherReturnProgress ?? 0})`;
  return `${phase(q.retentionPhase)} ${q.currentStreakCount ?? 0}`;
};

export interface MigrationVerse {
  verseId: string;
  verseNumber: number;
  /** "Daily 5" etc.; null when the verse already had a ladder step. */
  old: string | null;
  /** Where the verse's own streak mapped, before its passage agreed. */
  mapped: LadderState;
}

export interface MigrationPassage {
  key: string;
  translationId: string;
  book: string;
  chapter: number;
  first: number;
  last: number;
  verses: MigrationVerse[];
  /** The passage's agreed position. */
  to: LadderState;
  /** Members mapped to different steps, so the passage took the lowest (with the catch-up below Every week). */
  merged: boolean;
  due: string | null;
}

export interface MigrationReport {
  passages: MigrationPassage[];
  /** Verses that got ladder fields (or had them changed by their passage agreeing). */
  changedCount: number;
  /** Verses past Learning that already had a ladder step before this run. */
  alreadyMigrated: number;
  /** Verses still waiting or in Learning: untouched. */
  notStarted: number;
}

export interface MigrationResult {
  changed: QueueItem[];
  report: MigrationReport;
}

/**
 * Moves a queue onto the ladder (stage 3 of the plan):
 * 1. every verse past Learning without a `ladderStep` maps from its old
 *    streak (`mapLegacyItem`); its due date is kept, so nothing is late and
 *    nothing piles up on the first day;
 * 2. a passage whose members mapped to different steps takes the lowest
 *    one, with the short catch-up when that's below Every week (the
 *    catch-up only exists there); a passage whose members agree keeps its
 *    step;
 * 3. reconcile writes the agreed schedule on every member (earliest due
 *    date, legacy `status` / `retentionPhase` mapped);
 * 4. top-step passages with no due date (retained verses) are spread over
 *    the next 26 weeks (`spreadUndated`).
 * Idempotent: verses that already have `ladderStep` keep their position, so
 * a second run changes nothing. Learning and waiting verses are untouched.
 */
export const migrateQueue = (
  queue: readonly QueueItem[],
  opts: { clock: ReviewClock; thoroughness?: Thoroughness; now?: Date }
): MigrationResult => {
  const thoroughness = opts.thoroughness ?? DEFAULT_THOROUGHNESS;
  const original = new Map(queue.map((q) => [q.verseId, q]));
  const mappedOf = new Map<string, LadderState>();
  const oldOf = new Map<string, string>();
  let alreadyMigrated = 0;
  let notStarted = 0;

  const staged: QueueItem[] = queue.map((q) => {
    if (!isPastLearning(q)) {
      notStarted++;
      return q;
    }
    if (q.ladderStep !== undefined) {
      alreadyMigrated++;
      return q;
    }
    const s = mapLegacyItem(q, thoroughness);
    mappedOf.set(q.verseId, s);
    oldOf.set(q.verseId, legacyStageLabel(q));
    return { ...q, ladderStep: s.step, ladderReviews: s.reviews };
  });

  // Passages that disagree: the lowest members get the catch-up, and
  // reconcile takes the lowest (a tied catch-up wins there).
  const merged = new Set<string>();
  const byId = new Map(staged.map((q) => [q.verseId, q]));
  for (const p of passages(staged)) {
    if (!p.items.some((q) => mappedOf.has(q.verseId))) continue;
    const steps = new Set(p.items.map((q) => q.ladderStep));
    if (steps.size < 2) continue;
    merged.add(p.key);
    const low = Math.min(...p.items.map((q) => q.ladderStep!));
    if (low >= CATCH_UP_REVIEWS.length) continue;
    for (const q of p.items) {
      if (q.ladderStep !== low) continue;
      const s = fitStep({ step: low, reviews: q.ladderReviews ?? 0, catchUp: true }, thoroughness);
      byId.set(q.verseId, { ...q, ladderReviews: s.reviews, catchUp: true });
    }
  }
  const prepared = staged.map((q) => byId.get(q.verseId)!);

  const { changed: reconciled } = reconcile(prepared, { clock: opts.clock, now: opts.now });
  const finalOf = new Map(prepared.map((q) => [q.verseId, q]));
  for (const q of reconciled) finalOf.set(q.verseId, q);
  const spread = spreadUndated(queue.map((q) => finalOf.get(q.verseId)!), opts.clock, opts.now ?? new Date());
  for (const q of spread) finalOf.set(q.verseId, q);
  const final = queue.map((q) => finalOf.get(q.verseId)!);

  const changed = final.filter((q) => JSON.stringify(q) !== JSON.stringify(original.get(q.verseId)));
  const changedIds = new Set(changed.map((q) => q.verseId));

  const report: MigrationPassage[] = passages(final)
    // Membership doesn't change in a run (every member stays past Learning), so keys match `merged`.
    .filter((p) => p.items.some((q) => changedIds.has(q.verseId)))
    .map((p) => ({
      key: p.key,
      translationId: p.translationId,
      book: p.book,
      chapter: p.chapter,
      first: p.first,
      last: p.last,
      verses: p.items.map((q) => {
        const before = original.get(q.verseId)!;
        return {
          verseId: q.verseId,
          verseNumber: q.verseNumber,
          old: oldOf.get(q.verseId) ?? null,
          mapped: mappedOf.get(q.verseId) ?? { step: before.ladderStep ?? 0, reviews: before.ladderReviews ?? 0 },
        };
      }),
      to: passageState(p),
      merged: merged.has(p.key),
      due: p.items[0].nextReviewDueDate,
    }));

  return { changed, report: { passages: report, changedCount: changed.length, alreadyMigrated, notStarted } };
};

/** Weeks the undated top-step passages are spread over: one Every 6 months interval. */
export const SPREAD_WEEKS = 26;

/**
 * Retained verses never had a due date (the old system was finished with
 * them), and a verse with no date reads as due now. Top-step passages with
 * no date are spread across the next 26 weeks instead, weighted by verse
 * count so long chapters don't bunch up, each on its chapter's weekday
 * (a chapter without one counts whole weeks from today). In queue order.
 */
const spreadUndated = (queue: readonly QueueItem[], clock: ReviewClock, now: Date): QueueItem[] => {
  const undated = passages(queue).filter((p) => passageState(p).step === TOP_STEP && p.items.every((q) => !q.nextReviewDueDate));
  const total = undated.reduce((n, p) => n + p.items.length, 0);
  const tomorrow = new Date(getLogicalDate(clock.dayStartHour, now));
  tomorrow.setDate(tomorrow.getDate() + 1);
  const out: QueueItem[] = [];
  let before = 0;
  for (const p of undated) {
    const week = 1 + Math.floor((before * SPREAD_WEEKS) / total);
    before += p.items.length;
    const anchor = findChapterReviewAnchor(p.book, p.chapter, queue as QueueItem[]);
    const due = anchor
      ? nthOccurrenceOfWeekday(tomorrow, anchor, week, clock.sabbathEnabled, clock.sabbathDay).toISOString()
      : nextDueDateISO(week * 7, clock, now);
    for (const q of p.items) out.push({ ...q, nextReviewDueDate: due });
  }
  return out;
};

/** "Every 2 days, review 3 of 4 (catch-up)" for the report. */
export const describeLadderState = (s: LadderState, thoroughness: Thoroughness = DEFAULT_THOROUGHNESS): string => {
  const info = stepInfo(s.step);
  const count = s.catchUp && s.step < CATCH_UP_REVIEWS.length ? CATCH_UP_REVIEWS[s.step] : stepReviewCount(s.step, thoroughness);
  if (count === null) return `${info.label}, for good`;
  return `${info.label}, review ${s.reviews + 1} of ${count}${s.catchUp ? ' (catch-up)' : ''}`;
};

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'no date';

/** "v1–2 Weekly 3 · v3 Daily 12": runs of neighbouring verses that had the same old stage. */
export const oldStagesLine = (p: MigrationPassage): string => {
  const parts: string[] = [];
  let i = 0;
  while (i < p.verses.length) {
    let j = i;
    while (j + 1 < p.verses.length && p.verses[j + 1].old === p.verses[i].old) j++;
    const a = p.verses[i].verseNumber;
    const b = p.verses[j].verseNumber;
    parts.push(`v${a === b ? a : `${a}–${b}`} ${p.verses[i].old ?? 'already on the ladder'}`);
    i = j + 1;
  }
  return parts.join(' · ');
};

export const passageTitle = (p: MigrationPassage): string =>
  `${p.book} ${p.chapter}:${p.first === p.last ? p.first : `${p.first}–${p.last}`} (${p.translationId})`;

/** The whole report as plain text, to copy and read through. */
export const migrationReportText = (report: MigrationReport, thoroughness: Thoroughness = DEFAULT_THOROUGHNESS): string => {
  const lines = [
    `Review ladder migration (dry run, nothing saved)`,
    `${report.passages.length} passages · ${report.changedCount} verses would change · ${report.alreadyMigrated} already on the ladder · ${report.notStarted} waiting or in Learning (untouched)`,
    '',
  ];
  for (const p of report.passages) {
    lines.push(passageTitle(p) + (p.merged ? '  [mixed stages: took the lowest]' : ''));
    lines.push(`  was: ${oldStagesLine(p)}`);
    lines.push(`  now: ${describeLadderState(p.to, thoroughness)} · next review ${shortDate(p.due)}`);
  }
  return lines.join('\n');
};
