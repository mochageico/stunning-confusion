// Regression assertions for the constellation map layout (src/lib/mapLayout.ts),
// run by `npm run check:maplayout`.

import type { MapLayout, StarRef, VerseLink } from '../types';
import { CONSTELLATIONS } from '../content/constellations';
import { starKey } from './constellations';
import { echoGhost, echoGhosts, labelWidth, layout, LayoutInput, LayoutResult, MIN_SPACING, starBox, starLabel, viewBounds } from './mapLayout';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const ref = (book: string, chapter: number, start: number, end = start): StarRef => ({ book, chapter, start, end });
const link = (id: string, a: StarRef, b: StarRef, over: Partial<VerseLink> = {}): VerseLink => ({ id, a, b, createdAt: 1, ...over });

/** The closest two stars (by center) and whether any two star+label boxes overlap, curated pairs aside. */
function spacing(r: LayoutResult) {
  let min = Infinity;
  let pair = '';
  let overlaps = 0;
  const s = r.stars;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      if (s[i].curated && s[j].curated) continue;
      const a = r.positions[s[i].key];
      const b = r.positions[s[j].key];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d < min) {
        min = d;
        pair = `${s[i].key} / ${s[j].key}`;
      }
      const ba = starBox(a, s[i].labelWidth);
      const bb = starBox(b, s[j].labelWidth);
      if (ba.x < bb.x + bb.w && bb.x < ba.x + ba.w && ba.y < bb.y + bb.h && bb.y < ba.y + ba.h) overlaps++;
    }
  }
  return { min, pair, overlaps };
}

/** How far the stars of `before` moved in `after` (stars in both). */
function maxShift(before: LayoutResult, after: LayoutResult): { max: number; key: string } {
  let max = 0;
  let key = '';
  for (const [k, p] of Object.entries(before.positions)) {
    const q = after.positions[k];
    if (!q) continue;
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d > max) {
      max = d;
      key = k;
    }
  }
  return { max, key };
}

