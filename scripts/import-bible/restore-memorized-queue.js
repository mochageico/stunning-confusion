#!/usr/bin/env node
// One-off recovery: rebuilds missing users/{uid}/memoryQueue documents from
// the users/{uid}/verses mirror.
//
// Background: memoryQueue is the app's source of truth for "have I memorized
// this?" (see memorizedCount in src/state/useAppState.ts, which filters the
// queue for status === 'retained'). The `verses` collection is a write-only
// mirror that no screen actually renders. When a batch of memoryQueue docs
// for already-memorized verses went missing, `verses` was the only surviving
// copy of book/chapter/verse/text -- this script reads it back and recreates
// the corresponding queue items with status 'retained'.
//
// Safety:
//   * Dry run by default -- prints exactly what it would create, writes nothing.
//   * Never overwrites an existing queue item. Matching is by
//     book+chapter+verseNumber+translationId (NOT by document id), so legacy
//     translation-less ids like "GEN_1_14" are recognized and skipped rather
//     than duplicated under "ESV_GEN_1_14".
//   * Only considers `verses` docs whose status is 'memorized'.
//
// What cannot be recovered: per-verse review history (totalSuccessfulReviews,
// currentStreakCount, touchLogs). The `verses` mirror never stored it. Those
// are written as a clean slate rather than invented, so the activity heatmap
// and streak stay honest.
//
// Usage:
//   node restore-memorized-queue.js --uid <UID>            # dry run
//   node restore-memorized-queue.js --uid <UID> --apply    # actually writes

const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const { ALL_BIBLE_BOOKS } = require('./books');
const firebaseConfig = require('../../firebase-applet-config.json');

// Mirrors buildVerseId() in src/state/useAppState.ts.
const buildVerseId = (translationId, bookId, chapter, verse) =>
  `${translationId}_${bookId}_${chapter}_${verse}`;

// Same default loadUserData applies to docs written before translations
// existed: they were always ESV.
const DEFAULT_TRANSLATION = 'ESV';

const BOOK_ID_BY_NAME = new Map(ALL_BIBLE_BOOKS.map((b) => [b.name, b.id]));

function parseArgs() {
  const args = process.argv.slice(2);
  const uidIdx = args.indexOf('--uid');
  return {
    apply: args.includes('--apply'),
    uid: uidIdx >= 0 ? args[uidIdx + 1] : null,
  };
}

// Key a verse by its identity rather than its document id, so a legacy
// "GEN_1_14" and a modern "ESV_GEN_1_14" collapse to the same slot.
const identityKey = (translationId, book, chapter, verseNumber) =>
  `${translationId}|${book}|${chapter}|${verseNumber}`;

