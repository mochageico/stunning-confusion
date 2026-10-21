import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  ChevronUp,
  ClipboardCheck,
  Eye,
  Headphones,
  Mic,
  MicOff,
  MoveVertical,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Shuffle,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react-native';

import { VerseState, QueueItem, Recording, ChapterPhoto } from '../types';
import { normalizeToken, summarizeOutcomes, REVIEW_PASS_ACCURACY } from '../lib/recitation';
import { isRtl, maskExceptFirstLetter, maskLetters, scriptOfVerse, splitWords, wordGap } from '../lib/textScript';
import { MIN_JIGSAW_VERSES } from '../lib/drills';
import { BounceView, ChipRow, DiscreteSlider, FadeInView, SpinView, WaveBars } from './ui';
import { Dropdown } from './Dropdown';
import MemoryGrid from './MemoryGrid';
import ListenPhotoView from './ListenPhotoView';
import { AppButton, AppIconButton, AppTextInput, AppText, RangeCaption, useFontScale, useScaledSpace } from './design';
import { Badge, Dialog, EmptyState, SegmentedControl } from './blocks';

import { useThemeColors } from './theme';
import { useAboveTabBar } from './TabBar';
import BuildUpDrill from './drills/BuildUpDrill';
import JigsawDrill from './drills/JigsawDrill';
import ScrambleDrill from './drills/ScrambleDrill';
import SpotSwapDrill from './drills/SpotSwapDrill';
import {
  DrillSetting,
  DrillSettings,
  EMPTY_PHOTO_CACHE,
  HIDE_LEVELS,
  LISTEN_REPEATS,
  LISTEN_SPEEDS,
  ListenProgress,
} from './practice/shared';
import { useListenPlayback } from './practice/useListenPlayback';
import { useRecall } from './practice/useRecall';

export interface PracticeModalsProps {
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
  // Opens Pick up the thread through this verse, after a passing Recall has
  // been logged. Absent: the offer isn't shown.
  onPickUpThread?: (target: VerseState) => void;
  // Chained-review-session progress ("2 of 5"), shown in the header when
  // sessionTotal > 1. Both default to 0/undefined for a non-session launch.
  sessionPosition?: number;
  sessionTotal?: number;
  memoryQueue?: QueueItem[];
  primingLookahead?: number;
  // Settings -> Pause Reviews is on: nothing is due, so the "reviewing" and
  // "Today's Verses" playlists leave due reviews out, same as Home.
  reviewsPaused?: boolean;
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
  onPickUpThread,
  sessionPosition,
  sessionTotal,
  memoryQueue,
  primingLookahead = 30,
  reviewsPaused = false,
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
  // Listen playback (see practice/useListenPlayback).
  const {
    playSource,
    setPlaySource,
    activePlayVerses,
    listenViewMode,
    setListenViewMode,
    selectionStart,
    setSelectionStart,
    selectionEnd,
    setSelectionEnd,
    referenceText,
    listenPlaying,
    listenSpeed,
    setListenSpeed,
    currentVerseIndex,
    setCurrentVerseIndex,
    repeatMode,
    setRepeatMode,
    repeatsPerVerse,
    setRepeatsPerVerse,
    verseRepeatsDone,
    openSetting,
    setOpenSetting,
    autoFollow,
    setAutoFollow,
    verseListRef,
    verseContentRef,
    verseCardRefs,
    playableSegments,
    hasAnyAudio,
    currentSegment,
    photoVerse,
    photosForCurrentChapter,
    sessionHasPhotos,
    listenPlayer,
    restartListen,
    toggleListenPlaying,
    handleVerseClick,
    segmentStatusLabel,
  } = useListenPlayback({
    type,
    verses,
    allVerses,
    memoryQueue,
    primingLookahead,
    reviewsPaused,
    userRecordings,
    selectedChapterAudios,
    studioPlaybackEnabled,
    audioCacheMap,
    onCacheAudio,
    onListenPlayingChange,
    playingRecordingId,
    setPlayingRecordingId,
    chapterPhotos,
  });

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
  const aboveTabBar = useAboveTabBar();

