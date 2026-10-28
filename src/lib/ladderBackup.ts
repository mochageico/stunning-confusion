// A copy of the queue taken just before it's moved onto the review ladder
// (REVIEW_LADDER_PLAN.md stage 4a): saved on this device, and on web also
// handed over as a file to keep. Best effort -- a failed backup is logged and
// the move goes ahead, because the old fields stay on every verse anyway.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueueItem } from '../types';

export const ladderBackupKey = (uid: string) => `ladderBackup:${uid}`;

export async function backupQueueBeforeLadder(uid: string, queue: readonly QueueItem[]): Promise<void> {
  const json = JSON.stringify({ takenAt: new Date().toISOString(), uid, queue });
  try {
    await AsyncStorage.setItem(ladderBackupKey(uid), json);
  } catch (err) {
    console.error('[ladder] Could not save the queue backup on this device:', err);
  }
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `verses-backup-before-ladder-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    console.error('[ladder] Could not download the queue backup:', err);
  }
}
