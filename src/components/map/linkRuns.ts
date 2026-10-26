import type { QueueItem, StarRef } from '../../types';
import { STAGE_ORDER, verseStage } from '../../lib/stageProgress';
import { starLabel } from '../../lib/mapLayout';

// ============================================================================
// Runs of held verses -- what a link can join.
// A link joins two ranges. The default range is the unbroken run of verses the
// user holds around the one they tapped; they can trim it. "Held" means past
// Waiting, same as everywhere on the map.
// ============================================================================

export interface Run {
  book: string;
  chapter: number;
  /** The whole unbroken run of held verses. */
  start: number;
  end: number;
  /** Verse text from the queue, for searching and a one-line preview. */
  text: string;
  /** When the newest verse in the run was started; for "recent". */
  recent: number;
}

const held = (q: QueueItem) => STAGE_ORDER.indexOf(verseStage(q)) > STAGE_ORDER.indexOf('waiting');

/** Every unbroken run of held verses in the queue, newest first. */
export function heldRuns(queue: QueueItem[]): Run[] {
  const chapters = new Map<string, Map<number, QueueItem>>();
  for (const q of queue) {
    if (!held(q)) continue;
    const key = `${q.book}|${q.chapter}`;
    let verses = chapters.get(key);
    if (!verses) chapters.set(key, (verses = new Map()));
    const have = verses.get(q.verseNumber);
    if (!have || (q.dateStarted ?? '') > (have.dateStarted ?? '')) verses.set(q.verseNumber, q);
  }
  const runs: Run[] = [];
  for (const [key, verses] of chapters) {
    const [book, chapter] = key.split('|');
    const nums = [...verses.keys()].sort((a, b) => a - b);
    let from = 0;
    for (let i = 1; i <= nums.length; i++) {
      if (i < nums.length && nums[i] === nums[i - 1] + 1) continue;
      const slice = nums.slice(from, i);
      from = i;
      const items = slice.map((n) => verses.get(n) as QueueItem);
      runs.push({
        book,
        chapter: Number(chapter),
        start: slice[0],
        end: slice[slice.length - 1],
        text: items.map((q) => q.text).join(' '),
        recent: Math.max(...items.map((q) => (q.dateStarted ? Date.parse(q.dateStarted) || 0 : 0))),
      });
    }
  }
  return runs.sort((a, b) => b.recent - a.recent || (a.book + a.chapter + a.start < b.book + b.chapter + b.start ? -1 : 1));
}

/** The unbroken run holding this verse, or null when it isn't held. */
export const runAround = (runs: Run[], book: string, chapter: number, verse: number): Run | null =>
  runs.find((r) => r.book === book && r.chapter === chapter && r.start <= verse && verse <= r.end) ?? null;

/** The run a star sits in: around its first held verse. Null when it holds none. */
export function runForRef(runs: Run[], ref: StarRef): Run | null {
  for (let v = ref.start; v <= ref.end; v++) {
    const r = runAround(runs, ref.book, ref.chapter, v);
    if (r) return r;
  }
  return null;
}

export const runRef = (r: Run): StarRef => ({ book: r.book, chapter: r.chapter, start: r.start, end: r.end });

/** `ref` kept inside `run`. */
export const clampToRun = (ref: StarRef, run: Run): StarRef => ({
  book: run.book,
  chapter: run.chapter,
  start: Math.max(run.start, ref.start),
  end: Math.min(run.end, ref.end),
});

export const runLabel = (r: Run): string => starLabel(runRef(r));