  // The passage's writing system. One per session: every way into practice
  // (a Home group, a chapter-page selection) is a single translation and
  // chapter, so a group never mixes Hebrew with Greek or English. Every
  // split, compare and mask below goes through it -- word masks
  // (maskLetters / maskExceptFirstLetter) included, since an English-only
  // mask leaves Hebrew words fully visible.
  const passageScript = useMemo(() => (verses.length > 0 ? scriptOfVerse(verses[0]) : 'latin'), [verses]);
  // Rows that set words or a verse beside its number (word tiles, Order's
  // numbered slots) run right-to-left for Hebrew; the text itself gets
  // `script={passageScript}` on its AppText.
  const passageRow = isRtl(passageScript) ? 'flex-row-reverse' : 'flex-row';

  // Recall and the learn-mode drills (see practice/useRecall).
  const {
    learnTab,
    reciteWordObjects,
    recitePointer,
    reciteOutcomes,
    verseStrikes,
    strikeLimit,
    showStrikeResetAlert,
    typedInput,
    flashError,
    isFinishedRecite,
    finalOutcomes,
    isListeningSpeak,
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
    threadTarget,
    notDueLine,
    allNotDue,
    startListening,
    stopListening,
    onBuildUpTryBlind,
  } = useRecall({
    verses,
    onPickUpThread,
    sessionTotal,
    memoryQueue,
    passageScript,
  });

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

