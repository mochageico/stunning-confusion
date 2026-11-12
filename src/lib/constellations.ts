import type { Constellation, Echo, QueueItem, SkyState, StarRef, VerseLink } from '../types';
import { STAGE_ORDER, VerseStage, isTopStep, verseStage } from './stageProgress';

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
export const LEARNED_STAGE: VerseStage = 'settling';

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

/**
 * The star is at the top of the ladder (Every 6 months): every verse of it
 * the user holds is on the top step, so even its least advanced one is.
 */
export function starIsTop(ref: StarRef, queue: QueueItem[]): boolean {
  let any = false;
  for (const q of queue) {
    if (q.book !== ref.book || q.chapter !== ref.chapter) continue;
    if (q.verseNumber < ref.start || q.verseNumber > ref.end) continue;
    if (rank(verseStage(q)) <= rank('waiting')) continue;
    if (!isTopStep(q)) return false;
    any = true;
  }
  return any;
}

/** The star lights up when the user holds any verse in it. */
export const starLit = (ref: StarRef, queue: QueueItem[]): boolean => heldRanks(ref, queue).size > 0;

/** Learned = every verse of the star is held and past Learning (Settling or later). */
export function isLearned(ref: StarRef, queue: QueueItem[]): boolean {
  const held = heldRanks(ref, queue);
  if (held.size < ref.end - ref.start + 1) return false;
  return Math.min(...held.values()) >= rank(LEARNED_STAGE);
}

/** A line's label can be written once both of its ends are learned. */
export const canLabel = (link: Pick<VerseLink, 'a' | 'b'>, queue: QueueItem[]): boolean =>
  isLearned(link.a, queue) && isLearned(link.b, queue);

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

// ============================================================================
// CONSTELLATIONS 2 -- the mystery (CONSTELLATION_SKY_PLAN.md, stage 1)
// ----------------------------------------------------------------------------
// A constellation starts with only its starting star and the stars joined to
// it showing. Learning a verse (LEARNED_STAGE or later, `isLearned`) shows every
// star joined to it. A verse the user already holds shows at once. A star that
// has shown stays found forever (the saved `found` list), whatever happens to
// the verse afterward. Pure, like the rest of this file.
// ============================================================================

/** The starting star's id: `start`, else the first star. Empty string if there are no stars. */
export const startStarId = (c: Constellation): string => {
  if (c.start && c.stars.some((s) => s.id === c.start)) return c.start;
  return c.stars[0]?.id ?? '';
};

/** Ids of the stars joined to this one by a line, either direction, in the constellation's star order. */
export function joinedTo(c: Constellation, starId: string): string[] {
  const out = new Set<string>();
  for (const l of c.lines) {
    if (l.from === starId) out.add(l.to);
    else if (l.to === starId) out.add(l.from);
  }
  return c.stars.filter((s) => out.has(s.id)).map((s) => s.id);
}

/**
 * Star ids showing right now: the start, the stars joined to it, every star
 * the user holds, the stars joined to a learned star, and every star in `found`.
 */
export function revealedStars(c: Constellation, queue: QueueItem[], found: readonly string[] = []): Set<string> {
  const out = new Set<string>();
  const start = startStarId(c);
  if (start) {
    out.add(start);
    joinedTo(c, start).forEach((id) => out.add(id));
  }
  for (const s of c.stars) {
    if (!starLit(s.ref, queue)) continue;
    out.add(s.id);
    if (isLearned(s.ref, queue)) joinedTo(c, s.id).forEach((id) => out.add(id));
  }
  const ids = new Set(c.stars.map((s) => s.id));
  for (const id of found) if (ids.has(id)) out.add(id);
  return out;
}

/** Stars that show now but are not yet in `found` (so they are new), in star order. */
export function newlyFound(c: Constellation, queue: QueueItem[], found: readonly string[] = []): string[] {
  const have = new Set(found);
  const now = revealedStars(c, queue, found);
  return c.stars.filter((s) => now.has(s.id) && !have.has(s.id)).map((s) => s.id);
}

