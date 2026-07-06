// Adapter for public-domain translations, reading from a local bulk dataset
// file instead of scraping a live API. (bible-api.com's own terms explicitly
// say "Users must not download entire Bibles via the API" — its live endpoint
// is meant for on-demand single lookups, not a bulk import like this script
// does, so we deliberately don't call it here.)
//
// Bring your own dataset: several open-source repositories host complete
// public-domain translations (WEB, KJV, ASV, etc.) as bulk JSON specifically
// intended for this kind of use — for example the source data behind
// bible-api.com itself (https://github.com/seven1m/bible_api), or
// https://github.com/scrollmapper/bible_databases. Download one, and point
// LOCAL_BIBLE_JSON_PATH at it.
//
// Expected input file shape (adjust `extractVerses` below to match whatever
// dataset you actually download — formats vary):
// [
//   { book: "Genesis", chapter: 1, verse: 1, text: "..." },
//   ...
// ]

const fs = require('fs');
const path = require('path');

let cachedRows = null;

function loadDataset() {
  if (cachedRows) return cachedRows;
  const filePath = process.env.LOCAL_BIBLE_JSON_PATH;
  if (!filePath) {
    throw new Error(
      'LOCAL_BIBLE_JSON_PATH environment variable is not set. Point it at a downloaded public-domain Bible dataset JSON file (see comment at top of this file).'
    );
  }
  const raw = fs.readFileSync(path.resolve(filePath), 'utf-8');
  cachedRows = JSON.parse(raw);
  return cachedRows;
}

async function fetchChapter(bookName, chapterNumber) {
  const rows = loadDataset();
  const verses = {};
  for (const row of rows) {
    if (row.book === bookName && Number(row.chapter) === Number(chapterNumber)) {
      verses[String(row.verse)] = row.text;
    }
  }
  return verses;
}

module.exports = {
  fetchChapter,
  id: process.env.LOCAL_BIBLE_TRANSLATION_ID || 'WEB',
  name: process.env.LOCAL_BIBLE_TRANSLATION_NAME || 'World English Bible',
  isPublicDomain: true,
};
