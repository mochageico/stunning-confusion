// Regression assertions for Mixed review's pure logic, run by
// `npm run check:mix`. MIXED_REVIEW_PLAN.md stage 4's "Done when" list is the
// spec: honesty, no repeats in a row, fallbacks, stretches, and stopping
// mid-session keeping earlier credit.

import type { ChapterSections, QueueItem, ReviewGrade } from '../types';
import { FORMATS, FormatId } from './formatNames';
import {
  buildMixPlan,
  buildUnits,
  countsAsReview,
  currentRound,
  DEFAULT_MIX_FORMATS,
  MixEvent,
  MixInput,
  MixPlan,
  mixReducer,
  MixState,
  mixSummary,
  MixVerseResult,
  notGradedOn,
  readMixCounts,
  readMixFormats,
  roundCredits,
  startMix,
  todayOrder,
} from './mix';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

// Matthew 7 (BSB), enough verses for the user's nine sections.
const MATT7: Record<number, string> = {
  1: 'Do not judge, or you will be judged.',
  2: 'For with the same judgment you pronounce, you will be judged; and with the measure you use, it will be measured to you.',
  3: 'Why do you look at the speck in your brother’s eye, but fail to notice the beam in your own eye?',
  4: 'How can you say to your brother, ‘Let me take the speck out of your eye,’ while there is still a beam in your own eye?',
  5: 'You hypocrite! First take the beam out of your own eye, and then you will see clearly to remove the speck from your brother’s eye.',
  6: 'Do not give dogs what is holy; do not throw your pearls before swine. If you do, they may trample them underfoot, and then turn and tear you to pieces.',
  7: 'Ask, and it will be given to you; seek, and you will find; knock, and the door will be opened to you.',
  8: 'For everyone who asks receives; he who seeks finds; and to him who knocks, the door will be opened.',
  9: 'Which of you, if his son asks for bread, will give him a stone?',
  10: 'Or if he asks for a fish, will give him a snake?',
  11: 'So if you who are evil know how to give good gifts to your children, how much more will your Father in heaven give good things to those who ask Him!',
  12: 'In everything, then, do to others as you would have them do to you. For this is the essence of the Law and the Prophets.',
  13: 'Enter through the narrow gate. For wide is the gate and broad is the way that leads to destruction, and many enter through it.',
  14: 'But small is the gate and narrow the way that leads to life, and only a few find it.',
  15: 'Beware of false prophets. They come to you in sheep’s clothing, but inwardly they are ravenous wolves.',
  16: 'By their fruit you will recognize them. Are grapes gathered from thornbushes, or figs from thistles?',
  17: 'Likewise, every good tree bears good fruit, but a bad tree bears bad fruit.',
  18: 'A good tree cannot bear bad fruit, nor can a bad tree bear good fruit.',
  19: 'Every tree that does not bear good fruit is cut down and thrown into the fire.',
  20: 'So then, by their fruit you will recognize them.',
  21: 'Not everyone who says to Me, ‘Lord, Lord,’ will enter the kingdom of heaven, but only he who does the will of My Father in heaven.',
  22: 'Many will say to Me on that day, ‘Lord, Lord, did we not prophesy in Your name, and in Your name drive out demons and perform many miracles?’',
  23: 'Then I will tell them plainly, ‘I never knew you; depart from Me, you workers of lawlessness!’',
  24: 'Therefore everyone who hears these words of Mine and acts on them is like a wise man who built his house on the rock.',
  25: 'The rain fell, the torrents raged, and the winds blew and beat against that house; yet it did not fall, because its foundation was on the rock.',
  26: 'But everyone who hears these words of Mine and does not act on them is like a foolish man who built his house on sand.',
  27: 'The rain fell, the torrents raged, and the winds blew and beat against that house, and it fell—and great was its collapse!',
  28: 'When Jesus had finished saying these things, the crowds were astonished at His teaching,',
  29: 'because He taught as one who had authority, and not as their scribes.',
};
const PSALM23: Record<number, string> = {
  1: 'The LORD is my shepherd; I shall not want.',
  2: 'He makes me lie down in green pastures; He leads me beside quiet waters.',
  3: 'He restores my soul; He guides me in the paths of righteousness for the sake of His name.',
  4: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for You are with me; Your rod and Your staff, they comfort me.',
  5: 'You prepare a table before me in the presence of my enemies; You anoint my head with oil; my cup overflows.',
  6: 'Surely goodness and mercy will follow me all the days of my life, and I will dwell in the house of the LORD forever.',
};
const JOHN11: Record<number, string> = { 35: 'Jesus wept.' };

