import { Platform } from 'react-native';
import { TextScript } from '../types';
import { firstLetterOnly, joinWords, normalizeToken, splitWords } from './textScript';

export { firstLetterOnly, normalizeToken } from './textScript';

// ============================================================================
// RECITATION GRADING ENGINE
// ----------------------------------------------------------------------------
// Pure logic shared by every recall drill (first-letter typing today, spoken
// recitation as the speech pipeline matures). Nothing in here touches React,
// Firestore, or the microphone — it takes "what the verse says" and "what the
// user produced" and returns graded word-level outcomes, so drills and any
// future speech-recognition engine all score recall the same way.
// ============================================================================

// A session passes as a *review* at this word-accuracy or better (a due
// spaced-repetition review still advances). A *mastery touch* toward Learning
// graduation additionally requires a perfect run: zero missed words — "close
// enough" near-miss keys are fine, but no wrong words and no revealed hints.
export const REVIEW_PASS_ACCURACY = 0.9;

// The user's own pass mark and near-key forgiveness (Settings > Recall and
// typing, lib/appPrefs). Module state rather than arguments: every grader in
// the app goes through these few functions, and threading a setting through
// each call site would touch a dozen screens for one number.
let passAccuracy = REVIEW_PASS_ACCURACY;
let forgiveNearbyKeys = true;

/** The accuracy a review needs to pass: 0.9 unless changed in Settings. */
export const reviewPassAccuracy = (): number => passAccuracy;
export const setReviewPassAccuracy = (v: number) => {
  passAccuracy = v;
};
// No signal (OFFLINE_MODE_PLAN.md stage 8): ask the phone to recognise on the
// device, where it can. Apple's server recogniser can't be reached; if the
// device can't do it either the engine reports an error and the caller falls
// back to checking yourself or typing, as for any other speech failure.
let speechOffline = false;
export const setSpeechOffline = (on: boolean) => {
  speechOffline = on;
};
/** Whether a native run passed `onAudio` will save its recording (iPhone, online). */
export const willSaveSpeechAudio = (): boolean => Platform.OS === 'ios' && !speechOffline;
export const setForgiveNearbyKeys = (on: boolean) => {
  forgiveNearbyKeys = on;
};

// Speech slips this user's engine keeps making, learned from tap-to-fix (see
// lib/speechSlips, which loads them per account). Same module-state reasoning
// as the two settings above.
let learnedSlips: ReadonlySet<string> = new Set();

/** One learned slip: the verse word and what the engine wrote for it, both normalized. */
export const slipKey = (expectedWord: string, heardWord: string): string => `${expectedWord}>${heardWord}`;

export const setLearnedSlips = (keys: ReadonlySet<string>) => {
  learnedSlips = keys;
};

export type WordOutcome = 'perfect' | 'close' | 'missed';

export interface RecitationSummary {
  totalWords: number;
  perfectWords: number;
  closeWords: number;
  missedWords: number;
  /** 0..1 — perfect + close words over total. */
  accuracy: number;
  /** No missed words at all — required for a mastery touch. */
  isPerfect: boolean;
  /** accuracy >= REVIEW_PASS_ACCURACY — counts as a successful review. */
  passesReview: boolean;
}

export const summarizeOutcomes = (outcomes: WordOutcome[]): RecitationSummary => {
  const totalWords = outcomes.length;
  const perfectWords = outcomes.filter((o) => o === 'perfect').length;
  const closeWords = outcomes.filter((o) => o === 'close').length;
  const missedWords = totalWords - perfectWords - closeWords;
  const accuracy = totalWords === 0 ? 0 : (perfectWords + closeWords) / totalWords;
  return {
    totalWords,
    perfectWords,
    closeWords,
    missedWords,
    accuracy,
    isPerfect: totalWords > 0 && missedWords === 0,
    passesReview: totalWords > 0 && accuracy >= passAccuracy,
  };
};

// ============================================================================
// TEXT NORMALIZATION
// ============================================================================

// The word-level primitives (normalizeToken, firstLetterOnly) live in
// textScript.ts because they differ for Hebrew/Greek; they're re-exported
// above, where every drill already imports them from.

/** Splits verse text (or a speech transcript) into normalized word tokens. */
export const tokenizeWords = (text: string, script: TextScript = 'latin'): string[] =>
  splitWords(text, script)
    .map((w) => normalizeToken(w, script))
    .filter((t) => t.length > 0);

/**
 * "In the beginning, God..." -> "I t b, G...", one letter-group per word --
 * the Scripture Memory Fellowship-style Memory Grid line. Hebrew joins across
 * a maqaf with no space, as written.
 */
export const firstLetterLine = (text: string, script: TextScript = 'latin'): string =>
  joinWords(splitWords(text, script).map((w) => firstLetterOnly(w, script)));

// ============================================================================
// FIRST-LETTER TYPING — NEAR-MISS KEYBOARD FORGIVENESS
// ----------------------------------------------------------------------------
// biblememory.com's mobile behavior: fingers on a phone keyboard land a key
// off all the time, so a typed letter physically adjacent to the correct one
// counts as close enough. Adjacency is computed from QWERTY key positions
// (same row ± 1 column, or the diagonally-overlapping keys a row up/down).
// ============================================================================

const QWERTY_ROWS: { keys: string; offset: number }[] = [
  { keys: 'qwertyuiop', offset: 0 },
  { keys: 'asdfghjkl', offset: 0.25 },
  { keys: 'zxcvbnm', offset: 0.75 },
];

