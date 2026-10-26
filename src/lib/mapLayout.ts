import type { Constellation, MapLayout, StarRef, VerseLink } from '../types';
import { starKey } from './constellations';

// ============================================================================
// CONSTELLATION MAP -- where the stars sit
// ----------------------------------------------------------------------------
// CONSTELLATION_PLAN.md, stage 3. Pure: no React, no Firestore. Tested by
// mapLayout.check.ts (npm run check:maplayout).
//
// Map units are points at zoom 1, x right, y down. Every star has a label (its
// reference) drawn centered just below it; the label's width is estimated from
// its text, and no two stars' star+label boxes may overlap.
//
// How a layout is made, once per change (never per frame):
//   1. Groups. Each shown curated constellation is a group with a hand-placed,
//      never-bent shape. The user's linked verses form pieces (joined by their
//      own links); a piece linked to a curated star joins that constellation's
//      group as satellites, otherwise it is a group of its own.
//   2. Known spots. Saved positions stay. A curated shape keeps the offset it
//      was saved at.
//   3. New stars start next to what they're linked to, on the clearest side,
//      leaning outward. Pieces that a new link joins are slid together.
//   4. Settle. Only stars near the change move: new ones freely, their linked
//      neighbors on a spring back to their old spot, two links away a stiffer
//      spring, further out not at all. With nothing changed nothing moves.
//   5. Groups that are new are placed in open space (seeded, so the same data
//      always gives the same map); groups that grew into a neighbor are nudged.
// Looks win over physics: the forces only get the shape close, then a hard pass
// pushes apart anything overlapping.
// ============================================================================

export type Pt = [number, number];
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bump when the engine changes enough that old saved positions should be dropped. */
export const LAYOUT_VERSION = 1;
/** Hand-placed curated coordinates (about 0-100) are multiplied by this. */
export const CURATED_SCALE = 4;
/** Resting length of a link. */
export const LINK_LENGTH = 96;
/** No two stars' centers closer than this. */
export const MIN_SPACING = 56;
export const STAR_RADIUS = 7;
/** Labels: centered under the star, this far below its edge, this tall. */
export const LABEL_GAP = 4;
export const LABEL_HEIGHT = 14;
/** Average width of one label character (about an 11pt font). */
export const LABEL_CHAR_WIDTH = 6.4;
/** How far an echo's ghost star sits from its star. */
export const GHOST_DISTANCE = 72;

const BOX_H = 2 * STAR_RADIUS + LABEL_GAP + LABEL_HEIGHT;
const BOX_PAD = 6;
const GROUP_GAP = 72;
const GROUP_PAD = 24;
/** A link longer than this many resting lengths is pulled in (it's a change). */
const STRAIN = 1.8;
const SEG_CLEAR = 20;
const REPULSION = 300;
const REPULSION_RANGE = 3 * LINK_LENGTH;
/** Anchor springs by hops from a change; further than this many hops = pinned. */
const ANCHOR_BY_HOP = [0.05, 0.15, 0.4];

// ---------------------------------------------------------------------------
// Labels

/** The label under a star: "Matthew 11:28–30". */
export const starLabel = (r: StarRef): string =>
  `${r.book} ${r.chapter}:${r.start}${r.end > r.start ? `–${r.end}` : ''}`;

/** Estimated width of a label in map units. */
export const labelWidth = (text: string): number => Math.ceil(text.length * LABEL_CHAR_WIDTH) + 4;

/** The box a star and its label take up, centered on the star horizontally. */
export function starBox(p: Pt, width: number): Rect {
  return { x: p[0] - width / 2, y: p[1] - STAR_RADIUS, w: width, h: BOX_H };
}

// ---------------------------------------------------------------------------
// Seeded randomness (FNV-1a), so the same keys always give the same map.

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const seededAngle = (s: string): number => (hash(s) / 4294967296) * Math.PI * 2;

// ---------------------------------------------------------------------------
// Types

export interface LayoutInput {
  /** The curated constellations being shown (hidden ones left out). */
  constellations: Constellation[];
  /** All of the user's links; curated-line labels (`curated` set) don't place anything. */
  links: VerseLink[];
}

export interface MapStar {
  key: string;
  ref: StarRef;
  label: string;
  labelWidth: number;
  /** Id of the group (constellation) it sits in. */
  group: string;
  /** Set for a curated star. */
  curated?: { constellationId: string; starId: string };
}

export interface MapLine {
  from: string;
  to: string;
  kind: 'curated' | 'user';
  /** The constellation (curated line) or the link (user line). */
  id: string;
}

export interface MapGroup {
  /** Constellation id for a curated group; the smallest star key for the user's own. */
  id: string;
  kind: 'curated' | 'user';
  keys: string[];
  /** Everything in the group, labels included, with a margin: what a jump-to chip zooms to. */
  bounds: Rect;
  center: Pt;
}

