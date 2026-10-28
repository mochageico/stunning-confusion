// Assertions for where a verse sits on the ladder, run by `npm run check:stages`.

import { QueueItem } from '../types';
import {
  arrivalDates,
  groupByStage,
  isTopStep,
  ladderEstimates,
  passageGapNotes,
  legacyLadderState,
  passageRuns,
  referenceFor,
  roadEstimates,
  stageCounts,
  stageProgress,
  verseStage,
} from './stageProgress';
import { allLearnedBy, forecastCounts, horizonDate, learnedCount, projectStartDates, stageOn } from './forecast';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const PLAN = { masteryTouches: 3 };
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
/** A verse that already carries its ladder place. */
const onStep = (step: number, reviews: number, overrides: Partial<QueueItem> = {}) =>
  item({ ladderStep: step, ladderReviews: reviews, currentStreakCount: 0, ...overrides });

console.log('groups');
check('queued is waiting', verseStage(item({ status: 'queued', retentionPhase: 'none' })) === 'waiting');
check('learning', verseStage(item({ status: 'learning', retentionPhase: 'none' })) === 'learning');
check('retained is Secure', verseStage(item({ status: 'retained', retentionPhase: 'none' })) === 'secure');
check('steps 0-2 are Settling', [0, 1, 2].every((s) => verseStage(onStep(s, 0)) === 'settling'));
check('steps 3-4 are Steady', [3, 4].every((s) => verseStage(onStep(s, 0)) === 'steady'));
check('steps 5-6 are Kept, step 7 is Secure', [5, 6].every((s) => verseStage(onStep(s, 0)) === 'kept') && verseStage(onStep(7, 0)) === 'secure');
check('ladderStep wins over the old phase', verseStage(onStep(4, 2, { retentionPhase: 'daily', currentStreakCount: 3 })) === 'steady');
check('only step 7 is the top', isTopStep(onStep(7, 0)) && !isTopStep(onStep(6, 0)) && !isTopStep(item({ status: 'learning', retentionPhase: 'none' })));

console.log('unmigrated verses are placed from their old streak');
const legacy = (phase: 'daily' | 'weekly' | 'monthly', n: number) => legacyLadderState(item({ retentionPhase: phase, currentStreakCount: n }));
const at = (l: { step: number; reviews: number }) => `${l.step}/${l.reviews}`;
check('daily 0 -> Every day, 0', at(legacy('daily', 0)) === '0/0');
check('daily 6 -> Every day, 6', at(legacy('daily', 6)) === '0/6');
check('daily 7 -> Every 2 days, 0', at(legacy('daily', 7)) === '1/0');
check('daily 11 -> Every 4 days, 0', at(legacy('daily', 11)) === '2/0');
check('daily 15 -> Every week, 0', at(legacy('daily', 15)) === '3/0');
check('weekly 7 -> Every week, 7', at(legacy('weekly', 7)) === '3/7');
check('weekly 8 -> Every 2 weeks, 0', at(legacy('weekly', 8)) === '4/0');
check('weekly 14 -> Every 4 weeks, 0', at(legacy('weekly', 14)) === '5/0');
check('monthly 11 -> Every 4 weeks, 11', at(legacy('monthly', 11)) === '5/11');
check('monthly 12 -> Every 8 weeks, 0', at(legacy('monthly', 12)) === '6/0');
check('monthly 18 -> Every 6 months', at(legacy('monthly', 18)) === '7/0');
check('retained -> Every 6 months', legacyLadderState(item({ status: 'retained' })).step === 7);
check(
  'a refresher places it where it will return',
  at(legacyLadderState(item({ retentionPhase: 'daily', refresherActive: true, refresherReturnPhase: 'weekly', refresherReturnProgress: 9 }))) === '4/1'
);

console.log('every day');
const d = stageProgress(onStep(0, 5), PLAN, TODAY);
check('7 reviews: 5 done reads "Every day, 5 of 7 reviews"', d.position === 'Every day, 5 of 7 reviews', d.position);
check('2 reviews to go', d.remaining === 2, d.remaining);
check('moves up the day after next due', !!d.movesUpOn && day(d.movesUpOn.toISOString()) === '2026-10-12', d.movesUpOn);
check('fraction is 5/7', Math.abs(d.fraction - 5 / 7) < 1e-9, d.fraction);
const fresh = stageProgress(onStep(0, 0, { dateStarted: '2026-10-09T00:00:00Z' }), PLAN, TODAY);
check('arrived 2 days ago is just moved up', fresh.justMovedUp);
check('arrived weeks ago is not', !d.justMovedUp);

