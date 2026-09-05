// ============================================================================
// api.bible PROXY
// ----------------------------------------------------------------------------
// Fetches one chapter of scripture from api.bible on the app's behalf, through
// a shared server-side cache.
//
// This exists as a server-side proxy rather than a direct call from the device
// for five reasons, all of them requirements rather than preferences:
//
//   1. The API key must not ship inside the app. A key bundled into a React
//      Native binary is extractable from the .ipa/.apk in minutes, and it is
//      the credential the whole licence agreement hangs off.
//   2. THE CALL BUDGET ONLY WORKS IF THE CACHE IS SHARED. The free plan allows
//      5,000 calls per MONTH. With a per-device cache alone, 100 users opening
//      Romans 8 costs 100 calls -- roughly fifty ordinary users would exhaust
//      the month. Caching each chapter here instead means Romans 8 costs one
//      call no matter how many people read it, so spend scales with how many
//      DISTINCT chapters the userbase touches and is independent of headcount.
//      At a 14-day refresh that is ~214 calls/month per 100 chapters, so the
//      free plan covers roughly 2,300 distinct chapters across all three
//      licensed translations.
//   3. FUMS (Fair Use Management System) reporting is mandatory: every content
//      request must carry `fums-version=3`, and the token it returns must be
//      reported back. Doing that here means it can't be skipped by a stale
//      client build.
//   4. The cap can only be counted somewhere central -- a per-device counter
//      would let 100 users spend 100 times the allowance.
//   5. Swapping providers, or turning a translation off because a licence
//      lapsed, becomes a function deploy instead of an app-store release.
//
// The API key is a Functions secret (API_BIBLE_KEY), never app.config.js.
// Licence terms: https://scripture.api.bible/license
// ============================================================================

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineInt } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

const apiBibleKey = defineSecret('API_BIBLE_KEY');

/**
 * Calls allowed per calendar month.
 *
 * A parameter rather than a constant because the number changes with the plan
 * and nothing else about the code does: the free Starter plan allows 5,000
 * calls/month, the $30/month paid tier 150,000. Set API_BIBLE_MONTHLY_CAP at
 * deploy time when the plan changes.
 *
 * The default sits below the real 5,000 so a burst of in-flight requests can't
 * overshoot the actual ceiling -- the point of counting is to never hit it.
 *
 * NOTE the window: api.bible's older rate-limiting docs describe 5,000 per DAY
 * while the current plan card says per MONTH. Monthly is both the newer figure
 * and the stricter reading, so it is what this enforces.
 */
const monthlyCallCap = defineInt('API_BIBLE_MONTHLY_CAP', { default: 4_900 });

const API_BASE = 'https://api.scripture.api.bible/v1';
const FUMS_ENDPOINT = 'https://fums.api.bible/f3';

/**
 * How long a cached chapter may be served before it must be refetched.
 *
 * api.bible's licence page requires caches be cleared at least every 14 days;
 * their docs elsewhere say 30. This uses the stricter of the two published
 * numbers deliberately -- being wrong in this direction costs a few extra API
 * calls, being wrong in the other direction breaches the agreement.
 *
 * Keep in step with API_BIBLE_CACHE_TTL_MS in src/data.ts, which governs the
 * matching expiry on the device.
 */
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Flat collection so the scheduled purge below can sweep it with one query. */
const CACHE_COLLECTION = 'apiBibleCache';

function cacheDocId(apiBibleId: string, bookId: string, chapter: number): string {
  return `${apiBibleId}__${bookId}.${chapter}`;
}

/** Rolls at the start of each UTC month, matching the plan's billing window. */
function monthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

interface CachedChapter {
  apiBibleId: string;
  bookId: string;
  chapter: number;
  verses: Record<string, string>;
  verseCount: number;
  fetchedAt: Timestamp;
}

/**
 * Increments this month's counter and returns the new total, transactionally.
 *
 * Read-then-write without a transaction undercounts badly here: chapter
 * fetches arrive in bursts (opening a book, starting a plan), so concurrent
 * invocations would all read the same value and each write back one more than
 * it, losing most of the increments and letting the real cap slip past.
 *
 * Only ever called on a cache MISS -- a chapter served from cache costs
 * nothing and must not be counted, or the budget maths above collapses.
 */
