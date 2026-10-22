// Regression assertions for chapter sections (src/lib/sections.ts), run by
// `npm run check:sections`. The Matthew 7 cases are the user's own sections
// and phrase (MIXED_REVIEW_PLAN.md, locked decisions).

import {
  chapterSectionsKey,
  chapterStretches,
  emptyDraft,
  isBlankDraft,
  mergeAt,
  moveStart,
  normalizeDraft,
  normalizeStarts,
  phraseLetters,
  sameDraft,
  sectionIndexOf,
  sectionRangeText,
  sectionsFromStarts,
  SectionDraft,
  setSectionText,
  splitAt,
  startBounds,
} from './sections';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── Matthew 7, the user's nine sections ────────────────────────────────────
const MATT7_STARTS = [1, 6, 7, 12, 13, 15, 21, 24, 28];
const PHRASE = 'john doe ate some edamame but not every apple'.split(' ');
const matt7: SectionDraft = {
  starts: MATT7_STARTS,
  labels: { 1: 'Judging others', 13: 'The narrow gate', 24: 'Two builders' },
  phraseWords: Object.fromEntries(MATT7_STARTS.map((s, i) => [s, PHRASE[i]])),
};
const LAST = 29;

console.log('Keys');
check('key is book|chapter', chapterSectionsKey('Matthew', 7) === 'Matthew|7');
check('key keeps spaces in a book name', chapterSectionsKey('1 Corinthians', 13) === '1 Corinthians|13');

console.log('Section list');
const secs = sectionsFromStarts(matt7, LAST);
check('nine sections', secs.length === 9);
check(
  'ranges run start..next-1, last to the chapter end',
  eq(
    secs.map((s) => [s.start, s.end]),
    [[1, 5], [6, 6], [7, 11], [12, 12], [13, 14], [15, 20], [21, 23], [24, 27], [28, 29]]
  ),
  secs.map((s) => [s.start, s.end])
);
check('labels attach by start', secs[0].label === 'Judging others' && secs[4].label === 'The narrow gate' && secs[1].label === undefined);
check('phrase words attach by start', eq(secs.map((s) => s.phraseWord), PHRASE));
check('range text, many verses', sectionRangeText(secs[0]) === 'Verses 1–5');
check('range text, one verse', sectionRangeText(secs[1]) === 'Verse 6');

console.log('Which section');
check('verse 1 -> 0', sectionIndexOf(MATT7_STARTS, 1) === 0);
check('verse 5 -> 0', sectionIndexOf(MATT7_STARTS, 5) === 0);
check('verse 6 -> 1', sectionIndexOf(MATT7_STARTS, 6) === 1);
check('verse 14 -> 4', sectionIndexOf(MATT7_STARTS, 14) === 4);
check('verse 29 -> 8', sectionIndexOf(MATT7_STARTS, 29) === 8);
check('verse 0 -> -1', sectionIndexOf(MATT7_STARTS, 0) === -1);

console.log('Moving a start');
check('first start never moves', moveStart(matt7, 0, 3, LAST) === matt7);
check('bounds sit between neighbors', eq(startBounds(MATT7_STARTS, 4, LAST), { min: 13, max: 14 }));
check('last section may shrink to the final verse', eq(startBounds(MATT7_STARTS, 8, LAST), { min: 25, max: 29 }));
const moved = moveStart(matt7, 4, 14, LAST);
check('13 -> 14 moves the start', eq(moved.starts, [1, 6, 7, 12, 14, 15, 21, 24, 28]), moved.starts);
check('label follows its section', moved.labels[14] === 'The narrow gate' && moved.labels[13] === undefined);
check('phrase word follows its section', moved.phraseWords[14] === 'edamame' && moved.phraseWords[13] === undefined);
check('other labels untouched', moved.labels[1] === 'Judging others' && moved.labels[24] === 'Two builders');
check('dragging past the next start clamps to just before it', eq(moveStart(matt7, 4, 20, LAST).starts.slice(3, 6), [12, 14, 15]));
check('dragging above the previous start clamps to just after it', eq(moveStart(matt7, 4, 2, LAST).starts.slice(3, 6), [12, 13, 15]));
check('a one-verse section between neighbors cannot move', moveStart(matt7, 1, 9, LAST) === matt7);
check('moving to where it already is changes nothing', moveStart(matt7, 2, 7, LAST) === matt7);
check('the input draft is not mutated', eq(matt7.starts, MATT7_STARTS) && matt7.labels[13] === 'The narrow gate');

console.log('Splitting');
const split = splitAt(matt7, 3, LAST);
check('tap verse 3 starts a section there', eq(split.starts, [1, 3, 6, 7, 12, 13, 15, 21, 24, 28]));
check('the section it came from keeps its label', sectionsFromStarts(split, LAST)[0].label === 'Judging others');
check('the new section starts blank', sectionsFromStarts(split, LAST)[1].label === undefined);
check('splitting on an existing start changes nothing', splitAt(matt7, 13, LAST) === matt7);
check('splitting on the first verse changes nothing', splitAt(matt7, 1, LAST) === matt7);
check('splitting past the end changes nothing', splitAt(matt7, 30, LAST) === matt7);
const fromEmpty = splitAt(splitAt(emptyDraft(1), 10, 20), 5, 20);
check('splits from a blank chapter stay sorted', eq(fromEmpty.starts, [1, 5, 10]));

