import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { db } from '../firebase';
import { getTranslation } from '../data';
import { ChapterText } from '../types';
import { fetchApiBibleChapter } from '../lib/apiBible';

const CACHE_PREFIX = 'scripture-cache:';
// v2: cached blobs gained a `fetchedAt` stamp so api.bible-sourced chapters
// can expire. v1 entries have no stamp and can't be aged, so they're orphaned
// by the version bump rather than migrated.
const CACHE_VERSION = 'v2';

interface CachedChapter {
  fetchedAt: number; // epoch ms
  data: ChapterText;
}

function cacheKey(translationId: string, bookId: string, chapter: number) {
  return `${CACHE_PREFIX}${CACHE_VERSION}:${translationId}:${bookId}:${chapter}`;
}

/**
 * Fetches one chapter's verse text, caching it in AsyncStorage so re-opening
 * the same chapter later works offline and doesn't re-spend a network read.
 *
 * Two sources sit behind this one function (see `source` on BibleTranslation):
 *
 * - 'firestore' — bulk-imported text at
 *   translations/{translationId}/books/{bookId}/chapters/{chapter}. These
 *   documents are immutable once imported (a translation's text doesn't
 *   change) and the translations shipped this way are public domain, so the
 *   cache never expires.
 * - 'apiBible'  — fetched on demand through a Cloud Function. api.bible's
 *   licence requires cached text be cleared regularly, so these entries carry
 *   a TTL from the translation's `capabilities.cacheTtlMs`.
 *
 * Callers get the same `ChapterText` either way and don't know the difference.
 */
export async function fetchChapterText(translationId: string, bookId: string, chapter: number): Promise<ChapterText | null> {
  const key = cacheKey(translationId, bookId, chapter);
  const translation = getTranslation(translationId);
  const ttlMs = translation?.capabilities.cacheTtlMs ?? null;

  const cached = await AsyncStorage.getItem(key);
  if (cached) {
    try {
      const entry = JSON.parse(cached) as CachedChapter;
      const expired = ttlMs !== null && Date.now() - entry.fetchedAt > ttlMs;
      if (!expired && entry.data) return entry.data;
      if (expired) await AsyncStorage.removeItem(key);
    } catch {
      // fall through to a network fetch if the cached blob is somehow corrupt
    }
  }

  // An unknown translation id (e.g. a queue item written before the
  // translation was retired from BIBLE_TRANSLATIONS) still resolves against
  // Firestore, which is where every historically-imported translation lives.
  const data =
    translation?.source === 'apiBible'
      ? await fetchApiBibleChapter(translation, bookId, chapter)
      : await fetchFromFirestore(translationId, bookId, chapter);

  if (!data) return null;

  const entry: CachedChapter = { fetchedAt: Date.now(), data };
  await AsyncStorage.setItem(key, JSON.stringify(entry));
  return data;
}

async function fetchFromFirestore(translationId: string, bookId: string, chapter: number): Promise<ChapterText | null> {
  const ref = doc(db, 'translations', translationId, 'books', bookId, 'chapters', String(chapter));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as ChapterText;
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
