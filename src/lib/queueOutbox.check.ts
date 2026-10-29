// Assertions for the "to send" list (queueOutbox.ts), run by
// `npm run check:outbox`. Its whole job is that a review done with no
// signal is never lost -- and never undone, or allowed to undo someone
// else's -- so each case below is a way that could go wrong.

import { QueueItem, ReviewLog } from '../types';
import { applyOutbox, confirmIds, confirmSent, EMPTY_OUTBOX, mergeVerse, Outbox, recordPending, stableJson } from './queueOutbox';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

function item(verseId: string, orderIndex: number, extra: Partial<QueueItem> = {}): QueueItem {
  return {
    verseId,
    translationId: 'BSB',
    book: 'Romans',
    chapter: 8,
    verseNumber: orderIndex + 1,
    text: 'test',
    orderIndex,
    status: 'reviewing',
    retentionPhase: 'weekly',
    dateStarted: '2026-09-01T12:00:00.000Z',
    lastReviewDate: '2026-10-01T12:00:00.000Z',
    nextReviewDueDate: '2026-10-08T12:00:00.000Z',
    currentStreakCount: 1,
    totalSuccessfulReviews: 1,
    gracePeriodUsedToday: false,
    ...extra,
  };
}

const log = (at: string, result: ReviewLog['result'] = 'pass'): ReviewLog => ({ at, result, stage: 'weekly' });
const json = (q: QueueItem) => JSON.stringify(q);
const write = (q: QueueItem) => ({ item: q, json: json(q) });

// The verse as Firestore had it, and as this device changed it offline.
const server = item('ROM_8_1', 0, { reviewLogs: [log('2026-10-01T12:00:00.000Z')] });
const reviewedOffline = item('ROM_8_1', 0, {
  lastReviewDate: '2026-10-29T08:00:00.000Z',
  nextReviewDueDate: '2026-11-12T08:00:00.000Z',
  totalSuccessfulReviews: 2,
  reviewLogs: [log('2026-10-01T12:00:00.000Z'), log('2026-10-29T08:00:00.000Z')],
});

console.log('queueOutbox — recording and confirming');
{
  const o1 = recordPending(EMPTY_OUTBOX, [write(reviewedOffline)], [], () => json(server));
  check('a write goes on the list with what Firestore had as its base', o1.ROM_8_1?.base === json(server) && o1.ROM_8_1.json === json(reviewedOffline));

  const again = item('ROM_8_1', 0, { ...reviewedOffline, totalSuccessfulReviews: 3 });
  const o2 = recordPending(o1, [write(again)], [], () => 'SHOULD-NOT-BE-USED');
  check('a second change to a waiting verse keeps the first base', o2.ROM_8_1.base === json(server));
  check('...and holds the newest version', o2.ROM_8_1.json === json(again));

  check('confirming the OLDER write leaves the newer one waiting', confirmSent(o2, [{ verseId: 'ROM_8_1', json: json(reviewedOffline) }], []).ROM_8_1 !== undefined);
  check('confirming the newest write clears it', confirmSent(o2, [{ verseId: 'ROM_8_1', json: json(again) }], []).ROM_8_1 === undefined);

  const del = recordPending(EMPTY_OUTBOX, [], ['ROM_8_2'], () => '{}');
  check('a delete goes on the list as item null', del.ROM_8_2?.item === null);
  check('confirming the delete clears it', confirmSent(del, [], ['ROM_8_2']).ROM_8_2 === undefined);
  const readded = recordPending(del, [write(item('ROM_8_2', 1))], [], () => null);
  check('a delete confirm never clears a later re-add', confirmSent(readded, [], ['ROM_8_2']).ROM_8_2?.item?.verseId === 'ROM_8_2');

  check('confirmIds clears whatever is there', Object.keys(confirmIds(o2, ['ROM_8_1'])).length === 0);
  check('nothing to record returns the same list', recordPending(o1, [], [], () => null) === o1);
}

