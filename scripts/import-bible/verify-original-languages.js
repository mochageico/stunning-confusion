#!/usr/bin/env node
// Dry-run verifier for adapters/originalLanguages.js -- touches no database.
//
//   node verify-original-languages.js            # full report
//   node verify-original-languages.js --show "Psalms 51"   # print one chapter
//
// Compares every chapter's verse numbers against the BSB (the app's default,
// so the reference both translations must agree on) and scans the output for
// characters that shouldn't survive cleanup. Needs the BSB USFX file next to
// this script (engbsb_usfx.xml -- see README.md) or BSB_USFX_PATH.

const fs = require('fs');
const path = require('path');
const { ALL_BIBLE_BOOKS } = require('./books');

process.env.LOCAL_BIBLE_JSON_PATH = process.env.BSB_USFX_PATH || path.join(__dirname, 'engbsb_usfx.xml');
const bsb = require('./adapters/localFile');
const orig = require('./adapters/originalLanguages');

const HEBREW_OK = /^[\u05B0-\u05BC\u05BF\u05C1\u05C2\u05C7\u05D0-\u05EA\u05BE\u05C3 ]+$/;
// Greek letters (basic + extended), combining marks, Greek and Latin punctuation.
const GREEK_OK = /^[\u0370-\u03FF\u1F00-\u1FFF\u0300-\u036F ,.;:\u00B7\u0387\u2019\u02BC\u2014()'-]+$/;

async function main() {
  const showIdx = process.argv.indexOf('--show');
  if (showIdx !== -1) {
    const ref = process.argv[showIdx + 1];
    const m = ref.match(/^(.+) (\d+)$/);
    const verses = await orig.fetchChapter(m[1], Number(m[2]));
    const extras = orig.chapterExtras(m[1], Number(m[2]));
    if (extras.headings) console.log('HEADINGS', extras.headings);
    for (const [v, t] of Object.entries(verses)) console.log(v, t);
    return;
  }

  const problems = [];
  const badChars = new Map();
  let chapters = 0;
  let verses = 0;
  let headings = 0;

  for (const book of ALL_BIBLE_BOOKS) {
    const ok = book.testament === 'ot' ? HEBREW_OK : GREEK_OK;
    const all = orig._internal.loadBook(book.name);
    const chapterNums = Object.keys(all).map(Number);
    const maxCh = Math.max(...chapterNums);
    if (maxCh !== book.chapters) problems.push(`${book.name}: ${maxCh} chapters, expected ${book.chapters}`);

    for (let ch = 1; ch <= book.chapters; ch++) {
      const ours = await orig.fetchChapter(book.name, ch);
      const theirs = await bsb.fetchChapter(book.name, ch);
      const extras = orig.chapterExtras(book.name, ch);
      if (extras.headings) {
        headings += 1;
        if (book.id !== 'PSA') problems.push(`${book.name} ${ch}: heading outside Psalms`);
      }
      chapters += 1;
      const a = Object.keys(ours).map(Number).sort((x, y) => x - y);
      const b = Object.keys(theirs).map(Number).sort((x, y) => x - y);
      verses += a.length;
      const onlyOurs = a.filter((v) => !b.includes(v));
      const onlyBsb = b.filter((v) => !a.includes(v));
      if (onlyOurs.length || onlyBsb.length) {
        problems.push(
          `${book.name} ${ch}: ours ${a.length} vs BSB ${b.length}` +
            (onlyOurs.length ? `; only ours: ${onlyOurs.join(',')}` : '') +
            (onlyBsb.length ? `; only BSB: ${onlyBsb.join(',')}` : '')
        );
      }
      for (const [v, t] of Object.entries(ours)) {
        if (!t) problems.push(`${book.name} ${ch}:${v}: empty`);
        if (!ok.test(t)) {
          for (const c of t) {
            if (!ok.test(c) && c !== ' ') {
              const k = `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} (${book.testament})`;
              if (!badChars.has(k)) badChars.set(k, `${book.name} ${ch}:${v}`);
            }
          }
        }
      }
    }
  }

  console.log(`${chapters} chapters, ${verses} verses, ${headings} chapters with Psalm headings`);
  console.log(`\nUnexpected characters (${badChars.size}):`);
  for (const [k, where] of badChars) console.log(`  ${k}  first at ${where}`);
  console.log(`\nVerse-number differences vs BSB (${problems.length}):`);
  problems.forEach((p) => console.log('  ' + p));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
