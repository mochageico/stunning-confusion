import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { GestureDetector } from 'react-native-gesture-handler';
import { Bookmark, Brackets, Check, ChevronDown, Download, Grid2x2, GripVertical, LayoutGrid, List, ListTree, Pause, Play, Printer, Search } from 'lucide-react-native';

import { AppState, resolveChapterAudio } from '../state/useAppState';
import { recordingFitsTranslation } from '../lib/appData';
import { cacheableTarget } from '../lib/audioCache';
import { ChipRow, DiscreteSlider, FadeInView } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import ChapterPhotoStrip from '../components/ChapterPhotoStrip';
import ChapterLibraryPlayer from '../components/ChapterLibraryPlayer';
import { WeakSpotDot } from '../components/VerseStages';
import { LIBRARY_READER, libraryTimingsKey } from '../lib/libraryAudio';
import { useLibraryTimings } from '../state/useLibraryAudio';
import { usePickerTranslations } from '../state/usePickerTranslations';
import MemoryGrid, { verseAnnotationKey } from '../components/MemoryGrid';
import { printMemoryGrid } from '../lib/printMemoryGrid';
import { formatLabel } from '../lib/formatNames';
import { Recording } from '../types';
import { BIBLE_TRANSLATIONS, copyrightFor, textScriptFor, translationLabel } from '../data';
import { isRtl, joinWords, splitWords } from '../lib/textScript';
import { AppButton, AppIconButton, AppText, AppTextInput, RangeCaption, useFontScale, useScaledSpace } from '../components/design';
import { Dialog, ScreenHeader, SectionHeader, SegmentedControl } from '../components/blocks';
import { useDragSelect } from '../components/useDragSelect';
import {
  BracketGutter,
  displayLetter,
  DropLine,
  phraseSummary,
  SectionHeaderRow,
  SectionsEditIntro,
  useGutterWidth,
} from '../components/ChapterSections';
import {
  emptyDraft,
  isBlankDraft,
  isEmptyDraft,
  memoryAidOf,
  mergeAt,
  moveStart,
  normalizeDraft,
  phraseLetters,
  sameDraft,
  SectionDraft,
  sectionIndexOf,
  sectionsFromStarts,
  setSectionText,
  setVerseWord,
  splitAt,
  versePhrase,
} from '../lib/sections';

import { useThemeColors } from '../components/theme';
import { OneTimeTip } from '../components/OneTimeTip';
const OVERRIDE_PHASE_OPTIONS: { id: 'learning' | 'daily' | 'weekly' | 'monthly' | 'retained'; label: string }[] = [
  { id: 'learning', label: 'Learning' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'retained', label: 'Complete' },
];
const OVERRIDE_WEEKDAY_OPTIONS = [
  { id: 'M', label: 'Mon' },
  { id: 'T', label: 'Tue' },
  { id: 'W', label: 'Wed' },
  { id: 'Th', label: 'Thu' },
  { id: 'F', label: 'Fri' },
  { id: 'S', label: 'Sat' },
  { id: 'Su', label: 'Sun' },
];

// A verse's status as a dot (list, grid) and as words (screen readers).
const STATUS_DOT: Record<string, string> = { memorized: 'bg-success', learning: 'bg-warning' };
const STATUS_WORD: Record<string, string> = { memorized: 'memorized', learning: 'learning' };

// "Due: Today" reads as a label on a form; "Due today" reads as a sentence.
function dueLabel(dueDate: string | undefined): string | null {
  if (!dueDate) return null;
  const m = dueDate.match(/^Due:\s*(.*)$/i);
  if (!m) return dueDate;
  const when = /^(today|tomorrow)$/i.test(m[1]) ? m[1].toLowerCase() : m[1];
  return `Due ${when}`;
}