console.log('Merging');
const merged = mergeAt(matt7, 4);
check('join 13 onto 12', eq(merged.starts, [1, 6, 7, 12, 15, 21, 24, 28]));
check('joined section spans both', eq(sectionsFromStarts(merged, LAST)[3], { index: 3, start: 12, end: 14, label: 'The narrow gate', phraseWord: 'some' }), sectionsFromStarts(merged, LAST)[3]);
check('the lower label survives when the upper had none', merged.labels[12] === 'The narrow gate' && merged.labels[13] === undefined);
check('the upper word wins when both have one', merged.phraseWords[12] === 'some' && merged.phraseWords[13] === undefined);
const mergedTop = mergeAt(matt7, 1);
check('a label only the upper section had stays', mergedTop.labels[1] === 'Judging others');
check('section 0 cannot merge upward', mergeAt(matt7, 0) === matt7);
check('merge then split restores the starts', eq(splitAt(merged, 13, LAST).starts, MATT7_STARTS));

console.log('Labels and words');
const renamed = setSectionText(matt7, 'labels', 6, 'Pearls before pigs');
check('set a label', renamed.labels[6] === 'Pearls before pigs' && matt7.labels[6] === undefined);
check('blank clears a label', setSectionText(matt7, 'labels', 1, '   ').labels[1] === undefined);
check('set a phrase word', setSectionText(matt7, 'phraseWords', 7, 'ask').phraseWords[7] === 'ask');

console.log('Normalizing');
check('sorts, dedupes, forces the first verse', eq(normalizeStarts([12, 6, 6, 1, 40, 0], 1, 29), [1, 6, 12]));
check('a doc with no first verse gets one', eq(normalizeStarts([6, 12], 1, 29), [1, 6, 12]));
check('non-integers are dropped', eq(normalizeStarts([1, 6.5, 7], 1, 29), [1, 7]));
const norm = normalizeDraft({ starts: [1, 6, 40], labels: { 6: 'a', 40: 'gone', 1: '  ' }, phraseWords: { 40: 'x' } }, 1, 29);
check('labels of dropped starts go too', eq(norm, { starts: [1, 6], labels: { 6: 'a' }, phraseWords: {} }), norm);

console.log('Blank and same');
check('a fresh chapter is blank', isBlankDraft(emptyDraft(1)));
check('one labelled section is not blank', !isBlankDraft(setSectionText(emptyDraft(1), 'labels', 1, 'All of it')));
check('two sections are not blank', !isBlankDraft(splitAt(emptyDraft(1), 4, 10)));
check('same draft', sameDraft(matt7, { ...matt7, labels: { ...matt7.labels } }));
check('blank entries do not count as a difference', sameDraft(matt7, { ...matt7, labels: { ...matt7.labels, 6: ' ' } }));
check('a moved start is a difference', !sameDraft(matt7, moved));

console.log('Phrase letters');
// Matthew 7 openings in the BSB.
const bsb = [
  { verse: 1, text: 'Do not judge, or you will be judged.' },
  { verse: 6, text: 'Do not give dogs what is holy;' },
  { verse: 7, text: 'Ask, and it will be given to you;' },
  { verse: 12, text: 'In everything, then, do to others' },
  { verse: 13, text: '“Enter through the narrow gate.' },
  { verse: 15, text: 'Beware of false prophets.' },
  { verse: 21, text: 'Not everyone who says to Me,' },
  { verse: 24, text: 'Therefore everyone who hears' },
  { verse: 28, text: 'When Jesus had finished saying these things,' },
];
check('first letter of each opening verse', phraseLetters(secs, bsb).join('') === 'ddaiebntw', phraseLetters(secs, bsb));
check('leading punctuation is skipped', phraseLetters([{ start: 13, end: 14 }], bsb)[0] === 'e');
check('a missing start verse opens on the next one', phraseLetters([{ start: 2, end: 6 }], bsb)[0] === 'd');
check('no text -> empty letter', phraseLetters([{ start: 2, end: 5 }], bsb)[0] === '');
// Hebrew: Genesis 1:1 opens בְּרֵאשִׁית -- the bare consonant, no points.
const gen = [{ verse: 1, text: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים' }];
check('Hebrew gives the bare consonant', phraseLetters([{ start: 1, end: 1 }], gen, 'hebrew')[0] === 'ב');
// Greek: John 1:1 opens Ἐν -- lower case, no breathing mark.
const john = [{ verse: 1, text: 'Ἐν ἀρχῇ ἦν ὁ λόγος' }];
check('Greek gives the bare lower-case letter', phraseLetters([{ start: 1, end: 1 }], john, 'greek')[0] === 'ε');

console.log('Stretches (no sections)');
const vs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ book: 'Psalms', chapter: 1, verse: i + 1, text: `v${i + 1}`, translationId: 'BSB' }));
const st = chapterStretches(vs(10));
check('10 verses -> runs of up to 4 sharing their joins', eq(st.map((r) => r.map((v) => v.verse)), [[1, 2, 3, 4], [4, 5, 6, 7], [7, 8, 9, 10]]), st.map((r) => r.map((v) => v.verse)));
check('every verse is covered', vs(29).every((v) => chapterStretches(vs(29)).some((r) => r.some((x) => x.verse === v.verse))));
check('a one-verse chapter is one stretch', chapterStretches(vs(1)).length === 1);
check('three verses are one stretch', chapterStretches(vs(3)).length === 1);

console.log(failures === 0 ? '\nAll sections checks passed.' : `\n${failures} sections check(s) FAILED.`);
if (failures > 0) process.exit(1);