console.log('queueOutbox — putting the list back at launch');
{
  const outbox: Outbox = { ROM_8_1: { item: reviewedOffline, json: json(reviewedOffline), base: json(server) } };

  // THE case stage 1 exists for: reviewed offline, app closed, reopened online.
  const a = applyOutbox([server], outbox);
  check('an offline review Firestore never got comes back', stableJson(a.queue[0]) === stableJson(reviewedOffline), a.queue[0]);
  check('...and is not marked settled (it still has to be written)', !a.settled.includes('ROM_8_1'));

  const b = applyOutbox([reviewedOffline], outbox);
  check('already in Firestore: settled, nothing changes', b.settled.includes('ROM_8_1') && stableJson(b.queue[0]) === stableJson(reviewedOffline));

  // Same content, fields in another order (how Firestore hands them back).
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(reviewedOffline).reverse()))) as QueueItem;
  check('field order never counts as a difference', applyOutbox([reordered], outbox).settled.includes('ROM_8_1'));

  // Another device reviewed the same verse meanwhile, LATER than this one.
  const otherDevice = item('ROM_8_1', 0, {
    lastReviewDate: '2026-10-29T20:00:00.000Z',
    nextReviewDueDate: '2026-11-26T20:00:00.000Z',
    totalSuccessfulReviews: 2,
    reviewLogs: [log('2026-10-01T12:00:00.000Z'), log('2026-10-29T20:00:00.000Z')],
  });
  const c = applyOutbox([otherDevice], outbox);
  const merged = c.queue[0];
  check('both devices’ reviews are kept', (merged.reviewLogs ?? []).length === 3, merged.reviewLogs);
  check('the step comes from the most recent review (the other device)', merged.nextReviewDueDate === otherDevice.nextReviewDueDate);
  check('merged logs stay oldest first', (merged.reviewLogs ?? []).map((l) => l.at).join() === [...(merged.reviewLogs ?? [])].map((l) => l.at).sort().join());

  // This device's review is the newer one.
  const olderOther = item('ROM_8_1', 0, {
    lastReviewDate: '2026-10-28T09:00:00.000Z',
    nextReviewDueDate: '2026-11-04T09:00:00.000Z',
    reviewLogs: [log('2026-10-01T12:00:00.000Z'), log('2026-10-28T09:00:00.000Z', 'miss')],
  });
  const d = applyOutbox([olderOther], outbox);
  check('when this device reviewed last, its step wins', d.queue[0].nextReviewDueDate === reviewedOffline.nextReviewDueDate);
  check('...and the other device’s miss is still in the history', (d.queue[0].reviewLogs ?? []).some((l) => l.result === 'miss'));

  // Added offline, never reached Firestore.
  const added = item('ROM_8_9', 9, { status: 'queued' });
  const e = applyOutbox([server], { ROM_8_9: { item: added, json: json(added), base: null } });
  check('a verse added offline comes back', e.queue.some((q) => q.verseId === 'ROM_8_9'));
  check('...in its place in the order', e.queue.map((q) => q.verseId).join() === 'ROM_8_1,ROM_8_9');

  // Changed offline here, deleted on another device meanwhile.
  const f = applyOutbox([], outbox);
  check('a verse deleted elsewhere stays deleted', f.queue.length === 0 && f.settled.includes('ROM_8_1'));

  // Deleted offline here.
  const g = applyOutbox([server], { ROM_8_1: { item: null, json: null, base: json(server) } });
  check('a verse deleted offline is taken out', g.queue.length === 0);
  check('...and handed back to be deleted in Firestore', g.deleteIds.join() === 'ROM_8_1');
  check('a delete Firestore already has is settled', applyOutbox([], { ROM_8_1: { item: null, json: null, base: null } }).settled.join() === 'ROM_8_1');

  const untouched = item('ROM_8_5', 4);
  check('verses not on the list are left exactly as loaded', applyOutbox([server, untouched], outbox).queue[1] === untouched);
  check('an empty list changes nothing', applyOutbox([server], EMPTY_OUTBOX).queue[0] === server);
}

console.log('queueOutbox — mergeVerse');
{
  const touch = (timestamp: string) => ({ timestamp, drillType: 'speak' as const });
  const s = item('X', 0, { status: 'learning', touchLogs: [touch('2026-10-27T10:00:00.000Z')] });
  const l = item('X', 0, { status: 'learning', touchLogs: [touch('2026-10-27T10:00:00.000Z'), touch('2026-10-28T10:00:00.000Z')] });
  const m = mergeVerse(s, l);
  check('shared logs are not doubled', (m.touchLogs ?? []).length === 2, m.touchLogs);
  check('a tie in timing goes to this device', mergeVerse(item('X', 0, { text: 'server' }), item('X', 0, { text: 'local' })).text === 'local');
  check('no logs on either side stays no logs', mergeVerse(item('X', 0), item('X', 0)).reviewLogs === undefined);
}

console.log(failures === 0 ? '\ncheck:outbox — all assertions passed.' : `\ncheck:outbox — ${failures} FAILED.`);
if (failures > 0) process.exit(1);
