import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, FileAudio, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, NumericInput, WaveBars } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { Dropdown } from '../components/Dropdown';
import { BIBLE_TRANSLATIONS, getBookByName } from '../data';
import { recordingLabel, recordingMeta } from '../lib/recordingLabel';
import { AppButton, AppIconButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { Badge, Dialog, EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader, SegmentedControl } from '../components/blocks';
import { useThemeColors } from '../components/theme';

// Derived from the single source of truth (data.ts) instead of its own
// hardcoded list -- previously listed NIV/NKJV/NLT despite zero real text
// ever being imported for them (see scripts/import-bible/).
const TRANSLATION_OPTIONS = BIBLE_TRANSLATIONS.map((t) => ({ id: t.id, label: t.id }));

// The two things this screen can be doing. One word each: at 1.5x the longer
// "Record Live" / "Import Audio" pair stopped fitting on one line each.
const SUB_MODES = [
  { id: 'record' as const, label: 'Record' },
  { id: 'import' as const, label: 'Import' },
];

export default function RecordScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
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
    setPlayingRecProgress,
  } = state;

  const scale = useFontScale();
  const space = useScaledSpace();

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

  const fieldLabel = (text: string) => (
    <AppText variant="caption" className="font-sans font-medium text-ink-2">
      {text}
    </AppText>
  );
  const numberField = 'w-full bg-surface border border-line rounded-btn text-center font-sans font-semibold text-ink';

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title="Record"
          subtitle={
            subMode === 'record'
              ? 'Recite out loud and tap each verse as you start it.'
              : 'Tap each verse as it starts in audio you already have.'
          }
          actions={isRecording ? <Badge tone="danger" label={`${isRecordingPaused ? 'Paused' : 'Recording'} ${formatTime(recordingSeconds)}`} /> : undefined}
        />

        {/* Live recording and import tagging are separate activities; the
            switch is locked while recording so a tap can't abandon one. */}
        <View pointerEvents={isRecording ? 'none' : 'auto'} style={{ opacity: isRecording ? 0.5 : 1 }}>
          <SegmentedControl
            value={subMode}
            onChange={setSubMode}
            accessibilityLabel="Record or import"
            options={SUB_MODES}
          />
        </View>

        {/* WHICH PASSAGE -- reference and verse range in one card. Each field
            is labelled above itself, the way the add form on My Verses is,
            so the three pickers can size by what they hold (book wide,
            chapter and translation half each) without looking like three
            unrelated widths. */}
        <View style={{ gap: space(6), opacity: isRecording ? 0.55 : 1 }}>
          <SectionHeader title={subMode === 'record' ? "What you're reciting" : 'What this audio is'} />
          <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
            <View style={{ gap: space(4) }}>
              {fieldLabel('Book')}
              <BookPicker
                value={recordingBook}
                onChange={(book) => {
                  if (isRecording) return;
                  setRecordingBook(book);
                  setRecordingChapter(1);
                }}
              />
            </View>

            <View className="flex-row" style={{ gap: space(10) }}>
              <View className="flex-1" style={{ gap: space(4) }}>
                {fieldLabel('Chapter')}
                <Dropdown
                  value={recordingChapter}
                  options={chapterOptions}
                  title="Chapter"
                  onChange={(ch) => {
                    if (isRecording) return;
                    setRecordingChapter(Number(ch));
                  }}
                />
              </View>
              <View className="flex-1" style={{ gap: space(4) }}>
                {fieldLabel('Translation')}
                <Dropdown
                  value={recordingTranslation}
                  options={TRANSLATION_OPTIONS}
                  title="Translation"
                  onChange={(val) => {
                    if (isRecording) return;
                    setRecordingTranslation(val);
                  }}
                />
              </View>
            </View>

            {/* Verse range -- plain typed numbers. The trailing slot carries
                the chapter's verse count either way: "of 31" when the whole
                chapter is selected, and the way back to it when it isn't. */}
            <View style={{ gap: space(4) }}>
              {fieldLabel('Verses')}
              <View className="flex-row items-center" style={{ gap: space(8) }}>
                <View className="flex-1">
                  <NumericInput
                    value={startText}
                    editable={!isRecording}
                    accessibilityLabel="First verse"
                    onChangeText={(text) => {
                      setStartText(text);
                      const num = parseInt(text, 10);
                      if (Number.isNaN(num)) return;
                      const clamped = Math.max(1, Math.min(num, recordingChapterVerses.length || num));
                      setRecordingRangeStart(clamped);
                      if (clamped > rangeEndValue) setRecordingRangeEnd(clamped);
                    }}
                    onBlur={() => setStartText(String(rangeStartValue))}
                    className={numberField}
                    style={{ padding: space(10) }}
                  />
                </View>
                <AppText variant="label" className="text-ink-3 font-sans shrink-0">
                  to
                </AppText>
                <View className="flex-1">
                  <NumericInput
                    value={endText}
                    editable={!isRecording}
                    accessibilityLabel="Last verse"
                    onChangeText={(text) => {
                      setEndText(text);
                      const num = parseInt(text, 10);
                      if (Number.isNaN(num)) return;
                      const clamped = Math.max(rangeStartValue, Math.min(num, recordingChapterVerses.length || num));
                      setRecordingRangeEnd(clamped);
                    }}
                    onBlur={() => setEndText(String(rangeEndValue))}
                    className={numberField}
                    style={{ padding: space(10) }}
                  />
                </View>
                {recordingChapterVerses.length > 0 &&
                  (isRecordingFullChapterRange ? (
                    <AppText variant="label" className="font-sans text-ink-3 shrink-0">
                      of {recordingChapterVerses.length}
                    </AppText>
                  ) : (
                    <AppButton
                      size="sm"
                      variant="quiet"
                      label={`All ${recordingChapterVerses.length}`}
                      disabled={isRecording}
                      onPress={() => {
                        setRecordingRangeStart(null);
                        setRecordingRangeEnd(null);
                      }}
                    />
                  ))}
              </View>
            </View>
          </View>
        </View>

        {subMode === 'record' ? (
          <>
            {/* How the per-verse timing works. Only while recording, when it's
                the thing to do; it's the whole mechanism behind verse-by-verse
                playback, so it sits right above the script. */}
            {isRecording && (
              <Hint
                title="Tap each verse number as you start it"
                body={`That's what times each verse. Verse ${recordingSelectedVerses[0]?.verse ?? 1} is already marked${
                  recordingSelectedVerses.length > 1 ? ', so start with the next one' : ''
                }. ${taggedVerseCount} of ${recordingSelectedVerses.length} marked.`}
              />
            )}

            <ScriptList
              verses={recordingSelectedVerses}
              tapped={verseTapTimestamps}
              live={isRecording}
              onTap={handleMarkVerseTap}
              maxHeight={240}
            />

            {isRecording && (
              <View
                className="bg-surface border border-line rounded-card flex-row items-center"
                style={{ padding: space(12), gap: space(12) }}
              >
                <AppText variant="label" className="font-sans font-medium text-ink-2 shrink-0">
                  {isRecordingPaused ? 'Paused' : 'Recording'}
                </AppText>
                <View className="flex-1 items-center">
                  <WaveBars active={!isRecordingPaused} count={13} />
                </View>
                <AppText variant="label" className="font-sans font-semibold text-danger shrink-0" style={{ fontVariant: ['tabular-nums'] }}>
                  {formatTime(recordingSeconds)}
                </AppText>
              </View>
            )}

            {!isRecording ? (
              <AppButton size="lg" variant="primary" Icon={Mic} label="Start recording" onPress={handleStartRecording} />
            ) : (
              <View className="flex-row items-center" style={{ gap: space(8) }}>
                <AppIconButton
                  Icon={RotateCcw}
                  variant="outline"
                  diameter={44}
                  accessibilityLabel="Start over"
                  onPress={() => setShowResetConfirm(true)}
                />
                <View className="flex-1">
                  <AppButton
                    size="lg"
                    variant="secondary"
                    Icon={isRecordingPaused ? Play : Pause}
                    label={isRecordingPaused ? 'Resume' : 'Pause'}
                    onPress={isRecordingPaused ? handleResumeRecording : handlePauseRecording}
                  />
                </View>
                <View className="flex-1">
                  <AppButton size="lg" variant="primary" Icon={Square} label="Stop" onPress={handleStopRecording} />
                </View>
              </View>
            )}
          </>
        ) : !importedAudioUri ? (
          <View className="bg-surface border border-line rounded-card">
            <EmptyState
              Icon={FileAudio}
              title="No audio file yet"
              message="Pick a recitation from your device. Then play it back and tap each verse as it starts, just like recording live."
              actionLabel="Choose an audio file"
              onAction={pickImportAudio}
            />
          </View>
        ) : (
          <>
            {/* The loaded file, with a way to swap it. */}
            <View
              className="bg-surface border border-line rounded-card flex-row items-center"
              style={{ paddingLeft: space(14), paddingRight: space(8), paddingVertical: space(8), gap: space(10) }}
            >
              <FileAudio size={Math.round(18 * scale)} color={palette.accent} />
              <AppText variant="label" className="font-sans font-medium text-ink flex-1" numberOfLines={1}>
                {importedAudioName}
              </AppText>
              <AppButton size="sm" variant="quiet" label="Change" onPress={pickImportAudio} />
            </View>

            <Hint
              title="Play it, and tap each verse number as it starts"
              body={`No verse is marked ahead of time here: tap each one when it actually begins. ${importTaggedCount} of ${recordingSelectedVerses.length} tagged.`}
            />

            <ScriptList
              verses={recordingSelectedVerses}
              tapped={importTapTimestamps}
              live
              onTap={handleMarkImportTap}
              maxHeight={240}
            />

            {/* Playback. A card like the rest of the screen, not a solid
                accent slab: the play button is the thing to find, so it's the
                one filled shape here. */}
            <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
              {/* layout-ok: the progress track holds no text. */}
              <View className="w-full bg-fill rounded-full overflow-hidden" style={{ height: 6 }}>
                <View className="bg-accent h-full" style={{ width: `${Math.min(100, importProgress)}%` }} />
              </View>
              <View className="flex-row justify-between">
                <AppText variant="caption" className="font-sans text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
                  {formatTime(Math.floor(importPlayerStatus.currentTime))}
                </AppText>
                <AppText variant="caption" className="font-sans text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
                  {formatTime(Math.floor(importDuration))}
                </AppText>
              </View>
              <View className="flex-row items-center justify-center" style={{ gap: space(16) }}>
                <AppButton size="sm" variant="quiet" label="−5s" accessibilityLabel="Back 5 seconds" onPress={() => seekImportAudioBy(-5)} />
                <AppIconButton
                  Icon={importPlayerStatus.playing ? Pause : Play}
                  variant="filled"
                  diameter={52}
                  accessibilityLabel={importPlayerStatus.playing ? 'Pause' : 'Play'}
                  onPress={toggleImportPlayback}
                />
                <AppButton size="sm" variant="quiet" label="+5s" accessibilityLabel="Forward 5 seconds" onPress={() => seekImportAudioBy(5)} />
              </View>
            </View>

            <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
              <View style={{ flexGrow: 1, flexBasis: space(120) }}>
                <AppButton variant="secondary" Icon={RotateCcw} label="Clear taps" disabled={importTaggedCount === 0} onPress={resetImportTaps} />
              </View>
              <View style={{ flexGrow: 2, flexBasis: space(160) }}>
                <AppButton variant="primary" Icon={Check} label="Save recitation" disabled={importTaggedCount === 0} onPress={handleFinishImportTagging} />
              </View>
            </View>

            <View className="items-center">
              <AppButton size="sm" variant="quiet" label="Remove this file" onPress={clearImportedAudio} />
            </View>
          </>
        )}

        {/* Your recordings -- right where you're about to make a new one.
            Tap a row for its page; the play button plays it in place (the
            now-playing bar above the tabs shows progress). */}
        <View style={{ gap: space(6) }}>
          <SectionHeader title="Your recordings" />
          {userRecordings.length === 0 ? (
            <View className="bg-surface border border-line rounded-card">
              <EmptyState title="No recordings yet" message="Record or import one above and it will show up here." />
            </View>
          ) : (
            <GroupedList>
              {userRecordings.map((rec) => {
                const isPlaying = playingRecordingId === rec.id;
                return (
                  <ListRow
                    key={rec.id}
                    title={recordingLabel(rec)}
                    subtitle={recordingMeta(rec)}
                    onPress={() => {
                      setSelectedRecording(rec);
                      navigateTo('recordingDetail');
                    }}
                    accessory={
                      <AppIconButton
                        Icon={isPlaying ? Pause : Play}
                        variant={isPlaying ? 'filled' : 'outline'}
                        diameter={34}
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
                    }
                  />
                );
              })}
            </GroupedList>
          )}
        </View>
      </ScrollView>

      <Dialog
        visible={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title="Start over?"
        message={`This throws away the ${formatTime(recordingSeconds)} recorded so far and every verse you tapped. It can't be undone.`}
        actions={
          <>
            <AppButton variant="quiet" label="Keep recording" onPress={() => setShowResetConfirm(false)} />
            <AppButton
              variant="destructive"
              label="Start over"
              onPress={() => {
                handleResetRecording();
                setShowResetConfirm(false);
              }}
            />
          </>
        }
      />
    </FadeInView>
  );
}

