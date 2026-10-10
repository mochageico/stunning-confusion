import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, View } from 'react-native';
import { Check, Download, Pause, Play, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { VerseTimestamp } from '../types';
import { FadeInView } from '../components/ui';
import { BIBLE_TRANSLATIONS, translationLabel } from '../data';
import { recordingLabel, recordingMeta } from '../lib/recordingLabel';
import { cacheableTarget } from '../lib/audioCache';
import { hasPlayableAudio, hasStudioAudio, studioStatusLabel } from '../lib/studioAudio';
import { AppButton, AppIconButton, AppTextInput, AppText, MIN_TOUCH, useScaledSpace } from '../components/design';
import { Dialog, EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader, SegmentedControl } from '../components/blocks';
import { formatDate, formatDuration } from '../lib/format';

// Derived from the single source of truth (data.ts) instead of its own
// separately-hardcoded lookup -- previously listed NIV/NKJV/NLT despite zero
// real text ever being imported for them, and had already drifted from
// RecordScreen's own copy of the same list (see scripts/import-bible/).
const TRANSLATION_FULL_NAMES: Record<string, string> = Object.fromEntries(
  BIBLE_TRANSLATIONS.map((t) => [t.id, t.name])
);

// This page opens from more than one place, so the back link names whichever
// one you came from.
const BACK_LABELS: Partial<Record<string, string>> = {
  record: 'Record',
  profile: 'Profile',
  chapterLanding: 'Chapter',
  audioFeed: 'Recordings',
  myRecordings: 'Your recordings',
};

const WAVEFORM_HEIGHTS = [
  8, 16, 24, 12, 20, 28, 32, 16, 24, 20, 12, 24, 32, 28, 20, 16, 12, 20, 28, 24, 32, 20, 16, 24, 28,
  12, 20, 24, 32, 16, 8, 12,
];

const formatSec = (sec: number) => formatDuration(sec, 'clock');

// Draggable pin on the timeline for one verse's start marker. Bounds/callbacks
// are threaded through refs (updated every render, read inside the
// PanResponder's own callbacks) rather than closed over directly — the
// PanResponder instance itself is created exactly once via useRef, so a
// plain closure over changing props/state would go stale after the first
// render and the marker would drag using outdated neighbor bounds.
function DraggableMarker({
  verse,
  leftPercent,
  minSec,
  maxSec,
  durationSec,
  timelineWidthRef,
  timelinePageXRef,
  onDrag,
}: {
  verse: number;
  leftPercent: number;
  minSec: number;
  maxSec: number;
  durationSec: number;
  timelineWidthRef: React.MutableRefObject<number>;
  timelinePageXRef: React.MutableRefObject<number>;
  onDrag: (verse: number, sec: number) => void;
}) {
  const boundsRef = useRef({ minSec, maxSec, durationSec });
  boundsRef.current = { minSec, maxSec, durationSec };
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_evt, gestureState) => {
        const width = timelineWidthRef.current;
        if (width <= 0) return;
        const { minSec, maxSec, durationSec } = boundsRef.current;
        const fraction = Math.max(0, Math.min(1, (gestureState.moveX - timelinePageXRef.current) / width));
        const sec = Math.max(minSec, Math.min(maxSec, fraction * durationSec));
        onDragRef.current(verse, sec);
      },
    })
  ).current;

  return (
    <View
      {...panResponder.panHandlers}
      style={{ position: 'absolute', left: `${leftPercent}%`, top: -14, transform: [{ translateX: -9 }], width: 18 }}
      className="items-center"
    >
      <View className="bg-accent px-1 rounded" style={{ minWidth: 16 }}>
        <AppText variant="micro" className="text-on-accent font-sans font-semibold text-center">{verse}</AppText>
      </View>
      <View className="w-0.5 h-3 bg-accent" />
    </View>
  );
}