const buildNeighborMap = (): Record<string, Set<string>> => {
  const positions: Record<string, { row: number; col: number }> = {};
  QWERTY_ROWS.forEach(({ keys, offset }, row) => {
    keys.split('').forEach((key, i) => {
      positions[key] = { row, col: i + offset };
    });
  });
  const map: Record<string, Set<string>> = {};
  const letters = Object.keys(positions);
  letters.forEach((a) => {
    map[a] = new Set();
    letters.forEach((b) => {
      if (a === b) return;
      const pa = positions[a];
      const pb = positions[b];
      // Same-row neighbors are exactly 1.0 columns apart; the diagonally
      // overlapping keys a row up/down are 0.25–0.75 off. 1.3 includes both
      // (e.g. a: q/w/s/z) while excluding keys two columns away (2.0).
      if (Math.abs(pa.row - pb.row) <= 1 && Math.abs(pa.col - pb.col) <= 1.3) {
        map[a].add(b);
      }
    });
  });
  return map;
};

const QWERTY_NEIGHBORS = buildNeighborMap();

/** True when `typed` is a QWERTY key physically adjacent to `target`. */
export const isAdjacentKey = (typed: string, target: string): boolean =>
  !!QWERTY_NEIGHBORS[target.toLowerCase()]?.has(typed.toLowerCase());

export type LetterVerdict = 'exact' | 'close' | 'wrong';

/**
 * Grades one first-letter attempt against a verse word.
 * 'exact'  — the right letter.
 * 'close'  — a neighboring key; counts as correct, tracked separately.
 * 'wrong'  — anything else.
 * Words with no letters/digits (rare, e.g. an em-dash token) grade 'exact'.
 */
export const classifyFirstLetterAttempt = (typedChar: string, word: string, script: TextScript = 'latin'): LetterVerdict => {
  const target = normalizeToken(word, script).charAt(0);
  if (!target) return 'exact';
  // Hebrew/Greek fold the typed key the same way as the word (final forms,
  // case, accents); English keeps its plain lowercase. There's no near-key
  // forgiveness outside English -- isAdjacentKey only knows QWERTY, so a
  // Hebrew or Greek near-miss is just wrong. Strict, by the user's choice.
  const typed = script === 'latin' ? typedChar.toLowerCase() : normalizeToken(typedChar, script);
  if (typed === target) return 'exact';
  if (forgiveNearbyKeys && isAdjacentKey(typed, target)) return 'close';
  return 'wrong';
};

// ============================================================================
// SPOKEN RECITATION — SEQUENCE ALIGNMENT
// ----------------------------------------------------------------------------
// One alignment core (buildAlignmentTable + backtraceOutcomes) powers both
// the live incremental matcher and the final one-shot grade below, differing
// only in how each decides where the passage "ends" (see the two exported
// functions). Costs are tunable weights, not a plain 0/1 edit distance, so
// the alignment is biased toward how speech recognition actually fails
// rather than a strict textual difference.
// ============================================================================

const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[n];
};

// Crude phonetic key: collapses the spelling differences behind the most
// common same-sounding pairs a speech engine produces ("lite"/"light",
// "thru"/"through", "sees"/"seas"). Deliberately rough — it only ever runs
// on two words already suspected of being the same one.
const roughPhoneticKey = (word: string): string =>
  word
    .replace(/([aeiou])gh/g, '$1') // light -> lit, through -> throu
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1') // collapse doubled letters
    .replace(/e$/, ''); // silent trailing e

// Curated equivalents the general edit-distance/phonetic tiers below can't
// safely catch on their own -- two categories:
//  - Short interjections a speech engine transcribes differently than the
//    text spells them ("O Lord" routinely comes back as "oh Lord"). Too
//    short for edit distance to safely cover -- a single edit on a 1-2
//    letter word can just as easily land on an unrelated real word ("a"/"i",
//    "no"/"so"), so this can't just be a loosened length rule.
//  - True homophones whose spellings diverge too much for edit distance or
//    roughPhoneticKey to bridge ("Pharaoh" sounds identical to "farrow" but
//    shares only a handful of letters in the same order).
// Deliberately a small, explicit, hand-verified list rather than an attempt
// at a comprehensive dictionary -- add entries as real mishearings turn up
// during actual use, not speculatively.
const CURATED_WORD_EQUIVALENTS: Record<string, string> = {
  o: 'oh',
  oh: 'o',
  pharaoh: 'farrow',
  farrow: 'pharaoh',
};

/**
 * Fuzzy spoken-word equality. Speech engines constantly bend a word slightly
 * ("god" -> "got", "separated" -> "separate", "waters" -> "water's" — the
 * last is already handled by normalization). Tolerance scales with length:
 * one edit for 3+ letter words, two for 5+, three for 8+ (long theological
 * vocabulary -- "propitiation", "righteousness" -- a general speech model
 * can mangle across more than two syllables while it's still recognizably
 * the same word; 8+ letters is long enough that a 3-edit match is very
 * unlikely to land on a genuinely different word). Exact only for the tiny
 * words where one edit changes identity ("a"/"i", "an"/"at"), aside from the
 * curated equivalents list above. Most homophone-style spellings match
 * through the phonetic key; the few that don't are in that curated list.
 * (5+ rather than 6+ as of 2026-07: users correctly speaking a word still
 * saw it graded missed often enough that the tolerance needed widening —
 * 5-letter words still have enough length that a 2-edit match is very
 * unlikely to land on a genuinely different word.)
 */
// Two rules found by the 2026-10 speech bake-off, where every engine heard
// "visible" and "dominion" exactly as spoken:
//  - A negating prefix added or dropped ("visible"/"invisible") changes the
//    meaning, so it is never "close enough" however near the spelling.
//  - A plural said as a singular, or the reverse ("dominion"/"dominions",
//    "family"/"families", a dropped verb -s), always is. By the user's call,
//    nobody reciting actually confuses these -- context makes the right form
//    obvious -- so it's an engine slip, never a recall error. 3+ letters, so
//    "a"/"as" can't count.
const NEGATING_PREFIXES = ['in', 'im', 'il', 'ir', 'un', 'dis', 'non'];

