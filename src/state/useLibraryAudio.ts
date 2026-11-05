import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { db } from '../firebase';
import { LibraryChapterTimings, libraryTimingsKey, splitLibraryTimingsKey } from '../lib/libraryAudio';

// Verse timings for the built-in readings, one Firestore doc per English
// chapter per reader. Like firestore-sourced scripture text, they never change
// once uploaded, so they're cached on the device forever -- and in memory, so
// a chapter already seen this session resolves on the first render.

// `library-audio:v1:shmuelof:PSA_23` -- the format from before there was a
// second reader, so Hebrew timings already cached on phones stay valid.
const cacheKey = (key: string) => {
  const { readerId, chapterId } = splitLibraryTimingsKey(key);
  return `library-audio:v1:${readerId}:${chapterId}`;
};
const memory = new Map<string, LibraryChapterTimings | null>();
const inFlight = new Map<string, Promise<LibraryChapterTimings | null>>();

async function loadTimings(key: string): Promise<LibraryChapterTimings | null> {
  if (memory.has(key)) return memory.get(key)!;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      const cached = await AsyncStorage.getItem(cacheKey(key));
      if (cached) return JSON.parse(cached) as LibraryChapterTimings;
    } catch {
      // corrupt or unreadable cache entry -- fetch instead
    }
    try {
      const { readerId, chapterId } = splitLibraryTimingsKey(key);
      const snap = await getDoc(doc(db, 'audioLibrary', readerId, 'chapters', chapterId));
      const data = snap.exists() ? (snap.data() as LibraryChapterTimings) : null;
      // Only a real doc is cached: a miss may just mean the upload hasn't run yet.
      if (data) await AsyncStorage.setItem(cacheKey(key), JSON.stringify(data)).catch(() => {});
      return data;
    } catch {
      return null; // offline: no built-in audio this time, try again next mount
    }
  })();
  inFlight.set(key, p);
  const result = await p;
  inFlight.delete(key);
  if (result) memory.set(key, result);
  return result;
}

export interface ChapterRef {
  book: string;
  chapter: number;
  translationId?: string;
}

/**
 * Built-in reading timings for every chapter in `refs` that has one, keyed by
 * `libraryTimingsKey`. Chapters without a built-in reading (WEB, KJV, the
 * Greek NT ...) are never fetched.
 */
export function useLibraryTimings(refs: ChapterRef[]): ReadonlyMap<string, LibraryChapterTimings> {
  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const r of refs) {
      const key = libraryTimingsKey(r.translationId, r.book, r.chapter);
      if (key) set.add(key);
    }
    return [...set].sort();
  }, [refs]);
  const keysSig = keys.join('|');

  const [loaded, setLoaded] = useState<ReadonlyMap<string, LibraryChapterTimings>>(() => fromMemory(keys));

  useEffect(() => {
    let cancelled = false;
    setLoaded(fromMemory(keys));
    const missing = keys.filter((k) => !memory.has(k));
    if (missing.length === 0) return;
    Promise.all(missing.map(loadTimings)).then(() => {
      if (!cancelled) setLoaded(fromMemory(keys));
    });
    return () => {
      cancelled = true;
    };
    // keysSig stands in for `keys`: a new array with the same chapters must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig]);

  return loaded;
}

function fromMemory(keys: string[]): ReadonlyMap<string, LibraryChapterTimings> {
  const m = new Map<string, LibraryChapterTimings>();
  for (const k of keys) {
    const t = memory.get(k);
    if (t) m.set(k, t);
  }
  return m;
}
