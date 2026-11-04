// Writes work/text.json for align.py: for every chapter file, what Souer
// reads, in order --
//
//   titles      the spoken chapter title's accepted forms. Every file opens
//               with one ("Genesis 1." / "Matthew chapter 1." / "Philemon"),
//               and Psalm 1 opens "Psalms, Psalm 1.";
//   psalmTitle  the Psalm superscription (USFX <d>), read straight after the
//               chapter title, or null;
//   verses      [{ v, text }], the BSB verses exactly as the app stores them.
//
// The verses come from the same adapter the importer used on the same USFX
// file, so they can't drift from what users see. Section headings,
// cross-references, Psalm 119's stanza names and the Psalms book divisions
// aren't read (BSB_AUDIO_PLAN.md, stage 0), so they're left out.
//
//   node scripts/bsb-audio/export-text.js

const fs = require('fs');
const path = require('path');

const USFX = path.join(__dirname, '..', 'import-bible', 'engbsb_usfx.xml');
process.env.LOCAL_BIBLE_JSON_PATH = USFX;
const adapter = require('../import-bible/adapters/localFile');
const { ALL_BIBLE_BOOKS } = require('../import-bible/books');

const { stripFootnotesAndTags } = adapter._internal;
const WORK = path.join(__dirname, 'work');
const manifest = require('./sources/manifest.json');

/**
 * "PSA" -> { "3": "<d> text", ... } for <d> elements wholly before a chapter's
 * first verse. Zechariah 12's <d> holds the verse 1 marker, so it's verse text
 * (and read once), and cutting at the first marker leaves it out.
 */
function psalmTitles(xml, bookId) {
  const book = new RegExp(`<book id="${bookId}">([\\s\\S]*?)</book>`).exec(xml)[1];
  const parts = book.split(/<c id="(\d+)"[^>]*\/>/);
  const out = {};
  for (let i = 1; i < parts.length; i += 2) {
    const beforeV1 = parts[i + 1].split(/<v id="/)[0];
    const d = /<d\b[^>]*>([\s\S]*?)<\/d>/.exec(beforeV1);
    if (d) out[parts[i]] = stripFootnotesAndTags(d[1]);
  }
  return out;
}

function spokenTitles(book, ch) {
  if (book.id === 'PSA') return ch === 1 ? [`Psalms Psalm ${ch}`, `Psalm ${ch}`] : [`Psalm ${ch}`];
  const forms = [`${book.name} ${ch}`, `${book.name} chapter ${ch}`];
  return book.chapters === 1 ? [book.name, ...forms] : forms;
}

async function main() {
  const xml = fs.readFileSync(USFX, 'utf8');
  const fileFor = new Map(manifest.map((f) => [`${f.bookId}_${f.chapter}`, f.name]));
  const out = {};
  let verses = 0;
  let titled = 0;
  for (const book of ALL_BIBLE_BOOKS) {
    const titles = psalmTitles(xml, book.id);
    for (let ch = 1; ch <= book.chapters; ch++) {
      const key = `${book.id}_${ch}`;
      const text = await adapter.fetchChapter(book.name, ch);
      const list = Object.keys(text)
        .map(Number)
        .sort((a, b) => a - b)
        .map((v) => ({ v, text: text[v] }));
      if (!list.length) throw new Error(`${key}: no verses`);
      if (!fileFor.has(key)) throw new Error(`${key}: no audio file in sources/manifest.json`);
      const psalmTitle = titles[ch] || null;
      out[key] = { file: fileFor.get(key), titles: spokenTitles(book, ch), psalmTitle, verses: list };
      verses += list.length;
      if (psalmTitle) titled++;
    }
  }
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(path.join(WORK, 'text.json'), JSON.stringify(out));
  console.log(`${Object.keys(out).length} chapters, ${verses} verses, ${titled} Psalm titles`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
