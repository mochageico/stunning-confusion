// Passages (REVIEW_LADDER_PLAN.md Part 1 §2–§5, architecture decisions 1
// and 4): verses past Learning are reviewed together as unbroken runs in one
// chapter and one translation. A passage isn't stored as its own doc; its
// schedule is written identically on every member verse, and reconcile makes
// the members agree. Grades accumulate per verse through the day
// (`dayResult`) and the passage's outcome is applied once every member has
// one. Nothing here reads React state or Firestore; every function returns
// only the items it changed, so writes stay small.
import type { QueueItem, ReviewGrade, ReviewLog } from '../types';
import { canSelfCheckMoveUp } from './grading';
import {
  applyOutcome,
  DEFAULT_THOROUGHNESS,
  FIRST_WEEKLY_STEP,
  type LadderState,
  nextDue,
  passageOutcome,
  type PassageOutcome,
  stepInfo,
  type Thoroughness,
} from './ladder';
import { advancePastSabbath, DAY_ABBREVS, getLogicalDate, localDayKey, MAX_LEARNING_DAY_SCAN } from './logicalDate';
import { findChapterReviewAnchor, isReviewDue, REVIEW_SECONDS_PER_VERSE, type ReviewClock } from './retention';
import { isDayPaused, isPauseInEffect } from './reviewCalendar';

export interface Passage {
  /** Stable while the passage's first verse doesn't change. */
  key: string;
  translationId: string;
  book: string;
  chapter: number;
  first: number;
  last: number;
  /** Member verses in verse order. */
  items: QueueItem[];
}

const isPastLearning = (q: QueueItem) => q.status === 'reviewing' || q.status === 'retained';

/**
 * Unbroken runs of verses past Learning, per translation + book + chapter.
 * A verse still in Learning (or not started) breaks a run like a gap does.
 */
export const passages = (queue: readonly QueueItem[]): Passage[] => {
  const byChapter = new Map<string, QueueItem[]>();
  for (const q of queue) {
    if (!isPastLearning(q)) continue;
    const k = `${q.translationId}|${q.book}|${q.chapter}`;
    const list = byChapter.get(k);
    if (list) list.push(q);
    else byChapter.set(k, [q]);
  }
  const out: Passage[] = [];
  for (const list of byChapter.values()) {
    const sorted = [...list].sort((a, b) => a.verseNumber - b.verseNumber);
    let run: QueueItem[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const { translationId, book, chapter } = run[0];
      const first = run[0].verseNumber;
      out.push({ key: `${translationId}|${book}|${chapter}|${first}`, translationId, book, chapter, first, last: run[run.length - 1].verseNumber, items: run });
      run = [];
    };
    for (const q of sorted) {
      if (run.length > 0 && q.verseNumber > run[run.length - 1].verseNumber + 1) flush();
      run.push(q);
    }
    flush();
  }
  return out;
};

/** The passage a verse belongs to, or null while it's in Learning. */
export const passageOf = (queue: readonly QueueItem[], verseId: string): Passage | null =>
  passages(queue).find((p) => p.items.some((q) => q.verseId === verseId)) ?? null;

/** A member's ladder position; null for a verse that just left Learning (no `ladderStep` yet). */
export const ladderStateOf = (item: QueueItem): LadderState | null => {
  if (item.ladderStep === undefined) return null;
  const s: LadderState = { step: item.ladderStep, reviews: item.ladderReviews ?? 0 };
  if (item.catchUp) s.catchUp = true;
  return s;
};

/** A reconciled passage's position (its members agree; the first one speaks for it). */
export const passageState = (p: Passage): LadderState => ladderStateOf(p.items[0]) ?? { step: 0, reviews: 0 };

const legacyPhase = (step: number): QueueItem['retentionPhase'] => {
  const group = stepInfo(step).group;
  return group === 'settling' ? 'daily' : group === 'steady' ? 'weekly' : 'monthly';
};

/** The passage-level fields every member carries identically. */
interface Schedule {
  state: LadderState;
  due: string | null;
  lastSelfChecked?: true;
  firmUp?: QueueItem['firmUp'];
}

// Firestore rejects undefined: optional keys are deleted, never set to undefined.
function setOpt<K extends keyof QueueItem>(item: QueueItem, key: K, value: QueueItem[K] | undefined) {
  if (value === undefined) delete item[key];
  else item[key] = value;
}

