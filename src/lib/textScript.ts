import { TextScript } from '../types';
import { textScriptFor } from '../data';
import { GREEK_BASE_PAIRS } from './greekBaseLetters';

// ============================================================================
// WRITING-SYSTEM-AWARE WORD HANDLING
// ----------------------------------------------------------------------------
// Every drill reduces verse text to words, compares words, and shows partial
// words (first letters, masks). For English that meant "keep a-z0-9", which
// turns every Hebrew or Greek word into an empty string -- and the drills
// treat an empty-normalizing word as punctuation, so a Hebrew verse had no
// counted words at all. Everything here takes the passage's TextScript
// ('latin' by default, so English behaves byte-for-byte as before).
//
// Characters are classified by code point rather than by regex literals:
// Hebrew points and Greek accents are combining marks, invisible on their own
// in source code, and a file full of invisible characters is unreviewable.
//
// Decisions (HEBREW_GREEK_PLAN.md): Hebrew compares on bare consonants with
// final forms folded (ך = כ); a maqaf (־) ends a word, so אֶל־הָאָרֶץ is two;
// first-letter hints show the bare consonant. Greek compares on bare
// lowercase letters (Ἐν = εν, ς = σ).
// ============================================================================

const code = (ch: string): number => ch.charCodeAt(0);

// ── Hebrew ──────────────────────────────────────────────────────────────────

const MAQAF = String.fromCharCode(0x05be);

/** א..ת, final forms included. */
const isHebrewLetter = (ch: string): boolean => {
  const c = code(ch);
  return c >= 0x05d0 && c <= 0x05ea;
};

/**
 * Anything that stacks on a Hebrew letter: cantillation accents (0591-05AF),
 * vowel points and dagesh (05B0-05BD), rafe (05BF), shin/sin dots (05C1-2),
 * the extraordinary dots (05C4-5) and qamats qatan (05C7). Not the maqaf,
 * paseq or sof pasuq, which are punctuation between words.
 */
const isHebrewMark = (ch: string): boolean => {
  const c = code(ch);
  return (c >= 0x0591 && c <= 0x05bd) || c === 0x05bf || c === 0x05c1 || c === 0x05c2 || c === 0x05c4 || c === 0x05c5 || c === 0x05c7;
};

// Final forms fold onto the regular letter, so typing כ for a word-final ך
// counts and the two spellings compare equal.
const HEBREW_FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

// Hebrew presentation forms (U+FB1D-U+FB4F): single characters for a letter
// already carrying a point -- בּ with dagesh, שׁ with shin dot, the wide
// letters. Some Hebrew keyboards type these instead of letter + point, so
// each maps to its bare letter. Generated from Unicode's compatibility
// decompositions (NFKD); FB4F, the alef-lamed ligature, maps to its alef.
const HEBREW_PRESENTATION: Record<number, number> = {
  0xfb1d: 0x5d9, 0xfb20: 0x5e2, 0xfb21: 0x5d0, 0xfb22: 0x5d3, 0xfb23: 0x5d4, 0xfb24: 0x5db, 0xfb25: 0x5dc,
  0xfb26: 0x5dd, 0xfb27: 0x5e8, 0xfb28: 0x5ea, 0xfb2a: 0x5e9, 0xfb2b: 0x5e9, 0xfb2c: 0x5e9, 0xfb2d: 0x5e9,
  0xfb2e: 0x5d0, 0xfb2f: 0x5d0, 0xfb30: 0x5d0, 0xfb31: 0x5d1, 0xfb32: 0x5d2, 0xfb33: 0x5d3, 0xfb34: 0x5d4,
  0xfb35: 0x5d5, 0xfb36: 0x5d6, 0xfb38: 0x5d8, 0xfb39: 0x5d9, 0xfb3a: 0x5da, 0xfb3b: 0x5db, 0xfb3c: 0x5dc,
  0xfb3e: 0x5de, 0xfb40: 0x5e0, 0xfb41: 0x5e1, 0xfb43: 0x5e3, 0xfb44: 0x5e4, 0xfb46: 0x5e6, 0xfb47: 0x5e7,
  0xfb48: 0x5e8, 0xfb49: 0x5e9, 0xfb4a: 0x5ea, 0xfb4b: 0x5d5, 0xfb4c: 0x5d1, 0xfb4d: 0x5db, 0xfb4e: 0x5e4,
  0xfb4f: 0x5d0,
};

/** A Hebrew letter in its plain form: presentation forms unpacked, finals folded. '' if not a letter. */
const hebrewBase = (ch: string): string => {
  const unpacked = HEBREW_PRESENTATION[code(ch)];
  const letter = unpacked ? String.fromCharCode(unpacked) : ch;
  return isHebrewLetter(letter) ? HEBREW_FINALS[letter] ?? letter : '';
};