let order = 0;
const item = (
  book: string,
  chapter: number,
  verse: number,
  texts: Record<number, string>,
  opts: Partial<QueueItem> = {}
): QueueItem =>
  ({
    verseId: `BSB_${book}_${chapter}_${verse}`,
    translationId: 'BSB',
    book,
    chapter,
    verseNumber: verse,
    text: texts[verse],
    orderIndex: order++,
    status: 'reviewing',
    retentionPhase: 'daily',
    dateStarted: null,
    lastReviewDate: null,
    nextReviewDueDate: '2026-10-22',
    currentStreakCount: 0,
    totalSuccessfulReviews: 0,
    gracePeriodUsedToday: false,
    ...opts,
  }) as QueueItem;

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const matt7Sections: ChapterSections = {
  key: 'Matthew|7',
  book: 'Matthew',
  chapter: 7,
  starts: [1, 6, 7, 12, 13, 15, 21, 24, 28],
  labels: { 1: 'Judge not', 6: 'Pearls', 7: 'Ask', 12: 'Golden rule', 13: 'Narrow gate', 15: 'Fruit', 21: 'Lord, Lord', 24: 'Two builders', 28: 'Authority' },
  phraseWords: {},
  updatedAt: '2026-10-22T00:00:00Z',
} as ChapterSections;

const sectionsFor = (docs: ChapterSections[]) => (book: string, chapter: number) =>
  docs.find((d) => d.book === book && d.chapter === chapter) ?? null;

const matt = range(1, 29).map((v) => item('Matthew', 7, v, MATT7, { retentionPhase: 'weekly' }));
const psalm = range(1, 6).map((v) => item('Psalms', 23, v, PSALM23, { retentionPhase: 'daily' }));
const john = [item('John', 11, 35, JOHN11, { retentionPhase: 'monthly' })];

const fullInput = (enabled: FormatId[] = DEFAULT_MIX_FORMATS, extra: Partial<MixInput> = {}): MixInput => ({
  due: [...john, ...matt, ...psalm],
  pool: [...john, ...matt, ...psalm],
  sectionsFor: sectionsFor([matt7Sections]),
  enabled,
  ...extra,
});

/** Every counting round's verses graded at `accuracy` (or a function of the verse id). */
const resultFor = (
  plan: MixPlan,
  s: MixState,
  accuracy: number | ((id: string) => number) = 1
): Record<string, MixVerseResult> => {
  const round = plan.rounds[s.pos];
  const out: Record<string, MixVerseResult> = {};
  round.verseIds.forEach((id) => {
    const a = typeof accuracy === 'number' ? accuracy : accuracy(id);
    out[id] = { mode: 'speak', accuracy: a, perfect: a === 1 };
  });
  return out;
};

const runAll = (plan: MixPlan, accuracy: number | ((id: string) => number) = 1): MixState => {
  let s = mixReducer(startMix(plan), { type: 'start' });
  while (s.status === 'running') s = mixReducer(s, { type: 'result', perVerse: resultFor(plan, s, accuracy) });
  return s;
};