const withSchedule = (item: QueueItem, s: Schedule): QueueItem => {
  const next: QueueItem = {
    ...item,
    status: 'reviewing',
    retentionPhase: legacyPhase(s.state.step),
    ladderStep: s.state.step,
    ladderReviews: s.state.reviews,
    nextReviewDueDate: s.due,
  };
  setOpt(next, 'catchUp', s.state.catchUp);
  setOpt(next, 'lastSelfChecked', s.lastSelfChecked);
  setOpt(next, 'firmUp', s.firmUp);
  return next;
};

const differs = (a: QueueItem, b: QueueItem) => JSON.stringify(a) !== JSON.stringify(b);

const earliest = (dues: (string | null | undefined)[]): string | null => {
  let best: string | null = null;
  for (const d of dues) if (d && (best === null || new Date(d).getTime() < new Date(best).getTime())) best = d;
  return best;
};

const lower = (a: LadderState, b: LadderState) => (a.step !== b.step ? a.step < b.step : a.reviews <= b.reviews);
const same = (a: LadderState, b: LadderState) => a.step === b.step && a.reviews === b.reviews;

const anchorFor = (p: Passage, queue: readonly QueueItem[]) => findChapterReviewAnchor(p.book, p.chapter, queue as QueueItem[]);

export interface Join {
  passage: Passage;
  /** Verse numbers that just left Learning and joined. */
  joined: number[];
  /** The passage dropped to Every day with a fresh catch-up (false: joined one already running). */
  restarted: boolean;
}

/**
 * Makes every passage's members agree (decision 1). A verse that just left
 * Learning has no `ladderStep`:
 * - joining a passage drops it to Every day with the short catch-up, due by
 *   the next day; a catch-up already running is joined, not restarted. A
 *   filled gap is the same: the two sides and the new verse become one
 *   passage with one catch-up. A passage at the top that gains a verse
 *   reopens this way too and climbs from there like any other.
 * - a passage made only of new verses starts at Every day without a
 *   catch-up: there was nothing to join.
 * Members that otherwise disagree (migration) take the lowest step, then the
 * lowest review count, and the earliest due date.
 * Only run on a migrated queue: before migration every reviewing verse
 * looks newly arrived.
 */
export const reconcile = (
  queue: readonly QueueItem[],
  opts: { clock: ReviewClock; now?: Date }
): { changed: QueueItem[]; joins: Join[] } => {
  const now = opts.now ?? new Date();
  const changed: QueueItem[] = [];
  const joins: Join[] = [];
  for (const p of passages(queue)) {
    const established = p.items.filter((q) => q.ladderStep !== undefined);
    const arrivals = p.items.filter((q) => q.ladderStep === undefined);
    let lowest: LadderState | null = null;
    for (const q of established) {
      const s = ladderStateOf(q)!;
      // Lowest step, then fewest reviews; on a tie a running catch-up wins.
      if (!lowest || (lower(s, lowest) && !same(s, lowest)) || (same(s, lowest) && s.catchUp)) lowest = s;
    }
    const establishedDue = earliest(established.map((q) => q.nextReviewDueDate));
    const lastSelfChecked = established.some((q) => q.lastSelfChecked) ? (true as const) : undefined;
    const firmUp = established.find((q) => q.firmUp)?.firmUp;
    let schedule: Schedule;
    if (arrivals.length === 0) {
      schedule = { state: lowest!, due: establishedDue, lastSelfChecked, firmUp };
    } else {
      const running = !!lowest && !!lowest.catchUp && lowest.step < FIRST_WEEKLY_STEP;
      if (running) {
        schedule = { state: { ...lowest!, catchUp: true }, due: establishedDue ?? nextDue(lowest!.step, anchorFor(p, queue), opts.clock, now), lastSelfChecked, firmUp };
      } else {
        const firstDue = nextDue(0, anchorFor(p, queue), opts.clock, now);
        const state: LadderState = established.length > 0 ? { step: 0, reviews: 0, catchUp: true } : { step: 0, reviews: 0 };
        schedule = { state, due: earliest([establishedDue, firstDue]), lastSelfChecked };
      }
      if (established.length > 0) joins.push({ passage: p, joined: arrivals.map((q) => q.verseNumber), restarted: !running });
    }
    for (const q of p.items) {
      const next = withSchedule(q, schedule);
      if (differs(next, q)) changed.push(next);
    }
  }
  return { changed, joins };
};

