import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, BookOpen, Check, Pause, Play, Plus, Search, Volume2, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, ProgressBar } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { Dropdown } from '../components/Dropdown';
import { BIBLE_TRANSLATIONS, getBookByName } from '../data';
import { recordingLabel } from '../lib/recordingLabel';
import { AppButton, AppIconButton, AppTextInput, AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
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
    default:
      return { bg: '#f5f5f5', text: '#1A1A1A', border: '#E5E5E5' };
  }
};

export default function AudioFeedScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const {
    user,
    handleBack,
    audioSearchQuery,
    setAudioSearchQuery,
    feedBookFilter,
    setFeedBookFilter,
    feedChapterFilter,
    setFeedChapterFilter,
    activeFeedFilter,
    setActiveFeedFilter,
    feedTranslationFilter,
    setFeedTranslationFilter,
    setPlayingRecordingId,
    playingRecordingId,
    playingRecProgress,
    setPlayingRecProgress,
    feedRecordings,
    loadingFeedRecordings,
    userRecordings,
    friends,
    circleFriends,
    saveSharedRecordingToLibrary,
    formatTime,
    triggerToast,
  } = state;

  // Translation options are derived from what the feed ACTUALLY contains
  // rather than hardcoded from BIBLE_TRANSLATIONS: offering "KJV" when nobody
  // has recorded a KJV reading is dead UI, and the guest-preview mock feed
  // carries a few translation codes (NIV/NKJV/NASB) that have no imported
  // text and so aren't in BIBLE_TRANSLATIONS at all. Known translations sort
  // first, in canonical order; anything else follows alphabetically.
  const presentTranslations = Array.from(
    new Set(feedRecordings.map((r) => (r.translation || '').trim()).filter(Boolean))
  ).sort((a, b) => {
    const ia = BIBLE_TRANSLATIONS.findIndex((t) => t.id.toLowerCase() === a.toLowerCase());
    const ib = BIBLE_TRANSLATIONS.findIndex((t) => t.id.toLowerCase() === b.toLowerCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  const translationOptions = [
    { id: '', label: 'All' },
    ...presentTranslations.map((t) => ({ id: t, label: t })),
  ];

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

  // 1. Filter by category — real recordings are matched by userId against
  // real friends/circleFriends; r.category is only ever set on the
  // illustrative guest-preview mock feed (SUGGESTED_FEED_RECORDINGS), kept
  // here so that still filters sensibly when signed out.
  const friendUids = new Set(friends.map((f) => f.uid));
  const circleUids = new Set(circleFriends.map((f) => f.uid));
  let filtered = feedRecordings;
  if (activeFeedFilter === 'group') {
    filtered = feedRecordings.filter(
      (r) => (r.userId && (circleUids.has(r.userId) || r.userId === user?.uid)) || r.category === 'group'
    );
  } else if (activeFeedFilter === 'friends') {
    filtered = feedRecordings.filter(
      (r) => (r.userId && (friendUids.has(r.userId) || r.userId === user?.uid)) || r.category === 'friends'
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

  // 4. Filter by Translation selection
  if (feedTranslationFilter) {
    filtered = filtered.filter((r) => (r.translation || '').toLowerCase() === feedTranslationFilter.toLowerCase());
  }

  // 5. Filter by search query
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
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3 border-b border-line pb-1">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={15} iconColor={palette.ink} onPress={handleBack} className="rounded-full border border-line bg-surface shadow-xs" />
          <View className="flex-1">
            <AppText variant="title" className="font-serif font-bold text-ink">Suggested Recordings</AppText>
          </View>
        </View>

        {/* Search Bar */}
        <View className="relative justify-center">
          <View className="absolute left-3 z-10">
            <Search size={16} color={palette.ink3} />
          </View>
          <AppTextInput value={audioSearchQuery} onChangeText={setAudioSearchQuery} placeholder="Search by book, verses, or reciter..." placeholderTextColor={palette.ink3} className="w-full bg-surface-2 border border-line rounded-xl py-2 pl-9 pr-8 text-ink" />
          {!!audioSearchQuery && (
            <Pressable onPress={() => setAudioSearchQuery('')} className="absolute right-3">
              <X size={14} color={palette.ink3} />
            </Pressable>
          )}
        </View>

        {/* Book Filter under Search */}
        <View className="gap-1">
          <AppText variant="micro" className="font-bold uppercase text-ink-3 font-sans tracking-wider">Book</AppText>
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

        {/* Chapter + Translation filters. Chapter is only meaningful once a
            specific book is chosen; Translation only once the feed actually
            holds more than one. */}
        <View className="flex-row gap-3">
          {selectedBookMeta && (
            <View className="gap-1">
              <AppText variant="micro" className="font-bold uppercase text-ink-3 font-sans tracking-wider">Chapter</AppText>
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

          {presentTranslations.length > 1 && (
            <View className="gap-1">
              <AppText variant="micro" className="font-bold uppercase text-ink-3 font-sans tracking-wider">
                Translation
              </AppText>
              <View style={{ width: 140 }}>
                <Dropdown
                  options={translationOptions}
                  value={feedTranslationFilter}
                  title="Select a Translation"
                  onChange={(id) => {
                    setFeedTranslationFilter(id);
                    setPlayingRecordingId(null);
                  }}
                />
              </View>
            </View>
          )}
        </View>

        {/* Filter Tabs */}
        <View className="flex-row gap-1 bg-surface-2 p-1 border border-line rounded-xl">
          {(
            [
              { id: 'global', label: 'Global' },
              { id: 'group', label: 'My Group' },
              { id: 'friends', label: 'Friends' },
            ] as const
          ).map((opt) => {
            const active = activeFeedFilter === opt.id;
            return (
              <AppButton size="md" key={opt.id} onPress={() => { setActiveFeedFilter(opt.id); setPlayingRecordingId(null); }} className={`flex-1 rounded-lg items-center ${active ? 'bg-accent' : ''}`}>
                <AppText variant="section" className={`uppercase tracking-wider font-sans font-bold ${ active ? 'text-on-accent' : 'text-ink-3' }`} >
                  {opt.label}
                </AppText>
              </AppButton>
            );
          })}
        </View>

        {/* List of recordings */}
        <View className="gap-3">
          {loadingFeedRecordings ? (
            <View className="py-8 items-center">
              <AppText variant="label" className="text-ink-3 font-sans">Loading recordings...</AppText>
            </View>
          ) : filtered.length === 0 ? (
            <View className="items-center p-8 bg-surface-2 rounded-xl border border-dashed border-line gap-2">
              <Volume2 size={32} color={palette.lineStrong} />
              <AppText variant="label" className="font-sans font-bold text-ink-3">No recordings matched your criteria</AppText>
              <AppText variant="caption" className="font-sans text-ink-3 text-center">
                Be the first to share one. Record a recitation from the Record tab and set its visibility to Circle or Public.
              </AppText>
            </View>
          ) : (
            filtered.map((rec) => {
              const isPlaying = playingRecordingId === rec.id;
              const avatarStyle = getAvatarStyle(rec.user);
              const isOwnRecording = !!rec.userId && !!user?.uid && rec.userId === user.uid;
              const isSaved =
                isOwnRecording ||
                userRecordings.some(
                  (ur) =>
                    ur.savedFromRecordingId === rec.id ||
                    ur.id === rec.id ||
                    (ur.book === rec.book && ur.chapter === rec.chapter && ur.user === rec.user && ur.translation === rec.translation)
                );

              return (
                <View key={rec.id} className="border border-line rounded-xl p-3.5 bg-surface gap-3 shadow-xs">
                  {/* Card Top: Reciter Info */}
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2.5 flex-1">
                      <View
                        style={{ backgroundColor: avatarStyle.bg, borderColor: avatarStyle.border }}
                        className="w-8 h-8 rounded-full items-center justify-center border"
                      >
                        <AppText variant="label" style={{ color: avatarStyle.text }} className="font-sans font-bold ">
                          {rec.avatar || 'U'}
                        </AppText>
                      </View>
                      <View className="flex-1">
                        <View className="flex-row flex-wrap items-center gap-1.5">
                          <AppText variant="label" className="font-bold text-ink">{rec.user || 'Anonymous'}</AppText>
                          {isOwnRecording ? (
                            <View className="bg-success-soft px-1.5 py-0.5 rounded">
                              <AppText variant="micro" className="font-sans font-bold uppercase tracking-wide text-success">Me</AppText>
                            </View>
                          ) : rec.user === 'Sarah Miller' || rec.user === 'Elizabeth K.' ? (
                            <View className="bg-accent-soft px-1.5 py-0.5 rounded">
                              <AppText variant="micro" className="font-sans font-bold uppercase tracking-wide text-accent">Friend</AppText>
                            </View>
                          ) : rec.user === 'Brother Thomas' || rec.user === 'Mark Davis' ? (
                            <View className="bg-warning-soft px-1.5 py-0.5 rounded">
                              <AppText variant="micro" className="font-sans font-bold uppercase tracking-wide text-warning">Group</AppText>
                            </View>
                          ) : (
                            <View className="bg-surface-2 px-1.5 py-0.5 rounded">
                              <AppText variant="micro" className="font-sans font-bold uppercase tracking-wide text-ink-3">Public</AppText>
                            </View>
                          )}
                        </View>
                        <AppText variant="micro" className="font-sans text-ink-3">
                          {rec.date} • {rec.translation}
                        </AppText>
                      </View>
                    </View>
                    <AppText variant="caption" className="font-mono font-bold text-ink-3 bg-surface-2 px-2 py-0.5 rounded-md shrink-0">
                      {formatTime(rec.duration)}
                    </AppText>
                  </View>

                  {/* Card Middle: Title & Scripture Info */}
                  <View className="bg-surface-2 p-2.5 border border-line rounded-lg">
                    <View className="flex-row items-center gap-1.5">
                      <BookOpen size={11} color={palette.ink3} />
                      <AppText variant="section" className="font-sans font-bold uppercase tracking-wide text-ink-2">
                        {recordingLabel(rec)}
                      </AppText>
                    </View>
                  </View>

                  {/* Card Bottom: Play / Pause & Save to Library */}
                  <View className="flex-row items-center justify-between pt-1 border-t border-hairline">
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
                          isPlaying ? 'bg-accent' : 'border border-ink'
                        }`}
                      >
                        {isPlaying ? (
                          <Pause size={11} color={palette.onAccent} />
                        ) : (
                          <Play size={11} color={palette.ink} style={{ marginLeft: 2 }} />
                        )}
                      </Pressable>
                      <AppText variant="caption" className="font-sans font-bold text-ink">
                        {isPlaying ? 'Playing Narration' : 'Tap to Listen'}
                      </AppText>
                    </View>

                    <AppButton size="sm" onPress={() => { if (isSaved) { triggerToast(`"${rec.title}" is already in your library!`); return; } saveSharedRecordingToLibrary(rec); }} className={`flex-row items-center gap-1 rounded-lg ${ isSaved ? 'bg-success-soft border border-success/30' : 'bg-surface-2 border border-line' }`}>
                      {isSaved ? <Check size={11} color={palette.success} /> : <Plus size={11} color={palette.ink3} />}
                      <AppText variant="caption" className={`font-sans font-bold ${isSaved ? 'text-success' : 'text-ink'}`} >
                        {isSaved ? 'Saved to Library' : 'Save to Library'}
                      </AppText>
                    </AppButton>
                  </View>

                  {/* Custom Playback Progress indicator inside the active card */}
                  {isPlaying && (
                    <View className="gap-1 pt-1">
                      <ProgressBar percent={playingRecProgress} className="h-1" />
                      <View className="flex-row justify-between">
                        <AppText variant="micro" className="font-mono font-semibold text-ink-3">
                          {formatTime(Math.round((playingRecProgress / 100) * rec.duration))}
                        </AppText>
                        <AppText variant="micro" className="font-mono font-semibold text-ink-3">
                          {formatTime(rec.duration)}
                        </AppText>
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
