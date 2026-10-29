// Assertions for "Balance my review days", run by `npm run check:balance`.
// Covers src/lib/balance.ts and how passages.ts uses it (leveling, the credit
// window, and counting a next due date from the scheduled day).

import type { QueueItem, ReviewGrade } from '../types';
import { BALANCE_WINDOW, balanceWindow, creditsEarly, dayLoads, earliestCreditDay, levelDue, scheduledDayOf } from './balance';
import { localDayKey } from './logicalDate';
import { easeToday, movedFromDay, recordGrade } from './passages';
import { estimateReviewMinutes, newVerseRoom, type ReviewClock } from './retention';
import { movedNote } from './todayCards';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

// October 2026: the 12th is a Monday, the 18th a Sunday, the 19th a Monday.
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour);
const key = (day: number) => localDayKey(at(day));
const dayOf = (iso: string | null | undefined) => (iso ? localDayKey(new Date(iso)) : null);
const CLOCK: ReviewClock = { dayStartHour: 0, sabbathEnabled: false, sabbathDay: 'Su', pausedAt: null, pausedUntil: null };
const SABBATH: ReviewClock = { ...CLOCK, sabbathEnabled: true };

console.log('windows');
check('Settling steps never move', BALANCE_WINDOW.slice(0, 3).every((w) => w === 0));
check('the window grows with the step', JSON.stringify(BALANCE_WINDOW) === '[0,0,0,1,1,2,3,7]');
check('out-of-range steps clamp', balanceWindow(-1) === 0 && balanceWindow(99) === 7);

console.log('leveling');
const loads = (o: Record<number, number>) => new Map(Object.entries(o).map(([d, s]) => [key(Number(d)), s]));
const base = { step: 3, verses: 10, capMinutes: 5, clock: CLOCK, now: at(12) };
const anchor = at(19).toISOString();
{
  const stay = levelDue({ ...base, anchor, loads: loads({ 19: 100 }) });
  check('under the limit it stays on its day', dayOf(stay.due) === key(19) && stay.scheduledDue === undefined, stay);
  const moved = levelDue({ ...base, anchor, loads: loads({ 19: 240, 20: 60 }) });
  check('over the limit it moves to the lightest day in the window', dayOf(moved.due) === key(18) && moved.scheduledDue === anchor, moved);
  const tie = levelDue({ ...base, anchor, loads: loads({ 19: 240 }) });
  check('a tie goes to the later day', dayOf(tie.due) === key(20), tie);
  const heavy = levelDue({ ...base, anchor, loads: loads({ 18: 400, 19: 240, 20: 300 }) });
  check('it stays when no day in the window is lighter', dayOf(heavy.due) === key(19) && heavy.scheduledDue === undefined, heavy);
  const sab = levelDue({ ...base, clock: SABBATH, anchor, loads: loads({ 19: 240 }) });
  check('never lands on the Sabbath', dayOf(sab.due) === key(20), sab);
  const paused = levelDue({
    ...base,
    clock: { ...CLOCK, pausedAt: at(17).toISOString(), pausedUntil: at(18, 23).toISOString() },
    anchor,
    loads: loads({ 19: 240 }),
  });
  check('never lands on a paused day', dayOf(paused.due) === key(20), paused);
  const soon = levelDue({ ...base, anchor: at(13).toISOString(), loads: loads({ 13: 240 }) });
  check('never today or earlier', dayOf(soon.due) === key(14), soon);
  const settling = levelDue({ ...base, step: 2, anchor, loads: loads({ 19: 900 }) });
  check('Every 4 days never moves', dayOf(settling.due) === key(19) && settling.scheduledDue === undefined);
  const full = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [13 + i, 900]));
  const top = levelDue({ ...base, step: 7, anchor, loads: loads(full) });
  check('Every 6 months reaches a week out for a lighter day', dayOf(top.due) === key(26) && top.scheduledDue === anchor, top);
  const nowhere = levelDue({ ...base, step: 7, anchor, loads: loads({ ...full, 26: 900 }) });
  check('...and stays when the whole window is as heavy', dayOf(nowhere.due) === key(19), nowhere);
  const noCap = levelDue({ ...base, capMinutes: 0, anchor, loads: loads({ 19: 900 }) });
  check('no limit set: nothing moves', dayOf(noCap.due) === key(19));
}

