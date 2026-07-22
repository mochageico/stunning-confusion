import { Platform } from 'react-native';

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
    passesReview: totalWords > 0 && accuracy >= REVIEW_PASS_ACCURACY,
  };
};

// ============================================================================
// TEXT NORMALIZATION
// ============================================================================

/** Lowercases and strips everything but letters/digits: "Spirit," -> "spirit". */
export const normalizeToken = (word: string): string => word.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Splits verse text (or a speech transcript) into normalized word tokens. */
export const tokenizeWords = (text: string): string[] =>
  text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);

/**
 * Collapses a word to its first letter, keeping any leading punctuation
 * (opening quote/paren) and trailing punctuation (comma, period, closing
 * quote) attached -- e.g. "beginning," -> "b,", `"Let` -> `"L`. Used by the
 * Scripture Memory Fellowship-style Memory Grid, which shows every word's
 * first letter permanently (unlike Recall's First Letter hint mode, which
 * only reveals a random hidden subset).
 */
export const firstLetterOnly = (word: string): string => {
  const firstIdx = word.search(/[a-zA-Z0-9]/);
  if (firstIdx === -1) return word;
  const before = word.slice(0, firstIdx);
  const first = word[firstIdx];
  const trailingMatch = word.slice(firstIdx + 1).match(/[^a-zA-Z0-9]*$/);
  const trailing = trailingMatch ? trailingMatch[0] : '';
  return `${before}${first}${trailing}`;
};

/** "In the beginning, God..." -> "I t b, G...", one letter-group per word. */
export const firstLetterLine = (text: string): string =>
  text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map(firstLetterOnly)
    .join(' ');

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
export const classifyFirstLetterAttempt = (typedChar: string, word: string): LetterVerdict => {
  const target = normalizeToken(word).charAt(0);
  if (!target) return 'exact';
  const typed = typedChar.toLowerCase();
  if (typed === target) return 'exact';
  if (isAdjacentKey(typed, target)) return 'close';
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
export const wordsRoughlyEqual = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (CURATED_WORD_EQUIVALENTS[a] === b) return true;
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
export const MATCH_COST = 0;
export const CLOSE_MATCH_COST = 0.15;
export const SUBSTITUTION_COST = 1;
export const SKIP_EXPECTED_COST = 1.2;
export const SKIP_EXPECTED_DROPPABLE_COST = 0.05;
export const INSERT_SPOKEN_COST = 0.4;

const pairCost = (expectedWord: string, spokenWord: string): number => {
  // Normalized for comparison only -- isLikelyVerseNumber below still checks
  // the raw token, since a bare digit is exactly what marks a spoken verse
  // number for suppression regardless of its word form.
  const normalizedSpoken = DIGIT_TO_NUMBER_WORD[spokenWord] ?? spokenWord;
  if (expectedWord === normalizedSpoken) return MATCH_COST;
  // A spoken verse number ("three", "23") read aloud between verses isn't
  // part of the passage. Suppress the usual fuzzy-match discount so it can't
  // get cheaply substituted for a similarly-spelled real word (e.g. "three"
  // vs. "tree") -- the DP then naturally prefers writing it off as noise via
  // INSERT_SPOKEN_COST instead, unless it's an exact match (handled above).
  if (isLikelyVerseNumber(spokenWord) && !isLikelyVerseNumber(expectedWord)) return SUBSTITUTION_COST;
  if (wordsRoughlyEqual(expectedWord, normalizedSpoken)) return CLOSE_MATCH_COST;
  return SUBSTITUTION_COST;
};

const skipExpectedCost = (expectedWord: string): number =>
  isCommonlyDroppedWord(expectedWord) ? SKIP_EXPECTED_DROPPABLE_COST : SKIP_EXPECTED_COST;

// dp[i][j] = min cost aligning expected[0..i) with spoken[0..j). Standard
// three-move recurrence (match/substitute diagonally, skip an expected word,
// insert a spoken word) with the tuned costs above instead of plain 0/1.
const buildAlignmentTable = (expected: string[], spoken: string[]): number[][] => {
  const m = expected.length;
  const n = spoken.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) dp[i][0] = dp[i - 1][0] + skipExpectedCost(expected[i - 1]);
  for (let j = 1; j <= n; j++) dp[0][j] = dp[0][j - 1] + INSERT_SPOKEN_COST;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + pairCost(expected[i - 1], spoken[j - 1]),
        dp[i - 1][j] + skipExpectedCost(expected[i - 1]),
        dp[i][j - 1] + INSERT_SPOKEN_COST
      );
    }
  }
  return dp;
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
  dp: number[][],
  startI: number,
  startJ: number
): (WordOutcome | null)[] => {
  const outcomes: (WordOutcome | null)[] = new Array(expected.length).fill(null);
  let i = startI;
  let j = startJ;
  while (i > 0 && j > 0) {
    const cost = pairCost(expected[i - 1], spoken[j - 1]);
    if (dp[i][j] === dp[i - 1][j - 1] + cost) {
      outcomes[i - 1] = cost === MATCH_COST ? 'perfect' : cost === CLOSE_MATCH_COST ? 'close' : 'missed';
      i -= 1;
      j -= 1;
    } else if (dp[i][j] === dp[i - 1][j] + skipExpectedCost(expected[i - 1])) {
      // A skipped COMMONLY_DROPPED_WORDS word is forgiven outright -- the
      // cheap cost only decides which alignment PATH wins; without this the
      // word would still grade 'missed' despite never having a real chance
      // to be heard (see COMMONLY_DROPPED_WORDS above).
      outcomes[i - 1] = isCommonlyDroppedWord(expected[i - 1]) ? 'perfect' : 'missed';
      i -= 1;
    } else {
      j -= 1;
    }
  }
  while (i > 0) {
    outcomes[i - 1] = isCommonlyDroppedWord(expected[i - 1]) ? 'perfect' : 'missed';
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
  const dp = buildAlignmentTable(expected, spoken);
  const outcomes = backtraceOutcomes(expected, spoken, dp, expected.length, spoken.length);
  return outcomes.map((o) => o ?? 'missed');
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
 * The caller (PracticeModals) owns the actual window position/size and is
 * expected to re-run this on every transcript update. There is no ratchet
 * here -- the result can legitimately revise a previous call's decision
 * (e.g. resolve a repetition-driven ambiguity) once more words arrive; the
 * caller decides how much of that revision it's willing to accept.
 */
export const alignRecitationWindow = (expectedWindow: string[], spokenWindow: string[]): LiveAlignResult => {
  const dp = buildAlignmentTable(expectedWindow, spokenWindow);
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

  const outcomes = backtraceOutcomes(expectedWindow, spokenWindow, dp, bestI, n);
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
   * calls (see PracticeModals.tsx's strike-limit reset) must anchor to this
   * count, never to the full transcript's current token count.
   */
  start(callbacks: {
    onTranscript: (fullTranscript: string, finalizedTokenCount: number) => void;
    onEnd: () => void;
    onError: (message: string) => void;
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
class NativeSpeechRecognizer implements SpeechRecognizer {
  private subscriptions: { remove(): void }[] = [];
  private finalizedText = '';
  private expectedText = '';
  private generation = 0;

  constructor(private module: SpeechRecognitionModule) {}

  prime(expectedText: string) {
    this.expectedText = expectedText;
  }

  start(callbacks: { onTranscript: (t: string, finalizedTokenCount: number) => void; onEnd: () => void; onError: (m: string) => void }) {
    this.teardown();
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
