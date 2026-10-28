import { QueueItem, ReviewLog } from '../types';
import { ALL_BIBLE_BOOKS } from '../data';
import {
  DEFAULT_THOROUGHNESS,
  LADDER,
  LADDER_GROUPS,
  TOP_STEP,
  applyOutcome,
  reviewsToMoveUp,
  stepInfo,
  type LadderGroup,
  type LadderState,
  type Thoroughness,
} from './ladder';

// ============================================================================
// WHERE EACH VERSE IS ON THE LADDER
// ----------------------------------------------------------------------------
// Pure logic behind My Verses' groups, the road, and the verse page: which
// group a verse is in (Waiting, Learning, Settling, Steady, Kept), where it
// sits on the ladder's eight steps, how far through that step it is, and
// roughly when it moves up. REVIEW_LADDER_PLAN.md Part 1 §1.
//
// The step comes from `ladderStep` / `ladderReviews` on the queue item. Until
// the account is migrated (stage 3/4) those aren't there, so a reviewing verse
// without them is placed from its old daily / weekly / monthly streak by the
// same mapping the migration uses (legacyLadderState).
//
// Every date ahead is an estimate that assumes each review goes well -- the
// same promise the Memory Calendar makes. Sabbath skips and chapter anchor
// days can move the real date by a few days; the copy says "about" for that.
// ============================================================================

export type VerseStage = 'waiting' | 'learning' | 'settling' | 'steady' | 'kept' | 'secure';

export const STAGE_ORDER: VerseStage[] = ['waiting', 'learning', 'settling', 'steady', 'kept', 'secure'];

export const STAGE_LABEL: Record<VerseStage, string> = {
  waiting: 'Waiting',
  learning: 'Learning',
  settling: LADDER_GROUPS.settling.name,
  steady: LADDER_GROUPS.steady.name,
  kept: LADDER_GROUPS.kept.name,
  secure: LADDER_GROUPS.secure.name,
};

/** The reviewing groups, in ladder order. */
export const REVIEW_STAGES: readonly LadderGroup[] = ['settling', 'steady', 'kept', 'secure'];

