// ============================================================================
// RECITE ORDER
// ----------------------------------------------------------------------------
// Recall's words keep one index each, in passage order (verse 1's words, then
// verse 2's...): outcomes, the hidden-word sample and the memory grid are all
// keyed by it, and so is what gets credited. The recite pointer instead walks
// a *position* in the order the user says the words. Forward, position and
// index are the same number. "Last to first" (MIXED_REVIEW_PLAN.md) runs the
// verses in reverse with each verse still said forward, so position 0 is the
// last verse's first word. These helpers are the only place that translates
// between the two, so a reversed run can't grade or credit the wrong verse.
// ============================================================================

export interface ReciteOrder {
  /** Verse indices in the order they're recited. */
  verseOrder: number[];
  /** position -> word index (passage order). */
  order: number[];
  /** word index -> position. */
  posOf: number[];
}

/** `wordVerse[i]` is the verse index of word i, in passage order. */
export function buildReciteOrder(wordVerse: number[], verseCount: number, lastToFirst: boolean): ReciteOrder {
  const verseOrder = Array.from({ length: verseCount }, (_, i) => i);
  if (lastToFirst) verseOrder.reverse();
  const byVerse: number[][] = verseOrder.map(() => []);
  wordVerse.forEach((v, i) => {
    if (byVerse[v]) byVerse[v].push(i);
  });
  const order = verseOrder.flatMap((v) => byVerse[v]);
  const posOf: number[] = new Array(wordVerse.length);
  order.forEach((wordIdx, pos) => {
    posOf[wordIdx] = pos;
  });
  return { verseOrder, order, posOf };
}

/** The position where the verse being recited at `pos` starts (a strike reset goes back here). */
export function verseStartPosition(ro: ReciteOrder, wordVerse: number[], pos: number): number {
  const verse = wordVerse[ro.order[pos]];
  return ro.order.findIndex((w) => wordVerse[w] === verse);
}

/** Re-keys a speech patch's outcomes from positions to word indices. */
export function positionsToWords<T>(ro: ReciteOrder, byPos: Record<number, T>): Record<number, T> {
  const out: Record<number, T> = {};
  for (const key of Object.keys(byPos)) {
    const wordIdx = ro.order[Number(key)];
    if (wordIdx !== undefined) out[wordIdx] = byPos[Number(key)];
  }
  return out;
}
