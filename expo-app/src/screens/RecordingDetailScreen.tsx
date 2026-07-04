import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Pause, Play } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, HelpTooltip, PulseView } from '../components/ui';

const SYNC_VERSE_PREVIEWS = [
  'No condemnation to those who are in Christ...',
  'For the law of the Spirit of life has set you free...',
  'For God has done what the law could not do...',
  'In order that the righteous requirement might be met...',
  'For those who live according to the flesh...',
];

const WAVEFORM_HEIGHTS = [
  8, 16, 24, 12, 20, 28, 32, 16, 24, 20, 12, 24, 32, 28, 20, 16, 12, 20, 28, 24, 32, 20, 16, 24, 28,
  12, 20, 24, 32, 16, 8, 12,
];

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
    isEditingSync,
    setIsEditingSync,
    recSyncOffsets,
    setRecSyncOffsets,
  } = state;

  if (!selectedRecording) return null;

  const isPlayingThis = playingRecordingId === selectedRecording.id;
  const hasRealAudio = !!selectedRecording.audioUrl;

  const handleDelete = () => {
    Alert.alert(
      'Delete Recording',
      `Are you sure you want to delete the recording for ${selectedRecording.book} ${selectedRecording.chapter}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteRecording(selectedRecording);
            triggerToast(`Recitation for ${selectedRecording.book} ${selectedRecording.chapter} deleted. 🗑️`);
            handleBack();
          },
        },
      ]
    );
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
                CHAPTER RECITATION
              </Text>
              <Text className="text-base font-serif font-black text-neutral-900 leading-none mt-1">
                {selectedRecording.book} {selectedRecording.chapter}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={handleDelete}
            className="px-2 py-1 bg-red-50 border border-red-200 rounded-lg"
          >
            <Text className="text-[9px] font-sans font-bold uppercase tracking-wider text-red-600">Delete Rec</Text>
          </Pressable>
        </View>

        {/* Recording Metadata Card */}
        <View className="border border-neutral-200 rounded-2xl p-4 bg-neutral-50/50" style={{ gap: 12 }}>
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <View style={{ width: '45%' }}>
              <Text className="text-[8px] uppercase tracking-wider text-neutral-400 font-bold font-sans">Translation</Text>
              <Text className="font-extrabold text-neutral-800 text-xs font-sans">
                {selectedRecording.translation} (English Standard Version)
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
              <Text className="font-extrabold text-neutral-800 text-xs font-sans">Kenneth Carter (Me)</Text>
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
                  onPress={() => {
                    setIsEditingSync(false);
                    triggerToast('Verse sync offsets updated! 🔄');
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
                      {SYNC_VERSE_PREVIEWS[idx % 5]}
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
                      onPress={() => triggerToast(`Playing segment for Verse ${offset.verse} (${offset.start} - ${offset.end})`)}
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
        </View>
      </ScrollView>
    </FadeInView>
  );
}