export interface StarMove {
  key: string;
  from: Pt;
  to: Pt;
  /** A star that wasn't on the map before: it grows out of `from` (a linked star's old spot) or fades in. */
  appearing: boolean;
}

export interface LayoutResult {
  /** Every star on the map. */
  positions: Record<string, Pt>;
  stars: MapStar[];
  lines: MapLine[];
  groups: MapGroup[];
  /** The whole map: what Whole map zooms to. */
  bounds: Rect;
  /** Stars that moved or appeared since `saved`, for the screen to animate. */
  moves: StarMove[];
  /** What to save: these positions plus saved ones of stars now off the map (a hidden constellation comes back where it was). */
  layout: MapLayout;
  /** False when nothing differs from `saved`, so there's nothing to write. */
  changed: boolean;
}

interface Node {
  key: string;
  ref: StarRef;
  label: string;
  w: number;
  curated?: { constellationId: string; starId: string };
  group: Group | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  placed: boolean;
  isNew: boolean;
  mobile: boolean;
  ax: number;
  ay: number;
  k: number;
  adj: Node[];
}

interface Group {
  id: string;
  kind: 'curated' | 'user';
  order: number;
  nodes: Node[];
  edges: [Node, Node][];
  fresh: boolean;
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Geometry helpers

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

/** How far two star boxes overlap on each axis (both > 0 = overlapping). */
function boxOverlap(a: { x: number; y: number; w: number }, b: { x: number; y: number; w: number }): [number, number] {
  return [(a.w + b.w) / 2 + BOX_PAD - Math.abs(b.x - a.x), BOX_H + BOX_PAD - Math.abs(b.y - a.y)];
}

/** Cheap test: too far apart for their boxes or circles to touch. */
function apart(a: Node, b: Node): boolean {
  const dy = Math.abs(b.y - a.y);
  if (dy >= MIN_SPACING) return true;
  const dx = Math.abs(b.x - a.x);
  return dx >= MIN_SPACING && dx >= (a.w + b.w) / 2 + BOX_PAD;
}

function collides(a: Node, b: Node): boolean {
  if (apart(a, b)) return false;
  const [ox, oy] = boxOverlap(a, b);
  return (ox > 0.01 && oy > 0.01) || dist(a.x, a.y, b.x, b.y) < MIN_SPACING - 0.01;
}

function rectsOverlap(a: Rect, b: Rect, gap: number): [number, number] {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
  return [ox, oy];
}

function nodesRect(nodes: { x: number; y: number; w: number }[], pad: number): Rect {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const n of nodes) {
    l = Math.min(l, n.x - n.w / 2);
    r = Math.max(r, n.x + n.w / 2);
    t = Math.min(t, n.y - STAR_RADIUS);
    b = Math.max(b, n.y - STAR_RADIUS + BOX_H);
  }
  return { x: l - pad, y: t - pad, w: r - l + 2 * pad, h: b - t + 2 * pad };
}

/** Do segments p1-p2 and p3-p4 cross (not just touch at an end)? */
function crosses(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}

const round = (v: number) => Math.round(v * 10) / 10;
const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * Pushes two stars apart until neither their boxes nor their circles overlap,
 * moving only the mobile one(s). `extra` overshoots a hair so rounding the
 * saved positions can't make them touch again.
 */
function separate(a: Node, b: Node, strength: number, extra: number): boolean {
  const wa = a.mobile ? 1 : 0;
  const wb = b.mobile ? 1 : 0;
  if (wa + wb === 0) return false;
  const fa = wa / (wa + wb);
  const fb = wb / (wa + wb);
  let moved = false;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const tie = a.key < b.key ? 1 : -1;
  const [ox, oy] = boxOverlap(a, b);
  if (ox > 0 && oy > 0) {
    if (ox < oy) {
      const s = (Math.sign(dx) || tie) * (ox + extra) * strength;
      a.x -= s * fa;
      b.x += s * fb;
    } else {
      const s = (Math.sign(dy) || tie) * (oy + extra) * strength;
      a.y -= s * fa;
      b.y += s * fb;
    }
    moved = true;
    dx = b.x - a.x;
    dy = b.y - a.y;
  }
  const d = Math.hypot(dx, dy);
  if (d < MIN_SPACING) {
    const ux = d > 1e-6 ? dx / d : Math.cos(seededAngle(a.key + b.key));
    const uy = d > 1e-6 ? dy / d : Math.sin(seededAngle(a.key + b.key));
    const push = (MIN_SPACING - d + extra) * strength;
    a.x -= ux * push * fa;
    a.y -= uy * push * fa;
    b.x += ux * push * fb;
    b.y += uy * push * fb;
    moved = true;
  }
  return moved;
}

