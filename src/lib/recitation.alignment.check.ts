// Standalone regression check for the recitation alignment engine --
// specifically the two bugs fixed in the 2026-07 overhaul:
//   (A) a bad live-matching decision could never self-correct once committed
//   (B) repetitive passages (e.g. Romans 8's recurring "flesh"/"Spirit"/
//       "law"/"sin"/"condemn") could cause the matcher to jump to the WRONG
//       nearby occurrence of a repeated word, marking correctly-spoken
//       words in between as missed
//
// recitation.ts has zero React/Firestore imports, so this runs standalone
// under plain Node -- no app, no mic, no build needed. Run via:
//   npm run check:recitation
// (a plain `npx tsx` won't work: recitation.ts imports react-native's
// Platform, whose entry file plain esbuild/tsx can't parse on its own --
// see scripts/run-recitation-check.cjs for why and how that's handled.)
//
// This is a real regression guard, not a scratch script -- keep it
// committed and update it alongside any future change to the cost
// constants or the alignment/reconciliation functions in recitation.ts.

import {
  alignRecitationWindow,
  gradeTranscript,
  isCommonlyDroppedWord,
  reconcileSpeechWindow,
  tokenizeWords,
  wordsRoughlyEqual,
  WordOutcome,
} from './recitation';

// ============================================================================
// Tiny assertion/report harness
// ============================================================================

let total = 0;
let failures = 0;
let currentScenario = '';

