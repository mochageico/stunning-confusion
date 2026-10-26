// Builds src/content/echoes.json from the UBS Parallel Passages Database
// (github.com/ubsicap/ubs-open-license, "parallel passages/ParallelPassages.xml").
//
//   node scripts/build-echoes.cjs <path-to-ParallelPassages.xml> [out.json]
//
// The XML is treated as untrusted data: it is only parsed with regexes, never run.
// Each <Verse> is tagged HEB (Old Testament) or GRK (New Testament), so a passage
// holding both kinds is an NT verse paired with an OT verse. We keep only those
// NT -> OT pairs; OT-only and Gospel-only parallels are dropped. Refs only, no text.
//
// UBS numbers the Old Testament the Hebrew way (Psalm 22:1 is "PSA 22:2"); the app
// uses English numbering, so HEB_TO_ENGLISH converts the refs that differ.
//
// Credit: UBS Parallel Passage Database, © 2023 United Bible Societies, CC BY-SA 4.0.
// The output file is shared under the same license (see DATA_LICENSES.md).
const fs = require('fs');
const path = require('path');

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/build-echoes.cjs <ParallelPassages.xml> [out.json]');
  process.exit(1);
}
const out = process.argv[3] || path.join(__dirname, '..', 'src', 'content', 'echoes.json');

const NAMES = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalms', PRO: 'Proverbs',
  ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah', JER: 'Jeremiah',
  LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea', JOL: 'Joel',
  AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah', NAM: 'Nahum', HAB: 'Habakkuk',
  ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah', MAL: 'Malachi',
  MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts', ROM: 'Romans',
  '1CO': '1 Corinthians', '2CO': '2 Corinthians', GAL: 'Galatians', EPH: 'Ephesians',
  PHP: 'Philippians', COL: 'Colossians', '1TH': '1 Thessalonians', '2TH': '2 Thessalonians',
  '1TI': '1 Timothy', '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews',
  JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John',
  '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};

// Hebrew-numbered chapters -> English verse number, for the chapters that differ
// and that actually occur in the NT-quotes-OT passages. A number is "add n" (shift
// within the chapter) or an explicit {chapter, verse} map. Chapters not listed
// are the same in both systems.
const PSALM_SHIFT = {
  4: 1, 5: 1, 8: 1, 19: 1, 22: 1, 31: 1, 36: 1, 40: 1, 41: 1, 44: 1, 45: 1,
  51: 2, 53: 1, 68: 1, 69: 1, 89: 1, 102: 1, 140: 1,
};
function toEnglish(book, chapter, verse) {
  if (book === 'PSA') {
    const s = PSALM_SHIFT[chapter] || 0;
    return { chapter, verse: verse - s };
  }
  if (book === 'ISA' && chapter === 8 && verse === 23) return { chapter: 9, verse: 1 };
  if (book === 'ISA' && chapter === 9) return { chapter: 9, verse: verse + 1 };
  if (book === 'ISA' && chapter === 64) return { chapter: 64, verse: verse + 1 };
  if (book === 'HOS' && chapter === 2 && verse <= 2) return { chapter: 1, verse: verse + 9 };
  if (book === 'HOS' && chapter === 2) return { chapter: 2, verse: verse - 2 };
  if (book === 'JOL' && chapter === 3) return { chapter: 2, verse: verse + 27 };
  if (book === 'JON' && chapter === 2 && verse === 1) return { chapter: 1, verse: 17 };
  if (book === 'JON' && chapter === 2) return { chapter: 2, verse: verse - 1 };
  if (book === 'MIC' && chapter === 5) return { chapter: 5, verse: verse + 1 };
  if (book === 'JOB' && chapter === 41) return { chapter: 41, verse: verse + 8 };
  if (book === 'EXO' && chapter === 22) return { chapter: 22, verse: verse + 1 };
  if (book === 'JER' && chapter === 9) return { chapter: 9, verse: verse + 1 };
  return { chapter, verse };
}

// "MRK 10:7-8", "LUK 6:27-28,35" -> StarRef pieces. Cross-chapter ranges are skipped.
function parseRef(text, isOT, skipped) {
  const m = /^([0-9A-Z]{3}) (.+)$/.exec(text.trim());
  if (!m || !NAMES[m[1]]) { skipped.push(text); return []; }
  const book = m[1];
  const chapMatch = /^(\d+):(.+)$/.exec(m[2]);
  if (!chapMatch) { skipped.push(text); return []; }
  const chapter = Number(chapMatch[1]);
  const refs = [];
  for (const part of chapMatch[2].split(',')) {
    const r = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!r) { skipped.push(text); continue; }
    const start = Number(r[1]);
    const end = r[2] ? Number(r[2]) : start;
    if (isOT) {
      const s = toEnglish(book, chapter, start);
      const e = toEnglish(book, chapter, end);
      if (s.chapter !== e.chapter) { skipped.push(text); continue; }
      refs.push({ book: NAMES[book], chapter: s.chapter, start: s.verse, end: e.verse });
    } else {
      refs.push({ book: NAMES[book], chapter, start, end });
    }
  }
  return refs;
}

// UBS marks each word of a verse with a digit; 2 means a word shared with the
// parallel. A long shared run in the NT verse is a quotation; scattered or short
// overlap is an allusion.
function kindOf(digits) {
  let longest = 0, run = 0, twos = 0;
  for (const c of digits) {
    if (c === '2') { twos++; run++; longest = Math.max(longest, run); } else run = 0;
  }
  return longest >= 4 && twos / Math.max(digits.length, 1) >= 0.3 ? 'quote' : 'allusion';
}

const xml = fs.readFileSync(input, 'utf8');
const passages = [...xml.matchAll(/<Passage>([\s\S]*?)<\/Passage>/g)].map((p) =>
  [...p[1].matchAll(/<Verse (HEB|GRK)="([0-9]*)">([^<]*)<\/Verse>/g)].map((v) => ({ lang: v[1], digits: v[2], ref: v[3] })),
);

const skipped = [];
const seen = new Map();
let mixed = 0;
for (const p of passages) {
  const ots = p.filter((v) => v.lang === 'HEB');
  const nts = p.filter((v) => v.lang === 'GRK');
  if (!ots.length || !nts.length) continue;
  mixed++;
  for (const nt of nts) {
    for (const ot of ots) {
      for (const n of parseRef(nt.ref, false, skipped)) {
        for (const o of parseRef(ot.ref, true, skipped)) {
          const key = JSON.stringify([n, o]);
          const kind = kindOf(nt.digits);
          if (!seen.has(key) || kind === 'quote') seen.set(key, { nt: n, ot: o, kind });
        }
      }
    }
  }
}

const echoes = [...seen.values()];
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(echoes) + '\n');
const quotes = echoes.filter((e) => e.kind === 'quote').length;
console.log(`${passages.length} passages, ${mixed} with both OT and NT`);
console.log(`${echoes.length} NT->OT pairs (${quotes} quote, ${echoes.length - quotes} allusion) -> ${out}`);
if (skipped.length) console.log('skipped refs:', skipped.join('; '));
