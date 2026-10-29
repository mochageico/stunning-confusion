// The review ladder as the engine uses it (REVIEW_LADDER_PLAN.md stage 4):
// what runs on the queue when the app opens (migration, partly covered days,
// late reviews, the welcome-back spread) and what grading one verse does
// (firm-up, the passage's review, its history entries and the toast copy).
// Built on ladder.ts, passages.ts and ladderMigration.ts. Pure: nothing here
// reads React state or Firestore; useAppState and useReviewEngine write what
// comes back.
import type { QueueItem, ReviewGrade, ReviewLog, TouchLog } from '../types';
import {
  DEFAULT_THOROUGHNESS,
  lateness,
  reviewsToMoveUp,
  stepInfo,
  type Thoroughness,
  TOP_STEP,
} from './ladder';
import type { BalanceSettings } from './balance';
import { migrateQueue, type MigrationResult } from './ladderMigration';
import { getLogicalDate, localDayKey } from './logicalDate';
import {
  type Join,
  type Passage,
  passageOf,
  passages,
  passageState,
  easeToday,
  recordGrade,
  type ReviewApplied,
  settleStaleDays,
  type SpreadDay,
  spreadOverdue,
  winBack,
} from './passages';
import { appendReviewLog } from './reviewLog';
import { isPauseInEffect } from './reviewCalendar';
import { type LoadSensitivity, type ReviewClock, sensitivityMultiplier } from './retention';

/** memoryPlans/{uid}.ladderVersion once an account's queue is on the ladder. */
export const LADDER_VERSION = 2;

/** The user-level review settings (architecture decision 5). */
export interface LadderPrefs {
  thoroughness: Thoroughness;
  /** "Accuracy needed for clean", 85–100. */
  cleanPct: number;
  /** "Late reviews move you back". */
  lateMovesBack: boolean;
  /** "Find the wrong word can count as a clean review". */
  swapCanBeClean: boolean;
  /** "Balance my review days": weekly and longer reviews may move a few days to ease a heavy one. */
  balanceDays: boolean;
}

export const DEFAULT_LADDER_PREFS: LadderPrefs = {
  thoroughness: DEFAULT_THOROUGHNESS,
  cleanPct: 90,
  lateMovesBack: true,
  swapCanBeClean: true,
  balanceDays: true,
};

const THOROUGHNESS_VALUES: readonly Thoroughness[] = [0.5, 1, 1.5, 2];

/** Reads the settings off a memoryPlans doc, falling back to the defaults for anything missing or out of range. */
export const ladderPrefsFrom = (data: Record<string, unknown> | undefined): LadderPrefs => {
  const d = data ?? {};
  const t = d.thoroughness as Thoroughness;
  const pct = typeof d.cleanPct === 'number' ? Math.round(d.cleanPct / 5) * 5 : NaN;
  return {
    thoroughness: THOROUGHNESS_VALUES.includes(t) ? t : DEFAULT_LADDER_PREFS.thoroughness,
    cleanPct: pct >= 85 && pct <= 100 ? pct : DEFAULT_LADDER_PREFS.cleanPct,
    lateMovesBack: typeof d.lateMovesBack === 'boolean' ? d.lateMovesBack : DEFAULT_LADDER_PREFS.lateMovesBack,
    swapCanBeClean: typeof d.swapCanBeClean === 'boolean' ? d.swapCanBeClean : DEFAULT_LADDER_PREFS.swapCanBeClean,
    balanceDays: typeof d.balanceDays === 'boolean' ? d.balanceDays : DEFAULT_LADDER_PREFS.balanceDays,
  };
};

/** Puts changed items back in their places. */
export const mergeChanged = (queue: readonly QueueItem[], changed: readonly QueueItem[]): QueueItem[] => {
  if (changed.length === 0) return [...queue];
  const byId = new Map(changed.map((q) => [q.verseId, q]));
  return queue.map((q) => byId.get(q.verseId) ?? q);
};

