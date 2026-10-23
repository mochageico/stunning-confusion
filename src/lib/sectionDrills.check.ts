// Regression assertions for the section drills (src/lib/sectionDrills.ts), run
// by `npm run check:sectiondrills`. They cover what the plan promises: Put in
// order and Which section need 3+ sections, a Which section question offers the
// right section plus its neighbors, and Teach-It has one fixed 10 seconds.

import type { ChapterSections } from '../types';
import {
  addDraft,
  buildOrderRound,
  buildQuestions,
  choicesFor,
  drillSections,
  hasEnoughSections,
  makeTakeawayDraft,
  pickQuestionVerses,
  scoreOrder,
  sectionName,
  shuffledOrder,
  teachProgress,
  teachSecondsLeft,
  teachTargets,
  TEACH_SECONDS,
} from './sectionDrills';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A small deterministic Rng (mulberry32) so a failing run can be repeated.
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const verses = (book: string, chapter: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ book, chapter, verse: i + 1, text: `Word${i + 1} of verse ${i + 1} goes on here.`, translationId: 'BSB' }));
const V12 = verses('Matthew', 7, 12);
const doc = (starts: number[], labels: Record<number, string> = {}): ChapterSections => ({
  key: 'Matthew|7',
  book: 'Matthew',
  chapter: 7,
  starts,
  labels,
  phraseWords: {},
  updatedAt: '2026-10-22T00:00:00Z',
});

console.log('Which sections the drills see');
const four = drillSections(V12, doc([1, 4, 7, 10], { 1: 'Judge not', 4: 'Ask' }));
check('four sections, each with its own verses', four.length === 4 && eq(four[1].verses.map((v) => v.verse), [4, 5, 6]), four.map((s) => s.verses.length));
check('the last section ends at the last verse', four[3].end === 12);
check('a label is kept', four[0].label === 'Judge not' && four[2].label === undefined);
check('no doc, no sections', drillSections(V12, null).length === 0);
check('one section (or a doc holding only the placeholder start) is no sections', drillSections(V12, doc([1])).length === 0);
const mixedChapters = [...V12.slice(0, 3), ...verses('Matthew', 8, 3)];
check('a selection across chapters has no sections', drillSections(mixedChapters, doc([1, 2, 3])).length === 0);
const picked = drillSections(V12.slice(4, 9), doc([1, 4, 7, 10]));
check('a selection keeps only the sections it reaches', picked.length === 2, picked.map((s) => s.index));
check('a section keeps its place in the chapter for color', picked[0].index === 1 && picked[1].index === 2);

console.log('Three sections or more');
check('2 sections is not enough, 3 is', !hasEnoughSections([1, 2]) && hasEnoughSections([1, 2, 3]));
check('no questions with two sections', buildQuestions(drillSections(V12, doc([1, 7])), 8, seeded(1)).length === 0);

console.log('Put in order');
const names = drillSections(V12, doc([1, 4, 7], { 1: 'Judge not', 4: 'Ask' }));
check('a labeled section is called its label', sectionName(names[0]) === 'Judge not');
check('an unlabeled one is called its opening words, never its range', sectionName(names[2]) === 'Word7 of verse 7…', sectionName(names[2]));
let shuffleOk = true;
for (let seed = 1; seed <= 30; seed++) {
  const { tiles, bankOrder } = buildOrderRound(four, 'latin', seeded(seed));
  if (bankOrder.every((v, i) => v === i) || !eq([...bankOrder].sort(), [0, 1, 2, 3]) || tiles.length !== 4) shuffleOk = false;
}
check('the bank is always shuffled, never left in order, and holds every tile', shuffleOk);
check('three sections shuffle too', !eq(shuffledOrder(3, seeded(5)), [0, 1, 2]));
const { tiles } = buildOrderRound(four);
check('empty slots are not solved', !scoreOrder([null, null, null, null], tiles).solved);
check('the right order is solved', scoreOrder([0, 1, 2, 3], tiles).solved);
const wrong = scoreOrder([1, 0, 2, 3], tiles);
check('two swapped is 2 of 4, all placed, not solved', wrong.correct === 2 && wrong.allPlaced && !wrong.solved, wrong);
check('half placed is not all placed', !scoreOrder([0, 1, null, null], tiles).allPlaced && scoreOrder([0, 1, null, null], tiles).placed === 2);

