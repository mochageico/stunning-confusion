// Regression assertions for Pick up the thread, run by `npm run check:thread`.
//
// The first invariant is the one that matters most: the stretch a cue asks
// for, rejoined, is exactly the real text from the cue word to the end of the
// end verse. Everything after that is about the cue being fair (one right
// answer, never pointing at a verse the user hasn't learned) and the credit
// rules being what the user chose.

import { joinWords, splitWords } from './textScript';
import {
  pickThreadCue,
  threadCueKey,
  threadRunEndingAt,
  threadSlips,
  threadSpan,
  threadStartVerseCounts,
  ThreadCue,
} from './drills';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

/** Deterministic stand-in for Math.random, so a failure reproduces. */
const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const ps = (verse: number, text: string) => ({ book: 'Psalms', chapter: 23, verse, text, translationId: 'BSB' });
const PSALM_23 = [
  ps(1, 'The LORD is my shepherd; I shall not want.'),
  ps(2, 'He makes me lie down in green pastures; He leads me beside quiet waters.'),
  ps(3, 'He restores my soul; He guides me in the paths of righteousness for the sake of His name.'),
  ps(4, 'Even though I walk through the valley of the shadow of death, I will fear no evil, for You are with me; Your rod and Your staff, they comfort me.'),
  ps(5, 'You prepare a table before me in the presence of my enemies. You anoint my head with oil; my cup overflows.'),
  ps(6, 'Surely goodness and loving devotion will follow me all the days of my life, and I will dwell in the house of the LORD forever.'),
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '');

// ----------------------------------------------------------------------------
console.log('span text is exactly the original');
{
  const rand = seeded(7);
  let allExact = true;
  let detail: unknown;
  for (let n = 0; n < 300; n++) {
    const end = 1 + Math.floor(rand() * 5);
    const cue = pickThreadCue(PSALM_23, end, { random: rand });
    if (!cue) { allExact = false; detail = { end, cue }; break; }
    const span = threadSpan(PSALM_23, cue);
    const recited = span.map((s) => joinWords(s.words)).join(' ');
    const startWords = splitWords(PSALM_23[cue.startVerse].text);
    const expected = [joinWords(startWords.slice(cue.startWord)), ...PSALM_23.slice(cue.startVerse + 1, end + 1).map((v) => v.text)].join(' ');
    const before = joinWords(span[0].before);
    const rebuiltStart = [before, joinWords(span[0].words)].filter(Boolean).join(' ');
    if (recited !== expected || rebuiltStart !== PSALM_23[cue.startVerse].text) {
      allExact = false;
      detail = { cue, recited, expected };
      break;
    }
  }
  check('300 random cues: recited stretch === original text, before+words === start verse', allExact, detail);
}

// ----------------------------------------------------------------------------
console.log('cues are fair');
{
  const rand = seeded(11);
  let unique = true;
  let inRange = true;
  let cueMatchesText = true;
  let noFillerPair = true;
  let noSentenceBreak = true;
  let detail: unknown;
  const allText = PSALM_23.map((v) => norm(v.text)).join(' | ');
  for (let n = 0; n < 300; n++) {
    const end = 2 + Math.floor(rand() * 4);
    const from = Math.floor(rand() * end);
    const cue = pickThreadCue(PSALM_23, end, { fromVerse: from, random: rand })!;
    const phrase = norm(cue.cueWords.join(' '));
    // Unique: the phrase appears once across the range (counted within verses).
    const hits = PSALM_23.reduce((sum, v) => {
      const words = norm(v.text).split(/\s+/);
      let c = 0;
      for (let j = 0; j + cue.cueWords.length <= words.length; j++) {
        if (words.slice(j, j + cue.cueWords.length).join(' ') === phrase) c++;
      }
      return sum + c;
    }, 0);
    if (hits !== 1) { unique = false; detail = { cue, hits, allText: allText.length }; }
    if (cue.startVerse < from || cue.startVerse >= end) { inRange = false; detail = { cue, from, end }; }
    const raw = splitWords(PSALM_23[cue.startVerse].text).slice(cue.startWord, cue.startWord + cue.cueWords.length);
    if (norm(raw.join(' ')) !== phrase) { cueMatchesText = false; detail = { cue, raw }; }
    const filler = new Set(['and', 'the', 'my', 'me', 'i', 'in', 'of', 'you', 'your', 'he', 'his', 'will', 'shall', 'not', 'for', 'is']);
    if (cue.cueWords.length === 2 && cue.cueWords.every((w) => filler.has(norm(w)))) { noFillerPair = false; detail = { cue }; }
    if (raw.slice(0, -1).some((w) => /[.;:!?]$/.test(w))) { noSentenceBreak = false; detail = { cue, raw }; }
  }
  check('every cue phrase appears exactly once in the range', unique, detail);
  check('start verse is always inside from..end-1', inRange, detail);
  check('cue words are the words at startWord', cueMatchesText, detail);
  check('no two-filler cues ("and the")', noFillerPair, detail);
  check('no cue straddles a ; or . ("want. He")', noSentenceBreak, detail);
}

// ----------------------------------------------------------------------------
console.log('near verses are favoured');
{
  const rand = seeded(3);
  let near = 0;
  const N = 2000;
  for (let n = 0; n < N; n++) {
    const cue = pickThreadCue(PSALM_23, 5, { random: rand })!;
    if (cue.startVerse >= 3) near++;
  }
  const share = near / N;
  check(`about 3 in 4 cues come from the 2 verses before the end (got ${share.toFixed(2)})`, share > 0.68 && share < 0.82, share);
}

