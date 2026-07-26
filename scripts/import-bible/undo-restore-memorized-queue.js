#!/usr/bin/env node
// Undoes restore-memorized-queue.js: deletes the memoryQueue documents it
// created (status 'retained', zero review history) so the user can re-add
// them manually with correct daily/weekly/monthly phases instead.
//
// Safety: only deletes a memoryQueue doc if ALL of the following hold --
//   * it matches a `verses` doc marked 'memorized' (same identity check as
//     the restore script: book+chapter+verseNumber+translationId)
//   * status === 'retained', retentionPhase === 'none' (what the restore
//     script set)
//   * totalSuccessfulReviews === 0, currentStreakCount === 0,
//     reviewsToday === 0, (touchLogs || []).length === 0 -- i.e. genuinely
//     untouched since creation, so this can't delete real review progress
//     the user racked up in the meantime.
//
// Usage:
//   node undo-restore-memorized-queue.js --uid <UID>            # dry run
//   node undo-restore-memorized-queue.js --uid <UID> --apply    # delete

const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const firebaseConfig = require('../../firebase-applet-config.json');

const DEFAULT_TRANSLATION = 'ESV';

function parseArgs() {
  const args = process.argv.slice(2);
  const uidIdx = args.indexOf('--uid');
  return {
    apply: args.includes('--apply'),
    uid: uidIdx >= 0 ? args[uidIdx + 1] : null,
  };
}

const identityKey = (translationId, book, chapter, verseNumber) =>
  `${translationId}|${book}|${chapter}|${verseNumber}`;

async function main() {
  const opts = parseArgs();
  if (!opts.uid) {
    throw new Error('Missing --uid <UID>.');
  }

  const app = admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const versesSnap = await db.collection(`users/${opts.uid}/verses`).get();
  const queueSnap = await db.collection(`users/${opts.uid}/memoryQueue`).get();

  const memorizedIdentities = new Set();
  versesSnap.forEach((doc) => {
    const d = doc.data();
    if (d.status === 'memorized') {
      memorizedIdentities.add(identityKey(DEFAULT_TRANSLATION, d.book, d.chapter, d.verse));
    }
  });

  const toDelete = [];
  const skippedTouched = [];

  queueSnap.forEach((doc) => {
    const d = doc.data();
    const translationId = d.translationId || DEFAULT_TRANSLATION;
    const verseNumber = d.verseNumber !== undefined ? d.verseNumber : d.verse;
    const key = identityKey(translationId, d.book, d.chapter, verseNumber);

    if (!memorizedIdentities.has(key)) return;
    if (d.status !== 'retained' || d.retentionPhase !== 'none') return;

    const untouched =
      (d.totalSuccessfulReviews || 0) === 0 &&
      (d.currentStreakCount || 0) === 0 &&
      (d.reviewsToday || 0) === 0 &&
      (d.touchLogs || []).length === 0;

    if (!untouched) {
      skippedTouched.push(`${d.book} ${d.chapter}:${verseNumber} (has review activity -- not touching)`);
      return;
    }

    toDelete.push({ ref: doc.ref, book: d.book, chapter: d.chapter, verseNumber });
  });

  if (skippedTouched.length > 0) {
    console.log(`\nSkipped ${skippedTouched.length} verse(s) with review activity since restore -- leaving those alone:`);
    skippedTouched.forEach((s) => console.log(`  ${s}`));
  }

  const byChapter = new Map();
  toDelete.forEach((item) => {
    const ref = `${item.book} ${item.chapter}`;
    if (!byChapter.has(ref)) byChapter.set(ref, []);
    byChapter.get(ref).push(item.verseNumber);
  });

  console.log(`\n=== WOULD DELETE ${toDelete.length} memoryQueue document(s) ===\n`);
  for (const [ref, verseNums] of byChapter) {
    const sorted = verseNums.slice().sort((a, b) => a - b);
    console.log(`  ${ref}:${sorted[0]}-${sorted[sorted.length - 1]}  (${sorted.length} verses)`);
  }

  if (!opts.apply) {
    console.log('\nDRY RUN -- nothing was deleted. Re-run with --apply to commit.\n');
    return;
  }

  if (toDelete.length === 0) {
    console.log('\nNothing to delete.\n');
    return;
  }

  const CHUNK = 400;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const batch = db.batch();
    for (const item of toDelete.slice(i, i + CHUNK)) {
      batch.delete(item.ref);
    }
    await batch.commit();
    deleted += Math.min(CHUNK, toDelete.length - i);
    console.log(`  deleted ${deleted}/${toDelete.length}`);
  }

  console.log(`\nDone. Deleted ${deleted} memoryQueue document(s). The 'verses' mirror is untouched, so you can re-add these manually.\n`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message, '\n');
  process.exit(1);
});
