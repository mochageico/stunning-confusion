// ============================================================================
// api.bible CLIENT
// ----------------------------------------------------------------------------
// Thin wrapper over the fetchApiBibleChapter Cloud Function (see
// functions/src/apiBible.ts, which explains why this goes through a proxy at
// all rather than calling api.bible directly).
//
// The only thing this file adds on top of the call itself is the device and
// session identity FUMS wants. FUMS profiles *usage* -- which versions, books
// and chapters get read -- so it needs stable-ish ids to group requests by.
// Both are deliberately app-local random ids, not anything derived from the
// signed-in account or the hardware: the function already passes the Firebase
// uid separately, and nothing here should be able to identify a person or a
// device beyond "the same app install".
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { BibleTranslation, ChapterText } from '../types';
import { ALL_BIBLE_BOOKS } from '../data';

const DEVICE_ID_KEY = 'apiBible:deviceId';

// Must match the region the callable is deployed to (functions/src/apiBible.ts).
// The client builds the function URL from this; a mismatch is a 404 at call
// time, not a build error.
const FUNCTIONS_REGION = 'us-east1';

// Regenerated every app launch, which is what "session" means to FUMS.
const sessionId = randomId();

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let cachedDeviceId: string | null = null;

/** Stable per app install, created on first use. Cleared by a reinstall. */
async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }
  const fresh = randomId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
  cachedDeviceId = fresh;
  return fresh;
}

interface ChapterResponse {
  verses: Record<string, string>;
  verseCount: number;
}

/**
 * Fetches one chapter through the proxy and maps it into the same
 * `ChapterText` shape the Firestore path produces, so callers of
 * `fetchChapterText` can't tell the two sources apart.
 *
 * Throws on failure rather than returning null, so the message the function
 * produced (the daily-cap message in particular, which is genuinely useful to
 * a user) reaches `useChapterText`'s `error` and gets rendered. A null return
 * means only one thing: this Bible genuinely has no such chapter.
 */
export async function fetchApiBibleChapter(
  translation: BibleTranslation,
  bookId: string,
  chapter: number
): Promise<ChapterText | null> {
  if (!translation.apiBibleId) {
    throw new Error(`Translation ${translation.id} is marked source:'apiBible' but has no apiBibleId.`);
  }

  const functions = getFunctions(getApp(), FUNCTIONS_REGION);
  const call = httpsCallable<Record<string, unknown>, ChapterResponse | null>(functions, 'fetchApiBibleChapter');

  const result = await call({
    apiBibleId: translation.apiBibleId,
    bookId,
    chapter,
    deviceId: await getDeviceId(),
    sessionId,
  });

  if (!result.data) return null;

  const book = ALL_BIBLE_BOOKS.find((b) => b.id === bookId);

  return {
    translationId: translation.id,
    bookId,
    book: book?.name ?? bookId,
    chapter,
    verses: result.data.verses,
    verseCount: result.data.verseCount,
  };
}
