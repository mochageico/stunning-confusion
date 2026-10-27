// Assertions for passages, run by `npm run check:passages`.

import type { QueueItem, ReviewGrade } from '../types';
import { LADDER, type LadderState, TOP_STEP } from './ladder';
import { localDayKey } from './logicalDate';
import {
  firmUpsFor,
  ladderStateOf,
  passageOf,
  passages,
  passageState,
  reconcile,
  recordGrade,
  settleStaleDays,
  spreadOverdue,
  winBack,
} from './passages';
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
const key = (day: number, month = 9) => localDayKey(at(day, 12, month));
const dayOf = (iso: string | null | undefined) => (iso ? localDayKey(new Date(iso)) : null);
const CLOCK: ReviewClock = { dayStartHour: 0, sabbathEnabled: false, sabbathDay: 'Su', pausedAt: null, pausedUntil: null };
const SABBATH: ReviewClock = { ...CLOCK, sabbathEnabled: true };

interface Spec {
  v: number;
  t?: string;
  book?: string;
  ch?: number;
  status?: QueueItem['status'];
  step?: number;
  reviews?: number;
  catchUp?: boolean;
  due?: string | null;
}
const item = (s: Spec): QueueItem => {
  const t = s.t ?? 'BSB';
  const book = s.book ?? 'Romans';
  const ch = s.ch ?? 8;
  const q: QueueItem = {
    verseId: `${t}_${book}_${ch}_${s.v}`,
    translationId: t,
    book,
    chapter: ch,
    verseNumber: s.v,
    text: `verse ${s.v} text`,
    orderIndex: s.v,
    status: s.status ?? 'reviewing',
    retentionPhase: s.step === undefined ? 'daily' : (['daily', 'weekly', 'monthly'] as const)[s.step < 3 ? 0 : s.step < 5 ? 1 : 2],
    dateStarted: null,
    lastReviewDate: null,
    nextReviewDueDate: s.due === undefined ? at(12).toISOString() : s.due,
    currentStreakCount: 0,
    totalSuccessfulReviews: 0,
    gracePeriodUsedToday: false,
  };
  if (s.step !== undefined) {
    q.ladderStep = s.step;
    q.ladderReviews = s.reviews ?? 0;
  }
  if (s.catchUp) q.catchUp = true;
  return q;
};
const range = (from: number, to: number, rest: Omit<Spec, 'v'> = {}) =>
  Array.from({ length: to - from + 1 }, (_, i) => item({ ...rest, v: from + i }));
/** Applies changed items back onto the queue, like the engine's write would. */
const merge = (queue: QueueItem[], changed: QueueItem[]) => {
  const byId = new Map(changed.map((c) => [c.verseId, c]));
  return queue.map((q) => byId.get(q.verseId) ?? q);
};
const settle = (queue: QueueItem[], now: Date) => merge(queue, reconcile(queue, { clock: CLOCK, now }).changed);
const stateAt = (queue: QueueItem[], v: number, t = 'BSB'): LadderState | null =>
  ladderStateOf(queue.find((q) => q.verseNumber === v && q.translationId === t)!);
const sameState = (a: LadderState | null, b: LadderState) => JSON.stringify(a) === JSON.stringify(b);
const noUndefined = (items: QueueItem[]) => items.every((q) => !JSON.stringify(q, (_k, v) => (v === undefined ? '__U__' : v)).includes('__U__'));
const idOf = (v: number, t = 'BSB', book = 'Romans', ch = 8) => `${t}_${book}_${ch}_${v}`;

/** Grades every listed verse of the passage on `day` and returns the queue after each write. */
function review(
  queue: QueueItem[],
  grades: Record<number, ReviewGrade>,
  day: number,
  extra: { selfCheck?: boolean; canMoveUp?: boolean; clock?: ReviewClock } = {}
) {
  let q = queue;
  let last: ReturnType<typeof recordGrade> | null = null;
  for (const [v, grade] of Object.entries(grades)) {
    last = recordGrade(q, idOf(Number(v)), grade, { day: key(day), clock: extra.clock ?? CLOCK, now: at(day), ...extra });
    q = merge(q, last.changed);
  }
  return { queue: q, last: last! };
}
const allClean = (from: number, to: number): Record<number, ReviewGrade> =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, 'clean' as ReviewGrade]));

