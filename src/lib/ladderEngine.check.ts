// Assertions for the ladder engine glue, run by `npm run check:ladderengine`.

import type { QueueItem, ReviewGrade } from '../types';
import {
  gradeVerse,
  joinMessage,
  ladderPrefsFrom,
  mergeChanged,
  outcomeMessage,
  prepareLadderQueue,
  reviewNote,
  verseRanges,
  DEFAULT_LADDER_PREFS,
} from './ladderEngine';
import { localDayKey } from './logicalDate';
import { passageOf, passageState, reconcile } from './passages';
import { dayLabel, firmUpItems, lateNoteFor, welcomeBack } from './todayCards';
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

console.log('on load: a long absence drops one step, and one clean review returns it');
const awayQ = range(1, 3, { step: 4, reviews: 2, due: at(1, 8).toISOString() });
const away = prepareLadderQueue(awayQ, { clock: CLOCK, prefs: PREFS, capMinutes: 30, now: at(29, 9) });
check(
  '4 weeks late at Every 2 weeks: Every week, 7 of 8',
  away.queue.every((q) => q.ladderStep === 3 && q.ladderReviews === 7 && q.retentionPhase === 'weekly'),
  away.queue.map((q) => [q.ladderStep, q.ladderReviews])
);
check('…noted as a drop', away.late.length === 1 && away.late[0].dropped?.fromStep === 4 && away.late[0].dropped.toStep === 3);
check('…in the history too', away.queue[0].reviewLogs?.some((l) => l.outcome === 'late' && l.step === 4 && l.toStep === 3) === true);
check('…due today (spread)', dayOf(away.queue[0].nextReviewDueDate) === localDayKey(at(29)));
check('…opening again the same day charges nothing', prepareLadderQueue(away.queue, { clock: CLOCK, prefs: PREFS, capMinutes: 30, now: at(29, 15) }).changed.length === 0);
const back = gradeAll(away.queue, [[1, 'clean'], [2, 'clean'], [3, 'clean']], at(29, 10));
check('one clean review moves it back up to Every 2 weeks', back.last.applied?.outcome === 'up' && passageState(passageOf(back.queue, id(1))!).step === 4);
const topAway = prepareLadderQueue(range(1, 3, { step: 7, reviews: 1, due: at(1, 8).toISOString() }), { clock: CLOCK, prefs: PREFS, capMinutes: 30, now: at(29, 9) });
check('Every 6 months is for good: never moved back', topAway.late.length === 0 && topAway.queue.every((q) => q.ladderStep === 7 && q.ladderReviews === 1));
const awayOff = prepareLadderQueue(awayQ, { clock: CLOCK, prefs: { ...PREFS, lateMovesBack: false }, capMinutes: 30, now: at(29, 9) });
check('setting off: no drop either', awayOff.queue.every((q) => q.ladderStep === 4 && q.ladderReviews === 2));

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

console.log('grading: a stumble holds, and so does a blank');
const held = gradeAll(fresh, [[1, 'clean'], [2, 'stumble'], [3, 'clean']], at(12, 10));
check('1 stumble under 12 verses: held', held.last.applied?.outcome === 'held' && passageState(passageOf(held.queue, id(1))!).reviews === 2);
check('held offers a firm-up and says so', !!held.queue[0].firmUp && held.last.messages[0].includes('Firm it up tomorrow'));
check('the stumbled verse logs a miss, the clean ones a pass', held.queue[1].reviewLogs![0].result === 'miss' && held.queue[0].reviewLogs![0].result === 'pass');
const higher = range(1, 3, { step: 3, reviews: 2, due: at(12, 8).toISOString() });
const down = gradeAll(higher, [[1, 'clean'], [2, 'blank'], [3, 'stumble']], at(12, 10));
check('a blank: held at Every week', down.last.applied?.outcome === 'held' && passageState(passageOf(down.queue, id(1))!).step === 3 && passageState(passageOf(down.queue, id(1))!).reviews === 2);
check(
  'held toast names the slips',
  down.last.messages[0] === "Romans 8:1–3: 1 blank and 1 stumble, so this review didn't count. It stays where it was. Firm it up tomorrow to win it back.",
  down.last.messages
);

console.log('grading: a better run the same day redoes the review');
const redo = gradeAll(down.queue, [[2, 'clean'], [3, 'clean']], at(12, 18));
check('the blank and the stumble recited clean: the review moves up instead', redo.last.applied?.outcome === 'up' && passageState(passageOf(redo.queue, id(1))!).step === 3 && passageState(passageOf(redo.queue, id(1))!).reviews === 3);
check('…one history entry per verse for the day, the redo', redo.queue.every((q) => q.reviewLogs?.length === 1 && q.reviewLogs[0].outcome === 'up' && q.reviewLogs[0].step === 3 && q.reviewLogs[0].stage === 'weekly'), redo.queue.map((q) => q.reviewLogs));
check('…counted once as a success', redo.queue.every((q) => q.totalSuccessfulReviews === 1));
check('…the toast says so', redo.last.messages[0]?.startsWith('Better run! Romans 8:1–3'), redo.last.messages);
const partway = gradeVerse(down.queue, id(2), 'clean', { clock: CLOCK, now: at(12, 18) });
check(
  'one verse better (blank to clean, stumble left): still held, noted',
  !partway.applied && !partway.practice && partway.messages[0] === "Romans 8:1–3: better run noted, but today's review comes out the same.",
  partway.messages
);

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

