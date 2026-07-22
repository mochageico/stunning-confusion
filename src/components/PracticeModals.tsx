import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Check, ChevronUp, Eye, EyeOff, Info, Mic, MicOff, Pause, Play, RefreshCw, Repeat, Shuffle, Sliders, Sparkles, X } from 'lucide-react-native';

import { VerseState, QueueItem, Recording } from '../types';
import { resolveChapterAudio, isReviewDue } from '../state/useAppState';
import {
  classifyFirstLetterAttempt,
  getSpeechRecognizer,
  normalizeToken,
  reconcileSpeechWindow,
  summarizeOutcomes,
  tokenizeWords,
  REVIEW_PASS_ACCURACY,
  SpeechRecognizer,
  WordOutcome,
} from '../lib/recitation';
import { BounceView, ChipRow, DiscreteSlider, FadeInView, SpinView, WaveBars } from './ui';
import { Dropdown } from './Dropdown';
import MemoryGrid, { verseAnnotationKey } from './MemoryGrid';

interface PracticeModalsProps {
  type: 'listen' | 'learn';
  verses: VerseState[];
  allVerses?: VerseState[];
  // Full stop -- the header X button. Always closes the overlay entirely,
  // abandoning any queued chained-session groups (see onAdvance).
  onClose: () => void;
  // Fires after a group is graded/logged (the various "Log ..." buttons
  // below), instead of onClose. In a chained review session this advances
  // to the next queued group in place; otherwise it's just a normal close.
  // Falls back to onClose when absent, so callers that don't care about
  // sessions (e.g. a bare single-group practice launch) still work.
  onAdvance?: () => void;
  onUpdateStatus: (
    versesToUpdate: VerseState[],
    newStatus: 'memorized' | 'learning',
    customDrillType?: 'speak' | 'type' | 'reveal',
    opts?: { perfect?: boolean }
  ) => void;
  // Chained-review-session progress ("2 of 5"), shown in the header when
  // sessionTotal > 1. Both default to 0/undefined for a non-session launch.
  sessionPosition?: number;
  sessionTotal?: number;
  memoryQueue?: QueueItem[];
  primingLookahead?: number;
  setPrimingLookahead?: (val: number) => void;
  // Listen mode only — real audio playback needs to resolve which of the
  // user's saved recordings represents each verse's chapter, exactly the
  // way ChapterLandingScreen's audio card already does.
  userRecordings?: Recording[];
  selectedChapterAudios?: Record<string, Recording | null>;
  // App-wide "now playing saved recording" state (Profile/RecordingDetail/
  // etc's own mini-bar), threaded through so Listen mode and that system
  // can enforce "one audio source at a time" -- starting one cancels
  // (pauses) the other, rather than letting two playbacks run at once.
  playingRecordingId?: string | null;
  setPlayingRecordingId?: (id: string | null) => void;
  // Memory Grid highlights -- user-marked "meaningful anchor" verses, shared
  // across Chapter page / Listen / Recall so a highlight set anywhere shows
  // up everywhere (see verseAnnotationKey in MemoryGrid.tsx).
  highlightedVerses?: Set<string>;
  onToggleVerseHighlight?: (key: string) => void;
  verseDoodles?: Record<string, string[]>;
  onSaveVerseDoodle?: (key: string, strokes: string[]) => void;
  memoryGridColumns?: 2 | 4;
}

// Guard wrapper: the early "nothing to practice" return must happen OUTSIDE
// the component that declares hooks. Returning before the useState/useEffect
// calls below meant that if `verses` ever became empty while the modal was
// mounted, React would see fewer hooks than the previous render and crash
// ("Rendered fewer hooks than expected").
export default function PracticeModals(props: PracticeModalsProps) {
  if (!props.verses || props.verses.length === 0) return null;
  return <PracticeModalsInner {...props} />;
}

