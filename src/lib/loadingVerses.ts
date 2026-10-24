import AsyncStorage from '@react-native-async-storage/async-storage';

import { textScriptFor } from '../data';
import type { QueueItem } from '../types';

// The verse the loading screen shows when startup runs long: one of the
// user's own, cached on this device so it's there before Firestore answers.

const CACHE_KEY = 'loadingScreen.verses.v1';
const CACHE_MAX = 12;
// Long verses would push the mark off a small screen.
const MAX_CHARS = 180;

export interface LoadingVerse {
  text: string;
  reference: string;
}

// First launch on a device has nothing cached yet. BSB is public domain.
const FALLBACK_VERSE: LoadingVerse = {
  text: 'I have hidden Your word in my heart that I might not sin against You.',
  reference: 'Psalm 119:11',
};

/**
 * Remember a handful of the user's started verses on this device, so the next
 * launch has something of theirs to show before Firestore answers. Hebrew and
 * Greek are left out: the screen sets plain left-to-right text.
 */
export function cacheLoadingVerses(queue: QueueItem[]) {
  const picks: LoadingVerse[] = queue
    .filter(
      (q) =>
        q.status !== 'queued' &&
        q.text &&
        q.text.length <= MAX_CHARS &&
        textScriptFor(q.translationId, q.book) === 'latin'
    )
    .slice(0, CACHE_MAX)
    .map((q) => ({ text: q.text, reference: `${q.book} ${q.chapter}:${q.verseNumber}` }));
  if (picks.length === 0) return;
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(picks)).catch(() => undefined);
}

export async function pickLoadingVerse(): Promise<LoadingVerse> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const list = raw ? (JSON.parse(raw) as LoadingVerse[]) : [];
    if (list.length > 0) return list[Math.floor(Math.random() * list.length)];
  } catch {
    // Unreadable cache -- the fallback verse is fine.
  }
  return FALLBACK_VERSE;
}
