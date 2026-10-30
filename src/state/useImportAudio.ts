import { useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';

// ============================================================================
// IMPORTED AUDIO TAGGING
// ----------------------------------------------------------------------------
// The picked audio file, its own player, and the verse taps made while
// listening back. Saving it stays in useAppState (saveImportedRecording).
// Split out of useAppState (see .claude/file-split-plan.md).
// ============================================================================

interface ImportAudioDeps {
  triggerToast: (message: string) => void;
}

export function useImportAudio({ triggerToast }: ImportAudioDeps) {
  // Import-audio tagging: the reverse of live recording. Instead of tapping
  // each verse while the mic records, the user picks an existing audio file
  // and taps each verse while LISTENING BACK to it. Reuses the exact same
  // teleprompter + buildVerseTimestamps mechanism as live recording — only
  // the time source differs (playback position instead of recorder position).
  const [importedAudioUri, setImportedAudioUri] = useState<string | null>(null);
  const [importedAudioName, setImportedAudioName] = useState<string | null>(null);
  // Deliberately NOT seeded with verse 1 at t=0 the way live recording is:
  // a live recording's t=0 IS the moment the user hit Start, but an imported
  // file may have lead-in silence or an intro before verse 1 actually
  // begins, so verse 1 needs its own real tap like every other verse.
  const [importTapTimestamps, setImportTapTimestamps] = useState<Record<number, number>>({});

  // Separate player for the import-audio tagging flow — kept distinct
  // from recordingPlayer (which is reserved for "now playing a saved
  // Recording" everywhere else in the app: Profile, RecordingDetail, the
  // floating now-playing bar) so tagging playback can't collide with those.
  const importPlayer = useAudioPlayer(importedAudioUri ?? undefined);
  const importPlayerStatus = useAudioPlayerStatus(importPlayer);

  // ==========================================
  // IMPORT-AUDIO TAGGING FLOW — pick an existing audio file, then tap each
  // verse while LISTENING BACK to it (mirrors handleMarkVerseTap in useRecorder, but
  // keyed to playback position instead of recorder position).
  // ==========================================
  const pickImportAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      // Switch to playback mode up front -- picking a file mid-recording
      // isn't a real flow, but if audio mode were ever left in "recording"
      // from a previous take, playback would be silent/misrouted otherwise.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      setImportedAudioUri(asset.uri);
      setImportedAudioName(asset.name || 'Imported audio');
      setImportTapTimestamps({});
      triggerToast('Audio loaded. Press play and tap each verse as it starts.');
    } catch (err) {
      console.error('Failed to pick import audio:', err);
      triggerToast("Couldn't open that file. Try another.");
    }
  };

  // Clears the picked file and any taps so far, returning to the "choose a
  // file" state. Does NOT touch anything already saved.
  const clearImportedAudio = () => {
    // .pause() can throw if the native player was already released (same
    // race the saved-recording player guards against elsewhere) — pausing
    // an already-idle/released player is a no-op either way.
    try {
      importPlayer.pause();
    } catch {
      // already released — nothing to pause
    }
    setImportedAudioUri(null);
    setImportedAudioName(null);
    setImportTapTimestamps({});
  };

  const toggleImportPlayback = () => {
    if (!importedAudioUri) return;
    if (importPlayerStatus.playing) {
      importPlayer.pause();
    } else {
      importPlayer.play();
    }
  };

  const seekImportAudioBy = (deltaSeconds: number) => {
    if (!importedAudioUri) return;
    const total = importPlayerStatus.duration || 0;
    const next = Math.max(0, Math.min(total, importPlayerStatus.currentTime + deltaSeconds));
    importPlayer.seekTo(next);
  };

  // Re-tapping the same verse overwrites its mark with the newer time, same
  // forgiving behavior as the live-recording version.
  const handleMarkImportTap = (verseNumber: number) => {
    if (!importedAudioUri) return;
    setImportTapTimestamps((prev) => ({ ...prev, [verseNumber]: importPlayerStatus.currentTime }));
  };

  const resetImportTaps = () => {
    setImportTapTimestamps({});
  };

  return {
    importedAudioUri,
    importedAudioName,
    importTapTimestamps,
    importPlayer,
    importPlayerStatus,
    pickImportAudio,
    clearImportedAudio,
    toggleImportPlayback,
    seekImportAudioBy,
    handleMarkImportTap,
    resetImportTaps,
  };
}
