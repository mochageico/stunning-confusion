import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { db } from '../firebase';
import { ChapterText } from '../types';

const CACHE_PREFIX = 'scripture-cache:';
const CACHE_VERSION = 'v1';

function cacheKey(translationId: string, bookId: string, chapter: number) {
  return `${CACHE_PREFIX}${CACHE_VERSION}:${translationId}:${bookId}:${chapter}`;
}

/**
 * Fetches one chapter's verse text from Firestore
 * (translations/{translationId}/books/{bookId}/chapters/{chapter}),
 * caching it in AsyncStorage so re-opening the same chapter later works
 * offline and doesn't re-spend a Firestore read. Scripture documents are
 * immutable once imported (a translation's text doesn't change), so there's
 * no cache invalidation to worry about beyond bumping CACHE_VERSION if the
 * on-disk schema shape ever changes.
 */
export async function fetchChapterText(translationId: string, bookId: string, chapter: number): Promise<ChapterText | null> {
  const key = cacheKey(translationId, bookId, chapter);

  const cached = await AsyncStorage.getItem(key);
  if (cached) {
    try {
      return JSON.parse(cached) as ChapterText;
    } catch {
      // fall through to network fetch if the cached blob is somehow corrupt
    }
  }

  const ref = doc(db, 'translations', translationId, 'books', bookId, 'chapters', String(chapter));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() as ChapterText;
  await AsyncStorage.setItem(key, JSON.stringify(data));
  return data;
}

export function useChapterText(translationId: string | null, bookId: string | null, chapter: number | null) {
  const [data, setData] = useState<ChapterText | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!translationId || !bookId || !chapter) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchChapterText(translationId, bookId, chapter)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [translationId, bookId, chapter]);

  return { data, loading, error };
}