/** Every star shows: the full shape draws in. */
export const isComplete = (c: Constellation, revealed: ReadonlySet<string>): boolean =>
  c.stars.length > 0 && c.stars.every((s) => revealed.has(s.id));

/**
 * How far along: `found` showing stars, `total` stars, `known` showing stars the
 * user holds a verse of (the ones drawn filled).
 */
export function progress(c: Constellation, queue: QueueItem[], revealed: ReadonlySet<string>): { found: number; total: number; known: number } {
  let found = 0;
  let known = 0;
  for (const s of c.stars) {
    if (!revealed.has(s.id)) continue;
    found++;
    if (starLit(s.ref, queue)) known++;
  }
  return { found, total: c.stars.length, known };
}

/**
 * The NEXT marker: showing stars not yet learned that are joined to a learned
 * star or to the starting star. Star ids, in star order.
 */
export function nextToLearn(c: Constellation, queue: QueueItem[], revealed: ReadonlySet<string>): string[] {
  const byId = new Map(c.stars.map((s) => [s.id, s]));
  const start = startStarId(c);
  const out = new Set<string>();
  for (const l of c.lines) {
    for (const [from, to] of [[l.from, l.to], [l.to, l.from]] as const) {
      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b || !revealed.has(to) || isLearned(b.ref, queue)) continue;
      if (from === start || isLearned(a.ref, queue)) out.add(to);
    }
  }
  return c.stars.filter((s) => out.has(s.id)).map((s) => s.id);
}

/**
 * The star a new star's line draws in from: a showing neighbor, one the user
 * has learned first. Null when none of its neighbors shows (a held star found
 * on its own).
 */
export function joinedFrom(c: Constellation, queue: QueueItem[], starId: string, revealed: ReadonlySet<string>): string | null {
  const byId = new Map(c.stars.map((s) => [s.id, s]));
  const near = joinedTo(c, starId).filter((id) => id !== starId && revealed.has(id));
  const learned = near.find((id) => isLearned(byId.get(id)!.ref, queue));
  return learned ?? near[0] ?? null;
}

/**
 * The order Listen plays a constellation in: the stars that show, following the
 * lines from the starting star (depth first, neighbors in star order), then any
 * showing star the lines don't reach from there, in star order. Hidden stars
 * are never played and never crossed. Star ids.
 */
export function listenOrder(c: Constellation, revealed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !revealed.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const n of joinedTo(c, id)) visit(n);
  };
  visit(startStarId(c));
  for (const s of c.stars) visit(s.id);
  return out;
}

/**
 * The guide's notes on lines, each shown once both of its ends are found.
 * In line order; lines without a note are left out.
 */
export function guideNotes(c: Constellation, revealed: ReadonlySet<string>): { from: StarRef; to: StarRef; note: string }[] {
  const byId = new Map(c.stars.map((s) => [s.id, s.ref]));
  const out: { from: StarRef; to: StarRef; note: string }[] = [];
  for (const l of c.lines) {
    const note = l.note?.trim();
    const from = byId.get(l.from);
    const to = byId.get(l.to);
    if (note && from && to && revealed.has(l.from) && revealed.has(l.to)) out.push({ from, to, note });
  }
  return out;
}

/**
 * Stars that have appeared in the user's sky but not been looked at yet (not
 * saved as found): what a review or learning summary can say "1 new star
 * appeared in The Shepherd" about. Only constellations that are in My sky,
 * in the order added; none with nothing new.
 */
export function skyNewStars(sky: SkyState, list: readonly Constellation[], queue: QueueItem[]): { id: string; title: string; starIds: string[] }[] {
  const out: { id: string; title: string; starIds: string[] }[] = [];
  for (const id of sky.added) {
    const c = list.find((x) => x.id === id);
    if (!c) continue;
    const starIds = newlyFound(c, queue, sky.found[id] ?? []);
    if (starIds.length > 0) out.push({ id, title: c.title, starIds });
  }
  return out;
}

// ---- the sky doc (users/{uid}/mapLayout/sky), as pure transforms -------------