// ── Greek ───────────────────────────────────────────────────────────────────

const GREEK_BASE: Record<string, string> = {};
for (let i = 0; i < GREEK_BASE_PAIRS.length; i += 2) GREEK_BASE[GREEK_BASE_PAIRS[i]] = GREEK_BASE_PAIRS[i + 1];

/** Combining diacritics (0300-036F) -- how a decomposed Greek accent arrives. */
const isCombiningMark = (ch: string): boolean => {
  const c = code(ch);
  return c >= 0x0300 && c <= 0x036f;
};

/** A Greek letter's bare lowercase form ('Ἐ' -> 'ε', 'ς' -> 'σ'), or '' if not a letter. */
const greekBase = (ch: string): string => {
  const lower = (GREEK_BASE[ch] ?? ch).toLowerCase();
  const c = code(lower);
  if (c === 0x03c2) return 'σ'; // final sigma
  return c >= 0x03b1 && c <= 0x03c9 ? lower : '';
};

// ── Shared primitives ───────────────────────────────────────────────────────

const LATIN_LETTER_RE = /[a-zA-Z0-9]/;

/**
 * The comparable form of one character: its bare letter for Hebrew/Greek
 * (final forms folded, accents gone), the character itself for an English
 * letter or digit, '' for anything else.
 */
const letterKey = (ch: string, script: TextScript): string => {
  if (script === 'hebrew') return hebrewBase(ch);
  if (script === 'greek') return greekBase(ch);
  return LATIN_LETTER_RE.test(ch) ? ch : '';
};

const isMark = (ch: string, script: TextScript): boolean =>
  script === 'hebrew' ? isHebrewMark(ch) : script === 'greek' ? isCombiningMark(ch) : false;

/**
 * Splits a word into the punctuation before its first letter, the letters
 * themselves (marks included), and the punctuation after its last letter --
 * e.g. `“וַיֹּאמֶר,` -> `“` / `וַיֹּאמֶר` / `,`. A word with no letters is all
 * prefix.
 */
