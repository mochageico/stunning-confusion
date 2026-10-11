import { QueueItem } from '../types';
import { buildSwapVerses, chunkIntoPhrases, pickThreadCue, threadCueKey, ThreadCue } from './drills';
import { scriptOfVerse, splitWords } from './textScript';

// ============================================================================
// GUIDED LEARNING -- PURE LOGIC
// ----------------------------------------------------------------------------
// Everything Guided learning decides lives here: which drill, which rung,
// what a miss costs, which verses get a cold check or a stitch, and whether a
// result banks a run. No React, no Firestore -- same pattern as drills.ts.
// The screen only renders sessionReducer's state and reports what happened.
// Every random choice takes `rng: () => number` so the checks are repeatable.
// ============================================================================

export const GUIDED_LONG_VERSE_WORDS = 25;
/** Share of words hidden on the partly hidden recitation. */
export const GUIDED_PARTLY_HIDDEN = 0.6;
/** A missed graded recitation drops this many rungs. */
export const GUIDED_DROP_BACK = 2;
/** Real misses on one verse before it is set aside. */
export const GUIDED_SET_ASIDE_AFTER = 3;
/** A stitch window longer than this (in words) shrinks to 2 verses. */
export const GUIDED_MAX_STITCH_WORDS = 120;
export const GUIDED_MAX_STITCH_VERSES = 3;
/** Stitches that fail back to back before the sitting moves on. */
export const GUIDED_MAX_STITCH_FAILS = 2;
/** Shortest gap between banked runs (matches validateTouch). */
export const GUIDED_TOUCH_GAP_MS = 60 * 60 * 1000;
export const GUIDED_WITHIN_HOUR_LABEL = 'Counted toward learning within the last hour';

type Rng = () => number;

/** A queue item. guidedSetAside lives on QueueItem itself (src/types.ts). */
export type GuidedItem = QueueItem;

/** The verse shape drills.ts takes. */
export interface GuidedDrillVerse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  translationId?: string;
}

export const toDrillVerse = (item: QueueItem): GuidedDrillVerse => ({
  book: item.book,
  chapter: item.chapter,
  verse: item.verseNumber,
  text: item.text,
  translationId: item.translationId,
});

const wordCount = (v: GuidedDrillVerse): number => splitWords(v.text, scriptOfVerse(v)).length;

// ============================================================================
// 1. PASSAGES AND FINISHED VERSES
// ============================================================================

export interface Passage {
  /** Stable id: translation, book, chapter and first verse. */
  key: string;
  book: string;
  chapter: number;
  translationId: string;
  /** Sorted by verse number, consecutive. */
  items: GuidedItem[];
}

/**
 * Queue items with the same book, chapter and translation, in runs of
 * consecutive verse numbers. A gap splits one chapter into two passages.
 * Queued (not yet started) verses are included: they are what "Keep going"
 * pulls in, and they keep a gap from being mistaken for a missing verse.
 */
export const buildPassages = (queue: GuidedItem[]): Passage[] => {
  const groups = new Map<string, GuidedItem[]>();
  queue.forEach((item) => {
    const k = `${item.translationId || ''}|${item.book}|${item.chapter}`;
    const g = groups.get(k);
    if (g) g.push(item);
    else groups.set(k, [item]);
  });

  const passages: Passage[] = [];
  groups.forEach((group) => {
    const sorted = [...group].sort((a, b) => a.verseNumber - b.verseNumber);
    let run: GuidedItem[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const first = run[0];
      passages.push({
        key: `${first.translationId || ''}|${first.book}|${first.chapter}|${first.verseNumber}`,
        book: first.book,
        chapter: first.chapter,
        translationId: first.translationId,
        items: run,
      });
      run = [];
    };
    sorted.forEach((item) => {
      const prev = run[run.length - 1];
      if (prev && item.verseNumber !== prev.verseNumber + 1) flush();
      // Two items for one verse number (a data oddity) stay in one run.
      run.push(item);
    });
    flush();
  });

  const firstOrder = (p: Passage) => Math.min(...p.items.map((i) => i.orderIndex));
  return passages.sort((a, b) => firstOrder(a) - firstOrder(b));
};

/** One or more banked runs, or already past Learning. */
export const isFinishedVerse = (item: QueueItem): boolean =>
  (item.touchLogs?.length ?? 0) >= 1 || item.status === 'reviewing' || item.status === 'retained';

export const runsBanked = (item: QueueItem): number => item.touchLogs?.length ?? 0;

const lastTouchTime = (item: QueueItem): number | null => {
  const logs = item.touchLogs;
  if (!logs || logs.length === 0) return null;
  return new Date(logs[logs.length - 1].timestamp).getTime();
};

