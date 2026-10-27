// Regression assertions for the constellation rules (src/lib/constellations.ts),
// run by `npm run check:constellations`.

import type { Echo, QueueItem, StarRef, VerseLink } from '../types';
import { CONSTELLATIONS } from '../content/constellations';
import { starVerses, walkCredit, walkOrder } from './mapWalk';
import { canLabel, echoesFor, echoVisible, isLearned, starIsTop, starKey, starLit, starStage, suggestedNext, userConstellations } from './constellations';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const item = (book: string, chapter: number, verse: number, over: Partial<QueueItem> = {}, tr = 'BSB'): QueueItem =>
  ({
    verseId: `${tr}_${book}_${chapter}_${verse}`, translationId: tr, book, chapter, verseNumber: verse, text: 'x', orderIndex: 0,
    status: 'reviewing', retentionPhase: 'weekly', dateStarted: null, lastReviewDate: null, nextReviewDueDate: null,
    currentStreakCount: 0, totalSuccessfulReviews: 0, gracePeriodUsedToday: false, ...over,
  }) as QueueItem;
const learning = { status: 'learning' as const, retentionPhase: 'none' as const };
const queued = { status: 'queued' as const, retentionPhase: 'none' as const };
const daily = { retentionPhase: 'daily' as const };
const ref = (book: string, chapter: number, start: number, end = start): StarRef => ({ book, chapter, start, end });
const link = (id: string, a: StarRef, b: StarRef, over: Partial<VerseLink> = {}): VerseLink => ({ id, a, b, createdAt: 1, ...over });

const ps = ref('Psalms', 23, 1, 4);
check('starKey', starKey(ps) === 'Psalms|23|1-4');

// Stage: the least advanced held verse; waiting verses are not held.
const q1 = [item('Psalms', 23, 1), item('Psalms', 23, 2, daily), item('Psalms', 23, 3, learning), item('Psalms', 23, 4, queued)];
check('star stage is the floor of held verses', starStage(ps, q1) === 'learning', starStage(ps, q1));
check('a star with only waiting verses is dark', !starLit(ps, [item('Psalms', 23, 1, queued)]) && starStage(ps, [item('Psalms', 23, 1, queued)]) === null);
check('lit when any verse is held', starLit(ps, q1));
check('another chapter does not light it', !starLit(ps, [item('Psalms', 22, 1)]));

// Another translation counts at its furthest stage.
const q2 = [item('Psalms', 23, 1, learning), item('Psalms', 23, 1, {}, 'KJV')];
check('a verse in two translations counts at its furthest', starStage(ref('Psalms', 23, 1), q2) === 'steady', starStage(ref('Psalms', 23, 1), q2));

// Learned: every verse held and Settling or later.
const allDaily = [1, 2, 3, 4].map((v) => item('Psalms', 23, v, daily));
check('learned when every verse is Settling or later', isLearned(ps, allDaily));
check('not learned while one verse is still learning', !isLearned(ps, q1));
check('not learned with a verse missing', !isLearned(ps, allDaily.slice(1)));

// The top step (every 6 months): every held verse must be on it.
const top = { ladderStep: 7, ladderReviews: 0 };
check('a star is top when every held verse is on the top step', starIsTop(ps, [1, 2, 3, 4].map((v) => item('Psalms', 23, v, top))));
check('one verse below the top keeps the star off it', !starIsTop(ps, [...[1, 2, 3].map((v) => item('Psalms', 23, v, top)), item('Psalms', 23, 4, daily)]));
check('waiting verses do not hold a top star back', starIsTop(ps, [item('Psalms', 23, 1, top), item('Psalms', 23, 2, queued)]));
check('a star with nothing held is not top', !starIsTop(ps, []));

// canLabel needs both ends.
const rom = ref('Romans', 8, 38);
const l1 = link('l1', ps, rom);
check('cannot label with one end unlearned', !canLabel(l1, allDaily));
check('can label when both ends are learned', canLabel(l1, [...allDaily, item('Romans', 8, 38)]));

// Suggested next.
const c = CONSTELLATIONS[0];
const ids = new Set(c.stars.map((s) => s.id));
check('placeholder constellation is well formed', c.stars.length === 6 && c.lines.every((l) => ids.has(l.from) && ids.has(l.to)));
check('nothing suggested with nothing held', suggestedNext(c, []).length === 0);
check('a Daily star suggests the next one', suggestedNext(c, allDaily).join() === 'matt11', suggestedNext(c, allDaily));
check('a still-learning star suggests nothing', suggestedNext(c, [item('Psalms', 23, 1, learning)]).length === 0);
const withNext = [...allDaily, item('Matthew', 11, 28)];
check('a held next star is not suggested; the one after it is', suggestedNext(c, withNext).join() === '1pet5', suggestedNext(c, withNext));

