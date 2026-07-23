// Adapter for public-domain translations, reading from a local bulk dataset
// file instead of scraping a live API. (bible-api.com's own terms explicitly
// say "Users must not download entire Bibles via the API" — its live endpoint
// is meant for on-demand single lookups, not a bulk import like this script
// does, so we deliberately don't call it here.)
//
// Bring your own dataset. Two real formats are supported, auto-detected by
// file extension (or forced via LOCAL_BIBLE_FORMAT):
//
// - scrollmapper-json (.json) — https://github.com/scrollmapper/bible_databases
//   `formats/json/<CODE>.json`, shape: { books: [{ name, chapters: [{ chapter,
//   verses: [{ verse, text }] }] }] }. Has KJV but NOT the World English Bible
//   (its "Webster.json"/"RWebster.json" are Noah Webster's 1833 revision, a
//   different public-domain translation entirely — do not confuse the two).
//   Book names use "I/II/III <Book>" and "Revelation of John" instead of this
//   app's "1/2/3 <Book>" and "Revelation" — normalized in bookNameVariants().
//
// - usfx-xml (.xml) — e.g. https://github.com/seven1m/open-bibles
//   (`eng-web.usfx.xml`, `eng-kjv.osis.xml` is OSIS not USFX — get KJV from
//   scrollmapper instead, WEB from here), or directly from eBible.org (the
//   WEB's own publisher) via an eng-web USFX/USFM download. Chapters/verses
//   are self-closing markers (`<c id="1"/>`, `<v id="1"/>...<ve/>`) inside a
//   `<book id="GEN">` element, using this app's own 3-letter book ids
//   (see ../books.js) — no name-mapping needed for this format. Footnotes
//   (`<f>...</f>`) are stripped out; they're translator commentary, not text.
//
// Both parsers were verified against real downloaded files before this
// adapter was written (Genesis 1 = 31 verses, Psalms 119 = 176 verses, John
// 3:16 text spot-checked) — not just written against the format spec.

const fs = require('fs');
const path = require('path');
const { ALL_BIBLE_BOOKS } = require('../books');

let cachedIndex = null; // { format, data } -- data keyed by book NAME (scrollmapper-json) or book ID (usfx-xml)

function stripFootnotesAndTags(str) {
  // Footnote spans carry real prose (translator commentary) inside the tag,
  // not just markup -- must strip the content too, not only the tags.
  let out = str.replace(/<f\b[^>]*>[\s\S]*?<\/f>/g, '');
  // Any other inline formatting tag (<add>, <it>, <w>, etc.) -- strip the
  // tag, keep its text content.
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function parseUsfxXml(xml) {
  const index = {};
  const bookRe = /<book id="([A-Z0-9]{3})">([\s\S]*?)<\/book>/g;
  let bookMatch;
  while ((bookMatch = bookRe.exec(xml))) {
    const bookId = bookMatch[1];
    const bookContent = bookMatch[2];
    const chapters = {};
    // Splitting on the chapter marker turns the stream into alternating
    // [ignored front matter, chapterNum, content, chapterNum, content, ...].
    const chapterParts = bookContent.split(/<c id="(\d+)"\s*\/>/);
    for (let i = 1; i < chapterParts.length; i += 2) {
      const chapterNum = chapterParts[i];
      const chapterContent = chapterParts[i + 1] || '';
      const verses = {};
      const verseParts = chapterContent.split(/<v id="(\d+)"\s*\/>/);
      for (let j = 1; j < verseParts.length; j += 2) {
        const verseNum = verseParts[j];
        let verseText = verseParts[j + 1] || '';
        const veIdx = verseText.indexOf('<ve');
        if (veIdx !== -1) verseText = verseText.slice(0, veIdx);
        verses[verseNum] = stripFootnotesAndTags(verseText);
      }
      chapters[chapterNum] = verses;
    }
    index[bookId] = chapters;
  }
  return index;
}

function parseScrollmapperJson(json) {
  const index = {};
  for (const book of json.books) {
    const chapters = {};
    for (const ch of book.chapters) {
      const verses = {};
      for (const v of ch.verses) {
        verses[String(v.verse)] = v.text;
      }
      chapters[String(ch.chapter)] = verses;
    }
    index[book.name] = chapters;
  }
  return index;
}

// This app's canonical book name -> scrollmapper's naming convention.
// Verified to cover all 66 books against a real downloaded KJV.json before
// this adapter was written (see plan verification notes).
function toScrollmapperName(appBookName) {
  if (appBookName === 'Revelation') return 'Revelation of John';
  return appBookName.replace(/^1 /, 'I ').replace(/^2 /, 'II ').replace(/^3 /, 'III ');
}

function loadIndex() {
  if (cachedIndex) return cachedIndex;
  const filePath = process.env.LOCAL_BIBLE_JSON_PATH;
  if (!filePath) {
    throw new Error(
      'LOCAL_BIBLE_JSON_PATH environment variable is not set. Point it at a downloaded dataset file (.json or .xml -- see comment at top of this file).'
    );
  }
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  const format = process.env.LOCAL_BIBLE_FORMAT || (resolved.toLowerCase().endsWith('.xml') ? 'usfx-xml' : 'scrollmapper-json');

  if (format === 'usfx-xml') {
    cachedIndex = { format, data: parseUsfxXml(raw) };
  } else if (format === 'scrollmapper-json') {
    cachedIndex = { format, data: parseScrollmapperJson(JSON.parse(raw)) };
  } else {
    throw new Error(`Unknown LOCAL_BIBLE_FORMAT "${format}" -- expected "usfx-xml" or "scrollmapper-json".`);
  }
  return cachedIndex;
}

async function fetchChapter(bookName, chapterNumber) {
  const { format, data } = loadIndex();
  let chapters;
  if (format === 'usfx-xml') {
    const book = ALL_BIBLE_BOOKS.find((b) => b.name === bookName);
    chapters = book ? data[book.id] : undefined;
  } else {
    chapters = data[toScrollmapperName(bookName)];
  }
  return (chapters && chapters[String(chapterNumber)]) || {};
}

module.exports = {
  fetchChapter,
  id: process.env.LOCAL_BIBLE_TRANSLATION_ID || 'WEB',
  name: process.env.LOCAL_BIBLE_TRANSLATION_NAME || 'World English Bible',
  isPublicDomain: true,
};