const shorterLonger = (a: string, b: string): [string, string] => (a.length <= b.length ? [a, b] : [b, a]);

export const isNegatedPair = (a: string, b: string): boolean => {
  const [shorter, longer] = shorterLonger(a, b);
  return NEGATING_PREFIXES.some((p) => longer === p + shorter);
};

export const isPluralPair = (a: string, b: string): boolean => {
  const [shorter, longer] = shorterLonger(a, b);
  if (shorter.length < 3) return false;
  return longer === `${shorter}s` || longer === `${shorter}es` || (shorter.endsWith('y') && longer === `${shorter.slice(0, -1)}ies`);
};

export const wordsRoughlyEqual = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (CURATED_WORD_EQUIVALENTS[a] === b) return true;
  if (isNegatedPair(a, b)) return false;
  if (isPluralPair(a, b)) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 8 && levenshtein(a, b) <= 3) return true;
  if (minLen >= 5 && levenshtein(a, b) <= 2) return true;
  if (minLen >= 3 && levenshtein(a, b) <= 1) return true;
  if (minLen >= 3 && roughPhoneticKey(a) === roughPhoneticKey(b)) return true;
  return false;
};

const NUMBER_WORD_PAIRS: [word: string, digit: string][] = [
  ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'], ['five', '5'],
  ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'], ['ten', '10'],
  ['eleven', '11'], ['twelve', '12'], ['thirteen', '13'], ['fourteen', '14'],
  ['fifteen', '15'], ['sixteen', '16'], ['seventeen', '17'], ['eighteen', '18'],
  ['nineteen', '19'], ['twenty', '20'], ['thirty', '30'], ['forty', '40'],
  ['fifty', '50'], ['sixty', '60'], ['seventy', '70'], ['eighty', '80'],
  ['ninety', '90'], ['hundred', '100'],
];

const NUMBER_WORDS = new Set(NUMBER_WORD_PAIRS.map(([word]) => word));

// Scripture text nearly always spells numbers out ("the twelve tribes,"
// "forty days"), but speech engines routinely normalize spoken number words
// into numerals in the transcript -- consumed by pairCost below to compare
// a digit token against the spelled-out expected word on equal footing.
// Scoped to single tokens; a compound number like "930" -> "nine hundred
// thirty" would need aligning one spoken token against several expected
// ones, out of scope here.
const DIGIT_TO_NUMBER_WORD: Record<string, string> = Object.fromEntries(
  NUMBER_WORD_PAIRS.map(([word, digit]) => [digit, word])
);

// Same idea for ordinals: Apple's engine wrote "the 1st born" for "the
// firstborn" in the bake-off (the word-break matcher then joins "first" +
// "born").
const ORDINAL_TO_WORD: Record<string, string> = {
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth',
  '6th': 'sixth', '7th': 'seventh', '8th': 'eighth', '9th': 'ninth', '10th': 'tenth',
  '11th': 'eleventh', '12th': 'twelfth',
};

/** A spoken token in the form the verse text would spell it, for comparison only. */
const spelledOut = (spokenWord: string): string => DIGIT_TO_NUMBER_WORD[spokenWord] ?? ORDINAL_TO_WORD[spokenWord] ?? spokenWord;

/**
 * True for a spoken token that's plausibly a recited verse number ("3",
 * "twenty", "one hundred") rather than passage text -- either a bare digit
 * string (some engines transcribe numbers as digits) or a common English
 * number word. Consumed by pairCost below, not as a blanket pre-filter --
 * "six" spoken where the verse text genuinely says "six days" must still
 * match normally, so the number-ness of a token only matters relative to
 * what it's being compared against.
 */
export const isLikelyVerseNumber = (token: string): boolean => /^\d+$/.test(token) || NUMBER_WORDS.has(token);

// Extremely common short function words -- articles, prepositions,
// conjunctions, "to be", personal pronouns. Speech engines routinely swallow
// these entirely when spoken quickly ("he condemned sin in the flesh" often
// transcribes with "in"/"the" just absent, not misheard), which no amount of
// fuzzy TEXT matching can fix -- there's no wrong word to fuzzy-match
// against, the token simply never arrives. Grading these strictly produced
// constant, unfair misses on words the user genuinely said. Deliberately a
// curated list, not a length rule: short words that carry real doctrinal
// weight ("God", "sin", "law", "not", "no") are excluded on purpose and
// still graded normally -- getting THOSE wrong changes meaning.
const COMMONLY_DROPPED_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'is', 'it', 'and', 'but', 'or',
  'as', 'be', 'by', 'he', 'she', 'we', 'i', 'my', 'his', 'her', 'its', 'that',
  'this', 'for', 'with', 'from', 'are', 'was', 'were', 'am', 'so',
]);

export const isCommonlyDroppedWord = (token: string): boolean => COMMONLY_DROPPED_WORDS.has(token);