// ------------------------------------------------------------------ units ----
console.log('Units');
{
  const ordered = todayOrder(fullInput().due);
  check(
    'Today order: daily, then weekly, then monthly',
    ordered[0].book === 'Psalms' && ordered[6].book === 'Matthew' && ordered[ordered.length - 1].book === 'John',
    ordered.map((i) => i.book)
  );

  const stepped = todayOrder([
    item('John', 11, 35, JOHN11, { retentionPhase: 'daily', ladderStep: 4 }),
    item('Psalms', 23, 1, PSALM23, { retentionPhase: 'monthly', ladderStep: 1 }),
    item('Psalms', 23, 2, PSALM23, { retentionPhase: 'weekly' }),
  ]);
  check(
    'Today order goes by ladder step; a verse with no step ranks by its old phase',
    stepped.map((i) => `${i.book}${i.verseNumber}`).join() === 'Psalms1,Psalms2,John35',
    stepped.map((i) => `${i.book}${i.verseNumber}`)
  );

  const { chapters, units } = buildUnits(fullInput());
  check('Chapters follow Today: Psalm 23, Matthew 7, John 11', chapters.map((c) => c.book).join(',') === 'Psalms,Matthew,John', chapters.map((c) => c.book));

  const matthew = chapters.find((c) => c.book === 'Matthew')!;
  const mUnits = matthew.unitIndexes.map((i) => units[i]);
  check('Matthew 7 is cut into its nine sections', mUnits.length === 9 && mUnits.every((u) => u.kind === 'section'), mUnits.map((u) => [u.start, u.end]));
  check(
    'Section units carry their verse ranges and labels',
    mUnits[1].start === 6 && mUnits[1].end === 6 && mUnits[1].label === 'Pearls' && mUnits[8].start === 28 && mUnits[8].end === 29
  );

  const pUnits = chapters.find((c) => c.book === 'Psalms')!.unitIndexes.map((i) => units[i]);
  check('A chapter with no sections falls back to stretches', pUnits.length > 1 && pUnits.every((u) => u.kind === 'stretch'), pUnits.map((u) => [u.start, u.end]));
  check('...of at most 4 verses', pUnits.every((u) => u.verseIds.length <= 4), pUnits.map((u) => u.verseIds.length));
  const pCovered = new Set(pUnits.flatMap((u) => u.verseIds));
  check('...covering every due verse', psalm.every((i) => pCovered.has(i.verseId)));

  const jUnits = chapters.find((c) => c.book === 'John')!.unitIndexes.map((i) => units[i]);
  check('A single due verse is a stretch of its own', jUnits.length === 1 && jUnits[0].verseIds.length === 1);

  // A gap: verses 1, 2 and 5 due. Every one must still be in a unit.
  const gappy = [psalm[0], psalm[1], psalm[4]];
  const g = buildUnits({ due: gappy, pool: psalm, sectionsFor: () => null });
  const gCovered = new Set(g.units.flatMap((u) => u.verseIds));
  check('Stretches never drop a lone verse after a gap', gappy.every((i) => gCovered.has(i.verseId)), g.units.map((u) => u.verseIds));

  // Due verses all inside one section: that section is the unit, not stretches.
  const oneSection = buildUnits({ due: matt.slice(0, 5), pool: matt, sectionsFor: sectionsFor([matt7Sections]) });
  check(
    'Due verses all in one section stay one section',
    oneSection.units.length === 1 && oneSection.units[0].kind === 'section' && oneSection.units[0].verseIds.length === 5,
    oneSection.units.map((u) => [u.kind, u.verseIds.length])
  );

  // Keep going's context: the started verse just before the unit.
  const notDueYet = item('Psalms', 23, 1, PSALM23, { nextReviewDueDate: '2026-11-01' });
  const queued = item('Psalms', 23, 3, PSALM23, { status: 'queued' });
  const ctx = buildUnits({ due: [psalm[1]], pool: [notDueYet, psalm[1]], sectionsFor: () => null });
  check('A started verse before the unit becomes its Keep going context', ctx.units[0].contextVerseId === notDueYet.verseId, ctx.units[0]);
  const noCtx = buildUnits({ due: [psalm[3]], pool: [queued, psalm[3]], sectionsFor: () => null });
  check('A queued (not started) verse is never context', !noCtx.units[0].contextVerseId);
  const first = buildUnits({ due: [psalm[0]], pool: psalm, sectionsFor: () => null });
  check('Verse 1 has no context', !first.units[0].contextVerseId);

  check(
    'Duplicate due entries for one verse give one unit verse',
    buildUnits({ due: [psalm[0], psalm[0]], pool: psalm, sectionsFor: () => null }).units[0].verseIds.length === 1
  );
}

