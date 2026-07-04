import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, BookOpen, Check, Pause, Play, Plus, Search, Volume2, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, ProgressBar } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { Dropdown } from '../components/Dropdown';
import { getBookByName } from '../data';

// Helper to assign background/text colors to known users (mirrors original web app).
const getAvatarStyle = (user: string = '') => {
  switch (user) {
    case 'Sarah Miller':
      return { bg: '#f0fdfa', text: '#0f766e', border: '#99f6e4' }; // teal
    case 'Elizabeth K.':
      return { bg: '#fdf4ff', text: '#a21caf', border: '#f5d0fe' }; // fuchsia
    case 'Brother Thomas':
      return { bg: '#fffbeb', text: '#b45309', border: '#fde68a' }; // amber
    case 'Mark Davis':
      return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }; // blue
    case 'Pastor Robert':
      return { bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe' }; // indigo
    case 'Grace Thompson':
      return { bg: '#fff1f2', text: '#be123c', border: '#fecdd3' }; // rose
    case 'Kenneth Carter':
      return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' }; // emerald
    default:
      return { bg: '#f5f5f5', text: '#1A1A1A', border: '#E5E5E5' };
  }
};

export default function AudioFeedScreen({ state }: { state: AppState }) {
  const {
    handleBack,
    audioSearchQuery,
    setAudioSearchQuery,
    feedBookFilter,
    setFeedBookFilter,
    feedChapterFilter,
    setFeedChapterFilter,
    activeFeedFilter,
    setActiveFeedFilter,
    setPlayingRecordingId,
    playingRecordingId,
    playingRecProgress,
    setPlayingRecProgress,
    feedRecordings,
    userRecordings,
    setUserRecordings,
    formatTime,
    triggerToast,
  } = state;

  const selectedBookMeta = feedBookFilter ? getBookByName(feedBookFilter) : undefined;
  const chapterOptions = selectedBookMeta
    ? [
        { id: '', label: 'All' },
        ...Array.from({ length: selectedBookMeta.chapters }, (_, i) => {
          const n = i + 1;
          return { id: String(n), label: String(n) };
        }),
      ]
    : [];

  // 1. Filter by category
  let filtered = feedRecordings;
  if (activeFeedFilter === 'group') {
    filtered = feedRecordings.filter((r) => r.category === 'group' || r.user === 'Kenneth Carter');
  } else if (activeFeedFilter === 'friends') {
    filtered = feedRecordings.filter(
      (r) =>
        r.category === 'friends' ||
        r.user === 'Sarah Miller' ||
        r.user === 'Elizabeth K.' ||
        r.user === 'Kenneth Carter'
    );
  }

  // 2. Filter by Book selection
  if (feedBookFilter) {
    filtered = filtered.filter((r) => r.book.toLowerCase() === feedBookFilter.toLowerCase());
  }

  // 3. Filter by Chapter selection
  if (feedChapterFilter) {
    filtered = filtered.filter((r) => r.chapter.toString() === feedChapterFilter);
  }

  // 4. Filter by search query
  if (audioSearchQuery.trim()) {
    const q = audioSearchQuery.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        (r.user && r.user.toLowerCase().includes(q)) ||
        r.title.toLowerCase().includes(q) ||
        r.book.toLowerCase().includes(q) ||
        r.translation.toLowerCase().includes(q)
    );
  }

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3 border-b border-[#E5E5E5] pb-1">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-[#E5E5E5] items-center justify-center bg-white shadow-xs"
          >
            <ArrowLeft size={15} color="#1A1A1A" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-bold text-neutral-400 font-sans">
              SCRIPTURE AUDIO LIBRARY
            </Text>
            <Text className="text-xl font-serif font-bold text-[#1A1A1A]">Suggested Recordings</Text>
          </View>
        </View>

        {/* Search Bar */}
        <View className="relative justify-center">
          <View className="absolute left-3 z-10">
            <Search size={16} color="#a3a3a3" />
          </View>
          <TextInput
            value={audioSearchQuery}
            onChangeText={setAudioSearchQuery}
            placeholder="Search by book, verses, or reciter..."
            placeholderTextColor="#a3a3a3"
            className="w-full bg-[#F3F2F1] border border-[#E5E5E5] rounded-xl py-2 pl-9 pr-8 text-xs text-[#1A1A1A]"
          />
          {!!audioSearchQuery && (
            <Pressable onPress={() => setAudioSearchQuery('')} className="absolute right-3">
              <X size={14} color="#a3a3a3" />
            </Pressable>
          )}
        </View>

        {/* Book Filter under Search */}
        <View className="gap-1">
          <Text className="text-[8px] font-bold uppercase text-neutral-400 font-sans tracking-wider">Book</Text>
          <BookPicker
            value={feedBookFilter}
            allowAll
            allLabel="All Books"
            onChange={(name) => {
              setFeedBookFilter(name);
              setFeedChapterFilter(''); // Reset chapter when book changes
              setPlayingRecordingId(null);
            }}
          />
        </View>

        {/* Chapter Filter — only meaningful once a specific book is chosen */}
        {selectedBookMeta && (
          <View className="gap-1">
            <Text className="text-[8px] font-bold uppercase text-neutral-400 font-sans tracking-wider">Chapter</Text>
            <View style={{ width: 140 }}>
              <Dropdown
                options={chapterOptions}
                value={feedChapterFilter}
                title="Select a Chapter"
                onChange={(id) => {
                  setFeedChapterFilter(id);
                  setPlayingRecordingId(null);
                }}
              />
            </View>
          </View>
        )}

        {/* Filter Tabs */}
        <View className="flex-row gap-1 bg-[#F3F2F1] p-1 border border-[#E5E5E5] rounded-xl">
          {(
            [
              { id: 'global', label: 'Global' },
              { id: 'group', label: 'My Group' },
              { id: 'friends', label: 'Friends' },
            ] as const
          ).map((opt) => {
            const active = activeFeedFilter === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => {
                  setActiveFeedFilter(opt.id);
                  setPlayingRecordingId(null);
                }}
                className={`flex-1 py-2 px-2 rounded-lg items-center ${active ? 'bg-[#1A1A1A]' : ''}`}
              >
                <Text
                  className={`text-[10px] uppercase tracking-wider font-sans font-bold ${
                    active ? 'text-white' : 'text-neutral-500'
                  }`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* List of recordings */}
        <View className="gap-3">
          {filtered.length === 0 ? (
            <View className="items-center p-8 bg-neutral-50 rounded-xl border border-dashed border-[#E5E5E5] gap-2">
              <Volume2 size={32} color="#d4d4d4" />
              <Text className="font-sans font-bold text-xs text-neutral-400">No recordings matched your criteria</Text>
              <Text className="text-[10px] font-sans text-neutral-400 text-center">
                Be the first to share! Record a recitation under the Record tab and save it to your profile feed.
              </Text>
            </View>
          ) : (
            filtered.map((rec) => {
              const isPlaying = playingRecordingId === rec.id;
              const avatarStyle = getAvatarStyle(rec.user);
              const isSaved = userRecordings.some(
                (ur) =>
                  ur.id === rec.id ||
                  (ur.book === rec.book && ur.chapter === rec.chapter && ur.user === rec.user && ur.translation === rec.translation)
              );

              return (
                <View key={rec.id} className="border border-[#E5E5E5] rounded-xl p-3.5 bg-white gap-3 shadow-xs">
                  {/* Card Top: Reciter Info */}
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2.5">
                      <View
                        style={{ backgroundColor: avatarStyle.bg, borderColor: avatarStyle.border }}
                        className="w-8 h-8 rounded-full items-center justify-center border"
                      >
                        <Text style={{ color: avatarStyle.text }} className="font-sans font-bold text-xs">
                          {rec.avatar || 'U'}
                        </Text>
                      </View>
                      <View>
                        <View className="flex-row items-center gap-1.5">
                          <Text className="text-xs font-bold text-[#1A1A1A]">{rec.user || 'Anonymous'}</Text>
                          {rec.user === 'Kenneth Carter' ? (
                            <View className="bg-emerald-100 px-1.5 py-0.5 rounded">
                              <Text className="text-[8px] font-sans font-bold uppercase tracking-wide text-emerald-700">Me</Text>
                            </View>
                          ) : rec.user === 'Sarah Miller' || rec.user === 'Elizabeth K.' ? (
                            <View className="bg-indigo-50 px-1.5 py-0.5 rounded">
                              <Text className="text-[8px] font-sans font-bold uppercase tracking-wide text-indigo-600">Friend</Text>
                            </View>
                          ) : rec.user === 'Brother Thomas' || rec.user === 'Mark Davis' ? (
                            <View className="bg-amber-50 px-1.5 py-0.5 rounded">
                              <Text className="text-[8px] font-sans font-bold uppercase tracking-wide text-amber-700">Group</Text>
                            </View>
                          ) : (
                            <View className="bg-neutral-100 px-1.5 py-0.5 rounded">
                              <Text className="text-[8px] font-sans font-bold uppercase tracking-wide text-neutral-500">Public</Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-[9px] font-sans text-neutral-400">
                          {rec.date} • {rec.translation}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-[10px] font-mono font-bold text-neutral-500 bg-[#F3F2F1] px-2 py-0.5 rounded-md">
                      {formatTime(rec.duration)}
                    </Text>
                  </View>

                  {/* Card Middle: Title & Scripture Info */}
                  <View className="bg-neutral-50 p-2.5 border border-[#E5E5E5] rounded-lg">
                    <View className="flex-row items-center gap-1.5">
                      <BookOpen size={11} color="#737373" />
                      <Text className="text-[10px] font-sans font-bold uppercase tracking-wide text-neutral-700">
                        {rec.book} {rec.chapter} • Full Chapter
                      </Text>
                    </View>
                  </View>

                  {/* Card Bottom: Play / Pause & Save to Library */}
                  <View className="flex-row items-center justify-between pt-1 border-t border-neutral-50">
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        onPress={() => {
                          if (isPlaying) {
                            setPlayingRecordingId(null);
                          } else {
                            setPlayingRecordingId(rec.id);
                            setPlayingRecProgress(0);
                          }
                        }}
                        className={`w-7 h-7 rounded-full items-center justify-center ${
                          isPlaying ? 'bg-[#1A1A1A]' : 'border border-[#1A1A1A]'
                        }`}
                      >
                        {isPlaying ? (
                          <Pause size={11} color="#ffffff" />
                        ) : (
                          <Play size={11} color="#1A1A1A" style={{ marginLeft: 2 }} />
                        )}
                      </Pressable>
                      <Text className="text-[10px] font-sans font-bold text-[#1A1A1A]">
                        {isPlaying ? 'Playing Narration' : 'Tap to Listen'}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => {
                        if (isSaved) {
                          triggerToast(`"${rec.title}" is already in your library!`);
                          return;
                        }
                        // Save to user's library
                        const savedRec = {
                          ...rec,
                          id: `saved_${Date.now()}_${rec.id}`,
                        };
                        setUserRecordings((prev) => [savedRec, ...prev]);
                        triggerToast(`Saved to My Library! Added to your ${rec.book} ${rec.chapter} options. 📚`);
                      }}
                      className={`flex-row items-center gap-1 py-1.5 px-3 rounded-lg ${
                        isSaved ? 'bg-emerald-50 border border-emerald-200' : 'bg-neutral-50 border border-[#E5E5E5]'
                      }`}
                    >
                      {isSaved ? <Check size={11} color="#059669" /> : <Plus size={11} color="#737373" />}
                      <Text
                        className={`text-[10px] font-sans font-bold ${isSaved ? 'text-emerald-700' : 'text-[#1A1A1A]'}`}
                      >
                        {isSaved ? 'Saved to Library' : 'Save to Library'}
                      </Text>
                    </Pressable>
                  </View>

                  {/* Custom Playback Progress indicator inside the active card */}
                  {isPlaying && (
                    <View className="gap-1 pt-1">
                      <ProgressBar percent={playingRecProgress} className="h-1" />
                      <View className="flex-row justify-between">
                        <Text className="text-[8px] font-mono font-semibold text-neutral-400">
                          {formatTime(Math.round((playingRecProgress / 100) * rec.duration))}
                        </Text>
                        <Text className="text-[8px] font-mono font-semibold text-neutral-400">
                          {formatTime(rec.duration)}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
