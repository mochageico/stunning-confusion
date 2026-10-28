// What Today's ladder cards say (REVIEW_LADDER_PLAN.md stage 7): the welcome
// back spread, the firm-up item and the late note on a row. Pure: the
// engine's data in, short lines out.
import type { QueueItem } from '../types';
import { firmUpsFor, type SpreadDay } from './passages';
import { passageLabel, type LateNote } from './ladderEngine';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Tomorrow", or "Thursday, Oct 29" for a day key (YYYY-MM-DD) seen on `todayKey`. */
export const dayLabel = (dayKey: string, todayKey: string): string => {
  if (dayKey === todayKey) return 'Today';
  const d = new Date(`${dayKey}T12:00:00`);
  const t = new Date(`${todayKey}T12:00:00`);
  const gap = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (gap === 1) return 'Tomorrow';
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

export interface WelcomeBackLine {
  day: string;
  label: string;
  passages: number;
  verses: number;
}

export interface WelcomeBack {
  /** Verses spread in all. */
  verses: number;
  days: WelcomeBackLine[];
}

/** The welcome-back card's lines. null when nothing was spread. */
export const welcomeBack = (spread: readonly SpreadDay[], todayKey: string): WelcomeBack | null => {
  const days = spread
    .filter((d) => d.passages.length > 0)
    .map((d) => ({
      day: d.day,
      label: dayLabel(d.day, todayKey),
      passages: d.passages.length,
      verses: d.passages.reduce((n, p) => n + p.items.length, 0),
    }));
  if (days.length === 0) return null;
  return { verses: days.reduce((n, d) => n + d.verses, 0), days };
};

export interface FirmUpItem {
  /** "Romans 8:1–4". */
  title: string;
  /** The verses to say again, verse order. */
  verses: QueueItem[];
  /** "Verse 3 slipped last time." */
  line: string;
}

const numbersWord = (nums: readonly number[]): string =>
  nums.length === 1 ? `Verse ${nums[0]}` : `Verses ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;

/** Passages with a firm-up today: a short "win back a review" item each. */
export const firmUpItems = (queue: readonly QueueItem[], todayKey: string): FirmUpItem[] =>
  firmUpsFor(queue, todayKey).flatMap((p) => {
    const wanted = new Set(p.items[0].firmUp!.verses);
    const verses = p.items.filter((q) => wanted.has(q.verseNumber));
    if (verses.length === 0) return [];
    const nums = verses.map((q) => q.verseNumber);
    return [{ title: passageLabel(p), verses, line: `${numbersWord(nums)} slipped last time. Say ${nums.length === 1 ? 'it' : 'them'} clean to win the review back.` }];
  });

/** "Late: moved back 2 reviews" for a row whose verses were in a passage that fell back; null otherwise. */
export const lateNoteFor = (items: readonly QueueItem[], late: readonly LateNote[]): string | null => {
  const ids = new Set(items.map((q) => q.verseId));
  let moved = 0;
  for (const n of late) {
    if (!n.passage.items.some((q) => ids.has(q.verseId))) continue;
    moved = Math.max(moved, n.from - n.to);
  }
  return moved > 0 ? `Late: moved back ${moved} ${moved === 1 ? 'review' : 'reviews'}` : null;
};