// ---------------------------------------------------------- format draws ----
console.log('Format draws');
{
  let repeats = 0;
  let unfollowedPractice = 0;
  let uncountedUnits = 0;
  let openersOnBig = 0;
  let openersOnSmall = 0;
  let openerThenCounting = 0;
  const seen = new Set<FormatId>();
  for (let seed = 1; seed <= 300; seed++) {
    const plan = buildMixPlan(fullInput(), seeded(seed));
    plan.rounds.forEach((r, i) => {
      seen.add(r.format);
      const prev = plan.rounds[i - 1];
      if (prev && prev.format === r.format) repeats++;
      if (!r.counts) {
        const next = plan.rounds[i + 1];
        if (r.role === 'opener') {
          if (next && next.counts && next.chapterKey === r.chapterKey) openerThenCounting++;
        } else if (!next || !next.counts || next.unitIndex !== r.unitIndex || next.role !== 'follow') {
          unfollowedPractice++;
        }
      }
    });
    plan.units.forEach((u) => {
      if (!plan.rounds.some((r) => r.counts && r.unitIndex === u.index && r.role !== 'opener')) uncountedUnits++;
    });
    const openers = plan.rounds.filter((r) => r.role === 'opener');
    openersOnBig += openers.filter((r) => r.chapterKey.includes('Matthew')).length;
    openersOnSmall += openers.filter((r) => !r.chapterKey.includes('Matthew')).length;
  }
  check('No format twice in a row (300 sessions, all formats on)', repeats === 0, repeats);
  check('Every Practice round is followed by a counting round on the same section', unfollowedPractice === 0, unfollowedPractice);
  check('Every unit gets a counting round of its own', uncountedUnits === 0, uncountedUnits);
  check('A chapter with 3+ sections always opens with a Practice round', openersOnBig === 300, openersOnBig);
  check('...and its opener is followed by a counting round', openerThenCounting === 300, openerThenCounting);
  check('Chapters without sections never get an opener', openersOnSmall === 0, openersOnSmall);
  check('Every format shows up somewhere', DEFAULT_MIX_FORMATS.every((f) => seen.has(f)), Array.from(seen));

  // Only Recite on: nothing else fits, so Recite repeats rather than failing.
  const reciteOnly = buildMixPlan(fullInput(['recite']), seeded(4));
  check('Recite only: every round is Recite', reciteOnly.rounds.every((r) => r.format === 'recite'));
  check('Recite only: no opener (none switched on)', !reciteOnly.rounds.some((r) => r.role === 'opener'));

  // Nothing on at all: the fallback still reviews every verse.
  const none = buildMixPlan(fullInput([]), seeded(5));
  check('Nothing switched on: falls back to Recite for every unit', none.rounds.length === none.units.length && none.rounds.every((r) => r.format === 'recite'));

  // Only Practice switched on: each Practice round is followed by Recite.
  const practiceOnly = buildMixPlan(fullInput(['teachIt', 'scramble']), seeded(6));
  const pairsOk = practiceOnly.rounds.every((r, i) =>
    r.counts ? r.format === 'recite' && r.role === 'follow' : practiceOnly.rounds[i + 1]?.format === 'recite'
  );
  check('Only Practice on: every Practice round is followed by Recite', pairsOk, practiceOnly.rounds.map((r) => r.format));

  // Prerequisites.
  const noCtxPlan = (seed: number) =>
    buildMixPlan({ due: [psalm[0]], pool: psalm, sectionsFor: () => null, enabled: ['keepGoing', 'recite'] }, seeded(seed));
  let keepGoingWithoutContext = 0;
  for (let seed = 1; seed <= 50; seed++) if (noCtxPlan(seed).rounds.some((r) => r.format === 'keepGoing')) keepGoingWithoutContext++;
  check('Keep going is skipped with no earlier started verse', keepGoingWithoutContext === 0, keepGoingWithoutContext);
  check(
    'Keep going only on: falls back to Recite without context',
    buildMixPlan({ due: [psalm[0]], pool: psalm, sectionsFor: () => null, enabled: ['keepGoing'] }, seeded(1)).rounds[0].format === 'recite'
  );
  check(
    'Keep going only on: used when there is context',
    buildMixPlan({ due: [psalm[2]], pool: psalm, sectionsFor: () => null, enabled: ['keepGoing'] }, seeded(1)).rounds[0].format === 'keepGoing'
  );

  const short = { due: john, pool: john, sectionsFor: () => null };
  // Only words of 4+ letters can be swapped, so a verse of short words has none.
  const tiny = [item('John', 11, 35, { 35: 'I am He, and so it is.' })];
  check(
    'Find the wrong word is skipped on a verse with no wrong word to plant',
    buildMixPlan({ due: tiny, pool: tiny, sectionsFor: () => null, enabled: ['findWrongWord'] }, seeded(1)).rounds[0].format === 'recite'
  );
  check(
    'Scramble is skipped on a verse with nothing to reorder ("Jesus wept."): Recite alone',
    buildMixPlan({ ...short, enabled: ['scramble'] }, seeded(1)).rounds.map((r) => r.format).join(',') === 'recite'
  );
  check(
    'Find the wrong word runs on verses that have one',
    buildMixPlan({ due: [psalm[3]], pool: [psalm[3]], sectionsFor: () => null, enabled: ['findWrongWord'] }, seeded(1)).rounds[0].format === 'findWrongWord'
  );

  const twoSections: ChapterSections = { ...matt7Sections, starts: [1, 6] };
  const small = { due: matt.slice(0, 8), pool: matt, sectionsFor: sectionsFor([twoSections]) };
  const smallPlan = buildMixPlan({ ...small, enabled: ['whichSection', 'putInOrder'] }, seeded(1));
  check(
    'Put in order / Which section need 3+ sections: with 2, no opener and no Which section',
    smallPlan.rounds.every((r) => r.format === 'recite'),
    smallPlan.rounds.map((r) => r.format)
  );
  const stretchPlan = buildMixPlan({ due: psalm, pool: psalm, sectionsFor: () => null, enabled: ['whichSection', 'putInOrder'] }, seeded(1));
  check('...and never on stretches', stretchPlan.rounds.every((r) => r.format === 'recite'));
  let putInOrderAsMain = 0;
  for (let seed = 1; seed <= 100; seed++) {
    putInOrderAsMain += buildMixPlan(fullInput(), seeded(seed)).rounds.filter((r) => r.format === 'putInOrder' && r.role !== 'opener').length;
  }
  check('Put in order only ever opens a chapter', putInOrderAsMain === 0, putInOrderAsMain);
}