console.log('recap lines');
const notesOf = (r: ReturnType<typeof gradeVerse>) => r.notes;
check('a clean review: tag and count', (() => {
  const c = gradeAll(fresh, [[1, 'clean'], [2, 'clean'], [3, 'clean']], at(12, 10));
  const n = notesOf(c.last);
  return n.length === 1 && n[0].tag === 'Clean' && n[0].title === 'Romans 8:1–3' && /^Review 3 of 7 at Every day\.$/.test(n[0].reason) && n[0].slipped.length === 0 && !n[0].firmUp;
})());
check('a partly covered review has no line yet', notesOf(gradeAll(fresh, [[1, 'clean']], at(12, 10)).last).length === 0);
check('held: tag, count, firm-up', (() => {
  const n = notesOf(held.last)[0];
  return n.tag === 'Held' && n.reason === "1 stumble, so this review didn't count." && n.firmUp && n.slipped.length === 1 && n.slipped[0].verseNumber === 2;
})(), notesOf(held.last));
check('held by a blank: tag and reason', (() => {
  const n = notesOf(down.last)[0];
  return n.tag === 'Held' && n.reason === "1 blank and 1 stumble, so this review didn't count." && n.slipped.some((x) => x.verseNumber === 2);
})(), notesOf(down.last));
check('a firm-up won back is its own line', notesOf(w).some((n) => n.tag === 'Won back' && n.title === 'Romans 8:1–3'), notesOf(w));
check('a practice (not due) grade gives no line', gradeVerse(fresh, id(1), 'clean', { clock: CLOCK, now: at(11, 10) }).notes.length === 0);
check('forgiven and the spot check', (() => {
  const base = { passage: passageOf(range(1, 3, { step: 3 }), id(1))!, from: { step: 3, reviews: 2 }, to: { step: 3, reviews: 3 }, penaltyOnly: false, firmUp: false };
  const g = (grade: ReviewGrade, v: number) => ({ verseId: id(v), verseNumber: v, grade });
  const f = reviewNote({ ...base, outcome: 'forgiven', grades: [g('stumble', 1), g('stumble', 2)] }, 1);
  const sc = reviewNote({ ...base, outcome: 'held', grades: [g('clean', 1)] }, 1, 'spotCheck');
  return f.tag === 'Forgiven' && f.reason.startsWith('2 stumbles in 3 verses forgiven') && sc.reason === "The spot check slipped, so this review didn't count.";
})());

console.log("today's ladder cards");
check('dayLabel', dayLabel('2026-10-12', '2026-10-12') === 'Today' && dayLabel('2026-10-13', '2026-10-12') === 'Tomorrow' && dayLabel('2026-10-15', '2026-10-12') === 'Thursday, Oct 15');
check('welcomeBack: lines and totals', (() => {
  const wb = welcomeBack(
    [
      { day: '2026-10-12', passages: [passageOf(range(1, 3, { step: 0 }), id(1))!] },
      { day: '2026-10-13', passages: [passageOf(range(1, 4, { step: 0 }), id(1))!, passageOf(range(1, 2, { step: 0 }), id(1))!] },
    ],
    '2026-10-12'
  );
  return !!wb && wb.verses === 9 && wb.days.length === 2 && wb.days[1].label === 'Tomorrow' && wb.days[1].passages === 2 && wb.days[1].verses === 6;
})());
check('welcomeBack: nothing spread', welcomeBack([], '2026-10-12') === null);
check('welcomeBack: counts the passages that dropped', welcomeBack(away.spread, localDayKey(at(29)), away.late)?.dropped === 1 && welcomeBack(away.spread, localDayKey(at(29)))?.dropped === 0);
check(
  'late note for a dropped passage',
  lateNoteFor(away.queue.slice(0, 1), away.late) === 'Away a while: now Every week. One clean review moves it back up.',
  lateNoteFor(away.queue.slice(0, 1), away.late)
);
check('firm-up item: only the slipped verses, only on its day', (() => {
  const items = firmUpItems(held.queue, '2026-10-13');
  return items.length === 1 && items[0].title === 'Romans 8:1–3' && items[0].verses.length === 1 && items[0].verses[0].verseNumber === 2 && items[0].line.startsWith('Verse 2 slipped last time.') && firmUpItems(held.queue, '2026-10-12').length === 0;
})(), firmUpItems(held.queue, '2026-10-13'));
check('late note: only for rows in a passage that moved back', (() => {
  const p = passageOf(range(1, 3, { step: 3, reviews: 3 }), id(1))!;
  const late = [{ passage: p, missed: 2, from: 3, to: 1 }];
  return lateNoteFor(p.items.slice(0, 1), late) === 'Late: moved back 2 reviews' && lateNoteFor([item({ v: 9 })], late) === null && lateNoteFor(p.items, [{ passage: p, missed: 1, from: 0, to: 0 }]) === null && lateNoteFor(p.items, [{ passage: p, missed: 1, from: 2, to: 1 }]) === 'Late: moved back 1 review';
})());

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll ladder engine checks passed');