function PracticeModalsInner({
  type,
  verses,
  allVerses,
  onClose,
  onAdvance,
  onUpdateStatus,
  sessionPosition,
  sessionTotal,
  memoryQueue,
  primingLookahead = 30,
  setPrimingLookahead,
  userRecordings = [],
  selectedChapterAudios = {},
  playingRecordingId = null,
  highlightedVerses,
  onToggleVerseHighlight,
  verseDoodles,
  onSaveVerseDoodle,
  memoryGridColumns = 4,
  setPlayingRecordingId,
}: PracticeModalsProps) {
  const handleGroupComplete = onAdvance ?? onClose;
  // ==========================================
  // PLAYLIST / PLAY-SOURCE STATE (Listen mode only)
  // ==========================================
  const [playSource, setPlaySource] = useState<'selection' | 'memorization' | 'reviewing' | 'priming' | 'all'>('selection');
  const [activePlayVerses, setActivePlayVerses] = useState<VerseState[]>(verses);
  // "Verse by Verse" (existing card list) vs "Memory Grid" -- purely a
  // display choice, doesn't affect playback state at all. Tapping a grid
  // box calls the exact same handleVerseClick used by the card list.
  const [listenViewMode, setListenViewMode] = useState<'verses' | 'memoryGrid'>('verses');

  // Segment selection states — indices into activePlayVerses (verse
  // granularity; word-level selection was removed, see Listen mode below).
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);

  // Sync / load different playlists based on selected source
  useEffect(() => {
    if (playSource === 'selection') {
      setActivePlayVerses(verses);
    } else {
      let dbLearning: VerseState[] = [];
      let dbReviewing: VerseState[] = [];
      let dbPriming: VerseState[] = [];

      if (memoryQueue && memoryQueue.length > 0) {
        const mapQueueItemToVerse = (item: QueueItem): VerseState => ({
          book: item.book,
          chapter: item.chapter,
          verse: item.verseNumber,
          text: item.text,
          status: item.status === 'retained' ? 'memorized' : 'learning',
        });

        dbLearning = memoryQueue.filter((item) => item.status === 'learning').map(mapQueueItemToVerse);
        dbReviewing = memoryQueue
          .filter((item) => item.status === 'reviewing' && isReviewDue(item.nextReviewDueDate))
          .map(mapQueueItemToVerse);
        dbPriming = memoryQueue.filter((item) => item.status === 'queued').slice(0, primingLookahead).map(mapQueueItemToVerse);
      } else {
        // Fallback
        dbLearning = (allVerses || []).filter((v) => v.book === 'Genesis' && v.chapter === 1 && (v.verse === 3 || v.verse === 4 || v.verse === 5 || v.verse === 6));
        dbReviewing = (allVerses || []).filter((v) => (v.book === 'Romans' && v.chapter === 8 && (v.verse === 1 || v.verse === 2)) || (v.book === 'John' && v.chapter === 15));
        dbPriming = (allVerses || []).filter((v) => (v.book === 'Genesis' && v.chapter === 1 && v.verse >= 7) || (v.book === 'Genesis' && v.chapter === 2));
      }

      if (playSource === 'memorization') {
        setActivePlayVerses(dbLearning.length > 0 ? dbLearning : verses);
      } else if (playSource === 'reviewing') {
        setActivePlayVerses(dbReviewing.length > 0 ? dbReviewing : verses);
      } else if (playSource === 'priming') {
        setActivePlayVerses(dbPriming.length > 0 ? dbPriming : verses);
      } else if (playSource === 'all') {
        // "Today's Verses" -- everything actually relevant today (still
        // being learned, due for review, or coming up in the priming
        // lookahead), NOT the entire cached Bible text. A QueueItem only
        // ever has one status at a time, so these three lists are already
        // mutually exclusive -- no dedup needed.
        const dbToday = [...dbLearning, ...dbReviewing, ...dbPriming];
        setActivePlayVerses(dbToday.length > 0 ? dbToday : verses);
      }
    }
    // Reset playback position back to the first verse
    setCurrentVerseIndex(0);
    setSelectionStart(null);
    setSelectionEnd(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSource, verses, allVerses, memoryQueue, primingLookahead]);

  // Header reference text
  const referenceText = useMemo(() => {
    const targetVerses = type === 'learn' ? verses : activePlayVerses;

    if (targetVerses.length === 0) return 'No verses selected';
    if (targetVerses.length === 1) {
      return `${targetVerses[0].book} ${targetVerses[0].chapter}:${targetVerses[0].verse}`;
    }
    const first = targetVerses[0];
    const last = targetVerses[targetVerses.length - 1];

    // Check if they are in the same chapter
    if (first.book === last.book && first.chapter === last.chapter) {
      return `${first.book} ${first.chapter}:${first.verse}-${last.verse}`;
    }
    return `${first.book} ${first.chapter}:${first.verse} - ${last.book} ${last.chapter}:${last.verse}`;
  }, [type, verses, activePlayVerses]);

  // ==========================================
  // LISTEN MODE — real verse-by-verse audio playback. No word-level
  // highlighting: word timing was always simulated (a fixed WPM guess), and
  // the only real timing data this app has is per-VERSE (verseTimestamps),
  // so that's the granularity this mode actually plays and highlights at.
  // ==========================================
  const [listenPlaying, setListenPlaying] = useState(false);
  const [listenSpeed, setListenSpeed] = useState(1.0);
  const [currentVerseIndex, setCurrentVerseIndex] = useState(0);
  const [repeatMode, setRepeatMode] = useState<'off' | 'playlist'>('playlist'); // default to loop playlist
  // Minimizing (Listen mode's X button) keeps this whole component mounted
  // -- and with it, the real listenPlayer instance and the auto-advance
  // effect below -- so audio genuinely keeps playing/looping while the user
  // navigates the rest of the app, instead of onClose tearing the player
  // down. Only a real full-stop (the mini-bar's own X) calls the real
  // onClose. True OS-level background/lock-screen playback is a separate,
  // later piece of work -- this only keeps it going while the app itself is
  // foregrounded.
  const [listenMinimized, setListenMinimized] = useState(false);
  const insets = useSafeAreaInsets();

  // For every verse in the active playlist, resolve which real recording (if
  // any) covers it and that recording's tagged {startSec, endSec} for this
  // specific verse. A verse with no matching recording, or a recording with
  // no verseTimestamps entry for it, simply has no segment -- it's still
  // shown in the reading pane (so the list doesn't mysteriously skip verses)
  // but playback skips over it, since there's nothing to play.
  const playableSegments = useMemo(() => {
    return activePlayVerses.map((verseObj) => {
      const recording = resolveChapterAudio(userRecordings, selectedChapterAudios, verseObj.book, verseObj.chapter);
      const vt = recording?.audioUrl ? recording.verseTimestamps?.find((t) => t.verse === verseObj.verse) : undefined;
      return vt ? { verseObj, recording: recording!, startSec: vt.startSec, endSec: vt.endSec } : { verseObj, recording: null, startSec: null, endSec: null };
    });
  }, [activePlayVerses, userRecordings, selectedChapterAudios]);

  // Indices (into activePlayVerses/playableSegments) that actually have
  // audio -- the only ones playback ever lands on.
  const playableIndices = useMemo(
    () => playableSegments.map((s, i) => (s.recording ? i : -1)).filter((i) => i >= 0),
    [playableSegments]
  );
  const hasAnyAudio = playableIndices.length > 0;
  const currentSegment = playableSegments[currentVerseIndex] ?? null;

  // Real audio player for whichever recording covers the current verse.
  // Swapping to a different chapter's recording (or none) just means this
  // source string changes -- expo-audio reloads automatically, same pattern
  // as recordingPlayer/importPlayer elsewhere in this app. Deliberately its
  // own player rather than reusing the app-wide "now playing" system: Listen
  // mode auto-advances across verses (and can switch recordings on its own),
  // which shouldn't hijack whatever the floating mini-bar is doing elsewhere.
  const listenPlayer = useAudioPlayer(currentSegment?.recording?.audioUrl ?? undefined);
  const listenPlayerStatus = useAudioPlayerStatus(listenPlayer);

  useEffect(() => {
    return () => {
      try {
        listenPlayer.pause();
      } catch {
        // already released
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (listenPlaying) {
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    }
  }, [listenPlaying]);

  // One audio source at a time -- Listen mode and the app-wide saved-
  // recording "now playing" system (Profile/RecordingDetail/etc's mini-bar)
  // are otherwise fully independent, so without this a user could end up
  // with two playbacks running simultaneously. Starting either one cancels
  // (pauses) the other, in both directions:
  useEffect(() => {
    // Listen just started playing -- stop whatever saved recording was
    // already playing elsewhere. A no-op if nothing was playing.
    if (listenPlaying) setPlayingRecordingId?.(null);
  }, [listenPlaying, setPlayingRecordingId]);

  useEffect(() => {
    // A saved recording just started playing elsewhere while Listen mode
    // was actively playing -- pause Listen's playback (not a full close;
    // the overlay/mini-bar stays exactly as it was, just paused, so it can
    // be resumed manually).
    if (playingRecordingId && listenPlaying) {
      try {
        listenPlayer.pause();
      } catch {
        // already released
      }
      setListenPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingRecordingId]);

  // Finds the next playable index after `from`, restricted to the active
  // selection range when one is set. Returns null if there's nowhere to go
  // (caller decides whether that means "loop back to the start" or "stop").
  const findNextPlayableIndex = (from: number): number | null => {
    const inRange = (i: number) => {
      if (!(playSource === 'selection' && selectionStart !== null)) return true;
      const end = selectionEnd ?? selectionStart;
      return i >= selectionStart && i <= end;
    };
    const candidates = playableIndices.filter(inRange);
    if (candidates.length === 0) return null;
    const next = candidates.find((i) => i > from);
    return next !== undefined ? next : null;
  };

  const firstPlayableIndexInRange = (): number => {
    const inRange = (i: number) => {
      if (!(playSource === 'selection' && selectionStart !== null)) return true;
      const end = selectionEnd ?? selectionStart;
      return i >= selectionStart && i <= end;
    };
    return playableIndices.filter(inRange)[0] ?? 0;
  };

  // Guards against a race that showed up specifically on LOOPING BACK to an
  // earlier verse (e.g. a 1-3 selection finishing verse 3 and returning to
  // verse 1): looping back seeks to an EARLIER position within the same
  // still-loaded recording, but the player status can keep reporting the
  // old, later currentTime (verse 3's, well past verse 1's endSec) for a
  // beat before the seek actually takes effect. Without this guard, the
  // end-of-segment check below saw that stale/still-later currentTime, read
  // it as "verse 1 already finished" instantly, and skipped straight to
  // verse 2 -- verse 1 would flash for a fraction of a second and never
  // really play. Forward advances never hit this, since a stale slightly-
  // behind currentTime is harmless against a LATER segment's endSec -- only
  // seeking backward exposes it.
  const seekedToCurrentSegmentRef = useRef(false);
  useEffect(() => {
    seekedToCurrentSegmentRef.current = false;
  }, [currentVerseIndex]);

  // Once the (possibly just-swapped) player has finished loading this verse's
  // recording, cue up its start position. Fires on every verse change --
  // when consecutive verses share the same recording the player is already
  // loaded, so this seeks immediately; when the recording changes, it waits
  // for isLoaded to flip true after the reload.
  //
  // IMPORTANT: skip the seek entirely when we're already essentially at this
  // segment's start. Verse boundaries within one recording are contiguous by
  // construction (buildVerseTimestamps sets a verse's endSec to the exact
  // timestamp the next verse's startSec uses), so the ordinary case of
  // advancing to the next verse in a continuously-playing recording needs no
  // seek at all -- the audio is already flowing straight into it. Seeking
  // anyway (even to a position we're already at) produced an audible
  // stutter: seekTo is async, so by the time it actually lands, real
  // playback has usually already continued a beat past that exact instant,
  // and the seek yanks it back, replaying the start of the verse that had
  // already begun. A genuine jump (switching recordings, looping back to the
  // start, restarting, manually selecting a verse) still seeks normally.
  useEffect(() => {
    if (type !== 'listen' || !currentSegment?.recording || !listenPlayerStatus.isLoaded) return;
    const alreadyThere = Math.abs(listenPlayerStatus.currentTime - currentSegment.startSec) < 0.35;
    if (alreadyThere) {
      seekedToCurrentSegmentRef.current = true;
      return;
    }
    listenPlayer.seekTo(currentSegment.startSec).then(() => {
      seekedToCurrentSegmentRef.current = true;
      if (listenPlaying) listenPlayer.play();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, currentVerseIndex, currentSegment?.recording?.id, listenPlayerStatus.isLoaded]);

  // Keep the real playback rate in sync with the speed control, including
  // right after a recording (re)loads.
  useEffect(() => {
    if (listenPlayerStatus.isLoaded) listenPlayer.setPlaybackRate(listenSpeed, 'high');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenSpeed, listenPlayerStatus.isLoaded, currentSegment?.recording?.id]);

  // Detects reaching the end of the current verse's segment and advances --
  // to the next verse, possibly switching recordings, or loops/stops at the
  // end of the (possibly selection-restricted) range.
  useEffect(() => {
    if (type !== 'listen' || !listenPlaying || !currentSegment?.recording) return;
    // Don't trust currentTime until we've confirmed the seek to THIS verse's
    // start actually landed (see seekedToCurrentSegmentRef above) -- and even
    // then, ignore a reading that's still suspiciously behind this segment's
    // own start, in case the status object hasn't caught up to the seek yet.
    if (!seekedToCurrentSegmentRef.current) return;
    if (listenPlayerStatus.currentTime < currentSegment.startSec - 0.5) return;
    if (listenPlayerStatus.currentTime < currentSegment.endSec - 0.05 && !listenPlayerStatus.didJustFinish) return;
    const next = findNextPlayableIndex(currentVerseIndex);
    if (next !== null) {
      setCurrentVerseIndex(next);
    } else if (repeatMode === 'playlist') {
      setCurrentVerseIndex(firstPlayableIndexInRange());
    } else {
      setListenPlaying(false);
      listenPlayer.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenPlayerStatus.currentTime, listenPlayerStatus.didJustFinish, listenPlaying, type]);

  const restartListen = () => {
    setListenPlaying(false);
    setCurrentVerseIndex(firstPlayableIndexInRange());
    setTimeout(() => setListenPlaying(true), 150);
  };

  const toggleListenPlaying = () => {
    if (listenPlaying) {
      listenPlayer.pause();
      setListenPlaying(false);
    } else {
      if (!currentSegment?.recording && hasAnyAudio) {
        // Sitting on a verse with no audio (e.g. selection starts on a gap)
        // -- jump to the nearest playable one instead of doing nothing.
        setCurrentVerseIndex(firstPlayableIndexInRange());
      }
      setListenPlaying(true);
      if (listenPlayerStatus.isLoaded) listenPlayer.play();
    }
  };

  // ==========================================
  // Helper to mask alphabetical characters but keep punctuation
  // ==========================================
  const maskLetters = (word: string) => {
    return word.replace(/[a-zA-Z0-9]/g, '•');
  };

  // First Letter mode's mask -- keeps the word's real first letter/digit
  // visible (and any leading punctuation, e.g. an opening quote) and masks
  // the rest, instead of blanking the whole word.
  const maskExceptFirstLetter = (word: string) => {
    const firstAlnumIdx = word.search(/[a-zA-Z0-9]/);
    if (firstAlnumIdx === -1) return maskLetters(word);
    const before = word.slice(0, firstAlnumIdx);
    const first = word[firstAlnumIdx];
    const rest = word.slice(firstAlnumIdx + 1).replace(/[a-zA-Z0-9]/g, '•');
    return `${before}${first}${rest}`;
  };

  // ==========================================
  // LEARN MODE — unified Recall (typed + spoken, either channel advances
  // the same word) and Reveal tabs. Replaces the old separate Type/Speak/
  // Reveal entry points: every group-practice button in the app now opens
  // 'learn' and the tab bar below picks the drill. Internal value 'recite'
  // is kept for the graded tab (renamed to "Recall" in the UI only) to
  // avoid touching every reference below.
  // ==========================================
  const [learnTab, setLearnTab] = useState<'recite' | 'reveal'>('recite');

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
      v.text.split(/\s+/).forEach((w) => {
        if (normalizeToken(w).length > 0) list.push({ verseIdx, word: w });
      });
    });
    return list;
  }, [verses]);

  // How many words have been confirmed so far (either channel), and each
  // confirmed word's grade. Both persist across a tab switch away and back
  // within the same modal instance since the recording is the same passage.
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
  const [strikeLimit, setStrikeLimit] = useState<number | 'unlimited'>(5);
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

  // Make sure the engine never keeps listening past the modal's lifetime.
  useEffect(() => {
    return () => speechEngineRef.current?.stop();
  }, []);

  const triggerLocalToast = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => {
      setLocalToast((prev) => (prev === msg ? null : prev));
    }, 2500);
  };

  // Records one word's grade and advances the shared pointer -- used by
  // both the typed-letter path and the hint/reveal path. Resets the
  // per-verse strike count when the advance crosses into a new verse.
  // Tagged 'protected' -- a deliberate typed answer or an explicitly
  // revealed hint must never be silently reverted by a later speech
  // reconciliation pass.
  const commitReciteOutcome = (idx: number, outcome: WordOutcome, nextPointer: number) => {
    setReciteOutcomes((prev) => ({ ...prev, [idx]: outcome }));
    setReciteSource((prev) => ({ ...prev, [idx]: 'protected' }));
    if (reciteWordObjects[nextPointer] && reciteWordObjects[nextPointer].verseIdx !== reciteWordObjects[idx].verseIdx) {
      setVerseStrikes(0);
    }
    setRecitePointer(nextPointer);
  };

  // NOTE: onChangeText passes the string directly (unlike web's onChange event).
  const handleReciteTypeChar = (val: string) => {
    if (isFinishedRecite || recitePointer >= reciteWordObjects.length || showStrikeResetAlert) return;

    if (val.length === 0) {
      setTypedInput('');
      return;
    }

    const lastChar = val.charAt(val.length - 1);
    const current = reciteWordObjects[recitePointer];
    // Near-miss forgiveness: 'close' means a QWERTY key adjacent to the
    // right letter — accepted and advanced just like 'exact', but graded
    // separately so a perfect-run check can still see the difference
    // between clean recall and fat-fingered recall (both count as correct).
    const verdict = classifyFirstLetterAttempt(lastChar, current.word);

    if (verdict !== 'wrong') {
      const alreadyMissed = reciteOutcomes[recitePointer] === 'missed';
      const outcome: WordOutcome = alreadyMissed ? 'missed' : verdict === 'close' ? 'close' : 'perfect';
      commitReciteOutcome(recitePointer, outcome, recitePointer + 1);
      setTypedInput('');
    } else {
      const nextStrikes = verseStrikes + 1;
      setVerseStrikes(nextStrikes);
      setFlashError(true);
      setTypedInput(''); // Clear on error so user doesn't have to backspace
      // One wrong attempt permanently marks this word missed for the session
      // (getting it right on the next try lets you continue, but the
      // accuracy score keeps the miss).
      setReciteOutcomes((prev) => ({ ...prev, [recitePointer]: 'missed' }));

      if (strikeLimit !== 'unlimited' && nextStrikes >= strikeLimit) {
        setShowStrikeResetAlert(true);
        const verseIdx = current.verseIdx;
        const verseStartPointer = reciteWordObjects.findIndex((w) => w.verseIdx === verseIdx);
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
  const overrideWordAsCorrect = (idx: number) => {
    setReciteOutcomes((prev) => ({ ...prev, [idx]: 'perfect' }));
    setReciteSource((prev) => ({ ...prev, [idx]: 'protected' }));
    setFinalOutcomes((prev) => (prev ? prev.map((o, i) => (i === idx ? 'perfect' : o)) : prev));
  };

  // Revealing a word is a miss for grading purposes -- the user didn't
  // recall it.
  const handleReciteHint = () => {
    if (recitePointer >= reciteWordObjects.length) return;
    commitReciteOutcome(recitePointer, 'missed', recitePointer + 1);
  };

  const resetReciteGame = () => {
    setRecitePointer(0);
    setReciteOutcomes({});
    setReciteSource({});
    setVerseStrikes(0);
    setTypedInput('');
    setShowStrikeResetAlert(false);
    setIsFinishedRecite(false);
    setFinalOutcomes(null);
    speechEngineRef.current?.stop();
    setIsListeningSpeak(false);
    setSpeakTranscript('');
    usedSpeechRef.current = false;
    alignAnchorRef.current = 0;
    spokenTokenFloorRef.current = 0;
    finalizedTokenCountRef.current = 0;
  };

  const resetRevealPeeks = () => {
    setSinglePeekedWords({});
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
      // Same split + filter MemoryGrid itself renders from (text.split(/\s+/)
      // then drop empty strings) -- must match exactly or indices drift.
      const words = v.text.split(/\s+/).filter((w) => w.length > 0);
      const key = verseAnnotationKey(v.book, v.chapter, v.verse);
      map[key] = words.map((w) => {
        if (normalizeToken(w).length === 0) return undefined;
        const g = flatIdx++;
        if (g >= recitePointer) return undefined;
        const outcome = reciteOutcomes[g];
        return outcome === 'missed' ? 'incorrect' : outcome === 'close' ? 'close' : 'correct';
      });
    });
    return map;
  }, [verses, recitePointer, reciteOutcomes]);

  // Words Hidden / First Letter / Strike Limit prefs persist across sessions
  // (AsyncStorage, same mechanism useScripture.ts uses for its verse cache)
  // -- previously these were plain useState with no persistence at all and
  // silently reset to defaults on every remount.
  const HINT_PREFS_KEY = 'practice:hintPrefs:v1';
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(HINT_PREFS_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (typeof saved.hideLevel === 'number') setHideLevel(saved.hideLevel);
        if (typeof saved.firstLetterLevel === 'number') setFirstLetterLevel(saved.firstLetterLevel);
        if (saved.hintMode === 'percent' || saved.hintMode === 'firstLetter') setHintMode(saved.hintMode);
        if (saved.strikeLimit === 'unlimited' || typeof saved.strikeLimit === 'number') setStrikeLimit(saved.strikeLimit);
        if (saved.recallDisplayMode === 'passage' || saved.recallDisplayMode === 'memoryGrid') setRecallDisplayMode(saved.recallDisplayMode);
        const loadedLevel = saved.hintMode === 'firstLetter' ? saved.firstLetterLevel : saved.hideLevel;
        if (typeof loadedLevel === 'number') regenerateHiddenWords(loadedLevel);
      } catch {
        // Corrupt/missing prefs -- just keep the defaults.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    AsyncStorage.setItem(
      HINT_PREFS_KEY,
      JSON.stringify({ hideLevel, firstLetterLevel, hintMode, strikeLimit, recallDisplayMode })
    ).catch(() => {});
  }, [hideLevel, firstLetterLevel, hintMode, strikeLimit, recallDisplayMode]);

  // A chained review session (see advanceReviewSession in useAppState.ts)
  // swaps `verses` in place on the SAME mounted PracticeModals instance --
  // no unmount/remount happens between groups, since the overlay itself
  // stays up the whole session. Without this, the next group would inherit
  // the previous group's recitePointer/outcomes/finished state, which are
  // meaningless (even out of bounds) against a differently-sized passage.
  useEffect(() => {
    resetReciteGame();
    regenerateHiddenWords(activeLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses]);

  const switchLearnTab = (tab: 'recite' | 'reveal') => {
    if (tab === learnTab) return;
    speechEngineRef.current?.stop();
    setIsListeningSpeak(false);
    setLearnTab(tab);
  };

  // ==========================================
  // RECITE — live speech channel. Feeds the exact same recitePointer/
  // reciteOutcomes the typed channel does, so either input method advances
  // the same passage together.
  // ==========================================
  const speakExpectedTokens = useMemo(() => verses.flatMap((v) => tokenizeWords(v.text)), [verses]);
  const fullPassageText = useMemo(() => verses.map((v) => v.text).join(' '), [verses]);

  const startListening = () => {
    const engine = speechEngineRef.current;
    if (!engine) return;
    usedSpeechRef.current = true;
    setSpeakTranscript('');
    setIsListeningSpeak(true);
    // Engines that support contextual vocabulary hints get the exact passage
    // text before listening starts (no-op on the web engine).
    engine.prime?.(fullPassageText);
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
    });
    triggerLocalToast('Microphone active! Recite the passage... 🎙️');
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

    const protectedIndices = new Set<number>();
    for (const key of Object.keys(reciteSource)) {
      if (reciteSource[Number(key)] === 'protected') protectedIndices.add(Number(key));
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

    setReciteOutcomes((prev) => ({ ...prev, ...patch.outcomes }));
    setReciteSource((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch.outcomes)) next[Number(key)] = 'speech';
      return next;
    });
    if (patch.pointer !== recitePointer) {
      if (reciteWordObjects[patch.pointer]?.verseIdx !== reciteWordObjects[recitePointer]?.verseIdx) {
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

  // ==========================================
  // REVEAL MODE STATE & LOGIC (unchanged)
  // ==========================================
  const [maskLevel, setMaskLevel] = useState(50); // 0, 25, 50, 75, 100
  const [peekActive, setPeekActive] = useState(false);
  const [singlePeekedWords, setSinglePeekedWords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSinglePeekedWords({});
  }, [maskLevel, verses]);

  const shouldHideWord = (word: string, index: number) => {
    if (maskLevel === 0) return false;
    if (maskLevel === 100) return true;
    const hash = (index * 19 + word.length * 3) % 100;
    return hash < maskLevel;
  };

  // Renders one verse's masked text. NOTE: the web original used an
  // invisible-sizer + absolute-overlay trick to keep word width perfectly
  // stable when toggling between masked dots and the real word (which use
  // different fonts). RN's text layout model doesn't support that overlay
  // compositing the same way, and `maskLetters` already produces a
  // same-length string, so we render one or the other directly as nested
  // <Text> — width may shift very slightly on peek, which is an acceptable
  // simplification.
  const renderMaskedText = (v: VerseState) => {
    const words = v.text.split(/\s+/);
    return (
      <Text className="font-serif text-[15px] leading-relaxed text-neutral-800 mb-3">
        <Text className="font-sans text-[10px] font-bold text-neutral-400">{v.verse} </Text>
        {words.map((w, idx) => {
          const isHidden = shouldHideWord(w, idx);
          const wordKey = `${v.book}-${v.chapter}-${v.verse}-${idx}`;
          const isWordPeeked = peekActive || singlePeekedWords[wordKey];

          if (isHidden) {
            return (
              <Text
                key={idx}
                onPress={() =>
                  setSinglePeekedWords((prev) => ({
                    ...prev,
                    [wordKey]: !prev[wordKey],
                  }))
                }
                className={`font-serif text-[15px] rounded px-1 ${
                  isWordPeeked ? 'bg-amber-100 text-neutral-900 font-medium' : 'bg-neutral-100 text-neutral-400 font-mono font-bold'
                }`}
              >
                {isWordPeeked ? w : maskLetters(w)}{' '}
              </Text>
            );
          }

          return (
            <Text key={idx} className="font-serif text-[15px] text-neutral-800">
              {w}{' '}
            </Text>
          );
        })}
      </Text>
    );
  };

  // Tapping a verse in the reading pane either jumps playback straight to it
  // (normal playlist modes), or -- in Selection mode -- marks the start/end
  // of the loop range, exactly like the old word-tap mechanic but at verse
  // granularity.
  const handleVerseClick = (index: number) => {
    if (playSource !== 'selection') {
      setCurrentVerseIndex(index);
      return;
    }

    if (selectionStart === null || (selectionStart !== null && selectionEnd !== null)) {
      setSelectionStart(index);
      setSelectionEnd(null);
      setCurrentVerseIndex(index);
    } else {
      if (index < selectionStart) {
        setSelectionStart(index);
        setCurrentVerseIndex(index);
      } else {
        setSelectionEnd(index);
      }
    }
  };

  // Overall progress across the whole playlist, smoothly advancing using the
  // real playhead within the current verse's segment (0 when there's no
  // segment to play at all). Computed here, not inline in the JSX below, so
  // TypeScript can actually narrow currentSegment.recording -> non-null
  // startSec/endSec (a ternary buried in a template literal doesn't narrow
  // the same way).
  let listenSegmentFraction = 0;
  if (currentSegment && currentSegment.recording) {
    const span = Math.max(0.01, currentSegment.endSec - currentSegment.startSec);
    listenSegmentFraction = Math.max(0, Math.min(1, (listenPlayerStatus.currentTime - currentSegment.startSec) / span));
  }
  const overallListenProgressPercent =
    activePlayVerses.length > 0 ? ((currentVerseIndex + listenSegmentFraction) / activePlayVerses.length) * 100 : 0;

  // Minimized Listen mode: a small persistent bar instead of the full
  // overlay, positioned above the tab bar (its height, 64px, is hardcoded
  // to match AppShell's own h-16 tab/Back-to-Guide row -- this component
  // renders as its own absolutely-positioned sibling, not inside that row's
  // normal flex flow, so it can't inherit the offset automatically).
  // pointerEvents="box-none" on the full-screen wrapper means only the bar
  // itself (given pointerEvents="auto") captures touches -- everything else
  // on screen stays reachable, so the user can genuinely navigate the rest
  // of the app while this keeps playing.
  if (type === 'listen' && listenMinimized) {
    const miniVerse = currentSegment?.verseObj ?? activePlayVerses[currentVerseIndex] ?? null;
    return (
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
        <Pressable
          onPress={() => setListenMinimized(false)}
          pointerEvents="auto"
          style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 76 }}
          className="bg-[#1A1A1A] rounded-2xl px-3 py-2.5 flex-row items-center shadow-lg"
        >
          <View className="w-8 h-8 rounded-lg bg-white/15 items-center justify-center shrink-0 mr-3">
            <WaveBars active={listenPlaying} count={4} />
          </View>
          <View className="flex-1 mr-2" style={{ gap: 1 }}>
            <View className="flex-row items-center gap-1">
              <ChevronUp size={9} color="rgba(255,255,255,0.5)" />
              <Text className="text-white/60 text-[8px] font-sans font-extrabold uppercase tracking-wider">Now Playing</Text>
            </View>
            <Text numberOfLines={1} className="text-white font-sans font-bold text-xs">
              {miniVerse ? `${miniVerse.book} ${miniVerse.chapter}:${miniVerse.verse}` : referenceText}
            </Text>
          </View>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              toggleListenPlaying();
            }}
            className="w-9 h-9 rounded-full bg-white/15 items-center justify-center shrink-0 mr-1.5"
          >
            {listenPlaying ? <Pause size={15} color="#ffffff" /> : <Play size={15} color="#ffffff" />}
          </Pressable>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-9 h-9 rounded-full bg-white/15 items-center justify-center shrink-0"
          >
            <X size={15} color="#ffffff" />
          </Pressable>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="absolute inset-0 bg-white z-50 pt-11 pb-4 px-4" id="practice_overlay">
      {/* Header Bar */}
      <View className="flex-row items-center justify-between border-b border-[#1A1A1A] pb-2 mb-3">
        <View>
          <Text className="text-[9px] uppercase tracking-wider text-neutral-500 font-sans font-bold">
            {type === 'listen' ? 'Audio Player & Looper' : learnTab === 'recite' ? 'Recall Practice' : 'Active Reveal practice'}
          </Text>
          <Text className="text-base font-serif font-bold text-neutral-900 leading-tight max-w-[280px]" numberOfLines={1}>
            {referenceText}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          {!!sessionTotal && sessionTotal > 1 && (
            <View className="bg-neutral-900 px-2.5 py-1 rounded-full">
              <Text className="text-white text-[10px] font-mono font-bold">
                {sessionPosition} of {sessionTotal}
              </Text>
            </View>
          )}
          <Pressable
            onPress={type === 'listen' ? () => setListenMinimized(true) : onClose}
            className="w-10 h-10 rounded-full border border-neutral-300 items-center justify-center shrink-0"
            hitSlop={8}
          >
            <X size={18} color="#262626" />
          </Pressable>
        </View>
      </View>

      {/* Main Panel */}
      <View className="flex-1 justify-between py-1">
        {/* ======================================================== */}
        {/* LISTEN MODE VIEW */}
        {/* ======================================================== */}
        {type === 'listen' && (
          <View className="flex-1 justify-between">
            {/* Verse by Verse / Memory Grid tab -- purely a display choice,
                both tap through to the same handleVerseClick. */}
            <View className="flex-row bg-neutral-100 p-1 rounded-xl mb-2.5 border border-neutral-200 shrink-0">
              <Pressable
                onPress={() => setListenViewMode('verses')}
                className={`flex-1 py-1.5 rounded-lg items-center ${listenViewMode === 'verses' ? 'bg-[#1A1A1A]' : ''}`}
              >
                <Text className={`text-[10px] uppercase tracking-wider font-sans font-extrabold ${listenViewMode === 'verses' ? 'text-white' : 'text-neutral-500'}`}>
                  Verse by Verse
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setListenViewMode('memoryGrid')}
                className={`flex-1 py-1.5 rounded-lg items-center ${listenViewMode === 'memoryGrid' ? 'bg-[#1A1A1A]' : ''}`}
              >
                <Text className={`text-[10px] uppercase tracking-wider font-sans font-extrabold ${listenViewMode === 'memoryGrid' ? 'text-white' : 'text-neutral-500'}`}>
                  Memory Grid
                </Text>
              </Pressable>
            </View>

            {/* Verse Highlight Box — verse-by-verse, not word-by-word: the
                only real timing data this app has is per verse. */}
            <View className="bg-neutral-50 border border-neutral-200 rounded-2xl flex-1 mb-3 overflow-hidden">
              {listenViewMode === 'memoryGrid' ? (
                <ScrollView className="flex-1 p-3" contentContainerStyle={{ paddingBottom: 12 }}>
                  <MemoryGrid
                    verses={activePlayVerses.map((v) => ({ book: v.book, chapter: v.chapter, verse: v.verse, text: v.text }))}
                    columns={memoryGridColumns}
                    activeIndex={listenPlaying ? currentVerseIndex : undefined}
                    highlightedKeys={highlightedVerses}
                    onToggleHighlight={onToggleVerseHighlight ? (key) => onToggleVerseHighlight(key) : undefined}
                    doodles={verseDoodles}
                    onSaveDoodle={onSaveVerseDoodle ? (key, _v, strokes) => onSaveVerseDoodle(key, strokes) : undefined}
                    onTapVerse={(_v, index) => handleVerseClick(index)}
                  />
                </ScrollView>
              ) : (
              <ScrollView className="flex-1 p-4" contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
                {activePlayVerses.map((verseObj, index) => {
                  const segment = playableSegments[index];
                  const hasAudio = !!segment.recording;
                  const isActive = index === currentVerseIndex && listenPlaying;
                  const isRead = index < currentVerseIndex;
                  const inSelectionRange =
                    playSource === 'selection' &&
                    selectionStart !== null &&
                    (selectionEnd !== null ? index >= selectionStart && index <= selectionEnd : index === selectionStart);

                  let cardClassName = 'rounded-xl px-3 py-2.5 border ';
                  if (isActive) {
                    cardClassName += 'bg-[#1A1A1A] border-[#1A1A1A]';
                  } else if (playSource === 'selection' && selectionStart !== null) {
                    cardClassName += inSelectionRange ? 'bg-amber-100 border-amber-200' : 'bg-white border-neutral-200 opacity-40';
                  } else if (isRead) {
                    cardClassName += 'bg-neutral-200/40 border-neutral-200';
                  } else {
                    cardClassName += 'bg-white border-neutral-200';
                  }

                  const refClassName = isActive ? 'text-white/70' : inSelectionRange ? 'text-amber-800' : 'text-neutral-400';
                  const textClassName = isActive ? 'text-white' : !hasAudio ? 'text-neutral-400' : 'text-neutral-800';

                  return (
                    <Pressable key={`${verseObj.book}-${verseObj.chapter}-${verseObj.verse}`} onPress={() => handleVerseClick(index)} className={cardClassName}>
                      <View className="flex-row items-center justify-between mb-0.5">
                        <Text className={`font-sans text-[9px] font-extrabold uppercase tracking-wide ${refClassName}`}>
                          {verseObj.book} {verseObj.chapter}:{verseObj.verse}
                        </Text>
                        {!hasAudio && (
                          <Text className={`font-sans text-[8px] font-bold uppercase tracking-wide ${isActive ? 'text-white/50' : 'text-neutral-300'}`}>
                            No audio
                          </Text>
                        )}
                      </View>
                      <Text className={`font-serif text-[15px] leading-relaxed ${textClassName}`}>{verseObj.text}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              )}

              {/* Selection Mode Instructions overlay */}
              {playSource === 'selection' && (
                <View className="absolute top-2 right-2 bg-amber-500/10 px-2 py-1 rounded border border-amber-200 z-10" pointerEvents="none">
                  <Text className="text-[8.5px] font-sans font-bold text-amber-800">
                    {selectionStart === null ? 'Tap verse to set start' : selectionEnd === null ? 'Tap verse to set end' : 'Segment active'}
                  </Text>
                </View>
              )}

              {/* Static Segment control and Audio wave indicator footer bar */}
              <View className="bg-neutral-100 border-t border-neutral-200 px-3 py-2 flex-row justify-between items-center z-10">
                <View className="flex-row items-center gap-2">
                  {playSource === 'selection' && selectionStart !== null ? (
                    <Pressable
                      onPress={() => {
                        setSelectionStart(null);
                        setSelectionEnd(null);
                        setCurrentVerseIndex(0);
                      }}
                      className="flex-row items-center gap-1.5 bg-white border border-neutral-300 px-2.5 py-1 rounded-lg"
                    >
                      <RefreshCw size={10} color="#262626" />
                      <Text className="text-[8.5px] font-sans font-extrabold text-neutral-800">Reset Segment</Text>
                    </Pressable>
                  ) : (
                    <Text className="text-[8.5px] font-sans font-bold text-neutral-400 uppercase tracking-wider">
                      {playSource === 'selection' ? 'Tap verse to select segment' : 'Playlist Auto-playback'}
                    </Text>
                  )}
                </View>

                <View className="bg-white border border-neutral-200 px-2 py-1 rounded-lg">
                  <WaveBars active={listenPlaying} count={5} />
                </View>
              </View>
            </View>

            {/* Custom Control and Audio Looping Panel */}
            <View className="gap-3.5 bg-white pt-2">
              {/* playlist / source options -- shown whenever there's a real
                  alternative source to switch to (memoryQueue for today's
                  verses, or allVerses as the empty-queue fallback below). */}
              {((memoryQueue && memoryQueue.length > 0) || (allVerses && allVerses.length > 0)) && (
                <View className="gap-2 bg-neutral-50 p-2 rounded-xl border border-neutral-200">
                  <View className="flex-row justify-between items-center px-1">
                    <Text className="text-[9px] font-sans font-extrabold text-neutral-400 tracking-wider uppercase">Loop Target / Playlist</Text>
                    <Text className="text-[9px] font-mono font-bold text-neutral-500 bg-neutral-200 px-1.5 rounded-full">
                      {activePlayVerses.length} verses
                    </Text>
                  </View>
                  {/* Not ChipRow here -- its columns-mode spacing (2px per
                      chip) reads as cramped with 5 options this size; a
                      dedicated row gives real breathing room between them
                      without touching ChipRow's shared columns-mode styling
                      used elsewhere in the app. */}
                  <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                    {(
                      [
                        { id: 'all', label: "Today's Verses" },
                        { id: 'memorization', label: 'Learning' },
                        { id: 'reviewing', label: 'Review' },
                        { id: 'priming', label: 'Priming' },
                        { id: 'selection', label: 'Selected' },
                      ] as const
                    ).map((opt) => {
                      const active = playSource === opt.id;
                      return (
                        <Pressable
                          key={opt.id}
                          onPress={() => setPlaySource(opt.id)}
                          className={`px-2.5 py-1.5 rounded-lg border ${active ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'}`}
                        >
                          <Text className={`text-[9.5px] font-bold text-center ${active ? 'text-white' : 'text-neutral-600'}`}>
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {playSource === 'priming' && setPrimingLookahead && (
                    <View className="flex-row items-center justify-between bg-amber-50 border border-amber-100 rounded-lg p-2 mt-2">
                      <View>
                        <Text className="text-[9px] font-sans font-bold text-amber-800 uppercase tracking-wider">⚡ Priming Window Size</Text>
                        <Text className="text-[8.5px] font-sans text-amber-700 leading-none">Set lookahead priming size</Text>
                      </View>
                      <View style={{ width: 90 }}>
                        <Dropdown
                          value={primingLookahead}
                          onChange={(v) => setPrimingLookahead(Number(v))}
                          options={[10, 20, 30, 40, 50].map((n) => ({ id: n, label: `${n}` }))}
                          title="Priming Window Size"
                        />
                      </View>
                    </View>
                  )}
                </View>
              )}

              {!hasAnyAudio ? (
                <View className="items-center gap-1.5 py-4 bg-neutral-50 rounded-xl border border-dashed border-neutral-300">
                  <Text className="text-xs font-sans font-bold text-neutral-600">No audio recorded for these verses yet</Text>
                  <Text className="text-[10px] font-sans text-neutral-400 text-center px-6 leading-relaxed">
                    Record a recitation from the Record tab, or select a narration for this chapter from its Chapter
                    Landing page — playback here uses whichever recording is set there.
                  </Text>
                </View>
              ) : (
                <>
                  {/* Adjusters: Speed (.25 steps) and Repeat mode */}
                  <View className="flex-row gap-2">
                    {/* 1. Playback Speed Selector */}
                    <View className="flex-1 justify-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 gap-1">
                      <View className="flex-row items-center gap-1">
                        <Sliders size={10} color="#737373" />
                        <Text className="text-[9px] font-sans font-bold text-neutral-500 uppercase tracking-wider">Speed (±0.2)</Text>
                      </View>
                      <View className="flex-row items-center justify-between bg-white px-2 py-1 rounded-lg border border-neutral-200">
                        <Pressable
                          onPress={() => setListenSpeed((s) => Math.max(0.4, Number((s - 0.2).toFixed(1))))}
                          className="w-5 h-5 bg-neutral-100 border border-neutral-300 rounded items-center justify-center"
                        >
                          <Text className="font-black text-xs text-neutral-800">-</Text>
                        </Pressable>
                        <Text className="text-xs font-mono font-bold text-neutral-900">{listenSpeed.toFixed(1)}x</Text>
                        <Pressable
                          onPress={() => setListenSpeed((s) => Math.min(2.0, Number((s + 0.2).toFixed(1))))}
                          className="w-5 h-5 bg-neutral-100 border border-neutral-300 rounded items-center justify-center"
                        >
                          <Text className="font-black text-xs text-neutral-800">+</Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* 2. Audio Repeat Control */}
                    <View className="flex-1 justify-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 gap-1">
                      <View className="flex-row items-center gap-1">
                        <Repeat size={10} color="#737373" />
                        <Text className="text-[9px] font-sans font-bold text-neutral-500 uppercase tracking-wider">Repeat Setting</Text>
                      </View>
                      <ChipRow
                        value={repeatMode}
                        onChange={(id) => setRepeatMode(id)}
                        options={[
                          { id: 'off', label: 'Off' },
                          { id: 'playlist', label: 'Loop' },
                        ]}
                      />
                    </View>
                  </View>

                  {/* Progress bar — overall position across the playlist,
                      smoothly advancing using the real playhead within the
                      current verse's segment. */}
                  <View className="gap-0.5">
                    <View className="flex-row justify-between px-1">
                      <Text className="text-[8px] font-bold text-neutral-400 font-mono">START</Text>
                      <Text className="text-[8px] font-bold text-neutral-400 font-mono">
                        Verse {currentVerseIndex + 1} of {activePlayVerses.length}
                      </Text>
                      <Text className="text-[8px] font-bold text-neutral-400 font-mono">END</Text>
                    </View>
                    <View className="w-full bg-neutral-200 h-1.5 rounded-full overflow-hidden">
                      <View className="bg-[#1A1A1A] h-full" style={{ width: `${overallListenProgressPercent}%` }} />
                    </View>
                  </View>

                  {/* Main player controls row */}
                  <View className="flex-row gap-2.5 pb-1">
                    <Pressable onPress={restartListen} className="flex-1 py-2.5 px-3 border-2 border-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5">
                      <RefreshCw size={12} color="#1A1A1A" />
                      <Text className="font-sans font-bold text-xs text-[#1A1A1A]">Restart</Text>
                    </Pressable>
                    <Pressable
                      onPress={toggleListenPlaying}
                      className={`flex-[2] py-2.5 px-3 rounded-xl flex-row items-center justify-center gap-1.5 ${
                        listenPlaying ? 'bg-neutral-900' : 'bg-emerald-600'
                      }`}
                    >
                      {listenPlaying ? <Pause size={12} color="#ffffff" /> : <Play size={12} color="#ffffff" />}
                      <Text className="font-sans font-bold text-xs text-white">{listenPlaying ? 'Pause Audio' : 'Start Looping'}</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        {/* ======================================================== */}
        {/* LEARN MODE — Recall / Reveal tabs                          */}
        {/* ======================================================== */}
        {type === 'learn' && (
          <View className="flex-1 justify-between relative">
            {/* Local custom toast alert */}
            {localToast && (
              <BounceView style={{ position: 'absolute', top: 56, left: '50%', marginLeft: -100, zIndex: 30 }}>
                <View className="bg-[#1A1A1A] px-3.5 py-1.5 rounded-full">
                  <Text className="text-white text-[10px] font-sans font-bold">{localToast}</Text>
                </View>
              </BounceView>
            )}

            {/* Recall / Reveal Tab bar */}
            <View className="flex-row bg-neutral-100 p-1 rounded-xl mb-3.5 border border-neutral-200 shrink-0">
              <Pressable
                onPress={() => switchLearnTab('recite')}
                className={`flex-1 py-1.5 rounded-lg flex-row items-center justify-center gap-1.5 ${learnTab === 'recite' ? 'bg-[#1A1A1A]' : ''}`}
              >
                <Mic size={12} color={learnTab === 'recite' ? '#ffffff' : '#737373'} />
                <Text className={`text-[10px] uppercase tracking-wider font-sans font-extrabold ${learnTab === 'recite' ? 'text-white' : 'text-neutral-500'}`}>
                  Recall
                </Text>
              </Pressable>
              <Pressable
                onPress={() => switchLearnTab('reveal')}
                className={`flex-1 py-1.5 rounded-lg flex-row items-center justify-center gap-1.5 ${learnTab === 'reveal' ? 'bg-[#1A1A1A]' : ''}`}
              >
                <Eye size={12} color={learnTab === 'reveal' ? '#ffffff' : '#737373'} />
                <Text className={`text-[10px] uppercase tracking-wider font-sans font-extrabold ${learnTab === 'reveal' ? 'text-white' : 'text-neutral-500'}`}>
                  Reveal
                </Text>
              </Pressable>
            </View>

            {learnTab === 'recite' ? (
              !isFinishedRecite ? (
                <View className="flex-1 justify-between">
                  {/* Passage card frame — typed + spoken progress share one
                      highlight: words before the pointer are graded, the
                      word at the pointer is the "current" target for both
                      channels, everything after is masked. */}
                  <View className={`border-2 rounded-2xl p-4 flex-1 justify-between relative ${flashError ? 'border-red-500 bg-red-50' : 'border-[#1A1A1A] bg-white'}`}>
                    {/* Strike Reset Alert Overlay */}
                    {showStrikeResetAlert && (
                      <FadeInView style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
                        <View className="flex-1 bg-white/95 items-center justify-center p-4 rounded-xl">
                          <SpinView>
                            <View className="w-10 h-10 rounded-full bg-red-100 items-center justify-center mb-2">
                              <RefreshCw size={20} color="#dc2626" />
                            </View>
                          </SpinView>
                          <Text className="text-sm font-sans font-extrabold text-red-900">Verse Restarting!</Text>
                          <Text className="text-[10px] text-red-700/85 font-medium px-4 text-center">
                            You reached the strike limit. Let's try this verse again from the beginning!
                          </Text>
                        </View>
                      </FadeInView>
                    )}

                    <View className="flex-row bg-neutral-100 p-0.5 rounded-lg mb-2 shrink-0">
                      <Pressable
                        onPress={() => setRecallDisplayMode('passage')}
                        className={`flex-1 py-1 rounded-md items-center ${recallDisplayMode === 'passage' ? 'bg-white' : ''}`}
                      >
                        <Text className={`text-[9px] font-sans font-extrabold uppercase tracking-wider ${recallDisplayMode === 'passage' ? 'text-neutral-900' : 'text-neutral-500'}`}>
                          Passage
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setRecallDisplayMode('memoryGrid')}
                        className={`flex-1 py-1 rounded-md items-center ${recallDisplayMode === 'memoryGrid' ? 'bg-sky-600' : ''}`}
                      >
                        <Text className={`text-[9px] font-sans font-extrabold uppercase tracking-wider ${recallDisplayMode === 'memoryGrid' ? 'text-white' : 'text-neutral-500'}`}>
                          Memory Grid
                        </Text>
                      </Pressable>
                    </View>

                    {recallDisplayMode === 'memoryGrid' ? (
                      <ScrollView className="flex-1 mb-2">
                        <MemoryGrid
                          verses={verses.map((v) => ({ book: v.book, chapter: v.chapter, verse: v.verse, text: v.text }))}
                          columns={memoryGridColumns}
                          highlightedKeys={highlightedVerses}
                          onToggleHighlight={onToggleVerseHighlight ? (key) => onToggleVerseHighlight(key) : undefined}
                          doodles={verseDoodles}
                          onSaveDoodle={onSaveVerseDoodle ? (key, _v, strokes) => onSaveVerseDoodle(key, strokes) : undefined}
                          wordStates={gridWordStates}
                        />
                      </ScrollView>
                    ) : (
                    <ScrollView className="flex-1 mb-2">
                      <Text className="text-[9px] font-sans font-bold text-neutral-400 tracking-wider mb-1">
                        Recall Practice — {verses.length} {verses.length === 1 ? 'verse' : 'verses'} ({referenceText})
                      </Text>

                      <View className="gap-3">
                        {(() => {
                          let flatIdx = 0;
                          return verses.map((v) => {
                            const words = v.text.split(/\s+/);
                            return (
                              <Text key={`${v.book}-${v.chapter}-${v.verse}`} className="font-serif text-[15px] leading-relaxed text-neutral-800">
                                <Text className="font-sans text-[10px] font-bold text-neutral-400">{v.verse} </Text>
                                {words.map((w, idx) => {
                                  const isCountedWord = normalizeToken(w).length > 0;
                                  const g = isCountedWord ? flatIdx++ : -1;
                                  const isPast = g >= 0 && g < recitePointer;
                                  const isCurrent = g === recitePointer;
                                  const isGivenHint = g >= 0 && !hiddenWordIndices.has(g);

                                  if (isPast) {
                                    const outcome = reciteOutcomes[g];
                                    const gradeClass =
                                      outcome === 'missed'
                                        ? 'text-red-600 underline decoration-dotted decoration-red-300'
                                        : outcome === 'close'
                                          ? 'text-amber-600'
                                          : 'text-neutral-900';
                                    // Missed words are tappable -- the speech
                                    // engine mis-hears plenty of words the
                                    // user actually said right, and there's
                                    // no reliable automatic fix, so this is
                                    // the manual escape valve.
                                    return (
                                      <Text
                                        key={idx}
                                        className={`font-serif text-[15px] font-semibold ${gradeClass}`}
                                        onPress={outcome === 'missed' ? () => overrideWordAsCorrect(g) : undefined}
                                      >
                                        {w}{' '}
                                      </Text>
                                    );
                                  }

                                  if (!isCountedWord) {
                                    // Punctuation-only token (e.g. a standalone
                                    // dash) -- not part of the recite pointer,
                                    // just render it plainly.
                                    return (
                                      <Text key={idx} className="font-serif text-[15px] text-neutral-800">
                                        {w}{' '}
                                      </Text>
                                    );
                                  }

                                  if (isGivenHint) {
                                    // This word wasn't drawn into the hidden
                                    // sample, so it's shown as a given hint --
                                    // still has to be typed/spoken to advance,
                                    // but isn't a blind guess.
                                    return (
                                      <Text
                                        key={idx}
                                        className={`font-serif text-[15px] rounded px-1 ${isCurrent ? 'bg-amber-50 text-neutral-600' : 'text-neutral-400'}`}
                                      >
                                        {w}{' '}
                                      </Text>
                                    );
                                  }

                                  if (hintMode === 'firstLetter') {
                                    // Assisted hint -- kept visually distinct
                                    // (sky, not amber/neutral) from both a
                                    // given-hint word and a true blind mask,
                                    // since this run can only ever count as
                                    // a review, never mastery.
                                    return (
                                      <Text
                                        key={idx}
                                        className={`font-serif text-[15px] rounded px-1 font-mono font-bold ${
                                          isCurrent ? 'bg-sky-100 text-sky-700' : 'bg-sky-50 text-sky-400'
                                        }`}
                                      >
                                        {maskExceptFirstLetter(w)}{' '}
                                      </Text>
                                    );
                                  }

                                  return (
                                    <Text
                                      key={idx}
                                      className={`font-serif text-[15px] rounded px-1 font-mono font-bold ${
                                        isCurrent ? 'bg-amber-50 text-neutral-500' : 'bg-neutral-50 text-neutral-300'
                                      }`}
                                    >
                                      {maskLetters(w)}{' '}
                                    </Text>
                                  );
                                })}
                              </Text>
                            );
                          });
                        })()}
                      </View>
                    </ScrollView>
                    )}

                    {/* Input row -- mic lives inline at the right edge of the
                        typed-input box (was a whole separate labeled row
                        above; tapping a mic icon to talk is self-evident, and
                        this saves the vertical/horizontal room for the words
                        themselves instead). */}
                    <View className="gap-2.5 pt-2">
                      <View className="flex-row justify-between items-center px-1">
                        <View className="flex-row items-center gap-2">
                          {strikeLimit !== 'unlimited' && (
                            <Text className="text-[10px] text-red-500 font-medium">Verse errors: {verseStrikes}/{strikeLimit}</Text>
                          )}
                        </View>
                        <Text className="text-[10px] text-neutral-400 font-bold">{recitePointer} of {reciteWordObjects.length} words</Text>
                      </View>

                      <View className="flex-row items-center gap-2">
                        <TextInput
                          value={typedInput}
                          onChangeText={handleReciteTypeChar}
                          placeholder={showStrikeResetAlert ? 'Resetting...' : 'Type first letter of each word (nearby keys count)...'}
                          className="flex-1 bg-neutral-50 border border-neutral-300 rounded-xl py-2 px-3 text-center font-sans font-semibold text-xs text-neutral-900"
                          autoFocus
                          editable={!showStrikeResetAlert}
                        />
                        {speechAvailable && (
                          <Pressable
                            onPress={() => (isListeningSpeak ? stopListening() : startListening())}
                            className={`w-9 h-9 rounded-full items-center justify-center shrink-0 ${isListeningSpeak ? 'bg-red-500' : 'bg-indigo-600'}`}
                          >
                            {isListeningSpeak ? <MicOff size={15} color="#ffffff" /> : <Mic size={15} color="#ffffff" />}
                          </Pressable>
                        )}
                      </View>
                      {isListeningSpeak && (
                        <View className="h-6 items-center justify-center bg-neutral-50 rounded-lg border border-neutral-200">
                          <WaveBars active count={16} />
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Accuracy Settings Bar */}
                  <View className="mt-2.5 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 gap-1.5">
                    <View className="flex-row justify-between items-center px-1">
                      <Text className="text-[9px] font-sans font-extrabold text-neutral-400 tracking-wider uppercase">Strike Reset Limit (Accuracy Assist)</Text>
                      <Text className="text-[9px] font-mono font-bold text-neutral-500">
                        {strikeLimit === 'unlimited' ? 'No Reset' : `${strikeLimit} Max Strikes`}
                      </Text>
                    </View>
                    <DiscreteSlider
                      value={strikeLimit === 'unlimited' ? 'unlimited' : strikeLimit}
                      onChange={(id) => {
                        const limit = id === 'unlimited' ? 'unlimited' : Number(id);
                        setStrikeLimit(limit as number | 'unlimited');
                        setVerseStrikes(0);
                      }}
                      options={[3, 5, 10, 'unlimited'].map((limit) => ({
                        id: limit as number | 'unlimited',
                        label: limit === 'unlimited' ? 'Off' : `${limit} errors`,
                      }))}
                    />
                  </View>

                  {/* How many words get hidden this attempt -- changing it or
                      resetting always re-rolls a fresh random subset.
                      % Hidden only grades at 100% (Blind); First Letter
                      grades as a review at any level, but never mastery --
                      see the finish panel split below. */}
                  <View className="mt-2.5 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 gap-1.5">
                    <View className="flex-row justify-between items-center px-1">
                      <Text className="text-[9px] font-sans font-extrabold text-neutral-400 tracking-wider uppercase">
                        {hintMode === 'firstLetter' ? 'First Letter Hints' : 'Words Hidden'}
                      </Text>
                      <Text className={`text-[9px] font-mono font-bold ${hintMode === 'firstLetter' ? 'text-sky-600' : 'text-neutral-500'}`}>
                        {activeLevel}% hidden
                        {hintMode === 'percent' && activeLevel < 100 ? ' -- practice only' : ''}
                        {hintMode === 'firstLetter' ? ' -- review, not mastery' : ''}
                      </Text>
                    </View>
                    <View className="flex-row bg-neutral-200/70 p-0.5 rounded-lg">
                      <Pressable
                        onPress={() => switchHintMode('percent')}
                        className={`flex-1 py-1 rounded-md items-center ${hintMode === 'percent' ? 'bg-white' : ''}`}
                      >
                        <Text className={`text-[9px] font-sans font-extrabold ${hintMode === 'percent' ? 'text-neutral-900' : 'text-neutral-500'}`}>
                          % Hidden
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => switchHintMode('firstLetter')}
                        className={`flex-1 py-1 rounded-md items-center ${hintMode === 'firstLetter' ? 'bg-sky-600' : ''}`}
                      >
                        <Text className={`text-[9px] font-sans font-extrabold ${hintMode === 'firstLetter' ? 'text-white' : 'text-neutral-500'}`}>
                          First Letter
                        </Text>
                      </Pressable>
                    </View>
                    <DiscreteSlider
                      value={activeLevel}
                      onChange={(level) => {
                        setActiveLevel(level);
                        resetReciteGame();
                        regenerateHiddenWords(level);
                      }}
                      options={[0, 25, 50, 75, 100].map((level) => ({ id: level, label: level === 100 ? 'Blind' : `${level}%` }))}
                    />
                  </View>

                  {/* Options */}
                  <View className="mt-2 flex-row gap-2.5">
                    <Pressable
                      onPress={() => {
                        resetReciteGame();
                        regenerateHiddenWords(activeLevel);
                      }}
                      className="flex-1 py-2 px-3 border border-neutral-300 rounded-xl flex-row items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={12} color="#525252" />
                      <Text className="font-sans font-bold text-xs text-neutral-600">Reset Passage</Text>
                    </Pressable>
                    <Pressable onPress={handleReciteHint} className="flex-1 py-2 px-3 border-2 border-[#1A1A1A] rounded-xl items-center justify-center">
                      <Text className="font-sans font-bold text-xs text-neutral-900">Reveal Word</Text>
                    </Pressable>
                  </View>
                </View>
              ) : hintMode === 'percent' && hideLevel < 100 ? (
                /* Partially-hidden finish panel -- accuracy feedback only, no
                   mastery/review logging buttons, since anything short of a
                   fully blind attempt never counts. */
                (() => {
                  const summary = summarizeOutcomes(finalOutcomes || []);
                  const pct = Math.round(summary.accuracy * 100);
                  return (
                    <ScrollView className="flex-1" contentContainerClassName="items-center justify-center p-4 gap-4" contentContainerStyle={{ flexGrow: 1 }}>
                      <BounceView>
                        <View className="w-12 h-12 bg-neutral-100 border-2 border-[#1A1A1A] rounded-full items-center justify-center">
                          <Shuffle size={24} color="#171717" />
                        </View>
                      </BounceView>
                      <View className="items-center">
                        <Text className="text-lg font-serif font-bold text-neutral-900 leading-tight">Nice practice run!</Text>
                        <Text className="text-xs text-neutral-500 font-sans mt-0.5 text-center px-6 leading-relaxed">
                          {pct}% word accuracy with {hideLevel}% of words hidden. Anything short of fully blind never counts
                          toward mastery or a review -- it's just for warming up.
                        </Text>
                      </View>

                      <View className="w-full gap-2">
                        <Pressable
                          onPress={() => {
                            resetReciteGame();
                            regenerateHiddenWords(hideLevel);
                          }}
                          className="w-full py-2.5 px-3 bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5"
                        >
                          <Shuffle size={14} color="#ffffff" />
                          <Text className="font-sans font-bold text-xs text-white">Practice Again (new words hidden)</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setHideLevel(100);
                            resetReciteGame();
                            regenerateHiddenWords(100);
                          }}
                          className="w-full py-1 items-center"
                        >
                          <Text className="text-[10.5px] text-neutral-500 font-bold">Try It Fully Blind Instead</Text>
                        </Pressable>
                      </View>
                    </ScrollView>
                  );
                })()
              ) : (
                /* Graded results panel. The accuracy tier decides which
                   logging actions exist: perfect (no missed words) with
                   First Letter mode OFF -> counts as a mastery touch AND a
                   review; perfect WITH First Letter assist, or >=
                   REVIEW_PASS_ACCURACY otherwise -> counts as a review only;
                   below that -> the run logs as a failed attempt. */
                (() => {
                  const summary = summarizeOutcomes(finalOutcomes || []);
                  const drill: 'speak' | 'type' = usedSpeechRef.current ? 'speak' : 'type';
                  const pct = Math.round(summary.accuracy * 100);
                  const passPct = Math.round(REVIEW_PASS_ACCURACY * 100);
                  const assisted = hintMode === 'firstLetter' || recallDisplayMode === 'memoryGrid';
                  const isMasteryEligible = summary.isPerfect && !assisted;
                  return (
                    <ScrollView className="flex-1" contentContainerClassName="items-center justify-center p-4 gap-4" contentContainerStyle={{ flexGrow: 1 }}>
                      <BounceView>
                        <View className={`w-12 h-12 border-2 rounded-full items-center justify-center ${assisted ? 'bg-sky-50 border-sky-600' : 'bg-neutral-100 border-[#1A1A1A]'}`}>
                          <Sparkles size={24} color={assisted ? '#0284c7' : '#171717'} />
                        </View>
                      </BounceView>
                      <View className="items-center">
                        {assisted && (
                          <View className="bg-sky-100 rounded-full px-2 py-0.5 mb-1">
                            <Text className="text-[9px] font-sans font-extrabold text-sky-700 uppercase tracking-wider">First-Letter Assisted</Text>
                          </View>
                        )}
                        <Text className="text-lg font-serif font-bold text-neutral-900 leading-tight">
                          {isMasteryEligible ? 'Perfect Recall!' : summary.passesReview ? (assisted && summary.isPerfect ? 'Nicely Recalled!' : 'Close Enough!') : 'Keep Practicing!'}
                        </Text>
                        <Text className="text-xs text-neutral-500 font-sans mt-0.5">
                          {pct}% word accuracy — {summary.perfectWords} exact
                          {summary.closeWords > 0 ? `, ${summary.closeWords} near-miss` : ''}
                          {summary.missedWords > 0 ? `, ${summary.missedWords} missed` : ''} of {summary.totalWords} words.
                        </Text>
                      </View>

                      <View className="w-full bg-neutral-50 border border-neutral-200 rounded-xl p-3 gap-1.5 max-h-[110px]">
                        <ScrollView>
                          {verses.map((v) => (
                            <Text key={v.verse} className="font-serif italic text-xs text-neutral-600">
                              <Text className="font-sans text-[9px] font-bold text-neutral-400 not-italic">{v.verse} </Text>
                              {v.text}
                            </Text>
                          ))}
                        </ScrollView>
                      </View>

                      <View className="w-full gap-2">
                        {isMasteryEligible ? (
                          <Pressable
                            onPress={() => {
                              onUpdateStatus(verses, 'memorized', drill, { perfect: true });
                              handleGroupComplete();
                            }}
                            className="w-full py-2.5 px-3 bg-emerald-600 rounded-xl flex-row items-center justify-center gap-1.5"
                          >
                            <Check size={14} color="#ffffff" />
                            <Text className="font-sans font-bold text-xs text-white">Log Perfect Recall (counts toward mastery)</Text>
                          </Pressable>
                        ) : summary.passesReview ? (
                          <>
                            <Pressable
                              onPress={() => {
                                onUpdateStatus(verses, 'memorized', drill, { perfect: false });
                                handleGroupComplete();
                              }}
                              className={`w-full py-2.5 px-3 rounded-xl flex-row items-center justify-center gap-1.5 ${assisted ? 'bg-sky-600' : 'bg-indigo-600'}`}
                            >
                              <Check size={14} color="#ffffff" />
                              <Text className="font-sans font-bold text-xs text-white">
                                {assisted ? `Count as Review (First-Letter Assist)` : `Count as Review (${pct}% ≥ ${passPct}%)`}
                              </Text>
                            </Pressable>
                            <Text className="text-center text-[9px] text-neutral-400 font-sans font-bold px-4">
                              {assisted
                                ? 'First-Letter hints mean this counts for spaced review, but never a mastery touch -- switch to % Hidden → Blind for that.'
                                : 'Counts for verses in spaced review. Learning verses only bank a mastery touch on a perfect run.'}
                            </Text>
                          </>
                        ) : (
                          <Pressable
                            onPress={() => {
                              onUpdateStatus(verses, 'learning', drill);
                              handleGroupComplete();
                            }}
                            className="w-full py-2.5 px-3 bg-[#1A1A1A] rounded-xl items-center"
                          >
                            <Text className="font-sans font-bold text-xs text-white">Log as Needs Practice (below {passPct}%)</Text>
                          </Pressable>
                        )}
                        <Pressable onPress={resetReciteGame} className="w-full py-1 items-center">
                          <Text className="text-[10.5px] text-neutral-500 font-bold">Practice Again</Text>
                        </Pressable>
                      </View>
                    </ScrollView>
                  );
                })()
              )
            ) : (
              /* ======================================================== */
              /* REVEAL TAB VIEW                                           */
              /* ======================================================== */
              <View className="flex-1 justify-between">
                {/* Reading Box */}
                <ScrollView className="bg-neutral-50 border border-neutral-200 rounded-2xl flex-1 mb-3" contentContainerClassName="p-4 gap-3 pb-8">
                  {verses.map((v) => (
                    <View key={v.verse}>{renderMaskedText(v)}</View>
                  ))}
                  <View className="flex-row items-center gap-1 bg-white/90 p-1 rounded border border-neutral-100 self-start">
                    <Info size={10} color="#a3a3a3" />
                    <Text className="text-[9px] text-neutral-400 font-bold font-sans">Tap dots to peek, or set masking below</Text>
                  </View>
                </ScrollView>

                {/* Bottom masking control & Feedback buttons */}
                <View className="gap-3 shrink-0">
                  {/* Masking Strength Control */}
                  <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 gap-2">
                    <View className="flex-row justify-between items-center">
                      <Text className="text-[10px] font-sans font-bold text-neutral-600">Masking Strength</Text>
                      <Text className="text-[10px] font-mono font-bold text-neutral-900">{maskLevel}% Hidden</Text>
                    </View>

                    <DiscreteSlider
                      value={maskLevel}
                      onChange={setMaskLevel}
                      options={[
                        { id: 0, label: 'Visible' },
                        { id: 25, label: '25%' },
                        { id: 50, label: '50%' },
                        { id: 75, label: '75%' },
                        { id: 100, label: 'Blank' },
                      ]}
                    />

                    <Pressable
                      onPressIn={() => setPeekActive(true)}
                      onPressOut={() => setPeekActive(false)}
                      className={`w-full py-1.5 border rounded-lg flex-row items-center justify-center gap-1.5 ${
                        peekActive ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-300'
                      }`}
                    >
                      {peekActive ? <EyeOff size={12} color="#ffffff" /> : <Eye size={12} color="#262626" />}
                      <Text className={`font-sans font-bold text-[11px] ${peekActive ? 'text-white' : 'text-neutral-800'}`}>
                        {peekActive ? 'Peeking (release to hide)' : 'Hold to Peek All'}
                      </Text>
                    </Pressable>
                  </View>

                  {/* Assessment Panel */}
                  <View>
                    <Text className="text-center text-[9px] font-sans font-bold text-neutral-400 tracking-wider mb-1.5 uppercase">
                      How well did you recall this passage?
                    </Text>
                    <View className="gap-2">
                      <View className="flex-row gap-2">
                        <Pressable
                          onPress={() => {
                            onUpdateStatus(verses, 'memorized', 'reveal');
                            handleGroupComplete();
                          }}
                          className="flex-1 py-2 px-1 bg-emerald-600 rounded-xl items-center"
                        >
                          <Text className="font-sans font-bold text-[10.5px] text-white">I Got It! (Log Reveal) 🌟</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            resetRevealPeeks();
                            switchLearnTab('recite');
                          }}
                          className="flex-1 py-2 px-1 bg-indigo-600 rounded-xl items-center"
                        >
                          <Text className="font-sans font-bold text-[10.5px] text-white">Recall Instead 🎙️</Text>
                        </Pressable>
                      </View>
                      <Pressable
                        onPress={() => {
                          onUpdateStatus(verses, 'learning');
                          handleGroupComplete();
                        }}
                        className="w-full py-1.5 border border-dashed border-neutral-300 rounded-xl items-center"
                      >
                        <Text className="font-sans font-bold text-[10.5px] text-neutral-500">Need Practice 🔄</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