// ---------------------------------------------------------------------------
// Placing a new star (or sliding a piece) next to a star that's already placed

interface SpotQuery {
  around: Node;
  /** The unit being placed, as offsets from the star that links to `around` (that star first, at 0,0). */
  unit: { dx: number; dy: number; w: number }[];
  seed: string;
  placed: Node[];
  edges: [Node, Node][];
  /** Other placed stars the new star links to: it'd like to be a link's length from them too. */
  others: Node[];
  /** Lean away from this point (the group's middle), so groups grow outward. */
  outward: Pt | null;
  obstacles: Rect[];
}

function pickSpot(q: SpotQuery): Pt {
  const base = seededAngle(q.seed);
  const steps = 16;
  let best: Pt = [q.around.x + LINK_LENGTH, q.around.y];
  let bestScore = -Infinity;
  let ox = 0;
  let oy = 0;
  if (q.outward) {
    ox = q.around.x - q.outward[0];
    oy = q.around.y - q.outward[1];
    const l = Math.hypot(ox, oy);
    if (l > 1e-6) {
      ox /= l;
      oy /= l;
    } else {
      ox = 0;
      oy = 0;
    }
  }
  for (const r of [LINK_LENGTH, LINK_LENGTH * 1.35, LINK_LENGTH * 1.8]) {
    for (let i = 0; i < steps; i++) {
      const ang = base + (i * Math.PI * 2) / steps;
      const cx = q.around.x + Math.cos(ang) * r;
      const cy = q.around.y + Math.sin(ang) * r;
      let clearance = LINK_LENGTH;
      let hits = 0;
      for (const u of q.unit) {
        const p = { x: cx + u.dx, y: cy + u.dy, w: u.w };
        for (const n of q.placed) {
          const dx = Math.abs(n.x - p.x);
          const dy = Math.abs(n.y - p.y);
          if (dx > LINK_LENGTH * 2 || dy > LINK_LENGTH * 2) continue;
          clearance = Math.min(clearance, Math.hypot(dx, dy) - MIN_SPACING);
          if (dx < (p.w + n.w) / 2 + BOX_PAD && dy < BOX_H + BOX_PAD) hits++;
        }
        const box = starBox([p.x, p.y], p.w);
        for (const o of q.obstacles) {
          const [rx, ry] = rectsOverlap(box, o, 0);
          if (rx > 0 && ry > 0) hits += 4;
        }
      }
      let score = Math.min(clearance, LINK_LENGTH) - hits * 120 - (r - LINK_LENGTH) * 0.4;
      for (const o of q.others) score -= Math.abs(dist(cx, cy, o.x, o.y) - LINK_LENGTH) * 0.5;
      score += (Math.cos(ang) * ox + Math.sin(ang) * oy) * 30;
      const p1: Pt = [q.around.x, q.around.y];
      const p2: Pt = [cx, cy];
      for (const [a, b] of q.edges) {
        if (!a.placed || !b.placed || a === q.around || b === q.around) continue;
        if (crosses(p1, p2, [a.x, a.y], [b.x, b.y])) score -= 40;
      }
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = [cx, cy];
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Settling a group

function settle(g: Group, fresh: boolean) {
  const nodes = g.nodes;
  if (!nodes.some((n) => n.mobile)) return;
  const iters = fresh ? 240 : 160;
  let alpha = fresh ? 1 : 0.5;
  const decay = Math.pow(0.005 / alpha, 1 / iters);
  const deg = new Map<Node, number>();
  for (const n of nodes) deg.set(n, 0);
  for (const [a, b] of g.edges) {
    deg.set(a, (deg.get(a) ?? 0) + 1);
    deg.set(b, (deg.get(b) ?? 0) + 1);
  }
  const gravity = g.kind === 'user' && fresh ? 0.02 : 0;
  const n = nodes.length;
  for (const v of nodes) {
    v.vx = 0;
    v.vy = 0;
  }
  for (let it = 0; it < iters; it++) {
    // Springs on links (d3's link force: stiffness shared by degree).
    for (const [a, b] of g.edges) {
      if (!a.mobile && !b.mobile) continue;
      let dx = b.x + b.vx - a.x - a.vx;
      let dy = b.y + b.vy - a.y - a.vy;
      const d = Math.hypot(dx, dy) || 1e-3;
      const da = deg.get(a) as number;
      const db = deg.get(b) as number;
      const l = ((d - LINK_LENGTH) / d) * alpha * (1 / Math.min(da, db));
      dx *= l;
      dy *= l;
      const bias = !a.mobile ? 1 : !b.mobile ? 0 : da / (da + db);
      b.vx -= dx * bias;
      b.vy -= dy * bias;
      a.vx += dx * (1 - bias);
      a.vy += dy * (1 - bias);
    }
    // Repulsion between nearby stars.
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        if (!a.mobile && !b.mobile) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > REPULSION_RANGE * REPULSION_RANGE) continue;
        const w = (REPULSION * alpha) / Math.max(d2, 100);
        if (a.mobile) {
          a.vx -= dx * w;
          a.vy -= dy * w;
        }
        if (b.mobile) {
          b.vx += dx * w;
          b.vy += dy * w;
        }
      }
    }
    // Keep stars off lines they aren't part of.
    if (it % 3 === 0) {
      for (const v of nodes) {
        if (!v.mobile) continue;
        for (const [a, b] of g.edges) {
          if (a === v || b === v) continue;
          if (v.x < Math.min(a.x, b.x) - SEG_CLEAR || v.x > Math.max(a.x, b.x) + SEG_CLEAR) continue;
          if (v.y < Math.min(a.y, b.y) - SEG_CLEAR || v.y > Math.max(a.y, b.y) + SEG_CLEAR) continue;
          const ex = b.x - a.x;
          const ey = b.y - a.y;
          const len2 = ex * ex + ey * ey;
          if (len2 < 1e-6) continue;
          const t = Math.max(0, Math.min(1, ((v.x - a.x) * ex + (v.y - a.y) * ey) / len2));
          const cx = a.x + ex * t;
          const cy = a.y + ey * t;
          const d = dist(cx, cy, v.x, v.y);
          if (d >= SEG_CLEAR) continue;
          const len = Math.sqrt(len2);
          const ux = d > 1e-6 ? (v.x - cx) / d : -ey / len;
          const uy = d > 1e-6 ? (v.y - cy) / d : ex / len;
          v.vx += ux * (SEG_CLEAR - d) * 1.5 * alpha;
          v.vy += uy * (SEG_CLEAR - d) * 1.5 * alpha;
        }
      }
    }
    // Gentle pulls: a new group toward its middle, existing stars toward their old spot.
    for (const v of nodes) {
      if (!v.mobile) continue;
      if (gravity) {
        v.vx -= v.x * gravity * alpha;
        v.vy -= v.y * gravity * alpha;
      }
      if (v.k) {
        v.vx += (v.ax - v.x) * v.k * alpha;
        v.vy += (v.ay - v.y) * v.k * alpha;
      }
      v.vx *= 0.6;
      v.vy *= 0.6;
      v.x += v.vx;
      v.y += v.vy;
    }
    if (it > iters * 0.25) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) if (!apart(nodes[i], nodes[j])) separate(nodes[i], nodes[j], 0.5, 0);
      }
    }
    alpha *= decay;
  }
  // Hard pass: nothing may overlap, whatever the forces wanted.
  for (let sweep = 0; sweep < 80; sweep++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (collides(nodes[i], nodes[j]) && separate(nodes[i], nodes[j], 1, 0.6)) moved = true;
      }
    }
    if (!moved) break;
  }
}

