// Writes work/text.json for align.py: for every audio file (one per HEBREW
// chapter), the WLC verses it should contain, in Hebrew numbering, as the
// cleaned text the app stores. Also writes work/english-map.json: for every
// ENGLISH chapter, which WLC verses make up each English verse and heading,
// so build-timings.js can turn Hebrew-verse times into English-verse times.
//
// Both come from the same importer that produced translations/HEBGRK, so the
// renumbering can never drift from the text the app shows.
//
//   node scripts/hebrew-audio/export-text.js

const fs = require('fs');
const path = require('path');
const adapter = require('../import-bible/adapters/originalLanguages');
const { ALL_BIBLE_BOOKS } = require('../import-bible/books');

const { loadBook, parseWlcBook, cleanHebrewVerse, OSIS_BY_APP_ID, PARTIAL_SPLITS } = adapter._internal;
const WORK = path.join(__dirname, 'work');

// Same word cut as the app (maqaf splits words), so a split index here means
// the same thing everywhere.
const words = (text) => text.split(/[\s־]+/).filter(Boolean);
const bareConsonants = (w) => w.replace(/[֑-ׇ]/g, '');

const files = {}; // "GEN_1" (Hebrew chapter) -> [{ ref, text }]
const english = {}; // "GEN_1" (English chapter) -> { verses: {v: [ref]}, headings: {v: [ref]} }
const splits = {}; // WLC ref -> number of words in its first part

for (const book of ALL_BIBLE_BOOKS.filter((b) => b.testament === 'ot')) {
  const osis = OSIS_BY_APP_ID[book.id];
  for (const { ch, v, xml } of parseWlcBook(osis)) {
    (files[`${book.id}_${ch}`] = files[`${book.id}_${ch}`] || []).push({ ref: `${osis}.${ch}.${v}`, text: cleanHebrewVerse(xml) });
  }
  for (const [ch, c] of Object.entries(loadBook(book.name))) {
    english[`${book.id}_${ch}`] = { verses: c.sources, headings: c.headingSources };
  }
}

for (const [ref, { at }] of Object.entries(PARTIAL_SPLITS)) {
  const [osis, ch] = ref.split('.');
  const bookId = Object.keys(OSIS_BY_APP_ID).find((id) => OSIS_BY_APP_ID[id] === osis);
  const verse = files[`${bookId}_${ch}`].find((x) => x.ref === ref);
  const idx = words(verse.text).findIndex((w) => bareConsonants(w) === at.split('־')[0]);
  if (idx <= 0) throw new Error(`split word ${at} not found in ${ref}`);
  splits[ref] = idx;
}

fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'text.json'), JSON.stringify(files));
fs.writeFileSync(path.join(WORK, 'english-map.json'), JSON.stringify({ chapters: english, splits }));
console.log(`${Object.keys(files).length} Hebrew chapters, ${Object.keys(english).length} English chapters, splits:`, splits);
