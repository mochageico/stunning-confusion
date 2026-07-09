import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Pause, Play } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, HelpTooltip, PulseView } from '../components/ui';

const TRANSLATION_FULL_NAMES: Record<string, string> = {
  ESV: 'English Standard Version',
  NIV: 'New International Version',
  NKJV: 'New King James Version',
  NLT: 'New Living Translation',
};

const WAVEFORM_HEIGHTS = [
  8, 16, 24, 12, 20, 28, 32, 16, 24, 20, 12, 24, 32, 28, 20, 16, 12, 20, 28, 24, 32, 20, 16, 24, 28,
  12, 20, 24, 32, 16, 8, 12,
];

function toSeconds(mmss: string): number {
  const parts = mmss.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
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
    recSyncOffsets,
    setRecSyncOffsets,
    saveVerseSyncOffsets,
    selectedRecordingChapterTextData,
  } = state;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!selectedRecording) return null;

  const isPlayingThis = playingRecordingId === selectedRecording.id;
  const hasRealAudio = !!selectedRecording.audioUrl;

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
                CHAPTER RECITATION
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

        {/* Sync Verification Panel */}
        <View style={{ gap: 10 }}>
          <View className="flex-row justify-between items-center px-1">
            <View className="flex-row items-center">
              <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
                VERSE AUDIO-SYNC MATRIX
              </Text>
              <HelpTooltip text="Align your spoken recitation with individual verses. Correcting these timestamps will sync drill sessions perfectly." />
            </View>

            {!isEditingSync ? (
              <Pressable
                onPress={() => setIsEditingSync(true)}
                className="bg-[#1A1A1A] px-2 py-1 rounded"
              >
                <Text className="text-[9px] text-white font-sans font-bold uppercase tracking-wider">Edit Sync ✎</Text>
              </Pressable>
            ) : (
              <View className="flex-row gap-1.5">
                <Pressable
                  onPress={async () => {
                    setIsEditingSync(false);
                    await saveVerseSyncOffsets();
                  }}
                  className="bg-emerald-600 px-2 py-1 rounded"
                >
                  <Text className="text-[9px] text-white font-sans font-bold uppercase tracking-wider">Save ✓</Text>
                </Pressable>
                <Pressable
                  onPress={() => setIsEditingSync(false)}
                  className="bg-neutral-200 px-2 py-1 rounded"
                >
                  <Text className="text-[9px] text-neutral-700 font-sans font-bold uppercase tracking-wider">Cancel</Text>
                </Pressable>
              </View>
            )}
          </View>

          {recSyncOffsets.length === 0 ? (
            <View className="items-center p-4 bg-[#F3F2F1]/55 rounded-xl border border-dashed border-[#E5E5E5]">
              <Text className="text-xs text-[#888] text-center">
                No verse timestamps for this recording — tap each verse number as you reach it next time you record this
                chapter, and they'll show up here automatically.
              </Text>
            </View>
          ) : (
          <View className="border border-neutral-200 rounded-2xl bg-white overflow-hidden">
            <View className="bg-neutral-50 px-3.5 py-2.5 border-b border-neutral-200 flex-row justify-between">
              <Text className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider font-sans">Verse Reference</Text>
              <Text className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider font-sans">Timeline Offset Segment</Text>
            </View>

            <View>
              {recSyncOffsets.map((offset, idx) => (
                <View
                  key={offset.verse}
                  className={`p-3 flex-row justify-between items-center bg-white ${
                    idx < recSyncOffsets.length - 1 ? 'border-b border-neutral-100' : ''
                  }`}
                >
                  <View style={{ maxWidth: 140 }}>
                    <Text className="font-extrabold text-[#1A1A1A] text-xs font-sans">Verse {offset.verse}</Text>
                    <Text className="text-[9px] text-neutral-400 mt-0.5" numberOfLines={1} ellipsizeMode="tail">
                      {selectedRecordingChapterTextData?.verses[String(offset.verse)] ?? ''}
                    </Text>
                  </View>

                  {isEditingSync ? (
                    <View className="flex-row items-center gap-1.5">
                      <TextInput
                        value={offset.start}
                        onChangeText={(val) =>
                          setRecSyncOffsets((prev) => prev.map((o) => (o.verse === offset.verse ? { ...o, start: val } : o)))
                        }
                        className="w-11 px-1.5 py-0.5 bg-neutral-50 border border-neutral-300 rounded text-center font-bold font-mono text-xs"
                      />
                      <Text className="text-neutral-400 font-mono">-</Text>
                      <TextInput
                        value={offset.end}
                        onChangeText={(val) =>
                          setRecSyncOffsets((prev) => prev.map((o) => (o.verse === offset.verse ? { ...o, end: val } : o)))
                        }
                        className="w-11 px-1.5 py-0.5 bg-neutral-50 border border-neutral-300 rounded text-center font-bold font-mono text-xs"
                      />
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        if (hasRealAudio) {
                          seekRecordingToTime(selectedRecording, toSeconds(offset.start));
                          triggerToast(`Jumping to Verse ${offset.verse}...`);
                        } else {
                          triggerToast(`Playing segment for Verse ${offset.verse} (${offset.start} - ${offset.end})`);
                        }
                      }}
                      className="bg-neutral-100 px-2.5 py-1 rounded border border-neutral-200"
                    >
                      <Text className="font-mono font-bold text-[#1A1A1A] text-xs">
                        {offset.start} - {offset.end} 🔊
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