// ------------------------------------------------------------- honesty ----
console.log('Honesty');
{
  let creditedByPractice = 0;
  let creditedOutsideRound = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const plan = buildMixPlan(fullInput(), seeded(seed));
    let s = mixReducer(startMix(plan), { type: 'start' });
    while (s.status === 'running') {
      // A misbehaving screen: every round, Practice too, reports a perfect run
      // for every verse in the session.
      const all: Record<string, MixVerseResult> = {};
      plan.units.forEach((u) => u.verseIds.forEach((id) => (all[id] = { mode: 'speak', accuracy: 1, perfect: true })));
      const round = currentRound(s)!;
      s = mixReducer(s, { type: 'result', perVerse: all });
      s.newCredits.forEach((c) => {
        if (!FORMATS[c.format].counts || !round.counts) creditedByPractice++;
        if (!round.verseIds.includes(c.verseId)) creditedOutsideRound++;
      });
    }
  }
  check('No verse is ever credited by a Practice round', creditedByPractice === 0, creditedByPractice);
  check('A round only credits its own verses', creditedOutsideRound === 0, creditedOutsideRound);

  // Practice alone: skip every counting round, report on every Practice one.
  let practiceOnlyCredits = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const plan = buildMixPlan(fullInput(), seeded(seed));
    let s = mixReducer(startMix(plan), { type: 'start' });
    while (s.status === 'running') {
      const round = currentRound(s)!;
      s = round.counts ? mixReducer(s, { type: 'skip' }) : mixReducer(s, { type: 'result', perVerse: resultFor(plan, s) });
    }
    practiceOnlyCredits += s.credits.length;
    if (seed === 1) check('...and those verses are listed as not reviewed', mixSummary(s).notCovered.length === mixSummary(s).verses);
  }
  check('Doing only the Practice rounds credits nothing', practiceOnlyCredits === 0, practiceOnlyCredits);

  // Skipping a Practice round still leaves its counting round.
  const plan = buildMixPlan(fullInput(['teachIt']), seeded(2));
  let s = mixReducer(startMix(plan), { type: 'start' });
  check('Teach-It on: the first round is Practice', currentRound(s)?.format === 'teachIt');
  s = mixReducer(s, { type: 'skip' });
  check('...skipping it leads to its counting round', currentRound(s)?.counts === true && currentRound(s)?.unitIndex === plan.rounds[0].unitIndex);

  // Keep going's context verse is in the thread but not in the round.
  const kgPlan = buildMixPlan({ due: [psalm[2]], pool: psalm, sectionsFor: () => null, enabled: ['keepGoing'] }, seeded(1));
  const kg = mixReducer(mixReducer(startMix(kgPlan), { type: 'start' }), {
    type: 'result',
    perVerse: {
      [psalm[1].verseId]: { mode: 'speak', accuracy: 1, perfect: true },
      [psalm[2].verseId]: { mode: 'speak', accuracy: 1, perfect: true },
    },
  });
  check('Keep going credits the due verse, never the context verse it cued from', kg.credits.map((c) => c.verseId).join() === psalm[2].verseId, kg.credits);
}