console.log('passages()');
{
  const q = [
    ...range(1, 3, { step: 3 }),
    item({ v: 4, status: 'learning' }),
    ...range(5, 6, { step: 3 }),
    item({ v: 8, step: 3 }),
    ...range(1, 2, { t: 'KJV', step: 3 }),
    item({ v: 9, status: 'queued' }),
    item({ v: 1, ch: 9, step: 3 }),
  ];
  const ps = passages(q);
  const spans = ps.map((p) => `${p.translationId} ${p.chapter}:${p.first}-${p.last}`).sort();
  check(
    'runs split at gaps and Learning verses, per translation and chapter',
    JSON.stringify(spans) === JSON.stringify(['BSB 8:1-3', 'BSB 8:5-6', 'BSB 8:8-8', 'BSB 9:1-1', 'KJV 8:1-2']),
    spans
  );
  check('verses in Learning or queued are in no passage', !passageOf(q, idOf(4)) && !passageOf(q, idOf(9)));
  check('members come in verse order', passages([item({ v: 3 }), item({ v: 1 }), item({ v: 2 })])[0].items.map((i) => i.verseNumber).join() === '1,2,3');
  check('retained verses count as past Learning', passages([item({ v: 1, status: 'retained', step: 7 })]).length === 1);
}

console.log('joining');
{
  // Romans 8:1–20 at Every 2 weeks; verse 21 leaves Learning (no ladderStep).
  const base = range(1, 20, { step: 4, reviews: 3, due: at(20).toISOString() });
  const q = [...base, item({ v: 21, due: at(13).toISOString() })];
  const r = reconcile(q, { clock: CLOCK, now: at(12) });
  const after = merge(q, r.changed);
  check('join at the end: the passage drops to Every day with a catch-up', after.every((i) => sameState(ladderStateOf(i), { step: 0, reviews: 0, catchUp: true })));
  check('…due the next day', after.every((i) => dayOf(i.nextReviewDueDate) === key(13)));
  check('…every member changed (one write each)', r.changed.length === 21);
  check('…reported as a join that restarted', r.joins.length === 1 && r.joins[0].restarted && r.joins[0].joined.join() === '21');
  check('…legacy fields mapped: reviewing, daily', after.every((i) => i.status === 'reviewing' && i.retentionPhase === 'daily'));
  check('…no undefined values (Firestore)', noUndefined(r.changed));
  check('reconcile again changes nothing', reconcile(after, { clock: CLOCK, now: at(12) }).changed.length === 0);

  const front = [item({ v: 4 }), ...range(5, 9, { step: 5, reviews: 2 })];
  const f = merge(front, reconcile(front, { clock: CLOCK, now: at(12) }).changed);
  check('join at the front: same catch-up', f.every((i) => sameState(ladderStateOf(i), { step: 0, reviews: 0, catchUp: true })) && passages(f).length === 1);

  // A catch-up already running at Every 2 days, review 1.
  const running = [...range(1, 5, { step: 1, reviews: 1, catchUp: true, due: at(14).toISOString() }), item({ v: 6 })];
  const rr = reconcile(running, { clock: CLOCK, now: at(12) });
  const ra = merge(running, rr.changed);
  check('joining a running catch-up doesn\'t restart it', ra.every((i) => sameState(ladderStateOf(i), { step: 1, reviews: 1, catchUp: true })));
  check('…the due date stays', ra.every((i) => dayOf(i.nextReviewDueDate) === key(14)));
  check('…only the new verse is written', rr.changed.length === 1 && rr.changed[0].verseNumber === 6 && !rr.joins[0].restarted);

  // A brand-new passage (nothing to join) climbs normally.
  const fresh = merge(range(1, 3), reconcile(range(1, 3), { clock: CLOCK, now: at(12) }).changed);
  check('a passage made only of new verses starts at Every day without a catch-up', fresh.every((i) => sameState(ladderStateOf(i), { step: 0, reviews: 0 })));
}