console.log('dayLoads');
{
  const q = (id: string, due: string | null, status: QueueItem['status'] = 'reviewing'): QueueItem => ({ ...mk(1, { id, due }), status });
  const l = dayLoads([q('a', at(19).toISOString()), q('b', at(19).toISOString()), q('c', at(20).toISOString()), q('d', null), q('e', at(19).toISOString(), 'learning')], new Set(['b']));
  check('15 seconds a verse, by due day, skipping learning and the given ids', l.get(key(19)) === 15 && l.get(key(20)) === 15 && l.size === 2, [...l]);
}

console.log('scheduled day and the credit window');
{
  const shifted = { ladderStep: 3, nextReviewDueDate: at(20).toISOString(), scheduledDue: at(19).toISOString() };
  check('a real shift reads back its scheduled day', scheduledDayOf(shifted) === key(19));
  check('a stale scheduledDue (outside the window) is ignored', scheduledDayOf({ ...shifted, scheduledDue: at(10).toISOString() }) === key(20));
  check('no scheduledDue: the due day', scheduledDayOf({ ladderStep: 3, nextReviewDueDate: at(19).toISOString() }) === key(19));
  check('credit starts a window before the scheduled day', earliestCreditDay(shifted) === key(18));
  check('Every 8 weeks: three days before', earliestCreditDay({ ladderStep: 6, nextReviewDueDate: at(19).toISOString() }) === key(16));
  check('Settling steps have no window', earliestCreditDay({ ladderStep: 1, nextReviewDueDate: at(19).toISOString() }) === null);
  check('creditsEarly is false before the window', !creditsEarly(shifted, key(17)));
  check('creditsEarly is true inside the window', creditsEarly(shifted, key(18)) && creditsEarly(shifted, key(19)));
}

// ---- through passages.recordGrade ------------------------------------------------------------

function mk(v: number, o: { id?: string; book?: string; ch?: number; due?: string | null; step?: number; reviews?: number; sched?: string } = {}): QueueItem {
  const book = o.book ?? 'Romans';
  const ch = o.ch ?? 8;
  const q: QueueItem = {
    verseId: o.id ?? `BSB_${book}_${ch}_${v}`,
    translationId: 'BSB',
    book,
    chapter: ch,
    verseNumber: v,
    text: `verse ${v}`,
    orderIndex: v,
    status: 'reviewing',
    retentionPhase: 'weekly',
    dateStarted: null,
    lastReviewDate: null,
    nextReviewDueDate: o.due === undefined ? at(12).toISOString() : o.due,
    currentStreakCount: 0,
    totalSuccessfulReviews: 0,
    gracePeriodUsedToday: false,
    ladderStep: o.step ?? 3,
    ladderReviews: o.reviews ?? 0,
    chapterReviewAnchorDay: 'M',
  };
  if (o.sched) q.scheduledDue = o.sched;
  return q;
}
const verses = (from: number, to: number, o: Parameters<typeof mk>[1] = {}) => Array.from({ length: to - from + 1 }, (_, i) => mk(from + i, o));
const merge = (queue: QueueItem[], changed: QueueItem[]) => {
  const byId = new Map(changed.map((c) => [c.verseId, c]));
  return queue.map((q) => byId.get(q.verseId) ?? q);
};
function reviewPassage(queue: QueueItem[], nums: number[], day: number, balance: boolean) {
  let q = queue;
  let last: ReturnType<typeof recordGrade> | null = null;
  for (const n of nums) {
    last = recordGrade(q, `BSB_Romans_8_${n}`, 'clean' as ReviewGrade, {
      day: key(day),
      clock: CLOCK,
      now: at(day),
      balance: balance ? { capMinutes: 10 } : undefined,
    });
    q = merge(q, last.changed);
  }
  return { queue: q, last: last! };
}
const members = (queue: QueueItem[]) => queue.filter((q) => q.book === 'Romans');
// 40 verses of John 3 due Monday the 19th: 10 minutes, the whole limit.
const john = verses(1, 40, { book: 'John', ch: 3, due: at(19).toISOString() });