console.log('higher steps');
const w = stageProgress(onStep(4, 3), PLAN, TODAY);
check('Every 2 weeks, 3 of 6', w.position === 'Every 2 weeks, 3 of 6 reviews' && w.step === 4 && w.stage === 'steady', w);
check('moves up 3 reviews x 14 days - 14 after next due', !!w.movesUpOn && day(w.movesUpOn.toISOString()) === '2026-11-08', w.movesUpOn);
const newStep = stageProgress(onStep(5, 0), PLAN, TODAY);
check('first review of a step is just moved up', newStep.justMovedUp && newStep.position === 'Every 4 weeks, 0 of 12 reviews', newStep);
const thorough = stageProgress(onStep(3, 2), { masteryTouches: 3, thoroughness: 1.5 }, TODAY);
check('Thorough needs 12 at Every week', thorough.position === 'Every week, 2 of 12 reviews', thorough.position);
const light = stageProgress(onStep(0, 2), { masteryTouches: 3, thoroughness: 0.5 }, TODAY);
check('Light needs 4 at Every day', light.position === 'Every day, 2 of 4 reviews', light.position);

console.log('catch-up');
const cu = stageProgress(onStep(1, 1, { catchUp: true }), PLAN, TODAY);
check('catch-up targets apply: Every 2 days needs 2', cu.catchUp && cu.position === 'Every 2 days, 1 of 2 reviews', cu);
const cuHigh = stageProgress(onStep(3, 1, { catchUp: true }), PLAN, TODAY);
check('a stray catchUp above Every 4 days is ignored', !cuHigh.catchUp && cuHigh.position === 'Every week, 1 of 8 reviews', cuHigh);

console.log('the top');
const top = stageProgress(onStep(7, 0), PLAN, TODAY);
check('Every 6 months reads "for good"', top.top && top.stage === 'secure' && top.position === 'Every 6 months, for good' && top.fraction === 1, top);
check('nothing to move up to', top.movesUpOn === null && top.remaining === 0);
check('retained verses are on the top', stageProgress(item({ status: 'retained', retentionPhase: 'none' }), PLAN, TODAY).top);

console.log('weak spots');
check('slipped carries through', stageProgress(onStep(2, 1, { slipped: true }), PLAN, TODAY).slipped);
check('not slipped by default', !stageProgress(onStep(2, 1), PLAN, TODAY).slipped);

console.log('learning');
const l = stageProgress(item({ status: 'learning', retentionPhase: 'none', touchLogs: [{} as never, {} as never] }), PLAN, TODAY);
check('2 of 3 practices', l.position === '2 of 3 practices' && l.remaining === 1 && l.step === null, l);

console.log('road estimates');
const ladder = ladderEstimates(onStep(0, 5), PLAN, TODAY);
check('nothing for the step it is on or behind it', ladder[0] === null);
check('Every 2 days arrives on the move-up review', !!ladder[1] && day(ladder[1].toISOString()) === '2026-10-12', ladder[1]);
check('Every 4 days is 4 reviews x 2 days later', !!ladder[2] && day(ladder[2].toISOString()) === '2026-10-20', ladder[2]);
check('Every week is 4 reviews x 4 days after that', !!ladder[3] && day(ladder[3].toISOString()) === '2026-11-05', ladder[3]);
check('the top is years off', !!ladder[7] && ladder[7].getUTCFullYear() >= 2028, ladder[7]);
check('arrivals only ever move later', ladder.every((d, i) => !d || i === 0 || !ladder[i - 1] || d.getTime() >= ladder[i - 1]!.getTime()));
const est = roadEstimates(onStep(0, 5), PLAN, TODAY);
check('Steady is the arrival at Every week', !!est.steady && day(est.steady.toISOString()) === '2026-11-05', est.steady);
check('Kept is the arrival at Every 4 weeks', !!est.kept && est.kept.getUTCFullYear() === 2027, est.kept);
check('nothing for groups already passed', est.settling === undefined && est.learning === undefined);
check('a catch-up is quicker than the standard climb', (() => {
  const a = ladderEstimates(onStep(0, 0, { catchUp: true }), PLAN, TODAY)[3];
  const b = ladderEstimates(onStep(0, 0), PLAN, TODAY)[3];
  return !!a && !!b && a.getTime() < b.getTime();
})());
check('a Learning verse starts Settling tomorrow', (() => {
  const e = roadEstimates(item({ status: 'learning', retentionPhase: 'none' }), PLAN, TODAY);
  return !!e.settling && day(e.settling.toISOString()) === '2026-10-12';
})());
check('waiting gets no estimates', Object.keys(roadEstimates(item({ status: 'queued', retentionPhase: 'none' }), PLAN, TODAY)).length === 0);
check('the top has none ahead', ladderEstimates(onStep(7, 0), PLAN, TODAY).every((d) => d === null));

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
check('Settling arrives on the review that moved it', !!a.settling && a.settling.toISOString() === '2026-09-27T12:00:00.000Z', a.settling);
const midway = arrivalDates(item({ retentionPhase: 'weekly', dateStarted: null, reviewLogs: [{ at: '2026-09-28T09:00:00Z', result: 'pass', stage: 'weekly' }] }));
check('a log that starts mid-stage claims no arrival', midway.steady === undefined && midway.learning === undefined, midway);
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
check('refresher entries are not a trip back down', refresherLogs.steady === undefined, refresherLogs);

