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
// SPOKEN RECITATION — TRANSCRIPT GRADING
// ----------------------------------------------------------------------------
// Both graders below compare a speech transcript (from any source: Web Speech
// API, a native engine, or a manually typed fallback) against the expected
// verse text. Speech engines mis-hear small words constantly, so two words
// also match "fuzzily" when they're within one letter-edit of each other
// (4+ letter words only — "gods"/"god's", "labour"/"labor").
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

/**
 * Fuzzy spoken-word equality. Speech engines constantly bend a word slightly
 * ("god" -> "got", "separated" -> "separate", "waters" -> "water's" — the
 * last is already handled by normalization). Tolerance scales with length:
 * one edit for 3+ letter words, two for 5+, exact only for the tiny words
 * where one edit changes identity ("a"/"i", "an"/"at"). Homophone-style
 * spellings match through the phonetic key. (5+ rather than 6+ as of
 * 2026-07: users correctly speaking a word still saw it graded missed often
 * enough that the tolerance needed widening — 5-letter words still have
 * enough length that a 2-edit match is very unlikely to land on a genuinely
 * different word.)
 */
export const wordsRoughlyEqual = (a: string, b: string): boolean => {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 5 && levenshtein(a, b) <= 2) return true;
  if (minLen >= 3 && levenshtein(a, b) <= 1) return true;
  if (minLen >= 3 && roughPhoneticKey(a) === roughPhoneticKey(b)) return true;
  return false;
};

export interface LiveMatchResult {
  /** One flag per expected word: has it been spoken (or fuzzily heard)? */
  matched: boolean[];
  /** Index of the next expected word — everything before it is resolved. */
  pointer: number;
}

// How far ahead of the current position the live matcher will search to
// re-synchronize after a mis-heard word. Wide enough to absorb a bad word
// plus a couple of engine hiccups; narrow enough that a common word
// repeating later in the passage rarely causes a false jump (and the final
// grade re-aligns the whole transcript anyway).
export const RESYNC_WINDOW = 6;

const NUMBER_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety', 'hundred',
]);

/**
 * True for a spoken token that's plausibly a recited verse number ("3",
 * "twenty", "one hundred") rather than passage text -- either a bare digit
 * string (some engines transcribe numbers as digits) or a common English
 * number word. Only ever checked on a token that has ALREADY failed to
 * match the next expected word (see matchTranscriptLive below), so actually
 * reciting a number that's really in the verse text ("six days", "two great
 * lights") still matches normally and is never affected by this.
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

/**
 * Incremental matcher for LIVE recitation: recomputed from scratch on every
 * transcript update (transcripts are the only state, so an engine revising
 * its interim results heals earlier mistakes automatically).
 *
 * The cardinal rule is NEVER STALL. The classic failure in recitation apps:
 * the engine mis-hears one word, the matcher keeps comparing everything you
 * say next against that stuck position, and the session hangs while you keep
 * talking. Here, a token that doesn't match the next expected word searches
 * up to RESYNC_WINDOW words ahead and re-anchors there, marking whatever it
 * jumped over as (provisionally) missed. To keep tiny common words ("the",
 * "and") from causing false jumps, a re-anchor needs confidence: either the
 * matching word is 4+ letters, or the NEXT spoken token also matches the
 * word right after the anchor (a two-word agreement).
 */