const GRADE_RANK: Record<ReviewGrade, number> = { clean: 0, stumble: 1, blank: 2 };
const worse = (a: ReviewGrade, b: ReviewGrade) => (GRADE_RANK[a] >= GRADE_RANK[b] ? a : b);

/** Local noon of a day key, as a Date: safe to hand to nextDue / getLogicalDate for that day. */
const dayDate = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

/** The scheduled day after `day` (skips the Sabbath). */
const nextScheduledDay = (day: string, clock: ReviewClock) => {
  const d = dayDate(day);
  d.setDate(d.getDate() + 1);
  return localDayKey(advancePastSabbath(d, clock.sabbathEnabled, clock.sabbathDay));
};

export interface LadderSettings {
  clock: ReviewClock;
  thoroughness?: Thoroughness;
  now?: Date;
}

export interface ReviewApplied {
  passage: Passage;
  outcome: PassageOutcome;
  from: LadderState;
  to: LadderState;
  /** The grades the outcome was decided from, verse order. */
  grades: { verseId: string; verseNumber: number; grade: ReviewGrade }[];
  /** Partly covered and settled after its day: penalties apply, it can't move up. */
  penaltyOnly: boolean;
  /** A firm-up was offered for the next day. */
  firmUp: boolean;
}

/**
 * Applies one review's outcome to a passage's members (in `work`, keyed by
 * verseId) from the members graded on `forDay`. Clears those results, sets
 * the weak-spot dots, the every-other flag, a firm-up after a stumble-hold
 * or a back-one, and the next due date.
 */
const applyReview = (
  p: Passage,
  work: Map<string, QueueItem>,
  forDay: string,
  queue: readonly QueueItem[],
  settings: LadderSettings,
  penaltyOnly: boolean
): ReviewApplied => {
  const thoroughness = settings.thoroughness ?? DEFAULT_THOROUGHNESS;
  const members = p.items.map((q) => work.get(q.verseId)!);
  // settleStale has set today's results aside, so a penalty-only review takes every result left.
  const graded = members.filter((q) => q.dayResult && (penaltyOnly ? q.dayResult.day <= forDay : q.dayResult.day === forDay));
  const from = ladderStateOf(members[0]) ?? { step: 0, reviews: 0 };
  const grades = graded.map((q) => ({ verseId: q.verseId, verseNumber: q.verseNumber, grade: q.dayResult!.grade }));
  const selfChecked = graded.some((q) => q.dayResult!.selfCheck);
  const noUp = graded.some((q) => q.dayResult!.noUp);
  const lastSelfChecked = !!members[0].lastSelfChecked;
  const canMoveUp = !penaltyOnly && !noUp && (!selfChecked || canSelfCheckMoveUp(lastSelfChecked));
  const outcome = passageOutcome(
    grades.map((g) => g.grade),
    { size: members.length, canMoveUp }
  );
  const to = applyOutcome(from, outcome, thoroughness);

  // Every other review: a self-check that moves up blocks the next one; any
  // full review not from a self-check frees it. A partly covered review
  // leaves it as it was.
  let nextSelfChecked: true | undefined = lastSelfChecked ? true : undefined;
  if (outcome === 'up' || outcome === 'forgiven') nextSelfChecked = selfChecked ? true : undefined;
  else if (!penaltyOnly && !selfChecked) nextSelfChecked = undefined;

  const stumbles = grades.filter((g) => g.grade === 'stumble').length;
  const slipped = grades.filter((g) => g.grade !== 'clean').map((g) => g.verseNumber);
  let firmUp: QueueItem['firmUp'];
  if (!penaltyOnly && canMoveUp && stumbles > 0) {
    if (outcome === 'held') firmUp = { day: nextScheduledDay(forDay, settings.clock), restore: applyOutcome(from, 'up', thoroughness), verses: slipped };
    else if (outcome === 'back' && from.reviews > 0) firmUp = { day: nextScheduledDay(forDay, settings.clock), restore: { step: from.step, reviews: from.reviews }, verses: slipped };
    // restore is written to Firestore: no catchUp key riding along.
    if (firmUp) firmUp.restore = { step: firmUp.restore.step, reviews: firmUp.restore.reviews };
  }

  // Landing at Every week or longer needs the chapter's weekday; the first
  // passage of a chapter to get there sets it, like graduating out of Daily
  // does today.
  const base = penaltyOnly ? dayDate(forDay) : settings.now ?? new Date();
  let anchor = anchorFor(p, queue);
  let setAnchor: string | undefined;
  if (to.step >= FIRST_WEEKLY_STEP && !anchor) {
    anchor = setAnchor = DAY_ABBREVS[getLogicalDate(settings.clock.dayStartHour, base).getDay()];
  }
  const due = nextDue(to.step, anchor, settings.clock, base);

  const gradedIds = new Set(graded.map((q) => q.verseId));
  const gradeOf = new Map(grades.map((g) => [g.verseId, g.grade]));
  for (const q of members) {
    const next = withSchedule(q, { state: to, due, lastSelfChecked: nextSelfChecked, firmUp });
    if (gradedIds.has(q.verseId)) {
      delete next.dayResult;
      setOpt(next, 'slipped', gradeOf.get(q.verseId) === 'clean' ? undefined : true);
    }
    if (setAnchor && !next.chapterReviewAnchorDay) next.chapterReviewAnchorDay = setAnchor;
    work.set(q.verseId, next);
  }
  return { passage: p, outcome, from, to, grades, penaltyOnly, firmUp: !!firmUp };
};

