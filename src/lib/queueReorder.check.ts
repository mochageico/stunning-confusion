// Regression assertions for queue reordering, run by `npm run check:queue`.
//
// These exist because of a real data-loss incident: the queue screen's reorder
// buttons rebuilt the queue from a FILTERED view (queued/learning only), so a
// single tap dropped every reviewing/retained verse from state, and the
// memoryQueue auto-sync -- which inferred deletions from state shrinkage --
// deleted those documents from Firestore. A user lost their entire review
// history to one arrow press.
//
// The first assertion below is the one that would have caught it.

import { QueueItem } from '../types';
import { reorderQueueGroups } from './queueReorder';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

function item(verseId: string, orderIndex: number, status: QueueItem['status']): QueueItem {
  return {
    verseId,
    translationId: 'ESV',
    book: 'Romans',
    chapter: 8,
    verseNumber: orderIndex + 1,
    text: 'test',
    orderIndex,
    status,
    retentionPhase: status === 'reviewing' ? 'weekly' : 'none',
    dateStarted: null,
    lastReviewDate: null,
    nextReviewDueDate: null,
    currentStreakCount: 0,
    totalSuccessfulReviews: 0,
    gracePeriodUsedToday: false,
  };
}

// A realistic queue: two visible (queued/learning) verses the user can
// reorder, and three that are invisible on the queue screen -- the ones that
// got destroyed.
const queue: QueueItem[] = [
  item('vis-a', 0, 'queued'),
  item('hidden-1', 1, 'reviewing'),
  item('vis-b', 2, 'learning'),
  item('hidden-2', 3, 'reviewing'),
  item('hidden-3', 4, 'retained'),
];

const visibleGroups = [{ items: [queue[0]] }, { items: [queue[2]] }];

console.log('queueReorder — membership invariants');

{
  const result = reorderQueueGroups(queue, visibleGroups, 0, 1);

  check('reordering never changes queue LENGTH', result.length === queue.length, {
    before: queue.length,
    after: result.length,
  });

  const survived = (id: string) => result.some((i) => i.verseId === id);
  check('reviewing verses survive a reorder', survived('hidden-1') && survived('hidden-2'), result.map((i) => i.verseId));
  check('retained verses survive a reorder', survived('hidden-3'), result.map((i) => i.verseId));

  check(
    'hidden verses keep their status and phase',
    result.find((i) => i.verseId === 'hidden-1')?.status === 'reviewing' &&
      result.find((i) => i.verseId === 'hidden-1')?.retentionPhase === 'weekly'
  );

  // The actual reorder still has to work.
  const a = result.find((i) => i.verseId === 'vis-a')!;
  const b = result.find((i) => i.verseId === 'vis-b')!;
  check('the two visible verses swapped order', b.orderIndex < a.orderIndex, {
    'vis-a': a.orderIndex,
    'vis-b': b.orderIndex,
  });

  check(
    'hidden verses keep their original orderIndex',
    result.find((i) => i.verseId === 'hidden-1')?.orderIndex === 1 &&
      result.find((i) => i.verseId === 'hidden-2')?.orderIndex === 3
  );
}

{
  // Out-of-range and no-op moves must be inert, not destructive.
  check('a no-op move returns the queue unchanged', reorderQueueGroups(queue, visibleGroups, 0, 0).length === 5);
  check('an out-of-range move returns the queue unchanged', reorderQueueGroups(queue, visibleGroups, 0, 9).length === 5);
  check('moving up from the top is inert', reorderQueueGroups(queue, visibleGroups, 0, -1).length === 5);
}

