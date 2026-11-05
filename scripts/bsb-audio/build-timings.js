// Turns align.py's per-chapter verse times into timings/{BOOKID}_{ch}.json,
// the shape the app reads from audioLibrary/souer/chapters
// (LibraryChapterTimings in src/lib/libraryAudio.ts, plus headings["1"] for a
// Psalm title), and writes timings/report.json listing every verse worth a
// listen before upload. Run after spot-check.py all:
//
//   node scripts/bsb-audio/build-timings.js

const fs = require('fs');
const path = require('path');

const WORK = path.join(__dirname, 'work');
const OUT = path.join(__dirname, 'timings');

// A verse with fewer than this share of its words matched by align.py is flagged.
const MIN_MATCHED = 0.6;
// Seconds per word outside this range means a boundary is probably wrong.
// Souer reads about 0.35 s a word.
const MIN_SEC_PER_WORD = 0.15;
const MAX_SEC_PER_WORD = 1.2;

// spot-check.py's "all" run: each clip transcribed on its own. A clip holding
// under MIN_CLIP_RECALL of its verse's words is left without audio -- silence
// beats the wrong verse. Under GOOD_CLIP_RECALL, or with more than
// MAX_EXTRA_WORDS words that aren't the verse's, it's flagged for a listen.
const MIN_CLIP_RECALL = 0.4;
const GOOD_CLIP_RECALL = 0.7;
const MAX_EXTRA_WORDS = 3;
// Clips that failed the automatic check but were found sound by transcribing
// them in short pieces (stage 3). They keep their audio and stay in the report.
const CHECKED_BY_HAND = {
  '2SA 7:11': 'whole verse there; Whisper drops its first 8 s when it hears the clip in one go',
  '1CH 12:12': 'right verse; Whisper writes "the eighth ... the ninth" as "VIII ... IX"',
  'EZR 10:35': 'right verse; the three names are heard as "Banea, Badea, Kiluhai"',
};
const clipCheckPath = path.join(OUT, 'clip-check.json');
const clipCheck = fs.existsSync(clipCheckPath)
  ? Object.fromEntries(JSON.parse(fs.readFileSync(clipCheckPath, 'utf-8')).map((r) => [r.verse, r]))
  : null;

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources', 'manifest.json'), 'utf-8'));
const round = (n) => Math.round(n * 100) / 100;

/** A playable span for one verse or Psalm title, or null to leave it without audio. */
function span(seg, file, label, flags) {
  const secPerWord = (seg.endSec - seg.startSec) / Math.max(seg.words, 1);
  if (seg.interpolated) flags.push({ verse: label, problem: 'no words heard; time estimated' });
  else if (seg.matched / Math.max(seg.words, 1) < MIN_MATCHED) flags.push({ verse: label, problem: `only ${seg.matched}/${seg.words} words matched` });
  if (secPerWord < MIN_SEC_PER_WORD || secPerWord > MAX_SEC_PER_WORD)
    flags.push({ verse: label, problem: `${secPerWord.toFixed(2)} s per word (${(seg.endSec - seg.startSec).toFixed(1)} s for ${seg.words} words)` });
  const c = clipCheck && clipCheck[label];
  if (clipCheck && !c) flags.push({ verse: label, problem: 'not clip-checked' });
  if (c && c.recall < MIN_CLIP_RECALL && CHECKED_BY_HAND[label]) {
    flags.push({ verse: label, problem: `clip check failed (${Math.round(c.recall * 100)}% of words) but checked by hand: ${CHECKED_BY_HAND[label]}`, heard: c.heard });
  } else if (c && c.recall < MIN_CLIP_RECALL) {
    flags.push({ verse: label, problem: `clip check failed (${Math.round(c.recall * 100)}% of words); left without audio`, withheld: true, heard: c.heard });
    return null;
  } else if (c && (c.recall < GOOD_CLIP_RECALL || c.extraWords > MAX_EXTRA_WORDS))
    flags.push({ verse: label, problem: `clip holds ${Math.round(c.recall * 100)}% of its words, ${c.extraWords} extra`, heard: c.heard });
  return { file, startSec: round(seg.startSec), endSec: round(seg.endSec) };
}

fs.mkdirSync(OUT, { recursive: true });
const flags = [];
const missingFiles = [];
let verseCount = 0;
let withAudio = 0;
for (const f of manifest) {
  const key = `${f.bookId}_${f.chapter}`;
  const p = path.join(WORK, 'align', `${key}.json`);
  if (!fs.existsSync(p)) {
    missingFiles.push(key);
    continue;
  }
  const a = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const verses = {};
  for (const v of a.verses) {
    const s = span(v, a.file, `${f.bookId} ${f.chapter}:${v.v}`, flags);
    verseCount++;
    if (s) {
      verses[v.v] = s;
      withAudio++;
    }
  }
  const doc = { book: f.bookId, chapter: f.chapter, verses };
  if (a.psalmTitle) {
    const s = span(a.psalmTitle, a.file, `${f.bookId} ${f.chapter} title`, flags);
    if (s) doc.headings = { 1: s };
  }
  fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(doc));
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ missingFiles, flags }, null, 1));
console.log(`${manifest.length - missingFiles.length} chapters written to timings/: ${withAudio}/${verseCount} verses with audio`);
if (!clipCheck) console.log('No timings/clip-check.json yet -- run spot-check.py all before uploading.');
if (missingFiles.length) console.log(`${missingFiles.length} chapters not aligned yet`);
const byProblem = {};
for (const fl of flags) {
  const kind = fl.problem.replace(/[\d.]+/g, '#');
  byProblem[kind] = (byProblem[kind] || 0) + 1;
}
console.log(`${flags.length} flags (${flags.filter((fl) => fl.withheld).length} verses left without audio):`, byProblem);
