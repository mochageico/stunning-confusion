// Regression assertions for Spot the gap's pure logic, run by
// `npm run check:spotgap`.

import { DrillVerse } from './drills';
import { OPENING_WORDS, openingAccuracy, openingOf } from './openings';
import { blankCorrect, buildGapRound, drawSwapCount, GAP_MAX_BLANKS, GAP_MAX_SWAPS, GapAnswers, gapFits, GapRound, scoreGap } from './spotGap';

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

const TEXTS = [
  'The LORD is my shepherd; I shall not want.',
  'He maketh me to lie down in green pastures: he leadeth me beside the still waters.',
  'He restoreth my soul: he leadeth me in the paths of righteousness for his name’s sake.',
  'Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.',
  'Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.',
  'Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.',
];
const psalm = (n: number): DrillVerse[] =>
  TEXTS.slice(0, n).map((text, i) => ({ book: 'Psalms', chapter: 23, verse: i + 1, text, translationId: 'KJV' }));

const noAnswers: GapAnswers = { flagged: new Set(), typed: {}, numbers: {} };

console.log('Blank answers');
{
  check('One letter per hidden word', blankCorrect('yt', ['Yea,', 'though'], 'latin'));
  check('Capitals, spaces and punctuation are ignored', blankCorrect(' Y, T ', ['Yea,', 'though'], 'latin'));
  check('Words typed out count when each starts right', blankCorrect('yea though', ['Yea,', 'though'], 'latin'));
  check('A wrong letter fails', !blankCorrect('yh', ['Yea,', 'though'], 'latin'));
  check('Too few letters fails', !blankCorrect('y', ['Yea,', 'though'], 'latin'));
  check('Empty fails', !blankCorrect('', ['Yea,', 'though'], 'latin'));
}

console.log('Building a round');
{
  check('Swap count is always 0 to 5', Array.from({ length: 200 }, (_, i) => drawSwapCount(seeded(i + 1))).every((n) => n >= 0 && n <= GAP_MAX_SWAPS) && GAP_MAX_SWAPS === 5);
  const counts = new Set(Array.from({ length: 600 }, (_, i) => drawSwapCount(seeded(i * 7 + 3))));
  check('...and all six come up', counts.size === 6, [...counts]);

  let bad = 0;
  let noBlank = 0;
  let overBlank = 0;
  let overSwap = 0;
  let overlap = 0;
  let missingOpening = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const n = 2 + (seed % 5);
    const round = buildGapRound(psalm(n), { rng: seeded(seed) });
    if (!round) {
      bad++;
      continue;
    }
    if (round.blanks.length < 1) noBlank++;
    if (round.blanks.length > GAP_MAX_BLANKS) overBlank++;
    const planted = round.verses.reduce((c, v) => c + v.words.filter((w) => w.isDecoy).length, 0);
    if (planted > GAP_MAX_SWAPS) overSwap++;
    if (round.verses.some((v) => v.words.some((w) => w.isDecoy && w.blank !== undefined))) overlap++;
    if (!round.blanks.some((b) => b.verseIndex >= 1) && n > 1) missingOpening++;
  }
  check('A round builds for 2 to 6 verses', bad === 0, bad);
  check('Every round has at least one blank', noBlank === 0, noBlank);
  check('Never more than five blanks', overBlank === 0 && GAP_MAX_BLANKS === 5, overBlank);
  check('Never more than five planted words', overSwap === 0, overSwap);
  check('A planted word never sits on a blank', overlap === 0, overlap);
  check('A blank is never only on the first verse', missingOpening === 0, missingOpening);

  const six = buildGapRound(psalm(6), { rng: seeded(11) })!;
  check('Six verses get five blanks', six.blanks.length === 5, six.blanks);
  const openings = six.blanks.filter((b) => TEXTS[b.verseIndex].toLowerCase().startsWith(b.words[0].toLowerCase().replace(/[^a-z]/g, '')));
  check('Three of them are verse openings', openings.length >= 3, six.blanks);
  check('Some blanks hide three words', Array.from({ length: 60 }, (_, i) => buildGapRound(psalm(6), { rng: seeded(i + 1) })!).some((r) => r.blanks.some((b) => b.words.length === 3)));

  const one = buildGapRound(psalm(1).concat([]), { rng: seeded(4) })!;
  check('One verse still gets exactly one blank', one.blanks.length === 1, one.blanks);
  check('A single verse never hides its number', !buildGapRound(psalm(1), { hideNumbers: true, rng: seeded(4) })!.hideNumbers);

  const shuffled = Array.from({ length: 100 }, (_, i) => buildGapRound(psalm(4), { shuffle: true, rng: seeded(i + 1) })!);
  check('Shuffled order is never the passage in order', shuffled.every((r) => !r.verses.every((v, i) => v.verseIndex === i)));
  check('...and keeps every verse once', shuffled.every((r) => r.verses.map((v) => v.verseIndex).sort().join() === '0,1,2,3'));
  const plain = buildGapRound(psalm(4), { rng: seeded(2) })!;
  check('Without shuffle the verses stay in order', plain.verses.every((v, i) => v.verseIndex === i));

  check('Nothing builds from verses too short to blank', buildGapRound([{ book: 'John', chapter: 11, verse: 35, text: 'Jesus wept.' }]) === null);
  check('gapFits agrees', !gapFits([{ book: 'John', chapter: 11, verse: 35, text: 'Jesus wept.' }]) && gapFits(psalm(2)));

  // Hebrew gets the same round: initials, not whole words.
  const heb: DrillVerse[] = [
    { book: 'Genesis', chapter: 1, verse: 1, text: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃', translationId: 'HEBGRK' },
    { book: 'Genesis', chapter: 1, verse: 2, text: 'וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ וְחֹשֶׁךְ עַל־פְּנֵי תְהוֹם', translationId: 'HEBGRK' },
  ];
  check('Hebrew builds a round', !!buildGapRound(heb, { rng: seeded(3) }));
}