// A deterministic stand-in for a real user's links: groups of passages from
// across the Bible, chains with a few cross links, some tied to curated stars.
const BOOKS = ['Genesis', 'Exodus', 'Deuteronomy', 'Joshua', 'Psalms', 'Proverbs', 'Isaiah', 'Jeremiah', 'Micah', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', 'Hebrews', 'James', '1 Peter', '1 John', 'Revelation'];
function bigFixture(totalStars: number): VerseLink[] {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const refs: StarRef[] = [];
  const used = new Set<string>();
  while (refs.length < totalStars) {
    const book = BOOKS[Math.floor(rand() * BOOKS.length)];
    const chapter = 1 + Math.floor(rand() * 28);
    const start = 1 + Math.floor(rand() * 30);
    const r = ref(book, chapter, start, rand() < 0.3 ? start + 1 + Math.floor(rand() * 3) : start);
    if (used.has(starKey(r))) continue;
    used.add(starKey(r));
    refs.push(r);
  }
  const links: VerseLink[] = [];
  let i = 0;
  let n = 0;
  const sizes = [24, 16, 12, 10, 8, 8, 6, 6, 5, 5, 4, 3, 2, 2];
  for (const size of sizes) {
    const group = refs.slice(i, i + size);
    i += size;
    if (group.length < 2) break;
    for (let k = 1; k < group.length; k++) {
      const parent = group[Math.floor(rand() * k)];
      links.push(link(`L${n++}`, parent, group[k]));
    }
    // A few extra links inside the bigger groups make loops.
    for (let k = 0; k < Math.floor(group.length / 6); k++) {
      const a = group[Math.floor(rand() * group.length)];
      const b = group[Math.floor(rand() * group.length)];
      if (a !== b) links.push(link(`L${n++}`, a, b));
    }
  }
  // The rest hang off the curated constellation's stars.
  const curated = CONSTELLATIONS[0].stars.map((s) => s.ref);
  for (let k = 0; i < refs.length; k++) links.push(link(`L${n++}`, curated[k % curated.length], refs[i++]));
  return links;
}

const shuffle = <T>(xs: T[]): T[] => xs.map((x, i) => ({ x, k: (i * 7919) % 101 })).sort((a, b) => a.k - b.k).map((p) => p.x);
const constellations = CONSTELLATIONS;

// --- Small cases -----------------------------------------------------------

const ps23 = ref('Psalms', 23, 1, 4);
const john3 = ref('John', 3, 16);
const rom5 = ref('Romans', 5, 8);
const eph2 = ref('Ephesians', 2, 8, 9);
const isa53 = ref('Isaiah', 53, 5);
const small: LayoutInput = {
  constellations,
  links: [link('a', john3, rom5), link('b', rom5, eph2), link('c', isa53, rom5), link('d', ref('Matthew', 6, 33), ps23)],
};
const r1 = layout(small);
check('empty map lays out', layout({ constellations: [], links: [] }).stars.length === 0);
check('every star is placed', r1.stars.length === 6 + 5, r1.stars.length);
const curatedHome = constellations[0].stars.map((s) => r1.positions[starKey(s.ref)]);
const o = [curatedHome[0][0] - constellations[0].stars[0].x * 4, curatedHome[0][1] - constellations[0].stars[0].y * 4];
check(
  'the curated shape is exactly as drawn (one offset for the whole shape)',
  constellations[0].stars.every((s, i) => Math.abs(curatedHome[i][0] - (s.x * 4 + o[0])) < 0.11 && Math.abs(curatedHome[i][1] - (s.y * 4 + o[1])) < 0.11),
);
check('a verse linked to a curated star joins its group', r1.stars.find((s) => s.key === starKey(ref('Matthew', 6, 33)))?.group === 'rest-and-trust');
check('the user group is its own group', r1.groups.filter((g) => g.kind === 'user').length === 1);
const sp1 = spacing(r1);
check(`no two stars closer than ${MIN_SPACING} (closest ${sp1.min.toFixed(1)})`, sp1.min >= MIN_SPACING - 0.5, sp1.pair);
check('no labels overlap', sp1.overlaps === 0, sp1.overlaps);
check('first layout says it changed (so it gets saved)', r1.changed);

// Determinism and order-independence.
check('same input, same map', JSON.stringify(layout(small)) === JSON.stringify(r1));
check('links in another order, same map', JSON.stringify(layout({ ...small, links: [...small.links].reverse() }).positions) === JSON.stringify(r1.positions));

// Saved and loaded again: nothing moves.
const r1b = layout(small, r1.layout);
check('reloading from saved moves nothing', JSON.stringify(r1b.positions) === JSON.stringify(r1.positions) && r1b.moves.length === 0 && !r1b.changed);
check('an old layout version is ignored', layout(small, { ...r1.layout, version: 0 }).changed);

// Adding one verse: only its neighborhood moves, a little.
const added = { ...small, links: [...small.links, link('e', ref('Romans', 8, 1), rom5)] };
const r2 = layout(added, r1.layout);
const shift = maxShift(r1, r2);
check(`adding one linked verse moves existing stars < 24 (max ${shift.max.toFixed(1)})`, shift.max < 24, shift.key);
const newMove = r2.moves.find((m) => m.key === starKey(ref('Romans', 8, 1)));
check('the new star grows out of the star it links to', !!newMove && newMove.appearing && newMove.from.join() === r1.positions[starKey(rom5)].join(), newMove);
const sp2 = spacing(r2);
check('still no overlaps after adding', sp2.min >= MIN_SPACING - 0.5 && sp2.overlaps === 0, sp2);
const nl = Math.hypot(r2.positions[starKey(rom5)][0] - r2.positions[starKey(ref('Romans', 8, 1))][0], r2.positions[starKey(rom5)][1] - r2.positions[starKey(ref('Romans', 8, 1))][1]);
check(`the new star sits about a link's length away (${nl.toFixed(0)})`, nl > 60 && nl < 170);

// A user verse linked to a curated star lands near it without bending the shape.
const sat = { ...small, links: [...small.links, link('f', ref('Psalms', 46, 10), ref('1 Peter', 5, 7))] };
const r3 = layout(sat, r1.layout);
check('the curated shape does not move when a satellite is added', constellations[0].stars.every((s) => r3.positions[starKey(s.ref)].join() === r1.positions[starKey(s.ref)].join()));
const satP = r3.positions[starKey(ref('Psalms', 46, 10))];
const petP = r3.positions[starKey(ref('1 Peter', 5, 7))];
check('the satellite sits near its curated star', Math.hypot(satP[0] - petP[0], satP[1] - petP[1]) < 200);

// Joining two groups with one link slides one to the other; no overlaps after.
const two: LayoutInput = { constellations: [], links: [link('a', john3, rom5), link('b', rom5, eph2), link('c', isa53, ref('Micah', 6, 8))] };
const t1 = layout(two);
check('two pieces are two groups', t1.groups.length === 2);
const t2 = layout({ constellations: [], links: [...two.links, link('d', eph2, isa53)] }, t1.layout);
const tl = Math.hypot(t2.positions[starKey(eph2)][0] - t2.positions[starKey(isa53)][0], t2.positions[starKey(eph2)][1] - t2.positions[starKey(isa53)][1]);
check(`joined, they become one group with a normal-length link (${tl.toFixed(0)})`, t2.groups.length === 1 && tl < 180);
const spt = spacing(t2);
check('no overlaps after joining', spt.min >= MIN_SPACING - 0.5 && spt.overlaps === 0, spt);

// Hiding a curated constellation and showing it again puts it back.
const hidden = layout({ constellations: [], links: [] }, r1.layout);
const shown = layout({ constellations, links: [] }, hidden.layout);
check('a hidden constellation comes back where it was', constellations[0].stars.every((s) => shown.positions[starKey(s.ref)].join() === r1.positions[starKey(s.ref)].join()));

// Groups don't overlap each other; bounds hold their stars.
function groupsOk(r: LayoutResult): boolean {
  for (let i = 0; i < r.groups.length; i++) {
    for (let j = i + 1; j < r.groups.length; j++) {
      const a = r.groups[i].bounds;
      const b = r.groups[j].bounds;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return false;
    }
  }
  return r.groups.every((g) => g.keys.every((k) => {
    const p = r.positions[k];
    return p[0] > g.bounds.x && p[0] < g.bounds.x + g.bounds.w && p[1] > g.bounds.y && p[1] < g.bounds.y + g.bounds.h;
  }));
}
check('groups are apart and hold their stars', groupsOk(r1) && groupsOk(t2));
check('whole-map bounds hold every group', r1.groups.every((g) => g.bounds.x >= r1.bounds.x && g.bounds.y >= r1.bounds.y && g.bounds.x + g.bounds.w <= r1.bounds.x + r1.bounds.w + 0.01));
check('viewBounds falls back to the whole map', viewBounds(r1, 'nope') === r1.bounds && viewBounds(r1, 'rest-and-trust') !== r1.bounds);

// Echo ghosts sit clear of every star, a little out from their star.
let ghostsOk = true;
for (const s of r1.stars) {
  const g = echoGhost(r1, s.key, ref('Deuteronomy', 31, 6));
  if (!g) {
    ghostsOk = false;
    continue;
  }
  for (const t of r1.stars) {
    const p = r1.positions[t.key];
    if (Math.hypot(p[0] - g[0], p[1] - g[1]) < MIN_SPACING * 0.75) ghostsOk = false;
  }
}
check('echo ghosts are clear of other stars', ghostsOk);
check('no ghost for a star not on the map', echoGhost(r1, 'Nope|1|1-1') === null);

// A star with ten echoes (Mark 10:19 has ten): every one gets a spot, fanned out and clear.
{
  const refs = [12, 13, 14, 15, 16].map((v) => ref('Exodus', 20, v)).concat([16, 17, 18, 19, 20].map((v) => ref('Deuteronomy', 5, v)));
  const hit = (a: ReturnType<typeof starBox>, b: ReturnType<typeof starBox>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const overlaps = (r: LayoutResult, key: string, spots: [number, number][], againstStars: boolean) => {
    const boxes = spots.map((p, k) => starBox(p, labelWidth(starLabel(refs[k]))));
    let n = 0;
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) if (hit(boxes[a], boxes[b])) n++;
      if (againstStars) for (const t of r.stars) if (hit(boxes[a], starBox(r.positions[t.key], t.labelWidth))) n++;
    }
    return n;
  };
  // Out in the open (a star on its own, beside a pair): nothing overlaps anything.
  const open = layout({ constellations: [], links: [link('o1', john3, rom5), link('o2', ref('Mark', 10, 19), ref('Mark', 10, 19), { solo: true })] });
  const openKey = starKey(ref('Mark', 10, 19));
  const openSpots = echoGhosts(open, openKey, refs);
  check('ten echoes: one spot each', openSpots.length === 10);
  check('ten echoes in the open: no label box overlaps a star or another ghost', overlaps(open, openKey, openSpots, true) === 0, openSpots);
  const around = openSpots.map((p) => Math.hypot(p[0] - open.positions[openKey][0], p[1] - open.positions[openKey][1]));
  check(`ten echoes in the open: a snug ring (nearest ${Math.round(Math.min(...around))}, farthest ${Math.round(Math.max(...around))})`, Math.max(...around) < 170, around);
  check('ten echoes: same spots every time', JSON.stringify(openSpots) === JSON.stringify(echoGhosts(open, openKey, refs)));
  // Inside a crowded constellation there may not be room: ghosts still don't land on each other.
  const crowded = echoGhosts(r1, r1.stars[0].key, refs);
  check('ten echoes in a crowded constellation: ghosts keep off each other', crowded.length === 10 && overlaps(r1, r1.stars[0].key, crowded, false) === 0, crowded);
  check('no echoes, no spots; star not on the map, no spots', echoGhosts(r1, r1.stars[0].key, []).length === 0 && echoGhosts(r1, 'Nope|1|1-1', refs).length === 0);
}

