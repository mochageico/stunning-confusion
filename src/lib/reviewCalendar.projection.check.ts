// Standalone assertions for getMemoryCalendarProjection's new-verse
// projection, run by `npm run check:calendar` (see scripts/run-calendar-check.cjs).
//
// This covers the part of the plan/rhythm split the layout lab can't reach:
// the projection now runs the REAL computeDailyPull forward, day by day,
// against a simulated queue, instead of assuming every learning day pulls
// exactly newVersesPace of your own verses. That assumption was wrong for
// anyone in a group plan and badly wrong on an 'additive' membership.

import { QueueItem, GroupPlan, GroupPlanMembership } from '../types';
import { getMemoryCalendarProjection, CalendarPlanSettings } from './reviewCalendar';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

function queued(verseId: string, orderIndex: number, originPlanId?: string): QueueItem {
  return {
    verseId,
    translationId: 'ESV',
    book: 'Romans',
    chapter: 8,
    verseNumber: orderIndex + 1,
    text: 'test verse',
    orderIndex,
    status: 'queued',
    origin: originPlanId ? 'group' : 'individual',
    ...(originPlanId ? { originPlanId } : {}),
    retentionPhase: 'none',
    dateStarted: null,
    lastReviewDate: null,
    nextReviewDueDate: null,
    currentStreakCount: 0,
    totalSuccessfulReviews: 0,
    gracePeriodUsedToday: false,
  };
}

const BASE: CalendarPlanSettings = {
  dailyPhaseWeeks: 7,
  weeklyPhaseMonths: 6,
  monthlyPhaseYears: 5,
  // Every day is a learning day, so the projection window is all pull days
  // and nothing is masked by the weekday filter.
  learningDays: ['Su', 'M', 'T', 'W', 'Th', 'F', 'S'],
  newVersesPace: 2,
  sabbathEnabled: false,
  sabbathDay: 'Su',
};

const groupPlan: GroupPlan = {
  planId: 'plan-a',
  circleId: 'c1',
  name: 'Romans Challenge',
  description: '',
  managerId: 'u1',
  versesPerWeek: 7,
  verseIds: [],
  createdAt: '',
  updatedAt: '',
};

console.log('reviewCalendar — new-verse projection');

// ---------------------------------------------------------------- personal
{
  const queue = Array.from({ length: 40 }, (_, i) => queued(`v${i}`, i));
  const days = getMemoryCalendarProjection(queue, BASE, 8);

  check('day 0 (today) projects no pull -- already reflected in the real queue', days[0].newVersesPulled === 0);
  check('a future learning day pulls exactly newVersesPace', days[1].newVersesPulled === 2, days[1].newVersesPulled);
  check('newVerseItems names the actual queue items', days[1].newVerseItems.length === 2 && days[1].newVerseItems[0].verseId === 'v0');
  check(
    'consecutive days pull DIFFERENT verses (the sim consumes the queue)',
    days[2].newVerseItems[0].verseId !== days[1].newVerseItems[0].verseId,
    { d1: days[1].newVerseItems.map((i) => i.verseId), d2: days[2].newVerseItems.map((i) => i.verseId) }
  );
  check(
    'learningCount accumulates the projected pulls',
    days[2].learningCount === days[1].learningCount + days[2].newVersesPulled
  );
}

// ------------------------------------------------------------------ queue end
{
  // Only 3 queued verses but 8 days of pulling: the projection must run dry
  // rather than inventing verses that don't exist.
  const queue = Array.from({ length: 3 }, (_, i) => queued(`v${i}`, i));
  const days = getMemoryCalendarProjection(queue, BASE, 8);
  const total = days.reduce((sum, d) => sum + d.newVersesPulled, 0);
  check('never pulls more verses than are actually queued', total === 3, total);
}

// ------------------------------------------------------------------ additive
{
  const queue = [
    ...Array.from({ length: 20 }, (_, i) => queued(`mine${i}`, i)),
    ...Array.from({ length: 20 }, (_, i) => queued(`grp${i}`, 100 + i, 'plan-a')),
  ];
  const memberships: GroupPlanMembership[] = [
    { planId: 'plan-a', circleId: 'c1', priority: 'additive', joinedAt: '' },
  ];
  const days = getMemoryCalendarProjection(
    queue,
    { ...BASE, joinedPlans: [groupPlan], memberships },
    8
  );

  check(
    'an additive plan pulls ON TOP of the personal pace',
    days[1].newVersesPulled > BASE.newVersesPace,
    days[1].newVersesPulled
  );
  check(
    'additive day includes both group and personal verses',
    days[1].newVerseItems.some((i) => i.originPlanId === 'plan-a') &&
      days[1].newVerseItems.some((i) => !i.originPlanId)
  );

  // The weekly budget is derived from a 7-day lookback over dateStarted, so
  // a projection that failed to record simulated pulls would let the plan
  // re-spend its full versesPerWeek every single day.
  const groupPulledInWeek = days
    .slice(1, 8)
    .reduce((sum, d) => sum + d.newVerseItems.filter((i) => i.originPlanId === 'plan-a').length, 0);
  check(
    "a plan's weekly budget is not re-spent every day",
    groupPulledInWeek <= groupPlan.versesPerWeek,
    { groupPulledInWeek, versesPerWeek: groupPlan.versesPerWeek }
  );
}