console.log('gaps, merges, translations');
{
  // Romans 8:1–20 at Every week, 8:22–39 at Every 8 weeks; 21 fills the gap.
  const q = [...range(1, 20, { step: 3, reviews: 5 }), ...range(22, 39, { step: 6, reviews: 1 })];
  check('a gap keeps two passages apart', passages(q).length === 2);
  check('…and reconcile leaves them alone', reconcile(q, { clock: CLOCK, now: at(12) }).changed.length === 0);
  const filled = settle([...q, item({ v: 21 })], at(12));
  check('filling the gap merges them into one passage', passages(filled).length === 1 && passages(filled)[0].items.length === 39);
  check('…with one catch-up from Every day', filled.every((i) => sameState(ladderStateOf(i), { step: 0, reviews: 0, catchUp: true })));

  // ESV and BSB of the same verses: separate.
  const two = [...range(1, 3, { step: 3, reviews: 2 }), ...range(1, 3, { t: 'ESV', step: 6 }), item({ v: 4, t: 'ESV' })];
  const ta = settle(two, at(12));
  check('two translations are two passages', passages(ta).length === 2);
  check('…a join in ESV leaves BSB where it was', sameState(stateAt(ta, 1), { step: 3, reviews: 2 }) && sameState(stateAt(ta, 1, 'ESV'), { step: 0, reviews: 0, catchUp: true }));

  // Migration-style disagreement: the lowest step, then fewest reviews, earliest due.
  const mixed = [
    item({ v: 1, step: 5, reviews: 0, due: at(30).toISOString() }),
    item({ v: 2, step: 3, reviews: 4, due: at(20).toISOString() }),
    item({ v: 3, step: 3, reviews: 2, due: at(25).toISOString() }),
  ];
  const ma = settle(mixed, at(12));
  check('members that disagree take the lowest step and reviews', ma.every((i) => sameState(ladderStateOf(i), { step: 3, reviews: 2 })), ma.map(ladderStateOf));
  check('…and the earliest due date', ma.every((i) => dayOf(i.nextReviewDueDate) === key(20)));
  check('…legacy phase follows the group (Steady = weekly)', ma.every((i) => i.retentionPhase === 'weekly'));
}

console.log('a single-verse passage');
{
  let q = [item({ v: 1, step: 0, reviews: 0, due: at(12).toISOString() })];
  const r = review(q, { 1: 'clean' }, 12);
  q = r.queue;
  check('one clean grade completes the review: up', r.last.applied?.outcome === 'up' && sameState(stateAt(q, 1), { step: 0, reviews: 1 }));
  check('…next due tomorrow', dayOf(q[0].nextReviewDueDate) === key(13));
  check('…results cleared', !q[0].dayResult);
  const again = recordGrade(q, idOf(1), 'blank', { day: key(12), clock: CLOCK, now: at(12, 18) });
  check('grading it again the same day is practice (not due)', again.practice && !again.applied && again.changed.every((c) => !c.dayResult));
  const s = review(q, { 1: 'stumble' }, 13);
  check('a single stumble holds', s.last.applied?.outcome === 'held' && sameState(stateAt(s.queue, 1), { step: 0, reviews: 1 }));
}

console.log('coverage');
{
  let q = range(1, 5, { step: 3, reviews: 2, due: at(12).toISOString() });
  let r = review(q, { 1: 'clean', 2: 'clean' }, 12);
  q = r.queue;
  check('partly covered: nothing applied yet', !r.last.applied && r.last.covered === 2 && sameState(stateAt(q, 1), { step: 3, reviews: 2 }));
  check('…dayResult kept on the covered verses only', q.filter((i) => i.dayResult?.day === key(12)).length === 2);
  r = review(q, { 2: 'stumble' }, 12);
  q = r.queue;
  check('covered twice keeps the worse grade', q[1].dayResult?.grade === 'stumble');
  r = review(q, { 2: 'clean' }, 12);
  q = r.queue;
  check('…a later clean doesn\'t erase a stumble', q[1].dayResult?.grade === 'stumble');
  r = review(q, { 3: 'clean', 4: 'clean', 5: 'clean' }, 12);
  q = r.queue;
  check('fully covered: one outcome, from the worst grades (1 stumble in 5 = held)', r.last.applied?.outcome === 'held' && sameState(stateAt(q, 1), { step: 3, reviews: 2 }));
  check('…every member cleared and agreeing', q.every((i) => !i.dayResult && sameState(ladderStateOf(i), { step: 3, reviews: 2 })));
  check('…the stumbled verse gets the weak-spot dot', q[1].slipped === true && q.filter((i) => i.slipped).length === 1);
  check('…no undefined values (Firestore)', noUndefined(q));

  // The same passage reviewed half in one screen and half in another moves up once.
  let h = range(1, 4, { step: 3, reviews: 2, due: at(12).toISOString() });
  h = review(h, { 1: 'clean', 2: 'clean' }, 12, {}).queue;
  const second = review(h, { 3: 'clean', 4: 'clean' }, 12, {});
  h = second.queue;
  const third = review(h, allClean(1, 4), 12);
  check('two halves move up once, not twice', second.last.applied?.outcome === 'up' && !third.last.applied && sameState(stateAt(third.queue, 1), { step: 3, reviews: 3 }));

  const big = review(range(1, 12, { step: 3, reviews: 2, due: at(12).toISOString() }), { ...allClean(1, 12), 4: 'stumble', 9: 'stumble' }, 12);
  check('12 verses with 2 stumbles: forgiven, counts', big.last.applied?.outcome === 'forgiven' && sameState(stateAt(big.queue, 1), { step: 3, reviews: 3 }));
  check('…the slipped verses still get dots', big.queue.filter((i) => i.slipped).length === 2);
  check('…and no firm-up (nothing lost)', !big.queue[0].firmUp);

  const blank = review(range(1, 5, { step: 3, reviews: 4, due: at(12).toISOString() }), { ...allClean(1, 5), 3: 'blank' }, 12);
  check('a blank drops a step: Every week to Every 4 days, back to Settling', blank.last.applied?.outcome === 'down' && sameState(stateAt(blank.queue, 1), { step: 2, reviews: 0 }) && blank.queue[0].retentionPhase === 'daily');
  check('…due in 4 days', dayOf(blank.queue[0].nextReviewDueDate) === key(16));
}