// ----------------------------------------------------------------------------
// Cost weights for the alignment DP. Tuned for how speech recognition
// actually fails, not a plain edit distance:
//  - Skipping a real expected word (SKIP_EXPECTED_COST) costs MORE than
//    treating a mis-heard word as a substitution (SUBSTITUTION_COST). This
//    is the direct fix for repetitive passages (e.g. "flesh"/"Spirit"/"law"
//    recurring across Romans 8): the aligner is biased to explain a
//    mis-heard word as "they said something close to this" rather than
//    "they skipped ahead to the next occurrence," so it only jumps past
//    real words when the words in between genuinely don't align to
//    anything, not just because a nearby word happens to match.
//  - A fuzzy/phonetic match (CLOSE_MATCH_COST) is nearly free relative to a
//    real substitution, so a real fuzzy match always beats forcing a
//    resync, while exact matches still win ties (cost 0 < 0.15).
//  - Dropping a COMMONLY_DROPPED_WORDS word is almost free -- baked directly
//    into the alignment via skipExpectedCost instead of forgiven in a
//    post-hoc pass, so it can no longer distort which alignment path gets
//    chosen in the first place.
//  - A stray spoken word matching nothing (false start, "um", a
//    self-correction) is cheaper to write off as noise (INSERT_SPOKEN_COST)
//    than to force into a wrong slot.
//  - Once a run of skipped words has started, each further skipped word
//    costs less (SKIP_EXPECTED_CONTINUE_COST) -- a standard "affine gap".
//    Without it, skipping a whole verse was costlier than smearing the next
//    verse's words across the skipped one as substitutions: skip Isaiah
//    53:10 and verse 10 got partly "matched" by verse 11's words (both have
//    "his soul ... he shall see") while verse 11 was graded missed (2026-10
//    speech bake-off). A single skipped word still costs the full
//    SKIP_EXPECTED_COST, so the repetition bias above is unchanged.
export const MATCH_COST = 0;
export const CLOSE_MATCH_COST = 0.15;
export const SUBSTITUTION_COST = 1;
export const SKIP_EXPECTED_COST = 1.2;
// Anywhere in 0.6-0.9 fixes the Isaiah 53 case with every check passing; 0.5
// and below lets a long skip-ahead win again in Romans 8's repetitive verse 6
// (scenario 17), so 0.7 sits mid-range.
export const SKIP_EXPECTED_CONTINUE_COST = 0.7;
export const SKIP_EXPECTED_DROPPABLE_COST = 0.05;
export const INSERT_SPOKEN_COST = 0.4;

const pairCost = (expectedWord: string, spokenWord: string): number => {
  // Normalized for comparison only -- isLikelyVerseNumber below still checks
  // the raw token, since a bare digit is exactly what marks a spoken verse
  // number for suppression regardless of its word form.
  const normalizedSpoken = spelledOut(spokenWord);
  if (expectedWord === normalizedSpoken) return MATCH_COST;
  // A spoken verse number ("three", "23") read aloud between verses isn't
  // part of the passage. Suppress the usual fuzzy-match discount so it can't
  // get cheaply substituted for a similarly-spelled real word (e.g. "three"
  // vs. "tree") -- the DP then naturally prefers writing it off as noise via
  // INSERT_SPOKEN_COST instead, unless it's an exact match (handled above).
  if (isLikelyVerseNumber(spokenWord) && !isLikelyVerseNumber(expectedWord)) return SUBSTITUTION_COST;
  if (wordsRoughlyEqual(expectedWord, normalizedSpoken)) return CLOSE_MATCH_COST;
  if (learnedSlips.has(slipKey(expectedWord, normalizedSpoken))) return CLOSE_MATCH_COST;
  return SUBSTITUTION_COST;
};

/**
 * Whether a tap-to-fix pair may be learned at all. Never a meaning flip
 * ("visible" for "invisible": tapping still fixes that one time, but it's
 * never accepted automatically), never a spoken verse number, and never a
 * pair the grader already accepts on its own.
 */
export const isLearnableSlip = (expectedWord: string, heardWord: string): boolean =>
  expectedWord.length > 0 &&
  heardWord.length > 0 &&
  !isNegatedPair(expectedWord, heardWord) &&
  !isLikelyVerseNumber(heardWord) &&
  pairCost(expectedWord, heardWord) === SUBSTITUTION_COST;

const skipExpectedCost = (expectedWord: string): number =>
  isCommonlyDroppedWord(expectedWord) ? SKIP_EXPECTED_DROPPABLE_COST : SKIP_EXPECTED_COST;

const continueSkipCost = (expectedWord: string): number =>
  isCommonlyDroppedWord(expectedWord) ? SKIP_EXPECTED_DROPPABLE_COST : SKIP_EXPECTED_CONTINUE_COST;

// Word breaks that don't line up between the text and the transcript. A
// hyphenated word ("self-control", "son-in-law") or the ESV's unspaced
// em-dash ("flesh—could") normalizes to ONE expected token ("selfcontrol"),
// but speech engines hear separate words ("self control"); and the reverse
// happens too -- the ESV's "turned—every one—to" tokenizes as "turnedevery"
// "oneto" while engines write "turned everyone to". So a run of up to three
// expected words matches a run of up to three spoken words whenever their
// letters join up exactly. Exact-match only, so it can't become a new source
// of false passes; deliberately the same cost as a real match.
const MAX_JOINED_WORDS = 3;

const lettersMatch = (expected: string[], i: number, eSpan: number, spoken: string[], j: number, sSpan: number): boolean => {
  if ((eSpan === 1 && sSpan === 1) || i - eSpan < 0 || j - sSpan < 0) return false;
  const e = expected.slice(i - eSpan, i);
  const s = spoken.slice(j - sSpan, j).map(spelledOut);
  // Same breaks on both sides is just ordinary word-by-word matching --
  // leave it to the diagonal move so `heard` stays one word per word.
  if (eSpan === sSpan && e.every((w, k) => w === s[k])) return false;
  return e.join('') === s.join('');
};

interface AlignmentTables {
  /** dp[i][j] = min cost aligning expected[0..i) with spoken[0..j). */
  dp: number[][];
  /** gap[i][j] = the same, restricted to paths whose last move skipped expected[i-1]. */
  gap: number[][];
}

