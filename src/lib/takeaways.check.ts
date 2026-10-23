// Regression assertions for takeaways (src/lib/takeaways.ts), run by
// `npm run check:takeaways`. Matthew 7 uses the user's nine sections.

import type { ChapterSections, QueueItem, Takeaway } from '../types';
import { buildPath, makeTakeaway, nextAsk, nextUp, pendingAsks, sectionStatuses, takeawayId, writtenCount } from './takeaways';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const STARTS = [1, 6, 7, 12, 13, 15, 21, 24, 28];
const doc = (book: string, chapter: number, starts: number[], labels: Record<number, string> = {}): ChapterSections => ({
  key: `${book}|${chapter}`, book, chapter, starts, labels, phraseWords: {}, updatedAt: '',
});
const docs: Record<string, ChapterSections> = {
  'Matthew|7': doc('Matthew', 7, STARTS, { 1: 'Judge not', 7: 'Ask' }),
  'Romans|8': doc('Romans', 8, [1]), // placeholder only: no sections
};
const sectionsFor = (b: string, c: number) => docs[`${b}|${c}`] ?? null;

const item = (book: string, chapter: number, verse: number, over: Partial<QueueItem> = {}, tr = 'BSB'): QueueItem =>
  ({
    verseId: `${tr}_${book}_${chapter}_${verse}`, translationId: tr, book, chapter, verseNumber: verse, text: 'x', orderIndex: 0,
    status: 'reviewing', retentionPhase: 'weekly', dateStarted: null, lastReviewDate: null, nextReviewDueDate: null,
    currentStreakCount: 0, totalSuccessfulReviews: 0, gracePeriodUsedToday: false, ...over,
  }) as QueueItem;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const daily = { retentionPhase: 'daily' as const };
const key = (s: { start: number }) => s.start;

// Matthew 7:1-14 at weekly, 15-20 daily.
const queue = [
  ...range(1, 14).map((v) => item('Matthew', 7, v)),
  ...range(15, 20).map((v) => item('Matthew', 7, v, daily)),
  item('Romans', 8, 1),
];
const st = sectionStatuses(queue, sectionsFor);
check('sections of the chapter, none for a placeholder chapter', st.map(key).join() === '1,6,7,12,13,15', st.map(key));
check('sections up to verse 14 are ready, the daily one is not', st.filter((s) => s.ready).map(key).join() === '1,6,7,12,13', st.filter((s) => s.ready).map(key));
check('the last section runs to the last learned verse', st.find((s) => s.start === 15)?.end === 20);

// A verse missing inside a section blocks it.
const gap = sectionStatuses(queue.filter((q) => q.verseNumber !== 3), sectionsFor);
check('a missing verse blocks its section', gap.find((s) => s.start === 1)?.ready === false);
check('a section with no verse of the user is left out', !gap.some((s) => s.start === 21));
const waiting = sectionStatuses([...queue.filter((q) => q.verseNumber !== 2), item('Matthew', 7, 2, { status: 'queued', retentionPhase: 'none' })], sectionsFor);
check('a waiting verse blocks its section', waiting.find((s) => s.start === 1)?.ready === false);
const refresher = sectionStatuses(
  queue.map((q) => (q.verseNumber === 2 ? { ...q, retentionPhase: 'daily' as const, refresherActive: true, refresherReturnPhase: 'weekly' as const } : q)),
  sectionsFor
);
check('a verse on a refresher stays ready', refresher.find((s) => s.start === 1)?.ready === true);
const twoTr = sectionStatuses([...queue.filter((q) => q.verseNumber !== 14), item('Matthew', 7, 14, daily), item('Matthew', 7, 14, {}, 'KJV')], sectionsFor);
check('a verse in two translations counts at its furthest', twoTr.find((s) => s.start === 13)?.ready === true);
const retained = sectionStatuses(queue.map((q) => (q.verseNumber === 1 ? { ...q, status: 'retained' as const } : q)), sectionsFor);
check('a complete verse counts as ready', retained.find((s) => s.start === 1)?.ready === true);

// Asks
const none: Record<string, Takeaway> = {};
check('five ready sections are asked', pendingAsks(st, none).length === 5);
check('the first ask is the earliest section', nextAsk(st, none)?.start === 1);
const tk = (s: number, over: Partial<Takeaway> = {}): Takeaway => ({
  id: takeawayId('Matthew', 7, s), book: 'Matthew', chapter: 7, sectionStart: s, sectionEnd: s + 4, text: 'Point', status: 'saved',
  createdAt: `2026-10-${String(s).padStart(2, '0')}T00:00:00Z`, updatedAt: '', ...over,
});
const written: Record<string, Takeaway> = { [tk(1).id]: tk(1), [tk(6).id]: tk(6, { status: 'later', text: '' }) };
check('written and "later" sections are not asked again', pendingAsks(st, written).map(key).join() === '7,12,13', pendingAsks(st, written).map(key));
const drafted: Record<string, Takeaway> = { [tk(1).id]: tk(1, { status: 'draft', text: 'my words' }) };
check('a draft fills in the ask, it does not replace it', nextAsk(st, drafted)?.start === 1 && nextAsk(st, drafted)?.prefill === 'my words');
check('a draft is not written', writtenCount(drafted) === 0 && writtenCount(written) === 1);