/** Mirrors validateTouch in useAppState.ts, but with an explicit clock. */
export const touchAllowed = (item: QueueItem, now: number): boolean => {
  const last = lastTouchTime(item);
  return last === null || now - last >= GUIDED_TOUCH_GAP_MS;
};

// ============================================================================
// 2. DRILLS AND THE LADDER
// ============================================================================

export type GuidedDrillId = 'buildUp' | 'scramble' | 'swap' | 'firstLetters';
export type RungKind = 'read' | 'lookUp' | 'drill' | 'partly' | 'fully';

export interface Rung {
  kind: RungKind;
  /** Only on drill rungs. */
  drill?: GuidedDrillId;
}

export interface Ladder {
  rungs: Rung[];
  pos: number;
  misses: number;
  /** Activities completed (re-rolls excluded). */
  activities: number;
  status: 'climbing' | 'finished' | 'setAside';
  /** Drills that work for this verse. */
  eligible: GuidedDrillId[];
  /** The drill the previous verse ended on; avoided where possible. */
  avoid?: GuidedDrillId;
  /** Partly hidden passed and nothing missed since. */
  passedPartly: boolean;
  /** "I know this one": jumped straight to the fully hidden rung. */
  knowIt: boolean;
}

export type LadderEvent = 'done' | 'pass' | 'miss' | 'reroll' | 'knowIt' | 'easier';

/** Drills that work inside a single verse. Jigsaw and threads are stitch-only. */
export const eligibleDrills = (verse: GuidedDrillVerse, passageVerses: GuidedDrillVerse[]): GuidedDrillId[] => {
  const script = scriptOfVerse(verse);
  const out: GuidedDrillId[] = [];
  if (wordCount(verse) >= 8) out.push('buildUp');
  if (chunkIntoPhrases(verse.text, script).length >= 3) out.push('scramble');
  const pool = passageVerses.some((v) => v.verse === verse.verse && v.chapter === verse.chapter && v.book === verse.book)
    ? passageVerses
    : [...passageVerses, verse];
  const id = `${verse.book}-${verse.chapter}-${verse.verse}`;
  const swap = buildSwapVerses(pool).find((sv) => sv.id === id);
  if (swap && swap.tokens.some((t) => t.isDecoy)) out.push('swap');
  out.push('firstLetters');
  return out;
};

/**
 * One drill id. Prefers a drill not yet used on this verse, not the one the
 * previous verse ended on, and not `current` (the one being replaced). If that
 * leaves nothing it relaxes the previous-verse rule, then the used rule; it
 * only repeats `current` when nothing else exists.
 */
export const pickDrill = (
  eligible: GuidedDrillId[],
  usedThisVerse: ReadonlySet<GuidedDrillId> | GuidedDrillId[],
  lastOnPrevVerse: GuidedDrillId | undefined,
  current: GuidedDrillId | undefined,
  rng: Rng
): GuidedDrillId => {
  const used = new Set(usedThisVerse);
  const tiers: ((d: GuidedDrillId) => boolean)[] = [
    (d) => !used.has(d) && d !== lastOnPrevVerse && d !== current,
    (d) => !used.has(d) && d !== current,
    (d) => d !== current,
    () => true,
  ];
  for (const ok of tiers) {
    const pool = eligible.filter(ok);
    if (pool.length > 0) return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  }
  return 'firstLetters';
};

const firstDrillIndex = 2;

/** Picks drills for every drill rung from `fromPos` up, keeping the ones below. */
const pickDrillRungs = (rungs: Rung[], fromPos: number, eligible: GuidedDrillId[], avoid: GuidedDrillId | undefined, rng: Rng): Rung[] => {
  const next = rungs.map((r) => ({ ...r }));
  const used = new Set<GuidedDrillId>();
  next.forEach((r, i) => {
    if (r.kind === 'drill' && i < fromPos && r.drill) used.add(r.drill);
  });
  next.forEach((r, i) => {
    if (r.kind !== 'drill' || i < fromPos) return;
    const picked = pickDrill(eligible, used, avoid, r.drill, rng);
    r.drill = picked;
    used.add(picked);
  });
  return next;
};

