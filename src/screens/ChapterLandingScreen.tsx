import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, Check, ChevronDown, Pause, Play, Printer, Search, SlidersHorizontal, X } from 'lucide-react-native';

import { AppState, resolveChapterAudio } from '../state/useAppState';
import { ChipRow, FadeInView } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import MemoryGrid, { verseAnnotationKey } from '../components/MemoryGrid';
import { printMemoryGrid } from '../lib/printMemoryGrid';
import { Recording } from '../types';
import { BIBLE_TRANSLATIONS } from '../data';

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
    playingRecordingId,
    setPlayingRecordingId,
    playingRecProgress,
    setPlayingRecProgress,
    formatTime,
    setFeedBookFilter,
    setFeedChapterFilter,
    triggerToast,
    startPractice,
  } = state;

  // Manual memory-status override panel — for verses already memorized
  // outside the app (e.g. "I already know all of Ephesians 1, put it
  // straight into Weekly review"). Local to this screen since it only ever
  // acts on the current selection; resets whenever it's closed/reopened.
  const [showStatusOverride, setShowStatusOverride] = useState(false);
  const [overridePhase, setOverridePhase] = useState<'learning' | 'daily' | 'weekly' | 'monthly' | 'retained'>('weekly');
  const [overrideWeekday, setOverrideWeekday] = useState<string | null>(null);

  const activeChapterKey = `${selectedBook}_${selectedChapter}`;

  // Filter user recordings saved in library that match this chapter — these
  // are real Recording objects (with a real audioUrl), so selecting one here
  // and playing it uses the exact same playingRecordingId/playingRecProgress
  // mechanism as Profile/RecordingDetail/the floating now-playing bar.
  const availableNarrations = userRecordings.filter(
    (r) => r.book.toLowerCase() === (selectedBook || '').toLowerCase() && r.chapter === selectedChapter
  );
  const optionsList = availableNarrations;
  const currentAudio = resolveChapterAudio(userRecordings, selectedChapterAudios, selectedBook || '', selectedChapter || 0);
  const isPlayingThis = !!currentAudio && playingRecordingId === currentAudio.id;

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
            <Text className="text-lg font-serif font-extrabold text-[#1A1A1A]">
              {selectedBook} {selectedChapter}
            </Text>
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
              <Text className="text-[10px] font-bold font-sans uppercase text-[#1A1A1A]">
                {selectedVerseNumbers.length === activeChapterVerses.length ? 'Deselect All' : 'Select All'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Segmented Progress Bar */}
        <View className="gap-1.5">
          <View className="flex-row justify-between items-center">
            <Text className="text-[9px] font-sans font-bold text-[#888]">CHAPTER PROGRESS</Text>
            <View className="flex-row gap-2">
              <View className="flex-row items-center gap-1">
                <View className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                <Text className="text-[9px] font-sans font-bold text-[#888]">Memorized</Text>
              </View>
              <View className="flex-row items-center gap-1">
                <View className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                <Text className="text-[9px] font-sans font-bold text-[#888]">Learning</Text>
              </View>
              <View className="flex-row items-center gap-1">
                <View className="w-1.5 h-1.5 bg-neutral-200 rounded-full" />
                <Text className="text-[9px] font-sans font-bold text-[#888]">Untouched</Text>
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
              <Text className="text-xs font-sans font-bold text-neutral-500">No recordings yet for this chapter</Text>
              <Text className="text-[10px] font-sans text-neutral-400 text-center">
                Record one from the Record tab, or find one in the community library.
              </Text>
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
                <Text className="text-white font-sans font-bold text-[10px] uppercase tracking-wider">Find Recordings</Text>
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
                  <Text className="text-xs font-bold font-sans text-[#1A1A1A]" numberOfLines={1} style={{ maxWidth: 170 }}>
                    {currentAudio.title}
                  </Text>
                  <Text className="text-[10px] font-sans text-neutral-400">
                    Narrator: {currentAudio.user} • {currentAudio.translation}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => setShowAudioSelector(!showAudioSelector)}
                className="flex-row items-center gap-0.5"
              >
                <Text className="text-[10px] font-bold font-sans underline text-neutral-600">Change</Text>
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
                  <Text className="text-[8px] font-mono font-semibold text-neutral-400">
                    {formatTime(Math.round((playingRecProgress / 100) * currentAudio.duration))}
                  </Text>
                  <Text className="text-[8px] font-mono font-semibold text-neutral-400">{formatTime(currentAudio.duration)}</Text>
                </View>
              </View>
            )}

            {/* Dropdown Selector */}
            {showAudioSelector && (
              <View className="bg-[#F3F2F1] rounded-lg p-2.5 border border-[#E5E5E5] gap-2">
                <Text className="text-[9px] font-bold uppercase text-neutral-400 tracking-wider">Select Audio Source</Text>
                <ScrollView style={{ maxHeight: 120 }} contentContainerStyle={{ gap: 6 }}>
                  {optionsList.map((opt) => {
                    const isSelected = currentAudio.id === opt.id;
                    return (
                      <Pressable
                        key={opt.id}
                        onPress={() => {
                          setSelectedChapterAudios((prev) => ({
                            ...prev,
                            [activeChapterKey]: opt as Recording,
                          }));
                          setShowAudioSelector(false);
                          setPlayingRecordingId(null);
                          triggerToast(`Audio changed to ${opt.user}'s recitation`);
                        }}
                        className={`w-full p-2 rounded-md border flex-row items-center justify-between ${
                          isSelected ? 'bg-white border-[#1A1A1A]' : 'bg-white/60 border-[#E5E5E5]/50'
                        }`}
                      >
                        <View style={{ maxWidth: 190 }}>
                          <Text className="font-bold text-[10px] text-[#1A1A1A]" numberOfLines={1}>
                            {opt.title}
                          </Text>
                          <Text className="text-[8px] text-neutral-400 font-sans">
                            {opt.user} • {opt.translation}
                          </Text>
                        </View>
                        {isSelected && <Check size={11} color="#1A1A1A" />}
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <View className="border-t border-[#E5E5E5]/60 pt-2">
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
                    <Text className="text-white font-sans font-bold text-[10px] uppercase tracking-wider">
                      Find More Recordings
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
          )}
        </View>

        {/* Grid / List / Memory Grid view Toggle */}
        <View className="bg-[#F3F2F1] p-1.5 border border-[#E5E5E5] rounded-xl gap-1.5">
          <Text className="text-xs font-sans font-bold text-neutral-600 pl-1">Verse Layout</Text>
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
              <Text className="text-xs font-sans text-neutral-400">Loading {selectedBook} {selectedChapter}…</Text>
            </View>
          ) : activeChapterTextError ? (
            <View className="py-10 items-center gap-1">
              <Text className="text-xs font-sans font-bold text-red-500">Couldn't load this chapter.</Text>
              <Text className="text-[10px] font-sans text-neutral-400">{activeChapterTextError}</Text>
            </View>
          ) : activeChapterVerses.length === 0 ? (
            <View className="py-10 items-center">
              <Text className="text-xs font-sans text-neutral-400">No text available for {selectedBook} {selectedChapter} yet.</Text>
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
                        <Text className="font-serif text-sm leading-relaxed text-[#1A1A1A]">
                          <Text className="font-sans text-xs font-bold text-neutral-400">v{v.verse} </Text>
                          {v.text}
                        </Text>
                      </View>
                    </View>
                    {/* Due status badge */}
                    {v.dueDate && (
                      <View className="absolute top-2.5 right-2.5 bg-[#F3F2F1] border border-[#E5E5E5] px-1.5 py-0.5 rounded">
                        <Text className="text-[8px] font-sans font-bold text-neutral-400">{v.dueDate}</Text>
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
                      <Text className="text-[9px] font-sans font-extrabold text-[#1A1A1A]">v{v.verse}</Text>
                      {v.status === 'memorized' && (
                        <View className="bg-emerald-500/10 px-1 rounded">
                          <Text className="text-[7px] font-mono font-bold text-emerald-700 uppercase">MEM</Text>
                        </View>
                      )}
                      {v.status === 'learning' && (
                        <View className="bg-amber-500/15 px-1 rounded">
                          <Text className="text-[7px] font-mono font-bold text-amber-700 uppercase">LRN</Text>
                        </View>
                      )}
                    </View>
                    <Text className="font-serif italic text-[8.5px] leading-tight text-neutral-500 mt-1" numberOfLines={2}>
                      {textSnippet}
                    </Text>
                    {isSelected && (
                      <View className="absolute -top-1 -right-1 bg-black w-3.5 h-3.5 rounded-full items-center justify-center border border-white">
                        <Text className="text-white text-[8px] font-black">✓</Text>
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
                    <Text className={`text-[10px] font-sans font-extrabold ${memoryGridColumns === 2 ? 'text-neutral-900' : 'text-neutral-500'}`}>
                      2 Columns
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMemoryGridColumns(4)}
                    className={`px-3 py-1 rounded-md ${memoryGridColumns === 4 ? 'bg-white' : ''}`}
                  >
                    <Text className={`text-[10px] font-sans font-extrabold ${memoryGridColumns === 4 ? 'text-neutral-900' : 'text-neutral-500'}`}>
                      4 Columns
                    </Text>
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
                  <Text className="text-[10px] font-sans font-extrabold text-white">Printable PDF</Text>
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
          <Text className="text-[8px] font-sans text-neutral-400 leading-tight text-center px-2">
            {activeTranslation.copyright}
          </Text>
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
              <Text className="text-[9px] font-bold text-neutral-400 uppercase font-sans">SELECTED</Text>
              <Text className="text-xs font-extrabold font-sans text-[#1A1A1A]">
                {selectedVerseNumbers.length} {selectedVerseNumbers.length === 1 ? 'Verse' : 'Verses'}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setSelectedVerseNumbers([]);
                setShowStatusOverride(false);
              }}
              className="px-2 py-1"
            >
              <Text className="text-[10px] font-bold font-sans text-neutral-400">Clear</Text>
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
              <Text className="text-white text-[9.5px] font-bold uppercase tracking-wide" numberOfLines={1}>
                Add to Queue
              </Text>
            </Pressable>
            <Pressable
              onPress={() => startPractice('listen', activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)))}
              className="flex-1 py-2 items-center bg-[#1A1A1A] rounded-lg"
            >
              <Text className="text-white text-[9.5px] font-bold uppercase tracking-wide">Listen</Text>
            </Pressable>
            <Pressable
              onPress={() => startPractice('learn', activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)))}
              className="flex-1 py-2 items-center bg-[#1A1A1A] rounded-lg"
            >
              <Text className="text-white text-[9.5px] font-bold uppercase tracking-wide">Learn</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowStatusOverride((s) => !s)}
              className={`flex-1 py-2 items-center rounded-lg flex-row justify-center gap-1 ${
                showStatusOverride ? 'bg-indigo-700' : 'bg-indigo-600'
              }`}
            >
              <SlidersHorizontal size={10} color="#FFFFFF" />
              <Text className="text-white text-[9.5px] font-bold uppercase tracking-wide">Status</Text>
            </Pressable>
          </View>

          {/* Manual memory-status override -- for verses already memorized
              outside the app. Sets the selected verses directly to a
              chosen phase, skipping the normal learn-then-graduate climb. */}
          {showStatusOverride && (
            <FadeInView>
              <View className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 mt-1" style={{ gap: 10 }}>
                <View className="flex-row items-center justify-between">
                  <Text className="text-[9px] font-bold text-indigo-900 uppercase tracking-wide font-sans">
                    Set Memory Status
                  </Text>
                  <Pressable onPress={() => setShowStatusOverride(false)}>
                    <X size={13} color="#4338ca" />
                  </Pressable>
                </View>
                <Text className="text-[9px] text-indigo-800/80 font-sans leading-relaxed -mt-1">
                  Already know these from memory? Place them directly in the right phase instead of starting over from
                  Learning.
                </Text>

                <View style={{ gap: 4 }}>
                  <ChipRow
                    wrap
                    value={overridePhase}
                    onChange={(id) => {
                      setOverridePhase(id);
                      if (id !== 'weekly' && id !== 'monthly') setOverrideWeekday(null);
                    }}
                    options={OVERRIDE_PHASE_OPTIONS}
                  />
                </View>

                {(overridePhase === 'weekly' || overridePhase === 'monthly') && (
                  <View style={{ gap: 4 }}>
                    <Text className="text-[8px] font-bold text-indigo-800/70 uppercase tracking-wide font-sans">
                      Land review cycle on (optional) -- tap again to clear
                    </Text>
                    <ChipRow
                      wrap
                      value={overrideWeekday ?? ''}
                      onChange={(id) => setOverrideWeekday((prev) => (prev === id ? null : (id as string)))}
                      options={OVERRIDE_WEEKDAY_OPTIONS}
                    />
                  </View>
                )}

                <Pressable
                  onPress={() => {
                    overrideVerseMemoryStatus(
                      activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)),
                      overridePhase,
                      selectedTranslationId,
                      overrideWeekday ?? undefined
                    );
                    setSelectedVerseNumbers([]);
                    setShowStatusOverride(false);
                  }}
                  className="w-full py-2 items-center bg-indigo-700 rounded-lg"
                >
                  <Text className="text-white text-[10px] font-bold uppercase tracking-wide">Apply Override</Text>
                </Pressable>
              </View>
            </FadeInView>
          )}
        </View>
      )}
    </FadeInView>
  );
}
