// ============================================================================
// api.bible PROXY
// ----------------------------------------------------------------------------
// Fetches one chapter of scripture from api.bible on the app's behalf.
//
// This exists as a server-side proxy rather than a direct call from the device
// for four reasons, all of them requirements rather than preferences:
//
//   1. The API key must not ship inside the app. A key bundled into a React
//      Native binary is extractable from the .ipa/.apk in minutes, and it is
//      the credential the whole licence agreement hangs off.
//   2. api.bible enforces 5,000 queries/day per key. That cap is shared by
//      every user of the app, so it can only be counted somewhere central --
//      a per-device counter would let 100 users spend 500,000 calls.
//   3. FUMS (Fair Use Management System) reporting is mandatory: every content
//      request must carry `fums-version=3`, and the token it returns must be
//      reported back. Doing that here means it can't be skipped by a stale
//      client build.
//   4. Swapping providers, or turning a translation off because a licence
//      lapsed, becomes a function deploy instead of an app-store release.
//
// The API key is a Functions secret (API_BIBLE_KEY), never app.config.js.
// Licence terms: https://scripture.api.bible/license
// ============================================================================

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

const apiBibleKey = defineSecret('API_BIBLE_KEY');

// api.bible's published ceiling. Held slightly below the real 5,000 so a burst
// of in-flight requests can't overshoot the actual limit and get the key
// flagged -- the whole point of counting is to never hit it.
const DAILY_QUERY_CAP = 4_900;

const API_BASE = 'https://api.scripture.api.bible/v1';
const FUMS_ENDPOINT = 'https://fums.api.bible/f3';

/** Rolls at UTC midnight, matching how api.bible resets its own daily counter. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Increments today's counter and returns the new total, transactionally.
 *
 * Read-then-write without a transaction undercounts badly here: chapter
 * fetches arrive in bursts (opening a book, starting a plan), so concurrent
 * invocations would all read the same value and each write back one more than
 * it, losing most of the increments and letting the real cap slip past.
 */
async function reserveQuota(db: FirebaseFirestore.Firestore): Promise<number> {
  const ref = db.doc(`apiBibleUsage/${todayKey()}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = (snap.exists ? (snap.data()?.queries as number | undefined) : 0) ?? 0;
    if (used >= DAILY_QUERY_CAP) return used; // caller rejects; don't record a query never made
    tx.set(ref, { queries: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return used + 1;
  });
}

/**
 * Reports a FUMS token back to api.bible.
 *
 * Deliberately fire-and-forget with its own catch: failing to report usage
 * must never turn into a user staring at an error where their verses should
 * be. A miss is logged so a systematic failure is visible in the logs rather
 * than silent, but the chapter still gets delivered.
 */
async function reportFums(token: string, deviceId?: string, sessionId?: string, userId?: string): Promise<void> {
  const params = new URLSearchParams({ t: token, dId: deviceId ?? 'unknown', sId: sessionId ?? 'unknown' });
  if (userId) params.set('uId', userId);
  try {
    const res = await fetch(`${FUMS_ENDPOINT}?${params.toString()}`, { method: 'GET' });
    if (!res.ok) logger.warn('FUMS report rejected', { status: res.status });
  } catch (err) {
    logger.warn('FUMS report failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * api.bible returns a chapter as one HTML/plain-text blob with verse numbers
 * inline, not as a verse map. `content-type=text&include-verse-numbers=true`
 * gives `[1] In the beginning... [2] Now the earth...`, which splits cleanly
 * on the bracketed numbers.
 *
 * Verse numbers are NOT assumed consecutive. Translations following the
 * critical text legitimately omit verses (Matthew 17:21, Mark 9:44, John 5:4,
 * Acts 8:37 and others), so the parsed number is kept as given rather than
 * inferred from position.
 *
 * UNVERIFIED AGAINST A LIVE RESPONSE. Written against api.bible's documented
 * output format; nobody has yet run it on a real one, because that needs a key
 * and an approved Bible. The logic is exercised for gaps, leading front matter
 * and empty input, but check a real chapter before trusting this in anger --
 * same caveat the ESV adapter carries in scripts/import-bible/README.md.
 */
export function parseVerses(content: string): Record<string, string> {
  const verses: Record<string, string> = {};
  const parts = content.split(/\[(\d+)\]/);
  for (let i = 1; i < parts.length; i += 2) {
    const text = (parts[i + 1] ?? '').replace(/\s+/g, ' ').trim();
    if (text) verses[parts[i]] = text;
  }
  return verses;
}

interface ChapterRequest {
  apiBibleId: string;
  bookId: string;
  chapter: number;
  deviceId?: string;
  sessionId?: string;
}

export const fetchApiBibleChapter = onCall(
  {
    region: 'us-east1',
    secrets: [apiBibleKey],
    // One chapter per call. Beyond keeping responses small, this is what keeps
    // the app structurally inside api.bible's "fewer than 500 consecutive
    // verses" rule -- no single request can ever return more than one chapter.
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to load scripture.');
    }

    const { apiBibleId, bookId, chapter, deviceId, sessionId } = (request.data ?? {}) as ChapterRequest;
    if (!apiBibleId || !bookId || !Number.isInteger(chapter) || chapter < 1) {
      throw new HttpsError('invalid-argument', 'apiBibleId, bookId and a positive integer chapter are required.');
    }

    const db = getFirestore();
    const used = await reserveQuota(db);
    if (used >= DAILY_QUERY_CAP) {
      logger.warn('api.bible daily cap reached', { used, cap: DAILY_QUERY_CAP });
      throw new HttpsError(
        'resource-exhausted',
        "Today's scripture lookups are used up. Verses you've already opened still work offline; new ones will load again tomorrow."
      );
    }

    // api.bible addresses chapters as BOOK.CHAPTER using USFM book ids -- the
    // same 3-letter ids this app already uses in src/data.ts, so bookId passes
    // through unmapped.
    const url =
      `${API_BASE}/bibles/${encodeURIComponent(apiBibleId)}/chapters/${encodeURIComponent(`${bookId}.${chapter}`)}` +
      '?content-type=text&include-verse-numbers=true&include-notes=false&include-titles=false' +
      '&include-chapter-numbers=false&fums-version=3';

    const res = await fetch(url, { headers: { 'api-key': apiBibleKey.value() } });

    if (res.status === 404) return null; // chapter genuinely absent from this Bible
    if (!res.ok) {
      logger.error('api.bible request failed', { status: res.status, bookId, chapter });
      throw new HttpsError('unavailable', 'Could not reach the scripture service. Try again in a moment.');
    }

    const body = (await res.json()) as {
      data?: { content?: string; bookId?: string; number?: string };
      meta?: { fumsId?: string };
    };

    const content = body.data?.content ?? '';
    const verses = parseVerses(content);
    if (Object.keys(verses).length === 0) {
      logger.error('api.bible returned no parseable verses', { bookId, chapter, contentLength: content.length });
      throw new HttpsError('internal', 'Scripture came back in an unexpected format.');
    }

    if (body.meta?.fumsId) {
      await reportFums(body.meta.fumsId, deviceId, sessionId, request.auth.uid);
    }

    return { verses, verseCount: Object.keys(verses).length };
  }
);
