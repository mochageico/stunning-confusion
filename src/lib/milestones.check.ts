// Regression assertions for milestones (src/lib/milestones.ts), run by
// `npm run check:milestones`.

import { ALL_BIBLE_BOOKS } from '../data';
import type { QueueItem, ReviewLog } from '../types';
import { BOOK_VERSES, heldDates, heldLine, ladderPosition, LANDMARKS, landmarkDates, landmarkText, leftLearningAt, nextLine, passedLandmarks, versesHeld } from './milestones';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

// ---- The table ----
check('66 books', BOOK_VERSES.length === 66);
check("same books, same order as the app's list", BOOK_VERSES.every(([n], i) => ALL_BIBLE_BOOKS[i]?.name === n), BOOK_VERSES.map(([n]) => n).filter((n, i) => ALL_BIBLE_BOOKS[i]?.name !== n));
const sum = (a: ReadonlyArray<readonly [string, number]>) => a.reduce((n, [, v]) => n + v, 0);
check('Old Testament adds to 23,145', sum(BOOK_VERSES.slice(0, 39)) === 23145, sum(BOOK_VERSES.slice(0, 39)));
check('New Testament adds to 7,957', sum(BOOK_VERSES.slice(39)) === 7957, sum(BOOK_VERSES.slice(39)));
check('Bible adds to 31,102', sum(BOOK_VERSES) === 31102);
const v: Record<string, number> = Object.fromEntries(BOOK_VERSES);
check('Psalms 2,461 (longest), Genesis 1,533, 3 John 14, 2 John 13 (shortest)', v.Psalms === 2461 && v.Genesis === 1533 && v['3 John'] === 14 && v['2 John'] === 13);
check('Ruth 85, Philippians 104, Hebrews 303', v.Ruth === 85 && v.Philippians === 104 && v.Hebrews === 303);
check('Psalms is the longest and 2 John the shortest', Math.max(...Object.values(v)) === 2461 && Math.min(...Object.values(v)) === 13);

// ---- The ladder ----
check('ladder is sorted shortest first', LANDMARKS.every((l, i) => i === 0 || LANDMARKS[i - 1].verses <= l.verses));
check('ties stay in Bible order (Philemon before Jude)', LANDMARKS.findIndex((l) => l.book === 'Philemon') < LANDMARKS.findIndex((l) => l.book === 'Jude'));
let p = ladderPosition(0);
check('nothing held: no landmark passed, next is 2 John, 14 to go', p.passed === null && p.next?.book === '2 John' && p.toGo === 14, p);
check('nothing held: no "you hold" line', heldLine(p) === null);
p = ladderPosition(13);
check('exactly 13: still not past 2 John', p.passed === null && p.toGo === 1);
check('1 to go reads plainly', nextLine(p) === 'Next: 2 John, 1 to go', nextLine(p));
p = ladderPosition(86);
const afterRuth = LANDMARKS[LANDMARKS.findIndex((l) => l.book === 'Ruth') + 1];
check('86: more than Ruth, next is the next-longest book', p.passed?.book === 'Ruth' && p.next?.book === afterRuth.book, p);
check("Ruth and Philippians are 19 apart (the user's example)", v.Philippians - v.Ruth === 19);
p = ladderPosition(100);
check('toGo counts to more than the next book', p.toGo === p.next!.verses + 1 - 100);
p = ladderPosition(2462);
check('past Psalms: everything passed, nothing next', p.passed?.book === 'Psalms' && p.next === null && p.toGo === 0 && nextLine(p) === null);
check('passedLandmarks matches', passedLandmarks(2462).length === 66 && passedLandmarks(0).length === 0 && passedLandmarks(14).map((l) => l.book).join() === '2 John');
check('lines read plainly', /^You hold more verses than /.test(heldLine(ladderPosition(90))!) && /^Next: .+, \d+ to go$/.test(nextLine(ladderPosition(90))!));
check('a circle can use it', heldLine(ladderPosition(90), 'Together you')!.startsWith('Together you hold'));
check('text joins both', landmarkText(ladderPosition(90)).includes('Next:') && landmarkText(ladderPosition(90)).includes('hold more'));
check('bad counts are safe', ladderPosition(-5).held === 0 && ladderPosition(3.9).held === 3);

// ---- Verses held ----
const item = (book: string, chapter: number, verse: number, over: Partial<QueueItem> = {}, tr = 'BSB'): QueueItem =>
  ({
    verseId: `${tr}_${book}_${chapter}_${verse}`, translationId: tr, book, chapter, verseNumber: verse, text: 'x', orderIndex: 0,
    status: 'reviewing', retentionPhase: 'daily', dateStarted: null, lastReviewDate: null, nextReviewDueDate: null,
    currentStreakCount: 0, totalSuccessfulReviews: 0, gracePeriodUsedToday: false, ...over,
  }) as QueueItem;