// ---------------------------------------------------------------------------
// The layout

/**
 * Lays out the map. With `saved` (the last result's `layout`), stars stay where
 * they were and only the neighborhood of a change moves. Deterministic: the same
 * input always gives the same output, whatever order the links come in.
 */
export function layout(input: LayoutInput, saved?: MapLayout | null): LayoutResult {
  const savedPos: Record<string, [number, number]> =
    saved && saved.version === LAYOUT_VERSION && saved.positions ? saved.positions : {};
  const nodes = new Map<string, Node>();
  const groups: Group[] = [];
  const lines: MapLine[] = [];

  const makeNode = (key: string, ref: StarRef): Node => {
    const label = starLabel(ref);
    const node: Node = {
      key, ref, label, w: Math.max(labelWidth(label), 2 * STAR_RADIUS), group: null,
      x: 0, y: 0, vx: 0, vy: 0, placed: false, isNew: true, mobile: false, ax: 0, ay: 0, k: 0, adj: [],
    };
    nodes.set(key, node);
    return node;
  };

  // 1. Curated groups, shapes as drawn. A passage in two constellations gets a second star.
  input.constellations.forEach((c) => {
    if (!c.stars.length) return;
    const g: Group = { id: c.id, kind: 'curated', order: groups.length, nodes: [], edges: [], fresh: false, changed: false };
    const byId = new Map<string, Node>();
    for (const s of c.stars) {
      let key = starKey(s.ref);
      if (nodes.has(key)) key = `${key}#${c.id}`;
      const node = makeNode(key, s.ref);
      node.curated = { constellationId: c.id, starId: s.id };
      node.group = g;
      node.x = s.x * CURATED_SCALE;
      node.y = s.y * CURATED_SCALE;
      g.nodes.push(node);
      byId.set(s.id, node);
    }
    for (const l of c.lines) {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (!a || !b || a === b) continue;
      g.edges.push([a, b]);
      lines.push({ from: a.key, to: b.key, kind: 'curated', id: c.id });
    }
    // Where this shape was saved: the average offset of its saved stars.
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const node of g.nodes) {
      const p = savedPos[node.key];
      if (!p) continue;
      sx += p[0] - node.x;
      sy += p[1] - node.y;
      count++;
    }
    if (count) {
      const ox = round(sx / count);
      const oy = round(sy / count);
      for (const node of g.nodes) {
        node.x = round(node.x + ox);
        node.y = round(node.y + oy);
        node.placed = true;
        node.isNew = !savedPos[node.key];
      }
    } else {
      g.fresh = true;
      for (const node of g.nodes) node.placed = true;
    }
    groups.push(g);
  });

  // 2. The user's links, in a fixed order whatever order they arrive in.
  const seen = new Set<string>();
  const userEdges: { a: Node; b: Node; link: VerseLink }[] = [];
  const own = input.links
    .filter((l) => !l.curated)
    .map((l) => {
      const ka = starKey(l.a);
      const kb = starKey(l.b);
      return { l, ka, kb, pair: ka < kb ? `${ka}~${kb}` : `${kb}~${ka}` };
    })
    .filter((x) => x.ka !== x.kb)
    .sort((x, y) => (x.pair < y.pair ? -1 : x.pair > y.pair ? 1 : x.l.id < y.l.id ? -1 : 1));
  for (const { l, ka, kb, pair } of own) {
    const a = nodes.get(ka) ?? makeNode(ka, l.a);
    const b = nodes.get(kb) ?? makeNode(kb, l.b);
    lines.push({ from: a.key, to: b.key, kind: 'user', id: l.id });
    if (seen.has(pair)) continue;
    seen.add(pair);
    userEdges.push({ a, b, link: l });
  }

  // 3. Pieces of the user's own stars (joined by user-to-user links).
  const parent = new Map<Node, Node>();
  const find = (n: Node): Node => {
    let r = n;
    while (parent.get(r) !== r) r = parent.get(r) as Node;
    parent.set(n, r);
    return r;
  };
  const userNodes = [...nodes.values()].filter((n) => !n.curated).sort(byKey);
  for (const n of userNodes) parent.set(n, n);
  for (const { a, b } of userEdges) {
    if (a.curated || b.curated) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      if (ra.key < rb.key) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
  }
  const pieces = new Map<Node, Node[]>();
  for (const n of userNodes) {
    const r = find(n);
    if (!pieces.has(r)) pieces.set(r, []);
    (pieces.get(r) as Node[]).push(n);
  }
  // A piece linked to curated stars joins the constellation it has the most links to.
  const userGroups: Group[] = [];
  for (const piece of pieces.values()) {
    const inPiece = new Set(piece);
    const votes = new Map<Group, number>();
    for (const { a, b } of userEdges) {
      const c = inPiece.has(a) && b.curated ? b : inPiece.has(b) && a.curated ? a : null;
      if (c) votes.set(c.group as Group, (votes.get(c.group as Group) ?? 0) + 1);
    }
    let host: Group | null = null;
    for (const [g, v] of votes) {
      if (!host || v > (votes.get(host) as number) || (v === votes.get(host) && g.order < host.order)) host = g;
    }
    if (host) {
      for (const n of piece) {
        n.group = host;
        host.nodes.push(n);
      }
    } else {
      const g: Group = { id: piece[0].key, kind: 'user', order: 0, nodes: piece, edges: [], fresh: false, changed: false };
      for (const n of piece) n.group = g;
      userGroups.push(g);
    }
  }
  userGroups.sort((a, b) => b.nodes.length - a.nodes.length || (a.id < b.id ? -1 : 1));
  for (const g of userGroups) {
    g.order = groups.length;
    groups.push(g);
  }
  for (const { a, b } of userEdges) if (a.group === b.group) (a.group as Group).edges.push([a, b]);
  for (const g of groups) {
    g.nodes.sort(byKey);
    for (const [a, b] of g.edges) {
      a.adj.push(b);
      b.adj.push(a);
    }
    for (const n of g.nodes) n.adj.sort(byKey);
  }

  // 4. Saved spots for the user's stars (in a shape whose own spot is known).
  for (const g of groups) {
    if (g.kind === 'curated' && g.fresh) continue;
    for (const n of g.nodes) {
      if (n.curated) continue;
      const p = savedPos[n.key];
      if (!p) continue;
      n.x = p[0];
      n.y = p[1];
      n.placed = true;
      n.isNew = false;
    }
    if (g.kind === 'user' && !g.nodes.some((n) => n.placed)) g.fresh = true;
  }

  const groupRect = (g: Group) => nodesRect(g.nodes.filter((n) => n.placed), GROUP_PAD);

  // 5. Groups with known spots first, then the new ones into open space.
  const known = groups.filter((g) => !g.fresh);
  const knownRects = new Map<Group, Rect>();
  for (const g of known) if (g.nodes.some((n) => n.placed)) knownRects.set(g, groupRect(g));
  for (const g of known) {
    const obstacles = [...knownRects].filter(([o]) => o !== g).map(([, r]) => r);
    growAndSettle(g, obstacles);
    knownRects.set(g, groupRect(g));
  }
  const placedRects: { g: Group; r: Rect }[] = known.map((g) => ({ g, r: groupRect(g) }));
  for (const g of groups.filter((x) => x.fresh)) {
    growAndSettle(g, []);
    const r = groupRect(g);
    const [dx, dy] = openSpace(g, r, placedRects.map((p) => p.r));
    for (const n of g.nodes) {
      n.x += dx;
      n.y += dy;
    }
    placedRects.push({ g, r: groupRect(g) });
  }

  // 6. A group that grew into a neighbor is nudged clear (the changed or smaller one moves).
  for (let pass = 0; pass < 40; pass++) {
    const rects = groups.map((g) => ({ g, r: nodesRect(g.nodes, GROUP_PAD) }));
    let fixed = false;
    for (let i = 0; i < rects.length && !fixed; i++) {
      for (let j = i + 1; j < rects.length && !fixed; j++) {
        const [ox, oy] = rectsOverlap(rects[i].r, rects[j].r, GROUP_GAP / 2);
        if (ox <= 0 || oy <= 0) continue;
        const a = rects[i];
        const b = rects[j];
        const mover =
          a.g.changed !== b.g.changed ? (a.g.changed ? a : b) : a.g.nodes.length < b.g.nodes.length ? a : b;
        const other = mover === a ? b : a;
        const mx = mover.r.x + mover.r.w / 2 - (other.r.x + other.r.w / 2);
        const my = mover.r.y + mover.r.h / 2 - (other.r.y + other.r.h / 2);
        const dx = ox < oy ? (mx >= 0 ? ox : -ox) : 0;
        const dy = ox < oy ? 0 : my >= 0 ? oy : -oy;
        for (const n of mover.g.nodes) {
          n.x += dx;
          n.y += dy;
        }
        mover.g.changed = true;
        fixed = true;
      }
    }
    if (!fixed) break;
  }

  // 7. Results.
  const positions: Record<string, Pt> = {};
  const stars: MapStar[] = [];
  for (const g of groups) {
    for (const n of g.nodes) {
      n.x = round(n.x);
      n.y = round(n.y);
      positions[n.key] = [n.x, n.y];
      stars.push({ key: n.key, ref: n.ref, label: n.label, labelWidth: n.w, group: g.id, ...(n.curated ? { curated: n.curated } : {}) });
    }
  }
  const outGroups: MapGroup[] = groups.map((g) => {
    const r = nodesRect(g.nodes, GROUP_PAD);
    return { id: g.id, kind: g.kind, keys: g.nodes.map((n) => n.key), bounds: r, center: [r.x + r.w / 2, r.y + r.h / 2] };
  });
  const all = [...nodes.values()];
  const bounds = all.length ? nodesRect(all, GROUP_PAD) : { x: 0, y: 0, w: 0, h: 0 };

  const moves: StarMove[] = [];
  const neighborsOf = new Map<Node, Node[]>();
  for (const { a, b } of userEdges) {
    if (!neighborsOf.has(a)) neighborsOf.set(a, []);
    if (!neighborsOf.has(b)) neighborsOf.set(b, []);
    (neighborsOf.get(a) as Node[]).push(b);
    (neighborsOf.get(b) as Node[]).push(a);
  }
  for (const g of groups) {
    for (const n of g.nodes) {
      const old = savedPos[n.key];
      if (old) {
        if (old[0] !== n.x || old[1] !== n.y) moves.push({ key: n.key, from: [old[0], old[1]], to: [n.x, n.y], appearing: false });
        continue;
      }
      const from = [...n.adj, ...(neighborsOf.get(n) ?? [])].map((m) => savedPos[m.key]).find(Boolean);
      moves.push({ key: n.key, from: from ? [from[0], from[1]] : [n.x, n.y], to: [n.x, n.y], appearing: true });
    }
  }

  const keep: Record<string, [number, number]> = {};
  for (const [k, p] of Object.entries(savedPos)) if (!nodes.has(k)) keep[k] = p;
  const outLayout: MapLayout = { version: LAYOUT_VERSION, positions: { ...keep, ...positions } };
  const changed = moves.length > 0 || !saved || saved.version !== LAYOUT_VERSION;

  return { positions, stars, lines, groups: outGroups, bounds, moves, layout: outLayout, changed };
}