export interface StagePlan {
  /** Perfect recalls that move a verse out of Learning. */
  masteryTouches: number;
  /** Review thoroughness (Settings > Reviews). Standard until the setting lands. */
  thoroughness?: Thoroughness;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/**
 * Where an unmigrated reviewing verse sits, from its old streak (the stage 3
 * mapping in REVIEW_LADDER_PLAN.md): daily d -> Every day (d < 7), Every 2
 * days (d < 11), Every 4 days (d < 15), else Every week; weekly w -> Every
 * week (w < 8), Every 2 weeks (w < 14), else Every 4 weeks; monthly m ->
 * Every 4 weeks (m < 12), Every 8 weeks (m < 18), else Every 6 months;
 * retained -> Every 6 months. An active refresher uses its return place.
 */
export function legacyLadderState(item: QueueItem): LadderState {
  if (item.status === 'retained') return { step: TOP_STEP, reviews: 0 };
  const refreshing = item.refresherActive && item.refresherReturnPhase;
  const phase = refreshing ? item.refresherReturnPhase : item.retentionPhase;
  const n = Math.max(0, refreshing ? item.refresherReturnProgress || 1 : item.currentStreakCount || 0);
  if (phase === 'weekly') {
    if (n < 8) return { step: 3, reviews: n };
    if (n < 14) return { step: 4, reviews: n - 8 };
    return { step: 5, reviews: 0 };
  }
  if (phase === 'monthly') {
    if (n < 12) return { step: 5, reviews: n };
    if (n < 18) return { step: 6, reviews: n - 12 };
    return { step: TOP_STEP, reviews: 0 };
  }
  if (n < 7) return { step: 0, reviews: n };
  if (n < 11) return { step: 1, reviews: n - 7 };
  if (n < 15) return { step: 2, reviews: n - 11 };
  return { step: 3, reviews: 0 };
}

export const verseStage = (item: QueueItem): VerseStage => {
  if (item.status === 'retained') return 'secure';
  if (item.status === 'queued') return 'waiting';
  if (item.status === 'learning' || (item.ladderStep === undefined && item.retentionPhase === 'none')) return 'learning';
  return LADDER[ladderPlace(item)!.step].group;
};

/** The ladder place of a verse past Learning; null while it is Waiting or Learning. */
export function ladderPlace(item: QueueItem): LadderState | null {
  if (item.status === 'queued' || item.status === 'learning') return null;
  if (item.ladderStep === undefined && item.status !== 'retained' && item.retentionPhase === 'none') return null;
  if (item.ladderStep === undefined) return legacyLadderState(item);
  const step = Math.min(TOP_STEP, Math.max(0, Math.floor(item.ladderStep)));
  return item.catchUp && step < 3
    ? { step, reviews: item.ladderReviews ?? 0, catchUp: true }
    : { step, reviews: item.ladderReviews ?? 0 };
}

/** On the top step: Every 6 months, for good. */
export const isTopStep = (item: QueueItem): boolean => ladderPlace(item)?.step === TOP_STEP;

export interface StageProgress {
  stage: VerseStage;
  /** Ladder step 0-7 for a verse past Learning, else null. */
  step: number | null;
  /** On the top step (Every 6 months). */
  top: boolean;
  /** The short catch-up after joining a passage is running. */
  catchUp: boolean;
  /** How far through the current step, 0-1. The top step is always full. */
  fraction: number;
  /** "Every 2 weeks, 3 of 6 reviews", "2 of 3 practices". Empty for waiting. */
  position: string;
  /** Reviews (or practices) still needed before it moves up. */
  remaining: number;
  /** Estimated day it moves up a step, if every review goes well. Null at the top or when unknown. */
  movesUpOn: Date | null;
  /** Arrived on this step recently (its first review ahead). */
  justMovedUp: boolean;
  /** Slipped in its passage's last review: the weak-spot dot. */
  slipped: boolean;
  /** Learning only: practices banked out of those needed, for the dots. */
  steps?: { done: number; total: number };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function stageProgress(item: QueueItem, plan: StagePlan, today: Date = new Date()): StageProgress {
  const stage = verseStage(item);
  const base: StageProgress = {
    stage,
    step: null,
    top: false,
    catchUp: false,
    fraction: 0,
    position: '',
    remaining: 0,
    movesUpOn: null,
    justMovedUp: false,
    slipped: !!item.slipped,
  };

  if (stage === 'waiting') return base;

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

  const place = ladderPlace(item)!;
  const info = stepInfo(place.step);
  const top = !!info.top;
  if (top) {
    return { ...base, step: place.step, top: true, fraction: 1, position: `${info.label}, for good`, justMovedUp: place.reviews === 0 && item.status !== 'retained' };
  }

  const thoroughness = plan.thoroughness ?? DEFAULT_THOROUGHNESS;
  const need = reviewsToMoveUp(place, thoroughness) ?? 1;
  const done = clamp(place.reviews, 0, need);
  const remaining = need - done;
  const next = item.nextReviewDueDate ? new Date(item.nextReviewDueDate) : null;
  // The review that brings the count up to the target is the one that moves
  // it up, so it lands (remaining - 1) steps' intervals after the next due date.
  const movesUpOn = next && remaining > 0 ? addDays(next, (remaining - 1) * info.intervalDays) : null;
  const justMovedUp =
    place.step === 0
      ? !!item.dateStarted && today.getTime() - new Date(item.dateStarted).getTime() < 7 * DAY_MS
      : place.reviews === 0;

  return {
    ...base,
    step: place.step,
    catchUp: !!place.catchUp,
    fraction: need > 0 ? done / need : 0,
    position: `${info.label}, ${done} of ${need} reviews`,
    remaining,
    movesUpOn,
    justMovedUp,
  };
}

/**
 * Estimated arrival at each step still ahead of the verse (index = step; null
 * for steps it has passed or is on), if every review goes well. Plays the
 * engine's own applyOutcome forward, so catch-up and thoroughness count. A
 * Learning verse is placed at Every day tomorrow; Waiting gets none.
 */
export function ladderEstimates(item: QueueItem, plan: StagePlan, today: Date = new Date()): (Date | null)[] {
  const out: (Date | null)[] = LADDER.map(() => null);
  const stage = verseStage(item);
  if (stage === 'waiting') return out;
  const thoroughness = plan.thoroughness ?? DEFAULT_THOROUGHNESS;

  let state: LadderState;
  let date: Date | null;
  if (stage === 'learning') {
    state = { step: 0, reviews: 0 };
    date = addDays(today, 1);
    out[0] = date;
  } else {
    state = ladderPlace(item)!;
    date = item.nextReviewDueDate ? new Date(item.nextReviewDueDate) : null;
  }
  if (!date) return out;

  for (let i = 0; i < 400 && state.step < TOP_STEP; i++) {
    const after = applyOutcome(state, 'up', thoroughness);
    if (after.step > state.step) out[after.step] = date;
    date = addDays(date, stepInfo(after.step).intervalDays);
    state = after;
  }
  return out;
}

/** Estimated arrival at each group still ahead (its first step), same promise as ladderEstimates. */
export function roadEstimates(item: QueueItem, plan: StagePlan, today: Date = new Date()): Partial<Record<VerseStage, Date>> {
  const steps = ladderEstimates(item, plan, today);
  const out: Partial<Record<VerseStage, Date>> = {};
  const current = verseStage(item);
  if (current === 'learning' && steps[0]) out.settling = steps[0];
  for (const group of REVIEW_STAGES) {
    if (STAGE_ORDER.indexOf(group) <= STAGE_ORDER.indexOf(current)) continue;
    const first = LADDER.findIndex((s) => s.group === group);
    if (steps[first]) out[group] = steps[first]!;
  }
  return out;
}

/** The group an old review-log stage (daily / weekly / monthly) belongs to. */
export const LOG_STAGE: Record<ReviewLog['stage'], VerseStage> = {
  learning: 'learning',
  daily: 'settling',
  weekly: 'steady',
  monthly: 'kept',
  retained: 'secure',
};

/**
 * When the verse reached each group it has passed, read from its review log.
 * The log only goes back to 2026-09-26, so older verses have gaps -- a stop
 * with no entry here simply shows no date. Old logs name daily / weekly /
 * monthly, which are the Settling / Steady / Kept groups' ancestors.
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
  // Moving up to the first review step stamps dateStarted, which predates the log for older verses.
  if (!out.settling && item.dateStarted && rank(current) >= rank('settling')) out.settling = new Date(item.dateStarted);
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
  /** Learning rows only: "Joins verses 1–20 when it moves up", when it sits next to a passage. */
  joins?: string;
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
  [p.stage, p.step ?? '', p.position, p.remaining, p.catchUp ? 'c' : '', item.nextReviewDueDate?.slice(0, 10) ?? '', item.origin || 'individual'].join('|');

/** "Romans 8:1–20" (en dash, like the rest of the ladder copy); one verse reads "Romans 8:1". */
export const referenceFor = (book: string, chapter: number, verses: number[]) =>
  `${book} ${chapter}:${verses[0]}${verses.length > 1 ? `–${verses[verses.length - 1]}` : ''}`;

/** "verse 5" / "verses 1–20". */
export const versesWord = (start: number, end: number) => (start === end ? `verse ${start}` : `verses ${start}–${end}`);

/** An unbroken run of verses past Learning in one chapter and translation: a passage. */
export interface PassageRun {
  book: string;
  chapter: number;
  translationId: string;
  start: number;
  end: number;
}

/** Every passage in the list, in Bible order. Display-side twin of passages.ts, which needs a migrated queue. */
export function passageRuns(queue: QueueItem[]): PassageRun[] {
  // Bucket by chapter and translation first: two translations of the same
  // verses interleave when sorted by verse number, and are separate passages.
  const buckets = new Map<string, QueueItem[]>();
  for (const q of queue) {
    if (ladderPlace(q) === null) continue;
    const key = `${q.book}|${q.chapter}|${q.translationId || 'ESV'}`;
    const list = buckets.get(key);
    if (list) list.push(q);
    else buckets.set(key, [q]);
  }
  const out: PassageRun[] = [];
  for (const list of buckets.values()) {
    const verses = [...new Set(list.map((q) => q.verseNumber))].sort((x, y) => x - y);
    const { book, chapter } = list[0];
    const translationId = list[0].translationId || 'ESV';
    let run: PassageRun | null = null;
    for (const v of verses) {
      if (run && v === run.end + 1) run.end = v;
      else out.push((run = { book, chapter, translationId, start: v, end: v }));
    }
  }
  return out.sort((x, y) => bookIndex(x.book) - bookIndex(y.book) || x.chapter - y.chapter || x.start - y.start || x.translationId.localeCompare(y.translationId));
}

/**
 * Every verse except Waiting ones (My Verses keeps its own drag-to-reorder
 * list for those), grouped into runs of neighbouring verses at the same point
 * on the ladder -- a passage, once a migrated account keeps its members in
 * step -- then bucketed by group. Review groups list the passage closest to
 * moving up first (higher steps first on a tie); Learning keeps queue order;
 * Kept's top step reads in Bible order after the rest.
 */
export function groupByStage(queue: QueueItem[], plan: StagePlan, today: Date = new Date()): Record<VerseStage, StageGroup[]> {
  const out: Record<VerseStage, StageGroup[]> = { waiting: [], learning: [], settling: [], steady: [], kept: [], secure: [] };
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

  // A Learning row next to a passage says it will join it when it moves up.
  if (out.learning.length > 0) {
    const runs = passageRuns(queue);
    for (const g of out.learning) {
      const first = g.verses[0];
      const last = g.verses[g.verses.length - 1];
      const near = runs.filter(
        (r) => r.book === g.book && r.chapter === g.chapter && r.translationId === g.translationId && (r.end === first - 1 || r.start === last + 1)
      );
      if (near.length === 0) continue;
      const where = near.map((r) => versesWord(r.start, r.end));
      g.joins = near.length > 1 ? `Joins ${where[0]} and ${where[1].replace(/^verses? /, '')} into one passage when it moves up` : `Joins ${where[0]} when it moves up`;
    }
  }

  const minOrder = (g: StageGroup) => Math.min(...g.items.map((i) => i.orderIndex));
  out.learning.sort((a, b) => minOrder(a) - minOrder(b));
  for (const stage of REVIEW_STAGES) {
    // The top step is done climbing: after the rest, in Bible order (already sorted).
    out[stage].sort((a, b) => Number(a.progress.top) - Number(b.progress.top) || (a.progress.top ? 0 : a.progress.remaining - b.progress.remaining || (b.progress.step ?? 0) - (a.progress.step ?? 0)));
  }
  return out;
}

/** Verse count per stage, for the strip across the top of My Verses. */
export function stageCounts(queue: QueueItem[]): Record<VerseStage, number> {
  const out: Record<VerseStage, number> = { waiting: 0, learning: 0, settling: 0, steady: 0, kept: 0, secure: 0 };
  for (const item of queue) out[verseStage(item)]++;
  return out;
}

/**
 * "Verses 3–4 aren't on your list, so verses 1–2 and 5 are reviewed as
 * separate passages." One line per gap between two passages in a chapter (the
 * first two). When every gap verse is already on the list (Waiting or
 * Learning), it says they join once learned instead. `runs` are one
 * chapter's passages, in verse order.
 */
export function passageGapNotes(runs: PassageRun[], onList: (verse: number) => boolean): string[] {
  const notes: string[] = [];
  for (let i = 1; i < runs.length && notes.length < 2; i++) {
    const a = runs[i - 1];
    const b = runs[i];
    if (a.translationId !== b.translationId) continue;
    const gapStart = a.end + 1;
    const gapEnd = b.start - 1;
    let allOn = true;
    for (let v = gapStart; v <= gapEnd; v++) if (!onList(v)) allOn = false;
    const gap = versesWord(gapStart, gapEnd);
    const lead = `${gap[0].toUpperCase()}${gap.slice(1)}`;
    const both = `${versesWord(a.start, a.end)} and ${b.start === b.end ? b.start : `${b.start}–${b.end}`}`;
    notes.push(
      allOn
        ? `${lead} ${gapStart === gapEnd ? 'is' : 'are'} on the way. Once learned, ${both} join into one passage.`
        : `${lead} ${gapStart === gapEnd ? "isn't" : "aren't"} on your list, so ${both} are reviewed as separate passages.`
    );
  }
  return notes;
}