console.log('leveling through a graded review');
{
  const start = [...verses(1, 4, { due: at(12).toISOString() }), ...john];
  const off = reviewPassage(start, [1, 2, 3, 4], 12, false);
  check('off: the next review lands on its weekday, the 19th', members(off.queue).every((q) => dayOf(q.nextReviewDueDate) === key(19) && q.scheduledDue === undefined));
  const on = reviewPassage(start, [1, 2, 3, 4], 12, true);
  check('on, with the 19th full: the passage moves to the 20th', members(on.queue).every((q) => dayOf(q.nextReviewDueDate) === key(20)), members(on.queue).map((q) => q.nextReviewDueDate));
  check('every member keeps the day the step landed on', members(on.queue).every((q) => q.scheduledDue && dayOf(q.scheduledDue) === key(19)));
  check('it still moved up a review', members(on.queue).every((q) => q.ladderStep === 3 && q.ladderReviews === 1));
  check('no undefined fields for Firestore', !JSON.stringify(on.queue, (_k, v) => (v === undefined ? '__U__' : v)).includes('__U__'));
  const light = reviewPassage([...verses(1, 4, { due: at(12).toISOString() })], [1, 2, 3, 4], 12, true);
  check('on, with a light week: nothing moves', members(light.queue).every((q) => dayOf(q.nextReviewDueDate) === key(19) && q.scheduledDue === undefined));
}

console.log('counting from the scheduled day');
{
  const shifted = verses(1, 4, { due: at(20).toISOString(), sched: at(19).toISOString() });
  const onDay = reviewPassage(shifted, [1, 2, 3, 4], 20, true);
  check('reviewed on the moved day: next review is Monday the 26th', members(onDay.queue).every((q) => dayOf(q.nextReviewDueDate) === key(26) && q.scheduledDue === undefined), members(onDay.queue).map((q) => q.nextReviewDueDate));
  const ahead = reviewPassage(shifted, [1, 2, 3, 4], 18, true);
  check('reviewed ahead, inside the window, it counts', ahead.last.applied !== null && !ahead.last.practice);
  check('reviewed ahead, the next review still lands on Monday the 26th, not the 19th', members(ahead.queue).every((q) => dayOf(q.nextReviewDueDate) === key(26)), members(ahead.queue).map((q) => q.nextReviewDueDate));
  const tooEarly = reviewPassage(shifted, [1, 2, 3, 4], 17, true);
  check('before the window it is practice only', tooEarly.last.practice && tooEarly.last.applied === null);
  const off = reviewPassage(shifted, [1, 2, 3, 4], 18, false);
  check('balance off: ahead of the due day is practice only', off.last.practice && off.last.applied === null);
  const aheadPartial = reviewPassage(shifted, [1, 2], 18, true);
  check('reviewed ahead, a partly covered passage waits for the rest', aheadPartial.last.applied === null && aheadPartial.last.covered === 2 && !aheadPartial.last.practice);
}