/** Read, Look up, 2-3 drills, Partly hidden, Fully hidden. */
export const createLadder = (
  verse: GuidedDrillVerse,
  passageVerses: GuidedDrillVerse[],
  ctx: { lastDrill?: GuidedDrillId },
  rng: Rng
): Ladder => {
  const eligible = eligibleDrills(verse, passageVerses);
  const drillCount = wordCount(verse) >= GUIDED_LONG_VERSE_WORDS ? 3 : 2;
  const skeleton: Rung[] = [
    { kind: 'read' },
    { kind: 'lookUp' },
    ...Array.from({ length: drillCount }, () => ({ kind: 'drill' as const })),
    { kind: 'partly' },
    { kind: 'fully' },
  ];
  return {
    rungs: pickDrillRungs(skeleton, 0, eligible, ctx.lastDrill, rng),
    pos: 0,
    misses: 0,
    activities: 0,
    status: 'climbing',
    eligible,
    avoid: ctx.lastDrill,
    passedPartly: false,
    knowIt: false,
  };
};

export const currentRung = (ladder: Ladder): Rung => ladder.rungs[ladder.pos];
export const isGradedRung = (rung: Rung): boolean => rung.kind === 'partly' || rung.kind === 'fully';

/** The drill the verse ended on, so the next verse can avoid it. */
export const lastDrillOf = (ladder: Ladder): GuidedDrillId | undefined => {
  for (let i = ladder.rungs.length - 1; i >= 0; i--) if (ladder.rungs[i].kind === 'drill') return ladder.rungs[i].drill;
  return undefined;
};

/**
 * The next ladder. `done` ends a non-graded rung; `pass`/`miss` report a
 * graded one (the screen decides a miss only when the user taps Continue,
 * after any tap-to-correct); `reroll` swaps the current drill without
 * counting an activity; `knowIt` (Read rung only) jumps to the fully hidden
 * recitation.
 */
export const ladderAfter = (ladder: Ladder, event: LadderEvent, rng: Rng): Ladder => {
  if (ladder.status !== 'climbing') return ladder;
  const rung = currentRung(ladder);

  if (event === 'knowIt') {
    if (rung.kind !== 'read') return ladder;
    return { ...ladder, pos: ladder.rungs.length - 1, knowIt: true };
  }

  if (event === 'easier') {
    // Asked for before reciting: one rung down, never a miss or an activity.
    if (!isGradedRung(rung)) return ladder;
    if (ladder.knowIt) {
      // Backing out of "I know this one" lands on the partly hidden rung.
      return { ...ladder, pos: ladder.rungs.length - 2, knowIt: false, passedPartly: false };
    }
    const pos = Math.max(firstDrillIndex, ladder.pos - 1);
    return {
      ...ladder,
      // Back onto a drill: a fresh one, so it doesn't feel like a replay.
      rungs: ladder.rungs[pos].kind === 'drill' ? pickDrillRungs(ladder.rungs, pos, ladder.eligible, ladder.avoid, rng) : ladder.rungs,
      pos,
      passedPartly: false,
    };
  }

  if (event === 'reroll') {
    if (rung.kind !== 'drill') return ladder;
    const used = new Set<GuidedDrillId>();
    ladder.rungs.forEach((r, i) => {
      if (r.kind === 'drill' && i !== ladder.pos && r.drill) used.add(r.drill);
    });
    const picked = pickDrill(ladder.eligible, used, ladder.avoid, rung.drill, rng);
    const rungs = ladder.rungs.map((r, i) => (i === ladder.pos ? { ...r, drill: picked } : r));
    return { ...ladder, rungs };
  }

  if (event === 'done') {
    if (isGradedRung(rung)) return ladder;
    return { ...ladder, pos: ladder.pos + 1, activities: ladder.activities + 1 };
  }

  if (!isGradedRung(rung)) return ladder;

  if (event === 'pass') {
    const activities = ladder.activities + 1;
    if (rung.kind === 'partly') return { ...ladder, pos: ladder.pos + 1, activities, passedPartly: true };
    // Fully hidden. Finishing needs partly then fully with no miss between,
    // or the "I know this one" shortcut.
    if (ladder.passedPartly || ladder.knowIt) return { ...ladder, activities, status: 'finished' };
    return ladder;
  }

  // miss
  if (ladder.knowIt) {
    // The shortcut was a gamble, not a failure: no miss counted.
    return { ...ladder, pos: 0, knowIt: false, passedPartly: false, activities: ladder.activities + 1 };
  }
  const misses = ladder.misses + 1;
  const activities = ladder.activities + 1;
  if (misses >= GUIDED_SET_ASIDE_AFTER) return { ...ladder, misses, activities, status: 'setAside', passedPartly: false };
  const pos = Math.max(firstDrillIndex, ladder.pos - GUIDED_DROP_BACK);
  return {
    ...ladder,
    rungs: pickDrillRungs(ladder.rungs, pos, ladder.eligible, ladder.avoid, rng),
    pos,
    misses,
    activities,
    passedPartly: false,
  };
};

