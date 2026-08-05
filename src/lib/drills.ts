import { normalizeToken } from './recitation';

// ============================================================================
// SUPPLEMENTARY DRILL LOGIC
// ----------------------------------------------------------------------------
// Pure logic for the non-graded practice drills that sit alongside Recall:
// verse-order jigsaw, phrase scramble, and spot-the-swap. Nothing here touches
// React, Firestore, or audio — same pattern (and same testability) as
// recitation.ts.
//
// IMPORTANT: none of these drills feed the spaced-repetition engine. They
// never call onUpdateStatus, never bank a mastery touch, and never advance a
// review. Only real Recall (typed/spoken verbatim) and the explicit manual-log
// action affect scheduling — these are supplementary practice, deliberately
// kept out of the graduation path so "graduated" keeps meaning one thing.
// ============================================================================

/** Fisher-Yates. Returns a new array; never mutates the input. */
export const shuffleArray = <T>(items: T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * Shuffles indices 0..count-1, guaranteeing the result isn't already in
 * order — a "scramble" that happens to come out pre-solved is a broken
 * puzzle, not a lucky one. Falls back to a forced adjacent swap after a few
 * unlucky rolls rather than looping unbounded.
 */
export const shuffleOrder = (count: number): number[] => {
  const indices = Array.from({ length: count }, (_, i) => i);
  if (count < 2) return indices;
  const isInOrder = (arr: number[]) => arr.every((v, i) => v === i);
  for (let attempt = 0; attempt < 5; attempt++) {
    const shuffled = shuffleArray(indices);
    if (!isInOrder(shuffled)) return shuffled;
  }
  const forced = [...indices];
  [forced[0], forced[1]] = [forced[1], forced[0]];
  return forced;
};

// ============================================================================
// 1. VERSE-ORDER JIGSAW
// ============================================================================

/**
 * Below this, there isn't enough shuffle space for the puzzle to mean
 * anything (two tiles are either right or backwards), so the mode isn't
 * offered at all.
 */
export const MIN_JIGSAW_VERSES = 3;

export interface JigsawTile {
  /** Stable key — book/chapter/verse, not the shuffled position. */
  id: string;
  /** Verse number badge shown on the tile. */
  label: string;
  text: string;
  /**
   * Where this tile belongs in the solved passage. Taken from the order the
   * verses were handed to us rather than re-sorting by chapter/verse: the
   * caller's array is already canonical everywhere else in the app, and it
   * handles cross-book groups (which no chapter/verse sort could).
   */
  correctIndex: number;
}

export const buildJigsawTiles = (
  verses: { book: string; chapter: number; verse: number; text: string }[]
): JigsawTile[] =>
  verses.map((v, i) => ({
    id: `${v.book}-${v.chapter}-${v.verse}`,
    label: `${v.chapter}:${v.verse}`,
    text: v.text,
    correctIndex: i,
  }));

// ============================================================================
// 2. PHRASE SCRAMBLE
// ============================================================================

/** Target words per thought-unit tile. */
export const PHRASE_TARGET_WORDS = 3.5;

/**
 * Splits verse text into 3-4 word tiles.
 *
 * Deliberately naive: it divides the verse into evenly-sized chunks rather
 * than respecting clause boundaries, so a tile occasionally starts or ends
 * mid-thought. A clause-aware version (split on commas/semicolons first, then
 * subdivide long clauses) reads more naturally and is a drop-in replacement
 * for this function — the UI only consumes the returned strings — but it's a
 * separate upgrade, not a prerequisite for shipping the drill.
 */
export const chunkIntoPhrases = (text: string): string[] => {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  if (words.length <= 4) return [words.join(' ')];

  const chunkCount = Math.max(2, Math.round(words.length / PHRASE_TARGET_WORDS));
  const base = Math.floor(words.length / chunkCount);
  let remainder = words.length % chunkCount;

  const chunks: string[] = [];
  let cursor = 0;
  for (let c = 0; c < chunkCount; c++) {
    const size = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    chunks.push(words.slice(cursor, cursor + size).join(' '));
    cursor += size;
  }
  return chunks;
};

export interface ScrambleRound {
  /** Stable key for this verse. */
  id: string;
  label: string;
  /** Phrases in their correct order. */
  phrases: string[];
  /** Indices into `phrases`, shuffled — the order tiles appear in the bank. */
  bankOrder: number[];
}

/**
 * One round per verse. Scrambling the whole passage's phrases into a single
 * pool would be a memory test of a different (much harder) kind; stepping
 * verse-by-verse matches how every other drill in the app iterates.
 */
export const buildScrambleRounds = (
  verses: { book: string; chapter: number; verse: number; text: string }[]
): ScrambleRound[] =>
  verses
    .map((v) => {
      const phrases = chunkIntoPhrases(v.text);
      return {
        id: `${v.book}-${v.chapter}-${v.verse}`,
        label: `${v.chapter}:${v.verse}`,
        phrases,
        bankOrder: shuffleOrder(phrases.length),
      };
    })
    // A verse that produced a single tile has nothing to reorder.
    .filter((r) => r.phrases.length > 1);

// ============================================================================
// 3. SPOT-THE-SWAP
// ============================================================================

/**
 * Only words at least this long (after normalization) are eligible to be
 * swapped out or used as decoys. Swapping "the" for "and" is a proofreading
 * test, not a memory one — and short function words are exactly the ones a
 * reader glides over, so they make for unfair, guessy imposters.
 */
export const MIN_SWAP_WORD_LENGTH = 4;

export const DEFAULT_SWAPS_PER_VERSE = 2;

export interface SwapToken {
  /** What to render — the decoy when swapped, otherwise the real word. */
  display: string;
  /** True when this token is an imposter the user is meant to catch. */
  isDecoy: boolean;
  /** The real word this replaced. Only set when isDecoy. */
  original?: string;
  /** Flat index across the whole passage; the tap/selection key. */
  index: number;
}

export interface SwapVerse {
  id: string;
  label: string;
  tokens: SwapToken[];
}

/**
 * Copies the original word's shape onto a replacement: leading/trailing
 * punctuation and leading capitalization carry over, so a swapped word never
 * gives itself away by being the only one missing a comma or starting
 * lowercase mid-sentence.
 */
export const applyWordShape = (original: string, replacement: string): string => {
  const firstAlnum = original.search(/[a-zA-Z0-9]/);
  if (firstAlnum === -1) return replacement;
  const lastAlnum = original.search(/[a-zA-Z0-9][^a-zA-Z0-9]*$/);
  const prefix = original.slice(0, firstAlnum);
  const suffix = lastAlnum === -1 ? '' : original.slice(lastAlnum + 1);
  const wasCapitalized = original[firstAlnum] === original[firstAlnum].toUpperCase();
  const core = wasCapitalized
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement.toLowerCase();
  return `${prefix}${core}${suffix}`;
};

/**
 * Replaces a few words per verse with real words pulled from elsewhere in the
 * same passage.
 *
 * Using the passage's own vocabulary (rather than a curated
 * synonym/confusables list) means zero content authoring and decoys that are
 * always plausible scripture language in the same register. The tradeoff: a
 * decoy occasionally lands somewhere obviously wrong grammatically. A curated
 * confusables dictionary would read better and is the natural upgrade — it
 * would only need to replace how `pool` is built below.
 */
export const buildSwapVerses = (
  verses: { book: string; chapter: number; verse: number; text: string }[],
  swapsPerVerse: number = DEFAULT_SWAPS_PER_VERSE
): SwapVerse[] => {
  // Every substantial word in the group, deduped — the decoy vocabulary.
  const pool = Array.from(
    new Set(
      verses
        .flatMap((v) => v.text.split(/\s+/))
        .map(normalizeToken)
        .filter((w) => w.length >= MIN_SWAP_WORD_LENGTH)
    )
  );

  let flatIndex = 0;

  return verses.map((v) => {
    const words = v.text.split(/\s+/).filter((w) => w.length > 0);

    // Which positions in this verse are even eligible to be swapped.
    const eligible = words
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => normalizeToken(w).length >= MIN_SWAP_WORD_LENGTH)
      .map(({ i }) => i);

    // Never swap so much of a short verse that it stops being recognizable;
    // and with a thin pool there may be nothing valid to swap in at all.
    const swapCount = Math.min(swapsPerVerse, Math.floor(eligible.length / 2), Math.max(pool.length - 1, 0));
    const chosen = new Set(shuffleArray(eligible).slice(0, Math.max(swapCount, 0)));

    const tokens: SwapToken[] = words.map((word, i) => {
      const index = flatIndex++;
      if (!chosen.has(i)) return { display: word, isDecoy: false, index };

      const realWord = normalizeToken(word);
      const candidates = pool.filter((p) => p !== realWord);
      if (candidates.length === 0) return { display: word, isDecoy: false, index };

      const decoy = candidates[Math.floor(Math.random() * candidates.length)];
      return {
        display: applyWordShape(word, decoy),
        isDecoy: true,
        original: word,
        index,
      };
    });

    return { id: `${v.book}-${v.chapter}-${v.verse}`, label: `${v.chapter}:${v.verse}`, tokens };
  });
};