const collectChanged = (p: Passage, work: Map<string, QueueItem>) =>
  p.items.map((q) => work.get(q.verseId)!).filter((next, i) => differs(next, p.items[i]));

/** Settles a partly covered review left from before `today`, in `work`. */
const settleStale = (p: Passage, work: Map<string, QueueItem>, today: string, queue: readonly QueueItem[], settings: LadderSettings) => {
  const members = p.items.map((q) => work.get(q.verseId)!);
  const staleDays = members.flatMap((q) => (q.dayResult && q.dayResult.day < today ? [q.dayResult.day] : []));
  let settled: ReviewApplied | null = null;
  if (staleDays.length > 0) {
    // Clear today's results from consideration: only the stale ones settle.
    const forDay = staleDays.sort()[staleDays.length - 1];
    const keepToday = new Map<string, QueueItem['dayResult']>();
    for (const q of members) {
      if (q.dayResult && q.dayResult.day >= today) {
        keepToday.set(q.verseId, q.dayResult);
        const stripped = { ...q };
        delete stripped.dayResult;
        work.set(q.verseId, stripped);
      }
    }
    settled = applyReview(p, work, forDay, queue, settings, true);
    for (const [id, r] of keepToday) work.set(id, { ...work.get(id)!, dayResult: r });
  }
  // A firm-up only lasts its day.
  for (const q of p.items) {
    const cur = work.get(q.verseId)!;
    if (cur.firmUp && cur.firmUp.day < today) {
      const next = { ...cur };
      delete next.firmUp;
      work.set(q.verseId, next);
    }
  }
  return settled;
};

export interface GradeOptions extends LadderSettings {
  /** Today's logical day key (localDayKey of getLogicalDate). */
  day: string;
  via?: ReviewLog['via'];
  /** The grade came from a self-check (the every-other rule applies). */
  selfCheck?: boolean;
  /** false: this round can't move the passage up (a missed spot check). Stumbles and blanks still apply. */
  canMoveUp?: boolean;
}

export interface GradeResult {
  changed: QueueItem[];
  passage: Passage | null;
  /** Members graded for the passage's current review so far (after this grade). */
  covered: number;
  /** The review's outcome, when this grade completed the passage. */
  applied: ReviewApplied | null;
  /** A partly covered review from an earlier day, settled first. */
  settled: ReviewApplied | null;
  /** The passage wasn't due: the grade is practice (only a clean one clears the weak-spot dot). */
  practice: boolean;
}

/**
 * Records one verse's grade for its passage's current review (decision 4).
 * Covered twice in a day keeps the worse grade. Once every member has a
 * grade, the outcome is applied once and the results are cleared. A passage
 * that isn't due (or reviews are paused) takes it as practice. Expects a
 * reconciled queue.
 */