// -------------------------------------------------------------- credit ----
console.log('Credit');
{
  const plan = buildMixPlan({ due: psalm.slice(0, 2), pool: psalm, sectionsFor: () => null, enabled: ['recite'] }, seeded(1));
  const round = plan.rounds[0];
  const [a, b] = round.verseIds;
  const none = new Map<string, ReviewGrade>();
  const credits = roundCredits(round, { [a]: { mode: 'speak', accuracy: 0.9, perfect: false }, [b]: { mode: 'type', accuracy: 0.89 } }, none);
  check('90% is clean at the default', credits.find((c) => c.verseId === a)?.grade === 'clean');
  check('Under 90% is a stumble', credits.find((c) => c.verseId === b)?.grade === 'stumble');
  check('Under 50% is a blank', roundCredits(round, { [a]: { mode: 'speak', accuracy: 0.4 } }, none)[0].grade === 'blank');
  check(
    'The clean setting decides: 92% is a stumble at 95',
    roundCredits(round, { [a]: { mode: 'speak', accuracy: 0.92 } }, none, { cleanPct: 95, swapCanBeClean: true })[0].grade === 'stumble'
  );
  check('A clean that missed words is not perfect', credits.find((c) => c.verseId === a)?.perfect === false);
  check('Graded credits are not self-checks', credits.every((c) => !c.selfCheck && c.canMoveUp));
  const self = roundCredits(
    round,
    { [a]: { mode: 'self', answer: 'gotIt', perfect: true }, [b]: { mode: 'self', answer: 'blanked', spotMissed: true } },
    none
  );
  check('Self-check Got it is clean, never perfect, and marked a self-check', self[0].grade === 'clean' && self[0].perfect === false && self[0].selfCheck);
  check('Self-check Blanked is a blank', self[1].grade === 'blank');
  check('A missed spot check stops the move up', self[1].canMoveUp === false && self[0].canMoveUp === true);
  check(
    'Self-check Stumbled is a stumble',
    roundCredits(round, { [a]: { mode: 'self', answer: 'stumbled' } }, none)[0].grade === 'stumble'
  );
  const swap = roundCredits(round, { [a]: { mode: 'type', swap: { misses: 1, verses: 2 } }, [b]: { mode: 'type', swap: { misses: 1, verses: 2 } } }, none);
  check('Find the wrong word grades by the round rate (0.5 a verse is a stumble)', swap.every((c) => c.grade === 'stumble'));
  check(
    'Find the wrong word with clean off is a stumble at best',
    roundCredits(round, { [a]: { mode: 'type', swap: { misses: 0, verses: 2 } } }, none, { cleanPct: 90, swapCanBeClean: false })[0].grade === 'stumble'
  );
  check('A verse with no result gets no credit', roundCredits(round, { [a]: { mode: 'speak', accuracy: 1, perfect: true } }, none).length === 1);
  const cleanBefore = new Map<string, ReviewGrade>([[a, 'clean']]);
  check('A verse already clean this session is not credited again by a clean', roundCredits(round, { [a]: { mode: 'speak', accuracy: 1 } }, cleanBefore).length === 0);
  check(
    '...but is credited again when it went worse',
    roundCredits(round, { [a]: { mode: 'speak', accuracy: 0.6 } }, cleanBefore)[0]?.grade === 'stumble'
  );
  check(
    'A stumble is not undone by a later clean',
    roundCredits(round, { [a]: { mode: 'speak', accuracy: 1 } }, new Map<string, ReviewGrade>([[a, 'stumble']])).length === 0
  );

  // Overlapping stretches share a verse: covered twice, it takes the worse grade.
  const pPlan = buildMixPlan({ due: psalm, pool: psalm, sectionsFor: () => null, enabled: ['recite'] }, seeded(1));
  const shared = pPlan.units[0].verseIds.filter((id) => pPlan.units[1].verseIds.includes(id));
  const done = runAll(pPlan);
  check('Stretches overlap by a verse', shared.length === 1, pPlan.units.map((u) => u.verseIds));
  check('...and the shared verse, clean twice, is credited once', done.credits.filter((c) => c.verseId === shared[0]).length === 1);
  check('A full run credits every due verse once', done.credits.length === psalm.length && mixSummary(done).notCovered.length === 0);
  // Clean in the first stretch, stumbled in the second.
  let worse = mixReducer(startMix(pPlan), { type: 'start' });
  let n = 0;
  while (worse.status === 'running') {
    const acc = n === 1 ? (id: string) => (id === shared[0] ? 0.7 : 1) : 1;
    worse = mixReducer(worse, { type: 'result', perVerse: resultFor(pPlan, worse, acc) });
    n++;
  }
  check('Covered twice: clean then a stumble is sent again', worse.credits.filter((c) => c.verseId === shared[0]).map((c) => c.grade).join() === 'clean,stumble');
  check('...and the recap takes the worse', mixSummary(worse).grades.get(shared[0]) === 'stumble' && mixSummary(worse).stumbled.join() === shared[0]);

  // A whole session, all formats, everything passed.
  const full = runAll(buildMixPlan(fullInput(), seeded(9)));
  const sum = mixSummary(full);
  check('All formats, all passed: every due verse is clean', sum.clean.length === sum.verses && sum.missed.length === 0, sum);
  check('Finished status at the end', full.status === 'finished');

  // A miss shows in Where you slipped.
  const slipPlan = buildMixPlan(fullInput(['recite']), seeded(3));
  const target = matt[6].verseId; // Matthew 7:7, the "Ask" section.
  const slipped = runAll(slipPlan, (id) => (id === target ? 0.5 : 1));
  const slipSum = mixSummary(slipped);
  check('A slip is recorded as a stumble', slipSum.missed.join() === target && slipSum.stumbled.join() === target, slipSum.missed);
  check('...and its section is in Where you slipped', slipSum.slippedUnits.length === 1 && slipPlan.units[slipSum.slippedUnits[0]].label === 'Ask');
}