const check = (label: string, condition: boolean, detail?: string) => {
  total += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  [${currentScenario}] ${label}${detail ? ` -- ${detail}` : ''}`);
  } else {
    console.log(`  pass  [${currentScenario}] ${label}`);
  }
};

const scenario = (name: string, fn: () => void) => {
  currentScenario = name;
  console.log(`\n${name}`);
  fn();
};

// ============================================================================
// Session simulation helpers -- mirror exactly what PracticeModals.tsx does
// with reconcileSpeechWindow's return value, so these tests exercise the
// real reconciliation contract, not a reimplementation of it.
// ============================================================================

interface Session {
  outcomes: Record<number, WordOutcome>;
  source: Record<number, 'protected' | 'speech'>;
  pointer: number;
  alignAnchor: number;
  spokenFloor: number;
}

const newSession = (): Session => ({ outcomes: {}, source: {}, pointer: 0, alignAnchor: 0, spokenFloor: 0 });

/** Simulates one onTranscript callback firing with the full transcript so far. */
const feedTranscript = (session: Session, expectedTokens: string[], transcriptSoFar: string): Session => {
  const protectedIndices = new Set<number>();
  for (const key of Object.keys(session.source)) {
    if (session.source[Number(key)] === 'protected') protectedIndices.add(Number(key));
  }
  const patch = reconcileSpeechWindow(
    expectedTokens,
    tokenizeWords(transcriptSoFar),
    session.alignAnchor,
    session.spokenFloor,
    protectedIndices,
    session.pointer
  );
  const outcomes = { ...session.outcomes, ...patch.outcomes };
  const source = { ...session.source };
  for (const key of Object.keys(patch.outcomes)) source[Number(key)] = 'speech';
  return { outcomes, source, pointer: patch.pointer, alignAnchor: patch.nextAlignAnchor, spokenFloor: session.spokenFloor };
};

/** Simulates a typed keystroke or manual tap-to-fix committing a word directly. */
const markProtected = (session: Session, idx: number, outcome: WordOutcome): Session => ({
  ...session,
  outcomes: { ...session.outcomes, [idx]: outcome },
  source: { ...session.source, [idx]: 'protected' },
  pointer: Math.max(session.pointer, idx + 1),
});

/** Simulates the strike-limit reset branch in PracticeModals.tsx. */
const resetToVerseStart = (session: Session, verseStart: number, spokenTokenCountAtReset: number): Session => ({
  ...session,
  pointer: verseStart,
  alignAnchor: verseStart,
  spokenFloor: spokenTokenCountAtReset,
});

// ============================================================================
// Shared fixture: a Romans-8-style passage repeating "flesh"/"mind"/"spirit"/
// "the"/"god" within a short span, closely modeled on the user's actual
// complaint (real Romans 8 repeats these same words this densely).
// ============================================================================

const REPETITIVE_EXPECTED_TEXT =
  'the mind of the flesh is death but the mind of the spirit is life and peace because ' +
  'the mind of the flesh is hostile to god for it does not submit to the law of god';
const repetitiveExpected = tokenizeWords(REPETITIVE_EXPECTED_TEXT);
// Index of the word "flesh" the FIRST time it appears, and the second.
const FIRST_FLESH = repetitiveExpected.indexOf('flesh');
const SECOND_FLESH = repetitiveExpected.indexOf('flesh', FIRST_FLESH + 1);

// ============================================================================
// 1. Repetition core case -- correct recitation of a repetitive passage must
//    produce zero false misses.
// ============================================================================
scenario('1. Repetition core case (direct repro of complaint B)', () => {
  const outcomes = gradeTranscript(REPETITIVE_EXPECTED_TEXT, REPETITIVE_EXPECTED_TEXT);
  const missedCount = outcomes.filter((o) => o === 'missed').length;
  check('a verbatim-correct repetitive recitation has zero missed words', missedCount === 0, `${missedCount} missed`);
});

// ============================================================================
// 2. Wrong-occurrence mis-jump -- a single mis-heard word must NOT cause the
//    aligner to skip ahead to a later occurrence of a repeated word,
//    marking the real words in between as missed.
// ============================================================================
scenario('2. Wrong-occurrence mis-jump (direct repro of complaint B)', () => {
  const spoken = [...repetitiveExpected];
  spoken[FIRST_FLESH] = 'trash'; // clean mis-hearing, not fuzzy-close to "flesh"
  const outcomes = gradeTranscript(REPETITIVE_EXPECTED_TEXT, spoken.join(' '));

  check(
    `the mis-heard word itself (index ${FIRST_FLESH}) grades missed`,
    outcomes[FIRST_FLESH] === 'missed'
  );
  let wronglySkipped = 0;
  for (let i = FIRST_FLESH + 1; i < SECOND_FLESH; i++) {
    if (outcomes[i] === 'missed') wronglySkipped += 1;
  }
  check(
    `none of the ${SECOND_FLESH - FIRST_FLESH - 1} correctly-spoken words between the two occurrences of "flesh" were skipped`,
    wronglySkipped === 0,
    `${wronglySkipped} wrongly marked missed`
  );
  check(`the second "flesh" (index ${SECOND_FLESH}) still grades perfect`, outcomes[SECOND_FLESH] === 'perfect');
});

// ============================================================================
// 3. Mis-hear adjacent to a repeat -- resolves at the NEARER occurrence, not
//    a later one, when a mis-heard word sits right next to a repeated word.
// ============================================================================
scenario('3. Mis-hear adjacent to a repeat', () => {
  const expectedText = 'the law of sin and death condemns the flesh but the law of the spirit sets us free';
  const expected = tokenizeWords(expectedText);
  const firstLaw = expected.indexOf('law');
  const secondLaw = expected.indexOf('law', firstLaw + 1);
  const spoken = [...expected];
  spoken[firstLaw] = 'cat'; // unrelated to "law", not fuzzy-close

  const outcomes = gradeTranscript(expectedText, spoken.join(' '));
  check(`the near mis-hearing (index ${firstLaw}) grades missed, not silently absorbed`, outcomes[firstLaw] === 'missed');
  check(
    `the real second "law" (index ${secondLaw}) is matched at its own position, not reused for the first`,
    outcomes[secondLaw] === 'perfect'
  );
  const otherMisses = outcomes.filter((o, i) => o === 'missed' && i !== firstLaw).length;
  check('no other word in the passage was wrongly marked missed', otherMisses === 0, `${otherMisses} other misses`);
});

// ============================================================================
// 4. Dropped function words -- forgiven via the cost function (no post-hoc
//    pass anymore), a genuinely wrong word nearby still grades missed.
// ============================================================================
scenario('4. Dropped function words', () => {
  const expectedText = 'the mind of the flesh is death but the mind of the spirit is life';
  const expected = tokenizeWords(expectedText);
  const droppedIndices = [0, 2, 3]; // "the", "of", "the" -- all in COMMONLY_DROPPED_WORDS
  for (const idx of droppedIndices) {
    check(`fixture sanity: expected[${idx}] ("${expected[idx]}") is actually a droppable word`, isCommonlyDroppedWord(expected[idx]));
  }
  const spoken = expected.filter((_, i) => !droppedIndices.includes(i));
  const outcomes = gradeTranscript(expectedText, spoken.join(' '));
  for (const idx of droppedIndices) {
    check(`dropped word at index ${idx} ("${expected[idx]}") is forgiven (perfect, not missed)`, outcomes[idx] === 'perfect');
  }
  const realMisses = outcomes.filter((o) => o === 'missed').length;
  check('every other word (all genuinely spoken) grades perfect', realMisses === 0, `${realMisses} unexpected misses`);
});

// ============================================================================
// 5. Self-correction over time -- direct repro + fix-proof of complaint A.
//    An interim mis-hearing gets provisionally graded, then a later
//    transcript revision (the engine correcting its own guess) must be able
//    to flip that grade -- proving there's no permanent ratchet anymore.
// ============================================================================
scenario('5. Self-correction over time (direct repro + fix of complaint A)', () => {
  let session = newSession();

  // Tick 1: interim transcript mis-hears "flesh" as "flash" -- close enough
  // to fuzzy-match, so it provisionally grades 'close'.
  session = feedTranscript(session, repetitiveExpected, 'the mind of the flash');
  check(
    `after the interim mis-hearing, index ${FIRST_FLESH} is provisionally graded (not left unresolved)`,
    session.outcomes[FIRST_FLESH] === 'close' || session.outcomes[FIRST_FLESH] === 'perfect',
    `got ${session.outcomes[FIRST_FLESH]}`
  );

  // Tick 2: the engine finalizes and REVISES its own guess -- "flash" becomes
  // "trash" (not fuzzy-close to "flesh" at all) -- and more of the passage
  // arrives after it.
  const revisedTranscript =
    'the mind of the trash is death but the mind of the spirit is life and peace because the mind of the';
  session = feedTranscript(session, repetitiveExpected, revisedTranscript);
  check(
    `the earlier 'close' grade at index ${FIRST_FLESH} was revised to 'missed' once the transcript corrected itself`,
    session.outcomes[FIRST_FLESH] === 'missed',
    `got ${session.outcomes[FIRST_FLESH]} -- a permanent ratchet would have left this stuck at the old grade`
  );
});

// ============================================================================
// 6 & 7. Protection from being clobbered -- typed input and manual
//    tap-to-fix (both surface as 'protected' provenance) must survive a
//    disagreeing speech reconciliation.
// ============================================================================
scenario('6. Typed input survives a disagreeing speech reconciliation', () => {
  let session = newSession();
  session = markProtected(session, FIRST_FLESH, 'perfect'); // user typed the correct letter here

  const spoken = [...repetitiveExpected];
  spoken[FIRST_FLESH] = 'trash'; // speech disagrees with what was typed
  session = feedTranscript(session, repetitiveExpected, spoken.slice(0, FIRST_FLESH + 5).join(' '));

  check("the typed 'perfect' grade was not overwritten by disagreeing speech", session.outcomes[FIRST_FLESH] === 'perfect');
});

scenario('7. Manual tap-to-fix survives a disagreeing speech reconciliation', () => {
  let session = newSession();
  // Speech initially (correctly) grades it missed...
  const spoken = [...repetitiveExpected];
  spoken[FIRST_FLESH] = 'trash';
  session = feedTranscript(session, repetitiveExpected, spoken.slice(0, FIRST_FLESH + 5).join(' '));
  check('sanity: speech graded it missed before the manual fix', session.outcomes[FIRST_FLESH] === 'missed');

  // ...user taps it to mark it correct (they know they said it right).
  session = markProtected(session, FIRST_FLESH, 'perfect');

  // Further speech reconciliation must not revert the manual fix.
  session = feedTranscript(session, repetitiveExpected, spoken.slice(0, FIRST_FLESH + 10).join(' '));
  check("the manually-corrected grade survives further reconciliation", session.outcomes[FIRST_FLESH] === 'perfect');
});

// ============================================================================
// 8. Strike-reset isolation -- after a simulated reset, stale pre-reset
//    speech must not resurrect or jump the pointer past the reset boundary.
// ============================================================================
scenario('8. Strike-reset isolation', () => {
  let session = newSession();
  const fullCorrectTranscript = REPETITIVE_EXPECTED_TEXT;
  session = feedTranscript(session, repetitiveExpected, fullCorrectTranscript);
  const pointerBeforeReset = session.pointer;
  check('sanity: the session made real progress before the reset', pointerBeforeReset > 5, `pointer=${pointerBeforeReset}`);

  const verseStart = 3; // simulate a strike-limit reset back to some earlier word
  const spokenTokenCountAtReset = tokenizeWords(fullCorrectTranscript).length;
  session = resetToVerseStart(session, verseStart, spokenTokenCountAtReset);

  // The raw transcript the engine is still holding hasn't changed (it never
  // clears on a reset) -- re-feed the SAME old transcript and confirm it's
  // treated as stale, not as new evidence to jump forward on again.
  session = feedTranscript(session, repetitiveExpected, fullCorrectTranscript);
  check(
    'stale pre-reset speech does not walk the pointer back past the reset boundary',
    session.pointer === verseStart,
    `pointer=${session.pointer}, expected ${verseStart}`
  );

  // More realistically, the engine keeps listening and appends NEW words to
  // that same stale transcript as the user re-recites from the reset point.
  // Confirm reconciliation resumes correctly using only the new tail words.
  const reattemptWords = repetitiveExpected.slice(verseStart, verseStart + 8).join(' ');
  session = feedTranscript(session, repetitiveExpected, `${fullCorrectTranscript} ${reattemptWords}`);
  check(
    'speech after the reset correctly resumes progress from the reset boundary',
    session.pointer === verseStart + 8,
    `pointer=${session.pointer}, expected ${verseStart + 8}`
  );
});

// ============================================================================
// 9. Nearer-occurrence preference under ambiguity -- when a mis-heard word
//    could plausibly resync to more than one nearby repeat, the aligner
//    never prefers the farther one.
// ============================================================================
scenario('9. Nearer-occurrence preference under ambiguity', () => {
  const expectedText = 'a cat sat near a cat and a cat slept';
  const expected = tokenizeWords(expectedText);
  const firstCat = expected.indexOf('cat');
  const secondCat = expected.indexOf('cat', firstCat + 1);
  const spoken = [...expected];
  spoken[firstCat] = 'dog'; // unrelated

  const outcomes = gradeTranscript(expectedText, spoken.join(' '));
  check(`the first "cat" (index ${firstCat}) resolves locally as missed`, outcomes[firstCat] === 'missed');
  check(`the words between the two "cat"s are not skipped over`, outcomes[firstCat + 1] === 'perfect' && outcomes[firstCat + 2] === 'perfect');
  check(`the real second "cat" (index ${secondCat}) still matches at its own position`, outcomes[secondCat] === 'perfect');
});

// ============================================================================
// 10. gradeTranscript regression parity -- basic known-good/known-bad
//    complete-transcript cases still behave sanely after the shared-core
//    refactor.
// ============================================================================
scenario('10. gradeTranscript regression parity', () => {
  const perfect = gradeTranscript('in the beginning god created the heavens and the earth', 'in the beginning god created the heavens and the earth');
  check('an exact transcript grades entirely perfect', perfect.every((o) => o === 'perfect'));

  const oneWrongWord = gradeTranscript('for god so loved the world', 'for god so hated the world');
  check('a single genuinely wrong word grades missed, not the whole passage', oneWrongWord[3] === 'missed');
  check('the words around the wrong one still grade perfect', oneWrongWord[0] === 'perfect' && oneWrongWord[5] === 'perfect');

  const trailingUnspoken = gradeTranscript('the lord is my shepherd i shall not want', 'the lord is my shepherd');
  check('words never reached at all in a finished transcript still count against the final grade', trailingUnspoken[trailingUnspoken.length - 1] === 'missed');
});

// ============================================================================
// 11. Scale sanity -- a synthetic ~900-word chapter streamed word-by-word
//    through the real windowed reconciliation loop stays fast.
// ============================================================================
scenario('11. Scale sanity', () => {
  const basePhrase =
    'for i am not ashamed of the gospel for it is the power of god for salvation to everyone who believes';
  const words: string[] = [];
  while (words.length < 900) words.push(...tokenizeWords(basePhrase));
  const bigExpected = words.slice(0, 900);
  const bigTranscript = bigExpected.join(' ');

  const start = Date.now();
  let session = newSession();
  const CHUNK = 5;
  const allTokens = tokenizeWords(bigTranscript);
  for (let end = CHUNK; end <= allTokens.length; end += CHUNK) {
    session = feedTranscript(session, bigExpected, allTokens.slice(0, end).join(' '));
  }
  const elapsedMs = Date.now() - start;

  check('a ~900-word streamed session reaches (near) the end of the passage', session.pointer > 850, `pointer=${session.pointer}`);
  check('the full streamed session completes well within budget', elapsedMs < 5000, `${elapsedMs}ms`);
  console.log(`  info  streamed ~900 words in ${allTokens.length / CHUNK} reconciliation calls, ${elapsedMs}ms total`);
});

// ============================================================================
// 12. Live 'close' grading -- a near-miss word grades 'close' during LIVE
//    (windowed) recitation now, not just at the final grade.
// ============================================================================
scenario("12. Live 'close' grading", () => {
  const expectedWindow = tokenizeWords('in the beginning god created the heavens and the earth');
  const spokenWindow = tokenizeWords('in the beginning god creates the heavens and the earth'); // created -> creates
  const result = alignRecitationWindow(expectedWindow, spokenWindow);
  const createdIdx = expectedWindow.indexOf('created');
  check("a near-miss word grades 'close' during live windowed alignment", result.outcomes[createdIdx] === 'close', `got ${result.outcomes[createdIdx]}`);
});

// ============================================================================
// 13. Short interjection equivalence -- "O Lord" transcribed as "oh Lord"
//    must not grade missed, and the curated list must not accidentally
//    loosen unrelated short words.
// ============================================================================
scenario('13. "O Lord" short interjection equivalence', () => {
  check('"o" and "oh" are treated as equivalent', wordsRoughlyEqual('o', 'oh'));
  check('the equivalence is symmetric', wordsRoughlyEqual('oh', 'o'));
  check('unrelated short words are NOT loosened by the curated list', !wordsRoughlyEqual('no', 'so'));

  const outcomes = gradeTranscript('o lord my god i cry to you by day', 'oh lord my god i cry to you by day');
  check('"O" transcribed as "oh" does not grade missed', outcomes[0] !== 'missed', `got ${outcomes[0]}`);
  const otherMisses = outcomes.slice(1).filter((o) => o === 'missed').length;
  check('the rest of the verse is unaffected', otherMisses === 0, `${otherMisses} unexpected misses`);
});

// ============================================================================
// 14. Long/hard-word tolerance -- an 8+-letter word mangled across up to 3
//    edits still matches, but the widened tolerance doesn't leak down to
//    shorter words.
// ============================================================================
scenario('14. Long/hard-word tolerance', () => {
  check(
    '8-letter words 3 edits apart now match',
    wordsRoughlyEqual('abcdefgh', 'abzdyfgx') // c->z, e->y, h->x: exactly 3 substitutions
  );
  check(
    '7-letter words 3 edits apart still do NOT match (tolerance stays scoped to 8+)',
    !wordsRoughlyEqual('abcdefg', 'abzdyfx') // same 3-substitution shape, one letter shorter
  );

  const expectedText = 'we have redemption through his blood the forgiveness of our trespasses';
  const forgivenessIdx = tokenizeWords(expectedText).indexOf('forgiveness');
  const outcomes = gradeTranscript(
    expectedText,
    'we have redemption through his blood the forgivness of our trespasses' // dropped 'e'
  );
  check(
    'a long word with a minor mangling does not grade missed',
    outcomes[forgivenessIdx] !== 'missed',
    `got ${outcomes[forgivenessIdx]}`
  );
});

// ============================================================================
// 15. Number-word/digit normalization -- scripture spells numbers out, but
//    engines often transcribe them as digits.
// ============================================================================
scenario('15. Number-word/digit normalization', () => {
  const outcomes = gradeTranscript(
    'and he divided his forces against them by night twelve tribes gathered',
    'and he divided his forces against them by night 12 tribes gathered'
  );
  const twelveIdx = tokenizeWords('and he divided his forces against them by night twelve tribes gathered').indexOf('twelve');
  check('"twelve" transcribed as "12" does not grade missed', outcomes[twelveIdx] !== 'missed', `got ${outcomes[twelveIdx]}`);

  // A genuinely spoken verse-number annotation (not part of the text) must
  // still be suppressed rather than cheaply matched via digit normalization.
  const expectedText = 'there is therefore now no condemnation';
  const numberSuppressed = gradeTranscript(expectedText, '1 there is therefore now no condemnation');
  const missedCount = numberSuppressed.filter((o) => o === 'missed').length;
  check(
    'a spoken verse-number annotation before the text is still discarded as noise, not misaligned',
    missedCount === 0,
    `${missedCount} unexpected misses: ${JSON.stringify(numberSuppressed)}`
  );
});

// ============================================================================
// 16. Curated homophone (Pharaoh/farrow) -- a true homophone whose spelling
//    diverges too much for edit distance or the phonetic key to bridge.
// ============================================================================
scenario('16. Curated homophone (Pharaoh/farrow)', () => {
  check('"pharaoh" and "farrow" are treated as equivalent', wordsRoughlyEqual('pharaoh', 'farrow'));
  check('the equivalence is symmetric', wordsRoughlyEqual('farrow', 'pharaoh'));

  const outcomes = gradeTranscript(
    'so pharaoh dreamed and behold he stood by the river',
    'so farrow dreamed and behold he stood by the river'
  );
  check('"Pharaoh" transcribed as "farrow" does not grade missed', outcomes[1] !== 'missed', `got ${outcomes[1]}`);
});

// ============================================================================
console.log(`\n${total - failures}/${total} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILED.`);
  process.exit(1);
}