// Standard three-move recurrence (match/substitute diagonally, skip an
// expected word, insert a spoken word) with the tuned costs above instead of
// plain 0/1, plus the affine-gap split: a skip either opens a new run (from
// dp) or continues one (from gap).
const buildAlignmentTable = (expected: string[], spoken: string[]): AlignmentTables => {
  const m = expected.length;
  const n = spoken.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const gap: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(Infinity));
  for (let i = 1; i <= m; i++) {
    gap[i][0] = i === 1 ? skipExpectedCost(expected[0]) : gap[i - 1][0] + continueSkipCost(expected[i - 1]);
    dp[i][0] = gap[i][0];
  }
  for (let j = 1; j <= n; j++) dp[0][j] = dp[0][j - 1] + INSERT_SPOKEN_COST;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      gap[i][j] = Math.min(
        dp[i - 1][j] + skipExpectedCost(expected[i - 1]),
        gap[i - 1][j] + continueSkipCost(expected[i - 1])
      );
      let best = Math.min(
        dp[i - 1][j - 1] + pairCost(expected[i - 1], spoken[j - 1]),
        gap[i][j],
        dp[i][j - 1] + INSERT_SPOKEN_COST
      );
      for (let eSpan = 1; eSpan <= MAX_JOINED_WORDS; eSpan++) {
        for (let sSpan = 1; sSpan <= MAX_JOINED_WORDS; sSpan++) {
          if (lettersMatch(expected, i, eSpan, spoken, j, sSpan)) best = Math.min(best, dp[i - eSpan][j - sSpan] + MATCH_COST);
        }
      }
      dp[i][j] = best;
    }
  }
  return { dp, gap };
};

// Walks the DP table backward from (startI, startJ) to (0, 0), classifying
// each expected word the path passes through. Shared by both endpoint rules
// below -- only the starting cell differs. Recomputing each candidate
// expression here is deliberate: it's the exact same deterministic
// arithmetic the forward pass already did to fill dp[i][j], so the `===`
// comparisons below always land on a real candidate, no floating-point
// drift despite the fractional costs.
const backtraceOutcomes = (
  expected: string[],
  spoken: string[],
  { dp, gap }: AlignmentTables,
  startI: number,
  startJ: number,
  /** Optional: filled with the spoken word each expected word was paired with (null when none). */
  heard?: (string | null)[]
): (WordOutcome | null)[] => {
  const outcomes: (WordOutcome | null)[] = new Array(expected.length).fill(null);
  // A skipped COMMONLY_DROPPED_WORDS word is forgiven outright -- the cheap
  // cost only decides which alignment PATH wins; without this the word would
  // still grade 'missed' despite never having a real chance to be heard (see
  // COMMONLY_DROPPED_WORDS above).
  const skippedOutcome = (word: string): WordOutcome => (isCommonlyDroppedWord(word) ? 'perfect' : 'missed');
  let i = startI;
  let j = startJ;
  // True while walking back through a run of skipped expected words.
  let inGap = false;
  while (i > 0 && j > 0) {
    if (inGap) {
      outcomes[i - 1] = skippedOutcome(expected[i - 1]);
      inGap = i > 1 && gap[i][j] === gap[i - 1][j] + continueSkipCost(expected[i - 1]);
      i -= 1;
      continue;
    }
    const joined = (() => {
      for (let eSpan = 1; eSpan <= MAX_JOINED_WORDS; eSpan++) {
        for (let sSpan = 1; sSpan <= MAX_JOINED_WORDS; sSpan++) {
          if (lettersMatch(expected, i, eSpan, spoken, j, sSpan) && dp[i][j] === dp[i - eSpan][j - sSpan] + MATCH_COST) {
            return { eSpan, sSpan };
          }
        }
      }
      return null;
    })();
    if (joined) {
      const heardWords = spoken.slice(j - joined.sSpan, j).join(' ');
      for (let k = 1; k <= joined.eSpan; k++) {
        outcomes[i - k] = 'perfect';
        if (heard) heard[i - k] = heardWords;
      }
      i -= joined.eSpan;
      j -= joined.sSpan;
      continue;
    }
    const cost = pairCost(expected[i - 1], spoken[j - 1]);
    if (dp[i][j] === dp[i - 1][j - 1] + cost) {
      outcomes[i - 1] = cost === MATCH_COST ? 'perfect' : cost === CLOSE_MATCH_COST ? 'close' : 'missed';
      if (heard) heard[i - 1] = spoken[j - 1];
      i -= 1;
      j -= 1;
    } else if (dp[i][j] === gap[i][j]) {
      inGap = true;
    } else {
      j -= 1;
    }
  }
  while (i > 0) {
    outcomes[i - 1] = skippedOutcome(expected[i - 1]);
    i -= 1;
  }
  return outcomes;
};

/**
 * Grades a COMPLETE transcript against the expected text via cost-based
 * alignment, returning one outcome per expected word. Used when a recitation
 * arrives all at once (a finished speech-engine result, or the typed
 * "no microphone" fallback). Endpoint is forced to fully consume both
 * sequences (start the backtrace at (m, n)) -- unlike alignRecitationWindow
 * below, a finished recitation with un-recited words at the end should still
 * count them missed, not silently ignored.
 */
export const gradeTranscript = (expectedText: string, transcript: string): WordOutcome[] => {
  const expected = tokenizeWords(expectedText);
  const spoken = tokenizeWords(transcript);
  const tables = buildAlignmentTable(expected, spoken);
  const outcomes = backtraceOutcomes(expected, spoken, tables, expected.length, spoken.length);
  return outcomes.map((o) => o ?? 'missed');
};

/**
 * gradeTranscript plus, per expected word, the spoken word it was lined up
 * with (null when the word was skipped). Lets a result say "heard 'saw' for
 * 'say'" so the user can judge a mishearing.
 */
export const gradeTranscriptDetailed = (expectedText: string, transcript: string): { outcomes: WordOutcome[]; heard: (string | null)[] } => {
  const expected = tokenizeWords(expectedText);
  const spoken = tokenizeWords(transcript);
  const tables = buildAlignmentTable(expected, spoken);
  const heard: (string | null)[] = new Array(expected.length).fill(null);
  const outcomes = backtraceOutcomes(expected, spoken, tables, expected.length, spoken.length, heard);
  return { outcomes: outcomes.map((o) => o ?? 'missed'), heard };
};