async function reserveQuota(db: FirebaseFirestore.Firestore, cap: number): Promise<number> {
  const ref = db.doc(`apiBibleUsage/${monthKey()}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = (snap.exists ? (snap.data()?.queries as number | undefined) : 0) ?? 0;
    if (used >= cap) return used; // caller rejects; don't record a query never made
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
 *
 * UNRESOLVED: a FUMS token arrives only WITH an API response, so a chapter
 * served from the cache has no token to report and this is not called. That
 * means reported usage tracks cache misses, not reads -- which under-reports
 * to the publishers FUMS exists to inform. Caching is explicitly permitted by
 * the licence, so reporting on fetch is the only mechanically possible
 * reading, but confirm the intended behaviour with support@api.bible before
 * relying on it at any scale.
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
 * output format; nobody has yet run it on a real one. The logic is exercised
 * for gaps, leading front matter and empty input, but check a real chapter
 * before trusting this in anger -- same caveat the ESV adapter carries in
 * scripts/import-bible/README.md.
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
    // the app structurally inside api.bible's 500-consecutive-verse ceiling --
    // no single request can ever return more than one chapter.
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
    const cacheRef = db.collection(CACHE_COLLECTION).doc(cacheDocId(apiBibleId, bookId, chapter));

    // ── 1. Shared cache ──────────────────────────────────────────────────────
    // The whole call budget rests on this hit. Costs one Firestore read and
    // spends no API quota.
    const cached = await cacheRef.get();
    if (cached.exists) {
      const data = cached.data() as CachedChapter;
      const ageMs = Date.now() - data.fetchedAt.toMillis();
      if (ageMs < CACHE_TTL_MS) {
        return { verses: data.verses, verseCount: data.verseCount, cached: true };
      }
      // Expired. Delete now rather than leaving stale licensed text sitting in
      // Firestore if the refetch below fails -- the 14-day rule is about how
      // long text may be retained, not how long it may be served.
      await cacheRef.delete().catch(() => undefined);
    }

    // ── 2. Quota ─────────────────────────────────────────────────────────────
    const cap = monthlyCallCap.value();
    const used = await reserveQuota(db, cap);
    if (used >= cap) {
      logger.warn('api.bible monthly cap reached', { used, cap, month: monthKey() });
      throw new HttpsError(
        'resource-exhausted',
        "This month's scripture lookups are used up. Verses you've already opened still work; new ones will load again next month."
      );
    }

    // ── 3. Fetch ─────────────────────────────────────────────────────────────
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
      data?: { content?: string };
      meta?: { fumsId?: string };
    };

    const content = body.data?.content ?? '';
    const verses = parseVerses(content);
    const verseCount = Object.keys(verses).length;
    if (verseCount === 0) {
      logger.error('api.bible returned no parseable verses', { bookId, chapter, contentLength: content.length });
      throw new HttpsError('internal', 'Scripture came back in an unexpected format.');
    }

    if (body.meta?.fumsId) {
      await reportFums(body.meta.fumsId, deviceId, sessionId, request.auth.uid);
    }

    // ── 4. Populate the cache for everyone else ──────────────────────────────
    await cacheRef
      .set({ apiBibleId, bookId, chapter, verses, verseCount, fetchedAt: FieldValue.serverTimestamp() })
      .catch((err) => {
        // A failed cache write costs quota on the next reader but must not fail
        // this one, who already has their verses.
        logger.warn('cache write failed', { error: err instanceof Error ? err.message : String(err) });
      });

    return { verses, verseCount, cached: false };
  }
);

/**
 * Deletes cached chapters older than the TTL, daily.
 *
 * The read path already drops an expired entry when someone asks for it, but
 * that only ever touches chapters people still read. A chapter fetched once
 * and never opened again would otherwise sit in Firestore indefinitely, which
 * is exactly the retention the licence's "clear your cache at least every 14
 * days" clause forbids. This sweep is what makes that clause true for text
 * nobody is asking for.
 *
 * Batched at 400 (Firestore's limit is 500) with a bounded number of passes,
 * so one run can't turn into an unbounded delete loop.
 */
export const purgeApiBibleCache = onSchedule(
  { region: 'us-east1', schedule: 'every 24 hours', timeoutSeconds: 540 },
  async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(Date.now() - CACHE_TTL_MS);
    let deleted = 0;

    for (let pass = 0; pass < 25; pass++) {
      const stale = await db
        .collection(CACHE_COLLECTION)
        .where('fetchedAt', '<', cutoff)
        .limit(400)
        .get();
      if (stale.empty) break;

      const batch = db.batch();
      stale.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += stale.size;
      if (stale.size < 400) break;
    }

    logger.info('api.bible cache purge complete', { deleted, ttlDays: CACHE_TTL_MS / 86_400_000 });
  }
);