export const EMPTY_SKY: SkyState = { added: [], found: {}, v: 1 };

const union = (a: readonly string[], b: Iterable<string>): string[] => [...new Set([...a, ...b])];

/**
 * Puts a constellation in My sky. Whatever shows right now is saved as found
 * at once, so the reveal moment only plays for stars that appear later. Adding
 * one that is already there changes nothing.
 */
export function skyAdd(sky: SkyState, c: Constellation, queue: QueueItem[]): SkyState {
  if (sky.added.includes(c.id)) return sky;
  return {
    ...sky,
    added: [...sky.added, c.id],
    found: { ...sky.found, [c.id]: union(sky.found[c.id] ?? [], revealedStars(c, queue, sky.found[c.id])) },
  };
}

/** Takes a constellation out of My sky. Its found stars are kept, so adding it back brings them back. */
export const skyRemove = (sky: SkyState, id: string): SkyState =>
  sky.added.includes(id) ? { ...sky, added: sky.added.filter((x) => x !== id) } : sky;

/** Saves stars as found for good. Returns the same object when nothing is new. */
export function skyMarkFound(sky: SkyState, id: string, starIds: readonly string[]): SkyState {
  const have = sky.found[id] ?? [];
  const add = starIds.filter((s) => !have.includes(s));
  if (add.length === 0) return sky;
  return { ...sky, found: { ...sky.found, [id]: union(have, add) } };
}

/**
 * The first sky, for someone who has none: every curated constellation they
 * hold a star in and have not hidden (the old `hiddenConstellations` preference),
 * with what shows now saved as found.
 */
export function migrateSky(list: readonly Constellation[], queue: QueueItem[], hidden: readonly string[]): SkyState {
  let sky = EMPTY_SKY;
  for (const c of list) {
    if (hidden.includes(c.id) || !c.stars.some((s) => starLit(s.ref, queue))) continue;
    sky = skyAdd(sky, c, queue);
  }
  return sky;
}

const normBook = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/** "Psalm 23", "Ps 23:1", "1 pet 5:7-8", "john 3:16" -> book as typed, chapter, optional verse range. Null if it isn't one. */
function parseRefQuery(q: string): { book: string; chapter: number; start?: number; end?: number } | null {
  const m = /^\s*([1-3]?\s*[a-z][a-z .]*?)\.?\s*(\d+)(?:\s*:\s*(\d+)(?:\s*[-–—]\s*(\d+))?)?\s*$/i.exec(q);
  if (!m) return null;
  const book = normBook(m[1]);
  if (!book) return null;
  const start = m[3] ? Number(m[3]) : undefined;
  return { book, chapter: Number(m[2]), start, end: m[4] ? Number(m[4]) : start };
}

/** The typed book is this book's name, its first letters ("ps"), or its name without the s ("psalm"). */
const bookMatches = (typed: string, name: string): boolean => {
  const n = normBook(name);
  return n.startsWith(typed) || (n.endsWith('s') && n.slice(0, -1) === typed);
};

/**
 * Search the browse page: every word typed matches the title, the description
 * or a verse's book; or the whole text is a reference ("Psalm 23", "Ps 23:1",
 * "john 3:16") that lands inside one of its stars. An empty query returns everything.
 */
export function searchConstellations(list: readonly Constellation[], query: string): Constellation[] {
  const words = wordsOf(query);
  if (words.length === 0) return [...list];
  const ref = parseRefQuery(query);
  return list.filter((c) => {
    if (ref && c.stars.some((s) => {
      const r = s.ref;
      if (!bookMatches(ref.book, r.book) || r.chapter !== ref.chapter) return false;
      return ref.start === undefined || (ref.start <= r.end && (ref.end ?? ref.start) >= r.start);
    })) return true;
    const hay = [...wordsOf(`${c.title} ${c.description}`), ...c.stars.flatMap((s) => wordsOf(s.ref.book))];
    return words.every((w) => hay.some((h) => h.startsWith(w) || (w.length > 2 && h.includes(w))));
  });
}