/**
 * Speech second pass (SPEECH_SECOND_PASS_PLAN.md): after Stop, Whisper's
 * transcript of the same recording is graded with gradeTranscript, and a word
 * stays missed only if Apple's live grade AND Whisper's grade both missed it.
 * Apple and Whisper mishear different words, so either one hearing a word
 * right is good evidence it was said.
 *
 * - `live`: Apple's grade per position; null (never reached) counts as missed.
 * - `whisper`: gradeTranscript of Whisper's text against the same positions.
 * - `protectedIdx`: positions graded by hand (typed letters, revealed hints,
 *   tap-to-fix). These never change.
 *
 * Only missed words change, to Whisper's 'perfect' or 'close'. A word Apple
 * passed stays as Apple graded it, so the second pass can never add a red.
 * Returns the combined grades and the positions that changed.
 */
export const combineSecondPass = (
  live: readonly (WordOutcome | null | undefined)[],
  whisper: readonly WordOutcome[],
  protectedIdx: ReadonlySet<number> = new Set()
): { outcomes: WordOutcome[]; rescued: number[] } => {
  const rescued: number[] = [];
  const outcomes = live.map((o, i): WordOutcome => {
    const apple = o ?? 'missed';
    if (apple !== 'missed' || protectedIdx.has(i)) return apple;
    const second = whisper[i];
    if (second === 'perfect' || second === 'close') {
      rescued.push(i);
      return second;
    }
    return 'missed';
  });
  return { outcomes, rescued };
};

export interface LiveAlignResult {
  /** One outcome per expected word in the window; null = not yet reached. */
  outcomes: (WordOutcome | null)[];
  /** How many words into the window are now confirmed (exclusive end). */
  pointer: number;
}

/**
 * Aligns a WINDOW of expected words against a WINDOW of recently-spoken
 * words for the live/incremental case. Unlike gradeTranscript, the endpoint
 * is a free tail on the expected side: dp[i][n] already represents "align
 * ALL of the spoken window against just the first i expected words, and
 * never even look at the rest" (the remaining words simply never enter the
 * recurrence, at zero extra cost) -- exactly the semantics of a transcript
 * that's a genuine PREFIX of what's eventually going to be said. Forcing the
 * full-consumption endpoint gradeTranscript uses would be wrong here: it
 * would charge for "not having said the rest of the passage yet," which
 * mid-recitation isn't a real mistake.
 *
 * The caller (practice/useRecall) owns the actual window position/size and is
 * expected to re-run this on every transcript update. There is no ratchet
 * here -- the result can legitimately revise a previous call's decision
 * (e.g. resolve a repetition-driven ambiguity) once more words arrive; the
 * caller decides how much of that revision it's willing to accept.
 */
export const alignRecitationWindow = (expectedWindow: string[], spokenWindow: string[]): LiveAlignResult => {
  const tables = buildAlignmentTable(expectedWindow, spokenWindow);
  const { dp } = tables;
  const n = spokenWindow.length;

  // argmin over dp[i][n] -- the cheapest way to explain everything heard so
  // far using a prefix of the expected words. Ties broken toward the
  // SMALLEST i: never claim more progress than the evidence actually
  // supports, which is the direct fix for "jumped ahead over a repeated
  // word" -- a further-ahead i only wins if it's genuinely cheaper, not
  // merely tied with stopping earlier.
  let bestI = 0;
  let bestCost = dp[0][n];
  for (let i = 1; i <= expectedWindow.length; i++) {
    if (dp[i][n] < bestCost) {
      bestCost = dp[i][n];
      bestI = i;
    }
  }

  const outcomes = backtraceOutcomes(expectedWindow, spokenWindow, tables, bestI, n);
  return { outcomes, pointer: bestI };
};

// ----------------------------------------------------------------------------
// Live reconciliation step. Bounds alignRecitationWindow to a window instead
// of realigning the whole passage on every transcript update -- both cheap
// (bounded DP cost regardless of passage length) and predictable (bounds how
// far any single revision can jump).
//
// ALIGN_WINDOW_SPOKEN was 60 until a real on-device transcript (Romans 8,
// captured via the "Raw Transcript" debug view in Recall) showed it was too
// generous, not too tight: verse 6's "to set the mind on the X" phrase
// repeats twice, right after verse 5's own doubled "set their minds on the
// things of the X" -- four near-identical fragments close together. Because
// spokenWindow is just "the last N spoken tokens" with no relation to
// alignAnchor, a 60-token tail dragged verse 4/5's ALREADY-CONFIRMED spoken
// words back into the window alongside verse 6's new ones, and the DP's
// cost-minimizing alignment sometimes paired verse 6's real "set"/"mind"
// against one of those leftover verse-5 tokens instead -- grading correctly-
// spoken verse-6 words 'missed' even though the transcript contained them
// almost verbatim. Shrinking the spoken side to 30 (still comfortably wider
// than any single repeat-cycle) fixed it with zero regressions across every
// other scenario in recitation.alignment.check.ts, including the synthetic
// repetition-ambiguity tests this constant was originally sized for -- see
// scenario 17 there for the exact real-world repro this was tuned against.
// ALIGN_WINDOW_EXPECTED needed no change; only the spoken side was implicated.
// ----------------------------------------------------------------------------
export const ALIGN_WINDOW_EXPECTED = 40;
export const ALIGN_WINDOW_SPOKEN = 30;
export const ALIGN_REVISION_BUFFER = 10;

