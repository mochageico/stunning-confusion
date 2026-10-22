// Regression assertions for First words (src/lib/outline.ts), run by
// `npm run check:outline`. The reverse-order cases are the ones that matter:
// running last to first must file each result under the verse that was said.

import {
  bumpExtra,
  cleanExtra,
  gradeOutlineVerse,
  groupBySection,
  orderVerses,
  outlineKey,
  outlineRow,
  OutlineVerse,
  recordRunResult,
  runCurrent,
  runDone,
  runResultsInOrder,
  shownIndices,
  shownWordCount,
  startRun,
} from './outline';
import type { WordOutcome } from './recitation';

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

const mk = (verse: number, text: string): OutlineVerse => ({ book: 'Matthew', chapter: 7, verse, text, translationId: 'BSB' });
const V1 = mk(1, 'Do not judge, or you too will be judged.');
const V2 = mk(2, 'For with the same judgment you pronounce you will be judged, and with the measure you use it will be measured to you.');
const V3 = mk(3, 'Why do you look at the speck of sawdust in your brother’s eye and pay no attention to the plank in your own eye?');
const V4 = mk(4, 'Or how can you say to your brother — let me take the speck out of your eye — when all the time there is a plank in your own eye?');
const V5 = mk(5, 'You hypocrite!');

console.log('Taps');
check('slider 3: 3 -> 4 -> back to 3', bumpExtra(3, 0) === 1 && bumpExtra(3, 1) === 0);
check('slider 0: 0 -> 1 -> 2 -> 3 -> 4 -> 0', [0, 1, 2, 3].every((e) => bumpExtra(0, e) === e + 1) && bumpExtra(0, 4) === 0);
check('slider 4: a tap has nowhere to go and stays at none', bumpExtra(4, 0) === 0);
check('words shown = slider + taps, capped at 4', shownWordCount(3, 1) === 4 && shownWordCount(4, 2) === 4 && shownWordCount(0, undefined) === 0);
check(
  'cleanExtra keeps 1-4 only',
  eq(cleanExtra({ 1: 0, 2: 2, 3: 5, 4: 4, 5: -1 }), { 2: 2, 4: 4 }),
  cleanExtra({ 1: 0, 2: 2, 3: 5, 4: 4, 5: -1 })
);
check('cleanExtra of nothing is empty', eq(cleanExtra(undefined), {}) && eq(cleanExtra(null), {}));

console.log('Rows');
const r3 = outlineRow(V1, 3, undefined);
check('first three words', r3.shown === 'Do not judge,' && r3.shownCount === 3, r3);
check('a tap shows a fourth', outlineRow(V1, 3, 1).shown === 'Do not judge, or');
check('zero words shows none', outlineRow(V1, 0, undefined).shown === '' && outlineRow(V1, 0, undefined).shownCount === 0);
check('a short verse shows what it has', outlineRow(V5, 4, undefined).shown === 'You hypocrite!' && outlineRow(V5, 4, undefined).shownCount === 2);
check('the hidden share shrinks as words are shown', outlineRow(V2, 3, undefined).restShare > outlineRow(V2, 4, undefined).restShare);
check('a verse fully shown has no hidden share', outlineRow(V5, 4, undefined).restShare === 0);
const dash = outlineRow(V4, 4, undefined);
check('a dash is not counted as a word, and rides along', dash.shown === 'Or how can you' && dash.shownCount === 4, dash);
const dash2 = outlineRow(mk(9, 'Wait — what now'), 2, undefined);
check('a dash inside the shown words stays', dash2.shown === 'Wait — what' && dash2.shownCount === 2, dash2);
check('shownIndices are the first shownCount words', eq([...shownIndices(r3)], [0, 1, 2]));
check('shownIndices of none is empty', shownIndices(outlineRow(V1, 0, undefined)).size === 0);

console.log('Order');
const verses = [V1, V2, V3, V4, V5];
check('forward keeps the order', eq(orderVerses(verses, 'forward').map((v) => v.verse), [1, 2, 3, 4, 5]));
check('reverse flips the verses', eq(orderVerses(verses, 'reverse').map((v) => v.verse), [5, 4, 3, 2, 1]));
check('reverse leaves the input alone', eq(verses.map((v) => v.verse), [1, 2, 3, 4, 5]));

