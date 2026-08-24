import { QueueItem } from '../types';

// ============================================================================
// QUEUE REORDER — pure logic, extracted so it can be tested standalone.
// ----------------------------------------------------------------------------
// The queue screen shows a FILTERED view of the queue (queued/learning only;
// reviewing and retained verses live on the Memory Calendar). Reordering
// within that view previously rebuilt the whole queue from the filtered list,
// which dropped every reviewing/retained verse from state -- and the memory
// queue auto-sync, which inferred deletions from state shrinkage, then deleted
// those documents from Firestore. One tap on a reorder arrow permanently
// destroyed a user's entire review history.
//
// The invariant this module exists to hold: reordering NEVER changes queue
// membership. It only permutes orderIndex among the items being reordered.
// ============================================================================

/**
 * Moves the visible group at `from` to `to`, returning a new full queue.
 *
 * `visibleGroups` is the on-screen (filtered, grouped) view. Every item not in
 * that view is carried through untouched. The reordered items reuse the
 * orderIndex slots they already occupied, so nothing outside the visible set
 * shifts position.
 *
 * This MOVES (remove-then-insert); it does not swap the two positions. The
 * difference is invisible for an adjacent move and wrong for any other: the
 * screen used to offer only up/down arrow buttons, where from and to always
 * differ by one and a swap is indistinguishable from a move. Now that the
 * list is drag-ordered, dragging the first group to the third position must
 * leave the groups it passed in their existing relative order -- a swap would
 * additionally reverse them.
 */
export function reorderQueueGroups(
  queue: QueueItem[],
  visibleGroups: { items: QueueItem[] }[],
  from: number,
  to: number
): QueueItem[] {
  if (from === to || from < 0 || to < 0 || from >= visibleGroups.length || to >= visibleGroups.length) {
    return queue;
  }

  const reordered = [...visibleGroups];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);

  const orderedVisibleIds = reordered.flatMap((g) => g.items.map((item) => item.verseId));
  const visibleIdSet = new Set(orderedVisibleIds);

  const slots = queue
    .filter((item) => visibleIdSet.has(item.verseId))
    .map((item) => item.orderIndex)
    .sort((a, b) => a - b);

  const newIndexById = new Map<string, number>();
  orderedVisibleIds.forEach((id, i) => newIndexById.set(id, slots[i]));

  return queue.map((item) =>
    newIndexById.has(item.verseId) ? { ...item, orderIndex: newIndexById.get(item.verseId)! } : item
  );
}