export const recordGrade = (queue: readonly QueueItem[], verseId: string, grade: ReviewGrade, opts: GradeOptions): GradeResult => {
  const none: GradeResult = { changed: [], passage: null, covered: 0, applied: null, settled: null, practice: true };
  const p = passageOf(queue, verseId);
  if (!p || p.items.some((q) => q.ladderStep === undefined)) return none;
  const now = opts.now ?? new Date();
  const work = new Map(p.items.map((q) => [q.verseId, q]));
  const settled = settleStale(p, work, opts.day, queue, opts);

  const current = () => p.items.map((q) => work.get(q.verseId)!);
  const due = current()[0].nextReviewDueDate;
  const isDue =
    !isPauseInEffect(opts.clock.pausedAt, opts.clock.pausedUntil, now) && isReviewDue(due, getLogicalDate(opts.clock.dayStartHour, now));

  const item = work.get(verseId)!;
  const next: QueueItem = { ...item, lastReviewDate: now.toISOString() };
  if (grade === 'clean') delete next.slipped;
  if (isDue) {
    const prev = item.dayResult && item.dayResult.day === opts.day ? item.dayResult : undefined;
    const result: NonNullable<QueueItem['dayResult']> = { day: opts.day, grade: prev ? worse(prev.grade, grade) : grade };
    const via = opts.via ?? prev?.via;
    if (via) result.via = via;
    if (opts.selfCheck || prev?.selfCheck) result.selfCheck = true;
    if (opts.canMoveUp === false || prev?.noUp) result.noUp = true;
    next.dayResult = result;
  }
  work.set(verseId, next);

  let applied: ReviewApplied | null = null;
  const covered = current().filter((q) => q.dayResult?.day === opts.day).length;
  if (isDue && covered === p.items.length) applied = applyReview(p, work, opts.day, queue, opts, false);
  return { changed: collectChanged(p, work), passage: p, covered: applied ? p.items.length : covered, applied, settled, practice: !isDue };
};

/**
 * Settles every passage left partly covered on an earlier day: a
 * penalty-only outcome (stumbles and blanks apply, it can't move up), next
 * due counted from the day it was reviewed. Also drops firm-ups whose day
 * has passed. Run on load, before lateness.
 */
export const settleStaleDays = (
  queue: readonly QueueItem[],
  today: string,
  settings: LadderSettings
): { changed: QueueItem[]; settled: ReviewApplied[] } => {
  const changed: QueueItem[] = [];
  const settled: ReviewApplied[] = [];
  for (const p of passages(queue)) {
    if (p.items.some((q) => q.ladderStep === undefined)) continue;
    const work = new Map(p.items.map((q) => [q.verseId, q]));
    const s = settleStale(p, work, today, queue, settings);
    if (s) settled.push(s);
    changed.push(...collectChanged(p, work));
  }
  return { changed, settled };
};

/** The passages with a firm-up on `day` ("win back a review" on Today). */
export const firmUpsFor = (queue: readonly QueueItem[], day: string): Passage[] =>
  passages(queue).filter((p) => p.items[0].firmUp?.day === day);

/**
 * Firm up: reciting the slipped verses clean on the firm-up's day gives the
 * lost review back (a held review counts, a back-one is undone). Every
 * slipped verse must be in `grades` and clean; otherwise nothing is lost
 * and it can be tried again that day. Clean verses lose their weak-spot dot
 * either way. Step drops never get a firm-up, and any later review of the
 * passage replaces it.
 */
export const winBack = (
  queue: readonly QueueItem[],
  verseId: string,
  grades: readonly { verseId: string; grade: ReviewGrade }[],
  opts: { day: string } & LadderSettings
): { changed: QueueItem[]; won: boolean; passage: Passage | null } => {
  const p = passageOf(queue, verseId);
  if (!p) return { changed: [], won: false, passage: null };
  const firmUp = p.items[0].firmUp;
  const gradeOf = new Map(grades.map((g) => [g.verseId, g.grade]));
  const work = new Map(p.items.map((q) => [q.verseId, q]));
  for (const q of p.items) {
    if (gradeOf.get(q.verseId) === 'clean' && q.slipped) {
      const next = { ...q };
      delete next.slipped;
      work.set(q.verseId, next);
    }
  }
  const won =
    !!firmUp &&
    firmUp.day === opts.day &&
    firmUp.verses.every((n) => {
      const q = p.items.find((m) => m.verseNumber === n);
      return !q || gradeOf.get(q.verseId) === 'clean';
    });
  if (won) {
    const from = passageState(p);
    const to: LadderState = { step: firmUp!.restore.step, reviews: firmUp!.restore.reviews };
    if (from.catchUp && to.step < FIRST_WEEKLY_STEP) to.catchUp = true;
    const due =
      to.step === from.step ? p.items[0].nextReviewDueDate : nextDue(to.step, anchorFor(p, queue), opts.clock, opts.now ?? new Date());
    for (const q of p.items) {
      const cur = work.get(q.verseId)!;
      work.set(q.verseId, withSchedule(cur, { state: to, due, lastSelfChecked: cur.lastSelfChecked }));
    }
  }
  return { changed: collectChanged(p, work), won, passage: p };
};

