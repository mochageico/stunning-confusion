// Assertions for where a verse sits on the road, run by `npm run check:stages`.

import { QueueItem } from '../types';
import { arrivalDates, groupByStage, roadEstimates, stageCounts, stageProgress, verseStage } from './stageProgress';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const PLAN = { dailyPhaseWeeks: 7, weeklyPhaseMonths: 6, monthlyPhaseYears: 5, masteryTouches: 3 };
const TODAY = new Date('2026-10-11T12:00:00Z');
const day = (iso: string) => iso.slice(0, 10);

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    verseId: 'BSB_ROM_8_28',
    translationId: 'BSB',
    book: 'Romans',
    chapter: 8,
    verseNumber: 28,
    text: '',
    orderIndex: 0,
    status: 'reviewing',
    retentionPhase: 'daily',
    dateStarted: '2026-08-23T12:00:00Z',
    lastReviewDate: null,
    nextReviewDueDate: '2026-10-11T12:00:00Z',
    currentStreakCount: 47,
    totalSuccessfulReviews: 50,
    gracePeriodUsedToday: false,
    ...overrides,
  };
}

console.log('stages');
check('queued is waiting', verseStage(item({ status: 'queued', retentionPhase: 'none' })) === 'waiting');
check('learning', verseStage(item({ status: 'learning', retentionPhase: 'none' })) === 'learning');
check('retained is complete', verseStage(item({ status: 'retained', retentionPhase: 'none' })) === 'complete');
check(
  'a refresher shows in the stage it returns to',
  verseStage(item({ retentionPhase: 'daily', refresherActive: true, refresherReturnPhase: 'weekly' })) === 'weekly'
);

console.log('daily');
const d = stageProgress(item(), PLAN, TODAY);
check('49-day target: day 47 is week 7 of 7', d.position === 'Week 7 of 7', d.position);
check('2 reviews to go', d.remaining === 2, d.remaining);
check('moves up the day after next due', !!d.movesUpOn && day(d.movesUpOn.toISOString()) === '2026-10-12', d.movesUpOn);
const ext = stageProgress(item({ dailyPhaseExtensionDays: 3, currentStreakCount: 1, dateStarted: '2026-10-09T00:00:00Z' }), PLAN, TODAY);
check('a miss extension lengthens Daily (52 days = 8 weeks)', ext.position === 'Week 1 of 8', ext.position);
check('arrived 2 days ago is just moved up', ext.justMovedUp);
check('arrived weeks ago is not', !d.justMovedUp);

console.log('weekly and monthly');
const w = stageProgress(item({ retentionPhase: 'weekly', currentStreakCount: 22 }), PLAN, TODAY);
check('26 weekly reviews: 22 is month 6 of 6', w.position === 'Month 6 of 6', w.position);
check('weekly moves up 3 weeks after next due', !!w.movesUpOn && day(w.movesUpOn.toISOString()) === '2026-11-01', w.movesUpOn);
const wNew = stageProgress(item({ retentionPhase: 'weekly', currentStreakCount: 1 }), PLAN, TODAY);
check('first week in Weekly is month 1 and just moved up', wNew.position === 'Month 1 of 6' && wNew.justMovedUp, wNew);
const m = stageProgress(item({ retentionPhase: 'monthly', currentStreakCount: 13 }), PLAN, TODAY);
check('monthly review 13 is year 2 of 5', m.position === 'Year 2 of 5', m.position);

console.log('refresher');
const r = stageProgress(
  item({ retentionPhase: 'daily', refresherActive: true, refresherReturnPhase: 'weekly', refresherReturnProgress: 13, refresherTargetUnits: 7, currentStreakCount: 3 }),
  PLAN,
  TODAY
);
check('keeps its weekly place', r.stage === 'weekly' && r.position === 'Month 3 of 6', r);
check('4 refresher days left', !!r.refresher && r.refresher.remaining === 4 && r.refresher.unit === 'day', r.refresher);
check('no move-up date while on hold', r.movesUpOn === null);

