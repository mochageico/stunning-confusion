import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, ListChecks, ListOrdered, ListTree, MessageCircle, Mic, Puzzle, SearchCheck, Signpost } from 'lucide-react-native';
import { ChapterSections, VerseState, QueueItem, TextScript } from '../../types';
import { isReviewDue } from '../../state/useAppState';
import { feedbackDone, feedbackMiss } from '../../lib/feedback';
import { classifyFirstLetterAttempt, getSpeechRecognizer, gradeTranscriptDetailed, normalizeToken, reconcileSpeechWindow, tokenizeWords, SpeechRecognizer, willSaveSpeechAudio, WordOutcome } from '../../lib/recitation';
import { recordSpeechSlip } from '../../lib/speechSlips';
import { deleteSpeechRecording } from '../../lib/speechRecording';
import { runSecondPass, warmSecondPass } from '../../lib/speechSecondPass';
import { auth } from '../../firebase';
import { UNRELEASED_TRANSLATION_TESTERS } from '../../data';
import { splitWords, typedLetters } from '../../lib/textScript';
import { MIN_JIGSAW_VERSES, MIN_THREAD_VERSES, threadRunEndingAt } from '../../lib/drills';
import { verseAnnotationKey } from '../MemoryGrid';
import { DEFAULT_STRIKE_LIMIT, isStrikeLimit, loadPracticePrefs, savePracticePrefs, StrikeLimit } from '../../lib/practicePrefs';
import { formatDate } from '../../lib/format';
import { formatLabel } from '../../lib/formatNames';
import { drillSections, hasEnoughSections } from '../../lib/sectionDrills';
import { GradeInput, wordAccuracy } from '../../lib/grading';
import { buildReciteOrder, positionsToWords, verseStartPosition } from '../../lib/reciteOrder';

// ============================================================================
// RECALL (LEARN MODE)
// ----------------------------------------------------------------------------
// Graded Recall -- typed first letters and speech advancing one shared pointer
// -- plus the words hidden / first letter settings, the mode picker and the
// drill hand-off. PracticeModals calls this after useListenPlayback, every
// render, in either mode. Split out of PracticeModals.tsx (see
// .claude/file-split-plan.md).
// ============================================================================

export type LearnMode = 'recite' | 'buildUp' | 'jigsaw' | 'scramble' | 'spotSwap' | 'outline' | 'putInOrder' | 'whichSection' | 'teachIt';

export interface UseRecallParams {
  verses: VerseState[];
  onPickUpThread?: (target: VerseState) => void;
  sessionTotal?: number;
  memoryQueue?: QueueItem[];
  passageScript: TextScript;
  /** The tab to open on instead of Recall (the chapter page's First words button). */
  initialLearnTab?: LearnMode;
  /** Settings -> Pause Reviews is on: nothing is due. */
  reviewsPaused?: boolean;
  /**
   * The saved sections of the passage's chapter, if it has any. Put in order
   * and Which section only get a tab when the passage reaches 3+ of them.
   */
  chapterSectionsDoc?: ChapterSections | null;
}

