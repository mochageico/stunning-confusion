// Assertions for scheduled group plans, run by `npm run check:groupplan`.

import type { GroupPlan, GroupPlanMembership, QueueItem } from '../types';
import { computeDailyPull, scheduledDue } from './groupPlanScheduler';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const plan = (over: Partial<GroupPlan> = {}): GroupPlan => ({
  planId: 'p1',
  circleId: 'c1',
  name: 'Romans 8',
  description: '',
  managerId: 'u1',
  versesPerWeek: 6,
  days: ['M', 'W', 'F'],
  versesPerDay: 2,
  verseIds: [],
  createdAt: '',
  updatedAt: '',
  ...over,
});

const item = (n: number, status: QueueItem['status'] = 'queued', dateStarted: string | null = null, planId = 'p1'): QueueItem =>
  ({
    verseId: `ROM_8_${n}`,
    translationId: 'BSB',
    book: 'Romans',
    chapter: 8,
    verseNumber: n,
    text: '',
    orderIndex: n,
    status,
    origin: 'group',
    originPlanId: planId,
    retentionPhase: 'none',
    dateStarted,
    lastReviewDate: null,
    nextReviewDueDate: null,
    currentStreakCount: 0,
    totalSuccessfulReviews: 0,
    gracePeriodUsedToday: false,
  }) as QueueItem;

const queue = (n = 12) => Array.from({ length: n }, (_, i) => item(i + 1));
// Oct 2026: Mon 26, Tue 27, Wed 28, Thu 29, Fri 30. Local times, so any time zone reads the same.
const MON = new Date(2026, 9, 26, 9);
const TUE = new Date(2026, 9, 27, 9);
const WED = new Date(2026, 9, 28, 9);
const SAT = new Date(2026, 9, 31, 9);

check('plan day: today\'s share is due', scheduledDue(queue(), plan(), MON)?.due === 2);
check('a day between plan days owes the same', scheduledDue(queue(), plan(), TUE)?.due === 2);
check('missed Monday carries onto Wednesday', scheduledDue(queue(), plan(), WED)?.due === 4);
check('...and says 2 of them are carried', scheduledDue(queue(), plan(), WED)?.carried === 2);
check('never past the week\'s total', scheduledDue(queue(), plan(), SAT)?.due === 6);
const started = [item(1, 'learning', MON.toISOString()), item(2, 'learning', MON.toISOString()), ...queue(12).slice(2)];
check('started verses are subtracted', scheduledDue(started, plan(), WED)?.due === 2);
check('all started: nothing due', scheduledDue([...started.slice(0, 2), item(3, 'learning', WED.toISOString()), item(4, 'learning', WED.toISOString())], plan(), WED)?.due === 0);
check('only waiting verses can come due', scheduledDue(queue(1), plan(), WED)?.due === 1);
check('a plan with no schedule returns null', scheduledDue(queue(), plan({ days: undefined, versesPerDay: undefined }), MON) === null);
check('days before joining don\'t count', scheduledDue(queue(), plan(), WED, new Date(2026, 9, 28, 8).toISOString())?.due === 2);
check('last week\'s starts don\'t count', scheduledDue([item(1, 'learning', new Date(2026, 9, 20).toISOString()), ...queue(12).slice(1)], plan(), MON)?.due === 2);

const mem = (priority: GroupPlanMembership['priority']): GroupPlanMembership => ({ planId: 'p1', circleId: 'c1', priority, joinedAt: new Date(2026, 9, 1).toISOString() });
const own = (n: number): QueueItem => ({ ...item(100 + n), verseId: `PSA_119_${n}`, origin: 'individual', originPlanId: undefined, book: 'Psalms' }) as QueueItem;
const mixed = [...queue(12), own(1), own(2), own(3)];

const group = computeDailyPull(mixed, { newVersesPace: 3, learningDays: ['M', 'W', 'F'] }, [plan()], [mem('group')], MON);
check('counts toward pace: 2 plan + 1 own', group.verseIds.length === 3 && group.fromIndividual.length === 1, group);
const additive = computeDailyPull(mixed, { newVersesPace: 3, learningDays: ['M', 'W', 'F'] }, [plan()], [mem('additive')], MON);
check('on top of pace: 2 plan + 3 own', additive.verseIds.length === 5 && additive.fromIndividual.length === 3, additive);
const offDay = computeDailyPull(mixed, { newVersesPace: 0, learningDays: ['M', 'W', 'F'] }, [plan()], [mem('group')], MON);
check('plan day that is not a personal learning day still delivers the plan', offDay.verseIds.length === 2 && offDay.fromIndividual.length === 0, offDay);
const sabbath = computeDailyPull(mixed, { newVersesPace: 3, learningDays: ['M', 'W', 'F'], sabbathToday: true }, [plan()], [mem('group')], MON);
check('a member\'s Sabbath holds the plan back', !sabbath.verseIds.some((id) => id.startsWith('ROM')), sabbath);
const legacy = computeDailyPull(mixed, { newVersesPace: 3, learningDays: ['M', 'W', 'F'] }, [plan({ days: undefined, versesPerDay: undefined, versesPerWeek: 3 })], [mem('group')], MON);
check('older plans still use the weekly pace', legacy.fromPlans.p1?.length === 1, legacy);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\ncheck:groupplan — all assertions passed.');