// --- The big map -----------------------------------------------------------

const bigLinks = bigFixture(120);
const big: LayoutInput = { constellations, links: bigLinks };
const time = (f: () => void, runs = 5): number => {
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    f();
    ts.push(performance.now() - t0);
  }
  return ts.sort((a, b) => a - b)[Math.floor(runs / 2)];
};
let b1: LayoutResult = layout(big);
const fresh = time(() => (b1 = layout(big)));
const linked = b1.stars.filter((s) => !s.curated).length;
check(`big map: ${linked} linked verses + ${b1.stars.length - linked} curated stars in ${b1.groups.length} groups`, linked >= 115);
check(`big map settles from scratch well under 100 ms (median ${fresh.toFixed(1)} ms)`, fresh < 60);
const spb = spacing(b1);
check(`big map: no two stars closer than ${MIN_SPACING} (closest ${spb.min.toFixed(1)})`, spb.min >= MIN_SPACING - 0.5, spb.pair);
check('big map: no labels overlap', spb.overlaps === 0, spb.overlaps);
check('big map: groups apart', groupsOk(b1));
check('big map: deterministic, whatever the link order', JSON.stringify(layout({ constellations, links: shuffle(bigLinks) }).positions) === JSON.stringify(b1.positions));
const bReload = layout(big, b1.layout);
check('big map: reloading moves nothing', bReload.moves.length === 0 && !bReload.changed);