export interface SwapScore {
  /** Decoys the user correctly tapped. */
  caught: number;
  /** Decoys the user never tapped. */
  missed: number;
  /** Real words the user wrongly accused. */
  falseAlarms: number;
  totalDecoys: number;
}

// ============================================================================
// 4. REFERENCE <-> VERSE DRILL
// ----------------------------------------------------------------------------
// "Where is this?" is a different skill from "what does it say?" -- the whole
// spaced-repetition engine grades the latter and never touches the former.
// This drill runs over any verses already in the review system (regardless of
// phase or due date) and, like the drills above, never feeds scheduling.
// ============================================================================

export interface ReferenceItem {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export type DrillDirection = 'both' | 'refToVerse' | 'verseToRef';

export interface ReferenceRound {
  id: string;
  /** refToVerse: shown a reference, choose the text. verseToRef: the reverse. */
  kind: 'refToVerse' | 'verseToRef';
  answer: ReferenceItem;
  /** Multiple-choice candidates including the answer, already shuffled. */
  options: ReferenceItem[];
}

export const formatReference = (item: { book: string; chapter: number; verse: number }): string =>
  `${item.book} ${item.chapter}:${item.verse}`;

export const MAX_CHOICES = 4;

/**
 * Builds a quiz session.
 *
 * Decoys prefer verses from the same book as the answer — a round whose only
 * wrong answers are from other books is solvable by recognizing the book
 * alone, which isn't the skill being tested. Falls back to the wider pool
 * when a book doesn't have enough verses of its own.
 */
export const buildReferenceRounds = (
  pool: ReferenceItem[],
  count: number,
  direction: DrillDirection = 'both'
): ReferenceRound[] => {
  // Two translations of one verse share a reference, which would make a
  // "wrong" option secretly correct. Keep one item per reference.
  const unique = Array.from(new Map(pool.map((p) => [formatReference(p), p])).values());
  if (unique.length === 0) return [];

  const questionOrder = shuffleArray(unique).slice(0, Math.min(count, unique.length));

  return questionOrder.map((answer, i) => {
    const sameBook = unique.filter((p) => p.book === answer.book && formatReference(p) !== formatReference(answer));
    const otherBooks = unique.filter((p) => p.book !== answer.book);
    const decoys = [...shuffleArray(sameBook), ...shuffleArray(otherBooks)].slice(0, MAX_CHOICES - 1);

    const kind: ReferenceRound['kind'] =
      direction === 'both' ? (Math.random() < 0.5 ? 'refToVerse' : 'verseToRef') : direction;

    return {
      id: `${formatReference(answer)}-${i}`,
      kind,
      answer,
      options: shuffleArray([answer, ...decoys]),
    };
  });
};

/** Free-entry answers are compared loosely on book name, exactly on numbers. */
export const referenceAnswerMatches = (
  answer: ReferenceItem,
  guess: { book: string; chapter: string; verse: string }
): boolean =>
  guess.book.trim().toLowerCase() === answer.book.trim().toLowerCase() &&
  Number(guess.chapter) === answer.chapter &&
  Number(guess.verse) === answer.verse;

// ============================================================================
// 5. BUILD UP
// ----------------------------------------------------------------------------
// The add-on / snowball method: learn a verse a phrase at a time, where each
// stage adds one new phrase to everything already stacked. The payoff is
// structural -- a 5-bite verse gives you 5 passes over bite 1 and 1 over bite
// 5, which is exactly the right distribution, because the opening of a verse
// is the retrieval cue for all of it.
//
// Like every other drill in this file it is ungraded, and here the reason is
// especially blunt: the text is on screen for the first of every three reps
// and the user self-reports by tapping. The UI's answer is to hand off into a
// real blind Recall run at the end rather than to pretend this one counts.
// ============================================================================

/**
 * Words a phrase would rather start with than end on. Used to nudge a
 * too-long clause's break point onto a natural hinge instead of guillotining
 * it at whatever word the arithmetic landed on -- "that he gave / his only
 * Son" is a worse bite pair than "that he gave his only Son".
 *
 * Deliberately a small hand list rather than a parser: English Bible
 * translations are already punctuated for reading aloud, so punctuation does
 * most of the work (see splitIntoBites) and this only has to rescue the
 * long-clause minority.
 */
export const HINGE_WORDS = new Set([
  'and', 'or', 'but', 'for', 'nor', 'yet', 'so',
  'that', 'which', 'who', 'whom', 'whose', 'when', 'where', 'while', 'as',
  'because', 'therefore', 'though', 'although', 'unless', 'until', 'since',
  'if', 'then', 'thus', 'lest',
  'of', 'in', 'on', 'to', 'unto', 'with', 'by', 'from', 'into', 'upon',
  'through', 'against', 'before', 'after', 'according',
]);

export type BiteSize = 'short' | 'medium' | 'long';

/** Words per bite, before punctuation and hinge-words have their say. */
export const BITE_TARGET_WORDS: Record<BiteSize, number> = { short: 3, medium: 5, long: 8 };

/**
 * A bite this short isn't a thought, it's a fragment ("and", "of the"), so
 * it gets merged into its neighbour rather than earning a stage of its own.
 */
const MIN_BITE_WORDS = 2;

/** How far past the target a run may go before it's worth subdividing. */
const OVERSHOOT = 1.6;

const isHinge = (word: string): boolean => HINGE_WORDS.has(normalizeToken(word));

/**
 * True when this word closes a clause -- trailing quotes/brackets are skipped
 * so `world,"` counts the same as `world,`.
 */
const endsClause = (word: string): boolean => /[,;:.!?—–]["'’”)\]]*$/.test(word);

/**
 * Splits one long run of words at hinge-preferred boundaries near the target
 * length. Greedy rather than optimal: it walks forward, and at each cut point
 * searches outward from the target position for a word a phrase would rather
 * begin with. Optimal segmentation (minimise total deviation) is a nicer
 * problem and a worse product -- it can move an early break to fix a late one,
 * so adding a word to the end of a verse reshuffles its opening bites.
 */
const subdivideRun = (words: string[], target: number): string[][] => {
  const maxRun = Math.round(target * OVERSHOOT);
  if (words.length <= maxRun) return [words];

  const out: string[][] = [];
  let start = 0;
  while (start < words.length) {
    if (words.length - start <= maxRun) {
      out.push(words.slice(start));
      break;
    }
    const aim = start + target;
    const inBounds = (c: number) => c > start && c < words.length;
    // A bite must never END on a hinge -- "And we know that" trails off mid-
    // thought, and it splits compounds ("so / that", "according / to") right
    // down the middle. So a cut is only allowed where the word before it
    // isn't itself a hinge.
    const leavesCleanTail = (c: number) => !isHinge(words[c - 1]);

    let cut = -1;
    // Best: start the next bite ON a hinge, searching outward from the aim.
    for (let d = 0; d <= 2 && cut < 0; d++) {
      for (const c of [aim - d, aim + d]) {
        if (inBounds(c) && isHinge(words[c]) && leavesCleanTail(c)) { cut = c; break; }
      }
    }
    // Failing that, settle for merely not ending on one.
    for (let d = 0; d <= 2 && cut < 0; d++) {
      for (const c of [aim - d, aim + d]) {
        if (inBounds(c) && leavesCleanTail(c)) { cut = c; break; }
      }
    }
    if (cut < 0) cut = aim;

    out.push(words.slice(start, cut));
    start = cut;
  }
  return out;
};

/**
 * Splits verse text into the bites Build up stacks, punctuation first.
 *
 * Three passes: cut at clause-closing punctuation, subdivide any clause still
 * too long, then absorb stragglers too short to stand alone. A verse short
 * enough to be one bite legitimately returns one bite -- that's a real answer,
 * not a degenerate case, and the drill still runs its three reps over it.
 */
export const splitIntoBites = (text: string, size: BiteSize = 'medium'): string[] => {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const target = BITE_TARGET_WORDS[size];

  // Pass 1 -- clause boundaries.
  const clauses: string[][] = [];
  let current: string[] = [];
  words.forEach((w) => {
    current.push(w);
    if (endsClause(w)) {
      clauses.push(current);
      current = [];
    }
  });
  if (current.length > 0) clauses.push(current);

  // Pass 2 -- break up anything still oversized.
  const bites = clauses.flatMap((c) => subdivideRun(c, target));

  // Pass 3 -- absorb fragments. Merging backwards keeps a trailing "of God"
  // attached to the phrase it belongs to; only a leading fragment (nothing
  // behind it) merges forwards instead.
  const merged: string[][] = [];
  bites.forEach((bite) => {
    if (bite.length < MIN_BITE_WORDS && merged.length > 0) {
      merged[merged.length - 1] = [...merged[merged.length - 1], ...bite];
    } else {
      merged.push(bite);
    }
  });
  if (merged.length > 1 && merged[0].length < MIN_BITE_WORDS) {
    merged[1] = [...merged[0], ...merged[1]];
    merged.shift();
  }

  return merged.map((b) => b.join(' '));
};

export type BuildDirection = 'forward' | 'backward';

export interface BuildUpSegment {
  text: string;
  /** The piece this stage just added -- the UI accents exactly one of these. */
  isNew: boolean;
}

export interface BuildUpStage {
  /**
   * 'bite' while stacking phrases inside one verse; 'reassemble' during the
   * final whole-verses pass that only exists for multi-verse groups.
   */
  phase: 'bite' | 'reassemble';
  /** Index into the caller's verses array. During reassemble, the newest verse. */
  verseIndex: number;
  /** Everything in play, already in reading order regardless of direction. */
  segments: BuildUpSegment[];
  /** 1-based position within this verse's build (or within the reassemble pass). */
  step: number;
  stepCount: number;
}

/**
 * Accumulates pieces one at a time, returning the growing set at each step.
 *
 * Backward chaining ('backward') builds from the last piece toward the first,
 * so every rep *ends* on the material you've practised most and the verse gets
 * easier as it lengthens rather than trailing off. Either way the returned
 * segments are sorted back into reading order -- direction changes what gets
 * added when, never what the user reads.
 */
const accumulate = (pieces: string[], direction: BuildDirection): BuildUpSegment[][] =>
  pieces.map((_, step) => {
    const indices: number[] = [];
    for (let k = 0; k <= step; k++) {
      indices.push(direction === 'forward' ? k : pieces.length - 1 - k);
    }
    const newest = direction === 'forward' ? step : pieces.length - 1 - step;
    return indices
      .sort((a, b) => a - b)
      .map((i) => ({ text: pieces[i], isNew: i === newest }));
  });

/**
 * The whole session as one flat list of stages, so the UI is an index and a
 * rep counter rather than a nest of loops.
 *
 * Verse boundaries are kept: a verse builds to completion, the screen clears,
 * and the next verse starts from its own first bite. A multi-verse group then
 * earns a reassemble pass that runs the identical machine one level up, with
 * whole verses as the pieces. A single verse gets no reassemble pass -- its
 * last bite stage already *was* the whole verse.
 */
export const buildUpStages = (
  verses: { text: string }[],
  opts: { size?: BiteSize; direction?: BuildDirection } = {}
): BuildUpStage[] => {
  const { size = 'medium', direction = 'forward' } = opts;
  const stages: BuildUpStage[] = [];

  verses.forEach((v, verseIndex) => {
    const bites = splitIntoBites(v.text, size);
    if (bites.length === 0) return;
    accumulate(bites, direction).forEach((segments, i, all) => {
      stages.push({ phase: 'bite', verseIndex, segments, step: i + 1, stepCount: all.length });
    });
  });

  if (verses.length > 1) {
    const wholeVerses = verses.map((v) => v.text);
    accumulate(wholeVerses, direction).forEach((segments, i, all) => {
      const newestIndex = direction === 'forward' ? i : verses.length - 1 - i;
      stages.push({
        phase: 'reassemble',
        verseIndex: newestIndex,
        segments,
        step: i + 1,
        stepCount: all.length,
      });
    });
  }

  return stages;
};

/**
 * Support levels, in the order a stage steps through them. These are the
 * three reps: read it, say it off first letters, say it with nothing. The
 * repetition and the fade are deliberately the same dial -- three reps of
 * identical fully-visible text is parroting, not recall.
 */
export const BUILD_UP_REPS = ['read', 'hint', 'blind'] as const;
export type BuildUpRep = (typeof BUILD_UP_REPS)[number];

export const scoreSwapAttempt = (swapVerses: SwapVerse[], selected: Set<number>): SwapScore => {
  const allTokens = swapVerses.flatMap((v) => v.tokens);
  const decoys = allTokens.filter((t) => t.isDecoy);
  const caught = decoys.filter((t) => selected.has(t.index)).length;
  const falseAlarms = allTokens.filter((t) => !t.isDecoy && selected.has(t.index)).length;
  return {
    caught,
    missed: decoys.length - caught,
    falseAlarms,
    totalDecoys: decoys.length,
  };
};
