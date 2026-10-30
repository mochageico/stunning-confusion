import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';

import { DEFAULT_TRANSLATION_ID, getBookByName, getTranslation } from '../data';

// ============================================================================
// RECORD TAB: PASSAGE AND MIC
// ----------------------------------------------------------------------------
// Which passage the Record tab is on (remembered on this device), and live
// mic capture with tap-to-mark verse times. Saving the finished take stays in
// useAppState (persistRecording), which reads what this hook captured.
// Split out of useAppState (see .claude/file-split-plan.md).
// ============================================================================

const RECORD_PASSAGE_KEY = 'record:lastPassage:v1';

interface RecorderDeps {
  triggerToast: (message: string) => void;
  /** First verse of the picked range, seeded at t=0 when recording starts. */
  getFirstVerse: () => number | undefined;
  /** Recording stopped: open the Save dialog. */
  onStopped: () => void;
}

export function useRecorder({ triggerToast, getFirstVerse, onStopped }: RecorderDeps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  // Snapshot of recordingSeconds taken the instant recording stops — the Save
  // Recitation dialog reads this (not recordingSeconds directly), since the
  // recording timer effect zeroes recordingSeconds out as soon as isRecording
  // flips false, well before the dialog is dismissed.
  const [lastRecordingDuration, setLastRecordingDuration] = useState(0);
  // Tap-to-mark verse timestamps (Option 1 of timestamp automation): verse
  // number -> audioRecorder.currentTime at the moment the user tapped that
  // verse in the teleprompter. Reset on every new recording, seeded with the
  // chapter's first verse at t=0 so the user only needs to tap starting from
  // the second verse onward.
  const [verseTapTimestamps, setVerseTapTimestamps] = useState<Record<number, number>>({});
  // What the Record tab records. No passage until one is chosen ('' book):
  // it used to open on Romans 8 every time. The last one chosen is kept on
  // the device and comes back next time (RECORD_PASSAGE_KEY).
  const [recordingBook, setRecordingBook] = useState('');
  const [recordingChapter, setRecordingChapter] = useState(1);
  const [recordingTranslation, setRecordingTranslation] = useState(DEFAULT_TRANSLATION_ID);
  // Verse range for a partial-chapter recording. null bounds mean the
  // chapter's first / last verse (see recordingSelectedVerses in useAppState).
  const [recordingRangeStart, setRecordingRangeStart] = useState<number | null>(null);
  const [recordingRangeEnd, setRecordingRangeEnd] = useState<number | null>(null);

  // The last passage recorded from, restored on launch. Device-local, like
  // the other screen preferences here.
  const recordPassageLoaded = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(RECORD_PASSAGE_KEY);
        const saved = raw ? JSON.parse(raw) : null;
        if (saved && typeof saved.book === 'string' && getBookByName(saved.book)) {
          setRecordingBook(saved.book);
          setRecordingChapter(Number(saved.chapter) || 1);
          // A translation since removed falls back to the default. One this
          // account can't pick is dropped by useAppState once sign-in resolves.
          if (getTranslation(saved.translation)) setRecordingTranslation(saved.translation);
          setRecordingRangeStart(typeof saved.start === 'number' ? saved.start : null);
          setRecordingRangeEnd(typeof saved.end === 'number' ? saved.end : null);
        }
      } catch {
        // Corrupt/missing -- start with no passage chosen.
      } finally {
        recordPassageLoaded.current = true;
      }
    })();
  }, []);
  useEffect(() => {
    if (!recordPassageLoaded.current || !recordingBook) return;
    AsyncStorage.setItem(
      RECORD_PASSAGE_KEY,
      JSON.stringify({
        book: recordingBook,
        chapter: recordingChapter,
        translation: recordingTranslation,
        start: recordingRangeStart,
        end: recordingRangeEnd,
      })
    ).catch(() => {});
  }, [recordingBook, recordingChapter, recordingTranslation, recordingRangeStart, recordingRangeEnd]);

  // Real audio recorder (mic capture) for the Record tab.
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Captured the instant recording stops — audioRecorder.currentTime resets
  // once stop() resolves, and recordingSeconds gets zeroed by the recording
  // timer effect (below) well before the user taps "Confirm & Save" in the
  // dialog, so neither is safe to read directly inside saveRecordedAudio.
  const capturedDurationRef = useRef(0);

  // Recording Timer -- keeps ticking while recording and not paused. Only
  // resets to 0 when recording stops entirely, not when merely paused, so
  // resuming continues from where the elapsed time left off.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRecording && !isRecordingPaused) {
      interval = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else if (!isRecording) {
      setRecordingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isRecordingPaused]);

  // ==========================================
  // VOICE RECORDER FLOW — real mic capture via expo-audio, uploaded to
  // Firebase Storage (recordings/{uid}/{id}.<ext>) with metadata written to
  // Firestore (users/{uid}/recordings/{id}). Private to the recording user —
  // no circle/group sharing yet (see firestore.rules + storage.rules).
  // ==========================================
  const handleStartRecording = async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        triggerToast('Allow the microphone in Settings to record.');
        return;
      }
      // Required on iOS — expo-audio refuses to record until the audio
      // session is explicitly switched into recording mode.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingSeconds(0);
      // Seed the selected range's first verse at t=0 — recording always
      // starts on the first verse of the picked range (which may not be
      // verse 1 of the chapter), so the user only needs to tap from the
      // next verse in the range onward.
      const firstVerse = getFirstVerse();
      setVerseTapTimestamps(firstVerse !== undefined ? { [firstVerse]: 0 } : {});
      triggerToast('Recording. Tap each verse number as you reach it.');
    } catch (err) {
      console.error('Failed to start recording:', err);
      triggerToast("Couldn't start recording. Check microphone permissions.");
    }
  };

  const handleStopRecording = async () => {
    capturedDurationRef.current = Math.round(audioRecorder.currentTime) || recordingSeconds || 1;
    setLastRecordingDuration(capturedDurationRef.current);
    try {
      await audioRecorder.stop();
    } catch (err) {
      console.error('Failed to stop recording:', err);
    }
    try {
      // Switch back out of recording mode immediately, so anything played
      // back before the next recording starts doesn't inherit a session
      // still configured for recording.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (err) {
      console.error('Failed to reset audio mode after recording:', err);
    }
    setIsRecording(false);
    setIsRecordingPaused(false);
    onStopped();
  };

  // Pauses mid-recording without finalizing it -- the recording timer holds
  // at its current value (see the Recording Timer effect) rather than
  // resetting, since only a real stop should do that.
  const handlePauseRecording = () => {
    if (!isRecording || isRecordingPaused) return;
    audioRecorder.pause();
    setIsRecordingPaused(true);
  };

  const handleResumeRecording = () => {
    if (!isRecording || !isRecordingPaused) return;
    audioRecorder.record();
    setIsRecordingPaused(false);
  };

  // Discards the in-progress recording entirely (no save dialog) and
  // returns to the idle state so the user can start a fresh take.
  const handleResetRecording = async () => {
    try {
      await audioRecorder.stop();
    } catch (err) {
      console.error('Failed to stop recording during reset:', err);
    }
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (err) {
      console.error('Failed to reset audio mode after resetting recording:', err);
    }
    setIsRecording(false);
    setIsRecordingPaused(false);
    setVerseTapTimestamps({});
    triggerToast('Recording discarded.');
  };

  // Tap-to-mark: called when the user taps a verse in the teleprompter while
  // recording. Re-tapping the same verse overwrites its mark with the newer
  // time, so an accidental early tap can just be corrected with another tap.
  const handleMarkVerseTap = (verseNumber: number) => {
    if (!isRecording || isRecordingPaused) return;
    setVerseTapTimestamps((prev) => ({ ...prev, [verseNumber]: audioRecorder.currentTime }));
  };

  return {
    isRecording,
    setIsRecording,
    isRecordingPaused,
    recordingSeconds,
    setRecordingSeconds,
    lastRecordingDuration,
    verseTapTimestamps,
    recordingBook,
    setRecordingBook,
    recordingChapter,
    setRecordingChapter,
    recordingTranslation,
    setRecordingTranslation,
    recordingRangeStart,
    setRecordingRangeStart,
    recordingRangeEnd,
    setRecordingRangeEnd,
    audioRecorder,
    capturedDurationRef,
    handleStartRecording,
    handleStopRecording,
    handlePauseRecording,
    handleResumeRecording,
    handleResetRecording,
    handleMarkVerseTap,
  };
}
