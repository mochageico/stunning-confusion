// Turns align.py's per-file Hebrew-verse times into per-ENGLISH-chapter verse
// timings (timings/{BOOKID}_{ch}.json, the shape the app reads from
// audioLibrary/shmuelof/chapters), and writes timings/report.json listing
// every verse worth a listen before upload.
//
//   node scripts/hebrew-audio/build-timings.js

const fs = require('fs');
const path = require('path');

const WORK = path.join(__dirname, 'work');
const OUT = path.join(__dirname, 'timings');

// A verse with fewer than this share of its words heard is flagged.
const MIN_MATCHED = 0.6;
// Seconds per word outside this range means a boundary is probably wrong.
const MIN_SEC_PER_WORD = 0.15;
const MAX_SEC_PER_WORD = 1.6;

// spot-check.py's "all" run: each verse's clip transcribed on its own. A clip
// holding under this share of its verse's words is left without audio --
// silence beats the wrong verse.
const MIN_CLIP_RECALL = 0.4;
const clipCheckPath = path.join(OUT, 'clip-check.json');
const clipRecall = fs.existsSync(clipCheckPath)
  ? Object.fromEntries(JSON.parse(fs.readFileSync(clipCheckPath, 'utf-8')).map((r) => [r.verse, r.recall]))
  : null;

const { chapters, splits } = JSON.parse(fs.readFileSync(path.join(WORK, 'english-map.json'), 'utf-8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources', 'manifest.json'), 'utf-8'));
const fileByHebChapter = Object.fromEntries(manifest.map((f) => [`${f.bookId}_${f.hebChapter}`, f.name]));

// WLC ref -> { file, startSec, endSec, words, matched, wordStarts, interpolated }
const byRef = {};
const missingFiles = [];
for (const key of Object.keys(fileByHebChapter)) {
  const p = path.join(WORK, 'align', `${key}.json`);
  if (!fs.existsSync(p)) {
    missingFiles.push(key);
    continue;
  }
  const a = JSON.parse(fs.readFileSync(p, 'utf-8'));
  for (const v of a.verses) byRef[v.ref] = { ...v, file: a.file };
}

/** The part of WLC verse `ref` that belongs to the English verse being built. */
function partOf(ref, englishKey, englishVerse) {
  const t = byRef[ref];
  if (!t) return null;
  if (!(ref in splits)) return t;
  // A Hebrew verse split across two English verses: cut at the first word of
  // its second half (or the next word that was heard, if that one wasn't).
  const cutWord = splits[ref];
  const next = t.wordStarts.slice(cutWord).find((s) => s != null);
  const cut = next != null ? Math.max(t.startSec, next - 0.1) : (t.startSec + t.endSec) / 2;
  const firstHalf = isFirstHalf(ref, englishKey, englishVerse);
  return firstHalf
    ? { ...t, endSec: cut, words: cutWord, matched: t.wordStarts.slice(0, cutWord).filter((s) => s != null).length }
    : { ...t, startSec: cut, words: t.words - cutWord, matched: t.wordStarts.slice(cutWord).filter((s) => s != null).length };
}

// The first English verse (in canonical order) a split ref feeds is its first half.
const firstHalfOf = {};
for (const [key, c] of Object.entries(chapters)) {
  for (const [v, refs] of Object.entries(c.verses)) {
    for (const ref of refs) {
      if (!(ref in splits)) continue;
      const here = [Number(key.split('_')[1]), Number(v)];
      const seen = firstHalfOf[ref];
      if (!seen || here[0] < seen[0] || (here[0] === seen[0] && here[1] < seen[1])) firstHalfOf[ref] = here;
    }
  }
}
function isFirstHalf(ref, englishKey, englishVerse) {
  const [ch, v] = firstHalfOf[ref];
  return Number(englishKey.split('_')[1]) === ch && Number(englishVerse) === v;
}