/** Places a group's new stars, slides joined pieces together and settles what changed. */
function growAndSettle(g: Group, obstacles: Rect[]) {
  const middle = (ns: Node[]): Pt => {
    let x = 0;
    let y = 0;
    for (const n of ns) {
      x += n.x;
      y += n.y;
    }
    return [x / ns.length, y / ns.length];
  };
  const curatedNodes = g.nodes.filter((n) => n.curated);
  const outwardOf = (): Pt => middle(curatedNodes.length ? curatedNodes : g.nodes.filter((n) => n.placed));

  // A brand-new piece starts from its best-connected star.
  if (!g.nodes.some((n) => n.placed)) {
    const seed = [...g.nodes].sort((a, b) => b.adj.length - a.adj.length || byKey(a, b))[0];
    seed.x = 0;
    seed.y = 0;
    seed.placed = true;
  }

  // New stars, most-connected first, each next to a placed star it links to.
  for (;;) {
    let next: Node | null = null;
    let nextCount = 0;
    for (const n of g.nodes) {
      if (n.placed) continue;
      const c = n.adj.filter((m) => m.placed).length;
      if (c > nextCount) {
        next = n;
        nextCount = c;
      }
    }
    if (!next) {
      // Not reachable through links (shouldn't happen): start it beside the first placed star.
      next = g.nodes.find((n) => !n.placed) ?? null;
      if (!next) break;
    }
    const placedAdj = next.adj.filter((m) => m.placed).sort((a, b) => b.adj.length - a.adj.length || byKey(a, b));
    if (!placedAdj.length) placedAdj.push(g.nodes.find((n) => n.placed) as Node);
    const [x, y] = pickSpot({
      around: placedAdj[0], unit: [{ dx: 0, dy: 0, w: next.w }], seed: next.key,
      placed: g.nodes.filter((n) => n.placed), edges: g.edges, others: placedAdj.slice(1),
      outward: outwardOf(), obstacles,
    });
    next.x = x;
    next.y = y;
    next.placed = true;
  }

  // Pieces a change joined (their links now stretched) slide together as a whole.
  const dirty = new Set<Node>(g.nodes.filter((n) => n.isNew && !n.curated));
  const comp = new Map<Node, Node>();
  const find = (n: Node): Node => {
    let r = n;
    while (comp.get(r) !== r) r = comp.get(r) as Node;
    comp.set(n, r);
    return r;
  };
  const union = (a: Node, b: Node) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra.key < rb.key) comp.set(rb, ra);
    else comp.set(ra, rb);
  };
  for (const n of g.nodes) comp.set(n, n);
  for (let i = 1; i < curatedNodes.length; i++) union(curatedNodes[0], curatedNodes[i]);
  for (const [a, b] of g.edges) if (dist(a.x, a.y, b.x, b.y) <= STRAIN * LINK_LENGTH) union(a, b);
  const comps = new Map<Node, Node[]>();
  for (const n of g.nodes) {
    const r = find(n);
    if (!comps.has(r)) comps.set(r, []);
    (comps.get(r) as Node[]).push(n);
  }
  if (comps.size > 1) {
    const list = [...comps.values()];
    const anchor =
      list.find((c) => c.some((n) => n.curated)) ??
      list.sort((a, b) => b.length - a.length || (find(a[0]).key < find(b[0]).key ? -1 : 1))[0];
    const joined = new Set<Node>(anchor);
    for (;;) {
      const bridge = g.edges.find(([a, b]) => joined.has(a) !== joined.has(b));
      if (!bridge) break;
      const [u, v] = joined.has(bridge[0]) ? bridge : [bridge[1], bridge[0]];
      const piece = comps.get(find(v)) as Node[];
      const [x, y] = pickSpot({
        around: u, unit: [v, ...piece.filter((n) => n !== v)].map((n) => ({ dx: n.x - v.x, dy: n.y - v.y, w: n.w })),
        seed: v.key, placed: [...joined], edges: g.edges.filter(([a, b]) => joined.has(a) && joined.has(b)),
        others: [], outward: outwardOf(), obstacles,
      });
      const dx = x - v.x;
      const dy = y - v.y;
      for (const n of piece) {
        n.x += dx;
        n.y += dy;
        joined.add(n);
      }
      dirty.add(u);
      dirty.add(v);
    }
  }

  // Anything stretched or overlapping is part of the change too.
  for (const [a, b] of g.edges) {
    if (dist(a.x, a.y, b.x, b.y) > STRAIN * LINK_LENGTH) {
      dirty.add(a);
      dirty.add(b);
    }
  }
  for (let i = 0; i < g.nodes.length; i++) {
    for (let j = i + 1; j < g.nodes.length; j++) {
      const a = g.nodes[i];
      const b = g.nodes[j];
      if (a.curated && b.curated) continue;
      if (collides(a, b)) {
        dirty.add(a);
        dirty.add(b);
      }
    }
  }
  for (const n of [...dirty]) if (n.curated) dirty.delete(n);
  if (!dirty.size) return;
  g.changed = true;

  // Hops from the change decide who may move and how hard they're held.
  const hop = new Map<Node, number>();
  let frontier = [...dirty].sort(byKey);
  for (const n of frontier) hop.set(n, 0);
  for (let h = 1; h < ANCHOR_BY_HOP.length && frontier.length; h++) {
    const nextFrontier: Node[] = [];
    for (const n of frontier) {
      for (const m of n.adj) {
        if (hop.has(m)) continue;
        hop.set(m, h);
        nextFrontier.push(m);
      }
    }
    frontier = nextFrontier;
  }
  for (const n of g.nodes) {
    const h = hop.get(n);
    n.mobile = !n.curated && h !== undefined;
    // A slid piece is held where it was slid to, so it keeps its shape.
    n.ax = n.x;
    n.ay = n.y;
    n.k = !n.mobile || n.isNew ? 0 : ANCHOR_BY_HOP[h as number];
  }
  settle(g, g.fresh);
  for (const n of g.nodes) n.mobile = false;
}