// User constellations: connected components.
const A = ref('John', 3, 16), B = ref('Romans', 5, 8), C = ref('Psalms', 1, 1), D = ref('Psalms', 1, 2), E = ref('Acts', 1, 8);
const groups = userConstellations([
  link('1', A, B), link('2', C, D), link('3', B, E),
  link('4', A, ps, { curated: 'rest-and-trust' }), // a curated label joins nothing
]);
check('two groups', groups.length === 2, groups.map((g) => g.id));
check('biggest group first, with its stars and links', groups[0].stars.length === 3 && groups[0].links.length === 2, groups[0]);
check('no links, no groups', userConstellations([]).length === 0);
check('a repeated link adds no star', userConstellations([link('1', A, B), link('2', B, A)])[0].stars.length === 2);

// Echoes (tiny fixture).
const echoes: Echo[] = [{ nt: ref('Hebrews', 10, 16), ot: ref('Jeremiah', 31, 33), kind: 'quote' }];
check('echo found from either end', echoesFor(ref('Hebrews', 10, 15, 17), echoes).length === 1 && echoesFor(ref('Jeremiah', 31, 33), echoes).length === 1);
check('no echo for an unrelated star', echoesFor(ps, echoes).length === 0);
check('echo hidden until both ends are held', !echoVisible(echoes[0], [item('Hebrews', 10, 16)]));
check('echo permanent once both ends are held', echoVisible(echoes[0], [item('Hebrews', 10, 16), item('Jeremiah', 31, 33, learning)]));

// Walking the constellation.
const g = { keys: ['a', 'b', 'c', 'd', 'e'], lines: [{ from: 'a', to: 'b' }, { from: 'c', to: 'b' }, { from: 'c', to: 'd' }, { from: 'b', to: 'e' }] };
check('walk goes depth first, either direction, in key order', walkOrder(g, 'a', () => true).join() === 'b,c,d,e', walkOrder(g, 'a', () => true));
check('an unheld star is crossed, not asked for', walkOrder(g, 'a', (k) => k !== 'b').join() === 'c,d,e', walkOrder(g, 'a', (k) => k !== 'b'));
check('the start is never in its own walk', !walkOrder(g, 'c', () => true).includes('c'));
check('a lone star walks nowhere', walkOrder({ keys: ['x'], lines: [] }, 'x', () => true).length === 0);
const wq = [item('Psalms', 23, 2), item('Psalms', 23, 1, learning), item('Psalms', 23, 3, queued), item('Psalms', 23, 1, {}, 'KJV'), item('John', 3, 16)];
const wv = starVerses(ps, wq);
check('star verses: held only, verse order, one per number', wv.map((v) => v.verse).join() === '1,2', wv.map((v) => v.verse));
check('a schedule beats Learning for a verse in two translations', wv[0].translationId === 'KJV', wv[0].translationId);
const base = { counts: true, passed: true, perfect: false, mode: 'speak' as const, paused: false, due: true, touchOk: true, alreadyCounted: false };
const rev = item('Psalms', 23, 1);
check('a due review counts', walkCredit(rev, base).kind === 'review');
check('a not-due review is practice', walkCredit(rev, { ...base, due: false }).kind === null);
check('paused reviews are practice', walkCredit(rev, { ...base, paused: true }).kind === null);
check('a miss earns nothing', walkCredit(rev, { ...base, passed: false }).kind === null);
check('set to Practice, nothing counts', walkCredit(rev, { ...base, counts: false }).kind === null);
check('counted once per walk', walkCredit(rev, { ...base, alreadyCounted: true }).kind === null);
check('self-check still counts a due review', walkCredit(rev, { ...base, mode: 'self' }).kind === 'review');
const lrn = item('Psalms', 23, 1, learning);
check('learning needs graded and perfect', walkCredit(lrn, { ...base, perfect: true }).kind === 'touch' && walkCredit(lrn, { ...base, perfect: true, mode: 'self' }).kind === null && walkCredit(lrn, base).kind === null);
check('a Complete verse is practice', walkCredit(item('Psalms', 23, 1, { status: 'retained' as const }), base).kind === null);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll constellation checks passed.');