console.log('relief valve: easing a day that runs past the limit');
{
  // Today is Monday the 12th. Two weekly passages are due today: 20 verses (5 min) and 12 verses (3 min).
  const big = verses(1, 20, { book: 'Psalms', ch: 119, due: at(12).toISOString() });
  const mid = verses(1, 12, { book: 'Luke', ch: 2, due: at(12).toISOString() });
  const settlingDue = verses(1, 8, { book: 'Mark', ch: 1, step: 1, due: at(12).toISOString() });
  const ease = (queue: QueueItem[], capMinutes: number, clock = CLOCK) =>
    easeToday(queue, { clock, balance: { capMinutes }, sensitivity: 'medium', now: at(12) });
  const under = ease([...big, ...mid], 10);
  check('under the limit: nothing moves', under.moved.length === 0 && under.changed.length === 0);
  // 8 minutes due, limit 5: the larger passage goes, which is enough.
  const over = ease([...big, ...mid], 5);
  check('over the limit: the largest passage moves first, only as many as needed', over.moved.length === 1 && over.moved[0].book === 'Psalms', over.moved.map((p) => p.key));
  check('it moves to the next day and remembers today', over.changed.every((q) => dayOf(q.nextReviewDueDate) === key(13) && dayOf(q.scheduledDue) === key(12)));
  const after = merge([...big, ...mid], over.changed);
  check('afterwards today fits the limit', estimateReviewMinutes(after, 'medium', CLOCK, at(12)) <= 5);
  const list = movedFromDay(after, key(12));
  check('the moved list finds it from the scheduled day', list.length === 1 && list[0].book === 'Psalms');
  check('...and not on other days', movedFromDay(after, key(13)).length === 0);
  const note = movedNote(list, key(12));
  check('the note reads "Moved 1 passage to tomorrow"', note !== null && note.headline === 'Moved 1 passage to tomorrow' && note.items[0].detail === 'Every week · 20 verses · about 5 min', note);
  const twice = ease(after, 2);
  check('a passage that has moved is never moved again', twice.moved.every((p) => p.book !== 'Psalms'));
  const withSettling = ease([...big, ...settlingDue], 2);
  check('Settling reviews never move', withSettling.moved.every((p) => p.items[0].ladderStep! >= 3) && withSettling.changed.every((q) => q.book !== 'Mark'));
  const graded = merge([...big, ...mid], big.map((q) => ({ ...q, dayResult: { day: key(12), grade: 'clean' as ReviewGrade } })));
  check('a passage already graded today stays', ease(graded, 1).moved.every((p) => p.book !== 'Psalms'));
  const full = [...big, ...mid, ...verses(1, 40, { book: 'John', ch: 3, due: at(13).toISOString() })];
  check('it will not move onto a day that would go over the limit', ease(full, 5).moved.length === 0);
  const sabbathNext = ease([...big, ...mid], 5, { ...CLOCK, sabbathEnabled: true, sabbathDay: 'T' });
  check('a Sabbath tomorrow with a one-day window: it stays', sabbathNext.moved.length === 0);
  const paused = ease([...big, ...mid], 5, { ...CLOCK, pausedAt: at(1).toISOString(), pausedUntil: null });
  check('while reviews are paused nothing moves', paused.moved.length === 0);
}

console.log('new verses that fit the time left');
{
  const learning = (n: number) => Array.from({ length: n }, (_, i) => ({ ...mk(i + 1, { book: 'Acts', ch: 2 }), status: 'learning' as const }));
  const due = (n: number) => verses(1, n, { book: 'Luke', ch: 2, due: at(12).toISOString() });
  // 10 minute limit = 600s. 20 due reviews = 300s: 300s left, 90s a verse -> 3.
  check('3 fit in 5 minutes left', newVerseRoom(due(20), 'medium', 10, CLOCK, at(12)) === 3);
  check('none fit in under a verse', newVerseRoom(due(38), 'medium', 10, CLOCK, at(12)) === 0);
  check('none fit at the limit', newVerseRoom(due(40), 'medium', 10, CLOCK, at(12)) === 0);
  check('verses already in Learning use the room', newVerseRoom([...due(20), ...learning(2)], 'medium', 10, CLOCK, at(12)) === 1);
  check('high sensitivity costs more', newVerseRoom(due(20), 'high', 10, CLOCK, at(12)) === 1);
}

console.log('');
console.log(failures === 0 ? 'All balance checks passed.' : `${failures} balance check(s) FAILED.`);
if (failures > 0) process.exit(1);