const bigAdded: LayoutInput = { constellations, links: [...bigLinks, link('new', bigLinks[3].b, ref('Jude', 1, 24, 25))] };
let b2: LayoutResult = layout(bigAdded, b1.layout);
const resettle = time(() => (b2 = layout(bigAdded, b1.layout)));
const bs = maxShift(b1, b2);
check(`big map: adding one linked verse moves existing stars < 24 (max ${bs.max.toFixed(1)})`, bs.max < 24, bs.key);
check(`big map: re-settle well under 100 ms (median ${resettle.toFixed(1)} ms)`, resettle < 60);
const moved = b2.moves.filter((m) => !m.appearing).length;
check(`big map: only the neighborhood moves (${moved} existing stars moved)`, moved <= 12, moved);
const spb2 = spacing(b2);
check('big map: still no overlaps after adding', spb2.min >= MIN_SPACING - 0.5 && spb2.overlaps === 0, spb2);

// One big group of 120 (worst case for the pairwise forces).
const chain: VerseLink[] = [];
for (let i = 1; i < 120; i++) chain.push(link(`c${i}`, ref('Psalms', 119, 1 + Math.floor((i - 1) / 2)), ref('Psalms', 119, 1 + i)));
let c1: LayoutResult = layout({ constellations: [], links: chain });
const oneGroup = time(() => (c1 = layout({ constellations: [], links: chain })), 3);
check(`one group of ${c1.stars.length} settles under 100 ms (median ${oneGroup.toFixed(1)} ms)`, oneGroup < 100);
const spc = spacing(c1);
check('one big group: no overlaps', spc.min >= MIN_SPACING - 0.5 && spc.overlaps === 0, spc);