// ============================================================================
// 3. COLD CHECKS, STITCH AND THREAD
// ============================================================================

export interface ColdCheckQueue {
  /** Oldest last run first. */
  ready: GuidedItem[];
  waiting: { item: GuidedItem; minutesLeft: number }[];
}

/** Learning verses with at least one run but not yet at the mastery count. */
export const coldCheckQueue = (items: GuidedItem[], now: number, masteryTouches: number): ColdCheckQueue => {
  const ready: { item: GuidedItem; last: number }[] = [];
  const waiting: { item: GuidedItem; minutesLeft: number }[] = [];
  items.forEach((item) => {
    const runs = runsBanked(item);
    if (item.status !== 'learning' || runs < 1 || runs >= masteryTouches) return;
    const last = lastTouchTime(item) ?? 0;
    const elapsed = now - last;
    if (elapsed >= GUIDED_TOUCH_GAP_MS) ready.push({ item, last });
    else waiting.push({ item, minutesLeft: Math.ceil((GUIDED_TOUCH_GAP_MS - elapsed) / 60000) });
  });
  return { ready: ready.sort((a, b) => a.last - b.last).map((r) => r.item), waiting };
};

const sortedByVerse = (items: GuidedItem[]) => [...items].sort((a, b) => a.verseNumber - b.verseNumber);

/**
 * The unbroken run of finished verses ending at the newest finished one.
 * `extraFinished` holds verse ids finished earlier in this sitting that have
 * no banked run yet (the hour rule stopped the credit).
 */
export const finishedRun = (items: GuidedItem[], extraFinished?: ReadonlySet<string>): GuidedItem[] => {
  const sorted = sortedByVerse(items);
  const isFin = (i: GuidedItem) => isFinishedVerse(i) || !!extraFinished?.has(i.verseId);
  let newest = -1;
  sorted.forEach((it, idx) => {
    if (isFin(it)) newest = idx;
  });
  if (newest < 0) return [];
  const run: GuidedItem[] = [];
  for (let i = newest; i >= 0 && isFin(sorted[i]); i--) {
    if (run.length > 0 && sorted[i].verseNumber !== run[0].verseNumber - 1) break;
    run.unshift(sorted[i]);
  }
  return run;
};

/**
 * Up to 3 consecutive finished verses ending at the newest finished one.
 * Needs 2+; shrinks to 2 when the words pass GUIDED_MAX_STITCH_WORDS.
 */
export const stitchWindow = (items: GuidedItem[], extraFinished?: ReadonlySet<string>): GuidedItem[] => {
  const run = finishedRun(items, extraFinished);
  let window = run.slice(-GUIDED_MAX_STITCH_VERSES);
  if (window.length > 2 && window.reduce((n, v) => n + wordCount(toDrillVerse(v)), 0) > GUIDED_MAX_STITCH_WORDS) {
    window = window.slice(-2);
  }
  return window.length >= 2 ? window : [];
};