console.log('firm up and win back');
{
  // 5 verses at Every 4 days, review 2: verse 3 stumbles on the 12th = held.
  let q = range(1, 5, { step: 2, reviews: 2, due: at(12).toISOString() });
  q = review(q, { ...allClean(1, 5), 3: 'stumble' }, 12).queue;
  const fu = q[0].firmUp;
  check('a stumble-hold offers a firm-up the next day', !!fu && fu.day === key(13) && fu.verses.join() === '3', fu);
  check('…restoring the held review', !!fu && fu.restore.step === 2 && fu.restore.reviews === 3);
  check('…on every member', q.every((i) => JSON.stringify(i.firmUp) === JSON.stringify(fu)));
  check('firmUpsFor finds it on its day only', firmUpsFor(q, key(13)).length === 1 && firmUpsFor(q, key(12)).length === 0);
  const early = winBack(q, idOf(3), [{ verseId: idOf(3), grade: 'clean' }], { day: key(12), clock: CLOCK, now: at(12) });
  check('not winnable before its day', !early.won);
  const miss = winBack(q, idOf(1), [{ verseId: idOf(3), grade: 'stumble' }], { day: key(13), clock: CLOCK, now: at(13) });
  check('a slipped verse not clean: not won, nothing lost', !miss.won && miss.changed.length === 0);
  const won = winBack(q, idOf(1), [{ verseId: idOf(3), grade: 'clean' }], { day: key(13), clock: CLOCK, now: at(13) });
  const w = merge(q, won.changed);
  check('reciting the slipped verse clean the next day wins the review back', won.won && sameState(stateAt(w, 1), { step: 2, reviews: 3 }));
  check('…the firm-up and the dot are gone', w.every((i) => !i.firmUp && !i.slipped));
  check('…once only', !winBack(w, idOf(1), [{ verseId: idOf(3), grade: 'clean' }], { day: key(13), clock: CLOCK, now: at(13) }).won);
  check('…no undefined values (Firestore)', noUndefined(w));

  // Held at the last review of a step: winning it back moves up a step.
  let top = range(1, 3, { step: 2, reviews: 3, due: at(12).toISOString() });
  top = review(top, { 1: 'stumble', 2: 'clean', 3: 'clean' }, 12).queue;
  const tw = merge(top, winBack(top, idOf(1), [{ verseId: idOf(1), grade: 'clean' }], { day: key(13), clock: CLOCK, now: at(13) }).changed);
  check('winning back the step\'s last review moves up a step', sameState(stateAt(tw, 1), { step: 3, reviews: 0 }) && tw[0].retentionPhase === 'weekly');

  // Back one (3 stumbles) is undone.
  let back = range(1, 5, { step: 3, reviews: 3, due: at(12).toISOString() });
  back = review(back, { 1: 'stumble', 2: 'stumble', 3: 'stumble', 4: 'clean', 5: 'clean' }, 12).queue;
  check('3 stumbles: back one review', sameState(stateAt(back, 1), { step: 3, reviews: 2 }) && back[0].firmUp?.verses.join() === '1,2,3');
  const bw = merge(back, winBack(back, idOf(1), [1, 2, 3].map((v) => ({ verseId: idOf(v), grade: 'clean' as ReviewGrade })), { day: key(13), clock: CLOCK, now: at(13) }).changed);
  check('…a firm-up undoes it', sameState(stateAt(bw, 1), { step: 3, reviews: 3 }));

  let floor = range(1, 5, { step: 3, reviews: 0, due: at(12).toISOString() });
  floor = review(floor, { 1: 'stumble', 2: 'stumble', 3: 'stumble', 4: 'clean', 5: 'clean' }, 12).queue;
  check('back one at the start of a step loses nothing: no firm-up', !floor[0].firmUp && sameState(stateAt(floor, 1), { step: 3, reviews: 0 }));

  let drop = range(1, 5, { step: 3, reviews: 3, due: at(12).toISOString() });
  drop = review(drop, { ...allClean(1, 5), 2: 'blank' }, 12).queue;
  check('a step drop from a blank can\'t be won back', !drop[0].firmUp);

  // A firm-up landing on the Sabbath moves to the day after.
  let sab = range(1, 3, { step: 0, reviews: 2, due: at(10).toISOString() });
  sab = review(sab, { 1: 'stumble', 2: 'clean', 3: 'clean' }, 10, { clock: SABBATH }).queue;
  check('a firm-up skips the Sabbath', sab[0].firmUp?.day === key(12), sab[0].firmUp);

  // Any later review replaces the firm-up (Every day: due on the firm-up's day too).
  let daily = range(1, 3, { step: 0, reviews: 2, due: at(12).toISOString() });
  daily = review(daily, { 1: 'stumble', 2: 'clean', 3: 'clean' }, 12).queue;
  const later = review(daily, allClean(1, 3), 13).queue;
  check('a regular review on the firm-up day replaces it', !!daily[0].firmUp && later.every((i) => !i.firmUp) && sameState(stateAt(later, 1), { step: 0, reviews: 3 }));

  const expired = merge(q, settleStaleDays(q, key(14), { clock: CLOCK, now: at(14) }).changed);
  check('an unused firm-up expires after its day', expired.every((i) => !i.firmUp) && !!q[0].firmUp);

  const dot = review(q, { 3: 'clean' }, 13);
  check('a clean grade clears the weak-spot dot even before the passage is done', !dot.queue[2].slipped);
}