const log = (at: string, result: ReviewLog['result'], stage: ReviewLog['stage']): ReviewLog => ({ at, result, stage });
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const queue: QueueItem[] = [
  item('John', 3, 1, { status: 'queued', retentionPhase: 'none' }),
  item('John', 3, 2, { status: 'learning', retentionPhase: 'none' }),
  item('John', 3, 3, { retentionPhase: 'daily' }),
  item('John', 3, 4, { retentionPhase: 'weekly' }),
  item('John', 3, 5, { retentionPhase: 'monthly' }),
  item('John', 3, 6, { status: 'retained', retentionPhase: 'monthly' }),
  item('John', 3, 7, { retentionPhase: 'daily', refresherActive: true, refresherReturnPhase: 'weekly' }),
  item('John', 3, 3, { retentionPhase: 'daily' }, 'KJV'), // same verse, other translation
];
check('held = past Learning, waiting and learning left out, a refresher still held', versesHeld(queue) === 5, versesHeld(queue));
check('a verse in two translations counts once', versesHeld([item('John', 3, 3), item('John', 3, 3, {}, 'ESV')]) === 1);
check('empty queue holds nothing', versesHeld([]) === 0);

// ---- When a verse left Learning ----
check('last Learning pass is the day it left',
  leftLearningAt(item('A', 1, 1, { reviewLogs: [log('2026-01-01T10:00:00Z', 'pass', 'learning'), log('2026-01-03T10:00:00Z', 'pass', 'learning'), log('2026-01-04T09:00:00Z', 'pass', 'daily')] })) === '2026-01-03T10:00:00Z');
check('a Learning miss is not the day it left',
  leftLearningAt(item('A', 1, 1, { reviewLogs: [log('2026-01-01T10:00:00Z', 'pass', 'learning'), log('2026-01-02T10:00:00Z', 'miss', 'learning'), log('2026-01-05T09:00:00Z', 'pass', 'daily')] })) === '2026-01-01T10:00:00Z');
check('a hand placement is dated when placed',
  leftLearningAt(item('A', 1, 1, { reviewLogs: [log('2026-01-01T10:00:00Z', 'pass', 'learning'), log('2026-02-01T10:00:00Z', 'placed', 'weekly')] })) === '2026-02-01T10:00:00Z');
check('graduated and not yet reviewed: the last Learning pass',
  leftLearningAt(item('A', 1, 1, { reviewLogs: [log('2026-03-01T10:00:00Z', 'pass', 'learning')] })) === '2026-03-01T10:00:00Z');
check('reviews but no Learning log: the first review',
  leftLearningAt(item('A', 1, 1, { reviewLogs: [log('2026-03-09T10:00:00Z', 'pass', 'daily'), log('2026-03-10T10:00:00Z', 'pass', 'daily')] })) === '2026-03-09T10:00:00Z');
check('logs out of order are sorted',
  leftLearningAt(item('A', 1, 1, { reviewLogs: [log('2026-01-04T09:00:00Z', 'pass', 'daily'), log('2026-01-03T10:00:00Z', 'pass', 'learning')] })) === '2026-01-03T10:00:00Z');
check('no logs: last practiced, then started, else unknown',
  leftLearningAt(item('A', 1, 1, { lastReviewDate: '2026-04-01T00:00:00Z', dateStarted: '2026-03-01T00:00:00Z' })) === '2026-04-01T00:00:00Z' &&
  leftLearningAt(item('A', 1, 1, { dateStarted: '2026-03-01T00:00:00Z' })) === '2026-03-01T00:00:00Z' &&
  leftLearningAt(item('A', 1, 1)) === null);

// ---- Dating the landmarks ----
// 100 verses, one leaving Learning a day from Jan 1: the 14th left on Jan 14.
const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12)).toISOString();
const hundred = range(1, 100).map((n) => item('Psalms', 119, n, { reviewLogs: [log(day(n), 'pass', 'learning'), log(day(n + 1), 'pass', 'daily')] }));
const dates = heldDates(hundred);
check('100 dates, oldest first', dates.length === 100 && dates[0] === day(1) && dates[99] === day(100));
const passed = landmarkDates(dates);
check('every landmark under 100 is passed', passed.map((x) => x.landmark.book).join() === passedLandmarks(100).map((l) => l.book).join());
const twoJohn = passed.find((x) => x.landmark.book === '2 John')!;
check('2 John (13) is passed the day the 14th verse left Learning', twoJohn.at === day(14), twoJohn);
const ruthP = passed.find((x) => x.landmark.book === 'Ruth')!;
check('Ruth (85) is passed the day the 86th verse left Learning', ruthP.at === day(86), ruthP);
check('Philippians (104) is not passed at 100 verses', !passed.some((x) => x.landmark.book === 'Philippians'));
const shuffled = [...hundred].reverse().concat(
  hundred.slice(0, 10).map((q) => ({ ...q, translationId: 'ESV', verseId: 'E' + q.verseId, reviewLogs: [log(day(50), 'pass', 'learning')] }) as QueueItem)
);
const d2 = heldDates(shuffled);
check('input order and extra translations do not change it; the earlier copy wins', d2.length === 100 && d2.join() === dates.join());
const mixed = heldDates([item('A', 1, 1), item('A', 1, 2, { lastReviewDate: day(5) })]);
check('an undated verse sorts first', mixed[0] === null && mixed[1] === day(5));
check('nothing held, nothing passed', landmarkDates([]).length === 0);

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll milestones checks passed.');
