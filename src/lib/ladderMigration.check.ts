// Assertions for the ladder migration, run by `npm run check:migration`.

import type { QueueItem } from '../types';
import type { LadderState } from './ladder';
import { describeLadderState, legacyStageLabel, mapLegacyItem, migrateQueue } from './ladderMigration';
import { ladderStateOf, passages } from './passages';
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

const at = (day: number, hour = 12) => new Date(2026, 9, day, hour);
const CLOCK: ReviewClock = { dayStartHour: 0, sabbathEnabled: false, sabbathDay: 'Su', pausedAt: null, pausedUntil: null };
const NOW = at(12, 9);

interface Spec {
  v: number;
  t?: string;
  ch?: number;
  status?: QueueItem['status'];
  phase?: QueueItem['retentionPhase'];
  streak?: number;
  due?: string | null;
  refresher?: { phase: 'weekly' | 'monthly'; progress: number };
}
const item = (s: Spec): QueueItem => {
  const t = s.t ?? 'BSB';
  const ch = s.ch ?? 8;
  const status = s.status ?? 'reviewing';
  const q: QueueItem = {
    verseId: `${t}_Romans_${ch}_${s.v}`,
    translationId: t,
    book: 'Romans',
    chapter: ch,
    verseNumber: s.v,
    text: `verse ${s.v} text`,
    orderIndex: s.v,
    status,
    retentionPhase: s.phase ?? (status === 'reviewing' ? 'daily' : status === 'retained' ? 'monthly' : 'none'),
    dateStarted: null,
    lastReviewDate: null,
    nextReviewDueDate: s.due === undefined ? at(14).toISOString() : s.due,
    currentStreakCount: s.streak ?? 0,
    totalSuccessfulReviews: 0,
    gracePeriodUsedToday: false,
  };
  if (s.refresher) {
    q.refresherActive = true;
    q.refresherReturnPhase = s.refresher.phase;
    q.refresherReturnProgress = s.refresher.progress;
  }
  return q;
};
const st = (step: number, reviews: number, catchUp = false): LadderState => (catchUp ? { step, reviews, catchUp: true } : { step, reviews });
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const merge = (queue: QueueItem[], changed: QueueItem[]) => {
  const byId = new Map(changed.map((c) => [c.verseId, c]));
  return queue.map((q) => byId.get(q.verseId) ?? q);
};
const run = (queue: QueueItem[]) => {
  const r = migrateQueue(queue, { clock: CLOCK, now: NOW });
  return { ...r, queue: merge(queue, r.changed) };
};
const stateOf = (queue: QueueItem[], v: number, t = 'BSB', ch = 8) =>
  ladderStateOf(queue.find((q) => q.verseNumber === v && q.translationId === t && q.chapter === ch)!);
const noUndefined = (items: QueueItem[]) => items.every((q) => !JSON.stringify(q, (_k, v) => (v === undefined ? '__U__' : v)).includes('__U__'));