/** How to tag verses: a tinted note, no emoji. */
function Hint({ title, body }: { title: string; body: string }) {
  const space = useScaledSpace();
  return (
    <View className="bg-accent-soft rounded-card" style={{ padding: space(12), gap: space(2) }}>
      <AppText variant="label" className="font-sans font-semibold text-ink">
        {title}
      </AppText>
      <AppText variant="caption" className="font-sans text-ink-2">
        {body}
      </AppText>
    </View>
  );
}

/**
 * The passage to read from, with a tappable verse number per verse. `live`
 * is whether taps count right now (recording, or tagging an import); when
 * they don't, the numbers are plain grey rather than buttons.
 */
function ScriptList({
  verses,
  tapped,
  live,
  onTap,
  maxHeight,
}: {
  verses: { verse: number; text: string }[];
  tapped: Record<number, unknown>;
  live: boolean;
  onTap: (verse: number) => void;
  maxHeight: number;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  return (
    <View style={{ gap: space(6) }}>
      <SectionHeader title="Script" />
      <ScrollView
        className="bg-surface border border-line rounded-card"
        style={{ maxHeight: Math.round(maxHeight * Math.min(scale, 1.3)) }}
        contentContainerStyle={{ padding: space(14), gap: space(14) }}
        nestedScrollEnabled
      >
        {verses.length === 0 ? (
          <AppText variant="label" className="font-sans text-ink-3">
            There's no text for this translation yet. Try another one above.
          </AppText>
        ) : (
          verses.map((v) => {
            const isTapped = tapped[v.verse] !== undefined;
            return (
              <Pressable
                key={v.verse}
                disabled={!live}
                onPress={() => onTap(v.verse)}
                accessibilityRole={live ? 'button' : undefined}
                accessibilityLabel={live ? `Verse ${v.verse}${isTapped ? ', marked' : ''}` : undefined}
                className={`flex-row items-start rounded-btn ${live && isTapped ? 'bg-success-soft' : ''}`}
                style={{ gap: space(10), margin: -space(4), padding: space(4) }}
              >
                <View
                  className={`shrink-0 rounded-btn items-center justify-center flex-row ${
                    live ? (isTapped ? 'bg-success' : 'bg-accent') : ''
                  }`}
                  style={{ minWidth: space(26), minHeight: space(24), paddingHorizontal: space(4), gap: space(2), marginTop: space(2) }}
                >
                  {live && isTapped ? <Check size={Math.round(11 * scale)} color={palette.onAccent} strokeWidth={3} /> : null}
                  <AppText
                    variant="caption"
                    className={`font-sans font-semibold ${live ? 'text-on-accent' : 'text-ink-3'}`}
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {v.verse}
                  </AppText>
                </View>
                <AppText variant="title" className="flex-1 font-serif leading-relaxed text-ink">
                  {v.text}
                </AppText>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
