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
  return useLibraryTimingsState(refs).timings;
}

/**
 * The same, plus `pending`: true while a chapter that has a built-in reading
 * is still being fetched, so a screen can wait instead of saying there's no
 * audio. Once the fetch settles (loaded, or failed offline) it's false.
 */
export function useLibraryTimingsState(refs: ChapterRef[]): { timings: ReadonlyMap<string, LibraryChapterTimings>; pending: boolean } {
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
  // The keysSig whose fetches have all settled.
  const [settled, setSettled] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(fromMemory(keys));
    const missing = keys.filter((k) => !memory.has(k));
    if (missing.length === 0) {
      setSettled(keysSig);
      return;
    }
    Promise.all(missing.map(loadTimings)).then(() => {
      if (cancelled) return;
      setLoaded(fromMemory(keys));
      setSettled(keysSig);
    });
    return () => {
      cancelled = true;
    };
    // keysSig stands in for `keys`: a new array with the same chapters must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig]);

  const pending = settled !== keysSig && keys.some((k) => !memory.has(k));
  return { timings: loaded, pending };
}

function fromMemory(keys: string[]): ReadonlyMap<string, LibraryChapterTimings> {
  const m = new Map<string, LibraryChapterTimings>();
  for (const k of keys) {
    const t = memory.get(k);
    if (t) m.set(k, t);
  }
  return m;
}
