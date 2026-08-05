import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { ArrowLeft, Check, ChevronDown, Download, GripVertical, Pause, Play, Printer, Search, SlidersHorizontal, X } from 'lucide-react-native';

import { AppState, resolveChapterAudio } from '../state/useAppState';
import { cacheableTarget } from '../lib/audioCache';
import { ChipRow, DiscreteSlider, FadeInView } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import MemoryGrid, { verseAnnotationKey } from '../components/MemoryGrid';
import { printMemoryGrid } from '../lib/printMemoryGrid';
import { Recording } from '../types';
import { BIBLE_TRANSLATIONS } from '../data';
import { AppText } from '../components/design';

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

export default function ChapterLandingScreen({ state }: { state: AppState }) {
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
  const activeTranslation = BIBLE_TRANSLATIONS.find((t) => t.id === selectedTranslationId) ?? BIBLE_TRANSLATIONS[0];

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName="p-5"
        // Extra bottom padding whenever the floating selection bar is
        // showing, so the last verses and the ESV copyright notice can
        // still fully scroll into view above it rather than being hidden
        // underneath -- the bar itself no longer takes up real space in
        // the scroll flow (see below), so nothing pushes content up for it
        // automatically.
        contentContainerStyle={{ gap: 16, paddingBottom: floatingBarShowing ? 168 : 20 }}
      >
        {/* Title Header with back */}
        <View className="flex-row items-center justify-between border-b border-[#E5E5E5] pb-2">
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={handleBack}
              className="w-7 h-7 rounded-full border border-[#E5E5E5] items-center justify-center bg-white"
            >
              <ArrowLeft size={14} color="#1A1A1A" />
            </Pressable>
            <AppText variant="title" className="font-serif font-extrabold text-[#1A1A1A]">
              {selectedBook} {selectedChapter}
            </AppText>
          </View>

          <View className="flex-row items-center gap-2">
            {/* Translation picker -- determines which translation's text
                loads for this chapter, and which translation gets set on
                any verses added to the queue from here. Progress on the
                same verse in two different translations is tracked
                independently (see buildVerseId in useAppState.ts). */}
            <View style={{ width: 84 }}>
              <Dropdown
                value={selectedTranslationId}
                onChange={setSelectedTranslationId}
                options={BIBLE_TRANSLATIONS.map((t) => ({ id: t.id, label: t.id }))}
                title="Translation"
                searchable={false}
              />
            </View>
            {/* Simple Select/Deselect All Verse trigger */}
            <Pressable
              onPress={toggleSelectAll}
              className="border border-[#1A1A1A] px-2 py-0.5 rounded"
            >
              <AppText variant="caption" className="font-bold font-sans uppercase text-[#1A1A1A]">
                {selectedVerseNumbers.length === activeChapterVerses.length ? 'Deselect All' : 'Select All'}
              </AppText>
            </Pressable>
          </View>
        </View>

        {/* Segmented Progress Bar */}
        <View className="gap-1.5">
          <View className="flex-row justify-between items-center">
            <AppText variant="micro" className="font-sans font-bold text-[#888]">CHAPTER PROGRESS</AppText>
            <View className="flex-row gap-2">
              <View className="flex-row items-center gap-1">
                <View className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                <AppText variant="micro" className="font-sans font-bold text-[#888]">Memorized</AppText>
              </View>
              <View className="flex-row items-center gap-1">
                <View className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                <AppText variant="micro" className="font-sans font-bold text-[#888]">Learning</AppText>
              </View>
              <View className="flex-row items-center gap-1">
                <View className="w-1.5 h-1.5 bg-neutral-200 rounded-full" />
                <AppText variant="micro" className="font-sans font-bold text-[#888]">Untouched</AppText>
              </View>
            </View>
          </View>
          {/* Horizontal split colored indicator based on verses */}
          <View className="flex-row h-3 w-full border border-[#1A1A1A] rounded-full overflow-hidden bg-[#F3F2F1]">
            {activeChapterVerses.map((v) => {
              const statusColor =
                v.status === 'memorized' ? 'bg-emerald-500' : v.status === 'learning' ? 'bg-amber-400' : 'bg-neutral-200';
              return (
                <View
                  key={v.verse}
                  className={`${statusColor} flex-1 border-r border-white/50`}
                />
              );
            })}
          </View>
        </View>

        {/* Playable Custom Audio Card */}
        <View className="border border-[#1A1A1A] rounded-xl p-3 bg-white gap-2.5">
          {!currentAudio ? (
            <View className="items-center py-2 gap-1.5">
              <AppText variant="label" className="font-sans font-bold text-neutral-500">No recordings yet for this chapter</AppText>
              <AppText variant="caption" className="font-sans text-neutral-400 text-center">
                Record one from the Record tab, or find one in the community library.
              </AppText>
              <Pressable
                onPress={() => {
                  setFeedBookFilter(selectedBook || '');
                  setFeedChapterFilter(String(selectedChapter ?? ''));
                  navigateTo('audioFeed');
                  triggerToast(`Filtered suggested library for ${selectedBook} ${selectedChapter}`);
                }}
                className="mt-1 py-1.5 px-3 bg-[#1A1A1A] rounded-md flex-row items-center justify-center gap-1"
              >
                <Search size={11} color="#FFFFFF" />
                <AppText variant="section" className="text-white font-sans font-bold uppercase tracking-wider">Find Recordings</AppText>
              </Pressable>
            </View>
          ) : (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => {
                    if (isPlayingThis) {
                      setPlayingRecordingId(null);
                    } else {
                      setPlayingRecordingId(currentAudio.id);
                      setPlayingRecProgress(0);
                    }
                  }}
                  className={`w-8 h-8 rounded-full items-center justify-center ${
                    isPlayingThis ? 'bg-[#1A1A1A]' : 'border border-[#1A1A1A]'
                  }`}
                >
                  {isPlayingThis ? (
                    <Pause size={13} color="#FFFFFF" />
                  ) : (
                    <Play size={13} color="#1A1A1A" style={{ marginLeft: 2 }} />
                  )}
                </Pressable>
                <View>
                  <AppText variant="label" className="font-bold font-sans text-[#1A1A1A]" numberOfLines={1} style={{ maxWidth: 170 }}>
                    {currentAudio.title}
                  </AppText>
                  <AppText variant="caption" className="font-sans text-neutral-400">
                    Narrator: {currentAudio.user} • {currentAudio.translation}
                  </AppText>
                </View>
              </View>
              <Pressable
                onPress={() => setShowAudioSelector(!showAudioSelector)}
                className="flex-row items-center gap-0.5"
              >
                <AppText variant="caption" className="font-bold font-sans underline text-neutral-600">Change</AppText>
                <ChevronDown size={11} color="#525252" style={{ transform: [{ rotate: showAudioSelector ? '180deg' : '0deg' }] }} />
              </Pressable>
            </View>

            {/* Real playback progress bar */}
            {isPlayingThis && (
              <View className="gap-0.5">
                <View className="w-full bg-neutral-100 h-1 rounded-full overflow-hidden">
                  <View className="bg-[#1A1A1A] h-full" style={{ width: `${playingRecProgress}%` }} />
                </View>
                <View className="flex-row justify-between">
                  <AppText variant="micro" className="font-mono font-semibold text-neutral-400">
                    {formatTime(Math.round((playingRecProgress / 100) * currentAudio.duration))}
                  </AppText>
                  <AppText variant="micro" className="font-mono font-semibold text-neutral-400">{formatTime(currentAudio.duration)}</AppText>
                </View>
              </View>
            )}

            {/* Dropdown Selector — priority-ordered, drag-to-reorder list.
                The top row is this chapter's default (see resolveChapterAudio);
                tapping a row still just switches the active playback source,
                same as before. scrollEnabled is off since this always nests
                inside the page's own ScrollView -- lists here are short
                (a handful of recordings per chapter at most). */}
            {showAudioSelector && (
              <View className="bg-[#F3F2F1] rounded-lg p-2.5 border border-[#E5E5E5] gap-2">
                <AppText variant="micro" className="font-bold uppercase text-neutral-400 tracking-wider">
                  Recordings — press and hold to reorder. The top one plays by default.
                </AppText>
                <DraggableFlatList
                  data={optionsList}
                  scrollEnabled={false}
                  keyExtractor={(opt) => opt.id}
                  contentContainerStyle={{ gap: 6 }}
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
                          triggerToast(`Audio changed to ${opt.user}'s recitation`);
                        }}
                        className={`w-full p-2 rounded-md border flex-row items-center gap-2 ${
                          isSelected ? 'bg-white border-[#1A1A1A]' : 'bg-white/60 border-[#E5E5E5]/50'
                        } ${isActive ? 'border-indigo-400' : ''}`}
                      >
                        <Pressable onLongPress={drag} hitSlop={8} className="pr-0.5">
                          <GripVertical size={13} color="#a3a3a3" />
                        </Pressable>
                        <View className="flex-1" style={{ maxWidth: 175 }}>
                          <AppText variant="caption" className="font-bold text-[#1A1A1A]" numberOfLines={1}>
                            {opt.title}
                          </AppText>
                          <AppText variant="micro" className="text-neutral-400 font-sans">
                            {opt.user} • {opt.translation}
                          </AppText>
                        </View>
                        {isSelected && <Check size={11} color="#1A1A1A" />}
                      </Pressable>
                    );
                  }}
                />

                <View className="border-t border-[#E5E5E5]/60 pt-2 gap-1.5">
                  {downloadableNarrations.length > 0 && (
                    <Pressable
                      onPress={() => saveChapterOffline(downloadableNarrations)}
                      disabled={chapterDownloadBusy || notYetDownloaded.length === 0}
                      className={`w-full py-1.5 rounded-md flex-row items-center justify-center gap-1 border ${
                        notYetDownloaded.length === 0 ? 'bg-white/60 border-[#E5E5E5]' : 'bg-white border-[#1A1A1A]'
                      } ${chapterDownloadBusy ? 'opacity-50' : ''}`}
                    >
                      {notYetDownloaded.length === 0 ? (
                        <Check size={11} color="#525252" />
                      ) : (
                        <Download size={11} color="#1A1A1A" />
                      )}
                      <AppText variant="section" className={`font-sans font-bold uppercase tracking-wider ${ notYetDownloaded.length === 0 ? 'text-neutral-500' : 'text-[#1A1A1A]' }`} >
                        {chapterDownloadBusy
                          ? 'Downloading…'
                          : notYetDownloaded.length === 0
                            ? 'Saved Offline'
                            : `Save ${notYetDownloaded.length} Offline`}
                      </AppText>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => {
                      setFeedBookFilter(selectedBook || '');
                      setFeedChapterFilter(String(selectedChapter ?? ''));
                      navigateTo('audioFeed');
                      setShowAudioSelector(false);
                      triggerToast(`Filtered suggested library for ${selectedBook} ${selectedChapter}`);
                    }}
                    className="w-full py-1.5 bg-[#1A1A1A] rounded-md flex-row items-center justify-center gap-1"
                  >
                    <Search size={11} color="#FFFFFF" />
                    <AppText variant="section" className="text-white font-sans font-bold uppercase tracking-wider">
                      Find More Recordings
                    </AppText>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
          )}
        </View>

        {/* Grid / List / Memory Grid view Toggle */}
        <View className="bg-[#F3F2F1] p-1.5 border border-[#E5E5E5] rounded-xl gap-1.5">
          <AppText variant="label" className="font-sans font-bold text-neutral-600 pl-1">Verse Layout</AppText>
          <ChipRow
            value={chapterViewMode}
            onChange={setChapterViewMode}
            options={[
              { id: 'list', label: 'List' },
              { id: 'grid', label: 'Grid' },
              { id: 'memoryGrid', label: 'Memory Grid' },
            ]}
          />
        </View>

        {/* Dynamic verses area */}
        <View>
          {activeChapterTextLoading && activeChapterVerses.length === 0 ? (
            <View className="py-10 items-center">
              <AppText variant="label" className="font-sans text-neutral-400">Loading {selectedBook} {selectedChapter}…</AppText>
            </View>
          ) : activeChapterTextError ? (
            <View className="py-10 items-center gap-1">
              <AppText variant="label" className="font-sans font-bold text-red-500">Couldn't load this chapter.</AppText>
              <AppText variant="caption" className="font-sans text-neutral-400">{activeChapterTextError}</AppText>
            </View>
          ) : activeChapterVerses.length === 0 ? (
            <View className="py-10 items-center">
              <AppText variant="label" className="font-sans text-neutral-400">No text available for {selectedBook} {selectedChapter} yet.</AppText>
            </View>
          ) : chapterViewMode === 'list' ? (
            /* LIST VIEW */
            <View className="gap-2.5">
              {activeChapterVerses.map((v) => {
                const isSelected = isVerseSelected(v.verse);
                const dotColor =
                  v.status === 'memorized' ? 'bg-emerald-500' : v.status === 'learning' ? 'bg-amber-400' : 'bg-neutral-200';

                return (
                  <Pressable
                    key={v.verse}
                    onPress={() => toggleVerseSelection(v.verse)}
                    className={`border rounded-xl p-3 relative ${
                      isSelected ? 'border-[#1A1A1A] bg-[#F3F2F1]/30' : 'border-[#E5E5E5] bg-white'
                    }`}
                  >
                    <View className="flex-row items-start gap-2.5">
                      {/* Dot Status indicator */}
                      <View className={`w-2 h-2 rounded-full mt-1.5 ${dotColor}`} />
                      <View className="flex-1" style={{ paddingRight: 48 }}>
                        <AppText variant="body" className="font-serif leading-relaxed text-[#1A1A1A]">
                          <AppText variant="caption" className="font-sans font-bold text-neutral-400">v{v.verse} </AppText>
                          {v.text}
                        </AppText>
                      </View>
                    </View>
                    {/* Due status badge */}
                    {v.dueDate && (
                      <View className="absolute top-2.5 right-2.5 bg-[#F3F2F1] border border-[#E5E5E5] px-1.5 py-0.5 rounded">
                        <AppText variant="micro" className="font-sans font-bold text-neutral-400">{v.dueDate}</AppText>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : chapterViewMode === 'grid' ? (
            /* GRID VIEW - Compact & informative with word snippets */
            <View className="flex-row flex-wrap gap-2 pt-1">
              {activeChapterVerses.map((v) => {
                const isSelected = isVerseSelected(v.verse);
                const statusBorderColor =
                  v.status === 'memorized' ? '#10b981' : v.status === 'learning' ? '#f59e0b' : '#d4d4d4';

                const textSnippet = v.text ? v.text.split(/\s+/).slice(0, 4).join(' ') + '...' : 'No text...';

                return (
                  <Pressable
                    key={v.verse}
                    onPress={() => toggleVerseSelection(v.verse)}
                    style={{ width: '31.5%', borderLeftWidth: 3, borderLeftColor: statusBorderColor }}
                    className={`h-16 rounded-xl bg-white border border-[#E5E5E5] p-2 justify-between relative ${
                      isSelected ? 'border-[#1A1A1A]' : ''
                    }`}
                  >
                    <View className="flex-row justify-between items-center">
                      <AppText variant="micro" className="font-sans font-extrabold text-[#1A1A1A]">v{v.verse}</AppText>
                      {v.status === 'memorized' && (
                        <View className="bg-emerald-500/10 px-1 rounded">
                          <AppText variant="micro" className="font-mono font-bold text-emerald-700 uppercase">MEM</AppText>
                        </View>
                      )}
                      {v.status === 'learning' && (
                        <View className="bg-amber-500/15 px-1 rounded">
                          <AppText variant="micro" className="font-mono font-bold text-amber-700 uppercase">LRN</AppText>
                        </View>
                      )}
                    </View>
                    <AppText variant="micro" className="font-serif italic leading-tight text-neutral-500 mt-1" numberOfLines={2}>
                      {textSnippet}
                    </AppText>
                    {isSelected && (
                      <View className="absolute -top-1 -right-1 bg-black w-3.5 h-3.5 rounded-full items-center justify-center border border-white">
                        <AppText variant="micro" className="text-white font-black">✓</AppText>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            /* MEMORY GRID VIEW - Scripture Memory Fellowship style: every
               word's first letter, tap to select (same as List/Grid), pin
               icon to mark a personal memory anchor. */
            <View className="gap-2.5">
              <View className="flex-row items-center justify-between">
                <View className="flex-row bg-neutral-100 p-0.5 rounded-lg">
                  <Pressable
                    onPress={() => setMemoryGridColumns(2)}
                    className={`px-3 py-1 rounded-md ${memoryGridColumns === 2 ? 'bg-white' : ''}`}
                  >
                    <AppText variant="caption" className={`font-sans font-extrabold ${memoryGridColumns === 2 ? 'text-neutral-900' : 'text-neutral-500'}`}>
                      2 Columns
                    </AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => setMemoryGridColumns(4)}
                    className={`px-3 py-1 rounded-md ${memoryGridColumns === 4 ? 'bg-white' : ''}`}
                  >
                    <AppText variant="caption" className={`font-sans font-extrabold ${memoryGridColumns === 4 ? 'text-neutral-900' : 'text-neutral-500'}`}>
                      4 Columns
                    </AppText>
                  </Pressable>
                </View>
                <Pressable
                  onPress={() =>
                    printMemoryGrid(
                      activeChapterVerses.map((v) => ({
                        book: selectedBook || '',
                        chapter: selectedChapter || 0,
                        verse: v.verse,
                        text: v.text,
                      })),
                      `${selectedBook} ${selectedChapter}`
                    )
                  }
                  className="flex-row items-center gap-1.5 bg-[#1A1A1A] px-3 py-1.5 rounded-lg"
                >
                  <Printer size={12} color="#ffffff" />
                  <AppText variant="caption" className="font-sans font-extrabold text-white">Printable PDF</AppText>
                </Pressable>
              </View>
              <MemoryGrid
                verses={activeChapterVerses.map((v) => ({
                  book: selectedBook || '',
                  chapter: selectedChapter || 0,
                  verse: v.verse,
                  text: v.text,
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
                onTapVerse={(v) => toggleVerseSelection(v.verse)}
              />
            </View>
          )}
        </View>

        {/* Copyright/attribution notice -- only shown for translations that
            require one (public-domain translations like KJV/WEB have none). */}
        {activeChapterVerses.length > 0 && activeTranslation.copyright && (
          <AppText variant="micro" className="font-sans text-neutral-400 leading-tight text-center px-2">
            {activeTranslation.copyright}
          </AppText>
        )}

      </ScrollView>

      {/* Floating Action Menu -- hovers above the verse content near the
          bottom of the viewport (not the end of the scrollable page), so
          it's reachable the instant verses are selected without scrolling
          all the way down. Rendered as an absolutely-positioned sibling of
          the ScrollView rather than inside its content flow; the matching
          extra paddingBottom on the ScrollView above keeps the last verses
          and the ESV copyright notice from ever being hidden underneath it. */}
      {floatingBarShowing && (
        <View
          className="absolute left-4 right-4 bg-white border-2 border-[#1A1A1A] rounded-xl p-3 shadow-lg"
          style={{ bottom: 16, gap: 8 }}
        >
          <View className="flex-row items-center justify-between pl-1">
            <View>
              <AppText variant="micro" className="font-bold text-neutral-400 uppercase font-sans">SELECTED</AppText>
              <AppText variant="label" className="font-extrabold font-sans text-[#1A1A1A]">
                {selectedVerseNumbers.length} {selectedVerseNumbers.length === 1 ? 'Verse' : 'Verses'}
              </AppText>
            </View>
            <Pressable
              onPress={() => {
                setSelectedVerseNumbers([]);
                setShowStatusOverride(false);
              }}
              className="px-2 py-1"
            >
              <AppText variant="caption" className="font-bold font-sans text-neutral-400">Clear</AppText>
            </Pressable>
          </View>
          <View className="flex-row gap-1.5">
            <Pressable
              onPress={() => {
                addVersesToQueue(activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)), selectedTranslationId);
                setSelectedVerseNumbers([]);
              }}
              className="flex-1 py-2 items-center bg-emerald-600 rounded-lg"
            >
              <AppText variant="micro" className="text-white font-bold uppercase tracking-wide" numberOfLines={1}>
                Add to Queue
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => startPractice('listen', activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)))}
              className="flex-1 py-2 items-center bg-[#1A1A1A] rounded-lg"
            >
              <AppText variant="micro" className="text-white font-bold uppercase tracking-wide">Listen</AppText>
            </Pressable>
            <Pressable
              onPress={() => startPractice('learn', activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)))}
              className="flex-1 py-2 items-center bg-[#1A1A1A] rounded-lg"
            >
              <AppText variant="micro" className="text-white font-bold uppercase tracking-wide">Learn</AppText>
            </Pressable>
            <Pressable
              onPress={() => setShowStatusOverride((s) => !s)}
              className={`flex-1 py-2 items-center rounded-lg flex-row justify-center gap-1 ${
                showStatusOverride ? 'bg-indigo-700' : 'bg-indigo-600'
              }`}
            >
              <SlidersHorizontal size={10} color="#FFFFFF" />
              <AppText variant="micro" className="text-white font-bold uppercase tracking-wide">Status</AppText>
            </Pressable>
          </View>

          {/* Manual memory-status override -- for verses already memorized
              outside the app. Sets the selected verses directly to a
              chosen phase, skipping the normal learn-then-graduate climb. */}
          {showStatusOverride && (
            <FadeInView>
              <View className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 mt-1" style={{ gap: 10 }}>
                <View className="flex-row items-center justify-between">
                  <AppText variant="micro" className="font-bold text-indigo-900 uppercase tracking-wide font-sans">
                    Set Memory Status
                  </AppText>
                  <Pressable onPress={() => setShowStatusOverride(false)}>
                    <X size={13} color="#4338ca" />
                  </Pressable>
                </View>
                <AppText variant="micro" className="text-indigo-800/80 font-sans leading-relaxed -mt-1">
                  Already know these from memory? Place them directly in the right phase instead of starting over from
                  Learning.
                </AppText>

                <View style={{ gap: 4 }}>
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
                  <View style={{ gap: 4 }}>
                    <AppText variant="micro" className="font-bold text-indigo-800/70 uppercase tracking-wide font-sans">
                      Land review cycle on (optional) — tap again to clear
                    </AppText>
                    <ChipRow
                      wrap
                      value={overrideWeekday ?? ''}
                      onChange={(id) => setOverrideWeekday((prev) => (prev === id ? null : (id as string)))}
                      options={OVERRIDE_WEEKDAY_OPTIONS}
                    />
                  </View>
                )}

                {(overridePhase === 'daily' || overridePhase === 'weekly' || overridePhase === 'monthly') && (
                  <View style={{ gap: 4 }}>
                    <View className="flex-row items-center justify-between">
                      <AppText variant="micro" className="font-bold text-indigo-800/70 uppercase tracking-wide font-sans">
                        How far into this phase?
                      </AppText>
                      <AppText variant="micro" className="font-mono font-bold text-indigo-900">
                        {overrideProgressPercent >= 100 ? 'Graduates next review' : `${overrideProgressUnit} (${overrideProgressCount}/${overrideProgressMax})`}
                      </AppText>
                    </View>
                    <DiscreteSlider
                      value={overrideProgressPercent}
                      onChange={setOverrideProgressPercent}
                      options={Array.from({ length: 21 }, (_, i) => i * 5).map((p) => ({
                        id: p,
                        // Labeling every 5% stop would overlap into an
                        // unreadable smear -- only the quarter-marks get text,
                        // the rest are still real, draggable/tappable stops.
                        label: p % 25 === 0 ? (p === 0 ? 'Start' : `${p}%`) : '',
                      }))}
                    />
                  </View>
                )}

                <Pressable
                  onPress={() => {
                    overrideVerseMemoryStatus(
                      activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)),
                      overridePhase,
                      selectedTranslationId,
                      overrideWeekday ?? undefined,
                      overrideProgressCount
                    );
                    setSelectedVerseNumbers([]);
                    setShowStatusOverride(false);
                  }}
                  className="w-full py-2 items-center bg-indigo-700 rounded-lg"
                >
                  <AppText variant="section" className="text-white font-bold uppercase tracking-wide">Apply Override</AppText>
                </Pressable>
              </View>
            </FadeInView>
          )}
        </View>
      )}
    </FadeInView>
  );
}
