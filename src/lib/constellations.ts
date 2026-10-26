import type { Constellation, Echo, QueueItem, StarRef, VerseLink } from '../types';
import { STAGE_ORDER, VerseStage, verseStage } from './stageProgress';

// ============================================================================
// CONSTELLATION MAP -- the rules behind the stars
// ----------------------------------------------------------------------------
// CONSTELLATION_PLAN.md, stage 1. A star is a run of verses in one chapter. It
// lights up when the user holds any verse in it; its ring is the stage of its
// least advanced held verse; a verse in several translations counts at its
// furthest stage. Pure: no React, no Firestore. Tested by constellations.check.ts.
// ============================================================================

const rank = (stage: VerseStage): number => STAGE_ORDER.indexOf(stage);

/** A star counts as learned, and its lines can be labeled, from this stage on. */
export const LEARNED_STAGE: VerseStage = 'daily';

/** Key and lookup id of a star: book|chapter|start-end. */
export const starKey = (r: StarRef): string => `${r.book}|${r.chapter}|${r.start}-${r.end}`;

/** The two stars share a verse. */
export const refsOverlap = (a: StarRef, b: StarRef): boolean =>
  a.book === b.book && a.chapter === b.chapter && a.start <= b.end && b.start <= a.end;

/** Furthest stage rank per verse number of this star, for verses past waiting. */
function heldRanks(ref: StarRef, queue: QueueItem[]): Map<number, number> {
  const held = new Map<number, number>();
  for (const q of queue) {
    if (q.book !== ref.book || q.chapter !== ref.chapter) continue;
    if (q.verseNumber < ref.start || q.verseNumber > ref.end) continue;
    const r = rank(verseStage(q));
    if (r <= rank('waiting')) continue;
    held.set(q.verseNumber, Math.max(held.get(q.verseNumber) ?? -1, r));
  }
  return held;
}

/** The star's stage: its least advanced held verse. Null when it holds none. */
export function starStage(ref: StarRef, queue: QueueItem[]): VerseStage | null {
  const held = heldRanks(ref, queue);
  if (held.size === 0) return null;
  return STAGE_ORDER[Math.min(...held.values())];
}

/** The star lights up when the user holds any verse in it. */
export const starLit = (ref: StarRef, queue: QueueItem[]): boolean => heldRanks(ref, queue).size > 0;

/** Learned = every verse of the star is held and past Learning (Daily or later). */
export function isLearned(ref: StarRef, queue: QueueItem[]): boolean {
  const held = heldRanks(ref, queue);
  if (held.size < ref.end - ref.start + 1) return false;
  return Math.min(...held.values()) >= rank(LEARNED_STAGE);
}

/** A line's label can be written once both of its ends are learned. */
export const canLabel = (link: Pick<VerseLink, 'a' | 'b'>, queue: QueueItem[]): boolean =>
  isLearned(link.a, queue) && isLearned(link.b, queue);

/**
 * Curated stars worth suggesting: not held yet, with a line coming in from a
 * star at Daily or later. Returns star ids.
 */
export function suggestedNext(c: Constellation, queue: QueueItem[]): string[] {
  const byId = new Map(c.stars.map((s) => [s.id, s]));
  const out = new Set<string>();
  for (const line of c.lines) {
    const from = byId.get(line.from);
    const to = byId.get(line.to);
    if (!from || !to || starLit(to.ref, queue)) continue;
    const stage = starStage(from.ref, queue);
    if (stage && rank(stage) >= rank(LEARNED_STAGE)) out.add(to.id);
  }
  return c.stars.filter((s) => out.has(s.id)).map((s) => s.id);
}

export interface UserConstellation {
  /** The smallest star key in the group. */
  id: string;
  stars: StarRef[];
  links: VerseLink[];
}

/**
 * The user's own constellations: every group of stars joined by their links
 * (curated-line labels don't join anything). Biggest first, then by id.
 */
export function userConstellations(links: VerseLink[]): UserConstellation[] {
  const own = links.filter((l) => !l.curated);
  const refs = new Map<string, StarRef>();
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(k, root);
    return root;
  };
  for (const l of own) {
    for (const r of [l.a, l.b]) {
      const k = starKey(r);
      if (!refs.has(k)) {
        refs.set(k, r);
        parent.set(k, k);
      }
    }
    const ra = find(starKey(l.a));
    const rb = find(starKey(l.b));
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, UserConstellation>();
  for (const [k, r] of refs) {
    const root = find(k);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = { id: '', stars: [], links: [] }));
    g.stars.push(r);
  }
  for (const l of own) groups.get(find(starKey(l.a)))?.links.push(l);
  const out = [...groups.values()];
  for (const g of out) {
    g.stars.sort((a, b) => (starKey(a) < starKey(b) ? -1 : 1));
    g.id = starKey(g.stars[0]);
  }
  return out.sort((a, b) => b.stars.length - a.stars.length || (a.id < b.id ? -1 : 1));
}

/** The echoes that touch this star at either end, from a given list (src/content/echoes.json). */
export const echoesFor = (ref: StarRef, echoes: Echo[]): Echo[] =>
  echoes.filter((e) => refsOverlap(e.nt, ref) || refsOverlap(e.ot, ref));

/** Once the user holds both ends, the echo is found and shows for good. */
export const echoVisible = (echo: Echo, queue: QueueItem[]): boolean => starLit(echo.nt, queue) && starLit(echo.ot, queue);
