import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { GestureDetector } from 'react-native-gesture-handler';
import { Check, Download, GripVertical, Pause, Play, Printer, Search } from 'lucide-react-native';

import { AppState, resolveChapterAudio } from '../state/useAppState';
import { cacheableTarget } from '../lib/audioCache';
import { ChipRow, DiscreteSlider, FadeInView } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import ChapterPhotoStrip from '../components/ChapterPhotoStrip';
import MemoryGrid, { verseAnnotationKey } from '../components/MemoryGrid';
import { printMemoryGrid } from '../lib/printMemoryGrid';
import { Recording } from '../types';
import { BIBLE_TRANSLATIONS, PICKER_TRANSLATIONS, copyrightFor, translationLabel } from '../data';
import { AppButton, AppIconButton, AppText, RangeCaption, useFontScale, useScaledSpace } from '../components/design';
import { Dialog, ScreenHeader, SectionHeader, SegmentedControl } from '../components/blocks';
import { useDragSelect } from '../components/useDragSelect';

import { useThemeColors } from '../components/theme';
const OVERRIDE_PHASE_OPTIONS: { id: 'learning' | 'daily' | 'weekly' | 'monthly' | 'retained'; label: string }[] = [
  { id: 'learning', label: 'Learning' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'retained', label: 'Retained' },
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
    (r) => r.book.toLowerCase() === (selectedBook || '').toLowerCase() && r.chapter === selectedChapter
  );
  // Priority-ordered top to bottom -- the top item is this chapter's default
  // playback source (see resolveChapterAudio); dragging in the panel below
  // reorders this list and persists the new priority.
  const optionsList = [...availableNarrations].sort(
    (a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)
  );
  const currentAudio = resolveChapterAudio(userRecordings, selectedChapterAudios, selectedBook || '', selectedChapter || 0);
  const isPlayingThis = !!currentAudio && playingRecordingId === currentAudio.id;

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
  const selectedVerses = () => activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse));
  const oneVerse = selectedVerseNumbers.length === 1;
  const them = oneVerse ? 'it' : 'them';

  // Grid tiles fill each row exactly: as many columns as fit at the smallest
  // comfortable tile (which grows with text size), sharing the leftover room.
  const [gridWidth, setGridWidth] = useState(0);
  const tileGap = space(8);
  const minTile = space(96);
  const gridColumns = Math.max(1, Math.floor((gridWidth + tileGap) / (minTile + tileGap)));
  const tileWidth = gridWidth > 0 ? Math.floor((gridWidth - tileGap * (gridColumns - 1)) / gridColumns) : minTile;

  const changeButton = (
    <AppButton
      size="sm"
      variant="quiet"
      label={showAudioSelector ? 'Done' : 'Change'}
      onPress={() => setShowAudioSelector(!showAudioSelector)}
    />
  );

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
        className="flex-1 bg-canvas"
        contentContainerClassName="p-5"
        // Extra bottom padding whenever the floating selection bar is
        // showing, so the last verses and the copyright notice can
        // still fully scroll into view above it rather than being hidden
        // underneath -- the bar itself no longer takes up real space in
        // the scroll flow (see below), so nothing pushes content up for it
        // automatically.
        contentContainerStyle={{ gap: space(16), paddingBottom: floatingBarShowing ? floatingBarHeight + 32 : 16 }}
      >
        {/* Back can lead to Today, the chapter grid or My Memory Work, so it
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
            <Dropdown
              value={selectedTranslationId}
              onChange={setSelectedTranslationId}
              options={PICKER_TRANSLATIONS.map((t) => ({ id: t.id, label: translationLabel(t.id) }))}
              title="Translation"
              searchable={false}
              compact
            />
          }
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

        {/* This chapter's recording: play it here, or change which one plays. */}
        <View className="bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(12) }}>
          {/* Empty state is one line then the action. The second sentence used
              to say "or find one in the community library" directly above a
              button that does exactly that. */}
          {!currentAudio ? (
            <View className="items-center" style={{ gap: space(8), paddingVertical: space(4) }}>
              <AppText variant="label" className="font-sans text-ink-2 text-center">
                No recordings for this chapter yet
              </AppText>
              <AppButton size="sm" variant="secondary" Icon={Search} label="Find recordings" onPress={openRecordingsFeed} />
            </View>
          ) : (
            <>
              <View className="flex-row items-center" style={{ gap: space(12) }}>
                <AppIconButton
                  variant="filled"
                  Icon={isPlayingThis ? Pause : Play}
                  diameter={40}
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
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <AppText variant="label" className="font-sans font-semibold text-ink" numberOfLines={scale >= 1.3 ? 2 : 1}>
                    {currentAudio.title}
                  </AppText>
                  <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
                    {currentAudio.user} · {translationLabel(currentAudio.translation)}
                  </AppText>
                  {/* Past 1.3x the button would squeeze the title to a few
                      letters, so it moves under the title instead. */}
                  {scale >= 1.3 ? <View className="flex-row" style={{ paddingTop: space(6) }}>{changeButton}</View> : null}
                </View>
                {scale >= 1.3 ? null : changeButton}
              </View>

              {/* Real playback progress bar */}
              {isPlayingThis && (
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

              {/* Priority-ordered, drag-to-reorder list. The top row is this
                  chapter's default (see resolveChapterAudio); tapping a row
                  just switches what plays now. scrollEnabled is off since this
                  always nests inside the page's own ScrollView -- lists here
                  are short (a handful of recordings per chapter at most). */}
              {showAudioSelector && (
                <View className="border-t border-hairline" style={{ paddingTop: space(12), gap: space(10) }}>
                  <AppText variant="caption" className="font-sans text-ink-3">
                    Press and hold the handle to reorder. The top one plays by default.
                  </AppText>
                  <DraggableFlatList
                    data={optionsList}
                    scrollEnabled={false}
                    keyExtractor={(opt) => opt.id}
                    contentContainerStyle={{ gap: space(6) }}
                    onDragEnd={({ data }) => reorderChapterRecordings(data.map((r) => r.id))}
                    renderItem={({ item: opt, drag, isActive }: RenderItemParams<Recording>) => {
                      const isSelected = currentAudio.id === opt.id;
                      return (
                        <Pressable
                          onPress={() => {
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
            </>
          )}
        </View>

        {/* Photos of the user's own Bible pages for this chapter. Renders a
            single muted line when there are none -- see ChapterPhotoStrip. */}
        <ChapterPhotoStrip state={state} book={selectedBook || ''} chapter={selectedChapter ?? 0} />

        {/* How the verses are laid out, then the verses. Select all lives
            here, beside the thing it selects. */}
        <SegmentedControl
          value={chapterViewMode}
          onChange={setChapterViewMode}
          accessibilityLabel="Verse layout"
          options={[
            { id: 'list', label: 'List' },
            { id: 'grid', label: 'Grid' },
            { id: 'memoryGrid', label: 'Memory grid' },
          ]}
        />

        {activeChapterVerses.length > 0 && (
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
          ) : chapterViewMode === 'list' ? (
            /* LIST VIEW -- one continuous card, a row per verse: the number
               and its status dot in a narrow column, the text beside them. */
            <GestureDetector gesture={dragSelect.gesture}>
            <View className="bg-surface border border-line rounded-card overflow-hidden" collapsable={false}>
              {activeChapterVerses.map((v, index) => {
                const isSelected = isVerseSelected(v.verse);
                const due = dueLabel(v.dueDate);

                return (
                  <Pressable
                    key={v.verse}
                    onLayout={dragSelect.itemLayout(index)}
                    onPress={() => dragSelect.handleTap(v.verse)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`Verse ${v.verse}, ${STATUS_WORD[v.status] ?? 'not started'}`}
                    className={`flex-row ${index > 0 ? 'border-t border-hairline' : ''} ${isSelected ? 'bg-accent-soft' : ''}`}
                    style={{ paddingVertical: space(12), paddingHorizontal: space(14), gap: space(10) }}
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
                    </View>
                    <View className="flex-1" style={{ gap: space(4) }}>
                      <AppText variant="body" className="font-serif leading-relaxed text-ink">
                        {v.text}
                      </AppText>
                      {due ? (
                        <AppText variant="caption" className="font-sans text-ink-3">
                          {due}
                        </AppText>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            </GestureDetector>
          ) : chapterViewMode === 'grid' ? (
            /* GRID VIEW -- the first few words of each verse. Tiles are sized
               to fill each row: three across normally, two at large text. */
            <GestureDetector gesture={dragSelect.gesture}>
            <View
              className="flex-row flex-wrap"
              style={{ gap: tileGap }}
              collapsable={false}
              onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
            >
              {activeChapterVerses.map((v, index) => {
                const isSelected = isVerseSelected(v.verse);
                const textSnippet = v.text ? v.text.split(/\s+/).slice(0, 4).join(' ') + '…' : '';

                return (
                  <Pressable
                    key={v.verse}
                    onLayout={dragSelect.itemLayout(index)}
                    onPress={() => dragSelect.handleTap(v.verse)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`Verse ${v.verse}, ${STATUS_WORD[v.status] ?? 'not started'}`}
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
                      <View className={`w-2 h-2 rounded-full ${STATUS_DOT[v.status] ?? 'bg-fill'}`} />
                    </View>
                    <AppText variant="caption" className="font-serif text-ink-2" numberOfLines={2}>
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
      {floatingBarShowing && (
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