// ---------------------------------------------------------------------------
// MOVE, not SWAP.
//
// The screen used to offer only up/down arrows, so `from` and `to` were always
// adjacent and a swap was indistinguishable from a move. The list is
// drag-ordered now, and a non-adjacent drag exposes the difference: dragging A
// to index 2 must yield [B, C, A], not [C, B, A].
// ---------------------------------------------------------------------------
console.log('\nqueueReorder — move semantics (non-adjacent drags)');
{
  const four: QueueItem[] = [
    item('A', 0, 'queued'),
    item('B', 1, 'queued'),
    item('C', 2, 'queued'),
    item('D', 3, 'queued'),
  ];
  const groups = four.map((i) => ({ items: [i] }));
  const orderOf = (result: QueueItem[]) =>
    result
      .slice()
      .sort((x, y) => x.orderIndex - y.orderIndex)
      .map((i) => i.verseId)
      .join('');

  check('drag first to third gives BCAD (not CBAD)', orderOf(reorderQueueGroups(four, groups, 0, 2)) === 'BCAD', {
    got: orderOf(reorderQueueGroups(four, groups, 0, 2)),
  });
  check('drag last to first gives DABC (not DBCA)', orderOf(reorderQueueGroups(four, groups, 3, 0)) === 'DABC', {
    got: orderOf(reorderQueueGroups(four, groups, 3, 0)),
  });
  check('an adjacent drag still behaves like the old arrows', orderOf(reorderQueueGroups(four, groups, 0, 1)) === 'BACD', {
    got: orderOf(reorderQueueGroups(four, groups, 0, 1)),
  });
  check(
    'a multi-verse group moves as one unit',
    (() => {
      const q = [item('a1', 0, 'queued'), item('a2', 1, 'queued'), item('b1', 2, 'queued'), item('c1', 3, 'queued')];
      const g = [{ items: [q[0], q[1]] }, { items: [q[2]] }, { items: [q[3]] }];
      return orderOf(reorderQueueGroups(q, g, 0, 2)) === 'b1c1a1a2';
    })()
  );
}

// ---------------------------------------------------------------------------
// END TO END: reorder must survive being re-derived the way the screen does.
//
// reorderQueueGroups rewrites orderIndex but maps over the queue IN PLACE, so
// the array's own order never changes. ActivePlanScreen used to group straight
// off that array, which meant a reorder rebuilt the identical list and the
// dragged row snapped back to where it started -- the reorder looked like it
// did nothing, because visually it did nothing.
//
// This replicates the screen's derivation (sort by orderIndex -> filter to the
// visible statuses -> group) and asserts the NEW order actually comes out. It
// fails if either half regresses: the orderIndex math, or the sort.
// ---------------------------------------------------------------------------
console.log('\nqueueReorder — survives the screen\'s re-derivation');
{
  // Array order deliberately != orderIndex order, which is the state every
  // reorder leaves behind.
  const q: QueueItem[] = [
    item('gen', 2, 'queued'),
    item('rom', 1, 'queued'),
    item('john', 0, 'learning'),
    item('psalm', 3, 'reviewing'),
  ];

  const derive = (queue: QueueItem[]) =>
    [...queue]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .filter((i) => i.status === 'queued' || i.status === 'learning')
      .map((i) => ({ items: [i] }));

  const visibleIds = (queue: QueueItem[]) => derive(queue).map((g) => g.items[0].verseId).join('>');

  check('derivation follows orderIndex, not array position', visibleIds(q) === 'john>rom>gen', { got: visibleIds(q) });

  // Drag the first visible row (john) down to the third slot.
  const after = reorderQueueGroups(q, derive(q), 0, 2);
  check('a reorder is still visible after re-deriving', visibleIds(after) === 'rom>gen>john', { got: visibleIds(after) });
  check('the hidden reviewing verse is untouched', after.find((i) => i.verseId === 'psalm')?.orderIndex === 3);
  check('nothing was added or lost', after.length === 4);

  // And it must be stable: re-deriving twice cannot drift.
  check('re-deriving again is stable', visibleIds(reorderQueueGroups(after, derive(after), 0, 0)) === 'rom>gen>john');
}

console.log(failures === 0 ? '\ncheck:queue — all assertions passed.' : `\ncheck:queue — ${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
