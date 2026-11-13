// Assertions for References (lib/referenceQuiz.ts), run by `npm run check:refquiz`.

import type { DrillVerse } from './drills';
import { buildRefRound, choiceWindow, refAskable, refChapters, referencesFit, refOpening, REF_MAX_CHOICES } from './referenceQuiz';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? '');
  }
}

// A seeded random, so failures repeat.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const v = (book: string, chapter: number, verse: number, translationId = 'BSB', text = `Words of ${book} ${chapter}:${verse} go on for a while here.`): DrillVerse => ({
  book,
  chapter,
  verse,
  text,
  translationId,
});
const rom = [28, 29, 31, 32, 33, 34, 35, 36].map((n) => v('Romans', 8, n));
const php = [6, 7].map((n) => v('Philippians', 4, n));
const lone = v('John', 3, 16);

check('one verse is not enough', !referencesFit([lone]));
check('two verses in one chapter fit', referencesFit(php));
check('two verses in two chapters do not fit', !referencesFit([lone, v('Romans', 8, 1)]));
check('a lone verse in its chapter sits the round out', !refAskable([...php, lone]).some((x) => x.book === 'John'));
check('Hebrew verses are left out', !referencesFit([v('Genesis', 1, 1, 'HEBGRK'), v('Genesis', 1, 2, 'HEBGRK')]));
check('Greek verses are left out', !referencesFit([v('John', 1, 1, 'HEBGRK'), v('John', 1, 2, 'HEBGRK')]));
check('same chapter, two translations are two chapters', refChapters([v('Romans', 8, 1, 'BSB'), v('Romans', 8, 1, 'ESV')]).length === 0);

// The choice window.
for (let seed = 1; seed <= 40; seed++) {
  const rand = seeded(seed);
  for (const target of rom) {
    const w = choiceWindow(rom, target, rand);
    const nums = w.map((x) => x.verse);
    const idx = rom.indexOf(w[0]);
    const consecutive = w.every((x, i) => rom[idx + i] === x);
    if (w.length !== REF_MAX_CHOICES || !nums.includes(target.verse) || !consecutive) {
      check(`window for v${target.verse} (seed ${seed}) is 4 neighboring picks with the target`, false, nums);
    }
  }
}
check('every window is 4 neighboring picks that include the target', true);
check('a 2-verse chapter gives 2 choices', choiceWindow(php, php[0]).length === 2);
check('choices come only from the picks (no v30 between 29 and 31)', !rom.some((t) => choiceWindow(rom, t).some((x) => x.verse === 30)));

// The target lands in every slot over many seeds.
const slots = new Set<number>();
for (let seed = 1; seed <= 200; seed++) {
  const target = rom[4];
  slots.add(choiceWindow(rom, target, seeded(seed)).findIndex((x) => x === target));
}
check('the target can sit in any of the 4 slots', slots.size === 4, [...slots]);

// Rounds.
const round = buildRefRound([...rom, ...php, lone], 'both', seeded(7));
check('a round asks every askable verse once', round.length === rom.length + php.length);
check('a round mixes chapters', new Set(round.map((q) => q.target.book)).size === 2);
check('choices stay in the target\'s chapter', round.every((q) => q.choices.every((c) => c.book === q.target.book && c.chapter === q.target.chapter)));
check('Verse -> number keeps verse order', buildRefRound(rom, 'v2n', seeded(3)).every((q) => q.choices.every((c, i) => i === 0 || c.verse > q.choices[i - 1].verse)));
check('Both mixes the directions', new Set(buildRefRound(rom, 'both', seeded(11)).map((q) => q.direction)).size === 2);
const missed = [rom[2], php[1]];
const again = buildRefRound([...rom, ...php], 'v2n', seeded(5), missed);
check('the missed-ones round asks only those', again.length === 2 && again.every((q) => missed.includes(q.target)));
check('the missed-ones round still chooses among all picks', again.find((q) => q.target === rom[2])!.choices.length === 4);

// Openings.
check('opening is the first 7 words', refOpening(v('Romans', 8, 31, 'BSB', 'What then shall we say in response to these things?')) === 'What then shall we say in response…');
check('a short verse has no ellipsis', refOpening(v('John', 11, 35, 'BSB', 'Jesus wept.')) === 'Jesus wept.');

if (failures > 0) {
  console.log(`\ncheck:refquiz — ${failures} failure(s).`);
  process.exit(1);
}
console.log('\ncheck:refquiz — all assertions passed.');
