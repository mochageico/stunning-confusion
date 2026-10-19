import { useEffect, useRef, useState } from 'react';

import type { Recording } from '../types';
import type { AudioCacheSnapshot } from '../lib/audioCache';
import {
  cacheAudioFile,
  cacheableTarget,
  clearAudioCache,
  emptyAudioCacheSnapshot,
  initAudioCache,
  noteAudioPlayed,
  releaseAudioCache,
  removeCachedAudio,
  setCacheCapBytes,
} from '../lib/audioCache';

// ============================================================================
// RECORDING AUDIO ON THIS DEVICE
// ----------------------------------------------------------------------------
// The local audio cache: recordings cached as they're played, and the ones
// the user pinned with "Save offline". Split out of useAppState (see
// .claude/file-split-plan.md).
// ============================================================================

interface AudioDownloadsDeps {
  user: { uid: string } | null;
  /** The recording the shared player is on, if any. */
  playingRecordingId: string | null;
  nowPlayingRecording: Recording | null;
  /** The saved Studio preference (not the detail screen's A/B switch). */
  studioPlaybackEnabled: boolean;
  triggerToast: (message: string) => void;
}

export function useAudioDownloads({
  user,
  playingRecordingId,
  nowPlayingRecording,
  studioPlaybackEnabled,
  triggerToast,
}: AudioDownloadsDeps) {
  // Local audio cache (see lib/audioCache). Kept in React state purely so
  // resolvePlaybackUrl can do a synchronous lookup during render — the
  // manifest, the files and the eviction policy all live in that module.
  // Empty on web, where the browser's HTTP cache already honours the immutable
  // header the Cloud Function sets.
  const [audioCache, setAudioCache] = useState<AudioCacheSnapshot>(emptyAudioCacheSnapshot);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      // Signed out: drop the in-memory view. The files stay put — the next
      // sign-in either re-adopts them (same account) or sweeps them during
      // reconcile (different account).
      releaseAudioCache();
      setAudioCache(emptyAudioCacheSnapshot());
      return;
    }
    let cancelled = false;
    initAudioCache(uid)
      .then((snapshot) => {
        if (!cancelled) setAudioCache(snapshot);
      })
      .catch((err) => console.error('Failed to load audio cache:', err));
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // ── CACHE ON PLAY ───────────────────────────────────────────────────────
  // The first listen streams; every later one comes off disk. Fire-and-forget
  // by design — a failed or slow download must never affect playback, which
  // is already running against the remote URL.
  //
  // A finished download must NOT go straight into audioCache. Its map feeds
  // nowPlayingUrl, and changing that string swaps recordingPlayer's source
  // (see the playback effect in useAppState), which would restart the recitation from
  // zero at whatever moment the download happened to land. New snapshots are
  // parked here and flushed once nothing is playing.
  const pendingCacheSnapshotRef = useRef<AudioCacheSnapshot | null>(null);
  // Listen mode runs its own player inside PracticeModals and deliberately
  // clears playingRecordingId when it starts, so that flag alone can't tell
  // us whether audio is running. PracticeModals reports its state up.
  const [listenModePlaying, setListenModePlaying] = useState(false);

  const cacheRecordingAudio = (recording: Recording | null | undefined) => {
    // The persisted preference, NOT studioPlaybackActive: the A/B switch on
    // the detail screen is for comparing two takes back to back, and shouldn't
    // pull a second copy of the same recitation onto disk.
    const target = cacheableTarget(recording, studioPlaybackEnabled);
    if (!target) return;
    if (audioCache.map.has(target.storagePath)) {
      noteAudioPlayed(target.storagePath);
      return;
    }
    // No cancellation on unmount/re-run: the file is worth keeping regardless
    // of which playback started it, and cacheAudioFile already de-dupes
    // concurrent calls for the same path.
    cacheAudioFile(target)
      .then((snapshot) => {
        if (snapshot) pendingCacheSnapshotRef.current = snapshot;
      })
      .catch((err) => console.error('Audio cache write failed:', err));
  };

  useEffect(() => {
    if (!playingRecordingId) return;
    cacheRecordingAudio(nowPlayingRecording);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingRecordingId, nowPlayingRecording, studioPlaybackEnabled, audioCache]);

  // Drops cached files for a recording, either all of them (deletion) or just
  // the ones that are no longer the playback target (a studio render landing
  // on a recording whose raw take was already cached).
  //
  // Applies the new snapshot immediately rather than parking it like
  // cacheRecordingAudio does: the entries being removed belong to a recording
  // that is either gone or not the one playing, so no in-flight player's
  // source string can change underneath it.
  const dropCachedAudio = async (recording: Recording, mode: 'all' | 'stale') => {
    const paths = [recording.audioPath, recording.studioAudioPath];
    const keep = mode === 'stale' ? cacheableTarget(recording, studioPlaybackEnabled)?.storagePath : undefined;
    const snapshot = await removeCachedAudio(paths.filter((p) => p && p !== keep));
    if (snapshot) setAudioCache(snapshot);
  };

  useEffect(() => {
    if (playingRecordingId || listenModePlaying) return;
    const pending = pendingCacheSnapshotRef.current;
    if (!pending) return;
    pendingCacheSnapshotRef.current = null;
    setAudioCache(pending);
  }, [playingRecordingId, listenModePlaying]);

  // ── OFFLINE DOWNLOADS (user-driven) ─────────────────────────────────────
  // Distinct from cache-on-play: these are pinned, so eviction never touches
  // them. Applied immediately rather than parked — a user tapping "Save
  // offline" is not mid-listen on that recording in any flow that reaches
  // here, and the whole point is that the result is visible right away.
  const [downloadingRecordingIds, setDownloadingRecordingIds] = useState<Set<string>>(new Set());

  const markDownloading = (ids: string[], busy: boolean) =>
    setDownloadingRecordingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (busy ? next.add(id) : next.delete(id)));
      return next;
    });

  /** Downloads and pins one recording. Resolves once it is on disk. */
  const saveRecordingOffline = async (recording: Recording): Promise<boolean> => {
    const target = cacheableTarget(recording, studioPlaybackEnabled);
    if (!target) {
      triggerToast('This recording has no audio to download yet.');
      return false;
    }
    markDownloading([recording.id], true);
    try {
      const snapshot = await cacheAudioFile(target, { pin: true });
      if (snapshot) setAudioCache(snapshot);
      return true;
    } catch (err) {
      console.error('Offline download failed:', err);
      return false;
    } finally {
      markDownloading([recording.id], false);
    }
  };

  /** Removes a download, freeing the disk immediately. */
  const removeRecordingDownload = async (recording: Recording) => {
    await dropCachedAudio(recording, 'all');
    triggerToast('Download removed.');
  };

  /**
   * Bulk download for a chapter. Sequential on purpose: these files are
   * megabytes each, and firing a dozen parallel downloads over cellular is a
   * good way to have most of them time out.
   */
  const saveChapterOffline = async (recordings: Recording[]) => {
    // Keyed on `pinned`, not mere presence: an auto-cached file is still
    // evictable, so "save this chapter offline" has real work to do even when
    // every file already happens to be on disk (cacheAudioFile promotes those
    // in place rather than re-downloading them).
    const pending = recordings.filter((r) => {
      const target = cacheableTarget(r, studioPlaybackEnabled);
      return target && !audioCache.pinned.has(target.storagePath);
    });
    if (pending.length === 0) {
      triggerToast('Already saved for offline. ✓');
      return;
    }
    markDownloading(pending.map((r) => r.id), true);
    triggerToast(`Downloading ${pending.length} recording${pending.length === 1 ? '' : 's'}…`);
    let saved = 0;
    for (const recording of pending) {
      const target = cacheableTarget(recording, studioPlaybackEnabled);
      if (!target) continue;
      try {
        const snapshot = await cacheAudioFile(target, { pin: true });
        if (snapshot) {
          setAudioCache(snapshot);
          saved++;
        }
      } catch (err) {
        console.error('Offline download failed:', recording.id, err);
      }
    }
    markDownloading(pending.map((r) => r.id), false);
    triggerToast(
      saved === pending.length
        ? `Saved ${saved} recording${saved === 1 ? '' : 's'} offline. ⬇️`
        : `Saved ${saved} of ${pending.length} — check your connection.`
    );
  };

  const setAudioCacheCap = async (bytes: number) => {
    setAudioCache(await setCacheCapBytes(bytes));
  };

  /** Deletes every audio file on this device; called when the account is deleted. */
  const wipeAudioCache = async () => {
    setAudioCache(await clearAudioCache());
  };

  const clearAudioDownloads = async () => {
    await wipeAudioCache();
    triggerToast('Downloaded audio cleared.');
  };

  return {
    audioCache,
    wipeAudioCache,
    setListenModePlaying,
    cacheRecordingAudio,
    dropCachedAudio,
    downloadingRecordingIds,
    saveRecordingOffline,
    removeRecordingDownload,
    saveChapterOffline,
    setAudioCacheCap,
    clearAudioDownloads,
  };
}
