// Assertions for the review ladder's math, run by `npm run check:ladder`.

import type { ReviewGrade } from '../types';
import {
  applyOutcome,
  CATCH_UP_REVIEWS,
  catchUpDays,
  daysToTop,
  LADDER,
  LadderState,
  lateness,
  nextDue,
  passageOutcome,
  reviewsToMoveUp,
  stepReviewCount,
  THOROUGHNESS_PRESETS,
  TOP_STEP,
  type Thoroughness,
} from './ladder';
import { localDayKey } from './logicalDate';
import type { ReviewClock } from './retention';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

// Local-time dates so the check reads the same in any time zone.
// October 2026: the 10th is a Saturday, the 11th a Sunday, the 12th a Monday.
const at = (day: number, hour = 12, month = 9) => new Date(2026, month, day, hour);
const dayOf = (iso: string) => localDayKey(new Date(iso));
const plusDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return localDayKey(r);
};
const CLOCK: ReviewClock = { dayStartHour: 0, sabbathEnabled: false, sabbathDay: 'Su', pausedAt: null, pausedUntil: null };
const SABBATH: ReviewClock = { ...CLOCK, sabbathEnabled: true };
const g = (spec: string): ReviewGrade[] => [...spec].map((c) => (c === 'c' ? 'clean' : c === 's' ? 'stumble' : 'blank'));
const verses = (n: number, stumbles = 0, blanks = 0): ReviewGrade[] => [
  ...Array(stumbles).fill('stumble'),
  ...Array(blanks).fill('blank'),
  ...Array(n - stumbles - blanks).fill('clean'),
];
const same = (a: LadderState, b: LadderState) => JSON.stringify(a) === JSON.stringify(b);

console.log('ladder table');
check('eight steps, the top is Every 6 months', LADDER.length === 8 && TOP_STEP === 7 && LADDER[7].label === 'Every 6 months' && !!LADDER[7].top);
check(
  'intervals 1, 2, 4 days then 1, 2, 4, 8, 26 weeks',
  JSON.stringify(LADDER.map((s) => s.intervalDays)) === JSON.stringify([1, 2, 4, 7, 14, 28, 56, 182])
);
check('weekly and longer steps are whole weeks', LADDER.slice(3).every((s) => s.intervalDays % 7 === 0));
check(
  'groups: 3 Settling, 2 Steady, 3 Kept',
  JSON.stringify(LADDER.map((s) => s.group)) ===
    JSON.stringify(['settling', 'settling', 'settling', 'steady', 'steady', 'kept', 'kept', 'kept'])
);
check(
  'colors follow the groups',
  LADDER.every((s) => s.colorToken === { settling: 'stageDaily', steady: 'stageWeekly', kept: 'stageComplete' }[s.group])
);
check('only the top step is flagged top', LADDER.filter((s) => s.top).length === 1);

console.log('thoroughness');
const counts = (t: Thoroughness) => LADDER.map((_, step) => stepReviewCount(step, t));
const EXPECTED: Record<string, (number | null)[]> = {
  Light: [4, 2, 2, 4, 3, 6, 3, null],
  Standard: [7, 4, 4, 8, 6, 12, 6, null],
  Thorough: [11, 6, 6, 12, 9, 18, 9, null],
  Navigators: [14, 8, 8, 16, 12, 24, 12, null],
};
for (const p of THOROUGHNESS_PRESETS) {
  check(`${p.label} (${p.value}×) step counts`, JSON.stringify(counts(p.value)) === JSON.stringify(EXPECTED[p.label]), counts(p.value));
}
check('every step needs at least 2 reviews at Light', counts(0.5).every((n) => n === null || n >= 2));
check('Standard reaches the top in 843 days', daysToTop(1) === 843, daysToTop(1));
check('Light is about half of Standard', daysToTop(0.5) === 4 + 4 + 8 + 28 + 42 + 168 + 168, daysToTop(0.5));
check('Navigators is double Standard', daysToTop(2) === 2 * daysToTop(1));