// ----------------------------------------------------------------------------
console.log('no repeats until every spot is used');
{
  const two = PSALM_23.slice(0, 2);
  const rand = seeded(5);
  const used = new Set<string>();
  const seen: string[] = [];
  let repeatedEarly = false;
  // Count the clean spots available in v1 (the only start verse when ending at v2).
  for (let n = 0; n < 4; n++) {
    const cue = pickThreadCue(two, 1, { used, random: rand })!;
    const key = threadCueKey(cue);
    if (used.has(key)) repeatedEarly = true;
    used.add(key);
    seen.push(`${key} ${cue.cueWords.join(' ')}`);
  }
  check('v1 cues ending at v2 do not repeat while fresh ones remain', !repeatedEarly, seen);
  const afterExhaust = pickThreadCue(two, 1, { used: new Set(Array.from({ length: 20 }, (_, j) => `0:${j}`)), random: rand });
  check('once every spot is used, it still returns a cue', afterExhaust !== null);
}

// ----------------------------------------------------------------------------
console.log('a one-verse range cues inside that verse');
{
  const cue = pickThreadCue(PSALM_23.slice(3, 4), 0, { random: seeded(9) })!;
  check('start verse is the end verse', cue.startVerse === 0 && cue.endVerse === 0, cue);
  check('out of range end returns null', pickThreadCue(PSALM_23, 9) === null);
}

// ----------------------------------------------------------------------------
console.log('the run stops at a gap and at other chapters/translations');
{
  const pool = [
    PSALM_23[0], PSALM_23[1], PSALM_23[2], PSALM_23[5], // knows 1-3 and 6
    { ...PSALM_23[3], translationId: 'KJV' }, // v4 in a different translation
    { ...PSALM_23[4], chapter: 24 }, // a "v5" from the wrong chapter
  ];
  check('run ending at v3 is 1-3', threadRunEndingAt(pool, PSALM_23[2]).map((v) => v.verse).join(',') === '1,2,3');
  check('run ending at v6 is just v6 (gap at 4-5)', threadRunEndingAt(pool, PSALM_23[5]).map((v) => v.verse).join(',') === '6');
  check('target missing from the pool gives an empty run', threadRunEndingAt(pool.slice(0, 2), PSALM_23[2]).length === 0);
}

// ----------------------------------------------------------------------------
console.log('start verse credit: first half only');
{
  const v = [PSALM_23[0], PSALM_23[1]]; // v1 has 9 words: The LORD is my shepherd; I shall not want.
  const at = (w: number): ThreadCue => ({ startVerse: 0, startWord: w, endVerse: 1, cueWords: [] });
  check('cue at word 0 counts', threadStartVerseCounts(v, at(0)));
  check('cue at word 4 of 9 counts (4 skipped < 4.5)', threadStartVerseCounts(v, at(4)));
  check('cue at word 5 of 9 does not', !threadStartVerseCounts(v, at(5)));
}

// ----------------------------------------------------------------------------
console.log('slips');
{
  const cue: ThreadCue = { startVerse: 1, startWord: 3, endVerse: 3, cueWords: [] };
  const span = threadSpan(PSALM_23, cue);
  const clean = span.map((s) => s.words.map(() => false));
  check('no misses, no slips', threadSlips(span, clean).length === 0);

  const intoV3 = clean.map((a) => [...a]);
  intoV3[1][1] = true; // second word of v3
  check('miss at the start of v3 is a join slip into v3', JSON.stringify(threadSlips(span, intoV3)) === JSON.stringify([{ verse: 2, kind: 'join' }]), threadSlips(span, intoV3));

  const endOfV2 = clean.map((a) => [...a]);
  endOfV2[0][endOfV2[0].length - 1] = true; // last word of v2
  check('miss at the end of v2 is also the join into v3', JSON.stringify(threadSlips(span, endOfV2)) === JSON.stringify([{ verse: 2, kind: 'join' }]), threadSlips(span, endOfV2));

  const midV4 = clean.map((a) => [...a]);
  midV4[2][10] = true;
  check('miss mid-v4 is an inside slip', JSON.stringify(threadSlips(span, midV4)) === JSON.stringify([{ verse: 3, kind: 'inside' }]), threadSlips(span, midV4));

  const midCue = clean.map((a) => [...a]);
  midCue[0][1] = true;
  check('miss early in the cue verse is an inside slip of that verse', JSON.stringify(threadSlips(span, midCue)) === JSON.stringify([{ verse: 1, kind: 'inside' }]), threadSlips(span, midCue));
}

// ----------------------------------------------------------------------------
console.log('Hebrew');
{
  const he = (verse: number, text: string) => ({ book: 'Psalms', chapter: 23, verse, text, translationId: 'HEBGRK' });
  const verses = [
    he(1, 'מִזְמ֥וֹר לְדָוִ֑ד יְהוָ֥ה רֹ֝עִ֗י לֹ֣א אֶחְסָֽר׃'),
    he(2, 'בִּנְא֣וֹת דֶּ֭שֶׁא יַרְבִּיצֵ֑נִי עַל־מֵ֖י מְנֻח֣וֹת יְנַהֲלֵֽנִי׃'),
  ];
  const rand = seeded(2);
  let ok = true;
  let detail: unknown;
  for (let n = 0; n < 50; n++) {
    const cue = pickThreadCue(verses, 1, { random: rand });
    if (!cue) { ok = false; break; }
    const span = threadSpan(verses, cue);
    const rebuilt = joinWords([...span[0].before, ...span[0].words]);
    if (rebuilt !== verses[0].text || joinWords(span[1].words) !== verses[1].text) {
      ok = false;
      detail = { cue, rebuilt };
      break;
    }
  }
  check('Hebrew cues rebuild the exact text, maqaf and all', ok, detail);
}

console.log(failures === 0 ? '\nall thread checks passed' : `\n${failures} thread check(s) FAILED`);
if (failures > 0) process.exit(1);
