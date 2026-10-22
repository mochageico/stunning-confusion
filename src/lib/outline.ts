import type { TextScript } from '../types';
import { sectionIndexOf } from './sections';
import { joinWords, normalizeToken, scriptOfVerse, splitWords } from './textScript';
import { summarizeOutcomes, WordOutcome } from './recitation';

// ============================================================================
// FIRST WORDS (OUTLINE)
// ----------------------------------------------------------------------------
// One row per verse: its number, its first few words, then a faint line for
// the rest. Reciting a row says the whole verse from those first words, so it
// brings words out of memory and counts as a review (MIXED_REVIEW_PLAN.md,
// stage 2). Pure: no React, no Firestore (tested by outline.check.ts).
//
// How many words show: a slider sets one number for every verse (0-4), and a
// tap on a verse opens one more word on that verse alone, wrapping back to the
// slider's number after 4. The taps are saved per chapter as `outlineExtra`.
//
// Direction: the list, and "Run it", go first to last or last to first. Each
// verse is still said forward; only the order of the verses flips. Results are
// keyed by the verse, never by position in the run, so reversing can't credit
// the wrong verse (see recordRunResult).
// ============================================================================

export const OUTLINE_MIN_WORDS = 0;
export const OUTLINE_MAX_WORDS = 4;
export const DEFAULT_OUTLINE_WORDS = 3;

export type OutlineDirection = 'forward' | 'reverse';

/** Extra words the user tapped open, by verse number. */
export type OutlineExtra = Record<number, number>;

export interface OutlineVerse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  translationId?: string;
}

/** Identifies a verse across chapters and translations. */
export const outlineKey = (v: Pick<OutlineVerse, 'book' | 'chapter' | 'verse' | 'translationId'>): string =>
  `${v.translationId || ''}|${v.book}|${v.chapter}|${v.verse}`;

/**
 * Extra words after one more tap: one more word, or back to none once the
 * verse would show more than the maximum. With the slider on 3, taps go
 * 3 -> 4 -> 3; with it on 0, 0 -> 1 -> 2 -> 3 -> 4 -> 0.
 */
export function bumpExtra(base: number, extra: number): number {
  return base + extra + 1 > OUTLINE_MAX_WORDS ? 0 : extra + 1;
}

/** Words a verse shows: the slider's number plus its taps, never past the maximum. */
export const shownWordCount = (base: number, extra: number | undefined): number =>
  Math.min(OUTLINE_MAX_WORDS, Math.max(OUTLINE_MIN_WORDS, base) + (extra ?? 0));

/** Only the taps worth saving: whole numbers 1-4, verse numbers as keys. */
export function cleanExtra(extra: OutlineExtra | undefined | null): OutlineExtra {
  const out: OutlineExtra = {};
  for (const [verse, n] of Object.entries(extra ?? {})) {
    if (Number.isInteger(n) && n >= 1 && n <= OUTLINE_MAX_WORDS && Number.isInteger(Number(verse))) out[Number(verse)] = n;
  }
  return out;
}

export interface OutlineRow {
  key: string;
  verse: OutlineVerse;
  script: TextScript;
  /** The words shown, punctuation-only tokens included, as one line. */
  shown: string;
  /** How many graded words `shown` holds. The same count GradedRecitation treats as shown. */
  shownCount: number;
  /** Graded words in the whole verse. */
  totalWords: number;
  /** Share of the verse still hidden, 0..1. Sizes the faint line. */
  restShare: number;
  /** Extra words tapped open on this verse. */
  extra: number;
}

/** One verse as a row: its first `base + extra` words, the rest hidden. */
export function outlineRow(verse: OutlineVerse, base: number, extra: number | undefined): OutlineRow {
  const script = scriptOfVerse(verse);
  const words = splitWords(verse.text, script);
  const totalWords = words.filter((w) => normalizeToken(w, script).length > 0).length;
  const want = Math.min(shownWordCount(base, extra), totalWords);
  const shownTokens: string[] = [];
  let counted = 0;
  for (const w of words) {
    const isWord = normalizeToken(w, script).length > 0;
    if (isWord && counted >= want) break;
    shownTokens.push(w);
    if (isWord) counted++;
  }
  return {
    key: outlineKey(verse),
    verse,
    script,
    shown: joinWords(shownTokens),
    shownCount: counted,
    totalWords,
    restShare: totalWords === 0 ? 0 : (totalWords - counted) / totalWords,
    extra: extra ?? 0,
  };
}