export interface ReconcileResult {
  /** Sparse patch: only the global indices whose grade changed this call. */
  outcomes: Record<number, WordOutcome>;
  /** New global pointer (never below the highest protected index + 1). */
  pointer: number;
  /** Where the next call's expected-word window should start. */
  nextAlignAnchor: number;
}

/**
 * Pure reconciliation step for live speech: given the full expected
 * passage, the full accumulated spoken transcript so far, the caller's
 * current window position, and which global indices are 'protected' (typed,
 * revealed via a hint, or manually tap-corrected -- must never be silently
 * revised), returns a patch to merge into the caller's outcomes/pointer plus
 * the anchor to use next call.
 *
 * Unlike the old greedy live matcher this replaced, there is no ratchet --
 * calling this again with more of the transcript can legitimately change a
 * previous call's answer for a still-in-window word (e.g. resolve a
 * repetition-driven ambiguity once more context arrives). Protected indices
 * are the only permanent exception. Safe to call on every transcript update,
 * including a no-op when nothing new has been confirmed yet.
 */
export const reconcileSpeechWindow = (
  expectedTokens: string[],
  spokenTokens: string[],
  alignAnchor: number,
  spokenFloor: number,
  protectedIndices: ReadonlySet<number>,
  currentPointer: number
): ReconcileResult => {
  const noop = { outcomes: {}, pointer: currentPointer, nextAlignAnchor: alignAnchor };

  const spokenWindow = spokenTokens.slice(Math.max(spokenFloor, spokenTokens.length - ALIGN_WINDOW_SPOKEN));
  if (spokenWindow.length === 0) return noop;

  const expectedWindow = expectedTokens.slice(alignAnchor, alignAnchor + ALIGN_WINDOW_EXPECTED);
  if (expectedWindow.length === 0) return noop;

  const result = alignRecitationWindow(expectedWindow, spokenWindow);
  if (result.pointer === 0) return noop;

  const globalTo = Math.min(alignAnchor + result.pointer, expectedTokens.length);

  let protectedFloor = 0;
  for (const idx of protectedIndices) protectedFloor = Math.max(protectedFloor, idx + 1);

  const outcomes: Record<number, WordOutcome> = {};
  for (let i = alignAnchor; i < globalTo; i++) {
    if (protectedIndices.has(i)) continue;
    const local = result.outcomes[i - alignAnchor];
    if (local != null) outcomes[i] = local;
  }

  const pointer = Math.max(globalTo, protectedFloor);
  // Advance the window forward, holding back a trailing buffer so the most
  // recently confirmed words stay open to revision next call -- this is
  // what lets a bad call self-correct instead of freezing permanently.
  const advanceTo = Math.max(protectedFloor, globalTo - ALIGN_REVISION_BUFFER);
  const nextAlignAnchor = Math.max(alignAnchor, advanceTo);

  return { outcomes, pointer, nextAlignAnchor };
};

// ============================================================================
// SPEECH-RECOGNITION ADAPTER
// ----------------------------------------------------------------------------
// The drills only ever talk to this interface. Two real implementations:
// the browser's Web Speech API on web, and `expo-speech-recognition` (native
// iOS/Android Speech framework, requires a dev-client build -- unavailable in
// Expo Go, where getSpeechRecognizer() falls back to null and the UI offers a
// typed transcript instead). The grading pipeline is identical either way.
// ============================================================================

export interface SpeechRecognizer {
  /**
   * Begin listening. `onTranscript` fires repeatedly with the FULL transcript
   * so far (interim results included) — feed it to the live reconciliation.
   * `finalizedTokenCount` is how many words of that transcript are from
   * segments the engine has already finalized (won't be retroactively
   * rewritten) -- interim segments routinely get revised as more audio
   * context arrives (a word, or even the token COUNT, can change between
   * calls), so anything that needs a stable position to remember across
   * calls (see practice/useRecall.ts's strike-limit reset) must anchor to this
   * count, never to the full transcript's current token count.
   */
  start(callbacks: {
    onTranscript: (fullTranscript: string, finalizedTokenCount: number) => void;
    onEnd: () => void;
    onError: (message: string) => void;
    /**
     * Optional: ask the engine to also save what it heard to a file, for the
     * second pass (SPEECH_SECOND_PASS_PLAN.md). Fires once after the engine
     * finishes writing, which can be just AFTER stop(). iPhone only for now,
     * and never in offline mode; elsewhere it simply never fires.
     */
    onAudio?: (uri: string) => void;
  }): void;
  stop(): void;
  /**
   * Optional: tell the engine what the user is ABOUT to say. A recitation
   * checker knows the exact expected text, and on-device engines accept it
   * as contextual vocabulary hints (iOS `contextualStrings`, Android
   * `EXTRA_BIASING_STRINGS`) — a large accuracy boost for scripture words
   * the engine would otherwise never guess ("propitiation", "thee"). Call
   * before start(). The Web Speech API has no equivalent, so the web
   * implementation omits this.
   */
  prime?(expectedText: string): void;
}

class WebSpeechRecognizer implements SpeechRecognizer {
  private recognition: any = null;
  private finalizedText = '';

  constructor(private RecognitionCtor: any) {}

  start(callbacks: { onTranscript: (t: string, finalizedTokenCount: number) => void; onEnd: () => void; onError: (m: string) => void }) {
    this.finalizedText = '';
    const rec = new this.RecognitionCtor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) this.finalizedText += ' ' + chunk;
        else interim += ' ' + chunk;
      }
      callbacks.onTranscript((this.finalizedText + ' ' + interim).trim(), tokenizeWords(this.finalizedText).length);
    };
    rec.onerror = (event: any) => callbacks.onError(String(event?.error || 'speech recognition error'));
    rec.onend = () => callbacks.onEnd();
    this.recognition = rec;
    rec.start();
  }

  stop() {
    try {
      this.recognition?.stop();
    } catch {
      // already stopped
    }
    this.recognition = null;
  }
}

