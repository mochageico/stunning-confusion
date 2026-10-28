import { QueueItem } from '../types';
import { buildSwapVerses, chunkIntoPhrases, pickThreadCue, threadCueKey, ThreadCue, ThreadSlip } from './drills';
import { scriptOfVerse, splitWords } from './textScript';

// ============================================================================
// GUIDED LEARNING -- PURE LOGIC
// ----------------------------------------------------------------------------
// Everything Guided learning decides lives here: which drill, which rung,
// what a miss costs, which verses get a cold check, a stitch or a jump-in, and
// whether a result banks a run. No React, no Firestore -- same pattern as drills.ts.
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
/** Most jump-ins in one go (the first thread of a sitting; later ones get one). */
export const GUIDED_MAX_JUMP_INS = 3;
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

/**
 * Items split into recitable stretches: consecutive verse numbers, at most
 * GUIDED_MAX_STITCH_VERSES verses and GUIDED_MAX_STITCH_WORDS words each
 * (a single verse may run over). Used to merge cold checks and last looks.
 */
export const chunkStretches = (items: GuidedItem[]): GuidedItem[][] => {
  const out: GuidedItem[][] = [];
  let cur: GuidedItem[] = [];
  let words = 0;
  sortedByVerse(items).forEach((it) => {
    const w = wordCount(toDrillVerse(it));
    const prev = cur[cur.length - 1];
    const fits =
      !!prev && it.verseNumber === prev.verseNumber + 1 && cur.length < GUIDED_MAX_STITCH_VERSES && words + w <= GUIDED_MAX_STITCH_WORDS;
    if (!fits && cur.length > 0) {
      out.push(cur);
      cur = [];
      words = 0;
    }
    cur.push(it);
    words += w;
  });
  if (cur.length > 0) out.push(cur);
  return out;
};

/** How many jump-ins the older part of a run (before the stitch window) gets. */
export const jumpInCount = (older: number): number =>
  older <= 0 ? 0 : Math.min(GUIDED_MAX_JUMP_INS, older <= 2 ? 1 : older <= 5 ? 2 : 3);

/**
 * Jump-ins: short threads into the verses before the stitch window. Each
 * starts somewhere inside one verse and runs through the end of the next one
 * or two, so it is 2-3 verses long. The older verses are split into `count`
 * bands with one jump-in each, so they spread out instead of bunching up.
 *
 * Within a band, a start just before a shaky join (`shaky` holds run indices
 * whose join INTO them slipped last time) wins; then a start not in `avoid`
 * (already used this sitting). The result is shuffled and never left in
 * verse order, so finding your place is part of the work.
 */
export const jumpInCues = (
  run: GuidedDrillVerse[],
  windowStart: number,
  opts: { count: number; shaky?: ReadonlySet<number>; avoid?: ReadonlySet<number>; used?: ReadonlySet<string> },
  rng: Rng
): ThreadCue[] => {
  const older = Math.min(windowStart, run.length - 1);
  const count = Math.min(opts.count, older);
  if (count <= 0) return [];
  const shaky = opts.shaky ?? new Set<number>();
  const avoid = opts.avoid ?? new Set<number>();
  const used = new Set(opts.used ?? []);
  const pick = (xs: number[]): number => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
  const last = run.length - 1;

  const cues: ThreadCue[] = [];
  for (let b = 0; b < count; b++) {
    const lo = Math.floor((b * older) / count);
    const hi = Math.floor(((b + 1) * older) / count);
    const band = Array.from({ length: hi - lo }, (_, i) => lo + i);
    if (band.length === 0) continue;
    const nextShaky = band.filter((i) => shaky.has(i + 1));
    const laterShaky = band.filter((i) => i + 2 <= last && shaky.has(i + 2));
    const fresh = band.filter((i) => !avoid.has(i));
    const start = pick(nextShaky.length > 0 ? nextShaky : laterShaky.length > 0 ? laterShaky : fresh.length > 0 ? fresh : band);

    let end = shaky.has(start + 2) ? start + 2 : shaky.has(start + 1) ? start + 1 : rng() < 0.5 ? start + 1 : start + 2;
    end = Math.min(end, last);
    const words = run.slice(start, end + 1).reduce((n, v) => n + wordCount(v), 0);
    if (end > start + 1 && words > GUIDED_MAX_STITCH_WORDS) end = start + 1;

    const cue = pickThreadCue(run, end, { fromVerse: start, beforeVerse: start + 1, used, random: rng });
    if (!cue || cue.startVerse !== start) continue;
    used.add(threadCueKey(cue));
    cues.push(cue);
  }

  for (let i = cues.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cues[i], cues[j]] = [cues[j], cues[i]];
  }
  if (cues.length > 1 && cues.every((c, i) => i === 0 || cues[i - 1].startVerse < c.startVerse)) cues.reverse();
  return cues;
};