console.log('self-checks and spot checks');
{
  let q = range(1, 3, { step: 0, reviews: 0, due: at(12).toISOString() });
  let r = review(q, allClean(1, 3), 12, { selfCheck: true });
  q = r.queue;
  check('a self-check can move up', r.last.applied?.outcome === 'up' && q.every((i) => i.lastSelfChecked === true));
  r = review(q, allClean(1, 3), 13, { selfCheck: true });
  q = r.queue;
  check('…but not twice in a row', r.last.applied?.outcome === 'held' && sameState(stateAt(q, 1), { step: 0, reviews: 1 }));
  check('…a held self-check gets no firm-up', !q[0].firmUp);
  r = review(q, allClean(1, 3), 14);
  q = r.queue;
  check('a recall review then moves up and frees it', r.last.applied?.outcome === 'up' && q.every((i) => !i.lastSelfChecked));
  r = review(q, allClean(1, 3), 15, { selfCheck: true });
  check('…so the next self-check counts again', r.last.applied?.outcome === 'up');

  // Mixed: one verse self-checked, the rest recited; the last move up was a self-check.
  let m = range(1, 3, { step: 0, reviews: 0, due: at(12).toISOString() });
  m = review(m, allClean(1, 3), 12, { selfCheck: true }).queue;
  m = review(m, { 1: 'clean', 2: 'clean' }, 13).queue;
  const mr = review(m, { 3: 'clean' }, 13, { selfCheck: true });
  check('a review with any self-checked verse is a self-check', mr.last.applied?.outcome === 'held');

  const spot = review(range(1, 3, { step: 0, reviews: 0, due: at(12).toISOString() }), allClean(1, 3), 12, { canMoveUp: false });
  check('a missed spot check holds the review', spot.last.applied?.outcome === 'held' && sameState(stateAt(spot.queue, 1), { step: 0, reviews: 0 }));
  const spotBack = review(range(1, 5, { step: 3, reviews: 3, due: at(12).toISOString() }), { 1: 'stumble', 2: 'stumble', 3: 'stumble', 4: 'clean', 5: 'clean' }, 12, { canMoveUp: false });
  check('…stumbles still apply', spotBack.last.applied?.outcome === 'back');
}