const wordShape = (word: string, script: TextScript): { prefix: string; core: string; suffix: string } => {
  const chars = Array.from(word);
  const first = chars.findIndex((ch) => letterKey(ch, script) !== '');
  if (first === -1) return { prefix: word, core: '', suffix: '' };
  let last = chars.length - 1;
  while (last > first && letterKey(chars[last], script) === '' && !isMark(chars[last], script)) last--;
  return {
    prefix: chars.slice(0, first).join(''),
    core: chars.slice(first, last + 1).join(''),
    suffix: chars.slice(last + 1).join(''),
  };
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Whether a script reads right-to-left -- Hebrew only. Layouts that place
 * words or verses side by side (tile rows, the memory grid) reverse their row
 * direction on it, so the first word sits on the right.
 */
export const isRtl = (script: TextScript): boolean => script === 'hebrew';

/**
 * Which writing system a verse is in. A verse that doesn't say which
 * translation it's from predates the field and is English.
 */
export const scriptOfVerse = (v: { book: string; translationId?: string }): TextScript =>
  v.translationId ? textScriptFor(v.translationId, v.book) : 'latin';

/**
 * Verse text -> words. Whitespace-separated everywhere; Hebrew additionally
 * breaks after each maqaf, which stays on the first piece so the word still
 * displays exactly as written (`אֶל־` + `הָאָרֶץ`).
 *
 * Every drill must split with this one function: Recall's word list, the
 * memory grid and the hint masks index into each other by word position, and
 * drift apart the moment one of them splits differently.
 */
export const splitWords = (text: string, script: TextScript = 'latin'): string[] => {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (script !== 'hebrew') return words;
  return words.flatMap((w) => {
    const parts = w.split(MAQAF);
    return parts
      .map((p, i) => (i < parts.length - 1 ? p + MAQAF : p))
      .filter((p) => p.length > 0);
  });
};

/**
 * Words -> display text: the inverse of splitWords. A word ending in a maqaf
 * joins its neighbour with no space (עַל־הָאָרֶץ, not עַל־ הָאָרֶץ); everything
 * else is space-separated. Safe for English, which never contains a maqaf.
 */
export const joinWords = (words: string[]): string =>
  words.reduce((out, w, i) => (i === 0 ? w : out.endsWith(MAQAF) ? out + w : `${out} ${w}`), '');

/**
 * The separator to render after a word when words are laid out one element
 * at a time: none after a maqaf-ending Hebrew word, a space otherwise. Same
 * rule as joinWords.
 */
export const wordGap = (word: string): string => (word.endsWith(MAQAF) ? '' : ' ');

/**
 * The comparable form of a word: "Spirit," -> "spirit"; וַיֹּאמֶר -> ויאמר;
 * Ἐν -> εν. Empty for a word with no letters (a standalone dash or sof pasuq),
 * which every drill treats as punctuation rather than a word to recall.
 */
export const normalizeToken = (word: string, script: TextScript = 'latin'): string => {
  if (script === 'latin') return word.toLowerCase().replace(/[^a-z0-9]/g, '');
  return Array.from(word)
    .map((ch) => letterKey(ch, script))
    .join('');
};

/**
 * The guesses in a burst of typing, for first-letter Recall: one entry per
 * letter, in order.
 *
 * English keeps every character, exactly as before -- a stray space or comma
 * is a wrong guess there, as it always has been. Hebrew and Greek keep only
 * letters and drop everything else: vowel points, dagesh, accents, and the
 * invisible direction marks some keyboards add. A Hebrew keyboard that types
 * a point along with (or right after) the consonant would otherwise have that
 * point graded as a wrong guess at the next word -- which made typing feel
 * like it demanded vowels. The hint is the consonant; only the consonant is
 * graded.
 */
export const typedLetters = (text: string, script: TextScript = 'latin'): string[] => {
  if (script === 'latin') return Array.from(text);
  return Array.from(text).filter((ch) => letterKey(ch, script) !== '');
};

/**
 * Collapses a word to its first letter, keeping leading and trailing
 * punctuation attached -- "beginning," -> "b,", `"Let` -> `"L`, בְּרֵאשִׁית -> ב,
 * Ἐν -> ε, אֶל־ -> א־. Hebrew/Greek show the bare letter (no vowel points or
 * accents), by the user's choice: the hint is the consonant.
 */
export const firstLetterOnly = (word: string, script: TextScript = 'latin'): string => {
  if (script === 'latin') {
    const firstIdx = word.search(/[a-zA-Z0-9]/);
    if (firstIdx === -1) return word;
    const before = word.slice(0, firstIdx);
    const first = word[firstIdx];
    const trailingMatch = word.slice(firstIdx + 1).match(/[^a-zA-Z0-9]*$/);
    const trailing = trailingMatch ? trailingMatch[0] : '';
    return `${before}${first}${trailing}`;
  }
  const { prefix, core, suffix } = wordShape(word, script);
  if (!core) return word;
  const firstChar = Array.from(core)[0];
  // Hebrew keeps the letter as written (a final form can't start a word
  // anyway); Greek drops case and accents, matching what's compared.
  const first = script === 'greek' ? greekBase(firstChar) : firstChar;
  return `${prefix}${first}${suffix}`;
};

/**
 * Replaces every letter with '•', keeping punctuation -- so a hidden word
 * still shows its comma. A Hebrew letter and the points stacked on it become
 * one bullet, as do a Greek letter and its accents.
 */
export const maskLetters = (word: string, script: TextScript = 'latin'): string => {
  if (script === 'latin') return word.replace(/[a-zA-Z0-9]/g, '•');
  return Array.from(word)
    .map((ch) => (letterKey(ch, script) ? '•' : isMark(ch, script) ? '' : ch))
    .join('');
};

/**
 * maskLetters, but the first letter stays visible -- First Letter hint mode.
 * Hebrew/Greek show it bare, the same as firstLetterOnly.
 */
export const maskExceptFirstLetter = (word: string, script: TextScript = 'latin'): string => {
  if (script === 'latin') {
    const firstAlnumIdx = word.search(/[a-zA-Z0-9]/);
    if (firstAlnumIdx === -1) return maskLetters(word);
    const before = word.slice(0, firstAlnumIdx);
    const first = word[firstAlnumIdx];
    const rest = word.slice(firstAlnumIdx + 1).replace(/[a-zA-Z0-9]/g, '•');
    return `${before}${first}${rest}`;
  }
  const { prefix, core, suffix } = wordShape(word, script);
  if (!core) return maskLetters(word, script);
  const chars = Array.from(core);
  const first = script === 'greek' ? greekBase(chars[0]) : chars[0];
  const rest = maskLetters(chars.slice(1).join(''), script);
  return `${prefix}${first}${rest}${suffix}`;
};

/**
 * Puts a replacement word into the original's punctuation (and, for English,
 * its capitalization), so a spot-the-swap decoy never gives itself away by
 * being the only word missing its comma or maqaf. `replacement` is a bare
 * core: normalized for English (the shape restores case), and for Hebrew/Greek
 * the real pointed/accented letters, since a decoy stripped of its vowels
 * would be the one unpointed word in the verse.
 */
export const applyWordShape = (original: string, replacement: string, script: TextScript = 'latin'): string => {
  if (script === 'latin') {
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
  }
  const { prefix, core, suffix } = wordShape(original, script);
  return core ? `${prefix}${replacement}${suffix}` : replacement;
};

/** A word's letters with its punctuation trimmed off -- the decoy pool's display form. */
export const wordCore = (word: string, script: TextScript): string => wordShape(word, script).core;
