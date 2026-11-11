import { buildSwapVerses, DrillVerse } from './drills';
import type { TextScript } from '../types';
import { normalizeToken, scriptOfVerse, splitWords, typedLetters } from './textScript';

// ============================================================================
// SPOT THE GAP -- Mixed review's replacement for Find the wrong word.
// ----------------------------------------------------------------------------
// A passage with 0-3 look-alike words planted in it (never announced), a few
// blanks on verse openings and clause joins where the user types the first
// letters, and, with verse numbers hidden, a number box beside each verse.
// Everything is pure here: the screen draws a GapRound and hands the answers
// back to scoreGap, whose per-verse accuracy feeds the ordinary recall grade.
// ============================================================================

export const GAP_MAX_SWAPS = 5;
export const GAP_MAX_BLANKS = 5;
/** A verse shorter than this has too little left to blank. */
export const GAP_MIN_BLANK_VERSE_WORDS = 4;
/** Words a blank hides: two, or three about 4 times in 10. */
const GAP_BLANK_WORDS = 3;
/** A lone verse this long gets a second blank. */
const GAP_TWO_BLANK_VERSE_WORDS = 12;

export type Rng = () => number;

export interface GapWord {
  /** Flat index across the section: the tap key. */
  index: number;
  /** What is shown: the planted word when swapped, otherwise the real one. */
  text: string;
  isDecoy: boolean;
  /** The real word, only when isDecoy. */
  original?: string;
  /** Set on every word a blank hides. */
  blank?: number;
}

export interface GapBlank {
  id: number;
  verseIndex: number;
  /** The real words it hides. */
  words: string[];
}

export interface GapVerse {
  /** Position in the verses the round was built from. */
  verseIndex: number;
  verse: number;
  words: GapWord[];
}

export interface GapRound {
  /** In display order (shuffled when `shuffled`). */
  verses: GapVerse[];
  blanks: GapBlank[];
  /** A number box sits beside each verse. Never with a single verse. */
  hideNumbers: boolean;
  shuffled: boolean;
  script: TextScript;
}

export interface GapOptions {
  hideNumbers?: boolean;
  shuffle?: boolean;
  rng?: Rng;
}

const shuffle = <T,>(xs: T[], rng: Rng): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** 0 to 5 planted words, weighted toward 2 to 4 (0 stays possible, so finding none is never a given). */
export const drawSwapCount = (rng: Rng): number => {
  const r = rng();
  return r < 0.05 ? 0 : r < 0.15 ? 1 : r < 0.4 ? 2 : r < 0.7 ? 3 : r < 0.9 ? 4 : 5;
};