export const matchTranscriptLive = (expectedTokens: string[], transcript: string): LiveMatchResult => {
  const spoken = tokenizeWords(transcript);
  const matched = new Array(expectedTokens.length).fill(false);
  let e = 0;
  for (let s = 0; s < spoken.length; s++) {
    if (e >= expectedTokens.length) break;
    const token = spoken[s];

    if (wordsRoughlyEqual(token, expectedTokens[e])) {
      matched[e] = true;
      e += 1;
      continue;
    }

    // A spoken verse number ("three", "23") read aloud before/between verses
    // isn't part of the passage -- discard it outright rather than letting
    // it search for a resync anchor, so it can never coincidentally
    // fuzzy-match a real nearby word (e.g. "three" vs. "tree") and wrongly
    // jump the pointer forward.
    if (isLikelyVerseNumber(token)) continue;

    // Re-anchor: find this token a little further ahead in the passage.
    const windowEnd = Math.min(e + RESYNC_WINDOW, expectedTokens.length - 1);
    for (let j = e + 1; j <= windowEnd; j++) {
      if (!wordsRoughlyEqual(token, expectedTokens[j])) continue;
      const confident =
        token.length >= 4 ||
        (s + 1 < spoken.length && j + 1 < expectedTokens.length && wordsRoughlyEqual(spoken[s + 1], expectedTokens[j + 1]));
      if (confident) {
        matched[j] = true;
        e = j + 1;
        break;
      }
    }
    // No confident anchor: treat the token as noise and move on — the next
    // spoken word gets a fresh chance against the same position.
  }

  // Forgive commonly-dropped function words the pointer moved past without
  // ever seeing a matching token -- see COMMONLY_DROPPED_WORDS above. Only
  // words already behind the final pointer are touched; anything at/after it
  // hasn't been resolved yet and isn't read by callers regardless.
  for (let k = 0; k < e; k++) {
    if (!matched[k] && isCommonlyDroppedWord(expectedTokens[k])) matched[k] = true;
  }

  return { matched, pointer: e };
};

/**
 * Grades a COMPLETE transcript against the expected text via edit-distance
 * alignment, returning one outcome per expected word. Used when a recitation
 * arrives all at once (a finished speech-engine result, or the typed
 * "no microphone" fallback).
 */
export const gradeTranscript = (expectedText: string, transcript: string): WordOutcome[] => {
  const expected = tokenizeWords(expectedText);
  const spoken = tokenizeWords(transcript);
  const m = expected.length;
  const n = spoken.length;

  // Standard alignment DP: dp[i][j] = min cost aligning expected[0..i) with
  // spoken[0..j); matches cost 0, everything else costs 1.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const matchCost = wordsRoughlyEqual(expected[i - 1], spoken[j - 1]) ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + matchCost);
    }
  }

  // Backtrace: an expected word aligned to an equal spoken word is 'perfect';
  // anything else (substituted, dropped) is 'missed'.
  const outcomes: WordOutcome[] = new Array(m).fill('missed');
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const matchCost = wordsRoughlyEqual(expected[i - 1], spoken[j - 1]) ? 0 : 1;
    if (dp[i][j] === dp[i - 1][j - 1] + matchCost) {
      if (matchCost === 0) outcomes[i - 1] = expected[i - 1] === spoken[j - 1] ? 'perfect' : 'close';
      i -= 1;
      j -= 1;
    } else if (dp[i][j] === dp[i - 1][j] + 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  // Forgive commonly-dropped function words that landed as a miss (dropped
  // or substituted) -- same reasoning as matchTranscriptLive above: a
  // missing "in"/"the" is almost always the engine swallowing it, not a
  // real recall gap.
  return outcomes.map((o, idx) => (o === 'missed' && isCommonlyDroppedWord(expected[idx]) ? 'perfect' : o));
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
   * so far (interim results included) — feed it to matchTranscriptLive.
   */
  start(callbacks: {
    onTranscript: (fullTranscript: string) => void;
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

  start(callbacks: { onTranscript: (t: string) => void; onEnd: () => void; onError: (m: string) => void }) {
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
      callbacks.onTranscript((this.finalizedText + ' ' + interim).trim());
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

  start(callbacks: { onTranscript: (t: string) => void; onEnd: () => void; onError: (m: string) => void }) {
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
              callbacks.onTranscript(this.finalizedText);
            } else {
              callbacks.onTranscript((this.finalizedText + ' ' + transcript).trim());
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
