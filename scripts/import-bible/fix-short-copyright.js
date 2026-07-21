#!/usr/bin/env node
// One-off cleanup: strips a stray trailing "(ESV)" (or a full copyright
// paragraph) left on the last verse of already-imported chapters, caused by
// the ESV API's include-short-copyright/include-copyright params defaulting
// to true before adapters/esv.js started disabling them. Only rewrites verse
// text -- doesn't re-fetch from the ESV API, so it's fast and costs no API
// quota. Safe to re-run; a chapter with nothing to strip is left untouched.
//
// Usage:
//   node fix-short-copyright.js              # dry run, reports what it would change
//   node fix-short-copyright.js --apply       # actually writes the fixes
//   node fix-short-copyright.js --apply --book Genesis   # limit to one book

const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const { ALL_BIBLE_BOOKS } = require('./books');
const firebaseConfig = require('../../firebase-applet-config.json');

// Matches a trailing short citation ("(ESV)") or the full copyright
// paragraph Crossway's API can append, with any leading whitespace.
const TRAILING_CITATION_RE = /\s*\(ESV\)\s*$/;
const TRAILING_COPYRIGHT_RE = /\s*\(?Scripture quotations are from the ESV[\s\S]*$/i;

function stripTrailingCitation(text) {
  let cleaned = text.replace(TRAILING_COPYRIGHT_RE, '').trimEnd();
  cleaned = cleaned.replace(TRAILING_CITATION_RE, '').trimEnd();
  return cleaned;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    book: (() => {
      const i = args.indexOf('--book');
      return i >= 0 ? args[i + 1] : null;
    })(),
  };
}

async function main() {
  const opts = parseArgs();
  const app = admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const books = opts.book ? ALL_BIBLE_BOOKS.filter((b) => b.name === opts.book) : ALL_BIBLE_BOOKS;
  if (opts.book && books.length === 0) {
    throw new Error(`Unknown book "${opts.book}". Check spelling against books.js.`);
  }

  let scanned = 0;
  let changedChapters = 0;
  let changedVerses = 0;

  for (const book of books) {
    for (let chapter = 1; chapter <= book.chapters; chapter++) {
      const docRef = db.doc(`translations/ESV/books/${book.id}/chapters/${chapter}`);
      const snap = await docRef.get();
      if (!snap.exists) continue;
      scanned += 1;

      const data = snap.data();
      const verses = data.verses || {};
      let chapterChanged = false;
      const nextVerses = { ...verses };

      for (const [verseNum, text] of Object.entries(verses)) {
        const cleaned = stripTrailingCitation(text);
        if (cleaned !== text) {
          console.log(`  ${book.name} ${chapter}:${verseNum}`);
          console.log(`    before: ...${text.slice(-60)}`);
          console.log(`    after:  ...${cleaned.slice(-60)}`);
          nextVerses[verseNum] = cleaned;
          chapterChanged = true;
          changedVerses += 1;
        }
      }

      if (chapterChanged) {
        changedChapters += 1;
        if (opts.apply) {
          await docRef.update({ verses: nextVerses });
        }
      }
    }
  }

  console.log(
    `\n${opts.apply ? 'Applied' : 'Would apply'} fixes to ${changedVerses} verse(s) across ${changedChapters} chapter(s) (${scanned} chapters scanned).`
  );
  if (!opts.apply && changedChapters > 0) {
    console.log('Re-run with --apply to write these changes.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
