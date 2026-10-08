// Adapter for the app's "Hebrew/Greek" translation (id HEBGRK): one
// translation id, two source texts. Old Testament books come from the
// Westminster Leningrad Codex, New Testament books from the SBL Greek New
// Testament. See HEBREW_GREEK_PLAN.md at the repo root for the decisions
// behind every cleanup step below.
//
// Sources (both read from local downloads, never a live API):
//
// - Hebrew: the Open Scriptures Hebrew Bible's WLC, OSIS XML, one file per
//   book plus VerseMap.xml.
//     https://github.com/openscriptures/morphhb  (wlc/*.xml)
//   The WLC text is public domain; OSHB's own additions (morphology, lemmas)
//   are CC BY 4.0 but none of them are used here -- only the words.
//
// - Greek: SBLGNT plain text, one file per book, lines of
//   "John 3:16<TAB>Οὕτως γὰρ ...".
//     https://github.com/LogosBible/SBLGNT  (data/sblgnt/text/*.txt)
//   CC BY 4.0 since 2022-12-19 -- requires attribution, which the app shows
//   on New Testament chapters (see SBLGNT_COPYRIGHT in src/data.ts).
//
// Both are expected unzipped under ORIGINAL_LANGS_DIR (default ./sources):
//   sources/morphhb-master/wlc/Gen.xml ...
//   sources/SBLGNT-master/data/sblgnt/text/Matt.txt ...
//
// VERSIFICATION: the stored text uses English (KJV-style) verse numbers, not
// the Hebrew Bible's own, so the same reference opens the same verse in every
// translation (e.g. Hebrew Malachi 3:19 is stored as 4:1). OSHB's
// VerseMap.xml supplies the mapping. Psalm superscriptions, which the Hebrew
// numbers as verse 1 (sometimes 1-2), are pulled out into a separate
// per-chapter `headings` field instead of being glued onto English verse 1.

const fs = require('fs');
const path = require('path');
const { ALL_BIBLE_BOOKS } = require('../books');

const ROOT = path.resolve(process.env.ORIGINAL_LANGS_DIR || path.join(__dirname, '..', 'sources'));
const WLC_DIR = path.join(ROOT, 'morphhb-master', 'wlc');
const SBLGNT_DIR = path.join(ROOT, 'SBLGNT-master', 'data', 'sblgnt', 'text');

// App book id -> source file / OSIS book code.
const OSIS_BY_APP_ID = {
  GEN: 'Gen', EXO: 'Exod', LEV: 'Lev', NUM: 'Num', DEU: 'Deut', JOS: 'Josh', JDG: 'Judg',
  RUT: 'Ruth', '1SA': '1Sam', '2SA': '2Sam', '1KI': '1Kgs', '2KI': '2Kgs', '1CH': '1Chr',
  '2CH': '2Chr', EZR: 'Ezra', NEH: 'Neh', EST: 'Esth', JOB: 'Job', PSA: 'Ps', PRO: 'Prov',
  ECC: 'Eccl', SNG: 'Song', ISA: 'Isa', JER: 'Jer', LAM: 'Lam', EZK: 'Ezek', DAN: 'Dan',
  HOS: 'Hos', JOL: 'Joel', AMO: 'Amos', OBA: 'Obad', JON: 'Jonah', MIC: 'Mic', NAM: 'Nah',
  HAB: 'Hab', ZEP: 'Zeph', HAG: 'Hag', ZEC: 'Zech', MAL: 'Mal',
  MAT: 'Matt', MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts', ROM: 'Rom', '1CO': '1Cor',
  '2CO': '2Cor', GAL: 'Gal', EPH: 'Eph', PHP: 'Phil', COL: 'Col', '1TH': '1Thess',
  '2TH': '2Thess', '1TI': '1Tim', '2TI': '2Tim', TIT: 'Titus', PHM: 'Phlm', HEB: 'Heb',
  JAS: 'Jas', '1PE': '1Pet', '2PE': '2Pet', '1JN': '1John', '2JN': '2John', '3JN': '3John',
  JUD: 'Jude', REV: 'Rev',
};