/**
 * Which joins a graded stretch showed as shaky or steady. `spanIds` are the
 * recited verses in order and `spanStart` the index the slips count from; a
 * join is the step INTO each verse after the first. A join slip
 * (threadSlips) marks it shaky; a clean join clears it.
 */
export const joinChanges = (spanIds: string[], slips: ThreadSlip[], spanStart: number): { shaky: string[]; steady: string[] } => {
  const slipped = new Set(slips.filter((x) => x.kind === 'join').map((x) => x.verse - spanStart));
  const shaky: string[] = [];
  const steady: string[] = [];
  spanIds.forEach((id, k) => {
    if (k === 0) return;
    (slipped.has(k) ? shaky : steady).push(id);
  });
  return { shaky, steady };
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

export type GuidedActivity = 'fully' | 'partly' | 'refresh' | 'cold' | 'knowIt' | 'stitch' | 'thread' | 'seam' | 'lastLook';
export type GuidedAnswerMode = 'speak' | 'type' | 'self';

export interface GuidedOutcome {
  activity: GuidedActivity;
  /** accuracy >= REVIEW_PASS_ACCURACY. Ladder activities are all-or-nothing; pass perfect for both. */
  passed: boolean;
  /** summarizeOutcomes().isPerfect: no missed words (near-misses allowed). */
  perfect: boolean;
  /** Share of words right, 0..1: what a review is graded on (clean, stumble or blank). */
  accuracy?: number;
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
  if (outcome.activity === 'lastLook') return { kind: null, label: 'A last look back, so this one doesn’t count' };
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
// Cold checks, then an opening stitch, then jump-ins, then new verses -- each
// followed by its own stitch and a jump-in -- then one last look back at the
// new verses before Done for today. The state holds no verse text, only
// ids and ladders; `env` carries the live queue items (read fresh from
// memoryQueueRef by the screen on every dispatch) so a run banked a moment ago
// is already visible here.
// ============================================================================

export type GuidedStep =
  | { kind: 'opening' }
  /**
   * Back-to-back verses due a check are recited together. Any that slip are
   * refreshed one at a time (`refreshIds[0]` is the one in progress).
   */
  | { kind: 'cold'; verseIds: string[]; stage: 'recite' | 'refreshDrill' | 'refreshRecite'; refreshIds: string[]; drill?: GuidedDrillId }
  | { kind: 'stitch'; verseIds: string[]; stage: 'jigsaw' | 'recite'; fails: number; cue: ThreadCue }
  | { kind: 'seam'; verseIds: string[]; cue: ThreadCue; fails: number }
  /** Jump-ins over the finished run (`verseIds`), done one at a time. */
  | { kind: 'thread'; verseIds: string[]; cues: ThreadCue[]; index: number }
  /** The verses learned this sitting, said once more before stopping. */
  | { kind: 'lastLook'; groups: string[][]; index: number }
  | { kind: 'ladder'; verseId: string; ladder: Ladder }
  | { kind: 'doneToday' }
  | { kind: 'summary' };

export interface SessionLogEntry {
  step: 'cold' | 'refresh' | 'stitch' | 'seam' | 'thread' | 'ladder' | 'lastLook';
  verseIds: string[];
  perfect: boolean;
}

export interface SessionState {
  step: GuidedStep;
  /** Verse ids still waiting for a cold check, in order. Neighbours are checked together. */
  coldQueue: string[];
  /** New verses the sitting may still start; Keep going adds one. */
  budget: number;
  /** New verses finished this sitting. */
  newDone: number;
  /** Stitches completed; every second 3-verse stitch gets a jigsaw warm-up. */
  stitchCount: number;
  lastDrill?: GuidedDrillId;
  usedCues: string[];
  /** Jump-in rounds so far; only the first gets the full count. */
  jumpInRounds: number;
  /** Verses a jump-in started in this sitting; later rounds go elsewhere. */
  jumpStarts: string[];
  /** Verses already given their last look this sitting. */
  lookedBack: string[];
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
  | {
      type: 'result';
      perfect: boolean;
      /** Stitch: index in the window of the first slipped verse. */
      firstSlip?: number;
      /** Merged cold check: indices of the verses that were not perfect. */
      slips?: number[];
    }
  | { type: 'reroll' }
  | { type: 'knowIt' }
  /**
   * Before reciting: a cold check goes straight to its refresh (no slip
   * logged); a ladder recitation steps down one rung (no miss counted).
   */
  | { type: 'easier' }
  | { type: 'keepGoing' }
  /** Skip the current check, stitch, seam, jump-in or last look: no credit, no penalty. */
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
  jumpInRounds: 0,
  jumpStarts: [],
  lookedBack: [],
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
  // The oldest check, plus any neighbours also waiting, recited as one stretch.
  const stretches = chunkStretches(queue.map((id) => findItem(env, id)).filter((i): i is GuidedItem => !!i));
  const group = stretches.find((g) => g.some((i) => i.verseId === queue[0])) ?? [];
  const verseIds = group.length > 0 ? group.map((i) => i.verseId) : [queue[0]];
  return { ...s, coldQueue: queue, step: { kind: 'cold', verseIds, stage: 'recite', refreshIds: [] } };
};

const refreshDrillFor = (s: SessionState, env: SessionEnv, verseId: string, current?: GuidedDrillId): GuidedDrillId => {
  const item = findItem(env, verseId);
  const eligible = item ? eligibleDrills(toDrillVerse(item), drillVersesOf(env, buildPassageIds(env, verseId))) : (['firstLetters'] as GuidedDrillId[]);
  return pickDrill(eligible, [], s.lastDrill, current, env.rng);
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
    const older = run.length - window.length;
    const indicesWhere = (ok: (i: GuidedItem) => boolean) => new Set(run.flatMap((it, k) => (ok(it) ? [k] : [])));
    const cues = jumpInCues(
      run.map(toDrillVerse),
      older,
      {
        count: s.jumpInRounds === 0 ? jumpInCount(older) : 1,
        shaky: indicesWhere((i) => !!i.guidedShakyJoin),
        avoid: indicesWhere((i) => s.jumpStarts.includes(i.verseId)),
        used: new Set(s.usedCues),
      },
      env.rng
    );
    if (cues.length > 0) {
      return {
        ...s,
        jumpInRounds: s.jumpInRounds + 1,
        usedCues: [...s.usedCues, ...cues.map(threadCueKey)],
        jumpStarts: [...s.jumpStarts, ...cues.map((c) => run[c.startVerse].verseId)],
        step: { kind: 'thread', verseIds: run.map((i) => i.verseId), cues, index: 0 },
      };
    }
  }
  return enterNew(s, env);
};

/**
 * Before Done for today: the verses learned this sitting, recited once more
 * now that other work has pushed them out of mind. A verse only gets one if
 * at least two other activities followed its ladder. It never counts.
 */
const enterLastLook = (s: SessionState, env: SessionEnv): SessionState => {
  const busySince = (id: string) => {
    let at = -1;
    s.log.forEach((l, k) => {
      if (l.step === 'ladder' && l.perfect && l.verseIds[0] === id) at = k;
    });
    return at >= 0 && s.log.length - 1 - at >= 2;
  };
  const pending = s.finishedThisSitting.filter((id) => !s.lookedBack.includes(id) && busySince(id));
  const items = pending.map((id) => findItem(env, id)).filter((i): i is GuidedItem => !!i);
  if (items.length === 0) return { ...s, step: { kind: 'doneToday' } };
  const groups = chunkStretches(items).map((g) => g.map((i) => i.verseId));
  return { ...s, lookedBack: [...s.lookedBack, ...pending], step: { kind: 'lastLook', groups, index: 0 } };
};

const enterNew = (s: SessionState, env: SessionEnv, preferId?: string): SessionState => {
  if (s.budget <= 0) return enterLastLook(s, env);
  const exclude = new Set([...s.setAside, ...s.finishedThisSitting]);
  const preferred = preferId
    ? env.items.find((i) => i.verseId === preferId && i.status === 'learning' && runsBanked(i) === 0 && !exclude.has(i.verseId))
    : undefined;
  const item = preferred ?? nextNewVerse(env.items, exclude);
  if (!item) return enterLastLook(s, env);
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
      const popCold = (from: SessionState = s) => ({ ...from, coldQueue: from.coldQueue.filter((id) => !step.verseIds.includes(id)) });
      if (event.type === 'skip') return enterCold(popCold(), env);
      if (step.stage === 'recite' && event.type === 'easier') {
        // Not ready: refresh every verse in the stretch, nothing logged.
        const refreshIds = step.verseIds;
        return { ...s, step: { ...step, stage: 'refreshDrill', refreshIds, drill: refreshDrillFor(s, env, refreshIds[0]) } };
      }
      if (step.stage === 'recite' && event.type === 'result') {
        const slips = new Set(event.slips ?? (event.perfect ? [] : step.verseIds.map((_, k) => k)));
        let logged = s;
        step.verseIds.forEach((id, k) => {
          logged = pushLog(logged, { step: 'cold', verseIds: [id], perfect: !slips.has(k) });
        });
        const refreshIds = step.verseIds.filter((_, k) => slips.has(k));
        if (refreshIds.length === 0) return enterCold(popCold(logged), env);
        return { ...logged, step: { ...step, stage: 'refreshDrill', refreshIds, drill: refreshDrillFor(s, env, refreshIds[0]) } };
      }
      if (step.stage === 'refreshDrill') {
        if (event.type === 'next') return { ...s, step: { ...step, stage: 'refreshRecite' } };
        if (event.type === 'reroll') return { ...s, step: { ...step, drill: refreshDrillFor(s, env, step.refreshIds[0], step.drill) } };
        return s;
      }
      if (step.stage === 'refreshRecite' && event.type === 'result') {
        // The refresh never banks a run; it is checked cold again next sitting.
        const logged = pushLog(s, { step: 'refresh', verseIds: [step.refreshIds[0]], perfect: event.perfect });
        const rest = step.refreshIds.slice(1);
        if (rest.length === 0) return enterCold(popCold(logged), env);
        return { ...logged, step: { ...step, stage: 'refreshDrill', refreshIds: rest, drill: refreshDrillFor(s, env, rest[0]) } };
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

    case 'thread': {
      if (event.type !== 'skip' && event.type !== 'result') return s;
      const cue = step.cues[step.index];
      const next =
        event.type === 'result'
          ? pushLog(s, { step: 'thread', verseIds: step.verseIds.slice(cue.startVerse, cue.endVerse + 1), perfect: event.perfect })
          : s;
      if (step.index + 1 < step.cues.length) return { ...next, step: { ...step, index: step.index + 1 } };
      return enterNew(next, env);
    }

    case 'lastLook': {
      if (event.type !== 'skip' && event.type !== 'result') return s;
      const next = event.type === 'result' ? pushLog(s, { step: 'lastLook', verseIds: step.groups[step.index], perfect: event.perfect }) : s;
      if (step.index + 1 < step.groups.length) return { ...next, step: { ...step, index: step.index + 1 } };
      return { ...next, step: { kind: 'doneToday' } };
    }

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