console.log('Which section');
check('three sections: all three are offered', eq([...choicesFor(1, 3, seeded(2))].sort(), [0, 1, 2]));
check('first section: itself and the next two', eq([...choicesFor(0, 5, seeded(3))].sort(), [0, 1, 2]));
check('last section: itself and the two before', eq([...choicesFor(4, 5, seeded(3))].sort(), [2, 3, 4]));
check('middle section: itself, the one above and the one below', eq([...choicesFor(2, 5, seeded(3))].sort(), [1, 2, 3]));
let questionsOk = true;
for (let seed = 1; seed <= 40; seed++) {
  for (const q of buildQuestions(four, 8, seeded(seed))) {
    const inSection = four[q.answer].verses.some((v) => v.verse === q.verse.verse);
    if (!inSection || !q.choices.includes(q.answer) || q.choices.length !== 3 || new Set(q.choices).size !== 3) questionsOk = false;
  }
}
check('every question: the verse is in its answer, three different choices include it', questionsOk);
const qs = buildQuestions(four, 8, seeded(9));
check('a round asks 8 different verses', qs.length === 8 && new Set(qs.map((q) => q.verse.verse)).size === 8, qs.length);
check('every section is asked about before any is asked twice', [0, 1, 2, 3].every((s) => qs.filter((q) => q.answer === s).length === 2), qs.map((q) => q.answer));
const few = pickQuestionVerses(drillSections(verses('Matthew', 7, 4), doc([1, 2, 3])), 8, seeded(1));
check('a short selection asks each verse once and stops', few.length === 4);
const orders = Array.from({ length: 20 }, (_, i) => buildQuestions(four, 8, seeded(i + 1)).map((q) => q.answer));
check('the questions are not always in the same order', orders.some((o) => !eq(o, orders[0])));

console.log('Teach-It');
check('one fixed 10 seconds', TEACH_SECONDS === 10);
check('the ring starts empty and ends full', teachProgress(0) === 0 && teachProgress(10000) === 1 && teachProgress(25000) === 1 && teachProgress(-5) === 0);
check('halfway is half', teachProgress(5000) === 0.5);
check('seconds left count down 10 .. 0', teachSecondsLeft(0) === 10 && teachSecondsLeft(1) === 10 && teachSecondsLeft(1001) === 9 && teachSecondsLeft(9001) === 1 && teachSecondsLeft(10000) === 0 && teachSecondsLeft(99999) === 0);
const targets = teachTargets(V12, four);
check('with sections, each section is a target', targets.length === 4 && targets[1].start === 4 && targets[1].end === 6 && targets[0].label === 'Judge not');
const noSections = teachTargets(V12, []);
check('without sections, stretches of about four verses', noSections.length >= 3 && noSections.every((t) => t.sectionIndex === null && t.verses.length <= 4), noSections.map((t) => t.verses.length));
check('one verse is one target', teachTargets(V12.slice(0, 1), []).length === 1);
check('nothing selected, nothing to teach', teachTargets([], []).length === 0);

console.log('Takeaway drafts (kept in the drill until stage 6)');
const d1 = makeTakeawayDraft(targets[0], '  Do not\n judge   others  ', 1000);
check('a draft keeps the section and tidy words', !!d1 && d1.text === 'Do not judge others' && d1.sectionStart === 1 && d1.sectionEnd === 3 && d1.book === 'Matthew' && d1.label === 'Judge not', d1);
check('a blank draft is nothing', makeTakeawayDraft(targets[0], '   ', 1000) === null);
const d2 = makeTakeawayDraft(targets[0], 'Second try', 2000)!;
const d3 = makeTakeawayDraft(targets[1], 'Ask and it will be given', 3000)!;
const kept = addDraft(addDraft(addDraft([], d1!), d3), d2);
check('one draft per section, the latest wins', kept.length === 2 && kept.some((d) => d.text === 'Second try') && !kept.some((d) => d.text === 'Do not judge others'), kept);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll section drill checks passed.');
