import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, MoreHorizontal, Pause, Play, Plus, Search, UserPlus, Users, Volume2, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { Recording } from '../types';
import { FadeInView } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { Dropdown } from '../components/Dropdown';
import { BIBLE_TRANSLATIONS, getBookByName, translationLabel } from '../data';
import { recordingLabel } from '../lib/recordingLabel';
import { formatDate, formatDuration } from '../lib/format';
import { AppButton, AppIconButton, AppTextInput, AppText, useFontScale, useScaledSpace } from '../components/design';
import { Avatar, Badge, EmptyState, ScreenHeader, type BadgeTone } from '../components/blocks';
import { useThemeColors } from '../components/theme';
import { Dialog } from '../components/blocks';
import { BlockConfirmDialog, ReportSheet } from '../components/chat/ReportSheet';

// Opens from Today and from a chapter's page; the back link names which.
const BACK_LABELS: Partial<Record<string, string>> = {
  home: 'Today',
  chapterLanding: 'Chapter',
};

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
    myCircles,
    saveSharedRecordingToLibrary,
    setSelectedRecording,
    navigateTo,
    selectTab,
    triggerToast,
  } = state;

  // Whose recordings to show: '' is everyone you know, else one sharer's key
  // (their uid; the guest-preview mock feed has names only).
  const [personFilter, setPersonFilter] = useState('');

  // Report / block a recording's owner (App Store 1.2: anything people post
  // must be reportable, and its author blockable).
  const [menuFor, setMenuFor] = useState<Recording | null>(null);
  const [reportFor, setReportFor] = useState<Recording | null>(null);
  const [blockFor, setBlockFor] = useState<Recording | null>(null);


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

  // 1. Filter by person. The feed only ever holds recordings from friends
  // and circle co-members (sharedRecordings is queried by sharedWithUids),
  // so there's no "everyone" tier to pick -- just one person or all of them.
  const friendUids = new Set(friends.map((f) => f.uid));
  const circleUids = new Set(circleFriends.map((f) => f.uid));
  const personKey = (r: Recording) => r.userId || r.user || '';
  const sharers = Array.from(
    new Map(
      feedRecordings
        .filter((r) => personKey(r) && personKey(r) !== user?.uid)
        .map((r) => [personKey(r), r.user || 'Someone'] as const)
    )
  ).map(([key, name]) => ({ key, name }));
  let filtered = personFilter ? feedRecordings.filter((r) => personKey(r) === personFilter) : feedRecordings;

  // Signed in with nobody to hear from: the feed can only ever be empty, so
  // the screen explains why instead of showing search and filters.
  const knowsNobody = !!user && friends.length === 0 && myCircles.length === 0;
  const sourceLine = (() => {
    const parts = [
      friends.length > 0 ? `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}` : '',
      myCircles.length > 0 ? `${myCircles.length} ${myCircles.length === 1 ? 'circle' : 'circles'}` : '',
    ].filter(Boolean);
    return parts.length ? `Readings shared by your ${parts.join(' and ')}.` : 'Readings shared by your friends and circles.';
  })();

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
          subtitle={knowsNobody ? undefined : sourceLine}
          onBack={handleBack}
          backLabel={(prevScreen && BACK_LABELS[prevScreen]) || 'Back'}
        />

        {knowsNobody ? (
          <View className="bg-surface border border-line rounded-card" style={{ padding: space(20), gap: space(14) }}>
            <View className="bg-fill rounded-full items-center justify-center" style={{ width: space(56), height: space(56) }}>
              <Users size={Math.round(26 * scale)} color={palette.accent} />
            </View>
            <AppText variant="title" className="font-sans font-semibold text-ink">
              Recordings come from people you know
            </AppText>
            <AppText variant="body" className="font-sans text-ink-2">
              You'll hear chapters read aloud by your friends and the people in your scripture circles. Nobody else can see them, and nobody else
              sees yours.
            </AppText>
            <View style={{ gap: space(8) }}>
              {[
                'Add a friend or join a circle',
                'Their shared readings show up here',
                'Save one, and it plays for that chapter in Coming up next',
              ].map((step, i) => (
                <View key={step} className="flex-row" style={{ gap: space(10) }}>
                  <AppText variant="body" className="font-sans font-bold text-accent">
                    {i + 1}
                  </AppText>
                  <AppText variant="body" className="font-sans text-ink flex-1">
                    {step}
                  </AppText>
                </View>
              ))}
            </View>
            <View style={{ gap: space(8) }}>
              <AppButton variant="primary" Icon={UserPlus} label="Invite a friend" onPress={() => navigateTo('findFriends')} />
              <AppButton variant="secondary" Icon={Users} label="Find a circle" onPress={() => selectTab('community')} />
            </View>
            <AppText variant="caption" className="font-sans text-ink-3">
              Meanwhile, record a chapter yourself on the Record tab. Your own readings always play for you.
            </AppText>
          </View>
        ) : (
        <>
        {sharers.length > 0 && (
          <View className="bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(10) }}>
            <View className="flex-row items-center justify-between">
              <AppText variant="caption" className="font-sans font-medium text-ink-2">
                Shared with you by
              </AppText>
              <Pressable onPress={() => navigateTo('findFriends')} hitSlop={10} accessibilityRole="button">
                <AppText variant="caption" className="font-sans font-semibold text-accent">
                  Add people
                </AppText>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(12) }}>
              {[{ key: '', name: 'Everyone' }, ...sharers].map((p) => {
                const on = personFilter === p.key;
                return (
                  <Pressable
                    key={p.key || 'all'}
                    onPress={() => {
                      setPersonFilter(p.key);
                      setPlayingRecordingId(null);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={p.key ? `Only ${p.name}` : 'Everyone you know'}
                    className="items-center"
                    style={{ gap: space(4), opacity: on ? 1 : 0.6 }}
                  >
                    {p.key ? (
                      <Avatar name={p.name} size={Math.round(44 * scale)} ring={on} />
                    ) : (
                      <View className="bg-accent rounded-full items-center justify-center" style={{ width: Math.round(44 * scale), height: Math.round(44 * scale) }}>
                        <Users size={Math.round(20 * scale)} color={palette.onAccent} />
                      </View>
                    )}
                    <AppText variant="caption" className={`font-sans ${on ? 'font-semibold text-ink' : 'text-ink-2'}`} numberOfLines={1}>
                      {p.key ? p.name.split(' ')[0] : 'Everyone'}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

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
              message={
                feedRecordings.length === 0
                  ? "Your friends and circles haven't shared a reading yet. Share your own: record on the Record tab and choose Friends & Circles."
                  : 'Try a wider search, or share your own: record on the Record tab and choose Friends & Circles.'
              }
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
                    {/* Tap the reference for the recording's page: its verse
                        timing, who read it, and (once saved) your own timing. */}
                    <Pressable
                      style={{ gap: space(1) }}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${recordingLabel(rec)}`}
                      onPress={() => {
                        setSelectedRecording(rec);
                        navigateTo('recordingDetail');
                      }}
                    >
                      <AppText variant="body" className="font-sans font-semibold text-ink">
                        {recordingLabel(rec)}
                      </AppText>
                      <AppText variant="caption" className="font-sans text-ink-3">
                        {meta}
                      </AppText>
                    </Pressable>
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
                  {!isOwn && ownerUidOf(rec) ? (
                    <AppIconButton
                      Icon={MoreHorizontal}
                      variant="bare"
                      diameter={38}
                      accessibilityLabel={`More about ${recordingLabel(rec)}`}
                      onPress={() => setMenuFor(rec)}
                    />
                  ) : null}
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
        <AppText variant="caption" className="font-sans text-ink-3 text-center">
          Only your friends and circles hear what you share, and you only hear theirs.
        </AppText>
        </>
        )}
      </ScrollView>

      <Dialog visible={!!menuFor} onClose={() => setMenuFor(null)} placement="sheet" title={menuFor ? recordingLabel(menuFor) : ''}>
        <View style={{ gap: space(8) }}>
          <AppButton
            variant="secondary"
            label="Report recording"
            onPress={() => {
              setReportFor(menuFor);
              setMenuFor(null);
            }}
          />
          <AppButton
            variant="destructive"
            label={`Block ${(menuFor?.user || 'this person').split(' ')[0]}`}
            onPress={() => {
              setBlockFor(menuFor);
              setMenuFor(null);
            }}
          />
        </View>
      </Dialog>
      <ReportSheet
        visible={!!reportFor}
        title="Report recording"
        subjectName={reportFor?.user?.split(' ')[0]}
        onClose={() => setReportFor(null)}
        onSubmit={async ({ reason, note, alsoBlock }) => {
          if (!reportFor) return;
          await state.reportContent({
            kind: 'recording',
            targetUid: ownerUidOf(reportFor) || undefined,
            targetPath: `sharedRecordings/${reportFor.id}`,
            contentSnapshot: `${recordingLabel(reportFor)} · ${reportFor.audioUrl || ''}`,
            reason,
            note,
          });
          const owner = ownerUidOf(reportFor);
          if (alsoBlock && owner) await state.blockUser(owner, reportFor.user || 'Someone');
        }}
      />
      <BlockConfirmDialog
        visible={!!blockFor}
        name={(blockFor?.user || 'this person').split(' ')[0]}
        onClose={() => setBlockFor(null)}
        onConfirm={() => {
          const owner = blockFor && ownerUidOf(blockFor);
          if (owner) state.blockUser(owner, blockFor?.user || 'Someone');
        }}
      />
    </FadeInView>
  );
}

/** Who posted a shared recording: sharedRecordings docs always carry ownerId; userId is usually there too. */
const ownerUidOf = (rec: Recording): string | null => rec.userId || (rec as Recording & { ownerId?: string }).ownerId || null;