console.log('Mapping: every row');
const rows: [string, Spec, LadderState][] = [
  ['daily 0 -> Every day, review 1', { v: 1, phase: 'daily', streak: 0 }, st(0, 0)],
  ['daily 6 -> Every day, 6 done', { v: 1, phase: 'daily', streak: 6 }, st(0, 6)],
  ['daily 7 -> Every 2 days, 0 done', { v: 1, phase: 'daily', streak: 7 }, st(1, 0)],
  ['daily 10 -> Every 2 days, 3 done', { v: 1, phase: 'daily', streak: 10 }, st(1, 3)],
  ['daily 11 -> Every 4 days, 0 done', { v: 1, phase: 'daily', streak: 11 }, st(2, 0)],
  ['daily 14 -> Every 4 days, 3 done', { v: 1, phase: 'daily', streak: 14 }, st(2, 3)],
  ['daily 15 -> Every week, 0 done', { v: 1, phase: 'daily', streak: 15 }, st(3, 0)],
  ['daily 40 -> Every week, 0 done', { v: 1, phase: 'daily', streak: 40 }, st(3, 0)],
  ['no phase, streak 3 reads as daily', { v: 1, phase: 'none', streak: 3 }, st(0, 3)],
  ['weekly 0 -> Every week, 0 done', { v: 1, phase: 'weekly', streak: 0 }, st(3, 0)],
  ['weekly 7 -> Every week, 7 done', { v: 1, phase: 'weekly', streak: 7 }, st(3, 7)],
  ['weekly 8 -> Every 2 weeks, 0 done', { v: 1, phase: 'weekly', streak: 8 }, st(4, 0)],
  ['weekly 13 -> Every 2 weeks, 5 done', { v: 1, phase: 'weekly', streak: 13 }, st(4, 5)],
  ['weekly 14 -> Every 4 weeks, 0 done', { v: 1, phase: 'weekly', streak: 14 }, st(5, 0)],
  ['weekly 20 -> Every 4 weeks, 6 done', { v: 1, phase: 'weekly', streak: 20 }, st(5, 6)],
  ['weekly 40 -> Every 4 weeks, held short of the next step', { v: 1, phase: 'weekly', streak: 40 }, st(5, 11)],
  ['monthly 0 -> Every 4 weeks, 0 done', { v: 1, phase: 'monthly', streak: 0 }, st(5, 0)],
  ['monthly 11 -> Every 4 weeks, 11 done', { v: 1, phase: 'monthly', streak: 11 }, st(5, 11)],
  ['monthly 12 -> Every 8 weeks, 0 done', { v: 1, phase: 'monthly', streak: 12 }, st(6, 0)],
  ['monthly 17 -> Every 8 weeks, 5 done', { v: 1, phase: 'monthly', streak: 17 }, st(6, 5)],
  ['monthly 18 -> Every 6 months', { v: 1, phase: 'monthly', streak: 18 }, st(7, 0)],
  ['retained -> Every 6 months', { v: 1, status: 'retained', streak: 3 }, st(7, 0)],
  ['refresher back to weekly 9 -> Every 2 weeks, 1 done', { v: 1, phase: 'daily', streak: 2, refresher: { phase: 'weekly', progress: 9 } }, st(4, 1)],
  ['refresher back to monthly 13 -> Every 8 weeks, 1 done', { v: 1, phase: 'weekly', streak: 1, refresher: { phase: 'monthly', progress: 13 } }, st(6, 1)],
];
for (const [label, spec, want] of rows) {
  const got = mapLegacyItem(item(spec));
  check(label, eq(got, want), got);
}
check('Light: daily 6 is held at 3 of Every day (Light needs 4)', eq(mapLegacyItem(item({ v: 1, streak: 6 }), 0.5), st(0, 3)));
check('Intense: weekly 7 keeps 7 (needs 16)', eq(mapLegacyItem(item({ v: 1, phase: 'weekly', streak: 7 }), 2), st(3, 7)));
check('labels', legacyStageLabel(item({ v: 1, streak: 5 })) === 'Daily 5' &&
  legacyStageLabel(item({ v: 1, status: 'retained' })) === 'Retained' &&
  legacyStageLabel(item({ v: 1, refresher: { phase: 'weekly', progress: 4 } })) === 'Refresher (Weekly 4)');
check('describe: catch-up', describeLadderState(st(1, 0, true)) === 'Every 2 days, review 1 of 2 (catch-up)', describeLadderState(st(1, 0, true)));
check('describe: top', describeLadderState(st(7, 0)) === 'Every 6 months, for good', describeLadderState(st(7, 0)));
check('describe: step', describeLadderState(st(3, 2)) === 'Every week, review 3 of 8', describeLadderState(st(3, 2)));

console.log('A single verse keeps its own step and due date');
{
  const due = at(20).toISOString();
  const { queue, changed } = run([item({ v: 1, phase: 'weekly', streak: 9, due })]);
  check('one change', changed.length === 1);
  check('Every 2 weeks, 1 done', eq(stateOf(queue, 1), st(4, 1)), stateOf(queue, 1));
  check('due date kept (no lateness, no pile-up)', queue[0].nextReviewDueDate === due);
  check('legacy phase mapped to weekly (Steady)', queue[0].retentionPhase === 'weekly' && queue[0].status === 'reviewing');
}

