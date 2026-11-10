import type { DrillVerse } from './drills';
import { normalizeToken, scriptOfVerse, splitWords, typedLetters } from './textScript';
import type { TextScript } from '../types';

// The pure side of Mixed review's Openings format (components/drills/OpeningsDrill).

/** Words of each verse's opening that are asked for. */
export const OPENING_WORDS = 3;

export interface OpeningResult {
  /** Share of the opening's first letters right, 0..1. Peeking is 0. */
  accuracy: number;
  peeked: boolean;
}

/** A verse's opening words, as written and as the letters they stand for. */
export const openingOf = (verse: DrillVerse, count: number = OPENING_WORDS) => {
  const script = scriptOfVerse(verse);
  const words = splitWords(verse.text, script)
    .filter((w) => normalizeToken(w, script).length > 0)
    .slice(0, count);
  return { script, words, initials: words.map((w) => Array.from(normalizeToken(w, script))[0] ?? '') };
};

/** The share of an opening's letters that match; the typed letters are cut to the opening's length. */
export const openingAccuracy = (typed: string, initials: string[], script: TextScript): number => {
  if (initials.length === 0) return 1;
  const letters = typedLetters(typed.trim(), script)
    .map((ch) => normalizeToken(ch, script))
    .filter((ch) => ch !== '');
  return initials.filter((ch, i) => letters[i] === ch).length / initials.length;
};