  // Minimized Listen mode: a small persistent bar instead of the full
  // overlay, floating just above the tab bar in the same pill style as the
  // app's own now-playing bar. It renders as an absolutely-positioned
  // sibling, not inside the tab bar's tray, so it takes its offset from
  // useAboveTabBar rather than inheriting it.
  // pointerEvents="box-none" on the full-screen wrapper means only the bar
  // itself (given pointerEvents="auto") captures touches -- everything else
  // on screen stays reachable, so the user can genuinely navigate the rest
  // of the app while this keeps playing.
  if (type === 'listen' && listenMinimized) {
    const miniVerse = currentSegment?.verseObj ?? activePlayVerses[currentVerseIndex] ?? null;
    return (
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
        {/* button-ok: the floating now-playing bar, not a button */}
        <Pressable
          onPress={() => setListenMinimized(false)}
          pointerEvents="auto"
          accessibilityRole="button"
          accessibilityLabel="Open Listen"
          style={{ position: 'absolute', left: 16, right: 16, bottom: aboveTabBar, paddingVertical: space(6), paddingLeft: space(6), paddingRight: space(6), gap: space(10) }}
          className="bg-surface border border-line rounded-full flex-row items-center shadow-md active:bg-surface-2"
        >
          <View className="rounded-full bg-accent-soft items-center justify-center shrink-0" style={{ width: space(36), height: space(36) }}>
            {/* Moving bars while it plays; at rest they shrink to nothing, so
                a headphones icon holds the spot instead. */}
            {listenPlaying ? <WaveBars active count={4} /> : <Headphones size={16} color={palette.accent} />}
          </View>
          <View className="flex-1" style={{ gap: 1, minWidth: 0 }}>
            <View className="flex-row items-center gap-1">
              <ChevronUp size={10} color={palette.ink3} />
              <AppText variant="micro" className="text-ink-3 font-sans font-semibold">Now playing</AppText>
            </View>
            <AppText variant="label" numberOfLines={1} className="text-ink font-sans font-semibold">
              {miniVerse ? `${miniVerse.book} ${miniVerse.chapter}:${miniVerse.verse}` : referenceText}
            </AppText>
          </View>
          <AppIconButton
            Icon={listenPlaying ? Pause : Play}
            variant="filled"
            diameter={36}
            accessibilityLabel={listenPlaying ? 'Pause' : 'Play'}
            onPress={(e) => {
              e.stopPropagation();
              toggleListenPlaying();
            }}
          />
          <AppIconButton Icon={X} variant="bare" diameter={36} iconColor={palette.ink3} accessibilityLabel="Stop listening" onPress={(e) => { e.stopPropagation(); onClose(); }} />
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
          {/* Non-breaking hyphen: at large text a range wraps as "Romans /
              8:28-29", never "Romans 8:28- / 29". */}
          <AppText variant="title" className="font-sans font-bold text-ink leading-tight" numberOfLines={2}>
            {referenceText.replace(/-/g, '‑')}
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
                    verses={activePlayVerses.map((v) => ({ book: v.book, chapter: v.chapter, verse: v.verse, text: v.text, translationId: v.translationId }))}
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
                      <AppText variant="body" script={scriptOfVerse(verseObj)} className={`font-serif leading-relaxed ${textClassName}`}>{verseObj.text}</AppText>
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
                  <AppButton // button-ok: a Listen setting pill that draws its own on/off state
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
                      <AppButton // button-ok: a Listen setting pill that draws its own on/off state
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

                      <AppButton // button-ok: a Listen setting pill that draws its own on/off state
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
                      <AppButton // button-ok: a Listen setting pill that draws its own on/off state
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
                          verses={verses.map((v) => ({ book: v.book, chapter: v.chapter, verse: v.verse, text: v.text, translationId: v.translationId }))}
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
                            const words = splitWords(v.text, passageScript);
                            return (
                              <AppText variant="body" script={passageScript} key={`${v.book}-${v.chapter}-${v.verse}`} className="font-serif leading-relaxed text-ink">
                                <AppText variant="caption" className="font-sans font-bold text-ink-3">{v.verse} </AppText>
                                {words.map((w, idx) => {
                                  const isCountedWord = normalizeToken(w, passageScript).length > 0;
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
                                        {w}{wordGap(w)}
                                      </AppText>
                                    );
                                  }

                                  if (!isCountedWord) {
                                    // Punctuation-only token (e.g. a standalone
                                    // dash) -- not part of the recite pointer,
                                    // just render it plainly.
                                    return (
                                      <AppText variant="inherit" key={idx} className="font-serif text-ink">
                                        {w}{wordGap(w)}
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
                                        {w}{wordGap(w)}
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
                                        {maskExceptFirstLetter(w, passageScript)}{wordGap(w)}
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
                                      {maskLetters(w, passageScript)}{wordGap(w)}
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
                        <AppTextInput value={typedInput} onChangeText={handleReciteTypeChar} autoCapitalize="none" autoCorrect={false} spellCheck={false} placeholder={showStrikeResetAlert ? 'Starting over…' : fontScale >= 1.3 ? 'First letters' : 'First letter of each word'} style={{ minWidth: 0 }} className="flex-1 bg-surface-2 border border-line rounded-btn py-2 px-3 text-center font-sans font-semibold text-ink" editable={!showStrikeResetAlert} />
                        {/* English only: phone speech engines know modern
                            Hebrew at best, with no vowel points, so they
                            can't grade Biblical Hebrew or Koine Greek. Typing
                            still works for both. */}
                        {speechAvailable && passageScript === 'latin' && (
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
                            <AppText variant="label" script={passageScript} key={v.verse} className="font-serif italic text-ink-2">
                              <AppText variant="micro" className="font-sans font-bold text-ink-3 not-italic">{v.verse} </AppText>
                              {v.text}
                            </AppText>
                          ))}
                        </ScrollView>
                      </View>

                      <View className="w-full gap-2">
                        {allNotDue ? (
                          <>
                            <AppButton size="lg" variant="primary" Icon={Check} label="Done" onPress={handleGroupComplete} />
                            <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                              {notDueLine}
                            </AppText>
                          </>
                        ) : isMasteryEligible ? (
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
                        {!allNotDue && notDueLine !== '' && (
                          <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                            {notDueLine}
                          </AppText>
                        )}
                        {summary.passesReview && threadTarget && (
                          <AppButton
                            variant="secondary"
                            label={allNotDue ? `Pick up the thread to v${threadTarget.verse}` : `Count it and pick up the thread to v${threadTarget.verse}`}
                            onPress={() => {
                              if (!allNotDue) onUpdateStatus(verses, 'memorized', drill, { perfect: isMasteryEligible });
                              onPickUpThread?.(threadTarget);
                            }}
                          />
                        )}
                        <AppButton variant="quiet" label="Practice again" onPress={resetReciteGame} />
                      </View>
                    </ScrollView>
                  );
                })()
              )
            ) : null}

            {/* Drills extracted into their own components stay mounted while
                another tab is showing, so switching away and back keeps your
                place, as it did when their state lived up here. */}
            {verses.length >= MIN_JIGSAW_VERSES && (
              <View className="flex-1" style={{ display: learnTab === 'jigsaw' ? 'flex' : 'none' }}>
                <JigsawDrill verses={verses} />
              </View>
            )}
            <View className="flex-1" style={{ display: learnTab === 'buildUp' ? 'flex' : 'none' }}>
              <BuildUpDrill verses={verses} onTryBlind={onBuildUpTryBlind} />
            </View>
            <View className="flex-1" style={{ display: learnTab === 'scramble' ? 'flex' : 'none' }}>
              <ScrambleDrill verses={verses} />
            </View>
            <View className="flex-1" style={{ display: learnTab === 'spotSwap' ? 'flex' : 'none' }}>
              <SpotSwapDrill verses={verses} />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
