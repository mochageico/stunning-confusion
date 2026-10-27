// Assertions for the ladder engine glue, run by `npm run check:ladderengine`.

import type { QueueItem, ReviewGrade } from '../types';
import {
  gradeVerse,
  joinMessage,
  ladderPrefsFrom,
  mergeChanged,
  outcomeMessage,
  prepareLadderQueue,
  verseRanges,
  DEFAULT_LADDER_PREFS,
} from './ladderEngine';
import { localDayKey } from './logicalDate';
import { passageOf, passageState, reconcile } from './passages';
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

// October 2026: the 12th is a Monday.
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour);
const dayOf = (iso: string | null | undefined) => (iso ? localDayKey(new Date(iso)) : null);
const CLOCK: ReviewClock = { dayStartHour: 0, sabbathEnabled: false, sabbathDay: 'Su', pausedAt: null, pausedUntil: null };
const PREFS = DEFAULT_LADDER_PREFS;

interface Spec {
  v: number;
  status?: QueueItem['status'];
  phase?: QueueItem['retentionPhase'];
  streak?: number;
  step?: number;
  reviews?: number;
  due?: string | null;
}
const item = (s: Spec): QueueItem => {
  const q: QueueItem = {
    verseId: `BSB_ROM_8_${s.v}`,
    translationId: 'BSB',
    book: 'Romans',
    chapter: 8,
    verseNumber: s.v,
    text: `verse ${s.v}`,
    orderIndex: s.v,
    status: s.status ?? 'reviewing',
    retentionPhase: s.phase ?? 'daily',
    dateStarted: null,
    lastReviewDate: null,
    nextReviewDueDate: s.due === undefined ? at(12, 8).toISOString() : s.due,
    currentStreakCount: s.streak ?? 0,
    totalSuccessfulReviews: 0,
    gracePeriodUsedToday: false,
  };
  if (s.step !== undefined) {
    q.ladderStep = s.step;
    q.ladderReviews = s.reviews ?? 0;
  }
  return q;
};
const range = (from: number, to: number, rest: Omit<Spec, 'v'> = {}) =>
  Array.from({ length: to - from + 1 }, (_, i) => item({ ...rest, v: from + i }));
const id = (v: number) => `BSB_ROM_8_${v}`;

/** Grades every verse of a list, in order, the way the engine does one call at a time. */
const gradeAll = (queue: QueueItem[], grades: [number, ReviewGrade][], now: Date) => {
  let q = queue;
  let last: ReturnType<typeof gradeVerse> | null = null;
  for (const [v, g] of grades) {
    last = gradeVerse(q, id(v), g, { clock: CLOCK, now });
    q = mergeChanged(q, last.changed);
  }
  return { queue: q, last: last! };
};

console.log('settings');
check('defaults when nothing is saved', JSON.stringify(ladderPrefsFrom(undefined)) === JSON.stringify(DEFAULT_LADDER_PREFS));
const read = ladderPrefsFrom({ thoroughness: 1.5, cleanPct: 95, lateMovesBack: false, swapCanBeClean: false });
check('saved settings are read', read.thoroughness === 1.5 && read.cleanPct === 95 && !read.lateMovesBack && !read.swapCanBeClean);
const bad = ladderPrefsFrom({ thoroughness: 3, cleanPct: 70, lateMovesBack: 'yes' });
check('out-of-range values fall back', bad.thoroughness === 1 && bad.cleanPct === 90 && bad.lateMovesBack === true);

console.log('copy');
check('verseRanges joins runs', verseRanges([21, 22]) === '21–22' && verseRanges([1, 2, 3, 5]) === '1–3 and 5' && verseRanges([1, 3, 5, 6]) === '1, 3 and 5–6');

