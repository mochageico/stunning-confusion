import type { Echo, QueueItem, StarRef, VerseLink } from '../../types';
import { echoesFor, refsOverlap, starKey, starLit, starStage, suggestedNext } from '../../lib/constellations';
import { echoGhosts, LayoutResult, MapStar, Pt, starLabel, STAR_RADIUS, LABEL_GAP, LABEL_HEIGHT } from '../../lib/mapLayout';
import type { VerseStage } from '../../lib/stageProgress';
import { CONSTELLATIONS } from '../../content/constellations';
import ECHOES_JSON from '../../content/echoes.json';

// ============================================================================
// CONSTELLATION MAP -- what each star looks like, and what a tap hit
// ----------------------------------------------------------------------------
// The screen side of stage 4: given the layout (lib/mapLayout.ts) and the
// queue, which stars are lit and at what stage, which echoes are found for
// good, where a tapped star's hidden echoes go, and what a tap at a map point
// lands on. Pure, so the drawing components stay drawing.
// ============================================================================

export const ECHOES = ECHOES_JSON as Echo[];

export interface StarLook {
  key: string;
  lit: boolean;
  /** Least advanced held verse; null when the star holds none. */
  stage: VerseStage | null;
  /** A curated star worth adding next: soft dashed ring. */
  suggested: boolean;
}

/** Lit, stage and suggested for every star on the map. */
export function starLooks(result: LayoutResult, queue: QueueItem[]): Record<string, StarLook> {
  const suggested = new Set<string>();
  for (const c of CONSTELLATIONS) {
    for (const id of suggestedNext(c, queue)) suggested.add(`${c.id}/${id}`);
  }
  const out: Record<string, StarLook> = {};
  for (const s of result.stars) {
    const stage = starStage(s.ref, queue);
    out[s.key] = {
      key: s.key,
      lit: stage !== null,
      stage,
      suggested: !!s.curated && suggested.has(`${s.curated.constellationId}/${s.curated.starId}`),
    };
  }
  return out;
}

/** The first star on the map that shares a verse with this ref. */
function starOn(result: LayoutResult, ref: StarRef): MapStar | undefined {
  return result.stars.find((s) => refsOverlap(s.ref, ref));
}

/** An echo between two stars that are both on the map and both held: drawn for good as a dotted line. */
export interface FoundEcho {
  id: string;
  from: string;
  to: string;
  echo: Echo;
}

export function foundEchoes(result: LayoutResult, queue: QueueItem[]): FoundEcho[] {
  const out: FoundEcho[] = [];
  const seen = new Set<string>();
  // Only the echoes whose ends could both be on the map: index the map's chapters first.
  const chapters = new Set(result.stars.map((s) => `${s.ref.book}|${s.ref.chapter}`));
  for (const e of ECHOES) {
    if (!chapters.has(`${e.nt.book}|${e.nt.chapter}`) || !chapters.has(`${e.ot.book}|${e.ot.chapter}`)) continue;
    const a = starOn(result, e.nt);
    const b = starOn(result, e.ot);
    if (!a || !b || a.key === b.key) continue;
    if (!starLit(e.nt, queue) || !starLit(e.ot, queue)) continue;
    const id = [a.key, b.key].sort().join('~');
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, from: a.key, to: b.key, echo: e });
  }
  return out;
}

/** One of a tapped star's echoes: the other end, and where it shows. */
export interface EchoView {
  echo: Echo;
  /** The tapped star's side of it. */
  here: StarRef;
  /** The other end. */
  there: StarRef;
  /** "quotes" or "echoes", from the NT side: "Matthew 4:4 quotes Deuteronomy 8:3." */
  sentence: string;
  /** The other end's star when it is on the map; otherwise a ghost is drawn at `ghost`. */
  thereKey?: string;
  ghost?: Pt;
  /** Already drawn for good (both ends held and on the map). */
  found: boolean;
}

/** The sentence an echo card shows. Never "fulfills" (CONSTELLATION_PLAN.md). */
export const echoSentence = (e: Echo): string =>
  `${starLabel(e.nt)} ${e.kind === 'quote' ? 'quotes' : 'echoes'} ${starLabel(e.ot)}.`;

/**
 * The echoes of the tapped star. Quotes before allusions. Every one whose
 * other end isn't on the map gets a ghost star and a dotted line, fanned out
 * around the star; the card lists them all.
 */
