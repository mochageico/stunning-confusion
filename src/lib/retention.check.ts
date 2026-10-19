// Assertions for the review engine's scheduling math, run by `npm run check:retention`.
// Covers src/lib/retention.ts, missPolicy.ts and logicalDate.ts -- the pure
// helpers that moved out of useAppState.ts.

import { QueueItem } from '../types';
import {
  computeNextDueDate,
  estimateReviewMinutes,
  forecastMemoryLoad,
  isReviewDue,
  isTouchSpaced,
  nextDueDateISO,
  ReviewClock,
} from './retention';
import { applyMissToItem, computeMissedCycles, resolveMissedCycles } from './missPolicy';
import { countPausedDaysInRange, countSabbathDaysInRange, getLogicalDate, localDayKey } from './logicalDate';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

// Local-time dates, so the checks hold in any time zone.
// 2026-10-16 is a Friday.
const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour);
const dayOf = (iso: string) => localDayKey(new Date(iso));

const CLOCK: ReviewClock = { dayStartHour: 0, sabbathEnabled: false, sabbathDay: 'S', pausedAt: null, pausedUntil: null };
const SABBATH: ReviewClock = { ...CLOCK, sabbathEnabled: true };
const POLICY = { graceCount: 1, refresherDailyDays: 7, refresherWeeklyWeeks: 4 };

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
    nextReviewDueDate: at(10, 16).toISOString(),
    currentStreakCount: 10,
    totalSuccessfulReviews: 10,
    gracePeriodUsedToday: false,
    ...overrides,
  };
}

console.log('isReviewDue');
check('no due date is due', isReviewDue(null, at(10, 16)));
check('earlier the same day is due', isReviewDue(at(10, 16, 21).toISOString(), at(10, 16, 9)));
check('yesterday is due', isReviewDue(at(10, 15).toISOString(), at(10, 16)));
check('tomorrow is not due', !isReviewDue(at(10, 17, 1).toISOString(), at(10, 16, 23)));

console.log('logical day');
check('2am day start: 1am still counts as yesterday', localDayKey(getLogicalDate(2, at(10, 17, 1))) === '2026-10-16');
check('midnight day start leaves the date alone', localDayKey(getLogicalDate(0, at(10, 17, 1))) === '2026-10-17');
check('one Saturday between Fri and the next Mon', countSabbathDaysInRange(at(10, 16), at(10, 19), 'S') === 1);
check('paused overlap counts whole days', countPausedDaysInRange(at(10, 10), at(10, 16), at(10, 13).toISOString(), at(10, 15).toISOString()) === 2);
check('no pause, no paused days', countPausedDaysInRange(at(10, 10), at(10, 16), null, null) === 0);

console.log('next due dates');
check('1 day from Friday is Saturday', dayOf(nextDueDateISO(1, CLOCK, at(10, 16))) === '2026-10-17');
check('Saturday Sabbath pushes it to Sunday', dayOf(nextDueDateISO(1, SABBATH, at(10, 16))) === '2026-10-18');
const now = at(10, 16);
const before = now.getTime();
nextDueDateISO(3, CLOCK, now);
computeNextDueDate(item(), CLOCK, now);
check('the caller’s date is never changed', now.getTime() === before);
check('daily item: tomorrow', dayOf(computeNextDueDate(item(), CLOCK, now)) === '2026-10-17');
check('weekly item, no anchor: a week out', dayOf(computeNextDueDate(item({ retentionPhase: 'weekly' }), CLOCK, now)) === '2026-10-23');
check(
  'weekly item anchored on Wednesday: next Wednesday',
  dayOf(computeNextDueDate(item({ retentionPhase: 'weekly', chapterReviewAnchorDay: 'W' }), CLOCK, now)) === '2026-10-21'
);
check(
  'monthly item anchored on Wednesday: four Wednesdays out',
  dayOf(computeNextDueDate(item({ retentionPhase: 'monthly', chapterReviewAnchorDay: 'W' }), CLOCK, now)) === '2026-11-11'
);

console.log('touch spacing');
check('first touch always counts', isTouchSpaced(item(), at(10, 16).getTime()));
const touched = item({ touchLogs: [{ timestamp: at(10, 16, 12).toISOString(), drillType: 'type' }] });
check('30 minutes later does not count', !isTouchSpaced(touched, at(10, 16, 12).getTime() + 30 * 60 * 1000));
check('an hour later counts', isTouchSpaced(touched, at(10, 16, 13).getTime()));

console.log('missed reviews');
const draft = item({ retentionPhase: 'daily' });
check('first miss uses grace', applyMissToItem(draft, POLICY) === 'grace' && draft.graceMissesUsed === 1);
check('second miss extends Daily', applyMissToItem(draft, POLICY) === 'daily-extended' && draft.dailyPhaseExtensionDays === 1);
const weekly = item({ retentionPhase: 'weekly', graceMissesUsed: 1, currentStreakCount: 5 });
check(
  'a miss out of Weekly starts a Daily refresher',
  applyMissToItem(weekly, POLICY) === 'refresher-start' &&
    weekly.retentionPhase === 'daily' &&
    weekly.refresherTargetUnits === 7 &&
    weekly.refresherReturnProgress === 5
);
const frozen = resolveMissedCycles(item({ currentStreakCount: 9 }), 3, 'graceDiscretion', POLICY);
check('grace-discretion plans freeze the gap', frozen.tag === 'frozen' && frozen.updatedItem.currentStreakCount === 9);
const reset = resolveMissedCycles(item({ currentStreakCount: 9 }), 3, 'standard', POLICY, 'reset');
check('a reset only clears the streak', reset.tag === 'streak-reset' && reset.updatedItem.currentStreakCount === 0);
check('nothing missed when not reviewing', computeMissedCycles(item({ status: 'learning' }), 0, false, 'S', null, null) === 0);
const longAgo = item({ nextReviewDueDate: new Date(Date.now() - 3.5 * 24 * 3600 * 1000).toISOString() });
check('three daily cycles missed', computeMissedCycles(longAgo, 0, false, 'S', null, null) === 3, computeMissedCycles(longAgo, 0, false, 'S', null, null));

console.log('time estimates');
const queue = [
  item({ status: 'learning', verseId: 'a' }),
  item({ status: 'learning', verseId: 'b' }),
  item({ verseId: 'c' }),
  item({ verseId: 'd' }),
  item({ verseId: 'e', nextReviewDueDate: at(10, 20).toISOString() }),
];
// 2 learning × 90s + 2 due reviews × 15s = 210s → 4 minutes.
check('today: learning plus due reviews', estimateReviewMinutes(queue, 'medium', CLOCK, at(10, 16)) === 4);
check('high sensitivity costs more', estimateReviewMinutes(queue, 'high', CLOCK, at(10, 16)) === 6);
const paused = { ...CLOCK, pausedAt: at(10, 15).toISOString(), pausedUntil: null };
check('paused: reviews cost nothing', estimateReviewMinutes(queue, 'medium', paused, at(10, 16)) === 3);
const forecast = forecastMemoryLoad(queue, 'medium', ['M', 'W', 'F'], 2, 7, CLOCK, at(10, 16));
check('one row per day', forecast.length === 7);
check('today matches the today estimate', forecast[0].loadMins === 4);
check('Tuesday Oct 20 has the one review due then', forecast[4].versesCount === 2 + 2 + 1, forecast[4]);
check('Monday Oct 19 pulls two more verses', forecast[3].isLearnDay && forecast[3].versesCount === 4, forecast[3]);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll retention checks passed');