const trimCueWord = (word: string) => word.replace(/^["'‘“(\[]+/, '').replace(/[,;:.!?—–"'’”)\]]+$/, '');

/** A stitch recites the whole window, cued at word 0 of its first verse. */
export const stitchCue = (window: GuidedDrillVerse[]): ThreadCue => {
  const first = window[0];
  const words = splitWords(first.text, scriptOfVerse(first));
  return { startVerse: 0, startWord: 0, endVerse: window.length - 1, cueWords: words.slice(0, 2).map(trimCueWord) };
};

/**
 * After a slipped stitch: a cue that starts in the second half of the verse
 * before `slipIndex` and runs through the slipped verse. Falls back to any
 * cue ending there (including inside the slipped verse when it is first).
 */
export const seamCue = (verses: GuidedDrillVerse[], slipIndex: number, rng: Rng): ThreadCue | null => {
  if (slipIndex <= 0) return pickThreadCue(verses, slipIndex, { random: rng });
  const before = verses[slipIndex - 1];
  const half = Math.ceil(wordCount(before) / 2);
  const used = new Set<string>();
  let fallback: ThreadCue | null = null;
  for (let i = 0; i < 40; i++) {
    const cue = pickThreadCue(verses, slipIndex, { fromVerse: slipIndex - 1, used, random: rng });
    if (!cue) break;
    if (cue.startVerse === slipIndex - 1 && cue.startWord >= half) return cue;
    fallback = fallback ?? cue;
    const key = threadCueKey(cue);
    if (used.has(key)) break;
    used.add(key);
  }
  return fallback;
};

/** A thread cue that ends at the newest verse and starts before the stitch window, or null. */
export const reachCue = (run: GuidedDrillVerse[], windowStart: number, rng: Rng): ThreadCue | null => {
  if (windowStart <= 0 || run.length < 2) return null;
  const cue = pickThreadCue(run, run.length - 1, { beforeVerse: windowStart, random: rng });
  return cue && cue.startVerse < windowStart ? cue : null;
};

/** Set-aside verses first, then the lowest verse number, among 0-run Learning verses. */
export const nextNewVerse = (items: GuidedItem[], exclude?: ReadonlySet<string>): GuidedItem | null => {
  const open = items.filter((i) => i.status === 'learning' && runsBanked(i) === 0 && !exclude?.has(i.verseId));
  if (open.length === 0) return null;
  return [...open].sort((a, b) => {
    const sa = a.guidedSetAside ? 0 : 1;
    const sb = b.guidedSetAside ? 0 : 1;
    return sa - sb || a.verseNumber - b.verseNumber;
  })[0];
};

/** Verses whose first run landed on today's logical date: the pace-stop count. */
export const newVersesFinishedToday = (
  items: QueueItem[],
  logicalToday: string,
  toLogicalDate: (iso: string) => string
): number =>
  items.filter((i) => {
    if (i.status === 'queued') return false;
    const first = i.touchLogs?.[0];
    return !!first && toLogicalDate(first.timestamp) === logicalToday;
  }).length;

// ============================================================================
// 4. CREDIT
// ============================================================================

export type GuidedActivity = 'fully' | 'partly' | 'refresh' | 'cold' | 'knowIt' | 'stitch' | 'thread' | 'seam';
export type GuidedAnswerMode = 'speak' | 'type' | 'self';

export interface GuidedOutcome {
  activity: GuidedActivity;
  /** accuracy >= REVIEW_PASS_ACCURACY. Ladder activities are all-or-nothing; pass perfect for both. */
  passed: boolean;
  /** summarizeOutcomes().isPerfect: no missed words (near-misses allowed). */
  perfect: boolean;
  mode: GuidedAnswerMode;
  /** Threads only: the cue landed past half of this (the start) verse. */
  startsPastHalf?: boolean;
}

export interface GuidedCreditCtx {
  now: number;
  reviewsPaused: boolean;
  /** isReviewDue from useAppState. */
  isDue: (dueDateISO: string | null) => boolean;
  /** verseIds already credited in this sitting. */
  credited: ReadonlySet<string>;
}

export interface GuidedCredit {
  kind: 'touch' | 'review' | null;
  label: string;
}

/**
 * Whether a result banks a run (touch) or a review, and why or why not. A
 * pure copy of decide() in ThreadDrillScreen, plus: the partly hidden rung
 * (words shown) and refresh recitations (verse just seen) never credit.
 */
export const guidedCredit = (item: QueueItem, outcome: GuidedOutcome, ctx: GuidedCreditCtx): GuidedCredit => {
  if (outcome.activity === 'partly') return { kind: null, label: 'Words were shown, so this one doesn’t count' };
  if (outcome.activity === 'refresh') return { kind: null, label: 'You just saw it, so this one doesn’t count' };
  if (outcome.startsPastHalf) return { kind: null, label: 'Started past halfway, so not counted' };
  if (!outcome.passed) return { kind: null, label: 'Under 90%, so no credit and no penalty' };
  if (ctx.credited.has(item.verseId)) return { kind: null, label: 'Already counted this session' };
  if (item.status === 'learning') {
    if (outcome.mode === 'self') return { kind: null, label: 'Learning a verse needs it graded, not self-checked' };
    if (!outcome.perfect) return { kind: null, label: 'Learning a verse needs every word right' };
    if (!touchAllowed(item, ctx.now)) return { kind: null, label: GUIDED_WITHIN_HOUR_LABEL };
    return { kind: 'touch', label: 'Counts toward learning' };
  }
  if (item.status === 'reviewing') {
    if (ctx.reviewsPaused) return { kind: null, label: 'Reviews are paused, so practice only' };
    if (!ctx.isDue(item.nextReviewDueDate)) return { kind: null, label: 'Not due yet, so practice only' };
    return { kind: 'review', label: outcome.mode === 'self' ? 'Counts as a review, checked by you' : 'Counts as a review' };
  }
  return { kind: null, label: item.status === 'retained' ? 'Retained, so practice only' : 'Not started, so practice only' };
};

// ============================================================================
// 5. THE SITTING
// ----------------------------------------------------------------------------
// Cold checks, then an opening stitch, then a thread, then new verses -- each
// followed by its own stitch and thread. The state holds no verse text, only
// ids and ladders; `env` carries the live queue items (read fresh from
// memoryQueueRef by the screen on every dispatch) so a run banked a moment ago
// is already visible here.
// ============================================================================

export type GuidedStep =
  | { kind: 'opening' }
  | { kind: 'cold'; verseId: string; stage: 'recite' | 'refreshDrill' | 'refreshRecite'; drill?: GuidedDrillId }
  | { kind: 'stitch'; verseIds: string[]; stage: 'jigsaw' | 'recite'; fails: number; cue: ThreadCue }
  | { kind: 'seam'; verseIds: string[]; cue: ThreadCue; fails: number }
  | { kind: 'thread'; verseIds: string[]; cue: ThreadCue }
  | { kind: 'ladder'; verseId: string; ladder: Ladder }
  | { kind: 'doneToday' }
  | { kind: 'summary' };

export interface SessionLogEntry {
  step: 'cold' | 'refresh' | 'stitch' | 'seam' | 'thread' | 'ladder';
  verseIds: string[];
  perfect: boolean;
}

export interface SessionState {
  step: GuidedStep;
  /** Verse ids still waiting for a cold check, in order. */
  coldQueue: string[];
  /** New verses the sitting may still start; Keep going adds one. */
  budget: number;
  /** New verses finished this sitting. */
  newDone: number;
  /** Stitches completed; every second 3-verse stitch gets a jigsaw warm-up. */
  stitchCount: number;
  lastDrill?: GuidedDrillId;
  usedCues: string[];
  /** Verses that finished their ladder this sitting (credited or not). */
  finishedThisSitting: string[];
  /** Verses set aside this sitting. The screen persists guidedSetAside for each. */
  setAside: string[];
  log: SessionLogEntry[];
}

export interface SessionEnv {
  /** The passage's current queue items. */
  items: GuidedItem[];
  now: number;
  masteryTouches: number;
  /** New verses allowed this sitting by the schedule (0 on a non-learning day). */
  pace: number;
  /** New verses already finished today before this sitting. */
  newToday: number;
  /** Jigsaw warm-up before every second 3-verse stitch (a setting; default on). */
  jigsawWarmUp?: boolean;
  rng: Rng;
}

export type SessionEvent =
  | { type: 'begin' }
  /** A non-graded step ended: jigsaw, refresh drill, ladder rung. */
  | { type: 'next' }
  /** A graded recitation was decided (the user tapped Continue). */
  | { type: 'result'; perfect: boolean; /** Stitch: index in the window of the first slipped verse. */ firstSlip?: number }
  | { type: 'reroll' }
  | { type: 'knowIt' }
  /**
   * Before reciting: a cold check goes straight to its refresh (no slip
   * logged); a ladder recitation steps down one rung (no miss counted).
   */
  | { type: 'easier' }
  | { type: 'keepGoing' }
  /** Skip the current check, stitch, seam or thread: no credit, no penalty. */
  | { type: 'skip' }
  /**
   * Jump straight to a new verse from anywhere before a ladder (opening,
   * checks, stitch, thread, done for today). `verseId` picks which one;
   * otherwise nextNewVerse's choice. Counts against the pace, but always
   * allows at least one: the user asked for it.
   */
  | { type: 'startNew'; verseId?: string }
  /** Done for today: run the cold checks that a jump to a new verse skipped. */
  | { type: 'doChecks' }
  | { type: 'finish' };

export const startSession = (env: SessionEnv): SessionState => ({
  step: { kind: 'opening' },
  coldQueue: coldCheckQueue(env.items, env.now, env.masteryTouches).ready.map((i) => i.verseId),
  budget: Math.max(0, env.pace - env.newToday),
  newDone: 0,
  stitchCount: 0,
  usedCues: [],
  finishedThisSitting: [],
  setAside: [],
  log: [],
});

const findItem = (env: SessionEnv, id: string): GuidedItem | undefined => env.items.find((i) => i.verseId === id);
const drillVersesOf = (env: SessionEnv, ids: string[]): GuidedDrillVerse[] =>
  ids.map((id) => findItem(env, id)).filter((i): i is GuidedItem => !!i).map(toDrillVerse);

const enterCold = (s: SessionState, env: SessionEnv): SessionState => {
  const queue = s.coldQueue.filter((id) => !!findItem(env, id));
  if (queue.length === 0) return enterStitch({ ...s, coldQueue: [] }, env);
  return { ...s, coldQueue: queue, step: { kind: 'cold', verseId: queue[0], stage: 'recite' } };
};

const enterStitch = (s: SessionState, env: SessionEnv): SessionState => {
  const window = stitchWindow(env.items, new Set(s.finishedThisSitting));
  if (window.length < 2) return enterThread(s, env);
  const verseIds = window.map((i) => i.verseId);
  const jigsaw = env.jigsawWarmUp !== false && window.length === 3 && s.stitchCount % 2 === 1;
  return {
    ...s,
    step: { kind: 'stitch', verseIds, stage: jigsaw ? 'jigsaw' : 'recite', fails: 0, cue: stitchCue(window.map(toDrillVerse)) },
  };
};

const enterThread = (s: SessionState, env: SessionEnv): SessionState => {
  const extra = new Set(s.finishedThisSitting);
  const run = finishedRun(env.items, extra);
  const window = stitchWindow(env.items, extra);
  if (window.length >= 2 && run.length > window.length) {
    const cue = reachCue(run.map(toDrillVerse), run.length - window.length, env.rng);
    if (cue) {
      return {
        ...s,
        usedCues: [...s.usedCues, threadCueKey(cue)],
        step: { kind: 'thread', verseIds: run.map((i) => i.verseId), cue },
      };
    }
  }
  return enterNew(s, env);
};

const enterNew = (s: SessionState, env: SessionEnv, preferId?: string): SessionState => {
  if (s.budget <= 0) return { ...s, step: { kind: 'doneToday' } };
  const exclude = new Set([...s.setAside, ...s.finishedThisSitting]);
  const preferred = preferId
    ? env.items.find((i) => i.verseId === preferId && i.status === 'learning' && runsBanked(i) === 0 && !exclude.has(i.verseId))
    : undefined;
  const item = preferred ?? nextNewVerse(env.items, exclude);
  if (!item) return { ...s, step: { kind: 'doneToday' } };
  const passage = buildPassages(env.items).find((p) => p.items.some((i) => i.verseId === item.verseId));
  const ladder = createLadder(toDrillVerse(item), (passage?.items ?? [item]).map(toDrillVerse), { lastDrill: s.lastDrill }, env.rng);
  return { ...s, budget: s.budget - 1, step: { kind: 'ladder', verseId: item.verseId, ladder } };
};

const pushLog = (s: SessionState, entry: SessionLogEntry): SessionState => ({ ...s, log: [...s.log, entry] });

/** The whole sitting as a state machine. The screen calls only this. */
export const sessionReducer = (s: SessionState, event: SessionEvent, env: SessionEnv): SessionState => {
  const step = s.step;

  if (event.type === 'finish') return { ...s, step: { kind: 'summary' } };

  if (event.type === 'startNew') {
    if (step.kind === 'ladder' || step.kind === 'summary') return s;
    return enterNew({ ...s, budget: Math.max(s.budget, 1) }, env, event.verseId);
  }

  switch (step.kind) {
    case 'opening':
      return event.type === 'begin' ? enterCold(s, env) : s;

    case 'cold': {
      const popCold = () => ({ ...s, coldQueue: s.coldQueue.slice(1) });
      if (event.type === 'skip') return enterCold(popCold(), env);
      if (step.stage === 'recite' && event.type === 'easier') {
        const item = findItem(env, step.verseId);
        const eligible = item ? eligibleDrills(toDrillVerse(item), drillVersesOf(env, buildPassageIds(env, step.verseId))) : (['firstLetters'] as GuidedDrillId[]);
        return { ...s, step: { ...step, stage: 'refreshDrill', drill: pickDrill(eligible, [], s.lastDrill, undefined, env.rng) } };
      }
      if (step.stage === 'recite' && event.type === 'result') {
        const logged = pushLog(s, { step: 'cold', verseIds: [step.verseId], perfect: event.perfect });
        if (event.perfect) return enterCold({ ...logged, coldQueue: logged.coldQueue.slice(1) }, env);
        const item = findItem(env, step.verseId);
        const verse = item ? toDrillVerse(item) : null;
        const eligible = verse ? eligibleDrills(verse, drillVersesOf(env, buildPassageIds(env, step.verseId))) : (['firstLetters'] as GuidedDrillId[]);
        const drill = pickDrill(eligible, [], s.lastDrill, undefined, env.rng);
        return { ...logged, step: { ...step, stage: 'refreshDrill', drill } };
      }
      if (step.stage === 'refreshDrill') {
        if (event.type === 'next') return { ...s, step: { ...step, stage: 'refreshRecite' } };
        if (event.type === 'reroll') {
          const item = findItem(env, step.verseId);
          const eligible = item ? eligibleDrills(toDrillVerse(item), drillVersesOf(env, buildPassageIds(env, step.verseId))) : (['firstLetters'] as GuidedDrillId[]);
          return { ...s, step: { ...step, drill: pickDrill(eligible, [], s.lastDrill, step.drill, env.rng) } };
        }
        return s;
      }
      if (step.stage === 'refreshRecite' && event.type === 'result') {
        // The refresh never banks a run; it is checked cold again next sitting.
        const logged = pushLog(popCold(), { step: 'refresh', verseIds: [step.verseId], perfect: event.perfect });
        return enterCold(logged, env);
      }
      return s;
    }

    case 'stitch': {
      if (event.type === 'skip') return enterThread({ ...s, stitchCount: s.stitchCount + 1 }, env);
      if (step.stage === 'jigsaw') return event.type === 'next' ? { ...s, step: { ...step, stage: 'recite' } } : s;
      if (event.type !== 'result') return s;
      const logged = pushLog(s, { step: 'stitch', verseIds: step.verseIds, perfect: event.perfect });
      if (event.perfect || step.fails + 1 >= GUIDED_MAX_STITCH_FAILS) {
        // Two failed stitches in a row: move on, nothing is set aside.
        return enterThread({ ...logged, stitchCount: logged.stitchCount + 1 }, env);
      }
      const slip = Math.max(0, Math.min(step.verseIds.length - 1, event.firstSlip ?? 0));
      const cue = seamCue(drillVersesOf(env, step.verseIds), slip, env.rng);
      if (!cue) return { ...logged, step: { ...step, stage: 'recite', fails: step.fails + 1 } };
      return { ...logged, step: { kind: 'seam', verseIds: step.verseIds, cue, fails: step.fails + 1 } };
    }

    case 'seam': {
      if (event.type === 'skip') return enterThread({ ...s, stitchCount: s.stitchCount + 1 }, env);
      if (event.type !== 'result') return s;
      const window = drillVersesOf(env, step.verseIds);
      return {
        ...pushLog(s, { step: 'seam', verseIds: step.verseIds, perfect: event.perfect }),
        step: { kind: 'stitch', verseIds: step.verseIds, stage: 'recite', fails: step.fails, cue: stitchCue(window) },
      };
    }

    case 'thread':
      if (event.type === 'skip') return enterNew(s, env);
      return event.type === 'result'
        ? enterNew(pushLog(s, { step: 'thread', verseIds: step.verseIds, perfect: event.perfect }), env)
        : s;

    case 'ladder': {
      const map: Partial<Record<SessionEvent['type'], LadderEvent>> = { knowIt: 'knowIt', reroll: 'reroll', next: 'done', easier: 'easier' };
      let ladderEvent: LadderEvent | undefined = map[event.type];
      if (event.type === 'result') ladderEvent = event.perfect ? 'pass' : 'miss';
      if (!ladderEvent) return s;
      const ladder = ladderAfter(step.ladder, ladderEvent, env.rng);
      if (ladder === step.ladder) return s;

      if (ladder.status === 'finished') {
        const next: SessionState = {
          ...pushLog(s, { step: 'ladder', verseIds: [step.verseId], perfect: true }),
          newDone: s.newDone + 1,
          finishedThisSitting: [...s.finishedThisSitting, step.verseId],
          lastDrill: lastDrillOf(ladder) ?? s.lastDrill,
        };
        return enterStitch(next, env);
      }
      if (ladder.status === 'setAside') {
        const next: SessionState = {
          ...pushLog(s, { step: 'ladder', verseIds: [step.verseId], perfect: false }),
          setAside: [...s.setAside, step.verseId],
          // A set-aside verse didn't use up the sitting's pace.
          budget: s.budget + 1,
          lastDrill: lastDrillOf(ladder) ?? s.lastDrill,
        };
        return enterNew(next, env);
      }
      return { ...s, step: { ...step, ladder } };
    }

    case 'doneToday':
      if (event.type === 'doChecks') {
        // Only the checks: whatever follows them (a stitch, a thread) may
        // run too, but no new verse unless asked for again.
        return s.coldQueue.length > 0 ? enterCold({ ...s, budget: 0 }, env) : s;
      }
      return event.type === 'keepGoing' ? enterNew({ ...s, budget: s.budget + 1 }, env) : s;

    case 'summary':
      return s;
  }
};

/** Ids of the passage a verse belongs to, so drill decoys come from its neighbours. */
const buildPassageIds = (env: SessionEnv, verseId: string): string[] => {
  const passage = buildPassages(env.items).find((p) => p.items.some((i) => i.verseId === verseId));
  return (passage?.items ?? []).map((i) => i.verseId);
};