console.log('A mixed-stage chapter merges at the lowest step with the catch-up');
{
  const q = [
    item({ v: 1, phase: 'weekly', streak: 3, due: at(16).toISOString() }),
    item({ v: 2, phase: 'weekly', streak: 3, due: at(16).toISOString() }),
    item({ v: 3, phase: 'daily', streak: 12, due: at(13).toISOString() }),
    item({ v: 4, phase: 'daily', streak: 5, due: at(15).toISOString() }),
  ];
  const { queue, report } = run(q);
  const want = st(0, 2, true); // daily 5 is 5 done, held at 2 of the catch-up's 3
  check('every member at Every day, catch-up', [1, 2, 3, 4].every((v) => eq(stateOf(queue, v), want)), [1, 2, 3, 4].map((v) => stateOf(queue, v)));
  check('earliest due date', queue.every((x) => x.nextReviewDueDate === at(13).toISOString()));
  check('one passage in the report, marked merged', report.passages.length === 1 && report.passages[0].merged);
  check('report keeps old stages and per-verse mappings', eq(report.passages[0].verses.map((v) => v.old), ['Weekly 3', 'Weekly 3', 'Daily 12', 'Daily 5']) &&
    eq(report.passages[0].verses.map((v) => v.mapped.step), [3, 3, 2, 0]));
  check('legacy phase now daily (Settling)', queue.every((x) => x.retentionPhase === 'daily'));
}
{
  const { queue, report } = run([item({ v: 1, phase: 'daily', streak: 9 }), item({ v: 2, phase: 'daily', streak: 0 })]);
  check('lowest at step 0 with 0 done: catch-up from review 1', eq(stateOf(queue, 1), st(0, 0, true)) && report.passages[0].merged);
}
{
  const { queue } = run([item({ v: 1, phase: 'daily', streak: 13 }), item({ v: 2, phase: 'weekly', streak: 2 })]);
  check('lowest at Every 4 days with 2 done: catch-up holds it at 1 of 2', eq(stateOf(queue, 2), st(2, 1, true)), stateOf(queue, 2));
}
{
  const { queue, report } = run([item({ v: 1, phase: 'weekly', streak: 3 }), item({ v: 2, phase: 'monthly', streak: 4 })]);
  check('disagreeing at Every week or longer: lowest, no catch-up (it only exists below)', eq(stateOf(queue, 2), st(3, 3)) && report.passages[0].merged);
}

console.log('A uniform passage keeps its mapped step');
{
  const { queue, report } = run([item({ v: 1, streak: 3 }), item({ v: 2, streak: 5 }), item({ v: 3, streak: 4 })]);
  check('same step: lowest count, no catch-up', [1, 2, 3].every((v) => eq(stateOf(queue, v), st(0, 3))));
  check('not marked merged', !report.passages[0].merged);
}
{
  const { queue } = run([item({ v: 1, status: 'retained' }), item({ v: 2, phase: 'monthly', streak: 20 })]);
  check('retained + monthly 20: both at the top', eq(stateOf(queue, 1), st(7, 0)) && eq(stateOf(queue, 2), st(7, 0)));
  check('retained becomes reviewing, monthly (decision 3)', queue[0].status === 'reviewing' && queue[0].retentionPhase === 'monthly');
}

console.log('Retained verses with no due date are spread over 26 weeks');
{
  // 26 one-chapter passages of 4 retained verses each, no dates. Chapter 3 has a Thursday anchor.
  const q: QueueItem[] = [];
  for (let ch = 1; ch <= 26; ch++) for (let v = 1; v <= 4; v++) q.push(item({ v, ch, status: 'retained', due: null }));
  for (const x of q) if (x.chapter === 3) x.chapterReviewAnchorDay = 'Th';
  const { queue, report } = run(q);
  check('every verse got a date', queue.every((x) => !!x.nextReviewDueDate));
  const days = (ch: number) => {
    const d = new Date(queue.find((x) => x.chapter === ch)!.nextReviewDueDate!);
    return Math.round((d.getTime() - NOW.getTime()) / 86400000);
  };
  check('first chapter within the first week', days(1) >= 1 && days(1) <= 7, days(1));
  check('last chapter in week 26', days(26) > 25 * 7 - 7 && days(26) <= 26 * 7, days(26));
  check('one chapter a week (equal sizes)', [2, 10, 20].every((ch) => days(ch) > (ch - 1) * 7 - 1 && days(ch) <= ch * 7), [2, 10, 20].map(days));
  check('chapter weekday kept', new Date(queue.find((x) => x.chapter === 3)!.nextReviewDueDate!).getDay() === 4);
  check('members of a passage share the date', new Set(queue.filter((x) => x.chapter === 5).map((x) => x.nextReviewDueDate)).size === 1);
  check('report shows the date', report.passages.every((p) => !!p.due));
  check('a second run changes nothing', migrateQueue(queue, { clock: CLOCK, now: NOW }).changed.length === 0);
}
{
  // Weighted by verses: a 48-verse chapter, then two 2-verse ones.
  const q = [
    ...Array.from({ length: 48 }, (_, i) => item({ v: i + 1, ch: 5, status: 'retained', due: null })),
    item({ v: 1, ch: 6, status: 'retained', due: null }),
    item({ v: 2, ch: 6, status: 'retained', due: null }),
    item({ v: 1, ch: 7, status: 'retained', due: null }),
    item({ v: 2, ch: 7, status: 'retained', due: null }),
  ];
  const { queue } = run(q);
  const week = (ch: number) => Math.ceil((new Date(queue.find((x) => x.chapter === ch)!.nextReviewDueDate!).getTime() - NOW.getTime()) / (7 * 86400000));
  check('the long chapter pushes the next ones late in the 26 weeks', week(5) === 1 && week(6) >= 24 && week(7) >= 25, [week(5), week(6), week(7)]);
}
{
  const dated = at(30).toISOString();
  const { queue } = run([item({ v: 1, status: 'retained', due: dated })]);
  check('a retained verse that has a date keeps it', queue[0].nextReviewDueDate === dated);
}

