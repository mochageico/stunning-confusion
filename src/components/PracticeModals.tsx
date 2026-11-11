import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronUp, Headphones, Pause, Play, SlidersHorizontal, X } from 'lucide-react-native';

import { VerseState, QueueItem, Recording, ChapterPhoto, ChapterSections, ListenPlaylist } from '../types';
import type { ReviewCompletedOpts } from '../state/useAppState';
import type { OutlineExtra } from '../lib/outline';
import type { SelfCheckAnswer } from '../lib/grading';
import { isRtl, scriptOfVerse } from '../lib/textScript';
import { WaveBars } from './ui';
import { AppIconButton, AppText, FontScaleOverrideProvider, RadioMark, useFontScale, useScaledSpace } from './design';
import { PRACTICE_TEXT_SCALE, useAppPrefs } from '../lib/appPrefs';
import { Badge, Dialog, GroupedList, ListRow } from './blocks';
import { ModeChip } from './session';

import { useThemeColors } from './theme';
import { useAboveTabBar } from './TabBar';
import { useListenPlayback, type ListenSource } from './practice/useListenPlayback';
import { useRecall, type LearnMode } from './practice/useRecall';
import ListenPanel from './practice/ListenPanel';
import RecallPanel from './practice/RecallPanel';
import ManualLogFlow from './practice/ManualLogFlow';
import { logManualAnswers } from './practice/ManualLogSheet';
import type { TakeawayDraft } from '../lib/sectionDrills';

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
    opts?: ReviewCompletedOpts
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
  // Which list Listen opens on (see usePracticeSession). Defaults to the
  // verses handed in.
  initialListenSource?: ListenSource;
  // Listen playlists (see useLocalPrefs) and the editor's save/delete. The
  // editor's Browse the Bible view starts on your usual translation.
  listenPlaylists?: ListenPlaylist[];
  onSaveListenPlaylist?: (playlist: ListenPlaylist) => void;
  onDeleteListenPlaylist?: (id: string) => void;
  preferredTranslationId?: string;
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
  // The Learn tab to open on instead of Recall (the chapter page's First
  // words button).
  initialLearnTab?: LearnMode;
  // First words (Outline): the chapter's sections, for the dividers, and where
  // the per-verse taps are saved (the same chapter doc).
  sectionsForChapter?: (book: string, chapter: number) => ChapterSections | null;
  onSaveOutlineExtra?: (book: string, chapter: number, extra: OutlineExtra) => void;
  /** Teach-It's "Save as takeaway draft": true when kept, false when that section already has its takeaway. */
  onSaveTakeawayDraft?: (draft: TakeawayDraft) => boolean;
}

// Stable default, so the playlist effect in useListenPlayback doesn't rerun
// (and reset playback) on every render when no playlists are passed.
const EMPTY_PLAYLISTS: ListenPlaylist[] = [];

