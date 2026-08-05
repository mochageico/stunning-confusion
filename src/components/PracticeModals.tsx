import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { hasPlayableAudio, resolvePlaybackUrl } from '../lib/studioAudio';
import {
  Check,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  Eye,
  EyeOff,
  Info,
  Layers,
  ListOrdered,
  Mic,
  MicOff,
  Pause,
  Play,
  Puzzle,
  RefreshCw,
  Repeat,
  SearchCheck,
  Shuffle,
  Sliders,
  Sparkles,
  Trophy,
  Undo2,
  X,
} from 'lucide-react-native';

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
import {
  buildJigsawTiles,
  buildScrambleRounds,
  buildSwapVerses,
  buildUpStages,
  scoreSwapAttempt,
  shuffleOrder,
  BUILD_UP_REPS,
  DEFAULT_SWAPS_PER_VERSE,
  MIN_JIGSAW_VERSES,
  BiteSize,
  BuildDirection,
  JigsawTile,
  ScrambleRound,
  SwapVerse,
} from '../lib/drills';
import { BounceView, ChipRow, DiscreteSlider, FadeInView, SpinView, WaveBars } from './ui';
import { Dropdown } from './Dropdown';
import MemoryGrid, { verseAnnotationKey } from './MemoryGrid';
import { AppText } from './design';

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
  // Studio mode: play the processed render rather than the raw take when one
  // is ready. Threaded through so Listen mode honours the same setting as
  // every other playback surface.
  studioPlaybackEnabled?: boolean;
  // Local audio cache: Storage path -> local file:// URI (see lib/audioCache).
  // Listen mode is the heaviest repeat-listen surface in the app, so it both
  // reads the cache and asks for the current recording to be cached.
  audioCacheMap?: ReadonlyMap<string, string>;
  onCacheAudio?: (recording: Recording) => void;
  // Listen runs its own player and clears playingRecordingId when it starts,
  // so useAppState can't otherwise tell that audio is running -- and it needs
  // to know, to avoid swapping a player's source mid-recitation.
  onListenPlayingChange?: (playing: boolean) => void;
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
  studioPlaybackEnabled = true,
  audioCacheMap,
  onCacheAudio,
  onListenPlayingChange,
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
      // hasPlayableAudio rather than a raw audioUrl check — verse timestamps
      // are equally valid against the studio render, since processing is
      // duration-preserving (enforced by the guard in processStudioAudio).
      const vt = hasPlayableAudio(recording) ? recording!.verseTimestamps?.find((t) => t.verse === verseObj.verse) : undefined;
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
  const listenPlayer = useAudioPlayer(
    resolvePlaybackUrl(currentSegment?.recording, studioPlaybackEnabled, audioCacheMap)
  );
  const listenPlayerStatus = useAudioPlayerStatus(listenPlayer);

  // Report playback state up so useAppState knows not to swap any player's
  // source while Listen is mid-recitation, and ask for whatever recording is
  // playing to be cached. Both are no-ops after the first time for a given
  // file; the cache module de-dupes.
  useEffect(() => {
    onListenPlayingChange?.(listenPlaying);
  }, [listenPlaying, onListenPlayingChange]);

  useEffect(() => {
    return () => onListenPlayingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!listenPlaying || !currentSegment?.recording) return;
    onCacheAudio?.(currentSegment.recording);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenPlaying, currentSegment?.recording]);

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
  // LEARN MODE — Recall (typed + spoken, either channel advances the same
  // word) plus a set of supplementary drills. Every group-practice button in
  // the app opens 'learn' and the mode picker below chooses the drill.
  // Internal value 'recite' is kept for the graded mode (labeled "Recall" in
  // the UI) to avoid touching every reference below.
  //
  // Recall is the ONLY mode here that can advance a review or bank a mastery
  // touch. The three supplementary drills are deliberately ungraded — they
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
  type LearnMode = 'recite' | 'buildUp' | 'jigsaw' | 'scramble' | 'spotSwap';
  const [learnTab, setLearnTab] = useState<LearnMode>('recite');

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

  // Build Up's two settings. They live up here with the other persisted
  // prefs rather than beside the rest of the Build Up state below, because
  // the save effect's dependency array is evaluated during render -- a
  // later declaration is a genuine TDZ crash, not just untidy ordering.
  const [buildSize, setBuildSize] = useState<BiteSize>('medium');
  const [buildDirection, setBuildDirection] = useState<BuildDirection>('forward');

  // Debug aid for tuning speech recognition -- shows the exact raw transcript
  // the speech engine produced (not just the graded/matched result), so it
  // can be screenshotted alongside the grading colors. Off by default (a
  // practice screen for daily use has no reason to show this); persists once
  // turned on since a tuning session usually runs several takes in a row.
  const [showRawTranscript, setShowRawTranscript] = useState(false);

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
        if (saved.gridHideMode === 'firstLetter' || saved.gridHideMode === 'blank') setGridHideMode(saved.gridHideMode);
        if (typeof saved.showRawTranscript === 'boolean') setShowRawTranscript(saved.showRawTranscript);
        if (saved.buildSize === 'short' || saved.buildSize === 'medium' || saved.buildSize === 'long') setBuildSize(saved.buildSize);
        if (saved.buildDirection === 'forward' || saved.buildDirection === 'backward') setBuildDirection(saved.buildDirection);
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
      JSON.stringify({
        hideLevel,
        firstLetterLevel,
        hintMode,
        strikeLimit,
        recallDisplayMode,
        gridHideMode,
        showRawTranscript,
        buildSize,
        buildDirection,
      })
    ).catch(() => {});
  }, [hideLevel, firstLetterLevel, hintMode, strikeLimit, recallDisplayMode, gridHideMode, showRawTranscript, buildSize, buildDirection]);

  // A chained review session (see advanceReviewSession in useAppState.ts)
  // swaps `verses` in place on the SAME mounted PracticeModals instance --
  // no unmount/remount happens between groups, since the overlay itself
  // stays up the whole session. Without this, the next group would inherit
  // the previous group's recitePointer/outcomes/finished state, which are
  // meaningless (even out of bounds) against a differently-sized passage.
  useEffect(() => {
    resetReciteGame();
    regenerateHiddenWords(activeLevel);
    // The supplementary drills hold per-passage puzzle state too (tile
    // placements, decoy positions, round index) -- all of it is meaningless
    // and potentially out of bounds against a different passage, exactly
    // like recitePointer/reciteOutcomes above.
    resetJigsaw();
    resetScramble();
    resetSwap();
    resetBuildUp();
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

  // Jigsaw is only meaningful with enough tiles to genuinely scramble.
  const learnModes = useMemo(
    () =>
      [
        { id: 'recite' as const, label: 'Recall', Icon: Mic },
        { id: 'buildUp' as const, label: 'Build Up', Icon: Layers },
        ...(verses.length >= MIN_JIGSAW_VERSES ? [{ id: 'jigsaw' as const, label: 'Order', Icon: ListOrdered }] : []),
        { id: 'scramble' as const, label: 'Scramble', Icon: Puzzle },
        { id: 'spotSwap' as const, label: 'Spot', Icon: SearchCheck },
      ] as { id: LearnMode; label: string; Icon: typeof Mic }[],
    [verses.length]
  );

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
  // SUPPLEMENTARY DRILL STATE (jigsaw / scramble / spot-the-swap)
  // All three are ungraded — none of them ever call onUpdateStatus. Their
  // puzzle data is built once per passage by src/lib/drills.ts and re-rolled
  // on demand (and whenever `verses` changes, see the reset effect below).
  // ==========================================

  // --- Build up (add-on / snowball) ---
  // Two things move, and never at the same time: `buildStageIdx` is how much
  // of the verse is stacked (only grows when a phrase is finished), and
  // `buildRepIdx` is how much help you're getting right now (resets to 0 --
  // full text -- every time a phrase is added). The three reps ARE the fade;
  // there's no separate repetition counter, because three reps of identical
  // fully-visible text is parroting rather than recall.
  const [buildStageIdx, setBuildStageIdx] = useState(0);
  const [buildRepIdx, setBuildRepIdx] = useState(0);
  // A no-penalty full reveal on the hint/blind reps. Nothing is graded here,
  // so there is nothing to penalise -- being stuck and having no way out is
  // the only real failure state this drill has.
  const [buildPeek, setBuildPeek] = useState(false);
  const [buildFinished, setBuildFinished] = useState(false);
  const [buildSettingsOpen, setBuildSettingsOpen] = useState(false);

  const buildStages = useMemo(
    () => buildUpStages(verses, { size: buildSize, direction: buildDirection }),
    [verses, buildSize, buildDirection]
  );
  const buildStage = buildStages[buildStageIdx];
  const buildRep = BUILD_UP_REPS[buildRepIdx];

  const resetBuildUp = () => {
    setBuildStageIdx(0);
    setBuildRepIdx(0);
    setBuildPeek(false);
    setBuildFinished(false);
  };

  // Changing either setting re-cuts the verse underneath us, so the stage
  // index it was pointing at no longer means anything (and may not exist).
  const changeBuildSize = (size: BiteSize) => {
    setBuildSize(size);
    resetBuildUp();
  };
  const changeBuildDirection = (direction: BuildDirection) => {
    setBuildDirection(direction);
    resetBuildUp();
  };

  // The entire interaction: say it out loud (or in your head -- the app can't
  // tell and shouldn't care), then tap. No mic, no typing, nothing graded.
  const advanceBuildUp = () => {
    setBuildPeek(false);
    if (buildFinished) {
      resetBuildUp();
    } else if (buildRepIdx < BUILD_UP_REPS.length - 1) {
      setBuildRepIdx(buildRepIdx + 1);
    } else if (buildStageIdx < buildStages.length - 1) {
      setBuildStageIdx(buildStageIdx + 1);
      setBuildRepIdx(0);
    } else {
      setBuildFinished(true);
    }
  };

  const stepBackBuildUp = () => {
    setBuildPeek(false);
    if (buildFinished) setBuildFinished(false);
    else if (buildRepIdx > 0) setBuildRepIdx(buildRepIdx - 1);
    else if (buildStageIdx > 0) {
      setBuildStageIdx(buildStageIdx - 1);
      setBuildRepIdx(BUILD_UP_REPS.length - 1);
    }
  };

  // Build up can't count toward review -- the text was on screen for the
  // first of every three reps and the user self-reported by tapping. Rather
  // than pretend otherwise, finishing hands off to a real blind Recall run,
  // which is where the mic and the grading already live.
  const handoffToRecall = () => {
    resetBuildUp();
    setHintMode('percent');
    setHideLevel(100);
    resetReciteGame();
    regenerateHiddenWords(100);
    setLearnTab('recite');
  };

  // Applies the current rep's support level to one segment. 'read' shows the
  // text; 'hint' keeps each word's first letter; 'blind' shows nothing but
  // shape and punctuation. Peeking overrides all of it.
  const maskBuildSegment = (text: string) => {
    if (buildRep === 'read' || buildPeek) return text;
    const maskWord = buildRep === 'hint' ? maskExceptFirstLetter : maskLetters;
    return text
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map(maskWord)
      .join(' ');
  };

  // --- Verse-order jigsaw ---
  const jigsawTiles = useMemo<JigsawTile[]>(() => buildJigsawTiles(verses), [verses]);
  // Bank order (indices into jigsawTiles) and the slot assignments. A slot
  // holds a tile index, or null while empty.
  const [jigsawBankOrder, setJigsawBankOrder] = useState<number[]>(() => shuffleOrder(verses.length));
  const [jigsawSlots, setJigsawSlots] = useState<(number | null)[]>(() => verses.map(() => null));
  const [jigsawChecked, setJigsawChecked] = useState(false);

  const resetJigsaw = () => {
    setJigsawBankOrder(shuffleOrder(jigsawTiles.length));
    setJigsawSlots(jigsawTiles.map(() => null));
    setJigsawChecked(false);
  };

  // --- Phrase scramble ---
  const [scrambleRounds, setScrambleRounds] = useState<ScrambleRound[]>(() => buildScrambleRounds(verses));
  const [scrambleIndex, setScrambleIndex] = useState(0);
  const [scrambleSlots, setScrambleSlots] = useState<(number | null)[]>([]);
  const [scrambleChecked, setScrambleChecked] = useState(false);
  const [scrambleSolved, setScrambleSolved] = useState<Set<number>>(new Set());

  const currentScrambleRound = scrambleRounds[scrambleIndex] ?? null;

  // Slots are sized to whichever verse is on screen, so they have to be
  // rebuilt on every round change (not just on a full reset).
  useEffect(() => {
    setScrambleSlots(currentScrambleRound ? currentScrambleRound.phrases.map(() => null) : []);
    setScrambleChecked(false);
  }, [scrambleIndex, currentScrambleRound]);

  // A round confirms itself as soon as the tiles are in the right order, so
  // the completion mark can't hang off the Check button (which the user
  // never has to press on a correct run).
  useEffect(() => {
    if (!currentScrambleRound) return;
    const complete = scrambleSlots.length > 0 && scrambleSlots.every((p, i) => p === i);
    if (complete) setScrambleSolved((prev) => (prev.has(scrambleIndex) ? prev : new Set(prev).add(scrambleIndex)));
  }, [scrambleSlots, scrambleIndex, currentScrambleRound]);

  const resetScramble = () => {
    setScrambleRounds(buildScrambleRounds(verses));
    setScrambleIndex(0);
    setScrambleChecked(false);
    setScrambleSolved(new Set());
  };

  // --- Spot-the-swap ---
  const [swapsPerVerse, setSwapsPerVerse] = useState(DEFAULT_SWAPS_PER_VERSE);
  const [swapVerses, setSwapVerses] = useState<SwapVerse[]>(() => buildSwapVerses(verses, DEFAULT_SWAPS_PER_VERSE));
  const [swapSelected, setSwapSelected] = useState<Set<number>>(new Set());
  const [swapSubmitted, setSwapSubmitted] = useState(false);

  const resetSwap = (perVerse: number = swapsPerVerse) => {
    setSwapVerses(buildSwapVerses(verses, perVerse));
    setSwapSelected(new Set());
    setSwapSubmitted(false);
  };

  // ==========================================
  // MANUAL LOG — the honest replacement for the old Reveal tab's
  // self-assessment buttons. Available from every mode (and mirrored on
  // Home's due-review rows) for reviews genuinely done off-app: in the car,
  // from a paper card, out loud on a walk. It records the same outcomes the
  // Reveal tab did, just without dressing itself up as a drill.
  //
  // drillType 'reveal' is reused as the TouchLog marker for "self-reported,
  // not machine-graded" -- that's what it has always actually meant, and
  // keeping it avoids a schema change to every historical touch log.
  // ==========================================
  const [showManualLog, setShowManualLog] = useState(false);

  // `perfect` maps onto handleReviewCompleted's contract in useAppState.ts:
  // undefined = "the drill couldn't measure accuracy, treat as a claimed
  // perfect run" (banks a mastery touch), false = counts as a review only.
  const submitManualLog = (outcome: 'perfect' | 'passed' | 'practice') => {
    setShowManualLog(false);
    if (outcome === 'practice') {
      onUpdateStatus(verses, 'learning', 'reveal');
    } else if (outcome === 'passed') {
      onUpdateStatus(verses, 'memorized', 'reveal', { perfect: false });
    } else {
      onUpdateStatus(verses, 'memorized', 'reveal');
    }
    handleGroupComplete();
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
              <AppText variant="micro" className="text-white/60 font-sans font-extrabold uppercase tracking-wider">Now Playing</AppText>
            </View>
            <AppText variant="label" numberOfLines={1} className="text-white font-sans font-bold ">
              {miniVerse ? `${miniVerse.book} ${miniVerse.chapter}:${miniVerse.verse}` : referenceText}
            </AppText>
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
          <AppText variant="title" className="font-serif font-bold text-neutral-900 leading-tight max-w-[280px]" numberOfLines={1}>
            {referenceText}
          </AppText>
        </View>
        <View className="flex-row items-center gap-2">
          {!!sessionTotal && sessionTotal > 1 && (
            <View className="bg-neutral-900 px-2.5 py-1 rounded-full">
              <AppText variant="caption" className="text-white font-mono font-bold">
                {sessionPosition} of {sessionTotal}
              </AppText>
            </View>
          )}
          {/* Manual log -- replaces the old Reveal tab's self-assessment
              buttons. Available from every learn mode, since "I already did
              this off-app" isn't tied to any particular drill. */}
          {type === 'learn' && (
            <Pressable
              onPress={() => setShowManualLog(true)}
              className="w-10 h-10 rounded-full border border-neutral-300 items-center justify-center shrink-0"
              hitSlop={8}
            >
              <ClipboardCheck size={17} color="#262626" />
            </Pressable>
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

      {/* ======================================================== */}
      {/* MANUAL LOG SHEET                                          */}
      {/* ======================================================== */}
      {showManualLog && (
        <View className="absolute inset-0 bg-black/40 z-[60] justify-end" id="manual_log_sheet">
          <Pressable className="flex-1" onPress={() => setShowManualLog(false)} />
          <View className="bg-white rounded-t-3xl p-5 gap-3" style={{ paddingBottom: insets.bottom + 20 }}>
            <View className="items-center gap-1 mb-1">
              <ClipboardCheck size={22} color="#171717" />
              <AppText variant="title" className="font-serif font-bold text-neutral-900">Log this review manually</AppText>
              <AppText variant="caption" className="text-neutral-500 font-sans text-center px-2">
                For reviews you actually did — out loud in the car, from a card, anywhere but here. {referenceText}
              </AppText>
            </View>

            <Pressable onPress={() => submitManualLog('perfect')} className="w-full py-2.5 bg-emerald-600 rounded-xl items-center">
              <AppText variant="label" className="font-sans font-bold text-white">Perfect — no mistakes</AppText>
              <AppText variant="micro" className="text-emerald-100 font-sans mt-0.5">Counts as a review and toward mastery</AppText>
            </Pressable>

            <Pressable onPress={() => submitManualLog('passed')} className="w-full py-2.5 bg-indigo-600 rounded-xl items-center">
              <AppText variant="label" className="font-sans font-bold text-white">Got it, with a stumble</AppText>
              <AppText variant="micro" className="text-indigo-100 font-sans mt-0.5">Counts as a review only, no mastery touch</AppText>
            </Pressable>

            <Pressable onPress={() => submitManualLog('practice')} className="w-full py-2 border border-dashed border-neutral-300 rounded-xl items-center">
              <AppText variant="caption" className="font-sans font-bold text-neutral-500">Needs more practice</AppText>
            </Pressable>

            <Pressable onPress={() => setShowManualLog(false)} className="w-full py-1.5 items-center">
              <AppText variant="caption" className="font-sans font-bold text-neutral-400">Cancel</AppText>
            </Pressable>
          </View>
        </View>
      )}

      {/* Main Panel */}
      <View className="flex-1 justify-between py-1">
        {/* ======================================================== */}
        {/* LISTEN MODE VIEW */}
        {/* ======================================================== */}
        {type === 'listen' && (
          <View className="flex-1 justify-between">
            {/* View + Verse Selection -- dropdowns instead of always-visible
                buttons/chips, to cut down on-screen clutter. Both tap
                through to the same handleVerseClick regardless of which
                display mode is picked. */}
            <View className="flex-row gap-2 mb-2.5 shrink-0">
              <View className="flex-1">
                <Dropdown
                  value={listenViewMode}
                  onChange={setListenViewMode}
                  options={[
                    { id: 'verses', label: 'Verse List' },
                    { id: 'memoryGrid', label: 'Memory Grid' },
                  ]}
                  title="Display"
                  placeholder="View"
                  staticLabel
                  searchable={false}
                />
              </View>
              {((memoryQueue && memoryQueue.length > 0) || (allVerses && allVerses.length > 0)) && (
                <View className="flex-1">
                  <Dropdown
                    value={playSource}
                    onChange={setPlaySource}
                    options={[
                      { id: 'all', label: "Today's Verses" },
                      { id: 'memorization', label: 'Learning' },
                      { id: 'reviewing', label: 'Review' },
                      { id: 'priming', label: 'Priming' },
                      { id: 'selection', label: 'Selected' },
                    ]}
                    title="Verse Selection"
                    placeholder="Verse Selection"
                    staticLabel
                    searchable={false}
                  />
                </View>
              )}
            </View>

            {playSource === 'priming' && setPrimingLookahead && (
              <View className="flex-row items-center justify-between bg-amber-50 border border-amber-100 rounded-lg p-2 mb-2.5">
                <View>
                  <AppText variant="micro" className="font-sans font-bold text-amber-800 uppercase tracking-wider">⚡ Priming Window Size</AppText>
                  <AppText variant="micro" className="font-sans text-amber-700 leading-none">Set lookahead priming size</AppText>
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
                        <AppText variant="micro" className={`font-sans font-extrabold uppercase tracking-wide ${refClassName}`}>
                          {verseObj.book} {verseObj.chapter}:{verseObj.verse}
                        </AppText>
                        {!hasAudio && (
                          <AppText variant="micro" className={`font-sans font-bold uppercase tracking-wide ${isActive ? 'text-white/50' : 'text-neutral-300'}`}>
                            No audio
                          </AppText>
                        )}
                      </View>
                      <AppText variant="body" className={`font-serif leading-relaxed ${textClassName}`}>{verseObj.text}</AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>
              )}

              {/* Selection Mode Instructions overlay */}
              {playSource === 'selection' && (
                <View className="absolute top-2 right-2 bg-amber-500/10 px-2 py-1 rounded border border-amber-200 z-10" pointerEvents="none">
                  <AppText variant="micro" className="font-sans font-bold text-amber-800">
                    {selectionStart === null ? 'Tap verse to set start' : selectionEnd === null ? 'Tap verse to set end' : 'Segment active'}
                  </AppText>
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
                      <AppText variant="micro" className="font-sans font-extrabold text-neutral-800">Reset Segment</AppText>
                    </Pressable>
                  ) : (
                    <AppText variant="micro" className="font-sans font-bold text-neutral-400 uppercase tracking-wider">
                      {playSource === 'selection' ? 'Tap verse to select segment' : 'Playlist Auto-playback'}
                    </AppText>
                  )}
                </View>

                <View className="bg-white border border-neutral-200 px-2 py-1 rounded-lg">
                  <WaveBars active={listenPlaying} count={5} />
                </View>
              </View>
            </View>

            {/* Custom Control and Audio Looping Panel */}
            <View className="gap-3.5 bg-white pt-2">
              {!hasAnyAudio ? (
                <View className="items-center gap-1.5 py-4 bg-neutral-50 rounded-xl border border-dashed border-neutral-300">
                  <AppText variant="label" className="font-sans font-bold text-neutral-600">No audio recorded for these verses yet</AppText>
                  <AppText variant="caption" className="font-sans text-neutral-400 text-center px-6 leading-relaxed">
                    Record a recitation from the Record tab, or select a narration for this chapter from its Chapter
                    Landing page — playback here uses whichever recording is set there.
                  </AppText>
                </View>
              ) : (
                <>
                  {/* Adjusters: Speed (.25 steps) and Repeat mode */}
                  <View className="flex-row gap-2">
                    {/* 1. Playback Speed Selector */}
                    <View className="flex-1 justify-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 gap-1">
                      <View className="flex-row items-center gap-1">
                        <Sliders size={10} color="#737373" />
                        <AppText variant="micro" className="font-sans font-bold text-neutral-500 uppercase tracking-wider">Speed (±0.2)</AppText>
                      </View>
                      <View className="flex-row items-center justify-between bg-white px-2 py-1 rounded-lg border border-neutral-200">
                        <Pressable
                          onPress={() => setListenSpeed((s) => Math.max(0.4, Number((s - 0.2).toFixed(1))))}
                          className="w-5 h-5 bg-neutral-100 border border-neutral-300 rounded items-center justify-center"
                        >
                          <AppText variant="label" className="font-black text-neutral-800">-</AppText>
                        </Pressable>
                        <AppText variant="label" className="font-mono font-bold text-neutral-900">{listenSpeed.toFixed(1)}x</AppText>
                        <Pressable
                          onPress={() => setListenSpeed((s) => Math.min(2.0, Number((s + 0.2).toFixed(1))))}
                          className="w-5 h-5 bg-neutral-100 border border-neutral-300 rounded items-center justify-center"
                        >
                          <AppText variant="label" className="font-black text-neutral-800">+</AppText>
                        </Pressable>
                      </View>
                    </View>

                    {/* 2. Audio Repeat Control */}
                    <View className="flex-1 justify-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 gap-1">
                      <View className="flex-row items-center gap-1">
                        <Repeat size={10} color="#737373" />
                        <AppText variant="micro" className="font-sans font-bold text-neutral-500 uppercase tracking-wider">Repeat Setting</AppText>
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
                      <AppText variant="micro" className="font-bold text-neutral-400 font-mono">START</AppText>
                      <AppText variant="micro" className="font-bold text-neutral-400 font-mono">
                        Verse {currentVerseIndex + 1} of {activePlayVerses.length}
                      </AppText>
                      <AppText variant="micro" className="font-bold text-neutral-400 font-mono">END</AppText>
                    </View>
                    <View className="w-full bg-neutral-200 h-1.5 rounded-full overflow-hidden">
                      <View className="bg-[#1A1A1A] h-full" style={{ width: `${overallListenProgressPercent}%` }} />
                    </View>
                  </View>

                  {/* Main player controls row */}
                  <View className="flex-row gap-2.5 pb-1">
                    <Pressable onPress={restartListen} className="flex-1 py-2.5 px-3 border-2 border-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5">
                      <RefreshCw size={12} color="#1A1A1A" />
                      <AppText variant="label" className="font-sans font-bold text-[#1A1A1A]">Restart</AppText>
                    </Pressable>
                    <Pressable
                      onPress={toggleListenPlaying}
                      className={`flex-[2] py-2.5 px-3 rounded-xl flex-row items-center justify-center gap-1.5 ${
                        listenPlaying ? 'bg-neutral-900' : 'bg-emerald-600'
                      }`}
                    >
                      {listenPlaying ? <Pause size={12} color="#ffffff" /> : <Play size={12} color="#ffffff" />}
                      <AppText variant="label" className="font-sans font-bold text-white">{listenPlaying ? 'Pause Audio' : 'Start Looping'}</AppText>
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
                  <AppText variant="caption" className="text-white font-sans font-bold">{localToast}</AppText>
                </View>
              </BounceView>
            )}

            {/* Mode picker. Recall is the only graded mode; the rest are
                supplementary drills (see the LearnMode comment above). */}
            {/* Five modes no longer fit one row at a readable size (and
                certainly not at 1.5x text scale), so this wraps -- centred,
                so a trailing partial row reads as a deliberate group instead
                of a layout bug. Chips size to their content rather than
                flex-1 for the same reason ChipRow's wrap mode does: dividing
                the row evenly squeezes the longest label to a sliver. */}
            <View className="flex-row flex-wrap justify-center bg-neutral-100 p-1 rounded-xl mb-3.5 border border-neutral-200 shrink-0 gap-y-1">
              {learnModes.map(({ id, label, Icon }) => {
                const active = learnTab === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => switchLearnTab(id)}
                    className={`py-1.5 px-2.5 rounded-lg flex-row items-center justify-center gap-1 ${active ? 'bg-[#1A1A1A]' : ''}`}
                  >
                    <Icon size={12} color={active ? '#ffffff' : '#737373'} />
                    <AppText variant="micro" className={`uppercase tracking-wider font-sans font-extrabold ${active ? 'text-white' : 'text-neutral-500'}`} numberOfLines={1} >
                      {label}
                    </AppText>
                  </Pressable>
                );
              })}
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
                          <AppText variant="body" className="font-sans font-extrabold text-red-900">Verse Restarting!</AppText>
                          <AppText variant="caption" className="text-red-700/85 font-medium px-4 text-center">
                            You reached the strike limit. Let's try this verse again from the beginning!
                          </AppText>
                        </View>
                      </FadeInView>
                    )}

                    <View className="flex-row bg-neutral-100 p-0.5 rounded-lg mb-2 shrink-0">
                      <Pressable
                        onPress={() => setRecallDisplayMode('passage')}
                        className={`flex-1 py-1 rounded-md items-center ${recallDisplayMode === 'passage' ? 'bg-white' : ''}`}
                      >
                        <AppText variant="micro" className={`font-sans font-extrabold uppercase tracking-wider ${recallDisplayMode === 'passage' ? 'text-neutral-900' : 'text-neutral-500'}`}>
                          Passage
                        </AppText>
                      </Pressable>
                      <Pressable
                        onPress={() => setRecallDisplayMode('memoryGrid')}
                        className={`flex-1 py-1 rounded-md items-center ${recallDisplayMode === 'memoryGrid' ? 'bg-sky-600' : ''}`}
                      >
                        <AppText variant="micro" className={`font-sans font-extrabold uppercase tracking-wider ${recallDisplayMode === 'memoryGrid' ? 'text-white' : 'text-neutral-500'}`}>
                          Memory Grid
                        </AppText>
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
                          hideMode={gridHideMode}
                        />
                      </ScrollView>
                    ) : (
                    <ScrollView className="flex-1 mb-2">
                      <AppText variant="micro" className="font-sans font-bold text-neutral-400 tracking-wider mb-1">
                        Recall Practice — {verses.length} {verses.length === 1 ? 'verse' : 'verses'} ({referenceText})
                      </AppText>

                      <View className="gap-3">
                        {(() => {
                          let flatIdx = 0;
                          return verses.map((v) => {
                            const words = v.text.split(/\s+/);
                            return (
                              <AppText variant="body" key={`${v.book}-${v.chapter}-${v.verse}`} className="font-serif leading-relaxed text-neutral-800">
                                <AppText variant="caption" className="font-sans font-bold text-neutral-400">{v.verse} </AppText>
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
                                        className={`font-serif font-semibold ${gradeClass}`}
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
                                      <Text key={idx} className="font-serif text-neutral-800">
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
                                        className={`font-serif rounded px-1 ${isCurrent ? 'bg-amber-50 text-neutral-600' : 'text-neutral-400'}`}
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
                                        className={`font-serif rounded px-1 font-mono font-bold ${
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
                                      className={`font-serif rounded px-1 font-mono font-bold ${
                                        isCurrent ? 'bg-amber-50 text-neutral-500' : 'bg-neutral-50 text-neutral-300'
                                      }`}
                                    >
                                      {maskLetters(w)}{' '}
                                    </Text>
                                  );
                                })}
                              </AppText>
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
                            <AppText variant="caption" className="text-red-500 font-medium">Verse errors: {verseStrikes}/{strikeLimit}</AppText>
                          )}
                        </View>
                        <View className="flex-row items-center gap-2">
                          <AppText variant="caption" className="text-neutral-400 font-bold">{recitePointer} of {reciteWordObjects.length} words</AppText>
                          {speechAvailable && (
                            <Pressable hitSlop={8} onPress={() => setShowRawTranscript((v) => !v)}>
                              {showRawTranscript ? <Eye size={12} color="#6366f1" /> : <EyeOff size={12} color="#c7c7c7" />}
                            </Pressable>
                          )}
                        </View>
                      </View>

                      <View className="flex-row items-center gap-2">
                        <TextInput
                          value={typedInput}
                          onChangeText={handleReciteTypeChar}
                          placeholder={showStrikeResetAlert ? 'Resetting...' : 'Type first letter of each word (nearby keys count)...'}
                          className="flex-1 bg-neutral-50 border border-neutral-300 rounded-xl py-2 px-3 text-center font-sans font-semibold text-xs text-neutral-900"
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
                      {/* Raw transcript debug view -- exactly what the speech
                          engine produced, before any grading/matching. Stays
                          visible after stopping (doesn't clear until a new
                          attempt) so a finished take can be screenshotted. */}
                      {showRawTranscript && speakTranscript !== '' && (
                        <View className="bg-indigo-50 border border-indigo-100 rounded-lg p-2 gap-0.5">
                          <AppText variant="micro" className="font-sans font-extrabold text-indigo-400 uppercase tracking-wider">Raw Transcript</AppText>
                          <AppText variant="caption" className="font-mono text-indigo-900 leading-snug">{speakTranscript}</AppText>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Accuracy Settings Bar */}
                  <View className="mt-2.5 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 gap-1.5">
                    <View className="flex-row justify-between items-center px-1">
                      <AppText variant="micro" className="font-sans font-extrabold text-neutral-400 tracking-wider uppercase">Strike Reset Limit (Accuracy Assist)</AppText>
                      <AppText variant="micro" className="font-mono font-bold text-neutral-500">
                        {strikeLimit === 'unlimited' ? 'No Reset' : `${strikeLimit} Max Strikes`}
                      </AppText>
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
                      see the finish panel split below. Passage-mode only --
                      %-hidden has no meaning against the grid, which is
                      always first-letter (or now, always blank). */}
                  {recallDisplayMode === 'passage' && (
                    <View className="mt-2.5 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 gap-1.5">
                      <View className="flex-row justify-between items-center px-1">
                        <AppText variant="micro" className="font-sans font-extrabold text-neutral-400 tracking-wider uppercase">
                          {hintMode === 'firstLetter' ? 'First Letter Hints' : 'Words Hidden'}
                        </AppText>
                        <AppText variant="micro" className={`font-mono font-bold ${hintMode === 'firstLetter' ? 'text-sky-600' : 'text-neutral-500'}`}>
                          {activeLevel}% hidden
                          {hintMode === 'percent' && activeLevel < 100 ? ' -- practice only' : ''}
                          {hintMode === 'firstLetter' ? ' -- review, not mastery' : ''}
                        </AppText>
                      </View>
                      <View className="flex-row bg-neutral-200/70 p-0.5 rounded-lg">
                        <Pressable
                          onPress={() => switchHintMode('percent')}
                          className={`flex-1 py-1 rounded-md items-center ${hintMode === 'percent' ? 'bg-white' : ''}`}
                        >
                          <AppText variant="micro" className={`font-sans font-extrabold ${hintMode === 'percent' ? 'text-neutral-900' : 'text-neutral-500'}`}>
                            % Hidden
                          </AppText>
                        </Pressable>
                        <Pressable
                          onPress={() => switchHintMode('firstLetter')}
                          className={`flex-1 py-1 rounded-md items-center ${hintMode === 'firstLetter' ? 'bg-sky-600' : ''}`}
                        >
                          <AppText variant="micro" className={`font-sans font-extrabold ${hintMode === 'firstLetter' ? 'text-white' : 'text-neutral-500'}`}>
                            First Letter
                          </AppText>
                        </Pressable>
                      </View>
                      {hintMode === 'percent' && (
                        <DiscreteSlider
                          value={activeLevel}
                          onChange={(level) => {
                            setActiveLevel(level);
                            resetReciteGame();
                            regenerateHiddenWords(level);
                          }}
                          options={[0, 25, 50, 75, 100].map((level) => ({ id: level, label: level === 100 ? 'Blind' : `${level}%` }))}
                        />
                      )}
                    </View>
                  )}

                  {/* Memory Grid's own hide setting -- no slider, since the
                      grid is either showing first letters or not; there's no
                      in-between percentage to speak of. */}
                  {recallDisplayMode === 'memoryGrid' && (
                    <View className="mt-2.5 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 gap-1.5">
                      <AppText variant="micro" className="font-sans font-extrabold text-neutral-400 tracking-wider uppercase px-1">
                        Memory Grid Display
                      </AppText>
                      <View className="flex-row bg-neutral-200/70 p-0.5 rounded-lg">
                        <Pressable
                          onPress={() => setGridHideMode('firstLetter')}
                          className={`flex-1 py-1 rounded-md items-center ${gridHideMode === 'firstLetter' ? 'bg-white' : ''}`}
                        >
                          <AppText variant="micro" className={`font-sans font-extrabold ${gridHideMode === 'firstLetter' ? 'text-neutral-900' : 'text-neutral-500'}`}>
                            First Letter
                          </AppText>
                        </Pressable>
                        <Pressable
                          onPress={() => setGridHideMode('blank')}
                          className={`flex-1 py-1 rounded-md items-center ${gridHideMode === 'blank' ? 'bg-sky-600' : ''}`}
                        >
                          <AppText variant="micro" className={`font-sans font-extrabold ${gridHideMode === 'blank' ? 'text-white' : 'text-neutral-500'}`}>
                            Fully Hidden
                          </AppText>
                        </Pressable>
                      </View>
                    </View>
                  )}

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
                      <AppText variant="label" className="font-sans font-bold text-neutral-600">Reset Passage</AppText>
                    </Pressable>
                    <Pressable onPress={handleReciteHint} className="flex-1 py-2 px-3 border-2 border-[#1A1A1A] rounded-xl items-center justify-center">
                      <AppText variant="label" className="font-sans font-bold text-neutral-900">Reveal Word</AppText>
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
                        <AppText variant="title" className="font-serif font-bold text-neutral-900 leading-tight">Nice practice run!</AppText>
                        <AppText variant="label" className="text-neutral-500 font-sans mt-0.5 text-center px-6 leading-relaxed">
                          {pct}% word accuracy with {hideLevel}% of words hidden. Anything short of fully blind is warm-up
                          only — it never counts toward a mastery touch or a review.
                        </AppText>
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
                          <AppText variant="label" className="font-sans font-bold text-white">Practice Again (new words hidden)</AppText>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setHideLevel(100);
                            resetReciteGame();
                            regenerateHiddenWords(100);
                          }}
                          className="w-full py-1 items-center"
                        >
                          <AppText variant="caption" className="text-neutral-500 font-bold">Try It Fully Blind Instead</AppText>
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
                            <AppText variant="micro" className="font-sans font-extrabold text-sky-700 uppercase tracking-wider">First-Letter Assisted</AppText>
                          </View>
                        )}
                        <AppText variant="title" className="font-serif font-bold text-neutral-900 leading-tight">
                          {isMasteryEligible ? 'Perfect Recall!' : summary.passesReview ? (assisted && summary.isPerfect ? 'Nicely Recalled!' : 'Close Enough!') : 'Keep Practicing!'}
                        </AppText>
                        <AppText variant="label" className="text-neutral-500 font-sans mt-0.5">
                          {pct}% word accuracy — {summary.perfectWords} exact
                          {summary.closeWords > 0 ? `, ${summary.closeWords} near-miss` : ''}
                          {summary.missedWords > 0 ? `, ${summary.missedWords} missed` : ''} of {summary.totalWords} words.
                        </AppText>
                      </View>

                      <View className="w-full bg-neutral-50 border border-neutral-200 rounded-xl p-3 gap-1.5 max-h-[110px]">
                        <ScrollView>
                          {verses.map((v) => (
                            <AppText variant="label" key={v.verse} className="font-serif italic text-neutral-600">
                              <AppText variant="micro" className="font-sans font-bold text-neutral-400 not-italic">{v.verse} </AppText>
                              {v.text}
                            </AppText>
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
                            <AppText variant="label" className="font-sans font-bold text-white">Log Perfect Recall (counts toward mastery)</AppText>
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
                              <AppText variant="label" className="font-sans font-bold text-white">
                                {assisted ? `Count as Review (First-Letter Assist)` : `Count as Review (${pct}% ≥ ${passPct}%)`}
                              </AppText>
                            </Pressable>
                            <AppText variant="micro" className="text-center text-neutral-400 font-sans font-bold px-4">
                              {assisted
                                ? 'With first-letter hints on, this counts as a review but never as a mastery touch. Switch to % Hidden, set to fully blind, for that.'
                                : 'Counts for verses in spaced review. Learning verses only bank a mastery touch on a perfect run.'}
                            </AppText>
                          </>
                        ) : (
                          <Pressable
                            onPress={() => {
                              onUpdateStatus(verses, 'learning', drill);
                              handleGroupComplete();
                            }}
                            className="w-full py-2.5 px-3 bg-[#1A1A1A] rounded-xl items-center"
                          >
                            <AppText variant="label" className="font-sans font-bold text-white">Log as Needs Practice (below {passPct}%)</AppText>
                          </Pressable>
                        )}
                        <Pressable onPress={resetReciteGame} className="w-full py-1 items-center">
                          <AppText variant="caption" className="text-neutral-500 font-bold">Practice Again</AppText>
                        </Pressable>
                      </View>
                    </ScrollView>
                  );
                })()
              )
            ) : learnTab === 'jigsaw' ? (
              /* ======================================================== */
              /* VERSE-ORDER JIGSAW — reassemble the passage's verses in    */
              /* order. Ungraded: tests sequence memory, which word-        */
              /* accuracy grading doesn't model at all.                     */
              /* ======================================================== */
              (() => {
                const placed = jigsawSlots.filter((s) => s !== null).length;
                const allPlaced = placed === jigsawTiles.length;
                const correctCount = jigsawSlots.filter((tileIdx, slotIdx) => tileIdx !== null && jigsawTiles[tileIdx].correctIndex === slotIdx).length;
                const solved = allPlaced && correctCount === jigsawTiles.length;
                const bankRemaining = jigsawBankOrder.filter((t) => !jigsawSlots.includes(t));

                return (
                  <View className="flex-1 justify-between">
                    <ScrollView className="flex-1 mb-2" contentContainerClassName="gap-2 pb-2">
                      <View className="flex-row items-center gap-1 mb-0.5">
                        <Info size={10} color="#a3a3a3" />
                        <AppText variant="micro" className="text-neutral-400 font-bold font-sans">
                          Tap a verse to place it, tap a placed verse to take it back
                        </AppText>
                      </View>

                      {/* Ordered slots */}
                      {jigsawSlots.map((tileIdx, slotIdx) => {
                        const tile = tileIdx === null ? null : jigsawTiles[tileIdx];
                        const isRight = tile !== null && tile.correctIndex === slotIdx;
                        const showResult = jigsawChecked && tile !== null;
                        return (
                          <Pressable
                            key={`slot-${slotIdx}`}
                            onPress={() => {
                              if (tileIdx === null) return;
                              setJigsawSlots((prev) => prev.map((s, i) => (i === slotIdx ? null : s)));
                              setJigsawChecked(false);
                            }}
                            className={`border-2 rounded-xl p-2.5 min-h-[52px] justify-center ${
                              tile === null
                                ? 'border-dashed border-neutral-300 bg-neutral-50'
                                : showResult
                                  ? isRight
                                    ? 'border-emerald-500 bg-emerald-50'
                                    : 'border-red-400 bg-red-50'
                                  : 'border-[#1A1A1A] bg-white'
                            }`}
                          >
                            {tile === null ? (
                              <AppText variant="caption" className="font-sans font-bold text-neutral-400">Slot {slotIdx + 1}</AppText>
                            ) : (
                              <View className="flex-row items-start gap-2">
                                <View className={`px-1.5 py-0.5 rounded ${showResult ? (isRight ? 'bg-emerald-600' : 'bg-red-500') : 'bg-neutral-900'}`}>
                                  <AppText variant="micro" className="font-mono font-bold text-white">{slotIdx + 1}</AppText>
                                </View>
                                <AppText variant="label" className="font-serif leading-snug text-neutral-800 flex-1">{tile.text}</AppText>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}

                      {/* Tile bank */}
                      {bankRemaining.length > 0 && (
                        <View className="mt-1 gap-2">
                          <AppText variant="micro" className="font-sans font-bold text-neutral-400 uppercase tracking-wider">Verses to place</AppText>
                          {bankRemaining.map((tileIdx) => (
                            <Pressable
                              key={`bank-${jigsawTiles[tileIdx].id}`}
                              onPress={() => {
                                const firstEmpty = jigsawSlots.findIndex((s) => s === null);
                                if (firstEmpty === -1) return;
                                setJigsawSlots((prev) => prev.map((s, i) => (i === firstEmpty ? tileIdx : s)));
                                setJigsawChecked(false);
                              }}
                              className="border border-neutral-300 bg-neutral-50 rounded-xl p-2.5"
                            >
                              <AppText variant="label" className="font-serif leading-snug text-neutral-700">{jigsawTiles[tileIdx].text}</AppText>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </ScrollView>

                    <View className="shrink-0 gap-2">
                      {solved ? (
                        <View className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 flex-row items-center justify-center gap-2">
                          <Trophy size={14} color="#059669" />
                          <AppText variant="caption" className="font-sans font-bold text-emerald-800">Correct order! Practice only — nothing logged.</AppText>
                        </View>
                      ) : jigsawChecked ? (
                        <View className="bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                          <AppText variant="caption" className="font-sans font-bold text-amber-800 text-center">
                            {correctCount} of {jigsawTiles.length} in the right place — tap a wrong one to move it.
                          </AppText>
                        </View>
                      ) : null}
                      <View className="flex-row gap-2">
                        <Pressable onPress={resetJigsaw} className="flex-1 py-2 border border-neutral-300 rounded-xl flex-row items-center justify-center gap-1.5">
                          <Undo2 size={13} color="#404040" />
                          <AppText variant="caption" className="font-sans font-bold text-neutral-700">Reshuffle</AppText>
                        </Pressable>
                        <Pressable
                          onPress={() => setJigsawChecked(true)}
                          disabled={!allPlaced}
                          className={`flex-1 py-2 rounded-xl flex-row items-center justify-center gap-1.5 ${allPlaced ? 'bg-[#1A1A1A]' : 'bg-neutral-200'}`}
                        >
                          <Check size={13} color={allPlaced ? '#ffffff' : '#a3a3a3'} />
                          <AppText variant="caption" className={`font-sans font-bold ${allPlaced ? 'text-white' : 'text-neutral-400'}`}>Check Order</AppText>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })()
            ) : learnTab === 'buildUp' ? (
              /* ======================================================== */
              /* BUILD UP — learn a verse a phrase at a time, each stage    */
              /* adding one bite to everything already stacked, each stage  */
              /* fading from full text to first letters to nothing.         */
              /* Ungraded; hands off to a blind Recall run at the end.      */
              /* ======================================================== */
              (() => {
                if (!buildStage && !buildFinished) {
                  return (
                    <View className="flex-1 items-center justify-center px-6 gap-2">
                      <Layers size={28} color="#a3a3a3" />
                      <AppText variant="body" className="font-sans font-bold text-neutral-600 text-center">Nothing to build</AppText>
                      <AppText variant="caption" className="text-neutral-400 font-sans text-center">There's no verse text here to split into phrases.</AppText>
                    </View>
                  );
                }

                if (buildFinished) {
                  return (
                    <View className="flex-1 items-center justify-center gap-3 px-4">
                      <View className="w-12 h-12 rounded-full bg-emerald-100 items-center justify-center">
                        <Check size={24} color="#059669" />
                      </View>
                      <AppText variant="body" className="font-sans font-bold text-neutral-800 text-center">
                        {verses.length > 1 ? 'The whole passage, from memory' : 'The whole verse, from memory'}
                      </AppText>
                      <AppText variant="caption" className="text-neutral-500 font-sans text-center leading-[18px]">
                        Build Up doesn't count toward review — the words were on screen and you graded yourself. Want to prove it cold?
                      </AppText>
                      <Pressable onPress={handoffToRecall} className="w-full py-3 rounded-xl bg-[#1A1A1A] flex-row items-center justify-center gap-1.5">
                        <Mic size={14} color="#ffffff" />
                        <AppText variant="label" className="font-sans font-bold text-white">Try it blind in Recall</AppText>
                      </Pressable>
                      <Pressable onPress={resetBuildUp} className="w-full py-2 rounded-xl border border-neutral-300 flex-row items-center justify-center gap-1.5">
                        <RefreshCw size={13} color="#404040" />
                        <AppText variant="caption" className="font-sans font-bold text-neutral-700">Run it again</AppText>
                      </Pressable>
                    </View>
                  );
                }

                const stage = buildStage;
                const verse = verses[stage.verseIndex];
                const isLastRep = buildRepIdx === BUILD_UP_REPS.length - 1;
                const isLastStage = buildStageIdx === buildStages.length - 1;
                // The button names the one thing to do right now, so the rep
                // ladder never has to be interpreted to know what's being
                // asked. The exception is the blind rep, where the ladder is
                // already saying "from memory" and the useful thing to name
                // is what the tap commits you to next.
                const actionLabel = !isLastRep
                  ? buildRep === 'read'
                    ? 'Read it aloud'
                    : 'Say it with hints'
                  : isLastStage
                    ? 'Finish'
                    : stage.step === stage.stepCount
                      ? buildStages[buildStageIdx + 1]?.phase === 'reassemble'
                        ? 'Put it all together'
                        : 'Next verse'
                      : stage.phase === 'reassemble'
                        ? 'Add the next verse'
                        : 'Add the next phrase';

                return (
                  <View className="flex-1 justify-between">
                    {/* Progress: how much is stacked, and where we are. */}
                    <View className="shrink-0 gap-1.5 mb-2">
                      <View className="flex-row items-center justify-between">
                        <AppText variant="micro" className="font-sans font-bold text-neutral-400 uppercase tracking-wider">
                          {stage.phase === 'reassemble'
                            ? `Putting it together — verse ${stage.step} of ${stage.stepCount}`
                            : `${verse ? `${verse.chapter}:${verse.verse} — ` : ''}phrase ${stage.step} of ${stage.stepCount}`}
                        </AppText>
                        <Pressable onPress={() => setBuildSettingsOpen((p) => !p)} hitSlop={8} className="flex-row items-center gap-1">
                          <Sliders size={12} color="#737373" />
                          <AppText variant="micro" className="font-sans font-bold text-neutral-500 uppercase tracking-wider">
                            {buildDirection === 'forward' ? 'Forward' : 'Backward'}
                          </AppText>
                        </Pressable>
                      </View>

                      <View className="flex-row gap-1">
                        {Array.from({ length: stage.stepCount }).map((_, i) => {
                          // Backward chaining fills from the right, so the bar
                          // mirrors what's actually on screen.
                          const filledFromEnd = buildDirection === 'backward';
                          const pos = filledFromEnd ? stage.stepCount - 1 - i : i;
                          const inPlay = pos < stage.step;
                          const isNewest = pos === stage.step - 1;
                          return (
                            <View
                              key={i}
                              className={`h-1.5 flex-1 rounded-full ${isNewest ? 'bg-amber-500' : inPlay ? 'bg-[#1A1A1A]' : 'bg-neutral-200'}`}
                            />
                          );
                        })}
                      </View>
                    </View>

                    {/* Bite size lives behind the gear rather than on a setup
                        screen -- it's a once-in-a-while decision, and a card
                        between the user and phrase 1 is a tax on every
                        session to serve the rare one. */}
                    {buildSettingsOpen && (
                      <View className="shrink-0 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 gap-2 mb-2">
                        {/* Label ABOVE the chips, not beside them. ChipRow's
                            default chips are flex-1, so they need the full
                            row width to divide -- sitting them next to a label
                            in a justify-between row leaves them sizing against
                            whatever's left over, and the labels spill out. */}
                        <View className="gap-1">
                          <AppText variant="caption" className="font-sans font-bold text-neutral-600">Bite size</AppText>
                          <ChipRow
                            options={[
                              { id: 'short' as BiteSize, label: 'Short' },
                              { id: 'medium' as BiteSize, label: 'Medium' },
                              { id: 'long' as BiteSize, label: 'Long' },
                            ]}
                            value={buildSize}
                            onChange={changeBuildSize}
                          />
                        </View>
                        <View className="gap-1">
                          <AppText variant="caption" className="font-sans font-bold text-neutral-600">Build from</AppText>
                          <ChipRow
                            options={[
                              { id: 'forward' as BuildDirection, label: 'The start' },
                              { id: 'backward' as BuildDirection, label: 'The end' },
                            ]}
                            value={buildDirection}
                            onChange={changeBuildDirection}
                          />
                        </View>
                        <AppText variant="caption" className="text-neutral-400 font-sans leading-[15px]">
                          Building from the end means every repetition finishes on the words you know best. Changing either setting restarts the verse.
                        </AppText>
                      </View>
                    )}

                    {/* The passage. Everything in play fades together; the
                        phrase just added is the amber one. */}
                    <ScrollView className="flex-1" contentContainerClassName="grow justify-center py-2">
                      <View className="border-2 border-[#1A1A1A] bg-white rounded-2xl p-4">
                        <AppText variant="title" className="font-serif leading-[30px]">
                          {stage.segments.map((seg, i) => (
                            <Text key={i} className={seg.isNew ? 'text-amber-600' : 'text-neutral-900'}>
                              {maskBuildSegment(seg.text)}
                              {i < stage.segments.length - 1 ? ' ' : ''}
                            </Text>
                          ))}
                        </AppText>
                      </View>
                    </ScrollView>

                    <View className="shrink-0 gap-2">
                      {/* The rep ladder — the only other moving part. */}
                      <View className="flex-row items-center justify-between px-1">
                        {BUILD_UP_REPS.map((rep, i) => {
                          const reached = i <= buildRepIdx;
                          return (
                            <View key={rep} className="flex-row items-center gap-1.5">
                              <View
                                className={`w-2 h-2 rounded-full ${reached ? 'bg-[#1A1A1A]' : 'border border-neutral-300'}`}
                              />
                              <AppText variant="micro" className={`font-sans font-bold uppercase tracking-wider ${ i === buildRepIdx ? 'text-neutral-800' : 'text-neutral-400' }`} >
                                {rep === 'read' ? 'Read' : rep === 'hint' ? 'Hints' : 'From memory'}
                              </AppText>
                            </View>
                          );
                        })}
                      </View>

                      <Pressable
                        onPress={advanceBuildUp}
                        className="w-full py-3 rounded-xl bg-[#1A1A1A] flex-row items-center justify-center gap-1.5"
                      >
                        <AppText variant="label" className="font-sans font-bold text-white">{actionLabel}</AppText>
                        <ChevronRight size={15} color="#ffffff" />
                      </Pressable>

                      <View className="flex-row gap-2">
                        <Pressable
                          onPress={stepBackBuildUp}
                          disabled={buildStageIdx === 0 && buildRepIdx === 0}
                          className={`flex-1 py-2 border rounded-xl flex-row items-center justify-center gap-1.5 ${
                            buildStageIdx === 0 && buildRepIdx === 0 ? 'border-neutral-200' : 'border-neutral-300'
                          }`}
                        >
                          <Undo2 size={13} color={buildStageIdx === 0 && buildRepIdx === 0 ? '#d4d4d4' : '#404040'} />
                          <AppText variant="caption" className={`font-sans font-bold ${ buildStageIdx === 0 && buildRepIdx === 0 ? 'text-neutral-300' : 'text-neutral-700' }`} >
                            Back
                          </AppText>
                        </Pressable>
                        {buildRep !== 'read' && (
                          <Pressable
                            onPress={() => setBuildPeek((p) => !p)}
                            className={`flex-1 py-2 border rounded-xl flex-row items-center justify-center gap-1.5 ${
                              buildPeek ? 'border-amber-400 bg-amber-50' : 'border-neutral-300'
                            }`}
                          >
                            {buildPeek ? <EyeOff size={13} color="#b45309" /> : <Eye size={13} color="#404040" />}
                            <AppText variant="caption" className={`font-sans font-bold ${buildPeek ? 'text-amber-700' : 'text-neutral-700'}`}>
                              {buildPeek ? 'Hide' : 'Peek'}
                            </AppText>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })()
            ) : learnTab === 'scramble' ? (
              /* ======================================================== */
              /* PHRASE SCRAMBLE — rebuild one verse from 3-4 word thought  */
              /* units. Ungraded.                                           */
              /* ======================================================== */
              (() => {
                if (!currentScrambleRound) {
                  return (
                    <View className="flex-1 items-center justify-center px-6 gap-2">
                      <Puzzle size={28} color="#a3a3a3" />
                      <AppText variant="body" className="font-sans font-bold text-neutral-600 text-center">Nothing to scramble</AppText>
                      <AppText variant="caption" className="text-neutral-400 font-sans text-center">
                        These verses are too short to split into phrase tiles. Try Recall instead.
                      </AppText>
                    </View>
                  );
                }

                const round = currentScrambleRound;
                const bankRemaining = round.bankOrder.filter((p) => !scrambleSlots.includes(p));
                const allPlaced = scrambleSlots.length > 0 && scrambleSlots.every((s) => s !== null);
                const solved = allPlaced && scrambleSlots.every((p, i) => p === i);
                const isLastRound = scrambleIndex >= scrambleRounds.length - 1;

                return (
                  <View className="flex-1 justify-between">
                    <ScrollView className="flex-1 mb-2" contentContainerClassName="gap-2 pb-2">
                      <View className="flex-row items-center justify-between">
                        <AppText variant="micro" className="font-sans font-bold text-neutral-400 uppercase tracking-wider">
                          {round.label} — verse {scrambleIndex + 1} of {scrambleRounds.length}
                        </AppText>
                        {scrambleSolved.has(scrambleIndex) && <Check size={12} color="#059669" />}
                      </View>

                      {/* Construct box. A correct arrangement confirms itself
                          the moment it's complete (no Check press needed) --
                          the last tile landing IS the answer. Only a wrong
                          arrangement waits for an explicit Check, so the
                          drill never pre-emptively tells you you're wrong
                          while you're still placing tiles. */}
                      <View
                        className={`border-2 rounded-2xl p-3 min-h-[110px] ${
                          solved
                            ? 'border-emerald-500 bg-emerald-50'
                            : scrambleChecked
                              ? 'border-red-400 bg-red-50'
                              : 'border-[#1A1A1A] bg-white'
                        }`}
                      >
                        {scrambleSlots.every((s) => s === null) ? (
                          <AppText variant="caption" className="text-neutral-400 font-sans font-bold">Tap phrases below to build the verse…</AppText>
                        ) : (
                          <View className="flex-row flex-wrap gap-1.5">
                            {scrambleSlots.map((phraseIdx, slotIdx) =>
                              phraseIdx === null ? null : (
                                <Pressable
                                  key={`s-${slotIdx}`}
                                  onPress={() => {
                                    // Remove this tile and close the gap, so
                                    // the next placement always lands at the
                                    // end rather than in a hole mid-sentence.
                                    setScrambleSlots((prev) => {
                                      const kept = prev.filter((p, i) => i !== slotIdx && p !== null) as number[];
                                      return prev.map((_, i) => (i < kept.length ? kept[i] : null));
                                    });
                                    setScrambleChecked(false);
                                  }}
                                  className={`px-2 py-1 rounded-lg border ${
                                    scrambleChecked && phraseIdx !== slotIdx ? 'bg-red-100 border-red-300' : 'bg-neutral-900 border-neutral-900'
                                  }`}
                                >
                                  <AppText variant="label" className={`font-serif ${scrambleChecked && phraseIdx !== slotIdx ? 'text-red-800' : 'text-white'}`}>
                                    {round.phrases[phraseIdx]}
                                  </AppText>
                                </Pressable>
                              )
                            )}
                          </View>
                        )}
                      </View>

                      {/* Tile bank */}
                      {bankRemaining.length > 0 && (
                        <View className="flex-row flex-wrap gap-1.5 mt-1">
                          {bankRemaining.map((phraseIdx) => (
                            <Pressable
                              key={`b-${phraseIdx}`}
                              onPress={() => {
                                const firstEmpty = scrambleSlots.findIndex((s) => s === null);
                                if (firstEmpty === -1) return;
                                setScrambleSlots((prev) => prev.map((s, i) => (i === firstEmpty ? phraseIdx : s)));
                                setScrambleChecked(false);
                              }}
                              className="px-2 py-1 rounded-lg border border-neutral-300 bg-neutral-50"
                            >
                              <AppText variant="label" className="font-serif text-neutral-700">{round.phrases[phraseIdx]}</AppText>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </ScrollView>

                    <View className="shrink-0 gap-2">
                      {(solved || scrambleChecked) && (
                        <View className={`rounded-xl p-2.5 ${solved ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                          <AppText variant="caption" className={`font-sans font-bold text-center ${solved ? 'text-emerald-800' : 'text-amber-800'}`}>
                            {solved
                              ? isLastRound
                                ? 'That’s the whole passage! Practice only — nothing logged.'
                                : 'That’s the verse! Practice only — nothing logged.'
                              : 'Not quite — tap a red tile to send it back.'}
                          </AppText>
                        </View>
                      )}
                      <View className="flex-row gap-2">
                        <Pressable
                          onPress={() => {
                            setScrambleSlots(round.phrases.map(() => null));
                            setScrambleChecked(false);
                          }}
                          className="flex-1 py-2 border border-neutral-300 rounded-xl flex-row items-center justify-center gap-1.5"
                        >
                          <Undo2 size={13} color="#404040" />
                          <AppText variant="caption" className="font-sans font-bold text-neutral-700">Clear</AppText>
                        </Pressable>
                        {solved && !isLastRound ? (
                          <Pressable
                            onPress={() => setScrambleIndex((i) => i + 1)}
                            className="flex-1 py-2 rounded-xl bg-emerald-600 flex-row items-center justify-center gap-1.5"
                          >
                            <AppText variant="caption" className="font-sans font-bold text-white">Next Verse</AppText>
                          </Pressable>
                        ) : (
                          <Pressable
                            onPress={() => setScrambleChecked(true)}
                            disabled={!allPlaced}
                            className={`flex-1 py-2 rounded-xl flex-row items-center justify-center gap-1.5 ${allPlaced ? 'bg-[#1A1A1A]' : 'bg-neutral-200'}`}
                          >
                            <Check size={13} color={allPlaced ? '#ffffff' : '#a3a3a3'} />
                            <AppText variant="caption" className={`font-sans font-bold ${allPlaced ? 'text-white' : 'text-neutral-400'}`}>Check</AppText>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })()
            ) : (
              /* ======================================================== */
              /* SPOT-THE-SWAP — a few words per verse are replaced with    */
              /* real words from elsewhere in the passage; tap the          */
              /* imposters. Ungraded.                                       */
              /* ======================================================== */
              (() => {
                const score = scoreSwapAttempt(swapVerses, swapSelected);
                const noDecoys = score.totalDecoys === 0;

                return (
                  <View className="flex-1 justify-between">
                    <ScrollView className="flex-1 mb-2" contentContainerClassName="gap-3 pb-2">
                      <View className="flex-row items-center gap-1">
                        <Info size={10} color="#a3a3a3" />
                        <AppText variant="micro" className="text-neutral-400 font-bold font-sans">
                          {swapSubmitted ? 'Green = caught, red = missed, amber = wrongly flagged' : 'Tap every word that does not belong'}
                        </AppText>
                      </View>

                      {noDecoys ? (
                        <AppText variant="caption" className="text-neutral-400 font-sans">
                          This passage is too short to hide imposters in. Try a longer selection.
                        </AppText>
                      ) : (
                        swapVerses.map((sv) => (
                          <AppText variant="body" key={sv.id} className="font-serif leading-relaxed text-neutral-800">
                            <AppText variant="caption" className="font-sans font-bold text-neutral-400">{sv.label} </AppText>
                            {sv.tokens.map((tok) => {
                              const isSelected = swapSelected.has(tok.index);
                              let cls = 'text-neutral-800';
                              if (swapSubmitted) {
                                if (tok.isDecoy && isSelected) cls = 'text-emerald-700 font-bold';
                                else if (tok.isDecoy && !isSelected) cls = 'text-red-600 font-bold underline';
                                else if (!tok.isDecoy && isSelected) cls = 'text-amber-600 line-through';
                              } else if (isSelected) {
                                cls = 'text-indigo-700 font-bold underline';
                              }
                              return (
                                <Text
                                  key={tok.index}
                                  onPress={
                                    swapSubmitted
                                      ? undefined
                                      : () =>
                                          setSwapSelected((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(tok.index)) next.delete(tok.index);
                                            else next.add(tok.index);
                                            return next;
                                          })
                                  }
                                  className={`font-serif ${cls}`}
                                >
                                  {tok.display}{' '}
                                </Text>
                              );
                            })}
                          </AppText>
                        ))
                      )}

                      {/* After submitting, show what the swapped words really were */}
                      {swapSubmitted && score.totalDecoys > 0 && (
                        <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 gap-1">
                          <AppText variant="micro" className="font-sans font-bold text-neutral-400 uppercase tracking-wider">The real words</AppText>
                          {swapVerses.flatMap((sv) =>
                            sv.tokens
                              .filter((t) => t.isDecoy)
                              .map((t) => (
                                <AppText variant="label" key={t.index} className="font-serif text-neutral-600">
                                  <Text className="text-red-600 line-through">{t.display}</Text> → <Text className="text-emerald-700 font-bold">{t.original}</Text>
                                </AppText>
                              ))
                          )}
                        </View>
                      )}
                    </ScrollView>

                    <View className="shrink-0 gap-2">
                      {swapSubmitted ? (
                        <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-2.5">
                          <AppText variant="caption" className="font-sans font-bold text-neutral-800 text-center">
                            Caught {score.caught} of {score.totalDecoys}
                            {score.falseAlarms > 0 ? ` · ${score.falseAlarms} wrongly flagged` : ''} — practice only, nothing logged.
                          </AppText>
                        </View>
                      ) : (
                        <View className="flex-row items-center justify-between bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2">
                          <AppText variant="caption" className="font-sans font-bold text-neutral-600">Swaps per verse</AppText>
                          <ChipRow
                            options={[
                              { id: 1, label: '1' },
                              { id: 2, label: '2' },
                              { id: 3, label: '3' },
                            ]}
                            value={swapsPerVerse}
                            onChange={(n) => {
                              setSwapsPerVerse(n);
                              resetSwap(n);
                            }}
                          />
                        </View>
                      )}
                      <View className="flex-row gap-2">
                        <Pressable
                          onPress={() => resetSwap()}
                          className="flex-1 py-2 border border-neutral-300 rounded-xl flex-row items-center justify-center gap-1.5"
                        >
                          <Shuffle size={13} color="#404040" />
                          <AppText variant="caption" className="font-sans font-bold text-neutral-700">New Swaps</AppText>
                        </Pressable>
                        {!swapSubmitted && (
                          <Pressable
                            onPress={() => setSwapSubmitted(true)}
                            disabled={noDecoys}
                            className={`flex-1 py-2 rounded-xl flex-row items-center justify-center gap-1.5 ${noDecoys ? 'bg-neutral-200' : 'bg-[#1A1A1A]'}`}
                          >
                            <Check size={13} color={noDecoys ? '#a3a3a3' : '#ffffff'} />
                            <AppText variant="caption" className={`font-sans font-bold ${noDecoys ? 'text-neutral-400' : 'text-white'}`}>Check</AppText>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })()
            )}
          </View>
        )}
      </View>
    </View>
  );
}