console.log('on load: migration runs once');
const legacy = [...range(1, 3, { phase: 'daily', streak: 5 }), ...range(10, 11, { phase: 'weekly', streak: 3, due: at(15).toISOString() }), item({ v: 20, status: 'learning', due: null })];
const first = prepareLadderQueue(legacy, { clock: CLOCK, prefs: PREFS, capMinutes: 30, now: at(12, 9) });
check('every verse past Learning gets a ladder step', first.queue.filter((q) => q.status === 'reviewing').every((q) => q.ladderStep !== undefined));
check('Learning is untouched', first.queue.find((q) => q.verseNumber === 20)!.ladderStep === undefined && first.queue.find((q) => q.verseNumber === 20)!.status === 'learning');
check('daily 5 → Every day, 5 done', first.queue[0].ladderStep === 0 && first.queue[0].ladderReviews === 5);
check('weekly 3 → Every week, 3 done', first.queue[3].ladderStep === 3 && first.queue[3].ladderReviews === 3);
check('5 verses changed', first.changed.length === 5, first.changed.length);
const second = prepareLadderQueue(first.queue, { clock: CLOCK, prefs: PREFS, capMinutes: 30, now: at(12, 10) });
check('a second load changes nothing', second.changed.length === 0, second.changed.map((q) => q.verseId));

console.log('on load: a verse an old build wrote back without its ladder fields is mapped again, not joined');
const stripped = first.queue.map((q) => {
  if (q.verseNumber !== 2) return q;
  const n = { ...q, currentStreakCount: 6 };
  delete n.ladderStep;
  delete n.ladderReviews;
  return n;
});
const remap = prepareLadderQueue(stripped, { clock: CLOCK, prefs: PREFS, capMinutes: 30, now: at(12, 10) });
const v2 = remap.queue.find((q) => q.verseNumber === 2)!;
check('no catch-up (it was mapped, nothing joined)', !v2.catchUp && v2.ladderStep === 0, v2);

console.log('on load: late reviews move you back, then the spread gives new dates');
const lateQ = range(1, 3, { step: 0, reviews: 4, due: at(9, 8).toISOString() });
const late = prepareLadderQueue(lateQ, { clock: CLOCK, prefs: PREFS, capMinutes: 30, now: at(12, 9) });
check('3 days late at Every day = back 3', late.queue.every((q) => q.ladderReviews === 1), late.queue.map((q) => q.ladderReviews));
check('a late entry is in the history', late.queue[0].reviewLogs?.some((l) => l.outcome === 'late' && l.cycles === 3) === true);
check('the spread moved it to today', dayOf(late.queue[0].nextReviewDueDate) === localDayKey(at(12)));
const lateAgain = prepareLadderQueue(late.queue, { clock: CLOCK, prefs: PREFS, capMinutes: 30, now: at(12, 15) });
check('opening again the same day charges nothing', lateAgain.changed.length === 0);
const lateOff = prepareLadderQueue(lateQ, { clock: CLOCK, prefs: { ...PREFS, lateMovesBack: false }, capMinutes: 30, now: at(12, 9) });
check('setting off: it waits where it was', lateOff.queue.every((q) => q.ladderReviews === 4) && lateOff.late.length === 0);
const paused = prepareLadderQueue(lateQ, { clock: { ...CLOCK, pausedAt: at(1).toISOString() }, prefs: PREFS, capMinutes: 30, now: at(12, 9) });
check('paused: nothing late, nothing spread', paused.changed.length === 0);

console.log('grading: a passage reviewed end to end moves up');
const fresh = range(1, 3, { step: 0, reviews: 2, due: at(12, 8).toISOString() });
const half = gradeVerse(fresh, id(1), 'clean', { clock: CLOCK, now: at(12, 10) });
check('one verse in: no outcome yet', !half.applied && !half.practice && half.messages.length === 0);
const up = gradeAll(fresh, [[1, 'clean'], [2, 'clean'], [3, 'clean']], at(12, 10));
check('all clean: +1 review', up.last.applied?.outcome === 'up' && passageState(passageOf(up.queue, id(1))!).reviews === 3);
check('every member logged once with step + grade', up.queue.every((q) => q.reviewLogs?.length === 1 && q.reviewLogs[0].step === 0 && q.reviewLogs[0].grade === 'clean' && q.reviewLogs[0].result === 'pass'));
check('next due tomorrow', up.queue.every((q) => dayOf(q.nextReviewDueDate) === localDayKey(at(13))));
check('toast says it counted', up.last.messages[0] === 'Romans 8:1–3: review counted (3 of 7 at Every day).', up.last.messages);
const again = gradeVerse(up.queue, id(1), 'clean', { clock: CLOCK, now: at(12, 18) });
check('reviewed again the same day: practice', again.practice && !again.applied);

