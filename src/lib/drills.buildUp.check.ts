// Regression assertions for Build up's chunker and stage builder, run by
// `npm run check:buildup`.
//
// The invariant that matters most is the first one below: the bites must
// rejoin to exactly the original verse, word for word, in order. Every other
// property here is about the drill feeling right; that one is about the app
// not quietly showing someone a corrupted verse to memorize. A chunker that
// drops "not" from "should not perish" teaches the opposite of scripture.

import {
  splitIntoBites,
  buildUpStages,
  BITE_TARGET_WORDS,
  BiteSize,
  BuildDirection,
} from './drills';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

// Real verses, chosen for range: heavily punctuated, barely punctuated, very
// short, very long, and one with quotes and an em-dash.
const SAMPLES: { ref: string; text: string }[] = [
  { ref: 'John 3:16', text: 'For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.' },
  { ref: 'John 11:35', text: 'Jesus wept.' },
  { ref: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.' },
  { ref: 'Genesis 1:1', text: 'In the beginning, God created the heavens and the earth.' },
  { ref: 'Romans 8:28', text: 'And we know that for those who love God all things work together for good, for those who are called according to his purpose.' },
  { ref: 'Ephesians 2:8-9', text: 'For by grace you have been saved through faith. And this is not your own doing; it is the gift of God, not a result of works, so that no one may boast.' },
  { ref: 'Matthew 4:4', text: 'But he answered, "It is written, \'Man shall not live by bread alone, but by every word that comes from the mouth of God.\'"' },
  { ref: 'Revelation 22:13', text: 'I am the Alpha and the Omega, the first and the last, the beginning and the end.' },
];

const SIZES: BiteSize[] = ['short', 'medium', 'long'];

// ---------------------------------------------------------------------------
// The lossless invariant.
// ---------------------------------------------------------------------------
{
  let allLossless = true;
  const offenders: string[] = [];
  SAMPLES.forEach(({ ref, text }) => {
    SIZES.forEach((size) => {
      const rejoined = splitIntoBites(text, size).join(' ');
      const original = text.split(/\s+/).filter(Boolean).join(' ');
      if (rejoined !== original) {
        allLossless = false;
        offenders.push(`${ref}/${size}`);
      }
    });
  });
  check('bites rejoin to the exact original verse at every size', allLossless, offenders);
}

// ---------------------------------------------------------------------------
// Bite shape.
// ---------------------------------------------------------------------------
{
  let noEmpties = true;
  let noFragments = true;
  let noRunaways = true;
  const runaways: string[] = [];

  SAMPLES.forEach(({ ref, text }) => {
    SIZES.forEach((size) => {
      const bites = splitIntoBites(text, size);
      bites.forEach((b) => {
        const len = b.split(/\s+/).filter(Boolean).length;
        if (len === 0) noEmpties = false;
        // A 2-word floor, except when the whole verse is that short.
        if (len < 2 && bites.length > 1) noFragments = false;
        // Generous ceiling: the clause pass can legitimately leave a long
        // unpunctuated run, but it should never be wildly past the target.
        if (len > BITE_TARGET_WORDS[size] * 2.5) {
          noRunaways = false;
          runaways.push(`${ref}/${size}: ${len} words`);
        }
      });
    });
  });

  check('no empty bites', noEmpties);
  check('no sub-2-word fragments except in one-bite verses', noFragments);
  check('no bite runs wildly past its target length', noRunaways, runaways);
}

{
  // Punctuation should be doing the work on a well-punctuated verse: John
  // 3:16's commas alone imply the breaks a reader would make out loud.
  const bites = splitIntoBites(SAMPLES[0].text, 'medium');
  check('John 3:16 breaks on its commas', bites[0] === 'For God so loved the world,', bites);
  check('a very short verse yields exactly one bite', splitIntoBites('Jesus wept.', 'medium').length === 1);
  check('empty text yields no bites', splitIntoBites('   ', 'medium').length === 0);
}

{
  // Smaller bite size must never mean fewer pieces.
  let monotonic = true;
  SAMPLES.forEach(({ text }) => {
    const short = splitIntoBites(text, 'short').length;
    const long = splitIntoBites(text, 'long').length;
    if (short < long) monotonic = false;
  });
  check('"short" never produces fewer bites than "long"', monotonic);
}

// ---------------------------------------------------------------------------
// Stage accumulation.
// ---------------------------------------------------------------------------
const oneVerse = [{ text: SAMPLES[0].text }];
const threeVerses = [{ text: 'Verse one here, with a clause.' }, { text: 'Verse two here, with a clause.' }, { text: 'Verse three here, with a clause.' }];

{
  const stages = buildUpStages(oneVerse, { size: 'medium', direction: 'forward' });
  const bites = splitIntoBites(SAMPLES[0].text, 'medium');

  check('one stage per bite', stages.length === bites.length, { stages: stages.length, bites: bites.length });
  check('a single verse gets no reassemble pass', stages.every((s) => s.phase === 'bite'));
  check('the first stage holds one segment', stages[0].segments.length === 1);
  check('the last stage holds the whole verse', stages[stages.length - 1].segments.map((s) => s.text).join(' ') === bites.join(' '));
  check('every stage marks exactly one segment new', stages.every((s) => s.segments.filter((seg) => seg.isNew).length === 1));
  check('forward: stage 1 starts at the verse opening', stages[0].segments[0].text === bites[0]);
  check('step numbering is 1-based and complete', stages.every((s, i) => s.step === i + 1 && s.stepCount === stages.length));
}

{
  const forward = buildUpStages(oneVerse, { size: 'medium', direction: 'forward' });
  const backward = buildUpStages(oneVerse, { size: 'medium', direction: 'backward' });
  const bites = splitIntoBites(SAMPLES[0].text, 'medium');

  check('backward: stage 1 is the verse ENDING', backward[0].segments[0].text === bites[bites.length - 1], backward[0].segments);
  check('backward produces the same number of stages as forward', backward.length === forward.length);
  check(
    'backward still ends with the complete verse in reading order',
    backward[backward.length - 1].segments.map((s) => s.text).join(' ') === bites.join(' ')
  );

  // Direction decides what is ADDED when, never what the user reads. Every
  // stage's segments must sit in reading order regardless.
  const inReadingOrder = (direction: BuildDirection) =>
    buildUpStages(oneVerse, { size: 'medium', direction }).every((s) => {
      const positions = s.segments.map((seg) => bites.indexOf(seg.text));
      return positions.every((p, i) => i === 0 || p > positions[i - 1]);
    });
  check('forward stages read in verse order', inReadingOrder('forward'));
  check('backward stages read in verse order too', inReadingOrder('backward'));
}

{
  const stages = buildUpStages(threeVerses, { size: 'medium', direction: 'forward' });
  const biteStages = stages.filter((s) => s.phase === 'bite');
  const reassemble = stages.filter((s) => s.phase === 'reassemble');

  check('a multi-verse group earns a reassemble pass', reassemble.length === 3, reassemble.length);
  check('the reassemble pass comes last', stages.slice(biteStages.length).every((s) => s.phase === 'reassemble'));
  check('bite stages never mix two verses', biteStages.every((s) => typeof s.verseIndex === 'number'));
  check(
    'each verse builds to completion before the next begins',
    biteStages.every((s, i) => i === 0 || s.verseIndex >= biteStages[i - 1].verseIndex)
  );
  check('the final stage holds every verse', reassemble[reassemble.length - 1].segments.length === 3);
  check(
    'the final stage reads as the whole passage',
    reassemble[reassemble.length - 1].segments.map((s) => s.text).join(' ') === threeVerses.map((v) => v.text).join(' ')
  );
}

{
  // An empty group, and a group containing an empty verse, must not throw or
  // emit a stage with nothing in it -- PracticeModals can be handed either
  // mid-session when a chained review swaps `verses` in place.
  check('an empty group yields no stages', buildUpStages([]).length === 0);
  const withBlank = buildUpStages([{ text: 'A real verse, with a clause.' }, { text: '  ' }]);
  check('a blank verse contributes no bite stages', withBlank.filter((s) => s.phase === 'bite').every((s) => s.segments.length > 0));
}

console.log(failures === 0 ? '\ncheck:buildup — all assertions passed.' : `\ncheck:buildup — ${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
