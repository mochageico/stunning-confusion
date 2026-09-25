import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { hasPlayableAudio, resolvePlaybackUrl } from '../lib/studioAudio';
import {
  Check,
  ChevronDown,
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
  MoveVertical,
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

import { VerseState, QueueItem, Recording, ChapterPhoto } from '../types';
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
import ListenPhotoView from './ListenPhotoView';
import { chapterPhotoKey, sortChapterPhotos } from '../lib/chapterPhotos';
import { AppButton, AppIconButton, AppTextInput, AppText, RangeCaption, useCollapsed, useFontScale, useScaledSpace } from './design';
import { Badge, Dialog, EmptyState, SegmentedControl } from './blocks';
import { DEFAULT_STRIKE_LIMIT, isStrikeLimit, loadPracticePrefs, savePracticePrefs, StrikeLimit } from '../lib/practicePrefs';

import { useThemeColors } from './theme';
/** Stable identity, so a missing photoCache prop cannot retrigger renders. */
const EMPTY_PHOTO_CACHE: ReadonlyMap<string, string> = new Map();

/**
 * The Listen progress bar, and the ONLY thing in this file allowed to
 * subscribe to the playhead.
 *
 * useAudioPlayerStatus is useEvent under the hood: it parks the whole status
 * object -- currentTime included -- in React state, so whichever component
 * calls it re-renders on every status tick. Called up in PracticeModalsInner
 * that meant re-rendering the entire Listen screen, verse list and all, many
 * times a second, purely to move this one bar. The work saturated the JS
 * thread, which delayed the verse-boundary check, which is what made
 * playback drift seconds behind the audio.
 *
 * Isolated down here, a tick re-renders four Views and nothing else.
 */
const ListenProgress = React.memo(function ListenProgress({
  player,
  startSec,
  endSec,
  verseIndex,
  verseCount,
  repeatsPerVerse,
  verseRepeatsDone,
}: {
  player: AudioPlayer;
  startSec: number | null;
  endSec: number | null;
  verseIndex: number;
  verseCount: number;
  repeatsPerVerse: number;
  verseRepeatsDone: number;
}) {
  const status = useAudioPlayerStatus(player);
  // Position within the current verse's own segment, so the bar advances
  // smoothly between verses instead of jumping a whole verse at a time.
  let segmentFraction = 0;
  if (startSec !== null && endSec !== null) {
    const span = Math.max(0.01, endSec - startSec);
    segmentFraction = Math.max(0, Math.min(1, (status.currentTime - startSec) / span));
  }
  const percent = verseCount > 0 ? ((verseIndex + segmentFraction) / verseCount) * 100 : 0;

  return (
    <View className="gap-1">
      <View className="w-full bg-fill h-1 rounded-full overflow-hidden">
        <View className="bg-accent h-full" style={{ width: `${percent}%` }} />
      </View>
      <AppText variant="micro" numberOfLines={1} className="font-sans font-medium text-ink-3 text-center">
        Verse {verseIndex + 1} of {verseCount}
        {repeatsPerVerse > 1 ? ` · pass ${verseRepeatsDone + 1} of ${repeatsPerVerse}` : ''}
      </AppText>
    </View>
  );
});

/**
 * Listen-mode playback speeds. Discrete stops rather than the old ±0.2
 * stepper: picking one is a single tap instead of up to eight, and every
 * value here is one somebody would actually choose. 0.6/0.8 for learning a
 * hard verse, 1.2 and up for review passes.
 */
const LISTEN_SPEEDS = [0.6, 0.8, 1.0, 1.2, 1.5, 2.0];
/** Times each verse can repeat before playback moves on. */
const LISTEN_REPEATS = [1, 2, 3, 4, 5];
/** Recall's words-hidden stops: 0-100% in steps of 5. Only 100 grades. */
const HIDE_LEVELS = Array.from({ length: 21 }, (_, i) => i * 5).map((n) => ({
  id: n,
  label: n === 100 ? 'All' : `${n}%`,
}));

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
  // Bible page photos. Listen shows the page a verse lives on as a third
  // Display option, following playback across whatever chapters the session
  // happens to span (see ListenPhotoView).
  chapterPhotos?: ChapterPhoto[];
  photoCache?: ReadonlyMap<string, string>;
  onCacheChapterPhoto?: (photo: ChapterPhoto) => void;
  onAddChapterPhoto?: (book: string, chapter: number) => void;
}

// ============================================================
// DrillSetting — one row of the Recall screen's settings card.
// Mid-recall you want the passage, not panels of controls, so
// each row folds down to a single line that still states where
// it stands ("Restart verse after   5 mistakes"); tapping it
// opens the choices in place. Open/closed persists per key
// through the same store CollapsibleCard uses, so someone who
// fiddles with a knob every session keeps it open.
//
// The rows share one card (DrillSettings) and are divided by a
// hairline, the way a grouped settings list is. They used to be
// separate grey strips with grey Courier values, which read as
// disabled controls rather than as settings.
// ============================================================
function DrillSettings({ children }: { children: React.ReactNode }) {
  return <View className="mt-2.5 bg-surface border border-line rounded-card overflow-hidden">{children}</View>;
}