console.log('grading: a stumble holds, a blank drops a step');
const held = gradeAll(fresh, [[1, 'clean'], [2, 'stumble'], [3, 'clean']], at(12, 10));
check('1 stumble under 12 verses: held', held.last.applied?.outcome === 'held' && passageState(passageOf(held.queue, id(1))!).reviews === 2);
check('held offers a firm-up and says so', !!held.queue[0].firmUp && held.last.messages[0].includes('Firm it up tomorrow'));
check('the stumbled verse logs a miss, the clean ones a pass', held.queue[1].reviewLogs![0].result === 'miss' && held.queue[0].reviewLogs![0].result === 'pass');
const higher = range(1, 3, { step: 3, reviews: 2, due: at(12, 8).toISOString() });
const down = gradeAll(higher, [[1, 'clean'], [2, 'blank'], [3, 'stumble']], at(12, 10));
check('a blank: down to Every 4 days', down.last.applied?.outcome === 'down' && passageState(passageOf(down.queue, id(1))!).step === 2);
check('down toast', down.last.messages[0] === 'Romans 8:1–3: a blank moved it down to Every 4 days.', down.last.messages);

console.log('grading: firm-up the next day wins the review back');
const tomorrow = at(13, 10);
let fq = held.queue;
const w = gradeVerse(fq, id(2), 'clean', { clock: CLOCK, now: tomorrow, firmUpGrades: new Map() });
fq = mergeChanged(fq, w.changed);
check('won back', w.wonBack && w.messages[0] === 'Romans 8:1–3: review won back!', w.messages);
check('the held review now counts', passageState(passageOf(fq, id(1))!).reviews === 3);
check('firm-up gone', fq.every((q) => !q.firmUp));
check('won-back entry in the history', fq[1].reviewLogs!.some((l) => l.outcome === 'wonBack'));

console.log('partly covered, then the next day');
const part = gradeAll(fresh, [[1, 'clean'], [2, 'stumble']], at(12, 10)).queue;
const next = prepareLadderQueue(part, { clock: CLOCK, prefs: PREFS, capMinutes: 30, now: at(13, 9) });
check('penalty-only outcome applied on load', next.settled.length === 1 && next.settled[0].penaltyOnly && next.settled[0].outcome === 'held');
check('it did not move up', passageState(passageOf(next.queue, id(1))!).reviews === 2);
check('results cleared and logged', next.queue.every((q) => !q.dayResult) && next.queue[0].reviewLogs?.length === 1);

console.log('join copy');
const joinedQ = [...range(1, 20, { step: 3, reviews: 1, due: at(19).toISOString() }), ...range(21, 22, { due: null })];
const { joins } = reconcile(joinedQ, { clock: CLOCK, now: at(12, 10) });
check('"Romans 8:21–22 join verses 1–20."', joins.length === 1 && joinMessage(joins[0]).startsWith('Romans 8:21–22 join verses 1–20.'), joins.map(joinMessage));
check('outcomeMessage covers a move up', outcomeMessage({ passage: passageOf(range(1, 20, { step: 3 }), id(1))!, outcome: 'up', from: { step: 2, reviews: 3 }, to: { step: 3, reviews: 0 }, grades: [], penaltyOnly: false, firmUp: false }, 1) === 'Romans 8:1–20 moved up to Every week!');

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll ladder engine checks passed');