console.log('partial coverage and day rollover');
{
  let q = range(1, 6, { step: 3, reviews: 3, due: at(12).toISOString() });
  q = review(q, { 1: 'clean', 2: 'clean', 3: 'clean' }, 12).queue;
  const s = settleStaleDays(q, key(13), { clock: CLOCK, now: at(13, 8) });
  const after = merge(q, s.changed);
  check('clean but partly covered: held, no move up', s.settled.length === 1 && s.settled[0].outcome === 'held' && s.settled[0].penaltyOnly && sameState(stateAt(after, 1), { step: 3, reviews: 3 }));
  check('…results cleared', after.every((i) => !i.dayResult));
  check('…next due counted from the day it was reviewed', dayOf(after[0].nextReviewDueDate) === key(19), dayOf(after[0].nextReviewDueDate));
  check('…no firm-up for a penalty-only outcome', !after[0].firmUp);

  let p = range(1, 6, { step: 3, reviews: 3, due: at(12).toISOString() });
  p = review(p, { 1: 'stumble', 2: 'stumble', 3: 'stumble' }, 12).queue;
  const ps = settleStaleDays(p, key(13), { clock: CLOCK, now: at(13) });
  check('partly covered with 3 stumbles: back one', ps.settled[0]?.outcome === 'back' && sameState(stateAt(merge(p, ps.changed), 1), { step: 3, reviews: 2 }));

  let b = range(1, 6, { step: 3, reviews: 3, due: at(12).toISOString() });
  b = review(b, { 4: 'blank' }, 12).queue;
  const bs = settleStaleDays(b, key(13), { clock: CLOCK, now: at(13) });
  check('partly covered with a blank: down a step', bs.settled[0]?.outcome === 'down' && sameState(stateAt(merge(b, bs.changed), 1), { step: 2, reviews: 0 }));

  check('settleStaleDays leaves today\'s results alone', settleStaleDays(q, key(12), { clock: CLOCK, now: at(12, 20) }).changed.length === 0);

  // The app left open past midnight: the next grade settles yesterday first.
  let o = range(1, 2, { step: 0, reviews: 2, due: at(12).toISOString() });
  o = review(o, { 1: 'clean' }, 12).queue;
  const next = review(o, { 2: 'clean' }, 13);
  check('a grade on the next day settles the stale review first', next.last.settled?.outcome === 'held' && next.last.settled.penaltyOnly);
  check('…then counts toward the new day\'s review', next.last.covered === 1 && next.queue[1].dayResult?.day === key(13));
}

console.log('the top, and reopening it');
{
  let q = range(1, 3, { step: TOP_STEP, reviews: 4, due: at(12).toISOString() });
  q = review(q, allClean(1, 3), 12).queue;
  check('the top step keeps counting', sameState(stateAt(q, 1), { step: TOP_STEP, reviews: 5 }));
  check('…every 6 months (26 weeks) on the chapter\'s weekday', dayOf(q[0].nextReviewDueDate) === localDayKey(new Date(2027, 3, 12)), dayOf(q[0].nextReviewDueDate));
  q = settle([...q, item({ v: 4 })], at(13));
  check('a verse joining at the top reopens the passage with a catch-up', q.every((i) => sameState(ladderStateOf(i), { step: 0, reviews: 0, catchUp: true })));
  let day = 14;
  for (let i = 0; i < 7; i++) {
    q = review(q, allClean(1, 4), day).queue;
    day += LADDER[passageState(passages(q)[0]).step].intervalDays;
  }
  check('…7 clean reviews land it at Every week', sameState(stateAt(q, 1), { step: 3, reviews: 0 }));
  // The catch-up ends on Wednesday the 28th; Every week then lands on the
  // chapter's Monday, November 2 (day 33 of October), then weekly.
  check('…the first Every week review is on the chapter weekday', dayOf(q[0].nextReviewDueDate) === key(33), dayOf(q[0].nextReviewDueDate));
  day = 33;
  for (let i = 0; i < 7; i++) {
    q = review(q, allClean(1, 4), day).queue;
    day += 7;
  }
  check('…each a week apart', dayOf(q[0].nextReviewDueDate) === key(day), [dayOf(q[0].nextReviewDueDate), key(day)]);
  check('…then climbs at the normal pace (8 at Every week, no faster second climb)', sameState(stateAt(q, 1), { step: 3, reviews: 7 }));
}

