import { TextScript } from '../types';
import { normalizeToken } from './recitation';
import { applyWordShape, joinWords, scriptOfVerse, splitWords, wordCore } from './textScript';

export { applyWordShape } from './textScript';

/**
 * The verse shape the drills take. `translationId` decides the writing
 * system (scriptOfVerse); without it a verse is English.
 */
export type DrillVerse = { book: string; chapter: number; verse: number; text: string; translationId?: string };

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
// review. Only real Recall (typed/spoken verbatim), the explicit manual-log
// action, and Pick up the thread (verbatim recitation too -- see its section
// at the end) affect scheduling — the rest are supplementary practice, kept
// out of the graduation path so "graduated" keeps meaning one thing.
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
export const chunkIntoPhrases = (text: string, script: TextScript = 'latin'): string[] => {
  const words = splitWords(text, script);
  if (words.length === 0) return [];
  if (words.length <= 4) return [joinWords(words)];

  const chunkCount = Math.max(2, Math.round(words.length / PHRASE_TARGET_WORDS));
  const base = Math.floor(words.length / chunkCount);
  let remainder = words.length % chunkCount;

  const chunks: string[] = [];
  let cursor = 0;
  for (let c = 0; c < chunkCount; c++) {
    const size = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    chunks.push(joinWords(words.slice(cursor, cursor + size)));
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
export const buildScrambleRounds = (verses: DrillVerse[]): ScrambleRound[] =>
  verses
    .map((v) => {
      const phrases = chunkIntoPhrases(v.text, scriptOfVerse(v));
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

/**
 * Hebrew is measured in bare consonants, and its words run short: אֱלֹהִים is
 * five letters, אֶרֶץ three. Four would leave too few eligible words.
 */
const minSwapLength = (script: TextScript): number => (script === 'hebrew' ? 3 : MIN_SWAP_WORD_LENGTH);

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
  verses: DrillVerse[],
  swapsPerVerse: number = DEFAULT_SWAPS_PER_VERSE
): SwapVerse[] => {
  // Every substantial word in the group, deduped by its comparable form --
  // the decoy vocabulary. `display` is what gets dropped into the verse: for
  // English the normalized word (applyWordShape restores its case); for
  // Hebrew/Greek the word's real letters with punctuation trimmed, because a
  // normalized Hebrew decoy has no vowel points and would be the one
  // unpointed word on screen.
  const poolByKey = new Map<string, { key: string; display: string }>();
  verses.forEach((v) => {
    const script = scriptOfVerse(v);
    splitWords(v.text, script).forEach((w) => {
      const key = normalizeToken(w, script);
      if (key.length < minSwapLength(script) || poolByKey.has(key)) return;
      poolByKey.set(key, { key, display: script === 'latin' ? key : wordCore(w, script) });
    });
  });
  const pool = Array.from(poolByKey.values());

  let flatIndex = 0;

  return verses.map((v) => {
    const script = scriptOfVerse(v);
    const words = splitWords(v.text, script);

    // Which positions in this verse are even eligible to be swapped.
    const eligible = words
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => normalizeToken(w, script).length >= minSwapLength(script))
      .map(({ i }) => i);

    // Never swap so much of a short verse that it stops being recognizable;
    // and with a thin pool there may be nothing valid to swap in at all.
    const swapCount = Math.min(swapsPerVerse, Math.floor(eligible.length / 2), Math.max(pool.length - 1, 0));
    const chosen = new Set(shuffleArray(eligible).slice(0, Math.max(swapCount, 0)));

    const tokens: SwapToken[] = words.map((word, i) => {
      const index = flatIndex++;
      if (!chosen.has(i)) return { display: word, isDecoy: false, index };

      const realWord = normalizeToken(word, script);
      const candidates = pool.filter((p) => p.key !== realWord);
      if (candidates.length === 0) return { display: word, isDecoy: false, index };

      const decoy = candidates[Math.floor(Math.random() * candidates.length)];
      return {
        display: applyWordShape(word, decoy.display, script),
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
  /** Which translation `text` is from -- the pool can mix them, so each item says. */
  translationId?: string;
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
// Greek and Hebrew clause marks, by code point because they're lookalikes of
// ASCII on screen: the ano teleia (Greek semicolon, U+0387, and the U+00B7
// middle dot SBLGNT actually uses for it), the Greek question mark (U+037E,
// which looks like ';'), and the Hebrew sof pasuq (U+05C3, end of verse).
const CLAUSE_END_EXTRA = new Set([0x0387, 0x00b7, 0x037e, 0x05c3].map((c) => String.fromCharCode(c)));
const endsClause = (word: string): boolean => {
  if (/[,;:.!?—–]["'’”)\]]*$/.test(word)) return true;
  const bare = word.replace(/["'’”)\]]+$/, '');
  return CLAUSE_END_EXTRA.has(bare.slice(-1));
};

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
export const splitIntoBites = (text: string, size: BiteSize = 'medium', script: TextScript = 'latin'): string[] => {
  const words = splitWords(text, script);
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

  return merged.map(joinWords);
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
  verses: { text: string; book?: string; translationId?: string }[],
  opts: { size?: BiteSize; direction?: BuildDirection } = {}
): BuildUpStage[] => {
  const { size = 'medium', direction = 'forward' } = opts;
  const stages: BuildUpStage[] = [];

  verses.forEach((v, verseIndex) => {
    const script = v.book ? scriptOfVerse({ book: v.book, translationId: v.translationId }) : 'latin';
    const bites = splitIntoBites(v.text, size, script);
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

// ============================================================================
// PICK UP THE THREAD
// ----------------------------------------------------------------------------
// Two words from an earlier verse, plus that verse's number; the user finds
// where those words sit and recites from there through the end of a later
// verse. It trains the joins between verses and the Bible-study reflex of
// placing a phrase in its chapter.
//
// Unlike the drills above, a graded thread DOES count toward reviews (the
// user's explicit call). That bookkeeping lives in ThreadDrillScreen; this
// section stays pure: which verses are eligible, which cue, which words.
// ============================================================================

/** A thread needs somewhere to start before the verse it ends on. */
export const MIN_THREAD_VERSES = 2;

/** How often a cue comes from the two verses just before the end verse. */
export const THREAD_NEAR_SHARE = 0.75;
const THREAD_NEAR_VERSES = 2;

/**
 * Words too common to be half of a cue alongside another common word: "and
 * the" or "in my" points nowhere. One of them beside a real word is fine
 * ("the valley").
 */
const THREAD_FILLER = new Set([
  ...HINGE_WORDS,
  'the', 'a', 'an', 'i', 'me', 'my', 'he', 'him', 'his', 'she', 'her', 'it', 'its',
  'we', 'us', 'our', 'you', 'your', 'they', 'them', 'their', 'is', 'are', 'was', 'were',
  'be', 'not', 'no', 'all', 'will', 'shall', 'have', 'has', 'had', 'this', 'these', 'those',
]);

/** A cue never straddles a sentence or clause break ("want. He"). Commas are fine. */
const breaksSentence = (word: string): boolean => {
  const bare = word.replace(/["'’”)\]]+$/, '');
  return /[.;:!?]$/.test(bare) || CLAUSE_END_EXTRA.has(bare.slice(-1));
};

/** Same chapter, same translation. A missing translationId matches only another missing one. */
const sameText = (a: { book: string; chapter: number; translationId?: string }, b: typeof a) =>
  a.book === b.book && a.chapter === b.chapter && (a.translationId || '') === (b.translationId || '');

/**
 * The unbroken run of verses from `pool` that ends at `end`, in order. A gap
 * stops it: knowing verses 1-3 and 6 gives verse 6 a run of one, because a
 * cue in verse 2 would mean reciting verses 4 and 5, which were never learned.
 */
export const threadRunEndingAt = <V extends DrillVerse>(pool: V[], end: Omit<DrillVerse, 'text'>): V[] => {
  const byNumber = new Map<number, V>();
  pool.forEach((v) => {
    if (sameText(v, end)) byNumber.set(v.verse, v);
  });
  const run: V[] = [];
  for (let n = end.verse; byNumber.has(n); n--) run.unshift(byNumber.get(n)!);
  return run;
};

/** Targets further apart than this start a separate passage rather than one long thread. */
const THREAD_TARGET_GAP = 3;

/**
 * Splits started verses into short passages that each run THROUGH the verses
 * the user asked for ("due today", "monthly reviews"). Used both for a session
 * that covers every chapter at once and to cut one long range into short
 * stitches, so a thread never asks for a whole chapter from the middle.
 *
 * `pool` is every started verse (they're the context a cue can start from);
 * `isTarget` marks the ones the filter picked. Per chapter and translation,
 * each unbroken run of verses is cut into passages that:
 *   - end on a target (or, when the only target opens the run, on the verse
 *     after it -- a thread needs somewhere to start),
 *   - start one verse before their first target, so that target is recited
 *     whole rather than only from a cue partway in,
 *   - span at most `maxSpan` verses (the user's "verses per thread"); a
 *     longer stretch is cut into windows that share a verse, so the joins
 *     between windows still get drilled.
 * Targets more than THREAD_TARGET_GAP verses apart go in separate passages.
 * Runs of one verse produce nothing. Passages come out in reading order
 * within each chapter.
 */
export const buildThreadPassages = <V extends DrillVerse>(
  pool: V[],
  isTarget: (v: V) => boolean,
  maxSpan: number = Infinity
): V[][] => {
  const span = Math.max(MIN_THREAD_VERSES, maxSpan);
  const chapters = new Map<string, V[]>();
  pool.forEach((v) => {
    const key = `${v.translationId || ''}|${v.book}|${v.chapter}`;
    chapters.set(key, [...(chapters.get(key) || []), v]);
  });

  const out: V[][] = [];
  chapters.forEach((vs) => {
    const sorted = [...vs].sort((a, b) => a.verse - b.verse);
    // Unbroken runs.
    const runs: V[][] = [];
    sorted.forEach((v, i) => {
      if (i > 0 && v.verse === sorted[i - 1].verse + 1) runs[runs.length - 1].push(v);
      else runs.push([v]);
    });

    runs.forEach((run) => {
      if (run.length < MIN_THREAD_VERSES) return;
      const targets = run.map((v, i) => (isTarget(v) ? i : -1)).filter((i) => i >= 0);
      if (targets.length === 0) return;

      const clusters: number[][] = [];
      targets.forEach((t, k) => {
        if (k > 0 && t - targets[k - 1] <= THREAD_TARGET_GAP) clusters[clusters.length - 1].push(t);
        else clusters.push([t]);
      });

      clusters.forEach((cluster) => {
        const first = cluster[0];
        const last = cluster[cluster.length - 1];
        const through = Math.max(last, 1);
        let start = Math.max(0, Math.min(first - 1, through - 1));
        while (start < through) {
          const end = Math.min(start + span - 1, through);
          out.push(run.slice(start, end + 1));
          if (end === through) break;
          start = end;
        }
      });
    });
  });
  return out;
};

export interface ThreadCue {
  /** Index into the verses the cue was built from. */
  startVerse: number;
  /** Index into splitWords(text) of the start verse -- where reciting begins. */
  startWord: number;
  /** Index of the verse the recitation runs through to its end. */
  endVerse: number;
  /** The cue as written, outer punctuation trimmed. Usually two words. */
  cueWords: string[];
}

/** Identity of a cue spot, for "don't repeat until the others are used". */
export const threadCueKey = (cue: Pick<ThreadCue, 'startVerse' | 'startWord'>) => `${cue.startVerse}:${cue.startWord}`;

const trimForCue = (word: string) => word.replace(/^["'‘“(\[]+/, '').replace(/[,;:.!?—–"'’”)\]]+$/, '');

/** How often each run of `length` words appears across the range, never crossing a verse boundary. */
const sequenceCounts = (verses: DrillVerse[], length: number): Map<string, number> => {
  const counts = new Map<string, number>();
  verses.forEach((v) => {
    const script = scriptOfVerse(v);
    const norms = splitWords(v.text, script).map((w) => normalizeToken(w, script));
    for (let j = 0; j + length <= norms.length; j++) {
      const slice = norms.slice(j, j + length);
      if (slice.some((n) => n.length === 0)) continue;
      const key = slice.join(' ');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  });
  return counts;
};

/**
 * Every position in verse `verseIdx` where a cue of `length` words could
 * start. A cue must appear exactly once in the whole range, so it has one
 * right answer; `strict` adds the no-filler and no-sentence-break rules.
 */
const cueSpotsIn = (
  verses: DrillVerse[],
  verseIdx: number,
  length: number,
  counts: Map<string, number>,
  strict: boolean
): number[] => {
  const v = verses[verseIdx];
  const script = scriptOfVerse(v);
  const words = splitWords(v.text, script);
  const spots: number[] = [];
  for (let j = 0; j + length <= words.length; j++) {
    const slice = words.slice(j, j + length);
    const norms = slice.map((w) => normalizeToken(w, script));
    if (norms.some((n) => n.length === 0)) continue;
    if (counts.get(norms.join(' ')) !== 1) continue;
    if (strict) {
      if (slice.slice(0, -1).some(breaksSentence)) continue;
      if (norms.every((n) => THREAD_FILLER.has(n))) continue;
    }
    spots.push(j);
  }
  return spots;
};

/**
 * Picks the next cue for a thread ending at `endVerse`.
 *
 * The start verse is drawn from `fromVerse`..`endVerse - 1`, with
 * THREAD_NEAR_SHARE of picks landing on the one or two verses right before
 * the end -- the joins that need the most work. Only when the range has
 * nothing before the end verse does the cue fall inside the end verse itself.
 *
 * `beforeVerse` (exclusive) caps where the cue may start, so a caller can ask
 * for a cue that reaches back past a window it already recited.
 *
 * `used` holds threadCueKey()s already given this session; they're skipped
 * until every spot has been used, then they come back around. Returns null
 * only when the range has no usable words at all.
 */
export const pickThreadCue = (
  verses: DrillVerse[],
  endVerse: number,
  opts: { fromVerse?: number; beforeVerse?: number; used?: ReadonlySet<string>; random?: () => number } = {}
): ThreadCue | null => {
  const { fromVerse = 0, beforeVerse = endVerse, used = new Set<string>(), random = Math.random } = opts;
  if (endVerse < 0 || endVerse >= verses.length) return null;

  const lo = Math.max(0, Math.min(fromVerse, endVerse));
  const starts: number[] = [];
  for (let i = lo; i < Math.min(endVerse, beforeVerse); i++) starts.push(i);
  if (starts.length === 0) starts.push(endVerse);

  // Strictest first: a clean two-word cue. Then relax the filler and
  // sentence-break rules, then allow three words -- a range of short,
  // repetitive verses can run out of unique clean pairs.
  const attempts: { length: number; strict: boolean }[] = [
    { length: 2, strict: true },
    { length: 2, strict: false },
    { length: 3, strict: true },
    { length: 3, strict: false },
  ];

  for (const { length, strict } of attempts) {
    const counts = sequenceCounts(verses, length);
    const spotsByVerse = new Map<number, number[]>();
    starts.forEach((i) => spotsByVerse.set(i, cueSpotsIn(verses, i, length, counts, strict)));

    const isFresh = (i: number, j: number) => !used.has(threadCueKey({ startVerse: i, startWord: j }));
    const openStarts = (freshOnly: boolean) =>
      starts.filter((i) => (spotsByVerse.get(i) || []).some((j) => !freshOnly || isFresh(i, j)));

    let open = openStarts(true);
    const freshOnly = open.length > 0;
    if (!freshOnly) open = openStarts(false);
    if (open.length === 0) continue;

    const near = open.filter((i) => i >= endVerse - THREAD_NEAR_VERSES);
    const far = open.filter((i) => i < endVerse - THREAD_NEAR_VERSES);
    const group = far.length === 0 ? near : near.length === 0 ? far : random() < THREAD_NEAR_SHARE ? near : far;
    const startVerse = group[Math.floor(random() * group.length)];

    const spots = (spotsByVerse.get(startVerse) || []).filter((j) => !freshOnly || isFresh(startVerse, j));
    const startWord = spots[Math.floor(random() * spots.length)];
    const words = splitWords(verses[startVerse].text, scriptOfVerse(verses[startVerse]));
    return {
      startVerse,
      startWord,
      endVerse,
      cueWords: words.slice(startWord, startWord + length).map(trimForCue),
    };
  }
  return null;
};

export interface ThreadSpanVerse {
  /** Index into the verses the cue was built from. */
  index: number;
  /** The words to recite from this verse, as written (from the cue on, for the start verse). */
  words: string[];
  /** Words of the start verse before the cue -- shown dimmed when the text is revealed. */
  before: string[];
}

/**
 * The stretch a cue asks for, verse by verse. Joined back together it must be
 * exactly the original text from the cue word to the end of the end verse --
 * the check script's first assertion.
 */
export const threadSpan = (verses: DrillVerse[], cue: ThreadCue): ThreadSpanVerse[] => {
  const out: ThreadSpanVerse[] = [];
  for (let i = cue.startVerse; i <= cue.endVerse; i++) {
    const all = splitWords(verses[i].text, scriptOfVerse(verses[i]));
    const from = i === cue.startVerse ? cue.startWord : 0;
    out.push({ index: i, words: all.slice(from), before: all.slice(0, from) });
  }
  return out;
};

/**
 * Whether the start verse earns review credit: only when the cue lands in its
 * first half, so at least half the verse was actually recited. Every later
 * verse in the span is recited whole and always qualifies.
 */
export const threadStartVerseCounts = (verses: DrillVerse[], cue: ThreadCue): boolean => {
  const v = verses[cue.startVerse];
  const script = scriptOfVerse(v);
  const graded = splitWords(v.text, script).map((w) => normalizeToken(w, script).length > 0);
  const total = graded.filter(Boolean).length;
  const before = graded.slice(0, cue.startWord).filter(Boolean).length;
  return total > 0 && before < total / 2;
};

/** How many words either side of a join a miss is blamed on the join rather than the verse. */
const JOIN_HEAD = 3;
const JOIN_TAIL = 2;

export interface ThreadSlip {
  /** Index into the verses the cue was built from. */
  verse: number;
  /** 'join': stumbled getting INTO this verse. 'inside': somewhere within it. */
  kind: 'join' | 'inside';
}

/**
 * Where a graded thread went wrong. `missedByVerse` holds, per span verse,
 * whether each of its graded words was missed. A miss in the first few words
 * of a verse, or the last couple of the verse before it, is a slip at the
 * join into that verse; anything else is a slip inside the verse. At most one
 * slip per verse, join first -- the recap counts runs, not words.
 */
export const threadSlips = (span: ThreadSpanVerse[], missedByVerse: boolean[][]): ThreadSlip[] => {
  const slips: ThreadSlip[] = [];
  span.forEach((sv, k) => {
    const missed = missedByVerse[k] || [];
    if (k > 0) {
      const prev = missedByVerse[k - 1] || [];
      if (missed.slice(0, JOIN_HEAD).some(Boolean) || prev.slice(-JOIN_TAIL).some(Boolean)) {
        slips.push({ verse: sv.index, kind: 'join' });
        return;
      }
    }
    // The tail belongs to the join into the next verse when there is one, so
    // a stumble there isn't counted twice.
    const ownWords = k < span.length - 1 ? missed.slice(0, Math.max(0, missed.length - JOIN_TAIL)) : missed;
    if (ownWords.some(Boolean)) slips.push({ verse: sv.index, kind: 'inside' });
  });
  return slips;
};