console.log('Scoring');
{
  const round: GapRound = buildGapRound(psalm(4), { rng: seeded(21), hideNumbers: true })!;
  const perfect: GapAnswers = {
    flagged: new Set(round.verses.flatMap((v) => v.words.filter((w) => w.isDecoy).map((w) => w.index))),
    typed: Object.fromEntries(round.blanks.map((b) => [b.id, b.words.map((w) => w[0]).join('')])),
    numbers: Object.fromEntries(round.verses.map((v) => [v.verseIndex, String(v.verse)])),
  };
  const good = scoreGap(round, perfect);
  check('Everything right is perfect with accuracy 1', good.perfect && good.accuracy === 1, good);
  check('...for every verse too', good.perVerse.every((v) => v.perfect && v.accuracy === 1));

  const doNothing = scoreGap(round, noAnswers);
  check('Answering nothing is not perfect', !doNothing.perfect && doNothing.accuracy < 1, doNothing);
  check('Every blank is a miss when left empty', doNothing.blanksRight === 0 && doNothing.blanks === round.blanks.length);

  const blankVerse = round.blanks[0].verseIndex;
  const wrongBlank = scoreGap(round, { ...perfect, typed: { ...perfect.typed, [round.blanks[0].id]: 'zz' } });
  const row = wrongBlank.perVerse.find((v) => v.verseIndex === blankVerse)!;
  check('A wrong blank marks that verse', !row.perfect && row.accuracy < 1, row);

  const target = round.verses[0].verseIndex;
  const wrongNumber = scoreGap(round, { ...perfect, numbers: { ...perfect.numbers, [target]: '99' } });
  check('A wrong number marks that verse', wrongNumber.perVerse.find((v) => v.verseIndex === target)!.numberRight === false && !wrongNumber.perfect);

  // Flag a real word.
  const real = round.verses[0].words.find((w) => !w.isDecoy && w.blank === undefined)!;
  const flagged = scoreGap(round, { ...perfect, flagged: new Set([...perfect.flagged, real.index]) });
  check('Flagging a real word is a false alarm and counts against the verse', flagged.falseAlarms === 1 && !flagged.perfect, flagged);

  // With numbers showing, there are no number items.
  const shown = buildGapRound(psalm(4), { rng: seeded(21) })!;
  check('Showing numbers adds no number items', scoreGap(shown, noAnswers).numbers === 0);

  // An untested verse takes the section's accuracy.
  const withUntested = scoreGap(shown, noAnswers);
  const untested = withUntested.perVerse.filter((v) => v.items === 0);
  check('A verse with nothing tested takes the section accuracy', untested.every((v) => v.accuracy === withUntested.accuracy));
}

console.log('Openings');
{
  const v: DrillVerse = { book: 'Psalms', chapter: 23, verse: 4, text: 'Yea, though I walk through the valley of the shadow of death', translationId: 'KJV' };
  const o = openingOf(v);
  check('An opening is the first three words', o.words.length === OPENING_WORDS && o.words.join(' ') === 'Yea, though I', o.words);
  check('...stood for by their first letters', o.initials.join('') === 'yti', o.initials);
  check('All three letters right is 1', openingAccuracy('yti', o.initials, o.script) === 1);
  check('Capitals and spaces do not matter', openingAccuracy('Y T I', o.initials, o.script) === 1);
  check('Two of three right is two thirds', Math.abs(openingAccuracy('ytx', o.initials, o.script) - 2 / 3) < 1e-9);
  check('Nothing typed is 0', openingAccuracy('', o.initials, o.script) === 0);
  check('A short verse has a shorter opening', openingOf({ book: 'John', chapter: 11, verse: 35, text: 'Jesus wept.' }).words.length === 2);
}

console.log(failures === 0 ? '\nall spot-the-gap checks passed' : `\n${failures} spot-the-gap check(s) FAILED`);
if (failures > 0) process.exit(1);