// Guard wrapper: the early "nothing to practice" return must happen OUTSIDE
// the component that declares hooks. Returning before the useState/useEffect
// calls below meant that if `verses` ever became empty while the modal was
// mounted, React would see fewer hooks than the previous render and crash
// ("Rendered fewer hooks than expected").
export default function PracticeModals(props: PracticeModalsProps) {
  // Settings > Verse text > Practice text size: the practice screen's text,
  // on top of the phone's own size.
  const fontScale = useFontScale();
  const { practiceTextSize } = useAppPrefs();
  if (!props.verses || props.verses.length === 0) return null;
  return (
    <FontScaleOverrideProvider scale={fontScale * PRACTICE_TEXT_SCALE[practiceTextSize]}>
      <PracticeModalsInner {...props} />
    </FontScaleOverrideProvider>
  );
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
  initialListenSource = 'selection',
  listenPlaylists = EMPTY_PLAYLISTS,
  onSaveListenPlaylist,
  onDeleteListenPlaylist,
  preferredTranslationId,
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
  initialLearnTab,
  sectionsForChapter,
  onSaveOutlineExtra,
  onSaveTakeawayDraft,
}: PracticeModalsProps) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const fontScale = useFontScale();
  const handleGroupComplete = onAdvance ?? onClose;
  // Listen playback (see practice/useListenPlayback).
  const listen = useListenPlayback({
    type,
    verses,
    allVerses,
    memoryQueue,
    primingLookahead,
    reviewsPaused,
    initialSource: initialListenSource,
    playlists: listenPlaylists,
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
  const {
    activePlayVerses,
    referenceText,
    listenPlaying,
    currentVerseIndex,
    currentSegment,
    toggleListenPlaying,
  } = listen;

  // Minimizing (Listen mode's X button) keeps this whole component mounted
  // -- and with it, the real listenPlayer instance and the auto-advance
  // effect below -- so audio genuinely keeps playing/looping while the user
  // navigates the rest of the app, instead of onClose tearing the player
  // down. Only a real full-stop (the mini-bar's own X) calls the real
  // onClose. True OS-level background/lock-screen playback is a separate,
  // later piece of work -- this only keeps it going while the app itself is
  // foregrounded.
  const [listenMinimized, setListenMinimized] = useState(false);

  // Settings > Recall and typing > Hide the reference: drilling the
  // reference too, so the header keeps it back until tapped. Each new group
  // in a review session starts hidden again.
  const { hideReference } = useAppPrefs();
  const [referenceShown, setReferenceShown] = useState(false);
  useEffect(() => setReferenceShown(false), [verses]);
  const referenceHidden = hideReference && type === 'learn' && !referenceShown;

  // The first-time tip boxes are gone (UI simplify plan: the owner found
  // the explanation paragraphs excessive); the tutorial rework covers them.
  // The settings pop-up and the mode picker are centered pop-ups.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [modesOpen, setModesOpen] = useState(false);
  const closeOptions = useCallback(() => setOptionsOpen(false), []);
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
  const recall = useRecall({
    verses,
    onPickUpThread,
    sessionTotal,
    memoryQueue,
    passageScript,
    initialLearnTab,
    reviewsPaused,
    chapterSectionsDoc: verses[0] ? sectionsForChapter?.(verses[0].book, verses[0].chapter) ?? null : null,
  });

  // Closing mid-Recall (the X, the Home button) saves the verses already
  // said, as a Mixed review round does. The ref holds this render's closure so
  // the unmount cleanup sees the latest run, not the first render's.
  const savePartialRef = useRef<() => void>(() => {});
  savePartialRef.current = () => {
    if (type !== 'learn') return;
    const credit = recall.partialCredit();
    if (!credit) return;
    onUpdateStatus(credit.verses, 'memorized', credit.usedSpeech ? 'speak' : 'type', { perfect: false, gradeFor: credit.gradeFor });
  };
  useEffect(() => () => savePartialRef.current(), []);

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
  const openManualLog = useCallback(() => setShowManualLog(true), []);

  // A self-check per verse (practice/ManualLogSheet says what each answer does).
  const submitManualLog = (answers: SelfCheckAnswer[], canMoveUp: boolean) => {
    setShowManualLog(false);
    logManualAnswers(verses, answers, onUpdateStatus, canMoveUp);
    handleGroupComplete();
  };
  const manualSelfCheckedLast = verses.some((v) =>
    (memoryQueue || []).some(
      (q) =>
        q.lastSelfChecked &&
        q.book === v.book &&
        q.chapter === v.chapter &&
        q.verseNumber === v.verse &&
        (!v.translationId || (q.translationId || 'ESV') === v.translationId)
    )
  );

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
    // Clear of the notch / Dynamic Island: a fixed top padding sat under it
    // on taller-notched phones.
    <View className="absolute inset-0 bg-surface z-50 pb-4 px-4" style={{ paddingTop: insets.top + 12 }} id="practice_overlay">
      {/* Header. Practice (UI simplify plan, Job 2): close, the session's
          progress, and the gear on one row; the reference and the "Recall v"
          mode chip under it. Listen keeps its own header until Job 3. */}
      {type === 'learn' ? (
        <View className="mb-3" style={{ gap: space(12) }}>
          <View className="flex-row items-center" style={{ gap: space(12) }}>
            <AppIconButton variant="outline" Icon={X} diameter={40} onPress={onClose} accessibilityLabel="Close" />
            <View className="flex-1">
              {!!sessionTotal && sessionTotal > 1 ? (
                <View
                  className="bg-fill rounded-full overflow-hidden"
                  style={{ height: 8 /* layout-ok: a progress track, no text */ }}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: sessionTotal, now: (sessionPosition ?? 1) - 1 }}
                >
                  <View
                    className="bg-accent rounded-full"
                    style={{ height: 8 /* layout-ok: track fill */, width: `${(((sessionPosition ?? 1) - 1) / sessionTotal) * 100}%` }}
                  />
                </View>
              ) : null}
            </View>
            {!!sessionTotal && sessionTotal > 1 ? (
              <AppText variant="caption" className="font-sans font-semibold text-ink-3">
                {`${sessionPosition} of ${sessionTotal}`}
              </AppText>
            ) : null}
            <AppIconButton
              variant="outline"
              Icon={SlidersHorizontal}
              diameter={40}
              onPress={() => setOptionsOpen(true)}
              accessibilityLabel="Practice settings"
            />
          </View>
          <View className="flex-row items-center" style={{ gap: space(10) }}>
            {/* flex-1 so a long reference wraps instead of pushing the chip
                off the screen. Non-breaking hyphen: a range wraps as
                "Romans / 8:28-29", never "Romans 8:28- / 29". */}
            <View className="flex-1">
              {referenceHidden ? (
                <Pressable
                  onPress={() => setReferenceShown(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Reference hidden. Show it."
                  className="self-start active:opacity-60"
                >
                  <AppText variant="title" className="font-sans font-bold text-ink-3 leading-tight">
                    Reference hidden
                  </AppText>
                  <AppText variant="caption" className="font-sans font-semibold text-accent">
                    Show
                  </AppText>
                </Pressable>
              ) : (
                <AppText variant="display" className="font-sans font-bold text-ink" style={{ letterSpacing: -0.4 }} numberOfLines={2}>
                  {referenceText.replace(/-/g, '‑')}
                </AppText>
              )}
            </View>
            <ModeChip
              label={recall.learnModes.find((m) => m.id === recall.learnTab)?.label ?? 'Recall'}
              onPress={() => setModesOpen(true)}
              accessibilityLabel="Way to practice, change"
            />
          </View>
        </View>
      ) : (
        <View className="flex-row items-center justify-between border-b border-hairline pb-2 mb-3" style={{ gap: 8 }}>
          <View className="flex-1">
            <AppText variant="title" className="font-sans font-bold text-ink leading-tight" numberOfLines={2}>
              {referenceText.replace(/-/g, '‑')}
            </AppText>
          </View>
          <View className="flex-row items-center gap-2 shrink-0">
            {!!sessionTotal && sessionTotal > 1 && <Badge label={`${sessionPosition} of ${sessionTotal}`} />}
            <AppIconButton variant="outline" Icon={X} onPress={() => setListenMinimized(true)} accessibilityLabel="Minimize" />
          </View>
        </View>
      )}

      {/* The way-to-practice picker: centered, one tap picks and closes. */}
      <Dialog visible={modesOpen} onClose={() => setModesOpen(false)} title="Way to practice">
        <GroupedList>
          {recall.learnModes.map((mode) => (
            <ListRow
              key={mode.id}
              Icon={mode.Icon}
              title={mode.label}
              accessory={<RadioMark selected={mode.id === recall.learnTab} />}
              onPress={() => {
                recall.switchLearnTab(mode.id);
                setModesOpen(false);
              }}
            />
          ))}
        </GroupedList>
      </Dialog>

      {/* Manual log. The same sheet as the one on Today's review rows. */}
      <ManualLogFlow
        visible={showManualLog}
        title={`Log ${referenceText}`}
        verses={verses}
        memoryQueue={memoryQueue || []}
        selfCheckedLast={manualSelfCheckedLast}
        onClose={() => setShowManualLog(false)}
        onLog={submitManualLog}
      />

      {/* Main Panel */}
      <View className="flex-1 justify-between py-1">
        {/* ======================================================== */}
        {/* LISTEN MODE VIEW */}
        {/* ======================================================== */}
        {type === 'listen' && (
          <ListenPanel
            listen={listen}
            verses={verses}
            allVerses={allVerses}
            memoryQueue={memoryQueue}
            primingLookahead={primingLookahead}
            setPrimingLookahead={setPrimingLookahead}
            playlists={listenPlaylists}
            onSavePlaylist={onSaveListenPlaylist}
            onDeletePlaylist={onDeleteListenPlaylist}
            preferredTranslationId={preferredTranslationId}
            highlightedVerses={highlightedVerses}
            onToggleVerseHighlight={onToggleVerseHighlight}
            verseDoodles={verseDoodles}
            onSaveVerseDoodle={onSaveVerseDoodle}
            memoryGridColumns={memoryGridColumns}
            photoCache={photoCache}
            onCacheChapterPhoto={onCacheChapterPhoto}
            onAddChapterPhoto={onAddChapterPhoto}
            palette={palette}
            space={space}
          />
        )}

        {/* ======================================================== */}
        {/* LEARN MODE — Recall / Reveal tabs                          */}
        {/* ======================================================== */}
        {type === 'learn' && (
          <RecallPanel
            recall={recall}
            verses={verses}
            onUpdateStatus={onUpdateStatus}
            onPickUpThread={onPickUpThread}
            highlightedVerses={highlightedVerses}
            onToggleVerseHighlight={onToggleVerseHighlight}
            verseDoodles={verseDoodles}
            onSaveVerseDoodle={onSaveVerseDoodle}
            memoryGridColumns={memoryGridColumns}
            palette={palette}
            fontScale={fontScale}
            handleGroupComplete={handleGroupComplete}
            passageScript={passageScript}
            sectionsForChapter={sectionsForChapter}
            onSaveOutlineExtra={onSaveOutlineExtra}
            onSaveTakeawayDraft={onSaveTakeawayDraft}
            optionsOpen={optionsOpen}
            onCloseOptions={closeOptions}
            onManualLog={openManualLog}
          />
        )}
      </View>

    </View>
  );
}