const clauseBoundary = (word: string): boolean => /[:;][”’"')\]]*$/.test(word);

/** Whether this format has something to blank in the section. */
export const gapFits = (verses: DrillVerse[]): boolean =>
  verses.length > 0 && verses.some((v) => splitWords(v.text, scriptOfVerse(v)).length >= GAP_MIN_BLANK_VERSE_WORDS);

interface Span {
  verseIndex: number;
  start: number;
  len: number;
}

/**
 * Blanks: openings of verses 2 and up (no verse before to lean on) first, then
 * clause joins after a colon or semicolon. One verse gets a single blank at a
 * join, else mid-verse.
 */
const planBlanks = (wordsByVerse: string[][], script: TextScript, rng: Rng): Span[] => {
  const n = wordsByVerse.length;
  const usable = (v: number, from: number, len: number) =>
    from >= 0 &&
    from + len <= wordsByVerse[v].length &&
    wordsByVerse[v].slice(from, from + len).every((w) => normalizeToken(w, script) !== '');
  const spanAt = (v: number, from: number): Span | null => {
    const wanted = rng() < 0.4 ? GAP_BLANK_WORDS : 2;
    const len = [wanted, 2, 1].find((l) => l <= wanted && usable(v, from, l)) ?? 0;
    return len > 0 ? { verseIndex: v, start: from, len } : null;
  };
  const longEnough = (v: number) => wordsByVerse[v].length >= GAP_MIN_BLANK_VERSE_WORDS;

  const joins = (v: number): Span[] => {
    const out: Span[] = [];
    // Past the verse's own opening, with a word left after the join.
    for (let j = 3; j < wordsByVerse[v].length; j++) {
      if (!clauseBoundary(wordsByVerse[v][j - 1])) continue;
      const s = spanAt(v, j);
      if (s) out.push(s);
    }
    return out;
  };

  if (n === 1) {
    if (!longEnough(0)) return [];
    const out: Span[] = shuffle(joins(0), rng).slice(0, 1);
    if (out.length === 0) {
      const start = 1 + Math.floor(rng() * Math.max(1, wordsByVerse[0].length - 3));
      const s = spanAt(0, start);
      if (s) out.push(s);
    }
    // A long lone verse gets a second gap, well clear of the first.
    if (out.length === 1 && wordsByVerse[0].length >= GAP_TWO_BLANK_VERSE_WORDS) {
      const at = out[0].start;
      const far = Array.from({ length: wordsByVerse[0].length }, (_, i) => i).filter((i) => i >= 1 && Math.abs(i - at) >= 5);
      const second = far.length > 0 ? spanAt(0, far[Math.floor(rng() * far.length)]) : null;
      if (second) out.push(second);
    }
    return out;
  }

  const want = Math.min(GAP_MAX_BLANKS, Math.max(2, Math.round(n * 0.8)));
  const openingsWanted = Math.max(1, Math.ceil(want * 0.6));
  const chosen: Span[] = [];
  const takenVerses = new Set<number>();

  const openings = shuffle(
    Array.from({ length: n - 1 }, (_, i) => i + 1).filter(longEnough),
    rng
  )
    .map((v) => spanAt(v, 0))
    .filter((s): s is Span => !!s);
  openings.slice(0, openingsWanted).forEach((s) => {
    chosen.push(s);
    takenVerses.add(s.verseIndex);
  });

  const joinPool = shuffle(
    Array.from({ length: n }, (_, v) => v).flatMap((v) => joins(v)),
    rng
  );
  // One join per verse, in verses without a blank yet first.
  const sorted = [...joinPool.filter((s) => !takenVerses.has(s.verseIndex)), ...joinPool.filter((s) => takenVerses.has(s.verseIndex))];
  for (const s of sorted) {
    if (chosen.length >= want) break;
    if (chosen.some((c) => c.verseIndex === s.verseIndex && Math.abs(c.start - s.start) < 4)) continue;
    chosen.push(s);
    takenVerses.add(s.verseIndex);
  }

  for (const s of openings.slice(openingsWanted)) {
    if (chosen.length >= want) break;
    chosen.push(s);
  }
  if (chosen.length === 0) {
    // Nothing else fits: the first verse's opening.
    const first = longEnough(0) ? spanAt(0, 0) : null;
    if (first) chosen.push(first);
  }
  return chosen;
};

/** A new round over a section, or null when there is nothing to blank. */
export const buildGapRound = (verses: DrillVerse[], opts: GapOptions = {}): GapRound | null => {
  if (!gapFits(verses)) return null;
  const rng = opts.rng ?? Math.random;
  const script = scriptOfVerse(verses[0]);
  const wordsByVerse = verses.map((v) => splitWords(v.text, scriptOfVerse(v)));

  const spans = planBlanks(wordsByVerse, script, rng);
  if (spans.length === 0) return null;
  const blankAt = new Map<string, number>();
  spans.forEach((s, id) => {
    for (let k = 0; k < s.len; k++) blankAt.set(`${s.verseIndex}:${s.start + k}`, id);
  });

  // Planted words, kept at random and never on a blank.
  const swapVerses = buildSwapVerses(verses, 3);
  const decoys = swapVerses.flatMap((sv, v) =>
    sv.tokens.flatMap((t, j) => (t.isDecoy && !blankAt.has(`${v}:${j}`) ? [{ v, j, index: t.index }] : []))
  );
  const kept = new Set(shuffle(decoys, rng).slice(0, Math.min(drawSwapCount(rng), GAP_MAX_SWAPS, decoys.length)).map((d) => d.index));

  const built: GapVerse[] = verses.map((v, verseIndex) => ({
    verseIndex,
    verse: v.verse,
    words: swapVerses[verseIndex].tokens.map((t, j) => {
      const blank = blankAt.get(`${verseIndex}:${j}`);
      const isDecoy = kept.has(t.index);
      return {
        index: t.index,
        text: isDecoy ? t.display : wordsByVerse[verseIndex][j],
        isDecoy,
        ...(isDecoy ? { original: t.original } : {}),
        ...(blank !== undefined ? { blank } : {}),
      };
    }),
  }));

  let order = built;
  const shuffled = !!opts.shuffle && built.length > 1;
  if (shuffled) {
    order = shuffle(built, rng);
    // Never hand back the passage in its own order.
    if (order.every((gv, i) => gv.verseIndex === i)) order = [...order.slice(1), order[0]];
  }

  return {
    verses: order,
    blanks: spans.map((s, id) => ({ id, verseIndex: s.verseIndex, words: wordsByVerse[s.verseIndex].slice(s.start, s.start + s.len) })),
    hideNumbers: !!opts.hideNumbers && built.length > 1,
    shuffled,
    script,
  };
};

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------

/**
 * Whether typed letters answer a blank: one letter per hidden word, or the
 * words typed out (each only needs its first letter right). Case, spaces and
 * punctuation don't matter.
 */
export const blankCorrect = (typed: string, words: string[], script: TextScript): boolean => {
  const firstOf = (w: string) => Array.from(normalizeToken(w, script))[0] ?? '';
  const expected = words.map(firstOf);
  const letters = typedLetters(typed.trim(), script)
    .map((ch) => normalizeToken(ch, script))
    .filter((ch) => ch !== '');
  if (letters.length === 0) return false;
  if (letters.length === expected.length && letters.every((ch, i) => ch === expected[i])) return true;
  const tokens = typed.trim().split(/\s+/).filter(Boolean);
  return tokens.length === expected.length && tokens.every((t, i) => firstOf(t) === expected[i]);
};

export interface GapAnswers {
  /** Flat word indices the user tapped as wrong. */
  flagged: ReadonlySet<number>;
  /** What was typed in each blank, by blank id. */
  typed: Readonly<Record<number, string>>;
  /** What was typed in each verse's number box, by verseIndex. */
  numbers: Readonly<Record<number, string>>;
}

export interface GapVerseScore {
  verseIndex: number;
  planted: number;
  caught: number;
  falseAlarms: number;
  blanks: number;
  blanksRight: number;
  /** null when numbers are showing. */
  numberRight: boolean | null;
  /** Things the verse was tested on, and how many went right. */
  items: number;
  correct: number;
  /** 0..1: this verse's own share, or the section's when the verse tested nothing. */
  accuracy: number;
  perfect: boolean;
}

export interface GapScore {
  perVerse: GapVerseScore[];
  planted: number;
  caught: number;
  falseAlarms: number;
  blanks: number;
  blanksRight: number;
  numbers: number;
  numbersRight: number;
  accuracy: number;
  perfect: boolean;
}

export const scoreGap = (round: GapRound, answers: GapAnswers): GapScore => {
  const byIndex = [...round.verses].sort((a, b) => a.verseIndex - b.verseIndex);
  const rows = byIndex.map((gv) => {
    const planted = gv.words.filter((w) => w.isDecoy);
    const caught = planted.filter((w) => answers.flagged.has(w.index)).length;
    const falseAlarms = gv.words.filter((w) => !w.isDecoy && answers.flagged.has(w.index)).length;
    const blanks = round.blanks.filter((b) => b.verseIndex === gv.verseIndex);
    const blanksRight = blanks.filter((b) => blankCorrect(answers.typed[b.id] ?? '', b.words, round.script)).length;
    const numberRight = round.hideNumbers ? Number.parseInt((answers.numbers[gv.verseIndex] ?? '').trim(), 10) === gv.verse : null;
    const items = planted.length + falseAlarms + blanks.length + (numberRight === null ? 0 : 1);
    const correct = caught + blanksRight + (numberRight ? 1 : 0);
    return { verseIndex: gv.verseIndex, planted: planted.length, caught, falseAlarms, blanks: blanks.length, blanksRight, numberRight, items, correct };
  });

  const items = rows.reduce((n, r) => n + r.items, 0);
  const correct = rows.reduce((n, r) => n + r.correct, 0);
  const accuracy = items === 0 ? 1 : correct / items;
  const perVerse: GapVerseScore[] = rows.map((r) => ({
    ...r,
    accuracy: r.items === 0 ? accuracy : r.correct / r.items,
    perfect: r.items === 0 ? correct === items : r.correct === r.items,
  }));
  return {
    perVerse,
    planted: rows.reduce((n, r) => n + r.planted, 0),
    caught: rows.reduce((n, r) => n + r.caught, 0),
    falseAlarms: rows.reduce((n, r) => n + r.falseAlarms, 0),
    blanks: rows.reduce((n, r) => n + r.blanks, 0),
    blanksRight: rows.reduce((n, r) => n + r.blanksRight, 0),
    numbers: rows.filter((r) => r.numberRight !== null).length,
    numbersRight: rows.filter((r) => r.numberRight).length,
    accuracy,
    perfect: correct === items,
  };
};