console.log('catch-up');
check('catch-up is 3 / 2 / 2', JSON.stringify(CATCH_UP_REVIEWS) === JSON.stringify([3, 2, 2]));
check('catch-up takes 15 days', catchUpDays() === 15);
check('catch-up ignores thoroughness', reviewsToMoveUp({ step: 0, reviews: 0, catchUp: true }, 2) === 3);
check('outside a catch-up the step count applies', reviewsToMoveUp({ step: 0, reviews: 0 }, 1) === 7);
{
  let s: LadderState = { step: 0, reviews: 0, catchUp: true };
  let reviews = 0;
  let days = 0;
  while (s.step < 3 && reviews < 50) {
    days += LADDER[s.step].intervalDays;
    s = applyOutcome(s, 'up', 2);
    reviews++;
  }
  check('a clean catch-up lands at Every week after 7 reviews', s.step === 3 && s.reviews === 0 && reviews === 7, { s, reviews });
  check('…about two weeks', days === 15, days);
  check('…and the catch-up is over (key deleted, not undefined)', !('catchUp' in s));
}
check(
  'a blank during a catch-up drops a step and keeps the catch-up',
  same(applyOutcome({ step: 1, reviews: 1, catchUp: true }, 'down'), { step: 0, reviews: 0, catchUp: true })
);
check(
  'a stray catch-up flag at Every week is dropped',
  same(applyOutcome({ step: 3, reviews: 0, catchUp: true }, 'held'), { step: 3, reviews: 0 })
);

console.log('passage outcome (§4 table)');
for (const [size, name] of [
  [5, 'under 12'],
  [11, 'under 12 (11)'],
  [12, '12+ (12)'],
  [20, '12+'],
] as const) {
  const big = size >= 12;
  check(`${name}: all clean = up`, passageOutcome(verses(size)) === 'up');
  check(`${name}: 1 stumble = ${big ? 'forgiven' : 'held'}`, passageOutcome(verses(size, 1)) === (big ? 'forgiven' : 'held'));
  check(`${name}: 2 stumbles = ${big ? 'forgiven' : 'held'}`, passageOutcome(verses(size, 2)) === (big ? 'forgiven' : 'held'));
  check(`${name}: 3 stumbles = back`, passageOutcome(verses(size, 3)) === 'back');
  check(`${name}: 5 stumbles = back`, passageOutcome(verses(size, 5)) === 'back');
  check(`${name}: a blank = down`, passageOutcome(verses(size, 0, 1)) === 'down');
  check(`${name}: a blank beats stumbles`, passageOutcome(verses(size, 3, 1)) === 'down');
}
check('a single clean verse moves up', passageOutcome(g('c')) === 'up');
check('a single stumble holds', passageOutcome(g('s')) === 'held');
check('size counts the whole passage, not just the grades given', passageOutcome(g('cs'), { size: 12 }) === 'forgiven');
check('no grades holds', passageOutcome([]) === 'held');
check("can't move up: clean holds", passageOutcome(verses(5), { canMoveUp: false }) === 'held');
check("can't move up: forgiven holds", passageOutcome(verses(20, 2), { canMoveUp: false }) === 'held');
check("can't move up: 3 stumbles still back", passageOutcome(verses(5, 3), { canMoveUp: false }) === 'back');
check("can't move up: a blank still drops", passageOutcome(verses(5, 0, 1), { canMoveUp: false }) === 'down');

console.log('applying an outcome');
check('up counts a review', same(applyOutcome({ step: 3, reviews: 2 }, 'up'), { step: 3, reviews: 3 }));
check('forgiven counts a review', same(applyOutcome({ step: 3, reviews: 2 }, 'forgiven'), { step: 3, reviews: 3 }));
check('the 7th review at Every day moves up', same(applyOutcome({ step: 0, reviews: 6 }, 'up'), { step: 1, reviews: 0 }));
check('the 6th at Every day does not', same(applyOutcome({ step: 0, reviews: 5 }, 'up'), { step: 0, reviews: 6 }));
check('Light moves up from Every day after 4', same(applyOutcome({ step: 0, reviews: 3 }, 'up', 0.5), { step: 1, reviews: 0 }));
check('Every 8 weeks moves up to the top', same(applyOutcome({ step: 6, reviews: 5 }, 'up'), { step: 7, reviews: 0 }));
check('the top keeps counting and stays', same(applyOutcome({ step: 7, reviews: 40 }, 'up'), { step: 7, reviews: 41 }));
check('held changes nothing', same(applyOutcome({ step: 4, reviews: 3 }, 'held'), { step: 4, reviews: 3 }));
check('back one review', same(applyOutcome({ step: 4, reviews: 3 }, 'back'), { step: 4, reviews: 2 }));
check('back never below the start of the step', same(applyOutcome({ step: 4, reviews: 0 }, 'back'), { step: 4, reviews: 0 }));
check('down lands at the start of the step below', same(applyOutcome({ step: 4, reviews: 5 }, 'down'), { step: 3, reviews: 0 }));
check('down from Every week goes back to Settling', LADDER[applyOutcome({ step: 3, reviews: 7 }, 'down').step].group === 'settling');
check('down from the top', same(applyOutcome({ step: 7, reviews: 3 }, 'down'), { step: 6, reviews: 0 }));
check('Every day is the floor', same(applyOutcome({ step: 0, reviews: 4 }, 'down'), { step: 0, reviews: 0 }));