// Next up
const nx = nextUp(st, written);
check('next up is the section still on daily', nx?.start === 15, nx?.start);
const allDone = Object.fromEntries(st.map((s) => [takeawayId('Matthew', 7, s.start), tk(s.start)]));
check('nothing next when every section has its stop', nextUp(st, allDone) === null);
check('a section with a verse missing is not next', nextUp(sectionStatuses(queue.filter((q) => q.verseNumber !== 16), sectionsFor), written) === null);

// Path order
const t1 = tk(1, { createdAt: '2026-10-01T00:00:00Z' });
const t2 = tk(7, { createdAt: '2026-10-05T00:00:00Z' });
const t3: Takeaway = { ...tk(3), book: 'Romans', chapter: 8, id: takeawayId('Romans', 8, 3), createdAt: '2026-10-03T00:00:00Z', text: 'R' };
const path = buildPath({ [t1.id]: t1, [t2.id]: t2, [t3.id]: t3, x: tk(12, { status: 'draft' }) }, st, sectionsFor);
const kinds = path.map((p) => (p.kind === 'stop' ? `s${p.takeaway.sectionStart}` : p.kind === 'next' ? 'next' : p.kind === 'landmark' ? `m${p.book}` : `c${p.chapter}`));
check('newest first, next on top, dividers on chapter change', kinds.join() === 'c7,next,s7,c8,s3,c7,s1', kinds);
const sides = path.flatMap((p) => (p.kind === 'chapter' || p.kind === 'landmark' ? [] : [p.side]));
check('stops alternate sides', sides.join() === 'left,right,left,right', sides);
const sp = path.find((p) => p.kind === 'stop' && p.takeaway.sectionStart === 7);
check('a stop keeps its section color index and label', sp?.kind === 'stop' && sp.index === 2 && sp.label === 'Ask', sp);
check('a draft is not on the path', !kinds.includes('s12'));

// Landmarks sit between stops by the day they were passed (newest first); undated ones go last.
const lm = (book: string, verses: number, at: string | null) => ({ landmark: { book, verses }, at });
const withMarks = buildPath({ [t1.id]: t1, [t2.id]: t2, [t3.id]: t3 }, st, sectionsFor, [
  lm('Ruth', 85, '2026-10-04T00:00:00Z'), lm('Jude', 25, '2026-10-02T00:00:00Z'), lm('Titus', 46, '2026-10-02T00:00:00Z'), lm('2 John', 13, null), lm('Obadiah', 21, '2026-10-20T00:00:00Z'),
]);
const markKinds = withMarks.map((p) => (p.kind === 'stop' ? `s${p.takeaway.sectionStart}` : p.kind === 'next' ? 'next' : p.kind === 'landmark' ? `m${p.book}` : `c${p.chapter}`));
check('landmarks fall between stops by date, same-day longest first, undated last', markKinds.join() === 'c7,next,mObadiah,s7,mRuth,c8,s3,mTitus,mJude,c7,s1,m2 John', markKinds);
check('landmarks do not change the stops alternation', withMarks.flatMap((p) => (p.kind === 'stop' || p.kind === 'next' ? [p.side] : [])).join() === 'left,right,left,right');
check('no landmarks given: the path is as before', buildPath({ [t1.id]: t1 }, st, sectionsFor).every((p) => p.kind !== 'landmark'));
const later = buildPath({ [tk(6).id]: tk(6, { status: 'later', text: '' }) }, st, sectionsFor).find((p) => p.kind === 'stop');
check('a "later" stop is empty', later?.kind === 'stop' && later.empty);

// makeTakeaway
const made = makeTakeaway({ book: 'Matthew', chapter: 7, sectionStart: 1, sectionEnd: 5, label: ' Judge not ' }, { text: '  Do not\n judge ', note: '  ', status: 'saved' }, null, 'N');
check('made: tidy text, no empty note, id by section', made.text === 'Do not judge' && made.note === undefined && made.id === 'Matthew|7|1' && made.label === 'Judge not');
const from = makeTakeaway(made, { text: 'x', status: 'saved' }, { ...made, status: 'later' }, 'N2');
check('"later" becoming saved keeps its place on the path', from.createdAt === 'N');
const fromDraft = makeTakeaway(made, { text: 'x', status: 'saved' }, { ...made, status: 'draft', createdAt: 'OLD' }, 'N3');
check('a draft becoming saved is dated now', fromDraft.createdAt === 'N3');

console.log(failures === 0 ? '\nAll takeaways checks passed.' : `\n${failures} takeaways check(s) FAILED.`);
if (failures > 0) process.exit(1);