export interface SpreadDay {
  day: string;
  passages: Passage[];
}

/**
 * Welcome back: overdue passages spread over the next few days so no day's
 * reviews run past `capMinutes`, counting what's already due that day.
 * Settling first, then the most overdue. Sabbath and paused days get none.
 * A passage too long for the cap on its own still gets a day to itself.
 * Every overdue passage gets a new due date (today's too), so lateness
 * isn't counted twice. Run after lateness.
 */
export const spreadOverdue = (
  queue: readonly QueueItem[],
  capMinutes: number,
  clock: ReviewClock,
  now: Date = new Date()
): { changed: QueueItem[]; days: SpreadDay[] } => {
  const today = getLogicalDate(clock.dayStartHour, now);
  const todayKey = localDayKey(today);
  const all = passages(queue).filter((p) => p.items.every((q) => q.ladderStep !== undefined));
  const dueKey = (p: Passage) => {
    const d = p.items[0].nextReviewDueDate;
    return d ? localDayKey(new Date(d)) : null;
  };
  const overdue = all.filter((p) => {
    const k = dueKey(p);
    return k !== null && k < todayKey;
  });
  if (overdue.length === 0) return { changed: [], days: [] };

  const cost = (p: Passage) => p.items.length * REVIEW_SECONDS_PER_VERSE;
  const load = new Map<string, number>();
  for (const p of all) {
    if (overdue.includes(p)) continue;
    const k = dueKey(p) ?? todayKey;
    load.set(k, (load.get(k) ?? 0) + cost(p));
  }
  const settlingFirst = (p: Passage) => (stepInfo(passageState(p).step).group === 'settling' ? 0 : 1);
  const order = [...overdue].sort(
    (a, b) =>
      settlingFirst(a) - settlingFirst(b) ||
      new Date(a.items[0].nextReviewDueDate!).getTime() - new Date(b.items[0].nextReviewDueDate!).getTime() ||
      a.key.localeCompare(b.key)
  );

  const capSeconds = capMinutes > 0 ? capMinutes * 60 : Infinity;
  const days: SpreadDay[] = [];
  const changed: QueueItem[] = [];
  const cursor = new Date(today);
  cursor.setHours(12, 0, 0, 0);
  let offset = 0;
  const usable = (d: Date, i: number) =>
    !(clock.sabbathEnabled && DAY_ABBREVS[d.getDay()] === clock.sabbathDay) && !isDayPaused(d, i === 0, clock.pausedAt, clock.pausedUntil);
  const advance = () => {
    do {
      cursor.setDate(cursor.getDate() + 1);
      offset++;
    } while (!usable(cursor, offset) && offset < MAX_LEARNING_DAY_SCAN);
  };
  if (!usable(cursor, 0)) advance();
  let placedToday: Passage[] = [];
  const close = () => {
    if (placedToday.length > 0) days.push({ day: localDayKey(cursor), passages: placedToday });
    placedToday = [];
  };
  for (const p of order) {
    for (;;) {
      const k = localDayKey(cursor);
      const used = load.get(k) ?? 0;
      if (used + cost(p) <= capSeconds || used === 0 || offset >= MAX_LEARNING_DAY_SCAN) {
        load.set(k, used + cost(p));
        placedToday.push(p);
        const due = new Date(cursor).toISOString();
        for (const q of p.items) if (q.nextReviewDueDate !== due) changed.push({ ...q, nextReviewDueDate: due });
        break;
      }
      close();
      advance();
    }
  }
  close();
  return { changed, days };
};