console.log('the chapter\'s weekday');
{
  // Reaching Every week sets the anchor to the day it happened (Monday the 12th).
  let q = range(1, 2, { step: 2, reviews: 3, due: at(12).toISOString() });
  q = review(q, allClean(1, 2), 12).queue;
  check('the first passage to reach Every week sets the chapter\'s weekday', q.every((i) => i.chapterReviewAnchorDay === 'M'));
  check('…due a week later on it', dayOf(q[0].nextReviewDueDate) === key(19));
  // Another passage of the chapter uses it.
  const other = [...q, ...range(10, 11, { step: 2, reviews: 3, due: at(15).toISOString() })];
  const o = review(other, { 10: 'clean', 11: 'clean' }, 15).queue;
  const v10 = o.find((i) => i.verseNumber === 10)!;
  check('a later passage of the chapter snaps onto it', dayOf(v10.nextReviewDueDate) === key(19) && !v10.chapterReviewAnchorDay);
}

console.log('welcome back: spreading overdue reviews');
{
  // Back on the 31st after 19 days away (last due the 12th). Cap 3 minutes =
  // 12 verses a day at 15s each.
  const q = [
    ...range(1, 8, { step: 4, reviews: 2, due: at(12).toISOString() }), // Steady, 8 verses, most overdue
    ...range(10, 15, { step: 1, reviews: 1, due: at(20).toISOString() }), // Settling, 6 verses
    ...range(20, 25, { step: 0, reviews: 3, due: at(25).toISOString() }), // Settling, 6 verses
    ...range(1, 4, { ch: 9, step: 5, due: at(18).toISOString() }), // Kept, 4 verses
    ...range(1, 2, { ch: 10, step: 3, due: at(31).toISOString() }), // Steady, due today anyway
    ...range(1, 30, { ch: 11, step: 3, due: at(2, 12, 10).toISOString() }), // due Nov 2, 30 verses (over the cap)
  ];
  const now = at(31, 9);
  const { changed, days } = spreadOverdue(q, 3, CLOCK, now);
  const plan = days.map((d) => `${d.day}: ${d.passages.map((p) => `${p.chapter}:${p.first}`).join(' ')}`);
  check(
    'Settling first, then most overdue; each day under the cap with what\'s already due',
    JSON.stringify(plan) ===
      JSON.stringify([
        // Oct 31: 2 verses already due + 6 Settling; the next 6 would make 14.
        `${key(31)}: 8:10`,
        // Nov 1: the other Settling 6; Steady's 8 would make 14.
        `${key(1, 10)}: 8:20`,
        // Nov 2 already has 30 verses due: nothing more fits. Nov 3: 8 + 4.
        `${key(3, 10)}: 8:1 9:1`,
      ]),
    plan
  );
  const after = merge(q, changed);
  check('every overdue passage gets a new due date, today\'s too', after.filter((i) => i.chapter <= 9).every((i) => (dayOf(i.nextReviewDueDate) ?? '') >= key(31)));
  check('passages not overdue are untouched', changed.every((c) => c.chapter <= 9));
  check('a second run has nothing overdue left', spreadOverdue(after, 3, CLOCK, now).changed.length === 0);

  const sab = spreadOverdue(range(1, 12, { step: 0, due: at(5).toISOString() }).concat(range(20, 31, { step: 0, due: at(6).toISOString() })), 3, SABBATH, at(10, 9));
  check('the Sabbath gets no reviews', sab.days.map((d) => d.day).join() === `${key(10)},${key(12)}`, sab.days.map((d) => d.day));

  const huge = spreadOverdue(range(1, 40, { step: 3, due: at(5).toISOString() }), 3, CLOCK, at(10, 9));
  check('a passage too long for the cap still gets a day', huge.days.length === 1 && huge.days[0].day === key(10));

  check('nothing overdue, nothing spread', spreadOverdue(range(1, 3, { step: 0, due: at(10).toISOString() }), 3, CLOCK, at(10, 9)).changed.length === 0);
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All passage checks passed.');
