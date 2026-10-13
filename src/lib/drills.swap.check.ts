// Regression assertions for Spot the swap's decoy picker, run by
// `npm run check:swap`.
//
// Decoys are random, so every property is checked over many rounds. What
// matters: a decoy is the same kind of word as the one it replaces (a
// past-tense verb for a past-tense verb), about the same length, never the
// original word or another form of it -- and Hebrew/Greek still work with
// no tagger at all.

import { buildSwapVerses, englishSwapClasses, isSameWordFamily, SWAP_LENGTH_TOLERANCE, DrillVerse } from './drills';
import { BIBLE_DECOY_WORDS, SwapWordClass } from './swapDecoyWords';
import { normalizeToken } from './recitation';
import { splitWords } from './textScript';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const ROUNDS = 150;

// BSB, the shipping default.
const PASSAGES: { name: string; verses: DrillVerse[] }[] = [
  {
    name: 'John 3:16',
    verses: [{ book: 'John', chapter: 3, verse: 16, translationId: 'BSB', text: 'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.' }],
  },
  {
    name: 'Romans 8:28',
    verses: [{ book: 'Romans', chapter: 8, verse: 28, translationId: 'BSB', text: 'And we know that God works all things together for the good of those who love Him, who are called according to His purpose.' }],
  },
  {
    name: 'Psalm 23:1-3',
    verses: [
      { book: 'Psalms', chapter: 23, verse: 1, translationId: 'BSB', text: 'The LORD is my shepherd; I shall not want.' },
      { book: 'Psalms', chapter: 23, verse: 2, translationId: 'BSB', text: 'He makes me lie down in green pastures; He leads me beside quiet waters.' },
      { book: 'Psalms', chapter: 23, verse: 3, translationId: 'BSB', text: 'He restores my soul; He guides me in the paths of righteousness for the sake of His name.' },
    ],
  },
  {
    name: 'Romans 8:28-29, 8:1',
    verses: [
      { book: 'Romans', chapter: 8, verse: 28, translationId: 'BSB', text: 'And we know that God works all things together for the good of those who love Him, who are called according to His purpose.' },
      { book: 'Romans', chapter: 8, verse: 29, translationId: 'BSB', text: 'For those God foreknew, He also predestined to be conformed to the image of His Son, so that He would be the firstborn among many brothers.' },
      { book: 'Romans', chapter: 8, verse: 1, translationId: 'BSB', text: 'Therefore, there is now no condemnation for those who are in Christ Jesus.' },
    ],
  },
  {
    name: 'Genesis 5:24',
    verses: [{ book: 'Genesis', chapter: 5, verse: 24, translationId: 'BSB', text: 'And Enoch walked with God, and then he was no more, because God had taken him away.' }],
  },
];

const FALLBACK_CLASS = new Map<string, SwapWordClass[]>();
BIBLE_DECOY_WORDS.forEach(({ word, cls }) => FALLBACK_CLASS.set(word, [...(FALLBACK_CLASS.get(word) ?? []), cls]));

for (const { name, verses } of PASSAGES) {
  console.log(`\n${name}`);
  // Every class each word of the passage takes somewhere in it -- a decoy
  // from the passage carries the class of one of its own appearances.
  const passageClasses = new Map<string, Set<SwapWordClass>>();
  verses.forEach((v) => {
    const classes = englishSwapClasses(v.text);
    splitWords(v.text).forEach((w, i) => {
      const cls = classes[i];
      if (!cls) return;
      const key = normalizeToken(w);
      passageClasses.set(key, (passageClasses.get(key) ?? new Set()).add(cls));
    });
  });

  const wrongClass: string[] = [];
  const wrongLength: string[] = [];
  const sameWord: string[] = [];
  const sameFamily: string[] = [];
  const echoes: string[] = [];
  const textChanged: string[] = [];
  let decoys = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const built = buildSwapVerses(verses);
    built.forEach((sv, vi) => {
      const originalWords = splitWords(verses[vi].text);
      const originalClasses = englishSwapClasses(verses[vi].text);
      if (sv.tokens.length !== originalWords.length) textChanged.push(sv.label);
      sv.tokens.forEach((t, wi) => {
        if (!t.isDecoy) {
          if (t.display !== originalWords[wi]) textChanged.push(`${t.display} vs ${originalWords[wi]}`);
          return;
        }
        decoys++;
        const orig = normalizeToken(originalWords[wi]);
        const fake = normalizeToken(t.display);
        const cls = originalClasses[wi];
        const sources = [...(passageClasses.get(fake) ?? []), ...(FALLBACK_CLASS.get(fake) ?? [])];
        if (!cls || !sources.includes(cls)) wrongClass.push(`${orig}(${cls}) -> ${fake}(${sources.join('/')})`);
        if (Math.abs(orig.length - fake.length) > SWAP_LENGTH_TOLERANCE) wrongLength.push(`${orig} -> ${fake}`);
        if (orig === fake) sameWord.push(orig);
        if (isSameWordFamily(orig, fake)) sameFamily.push(`${orig} -> ${fake}`);
        const around = [sv.tokens[wi - 1], sv.tokens[wi + 1]].filter(Boolean).map((n) => normalizeToken(n.display));
        if (around.includes(fake)) echoes.push(sv.tokens.map((n) => n.display).join(' '));
      });
    });
  }
  check(`produces at least one decoy a round (${decoys} over ${ROUNDS} rounds)`, decoys >= ROUNDS);
  check('every decoy is the same word class and form', wrongClass.length === 0, wrongClass.slice(0, 5));
  check(`every decoy is within ±${SWAP_LENGTH_TOLERANCE} letters`, wrongLength.length === 0, wrongLength.slice(0, 5));
  check('no decoy is the original word', sameWord.length === 0, sameWord.slice(0, 5));
  check('no decoy is another form of the original', sameFamily.length === 0, sameFamily.slice(0, 5));
  check('no decoy repeats the word next to it ("Christ Christ")', echoes.length === 0, echoes.slice(0, 2));
  check('non-decoy words are untouched', textChanged.length === 0, textChanged.slice(0, 5));
}