// ------------------------------------------------------------- reducer ----
console.log('Reducer');
{
  const plan = buildMixPlan(fullInput(), seeded(11));
  const ready = startMix(plan);
  check('Starts ready, nothing on screen', ready.status === 'ready' && currentRound(ready) === undefined);
  check('A result before start does nothing', mixReducer(ready, { type: 'result', perVerse: {} }) === ready);

  let s = mixReducer(ready, { type: 'start' });
  check('Start shows the first round', s.status === 'running' && currentRound(s)?.index === 0);

  // Run until a few counting rounds have credited, then stop.
  let countingDone = 0;
  while (s.status === 'running' && countingDone < 3) {
    const round = currentRound(s)!;
    s = mixReducer(s, { type: 'result', perVerse: resultFor(plan, s) });
    if (round.counts) countingDone++;
    check(`newCredits holds exactly round ${round.index}'s credits`, s.newCredits.every((c) => c.roundIndex === round.index));
  }
  const before = s.credits.map((c) => c.verseId);
  const stopped = mixReducer(s, { type: 'stop' });
  check('Stopping mid-session keeps every earlier credit', stopped.status === 'stopped' && stopped.credits.map((c) => c.verseId).join() === before.join() && before.length > 0, before.length);
  check('...and earns nothing new', stopped.newCredits.length === 0);
  const after = mixReducer(stopped, { type: 'result', perVerse: resultFor(plan, { ...stopped, pos: stopped.pos }) });
  check('Nothing after stop changes the credit', after.credits.length === stopped.credits.length && after.status === 'stopped');
  const stopSum = mixSummary(stopped);
  check('The recap counts the rest as not reviewed', stopSum.clean.length === before.length && stopSum.notCovered.length === stopSum.verses - before.length);

  // Stopping before starting is fine and credits nothing.
  const early = mixReducer(startMix(plan), { type: 'stop' });
  check('Stop before start: stopped, no credit', early.status === 'stopped' && early.credits.length === 0);

  // An empty session finishes at once.
  const empty = buildMixPlan({ due: [], pool: [], sectionsFor: () => null, enabled: DEFAULT_MIX_FORMATS }, seeded(1));
  check('No due verses: starting finishes at once', mixReducer(startMix(empty), { type: 'start' }).status === 'finished');

  // Skip moves on without credit.
  const one = buildMixPlan({ due: [psalm[0]], pool: psalm, sectionsFor: () => null, enabled: ['recite'] }, seeded(1));
  const skipped = mixReducer(mixReducer(startMix(one), { type: 'start' }), { type: 'skip' });
  check('Skipping the only counting round finishes with no credit', skipped.status === 'finished' && skipped.credits.length === 0);
  check('...and the log says it was skipped', skipped.log.length === 1 && skipped.log[0].skipped);

  const events: MixEvent[] = [{ type: 'start' }, { type: 'skip' }];
  check('Events never throw past the end', !!events.reduce((acc, e) => mixReducer(acc, e), skipped));
}

