#!/usr/bin/env node
// Populates translations/{translationId}/books/{bookId}/chapters/{chapterNumber}
// in Firestore from a pluggable source adapter (see adapters/).
//
// Usage:
//   node run.js --adapter esv --book Genesis           # one book
//   node run.js --adapter esv                          # whole Bible
//   node run.js --adapter localFile --book "1 John"     # public-domain source
//
// Requires a Firebase service account key (Firestore Console > Project
// Settings > Service Accounts > Generate new private key) referenced via
// GOOGLE_APPLICATION_CREDENTIALS, plus whatever env vars the chosen adapter
// needs (see adapters/esv.js / adapters/localFile.js).

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { ALL_BIBLE_BOOKS } = require('./books');
const firebaseConfig = require('../../firebase-applet-config.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { adapter: 'esv', book: null, delayMs: 350, force: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--adapter') opts.adapter = args[++i];
    else if (args[i] === '--book') opts.book = args[++i];
    else if (args[i] === '--delay-ms') opts.delayMs = Number(args[++i]);
    else if (args[i] === '--force') opts.force = true; // re-fetch even chapters already in Firestore
  }
  return opts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const opts = parseArgs();
  const adapter = require(`./adapters/${opts.adapter}`);

  // This project uses a non-default named Firestore database (the same one
  // the app itself connects to via firebaseConfig.firestoreDatabaseId in
  // src/firebase.ts) — admin.firestore() alone targets "(default)"
  // and would fail with NOT_FOUND since that database was never provisioned.
  const app = admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const books = opts.book ? ALL_BIBLE_BOOKS.filter((b) => b.name === opts.book) : ALL_BIBLE_BOOKS;
  if (opts.book && books.length === 0) {
    throw new Error(`Unknown book "${opts.book}". Check spelling against books.js.`);
  }

  await db.doc(`translations/${adapter.id}`).set({
    id: adapter.id,
    name: adapter.name,
    isPublicDomain: adapter.isPublicDomain,
    importedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let totalChapters = 0;
  let totalVerses = 0;
  let skipped = 0;

  for (const book of books) {
    console.log(`\n${book.name} (${book.chapters} chapters)`);
    for (let chapter = 1; chapter <= book.chapters; chapter++) {
      const docRef = db.doc(`translations/${adapter.id}/books/${book.id}/chapters/${chapter}`);

      // Resumable: skip chapters already imported, so a rate-limit failure
      // partway through doesn't mean re-fetching (and re-spending API quota
      // on) everything before it — just re-run the same command.
      if (!opts.force) {
        const existing = await docRef.get();
        if (existing.exists) {
          skipped += 1;
          continue;
        }
      }

      const verses = await adapter.fetchChapter(book.name, chapter);
      const verseCount = Object.keys(verses).length;

      if (verseCount === 0) {
        console.warn(`  ! ${book.name} ${chapter}: adapter returned no verses — skipping write`);
      } else {
        await docRef.set({
          translationId: adapter.id,
          bookId: book.id,
          book: book.name,
          chapter,
          verses,
          verseCount,
        });
        totalChapters += 1;
        totalVerses += verseCount;
        console.log(`  ✓ ${book.name} ${chapter}: ${verseCount} verses`);
      }

      if (opts.delayMs) await sleep(opts.delayMs);
    }
  }

  console.log(
    `\nDone. Wrote ${totalChapters} chapters / ${totalVerses} verses to translations/${adapter.id} (${skipped} already-imported chapters skipped).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
