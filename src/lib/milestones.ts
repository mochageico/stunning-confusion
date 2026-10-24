import type { QueueItem, ReviewLog } from '../types';
import { verseStage } from './stageProgress';

// ============================================================================
// LANDMARKS: BOOKS OF THE BIBLE, COUNTED IN VERSES HELD
// ----------------------------------------------------------------------------
// The only milestone kind: how many verses you hold, set against how long each
// book of the Bible is. "You hold more verses than Ruth. Next: Philippians,
// 19 to go." No points, no streaks, nothing that can go backwards loudly.
//
//   - Verses held = verses past Learning (Daily, Weekly, Monthly, Complete),
//     the same stage words as My Verses (verseStage). A verse in two
//     translations counts once.
//   - The ladder is the books sorted by length. Pure on a plain number, so a
//     circle's combined count can use ladderPosition() unchanged.
//   - Each landmark's date is the day your Nth verse first left Learning,
//     worked out from the review logs, so it never needs storing.
//
// Verse counts are the standard Protestant versification (KJV/ESV/BSB), the
// numbering every translation in the app uses. The check adds them up
// (23,145 Old Testament + 7,957 New Testament = 31,102).
// ============================================================================

/** [book, verses] in canonical order, Genesis to Revelation. */
export const BOOK_VERSES: ReadonlyArray<readonly [string, number]> = [
  ['Genesis', 1533], ['Exodus', 1213], ['Leviticus', 859], ['Numbers', 1288], ['Deuteronomy', 959],
  ['Joshua', 658], ['Judges', 618], ['Ruth', 85], ['1 Samuel', 810], ['2 Samuel', 695],
  ['1 Kings', 816], ['2 Kings', 719], ['1 Chronicles', 942], ['2 Chronicles', 822], ['Ezra', 280],
  ['Nehemiah', 406], ['Esther', 167], ['Job', 1070], ['Psalms', 2461], ['Proverbs', 915],
  ['Ecclesiastes', 222], ['Song of Solomon', 117], ['Isaiah', 1292], ['Jeremiah', 1364], ['Lamentations', 154],
  ['Ezekiel', 1273], ['Daniel', 357], ['Hosea', 197], ['Joel', 73], ['Amos', 146],
  ['Obadiah', 21], ['Jonah', 48], ['Micah', 105], ['Nahum', 47], ['Habakkuk', 56],
  ['Zephaniah', 53], ['Haggai', 38], ['Zechariah', 211], ['Malachi', 55],
  ['Matthew', 1071], ['Mark', 678], ['Luke', 1151], ['John', 879], ['Acts', 1007],
  ['Romans', 433], ['1 Corinthians', 437], ['2 Corinthians', 257], ['Galatians', 149], ['Ephesians', 155],
  ['Philippians', 104], ['Colossians', 95], ['1 Thessalonians', 89], ['2 Thessalonians', 47], ['1 Timothy', 113],
  ['2 Timothy', 83], ['Titus', 46], ['Philemon', 25], ['Hebrews', 303], ['James', 108],
  ['1 Peter', 105], ['2 Peter', 61], ['1 John', 105], ['2 John', 13], ['3 John', 14],
  ['Jude', 25], ['Revelation', 404],
];

export interface Landmark {
  book: string;
  /** How many verses the book has. Pass it by holding more than this. */
  verses: number;
}

/** Shortest book first; books of the same length stay in Bible order. */
export const LANDMARKS: readonly Landmark[] = BOOK_VERSES.map(([book, verses], i) => ({ book, verses, i }))
  .sort((a, b) => a.verses - b.verses || a.i - b.i)
  .map(({ book, verses }) => ({ book, verses }));

// ----------------------------------------------------------------------------
// Where a count sits on the ladder
// ----------------------------------------------------------------------------

export interface LadderPosition {
  held: number;
  /** The longest book you hold more verses than; null before the first. */
  passed: Landmark | null;
  /** The next book up; null once you are past the longest (Psalms). */
  next: Landmark | null;
  /** Verses to hold more than `next`: one past its length, minus what you hold. */
  toGo: number;
}

