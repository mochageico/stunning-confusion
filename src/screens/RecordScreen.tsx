import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Check, Mic, Pause, Play, RotateCcw } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, PulseView, WaveBars } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { Dropdown } from '../components/Dropdown';
import { getBookByName } from '../data';

const TRANSLATION_OPTIONS = [
  { id: 'ESV', label: 'ESV' },
  { id: 'NIV', label: 'NIV' },
  { id: 'NKJV', label: 'NKJV' },
  { id: 'NLT', label: 'NLT' },
];

export default function RecordScreen({ state }: { state: AppState }) {
  const {
    isRecording,
    isRecordingPaused,
    recordingSeconds,
    recordingBook,
    recordingChapter,
    recordingTranslation,
    recordingChapterVerses,
    verseTapTimestamps,
    setRecordingBook,
    setRecordingChapter,
    setRecordingTranslation,
    formatTime,
    handleStartRecording,
    handleStopRecording,
    handlePauseRecording,
    handleResumeRecording,
    handleResetRecording,
    handleMarkVerseTap,
  } = state;

  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const recordingBookMeta = getBookByName(recordingBook);
  const chapterOptions = recordingBookMeta
    ? Array.from({ length: recordingBookMeta.chapters }, (_, i) => ({ id: i + 1, label: String(i + 1) }))
    : [];

  const taggedVerseCount = Object.keys(verseTapTimestamps).length;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header Info */}
        <View className="border-b border-[#E5E5E5] pb-2 flex-row justify-between items-end">
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-bold text-neutral-400 font-sans">
              TELEPROMPTER VERIFICATION
            </Text>
            <Text className="text-xl font-serif font-bold text-[#1A1A1A]">Record Recitation</Text>
          </View>
          {/* Active Indicator */}
          {isRecording && (
            <PulseView>
              <View className="flex-row items-center gap-1.5 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                <View className="w-2 h-2 bg-red-600 rounded-full" />
                <Text className="text-xs text-red-600 font-bold">{formatTime(recordingSeconds)}</Text>
              </View>
            </PulseView>
          )}
        </View>

        {/* What are you recording? — book + chapter dropdowns (all 66 books, even
            though most don't have loaded verse content yet) */}
        <View style={{ gap: 8 }}>
          <Text className="text-[8px] font-extrabold uppercase text-neutral-400 font-sans tracking-wider">
            WHAT ARE YOU RECORDING?
          </Text>
          <View className="flex-row gap-2" style={{ opacity: isRecording ? 0.5 : 1 }}>
            <View className="flex-1">
              <BookPicker
                value={recordingBook}
                onChange={(book) => {
                  if (isRecording) return;
                  setRecordingBook(book);
                  setRecordingChapter(1);
                }}
              />
            </View>
            <View style={{ width: 100 }}>
              <Dropdown
                value={recordingChapter}
                options={chapterOptions}
                title="Select a Chapter"
                onChange={(ch) => {
                  if (isRecording) return;
                  setRecordingChapter(Number(ch));
                }}
              />
            </View>
          </View>
        </View>

        <View className="gap-1">
          <Text className="text-[8px] font-extrabold uppercase text-neutral-400 font-sans tracking-wider">
            TRANSLATION SELECT
          </Text>
          <View style={{ opacity: isRecording ? 0.5 : 1 }}>
            <Dropdown
              value={recordingTranslation}
              options={TRANSLATION_OPTIONS}
              title="Select a Translation"
              onChange={(val) => {
                if (isRecording) return;
                setRecordingTranslation(val);
              }}
            />
          </View>
        </View>

        {/* Tap-to-mark instructions — only relevant, and only shown, while
            actually recording (this is the whole mechanism behind automatic
            per-verse timestamps, so it needs to be impossible to miss). */}
        {isRecording && (
          <View className="bg-indigo-50 border border-indigo-200 rounded-xl p-3" style={{ gap: 2 }}>
            <Text className="text-xs font-sans font-bold text-indigo-900">
              💡 Tap each verse number the instant you begin reciting it
            </Text>
            <Text className="text-[10px] font-sans text-indigo-700">
              This times your recitation automatically. Verse 1 is already marked —{' '}
              {recordingChapterVerses.length > 1 ? 'start tapping from verse 2.' : ''}
              {'  '}
              {taggedVerseCount}/{recordingChapterVerses.length} verses marked.
            </Text>
          </View>
        )}

        {/* Teleprompter Scrollable text display */}
        <ScrollView
          className="border border-[#1A1A1A] rounded-xl bg-[#F3F2F1]/35 p-4"
          style={{ maxHeight: 380 }}
          contentContainerStyle={{ gap: 16 }}
        >
          <Text className="text-[9px] uppercase font-bold text-neutral-400 tracking-wider font-sans mb-2">
            TELEPROMPTER SCRIPT
          </Text>

          {recordingChapterVerses.length === 0 ? (
            <Text className="text-xs text-neutral-400 italic">
              No scripture loaded for {recordingTranslation} — try ESV, the only translation currently imported.
            </Text>
          ) : (
            recordingChapterVerses.map((v) => {
              const isTapped = verseTapTimestamps[v.verse] !== undefined;
              return (
                <Pressable
                  key={v.verse}
                  disabled={!isRecording}
                  onPress={() => handleMarkVerseTap(v.verse)}
                  className={`flex-row gap-2 -m-1 p-1 rounded-lg ${isRecording && isTapped ? 'bg-emerald-50' : ''}`}
                >
                  <View
                    className={`shrink-0 h-5 min-w-5 px-1 rounded items-center justify-center flex-row gap-0.5 ${
                      isRecording ? (isTapped ? 'bg-emerald-600' : 'bg-indigo-600') : ''
                    }`}
                  >
                    {isRecording && isTapped && <Check size={10} color="#FFFFFF" />}
                    <Text
                      className={`font-sans text-[10px] font-bold ${
                        isRecording ? 'text-white' : 'text-neutral-400'
                      }`}
                    >
                      {v.verse}
                    </Text>
                  </View>
                  <Text className="flex-1 font-serif text-lg leading-relaxed text-neutral-800">{v.text}</Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {/* Recording Animation Waveform Display */}
        {isRecording && (
          <PulseView style={isRecordingPaused ? { opacity: 1 } : undefined}>
            <View className="bg-[#1A1A1A] p-3 rounded-xl flex-row items-center justify-between gap-3.5">
              <Text className="text-[9px] uppercase font-bold tracking-wider font-sans text-neutral-400">
                {isRecordingPaused ? 'PAUSED' : 'AUDIO SIGNAL'}
              </Text>
              <View className="flex-1 items-center">
                <WaveBars active={isRecording && !isRecordingPaused} count={13} />
              </View>
              <Text className="text-xs font-mono font-bold text-red-400">{formatTime(recordingSeconds)}</Text>
            </View>
          </PulseView>
        )}

        {/* Recording Controls */}
        <View className="pt-2">
          {!isRecording ? (
            <Pressable
              onPress={handleStartRecording}
              className="w-full bg-[#1A1A1A] py-3.5 px-4 rounded-xl flex-row items-center justify-center gap-2 shadow"
            >
              <Mic size={16} color="#FFFFFF" />
              <Text className="text-white font-sans font-bold text-sm">Tap to Record recitation</Text>
            </Pressable>
          ) : showResetConfirm ? (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3" style={{ gap: 8 }}>
              <Text className="text-[11px] font-sans font-bold text-red-800">Discard this recording?</Text>
              <Text className="text-[9px] font-sans text-red-700/80 leading-relaxed">
                You'll lose everything recorded so far ({formatTime(recordingSeconds)}) and any verse taps. This can't
                be undone.
              </Text>
              <View className="flex-row gap-2 justify-end pt-1">
                <Pressable
                  onPress={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 border border-neutral-300 rounded-lg"
                >
                  <Text className="text-neutral-600 font-sans font-bold text-[10px]">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    handleResetRecording();
                    setShowResetConfirm(false);
                  }}
                  className="px-3 py-1.5 bg-red-600 rounded-lg"
                >
                  <Text className="text-white font-sans font-bold text-[10px]">Discard</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setShowResetConfirm(true)}
                className="w-12 items-center justify-center border border-neutral-300 rounded-xl"
              >
                <RotateCcw size={16} color="#737373" />
              </Pressable>
              <Pressable
                onPress={isRecordingPaused ? handleResumeRecording : handlePauseRecording}
                className="flex-1 bg-neutral-800 py-3.5 px-4 rounded-xl flex-row items-center justify-center gap-2 shadow"
              >
                {isRecordingPaused ? <Play size={16} color="#FFFFFF" /> : <Pause size={16} color="#FFFFFF" />}
                <Text className="text-white font-sans font-bold text-sm">{isRecordingPaused ? 'Resume' : 'Pause'}</Text>
              </Pressable>
              <PulseView>
                <Pressable
                  onPress={handleStopRecording}
                  className="w-28 bg-red-600 py-3.5 px-4 rounded-xl flex-row items-center justify-center gap-2 shadow-lg"
                >
                  <View className="w-3 h-3 bg-white rounded-sm" />
                  <Text className="text-white font-sans font-bold text-sm">Stop</Text>
                </Pressable>
              </PulseView>
            </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
