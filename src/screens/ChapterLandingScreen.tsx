import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Grid as GridIcon,
  List as ListIcon,
  Pause,
  Play,
  Search,
} from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { Recording } from '../types';
import { ESV_COPYRIGHT_NOTICE } from '../data';

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
    isVerseSelected,
    toggleVerseSelection,
    setSelectedVerseNumbers,
    addVersesToQueue,
    chapterViewMode,
    setChapterViewMode,
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

  const activeChapterKey = `${selectedBook}_${selectedChapter}`;

  // Filter user recordings saved in library that match this chapter — these
  // are real Recording objects (with a real audioUrl), so selecting one here
  // and playing it uses the exact same playingRecordingId/playingRecProgress
  // mechanism as Profile/RecordingDetail/the floating now-playing bar.
  const availableNarrations = userRecordings.filter(
    (r) => r.book.toLowerCase() === (selectedBook || '').toLowerCase() && r.chapter === selectedChapter
  );
  const optionsList = availableNarrations;
  const currentAudio = selectedChapterAudios[activeChapterKey] || availableNarrations[0] || null;
  const isPlayingThis = !!currentAudio && playingRecordingId === currentAudio.id;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
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

        {/* Grid / List view Toggle */}
        <View className="flex-row items-center justify-between bg-[#F3F2F1] p-1.5 border border-[#E5E5E5] rounded-xl">
          <Text className="text-xs font-sans font-bold text-neutral-600 pl-1">Verse Layout</Text>
          <View className="flex-row bg-white border border-[#E5E5E5] rounded-lg p-0.5">
            <Pressable
              onPress={() => setChapterViewMode('list')}
              className={`p-1.5 rounded-md flex-row items-center gap-1 ${
                chapterViewMode === 'list' ? 'bg-[#1A1A1A]' : ''
              }`}
            >
              <ListIcon size={13} color={chapterViewMode === 'list' ? '#FFFFFF' : '#737373'} />
              <Text className={`text-xs font-bold ${chapterViewMode === 'list' ? 'text-white' : 'text-neutral-500'}`}>
                List View
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setChapterViewMode('grid')}
              className={`p-1.5 rounded-md flex-row items-center gap-1 ${
                chapterViewMode === 'grid' ? 'bg-[#1A1A1A]' : ''
              }`}
            >
              <GridIcon size={13} color={chapterViewMode === 'grid' ? '#FFFFFF' : '#737373'} />
              <Text className={`text-xs font-bold ${chapterViewMode === 'grid' ? 'text-white' : 'text-neutral-500'}`}>
                Grid View
              </Text>
            </Pressable>
          </View>
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
          ) : (
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
          )}
        </View>

        {/* ESV copyright/attribution notice — required by Crossway whenever ESV text is displayed */}
        {activeChapterVerses.length > 0 && (
          <Text className="text-[8px] font-sans text-neutral-400 leading-tight text-center px-2">
            {ESV_COPYRIGHT_NOTICE}
          </Text>
        )}

        {/* Floating Action Menu (Appears when 1+ verses selected) */}
        {selectedVerseNumbers.length > 0 && (
          <View className="bg-white border-2 border-[#1A1A1A] rounded-xl p-3" style={{ gap: 8 }}>
            <View className="flex-row items-center justify-between pl-1">
              <View>
                <Text className="text-[9px] font-bold text-neutral-400 uppercase font-sans">SELECTED</Text>
                <Text className="text-xs font-extrabold font-sans text-[#1A1A1A]">
                  {selectedVerseNumbers.length} {selectedVerseNumbers.length === 1 ? 'Verse' : 'Verses'}
                </Text>
              </View>
              <Pressable onPress={() => setSelectedVerseNumbers([])} className="px-2 py-1">
                <Text className="text-[10px] font-bold font-sans text-neutral-400">Clear</Text>
              </Pressable>
            </View>
            <View className="flex-row gap-1.5">
              <Pressable
                onPress={() => {
                  addVersesToQueue(activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)));
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
                onPress={() => startPractice('type', activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)))}
                className="flex-1 py-2 items-center bg-[#1A1A1A] rounded-lg"
              >
                <Text className="text-white text-[9.5px] font-bold uppercase tracking-wide">Type</Text>
              </Pressable>
              <Pressable
                onPress={() => startPractice('reveal', activeChapterVerses.filter((v) => selectedVerseNumbers.includes(v.verse)))}
                className="flex-1 py-2 items-center bg-[#1A1A1A] rounded-lg"
              >
                <Text className="text-white text-[9.5px] font-bold uppercase tracking-wide">Reveal</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </FadeInView>
  );
}