console.log('Sections');
const rows = verses.map((v) => outlineRow(v, 3, undefined));
const starts = [1, 3, 5];
const fwd = groupBySection(rows, starts);
check('rows group under their sections', eq(fwd.map((g) => [g.sectionStart, g.rows.map((r) => r.verse.verse)]), [[1, [1, 2]], [3, [3, 4]], [5, [5]]]));
const rev = groupBySection(orderVerses(rows, 'reverse'), starts);
check('reversed, the sections and their rows run last to first', eq(rev.map((g) => [g.sectionStart, g.rows.map((r) => r.verse.verse)]), [[5, [5]], [3, [4, 3]], [1, [2, 1]]]));
const partial = groupBySection(rows.slice(3), starts);
check('a partial selection keeps its section start', eq(partial.map((g) => [g.sectionStart, g.rows.map((r) => r.verse.verse)]), [[3, [4]], [5, [5]]]));
check('no sections is one group', groupBySection(rows, null).length === 1 && groupBySection(rows, [])[0].sectionStart === null);

console.log('Grading');
const outcomes = (n: number, missed: number): WordOutcome[] => Array.from({ length: n }, (_, i) => (i < missed ? 'missed' : 'perfect'));
const g1 = gradeOutlineVerse(rows[0], outcomes(9, 0), 'type');
check('every word right passes and is perfect', g1.passed && g1.perfect && g1.accuracy === 1 && g1.key === outlineKey(V1));
const g2 = gradeOutlineVerse(rows[1], outcomes(20, 2), 'speak');
check('90% passes, not perfect', g2.passed && !g2.perfect, g2);
const g3 = gradeOutlineVerse(rows[2], outcomes(20, 3), 'speak');
check('85% does not pass', !g3.passed, g3);
check('the result remembers how many words showed', g1.shownCount === 3 && g1.mode === 'type' && g2.mode === 'speak');

console.log('A run, last to first');
const reversedRows = orderVerses(rows, 'reverse');
let run = startRun(reversedRows);
check('starts on the last verse', runCurrent(run) === outlineKey(V5) && !runDone(run));
check('the queue is the listed order', eq(run.queue, reversedRows.map((r) => r.key)));
// Say each verse in turn, with a different number of misses so a result on the
// wrong verse would show: verse 5 -> 0 missed, 4 -> 1 ... 1 -> 4.
const missedFor: Record<number, number> = { 5: 0, 4: 1, 3: 2, 2: 3, 1: 4 };
const totalFor: Record<number, number> = { 5: 20, 4: 20, 3: 20, 2: 20, 1: 20 };
for (const row of reversedRows) {
  const v = row.verse.verse;
  run = recordRunResult(run, gradeOutlineVerse(row, outcomes(totalFor[v], missedFor[v]), 'type'));
}
check('the run is done after every verse', runDone(run) && runCurrent(run) === null);
check(
  'each result sits under the verse that was said',
  verses.every((v) => run.results[outlineKey(v)]?.verse.verse === v.verse && Math.round((1 - run.results[outlineKey(v)].accuracy) * 20) === missedFor[v.verse]),
  Object.values(run.results).map((r) => [r.verse.verse, r.accuracy])
);
check('results come back in the order said (5 down to 1)', eq(runResultsInOrder(run).map((r) => r.verse.verse), [5, 4, 3, 2, 1]));

console.log('A stale result');
let run2 = startRun(reversedRows);
const stale = gradeOutlineVerse(rows[0], outcomes(9, 0), 'type'); // verse 1, but verse 5 is being said
const after = recordRunResult(run2, stale);
check('a result for another verse is ignored', after === run2 && Object.keys(after.results).length === 0 && after.index === 0);
run2 = recordRunResult(run2, gradeOutlineVerse(rows[4], outcomes(2, 0), 'type'));
check('the right verse advances the run', runCurrent(run2) === outlineKey(V4) && run2.index === 1);
const twice = recordRunResult(run2, gradeOutlineVerse(rows[4], outcomes(2, 2), 'type'));
check('a repeat of a finished verse is ignored', twice === run2);

console.log('A run, first to last');
let run3 = startRun(rows);
for (const row of rows) run3 = recordRunResult(run3, gradeOutlineVerse(row, outcomes(10, row.verse.verse - 1), 'speak'));
check('forward results map to their verses too', verses.every((v) => run3.results[outlineKey(v)].verse.verse === v.verse && Math.round((1 - run3.results[outlineKey(v)].accuracy) * 10) === v.verse - 1));

console.log(failures === 0 ? '\nAll outline checks passed.' : `\n${failures} outline check(s) FAILED.`);
if (failures > 0) process.exit(1);