// ------------------------------------------------------------- settings ----
console.log('Settings');
{
  check('Nothing saved: every format on', readMixFormats(undefined).length === DEFAULT_MIX_FORMATS.length);
  check('Unknown ids are dropped', readMixFormats(['recite', 'bogus']).join() === 'recite');
  check('Saved order is put back in Settings order', readMixFormats(['teachIt', 'recite']).join() === 'recite,teachIt');
  check('An empty list stays empty (Recite still runs as the fallback)', readMixFormats([]).length === 0);
}

// ------------------------------------------------- counts / practice ----
console.log('Counts or Practice, per format');
{
  const usual = readMixCounts(undefined);
  check('Nothing saved: each format keeps its usual tag', DEFAULT_MIX_FORMATS.every((f) => usual[f] === FORMATS[f].counts));
  check('Recite can never be switched to Practice', readMixCounts({ recite: false }).recite === true);
  check('Junk values are ignored', readMixCounts({ scramble: 'yes' }).scramble === FORMATS.scramble.counts);
  check('Put in order, Which section and Teach-It can never count', (['putInOrder', 'whichSection', 'teachIt'] as const).every((f) => !readMixCounts({ [f]: true })[f] && !countsAsReview(f, { [f]: true })));

  // Scramble switched to Counts: it reviews on its own, no follow round.
  const scrCounts = buildMixPlan({ ...fullInput(['scramble']), counts: { scramble: true } }, seeded(7));
  const scr = scrCounts.rounds.filter((r) => r.format === 'scramble');
  check('Scramble set to Counts: its rounds count', scr.length > 0 && scr.every((r) => r.counts), scr.length);
  check('Scramble set to Counts: no follow rounds', !scrCounts.rounds.some((r) => r.role === 'follow'));

  // Find the wrong word switched to Practice: it never credits, and a counting round follows.
  const fwPlan = buildMixPlan({ ...fullInput(['findWrongWord', 'recite']), counts: { findWrongWord: false } }, seeded(8));
  const fwOk = fwPlan.rounds.every((r, i) => r.format !== 'findWrongWord' || (!r.counts && fwPlan.rounds[i + 1]?.counts));
  check('Find the wrong word set to Practice: never counts, always followed', fwOk, fwPlan.rounds.map((r) => `${r.format}:${r.counts}`));
}

// ------------------------------------------------- resuming a day ----
console.log('Picking up where the last session stopped');
{
  // Matthew 7:1-11 graded earlier today (sections 1-3), the rest not yet; 7:12 graded yesterday.
  const day = '2026-10-22';
  const graded = matt.map((q) =>
    q.verseNumber <= 11
      ? { ...q, dayResult: { day, grade: 'clean' as ReviewGrade } }
      : q.verseNumber === 12
        ? { ...q, dayResult: { day: '2026-10-21', grade: 'clean' as ReviewGrade } }
        : q
  );
  const left = notGradedOn(graded, day);
  check('Verses graded today are left out', left.every((q) => q.verseNumber >= 12) && left.length === 18, left.map((q) => q.verseNumber));
  check('A grade from an earlier day does not count as done', left.some((q) => q.verseNumber === 12));
  const plan = buildMixPlan({ ...fullInput(['recite']), due: left }, seeded(9));
  const first = plan.units[plan.rounds.find((r) => r.role !== 'opener')!.unitIndex];
  check('The next session starts at the first section not done (Golden rule)', first.start === 12 && first.label === 'Golden rule', first);
}

console.log(failures === 0 ? '\nAll mix checks passed.' : `\n${failures} mix check(s) FAILED.`);
if (failures > 0) process.exit(1);