// -------------------------------------------------------------- group first
{
  const queue = [
    ...Array.from({ length: 20 }, (_, i) => queued(`mine${i}`, i)),
    ...Array.from({ length: 20 }, (_, i) => queued(`grp${i}`, 100 + i, 'plan-a')),
  ];
  const memberships: GroupPlanMembership[] = [
    { planId: 'plan-a', circleId: 'c1', priority: 'group', joinedAt: '' },
  ];
  const days = getMemoryCalendarProjection(queue, { ...BASE, joinedPlans: [groupPlan], memberships }, 8);

  check(
    "'group' priority stays within the personal pace",
    days[1].newVersesPulled <= BASE.newVersesPace,
    days[1].newVersesPulled
  );
  check(
    "'group' priority pulls the plan's verses first",
    days[1].newVerseItems[0]?.originPlanId === 'plan-a',
    days[1].newVerseItems.map((i) => i.verseId)
  );
}

// ------------------------------------------------------------------- sabbath
{
  const queue = Array.from({ length: 40 }, (_, i) => queued(`v${i}`, i));
  const days = getMemoryCalendarProjection(
    queue,
    { ...BASE, sabbathEnabled: true, sabbathDay: 'Su' },
    14
  );
  const sabbathDays = days.filter((d) => d.isSabbath);
  check('sabbath days exist in the window', sabbathDays.length > 0);
  check('no verses are pulled on a sabbath day', sabbathDays.every((d) => d.newVersesPulled === 0));
}

// --------------------------------------------------------------------- pause
{
  // A reviewing verse that's already overdue -- due today on an unpaused day.
  const overdue: QueueItem = {
    ...queued('r0', 0),
    status: 'reviewing',
    retentionPhase: 'daily',
    nextReviewDueDate: new Date(Date.now() - 3 * 86400000).toISOString(),
    currentStreakCount: 1,
  };
  const queue = [overdue, ...Array.from({ length: 40 }, (_, i) => queued(`v${i}`, i + 1))];
  const hoursAgo = new Date(Date.now() - 3600000).toISOString();

  const unpaused = getMemoryCalendarProjection(queue, BASE, 8);
  check('unpaused: an overdue review shows as due today', unpaused[0].dueReviews.length === 1);

  // Open-ended pause (the "until I resume" option).
  const open = getMemoryCalendarProjection(queue, { ...BASE, pausedAt: hoursAgo, pausedUntil: null }, 8);
  check('open-ended pause: no reviews on any day', open.every((d) => d.dueReviews.length === 0));
  check('open-ended pause: no pulls on any day', open.every((d) => d.newVersesPulled === 0));

  // Dated pause ending mid-day 3, the way Settings sets it (now + N days).
  const until = new Date(Date.now() + 3 * 86400000).toISOString();
  const dated = getMemoryCalendarProjection(queue, { ...BASE, pausedAt: hoursAgo, pausedUntil: until }, 8);
  check('dated pause: nothing due before the return day', dated.slice(0, 3).every((d) => d.dueReviews.length === 0));
  check('dated pause: the overdue review lands on the return day', dated[3].dueReviews.length === 1, dated.map((d) => d.dueReviews.length));
  check('dated pause: no pulls while paused', dated.slice(0, 3).every((d) => d.newVersesPulled === 0));
  check('dated pause: pulls start again on the return day', dated[3].newVersesPulled === BASE.newVersesPace);

  // A pause whose date already passed is over -- same as not paused.
  const expired = getMemoryCalendarProjection(
    queue,
    { ...BASE, pausedAt: new Date(Date.now() - 10 * 86400000).toISOString(), pausedUntil: hoursAgo },
    8
  );
  check('an expired pause changes nothing', expired[0].dueReviews.length === 1);
}

console.log(failures === 0 ? '\ncheck:calendar — all assertions passed.' : `\ncheck:calendar — ${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
