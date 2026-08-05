import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Check, FileAudio, Folder, Mic, Pause, Play, RotateCcw, Upload } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, NumericInput, PulseView, WaveBars } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { Dropdown } from '../components/Dropdown';
import { BIBLE_TRANSLATIONS, getBookByName } from '../data';
import { recordingLabel } from '../lib/recordingLabel';
import { AppButton, AppText } from '../components/design';

// Derived from the single source of truth (data.ts) instead of its own
// hardcoded list -- previously listed NIV/NKJV/NLT despite zero real text
// ever being imported for them (see scripts/import-bible/).
const TRANSLATION_OPTIONS = BIBLE_TRANSLATIONS.map((t) => ({ id: t.id, label: t.id }));

export default function RecordScreen({ state }: { state: AppState }) {
  const {
    isRecording,
    isRecordingPaused,
    recordingSeconds,
    recordingBook,
    recordingChapter,
    recordingTranslation,
    recordingChapterVerses,
    recordingRangeStart,
    setRecordingRangeStart,
    recordingRangeEnd,
    setRecordingRangeEnd,
    recordingSelectedVerses,
    isRecordingFullChapterRange,
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

  // Verse-range picker: which portion of the chapter is about to be
  // recorded/tagged. Options bounded by the chapter's actual verse count.
  const rangeStartValue = recordingRangeStart ?? 1;
  const rangeEndValue = recordingRangeEnd ?? recordingChapterVerses.length;

  // Raw text mirrors of the range inputs. Controlled inputs driven straight
  // off rangeStartValue/rangeEndValue re-render to the clamped number on
  // every keystroke, so clearing a field to type a new value (e.g. deleting
  // "1") immediately snaps back to "1" because "" parses to NaN and the
  // commit is skipped while the displayed value stays put. Keeping the
  // field's own text separate lets it sit empty/partial mid-edit; only a
  // successful parse pushes a clamped number into the shared range state.
  const [startText, setStartText] = useState(String(rangeStartValue));
  const [endText, setEndText] = useState(String(rangeEndValue));

  // Resync the text fields when the range changes for reasons other than
  // typing in them -- switching book/chapter or tapping "Select All".
  useEffect(() => {
    setStartText(String(rangeStartValue));
    setEndText(String(rangeEndValue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingBook, recordingChapter, isRecordingFullChapterRange]);

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
            <AppText variant="micro" className="uppercase tracking-wider font-bold text-neutral-400 font-sans">
              TELEPROMPTER VERIFICATION
            </AppText>
            <AppText variant="title" className="font-serif font-bold text-[#1A1A1A]">
              {subMode === 'record' ? 'Record Recitation' : 'Tag Imported Audio'}
            </AppText>
          </View>
          {/* Active Indicator */}
          {isRecording && (
            <PulseView>
              <View className="flex-row items-center gap-1.5 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                <View className="w-2 h-2 bg-red-600 rounded-full" />
                <AppText variant="label" className="text-red-600 font-bold">{formatTime(recordingSeconds)}</AppText>
              </View>
            </PulseView>
          )}
        </View>

        {/* Record vs Import sub-mode tabs */}
        <View className="flex-row bg-neutral-100 p-1 rounded-xl border border-neutral-200">
          <AppButton size="sm" onPress={() => setSubMode('record')} disabled={isRecording} className={`flex-1 rounded-lg flex-row items-center justify-center gap-1.5 ${ subMode === 'record' ? 'bg-[#1A1A1A]' : '' } ${isRecording ? 'opacity-60' : ''}`}>
            <Mic size={12} color={subMode === 'record' ? '#ffffff' : '#737373'} />
            <AppText variant="section" className={`uppercase tracking-wider font-sans font-extrabold ${ subMode === 'record' ? 'text-white' : 'text-neutral-500' }`} >
              Record Live
            </AppText>
          </AppButton>
          <AppButton size="sm" onPress={() => setSubMode('import')} disabled={isRecording} className={`flex-1 rounded-lg flex-row items-center justify-center gap-1.5 ${ subMode === 'import' ? 'bg-[#1A1A1A]' : '' } ${isRecording ? 'opacity-60' : ''}`}>
            <Upload size={12} color={subMode === 'import' ? '#ffffff' : '#737373'} />
            <AppText variant="section" className={`uppercase tracking-wider font-sans font-extrabold ${ subMode === 'import' ? 'text-white' : 'text-neutral-500' }`} >
              Import Audio
            </AppText>
          </AppButton>
        </View>

        {/* What are you recording/tagging? — book + chapter + translation,
            all in one row now: book box sized to its content instead of
            flex-1, chapter # right beside it, translation taking the rest
            of the row (previously its own full-width row below). */}
        <View style={{ gap: 8 }}>
          <AppText variant="micro" className="font-extrabold uppercase text-neutral-400 font-sans tracking-wider">
            {subMode === 'record' ? 'WHAT ARE YOU RECORDING?' : 'WHAT IS THIS AUDIO?'}
          </AppText>
          <View className="flex-row gap-2" style={{ opacity: isRecording ? 0.5 : 1 }}>
            <View style={{ width: 130 }}>
              <BookPicker
                value={recordingBook}
                onChange={(book) => {
                  if (isRecording) return;
                  setRecordingBook(book);
                  setRecordingChapter(1);
                }}
              />
            </View>
            <View style={{ width: 64 }}>
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
            <View className="flex-1">
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
        </View>

        {/* Verse range — plain typed numbers, like the "Add Verses" box on
            the Group Plan screen, instead of scrolling two long dropdowns. */}
        <View className="gap-1">
          <View className="flex-row items-center justify-between">
            <AppText variant="micro" className="font-extrabold uppercase text-neutral-400 font-sans tracking-wider">
              VERSE RANGE
            </AppText>
            {!isRecordingFullChapterRange && (
              <Pressable
                onPress={() => {
                  if (isRecording) return;
                  setRecordingRangeStart(null);
                  setRecordingRangeEnd(null);
                }}
                disabled={isRecording}
              >
                <AppText variant="micro" className="font-bold font-sans underline text-indigo-600">Select All</AppText>
              </Pressable>
            )}
          </View>
          <View className="flex-row gap-2 items-center" style={{ opacity: isRecording ? 0.5 : 1 }}>
            <View className="flex-1">
              <NumericInput
                value={startText}
                editable={!isRecording}
                onChangeText={(text) => {
                  setStartText(text);
                  const num = parseInt(text, 10);
                  if (Number.isNaN(num)) return;
                  const clamped = Math.max(1, Math.min(num, recordingChapterVerses.length || num));
                  setRecordingRangeStart(clamped);
                  if (clamped > rangeEndValue) setRecordingRangeEnd(clamped);
                }}
                onBlur={() => setStartText(String(rangeStartValue))}
                className="w-full bg-neutral-50 border border-neutral-300 rounded-lg px-2 py-2.5 text-xs text-center font-bold"
              />
            </View>
            <AppText variant="label" className="font-bold text-neutral-400">to</AppText>
            <View className="flex-1">
              <NumericInput
                value={endText}
                editable={!isRecording}
                onChangeText={(text) => {
                  setEndText(text);
                  const num = parseInt(text, 10);
                  if (Number.isNaN(num)) return;
                  const clamped = Math.max(rangeStartValue, Math.min(num, recordingChapterVerses.length || num));
                  setRecordingRangeEnd(clamped);
                }}
                onBlur={() => setEndText(String(rangeEndValue))}
                className="w-full bg-neutral-50 border border-neutral-300 rounded-lg px-2 py-2.5 text-xs text-center font-bold"
              />
            </View>
            {recordingChapterVerses.length > 0 && (
              <AppText variant="micro" className="font-mono text-neutral-400 shrink-0">
                max {recordingChapterVerses.length}
              </AppText>
            )}
          </View>
        </View>

        {subMode === 'record' ? (
          <>
            {/* Tap-to-mark instructions — only relevant, and only shown, while
                actually recording (this is the whole mechanism behind automatic
                per-verse timestamps, so it needs to be impossible to miss). */}
            {isRecording && (
              <View className="bg-indigo-50 border border-indigo-200 rounded-xl p-3" style={{ gap: 2 }}>
                <AppText variant="label" className="font-sans font-bold text-indigo-900">
                  💡 Tap each verse number the instant you begin reciting it
                </AppText>
                <AppText variant="caption" className="font-sans text-indigo-700">
                  This times your recitation automatically. Verse {recordingSelectedVerses[0]?.verse ?? 1} is already
                  marked{recordingSelectedVerses.length > 1 ? ', so start tapping from the next one.' : '.'}{' '}
                  {taggedVerseCount}/{recordingSelectedVerses.length} verses marked.
                </AppText>
              </View>
            )}

            {/* Teleprompter Scrollable text display */}
            <ScrollView
              className="border border-[#1A1A1A] rounded-xl bg-[#F3F2F1]/35 p-4"
              style={{ maxHeight: 380 }}
              contentContainerStyle={{ gap: 16 }}
            >
              <AppText variant="micro" className="uppercase font-bold text-neutral-400 tracking-wider font-sans mb-2">
                TELEPROMPTER SCRIPT
              </AppText>

              {recordingSelectedVerses.length === 0 ? (
                <AppText variant="label" className="text-neutral-400 italic">
                  No scripture loaded for {recordingTranslation} — try ESV, KJV, or WEB, the currently imported translations.
                </AppText>
              ) : (
                recordingSelectedVerses.map((v) => {
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
                        <AppText variant="caption" className={`font-sans font-bold ${ isRecording ? 'text-white' : 'text-neutral-400' }`} >
                          {v.verse}
                        </AppText>
                      </View>
                      <AppText variant="title" className="flex-1 font-serif leading-relaxed text-neutral-800">{v.text}</AppText>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            {/* Recording Animation Waveform Display */}
            {isRecording && (
              <PulseView style={isRecordingPaused ? { opacity: 1 } : undefined}>
                <View className="bg-[#1A1A1A] p-3 rounded-xl flex-row items-center justify-between gap-3.5">
                  <AppText variant="micro" className="uppercase font-bold tracking-wider font-sans text-neutral-400">
                    {isRecordingPaused ? 'PAUSED' : 'AUDIO SIGNAL'}
                  </AppText>
                  <View className="flex-1 items-center">
                    <WaveBars active={isRecording && !isRecordingPaused} count={13} />
                  </View>
                  <AppText variant="label" className="font-mono font-bold text-red-400">{formatTime(recordingSeconds)}</AppText>
                </View>
              </PulseView>
            )}

            {/* Recording Controls */}
            <View className="pt-2">
              {!isRecording ? (
                <AppButton size="lg" onPress={handleStartRecording} className="w-full bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-2 shadow">
                  <Mic size={16} color="#FFFFFF" />
                  <AppText variant="body" className="text-white font-sans font-bold ">Tap to Record recitation</AppText>
                </AppButton>
              ) : showResetConfirm ? (
                <View className="bg-red-50 border border-red-200 rounded-xl p-3" style={{ gap: 8 }}>
                  <AppText variant="caption" className="font-sans font-bold text-red-800">Discard this recording?</AppText>
                  <AppText variant="micro" className="font-sans text-red-700/80 leading-relaxed">
                    You'll lose everything recorded so far ({formatTime(recordingSeconds)}) and any verse taps. This
                    can't be undone.
                  </AppText>
                  <View className="flex-row gap-2 justify-end pt-1">
                    <Pressable
                      onPress={() => setShowResetConfirm(false)}
                      className="px-3 py-1.5 border border-neutral-300 rounded-lg"
                    >
                      <AppText variant="caption" className="text-neutral-600 font-sans font-bold ">Cancel</AppText>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        handleResetRecording();
                        setShowResetConfirm(false);
                      }}
                      className="px-3 py-1.5 bg-red-600 rounded-lg"
                    >
                      <AppText variant="caption" className="text-white font-sans font-bold ">Discard</AppText>
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
                  <AppButton size="lg" onPress={isRecordingPaused ? handleResumeRecording : handlePauseRecording} className="flex-1 bg-neutral-800 rounded-xl flex-row items-center justify-center gap-2 shadow">
                    {isRecordingPaused ? <Play size={16} color="#FFFFFF" /> : <Pause size={16} color="#FFFFFF" />}
                    <AppText variant="body" className="text-white font-sans font-bold ">
                      {isRecordingPaused ? 'Resume' : 'Pause'}
                    </AppText>
                  </AppButton>
                  <PulseView>
                    <Pressable
                      onPress={handleStopRecording}
                      className="w-28 bg-red-600 py-3.5 px-4 rounded-xl flex-row items-center justify-center gap-2 shadow-lg"
                    >
                      <View className="w-3 h-3 bg-white rounded-sm" />
                      <AppText variant="body" className="text-white font-sans font-bold ">Stop</AppText>
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
                  <AppText variant="label" className="font-sans font-bold text-neutral-700">No audio file loaded yet</AppText>
                  <AppText variant="caption" className="font-sans text-neutral-400 text-center leading-relaxed">
                    Pick an existing recitation from your device, then listen back and tap each verse as it starts —
                    just like recording live, but for audio you already have.
                  </AppText>
                </View>
                <AppButton size="md" onPress={pickImportAudio} className="flex-row items-center gap-2 bg-[#1A1A1A] rounded-xl">
                  <Folder size={14} color="#FFFFFF" />
                  <AppText variant="label" className="text-white font-sans font-bold ">Choose Audio File</AppText>
                </AppButton>
              </View>
            ) : (
              <>
                {/* Loaded-file summary + swap option */}
                <View className="flex-row items-center justify-between bg-neutral-50 border border-neutral-200 rounded-xl p-2.5">
                  <View className="flex-row items-center gap-2 flex-1 pr-2">
                    <FileAudio size={14} color="#4f46e5" />
                    <AppText variant="label" className="font-sans font-bold text-neutral-800 flex-1" numberOfLines={1}>
                      {importedAudioName}
                    </AppText>
                  </View>
                  <Pressable onPress={pickImportAudio}>
                    <AppText variant="caption" className="font-sans font-bold text-indigo-600">Change</AppText>
                  </Pressable>
                </View>

                {/* Tagging instructions */}
                <View className="bg-indigo-50 border border-indigo-200 rounded-xl p-3" style={{ gap: 2 }}>
                  <AppText variant="label" className="font-sans font-bold text-indigo-900">
                    💡 Play the audio, tap each verse number the instant it begins
                  </AppText>
                  <AppText variant="caption" className="font-sans text-indigo-700">
                    Unlike live recording, no verse is pre-marked — tap each one, whenever it actually starts.{'  '}
                    {importTaggedCount}/{recordingSelectedVerses.length} verses tagged.
                  </AppText>
                </View>

                {/* Teleprompter, tap-to-mark against PLAYBACK position */}
                <ScrollView
                  className="border border-[#1A1A1A] rounded-xl bg-[#F3F2F1]/35 p-4"
                  style={{ maxHeight: 320 }}
                  contentContainerStyle={{ gap: 16 }}
                >
                  <AppText variant="micro" className="uppercase font-bold text-neutral-400 tracking-wider font-sans mb-2">
                    TELEPROMPTER SCRIPT
                  </AppText>

                  {recordingSelectedVerses.length === 0 ? (
                    <AppText variant="label" className="text-neutral-400 italic">
                      No scripture loaded for {recordingTranslation} — try ESV, KJV, or WEB, the currently
                      imported translations.
                    </AppText>
                  ) : (
                    recordingSelectedVerses.map((v) => {
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
                            <AppText variant="caption" className="font-sans font-bold text-white">{v.verse}</AppText>
                          </View>
                          <AppText variant="title" className="flex-1 font-serif leading-relaxed text-neutral-800">{v.text}</AppText>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>

                {/* Playback transport */}
                <View className="bg-[#1A1A1A] p-3 rounded-xl" style={{ gap: 10 }}>
                  <View className="flex-row justify-between items-center">
                    <AppText variant="micro" className="uppercase font-bold tracking-wider font-sans text-neutral-400">
                      PLAYBACK
                    </AppText>
                    <AppText variant="label" className="font-mono font-bold text-white">
                      {formatTime(Math.floor(importPlayerStatus.currentTime))} / {formatTime(Math.floor(importDuration))}
                    </AppText>
                  </View>
                  <View className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden">
                    <View className="bg-white h-full" style={{ width: `${Math.min(100, importProgress)}%` }} />
                  </View>
                  <View className="flex-row items-center justify-center gap-4 pt-1">
                    <Pressable
                      onPress={() => seekImportAudioBy(-5)}
                      className="w-9 h-9 rounded-full border border-white/25 items-center justify-center"
                    >
                      <AppText variant="caption" className="font-black font-sans text-white">-5s</AppText>
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
                      <AppText variant="caption" className="font-black font-sans text-white">+5s</AppText>
                    </Pressable>
                  </View>
                </View>

                {/* Tagging controls */}
                <View className="flex-row gap-2">
                  <AppButton size="md" onPress={resetImportTaps} disabled={importTaggedCount === 0} className={`flex-1 border border-neutral-300 rounded-xl flex-row items-center justify-center gap-1.5 ${ importTaggedCount === 0 ? 'opacity-40' : '' }`}>
                    <RotateCcw size={13} color="#525252" />
                    <AppText variant="label" className="font-sans font-bold text-neutral-600">Reset Tags</AppText>
                  </AppButton>
                  <AppButton size="md" onPress={handleFinishImportTagging} disabled={importTaggedCount === 0} className={`flex-[2] bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5 ${ importTaggedCount === 0 ? 'opacity-40' : '' }`}>
                    <Check size={14} color="#FFFFFF" />
                    <AppText variant="body" className="text-white font-sans font-bold ">Finish & Save Recitation</AppText>
                  </AppButton>
                </View>

                <Pressable onPress={clearImportedAudio} className="items-center py-1">
                  <AppText variant="caption" className="text-neutral-400 font-bold">Remove this file</AppText>
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
            <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
              Prior Recordings ({userRecordings.length})
            </AppText>
          </View>

          {userRecordings.length === 0 ? (
            <View className="items-center p-4 bg-[#F3F2F1]/55 rounded-xl border border-dashed border-[#E5E5E5]">
              <AppText variant="label" className="text-[#888]">No recorded chapters yet — record or import one above!</AppText>
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
                          <AppText variant="label" className="font-black text-[#1A1A1A] leading-tight">
                            {recordingLabel(rec)}
                          </AppText>
                          {rec.sourceType === 'imported' && (
                            <AppText variant="micro" className="bg-indigo-50 text-indigo-600 font-sans border border-indigo-200 px-1.5 py-0.5 rounded font-bold uppercase">
                              Imported
                            </AppText>
                          )}
                        </View>
                        <AppText variant="micro" className="font-sans text-neutral-400 mt-0.5">
                          {rec.date} • {rec.translation} • {rec.duration} seconds
                        </AppText>
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