// ── Hebrew cleanup ──────────────────────────────────────────────────────────

// Stripped from the stored text: cantillation accents (U+0591-U+05AF), meteg
// (U+05BD), paseq (U+05C0), the extraordinary upper/lower dots (U+05C4-5),
// inverted nun (U+05C6), and the combining grapheme joiner (U+034F) WLC uses
// only to pin the order of stacked marks. Vowel points, dagesh, shin/sin dots
// and qamats qatan stay -- the plan's "vowels only".
const HEBREW_STRIP_RE = /[\u0591-\u05AF\u05BD\u05C0\u05C4\u05C5\u05C6\u034F]/g;

/**
 * One OSHB <verse> element -> plain pointed text.
 *
 * Ketiv/qere: where the written consonants (ketiv) differ from what is read
 * (qere), OSHB gives the ketiv UNPOINTED and the qere fully pointed in a
 * <note type="variant">. A bare consonantal word in the middle of a pointed
 * verse is unreadable for a learner, so the qere is what's kept -- it is also
 * what's read aloud.
 */
function cleanHebrewVerse(xml) {
  let s = xml;
  // Qere replaces ketiv: drop the ketiv words, then unwrap the qere reading.
  s = s.replace(/<w type="x-ketiv"[^>]*>[\s\S]*?<\/w>/g, '');
  s = s.replace(/<note type="variant">[\s\S]*?<rdg type="x-qere">([\s\S]*?)<\/rdg>\s*<\/note>/g, ' $1 ');
  // Every other note (alternative accentuation, textual/exegetical remarks)
  // is commentary, not text.
  s = s.replace(/<note\b[^>]*>[\s\S]*?<\/note>/g, '');
  // Paragraph markers (פ / ס) and the inverted-nun marker are layout, not words.
  s = s.replace(/<seg type="x-(pe|samekh|reversednun)">[^<]*<\/seg>/g, ' ');
  s = s.replace(/<seg type="x-paseq">[^<]*<\/seg>/g, '');
  // Maqaf and sof pasuq attach to the preceding word with no space.
  s = s.replace(/\s*<seg type="x-maqqef">([^<]*)<\/seg>\s*/g, '$1');
  s = s.replace(/\s*<seg type="x-sof-pasuq">([^<]*)<\/seg>/g, '$1');
  // Large/small/suspended letters are scribal size variants of ordinary
  // letters inside a word -- keep the letter, lose the wrapper.
  s = s.replace(/<\/?seg\b[^>]*>/g, '');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  s = s.replace(/\//g, ''); // OSHB morpheme separators (בְּ/רֵאשִׁית)
  s = s.replace(HEBREW_STRIP_RE, '');
  // Tag removal above leaves spaces around the maqaf and before sof pasuq;
  // both bind tightly (עַל־הָאָרֶץ, הָאָרֶץ׃).
  s = s.replace(/\s*\u05BE\s*/g, '\u05BE').replace(/\s*\u05C3/g, '\u05C3');
  return s.replace(/\s+/g, ' ').trim();
}

function parseWlcBook(osis) {
  const xml = fs.readFileSync(path.join(WLC_DIR, `${osis}.xml`), 'utf-8');
  const verses = []; // [{ ch, v, xml }] in document order
  const re = /<verse osisID="[^.]+\.(\d+)\.(\d+)">([\s\S]*?)<\/verse>/g;
  let m;
  while ((m = re.exec(xml))) verses.push({ ch: Number(m[1]), v: Number(m[2]), xml: m[3] });
  return verses;
}

// ── Versification ───────────────────────────────────────────────────────────

let verseMapCache = null;
/** "Gen.32.1" -> "Gen.31.55", keyed by OSIS book. Partial (!a/!b) refs kept as-is. */
function loadVerseMap() {
  if (verseMapCache) return verseMapCache;
  const xml = fs.readFileSync(path.join(WLC_DIR, 'VerseMap.xml'), 'utf-8');
  const map = {};
  const re = /<verse wlc="([^"]+)" kjv="([^"]+)" type="(full|partial)"\/>/g;
  let m;
  while ((m = re.exec(xml))) map[m[1]] = { kjv: m[2], type: m[3] };
  verseMapCache = map;
  return map;
}

// VerseMap.xml has seven "partial" entries (refs ending !a/!b) where the
// Hebrew and KJV verse breaks fall mid-verse. The target here is the BSB's
// numbering, not the KJV's, and the BSB sides with the Hebrew in three of
// them (1 Kgs 18:33-34, 20:2-3, 22:21-22), so those entries are ignored and
// the Hebrew verse stays whole. 1 Kgs 22:44 -> 22:43 is a whole-verse merge
// and goes through the ordinary mapping. That leaves two genuine splits,
// each cut at a named word checked by hand against the BSB's wording (not at
// the atnah: in the Psalms' poetic accent system the atnah is not the main
// divider, and Ps 13:6's sits after "I will sing to the LORD").
//   Isa 63:19b "Oh that you would rend the heavens" is English 64:1.
//   Ps 13:6b "I will sing to the LORD" is English 13:6; 6a is English 13:5.
// Keyed by WLC ref; `at` is the consonants of the word the second half starts
// with (consonants only, because stacked vowel marks can be stored in more
// than one order and a pointed literal here might not match byte-for-byte).
const PARTIAL_SPLITS = {
  'Isa.63.19': { at: 'לוא־קרעת', into: ['Isa.63.19', 'Isa.64.1'] },
  'Ps.13.6': { at: 'אשירה', into: ['Ps.13.5', 'Ps.13.6'] },
};

/**
 * Hebrew book -> { chapters: { [ch]: { verses: {v: text}, headings: {v: text} } } }
 * in English numbering.
 */
function buildHebrewBook(osis) {
  const map = loadVerseMap();
  const raw = parseWlcBook(osis);
  // Only whole-verse entries count; partial ones are handled by PARTIAL_SPLITS
  // or deliberately ignored (see above).
  const explicitTargets = new Set(
    Object.entries(map)
      .filter(([wlc]) => wlc.startsWith(`${osis}.`) && !wlc.includes('!'))
      .map(([, { kjv }]) => kjv.replace(/!.*/, ''))
  );

  // Resolve every WLC verse to one or more [kjvRef, text] pieces.
  const pieces = []; // { ch, v, text, wlc }
  for (const { ch, v, xml } of raw) {
    const wlc = `${osis}.${ch}.${v}`;
    const split = PARTIAL_SPLITS[wlc];
    if (split) {
      const [first, second] = splitAtWord(cleanHebrewVerse(xml), split.at, wlc);
      split.into.forEach((target, i) => {
        const [tch, tv] = target.split('.').slice(1).map(Number);
        pieces.push({ ch: tch, v: tv, text: i === 0 ? first : second, wlc });
      });
      continue;
    }
    const entry = map[wlc];
    let target;
    // (Partial "!a"/"!b" entries are keyed with the suffix, so map[wlc] never
    // finds them -- the three the BSB doesn't follow fall through to identity.)
    if (entry) {
      target = entry.kjv.replace(/!.*/, '');
    } else {
      target = wlc;
      // In the Psalms, an unmapped WLC verse whose identity target is also
      // some other verse's explicit target is a superscription (VerseMap
      // leaves Ps.3.1 unmapped while mapping Ps.3.2 -> Ps.3.1). Elsewhere the
      // same collision is a real merge -- e.g. Hebrew Num 25:19 + 26:1 are
      // English 26:1 -- and falls through to be joined in document order.
      if (osis === 'Ps' && explicitTargets.has(wlc)) {
        pieces.push({ ch, v: 1, text: cleanHebrewVerse(xml), wlc, heading: true, collidesWith: wlc });
        continue;
      }
    }
    const [, tch, tv] = target.split('.');
    pieces.push({ ch: Number(tch), v: Number(tv), text: cleanHebrewVerse(xml), wlc });
  }

  const chapters = {};
  const get = (ch) => (chapters[ch] = chapters[ch] || { verses: {}, headings: {}, sources: {} });
  // Group by target verse, in document order.
  const byTarget = new Map();
  for (const p of pieces) {
    const key = `${p.ch}.${p.v}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(p);
  }
  for (const [key, group] of byTarget) {
    const [ch, v] = key.split('.').map(Number);
    const c = get(ch);
    let verseParts = group.filter((p) => !p.heading);
    const headingParts = group.filter((p) => p.heading);
    // Psalms: when several whole Hebrew verses map onto English verse 1, all
    // but the last are superscription (Ps 51: Hebrew 1-2 are the heading,
    // Hebrew 3 is "Have mercy on me").
    if (osis === 'Ps' && v === 1 && verseParts.length > 1) {
      headingParts.push(...verseParts.slice(0, -1));
      verseParts = verseParts.slice(-1);
    }
    if (headingParts.length) c.headings[v] = headingParts.map((p) => p.text).join(' ');
    if (verseParts.length) {
      c.verses[v] = verseParts.map((p) => p.text).join(' ');
      c.sources[v] = verseParts.map((p) => p.wlc);
    }
  }
  return chapters;
}

/** Splits cleaned verse text before the word whose consonants are `consonants`. */
function splitAtWord(text, consonants, ref) {
  const words = text.split(' ');
  const idx = words.findIndex((w) => w.replace(/[\u05B0-\u05BD\u05BF-\u05C7]/g, '') === consonants);
  if (idx <= 0) throw new Error(`splitAtWord: "${consonants}" not found in ${ref}`);
  return [words.slice(0, idx).join(' '), words.slice(idx).join(' ')];
}

// ── Greek ───────────────────────────────────────────────────────────────────

// SBLGNT's apparatus signs (⸀ ⸁ ⸂ ⸃ ⸄ ⸅ and kin, U+2E00-U+2E0F, sometimes
// followed by a digit when one verse has several, as in "⸀1ἄλλῳ") point into
// the printed edition's footnotes -- meaningless without them. Square
// brackets, single and double (⟦ ⟧), mark words/passages of doubtful
// authenticity (e.g. Mark 16:9-20); the words are kept, the brackets dropped,
// matching the BSB which also prints those passages.
const GREEK_STRIP_RE = /[\u2E00-\u2E0F]\d*|[\u27E6\u27E7[\]]/g;

function cleanGreekVerse(text) {
  return text.replace(GREEK_STRIP_RE, '').replace(/\s+/g, ' ').trim();
}

function buildGreekBook(osis) {
  const lines = fs.readFileSync(path.join(SBLGNT_DIR, `${osis}.txt`), 'utf-8').split(/\r?\n/);
  const chapters = {};
  for (const line of lines) {
    const m = line.match(/^\S+ (\d+):(\d+)\t(.*)$/);
    if (!m) continue; // the Greek book-title line at the top of each file
    const ch = Number(m[1]);
    const v = Number(m[2]);
    const c = (chapters[ch] = chapters[ch] || { verses: {}, headings: {}, sources: {} });
    c.verses[v] = cleanGreekVerse(m[3]);
    c.sources[v] = [`${osis}.${ch}.${v}`];
  }
  for (const fix of GREEK_VERSE_FIXES[osis] || []) fix(chapters);
  return chapters;
}

// Where SBLGNT's verse breaks differ from the BSB's. Each was checked against
// the BSB's English text; the split points are the Greek words that begin
// the BSB's next verse.
//
// Romans 16 is deliberately NOT here: SBLGNT prints 16:24 (the grace
// benediction) and leaves the doxology (BSB 16:25-27) to its apparatus. That
// is a real textual difference, not a numbering one, so the Greek simply has
// a 16:24 the BSB lacks and lacks 16:25-27 -- the same as any other gap.
const splitVerse = (chapters, ch, v, marker, newV) => {
  const c = chapters[ch];
  const text = c.verses[v];
  const at = text.indexOf(marker);
  if (at <= 0) throw new Error(`splitVerse: "${marker}" not found in ${ch}:${v}`);
  c.verses[v] = text.slice(0, at).trim();
  c.verses[newV] = text.slice(at).trim();
  c.sources[newV] = c.sources[v];
};
const dropAfter = (chapters, ch, v, marker) => {
  const c = chapters[ch];
  const at = c.verses[v].indexOf(marker);
  if (at <= 0) throw new Error(`dropAfter: "${marker}" not found in ${ch}:${v}`);
  c.verses[v] = c.verses[v].slice(0, at).trim();
};
const mergeVerse = (chapters, ch, from, into) => {
  const c = chapters[ch];
  c.verses[into] = `${c.verses[into]} ${c.verses[from]}`;
  c.sources[into] = [...c.sources[into], ...c.sources[from]];
  delete c.verses[from];
  delete c.sources[from];
};
const renumberVerse = (chapters, ch, from, to) => {
  const c = chapters[ch];
  c.verses[to] = c.verses[from];
  c.sources[to] = c.sources[from];
  delete c.verses[from];
  delete c.sources[from];
};
const GREEK_VERSE_FIXES = {
  // SBLGNT prints Mark's "shorter ending" inside 16:8, double-bracketed. The
  // BSB relegates it to a footnote, so it's cut; the longer ending (16:9-20,
  // also double-bracketed) stays, as the BSB prints it.
  Mark: [(c) => dropAfter(c, 16, 8, 'Πάντα δὲ τὰ παρηγγελμένα')],
  // "After he had said this, he dismissed the assembly" is BSB 19:41.
  Acts: [(c) => splitVerse(c, 19, 40, 'καὶ ταῦτα εἰπὼν', 41)],
  // BSB splits the greetings (12 / 13) and numbers the benediction 14.
  '2Cor': [
    (c) => renumberVerse(c, 13, 13, 14),
    (c) => splitVerse(c, 13, 12, 'ἀσπάζονται ὑμᾶς', 13),
  ],
  // "Peace to you. The friends here greet you..." is part of BSB 14.
  '3John': [(c) => mergeVerse(c, 1, 15, 14)],
  // "And the dragon stood on the shore of the sea" ends BSB 12:17.
  Rev: [(c) => mergeVerse(c, 12, 18, 17)],
};

// ── Adapter interface (see run.js) ──────────────────────────────────────────

const bookCache = {};
function loadBook(bookName) {
  if (bookCache[bookName]) return bookCache[bookName];
  const book = ALL_BIBLE_BOOKS.find((b) => b.name === bookName);
  if (!book) throw new Error(`Unknown book ${bookName}`);
  const osis = OSIS_BY_APP_ID[book.id];
  bookCache[bookName] = book.testament === 'ot' ? buildHebrewBook(osis) : buildGreekBook(osis);
  return bookCache[bookName];
}

async function fetchChapter(bookName, chapterNumber) {
  const c = loadBook(bookName)[chapterNumber];
  if (!c) return {};
  const out = {};
  for (const [v, text] of Object.entries(c.verses)) out[String(v)] = text;
  return out;
}

/** Extra fields for the chapter document: Psalm superscriptions, when present. */
function chapterExtras(bookName, chapterNumber) {
  const c = loadBook(bookName)[chapterNumber];
  if (!c || Object.keys(c.headings).length === 0) return {};
  const headings = {};
  for (const [v, text] of Object.entries(c.headings)) headings[String(v)] = text;
  return { headings };
}

module.exports = {
  id: 'HEBGRK',
  name: 'Original languages (WLC + SBLGNT)',
  isPublicDomain: true, // WLC is; SBLGNT is CC BY 4.0 -- attribution handled in-app
  fetchChapter,
  chapterExtras,
  // Exposed for verify-original-languages.js.
  _internal: { loadBook, parseWlcBook, cleanHebrewVerse, loadVerseMap, OSIS_BY_APP_ID, PARTIAL_SPLITS },
};
