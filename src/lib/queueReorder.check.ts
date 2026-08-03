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

console.log(failures === 0 ? '\ncheck:queue — all assertions passed.' : `\ncheck:queue — ${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
