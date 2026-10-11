import { Pressable, ScrollView, View } from 'react-native';
import { Check, Pause, Play, Plus, Search, Volume2, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { Recording } from '../types';
import { FadeInView } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { Dropdown } from '../components/Dropdown';
import { BIBLE_TRANSLATIONS, getBookByName, translationLabel } from '../data';
import { recordingLabel } from '../lib/recordingLabel';
import { formatDate, formatDuration } from '../lib/format';
import { AppButton, AppIconButton, AppTextInput, AppText, useFontScale, useScaledSpace } from '../components/design';
import { Avatar, Badge, EmptyState, ScreenHeader, SegmentedControl, type BadgeTone } from '../components/blocks';
import { useThemeColors } from '../components/theme';

// Opens from Today and from a chapter's page; the back link names which.
const BACK_LABELS: Partial<Record<string, string>> = {
  home: 'Today',
  chapterLanding: 'Chapter',
};

const FEED_FILTERS = [
  { id: 'global' as const, label: 'Everyone' },
  { id: 'group' as const, label: 'Circles' },
  { id: 'friends' as const, label: 'Friends' },
];

// The guest-preview mock feed names its people rather than carrying real
// uids, so these stand in for "is a friend" / "is in a circle" there.
const MOCK_FRIENDS = new Set(['Sarah Miller', 'Elizabeth K.']);
const MOCK_CIRCLE = new Set(['Brother Thomas', 'Mark Davis']);

export default function AudioFeedScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const {
    user,
    handleBack,
    backHistory,
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
    setPlayingRecProgress,
    feedRecordings,
    loadingFeedRecordings,
    userRecordings,
    friends,
    circleFriends,
    saveSharedRecordingToLibrary,
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
    ...presentTranslations.map((t) => ({ id: t, label: translationLabel(t) })),
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
        (r.translation.toLowerCase().includes(q) || translationLabel(r.translation).toLowerCase().includes(q))
    );
  }

  const prevScreen = backHistory[backHistory.length - 1]?.screen;
  const iconSize = Math.round(16 * scale);

  // Who a recording is from, relative to you. Public strangers get no badge:
  // "Public" on most of the rows said nothing.
  const relationFor = (rec: Recording): { label: string; tone: BadgeTone } | null => {
    if (rec.userId && user?.uid && rec.userId === user.uid) return { label: 'You', tone: 'success' };
    if ((rec.userId && friendUids.has(rec.userId)) || MOCK_FRIENDS.has(rec.user || '')) return { label: 'Friend', tone: 'accent' };
    if ((rec.userId && circleUids.has(rec.userId)) || MOCK_CIRCLE.has(rec.user || '')) return { label: 'Circle', tone: 'neutral' };
    return null;
  };

  const filterBasis = { flexGrow: 1, flexBasis: space(120), gap: space(4) };
  const fieldLabel = (text: string) => (
    <AppText variant="caption" className="font-sans font-medium text-ink-2">
      {text}
    </AppText>
  );

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* Named like the Today row that opens it. It was "Suggested
            Recordings" here and "Find Recordings" on the way in. */}
        <ScreenHeader
          title="Find recordings"
          subtitle="Recitations other people have shared. Save one to play it from your own list."
          onBack={handleBack}
          backLabel={(prevScreen && BACK_LABELS[prevScreen]) || 'Back'}
        />

        <View style={{ gap: space(12) }}>
          <View className="flex-row items-center bg-surface border border-line rounded-btn" style={{ paddingHorizontal: space(12), gap: space(8) }}>
            <Search size={iconSize} color={palette.ink3} />
            <AppTextInput
              value={audioSearchQuery}
              onChangeText={setAudioSearchQuery}
              placeholder={scale >= 1.3 ? 'Passage or person' : 'Search by passage or person'}
              accessibilityLabel="Search recordings"
              variant="body"
              className="flex-1 text-ink font-sans"
              style={{ minWidth: 0, paddingVertical: space(10) }}
            />
            {!!audioSearchQuery && (
              <Pressable onPress={() => setAudioSearchQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <X size={iconSize} color={palette.ink3} />
              </Pressable>
            )}
          </View>

          <SegmentedControl
            value={activeFeedFilter}
            onChange={(id) => {
              setActiveFeedFilter(id);
              setPlayingRecordingId(null);
            }}
            accessibilityLabel="Whose recordings"
            options={FEED_FILTERS}
          />

          {/* Book, then Chapter once a book is picked, then Translation once
              the feed holds more than one. Each takes an equal share of the
              row and wraps when the row runs out, so they're never three
              unrelated widths. */}
          <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
            <View style={{ ...filterBasis, flexBasis: space(160) }}>
              {fieldLabel('Book')}
              <BookPicker
                value={feedBookFilter}
                allowAll
                onChange={(name) => {
                  setFeedBookFilter(name);
                  setFeedChapterFilter(''); // a chapter only means something within its book
                  setPlayingRecordingId(null);
                }}
              />
            </View>
            {selectedBookMeta && (
              <View style={filterBasis}>
                {fieldLabel('Chapter')}
                <Dropdown
                  options={chapterOptions}
                  value={feedChapterFilter}
                  title="Chapter"
                  onChange={(id) => {
                    setFeedChapterFilter(id);
                    setPlayingRecordingId(null);
                  }}
                />
              </View>
            )}
            {presentTranslations.length > 1 && (
              <View style={filterBasis}>
                {fieldLabel('Translation')}
                <Dropdown
                  options={translationOptions}
                  value={feedTranslationFilter}
                  title="Translation"
                  onChange={(id) => {
                    setFeedTranslationFilter(id);
                    setPlayingRecordingId(null);
                  }}
                />
              </View>
            )}
          </View>
        </View>

        {loadingFeedRecordings ? (
          <AppText variant="label" className="font-sans text-ink-3 text-center" style={{ paddingVertical: space(24) }}>
            Loading recordings…
          </AppText>
        ) : filtered.length === 0 ? (
          <View className="bg-surface border border-line rounded-card">
            <EmptyState
              Icon={Volume2}
              title="No recordings match"
              message="Try a wider search, or share your own: record on the Record tab and choose Circle or Public."
            />
          </View>
        ) : (
          // One card of rows, like every other list in the app. The reference
          // leads each row -- it's what you came to find -- with the person,
          // date, translation and length on the line under it.
          <View className="bg-surface border border-line rounded-card overflow-hidden">
            {filtered.map((rec, idx) => {
              const isPlaying = playingRecordingId === rec.id;
              const relation = relationFor(rec);
              const isOwn = relation?.label === 'You';
              const isSaved =
                isOwn ||
                userRecordings.some(
                  (ur) =>
                    ur.savedFromRecordingId === rec.id ||
                    ur.id === rec.id ||
                    (ur.book === rec.book && ur.chapter === rec.chapter && ur.user === rec.user && ur.translation === rec.translation)
                );
              const meta = [rec.user || 'Someone', formatDate(rec.date), translationLabel(rec.translation), formatDuration(rec.duration)]
                .filter(Boolean)
                .join(' · ');

              return (
                <View
                  key={rec.id}
                  className={`flex-row items-start ${idx > 0 ? 'border-t border-hairline' : ''}`}
                  style={{ padding: space(14), gap: space(12) }}
                >
                  {/* The person is named on the line under the reference, so
                      the avatar gives way at large text, where it left the
                      text a column too narrow for "Friend" and Save to share. */}
                  {scale < 1.3 && <Avatar name={rec.user} size={Math.round(36 * scale)} />}
                  <View className="flex-1" style={{ gap: space(6), minWidth: 0 }}>
                    <View style={{ gap: space(1) }}>
                      <AppText variant="body" className="font-sans font-semibold text-ink">
                        {recordingLabel(rec)}
                      </AppText>
                      <AppText variant="caption" className="font-sans text-ink-3">
                        {meta}
                      </AppText>
                    </View>
                    <View className="flex-row flex-wrap items-center" style={{ gap: space(8) }}>
                      {relation && <Badge label={relation.label} tone={relation.tone} />}
                      {!isOwn && (
                        <AppButton
                          size="sm"
                          variant={isSaved ? 'quiet' : 'secondary'}
                          Icon={isSaved ? Check : Plus}
                          label={isSaved ? 'Saved' : 'Save'}
                          accessibilityLabel={isSaved ? `${recordingLabel(rec)} is saved` : `Save ${recordingLabel(rec)}`}
                          onPress={() => {
                            if (isSaved) {
                              triggerToast(`${recordingLabel(rec)} is already in your recordings.`);
                              return;
                            }
                            saveSharedRecordingToLibrary(rec);
                          }}
                        />
                      )}
                    </View>
                  </View>
                  {/* Plays in place; the now-playing bar above the tabs shows
                      progress and keeps going if you leave. */}
                  <AppIconButton
                    Icon={isPlaying ? Pause : Play}
                    variant={isPlaying ? 'filled' : 'outline'}
                    diameter={38}
                    accessibilityLabel={`${isPlaying ? 'Pause' : 'Play'} ${recordingLabel(rec)}`}
                    onPress={() => {
                      if (isPlaying) {
                        setPlayingRecordingId(null);
                      } else {
                        setPlayingRecordingId(rec.id);
                        setPlayingRecProgress(0);
                      }
                    }}
                  />
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </FadeInView>
  );
}
