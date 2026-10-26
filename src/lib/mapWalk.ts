import type { QueueItem, StarRef } from '../types';
import { starLit } from './constellations';

// ============================================================================
// WALK THE CONSTELLATION -- the rules
// ----------------------------------------------------------------------------
// CONSTELLATION_PLAN.md, stage 6. The user starts at a star and follows the
// lines: each next star shows as a blank circle in its place on the map (the
// cue is where it sits, not text) and they recite what's there. Pure: the
// screen is components/map/WalkConstellation.tsx. Tested by
// constellations.check.ts.
//
// Only stars the user holds are walked to. A star they don't hold is passed
// through (the lines carry on beyond it) but never asked for.
//
// Credit follows Pick up the thread: due-gated, misses never penalize, a
// self-check is self-reported and never perfect.
// ============================================================================

/** The part of the map's layout the walk needs: stars by key and the lines between them. */
export interface WalkGraph {
  keys: string[];
  lines: { from: string; to: string }[];
}

/**
 * The order to walk in, from `start`: depth first along the lines (either
 * direction), taking neighbors in key order so the same map always walks the
 * same way. Returns held stars only, without the start itself; unheld stars
 * are crossed but not listed. `held` says which star keys the user holds.
 */
export function walkOrder(graph: WalkGraph, start: string, held: (key: string) => boolean): string[] {
  const next = new Map<string, string[]>();
  for (const k of graph.keys) next.set(k, []);
  for (const l of graph.lines) {
    next.get(l.from)?.push(l.to);
    next.get(l.to)?.push(l.from);
  }
  for (const list of next.values()) list.sort();
  const seen = new Set<string>([start]);
  const out: string[] = [];
  const visit = (key: string) => {
    for (const n of next.get(key) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      if (held(n)) out.push(n);
      visit(n);
    }
  };
  visit(start);
  return out;
}

/** A verse of a star the user holds, with the item that would be credited. */
export interface WalkVerse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  translationId: string;
  item: QueueItem;
}

/**
 * The verses of a star the user holds, in verse order, one per verse number.
 * A verse held in two translations is said in the one further along (a review
 * schedule beats Learning), and the first one found breaks a tie.
 */
export function starVerses(ref: StarRef, queue: QueueItem[]): WalkVerse[] {
  const rank = (q: QueueItem) => (q.status === 'reviewing' ? 2 : q.status === 'learning' ? 1 : 0);
  const best = new Map<number, QueueItem>();
  for (const q of queue) {
    if (q.status === 'queued' || q.book !== ref.book || q.chapter !== ref.chapter) continue;
    if (q.verseNumber < ref.start || q.verseNumber > ref.end) continue;
    const cur = best.get(q.verseNumber);
    if (!cur || rank(q) > rank(cur)) best.set(q.verseNumber, q);
  }
  return [...best.values()]
    .sort((a, b) => a.verseNumber - b.verseNumber)
    .map((q) => ({ book: q.book, chapter: q.chapter, verse: q.verseNumber, text: q.text, translationId: q.translationId || 'ESV', item: q }));
}

export const starHeld = (ref: StarRef, queue: QueueItem[]): boolean => starLit(ref, queue);

export type WalkCredit = 'review' | 'touch' | null;

/**
 * What one verse in a walked star earns. A review only when the verse is on a
 * schedule and due (a not-due verse is practice, so it never moves on); a
 * learning verse banks a touch only with every word right and graded, never
 * self-checked. A miss earns nothing and costs nothing.
 */
export function walkCredit(
  item: QueueItem,
  r: {
    /** The format counts (Settings: Counts or Practice). */
    counts: boolean;
    passed: boolean;
    perfect: boolean;
    mode: 'speak' | 'type' | 'self';
    paused: boolean;
    due: boolean;
    /** validateTouch: no other touch in the last hour. */
    touchOk: boolean;
    alreadyCounted: boolean;
  }
): { kind: WalkCredit; label: string } {
  if (!r.counts) return { kind: null, label: 'Set to practice, so not counted' };
  if (!r.passed) return { kind: null, label: 'Under the pass mark, so no credit and no penalty' };
  if (r.alreadyCounted) return { kind: null, label: 'Already counted this walk' };
  if (item.status === 'learning') {
    if (r.mode === 'self') return { kind: null, label: 'Learning a verse needs it graded, not self-checked' };
    if (!r.perfect) return { kind: null, label: 'Learning a verse needs every word right' };
    if (!r.touchOk) return { kind: null, label: 'Counted toward learning within the last hour' };
    return { kind: 'touch', label: 'Counts toward learning' };
  }
  if (item.status === 'reviewing') {
    if (r.paused) return { kind: null, label: 'Reviews are paused, so practice only' };
    if (!r.due) return { kind: null, label: 'Not due yet, so practice only' };
    return { kind: 'review', label: r.mode === 'self' ? 'Counts as a review, checked by you' : 'Counts as a review' };
  }
  return { kind: null, label: 'Complete, so practice only' };
}