/** Pure on a number so a circle's combined count can use it as it is. */
export function ladderPosition(held: number): LadderPosition {
  const n = Math.max(0, Math.floor(held));
  let passed: Landmark | null = null;
  let next: Landmark | null = null;
  for (const l of LANDMARKS) {
    if (n > l.verses) passed = l;
    else {
      next = l;
      break;
    }
  }
  return { held: n, passed, next, toGo: next ? next.verses + 1 - n : 0 };
}

/** Every landmark passed at this count, shortest first. */
export const passedLandmarks = (held: number): Landmark[] => LANDMARKS.filter((l) => Math.floor(held) > l.verses);

/** "You hold more verses than the book of Ruth." (null before the first landmark.) */
export const heldLine = (pos: LadderPosition, who: 'You' | 'Together you' = 'You'): string | null =>
  pos.passed ? `${who} hold more verses than the book of ${pos.passed.book}.` : null;

/** "Next: Philippians, 19 to go" (null once past the longest book). */
export const nextLine = (pos: LadderPosition): string | null => (pos.next ? `Next: ${pos.next.book}, ${pos.toGo} to go` : null);

/** The held line alone, for My Verses (empty before the first landmark). */
export function landmarkText(pos: LadderPosition): string {
  return heldLine(pos) ?? '';
}

// ----------------------------------------------------------------------------
// Verses held, and the day each one first left Learning
// ----------------------------------------------------------------------------

const slot = (q: QueueItem) => `${q.book}|${q.chapter}|${q.verseNumber}`;
const isHeld = (q: QueueItem) => {
  const s = verseStage(q);
  return s !== 'waiting' && s !== 'learning';
};

/** Verses past Learning, a verse in two translations counted once. */
export function versesHeld(queue: QueueItem[]): number {
  return new Set(queue.filter(isHeld).map(slot)).size;
}

/**
 * When one verse first left Learning (ISO), or null if its history doesn't say.
 *
 * The engine logs the last Learning practice as a pass in stage 'learning' and
 * only then moves the verse on, so that log is the day it left; a hand
 * placement is logged in the stage it moved to. A verse that has been
 * reviewed but kept no Learning log (older data) falls back to its first
 * review, then to the day it was last practiced.
 */
export function leftLearningAt(item: QueueItem): string | null {
  const logs = [...(item.reviewLogs ?? [])].sort((a: ReviewLog, b: ReviewLog) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const firstBeyond = logs.findIndex((l) => l.stage !== 'learning');
  if (firstBeyond >= 0) {
    const entry = logs[firstBeyond];
    if (entry.result === 'placed') return entry.at;
    for (let i = firstBeyond - 1; i >= 0; i--) if (logs[i].result === 'pass') return logs[i].at;
    return entry.at;
  }
  for (let i = logs.length - 1; i >= 0; i--) if (logs[i].result === 'pass') return logs[i].at;
  return item.lastReviewDate ?? item.dateStarted ?? null;
}

/**
 * The days the verses you hold left Learning, oldest first. `null` is a verse
 * with no date to go on; it sorts first (it is older than anything with one).
 */
export function heldDates(queue: QueueItem[]): (string | null)[] {
  const bySlot = new Map<string, string | null>();
  for (const q of queue) {
    if (!isHeld(q)) continue;
    const at = leftLearningAt(q);
    const key = slot(q);
    if (!bySlot.has(key)) bySlot.set(key, at);
    else {
      const have = bySlot.get(key) ?? null;
      // The earlier copy is when the verse first left Learning.
      if (have === null || at === null) bySlot.set(key, null);
      else if (at < have) bySlot.set(key, at);
    }
  }
  return [...bySlot.values()].sort((a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1));
}

export interface LandmarkPassed {
  landmark: Landmark;
  /** ISO time your (length + 1)th verse left Learning; null if undated. */
  at: string | null;
}

/** Each landmark passed so far with the day it was passed, shortest first. */
export function landmarkDates(dates: (string | null)[]): LandmarkPassed[] {
  return passedLandmarks(dates.length).map((landmark) => ({ landmark, at: dates[landmark.verses] }));
}