export default function ChapterLandingScreen({ state }: { state: AppState }) {
  const pickerTranslations = usePickerTranslations();
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const {
    handleBack,
    navigateTo,
    selectedBook,
    selectedChapter,
    selectedVerseNumbers,
    toggleSelectAll,
    activeChapterVerses,
    activeChapterTextLoading,
    activeChapterTextError,
    selectedTranslationId,
    setSelectedTranslationId,
    isVerseSelected,
    toggleVerseSelection,
    setSelectedVerseNumbers,
    addVersesToQueue,
    overrideVerseMemoryStatus,
    chapterViewMode,
    setChapterViewMode,
    highlightedVerses,
    toggleVerseHighlight,
    verseDoodles,
    saveVerseDoodle,
    memoryGridColumns,
    setMemoryGridColumns,
    selectedChapterAudios,
    setSelectedChapterAudios,
    showAudioSelector,
    setShowAudioSelector,
    userRecordings,
    reorderChapterRecordings,
    audioCache,
    downloadingRecordingIds,
    saveChapterOffline,
    studioPlaybackEnabled,
    playingRecordingId,
    setPlayingRecordingId,
    playingRecProgress,
    setPlayingRecProgress,
    formatTime,
    setFeedBookFilter,
    setFeedChapterFilter,
    triggerToast,
    startPractice,
    dailyPhaseWeeks,
    weeklyPhaseMonths,
    monthlyPhaseYears,
    sectionsForChapter,
    saveChapterSections,
  } = state;

  // Manual memory-status override panel — for verses already memorized
  // outside the app (e.g. "I already know all of Ephesians 1, put it
  // straight into Weekly review"). Local to this screen since it only ever
  // acts on the current selection; resets whenever it's closed/reopened.
  const [showStatusOverride, setShowStatusOverride] = useState(false);
  const [overridePhase, setOverridePhase] = useState<'learning' | 'daily' | 'weekly' | 'monthly' | 'retained'>('weekly');
  const [overrideWeekday, setOverrideWeekday] = useState<string | null>(null);
  // How far into the phase's graduation cycle these verses should start,
  // as a percent of the way to graduating -- mirrors the same threshold
  // handleReviewCompleted graduates a real review streak on (see
  // dailyGraduationDays/weeklyGraduationReviews/monthlyGraduationReviews in
  // useAppState.ts). 0% = just began (streak 1, same as the old hardcoded
  // behavior); 100% = graduates on the very next successful review, same as
  // if it had organically climbed there. Percent stops (not a raw 1..N
  // count) because the graduation target can be 50+ reviews for
  // Weekly/Monthly -- a labeled stop per review would be unreadable.
  const [overrideProgressPercent, setOverrideProgressPercent] = useState(0);
  const overrideProgressMax =
    overridePhase === 'daily'
      ? dailyPhaseWeeks * 7
      : overridePhase === 'weekly'
        ? Math.round(weeklyPhaseMonths * (52 / 12))
        : overridePhase === 'monthly'
          ? monthlyPhaseYears * 12
          : 1;
  const overrideProgressCount = Math.max(1, Math.round((overrideProgressPercent / 100) * overrideProgressMax));
  // A raw review count ("37 of 49") doesn't tell you where that lands on a
  // calendar -- surface the enclosing week/month/year too, using the same
  // cadence each phase graduates on (1 review/day for Daily, ~1/week for
  // Weekly, 1/month for Monthly).
  const overrideProgressUnit =
    overridePhase === 'daily'
      ? `Week ${Math.max(1, Math.ceil(overrideProgressCount / 7))} of ${dailyPhaseWeeks}`
      : overridePhase === 'weekly'
        ? `Month ${Math.max(1, Math.ceil(overrideProgressCount / (52 / 12)))} of ${weeklyPhaseMonths}`
        : overridePhase === 'monthly'
          ? `Year ${Math.max(1, Math.ceil(overrideProgressCount / 12))} of ${monthlyPhaseYears}`
          : '';

  const activeChapterKey = `${selectedBook}_${selectedChapter}`;

  // Filter user recordings saved in library that match this chapter — these
  // are real Recording objects (with a real audioUrl), so selecting one here
  // and playing it uses the exact same playingRecordingId/playingRecProgress
  // mechanism as Profile/RecordingDetail/the floating now-playing bar.
  const availableNarrations = userRecordings.filter(
    (r) =>
      r.book.toLowerCase() === (selectedBook || '').toLowerCase() &&
      r.chapter === selectedChapter &&
      recordingFitsTranslation(r, selectedTranslationId)
  );
  // Priority-ordered top to bottom -- the top item is this chapter's default
  // playback source (see resolveChapterAudio); dragging in the panel below
  // reorders this list and persists the new priority.
  const optionsList = [...availableNarrations].sort(
    (a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)
  );
  const currentAudio = resolveChapterAudio(
    userRecordings,
    selectedChapterAudios,
    selectedBook || '',
    selectedChapter || 0,
    selectedTranslationId
  );
  const isPlayingThis = !!currentAudio && playingRecordingId === currentAudio.id;

  // The built-in Hebrew reading, for an Old Testament chapter shown in
  // Hebrew/Greek only. The user's own recording in the same language stays
  // the default when there is one; the reading is then a choice in the list.
  const libraryRefs = useMemo(
    () => [{ book: selectedBook || '', chapter: selectedChapter || 0, translationId: selectedTranslationId }],
    [selectedBook, selectedChapter, selectedTranslationId]
  );
  const libraryTimingsMap = useLibraryTimings(libraryRefs);
  const libraryKey = libraryTimingsKey(selectedTranslationId, selectedBook || '', selectedChapter || 0);
  const libraryTimings = (libraryKey && libraryTimingsMap.get(libraryKey)) || null;
  const [libraryPickedFor, setLibraryPickedFor] = useState<string | null>(null);
  const libraryActive = !!libraryTimings && (!currentAudio || libraryPickedFor === activeChapterKey);

  // Offline downloads for this chapter's recordings. "Downloadable" excludes
  // anything still being processed — cacheableTarget returns null while a
  // studio render is pending, since whichever file we saved would be
  // superseded minutes later.
  const downloadableNarrations = availableNarrations.filter((r) => cacheableTarget(r, studioPlaybackEnabled));
  // `pinned`, not `map`: a file that merely happens to be auto-cached is still
  // evictable, so it hasn't really been "saved offline" yet.
  const notYetDownloaded = downloadableNarrations.filter((r) => {
    const target = cacheableTarget(r, studioPlaybackEnabled)!;
    return !audioCache.pinned.has(target.storagePath);
  });
  const chapterDownloadBusy = downloadableNarrations.some((r) => downloadingRecordingIds.has(r.id));

  const floatingBarShowing = selectedVerseNumbers.length > 0;

  // Hold a verse, then slide to select a run of them (all three views).
  const scrollRef = useRef<ScrollView>(null);
  const [floatingBarHeight, setFloatingBarHeight] = useState(0);
  const dragSelect = useDragSelect({
    ids: activeChapterVerses.map((v) => v.verse),
    selected: selectedVerseNumbers,
    setSelected: setSelectedVerseNumbers,
    onTap: toggleVerseSelection,
    scrollRef,
    bottomInset: floatingBarShowing ? floatingBarHeight + 16 : 0,
  });
  const activeTranslation = BIBLE_TRANSLATIONS.find((t) => t.id === selectedTranslationId) ?? BIBLE_TRANSLATIONS[0];
  // Per book, not per translation: the Hebrew/Greek translation owes credit
  // for its Greek New Testament only.
  const activeCopyright = copyrightFor(activeTranslation.id, selectedBook || undefined);
  // Hebrew/Greek: the chapter's writing system. Hebrew lays verse rows and
  // tiles out right-to-left (number on the right, verse 1 top-right).
  const chapterScript = textScriptFor(activeTranslation.id, selectedBook || '');
  const rtl = isRtl(chapterScript);
  const selectedVerses = () => activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse));
  const oneVerse = selectedVerseNumbers.length === 1;
  const them = oneVerse ? 'it' : 'them';

  // ── Sections ──────────────────────────────────────────────────────────────
  // The user's own sections for this chapter, drawn as colored brackets down
  // the left of the list (MIXED_REVIEW_PLAN.md, stage 1). Edit sections is a
  // mode of its own: taps split instead of select, and the hold-and-drag
  // selection is off, so the two gestures never compete.
  const firstVerse = activeChapterVerses[0]?.verse ?? 1;
  const lastVerse = activeChapterVerses[activeChapterVerses.length - 1]?.verse ?? firstVerse;
  const savedSections = selectedBook && selectedChapter ? sectionsForChapter(selectedBook, selectedChapter) : null;
  // A doc that holds only First words taps (nothing written for sections or
  // the memory phrase) counts as nothing saved here.
  const normalizedSaved = savedSections && activeChapterVerses.length > 0 ? normalizeDraft(savedSections, firstVerse, lastVerse) : null;
  const savedDraft = normalizedSaved && !isEmptyDraft(normalizedSaved) ? normalizedSaved : null;
  // Non-null while editing: the sections as edited so far, saved on Done.
  const [editDraft, setEditDraft] = useState<SectionDraft | null>(null);
  const editing = editDraft !== null;
  const shownDraft = editDraft ?? savedDraft;
  // Brackets and header rows only for real sections (or while editing them):
  // a chapter with just per-verse phrase words has none.
  const hasSections = !!shownDraft && (editing || !isBlankDraft(shownDraft));
  const sections = shownDraft && hasSections ? sectionsFromStarts(shownDraft, lastVerse) : [];
  const letters = phraseLetters(sections, activeChapterVerses, chapterScript);
  const gutterForMode = useGutterWidth(editing);
  const gutterWidth = hasSections ? gutterForMode : 0;

  // The memory phrase: off, a word per section, or a word per verse (in the
  // last case the verse's own first letter is the field's hint).
  const memoryAid = memoryAidOf(shownDraft);
  const verseLetters =
    memoryAid === 'verses'
      ? phraseLetters(activeChapterVerses.map((v) => ({ start: v.verse, end: v.verse })), activeChapterVerses, chapterScript)
      : [];
  const phrase =
    memoryAid === 'sections' && sections.length > 0
      ? phraseSummary(sections, letters, chapterScript)
      : memoryAid === 'verses'
        ? versePhrase(shownDraft?.verseWords, activeChapterVerses.map((v) => v.verse))
        : null;

  // A handle mid-drag: which start, and the verse it would land on. The list
  // doesn't reflow until the finger lifts (the handle would move out from
  // under it); the bars recolor and a line marks the landing verse instead.
  const [drag, setDrag] = useState<{ index: number; to: number } | null>(null);
  const dragRef = useRef<{ index: number; to: number } | null>(null);
  const barDraft = !hasSections ? null : shownDraft && drag ? moveStart(shownDraft, drag.index, drag.to, lastVerse) : shownDraft;
  // Verse rows by index, and their on-screen spans measured when a drag
  // starts. Measured fresh rather than kept from onLayout: inserting a header
  // row moves the rows below it without resizing them, and web reports only
  // size changes. The page can't scroll mid-drag, so the spans hold until the
  // finger lifts.
  const rowRefs = useRef<(View | null)[]>([]);
  const rowSpans = useRef<({ y: number; height: number } | undefined)[]>([]);
  const spansReady = useRef(false);
  const lastFingerY = useRef(0);

  useEffect(() => {
    setEditDraft(null);
    setDrag(null);
    dragRef.current = null;
  }, [selectedBook, selectedChapter]);

  // The verse under a finger (screen y). Over a section's header row, that's
  // the verse the header sits on.
  const verseAtY = (y: number) => {
    for (let i = 0; i < activeChapterVerses.length; i++) {
      const r = rowSpans.current[i];
      if (r && r.y + r.height > y) return activeChapterVerses[i].verse;
    }
    return lastVerse;
  };
  const setDragTo = (next: { index: number; to: number } | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  const followFinger = (absoluteY: number) => {
    lastFingerY.current = absoluteY;
    const d = dragRef.current;
    if (!d || !spansReady.current) return;
    const to = verseAtY(absoluteY);
    if (to !== d.to) setDragTo({ ...d, to });
  };
  const handleFor = (index: number) => ({
    onDragStart: (absoluteY: number) => {
      setDragTo({ index, to: editDraft?.starts[index] ?? firstVerse });
      spansReady.current = false;
      lastFingerY.current = absoluteY;
      const rows = activeChapterVerses.map((_, i) => rowRefs.current[i]);
      let left = rows.length;
      rowSpans.current = [];
      rows.forEach((row, i) => {
        const done = () => {
          if (--left > 0) return;
          spansReady.current = true;
          followFinger(lastFingerY.current);
        };
        if (!row) return done();
        row.measureInWindow((_x, y, _w, height) => {
          rowSpans.current[i] = { y, height };
          done();
        });
      });
    },
    onDragMove: followFinger,
    onDragEnd: (commit: boolean) => {
      const d = dragRef.current;
      if (d && commit) setEditDraft((prev) => prev && moveStart(prev, d.index, d.to, lastVerse));
      setDragTo(null);
    },
    onJoin: () => setEditDraft((prev) => prev && mergeAt(prev, index)),
    onStep: (delta: 1 | -1) => setEditDraft((prev) => prev && moveStart(prev, index, prev.starts[index] + delta, lastVerse)),
  });

  const startEditingSections = () => {
    setSelectedVerseNumbers([]);
    setEditDraft(savedDraft ?? emptyDraft(firstVerse));
  };
  const finishEditingSections = () => {
    if (editDraft && selectedBook && selectedChapter) {
      const next = normalizeDraft(editDraft, firstVerse, lastVerse);
      if (!sameDraft(next, savedDraft ?? emptyDraft(firstVerse))) {
        void saveChapterSections(selectedBook, selectedChapter, next);
        triggerToast(isEmptyDraft(next) ? 'Sections removed' : 'Saved');
      }
    }
    setEditDraft(null);
    setDragTo(null);
  };
  // Hold-and-drag selection wraps the list, except while editing sections.
  const withDragSelect = (child: React.ReactElement) =>
    editing ? child : <GestureDetector gesture={dragSelect.gesture}>{child}</GestureDetector>;
  const cancelEditingSections = () => {
    setEditDraft(null);
    setDragTo(null);
  };
  const tapVerseWhileEditing = (verse: number) => {
    if (!editDraft) return;
    if (editDraft.starts.includes(verse)) {
      triggerToast(
        verse === firstVerse
          ? 'The first section always starts here.'
          : 'A section already starts here. Double-tap its handle to join it to the one above.'
      );
      return;
    }
    setEditDraft(splitAt(editDraft, verse, lastVerse));
  };

  // Grid tiles fill each row exactly: as many columns as fit at the smallest
  // comfortable tile (which grows with text size), sharing the leftover room.
  const [gridWidth, setGridWidth] = useState(0);
  const tileGap = space(8);
  const minTile = space(96);
  const gridColumns = Math.max(1, Math.floor((gridWidth + tileGap) / (minTile + tileGap)));
  const tileWidth = gridWidth > 0 ? Math.floor((gridWidth - tileGap * (gridColumns - 1)) / gridColumns) : minTile;

  // The recordings feed, already filtered to this chapter.
  const openRecordingsFeed = () => {
    setFeedBookFilter(selectedBook || '');
    setFeedChapterFilter(String(selectedChapter ?? ''));
    navigateTo('audioFeed');
    triggerToast(`Showing recordings of ${selectedBook} ${selectedChapter}`);
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        {...dragSelect.scrollProps}
        // Frozen while a section handle is dragged, like a drag-select.
        scrollEnabled={dragSelect.scrollProps.scrollEnabled && !drag}
        className="flex-1 bg-canvas"
        contentContainerClassName="p-5"
        // Extra bottom padding whenever the floating selection bar is
        // showing, so the last verses and the copyright notice can
        // still fully scroll into view above it rather than being hidden
        // underneath -- the bar itself no longer takes up real space in
        // the scroll flow (see below), so nothing pushes content up for it
        // automatically.
        contentContainerStyle={{ gap: space(16), paddingBottom: floatingBarShowing || editing ? floatingBarHeight + 32 : 16 }}
      >
        {/* Back can lead to Today, the chapter grid or elsewhere, so it
            says "Back" rather than naming one of them. The translation picker
            sits in the actions slot: it decides which text loads here and
            which translation gets set on any verses added from here.
            Progress on the same verse in two translations is tracked
            separately (see buildVerseId in useAppState.ts). */}
        <ScreenHeader
          title={`${selectedBook} ${selectedChapter}`}
          subtitle={
            activeChapterVerses.length > 0
              ? `${activeChapterVerses.filter((v) => v.status === 'memorized').length} of ${activeChapterVerses.length} verses memorized`
              : undefined
          }
          onBack={handleBack}
          actions={
            <>
              {/* The pill names the translation; Hebrew/Greek is too long
                  for it, so it shortens there and stays spelled out in the menu. */}
              <Dropdown
                value={selectedTranslationId}
                onChange={setSelectedTranslationId}
                options={pickerTranslations.map((t) => ({ id: t.id, label: translationLabel(t.id) }))}
                triggerLabel={selectedTranslationId === 'HEBGRK' ? 'Hb/Gk' : translationLabel(selectedTranslationId)}
                title="Translation"
                searchable={false}
                compact
              />
              {/* How the verses are laid out. Edit sections always shows the
                  list, so the switch steps aside while it's open. */}
              {!editing && (
                <Dropdown
                  value={chapterViewMode}
                  onChange={setChapterViewMode}
                  options={[
                    { id: 'list', label: 'List' },
                    { id: 'grid', label: 'Grid' },
                    { id: 'memoryGrid', label: 'Memory grid' },
                  ]}
                  TriggerIcon={chapterViewMode === 'grid' ? LayoutGrid : chapterViewMode === 'memoryGrid' ? Grid2x2 : List}
                  title="Verse layout"
                  searchable={false}
                  compact
                />
              )}
            </>
          }
        />

        <OneTimeTip
          id="chapterPage"
          text="Tap verses to select them, then Add to learn them. Already know some by heart? Select them and tap Status instead."
        />

        {/* Chapter progress: one sliver per verse, in the same status colors
            as the dots beside each verse. The count is in the subtitle. */}
        <View>
          <View className="flex-row h-2 w-full rounded-full overflow-hidden bg-fill">
            {activeChapterVerses.map((v) => {
              const statusColor =
                v.status === 'memorized' ? 'bg-success' : v.status === 'learning' ? 'bg-warning' : 'bg-fill';
              return (
                <View
                  key={v.verse}
                  className={`${statusColor} flex-1 border-r border-canvas`}
                />
              );
            })}
          </View>
        </View>

        {/* This chapter's recording and photos of the user's Bible pages, in
            one slim card: play and the recording's name on the left (tap the
            name to change which recording plays), pages on the right. */}
        <View className="bg-surface border border-line rounded-card" style={{ padding: space(10), gap: space(10) }}>
          {libraryActive && libraryTimings ? (
            <ChapterLibraryPlayer
              book={selectedBook || ''}
              timings={libraryTimings}
              audioCacheMap={audioCache.map}
              onStart={() => setPlayingRecordingId(null)}
              suspended={!!playingRecordingId}
              onPressTitle={() => setShowAudioSelector(!showAudioSelector)}
              titleExpanded={showAudioSelector}
              trailing={
                <>
                  <View className="self-stretch bg-line" style={{ width: 1 }} />
                  <ChapterPhotoStrip state={state} book={selectedBook || ''} chapter={selectedChapter ?? 0} />
                </>
              }
            />
          ) : (
            <>
              <View className="flex-row items-center" style={{ gap: space(10) }}>
                {currentAudio ? (
                  <>
                    <AppIconButton
                      variant="filled"
                      Icon={isPlayingThis ? Pause : Play}
                      diameter={34}
                      accessibilityLabel={isPlayingThis ? 'Pause' : `Play ${currentAudio.title}`}
                      onPress={() => {
                        if (isPlayingThis) {
                          setPlayingRecordingId(null);
                        } else {
                          setPlayingRecordingId(currentAudio.id);
                          setPlayingRecProgress(0);
                        }
                      }}
                    />
                    <Pressable
                      onPress={() => setShowAudioSelector(!showAudioSelector)}
                      accessibilityRole="button"
                      accessibilityLabel={`${currentAudio.title}, by ${currentAudio.user}. Change recording`}
                      accessibilityState={{ expanded: showAudioSelector }}
                      className="flex-1 active:opacity-60"
                      style={{ minWidth: 0 }}
                    >
                      <View className="flex-row items-center" style={{ gap: space(4) }}>
                        <AppText variant="label" className="font-sans font-semibold text-ink shrink" numberOfLines={1}>
                          {currentAudio.title}
                        </AppText>
                        <ChevronDown size={Math.round(13 * scale)} color={palette.ink3} strokeWidth={2.4} />
                      </View>
                      <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
                        {currentAudio.user} · {translationLabel(currentAudio.translation)}
                      </AppText>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    onPress={openRecordingsFeed}
                    accessibilityRole="button"
                    className="flex-1 flex-row items-center active:opacity-60"
                    style={{ gap: space(6), paddingVertical: space(4) }}
                  >
                    <Search size={Math.round(16 * scale)} color={palette.accent} />
                    <AppText variant="caption" className="font-sans font-semibold text-accent">
                      Find a recording
                    </AppText>
                  </Pressable>
                )}
                <View className="self-stretch bg-line" style={{ width: 1 }} />
                <ChapterPhotoStrip state={state} book={selectedBook || ''} chapter={selectedChapter ?? 0} />
              </View>

              {/* Real playback progress bar */}
              {currentAudio && isPlayingThis && (
                <View style={{ gap: space(4) }}>
                  <View className="w-full bg-fill h-1 rounded-full overflow-hidden">
                    <View className="bg-accent h-full" style={{ width: `${playingRecProgress}%` }} />
                  </View>
                  <View className="flex-row justify-between">
                    <AppText variant="caption" className="font-sans text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
                      {formatTime(Math.round((playingRecProgress / 100) * currentAudio.duration))}
                    </AppText>
                    <AppText variant="caption" className="font-sans text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
                      {formatTime(currentAudio.duration)}
                    </AppText>
                  </View>
                </View>
              )}
            </>
          )}

          {/* Priority-ordered, drag-to-reorder list. The top row is this
              chapter's default (see resolveChapterAudio); tapping a row
              just switches what plays now. scrollEnabled is off since this
              always nests inside the page's own ScrollView -- lists here
              are short (a handful of recordings per chapter at most). */}
          {(currentAudio || libraryTimings) && showAudioSelector && (
            <View className="border-t border-hairline" style={{ paddingTop: space(12), gap: space(10) }}>
              {libraryTimings && (
                <Pressable
                  onPress={() => {
                    setLibraryPickedFor(activeChapterKey);
                    setShowAudioSelector(false);
                    setPlayingRecordingId(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: libraryActive }}
                  className={`w-full rounded-btn border flex-row items-center ${
                    libraryActive ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
                  }`}
                  style={{ padding: space(10), gap: space(8) }}
                >
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <AppText variant="label" className="font-sans font-semibold text-ink" numberOfLines={1}>
                      Hebrew reading · {LIBRARY_READER.name}
                    </AppText>
                    <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
                      Built in · Hebrew
                    </AppText>
                  </View>
                  {libraryActive && <Check size={Math.round(16 * scale)} color={palette.accent} strokeWidth={2.4} />}
                </Pressable>
              )}
              {optionsList.length > 1 && (
                <AppText variant="caption" className="font-sans text-ink-3">
                  Press and hold the handle to reorder. The top one plays by default.
                </AppText>
              )}
              <DraggableFlatList
                data={optionsList}
                scrollEnabled={false}
                keyExtractor={(opt) => opt.id}
                contentContainerStyle={{ gap: space(6) }}
                onDragEnd={({ data }) => reorderChapterRecordings(data.map((r) => r.id))}
                renderItem={({ item: opt, drag, isActive }: RenderItemParams<Recording>) => {
                  const isSelected = !libraryActive && currentAudio?.id === opt.id;
                  return (
                    <Pressable
                      onPress={() => {
                        setLibraryPickedFor(null);
                        setSelectedChapterAudios((prev) => ({
                          ...prev,
                          [activeChapterKey]: opt as Recording,
                        }));
                        setShowAudioSelector(false);
                        setPlayingRecordingId(null);
                        triggerToast(`Now playing ${opt.user}'s recording`);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      className={`w-full rounded-btn border flex-row items-center ${
                        isSelected || isActive ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
                      }`}
                      style={{ padding: space(10), gap: space(8) }}
                    >
                      <Pressable onLongPress={drag} hitSlop={10} accessibilityLabel="Hold to reorder">
                        <GripVertical size={Math.round(16 * scale)} color={palette.ink3} />
                      </Pressable>
                      <View className="flex-1" style={{ minWidth: 0 }}>
                        <AppText variant="label" className="font-sans font-semibold text-ink" numberOfLines={1}>
                          {opt.title}
                        </AppText>
                        <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
                          {opt.user} · {translationLabel(opt.translation)}
                        </AppText>
                      </View>
                      {isSelected && <Check size={Math.round(16 * scale)} color={palette.accent} strokeWidth={2.4} />}
                    </Pressable>
                  );
                }}
              />

              <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
                {downloadableNarrations.length > 0 && (
                  <AppButton
                    size="sm"
                    variant="secondary"
                    Icon={notYetDownloaded.length === 0 ? Check : Download}
                    label={
                      chapterDownloadBusy
                        ? 'Downloading…'
                        : notYetDownloaded.length === 0
                          ? 'Saved offline'
                          : `Save ${notYetDownloaded.length} offline`
                    }
                    disabled={chapterDownloadBusy || notYetDownloaded.length === 0}
                    onPress={() => saveChapterOffline(downloadableNarrations)}
                  />
                )}
                <AppButton
                  size="sm"
                  variant="quiet"
                  Icon={Search}
                  label="Find more recordings"
                  onPress={() => {
                    setShowAudioSelector(false);
                    openRecordingsFeed();
                  }}
                />
              </View>
            </View>
          )}
        </View>

        {/* The chapter's tools in one row: First words (the verses picked, or
            the whole chapter when none are), Sections, Takeaways. */}
        {activeChapterVerses.length > 0 && !editing && (
          <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
            <AppButton
              size="sm"
              variant="secondary"
              Icon={ListTree}
              label={formatLabel('firstWords')}
              accessibilityLabel={`${formatLabel('firstWords')}: ${selectedVerseNumbers.length > 0 ? 'the verses you picked' : 'the whole chapter'}`}
              onPress={() =>
                startPractice('learn', selectedVerseNumbers.length > 0 ? selectedVerses() : activeChapterVerses, { learnTab: 'outline' })
              }
            />
            <AppButton
              size="sm"
              variant="secondary"
              Icon={Brackets}
              label="Sections"
              accessibilityLabel={savedDraft ? 'Edit sections' : 'Add sections'}
              onPress={startEditingSections}
            />
            <AppButton size="sm" variant="secondary" Icon={Bookmark} label="Takeaways" onPress={() => navigateTo('takeaways')} />
          </View>
        )}

        {/* The memory phrase, only once the user has written one. */}
        {phrase && !editing && (
          <AppText variant="label" className="font-sans text-ink-2" accessibilityLabel={`Memory phrase: ${phrase}`}>
            {phrase}
          </AppText>
        )}

        {editing && (
          <SectionsEditIntro
            canStartOver={!!editDraft && !isBlankDraft(editDraft)}
            // Start over clears the sections, not the phrase choice or verse words.
            onStartOver={() =>
              setEditDraft((prev) => ({ ...emptyDraft(firstVerse), memoryAid: prev?.memoryAid, verseWords: prev?.verseWords }))
            }
            memoryAid={memoryAid}
            onMemoryAid={(aid) => setEditDraft((prev) => prev && { ...prev, memoryAid: aid })}
          />
        )}

        {activeChapterVerses.length > 0 && !editing && (
          <SectionHeader
            title={selectedVerseNumbers.length > 0 ? `${selectedVerseNumbers.length} selected` : 'Tap a verse to select it'}
            actionLabel={selectedVerseNumbers.length === activeChapterVerses.length ? 'Deselect all' : 'Select all'}
            onAction={toggleSelectAll}
          />
        )}

        {/* Dynamic verses area */}
        <View>
          {activeChapterTextLoading && activeChapterVerses.length === 0 ? (
            <View className="py-10 items-center">
              <AppText variant="label" className="font-sans text-ink-3">Loading {selectedBook} {selectedChapter}…</AppText>
            </View>
          ) : activeChapterTextError ? (
            <View className="py-10 items-center gap-1">
              <AppText variant="label" className="font-sans font-bold text-danger">Couldn't load this chapter.</AppText>
              <AppText variant="caption" className="font-sans text-ink-3">{activeChapterTextError}</AppText>
            </View>
          ) : activeChapterVerses.length === 0 ? (
            <View className="py-10 items-center">
              <AppText variant="label" className="font-sans text-ink-3">No text available for {selectedBook} {selectedChapter} yet.</AppText>
            </View>
          ) : chapterViewMode === 'list' || editing ? (
            /* LIST VIEW -- one continuous card, a row per verse: the number
               and its status dot in a narrow column, the text beside them.
               With sections, each section opens with a header row and a
               colored bracket runs down the gutter beside its verses. While
               editing sections there's no drag-select: taps split instead. */
            withDragSelect(
            <View className="bg-surface border border-line rounded-card overflow-hidden" collapsable={false}>
              {activeChapterVerses.map((v, index) => {
                const isSelected = !editing && isVerseSelected(v.verse);
                const due = dueLabel(v.dueDate);
                const next = activeChapterVerses[index + 1];
                // Header rows follow the sections as they are; the bars follow
                // a handle mid-drag (barDraft), so the change shows before it lands.
                const sIdx = shownDraft && hasSections ? sectionIndexOf(shownDraft.starts, v.verse) : -1;
                const verseWord = memoryAid === 'verses' ? shownDraft?.verseWords?.[v.verse]?.trim() : undefined;
                const verseLetter = displayLetter(verseLetters[index] ?? '', chapterScript);
                const section = sIdx >= 0 ? sections[sIdx] : null;
                const opensSection =
                  !!section && (index === 0 || sectionIndexOf(shownDraft!.starts, activeChapterVerses[index - 1].verse) !== sIdx);
                const bIdx = barDraft ? sectionIndexOf(barDraft.starts, v.verse) : -1;
                const closesBar = !!barDraft && (!next || sectionIndexOf(barDraft.starts, next.verse) !== bIdx);
                const dropHere = !!drag && drag.to === v.verse && drag.to !== shownDraft?.starts[drag.index];

                return (
                  <Fragment key={v.verse}>
                    {opensSection && section ? (
                      <SectionHeaderRow
                        section={section}
                        letter={letters[sIdx] ?? ''}
                        script={chapterScript}
                        rtl={rtl}
                        editing={editing}
                        gutter={gutterWidth}
                        first={index === 0}
                        labelText={editDraft?.labels[section.start]}
                        wordText={editDraft?.phraseWords[section.start]}
                        onLabel={(t) => setEditDraft((prev) => prev && setSectionText(prev, 'labels', section.start, t))}
                        onPhraseWord={(t) => setEditDraft((prev) => prev && setSectionText(prev, 'phraseWords', section.start, t))}
                        handle={editing ? handleFor(sIdx) : undefined}
                        showWord={memoryAid === 'sections'}
                      />
                    ) : null}
                    {/* The row measures itself for drag-select; the verse is
                        the tappable part, and a per-verse word field sits
                        beside it rather than inside it, so tapping the field
                        never splits a section. */}
                    <View className={rtl ? 'flex-row-reverse' : 'flex-row'} onLayout={dragSelect.itemLayout(index)}>
                    <Pressable
                      ref={(el) => {
                        rowRefs.current[index] = el;
                      }}
                      onPress={() => (editing ? tapVerseWhileEditing(v.verse) : dragSelect.handleTap(v.verse))}
                      accessibilityRole="button"
                      accessibilityState={editing ? undefined : { selected: isSelected }}
                      accessibilityLabel={`Verse ${v.verse}, ${STATUS_WORD[v.status] ?? 'not started'}${v.slipped ? ', slipped last time' : ''}`}
                      accessibilityHint={editing ? 'Starts a new section at this verse.' : undefined}
                      className={`flex-1 ${rtl ? 'flex-row-reverse' : 'flex-row'} ${isSelected ? 'bg-accent-soft' : ''}`}
                    >
                      <BracketGutter index={bIdx} width={gutterWidth} bottom={closesBar} rtl={rtl} />
                      <View
                        className={`flex-1 ${rtl ? 'flex-row-reverse' : 'flex-row'} ${index > 0 && !opensSection ? 'border-t border-hairline' : ''}`}
                        style={{
                          paddingVertical: space(12),
                          paddingHorizontal: space(14),
                          // The bracket gutter already spaces the text from the edge.
                          ...(gutterWidth > 0 ? (rtl ? { paddingRight: space(4) } : { paddingLeft: space(4) }) : null),
                          gap: space(10),
                        }}
                      >
                        <View className="items-center" style={{ minWidth: space(22), gap: space(6), paddingTop: space(2) }}>
                          <AppText
                            variant="caption"
                            className={`font-sans font-semibold ${isSelected ? 'text-accent' : 'text-ink-3'}`}
                            style={{ fontVariant: ['tabular-nums'] }}
                          >
                            {v.verse}
                          </AppText>
                          <View className={`w-2 h-2 rounded-full ${STATUS_DOT[v.status] ?? 'bg-fill'}`} />
                          {v.slipped && <WeakSpotDot size={8} />}
                        </View>
                        <View className="flex-1" style={{ gap: space(4) }}>
                          {verseWord && !editing ? (
                            <AppText variant="caption" className="font-sans font-semibold text-accent" accessibilityLabel={`Phrase word: ${verseWord}`}>
                              {verseWord}
                            </AppText>
                          ) : null}
                          <AppText variant="label" script={chapterScript} className="font-serif leading-relaxed text-ink">
                            {v.text}
                          </AppText>
                          {due ? (
                            <AppText variant="caption" className="font-sans text-ink-3">
                              {due}
                            </AppText>
                          ) : null}
                        </View>
                      </View>
                      {dropHere ? <DropLine /> : null}
                    </Pressable>
                    {/* Per verse: the verse's phrase word, hinted with its first letter. */}
                    {editing && memoryAid === 'verses' ? (
                      <View
                        className={index > 0 && !opensSection ? 'border-t border-hairline' : ''}
                        style={{ paddingVertical: space(12), ...(rtl ? { paddingLeft: space(14) } : { paddingRight: space(14) }) }}
                      >
                        <AppTextInput
                          value={editDraft?.verseWords?.[v.verse] ?? ''}
                          onChangeText={(t) => setEditDraft((prev) => prev && setVerseWord(prev, v.verse, t))}
                          placeholder={verseLetter ? `${verseLetter}…` : 'Word'}
                          accessibilityLabel={`Memory phrase word for verse ${v.verse}${verseLetter ? `, starts with ${verseLetter}` : ''}`}
                          variant="caption"
                          autoCapitalize="none"
                          autoCorrect={false}
                          maxLength={30}
                          className="bg-surface border border-line rounded-btn text-ink font-sans"
                          style={{ width: space(84), paddingHorizontal: space(8), paddingVertical: space(6) }}
                        />
                      </View>
                    ) : null}
                    </View>
                  </Fragment>
                );
              })}
            </View>
            )
          ) : chapterViewMode === 'grid' ? (
            /* GRID VIEW -- the first few words of each verse. Tiles are sized
               to fill each row: three across normally, two at large text. */
            <GestureDetector gesture={dragSelect.gesture}>
            <View
              className={`${rtl ? 'flex-row-reverse' : 'flex-row'} flex-wrap`}
              style={{ gap: tileGap }}
              collapsable={false}
              onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
            >
              {activeChapterVerses.map((v, index) => {
                const isSelected = isVerseSelected(v.verse);
                const textSnippet = v.text ? joinWords(splitWords(v.text, chapterScript).slice(0, 4)) + '…' : '';

                return (
                  <Pressable
                    key={v.verse}
                    onLayout={dragSelect.itemLayout(index)}
                    onPress={() => dragSelect.handleTap(v.verse)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`Verse ${v.verse}, ${STATUS_WORD[v.status] ?? 'not started'}${v.slipped ? ', slipped last time' : ''}`}
                    style={{ width: tileWidth, minHeight: space(64), padding: space(10), gap: space(4) }}
                    className={`rounded-btn border ${isSelected ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
                  >
                    <View className="flex-row items-center justify-between" style={{ gap: space(6) }}>
                      <AppText
                        variant="caption"
                        className={`font-sans font-semibold ${isSelected ? 'text-accent' : 'text-ink'}`}
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
                        {v.verse}
                      </AppText>
                      <View className="flex-row items-center" style={{ gap: space(4) }}>
                        {v.slipped && <WeakSpotDot size={8} />}
                        <View className={`w-2 h-2 rounded-full ${STATUS_DOT[v.status] ?? 'bg-fill'}`} />
                      </View>
                    </View>
                    <AppText variant="caption" script={chapterScript} className="font-serif text-ink-2" numberOfLines={2}>
                      {textSnippet}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            </GestureDetector>
          ) : (
            /* MEMORY GRID VIEW - Scripture Memory Fellowship style: every
               word's first letter, tap to select (same as List/Grid), pin
               icon to mark a personal memory anchor. */
            <View style={{ gap: space(12) }}>
              <View className="flex-row flex-wrap items-center justify-between" style={{ gap: space(8) }}>
                <View style={{ flexGrow: 1, flexBasis: space(170) }}>
                  <SegmentedControl
                    value={memoryGridColumns}
                    onChange={setMemoryGridColumns}
                    accessibilityLabel="Columns"
                    options={[
                      { id: 2, label: '2 columns' },
                      { id: 4, label: '4 columns' },
                    ]}
                  />
                </View>
                <AppButton
                  size="sm"
                  variant="secondary"
                  Icon={Printer}
                  label="Print"
                  accessibilityLabel="Print as a PDF"
                  onPress={() =>
                    printMemoryGrid(
                      activeChapterVerses.map((v) => ({ book: selectedBook || '', chapter: selectedChapter || 0, verse: v.verse, text: v.text })),
                      `${selectedBook} ${selectedChapter}`,
                      activeTranslation.id
                    )
                  }
                />
              </View>
              <GestureDetector gesture={dragSelect.gesture}>
              <View collapsable={false}>
              <MemoryGrid
                verses={activeChapterVerses.map((v) => ({
                  book: selectedBook || '',
                  chapter: selectedChapter || 0,
                  verse: v.verse,
                  text: v.text,
                  translationId: activeTranslation.id,
                }))}
                columns={memoryGridColumns}
                highlightedKeys={highlightedVerses}
                onToggleHighlight={toggleVerseHighlight}
                doodles={verseDoodles}
                onSaveDoodle={(key, _v, strokes) => saveVerseDoodle(key, strokes)}
                selectedKeys={
                  new Set(
                    activeChapterVerses
                      .filter((v) => isVerseSelected(v.verse))
                      .map((v) => verseAnnotationKey(selectedBook || '', selectedChapter || 0, v.verse))
                  )
                }
                onTapVerse={(v) => dragSelect.handleTap(v.verse)}
                onBoxLayout={(index, e) => dragSelect.itemLayout(index)(e)}
              />
              </View>
              </GestureDetector>
            </View>
          )}
        </View>

        {/* Copyright/attribution notice -- only shown for translations that
            require one (public-domain translations like BSB/KJV/WEB have none).

            The publisher link is not decoration: Lockman's licence requires "a
            clickable link to LOCKMAN's web site home page... placed in a
            conspicuous place", so for the NASB a plain-text notice would not
            satisfy the terms. Rendered as a real Pressable rather than styled
            text so it is actually tappable. */}
        {activeChapterVerses.length > 0 && activeCopyright && (
          <View className="px-2 gap-0.5">
            <AppText variant="micro" className="font-sans text-ink-3 leading-tight text-center">
              {activeCopyright}
            </AppText>
            {activeTranslation.copyrightUrl && (
              <Pressable
                onPress={() => Linking.openURL(activeTranslation.copyrightUrl!)}
                accessibilityRole="link"
                hitSlop={8}
              >
                <AppText variant="micro" className="font-sans text-ink-3 underline leading-tight text-center">
                  {activeTranslation.copyrightUrl.replace(/^https?:\/\//, '')}
                </AppText>
              </Pressable>
            )}
          </View>
        )}

      </ScrollView>

      {/* Floating action bar -- hovers above the verse content near the
          bottom of the viewport (not the end of the scrollable page), so
          it's reachable the instant verses are selected without scrolling
          all the way down. Rendered as an absolutely-positioned sibling of
          the ScrollView rather than inside its content flow; the matching
          extra paddingBottom on the ScrollView above keeps the last verses
          and the copyright notice from ever being hidden underneath it.
          The shadow is on a view that mounts and unmounts whole, never
          toggled by a class (see ios-fabric-shadow-deadlock). */}
      {floatingBarShowing && !editing && (
        <View
          className="absolute left-4 right-4 bg-surface border border-line rounded-card shadow-lg"
          style={{ bottom: 16, padding: space(12), gap: space(10) }}
          onLayout={(e) => setFloatingBarHeight(e.nativeEvent.layout.height)}
        >
          <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
            <AppText variant="label" className="font-sans font-semibold text-ink shrink">
              {selectedVerseNumbers.length} {selectedVerseNumbers.length === 1 ? 'verse' : 'verses'} selected
            </AppText>
            <AppButton size="sm" variant="quiet" label="Clear" onPress={() => setSelectedVerseNumbers([])} />
          </View>
          {/* Four across normally; two by two at large text, where four
              would each be too narrow for their one word. */}
          <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
            {[
              {
                label: 'Add',
                a11y: 'Add to My Verses',
                variant: 'primary' as const,
                onPress: () => {
                  addVersesToQueue(selectedVerses(), selectedTranslationId);
                  setSelectedVerseNumbers([]);
                },
              },
              { label: 'Listen', a11y: 'Listen', variant: 'secondary' as const, onPress: () => startPractice('listen', selectedVerses()) },
              { label: 'Learn', a11y: 'Learn', variant: 'secondary' as const, onPress: () => startPractice('learn', selectedVerses()) },
              { label: 'Status', a11y: 'Set memory status', variant: 'secondary' as const, onPress: () => setShowStatusOverride(true) },
            ].map((b) => (
              <View key={b.label} style={{ flexGrow: 1, flexBasis: space(64) }}>
                <AppButton size="sm" variant={b.variant} label={b.label} accessibilityLabel={b.a11y} onPress={b.onPress} />
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Edit sections' own bar: how many sections, Cancel, Done. Same
          mount-whole rule for its shadow as the selection bar above. */}
      {editing && (
        <View
          className="absolute left-4 right-4 bg-surface border border-line rounded-card shadow-lg"
          style={{ bottom: 16, padding: space(12) }}
          onLayout={(e) => setFloatingBarHeight(e.nativeEvent.layout.height)}
        >
          <View className="flex-row flex-wrap items-center justify-between" style={{ gap: space(8) }}>
            <AppText variant="label" className="font-sans font-semibold text-ink shrink">
              {sections.length} {sections.length === 1 ? 'section' : 'sections'}
            </AppText>
            <View className="flex-row" style={{ gap: space(8) }}>
              <AppButton size="sm" variant="quiet" label="Cancel" onPress={cancelEditingSections} />
              <AppButton size="sm" variant="primary" label="Done" onPress={finishEditingSections} />
            </View>
          </View>
        </View>
      )}

      {/* Manual memory-status override -- for verses already memorized
          outside the app. Sets the selected verses directly to a chosen
          stage, skipping the normal learn-then-review climb. */}
      <Dialog
        visible={showStatusOverride && floatingBarShowing}
        onClose={() => setShowStatusOverride(false)}
        placement="sheet"
        title={oneVerse ? 'Already know this one?' : 'Already know these?'}
        message={`Tell the app where ${oneVerse ? 'this verse is' : 'these verses are'}, and it will review ${them} on that schedule instead of teaching ${them} from scratch.`}
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setShowStatusOverride(false)} />
            <AppButton
              variant="primary"
              label="Save"
              onPress={() => {
                overrideVerseMemoryStatus(
                  selectedVerses(),
                  overridePhase,
                  selectedTranslationId,
                  overrideWeekday ?? undefined,
                  overrideProgressCount
                );
                setSelectedVerseNumbers([]);
                setShowStatusOverride(false);
              }}
            />
          </>
        }
      >
        <View style={{ gap: space(8) }}>
          <AppText variant="label" className="font-sans font-medium text-ink">
            Put {them} in
          </AppText>
          <ChipRow
            wrap
            value={overridePhase}
            onChange={(id) => {
              setOverridePhase(id);
              if (id !== 'weekly' && id !== 'monthly') setOverrideWeekday(null);
              setOverrideProgressPercent(0);
            }}
            options={OVERRIDE_PHASE_OPTIONS}
          />
        </View>

        {(overridePhase === 'weekly' || overridePhase === 'monthly') && (
          <View style={{ gap: space(8) }}>
            <AppText variant="label" className="font-sans font-medium text-ink">
              Review {them} on
            </AppText>
            <ChipRow
              wrap
              value={overrideWeekday ?? ''}
              onChange={(id) => setOverrideWeekday((prev) => (prev === id ? null : (id as string)))}
              options={OVERRIDE_WEEKDAY_OPTIONS}
            />
            <AppText variant="caption" className="font-sans text-ink-3">
              Optional. Tap the day again to clear it.
            </AppText>
          </View>
        )}

        {(overridePhase === 'daily' || overridePhase === 'weekly' || overridePhase === 'monthly') && (
          <View style={{ gap: space(8) }}>
            <View className="flex-row flex-wrap items-baseline justify-between" style={{ columnGap: space(8) }}>
              <AppText variant="label" className="font-sans font-medium text-ink">
                How far along
              </AppText>
              <AppText variant="label" className="font-sans text-ink-2">
                {overrideProgressPercent >= 100
                  ? 'Moves on after the next review'
                  : `${overrideProgressUnit} (${overrideProgressCount} of ${overrideProgressMax})`}
              </AppText>
            </View>
            <DiscreteSlider
              value={overrideProgressPercent}
              onChange={setOverrideProgressPercent}
              options={Array.from({ length: 21 }, (_, i) => i * 5).map((p) => ({ id: p, label: `${p}%` }))}
              showStopLabels={false}
              accessibilityLabel="How far along"
            />
            <RangeCaption min="Just started" max="Ready to move on" />
          </View>
        )}
      </Dialog>
    </FadeInView>
  );
}
