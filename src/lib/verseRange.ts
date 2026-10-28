import type { QueueItem } from '../types';

// Shared by Challenge and GroupChallenge: a book/chapter span, with an
// optional verse sub-range only meaningful when startChapter === endChapter
// (a range spanning multiple chapters always uses whole chapters, same
// simplification this app already makes for goal-style ranges elsewhere).
export type VerseRange = {
  book: string;
  startChapter: number;
  endChapter: number;
  startVerse?: number;
  endVerse?: number;
};

// Pure -- counts how many of `queue`'s items fall inside `range` and are
// learned: past Learning, so Settling or later ('reviewing' / 'retained').
// A verse still queued, in Learning, or waiting on today's reviews to lock in
// doesn't count yet.
export const countRangeProgress = (queue: QueueItem[], range: VerseRange): number =>
  queue.filter((item) => {
    if (item.book !== range.book) return false;
    if (item.chapter < range.startChapter || item.chapter > range.endChapter) return false;
    if (range.startChapter === range.endChapter && item.chapter === range.startChapter) {
      if (range.startVerse != null && item.verseNumber < range.startVerse) return false;
      if (range.endVerse != null && item.verseNumber > range.endVerse) return false;
    }
    return item.status === 'reviewing' || item.status === 'retained';
  }).length;