console.log('Passage boundaries');
{
  const q = [
    item({ v: 1, phase: 'weekly', streak: 3 }),
    item({ v: 2, phase: 'weekly', streak: 3 }),
    item({ v: 4, streak: 2 }), // gap at 3
    item({ v: 5, status: 'learning' }),
    item({ v: 6, phase: 'monthly', streak: 1 }), // Learning verse breaks the run
    item({ v: 1, t: 'KJV', streak: 1 }), // another translation
    item({ v: 1, ch: 9, streak: 1 }), // another chapter
    item({ v: 7, status: 'queued' }),
  ];
  const { queue, report, changed } = run(q);
  check('a gap keeps Romans 8:1–2 at Every week', eq(stateOf(queue, 1), st(3, 3)) && eq(stateOf(queue, 2), st(3, 3)));
  check('verse 4 alone at Every day', eq(stateOf(queue, 4), st(0, 2)));
  check('verse 6 alone (Learning verse 5 between)', eq(stateOf(queue, 6), st(5, 1)));
  check('KJV 8:1 its own passage', eq(stateOf(queue, 1, 'KJV'), st(0, 1)));
  check('Romans 9:1 its own passage', eq(stateOf(queue, 1, 'BSB', 9), st(0, 1)));
  check('Learning and waiting verses untouched', queue[3] === q[3] && queue[7] === q[7]);
  check('no catch-up anywhere (nothing disagreed inside a passage)', queue.every((x) => !x.catchUp));
  check('report: 5 passages, 2 not started', report.passages.length === 5 && report.notStarted === 2, report);
  check('6 verses changed', changed.length === 6 && report.changedCount === 6);
  check('no undefined values written', noUndefined(changed));
  check('passages() agrees with the report', passages(queue).length === 5);
}

console.log('Idempotent');
{
  const q = [
    item({ v: 1, phase: 'weekly', streak: 3 }),
    item({ v: 2, streak: 12 }),
    item({ v: 3, status: 'retained' }),
    item({ v: 9, status: 'learning' }),
  ];
  const first = run(q);
  const second = run(first.queue);
  check('a second run changes nothing', second.changed.length === 0, second.changed);
  check('and reports nothing to do', second.report.passages.length === 0 && second.report.alreadyMigrated === 3);
}
{
  // Half migrated already (an interrupted run, or a verse migrated earlier).
  const done = item({ v: 1, phase: 'weekly', streak: 3 });
  done.ladderStep = 4;
  done.ladderReviews = 2;
  const { queue } = run([done, item({ v: 2, phase: 'weekly', streak: 9 })]);
  check('an already-migrated verse keeps its step; new ones map and the passage agrees', eq(stateOf(queue, 1), st(4, 1)) && eq(stateOf(queue, 2), st(4, 1)), [stateOf(queue, 1), stateOf(queue, 2)]);
}
{
  const { changed, report } = run([]);
  check('empty queue', changed.length === 0 && report.passages.length === 0);
}

if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All migration checks passed.');
