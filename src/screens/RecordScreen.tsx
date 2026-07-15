import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Check, FileAudio, Folder, Mic, Pause, Play, RotateCcw, Upload } from 'lucide-react-native';

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
    // import-audio tagging flow
    importedAudioUri,
    importedAudioName,
    importTapTimestamps,
    importPlayerStatus,
    pickImportAudio,
    clearImportedAudio,
    toggleImportPlayback,
    seekImportAudioBy,
    handleMarkImportTap,
    resetImportTaps,
    handleFinishImportTagging,
    // prior recordings list
    userRecordings,
    navigateTo,
    setSelectedRecording,
    playingRecordingId,
    setPlayingRecordingId,
    playingRecProgress,
    setPlayingRecProgress,
  } = state;

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // Live recording and import tagging are mutually exclusive activities, so
  // one tab bar picks which flow this screen shows — switching tabs never
  // touches the other flow's in-progress state (e.g. flipping to Record
  // mid-tagging doesn't clear the picked file; it's still there on return).
  const [subMode, setSubMode] = useState<'record' | 'import'>('record');

  const recordingBookMeta = getBookByName(recordingBook);
  const chapterOptions = recordingBookMeta
    ? Array.from({ length: recordingBookMeta.chapters }, (_, i) => ({ id: i + 1, label: String(i + 1) }))
    : [];

  const taggedVerseCount = Object.keys(verseTapTimestamps).length;
  const importTaggedCount = Object.keys(importTapTimestamps).length;
  const importDuration = importPlayerStatus.duration || 0;
  const importProgress = importDuration > 0 ? (importPlayerStatus.currentTime / importDuration) * 100 : 0;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header Info */}
        <View className="border-b border-[#E5E5E5] pb-2 flex-row justify-between items-end">
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-bold text-neutral-400 font-sans">
              TELEPROMPTER VERIFICATION
            </Text>
            <Text className="text-xl font-serif font-bold text-[#1A1A1A]">
              {subMode === 'record' ? 'Record Recitation' : 'Tag Imported Audio'}
            </Text>
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

        {/* Record vs Import sub-mode tabs */}
        <View className="flex-row bg-neutral-100 p-1 rounded-xl border border-neutral-200">
          <Pressable
            onPress={() => setSubMode('record')}
            disabled={isRecording}
            className={`flex-1 py-1.5 rounded-lg flex-row items-center justify-center gap-1.5 ${
              subMode === 'record' ? 'bg-[#1A1A1A]' : ''
            } ${isRecording ? 'opacity-60' : ''}`}
          >
            <Mic size={12} color={subMode === 'record' ? '#ffffff' : '#737373'} />
            <Text
              className={`text-[10px] uppercase tracking-wider font-sans font-extrabold ${
                subMode === 'record' ? 'text-white' : 'text-neutral-500'
              }`}
            >
              Record Live
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSubMode('import')}
            disabled={isRecording}
            className={`flex-1 py-1.5 rounded-lg flex-row items-center justify-center gap-1.5 ${
              subMode === 'import' ? 'bg-[#1A1A1A]' : ''
            } ${isRecording ? 'opacity-60' : ''}`}
          >
            <Upload size={12} color={subMode === 'import' ? '#ffffff' : '#737373'} />
            <Text
              className={`text-[10px] uppercase tracking-wider font-sans font-extrabold ${
                subMode === 'import' ? 'text-white' : 'text-neutral-500'
              }`}
            >
              Import Audio
            </Text>
          </Pressable>
        </View>

        {/* What are you recording/tagging? — book + chapter dropdowns (all 66
            books, even though most don't have loaded verse content yet) */}
        <View style={{ gap: 8 }}>
          <Text className="text-[8px] font-extrabold uppercase text-neutral-400 font-sans tracking-wider">
            {subMode === 'record' ? 'WHAT ARE YOU RECORDING?' : 'WHAT IS THIS AUDIO?'}
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

        {subMode === 'record' ? (
          <>
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
                    You'll lose everything recorded so far ({formatTime(recordingSeconds)}) and any verse taps. This
                    can't be undone.
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
                    <Text className="text-white font-sans font-bold text-sm">
                      {isRecordingPaused ? 'Resume' : 'Pause'}
                    </Text>
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
          </>
        ) : (
          <>
            {/* IMPORT-AUDIO TAGGING SUB-MODE */}
            {!importedAudioUri ? (
              <View className="items-center gap-3 py-8 border-2 border-dashed border-neutral-200 rounded-xl bg-neutral-50/50">
                <View className="w-12 h-12 rounded-full bg-white border border-neutral-200 items-center justify-center">
                  <FileAudio size={20} color="#737373" />
                </View>
                <View className="items-center px-6" style={{ gap: 2 }}>
                  <Text className="text-xs font-sans font-bold text-neutral-700">No audio file loaded yet</Text>
                  <Text className="text-[10px] font-sans text-neutral-400 text-center leading-relaxed">
                    Pick an existing recitation from your device, then listen back and tap each verse as it starts —
                    just like recording live, but for audio you already have.
                  </Text>
                </View>
                <Pressable
                  onPress={pickImportAudio}
                  className="flex-row items-center gap-2 bg-[#1A1A1A] px-4 py-2.5 rounded-xl"
                >
                  <Folder size={14} color="#FFFFFF" />
                  <Text className="text-white font-sans font-bold text-xs">Choose Audio File</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {/* Loaded-file summary + swap option */}
                <View className="flex-row items-center justify-between bg-neutral-50 border border-neutral-200 rounded-xl p-2.5">
                  <View className="flex-row items-center gap-2 flex-1 pr-2">
                    <FileAudio size={14} color="#4f46e5" />
                    <Text className="text-xs font-sans font-bold text-neutral-800 flex-1" numberOfLines={1}>
                      {importedAudioName}
                    </Text>
                  </View>
                  <Pressable onPress={pickImportAudio}>
                    <Text className="text-[10px] font-sans font-bold text-indigo-600">Change</Text>
                  </Pressable>
                </View>

                {/* Tagging instructions */}
                <View className="bg-indigo-50 border border-indigo-200 rounded-xl p-3" style={{ gap: 2 }}>
                  <Text className="text-xs font-sans font-bold text-indigo-900">
                    💡 Play the audio, tap each verse number the instant it begins
                  </Text>
                  <Text className="text-[10px] font-sans text-indigo-700">
                    Unlike live recording, verse 1 isn't pre-marked — tap it too, whenever it actually starts.{'  '}
                    {importTaggedCount}/{recordingChapterVerses.length} verses tagged.
                  </Text>
                </View>

                {/* Teleprompter, tap-to-mark against PLAYBACK position */}
                <ScrollView
                  className="border border-[#1A1A1A] rounded-xl bg-[#F3F2F1]/35 p-4"
                  style={{ maxHeight: 320 }}
                  contentContainerStyle={{ gap: 16 }}
                >
                  <Text className="text-[9px] uppercase font-bold text-neutral-400 tracking-wider font-sans mb-2">
                    TELEPROMPTER SCRIPT
                  </Text>

                  {recordingChapterVerses.length === 0 ? (
                    <Text className="text-xs text-neutral-400 italic">
                      No scripture loaded for {recordingTranslation} — try ESV, the only translation currently
                      imported.
                    </Text>
                  ) : (
                    recordingChapterVerses.map((v) => {
                      const isTapped = importTapTimestamps[v.verse] !== undefined;
                      return (
                        <Pressable
                          key={v.verse}
                          onPress={() => handleMarkImportTap(v.verse)}
                          className={`flex-row gap-2 -m-1 p-1 rounded-lg ${isTapped ? 'bg-emerald-50' : ''}`}
                        >
                          <View
                            className={`shrink-0 h-5 min-w-5 px-1 rounded items-center justify-center flex-row gap-0.5 ${
                              isTapped ? 'bg-emerald-600' : 'bg-indigo-600'
                            }`}
                          >
                            {isTapped && <Check size={10} color="#FFFFFF" />}
                            <Text className="font-sans text-[10px] font-bold text-white">{v.verse}</Text>
                          </View>
                          <Text className="flex-1 font-serif text-lg leading-relaxed text-neutral-800">{v.text}</Text>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>

                {/* Playback transport */}
                <View className="bg-[#1A1A1A] p-3 rounded-xl" style={{ gap: 10 }}>
                  <View className="flex-row justify-between items-center">
                    <Text className="text-[9px] uppercase font-bold tracking-wider font-sans text-neutral-400">
                      PLAYBACK
                    </Text>
                    <Text className="text-xs font-mono font-bold text-white">
                      {formatTime(Math.floor(importPlayerStatus.currentTime))} / {formatTime(Math.floor(importDuration))}
                    </Text>
                  </View>
                  <View className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden">
                    <View className="bg-white h-full" style={{ width: `${Math.min(100, importProgress)}%` }} />
                  </View>
                  <View className="flex-row items-center justify-center gap-4 pt-1">
                    <Pressable
                      onPress={() => seekImportAudioBy(-5)}
                      className="w-9 h-9 rounded-full border border-white/25 items-center justify-center"
                    >
                      <Text className="text-[10px] font-black font-sans text-white">-5s</Text>
                    </Pressable>
                    <Pressable
                      onPress={toggleImportPlayback}
                      className="w-12 h-12 rounded-full bg-white items-center justify-center"
                    >
                      {importPlayerStatus.playing ? (
                        <Pause size={18} color="#1A1A1A" />
                      ) : (
                        <Play size={18} color="#1A1A1A" style={{ marginLeft: 2 }} />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => seekImportAudioBy(5)}
                      className="w-9 h-9 rounded-full border border-white/25 items-center justify-center"
                    >
                      <Text className="text-[10px] font-black font-sans text-white">+5s</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Tagging controls */}
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={resetImportTaps}
                    disabled={importTaggedCount === 0}
                    className={`flex-1 py-2.5 px-3 border border-neutral-300 rounded-xl flex-row items-center justify-center gap-1.5 ${
                      importTaggedCount === 0 ? 'opacity-40' : ''
                    }`}
                  >
                    <RotateCcw size={13} color="#525252" />
                    <Text className="font-sans font-bold text-xs text-neutral-600">Reset Tags</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleFinishImportTagging}
                    disabled={importTaggedCount === 0}
                    className={`flex-[2] py-2.5 px-3 bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5 ${
                      importTaggedCount === 0 ? 'opacity-40' : ''
                    }`}
                  >
                    <Check size={14} color="#FFFFFF" />
                    <Text className="text-white font-sans font-bold text-sm">Finish & Save Recitation</Text>
                  </Pressable>
                </View>

                <Pressable onPress={clearImportedAudio} className="items-center py-1">
                  <Text className="text-[10.5px] text-neutral-400 font-bold">Remove this file</Text>
                </Pressable>
              </>
            )}
          </>
        )}

        {/* Prior Recordings — previously only reachable via Profile or a
            chapter's landing page, which was inconvenient right where you're
            about to make a new one. Same row layout/behavior as Profile's
            "Recorded Chapters" list (tap opens RecordingDetailScreen, the
            small play button plays it in place without navigating). */}
        <View className="gap-2 pt-2 border-t border-neutral-100">
          <View className="flex-row items-center px-1">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              Prior Recordings ({userRecordings.length})
            </Text>
          </View>

          {userRecordings.length === 0 ? (
            <View className="items-center p-4 bg-[#F3F2F1]/55 rounded-xl border border-dashed border-[#E5E5E5]">
              <Text className="text-xs text-[#888]">No recorded chapters yet — record or import one above!</Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {userRecordings.map((rec) => {
                const isPlaying = playingRecordingId === rec.id;
                return (
                  <Pressable
                    key={rec.id}
                    onPress={() => {
                      setSelectedRecording(rec);
                      navigateTo('recordingDetail');
                    }}
                    className="border border-[#E5E5E5] rounded-xl p-3 bg-white gap-2"
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 pr-2">
                        <View className="flex-row items-center gap-1.5">
                          <Text className="text-xs font-black text-[#1A1A1A] leading-tight">
                            {rec.book} {rec.chapter}
                          </Text>
                          {rec.sourceType === 'imported' && (
                            <Text className="text-[8px] bg-indigo-50 text-indigo-600 font-sans border border-indigo-200 px-1.5 py-0.5 rounded font-bold uppercase">
                              Imported
                            </Text>
                          )}
                        </View>
                        <Text className="text-[9px] font-sans text-neutral-400 mt-0.5">
                          {rec.date} • {rec.translation} • {rec.duration} seconds
                        </Text>
                      </View>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          if (isPlaying) {
                            setPlayingRecordingId(null);
                          } else {
                            setPlayingRecordingId(rec.id);
                            setPlayingRecProgress(0);
                          }
                        }}
                        className={`w-7 h-7 rounded-full items-center justify-center shrink-0 ${
                          isPlaying ? 'bg-[#1A1A1A]' : 'border border-[#1A1A1A]'
                        }`}
                      >
                        {isPlaying ? (
                          <Pause size={12} color="#FFFFFF" />
                        ) : (
                          <Play size={12} color="#1A1A1A" style={{ marginLeft: 2 }} />
                        )}
                      </Pressable>
                    </View>

                    {isPlaying && (
                      <View className="w-full bg-neutral-100 h-1.5 rounded-full overflow-hidden">
                        <View className="bg-[#1A1A1A] h-full" style={{ width: `${playingRecProgress}%` }} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