export function echoViews(result: LayoutResult, key: string, found: FoundEcho[]): EchoView[] {
  const star = result.stars.find((s) => s.key === key);
  if (!star) return [];
  const list = [...echoesFor(star.ref, ECHOES)].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'quote' ? -1 : 1));
  const seen = new Set<string>();
  const out: EchoView[] = [];
  for (const e of list) {
    const ntHere = refsOverlap(e.nt, star.ref);
    const here = ntHere ? e.nt : e.ot;
    const there = ntHere ? e.ot : e.nt;
    const k = starKey(there);
    if (seen.has(k)) continue;
    seen.add(k);
    const other = starOn(result, there);
    const view: EchoView = { echo: e, here, there, sentence: echoSentence(e), found: false };
    if (other && other.key !== key) {
      view.thereKey = other.key;
      view.found = found.some((f) => (f.from === key && f.to === other.key) || (f.to === key && f.from === other.key));
    }
    out.push(view);
  }
  // Every end that isn't a star on the map gets a ghost, all placed together so they fan out.
  const bare = out.filter((v) => !v.thereKey);
  const spots = echoGhosts(result, key, bare.map((v) => v.there));
  bare.forEach((v, i) => (v.ghost = spots[i]));
  return out;
}

// ---------------------------------------------------------------------------
// Taps

export type MapHit =
  | { kind: 'star'; key: string }
  | { kind: 'line'; from: string; to: string; lineKind: 'curated' | 'user'; id: string }
  | { kind: 'ghost'; index: number }
  | { kind: 'empty' };

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return dist(p[0], p[1], a[0] + t * dx, a[1] + t * dy);
}

/**
 * What a tap at map point `p` lands on, at zoom `zoom`. Generous on purpose:
 * a star answers within about 28 points on screen, its label counts as the
 * star, and a line within 16. Ghosts first (they sit on top), then stars,
 * then lines.
 */
export function hitTest(
  p: Pt,
  zoom: number,
  result: LayoutResult,
  positions: Record<string, Pt>,
  ghosts: Pt[]
): MapHit {
  const starR = Math.max(28 / zoom, STAR_RADIUS + 4);
  for (let i = 0; i < ghosts.length; i++) {
    if (dist(p[0], p[1], ghosts[i][0], ghosts[i][1]) <= starR) return { kind: 'ghost', index: i };
  }
  let best: { key: string; d: number } | null = null;
  for (const s of result.stars) {
    const q = positions[s.key];
    if (!q) continue;
    let d = dist(p[0], p[1], q[0], q[1]);
    // On its label: as good as on the star.
    const top = q[1] + STAR_RADIUS + LABEL_GAP;
    if (p[1] >= top - 2 && p[1] <= top + LABEL_HEIGHT + 4 && Math.abs(p[0] - q[0]) <= s.labelWidth / 2 + 4) d = Math.min(d, 1);
    if (d <= starR && (!best || d < best.d)) best = { key: s.key, d };
  }
  if (best) return { kind: 'star', key: best.key };
  const lineR = Math.max(16 / zoom, 6);
  let line: { l: LayoutResult['lines'][number]; d: number } | null = null;
  for (const l of result.lines) {
    const a = positions[l.from];
    const b = positions[l.to];
    if (!a || !b) continue;
    const d = segDist(p, a, b);
    if (d <= lineR && (!line || d < line.d)) line = { l, d };
  }
  if (line) return { kind: 'line', from: line.l.from, to: line.l.to, lineKind: line.l.kind, id: line.l.id };
  return { kind: 'empty' };
}

/** The user's label on a line, if they wrote one: links match lines by their two ends. */
export function lineLabels(result: LayoutResult, links: VerseLink[]): Record<string, string> {
  const byPair = new Map<string, string>();
  for (const l of links) {
    if (!l.label) continue;
    byPair.set([starKey(l.a), starKey(l.b)].sort().join('~'), l.label);
  }
  const out: Record<string, string> = {};
  if (byPair.size === 0) return out;
  const base = (k: string) => k.split('#')[0];
  for (const l of result.lines) {
    const label = byPair.get([base(l.from), base(l.to)].sort().join('~'));
    if (label) out[`${l.from}~${l.to}`] = label;
  }
  return out;
}
