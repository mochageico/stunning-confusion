// Regression assertions for circle totals (src/lib/circleTotals.ts), run by
// `npm run check:circletotals`. Dates are built in local time, like the app's
// logical day, so this passes in any time zone.

import type { CircleMember, CircleMemberStats, QueueItem, ReviewLog } from '../types';
import {
  cleanStats,
  combineCircle,
  isReviewLog,
  memberOrder,
  myWeekStats,
  reviewsInWeek,
  togetherLine,
  weekBounds,
  weeklyLine,
  withCommas,
} from './circleTotals';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

// Local time: month is 1-based here for reading ease. 2026-10-19 is a Monday.
const at = (m: number, d: number, h = 12, min = 0) => new Date(2026, m - 1, d, h, min);
const iso = (m: number, d: number, h = 12, min = 0) => at(m, d, h, min).toISOString();

// ---- Week bounds ----
let w = weekBounds(at(10, 21), 0); // Wednesday
check('a Wednesday belongs to the week of Monday the 19th', w.key === '2026-10-19', w.key);
check('starts Monday at midnight', w.start.getTime() === at(10, 19, 0).getTime());
check('ends the next Monday at midnight', w.end.getTime() === at(10, 26, 0).getTime());
check('Monday itself is in its own week', weekBounds(at(10, 19, 0, 1), 0).key === '2026-10-19');
check('Sunday night is still the same week', weekBounds(at(10, 25, 23, 59), 0).key === '2026-10-19');
check('next Monday starts a new week', weekBounds(at(10, 26, 0, 0), 0).key === '2026-10-26');
check('a Sunday is the last day, not the first', weekBounds(at(10, 25), 0).key === '2026-10-19');
// Day-start hour 2: the day turns over at 2am, so does the week.
check('day starts at 2am: Monday 1am is still last week', weekBounds(at(10, 26, 1), 2).key === '2026-10-19');
check('day starts at 2am: Monday 2am is the new week', weekBounds(at(10, 26, 2), 2).key === '2026-10-26');
w = weekBounds(at(10, 21), 2);
check('day starts at 2am: bounds are Monday 2am to Monday 2am', w.start.getTime() === at(10, 19, 2).getTime() && w.end.getTime() === at(10, 26, 2).getTime());
check('a week across a month end keys on its Monday', weekBounds(at(11, 1), 0).key === '2026-10-26');
check('a week across a year end keys on its Monday', weekBounds(new Date(2027, 0, 2, 12), 0).key === '2026-12-28');

// ---- Counting one person's reviews ----
const log = (atIso: string, result: ReviewLog['result'], stage: ReviewLog['stage']): ReviewLog => ({ at: atIso, result, stage });
const item = (verse: number, logs: ReviewLog[], over: Partial<QueueItem> = {}, tr = 'BSB'): QueueItem =>
  ({
    verseId: `${tr}_John_3_${verse}`, translationId: tr, book: 'John', chapter: 3, verseNumber: verse, text: 'x', orderIndex: 0,
    status: 'reviewing', retentionPhase: 'weekly', dateStarted: null, lastReviewDate: null, nextReviewDueDate: null,
    currentStreakCount: 0, totalSuccessfulReviews: 0, gracePeriodUsedToday: false, reviewLogs: logs, ...over,
  }) as QueueItem;

check('a pass, a miss and grace are reviews', isReviewLog(log('x', 'pass', 'daily')) && isReviewLog(log('x', 'miss', 'weekly')) && isReviewLog(log('x', 'grace', 'monthly')));
check('Learning practice, skipped and placed are not', !isReviewLog(log('x', 'pass', 'learning')) && !isReviewLog(log('x', 'skipped', 'daily')) && !isReviewLog(log('x', 'placed', 'weekly')));

w = weekBounds(at(10, 23), 0);
const queue: QueueItem[] = [
  item(1, [log(iso(10, 18, 22), 'pass', 'daily'), log(iso(10, 19, 8), 'pass', 'daily'), log(iso(10, 22), 'miss', 'daily')]),
  item(2, [log(iso(10, 20), 'pass', 'learning'), log(iso(10, 21), 'pass', 'learning')], { status: 'learning', retentionPhase: 'none' }),
  item(3, [log(iso(10, 20), 'grace', 'weekly'), log(iso(10, 26, 0, 30), 'pass', 'weekly')]),
  item(3, [log(iso(10, 20), 'pass', 'weekly')], {}, 'KJV'),
  item(4, [log('not a date', 'pass', 'daily')]),
  item(5, []),
];
check("this week's reviews: Monday's, the miss, grace, the other translation; not last Sunday's, Learning or next week's", reviewsInWeek(queue, w) === 4, reviewsInWeek(queue, w));
check('no logs at all is zero', reviewsInWeek([item(1, [])], w) === 0 && reviewsInWeek([], w) === 0);
const mine = myWeekStats(queue, at(10, 23), 0);
check('my week: Monday key, reviews, held (verse 3 once across translations)', mine.weekStart === '2026-10-19' && mine.reviewed === 4 && mine.held === 4, mine);
check('the day-start hour moves an early-Monday review into last week', myWeekStats([item(1, [log(iso(10, 19, 1), 'pass', 'daily')])], at(10, 23), 2).reviewed === 0);