async function main() {
  const opts = parseArgs();
  if (!opts.uid) {
    throw new Error('Missing --uid <UID>. Find it in Firebase Console > Authentication.');
  }

  const app = admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const versesSnap = await db.collection(`users/${opts.uid}/verses`).get();
  const queueSnap = await db.collection(`users/${opts.uid}/memoryQueue`).get();

  console.log(`\nverses docs:      ${versesSnap.size}`);
  console.log(`memoryQueue docs: ${queueSnap.size}\n`);

  if (versesSnap.empty) {
    throw new Error('No `verses` documents found -- nothing to restore from. Check the uid.');
  }

  // Existing queue identities, plus the highest orderIndex so restored items
  // append after everything already queued instead of fighting for position.
  const existingIdentities = new Set();
  let maxOrderIndex = -1;
  queueSnap.forEach((doc) => {
    const d = doc.data();
    const translationId = d.translationId || DEFAULT_TRANSLATION;
    const verseNumber = d.verseNumber !== undefined ? d.verseNumber : d.verse;
    existingIdentities.add(identityKey(translationId, d.book, d.chapter, verseNumber));
    if (typeof d.orderIndex === 'number' && d.orderIndex > maxOrderIndex) {
      maxOrderIndex = d.orderIndex;
    }
  });

  const toCreate = [];
  const skippedExisting = [];
  const skippedNotMemorized = [];
  const unknownBooks = new Set();

  versesSnap.forEach((doc) => {
    const d = doc.data();

    if (d.status !== 'memorized') {
      skippedNotMemorized.push(`${d.book} ${d.chapter}:${d.verse} (status: ${d.status})`);
      return;
    }

    const bookId = BOOK_ID_BY_NAME.get(d.book);
    if (!bookId) {
      unknownBooks.add(d.book);
      return;
    }

    const key = identityKey(DEFAULT_TRANSLATION, d.book, d.chapter, d.verse);
    if (existingIdentities.has(key)) {
      skippedExisting.push(`${d.book} ${d.chapter}:${d.verse}`);
      return;
    }
    // Guard against duplicate `verses` docs for the same reference.
    existingIdentities.add(key);

    // Preserve whatever timestamp the mirror recorded, so restored verses
    // don't all claim to have been started the moment this script ran.
    const updatedAt = d.updatedAt && typeof d.updatedAt.toDate === 'function'
      ? d.updatedAt.toDate().toISOString()
      : new Date().toISOString();

    toCreate.push({
      verseId: buildVerseId(DEFAULT_TRANSLATION, bookId, d.chapter, d.verse),
      translationId: DEFAULT_TRANSLATION,
      book: d.book,
      chapter: d.chapter,
      verseNumber: d.verse,
      text: d.text || '',
      orderIndex: 0, // assigned below, after sorting
      // 'retained' is what memorizedCount filters on, and what the chapter
      // view maps to a "memorized / Completed" badge.
      status: 'retained',
      retentionPhase: 'none',
      origin: 'individual',
      dateStarted: updatedAt,
      lastReviewDate: updatedAt,
      nextReviewDueDate: null,
      currentStreakCount: 0,
      totalSuccessfulReviews: 0,
      gracePeriodUsedToday: false,
      graceMissesUsed: 0,
      dailyPhaseExtensionDays: 0,
      refresherActive: false,
      touchLogs: [],
      reviewsToday: 0,
    });
  });

  toCreate.sort((a, b) => {
    if (a.book !== b.book) return a.book.localeCompare(b.book);
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.verseNumber - b.verseNumber;
  });
  toCreate.forEach((item, i) => {
    item.orderIndex = maxOrderIndex + 1 + i;
  });

  if (unknownBooks.size > 0) {
    console.log(`WARNING -- unrecognized book names, skipped: ${[...unknownBooks].join(', ')}\n`);
  }
  if (skippedNotMemorized.length > 0) {
    console.log(`Skipped ${skippedNotMemorized.length} verse(s) not marked memorized.`);
  }
  if (skippedExisting.length > 0) {
    console.log(`Skipped ${skippedExisting.length} verse(s) already present in memoryQueue.`);
  }

  // Group into readable reference ranges instead of listing every verse.
  const byChapter = new Map();
  toCreate.forEach((item) => {
    const ref = `${item.book} ${item.chapter}`;
    if (!byChapter.has(ref)) byChapter.set(ref, []);
    byChapter.get(ref).push(item.verseNumber);
  });

  console.log(`\n=== WOULD CREATE ${toCreate.length} memoryQueue document(s), status 'retained' ===\n`);
  for (const [ref, verseNums] of byChapter) {
    const sorted = verseNums.slice().sort((a, b) => a - b);
    console.log(`  ${ref}:${sorted[0]}-${sorted[sorted.length - 1]}  (${sorted.length} verses)`);
  }

  if (!opts.apply) {
    console.log('\nDRY RUN -- nothing was written. Re-run with --apply to commit.\n');
    return;
  }

  if (toCreate.length === 0) {
    console.log('\nNothing to create.\n');
    return;
  }

  // Firestore caps a batch at 500 writes.
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const batch = db.batch();
    for (const item of toCreate.slice(i, i + CHUNK)) {
      // .create() (not .set()) so an unexpected pre-existing document causes
      // a loud failure instead of silently clobbering real progress.
      batch.create(db.doc(`users/${opts.uid}/memoryQueue/${item.verseId}`), item);
    }
    await batch.commit();
    written += Math.min(CHUNK, toCreate.length - i);
    console.log(`  committed ${written}/${toCreate.length}`);
  }

  console.log(`\nDone. Created ${written} memoryQueue document(s).\n`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message, '\n');
  process.exit(1);
});