console.log('learning');
const l = stageProgress(item({ status: 'learning', retentionPhase: 'none', touchLogs: [{} as never, {} as never] }), PLAN, TODAY);
check('2 of 3 practices', l.position === '2 of 3 practices' && l.remaining === 1, l);

console.log('road estimates');
const est = roadEstimates(item(), PLAN, TODAY);
check('weekly is the move-up date', !!est.weekly && day(est.weekly.toISOString()) === '2026-10-12');
check('monthly about 6 months later', !!est.monthly && est.monthly.getUTCFullYear() === 2027 && est.monthly.getUTCMonth() === 3, est.monthly);
check('complete about 5 years after that', !!est.complete && est.complete.getUTCFullYear() === 2032, est.complete);
check('nothing for stops already passed', est.daily === undefined && est.learning === undefined);
check('waiting gets no estimates', Object.keys(roadEstimates(item({ status: 'queued', retentionPhase: 'none' }), PLAN, TODAY)).length === 0);

console.log('arrivals');
const logged = item({
  dateStarted: null,
  reviewLogs: [
    { at: '2026-09-27T10:00:00Z', result: 'pass', stage: 'learning' },
    { at: '2026-09-27T12:00:00Z', result: 'pass', stage: 'learning' },
    { at: '2026-09-28T09:00:00Z', result: 'pass', stage: 'daily' },
  ],
});
const a = arrivalDates(logged);
check('learning starts at the first log', !!a.learning && day(a.learning.toISOString()) === '2026-09-27');
check('daily arrives on the review that moved it', !!a.daily && a.daily.toISOString() === '2026-09-27T12:00:00.000Z', a.daily);
const midway = arrivalDates(item({ retentionPhase: 'weekly', dateStarted: null, reviewLogs: [{ at: '2026-09-28T09:00:00Z', result: 'pass', stage: 'weekly' }] }));
check('a log that starts mid-stage claims no arrival', midway.weekly === undefined && midway.learning === undefined, midway);
const refresherLogs = arrivalDates(
  item({
    retentionPhase: 'weekly',
    dateStarted: null,
    reviewLogs: [
      { at: '2026-09-28T09:00:00Z', result: 'pass', stage: 'weekly' },
      { at: '2026-09-29T09:00:00Z', result: 'pass', stage: 'daily', refresher: true },
      { at: '2026-10-05T09:00:00Z', result: 'pass', stage: 'weekly' },
    ],
  })
);
check('refresher entries are not a trip back down', refresherLogs.weekly === undefined, refresherLogs);

console.log('grouping');
const q = [
  item({ verseId: 'a', verseNumber: 6, book: 'Philippians', chapter: 4, currentStreakCount: 3 }),
  item({ verseId: 'b', verseNumber: 7, book: 'Philippians', chapter: 4, currentStreakCount: 3 }),
  item({ verseId: 'c', verseNumber: 8, book: 'Philippians', chapter: 4, currentStreakCount: 9 }),
  item({ verseId: 'd', verseNumber: 9, book: 'Joshua', chapter: 1, currentStreakCount: 40 }),
  item({ verseId: 'e', verseNumber: 1, book: 'Psalms', chapter: 1, status: 'retained', retentionPhase: 'none' }),
  item({ verseId: 'f', verseNumber: 2, book: 'Psalms', chapter: 1, status: 'retained', retentionPhase: 'none' }),
  item({ verseId: 'g', verseNumber: 9, book: 'Romans', chapter: 1, status: 'queued', retentionPhase: 'none' }),
];
const g = groupByStage(q, PLAN, TODAY);
check('neighbours at the same point share a row', g.daily.some((x) => x.verses.join(',') === '6,7'));
check('a neighbour further along gets its own row', g.daily.some((x) => x.verses.join(',') === '8'));
check('closest to moving up first', g.daily[0].book === 'Joshua', g.daily.map((x) => x.key));
check('complete verses group too', g.complete.length === 1 && g.complete[0].verses.length === 2);
check('waiting verses are left to the reorder list', g.waiting.length === 0);
const counts = stageCounts(q);
check('counts every verse', counts.daily === 4 && counts.complete === 2 && counts.waiting === 1, counts);

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall passed');