/** The words of the verse GradedRecitation should leave visible: its first `shownCount`. */
export const shownIndices = (row: Pick<OutlineRow, 'shownCount'>): Set<number> =>
  new Set(Array.from({ length: row.shownCount }, (_, i) => i));

/** The verses in the order they're listed and run. */
export function orderVerses<V>(verses: V[], direction: OutlineDirection): V[] {
  return direction === 'reverse' ? verses.slice().reverse() : verses.slice();
}

export interface OutlineGroup {
  /** The section's start verse, or null when the chapter has no sections. */
  sectionStart: number | null;
  /** 0-based position among the chapter's sections, or -1 with none. */
  sectionIndex: number;
  rows: OutlineRow[];
}

/**
 * The listed rows cut into consecutive groups by section, so the list can draw a
 * divider (label, memory-phrase word) above each. `rows` are already in listed
 * order. With no starts it's one group. Uses the chapter's real starts, not a
 * re-normalized copy, so a partial selection (verses 9-11 of a section that
 * starts on 7) still reads under that section's label.
 */
export function groupBySection(rows: OutlineRow[], starts: number[] | null): OutlineGroup[] {
  if (!starts || starts.length === 0) return [{ sectionStart: null, sectionIndex: -1, rows }];
  const groups: OutlineGroup[] = [];
  for (const row of rows) {
    const sectionIndex = sectionIndexOf(starts, row.verse.verse);
    const last = groups[groups.length - 1];
    if (last && last.sectionIndex === sectionIndex) last.rows.push(row);
    else groups.push({ sectionStart: sectionIndex >= 0 ? starts[sectionIndex] : null, sectionIndex, rows: [row] });
  }
  return groups;
}

// ---- Grading ---------------------------------------------------------------

export interface OutlineVerseResult {
  key: string;
  verse: OutlineVerse;
  /** 0..1 */
  accuracy: number;
  /** At least REVIEW_PASS_ACCURACY of the words right. */
  passed: boolean;
  /** Not one word missed. */
  perfect: boolean;
  mode: 'speak' | 'type';
  /** Words that were showing, so a recap can say how much help there was. */
  shownCount: number;
}

/** A verse's graded words, as GradedRecitation returns them, turned into its result. */
export function gradeOutlineVerse(row: OutlineRow, outcomes: WordOutcome[], mode: 'speak' | 'type'): OutlineVerseResult {
  const summary = summarizeOutcomes(outcomes);
  return {
    key: row.key,
    verse: row.verse,
    accuracy: summary.accuracy,
    passed: summary.passesReview,
    perfect: summary.isPerfect,
    mode,
    shownCount: row.shownCount,
  };
}

// ---- A run -----------------------------------------------------------------

export interface OutlineRun {
  /** Verse keys in the order they'll be said. */
  queue: string[];
  /** Position in `queue` of the verse being said. */
  index: number;
  /** Results so far, by verse key. */
  results: Record<string, OutlineVerseResult>;
}

/** Starts a run over the rows as listed (so the chosen direction is already applied). */
export const startRun = (rows: Pick<OutlineRow, 'key'>[]): OutlineRun => ({ queue: rows.map((r) => r.key), index: 0, results: {} });

export const runCurrent = (run: OutlineRun): string | null => run.queue[run.index] ?? null;

export const runDone = (run: OutlineRun): boolean => run.index >= run.queue.length;

/**
 * Files a result under its verse and moves to the next one. A result for any
 * verse other than the one being said is ignored, so a late callback from a
 * round that has since moved on can't land on the wrong verse.
 */
export function recordRunResult(run: OutlineRun, result: OutlineVerseResult): OutlineRun {
  if (runCurrent(run) !== result.key) return run;
  return { ...run, index: run.index + 1, results: { ...run.results, [result.key]: result } };
}

/** The run's results in the order they were said. */
export const runResultsInOrder = (run: OutlineRun): OutlineVerseResult[] =>
  run.queue.map((k) => run.results[k]).filter((r): r is OutlineVerseResult => !!r);