console.log('\nTagging in context');
const romans = englishSwapClasses(PASSAGES[1].verses[0].text);
const romansWords = splitWords(PASSAGES[1].verses[0].text);
check('"love" in "those who love Him" is a base verb', romans[romansWords.indexOf('love')] === 'verb');
check('"works" in "God works all things" is an -s verb', romans[romansWords.indexOf('works')] === 'verb-s');
check('"called" in "who are called" is a participle', romans[romansWords.indexOf('called')] === 'verb-en');
check('"good" in "the good of those" is a noun', romans[romansWords.indexOf('good')] === 'noun');
check('"according" is never swapped', romans[romansWords.indexOf('according')] === null);
check('"things" is a plural noun', romans[romansWords.indexOf('things')] === 'nouns');
const ENOCH = PASSAGES[PASSAGES.length - 1].verses;
const enoch = splitWords(ENOCH[0].text);
const enochClasses = englishSwapClasses(ENOCH[0].text);
check('"walked" is past tense', enochClasses[enoch.indexOf('walked')] === 'verb-ed');
const r829 = 'For those God foreknew, He also predestined to be conformed to the image of His Son, so that He would be the firstborn among many brothers.';
check('a word the tagger only guessed at ("foreknew") is never swapped', englishSwapClasses(r829)[splitWords(r829).indexOf('foreknew,')] === null);
check('"taken" in "had taken" is a participle', enochClasses[enoch.indexOf('taken')] === 'verb-en');
const enochDecoys = new Set<string>();
for (let r = 0; r < ROUNDS; r++) {
  buildSwapVerses(ENOCH)[0].tokens.forEach((t, i) => {
    if (t.isDecoy && i === enoch.indexOf('walked')) enochDecoys.add(normalizeToken(t.display));
  });
}
check(
  '"walked" is only ever replaced by a past-tense verb (from the built-in list)',
  enochDecoys.size > 0 && [...enochDecoys].every((d) => FALLBACK_CLASS.get(d)?.includes('verb-ed')),
  [...enochDecoys]
);

console.log('\nWord families');
check('love / loved', isSameWordFamily('love', 'loved'));
check('believe / believing', isSameWordFamily('believe', 'believing'));
check('faith / faithful', isSameWordFamily('faith', 'faithful'));
check('walked / spoke are different words', !isSameWordFamily('walked', 'spoke'));
check('shepherd / righteousness are different words', !isSameWordFamily('shepherd', 'righteousness'));

console.log('\nCasing');
const capDecoys: string[] = [];
for (let r = 0; r < ROUNDS; r++) {
  buildSwapVerses(PASSAGES[0].verses)[0].tokens.forEach((t) => {
    if (t.isDecoy && t.original && /^[A-Z]/.test(t.original) !== /^[A-Z]/.test(t.display)) capDecoys.push(`${t.original} -> ${t.display}`);
  });
}
check('a decoy keeps the original word\'s capitalization', capDecoys.length === 0, capDecoys.slice(0, 5));

console.log('\nHebrew / Greek (no tagger, length only)');
const HEBREW: DrillVerse[] = [
  { book: 'Genesis', chapter: 1, verse: 1, translationId: 'HEBGRK', text: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃' },
  { book: 'Genesis', chapter: 1, verse: 3, translationId: 'HEBGRK', text: 'וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַֽיְהִי־אוֹר׃' },
];
const GREEK: DrillVerse[] = [
  { book: 'John', chapter: 1, verse: 1, translationId: 'HEBGRK', text: 'Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν, καὶ θεὸς ἦν ὁ λόγος.' },
];
for (const [label, verses, script] of [['Hebrew', HEBREW, 'hebrew'], ['Greek', GREEK, 'greek']] as const) {
  let decoys = 0;
  const bad: string[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    buildSwapVerses(verses).forEach((sv, vi) => {
      const words = splitWords(verses[vi].text, script);
      sv.tokens.forEach((t, i) => {
        if (!t.isDecoy) return;
        decoys++;
        const orig = normalizeToken(words[i], script);
        const fake = normalizeToken(t.display, script);
        if (orig === fake || Math.abs(orig.length - fake.length) > SWAP_LENGTH_TOLERANCE) bad.push(`${orig} -> ${fake}`);
        // A decoy must be in the verse's own script, never English.
        if (/[a-z]/i.test(t.display)) bad.push(`latin decoy ${t.display}`);
      });
    });
  }
  check(`${label}: builds and produces decoys (${decoys})`, decoys > 0);
  check(`${label}: decoys differ from the original and are within ±${SWAP_LENGTH_TOLERANCE}`, bad.length === 0, bad.slice(0, 5));
}

console.log('\nSample rounds:');
for (const { verses } of PASSAGES) {
  for (let r = 0; r < 3; r++) {
    console.log('  ' + buildSwapVerses(verses).map((sv) => sv.tokens.map((t) => (t.isDecoy ? `[${t.display}]` : t.display)).join(' ')).join(' / '));
  }
}

console.log(failures === 0 ? '\nAll swap checks passed.' : `\n${failures} swap check(s) FAILED.`);
if (failures > 0) process.exit(1);