console.log('grouping');
const q = [
  item({ verseId: 'a', verseNumber: 6, book: 'Philippians', chapter: 4, ladderStep: 0, ladderReviews: 3 }),
  item({ verseId: 'b', verseNumber: 7, book: 'Philippians', chapter: 4, ladderStep: 0, ladderReviews: 3, slipped: true }),
  item({ verseId: 'c', verseNumber: 8, book: 'Philippians', chapter: 4, ladderStep: 0, ladderReviews: 6 }),
  item({ verseId: 'd', verseNumber: 9, book: 'Joshua', chapter: 1, ladderStep: 3, ladderReviews: 2 }),
  item({ verseId: 'e', verseNumber: 1, book: 'Psalms', chapter: 1, status: 'retained', retentionPhase: 'none', ladderStep: 7, ladderReviews: 0 }),
  item({ verseId: 'f', verseNumber: 2, book: 'Psalms', chapter: 1, status: 'retained', retentionPhase: 'none', ladderStep: 7, ladderReviews: 0 }),
  item({ verseId: 'g', verseNumber: 9, book: 'Romans', chapter: 1, status: 'queued', retentionPhase: 'none' }),
  item({ verseId: 'h', verseNumber: 9, book: 'Philippians', chapter: 4, status: 'learning', retentionPhase: 'none', touchLogs: [] }),
  item({ verseId: 'i', verseNumber: 5, book: 'Philippians', chapter: 4, status: 'learning', retentionPhase: 'none', touchLogs: [] }),
];
const g = groupByStage(q, PLAN, TODAY);
check('neighbours at the same point share a row, a slipped one included', g.settling.some((x) => x.verses.join(',') === '6,7'), g.settling.map((x) => x.verses));
check('a neighbour further along gets its own row', g.settling.some((x) => x.verses.join(',') === '8'));
check('closest to moving up first', g.settling[0].verses.join(',') === '8', g.settling.map((x) => x.key));
check('Steady groups on their own', g.steady.length === 1 && g.steady[0].book === 'Joshua');
check('the top step groups as Secure, flagged', g.secure.length === 1 && g.secure[0].verses.length === 2 && g.secure[0].progress.top);
check('waiting verses are left to the reorder list', g.waiting.length === 0);
const joinsAfter = g.learning.find((x) => x.verses[0] === 9);
const joinsBefore = g.learning.find((x) => x.verses[0] === 5);
check('a Learning verse after a passage says it joins it', joinsAfter?.joins === 'Joins verses 6–8 when it moves up', joinsAfter?.joins);
check('...and one before it says the same', joinsBefore?.joins === 'Joins verses 6–8 when it moves up', joinsBefore?.joins);
const counts = stageCounts(q);
check('counts every verse', counts.settling === 3 && counts.steady === 1 && counts.kept === 0 && counts.secure === 2 && counts.learning === 2 && counts.waiting === 1, counts);