// `expo-speech-recognition` ships native code, so it only works in a custom
// dev client / production build -- NOT in Expo Go, at any SDK version (same
// reasoning as useGoogleSignIn.ts's lazy require). A plain static `import`
// executes the native-module lookup the moment the JS bundle loads, which
// would crash the whole app in Expo Go before a single screen renders --
// loaded lazily inside a try/catch instead, so Expo Go falls back to null
// (typed-transcript UI) exactly like before this module existed.
type SpeechRecognitionModule = typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;

let cachedSpeechModule: SpeechRecognitionModule | null | undefined;

const loadSpeechRecognitionModule = (): SpeechRecognitionModule | null => {
  if (cachedSpeechModule !== undefined) return cachedSpeechModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedSpeechModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
  } catch {
    // Native module not present in this binary (Expo Go).
    cachedSpeechModule = null;
  }
  return cachedSpeechModule ?? null;
};

// Requesting mic/speech permission is async, but this interface's start() is
// synchronous (fire callbacks, no promise) -- the permission check runs
// internally and reports through onError if denied. `generation` guards
// against a stop() landing while that permission prompt is still pending: if
// the user taps the mic off before the promise resolves, the stale response
// must not go on to attach listeners and start the native recognizer anyway.
//
// The saved recording (onAudio) is reported by 'audioend', which iOS sends
// only after stop() has torn the other listeners down, so that one listener
// lives apart and removes itself once it fires (or when a new run starts).
// 16 kHz 16-bit mono WAV: what Whisper resamples to anyway, at a third of
// the default 48 kHz float file's size.
const SAVE_AUDIO_OPTIONS = { persist: true, outputSampleRate: 16000, outputEncoding: 'pcmFormatInt16' } as const;

class NativeSpeechRecognizer implements SpeechRecognizer {
  private subscriptions: { remove(): void }[] = [];
  private audioSubscription: { remove(): void } | null = null;
  private finalizedText = '';
  private expectedText = '';
  private generation = 0;

  constructor(private module: SpeechRecognitionModule) {}

  prime(expectedText: string) {
    this.expectedText = expectedText;
  }

  start(callbacks: Parameters<SpeechRecognizer['start']>[0]) {
    this.teardown();
    this.removeAudioListener();
    this.finalizedText = '';
    const myGeneration = ++this.generation;

    this.module
      .requestPermissionsAsync()
      .then(({ granted }) => {
        if (myGeneration !== this.generation) return; // stopped/restarted while the prompt was open
        if (!granted) {
          callbacks.onError('Microphone or speech recognition permission was denied. Enable it in Settings to use voice recitation.');
          return;
        }

        this.subscriptions = [
          this.module.addListener('result', (event) => {
            const transcript = event.results[0]?.transcript ?? '';
            if (event.isFinal) {
              this.finalizedText = (this.finalizedText + ' ' + transcript).trim();
              callbacks.onTranscript(this.finalizedText, tokenizeWords(this.finalizedText).length);
            } else {
              // this.finalizedText is intentionally NOT updated here -- an
              // interim result hasn't been committed by the engine yet, so
              // the finalized count reported alongside it must reflect only
              // what was true before this in-flight segment.
              callbacks.onTranscript((this.finalizedText + ' ' + transcript).trim(), tokenizeWords(this.finalizedText).length);
            }
          }),
          this.module.addListener('error', (event) => callbacks.onError(event.message || event.error)),
          this.module.addListener('end', () => callbacks.onEnd()),
        ];

        const { onAudio } = callbacks;
        const saveAudio = !!onAudio && willSaveSpeechAudio();
        if (saveAudio) {
          const sub = this.module.addListener('audioend', (event) => {
            if (this.audioSubscription === sub) this.removeAudioListener();
            if (event.uri) onAudio(event.uri);
          });
          this.audioSubscription = sub;
        }

        // Contextual vocabulary hint: the exact words this passage contains,
        // deduplicated -- a real accuracy boost for scripture words a general
        // language model would otherwise never guess.
        const contextualStrings = this.expectedText
          ? Array.from(
              new Set(
                this.expectedText
                  .split(/\s+/)
                  .map((w) => w.replace(/[^a-zA-Z']/g, ''))
                  .filter(Boolean)
              )
            )
          : undefined;

        this.module.start({
          lang: 'en-US',
          interimResults: true,
          continuous: true,
          contextualStrings,
          ...(speechOffline && this.module.supportsOnDeviceRecognition() ? { requiresOnDeviceRecognition: true } : {}),
          ...(saveAudio ? { recordingOptions: SAVE_AUDIO_OPTIONS } : {}),
        });
      })
      .catch((err) => callbacks.onError(String(err?.message || err)));
  }

  stop() {
    this.generation++;
    this.teardown();
    try {
      this.module.stop();
    } catch {
      // already stopped
    }
  }

  private teardown() {
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
  }

  private removeAudioListener() {
    this.audioSubscription?.remove();
    this.audioSubscription = null;
  }
}

/**
 * Returns a live speech engine when one exists on this platform, else null
 * (callers must offer the typed-transcript fallback).
 */
export const getSpeechRecognizer = (): SpeechRecognizer | null => {
  if (Platform.OS === 'web') {
    const Ctor = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
    return Ctor ? new WebSpeechRecognizer(Ctor) : null;
  }
  // Native dev-client/production build: expo-speech-recognition wraps iOS's
  // SFSpeech framework / Android's SpeechRecognizer. Still null under Expo
  // Go, since the native module isn't compiled in there.
  const nativeModule = loadSpeechRecognitionModule();
  return nativeModule ? new NativeSpeechRecognizer(nativeModule) : null;
};