/** Where a new group goes: the nearest open spot to the middle of the map, spiraling out. */
function openSpace(g: Group, r: Rect, taken: Rect[]): Pt {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const base = seededAngle(g.id);
  const step = 48;
  for (let ring = 0; ring < 400; ring++) {
    const radius = ring * step;
    const count = ring === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * radius) / step));
    for (let i = 0; i < count; i++) {
      const ang = base + (i * Math.PI * 2) / count;
      // A little taller than wide: phones are portrait.
      const tx = Math.cos(ang) * radius;
      const ty = Math.sin(ang) * radius * 1.3;
      const moved = { x: tx - r.w / 2, y: ty - r.h / 2, w: r.w, h: r.h };
      if (taken.every((t) => {
        const [ox, oy] = rectsOverlap(moved, t, GROUP_GAP / 2);
        return ox <= 0 || oy <= 0;
      })) {
        return [tx - cx, ty - cy];
      }
    }
  }
  return [0, 0];
}

// ---------------------------------------------------------------------------
// Echo ghosts

/**
 * Where an echo's ghost star goes for the star `key`: outward from its group's
 * middle, turned as little as needed to sit clear of every star and label.
 */
export function echoGhost(result: LayoutResult, key: string, ghostRef?: StarRef): Pt | null {
  const p = result.positions[key];
  if (!p) return null;
  const star = result.stars.find((s) => s.key === key);
  const group = result.groups.find((g) => g.id === star?.group);
  const w = ghostRef ? labelWidth(starLabel(ghostRef)) : 80;
  let base = group ? Math.atan2(p[1] - group.center[1], p[0] - group.center[0]) : seededAngle(key);
  if (group && dist(p[0], p[1], group.center[0], group.center[1]) < 1) base = seededAngle(key);
  const others = result.stars.map((s) => ({ x: result.positions[s.key][0], y: result.positions[s.key][1], w: s.labelWidth }));
  // Lines are drawn too: keep the ghost off them.
  const segs = result.lines.map((l) => [result.positions[l.from], result.positions[l.to]] as [Pt, Pt]);
  let best: Pt = [p[0] + Math.cos(base) * GHOST_DISTANCE, p[1] + Math.sin(base) * GHOST_DISTANCE];
  let bestScore = -Infinity;
  const turns = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
  for (const r of [GHOST_DISTANCE, GHOST_DISTANCE * 1.5, GHOST_DISTANCE * 2]) {
    for (const t of turns) {
      const ang = base + (t * Math.PI) / 6;
      const g = { x: p[0] + Math.cos(ang) * r, y: p[1] + Math.sin(ang) * r, w };
      let clearance = Infinity;
      let hits = 0;
      for (const o of others) {
        clearance = Math.min(clearance, dist(g.x, g.y, o.x, o.y));
        const [ox, oy] = boxOverlap(g, o);
        if (ox > 0 && oy > 0) hits++;
      }
      for (const [a, b] of segs) {
        if (crosses([p[0], p[1]], [g.x, g.y], a, b)) hits++;
      }
      if (!hits && clearance >= MIN_SPACING) return [round(g.x), round(g.y)];
      const score = Math.min(clearance, MIN_SPACING) - hits * 100 - Math.abs(t) * 2 - r * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = [g.x, g.y];
      }
    }
  }
  return [round(best[0]), round(best[1])];
}

/** The rectangle a jump-to chip should zoom to: one group, or the whole map. */
export const viewBounds = (result: LayoutResult, groupId?: string): Rect =>
  (groupId && result.groups.find((g) => g.id === groupId)?.bounds) || result.bounds;