// ---- Reading a doc ----
const clean = cleanStats('u1', { weekStart: '2026-10-19', reviewed: 12.7, held: -3, updatedAt: 5 });
check('a doc is cleaned: whole numbers, no negatives, bad fields blank', clean.reviewed === 12 && clean.held === 0 && clean.updatedAt === '' && clean.uid === 'u1', clean);
check('an empty doc reads as zero', cleanStats('u1', undefined).reviewed === 0 && cleanStats('u1', null).weekStart === '');
check('huge numbers are capped', cleanStats('u1', { reviewed: 1e12, held: 1e9 }).reviewed === 100000 && cleanStats('u1', { held: 1e9 }).held === 40000);

// ---- The circle together ----
const member = (uid: string, displayName: string, joinedAt: string): CircleMember => ({ uid, displayName, avatarUrl: '', role: 'member', joinedAt });
const members = [member('u3', 'David', iso(9, 3)), member('u1', 'Micah', iso(8, 1)), member('u2', 'Sarah', iso(8, 20))];
const stat = (uid: string, weekStart: string, reviewed: number, held: number, updatedAt = iso(10, 22)): CircleMemberStats => ({ uid, weekStart, reviewed, held, updatedAt });
const shared = [
  { authorUid: 'u1', createdAt: iso(10, 20) },
  { authorUid: 'u2', createdAt: iso(10, 22) },
  { authorUid: 'u2', createdAt: iso(10, 12) }, // last week
  { authorUid: 'u9', createdAt: iso(10, 21) }, // left the circle
];
let t = combineCircle(
  members,
  [stat('u1', '2026-10-19', 30, 200), stat('u2', '2026-10-19', 90, 150), stat('u9', '2026-10-19', 500, 900)],
  shared,
  w
);
check('member order is join date, not amount', t.parts.map((p) => p.uid).join() === 'u1,u2,u3', t.parts.map((p) => p.uid));
check('memberOrder ignores the list order it was given', memberOrder([...members].reverse()).map((m) => m.uid).join() === 'u1,u2,u3');
check('reviews add up; someone who left (u9) is not counted', t.reviewed === 120, t.reviewed);
check('verses held add up, without the person who left', t.held === 350, t.held);
check("takeaways: this week's, by current members only", t.takeaways === 2, t.takeaways);
check('a member with no stats doc yet counts as zero', t.parts[2].reviewed === 0 && t.parts[2].fraction === 0);
check('shares are each part of the total', t.parts[0].fraction === 0.25 && t.parts[1].fraction === 0.75);
check('shares add to 1', Math.abs(t.parts.reduce((n, p) => n + p.fraction, 0) - 1) < 1e-9);

t = combineCircle(members, [stat('u1', '2026-10-12', 80, 210), stat('u2', '2026-10-19', 10, 150)], [], w);
check("last week's doc counts as zero reviews this week", t.reviewed === 10 && t.parts[0].reviewed === 0, t);
check("last week's doc still counts its verses held", t.held === 360, t.held);
check('with one person reviewing, they hold the whole bar', t.parts[1].fraction === 1);

t = combineCircle(members, [stat('u1', '2026-10-19', 5, 10, iso(10, 20)), stat('u1', '2026-10-19', 9, 11, iso(10, 22))], [], w);
check('two docs for one person: the newer wins, never both', t.reviewed === 9 && t.held === 11, t);

t = combineCircle(members, [], [], w);
check('nobody has written yet: all zero, no shares', t.reviewed === 0 && t.held === 0 && t.parts.every((p) => p.fraction === 0) && t.parts.length === 3);
t = combineCircle([], [stat('u1', '2026-10-19', 5, 10)], shared, w);
check('no members (just left): nothing counts', t.reviewed === 0 && t.held === 0 && t.takeaways === 0 && t.parts.length === 0);

// ---- Words ----
check('commas', withCommas(2140) === '2,140' && withCommas(999) === '999' && withCommas(1234567) === '1,234,567' && withCommas(0) === '0');
check('the weekly line', weeklyLine('the Tuesday group', { reviewed: 2140, takeaways: 6 }) === 'This week the Tuesday group reviewed 2,140 verses and wrote 6 takeaways.', weeklyLine('the Tuesday group', { reviewed: 2140, takeaways: 6 }));
check('singulars', weeklyLine('Grace', { reviewed: 1, takeaways: 1 }) === 'This week Grace reviewed 1 verse and wrote 1 takeaway.');
check('no takeaways: just the reviews', weeklyLine('Grace', { reviewed: 40, takeaways: 0 }) === 'This week Grace reviewed 40 verses.');
check('only takeaways', weeklyLine('Grace', { reviewed: 0, takeaways: 2 }) === 'This week Grace wrote 2 takeaways.');
check('nothing yet', weeklyLine('Grace', { reviewed: 0, takeaways: 0 }) === 'No reviews yet this week.');
check('together line past Hebrews', togetherLine(304) === 'Together you hold more verses than the book of Hebrews. Next: Daniel, 54 to go.', togetherLine(304));
check('together line before the first landmark', togetherLine(8) === 'Together you hold 8 verses. Next: 2 John, 6 to go.', togetherLine(8));
check('together line with nothing held is empty', togetherLine(0) === '');
check('together line past Psalms has no Next', togetherLine(5000) === 'Together you hold more verses than the book of Psalms.', togetherLine(5000));

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll circle totals checks passed.');