/** "21–22", "1–20 and 23–30", "1, 3 and 5–7". */
export const verseRanges = (nums: readonly number[]): string => {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? String(sorted[i]) : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

/** "Romans 8:1–20". */
export const passageLabel = (p: Pick<Passage, 'book' | 'chapter' | 'first' | 'last'>): string =>
  `${p.book} ${p.chapter}:${p.first === p.last ? p.first : `${p.first}–${p.last}`}`;

/** "Romans 8:21–22 join verses 1–20." plus the catch-up note when it started one. */
export const joinMessage = (j: Join): string => {
  const others = j.passage.items.map((q) => q.verseNumber).filter((n) => !j.joined.includes(n));
  const head = `${j.passage.book} ${j.passage.chapter}:${verseRanges(j.joined)} ${j.joined.length === 1 ? 'joins' : 'join'} verse${others.length === 1 ? '' : 's'} ${verseRanges(others)}.`;
  return j.restarted ? `${head} Reviewed together every day for about 2 weeks to catch up.` : head;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "1 blank and 2 stumbles", "3 stumbles", or '' when every verse was clean. */
const slips = (grades: ReviewApplied['grades']): string => {
  const blanks = grades.filter((g) => g.grade === 'blank').length;
  const stumbles = grades.filter((g) => g.grade === 'stumble').length;
  return [blanks > 0 && plural(blanks, 'blank'), stumbles > 0 && plural(stumbles, 'stumble')].filter(Boolean).join(' and ');
};

/** Why a review that was all clean didn't count: a missed spot check, or two self-checks in a row. */
export type HeldReason = 'spotCheck' | 'selfCheck' | null;

/** The toast for one passage's review. */
export const outcomeMessage = (a: ReviewApplied, thoroughness: Thoroughness, heldReason: HeldReason = null): string => {
  const title = `${a.replaced ? 'Better run! ' : ''}${passageLabel(a.passage)}`;
  const stumbles = a.grades.filter((g) => g.grade === 'stumble').length;
  const firmUp = a.firmUp ? ' Firm it up tomorrow to win it back.' : '';
  switch (a.outcome) {
    case 'up':
    case 'forgiven': {
      const forgiven = a.outcome === 'forgiven' ? ` ${plural(stumbles, 'stumble')} in ${a.passage.items.length} verses forgiven.` : '';
      if (a.to.step === TOP_STEP && a.from.step < TOP_STEP) return `${title} reached Every 6 months, for good. 🌟${forgiven}`;
      if (a.to.step > a.from.step) return `${title} moved up to ${stepInfo(a.to.step).label}!${forgiven}`;
      const need = reviewsToMoveUp(a.to, thoroughness);
      const where = need === null ? stepInfo(a.to.step).label : `${a.to.reviews} of ${need} at ${stepInfo(a.to.step).label}`;
      return `${title}: review counted (${where}).${forgiven}`;
    }
    case 'held':
      if (slips(a.grades)) return `${title}: ${slips(a.grades)}, so this review didn't count. It stays where it was.${firmUp}`;
      if (heldReason === 'spotCheck') return `${title}: the spot check slipped, so this review didn't count.`;
      if (heldReason === 'selfCheck') return `${title}: two self-checks in a row can't both count. Recite it next time.`;
      return `${title}: this review didn't count.`;
  }
};

// ---------------------------------------------------------------------------
// The recap's per-passage line
// ---------------------------------------------------------------------------

export type ReviewTag = 'Clean' | 'Held' | 'Forgiven' | 'Won back';

/** What one passage's review did, for the Mixed review recap (stage 7). */
export interface ReviewNote {
  /** When it was applied (ms), so a recap can show only its own session. */
  at: number;
  title: string;
  tag: ReviewTag;
  /** One line saying why: the count, the stumbles, the step it fell to. */
  reason: string;
  /** Every verse of the passage, so the recap can match it to a session. */
  verseIds: string[];
  /** The verses that weren't clean (the weak-spot dots the review left), verse order. */
  slipped: { verseId: string; verseNumber: number }[];
  /** A firm-up was offered for the next scheduled day. */
  firmUp: boolean;
}

const TAG_OF: Record<ReviewApplied['outcome'], ReviewTag> = {
  up: 'Clean',
  forgiven: 'Forgiven',
  held: 'Held',
};

/** The recap line for an applied review. Same facts as `outcomeMessage`, shorter. */
export const reviewNote = (a: ReviewApplied, thoroughness: Thoroughness, heldReason: HeldReason = null, at: number = Date.now()): ReviewNote => {
  const stumbles = a.grades.filter((g) => g.grade === 'stumble').length;
  let reason: string;
  switch (a.outcome) {
    case 'up': {
      if (a.to.step === TOP_STEP && a.from.step < TOP_STEP) reason = 'Reached Every 6 months, for good.';
      else if (a.to.step > a.from.step) reason = `Moved up to ${stepInfo(a.to.step).label}.`;
      else {
        const need = reviewsToMoveUp(a.to, thoroughness);
        reason = need === null ? 'Review counted.' : `Review ${a.to.reviews} of ${need} at ${stepInfo(a.to.step).label}.`;
      }
      break;
    }
    case 'forgiven':
      reason = `${plural(stumbles, 'stumble')} in ${a.passage.items.length} verses forgiven, so the review counted.`;
      break;
    case 'held':
      if (slips(a.grades)) reason = `${slips(a.grades)}, so this review didn't count.`;
      else if (heldReason === 'spotCheck') reason = "The spot check slipped, so this review didn't count.";
      else if (heldReason === 'selfCheck') reason = "Two self-checks in a row can't both count. Recite it next time.";
      else reason = "This review didn't count.";
      break;
  }
  return {
    at,
    title: passageLabel(a.passage),
    tag: TAG_OF[a.outcome],
    reason,
    verseIds: a.passage.items.map((q) => q.verseId),
    slipped: a.grades.filter((g) => g.grade !== 'clean').map((g) => ({ verseId: g.verseId, verseNumber: g.verseNumber })),
    firmUp: !!a.firmUp,
  };
};

/** The recap line for a firm-up that won the lost review back. */
export const wonBackNote = (p: Passage, at: number = Date.now()): ReviewNote => ({
  at,
  title: passageLabel(p),
  tag: 'Won back',
  reason: 'You recited the slipped verses clean, so the review is back.',
  verseIds: p.items.map((q) => q.verseId),
  slipped: [],
  firmUp: false,
});

/** The history entry's `result` for older readers: a counted review is a pass, otherwise the verse's own grade decides. */
const legacyResult = (outcome: ReviewApplied['outcome'], grade: ReviewGrade): ReviewLog['result'] =>
  outcome === 'up' || outcome === 'forgiven' || grade === 'clean' ? 'pass' : 'miss';

/**
 * A better run redid today's review: takes each member's entry for the
 * review it replaced back out of the history (logApplied then adds the new
 * one), so a day has one entry per review.
 */
const unlogReplaced = (work: Map<string, QueueItem>, a: ReviewApplied) => {
  for (const g of a.grades) {
    const cur = work.get(g.verseId);
    const last = cur?.reviewLogs?.[cur.reviewLogs.length - 1];
    if (!cur || !last || last.outcome !== a.replaced || last.step !== a.from.step) continue;
    work.set(g.verseId, { ...cur, reviewLogs: cur.reviewLogs!.slice(0, -1) });
  }
};

/**
 * Adds a history entry to every member graded in `a`, logged against the
 * stage the passage was at. `before` is the member as it stood before the
 * review (its mapped legacy stage).
 */
const logApplied = (
  work: Map<string, QueueItem>,
  a: ReviewApplied,
  before: ReadonlyMap<string, QueueItem>,
  extra: { via?: ReviewLog['via']; drillType?: TouchLog['drillType']; forVerse?: string } = {}
) => {
  for (const g of a.grades) {
    const cur = work.get(g.verseId);
    if (!cur) continue;
    const next = { ...cur };
    const entry: Omit<ReviewLog, 'at' | 'result' | 'stage' | 'refresher'> = { step: a.from.step, grade: g.grade, outcome: a.outcome };
    if (extra.drillType && g.verseId === extra.forVerse) entry.drillType = extra.drillType;
    if (extra.via && g.verseId === extra.forVerse) entry.via = extra.via;
    appendReviewLog(next, before.get(g.verseId) ?? cur, legacyResult(a.outcome, g.grade), entry);
    if (a.outcome === 'up' || a.outcome === 'forgiven') next.totalSuccessfulReviews = (next.totalSuccessfulReviews || 0) + 1;
    work.set(g.verseId, next);
  }
};

// ---------------------------------------------------------------------------
// On load
// ---------------------------------------------------------------------------

export interface LateNote {
  passage: Passage;
  missed: number;
  from: number;
  to: number;
}

export interface LoadResult {
  /** The whole queue, ready to show. */
  queue: QueueItem[];
  /** Every item that differs from what was loaded, final versions. */
  changed: QueueItem[];
  migration: MigrationResult;
  settled: ReviewApplied[];
  late: LateNote[];
  /** Welcome back: the days overdue passages were spread over (empty when nothing was overdue). */
  spread: SpreadDay[];
}

/**
 * Everything that runs on the queue when the app opens, in order:
 * 1. the migration (idempotent: only verses past Learning with no ladder
 *    step are mapped, so this also catches verses an old app build wrote
 *    back without their ladder fields);
 * 2. passages left partly covered on an earlier day get their
 *    outcome, which can only hold;
 * 3. "Late reviews move you back" (when on), one review per full interval
 *    overdue, never below the start of the step, noted in the history;
 * 4. overdue passages are spread over the next few days under the review
 *    time cap (welcome back), which also gives each a new due date so the
 *    same lateness isn't charged on the next open.
 * 5. Balance my review days (when on): a day still past the limit sets some
 *    of its weekly-and-longer reviews a day later (easeToday).
 * Steps 3 to 5 are skipped while reviews are paused: nothing is late then.
 */
export const prepareLadderQueue = (
  loaded: readonly QueueItem[],
  opts: { clock: ReviewClock; prefs: LadderPrefs; capMinutes: number; sensitivity?: LoadSensitivity; now?: Date }
): LoadResult => {
  const now = opts.now ?? new Date();
  const { clock, prefs } = opts;
  const sensitivity = opts.sensitivity ?? 'medium';
  const balance = prefs.balanceDays ? { capMinutes: opts.capMinutes, loadFactor: sensitivityMultiplier(sensitivity) } : undefined;
  const settings = { clock, thoroughness: prefs.thoroughness, now, balance };

  const migration = migrateQueue(loaded, settings);
  let queue = mergeChanged(loaded, migration.changed);

  const today = localDayKey(getLogicalDate(clock.dayStartHour, now));
  const stale = settleStaleDays(queue, today, settings);
  if (stale.changed.length > 0) {
    const before = new Map(queue.map((q) => [q.verseId, q]));
    const work = new Map(stale.changed.map((q) => [q.verseId, q]));
    for (const a of stale.settled) logApplied(work, a, before);
    queue = mergeChanged(queue, [...work.values()]);
  }

  const late: LateNote[] = [];
  let spread: SpreadDay[] = [];
  if (!isPauseInEffect(clock.pausedAt, clock.pausedUntil, now)) {
    if (prefs.lateMovesBack) {
      const changed: QueueItem[] = [];
      for (const p of passages(queue)) {
        if (p.items.some((q) => q.ladderStep === undefined)) continue;
        const state = passageState(p);
        const { missed, state: after } = lateness(state, p.items[0].nextReviewDueDate, clock, now);
        if (missed === 0) continue;
        late.push({ passage: p, missed, from: state.reviews, to: after.reviews });
        for (const q of p.items) {
          const next = { ...q, ladderReviews: after.reviews };
          appendReviewLog(next, q, 'skipped', { cycles: missed, step: state.step, outcome: 'late' });
          changed.push(next);
        }
      }
      queue = mergeChanged(queue, changed);
    }
    const s = spreadOverdue(queue, opts.capMinutes, clock, now);
    queue = mergeChanged(queue, s.changed);
    spread = s.days;
    // Balance my review days: a day still past the limit sets some of its weekly-and-longer reviews a day later.
    if (balance) queue = mergeChanged(queue, easeToday(queue, { clock, balance, sensitivity, now }).changed);
  }

  const original = new Map(loaded.map((q) => [q.verseId, JSON.stringify(q)]));
  const changed = queue.filter((q) => original.get(q.verseId) !== JSON.stringify(q));
  return { queue, changed, migration, settled: stale.settled, late, spread };
};

// ---------------------------------------------------------------------------
// Grading one verse
// ---------------------------------------------------------------------------

export interface GradeVerseOptions {
  clock: ReviewClock;
  thoroughness?: Thoroughness;
  now?: Date;
  via?: ReviewLog['via'];
  drillType?: TouchLog['drillType'];
  /** The grade came from a self-check (every-other rule). */
  selfCheck?: boolean;
  /** false: this round can't move the passage up (a missed spot check). */
  canMoveUp?: boolean;
  /** Balance my review days, when on. */
  balance?: BalanceSettings;
  /**
   * Grades given today to verses of passages with a firm-up today, by
   * verseId. The caller keeps it across calls (verses are graded one at a
   * time) and this adds to it; winning back needs every slipped verse clean.
   */
  firmUpGrades?: Map<string, ReviewGrade>;
}

export interface GradeVerseResult {
  changed: QueueItem[];
  passage: Passage | null;
  /** Not due: practice, nothing counted (a clean grade still clears the weak-spot dot). */
  practice: boolean;
  applied: ReviewApplied | null;
  settled: ReviewApplied | null;
  /** The firm-up was won with this grade. */
  wonBack: boolean;
  /** This review took the passage to Every 6 months. */
  reachedTop: boolean;
  /** The recap lines this grade produced: the review's outcome, and a firm-up won back. */
  notes: ReviewNote[];
  messages: string[];
}

/**
 * Grades one verse past Learning: a firm-up attempt first (when its passage
 * has one today), then the passage's current review (recordGrade). Adds the
 * history entries and returns the toasts. Expects a migrated queue.
 */
export const gradeVerse = (
  queue: readonly QueueItem[],
  verseId: string,
  grade: ReviewGrade,
  opts: GradeVerseOptions
): GradeVerseResult => {
  const now = opts.now ?? new Date();
  const thoroughness = opts.thoroughness ?? DEFAULT_THOROUGHNESS;
  const day = localDayKey(getLogicalDate(opts.clock.dayStartHour, now));
  const messages: string[] = [];
  const notes: ReviewNote[] = [];
  let work = [...queue];
  const touched = new Set<string>();
  const take = (changed: QueueItem[]) => {
    for (const q of changed) touched.add(q.verseId);
    work = mergeChanged(work, changed);
  };

  let wonBack = false;
  const p0 = passageOf(work, verseId);
  if (p0 && p0.items[0].firmUp?.day === day && opts.firmUpGrades) {
    const prev = opts.firmUpGrades.get(verseId);
    opts.firmUpGrades.set(verseId, prev === undefined || prev === 'clean' ? grade : prev === 'blank' || grade === 'blank' ? 'blank' : 'stumble');
    const grades = p0.items.flatMap((q) => {
      const g = opts.firmUpGrades!.get(q.verseId);
      return g ? [{ verseId: q.verseId, grade: g }] : [];
    });
    const w = winBack(work, verseId, grades, { day, clock: opts.clock, thoroughness, now });
    if (w.won) {
      wonBack = true;
      notes.push(wonBackNote(p0, now.getTime()));
      const slipped = new Set(p0.items[0].firmUp!.verses);
      const logged = w.changed.map((q) => {
        if (!slipped.has(q.verseNumber)) return q;
        const next = { ...q };
        appendReviewLog(next, q, 'pass', { step: passageState(p0).step, grade: 'clean', outcome: 'wonBack' });
        return next;
      });
      take(logged);
      messages.push(`${passageLabel(p0)}: review won back!`);
      for (const q of p0.items) opts.firmUpGrades.delete(q.verseId);
    } else {
      take(w.changed);
    }
  }

  const before = new Map(work.map((q) => [q.verseId, q]));
  const pBefore = passageOf(work, verseId);
  const r = recordGrade(work, verseId, grade, {
    day,
    clock: opts.clock,
    thoroughness,
    now,
    via: opts.via,
    selfCheck: opts.selfCheck,
    canMoveUp: opts.canMoveUp,
    balance: opts.balance,
  });
  const map = new Map(r.changed.map((q) => [q.verseId, q]));
  if (r.settled) logApplied(map, r.settled, before);
  if (r.applied) {
    if (r.applied.replaced) {
      // Every member's entry is replaced, changed by the redo or not.
      for (const q of r.applied.passage.items) if (!map.has(q.verseId)) map.set(q.verseId, before.get(q.verseId)!);
      unlogReplaced(map, r.applied);
    }
    // A redo is logged against the step the passage was at before the review it replaced.
    const stageOf = r.applied.replaced
      ? new Map([...before].map(([id, q]) => [id, { ...q, ladderStep: r.applied!.from.step }]))
      : before;
    logApplied(map, r.applied, stageOf, { via: opts.via, drillType: opts.drillType, forVerse: verseId });
    let heldReason: HeldReason = null;
    if (r.applied.outcome === 'held' && r.applied.grades.every((g) => g.grade === 'clean')) {
      const noUp =
        opts.canMoveUp === false ||
        (pBefore?.items ?? []).some((q) => (q.dayResult?.day === day && q.dayResult.noUp) || (q.dayReview?.day === day && q.dayReview.result.noUp));
      heldReason = noUp ? 'spotCheck' : 'selfCheck';
    }
    messages.push(outcomeMessage(r.applied, thoroughness, heldReason));
    notes.push(reviewNote(r.applied, thoroughness, heldReason, now.getTime()));
  } else if (r.improved && r.passage) {
    messages.push(`${passageLabel(r.passage)}: better run noted, but today's review comes out the same.`);
  }
  take([...map.values()]);

  const changed = work.filter((q) => touched.has(q.verseId));
  return {
    changed,
    passage: r.passage,
    practice: r.practice && !wonBack,
    applied: r.applied,
    settled: r.settled,
    wonBack,
    reachedTop: !!r.applied && r.applied.to.step === TOP_STEP && r.applied.from.step < TOP_STEP,
    notes,
    messages,
  };
};