console.log('next due');
check('Every day: tomorrow', dayOf(nextDue(0, 'M', CLOCK, at(12))) === '2026-10-13');
check('Every 2 days', dayOf(nextDue(1, 'M', CLOCK, at(12))) === '2026-10-14');
check('Every 4 days', dayOf(nextDue(2, 'M', CLOCK, at(12))) === '2026-10-16');
check('a daily due date skips the Sabbath', dayOf(nextDue(0, undefined, SABBATH, at(10))) === '2026-10-12');
check('Every week on the anchor day', dayOf(nextDue(3, 'M', CLOCK, at(12))) === '2026-10-19');
check('Every week reviewed late stays on the anchor day', dayOf(nextDue(3, 'M', CLOCK, at(14))) === '2026-10-19');
check('Every 2 weeks', dayOf(nextDue(4, 'M', CLOCK, at(12))) === '2026-10-26');
check('Every 4 weeks', dayOf(nextDue(5, 'M', CLOCK, at(12))) === plusDays(at(12), 28));
check('Every 8 weeks', dayOf(nextDue(6, 'M', CLOCK, at(12))) === plusDays(at(12), 56));
check('Every 6 months is 26 weeks, on the anchor day', dayOf(nextDue(7, 'M', CLOCK, at(12))) === plusDays(at(12), 182));
check('6 months lands on a Monday', new Date(nextDue(7, 'M', CLOCK, at(12))).getDay() === 1);
check('Every week with no anchor: 7 days', dayOf(nextDue(3, undefined, CLOCK, at(14))) === '2026-10-21');
check(
  'day start hour: 1am still counts as the day before',
  dayOf(nextDue(0, undefined, { ...CLOCK, dayStartHour: 2 }, at(13, 1))) === '2026-10-13'
);

console.log('late reviews');
const daily: LadderState = { step: 0, reviews: 3 };
check('due today is not late', lateness(daily, at(12, 21).toISOString(), CLOCK, at(12, 22)).missed === 0);
check('no due date is not late', lateness(daily, null, CLOCK, at(12)).missed === 0);
{
  const r = lateness(daily, at(12, 21).toISOString(), CLOCK, at(13, 8));
  check('due 9pm yesterday, 8am today: one missed', r.missed === 1 && same(r.state, { step: 0, reviews: 2 }), r);
}
check('Every 2 days, one day late is free', lateness({ step: 1, reviews: 2 }, at(12).toISOString(), CLOCK, at(13)).missed === 0);
check('Every 2 days, two days late: one missed', lateness({ step: 1, reviews: 2 }, at(12).toISOString(), CLOCK, at(14)).missed === 1);
check('Every 2 days, three days late: still one', lateness({ step: 1, reviews: 2 }, at(12).toISOString(), CLOCK, at(15)).missed === 1);
{
  const r = lateness({ step: 3, reviews: 1 }, at(12).toISOString(), CLOCK, at(12, 12, 10));
  check('never below the start of the step', r.missed === 4 && same(r.state, { step: 3, reviews: 0 }), r);
}
check(
  'late moves back but keeps the step and catch-up',
  same(lateness({ step: 1, reviews: 1, catchUp: true }, at(12).toISOString(), CLOCK, at(16)).state, { step: 1, reviews: 0, catchUp: true })
);
check('across a Sabbath: Sat due, Mon is two days late without one', lateness(daily, at(10).toISOString(), CLOCK, at(12)).missed === 2);
check('…and one day with Sunday the Sabbath', lateness(daily, at(10).toISOString(), SABBATH, at(12)).missed === 1);
check('a week late across a Sabbath is under one interval', lateness({ step: 3, reviews: 3 }, at(12).toISOString(), SABBATH, at(19)).missed === 0);
check('…and one missed without it', lateness({ step: 3, reviews: 3 }, at(12).toISOString(), CLOCK, at(19)).missed === 1);
{
  const paused = { ...CLOCK, pausedAt: at(13, 0).toISOString(), pausedUntil: at(16, 0).toISOString() };
  check('paused days do not count', lateness(daily, at(12).toISOString(), paused, at(17)).missed === 2);
  check('…five without the pause', lateness(daily, at(12).toISOString(), CLOCK, at(17)).missed === 5);
  const open = { ...CLOCK, pausedAt: at(12, 0).toISOString(), pausedUntil: null };
  check('an open-ended pause counts nothing', lateness(daily, at(12).toISOString(), open, at(20)).missed === 0);
}
check(
  'day start hour: 1am the next day is still the due day',
  lateness(daily, at(12).toISOString(), { ...CLOCK, dayStartHour: 2 }, at(13, 1)).missed === 0
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll ladder checks passed.');