// Saved data from another shape of map is used, not trusted blindly.
const odd: MapLayout = { version: 1, positions: { [starKey(john3)]: [0, 0], [starKey(rom5)]: [1, 1] } };
const sp3 = spacing(layout(small, odd));
check('overlapping saved spots are pushed apart', sp3.min >= MIN_SPACING - 0.5 && sp3.overlaps === 0, sp3);

// A star on its own: on the map, joined to nothing.
{
  const lone = ref('Psalms', 46, 10);
  const soloLink = link('s1', lone, lone, { solo: true });
  const withLone = layout({ constellations: [], links: [link('l1', john3, rom5), soloLink] });
  const loneKey = starKey(lone);
  check('lone star: it is on the map', !!withLone.positions[loneKey] && withLone.stars.some((x) => x.key === loneKey));
  check('lone star: no line touches it', !withLone.lines.some((l) => l.from === loneKey || l.to === loneKey));
  const loneGroup = withLone.groups.find((g) => g.keys.includes(loneKey));
  check('lone star: it is its own group', !!loneGroup && loneGroup.keys.length === 1 && loneGroup.kind === 'user', loneGroup);
  const spl = spacing(withLone);
  check('lone star: no overlaps with the others', spl.min >= MIN_SPACING - 0.5 && spl.overlaps === 0, spl);
  const again = layout({ constellations: [], links: [link('l1', john3, rom5), soloLink] });
  check('lone star: same place every time', JSON.stringify(again.positions) === JSON.stringify(withLone.positions));
  const onlyLone = layout({ constellations: [], links: [soloLink] });
  check('lone star: alone on an empty map is fine', onlyLone.stars.length === 1 && onlyLone.lines.length === 0);
  // Joining it to something later moves it only a little, and the solo record draws no extra line.
  const joined = layout({ constellations: [], links: [link('l1', john3, rom5), soloLink, link('l2', lone, john3)] }, withLone.layout);
  check('lone star: joined later, it gets one line', joined.lines.filter((l) => l.from === loneKey || l.to === loneKey).length === 1);
  const shift = maxShift(withLone, joined);
  check(`lone star: the others barely move when it is joined (${Math.round(shift.max)} pt)`, shift.max < 160, shift);
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall map layout checks passed');