export default function RecordingDetailScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const {
    selectedRecording,
    backHistory,
    handleBack,
    deleteRecording,
    triggerToast,
    playingRecordingId,
    setPlayingRecordingId,
    playingRecProgress,
    setPlayingRecProgress,
    seekRecordingBy,
    seekRecordingToTime,
    isEditingSync,
    setIsEditingSync,
    saveVerseSyncOffsets,
    updateRecordingSpeaker,
    buildVerseTimestamps,
    selectedRecordingChapterTextData,
    studioPlaybackEnabled,
    studioAbOverride,
    setStudioAbOverride,
    audioCache,
    downloadingRecordingIds,
    saveRecordingOffline,
    removeRecordingDownload,
  } = state;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Local edit-in-place state for the Speaker metadata cell — not seeded
  // until the user actually taps in to edit, so navigating between
  // recordings never carries a stale draft into a fresh one.
  const [isEditingSpeaker, setIsEditingSpeaker] = useState(false);
  const [speakerDraft, setSpeakerDraft] = useState('');
  // Draft marker positions (verse -> start seconds) for the editing session.
  // Local to this screen -- there's no reason this scratch state needs to
  // survive navigating away and back, unlike the recording data itself.
  const [draftTaps, setDraftTaps] = useState<Record<number, number>>({});
  // Which verses' positions are "real" (deliberately tapped or dragged in
  // THIS editing session) versus a placeholder buildVerseTimestamps filled
  // in for a verse nobody ever tapped (see its own comment on the "cursor"
  // fallback). Only confirmed verses act as drag-bound neighbors -- see
  // getBounds below.
  //
  // Deliberately starts empty on every fresh edit, rather than trying to
  // infer which SAVED verses were real taps vs placeholders: that turns out
  // to be undecidable from buildVerseTimestamps's output alone (a genuinely
  // untapped last verse in the chapter always ends up with a non-degenerate
  // span purely from being at the edge of the array, indistinguishable from
  // a real tap by any simple rule on the saved numbers). The cost is that
  // dragging one marker on an already-well-tagged recording won't initially
  // respect its OTHER already-good neighbors as bounds until they're also
  // touched this session -- an acceptable trade for never producing a
  // marker that's stuck immovable against a neighbor nobody actually placed.
  const [confirmedVerses, setConfirmedVerses] = useState<Set<number>>(new Set());
  const timelineWidthRef = useRef(0);
  const timelinePageXRef = useRef(0);
  const timelineRef = useRef<View>(null);

  // Seed the draft from the recording's saved timestamps every time editing
  // starts (or a different recording is opened) -- not on every render. Must
  // stay above the `!selectedRecording` early return below: hooks can't be
  // conditional on that check, only their body can (see PracticeModals.tsx
  // for the same pattern/reasoning).
  useEffect(() => {
    if (!isEditingSync || !selectedRecording) return;
    const seeded: Record<number, number> = {};
    (selectedRecording.verseTimestamps || []).forEach((vt) => {
      seeded[vt.verse] = vt.startSec;
    });
    setDraftTaps(seeded);
    setConfirmedVerses(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditingSync, selectedRecording?.id]);

  // The A/B override belongs to this screen's comparison session only. Without
  // this, choosing "Original" here would silently keep overriding the global
  // Studio Mode setting everywhere else in the app until the next relaunch.
  useEffect(() => {
    return () => setStudioAbOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!selectedRecording) return null;

  const isPlayingThis = playingRecordingId === selectedRecording.id;
  const hasRealAudio = hasPlayableAudio(selectedRecording);
  // null override == follow the global Studio Mode setting, so the switch
  // opens showing whichever version is actually about to play.
  const studioAbActive = studioAbOverride ?? studioPlaybackEnabled;
  const studioLabel = studioStatusLabel(selectedRecording);

  // Offline download state. Keyed off the PERSISTED studio preference, not the
  // A/B override, so flipping the switch to compare takes doesn't make the
  // download button flicker between "saved" and "not saved".
  const offlineTarget = cacheableTarget(selectedRecording, studioPlaybackEnabled);
  const isDownloaded = !!offlineTarget && audioCache.pinned.has(offlineTarget.storagePath);
  const isDownloading = downloadingRecordingIds.has(selectedRecording.id);

  const durationSec = selectedRecording.duration;
  const currentPlaybackSec = isPlayingThis ? Math.floor((playingRecProgress / 100) * durationSec) : 0;

  // Every verse in this chapter, for the tap-to-tag chip row -- falls back to
  // whatever verses already have a saved timestamp if the chapter text isn't
  // loaded (e.g. a translation without real text yet).
  const chapterVerseNumbers = selectedRecordingChapterTextData
    ? Object.keys(selectedRecordingChapterTextData.verses).map(Number).sort((a, b) => a - b)
    : (selectedRecording.verseTimestamps || []).map((vt) => vt.verse).sort((a, b) => a - b);

  const taggedVerseNumbers = Object.keys(draftTaps).map(Number).sort((a, b) => a - b);

  // A marker's drag range is bounded by its nearest CONFIRMED neighbor on
  // each side, walking past any unconfirmed ones in between -- not simply
  // the adjacent array entry. buildVerseTimestamps fills every untapped
  // verse with a placeholder at whatever the running cursor was (see its
  // own comment), so several verses in a row can share a saved start time
  // despite none of them having been deliberately tagged (most visibly: an
  // entire never-tagged recording defaults EVERY verse to 0). Bounding
  // against an unconfirmed neighbor would pin a marker in place the instant
  // it's adjacent to any of those placeholders, regardless of how far it's
  // dragged -- skipping past them keeps the constraint meaningful (never
  // cross a verse the user actually placed) without it locking onto data
  // nobody set on purpose.
  const getBounds = (idx: number) => {
    let minSec = 0;
    for (let i = idx - 1; i >= 0; i--) {
      const v = taggedVerseNumbers[i];
      if (confirmedVerses.has(v)) {
        minSec = draftTaps[v] + 0.5;
        break;
      }
    }
    let maxSec = durationSec;
    for (let i = idx + 1; i < taggedVerseNumbers.length; i++) {
      const v = taggedVerseNumbers[i];
      if (confirmedVerses.has(v)) {
        maxSec = draftTaps[v] - 0.5;
        break;
      }
    }
    return { minSec: Math.max(0, minSec), maxSec: Math.min(durationSec, Math.max(minSec, maxSec)) };
  };

  const handleTimelineLayout = () => {
    timelineRef.current?.measure((_x, _y, width, _height, pageX) => {
      timelineWidthRef.current = width;
      timelinePageXRef.current = pageX;
    });
  };

  const handleTapSeek = (locationX: number) => {
    const width = timelineWidthRef.current;
    if (width <= 0) return;
    const fraction = Math.max(0, Math.min(1, locationX / width));
    const sec = fraction * durationSec;
    if (hasRealAudio) {
      seekRecordingToTime(selectedRecording, sec);
    } else if (isPlayingThis) {
      setPlayingRecProgress(fraction * 100);
    }
  };

  const handleTagVerse = (verse: number) => {
    setDraftTaps((prev) => ({ ...prev, [verse]: currentPlaybackSec }));
    setConfirmedVerses((prev) => (prev.has(verse) ? prev : new Set(prev).add(verse)));
  };

  const handleDragMarker = (verse: number, sec: number) => {
    setDraftTaps((prev) => ({ ...prev, [verse]: sec }));
    setConfirmedVerses((prev) => (prev.has(verse) ? prev : new Set(prev).add(verse)));
  };

  const handleSaveSync = async () => {
    setIsEditingSync(false);
    // buildVerseTimestamps assumes its tap map is already in increasing
    // verse-number order (each real tap happens later in the recording than
    // the last) -- that's true of a fresh live/import tagging session, but
    // draftTaps here can also carry old, never-really-adjusted placeholder
    // values from a prior save (see the seeding effect above). Passing a
    // non-monotonic value straight through can make a verse's computed end
    // land BEFORE its own start (e.g. a dragged verse followed by an old
    // untouched placeholder that's numerically smaller). Filtering to a
    // strictly-increasing subsequence first guarantees that can't happen --
    // any tap that would go backwards is dropped and that verse instead
    // inherits the cursor, exactly as if it had never been tapped at all.
    const monotonicTaps: Record<number, number> = {};
    let cursor = -1;
    taggedVerseNumbers.forEach((verse) => {
      const sec = draftTaps[verse];
      if (sec > cursor) {
        monotonicTaps[verse] = sec;
        cursor = sec;
      }
    });
    const verseTimestamps: VerseTimestamp[] = buildVerseTimestamps(chapterVerseNumbers, monotonicTaps, durationSec);
    await saveVerseSyncOffsets(verseTimestamps);
  };

  const recLabel = recordingLabel(selectedRecording);
  const prevScreen = backHistory[backHistory.length - 1]?.screen;
  const tabular = { fontVariant: ['tabular-nums' as const] };

  const seekBy = (delta: number) => {
    if (!isPlayingThis) return;
    if (hasRealAudio) seekRecordingBy(delta);
    else setPlayingRecProgress((prev) => Math.max(0, Math.min(100, prev + (delta > 0 ? 10 : -10))));
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title={recLabel}
          eyebrow={selectedRecording.sourceType === 'imported' ? 'Imported audio' : undefined}
          subtitle={recordingMeta({ ...selectedRecording, sourceType: undefined })}
          onBack={handleBack}
          backLabel={(prevScreen && BACK_LABELS[prevScreen]) || 'Back'}
        />

        {/* PLAYER. One filled button -- play -- and quiet skips either side. */}
        <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
          <View className="flex-row items-end justify-center overflow-hidden" style={{ height: space(40), gap: 3 }}>
            {WAVEFORM_HEIGHTS.map((h, i) => {
              const isActive = isPlayingThis && (i / 32) * 100 <= playingRecProgress;
              // layout-ok: waveform bars hold no text.
              return <View key={i} style={{ width: 4, height: h }} className={`rounded-full ${isActive ? 'bg-accent' : 'bg-fill'}`} />;
            })}
          </View>
          <View className="flex-row justify-between">
            <AppText variant="caption" className="font-sans text-ink-3" style={tabular}>
              {formatSec(currentPlaybackSec)}
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-3" style={tabular}>
              {formatSec(durationSec)}
            </AppText>
          </View>
          <View className="flex-row items-center justify-center" style={{ gap: space(16) }}>
            <AppButton size="sm" variant="quiet" label="−5s" accessibilityLabel="Back 5 seconds" disabled={!isPlayingThis} onPress={() => seekBy(-5)} />
            <AppIconButton
              Icon={isPlayingThis ? Pause : Play}
              variant="filled"
              diameter={52}
              accessibilityLabel={isPlayingThis ? 'Pause' : 'Play'}
              onPress={() => {
                if (isPlayingThis) {
                  setPlayingRecordingId(null);
                } else {
                  setPlayingRecordingId(selectedRecording.id);
                  setPlayingRecProgress(0);
                }
              }}
            />
            <AppButton size="sm" variant="quiet" label="+5s" accessibilityLabel="Forward 5 seconds" disabled={!isPlayingThis} onPress={() => seekBy(5)} />
          </View>

          {/* Studio A/B -- only once a processed render exists. While it's
              still being made, the status shows instead, so the missing
              switch doesn't read as a missing feature. */}
          {studioLabel &&
            (hasStudioAudio(selectedRecording) ? (
              <SegmentedControl
                value={studioAbActive ? 'studio' : 'original'}
                onChange={(id) => setStudioAbOverride(id === 'studio')}
                accessibilityLabel="Which version plays"
                options={[
                  { id: 'studio', label: 'Studio' },
                  { id: 'original', label: 'Original' },
                ]}
              />
            ) : (
              <AppText variant="caption" className="font-sans text-ink-3 text-center">
                {studioLabel}
              </AppText>
            ))}

          {/* Offline download. Only once there's a settled version: while a
              studio render is processing, whichever file we saved would be
              superseded minutes later. */}
          {offlineTarget && (
            <View className="items-center">
              <AppButton
                size="sm"
                variant="quiet"
                Icon={isDownloaded ? Trash2 : Download}
                label={isDownloading ? 'Downloading…' : isDownloaded ? 'Remove download' : 'Save offline'}
                disabled={isDownloading}
                onPress={() => (isDownloaded ? removeRecordingDownload(selectedRecording) : saveRecordingOffline(selectedRecording))}
              />
            </View>
          )}
        </View>

        {/* DETAILS */}
        <GroupedList header="Details">
          <ListRow
            title="Translation"
            value={TRANSLATION_FULL_NAMES[selectedRecording.translation] || selectedRecording.translation}
          />
          <ListRow title="Length" value={formatDuration(durationSec, 'words')} />
          <ListRow title="Recorded" value={formatDate(selectedRecording.date, 'long')} />
          <ListRow
            title="Speaker"
            value={selectedRecording.user || 'Me'}
            onPress={() => {
              setSpeakerDraft(selectedRecording.user || 'Me');
              setIsEditingSpeaker(true);
            }}
          />
        </GroupedList>

        {/* VERSE TIMING -- scrub the real playback position and drop or drag
            a marker per verse, instead of typing raw offsets. */}
        <View style={{ gap: space(6) }}>
          <SectionHeader
            title="Verse timing"
            actionLabel={isEditingSync ? undefined : 'Edit'}
            onAction={isEditingSync ? undefined : () => setIsEditingSync(true)}
          />

          <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
            <Pressable onPress={(e) => handleTapSeek(e.nativeEvent.locationX)} disabled={!isEditingSync && !hasRealAudio}>
              <View
                ref={timelineRef}
                onLayout={handleTimelineLayout}
                className="w-full bg-fill rounded-full overflow-visible"
                // layout-ok: the track holds no text; markers sit above it.
                style={{ height: 8, marginTop: isEditingSync ? 18 : 0 }}
              >
                <View className="h-full rounded-full overflow-hidden">
                  <View
                    className="bg-accent h-full"
                    style={{ width: `${durationSec > 0 ? Math.min(100, (currentPlaybackSec / durationSec) * 100) : 0}%` }}
                  />
                </View>
                {isEditingSync
                  ? taggedVerseNumbers.map((verse, idx) => {
                      const { minSec, maxSec } = getBounds(idx);
                      return (
                        <DraggableMarker
                          key={verse}
                          verse={verse}
                          leftPercent={durationSec > 0 ? (draftTaps[verse] / durationSec) * 100 : 0}
                          minSec={minSec}
                          maxSec={maxSec}
                          durationSec={durationSec}
                          timelineWidthRef={timelineWidthRef}
                          timelinePageXRef={timelinePageXRef}
                          onDrag={handleDragMarker}
                        />
                      );
                    })
                  : (selectedRecording.verseTimestamps || []).map((vt) => (
                      <View
                        key={vt.verse}
                        style={{
                          position: 'absolute',
                          left: `${durationSec > 0 ? (vt.startSec / durationSec) * 100 : 0}%`,
                          top: 0,
                          height: '100%',
                          width: 2,
                        }}
                        className="bg-ink-3"
                      />
                    ))}
              </View>
            </Pressable>
            <View className="flex-row justify-between">
              <AppText variant="caption" className="font-sans text-ink-3" style={tabular}>
                {formatSec(0)}
              </AppText>
              <AppText variant="caption" className="font-sans text-ink-3" style={tabular}>
                {formatSec(durationSec)}
              </AppText>
            </View>

            {isEditingSync && (
              <>
                <AppText variant="caption" className="font-sans text-ink-2">
                  Play the recording above and tap each verse the moment it starts. Drag a marker on the line to
                  fine-tune it.
                </AppText>
                {chapterVerseNumbers.length === 0 && (
                  <AppText variant="caption" className="font-sans text-warning">
                    This chapter's text isn't available in {translationLabel(selectedRecording.translation)} yet, so there are no verses
                    to mark.
                  </AppText>
                )}
                <View className="flex-row flex-wrap" style={{ gap: space(6) }}>
                  {chapterVerseNumbers.map((verse) => {
                    const isTagged = draftTaps[verse] !== undefined;
                    return (
                      <Pressable
                        key={verse}
                        onPress={() => handleTagVerse(verse)}
                        accessibilityRole="button"
                        accessibilityLabel={`Mark verse ${verse} here`}
                        className={`items-center justify-center rounded-btn border ${
                          isTagged ? 'bg-accent border-accent' : 'bg-surface border-line-strong active:bg-surface-2'
                        }`}
                        style={{ minWidth: space(40), minHeight: space(36), paddingHorizontal: space(8) }}
                      >
                        <AppText
                          variant="label"
                          className={`font-sans font-semibold ${isTagged ? 'text-on-accent' : 'text-ink-2'}`}
                          style={tabular}
                        >
                          {verse}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
                <View className="flex-row justify-end" style={{ gap: space(8) }}>
                  <AppButton size="sm" variant="quiet" label="Cancel" onPress={() => setIsEditingSync(false)} />
                  <AppButton size="sm" variant="primary" Icon={Check} label="Save timing" onPress={handleSaveSync} />
                </View>
              </>
            )}
          </View>

          {/* Each verse's slot, tappable to jump there. */}
          {!isEditingSync &&
            (!selectedRecording.verseTimestamps || selectedRecording.verseTimestamps.length === 0 ? (
              <View className="bg-surface border border-line rounded-card">
                <EmptyState
                  title="No verse timing yet"
                  message="Tap Edit, play the recording, and tap each verse as it starts. Then any verse can be played on its own."
                />
              </View>
            ) : (
              <View className="bg-surface border border-line rounded-card overflow-hidden">
                {selectedRecording.verseTimestamps.map((vt, idx) => (
                  <View
                    key={vt.verse}
                    className={`flex-row items-center ${idx > 0 ? 'border-t border-hairline' : ''}`}
                    style={{ paddingLeft: space(14), paddingRight: space(8), paddingVertical: space(10), gap: space(10) }}
                  >
                    <View className="flex-1" style={{ gap: space(1), minWidth: 0 }}>
                      <AppText variant="label" className="font-sans font-semibold text-ink">
                        Verse {vt.verse}
                      </AppText>
                      <AppText variant="caption" className="font-serif text-ink-3" numberOfLines={1}>
                        {selectedRecordingChapterTextData?.verses[String(vt.verse)] ?? ''}
                      </AppText>
                    </View>
                    <AppButton
                      size="sm"
                      variant="quiet"
                      Icon={Play}
                      label={formatSec(vt.startSec)}
                      accessibilityLabel={`Play from verse ${vt.verse}`}
                      onPress={() => {
                        if (hasRealAudio) seekRecordingToTime(selectedRecording, vt.startSec);
                        else triggerToast(`Verse ${vt.verse} runs ${formatSec(vt.startSec)} to ${formatSec(vt.endSec)}.`);
                      }}
                    />
                  </View>
                ))}
              </View>
            ))}
        </View>

        {/* Delete at the foot, as a destructive row, rather than a red caps
            button beside the title that ran off the screen at 1.5x. */}
        <GroupedList>
          <ListRow title="Delete recording" destructive accessory="none" onPress={() => setShowDeleteConfirm(true)} />
        </GroupedList>
      </ScrollView>

      <Dialog
        visible={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete this recording?"
        message={`Your recitation of ${recLabel} will be removed for good. This can't be undone.`}
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setShowDeleteConfirm(false)} />
            <AppButton
              variant="destructive"
              label="Delete"
              onPress={async () => {
                setShowDeleteConfirm(false);
                await deleteRecording(selectedRecording);
                triggerToast(`Deleted ${recLabel}.`);
                handleBack();
              }}
            />
          </>
        }
      />

      {/* The speaker's name, edited in a small dialog rather than an inline
          field squeezed into half a grid cell. */}
      <Dialog
        visible={isEditingSpeaker}
        onClose={() => setIsEditingSpeaker(false)}
        title="Who's speaking?"
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setIsEditingSpeaker(false)} />
            <AppButton
              variant="primary"
              label="Save"
              disabled={!speakerDraft.trim()}
              onPress={() => {
                setIsEditingSpeaker(false);
                updateRecordingSpeaker(selectedRecording, speakerDraft.trim());
              }}
            />
          </>
        }
      >
        <AppTextInput
          value={speakerDraft}
          onChangeText={setSpeakerDraft}
          autoFocus
          variant="body"
          accessibilityLabel="Speaker"
          className="w-full bg-surface border border-line rounded-btn font-sans text-ink"
          style={{ minHeight: MIN_TOUCH, paddingHorizontal: space(12), paddingVertical: space(10) }}
        />
      </Dialog>
    </FadeInView>
  );
}
