import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, Pause, Play } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { VerseTimestamp } from '../types';
import { FadeInView, HelpTooltip, PulseView } from '../components/ui';
import { BIBLE_TRANSLATIONS } from '../data';

// Derived from the single source of truth (data.ts) instead of its own
// separately-hardcoded lookup -- previously listed NIV/NKJV/NLT despite zero
// real text ever being imported for them, and had already drifted from
// RecordScreen's own copy of the same list (see scripts/import-bible/).
const TRANSLATION_FULL_NAMES: Record<string, string> = Object.fromEntries(
  BIBLE_TRANSLATIONS.map((t) => [t.id, t.name])
);

const WAVEFORM_HEIGHTS = [
  8, 16, 24, 12, 20, 28, 32, 16, 24, 20, 12, 24, 32, 28, 20, 16, 12, 20, 28, 24, 32, 20, 16, 24, 28,
  12, 20, 24, 32, 16, 8, 12,
];

const formatSec = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

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
      <View className="bg-indigo-600 px-1 rounded" style={{ minWidth: 16 }}>
        <Text className="text-white text-[8px] font-bold text-center">{verse}</Text>
      </View>
      <View className="w-0.5 h-3 bg-indigo-600" />
    </View>
  );
}

export default function RecordingDetailScreen({ state }: { state: AppState }) {
  const {
    selectedRecording,
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
    buildVerseTimestamps,
    selectedRecordingChapterTextData,
  } = state;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

  if (!selectedRecording) return null;

  const isPlayingThis = playingRecordingId === selectedRecording.id;
  const hasRealAudio = !!selectedRecording.audioUrl;
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

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        {/* Header / Back Button */}
        <View className="flex-row items-center justify-between border-b border-neutral-100 pb-3">
          <View className="flex-row items-center gap-3">
            <Pressable
              onPress={handleBack}
              className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
            >
              <ArrowLeft size={14} color="#262626" />
            </Pressable>
            <View>
              <Text className="text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-sans self-start">
                {selectedRecording.sourceType === 'imported' ? 'IMPORTED AUDIO' : 'CHAPTER RECITATION'}
              </Text>
              <Text className="text-base font-serif font-black text-neutral-900 leading-none mt-1">
                {selectedRecording.book} {selectedRecording.chapter}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => setShowDeleteConfirm(true)}
            className="px-2 py-1 bg-red-50 border border-red-200 rounded-lg"
          >
            <Text className="text-[9px] font-sans font-bold uppercase tracking-wider text-red-600">Delete Rec</Text>
          </Pressable>
        </View>

        {showDeleteConfirm && (
          <View className="bg-red-50 border border-red-200 rounded-xl p-3" style={{ gap: 8 }}>
            <Text className="text-[11px] font-sans font-bold text-red-800">Delete this recording?</Text>
            <Text className="text-[9px] font-sans text-red-700/80 leading-relaxed">
              The recitation for {selectedRecording.book} {selectedRecording.chapter} will be permanently removed.
              This can't be undone.
            </Text>
            <View className="flex-row gap-2 justify-end pt-1">
              <Pressable
                onPress={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 border border-neutral-300 rounded-lg bg-white"
              >
                <Text className="text-neutral-600 font-sans font-bold text-[10px]">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  setShowDeleteConfirm(false);
                  await deleteRecording(selectedRecording);
                  triggerToast(`Recitation for ${selectedRecording.book} ${selectedRecording.chapter} deleted. 🗑️`);
                  handleBack();
                }}
                className="px-3 py-1.5 bg-red-600 rounded-lg"
              >
                <Text className="text-white font-sans font-bold text-[10px]">Yes, Delete</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Recording Metadata Card */}
        <View className="border border-neutral-200 rounded-2xl p-4 bg-neutral-50/50" style={{ gap: 12 }}>
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <View style={{ width: '45%' }}>
              <Text className="text-[8px] uppercase tracking-wider text-neutral-400 font-bold font-sans">Translation</Text>
              <Text className="font-extrabold text-neutral-800 text-xs font-sans">
                {selectedRecording.translation}
                {TRANSLATION_FULL_NAMES[selectedRecording.translation] ? ` (${TRANSLATION_FULL_NAMES[selectedRecording.translation]})` : ''}
              </Text>
            </View>
            <View style={{ width: '45%' }}>
              <Text className="text-[8px] uppercase tracking-wider text-neutral-400 font-bold font-sans">Duration</Text>
              <Text className="font-extrabold text-neutral-800 text-xs font-sans">{selectedRecording.duration} seconds</Text>
            </View>
            <View style={{ width: '45%' }}>
              <Text className="text-[8px] uppercase tracking-wider text-neutral-400 font-bold font-sans">Recitation Date</Text>
              <Text className="font-extrabold text-neutral-800 text-xs font-sans">{selectedRecording.date}</Text>
            </View>
            <View style={{ width: '45%' }}>
              <Text className="text-[8px] uppercase tracking-wider text-neutral-400 font-bold font-sans">Speaker</Text>
              <Text className="font-extrabold text-neutral-800 text-xs font-sans">{selectedRecording.user || 'Me'}</Text>
            </View>
          </View>
        </View>

        {/* Playback Simulation */}
        <View className="border border-neutral-200 rounded-2xl p-4 bg-white" style={{ gap: 12 }}>
          <View className="flex-row justify-between items-center">
            <Text className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans uppercase">Audio Player</Text>
            <Text className="text-[10px] font-mono font-bold text-neutral-600">
              {isPlayingThis ? `${Math.floor((playingRecProgress / 100) * selectedRecording.duration)}s` : '0s'} /{' '}
              {selectedRecording.duration}s
            </Text>
          </View>

          {/* Animated Waveform Visualizer */}
          <View className="h-10 flex-row items-end justify-center px-1 py-2 bg-neutral-50 rounded-xl border border-neutral-100 overflow-hidden" style={{ gap: 3 }}>
            {WAVEFORM_HEIGHTS.map((h, i) => {
              const isActive = isPlayingThis && (i / 32) * 100 <= playingRecProgress;
              const bar = (
                <View
                  key={i}
                  style={{ width: 4, height: h }}
                  className={`rounded-full ${isActive ? 'bg-indigo-600 border border-indigo-700' : 'bg-neutral-200'}`}
                />
              );
              return isActive ? (
                <PulseView key={i} style={{ width: 4, height: h }}>
                  {bar}
                </PulseView>
              ) : (
                bar
              );
            })}
          </View>

          {/* Controls Bar */}
          <View className="flex-row justify-center items-center gap-4">
            <Pressable
              onPress={() => {
                if (!isPlayingThis) return;
                if (hasRealAudio) {
                  seekRecordingBy(-5);
                } else {
                  setPlayingRecProgress((prev) => Math.max(0, prev - 10));
                }
                triggerToast('Rewind 5s');
              }}
              className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
            >
              <Text className="text-[10px] font-black font-sans text-neutral-600">-5s</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                if (isPlayingThis) {
                  setPlayingRecordingId(null);
                } else {
                  setPlayingRecordingId(selectedRecording.id);
                  setPlayingRecProgress(0);
                  triggerToast('Playing chapter recitation...');
                }
              }}
              className="w-11 h-11 rounded-full bg-[#1A1A1A] items-center justify-center"
            >
              {isPlayingThis ? (
                <Pause size={18} color="#FFFFFF" />
              ) : (
                <Play size={18} color="#FFFFFF" style={{ marginLeft: 2 }} />
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                if (!isPlayingThis) return;
                if (hasRealAudio) {
                  seekRecordingBy(5);
                } else {
                  setPlayingRecProgress((prev) => Math.min(100, prev + 10));
                }
                triggerToast('Fast Forward 5s');
              }}
              className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
            >
              <Text className="text-[10px] font-black font-sans text-neutral-600">+5s</Text>
            </Pressable>
          </View>
        </View>

        {/* Verse Sync Timeline — scrub the real playback position and drop/
            drag a marker per verse, instead of typing raw MM:SS offsets. */}
        <View style={{ gap: 10 }}>
          <View className="flex-row justify-between items-center px-1">
            <View className="flex-row items-center">
              <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
                VERSE SYNC TIMELINE
              </Text>
              <HelpTooltip text="Tap the timeline (or use the player above) to scrub, then tap a verse chip to drop its marker at the current position. Drag an existing marker to fine-tune it." />
            </View>

            {!isEditingSync ? (
              <Pressable onPress={() => setIsEditingSync(true)} className="bg-[#1A1A1A] px-2 py-1 rounded">
                <Text className="text-[9px] text-white font-sans font-bold uppercase tracking-wider">Edit Sync ✎</Text>
              </Pressable>
            ) : (
              <View className="flex-row gap-1.5">
                <Pressable onPress={handleSaveSync} className="bg-emerald-600 px-2 py-1 rounded">
                  <Text className="text-[9px] text-white font-sans font-bold uppercase tracking-wider">Save ✓</Text>
                </Pressable>
                <Pressable onPress={() => setIsEditingSync(false)} className="bg-neutral-200 px-2 py-1 rounded">
                  <Text className="text-[9px] text-neutral-700 font-sans font-bold uppercase tracking-wider">Cancel</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Timeline strip */}
          <View className="bg-white border border-neutral-200 rounded-2xl p-3" style={{ gap: 8 }}>
            <Pressable
              onPress={(e) => handleTapSeek(e.nativeEvent.locationX)}
              disabled={!isEditingSync && !hasRealAudio}
            >
              <View
                ref={timelineRef}
                onLayout={handleTimelineLayout}
                className="w-full bg-neutral-100 rounded-full overflow-visible"
                style={{ height: 10, marginTop: isEditingSync ? 16 : 0 }}
              >
                <View className="bg-neutral-100 h-full rounded-full overflow-hidden">
                  <View
                    className="bg-indigo-400 h-full"
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
                        className="bg-[#1A1A1A]"
                      />
                    ))}
              </View>
            </Pressable>
            <View className="flex-row justify-between">
              <Text className="text-[8px] font-mono font-semibold text-neutral-400">00:00</Text>
              <Text className="text-[8px] font-mono font-semibold text-neutral-400">{formatSec(durationSec)}</Text>
            </View>

            {isEditingSync && (
              <>
                <Text className="text-[9px] text-neutral-400 font-sans leading-relaxed">
                  Play the audio above, then tap each verse below the instant it starts. Drag a marker on the timeline
                  to fine-tune it afterward.
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {chapterVerseNumbers.map((verse) => {
                    const isTagged = draftTaps[verse] !== undefined;
                    return (
                      <Pressable
                        key={verse}
                        onPress={() => handleTagVerse(verse)}
                        className={`px-2.5 py-1.5 rounded-lg border ${
                          isTagged ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-neutral-300'
                        }`}
                      >
                        <Text className={`text-[10px] font-bold font-mono ${isTagged ? 'text-white' : 'text-neutral-500'}`}>
                          v{verse}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            )}
          </View>

          {/* Read-only verse reference list — unchanged from before, minus
              the old text-input editing (now done via the timeline above). */}
          {!isEditingSync &&
            (!selectedRecording.verseTimestamps || selectedRecording.verseTimestamps.length === 0 ? (
              <View className="items-center p-4 bg-[#F3F2F1]/55 rounded-xl border border-dashed border-[#E5E5E5]">
                <Text className="text-xs text-[#888] text-center">
                  No verse timestamps for this recording — tap "Edit Sync" above and tag verses while listening back.
                </Text>
              </View>
            ) : (
              <View className="border border-neutral-200 rounded-2xl bg-white overflow-hidden">
                <View className="bg-neutral-50 px-3.5 py-2.5 border-b border-neutral-200 flex-row justify-between">
                  <Text className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider font-sans">Verse Reference</Text>
                  <Text className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider font-sans">Timeline Offset Segment</Text>
                </View>

                <View>
                  {selectedRecording.verseTimestamps.map((vt, idx) => (
                    <View
                      key={vt.verse}
                      className={`p-3 flex-row justify-between items-center bg-white ${
                        idx < selectedRecording.verseTimestamps!.length - 1 ? 'border-b border-neutral-100' : ''
                      }`}
                    >
                      <View style={{ maxWidth: 140 }}>
                        <Text className="font-extrabold text-[#1A1A1A] text-xs font-sans">Verse {vt.verse}</Text>
                        <Text className="text-[9px] text-neutral-400 mt-0.5" numberOfLines={1} ellipsizeMode="tail">
                          {selectedRecordingChapterTextData?.verses[String(vt.verse)] ?? ''}
                        </Text>
                      </View>

                      <Pressable
                        onPress={() => {
                          if (hasRealAudio) {
                            seekRecordingToTime(selectedRecording, vt.startSec);
                            triggerToast(`Jumping to Verse ${vt.verse}...`);
                          } else {
                            triggerToast(`Playing segment for Verse ${vt.verse} (${formatSec(vt.startSec)} - ${formatSec(vt.endSec)})`);
                          }
                        }}
                        className="bg-neutral-100 px-2.5 py-1 rounded border border-neutral-200"
                      >
                        <Text className="font-mono font-bold text-[#1A1A1A] text-xs">
                          {formatSec(vt.startSec)} - {formatSec(vt.endSec)} 🔊
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            ))}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