/** Joins the parts of one English verse (or heading) into a single playable span. */
function span(refs, key, verse, flags, label) {
  const parts = refs.map((r) => partOf(r, key, verse)).filter(Boolean);
  if (parts.length !== refs.length) {
    flags.push({ verse: label, problem: 'no timing (audio file not aligned)' });
    return null;
  }
  // Two verses (Num 26:1, 1 Sam 20:42) straddle two files. Play the longer
  // part; a player can't run one clip across two files.
  const files = [...new Set(parts.map((p) => p.file))];
  let use = parts;
  if (files.length > 1) {
    const dur = (f) => parts.filter((p) => p.file === f).reduce((s, p) => s + p.endSec - p.startSec, 0);
    const keep = files.sort((a, b) => dur(b) - dur(a))[0];
    use = parts.filter((p) => p.file === keep);
    flags.push({ verse: label, problem: `spans two files; plays only ${keep}`, minor: true });
  }
  const startSec = Math.min(...use.map((p) => p.startSec));
  const endSec = Math.max(...use.map((p) => p.endSec));
  const words = parts.reduce((s, p) => s + p.words, 0);
  const matched = parts.reduce((s, p) => s + p.matched, 0);
  const secPerWord = (endSec - startSec) / Math.max(words, 1);
  // Nothing heard AND no room left for it: the reader skipped the verse (1 Chr
  // 2:51 -- his eye jumped between two lines ending "father of Kiriath-jearim").
  // No audio beats a clip of the wrong words.
  if (parts.some((p) => p.interpolated) && secPerWord < MIN_SEC_PER_WORD) {
    flags.push({ verse: label, problem: 'not found in the recording; left without audio' });
    return null;
  }
  if (parts.some((p) => p.interpolated)) flags.push({ verse: label, problem: 'no words heard; time estimated' });
  else if (matched / Math.max(words, 1) < MIN_MATCHED) flags.push({ verse: label, problem: `only ${matched}/${words} words heard` });
  if (secPerWord < MIN_SEC_PER_WORD || secPerWord > MAX_SEC_PER_WORD)
    flags.push({ verse: label, problem: `${secPerWord.toFixed(2)} s per word (${(endSec - startSec).toFixed(1)} s for ${words} words)` });
  return { file: use[0].file, startSec: round(startSec), endSec: round(endSec) };
}

const round = (n) => Math.round(n * 100) / 100;

fs.mkdirSync(OUT, { recursive: true });
const report = [];
let verseCount = 0;
for (const [key, c] of Object.entries(chapters)) {
  const [book, ch] = key.split('_');
  const flags = [];
  const verses = {};
  for (const [v, refs] of Object.entries(c.verses)) {
    const label = `${book} ${ch}:${v}`;
    const s = span(refs, key, v, flags, label);
    if (s && clipRecall && (clipRecall[label] ?? 1) < MIN_CLIP_RECALL) {
      flags.push({ verse: label, problem: `clip check failed (${Math.round(clipRecall[label] * 100)}% of words); left without audio` });
    } else if (s) verses[v] = s;
    verseCount++;
  }
  const headings = {};
  for (const [v, refs] of Object.entries(c.headings || {})) {
    const s = span(refs, key, v, flags, `${book} ${ch} heading`);
    if (s) headings[v] = s;
  }
  const doc = { book, chapter: Number(ch), verses };
  if (Object.keys(headings).length) doc.headings = headings;
  fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(doc));
  report.push(...flags);
}

const serious = report.filter((f) => !f.minor);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ missingFiles, flags: report }, null, 1));
console.log(`${Object.keys(chapters).length} chapters, ${verseCount} verses written to timings/`);
if (!clipRecall) console.log('No timings/clip-check.json yet -- run spot-check.py all before uploading.');
console.log(`${missingFiles.length} audio files not aligned yet; ${serious.length} verses flagged (${report.length - serious.length} minor)`);
const byProblem = {};
for (const f of serious) byProblem[f.problem.replace(/[\d.]+/g, '#')] = (byProblem[f.problem.replace(/[\d.]+/g, '#')] || 0) + 1;
console.log(byProblem);
