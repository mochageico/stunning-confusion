import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookOpen, Check, FileAudio, ListMusic, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { passageLabel } from '../lib/chatAttachments';
import { FadeInView } from '../components/ui';
import { RecordPassageSheet, type RecordPassage } from '../components/RecordPassageSheet';
import { textScriptFor, translationLabel } from '../data';
import { isRtl } from '../lib/textScript';
import type { TextScript } from '../types';
import { AppButton, AppIconButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { Badge, Dialog, EmptyState, GroupedList, ListRow, ScreenHeader, SegmentedControl } from '../components/blocks';
import { useThemeColors } from '../components/theme';

// The two things this screen can be doing. One word each: at 1.5x the longer
// "Record Live" / "Import Audio" pair stopped fitting on one line each.
const SUB_MODES = [
  { id: 'record' as const, label: 'Record' },
  { id: 'import' as const, label: 'Import' },
];

/**
 * The Record tab. The passage is one summary row (its pickers live in a
 * sheet), so the text to read from gets the rest of the screen. While a take
 * is running the whole tab goes over to the text: the header, the mode
 * switch, the passage row and the tab bar step aside.
 */
export default function RecordScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const insets = useSafeAreaInsets();
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
    navigateTo,
  } = state;

  const scale = useFontScale();
  const space = useScaledSpace();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPassage, setShowPassage] = useState(false);
  // Live recording and import tagging are mutually exclusive activities, so
  // one switch picks which flow this screen shows — switching never touches
  // the other flow's in-progress state (e.g. flipping to Record mid-tagging
  // doesn't clear the picked file; it's still there on return).
  const [subMode, setSubMode] = useState<'record' | 'import'>('record');

  const passageChosen = !!recordingBook;
  const verseCount = recordingChapterVerses.length;
  const selectedCount = recordingSelectedVerses.length;
  const firstVerse = recordingSelectedVerses[0]?.verse;
  const lastVerse = recordingSelectedVerses[selectedCount - 1]?.verse;
  // Non-breaking hyphen so a range never wraps as "8:1- / 11".
  const passageTitle = !passageChosen
    ? 'Choose a passage'
    : isRecordingFullChapterRange || !selectedCount
      ? `${recordingBook} ${recordingChapter}`
      : `${recordingBook} ${recordingChapter}:${firstVerse}${lastVerse !== firstVerse ? `‑${lastVerse}` : ''}`;
  const passageSubtitle = !passageChosen
    ? 'Book, chapter and verses'
    : !verseCount
      ? translationLabel(recordingTranslation)
      : `${translationLabel(recordingTranslation)} · ${
          isRecordingFullChapterRange ? `all ${verseCount} verses` : `${selectedCount} ${selectedCount === 1 ? 'verse' : 'verses'}`
        }`;

  const applyPassage = (p: RecordPassage) => {
    setRecordingBook(p.book);
    setRecordingChapter(p.chapter);
    setRecordingTranslation(p.translation);
    setRecordingRangeStart(p.start);
    setRecordingRangeEnd(p.end);
    setShowPassage(false);
  };

  const taggedVerseCount = Object.keys(verseTapTimestamps).length;
  const importTaggedCount = Object.keys(importTapTimestamps).length;
  const importDuration = importPlayerStatus.duration || 0;
  const importProgress = importDuration > 0 ? (importPlayerStatus.currentTime / importDuration) * 100 : 0;
  const script = textScriptFor(recordingTranslation, recordingBook);

  const resetDialog = (
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
  );

  // --- Recording: the text and the controls, nothing else. ---
  if (isRecording) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <View
          className="flex-1 bg-canvas"
          // The tab bar is hidden while recording, so this screen owns the
          // bottom edge and keeps clear of the home indicator itself.
          style={{ paddingHorizontal: space(20), paddingTop: space(12), paddingBottom: Math.max(insets.bottom, space(12)), gap: space(12) }}
        >
          <View className="flex-row items-center" style={{ gap: space(10) }}>
            <AppText variant="title" className="flex-1 font-sans font-bold text-ink" numberOfLines={2}>
              {passageTitle}
            </AppText>
            <Badge tone="danger" label={`${isRecordingPaused ? 'Paused' : 'Recording'} ${formatTime(recordingSeconds)}`} />
          </View>
          {/* Tapping a verse number as you start it is what times each
              verse, the whole mechanism behind verse-by-verse playback. */}
          <AppText variant="caption" className="font-sans text-ink-2">
            Tap each verse number as you start it. Verse {firstVerse ?? 1} is already marked. {taggedVerseCount} of {selectedCount} marked.
          </AppText>

          <ScriptList fill verses={recordingSelectedVerses} tapped={verseTapTimestamps} live onTap={handleMarkVerseTap} script={script} />

          <View className="flex-row items-center" style={{ gap: space(8) }}>
            <AppIconButton
              Icon={RotateCcw}
              variant="outline"
              diameter={44}
              accessibilityLabel="Start over"
              onPress={() => setShowResetConfirm(true)}
            />
            {/* At large text three labelled buttons don't fit a row ("Paus /
                e"), so Pause becomes a round button like Start over. */}
            {scale >= 1.3 ? (
              <AppIconButton
                Icon={isRecordingPaused ? Play : Pause}
                variant="outline"
                diameter={44}
                accessibilityLabel={isRecordingPaused ? 'Resume' : 'Pause'}
                onPress={isRecordingPaused ? handleResumeRecording : handlePauseRecording}
              />
            ) : (
              <View className="flex-1">
                <AppButton
                  size="lg"
                  variant="secondary"
                  Icon={isRecordingPaused ? Play : Pause}
                  label={isRecordingPaused ? 'Resume' : 'Pause'}
                  onPress={isRecordingPaused ? handleResumeRecording : handlePauseRecording}
                />
              </View>
            )}
            <View className="flex-1">
              <AppButton size="lg" variant="primary" Icon={Square} label="Stop" onPress={handleStopRecording} />
            </View>
          </View>
        </View>
        {resetDialog}
      </FadeInView>
    );
  }

  const top = (
    <>
        <ScreenHeader
          title="Record"
          subtitle={
            subMode === 'record'
              ? 'Recite out loud and tap each verse as you start it.'
              : 'Tap each verse as it starts in audio you already have.'
          }
          actions={
            <AppIconButton
              Icon={ListMusic}
              variant="outline"
              accessibilityLabel="Your recordings"
              onPress={() => navigateTo('myRecordings')}
            />
          }
        />

        <SegmentedControl value={subMode} onChange={setSubMode} accessibilityLabel="Record or import" options={SUB_MODES} />

        {/* Recording for someone's request (said "I will" in a chat). Saving
            a recording of this chapter sends it back to them automatically. */}
        {state.activeRecordingRequest ? (
          <View className="bg-accent-soft border border-accent rounded-card flex-row items-center" style={{ padding: space(12), gap: space(10) }}>
            <View className="flex-1" style={{ gap: space(2) }}>
              <AppText variant="label" className="font-sans font-semibold text-ink">
                Recording for {state.activeRecordingRequest.scope === 'dm' ? state.activeRecordingRequest.requesterName : 'your circle'}
              </AppText>
              <AppText variant="caption" className="font-sans text-ink-2">
                Save a recording of {passageLabel(state.activeRecordingRequest.attachment)} and it's sent to the chat for you.
              </AppText>
            </View>
            <AppButton size="sm" variant="quiet" label="Cancel" onPress={state.cancelRecordingRequest} />
          </View>
        ) : null}

        {/* The passage, as one row. Its pickers are in a sheet. */}
        <GroupedList>
          <ListRow
            Icon={BookOpen}
            title={passageTitle}
            subtitle={passageSubtitle}
            onPress={() => setShowPassage(true)}
            accessory={
              <AppText variant="label" className="font-sans font-semibold text-accent">
                {passageChosen ? 'Change' : 'Choose'}
              </AppText>
            }
          />
        </GroupedList>
    </>
  );

  const sheets = (
    <>
      <RecordPassageSheet
        visible={showPassage}
        initial={{
          book: recordingBook,
          chapter: recordingChapter,
          translation: recordingTranslation,
          start: recordingRangeStart,
          end: recordingRangeEnd,
        }}
        onClose={() => setShowPassage(false)}
        onApply={applyPassage}
      />
      {resetDialog}
    </>
  );

  // Record mode (and the no-passage prompt): a fixed page, not a scrolling
  // one, so the script fills exactly the height that's left between the
  // passage row and the Start button. Inside a scrolling page it grew to its
  // full length and pushed Start off the bottom.
  if (subMode === 'record' || !passageChosen) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas p-5" style={{ gap: space(16) }}>
          {top}
          {!passageChosen ? (
            <View className="flex-1 bg-surface border border-line rounded-card justify-center">
              <EmptyState
                Icon={BookOpen}
                title="Pick what to recite"
                message="Choose a book and chapter, and its text shows up here to read from."
                actionLabel="Choose a passage"
                onAction={() => setShowPassage(true)}
              />
            </View>
          ) : (
            <>
              <ScriptList fill verses={recordingSelectedVerses} tapped={verseTapTimestamps} live={false} onTap={handleMarkVerseTap} script={script} />
              <AppButton
                size="lg"
                variant="primary"
                Icon={Mic}
                label="Start recording"
                disabled={selectedCount === 0}
                onPress={handleStartRecording}
              />
            </>
          )}
        </View>
        {sheets}
      </FadeInView>
    );
  }

  // Import mode has more controls (the file, playback, save), so it scrolls,
  // with the script at a fixed height.
  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }}>
        {top}
        {!importedAudioUri ? (
          <View className="flex-1 bg-surface border border-line rounded-card justify-center">
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

            <AppText variant="caption" className="font-sans text-ink-2">
              Play it, and tap each verse number as it starts. No verse is marked ahead of time here. {importTaggedCount} of {selectedCount} tagged.
            </AppText>

            <ScriptList verses={recordingSelectedVerses} tapped={importTapTimestamps} live onTap={handleMarkImportTap} script={script} />

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
      </ScrollView>

      {sheets}
    </FadeInView>
  );
}