function DrillSetting({
  storageKey,
  label,
  value,
  valueClassName = 'text-ink-2',
  first = false,
  children,
}: {
  storageKey: string;
  label: string;
  /** Current setting, shown on the row so a folded row still reads. */
  value: string;
  valueClassName?: string;
  /** The first row in its card draws no divider above it. */
  first?: boolean;
  children: React.ReactNode;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const [collapsed, setCollapsed] = useCollapsed(storageKey, true);
  const Chevron = collapsed ? ChevronDown : ChevronUp;

  return (
    <View
      className={first ? '' : 'border-t border-hairline'}
      style={{ paddingHorizontal: space(12), paddingVertical: space(10), gap: space(8) }}
    >
      <Pressable
        onPress={() => setCollapsed(!collapsed)}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        hitSlop={6}
        className="flex-row items-center active:opacity-60"
        style={{ gap: space(8) }}
      >
        <AppText variant="label" className="font-sans font-medium text-ink shrink">
          {label}
        </AppText>
        <AppText variant="label" className={`font-sans flex-1 text-right ${valueClassName}`}>
          {value}
        </AppText>
        <Chevron size={Math.round(space(14))} color={palette.ink3} />
      </Pressable>
      {!collapsed && children}
    </View>
  );
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
  chapterPhotos,
  photoCache,
  onCacheChapterPhoto,
  onAddChapterPhoto,
}: PracticeModalsProps) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const fontScale = useFontScale();
  const handleGroupComplete = onAdvance ?? onClose;
  // ==========================================
  // PLAYLIST / PLAY-SOURCE STATE (Listen mode only)
  // ==========================================
  const [playSource, setPlaySource] = useState<'selection' | 'memorization' | 'reviewing' | 'priming' | 'all'>('selection');
  const [activePlayVerses, setActivePlayVerses] = useState<VerseState[]>(verses);
  // "Verse by Verse" (existing card list) vs "Memory Grid" -- purely a
  // display choice, doesn't affect playback state at all. Tapping a grid
  // box calls the exact same handleVerseClick used by the card list.
  const [listenViewMode, setListenViewMode] = useState<'verses' | 'memoryGrid' | 'photo'>('verses');

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
  // How many times each verse plays before playback moves on -- 15, 15, 15,
  // then 16, 16, 16. A separate axis from repeatMode above, which only
  // decides what happens once the whole list has played through. Session-
  // local like listenSpeed: every Listen session opens back at 1x, so nobody
  // ever wonders why a verse is repeating itself.
  const [repeatsPerVerse, setRepeatsPerVerse] = useState(1);
  const [verseRepeatsDone, setVerseRepeatsDone] = useState(0);
  // Which settings pill has its choices expanded beneath it, if any. Speed
  // and repeats are the only two with more than an on/off to say; the
  // end-of-list pill just toggles. Only one opens at a time because they
  // share one row of space -- not because the others are being hidden from
  // you: whatever is set is always readable on the pill itself.
  const [openSetting, setOpenSetting] = useState<'speed' | 'repeats' | null>(null);

  // Auto-follow: the reading pane scrolls itself so the verse being played
  // stays on screen. On by default; scrolling by hand DURING playback turns
  // it off (the user is deliberately reading somewhere else), and only the
  // Follow button turns it back on.
  const [autoFollow, setAutoFollow] = useState(true);
  const verseListRef = useRef<ScrollView>(null);
  // Geometry is read on demand with .measureLayout(), NOT collected from
  // onLayout: onLayout does not fire on this app's Views (the same finding
  // already recorded on the range slider in ui.tsx), so an offsets map filled
  // in by onLayout stays empty forever and Follow silently never scrolls.
  // Verified in the browser: it did exactly that.
  const verseContentRef = useRef<View>(null);
  const verseCardRefs = useRef<Record<number, View | null>>({});
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

  // ---- Bible page photos ------------------------------------------------
  // Resolution is (CHAPTER, verse) -> photo, not verse -> photo. A Listen
  // session launched from Home routinely spans several chapters, so this has to
  // re-resolve against whichever chapter the current verse actually belongs to
  // -- otherwise the page on screen quietly stops matching the audio.
  // The verse playback is actually on. Named for what it is rather than for
  // the photo layer, because the lock screen needs exactly the same thing.
  const nowPlayingVerse = currentSegment?.verseObj ?? activePlayVerses[currentVerseIndex] ?? null;
  const photoVerse = nowPlayingVerse;
  const photoChapterKey = photoVerse ? chapterPhotoKey(photoVerse.book, photoVerse.chapter) : null;
  const photosForCurrentChapter = useMemo(
    () =>
      photoChapterKey && chapterPhotos
        ? sortChapterPhotos(chapterPhotos.filter((photo) => photo.chapterKey === photoChapterKey))
        : [],
    [chapterPhotos, photoChapterKey]
  );
  // The Display option appears when ANY chapter in the session has a photo, not
  // only when the current one does. Otherwise a mixed queue hides the option for
  // the whole session because one chapter in it happens to lack a page.
  const sessionHasPhotos = useMemo(() => {
    if (!chapterPhotos?.length) return false;
    const keys = new Set(activePlayVerses.map((v) => chapterPhotoKey(v.book, v.chapter)));
    return chapterPhotos.some((photo) => keys.has(photo.chapterKey));
  }, [chapterPhotos, activePlayVerses]);

  // Deleting the session's last photo elsewhere would otherwise strand the user
  // on a Display mode whose option no longer exists in the dropdown.
  useEffect(() => {
    if (listenViewMode === 'photo' && !sessionHasPhotos) setListenViewMode('verses');
  }, [listenViewMode, sessionHasPhotos]);

  // Keep the playing verse on screen. Only the card list is followed: the
  // memory grid is compact enough not to need it, and the photo view doesn't
  // scroll by verse at all. Re-arming Follow re-runs this too, so the button
  // immediately brings you back to whatever is playing.
  //
  // measureLayout against the content wrapper gives the card's offset INSIDE
  // the scrollable content -- exactly the number scrollTo wants, with no need
  // to track the current scroll position. The rAF retry mirrors ui.tsx's
  // slider: for a frame or two after a view switch or a playlist change there
  // is nothing laid out to measure yet.
  useEffect(() => {
    if (type !== 'listen' || !autoFollow || listenViewMode !== 'verses') return;
    let frame = 0;
    let cancelled = false;
    const attempt = (triesLeft: number) => {
      if (cancelled) return;
      const retry = () => {
        if (triesLeft > 0) frame = requestAnimationFrame(() => attempt(triesLeft - 1));
      };
      const card = verseCardRefs.current[currentVerseIndex];
      const content = verseContentRef.current;
      if (!card || !content) {
        retry();
        return;
      }
      card.measureLayout(
        content as never,
        (_x, y) => {
          if (!cancelled) verseListRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
        },
        () => retry()
      );
    };
    attempt(20);
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, autoFollow, listenViewMode, currentVerseIndex]);

  // Real audio player for whichever recording covers the current verse.
  // Swapping to a different chapter's recording (or none) just means this
  // source string changes -- expo-audio reloads automatically, same pattern
  // as recordingPlayer/importPlayer elsewhere in this app. Deliberately its
  // own player rather than reusing the app-wide "now playing" system: Listen
  // mode auto-advances across verses (and can switch recordings on its own),
  // which shouldn't hijack whatever the floating mini-bar is doing elsewhere.
  // updateInterval matters more here than anywhere else in the app. Every
  // verse boundary is detected by watching status.currentTime cross the
  // tagged endSec, so the boundary can only ever be noticed on a status tick
  // -- at expo-audio's 500ms default that means overshooting the end of a
  // verse by up to half a second. For ordinary playback that's invisible (the
  // audio flows straight into the next verse anyway), but when a verse is
  // looping -- a selected segment, or repeats-per-verse -- the overshoot is
  // the beginning of the NEXT verse, audibly played before the loop snaps
  // back. 100ms puts the boundary where the user expects it.
  //
  // This rate is only affordable because nothing in this component re-renders
  // on a tick any more -- see ListenProgress and the subscription below.
  const listenPlayer = useAudioPlayer(
    resolvePlaybackUrl(currentSegment?.recording, studioPlaybackEnabled, audioCacheMap),
    { updateInterval: 100 }
  );

  // Deliberately NOT useAudioPlayerStatus. That hook stores the whole status
  // in React state, so calling it here re-rendered this entire component --
  // the full verse list included -- ten times a second, just to move a
  // progress bar. Verse boundaries were then detected inside an effect that
  // only ran as part of those renders, so once the JS thread fell behind,
  // detection fell behind with it: verse 2's audio played for seconds while
  // the screen still showed verse 1, then the advance finally landed, the
  // seek below saw a playhead far past verse 2's start and yanked it
  // backwards -- restarting a verse that was already halfway through.
  //
  // Boundary detection now runs in the player's own event callback, off the
  // render path entirely, and cannot be delayed by rendering at all. Only
  // isLoaded reaches React state, and only when it actually changes.
  const [listenLoaded, setListenLoaded] = useState(false);
  // Reassigned after every render (below) so this long-lived listener always
  // runs against current state without needing to be re-subscribed.
  const onStatusTickRef = useRef<(status: AudioStatus) => void>(() => {});

  useEffect(() => {
    setListenLoaded(listenPlayer.currentStatus?.isLoaded ?? false);
    const subscription = listenPlayer.addListener('playbackStatusUpdate', (status) => {
      // Returning the identical value makes React bail out without
      // re-rendering, so this costs nothing on the ticks where nothing
      // changed -- which is all but two of them.
      setListenLoaded((was) => (was === status.isLoaded ? was : status.isLoaded));
      onStatusTickRef.current(status);
    });
    return () => subscription.remove();
  }, [listenPlayer]);

  // ---- Lock screen / Control Centre ------------------------------------
  // What the OS shows while the phone is locked: the verse being spoken, and
  // underneath it whichever recording is being played.
  const lockScreenMetadata = useMemo(
    () => ({
      title: nowPlayingVerse
        ? `${nowPlayingVerse.book} ${nowPlayingVerse.chapter}:${nowPlayingVerse.verse}`
        : referenceText,
      artist: currentSegment?.recording?.title ?? 'Scripture Memory',
      albumTitle: referenceText,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nowPlayingVerse?.book, nowPlayingVerse?.chapter, nowPlayingVerse?.verse, currentSegment?.recording?.title, referenceText]
  );

  // Claim the controls the first time this session actually plays -- not the
  // moment Listen opens, which would park a silent "now playing" card on the
  // lock screen for someone who is only reading.
  //
  // Claiming is per PLAYER, and useAudioPlayer builds a new one whenever the
  // source changes, so a session spanning two chapters has to re-claim on the
  // swap; hence tracking which player holds it rather than a bare boolean.
  //
  // Deliberately never released on pause: releasing it would take the
  // controls away at exactly the moment the user needs them to press play
  // again. Only unmount clears it.
  const lockScreenPlayerRef = useRef<AudioPlayer | null>(null);
  useEffect(() => {
    if (type !== 'listen' || !listenPlaying || !listenLoaded) return;
    if (lockScreenPlayerRef.current === listenPlayer) {
      listenPlayer.updateLockScreenMetadata(lockScreenMetadata);
      return;
    }
    lockScreenPlayerRef.current = listenPlayer;
    // Seek buttons stay off: they would move the playhead ten seconds at a
    // time with no regard for verse boundaries. The scrub bar is left on, and
    // handleStatusTick below follows it to whichever verse it lands in.
    listenPlayer.setActiveForLockScreen(true, lockScreenMetadata, {
      showSeekForward: false,
      showSeekBackward: false,
    });
  }, [type, listenPlaying, listenLoaded, listenPlayer, lockScreenMetadata]);

  useEffect(() => {
    return () => {
      try {
        lockScreenPlayerRef.current?.clearLockScreenControls();
      } catch {
        // already released
      }
    };
  }, []);

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

  // Audio session for Listen playback. Both of the additions here are load-
  // bearing for locked-screen listening, not preferences:
  //
  // - shouldPlayInBackground is what keeps audio running once the app leaves
  //   the foreground at all. The native side of it is already in place --
  //   expo-audio's config plugin defaults enableBackgroundPlayback to true,
  //   so the build already carries UIBackgroundModes: ['audio'] and Android's
  //   mediaPlayback foreground service.
  // - interruptionMode must be 'doNotMix' or the OS may decline to hand this
  //   player the lock screen controls at all (expo-audio's own requirement
  //   for setActiveForLockScreen). It also means starting a Listen session
  //   now stops whatever else was playing, rather than talking over it --
  //   which is the right behaviour for a recitation you are trying to follow.
  //
  // NOTE: the audio session is global, and useAppState resets it to a
  // foreground-only mode after recording/importing. Those paths all stop
  // Listen first (the one-source-at-a-time effect below), so they can't strip
  // background mode from a session that is still playing.
  useEffect(() => {
    if (listenPlaying) {
      setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      }).catch(() => {});
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
  // Set while a repeats-per-verse replay has seeked back to this same
  // segment's start and we're still waiting for the status to catch up. It is
  // NOT enough to re-arm on seekTo's promise: resolving the seek does not mean
  // the next status tick reflects the new position, and a stale reading still
  // sitting past endSec reads as "this pass finished too" -- which would burn
  // every remaining repeat in one go. seekedToCurrentSegmentRef can't cover
  // this on its own because, unlike a verse change, currentVerseIndex never
  // changes here.
  const repeatSeekPendingRef = useRef(false);
  // When this component last commanded the player itself. The remote-transport
  // sync in handleStatusTick ignores disagreements newer than this, so our own
  // in-flight play/pause/seek is never mistaken for someone pressing a button
  // on their headphones.
  const lastTransportCommandRef = useRef(0);
  const markTransportCommand = () => {
    lastTransportCommandRef.current = Date.now();
  };
  useEffect(() => {
    seekedToCurrentSegmentRef.current = false;
    repeatSeekPendingRef.current = false;
    setVerseRepeatsDone(0);
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
    if (type !== 'listen' || !currentSegment?.recording || !listenLoaded) return;
    // "Already there" means anywhere INSIDE this verse, not just within a
    // fraction of a second of its start. If the playhead is already somewhere
    // in the segment we just switched to, the audio is by definition already
    // playing the right verse and seeking could only interrupt it -- most
    // destructively by restarting a verse the listener is halfway through.
    // A genuine jump (different recording, looping back, restarting, tapping
    // a verse) leaves the playhead outside the target and still seeks.
    const playhead = listenPlayer.currentStatus?.currentTime ?? 0;
    const alreadyInsideSegment = playhead >= currentSegment.startSec - 0.35 && playhead < currentSegment.endSec;
    if (alreadyInsideSegment) {
      seekedToCurrentSegmentRef.current = true;
      // ...but "no seek needed" is not the same as "already playing", and the
      // difference is a whole chapter. Crossing into a new one swaps the
      // recording, and useAudioPlayer answers a new source by building a new
      // player -- which arrives loaded, parked at 0, and paused. A chapter's
      // first verse starts at 0 too, so the playhead is legitimately inside
      // the target segment and this shortcut is taken. Returning here would
      // leave that new recording sitting silently at its start forever, since
      // the only play() on this path is the one inside the seek below.
      // Playback simply stopped at every chapter boundary.
      const playing = listenPlayer.currentStatus?.playing ?? false;
      if (listenPlaying && !playing) {
        markTransportCommand();
        listenPlayer.play();
      }
      return;
    }
    markTransportCommand();
    listenPlayer.seekTo(currentSegment.startSec).then(() => {
      seekedToCurrentSegmentRef.current = true;
      markTransportCommand();
      if (listenPlaying) listenPlayer.play();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, currentVerseIndex, currentSegment?.recording?.id, listenLoaded]);

  // Keep the real playback rate in sync with the speed control, including
  // right after a recording (re)loads.
  useEffect(() => {
    if (listenLoaded) listenPlayer.setPlaybackRate(listenSpeed, 'high');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenSpeed, listenLoaded, currentSegment?.recording?.id]);

  // Play the CURRENT segment again from its own start.
  //
  // Every other jump in this component happens by changing currentVerseIndex
  // and letting the seek effect above react to it. That machinery is useless
  // whenever the target is the verse we are already on -- setting state to the
  // value it already holds re-renders nothing, so no effect re-runs, nothing
  // seeks, and the playhead just carries on into the following verses. Two
  // paths need exactly that: repeats-per-verse, and a playlist loop whose
  // range is a single verse (a one-verse selected segment).
  const replayCurrentSegment = (startSec: number, resume: boolean) => {
    seekedToCurrentSegmentRef.current = false;
    repeatSeekPendingRef.current = true;
    markTransportCommand();
    listenPlayer.seekTo(startSec).then(() => {
      seekedToCurrentSegmentRef.current = true;
      markTransportCommand();
      if (resume) listenPlayer.play();
    });
  };

  // Detects reaching the end of the current verse's segment and advances --
  // to the next verse, possibly switching recordings, or loops/stops at the
  // end of the (possibly selection-restricted) range.
  //
  // Runs from the player's status callback, NOT from a render effect, so it
  // stays on time no matter how busy React is (see the subscription above).
  // It is redefined on every render and stashed in the ref below, which is
  // what keeps the state it closes over current.
  const handleStatusTick = (status: AudioStatus) => {
    if (type !== 'listen') return;

    // The player has run off the end of the file and stopped itself. That is
    // what always happens on a chapter's LAST verse: its endSec is the
    // recording's duration rounded to a whole second (buildVerseTimestamps),
    // which usually lands a fraction PAST the real end, so the ordinary
    // endSec check below can never be met -- the audio stops first.
    const atEndOfFile =
      status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.15);

    // Transport pressed from outside the app -- one squeeze of an AirPod, the
    // lock screen, a car stereo. Those commands are handled natively, against
    // the player directly, so React never hears about them and the on-screen
    // button would otherwise keep claiming the opposite of the truth. The
    // player's own reported state is the authority here; adopt it.
    //
    // Guarded four ways so this never fights a transition we started
    // ourselves: not before the current verse has actually been cued, not
    // while the player is still loading or buffering (we legitimately intend
    // to play before it can), and not within a moment of our own
    // play/pause/seek, which takes a beat to show up in the status.
    //
    // That first guard is what makes crossing into a new CHAPTER survive.
    // A new chapter is a new recording, so the player reloads, and a freshly
    // loaded source sits there paused until the seek effect cues it and hits
    // play. The tick announcing isLoaded arrives from the player's own
    // callback, synchronously, before React has re-rendered -- so the seek
    // effect has not run yet, nothing has marked a transport command, and
    // this saw a loaded, not-playing player under a listenPlaying intent of
    // true. It read that as "they pressed pause" and stopped playback at
    // every chapter boundary. seekedToCurrentSegmentRef is false for exactly
    // that window and true once the verse is genuinely cued.
    //
    // Reaching the end of the file is the other stop nobody pressed. Without
    // excluding it, finishing a chapter's last verse read as "they paused" and
    // returned before the advance/loop logic below ever ran -- so a Listen
    // session stopped dead after any set ending on a chapter's last verse, and
    // a whole-chapter loop never looped.
    if (
      seekedToCurrentSegmentRef.current &&
      status.isLoaded &&
      !status.isBuffering &&
      status.playing !== listenPlaying &&
      !(atEndOfFile && !status.playing) &&
      Date.now() - lastTransportCommandRef.current > 800
    ) {
      setListenPlaying(status.playing);
      return;
    }

    if (!listenPlaying || !currentSegment?.recording) return;
    // Don't trust currentTime until we've confirmed the seek to THIS verse's
    // start actually landed (see seekedToCurrentSegmentRef above).
    if (!seekedToCurrentSegmentRef.current) return;

    // Disarm before handing over to the verse-change effects. Ticks arrive on
    // the player's own schedule now, so another one can land before React has
    // committed the new currentVerseIndex -- at which point this callback is
    // still the previous render's closure, still pointed at the verse we just
    // decided to leave. Clearing the ref here makes that tick a no-op instead
    // of a second decision about a verse that is already behind us; the seek
    // effect re-arms it once the new verse is cued.
    const leaveCurrentVerse = (index: number) => {
      seekedToCurrentSegmentRef.current = false;
      setCurrentVerseIndex(index);
    };

    const segmentSpan = Math.max(0.01, currentSegment.endSec - currentSegment.startSec);
    if (repeatSeekPendingRef.current) {
      // Nothing about this segment can be trusted until the status reports the
      // playhead genuinely back near its start (see repeatSeekPendingRef).
      if (status.currentTime <= currentSegment.startSec + Math.min(0.5, segmentSpan / 2)) {
        repeatSeekPendingRef.current = false;
      }
      return;
    }

    // The playhead is somewhere this component did not put it: the lock
    // screen's scrub bar was dragged. Follow it to whichever verse now owns
    // that position rather than fighting it -- without this, dragging the
    // scrubber leaves the highlight stranded on the old verse, and the next
    // boundary check seeks the audio back to it.
    //
    // The 1.5s margin keeps a genuine drag distinct from a status reading
    // that is merely a little stale right after one of our own seeks; an
    // ordinary verse boundary is noticed within about a tick of crossing it.
    const activeRecordingId = currentSegment.recording.id;
    const scrubbedAway =
      status.currentTime < currentSegment.startSec - 1.5 || status.currentTime >= currentSegment.endSec + 1.5;
    if (scrubbedAway) {
      const landedOn = playableSegments.findIndex(
        (segment) =>
          segment.recording?.id === activeRecordingId &&
          segment.startSec !== null &&
          segment.endSec !== null &&
          status.currentTime >= segment.startSec &&
          status.currentTime < segment.endSec
      );
      if (landedOn >= 0 && landedOn !== currentVerseIndex) {
        leaveCurrentVerse(landedOn);
        return;
      }
    }

    // A reading still behind this segment's start, but not far enough to be a
    // deliberate jump -- the status simply hasn't caught up to a seek yet.
    if (status.currentTime < currentSegment.startSec - 0.5) return;

    const reachedEnd = status.currentTime >= currentSegment.endSec - 0.05;
    // End of file is the safety net for a player that stops a hair short of
    // the tagged end (see atEndOfFile). Honour it only when the playhead is
    // genuinely deep into this segment -- a finish flag left over from the
    // previous pass, arriving just after a repeat seeked back to the start, is
    // not another finish.
    const finishedShort =
      atEndOfFile &&
      status.currentTime > currentSegment.startSec + Math.min(0.25, segmentSpan / 2);
    if (!reachedEnd && !finishedShort) return;

    // Repeats-per-verse: replay THIS verse from its own start instead of
    // moving on, until it has played the requested number of times. Clearing
    // seekedToCurrentSegmentRef before the seek is what stops the next status
    // tick from firing this again and stacking up seeks while the first is
    // still in flight -- the same stale-currentTime hazard that ref exists
    // for on a backward loop.
    if (verseRepeatsDone < repeatsPerVerse - 1) {
      setVerseRepeatsDone((done) => done + 1);
      replayCurrentSegment(currentSegment.startSec, listenPlaying);
      return;
    }

    const next = findNextPlayableIndex(currentVerseIndex);
    if (next !== null) {
      leaveCurrentVerse(next);
    } else if (repeatMode === 'playlist') {
      const first = firstPlayableIndexInRange();
      setVerseRepeatsDone(0);
      if (first === currentVerseIndex) {
        // Looping a range that is only this verse -- see replayCurrentSegment.
        replayCurrentSegment(currentSegment.startSec, listenPlaying);
      } else {
        leaveCurrentVerse(first);
      }
    } else {
      markTransportCommand();
      setListenPlaying(false);
      listenPlayer.pause();
    }
  };

  // No dependency array: the listener must always hold THIS render's closure,
  // or it would advance using stale verse/repeat/selection state.
  useEffect(() => {
    onStatusTickRef.current = handleStatusTick;
  });

  const restartListen = () => {
    markTransportCommand();
    setListenPlaying(false);
    const first = firstPlayableIndexInRange();
    setVerseRepeatsDone(0);
    repeatSeekPendingRef.current = false;
    if (first === currentVerseIndex) {
      // Already on the first verse in range, so the index doesn't change and
      // nothing else will seek (see replayCurrentSegment). resume is false
      // because restartListen never pauses the underlying player -- only the
      // React flag -- so the audio is still rolling and only needs moving.
      const segment = playableSegments[first];
      if (segment?.recording) replayCurrentSegment(segment.startSec, false);
    } else {
      setCurrentVerseIndex(first);
    }
    setTimeout(() => setListenPlaying(true), 150);
  };

  const toggleListenPlaying = () => {
    markTransportCommand();
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
      if (listenLoaded) listenPlayer.play();
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
      buildSize,
      buildDirection,
    });
  }, [hideLevel, firstLetterLevel, hintMode, recallDisplayMode, gridHideMode, buildSize, buildDirection]);

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
        { id: 'buildUp' as const, label: 'Build up', Icon: Layers },
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
  // granularity. Tapping the SAME verse twice is a one-verse loop: end ===
  // start is just the shortest valid range, not a special case.
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
        // Tapped back above the start -- treat it as re-placing the start
        // rather than as an impossible backwards range.
        setSelectionStart(index);
        setCurrentVerseIndex(index);
      } else {
        // Includes index === selectionStart: closes a single-verse segment.
        setSelectionEnd(index);
      }
    }
  };

  // Footer wording for the current selection -- computed out here, not inline
  // in the JSX, so TypeScript keeps the narrowing on selectionStart/End.
  let segmentStatusLabel: string | null = null;
  if (playSource === 'selection' && selectionStart !== null) {
    if (selectionEnd === null) {
      segmentStatusLabel = 'Tap end verse';
    } else {
      const count = selectionEnd - selectionStart + 1;
      segmentStatusLabel = count === 1 ? 'Looping 1 verse' : `Looping ${count} verses`;
    }
  }

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
          className="bg-accent rounded-2xl px-3 py-2.5 flex-row items-center shadow-lg"
        >
          <View className="w-8 h-8 rounded-lg bg-on-accent/15 items-center justify-center shrink-0 mr-3">
            <WaveBars active={listenPlaying} count={4} onFill />
          </View>
          <View className="flex-1 mr-2" style={{ gap: 1 }}>
            <View className="flex-row items-center gap-1">
              <ChevronUp size={9} color="rgba(255,255,255,0.5)" />
              <AppText variant="micro" className="text-on-accent/70 font-sans font-semibold">Now playing</AppText>
            </View>
            <AppText variant="label" numberOfLines={1} className="text-on-accent font-sans font-bold ">
              {miniVerse ? `${miniVerse.book} ${miniVerse.chapter}:${miniVerse.verse}` : referenceText}
            </AppText>
          </View>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              toggleListenPlaying();
            }}
            className="w-9 h-9 rounded-full bg-on-accent/15 items-center justify-center shrink-0 mr-1.5"
          >
            {listenPlaying ? <Pause size={15} color={palette.onAccent} /> : <Play size={15} color={palette.onAccent} />}
          </Pressable>
          <AppIconButton Icon={X} diameter={36} iconSize={15} iconColor={palette.onAccent} onPress={(e) => { e.stopPropagation(); onClose(); }} className="rounded-full bg-on-accent/15 shrink-0" />
        </Pressable>
      </View>
    );
  }

  return (
    <View className="absolute inset-0 bg-surface z-50 pt-11 pb-4 px-4" id="practice_overlay">
      {/* Header Bar */}
      <View className="flex-row items-center justify-between border-b border-hairline pb-2 mb-3" style={{ gap: 8 }}>
        {/* flex-1 so a long reference wraps instead of pushing the
            close button off the screen at large text sizes. */}
        <View className="flex-1">
          <AppText variant="title" className="font-sans font-bold text-ink leading-tight" numberOfLines={2}>
            {referenceText}
          </AppText>
        </View>
        <View className="flex-row items-center gap-2 shrink-0">
          {!!sessionTotal && sessionTotal > 1 && <Badge label={`${sessionPosition} of ${sessionTotal}`} />}
          {/* Manual log -- replaces the old Reveal tab's self-assessment
              buttons. Available from every learn mode, since "I already did
              this off-app" isn't tied to any particular drill. */}
          {type === 'learn' && (
            <AppIconButton
              variant="outline"
              Icon={ClipboardCheck}
              onPress={() => setShowManualLog(true)}
              accessibilityLabel="Log a review done somewhere else"
            />
          )}
          <AppIconButton
            variant="outline"
            Icon={X}
            onPress={type === 'listen' ? () => setListenMinimized(true) : onClose}
            accessibilityLabel={type === 'listen' ? 'Minimize' : 'Close'}
          />
        </View>
      </View>

      {/* Manual log. Same sheet and the same three outcomes as the one on
          Today's review rows. */}
      <Dialog
        visible={showManualLog}
        onClose={() => setShowManualLog(false)}
        placement="sheet"
        title={`Log ${referenceText}`}
        message="For a review you actually did somewhere else — out loud in the car, from a card, anywhere but here."
      >
        <View style={{ gap: 8 }}>
          <AppButton variant="primary" label="Perfect — no mistakes" onPress={() => submitManualLog('perfect')} />
          <AppButton variant="secondary" label="Got it, with a stumble" onPress={() => submitManualLog('passed')} />
          <AppButton variant="quiet" label="Needs practice" onPress={() => submitManualLog('practice')} />
        </View>
      </Dialog>

      {/* Main Panel */}
      <View className="flex-1 justify-between py-1">
        {/* ======================================================== */}
        {/* LISTEN MODE VIEW */}
        {/* ======================================================== */}
        {type === 'listen' && (
          <View className="flex-1 justify-between">
            {/* Which verses play, and how they're shown. The verse picker
                names its current choice rather than a fixed "Verse
                Selection" label, and the display is a segmented control:
                two or three short choices, all visible at once. They wrap
                onto two lines at large text sizes. */}
            <View className="flex-row flex-wrap items-center mb-2.5 shrink-0" style={{ gap: 8 }}>
              {((memoryQueue && memoryQueue.length > 0) || (allVerses && allVerses.length > 0)) && (
                <View style={{ flexGrow: 1, flexBasis: space(150) }}>
                  <Dropdown
                    value={playSource}
                    onChange={setPlaySource}
                    options={[
                      { id: 'all', label: "Today's verses" },
                      { id: 'memorization', label: 'Learning now' },
                      { id: 'reviewing', label: 'Review' },
                      { id: 'priming', label: 'Coming up next' },
                      { id: 'selection', label: 'Selected verses' },
                    ]}
                    title="Which verses play"
                    searchable={false}
                  />
                </View>
              )}
              <View style={{ flexGrow: 1, flexBasis: space(150) }}>
                <SegmentedControl
                  value={listenViewMode}
                  onChange={setListenViewMode}
                  accessibilityLabel="Display"
                  options={[
                    { id: 'verses' as const, label: 'List' },
                    { id: 'memoryGrid' as const, label: 'Grid' },
                    ...(sessionHasPhotos ? [{ id: 'photo' as const, label: 'Photo' }] : []),
                  ]}
                />
              </View>
            </View>

            {/* Same control as Today's "Coming up next" section. */}
            {playSource === 'priming' && setPrimingLookahead && (
              <View className="flex-row items-center justify-end mb-2.5 shrink-0" style={{ gap: 8 }}>
                <AppText variant="caption" className="font-sans font-medium text-ink-3">
                  Show
                </AppText>
                <Dropdown
                  value={primingLookahead}
                  onChange={(v) => setPrimingLookahead(Number(v))}
                  options={[10, 20, 30, 40, 50].map((n) => ({ id: n, label: `${n}` }))}
                  title="How many to show"
                  compact
                />
              </View>
            )}

            {/* Verse Highlight Box — verse-by-verse, not word-by-word: the
                only real timing data this app has is per verse. */}
            <View className="bg-surface border border-line rounded-card flex-1 mb-3 overflow-hidden">
              {/* Content area. The photo layer is absolute within THIS box
                  rather than the panel, so it covers the two scroll views
                  without also covering the footer bar below them. */}
              <View className="flex-1">
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
              <ScrollView
                ref={verseListRef}
                className="flex-1 p-2"
                contentContainerStyle={{ paddingBottom: 12 }}
                onScrollBeginDrag={() => {
                  // Only a real finger-drag lands here -- a programmatic
                  // scrollTo doesn't -- and only while audio is actually
                  // playing: scrolling a paused list to read ahead shouldn't
                  // quietly disarm Follow.
                  if (listenPlaying) setAutoFollow(false);
                }}
              >
                {/* One wrapper around every card, so measureLayout has a
                    stable content-relative origin to measure against. The gap
                    lives here rather than on contentContainerStyle for the
                    same reason. */}
                <View ref={verseContentRef} collapsable={false} style={{ gap: 4 }}>
                {activePlayVerses.map((verseObj, index) => {
                  const segment = playableSegments[index];
                  const hasAudio = !!segment.recording;
                  const isActive = index === currentVerseIndex && listenPlaying;
                  const isRead = index < currentVerseIndex;
                  // Amber = a start is placed and the segment is still open
                  // (we're waiting on an end verse); green = the segment is
                  // closed and is what will actually loop. Two colours, so
                  // "half-selected" never looks like a finished selection.
                  const segmentClosed = playSource === 'selection' && selectionStart !== null && selectionEnd !== null;
                  const inSelectionRange =
                    playSource === 'selection' &&
                    selectionStart !== null &&
                    (selectionEnd !== null ? index >= selectionStart && index <= selectionEnd : index === selectionStart);

                  // One continuous list, not a card per verse: the verse
                  // playing gets a soft accent fill, and a selection range a
                  // soft amber or green one. Verse text stays full ink even
                  // without audio -- "No audio" says that on its own, and
                  // greying the words made them hard to read.
                  let cardClassName = 'rounded-btn px-3 py-2.5 ';
                  if (isActive) {
                    cardClassName += 'bg-accent-soft';
                  } else if (playSource === 'selection' && selectionStart !== null) {
                    if (!inSelectionRange) {
                      cardClassName += 'opacity-40';
                    } else {
                      cardClassName += segmentClosed ? 'bg-success-soft' : 'bg-warning-soft';
                    }
                  }

                  const refClassName = isActive
                    ? 'text-accent'
                    : inSelectionRange
                      ? segmentClosed
                        ? 'text-success'
                        : 'text-warning'
                      : 'text-ink-3';
                  const textClassName = isRead && !isActive ? 'text-ink-2' : 'text-ink';

                  return (
                    <Pressable
                      key={`${verseObj.book}-${verseObj.chapter}-${verseObj.verse}`}
                      onPress={() => handleVerseClick(index)}
                      ref={(el) => {
                        verseCardRefs.current[index] = el as unknown as View | null;
                      }}
                      className={cardClassName}
                    >
                      <View className="flex-row items-center justify-between mb-0.5">
                        <AppText variant="caption" className={`font-sans font-semibold ${refClassName}`}>
                          {verseObj.book} {verseObj.chapter}:{verseObj.verse}
                        </AppText>
                        {!hasAudio && (
                          <AppText variant="caption" className="font-sans text-ink-3">
                            No audio
                          </AppText>
                        )}
                      </View>
                      <AppText variant="body" className={`font-serif leading-relaxed ${textClassName}`}>{verseObj.text}</AppText>
                    </Pressable>
                  );
                })}
                </View>
              </ScrollView>
              )}

              {/* PHOTO LAYER -- mounted for the whole session and hidden with
                  opacity, never swapped in and out alongside the other two
                  views. Conditionally mounting a large decoded bitmap inside
                  this live modal is the exact shape of the iOS Fabric
                  shadow-tree deadlock this project has already hit once. */}
              {sessionHasPhotos && (
                <View
                  className="absolute inset-0 bg-surface-2"
                  style={{ opacity: listenViewMode === 'photo' ? 1 : 0 }}
                  pointerEvents={listenViewMode === 'photo' ? 'auto' : 'none'}
                >
                  <ListenPhotoView
                    photos={photosForCurrentChapter}
                    chapterLabel={photoVerse ? `${photoVerse.book} ${photoVerse.chapter}` : ''}
                    verse={photoVerse?.verse ?? null}
                    photoCache={photoCache ?? EMPTY_PHOTO_CACHE}
                    onCache={(photo) => onCacheChapterPhoto?.(photo)}
                    onAddPhoto={() =>
                      photoVerse && onAddChapterPhoto?.(photoVerse.book, photoVerse.chapter)
                    }
                    visible={listenViewMode === 'photo'}
                  />
                </View>
              )}
              </View>

              {/* Segment status and the Follow toggle. The old floating "Tap
                  verse to set start" corner chip is gone -- it said the same
                  thing this bar already says -- and so is the animated wave
                  indicator that used to sit on the right: it was decoration
                  competing with real controls, and the play button already
                  says whether audio is running. A hairline instead of a
                  filled grey bar, so this reads as the bottom edge of the
                  verse list rather than a fourth stacked band of chrome. */}
              <View className="border-t border-line px-3 py-2 flex-row justify-between items-center gap-2 z-10">
                <View className="flex-row items-center gap-2 flex-1">
                  {playSource === 'selection' && selectionStart !== null ? (
                    <>
                      <AppButton
                        size="sm"
                        variant="quiet"
                        Icon={RefreshCw}
                        label="Reset"
                        onPress={() => { setSelectionStart(null); setSelectionEnd(null); setCurrentVerseIndex(0); }}
                        className="shrink-0"
                      />
                      {/* Matches the row colours: amber while the segment is
                          still open, green once it is closed and looping. */}
                      <AppText
                        variant="caption"
                        className={`font-sans font-semibold flex-1 ${selectionEnd === null ? 'text-warning' : 'text-success'}`}
                      >
                        {segmentStatusLabel}
                      </AppText>
                    </>
                  ) : (
                    <AppText variant="caption" className="font-sans text-ink-3 flex-1">
                      {playSource === 'selection' ? 'Tap the first verse to loop' : 'Tap a verse to play from there'}
                    </AppText>
                  )}
                </View>

                {/* Follow -- scrolls the list to keep the playing verse on
                    screen. Only offered for the card list, the one view that
                    can actually run the verse off-screen. */}
                {listenViewMode === 'verses' && (
                  <AppButton
                    size="sm"
                    onPress={() => setAutoFollow((on) => !on)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: autoFollow }}
                    Icon={MoveVertical}
                    iconColor={autoFollow ? palette.accent : palette.ink3}
                    label="Follow"
                    textClassName={`font-semibold ${autoFollow ? 'text-accent' : 'text-ink-2'}`}
                    className={`rounded-full border shrink-0 ${autoFollow ? 'bg-accent-soft border-accent' : 'bg-surface border-line-strong'}`}
                  />
                )}
              </View>
            </View>

            {/* Custom Control and Audio Looping Panel */}
            <View className="gap-3 bg-surface pt-2">
              {!hasAnyAudio ? (
                <EmptyState
                  title="No recordings for these verses yet"
                  message="Record one on the Record tab, or pick a narration on the chapter's page."
                />
              ) : (
                <>
                  {/* Settings pills. These replaced two bordered cards, each
                      holding a bordered inner pill, each holding bordered 20pt
                      -/+ buttons -- three nested border tones stacked, with
                      nothing reading as more important than anything else.
                      Worse, those -/+ buttons were fixed at w-5 h-5: no
                      useFontScale, well under MIN_TOUCH, and at 1.5x text
                      scale the glyph outgrew the box around it.

                      Now each setting is one pill showing its current value,
                      and tapping it expands the choices directly above the row
                      -- still on this screen, never behind a sheet. Only one
                      expands at a time because they share the row's space, but
                      nothing is hidden by that: every pill states its own
                      value whether or not it's open. */}
                  <View className="gap-1.5">
                    {openSetting !== null && (
                      <View className="bg-surface-2 border border-line rounded-card p-2.5 gap-2">
                        <AppText variant="caption" className="font-sans font-semibold text-ink-2">
                          {openSetting === 'speed' ? 'Playback speed' : 'Times each verse plays before moving on'}
                        </AppText>
                        {openSetting === 'speed' ? (
                          <ChipRow
                            value={listenSpeed}
                            onChange={(v) => { setListenSpeed(Number(v)); setOpenSetting(null); }}
                            options={LISTEN_SPEEDS.map((s) => ({ id: s, label: `${s.toFixed(1)}×` }))}
                          />
                        ) : (
                          <ChipRow
                            value={repeatsPerVerse}
                            onChange={(v) => { setRepeatsPerVerse(Number(v)); setOpenSetting(null); }}
                            options={LISTEN_REPEATS.map((n) => ({ id: n, label: `${n}×` }))}
                          />
                        )}
                      </View>
                    )}

                    <View className="flex-row gap-1.5">
                      <AppButton
                        size="sm"
                        onPress={() => setOpenSetting((cur) => (cur === 'speed' ? null : 'speed'))}
                        className={`flex-row items-center justify-center gap-1 flex-1 rounded-full border ${openSetting === 'speed' ? 'bg-surface-2 border-line-strong' : 'bg-surface border-line-strong'}`}
                      >
                        {/* An icon rather than the word "speed": spelled out,
                            this pill clipped to "1.0x s..." at 1.5x font
                            scale. The expander names it in full once open. */}
                        <Sliders size={10} color={palette.ink3} />
                        <AppText variant="micro" numberOfLines={1} className="font-sans font-semibold text-ink">
                          {listenSpeed.toFixed(1)}×
                        </AppText>
                      </AppButton>

                      <AppButton
                        size="sm"
                        onPress={() => setOpenSetting((cur) => (cur === 'repeats' ? null : 'repeats'))}
                        className={`flex-1 rounded-full border ${openSetting === 'repeats' ? 'bg-surface-2 border-line-strong' : 'bg-surface border-line-strong'}`}
                      >
                        <AppText variant="micro" numberOfLines={1} className="font-sans font-semibold text-ink">
                          {repeatsPerVerse}× each
                        </AppText>
                      </AppButton>

                      {/* End-of-list behaviour -- a plain toggle, so it needs no
                          expander of its own. */}
                      <AppButton
                        size="sm"
                        onPress={() => setRepeatMode((m) => (m === 'playlist' ? 'off' : 'playlist'))}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: repeatMode === 'playlist' }}
                        className={`flex-row items-center gap-1 rounded-full border shrink-0 ${repeatMode === 'playlist' ? 'bg-accent-soft border-accent' : 'bg-surface border-line-strong'}`}
                      >
                        <Repeat size={10} color={repeatMode === 'playlist' ? palette.accent : palette.ink3} />
                        <AppText variant="micro" numberOfLines={1} className={`font-sans font-semibold ${repeatMode === 'playlist' ? 'text-accent' : 'text-ink-2'}`}>
                          {repeatMode === 'playlist' ? 'Loop' : 'Off'}
                        </AppText>
                      </AppButton>
                    </View>
                  </View>

                  {/* Progress bar — overall position across the playlist,
                      smoothly advancing using the real playhead within the
                      current verse's segment.

                      The START and END captions that used to flank the counter
                      are gone: the ends of a progress bar are already its
                      start and its end, and they cost a whole line to say so.
                      What's left is the one caption carrying information,
                      centred under the bar. */}
                  <ListenProgress
                    player={listenPlayer}
                    startSec={currentSegment?.startSec ?? null}
                    endSec={currentSegment?.endSec ?? null}
                    verseIndex={currentVerseIndex}
                    verseCount={activePlayVerses.length}
                    repeatsPerVerse={repeatsPerVerse}
                    verseRepeatsDone={verseRepeatsDone}
                  />

                  {/* Transport. Restart drops to an icon circle -- it's the
                      secondary action and its label was buying a third of the
                      row -- which hands that width to the one control that
                      gets pressed constantly. AppIconButton scales the circle
                      with the font setting and makes up any shortfall against
                      MIN_TOUCH with hitSlop, so shrinking it visually doesn't
                      shrink the tap target.

                      The play label is "Play", not the old "Start Looping":
                      that was only ever true when the repeat pill was on. */}
                  <View className="flex-row items-center gap-2.5 pb-1">
                    <AppIconButton
                      variant="outline"
                      Icon={RefreshCw}
                      diameter={44}
                      iconSize={18}
                      onPress={restartListen}
                      accessibilityLabel="Restart from the first verse"
                      className="shrink-0"
                    />
                    <AppButton
                      size="lg"
                      variant="primary"
                      Icon={listenPlaying ? Pause : Play}
                      label={listenPlaying ? 'Pause' : 'Play'}
                      onPress={toggleListenPlaying}
                      className="flex-1"
                    />
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
                <View className="bg-accent px-3.5 py-1.5 rounded-full">
                  <AppText variant="caption" className="text-on-accent font-sans font-bold">{localToast}</AppText>
                </View>
              </BounceView>
            )}

            {/* Mode picker. Recall is the only graded mode; the rest are
                supplementary drills (see the LearnMode comment above). */}
            {/* The standard segmented control, labels only: at five modes
                the icons were what pushed the old picker onto two rows.
                Segments size to their labels, so "Scramble" gets more room
                than "Spot", and a label wraps rather than being cut off at
                large text sizes. */}
            <View className="mb-3 shrink-0">
              <SegmentedControl
                value={learnTab}
                onChange={switchLearnTab}
                accessibilityLabel="Practice mode"
                options={learnModes.map(({ id, label }) => ({ id, label }))}
              />
            </View>

            {learnTab === 'recite' ? (
              !isFinishedRecite ? (
                <View className="flex-1 justify-between">
                  {/* Passage card frame — typed + spoken progress share one
                      highlight: words before the pointer are graded, the
                      word at the pointer is the "current" target for both
                      channels, everything after is masked. */}
                  <View className={`border rounded-card p-4 flex-1 justify-between relative ${flashError ? 'border-danger bg-danger-soft' : 'border-line bg-surface'}`}>
                    {/* Strike Reset Alert Overlay */}
                    {showStrikeResetAlert && (
                      <FadeInView style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
                        <View className="flex-1 bg-surface/95 items-center justify-center p-4 rounded-card">
                          <SpinView>
                            <View className="w-10 h-10 rounded-full bg-danger-soft items-center justify-center mb-2">
                              <RefreshCw size={20} color={palette.danger} />
                            </View>
                          </SpinView>
                          <AppText variant="body" className="font-sans font-bold text-ink">Starting the verse over</AppText>
                          <AppText variant="caption" className="font-sans text-ink-2 px-4 text-center">
                            That's {strikeLimit} mistakes in this verse, so it starts again from the top. You can change
                            this in Settings.
                          </AppText>
                        </View>
                      </FadeInView>
                    )}

                    <View className="mb-3 shrink-0">
                      <SegmentedControl
                        value={recallDisplayMode}
                        onChange={setRecallDisplayMode}
                        accessibilityLabel="Show the verses as"
                        options={[
                          { id: 'passage' as const, label: 'Passage' },
                          { id: 'memoryGrid' as const, label: 'Memory grid' },
                        ]}
                      />
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
                      <View className="gap-3">
                        {(() => {
                          let flatIdx = 0;
                          return verses.map((v) => {
                            const words = v.text.split(/\s+/);
                            return (
                              <AppText variant="body" key={`${v.book}-${v.chapter}-${v.verse}`} className="font-serif leading-relaxed text-ink">
                                <AppText variant="caption" className="font-sans font-bold text-ink-3">{v.verse} </AppText>
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
                                        ? 'text-danger underline decoration-dotted decoration-danger/50'
                                        : outcome === 'close'
                                          ? 'text-warning'
                                          : 'text-ink';
                                    // Missed words are tappable -- the speech
                                    // engine mis-hears plenty of words the
                                    // user actually said right, and there's
                                    // no reliable automatic fix, so this is
                                    // the manual escape valve.
                                    return (
                                      <AppText variant="inherit"
                                        key={idx}
                                        className={`font-serif font-semibold ${gradeClass}`}
                                        onPress={outcome === 'missed' ? () => overrideWordAsCorrect(g) : undefined}
                                      >
                                        {w}{' '}
                                      </AppText>
                                    );
                                  }

                                  if (!isCountedWord) {
                                    // Punctuation-only token (e.g. a standalone
                                    // dash) -- not part of the recite pointer,
                                    // just render it plainly.
                                    return (
                                      <AppText variant="inherit" key={idx} className="font-serif text-ink">
                                        {w}{' '}
                                      </AppText>
                                    );
                                  }

                                  if (isGivenHint) {
                                    // This word wasn't drawn into the hidden
                                    // sample, so it's shown as a given hint --
                                    // still has to be typed/spoken to advance,
                                    // but isn't a blind guess.
                                    return (
                                      <AppText variant="inherit"
                                        key={idx}
                                        className={`font-serif rounded px-1 ${isCurrent ? 'bg-warning-soft text-ink-2' : 'text-ink-3'}`}
                                      >
                                        {w}{' '}
                                      </AppText>
                                    );
                                  }

                                  if (hintMode === 'firstLetter') {
                                    // Assisted hint -- kept visually distinct
                                    // (sky, not amber/neutral) from both a
                                    // given-hint word and a true blind mask,
                                    // since this run can only ever count as
                                    // a review, never mastery.
                                    return (
                                      <AppText variant="inherit"
                                        key={idx}
                                        className={`font-sans rounded px-1 font-bold ${
                                          isCurrent ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3'
                                        }`}
                                      >
                                        {maskExceptFirstLetter(w)}{' '}
                                      </AppText>
                                    );
                                  }

                                  return (
                                    <AppText variant="inherit"
                                      key={idx}
                                      className={`font-sans rounded px-1 font-bold ${
                                        isCurrent ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3'
                                      }`}
                                    >
                                      {maskLetters(w)}{' '}
                                    </AppText>
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
                          {/* Red only once there's a mistake to count. */}
                          {strikeLimit !== 'unlimited' && (
                            <AppText variant="caption" className={`font-sans font-medium ${verseStrikes > 0 ? 'text-danger' : 'text-ink-3'}`}>
                              {verseStrikes} of {strikeLimit} mistakes
                            </AppText>
                          )}
                        </View>
                        <AppText variant="caption" className="font-sans font-medium text-ink-3">{recitePointer} of {reciteWordObjects.length} words</AppText>
                      </View>

                      <View className="flex-row items-center gap-2">
                        {/* Short enough to fit an SE at 1.5x. Nearby keys still
                            count; that's forgiveness, not an instruction. */}
                        <AppTextInput value={typedInput} onChangeText={handleReciteTypeChar} placeholder={showStrikeResetAlert ? 'Starting over…' : fontScale >= 1.3 ? 'First letters' : 'First letter of each word'} style={{ minWidth: 0 }} className="flex-1 bg-surface-2 border border-line rounded-btn py-2 px-3 text-center font-sans font-semibold text-ink" editable={!showStrikeResetAlert} />
                        {speechAvailable && (
                          <AppIconButton
                            Icon={isListeningSpeak ? MicOff : Mic}
                            diameter={40}
                            iconColor={palette.onAccent}
                            onPress={() => (isListeningSpeak ? stopListening() : startListening())}
                            accessibilityLabel={isListeningSpeak ? 'Stop listening' : 'Say it out loud'}
                            className={`shrink-0 ${isListeningSpeak ? 'bg-danger' : 'bg-accent'}`}
                          />
                        )}
                      </View>
                      {isListeningSpeak && (
                        <View className="h-6 items-center justify-center bg-surface-2 rounded-lg border border-line">
                          <WaveBars active count={16} />
                        </View>
                      )}
                    </View>
                  </View>

                  <DrillSettings>
                  {/* How many words get hidden this attempt -- changing it or
                      resetting always re-rolls a fresh random subset.
                      % Hidden only grades at 100% (Blind); First Letter
                      grades as a review at any level, but never mastery --
                      see the finish panel split below. Passage-mode only --
                      %-hidden has no meaning against the grid, which is
                      always first-letter (or now, always blank). */}
                  {recallDisplayMode === 'passage' && (
                    <DrillSetting
                      storageKey="recall.hiding"
                      first
                      label="Words hidden"
                      valueClassName={hintMode === 'firstLetter' ? 'text-accent' : 'text-ink-2'}
                      value={
                        hintMode === 'firstLetter'
                          ? 'First letters · review only'
                          : activeLevel === 100
                            ? 'All (blind)'
                            : `${activeLevel}% · practice only`
                      }
                    >
                      <SegmentedControl
                        value={hintMode}
                        onChange={switchHintMode}
                        accessibilityLabel="How words are hidden"
                        options={[
                          { id: 'percent' as const, label: 'Hide words' },
                          { id: 'firstLetter' as const, label: 'Show first letters' },
                        ]}
                      />
                      {hintMode === 'percent' && (
                        // 0-100 in steps of 5. The row above reads the
                        // current value out, so the slider needs only its
                        // two ends labeled rather than 21 stops.
                        <View style={{ gap: 2 }}>
                          <DiscreteSlider
                            value={activeLevel}
                            onChange={(level) => {
                              setActiveLevel(level);
                              resetReciteGame();
                              regenerateHiddenWords(level);
                            }}
                            options={HIDE_LEVELS}
                            showStopLabels={false}
                            accessibilityLabel="Words hidden"
                          />
                          <RangeCaption min="None" max="All" />
                        </View>
                      )}
                      <AppText variant="caption" className="text-ink-3 font-sans">
                        {hintMode === 'firstLetter'
                          ? 'Counts as a review, but never toward learning a verse.'
                          : 'Only a run with every word hidden counts as a review.'}
                      </AppText>
                    </DrillSetting>
                  )}

                  {/* Memory Grid's own hide setting -- no slider, since the
                      grid is either showing first letters or not; there's no
                      in-between percentage to speak of. */}
                  {recallDisplayMode === 'memoryGrid' && (
                    <DrillSetting
                      storageKey="recall.grid"
                      first
                      label="Grid shows"
                      value={gridHideMode === 'blank' ? 'Nothing' : 'First letters'}
                    >
                      <SegmentedControl
                        value={gridHideMode}
                        onChange={setGridHideMode}
                        accessibilityLabel="What the grid shows"
                        options={[
                          { id: 'firstLetter' as const, label: 'First letters' },
                          { id: 'blank' as const, label: 'Nothing' },
                        ]}
                      />
                    </DrillSetting>
                  )}
                  </DrillSettings>

                  <View className="mt-2.5 flex-row gap-2.5">
                    <AppButton
                      variant="quiet"
                      Icon={fontScale >= 1.3 ? undefined : RefreshCw}
                      label="Start over"
                      onPress={() => { resetReciteGame(); regenerateHiddenWords(activeLevel); }}
                      className="flex-1"
                    />
                    <AppButton variant="secondary" Icon={fontScale >= 1.3 ? undefined : Eye} label="Reveal word" onPress={handleReciteHint} className="flex-1" />
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
                        <View className="w-12 h-12 bg-accent-soft rounded-full items-center justify-center">
                          <Shuffle size={24} color={palette.accent} />
                        </View>
                      </BounceView>
                      <View className="items-center gap-1">
                        <AppText variant="title" className="font-sans font-bold text-ink leading-tight">Nice practice run</AppText>
                        <AppText variant="label" className="text-ink-2 font-sans text-center px-4">
                          {pct}% word accuracy with {hideLevel}% of words hidden. Anything short of every word hidden is
                          warm-up only, so nothing was logged.
                        </AppText>
                      </View>

                      <View className="w-full gap-2">
                        <AppButton
                          variant="primary"
                          Icon={Shuffle}
                          label="Practice again with new words hidden"
                          onPress={() => { resetReciteGame(); regenerateHiddenWords(hideLevel); }}
                        />
                        <AppButton
                          variant="quiet"
                          label="Try it with every word hidden"
                          onPress={() => {
                            setHideLevel(100);
                            resetReciteGame();
                            regenerateHiddenWords(100);
                          }}
                        />
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
                        <View className={`w-12 h-12 rounded-full items-center justify-center ${summary.passesReview ? 'bg-success-soft' : 'bg-accent-soft'}`}>
                          <Sparkles size={24} color={summary.passesReview ? palette.success : palette.accent} />
                        </View>
                      </BounceView>
                      <View className="items-center gap-1">
                        {assisted && <Badge tone="accent" label="First letters shown" />}
                        <AppText variant="title" className="font-sans font-bold text-ink leading-tight text-center">
                          {isMasteryEligible ? 'Perfect recall' : summary.passesReview ? (assisted && summary.isPerfect ? 'Nicely recalled' : 'Close enough') : 'Keep practicing'}
                        </AppText>
                        <AppText variant="label" className="text-ink-2 font-sans text-center">
                          {pct}% word accuracy: {summary.perfectWords} exact
                          {summary.closeWords > 0 ? `, ${summary.closeWords} near-miss` : ''}
                          {summary.missedWords > 0 ? `, ${summary.missedWords} missed` : ''} of {summary.totalWords} words.
                        </AppText>
                      </View>

                      <View className="w-full bg-surface-2 border border-line rounded-card p-3 gap-1.5 max-h-[110px]">
                        <ScrollView>
                          {verses.map((v) => (
                            <AppText variant="label" key={v.verse} className="font-serif italic text-ink-2">
                              <AppText variant="micro" className="font-sans font-bold text-ink-3 not-italic">{v.verse} </AppText>
                              {v.text}
                            </AppText>
                          ))}
                        </ScrollView>
                      </View>

                      <View className="w-full gap-2">
                        {isMasteryEligible ? (
                          <>
                            <AppButton
                              size="lg"
                              variant="primary"
                              Icon={Check}
                              label="Log perfect recall"
                              onPress={() => { onUpdateStatus(verses, 'memorized', drill, { perfect: true }); handleGroupComplete(); }}
                            />
                            <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                              Counts as a review, and as one of the perfect recalls a new verse needs.
                            </AppText>
                          </>
                        ) : summary.passesReview ? (
                          <>
                            <AppButton
                              size="lg"
                              variant="primary"
                              Icon={Check}
                              label="Count as a review"
                              onPress={() => { onUpdateStatus(verses, 'memorized', drill, { perfect: false }); handleGroupComplete(); }}
                            />
                            <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                              {assisted
                                ? 'With first letters shown, this counts as a review but not toward learning a new verse. Hide every word for that.'
                                : `${pct}% clears the ${passPct}% a review needs. A new verse only moves forward on a perfect run.`}
                            </AppText>
                          </>
                        ) : (
                          <>
                            <AppButton
                              size="lg"
                              variant="primary"
                              label="Log as needs practice"
                              onPress={() => { onUpdateStatus(verses, 'learning', drill); handleGroupComplete(); }}
                            />
                            <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                              A review needs {passPct}% of the words right.
                            </AppText>
                          </>
                        )}
                        <AppButton variant="quiet" label="Practice again" onPress={resetReciteGame} />
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
                        <Info size={12} color={palette.ink3} />
                        <AppText variant="caption" className="text-ink-3 font-sans flex-1">
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
                            className={`border rounded-card p-2.5 min-h-[52px] justify-center ${
                              tile === null
                                ? 'border-dashed border-line-strong bg-surface-2'
                                : showResult
                                  ? isRight
                                    ? 'border-success bg-success-soft'
                                    : 'border-danger/60 bg-danger-soft'
                                  : 'border-line-strong bg-surface'
                            }`}
                          >
                            {tile === null ? (
                              <AppText variant="caption" className="font-sans font-medium text-ink-3">Slot {slotIdx + 1}</AppText>
                            ) : (
                              <View className="flex-row items-start gap-2">
                                <View className={`px-1.5 py-0.5 rounded ${showResult ? (isRight ? 'bg-success' : 'bg-danger') : 'bg-accent'}`}>
                                  <AppText variant="micro" className="font-sans font-bold text-on-accent">{slotIdx + 1}</AppText>
                                </View>
                                <AppText variant="label" className="font-serif leading-snug text-ink flex-1">{tile.text}</AppText>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}

                      {/* Tile bank */}
                      {bankRemaining.length > 0 && (
                        <View className="mt-1 gap-2">
                          <AppText variant="caption" className="font-sans font-semibold text-ink-3">Verses to place</AppText>
                          {bankRemaining.map((tileIdx) => (
                            <Pressable
                              key={`bank-${jigsawTiles[tileIdx].id}`}
                              onPress={() => {
                                const firstEmpty = jigsawSlots.findIndex((s) => s === null);
                                if (firstEmpty === -1) return;
                                setJigsawSlots((prev) => prev.map((s, i) => (i === firstEmpty ? tileIdx : s)));
                                setJigsawChecked(false);
                              }}
                              className="border border-line bg-surface-2 rounded-card p-2.5"
                            >
                              <AppText variant="label" className="font-serif leading-snug text-ink-2">{jigsawTiles[tileIdx].text}</AppText>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </ScrollView>

                    <View className="shrink-0 gap-2">
                      {solved ? (
                        <View className="bg-success-soft border border-success/30 rounded-card p-2.5 flex-row items-center justify-center gap-2">
                          <Trophy size={14} color={palette.success} />
                          <AppText variant="caption" className="font-sans font-bold text-success">Correct order! Practice only — nothing logged.</AppText>
                        </View>
                      ) : jigsawChecked ? (
                        <View className="bg-warning-soft border border-warning/30 rounded-card p-2.5">
                          <AppText variant="caption" className="font-sans font-bold text-warning text-center">
                            {correctCount} of {jigsawTiles.length} in the right place — tap a wrong one to move it.
                          </AppText>
                        </View>
                      ) : null}
                      <View className="flex-row gap-2">
                        <AppButton variant="quiet" Icon={Undo2} label="Reshuffle" onPress={resetJigsaw} className="flex-1" />
                        <AppButton variant="primary" Icon={Check} label="Check order" onPress={() => setJigsawChecked(true)} disabled={!allPlaced} className="flex-1" />
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
                      <Layers size={28} color={palette.ink3} />
                      <AppText variant="body" className="font-sans font-bold text-ink-2 text-center">Nothing to build</AppText>
                      <AppText variant="caption" className="text-ink-3 font-sans text-center">There's no verse text here to split into phrases.</AppText>
                    </View>
                  );
                }

                if (buildFinished) {
                  return (
                    <View className="flex-1 items-center justify-center gap-3 px-4">
                      <View className="w-12 h-12 rounded-full bg-success-soft items-center justify-center">
                        <Check size={24} color={palette.success} />
                      </View>
                      <AppText variant="body" className="font-sans font-bold text-ink text-center">
                        {verses.length > 1 ? 'The whole passage, from memory' : 'The whole verse, from memory'}
                      </AppText>
                      <AppText variant="caption" className="text-ink-3 font-sans text-center">
                        Build up doesn't count toward review — the words were on screen and you graded yourself. Want to prove it cold?
                      </AppText>
                      <AppButton size="lg" variant="primary" Icon={Mic} label="Try it blind in Recall" onPress={handoffToRecall} className="w-full" />
                      <AppButton variant="quiet" Icon={RefreshCw} label="Run it again" onPress={resetBuildUp} className="w-full" />
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
                        <AppText variant="caption" className="font-sans font-semibold text-ink-3 flex-1">
                          {stage.phase === 'reassemble'
                            ? `Putting it together — verse ${stage.step} of ${stage.stepCount}`
                            : `${verse ? `${verse.chapter}:${verse.verse} — ` : ''}phrase ${stage.step} of ${stage.stepCount}`}
                        </AppText>
                        <Pressable onPress={() => setBuildSettingsOpen((p) => !p)} hitSlop={8} className="flex-row items-center gap-1">
                          <Sliders size={12} color={palette.ink3} />
                          <AppText variant="caption" className="font-sans font-semibold text-ink-2">
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
                              className={`h-1.5 flex-1 rounded-full ${isNewest ? 'bg-warning' : inPlay ? 'bg-accent' : 'bg-fill'}`}
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
                      <View className="shrink-0 bg-surface-2 border border-line rounded-card p-2.5 gap-2 mb-2">
                        {/* Label ABOVE the chips, not beside them. ChipRow's
                            default chips are flex-1, so they need the full
                            row width to divide -- sitting them next to a label
                            in a justify-between row leaves them sizing against
                            whatever's left over, and the labels spill out. */}
                        <View className="gap-1">
                          <AppText variant="caption" className="font-sans font-bold text-ink-2">Bite size</AppText>
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
                          <AppText variant="caption" className="font-sans font-bold text-ink-2">Build from</AppText>
                          <ChipRow
                            options={[
                              { id: 'forward' as BuildDirection, label: 'The start' },
                              { id: 'backward' as BuildDirection, label: 'The end' },
                            ]}
                            value={buildDirection}
                            onChange={changeBuildDirection}
                          />
                        </View>
                        <AppText variant="caption" className="text-ink-3 font-sans">
                          Building from the end means every repetition finishes on the words you know best. Changing either setting restarts the verse.
                        </AppText>
                      </View>
                    )}

                    {/* The passage. Everything in play fades together; the
                        phrase just added is the amber one. */}
                    <ScrollView className="flex-1" contentContainerClassName="grow justify-center py-2">
                      <View className="border border-line bg-surface rounded-card p-4">
                        <AppText variant="title" className="font-serif leading-[30px]">
                          {stage.segments.map((seg, i) => (
                            <AppText variant="inherit" key={i} className={seg.isNew ? 'text-warning' : 'text-ink'}>
                              {maskBuildSegment(seg.text)}
                              {i < stage.segments.length - 1 ? ' ' : ''}
                            </AppText>
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
                                className={`w-2 h-2 rounded-full ${reached ? 'bg-accent' : 'border border-line-strong'}`}
                              />
                              <AppText variant="caption" className={`font-sans ${ i === buildRepIdx ? 'font-semibold text-ink' : 'font-medium text-ink-3' }`} >
                                {rep === 'read' ? 'Read' : rep === 'hint' ? 'Hints' : 'From memory'}
                              </AppText>
                            </View>
                          );
                        })}
                      </View>

                      <AppButton size="lg" variant="primary" label={actionLabel} onPress={advanceBuildUp} className="w-full">
                        <ChevronRight size={17} color={palette.onAccent} />
                      </AppButton>

                      <View className="flex-row gap-2">
                        <AppButton
                          variant="quiet"
                          Icon={Undo2}
                          label="Back"
                          onPress={stepBackBuildUp}
                          disabled={buildStageIdx === 0 && buildRepIdx === 0}
                          className="flex-1"
                        />
                        {buildRep !== 'read' && (
                          <AppButton
                            variant={buildPeek ? 'secondary' : 'quiet'}
                            Icon={buildPeek ? EyeOff : Eye}
                            label={buildPeek ? 'Hide' : 'Peek'}
                            onPress={() => setBuildPeek((p) => !p)}
                            className="flex-1"
                          />
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
                      <Puzzle size={28} color={palette.ink3} />
                      <AppText variant="body" className="font-sans font-bold text-ink-2 text-center">Nothing to scramble</AppText>
                      <AppText variant="caption" className="text-ink-3 font-sans text-center">
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
                        <AppText variant="caption" className="font-sans font-semibold text-ink-3 flex-1">
                          {round.label} — verse {scrambleIndex + 1} of {scrambleRounds.length}
                        </AppText>
                        {scrambleSolved.has(scrambleIndex) && <Check size={12} color={palette.success} />}
                      </View>

                      {/* Construct box. A correct arrangement confirms itself
                          the moment it's complete (no Check press needed) --
                          the last tile landing IS the answer. Only a wrong
                          arrangement waits for an explicit Check, so the
                          drill never pre-emptively tells you you're wrong
                          while you're still placing tiles. */}
                      <View
                        className={`border rounded-card p-3 min-h-[110px] ${
                          solved
                            ? 'border-success bg-success-soft'
                            : scrambleChecked
                              ? 'border-danger/60 bg-danger-soft'
                              : 'border-line bg-surface'
                        }`}
                      >
                        {scrambleSlots.every((s) => s === null) ? (
                          <AppText variant="caption" className="text-ink-3 font-sans">Tap the phrases below to build the verse</AppText>
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
                                    scrambleChecked && phraseIdx !== slotIdx ? 'bg-danger-soft border-danger/30' : 'bg-accent border-accent'
                                  }`}
                                >
                                  <AppText variant="label" className={`font-serif ${scrambleChecked && phraseIdx !== slotIdx ? 'text-danger' : 'text-on-accent'}`}>
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
                              className="px-2 py-1 rounded-lg border border-line-strong bg-surface-2"
                            >
                              <AppText variant="label" className="font-serif text-ink-2">{round.phrases[phraseIdx]}</AppText>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </ScrollView>

                    <View className="shrink-0 gap-2">
                      {(solved || scrambleChecked) && (
                        <View className={`rounded-card p-2.5 ${solved ? 'bg-success-soft border border-success/30' : 'bg-warning-soft border border-warning/30'}`}>
                          <AppText variant="caption" className={`font-sans font-bold text-center ${solved ? 'text-success' : 'text-warning'}`}>
                            {solved
                              ? isLastRound
                                ? 'That’s the whole passage! Practice only — nothing logged.'
                                : 'That’s the verse! Practice only — nothing logged.'
                              : 'Not quite — tap a red tile to send it back.'}
                          </AppText>
                        </View>
                      )}
                      <View className="flex-row gap-2">
                        <AppButton
                          variant="quiet"
                          Icon={Undo2}
                          label="Clear"
                          onPress={() => { setScrambleSlots(round.phrases.map(() => null)); setScrambleChecked(false); }}
                          className="flex-1"
                        />
                        {solved && !isLastRound ? (
                          <AppButton variant="primary" label="Next verse" onPress={() => setScrambleIndex((i) => i + 1)} className="flex-1">
                            <ChevronRight size={15} color={palette.onAccent} />
                          </AppButton>
                        ) : (
                          <AppButton variant="primary" Icon={Check} label="Check" onPress={() => setScrambleChecked(true)} disabled={!allPlaced} className="flex-1" />
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
                        <Info size={12} color={palette.ink3} />
                        <AppText variant="caption" className="text-ink-3 font-sans flex-1">
                          {swapSubmitted ? 'Green = caught, red = missed, amber = wrongly flagged' : 'Tap every word that does not belong'}
                        </AppText>
                      </View>

                      {noDecoys ? (
                        <AppText variant="caption" className="text-ink-3 font-sans">
                          This passage is too short to hide imposters in. Try a longer selection.
                        </AppText>
                      ) : (
                        swapVerses.map((sv) => (
                          <AppText variant="body" key={sv.id} className="font-serif leading-relaxed text-ink">
                            <AppText variant="caption" className="font-sans font-bold text-ink-3">{sv.label} </AppText>
                            {sv.tokens.map((tok) => {
                              const isSelected = swapSelected.has(tok.index);
                              let cls = 'text-ink';
                              if (swapSubmitted) {
                                if (tok.isDecoy && isSelected) cls = 'text-success font-bold';
                                else if (tok.isDecoy && !isSelected) cls = 'text-danger font-bold underline';
                                else if (!tok.isDecoy && isSelected) cls = 'text-warning line-through';
                              } else if (isSelected) {
                                cls = 'text-accent font-bold underline';
                              }
                              return (
                                <AppText variant="inherit"
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
                                </AppText>
                              );
                            })}
                          </AppText>
                        ))
                      )}

                      {/* After submitting, show what the swapped words really were */}
                      {swapSubmitted && score.totalDecoys > 0 && (
                        <View className="bg-surface-2 border border-line rounded-card p-2.5 gap-1">
                          <AppText variant="caption" className="font-sans font-semibold text-ink-3">The real words</AppText>
                          {swapVerses.flatMap((sv) =>
                            sv.tokens
                              .filter((t) => t.isDecoy)
                              .map((t) => (
                                <AppText variant="label" key={t.index} className="font-serif text-ink-2">
                                  <AppText variant="inherit" className="text-danger line-through">{t.display}</AppText> → <AppText variant="inherit" className="text-success font-bold">{t.original}</AppText>
                                </AppText>
                              ))
                          )}
                        </View>
                      )}
                    </ScrollView>

                    <View className="shrink-0 gap-2">
                      {swapSubmitted ? (
                        <View className="bg-surface-2 border border-line rounded-card p-2.5">
                          <AppText variant="caption" className="font-sans font-bold text-ink text-center">
                            Caught {score.caught} of {score.totalDecoys}
                            {score.falseAlarms > 0 ? ` · ${score.falseAlarms} wrongly flagged` : ''} — practice only, nothing logged.
                          </AppText>
                        </View>
                      ) : (
                        // Label ABOVE the chips -- ChipRow's default chips are
                        // flex-1, so next to a label in a justify-between row
                        // they size against the leftovers and squash to
                        // slivers (same fix as the Build-up settings).
                        <View className="bg-surface-2 border border-line rounded-card px-3 py-2 gap-1">
                          <AppText variant="caption" className="font-sans font-bold text-ink-2">Swaps per verse</AppText>
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
                        <AppButton variant="quiet" Icon={Shuffle} label="New swaps" onPress={() => resetSwap()} className="flex-1" />
                        {!swapSubmitted && (
                          <AppButton variant="primary" Icon={Check} label="Check" onPress={() => setSwapSubmitted(true)} disabled={noDecoys} className="flex-1" />
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