export function useRecall({
  verses,
  onPickUpThread,
  sessionTotal,
  memoryQueue,
  passageScript,
  initialLearnTab,
  reviewsPaused = false,
  chapterSectionsDoc = null,
}: UseRecallParams) {
  // ==========================================
  // LEARN MODE — Recall (typed + spoken, either channel advances the same
  // word) plus a set of supplementary drills. Every group-practice button in
  // the app opens 'learn' and the mode picker on the screen chooses the drill.
  // Internal value 'recite' is kept for the graded mode (labeled "Recall" in
  // the UI) to avoid touching every reference below.
  //
  // Recall is the only mode here that can bank a mastery touch, and with First
  // words (the Outline tab: say each verse from its first words) the only one
  // that can count a review. The other supplementary drills are deliberately ungraded — they
  // exercise different memory skills (sequence, phrasing, error-spotting)
  // that word-accuracy grading doesn't model, and letting them feed the
  // graduation engine would blur what "graduated" means. The manual-log
  // button in the header is the honest escape valve for "I reviewed this
  // for real, off-app".
  //
  // The old "Reveal" tab was removed here: its masking slider duplicated
  // Recall's own hide-level slider while grading nothing (you could peek the
  // whole passage), so the only part anyone actually used was its
  // self-assessed logging buttons — which is exactly what the manual-log
  // action now does, without pretending to be a drill.
  // ==========================================

  const [learnTab, setLearnTab] = useState<LearnMode>(initialLearnTab ?? 'recite');

  // Flat word list across the whole passage -- the single shared "position"
  // both input channels advance, instead of maintaining two separate
  // (verseIdx, wordIdx) and flat-transcript-index representations that would
  // need to be kept in sync. Filters out any token that normalizes to
  // nothing (e.g. a standalone em-dash), matching tokenizeWords's own filter
  // exactly so this list and speakExpectedTokens below always stay the same
  // length and line up 1:1 by index.
  const reciteWordObjects = useMemo(() => {
    const list: { verseIdx: number; word: string }[] = [];
    verses.forEach((v, verseIdx) => {
      splitWords(v.text, passageScript).forEach((w) => {
        if (normalizeToken(w, passageScript).length > 0) list.push({ verseIdx, word: w });
      });
    });
    return list;
  }, [verses, passageScript]);

  // "Last to first": verses in reverse, each verse still said forward. Words
  // keep their passage-order index everywhere (outcomes, hidden sample, grid,
  // crediting); only the pointer below walks recite positions, and
  // lib/reciteOrder translates between the two.
  const [lastToFirst, setLastToFirst] = useState(false);

  const reciteOrder = useMemo(
    () => buildReciteOrder(reciteWordObjects.map((w) => w.verseIdx), verses.length, lastToFirst),
    [reciteWordObjects, verses.length, lastToFirst]
  );

  const wordVerse = (pos: number) => reciteWordObjects[reciteOrder.order[pos]]?.verseIdx;

  // How many words have been confirmed so far (either channel) -- a recite
  // position, not a word index (see reciteOrder) -- and each confirmed
  // word's grade, keyed by word index. Both persist across a tab switch away
  // and back within the same modal instance since the recording is the same
  // passage.
  const [recitePointer, setRecitePointer] = useState(0);

  const [reciteOutcomes, setReciteOutcomes] = useState<Record<number, WordOutcome>>({});

  // Who committed each graded word -- 'protected' entries (typed, revealed
  // hints, manual tap-to-fix) can never be silently overwritten by a later
  // speech reconciliation pass; 'speech' entries can be revised freely as
  // more of the transcript arrives. Speech and typing share the same
  // recitePointer/reciteOutcomes (either input works at any moment), so this
  // is what stops a speech revision from clobbering a more-authoritative
  // signal.
  const [reciteSource, setReciteSource] = useState<Record<number, 'protected' | 'speech'>>({});

  const [verseStrikes, setVerseStrikes] = useState(0);

  // Verses (index into `verses`) where a word was revealed as a hint: a hint
  // makes that verse a stumble at best (REVIEW_LADDER_PLAN.md §4).
  const [hintedVerses, setHintedVerses] = useState<Set<number>>(new Set());

  // Set in Settings, not here (see lib/practicePrefs); read once on open.
  const [strikeLimit, setStrikeLimit] = useState<StrikeLimit>(DEFAULT_STRIKE_LIMIT);

  const [showStrikeResetAlert, setShowStrikeResetAlert] = useState(false);

  const [typedInput, setTypedInput] = useState('');

  const [flashError, setFlashError] = useState(false);

  const [isFinishedRecite, setIsFinishedRecite] = useState(false);

  // Final graded outcomes for the finished Recite session -- drives the
  // accuracy summary + which logging buttons the user gets.
  const [finalOutcomes, setFinalOutcomes] = useState<WordOutcome[] | null>(null);

  // Voice channel
  const [isListeningSpeak, setIsListeningSpeak] = useState(false);

  const [localToast, setLocalToast] = useState<string | null>(null);

  const [speakTranscript, setSpeakTranscript] = useState('');

  // One engine per mounted modal; null when this platform has no live speech
  // engine (native Expo Go) -- Recite still works via typing alone.
  const speechEngineRef = useRef<SpeechRecognizer | null>(null);

  const [speechAvailable] = useState(() => {
    speechEngineRef.current = getSpeechRecognizer();
    return speechEngineRef.current !== null;
  });

  // Whether speech contributed anything this session -- decides whether the
  // completed drill logs as 'speak' or 'type' (there's no third drillType
  // for "both"; matches TouchLog's existing two-value shape).
  const usedSpeechRef = useRef(false);

  // Bounds the live speech reconciliation to a window instead of realigning
  // the whole passage on every transcript update -- both cheap (bounded DP
  // cost regardless of passage length) and predictable (bounds how far any
  // single revision can jump). alignAnchorRef is where the expected-word
  // window starts; it only ever advances, holding back a trailing buffer of
  // recently-committed words that stay open to revision as more speech
  // arrives (see the reconciliation effect below). spokenTokenFloorRef marks
  // the first spoken token that's still relevant -- the transcript keeps
  // accumulating for the whole listening session, so after a strike-limit
  // reset (or a full game reset) this must jump forward too, or stale
  // pre-reset speech could walk the pointer right back past the reset.
  const alignAnchorRef = useRef(0);

  const spokenTokenFloorRef = useRef(0);

  // How many tokens of speakTranscript are from FINALIZED segments as of the
  // most recent onTranscript call -- the only stable position to snapshot
  // spokenTokenFloorRef from. Engines routinely rewrite interim segments as
  // more audio context arrives (even the token COUNT can change between
  // calls), so basing the floor on the full transcript's raw token count at
  // an arbitrary moment risks snapshotting a count that's about to become
  // wrong once that in-flight interim segment finalizes differently.
  const finalizedTokenCountRef = useRef(0);

  // The last listening run's saved audio (iPhone), for the second pass in
  // SPEECH_SECOND_PASS_PLAN.md. Only one is kept: a new run deletes it.
  const speechAudioUriRef = useRef<string | null>(null);
  const [speechAudioUri, setSpeechAudioUri] = useState<string | null>(null);

  // Second pass: once the run is finished, Whisper re-hears the last
  // listening run and any word Apple missed but Whisper heard turns green.
  // The run is the recite position listening started at; a strike reset
  // during it makes the audio hold a verse twice, so that run is skipped.
  const [isDoubleChecking, setIsDoubleChecking] = useState(false);
  const listenStartPosRef = useRef(0);
  const listenHadResetRef = useRef(false);
  const expectAudioRef = useRef(false);
  // Bumped by a reset or close, so a late answer can't touch a newer run.
  const secondPassGenRef = useRef(0);
  const checkedAudioRef = useRef<string | null>(null);

  // Make sure the engine never keeps listening past the modal's lifetime.
  useEffect(() => {
    // Wake the second-pass function now so it's ready by Stop.
    if (speechAvailable && passageScript === 'latin' && willSaveSpeechAudio()) warmSecondPass();
    return () => {
      speechEngineRef.current?.stop();
      secondPassGenRef.current++;
      deleteSpeechRecording(speechAudioUriRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerLocalToast = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => {
      setLocalToast((prev) => (prev === msg ? null : prev));
    }, 2500);
  };

  // Records the grade of the word at recite position `pos` and advances the
  // shared pointer -- used by both the typed-letter path and the hint/reveal
  // path. Resets the per-verse strike count when the advance crosses into a
  // new verse. Tagged 'protected' -- a deliberate typed answer or an
  // explicitly revealed hint must never be silently reverted by a later
  // speech reconciliation pass.
  const commitReciteOutcome = (pos: number, outcome: WordOutcome) => {
    const idx = reciteOrder.order[pos];
    setReciteOutcomes((prev) => ({ ...prev, [idx]: outcome }));
    setReciteSource((prev) => ({ ...prev, [idx]: 'protected' }));
    const verseDone = pos + 1 >= reciteOrder.order.length || wordVerse(pos + 1) !== wordVerse(pos);
    if (verseDone) feedbackDone();
    if (pos + 1 < reciteOrder.order.length && wordVerse(pos + 1) !== wordVerse(pos)) {
      setVerseStrikes(0);
    }
    setRecitePointer(pos + 1);
  };

  // NOTE: onChangeText passes the string directly (unlike web's onChange event).
  const handleReciteTypeChar = (val: string) => {
    if (isFinishedRecite || recitePointer >= reciteWordObjects.length || showStrikeResetAlert) return;

    if (val.length === 0) {
      setTypedInput('');
      return;
    }

    // Hebrew/Greek: only letters count as guesses -- a vowel point or
    // invisible mark the keyboard sends with the letter is dropped, not
    // graded wrong (see typedLetters). A change carrying no letter at all is
    // just cleared. English keeps its last-character behaviour.
    const letters = typedLetters(val, passageScript);
    if (letters.length === 0) {
      setTypedInput('');
      return;
    }
    const lastChar = letters[letters.length - 1];
    const currentIdx = reciteOrder.order[recitePointer];
    const current = reciteWordObjects[currentIdx];
    // Near-miss forgiveness: 'close' means a QWERTY key adjacent to the
    // right letter — accepted and advanced just like 'exact', but graded
    // separately so a perfect-run check can still see the difference
    // between clean recall and fat-fingered recall (both count as correct).
    const verdict = classifyFirstLetterAttempt(lastChar, current.word, passageScript);

    if (verdict !== 'wrong') {
      const alreadyMissed = reciteOutcomes[currentIdx] === 'missed';
      const outcome: WordOutcome = alreadyMissed ? 'missed' : verdict === 'close' ? 'close' : 'perfect';
      commitReciteOutcome(recitePointer, outcome);
      setTypedInput('');
    } else {
      const nextStrikes = verseStrikes + 1;
      setVerseStrikes(nextStrikes);
      setFlashError(true);
      feedbackMiss();
      setTypedInput(''); // Clear on error so user doesn't have to backspace
      // One wrong attempt permanently marks this word missed for the session
      // (getting it right on the next try lets you continue, but the
      // accuracy score keeps the miss).
      setReciteOutcomes((prev) => ({ ...prev, [currentIdx]: 'missed' }));

      if (strikeLimit !== 'unlimited' && nextStrikes >= strikeLimit) {
        setShowStrikeResetAlert(true);
        const verseStartPointer = verseStartPosition(reciteOrder, reciteWordObjects.map((w) => w.verseIdx), recitePointer);
        setRecitePointer(verseStartPointer);
        setVerseStrikes(0);
        // The spoken transcript isn't cleared by this reset -- the engine
        // keeps listening and accumulating regardless. Without moving these
        // anchors forward too, the next reconciliation tick would still see
        // the old pre-reset words and could walk the pointer right back past
        // the reset using stale speech, defeating the whole point of it.
        // Snapshotting from finalizedTokenCountRef (not speakTranscript's raw
        // token count) matters here specifically: whatever's still interim
        // right at this instant could still be rewritten by the engine into
        // a different token count once it finalizes, which would silently
        // invalidate a floor based on the current full-transcript length.
        alignAnchorRef.current = verseStartPointer;
        spokenTokenFloorRef.current = finalizedTokenCountRef.current;
        listenHadResetRef.current = true;
        setTimeout(() => setShowStrikeResetAlert(false), 1500);
      }

      setTimeout(() => setFlashError(false), 200);
    }
  };

  // Manual override for a word the matcher marked missed -- speech engines
  // routinely mis-hear a word the user actually said correctly, and there's
  // no reliable automatic fix for that, so tapping a red word lets the user
  // grade it themselves. Also patches finalOutcomes when the session has
  // already finished (the summary/log buttons read from that snapshot, not
  // reciteOutcomes, once isFinishedRecite is true).
  //
  // A word speech graded (not a typed miss or a revealed hint, which are the
  // user's own) also teaches the grader: what the engine wrote in its place
  // is counted, and a slip fixed often enough is accepted from then on (see
  // lib/speechSlips). Recomputed from the full transcript here rather than
  // tracked through every live reconciliation pass.
  const overrideWordAsCorrect = (idx: number) => {
    if (reciteSource[idx] === 'speech' && passageScript === 'latin' && speakTranscript) {
      const pos = reciteOrder.posOf[idx];
      const { heard } = gradeTranscriptDetailed(speakExpectedTokens.join(' '), speakTranscript);
      recordSpeechSlip(speakExpectedTokens[pos] ?? '', heard[pos]);
    }
    setReciteOutcomes((prev) => ({ ...prev, [idx]: 'perfect' }));
    setReciteSource((prev) => ({ ...prev, [idx]: 'protected' }));
    setFinalOutcomes((prev) => (prev ? prev.map((o, i) => (i === idx ? 'perfect' : o)) : prev));
  };

  // Revealing a word is a miss for grading purposes -- the user didn't
  // recall it.
  const handleReciteHint = () => {
    if (recitePointer >= reciteWordObjects.length) return;
    const verseIdx = wordVerse(recitePointer);
    if (verseIdx !== undefined) setHintedVerses((prev) => (prev.has(verseIdx) ? prev : new Set(prev).add(verseIdx)));
    commitReciteOutcome(recitePointer, 'missed');
  };

  const resetReciteGame = () => {
    setRecitePointer(0);
    setReciteOutcomes({});
    setReciteSource({});
    setVerseStrikes(0);
    setHintedVerses(new Set());
    setTypedInput('');
    setShowStrikeResetAlert(false);
    setIsFinishedRecite(false);
    setFinalOutcomes(null);
    speechEngineRef.current?.stop();
    setIsListeningSpeak(false);
    secondPassGenRef.current++;
    setIsDoubleChecking(false);
    expectAudioRef.current = false;
    setSpeakTranscript('');
    usedSpeechRef.current = false;
    alignAnchorRef.current = 0;
    spokenTokenFloorRef.current = 0;
    finalizedTokenCountRef.current = 0;
  };

  // ==========================================
  // HIDE LEVEL — future words are only masked if their flat index landed in
  // this session's random `hiddenWordIndices` sample (re-rolled every time
  // the passage resets, so a different subset is hidden each attempt).
  // Defaults to 100 (fully hidden), matching this drill's original all-or-
  // nothing behavior. Below 100, it's a lower-stakes warm-up and never
  // counts toward mastery or a review; at 100 it's a real blind attempt and
  // grades exactly like the drill always has.
  // ==========================================
  const [hideLevel, setHideLevel] = useState(100);

  // First Letter is an alternate hint mode to plain %-hidden: hidden words
  // show their real first letter instead of a full dot-mask. It has its own
  // independent level (0/25/50/75/100) rather than sharing hideLevel, so
  // switching modes doesn't clobber whichever level you last used in the
  // other one. Unlike plain %-hidden (which only grades at 100%), a First
  // Letter run counts as a real review at ANY level -- the hint means it
  // can never bank a mastery touch, but it's not a no-credit warm-up either.
  const [hintMode, setHintMode] = useState<'percent' | 'firstLetter'>('percent');

  const [firstLetterLevel, setFirstLetterLevel] = useState(100);

  const activeLevel = hintMode === 'firstLetter' ? firstLetterLevel : hideLevel;

  const setActiveLevel = (level: number) => {
    if (hintMode === 'firstLetter') setFirstLetterLevel(level);
    else setHideLevel(level);
  };

  const switchHintMode = (mode: 'percent' | 'firstLetter') => {
    if (mode === hintMode) return;
    setHintMode(mode);
    resetReciteGame();
    regenerateHiddenWords(mode === 'firstLetter' ? firstLetterLevel : hideLevel);
  };

  // Passage (existing inline masked paragraph) vs Memory Grid -- a display
  // choice for the reading area only, independent of hintMode/hideLevel.
  // Memory Grid always shows every word's first letter (it doesn't respect
  // the hidden-word sample at all -- that's the whole nature of the SMF-
  // style grid, a permanent aid rather than a hide/reveal quiz), and per
  // explicit product direction, reciting via the grid is itself a hint --
  // same "counts as review, never mastery" rule as First Letter mode.
  const [recallDisplayMode, setRecallDisplayMode] = useState<'passage' | 'memoryGrid'>('passage');

  // Memory Grid's own hide setting -- separate from hintMode/hideLevel above
  // (which only apply to Passage mode and are hidden while Grid mode is
  // active, since %-hidden has no meaning for a grid that's always
  // first-letter). 'firstLetter' is the existing permanent-hint look;
  // 'blank' hides words entirely for reciting from pure recall.
  const [gridHideMode, setGridHideMode] = useState<'firstLetter' | 'blank'>('firstLetter');

  const [hiddenWordIndices, setHiddenWordIndices] = useState<Set<number>>(
    () => new Set(reciteWordObjects.map((_, i) => i))
  );

  const regenerateHiddenWords = (level: number) => {
    const indices = reciteWordObjects.map((_, i) => i);
    const hideCount = Math.round((level / 100) * indices.length);
    const shuffled = [...indices].sort(() => Math.random() - 0.5);
    setHiddenWordIndices(new Set(shuffled.slice(0, hideCount)));
  };

  // Per-word grade colors for the Memory Grid view during an active Recall
  // session -- mirrors the paragraph view's own isCountedWord/flatIdx logic
  // exactly (words.split then normalizeToken-filter to find the "counted"
  // ones) so indices line up 1:1 with reciteOutcomes/recitePointer. Ungraded
  // (not reached yet) words are left undefined -- MemoryGrid just shows
  // their plain first letter.
  const gridWordStates = useMemo(() => {
    const map: Record<string, ('correct' | 'close' | 'incorrect' | undefined)[]> = {};
    let flatIdx = 0;
    verses.forEach((v) => {
      // Same split MemoryGrid itself renders from (splitWords with the
      // verse's script) -- must match exactly or indices drift.
      const words = splitWords(v.text, passageScript);
      const key = verseAnnotationKey(v.book, v.chapter, v.verse);
      map[key] = words.map((w) => {
        if (normalizeToken(w, passageScript).length === 0) return undefined;
        const g = flatIdx++;
        if (reciteOrder.posOf[g] >= recitePointer) return undefined;
        const outcome = reciteOutcomes[g];
        return outcome === 'missed' ? 'incorrect' : outcome === 'close' ? 'close' : 'correct';
      });
    });
    return map;
  }, [verses, recitePointer, reciteOutcomes, passageScript, reciteOrder]);

  // Words Hidden / First Letter / Strike Limit prefs persist across sessions
  // (AsyncStorage, same mechanism useScripture.ts uses for its verse cache)
  // -- previously these were plain useState with no persistence at all and
  // silently reset to defaults on every remount.
  useEffect(() => {
    (async () => {
      try {
        const saved: any = await loadPracticePrefs();
        if (typeof saved.hideLevel === 'number') setHideLevel(saved.hideLevel);
        if (typeof saved.firstLetterLevel === 'number') setFirstLetterLevel(saved.firstLetterLevel);
        if (saved.hintMode === 'percent' || saved.hintMode === 'firstLetter') setHintMode(saved.hintMode);
        if (isStrikeLimit(saved.strikeLimit)) setStrikeLimit(saved.strikeLimit);
        if (saved.recallDisplayMode === 'passage' || saved.recallDisplayMode === 'memoryGrid') setRecallDisplayMode(saved.recallDisplayMode);
        if (saved.gridHideMode === 'firstLetter' || saved.gridHideMode === 'blank') setGridHideMode(saved.gridHideMode);
        if (typeof saved.lastToFirst === 'boolean') setLastToFirst(saved.lastToFirst);
        const loadedLevel = saved.hintMode === 'firstLetter' ? saved.firstLetterLevel : saved.hideLevel;
        if (typeof loadedLevel === 'number') regenerateHiddenWords(loadedLevel);
      } catch {
        // Corrupt/missing prefs -- just keep the defaults.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Merges rather than overwrites, and leaves strikeLimit out: that one
  // belongs to Settings now, and writing this screen's copy back would undo
  // a change made there.
  useEffect(() => {
    savePracticePrefs({
      hideLevel,
      firstLetterLevel,
      hintMode,
      recallDisplayMode,
      gridHideMode,
      lastToFirst,
    });
  }, [hideLevel, firstLetterLevel, hintMode, recallDisplayMode, gridHideMode, lastToFirst]);

  // Flipping the order mid-run would leave graded words on both sides of the
  // pointer, so it starts the run over, like switching how words are hidden.
  const switchLastToFirst = (on: boolean) => {
    if (on === lastToFirst) return;
    setLastToFirst(on);
    resetReciteGame();
    regenerateHiddenWords(activeLevel);
  };

  // A chained review session (see advanceReviewSession in useAppState.ts)
  // swaps `verses` in place on the SAME mounted PracticeModals instance --
  // no unmount/remount happens between groups, since the overlay itself
  // stays up the whole session. Without this, the next group would inherit
  // the previous group's recitePointer/outcomes/finished state, which are
  // meaningless (even out of bounds) against a differently-sized passage.
  useEffect(() => {
    resetReciteGame();
    regenerateHiddenWords(activeLevel);
    // The drill components reset their own puzzle state on a new passage.
    // If the incoming group is too short for the jigsaw, don't leave the
    // user parked on a mode that no longer exists.
    if (verses.length < MIN_JIGSAW_VERSES && learnTab === 'jigsaw') setLearnTab('recite');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses]);

  const switchLearnTab = (tab: LearnMode) => {
    if (tab === learnTab) return;
    speechEngineRef.current?.stop();
    setIsListeningSpeak(false);
    setLearnTab(tab);
  };

  // The chapter's sections as far as this passage reaches (empty with none).
  // Put in order and Which section need 3+ of them; Teach-It works on any
  // passage and teaches stretches when there are no sections.
  const sectionList = useMemo(() => drillSections(verses, chapterSectionsDoc), [verses, chapterSectionsDoc]);
  const sectionDrillsReady = hasEnoughSections(sectionList);

  // The same for the section drills: a passage without 3+ sections (or
  // sections edited away) leaves no tab for them.
  useEffect(() => {
    if (!sectionDrillsReady && (learnTab === 'putInOrder' || learnTab === 'whichSection')) setLearnTab('recite');
  }, [sectionDrillsReady, learnTab]);

  // Jigsaw is only meaningful with enough tiles to genuinely scramble.
  const learnModes = useMemo(
    () =>
      [
        { id: 'recite' as const, label: 'Recall', Icon: Mic },
        { id: 'buildUp' as const, label: 'Build up', Icon: Layers },
        ...(verses.length >= MIN_JIGSAW_VERSES ? [{ id: 'jigsaw' as const, label: 'Order', Icon: ListOrdered }] : []),
        { id: 'scramble' as const, label: 'Scramble', Icon: Puzzle },
        { id: 'spotSwap' as const, label: 'Spot', Icon: SearchCheck },
        { id: 'outline' as const, label: formatLabel('firstWords'), Icon: ListTree },
        ...(sectionDrillsReady
          ? [
              { id: 'putInOrder' as const, label: formatLabel('putInOrder'), Icon: ListChecks },
              { id: 'whichSection' as const, label: formatLabel('whichSection'), Icon: Signpost },
            ]
          : []),
        { id: 'teachIt' as const, label: formatLabel('teachIt'), Icon: MessageCircle },
      ] as { id: LearnMode; label: string; Icon: typeof Mic }[],
    [verses.length, sectionDrillsReady]
  );

  // Pick up the thread is offered after a passing Recall when the last verse
  // here has an earlier verse right before it that you've also started --
  // a thread needs somewhere to start. Not mid chained-review: opening the
  // drill closes the overlay, which would drop the rest of the queue.
  const threadTarget = useMemo(() => {
    if (!onPickUpThread || (sessionTotal ?? 0) > 1 || verses.length === 0) return null;
    const last = verses[verses.length - 1];
    const started = (memoryQueue || [])
      .filter((q) => q.status !== 'queued')
      .map((q) => ({ book: q.book, chapter: q.chapter, verse: q.verseNumber, text: q.text, translationId: q.translationId || 'ESV' }));
    // A verse that doesn't say its translation matches on reference alone,
    // the same rule review logging uses.
    const item = started.find(
      (q) => q.book === last.book && q.chapter === last.chapter && q.verse === last.verse && (!last.translationId || q.translationId === last.translationId)
    );
    if (!item) return null;
    const run = threadRunEndingAt(started, item);
    return run.length >= MIN_THREAD_VERSES ? { ...last, translationId: item.translationId } : null;
  }, [onPickUpThread, sessionTotal, verses, memoryQueue]);

  // Verses here that are on a review schedule but not due yet. Logging them
  // changes nothing (see handleReviewCompleted), so the result screen says
  // so instead of offering "Count as a review" for a review that won't count.
  const notDueVerses = useMemo(
    () =>
      verses
        .map((v) => ({
          v,
          item: (memoryQueue || []).find(
            (q) =>
              q.book === v.book &&
              q.chapter === v.chapter &&
              q.verseNumber === v.verse &&
              (!v.translationId || (q.translationId || 'ESV') === v.translationId)
          ),
        }))
        .filter(({ item }) => item?.status === 'reviewing' && !isReviewDue(item.nextReviewDueDate)),
    [verses, memoryQueue]
  );

  const notDueLine = (() => {
    if (notDueVerses.length === 0) return '';
    const soonest = notDueVerses.map(({ item }) => item!.nextReviewDueDate || '').filter(Boolean).sort()[0];
    const day = soonest ? formatDate(soonest, 'relative') : '';
    const when = day === 'Tomorrow' ? 'tomorrow' : day;
    if (notDueVerses.length === verses.length) {
      return `Not due until ${when}, so this was practice. Your schedule stays as it is.`;
    }
    const list = notDueVerses.map(({ v }) => `v${v.verse}`).join(', ');
    return `${list} ${notDueVerses.length === 1 ? "isn't" : "aren't"} due until ${when}, so ${notDueVerses.length === 1 ? 'it stays' : 'they stay'} as ${notDueVerses.length === 1 ? 'it is' : 'they are'}.`;
  })();

  const allNotDue = verses.length > 0 && notDueVerses.length === verses.length;

  // First words credits a verse that is on a review schedule and due (the
  // engine would refuse an early one anyway; checking here keeps it from
  // writing anything for it). A verse still being learned needs a perfect,
  // graded run an hour apart, which a partly-shown verse can't give, so it is
  // practice only there; Recall and Guided learning are how it gets learned.
  const isDueForReview = (v: { book: string; chapter: number; verse: number; translationId?: string }) =>
    !reviewsPaused &&
    (memoryQueue || []).some(
      (q) =>
        q.status === 'reviewing' &&
        isReviewDue(q.nextReviewDueDate) &&
        q.book === v.book &&
        q.chapter === v.chapter &&
        q.verseNumber === v.verse &&
        (!v.translationId || (q.translationId || 'ESV') === v.translationId)
    );

  // ==========================================
  // RECITE — live speech channel. Feeds the exact same recitePointer/
  // reciteOutcomes the typed channel does, so either input method advances
  // the same passage together.
  // ==========================================
  // In recite order, so token N lines up with recite position N.
  const speakExpectedTokens = useMemo(
    () => reciteOrder.verseOrder.flatMap((vi) => tokenizeWords(verses[vi].text)),
    [verses, reciteOrder]
  );

  const fullPassageText = useMemo(() => reciteOrder.verseOrder.map((vi) => verses[vi].text).join(' '), [verses, reciteOrder]);

  const startListening = () => {
    const engine = speechEngineRef.current;
    if (!engine) return;
    usedSpeechRef.current = true;
    setSpeakTranscript('');
    setIsListeningSpeak(true);
    // Engines that support contextual vocabulary hints get the exact passage
    // text before listening starts (no-op on the web engine).
    engine.prime?.(fullPassageText);
    deleteSpeechRecording(speechAudioUriRef.current);
    speechAudioUriRef.current = null;
    setSpeechAudioUri(null);
    listenStartPosRef.current = recitePointer;
    listenHadResetRef.current = false;
    expectAudioRef.current = passageScript === 'latin' && willSaveSpeechAudio();
    engine.start({
      onTranscript: (fullTranscript, finalizedTokenCount) => {
        setSpeakTranscript(fullTranscript);
        finalizedTokenCountRef.current = finalizedTokenCount;
      },
      onEnd: () => setIsListeningSpeak(false),
      onError: (message) => {
        setIsListeningSpeak(false);
        triggerLocalToast(`Speech engine error: ${message}`);
      },
      onAudio: (uri) => {
        speechAudioUriRef.current = uri;
        setSpeechAudioUri(uri);
      },
    });
    triggerLocalToast('Microphone active! Recite the passage...');
  };

  const stopListening = () => {
    speechEngineRef.current?.stop();
    setIsListeningSpeak(false);
  };

  // Speech drives the SAME pointer typing does: on every transcript update,
  // reconcileSpeechWindow (recitation.ts) realigns a bounded window of
  // upcoming expected words against a bounded window of recently-spoken
  // words and returns a patch to merge into reciteOutcomes/recitePointer.
  // Unlike the old matcher, this is NOT forward-only -- a 'speech'-sourced
  // entry can be revised as more of the transcript arrives (the actual fix
  // for a bad resync locking in permanently instead of self-correcting),
  // but a 'protected' entry (typed, revealed, manually overridden) is never
  // touched, and the pointer can never fall below one.
  useEffect(() => {
    if (learnTab !== 'recite' || isFinishedRecite) return;

    // The reconciler works in recite positions; outcomes are keyed by word.
    const protectedIndices = new Set<number>();
    for (const key of Object.keys(reciteSource)) {
      if (reciteSource[Number(key)] === 'protected') protectedIndices.add(reciteOrder.posOf[Number(key)]);
    }

    const patch = reconcileSpeechWindow(
      speakExpectedTokens,
      tokenizeWords(speakTranscript),
      alignAnchorRef.current,
      spokenTokenFloorRef.current,
      protectedIndices,
      recitePointer
    );
    alignAnchorRef.current = patch.nextAlignAnchor;
    if (Object.keys(patch.outcomes).length === 0 && patch.pointer === recitePointer) return;

    const wordOutcomes = positionsToWords(reciteOrder, patch.outcomes);
    setReciteOutcomes((prev) => ({ ...prev, ...wordOutcomes }));
    setReciteSource((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(wordOutcomes)) next[Number(key)] = 'speech';
      return next;
    });
    if (patch.pointer !== recitePointer) {
      if (wordVerse(patch.pointer) !== wordVerse(recitePointer)) {
        setVerseStrikes(0);
      }
      setRecitePointer(patch.pointer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakTranscript, learnTab, isFinishedRecite]);

  // Fires once the shared pointer reaches the end of the passage, by
  // whichever channel got it there -- typing simply runs out of words the
  // same way it always did; speech now can finish a passage outright too,
  // instead of needing a separate "Finish & Grade" button.
  useEffect(() => {
    if (learnTab !== 'recite' || isFinishedRecite || reciteWordObjects.length === 0) return;
    if (recitePointer < reciteWordObjects.length) return;
    const all = reciteWordObjects.map((_, i) => reciteOutcomes[i] || 'missed');
    setFinalOutcomes(all);
    setIsFinishedRecite(true);
    stopListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recitePointer, learnTab, reciteWordObjects.length]);

  // The second pass (SPEECH_SECOND_PASS_PLAN.md stage 5). Runs once the run is
  // finished and the last listening run's audio has arrived (just after
  // Stop). Only runs Apple left a red word in are sent: the combined grade can
  // only turn red words green. Any failure keeps Apple's grade silently.
  useEffect(() => {
    if (!isFinishedRecite || !expectAudioRef.current || listenHadResetRef.current) return;
    const start = listenStartPosRef.current;
    const order = reciteOrder.order.slice(start);
    const live = order.map((wi) => reciteOutcomes[wi] ?? null);
    const protectedPos = new Set(order.flatMap((wi, p) => (reciteSource[wi] === 'protected' ? [p] : [])));
    if (!live.some((o, p) => (o ?? 'missed') === 'missed' && !protectedPos.has(p))) return;

    const uri = speechAudioUri;
    if (uri && checkedAudioRef.current === uri) return;
    const gen = secondPassGenRef.current;
    setIsDoubleChecking(true);
    if (!uri) {
      // The audio lands just after Stop; if it never does, keep Apple's grade.
      const t = setTimeout(() => {
        if (secondPassGenRef.current === gen && !speechAudioUriRef.current) setIsDoubleChecking(false);
      }, 2000);
      return () => clearTimeout(t);
    }
    checkedAudioRef.current = uri;

    const isTester = UNRELEASED_TRANSLATION_TESTERS.includes(auth.currentUser?.uid ?? '');
    runSecondPass(uri, speakExpectedTokens.slice(start), live, protectedPos).then((result) => {
      if (secondPassGenRef.current !== gen) return;
      setIsDoubleChecking(false);
      if (!result) {
        if (isTester) triggerLocalToast('Double-check unavailable; kept the live grade');
        return;
      }
      if (isTester) {
        triggerLocalToast(`Double-check: ${result.rescued.length} word${result.rescued.length === 1 ? '' : 's'} fixed (${result.pieces} piece${result.pieces === 1 ? '' : 's'}, ${(result.ms / 1000).toFixed(1)} s)`);
      }
      if (result.rescued.length === 0) return;
      const fixes = new Map(result.rescued.map((p, k) => [order[p], result.grades[k]]));
      // Only words still red change: a word tapped green meanwhile stays as tapped.
      setReciteOutcomes((prev) => {
        const next = { ...prev };
        for (const [wi, g] of fixes) if ((next[wi] ?? 'missed') === 'missed') next[wi] = g;
        return next;
      });
      setFinalOutcomes((prev) => (prev ? prev.map((o, wi) => (o === 'missed' && fixes.has(wi) ? fixes.get(wi)! : o)) : prev));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinishedRecite, speechAudioUri]);

  // ==========================================
  // SUPPLEMENTARY DRILLS (build up / order / scramble / spot-the-swap)
  // Ungraded -- none of them ever call onUpdateStatus. Each lives in its own
  // component under ../drills, owns its puzzle state, and re-rolls it when
  // `verses` changes. Guided learning renders the same components.
  // ==========================================

  // Build up can't count toward review, so its end screen hands off to a
  // real blind Recall run. A ref keeps the callback stable, so the memoized
  // drill doesn't re-render on every Recall tick while it sits hidden.
  const handoffToRecall = () => {
    setHintMode('percent');
    setHideLevel(100);
    resetReciteGame();
    regenerateHiddenWords(100);
    setLearnTab('recite');
  };

  const handoffToRecallRef = useRef(handoffToRecall);

  handoffToRecallRef.current = handoffToRecall;

  const onBuildUpTryBlind = useCallback(() => handoffToRecallRef.current(), []);

  // A Recall left part-way (the X, the Home button) still earns the verses it
  // got all the way through, like a Mixed review round does as it ends. Only
  // due reviews count; the verse the run stopped inside, and any after it,
  // are left for another go. Null when there is nothing to credit.
  const partialCredit = () => {
    if (learnTab !== 'recite' || isFinishedRecite || recitePointer === 0) return null;
    const lastPos: number[] = verses.map(() => -1);
    reciteWordObjects.forEach((w, wi) => {
      lastPos[w.verseIdx] = Math.max(lastPos[w.verseIdx], reciteOrder.posOf[wi]);
    });
    const done = verses.filter((v, i) => lastPos[i] >= 0 && lastPos[i] < recitePointer && isDueForReview(v));
    if (done.length === 0) return null;
    const gradeFor = (v: VerseState): GradeInput | undefined => {
      const i = verses.findIndex((x) => x.book === v.book && x.chapter === v.chapter && x.verse === v.verse);
      if (i < 0) return undefined;
      const own = reciteWordObjects.flatMap((w, wi) => (w.verseIdx === i ? [reciteOutcomes[wi] || ('missed' as WordOutcome)] : []));
      return { kind: 'recall', accuracy: wordAccuracy(own), hinted: hintedVerses.has(i) };
    };
    return { verses: done, gradeFor, usedSpeech: usedSpeechRef.current };
  };

  return {
    partialCredit,
    learnTab,
    reciteWordObjects,
    recitePointer,
    reciteOrder,
    lastToFirst,
    switchLastToFirst,
    reciteOutcomes,
    verseStrikes,
    strikeLimit,
    showStrikeResetAlert,
    typedInput,
    flashError,
    isFinishedRecite,
    finalOutcomes,
    hintedVerses,
    isListeningSpeak,
    isDoubleChecking,
    localToast,
    speechAvailable,
    usedSpeechRef,
    handleReciteTypeChar,
    overrideWordAsCorrect,
    handleReciteHint,
    resetReciteGame,
    hideLevel,
    setHideLevel,
    hintMode,
    activeLevel,
    setActiveLevel,
    switchHintMode,
    recallDisplayMode,
    setRecallDisplayMode,
    gridHideMode,
    setGridHideMode,
    hiddenWordIndices,
    regenerateHiddenWords,
    gridWordStates,
    switchLearnTab,
    learnModes,
    sectionList,
    threadTarget,
    notDueLine,
    allNotDue,
    isDueForReview,
    startListening,
    stopListening,
    onBuildUpTryBlind,
  };
}

export type RecallState = ReturnType<typeof useRecall>;