/**
 * The passage to read from, with a tappable verse number per verse. `live`
 * is whether taps count right now (recording, or tagging an import); when
 * they don't, the numbers are plain grey rather than buttons. With `fill` it
 * takes all the height its (non-scrolling) parent has left; without, it has
 * a fixed height inside a scrolling page.
 */
function ScriptList({
  verses,
  tapped,
  live,
  onTap,
  fill = false,
  script = 'latin',
}: {
  verses: { verse: number; text: string }[];
  tapped: Record<number, unknown>;
  live: boolean;
  onTap: (verse: number) => void;
  fill?: boolean;
  /** Hebrew sets each row right-to-left: number on the right, text RTL. */
  script?: TextScript;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  return (
    <ScrollView
      className="bg-surface border border-line rounded-card"
      style={fill ? { flex: 1, minHeight: space(140) } : { maxHeight: Math.round(320 * Math.min(scale, 1.3)) }}
      contentContainerStyle={{ padding: space(14), gap: space(14) }}
      nestedScrollEnabled
    >
      {verses.length === 0 ? (
        <AppText variant="label" className="font-sans text-ink-3">
          There's no text for this translation yet. Try another one in the passage picker.
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
              className={`${isRtl(script) ? 'flex-row-reverse' : 'flex-row'} items-start rounded-btn ${live && isTapped ? 'bg-success-soft' : ''}`}
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
              <AppText variant="title" script={script} className="flex-1 font-serif leading-relaxed text-ink">
                {v.text}
              </AppText>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}