console.log('passages and references');
const runs = passageRuns([
  ...[1, 2, 3, 4].map((v) => onStep(3, 1, { verseId: `r${v}`, verseNumber: v })),
  ...[7, 8].map((v) => onStep(3, 1, { verseId: `r${v}`, verseNumber: v })),
  onStep(3, 1, { verseId: 'rb', verseNumber: 5, translationId: 'ESV' }),
  item({ verseId: 'rl', verseNumber: 6, status: 'learning', retentionPhase: 'none' }),
]);
check('an unbroken run is one passage; a gap splits; translations stay apart', runs.length === 3 && runs[0].end === 4 && runs[1].start === 5 && runs[1].translationId === 'ESV' && runs[2].start === 7, runs);
check('Learning verses are not part of a passage', !runs.some((r) => r.start <= 6 && r.end >= 6));
const gapRuns = [
  { book: 'Romans', chapter: 8, translationId: 'BSB', start: 1, end: 2 },
  { book: 'Romans', chapter: 8, translationId: 'BSB', start: 5, end: 5 },
];
check('a gap that is not on the list says the passages stay separate', passageGapNotes(gapRuns, () => false)[0] === "Verses 3–4 aren't on your list, so verses 1–2 and 5 are reviewed as separate passages.", passageGapNotes(gapRuns, () => false));
check('a gap that is Waiting or Learning says they join once learned', passageGapNotes(gapRuns, () => true)[0] === 'Verses 3–4 are on the way. Once learned, verses 1–2 and 5 join into one passage.', passageGapNotes(gapRuns, () => true));
check('a one-verse gap reads singular', passageGapNotes([gapRuns[0], { ...gapRuns[1], start: 4, end: 9 }], () => false)[0] === "Verse 3 isn't on your list, so verses 1–2 and 4–9 are reviewed as separate passages.");
check('no gap, no note', passageGapNotes([gapRuns[0]], () => false).length === 0);
check('references use an en dash', referenceFor('Romans', 8, [21, 22]) === 'Romans 8:21–22' && referenceFor('Romans', 8, [5]) === 'Romans 8:5');

console.log('forecast');
const FPLAN = { ...PLAN, dailyPhaseWeeks: 7, weeklyPhaseMonths: 6, monthlyPhaseYears: 5, learningDays: ['M', 'W', 'F'], newVersesPace: 2, sabbathEnabled: false, sabbathDay: 'Su' };
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);
const FTODAY = local(2026, 10, 11); // a Sunday
const waiting = [1, 2, 3, 4, 5].map((v) =>
  item({ verseId: `w${v}`, book: 'Romans', chapter: 8, verseNumber: 30 + v, status: 'queued', retentionPhase: 'none', orderIndex: v, dateStarted: null, nextReviewDueDate: null, currentStreakCount: 0 })
);
const fq = [...waiting, onStep(2, 3, { verseId: 'd1', dateStarted: '2026-10-01T12:00:00Z' }), item({ verseId: 'k1', status: 'retained', retentionPhase: 'none' })];
const starts = projectStartDates(fq, FPLAN, FTODAY);
const startDay = (id: string) => starts.get(id)?.getDate();
check('2 a day on Mon, Wed, Fri', startDay('w1') === 12 && startDay('w2') === 12 && startDay('w3') === 14 && startDay('w4') === 14 && startDay('w5') === 16, Array.from(starts.entries()));
check('no learning days, nothing starts', projectStartDates(fq, { ...FPLAN, learningDays: [] }, FTODAY).size === 0);
check('an open-ended pause starts nothing', projectStartDates(fq, { ...FPLAN, pausedAt: '2026-10-01T00:00:00Z', pausedUntil: null }, FTODAY).size === 0);
const now = forecastCounts(fq, FPLAN, FTODAY, starts, FTODAY);
check('now is the counts as they stand', now.waiting === 5 && now.settling === 1 && now.secure === 1, now);
const m1 = forecastCounts(fq, FPLAN, horizonDate('m1', FTODAY), starts, FTODAY);
check('in a month all five are in Settling', m1.waiting === 0 && m1.learning === 0 && m1.settling === 5, m1);
check('the Every 4 days verse due to move up is Steady by then', m1.steady === 1, m1);
check('the total never changes', Object.values(m1).reduce((a, b) => a + b, 0) === fq.length);
check('learned counts Settling onward', learnedCount(m1) === 7, learnedCount(m1));
const y1 = forecastCounts(fq, FPLAN, horizonDate('y1', FTODAY), starts, FTODAY);
check('in a year the five and the Steady verse are Kept', y1.kept === 6 && y1.secure === 1, y1);
check('a waiting verse with no start stays waiting', stageOn(waiting[0], PLAN, horizonDate('y1', FTODAY), undefined, FTODAY) === 'waiting');
const learnedBy = allLearnedBy(waiting, PLAN, starts, FTODAY);
check('all learned the day after the last starts', learnedBy instanceof Date && learnedBy.getDate() === 17, learnedBy);
check('already learned is done', allLearnedBy([fq[5], fq[6]], PLAN, starts, FTODAY) === 'done');
check('unknown start gives no date', allLearnedBy(waiting, PLAN, new Map(), FTODAY) === null);

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall passed');
