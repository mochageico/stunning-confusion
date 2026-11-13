// ============================================================================
// REFERENCES (FREE_PRACTICE_PLAN.md, stage 4)
// ----------------------------------------------------------------------------
// A multiple-choice drill on verse numbers, built for speed. Two directions:
//   - Verse -> number: see the verse, pick its number.
//   - Number -> verse: see the reference, pick the verse from its opening
//     words.
// The user's rules (2026-11-13):
//   - Choices come only from the picked verses in the same chapter, nearest
//     neighbors first, up to 4. A chapter with only 2 picked gives 2
//     choices; never pad with verses that weren't picked.
//   - Picks from several chapters mix into one round (every other mode goes
//     one chapter at a time).
//   - Hebrew and Greek verses are left out for now.
//   - Practice only: it never credits a review.
// A verse that is the only pick in its chapter has nothing to choose
// between, so it sits the round out.
// Pure logic; the screen is components/drills/ReferenceQuizDrill.tsx.
// ============================================================================

import type { DrillVerse } from './drills';
import { scriptOfVerse, splitWords } from './textScript';

export type RefDirection = 'v2n' | 'n2v';
export type RefDirectionPref = RefDirection | 'both';

export const REF_MAX_CHOICES = 4;
export const REF_OPENING_WORDS = 7;

export interface RefQuestion<V extends DrillVerse = DrillVerse> {
  target: V;
  direction: RefDirection;
  /** Includes the target. Verse -> number keeps verse order; Number -> verse is shuffled. */
  choices: V[];
}

const chapterKey = (v: DrillVerse) => `${v.translationId ?? ''}|${v.book}|${v.chapter}`;

/** The picked verses that can be asked, by chapter, each chapter in verse order. */
export function refChapters<V extends DrillVerse>(verses: V[]): V[][] {
  const byChapter = new Map<string, Map<number, V>>();
  for (const v of verses) {
    if (scriptOfVerse(v) !== 'latin') continue;
    const k = chapterKey(v);
    if (!byChapter.has(k)) byChapter.set(k, new Map());
    byChapter.get(k)!.set(v.verse, v);
  }
  return [...byChapter.values()]
    .map((m) => [...m.values()].sort((a, b) => a.verse - b.verse))
    .filter((c) => c.length >= 2);
}

/** Whether References has anything to ask in these verses. */
export const referencesFit = (verses: DrillVerse[]): boolean => refChapters(verses).length > 0;

/** The verses References will ask about (those with a chapter-mate picked). */
export const refAskable = <V extends DrillVerse>(verses: V[]): V[] => refChapters(verses).flat();

/**
 * Up to REF_MAX_CHOICES consecutive picks from the target's chapter that
 * include the target, at a random spot in the window so the target isn't
 * always first or last.
 */
export function choiceWindow<V extends DrillVerse>(chapter: V[], target: V, rand: () => number = Math.random): V[] {
  const size = Math.min(REF_MAX_CHOICES, chapter.length);
  const i = chapter.findIndex((v) => v.verse === target.verse);
  const lo = Math.max(0, i - (size - 1));
  const hi = Math.min(i, chapter.length - size);
  const start = lo + Math.floor(rand() * (hi - lo + 1));
  return chapter.slice(start, start + size);
}

export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * One round: every askable verse once, in random order. `only` limits it to
 * some verses (the missed ones), still choosing among all the picks.
 */
export function buildRefRound<V extends DrillVerse>(
  verses: V[],
  pref: RefDirectionPref,
  rand: () => number = Math.random,
  only?: V[],
): RefQuestion<V>[] {
  const chapters = refChapters(verses);
  const chapterOf = new Map<string, V[]>();
  chapters.forEach((c) => chapterOf.set(chapterKey(c[0]), c));
  const wanted = only ? new Set(only.map((v) => `${chapterKey(v)}|${v.verse}`)) : null;
  const targets = chapters.flat().filter((v) => !wanted || wanted.has(`${chapterKey(v)}|${v.verse}`));
  return shuffle(targets, rand).map((target) => {
    const direction: RefDirection = pref === 'both' ? (rand() < 0.5 ? 'v2n' : 'n2v') : pref;
    const window = choiceWindow(chapterOf.get(chapterKey(target))!, target, rand);
    return { target, direction, choices: direction === 'n2v' ? shuffle(window, rand) : window };
  });
}

/** A verse's first few words, for Number -> verse choices. */
export function refOpening(v: DrillVerse, words: number = REF_OPENING_WORDS): string {
  const all = splitWords(v.text, scriptOfVerse(v));
  return all.slice(0, words).join(' ') + (all.length > words ? '…' : '');
}

/** "Romans 8:33". */
export const refLabel = (v: DrillVerse): string => `${v.book} ${v.chapter}:${v.verse}`;

/** Whether the picks span more than one chapter (the prompt then names the chapter). */
export const refManyChapters = (verses: DrillVerse[]): boolean => refChapters(verses).length > 1;
