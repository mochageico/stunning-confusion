// Regression assertions for Recall's Last to first order (src/lib/reciteOrder.ts),
// run by `npm run check:reciteorder`. The point: a reversed run walks the verses
// last to first, but every grade lands on the word -- and so the verse -- it
// belongs to, by typing and by speech, so crediting is unchanged.

import { buildReciteOrder, positionsToWords, verseStartPosition } from './reciteOrder';
import { reconcileSpeechWindow, summarizeOutcomes, tokenizeWords, WordOutcome } from './recitation';

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

// Psalm 23:1-3 (BSB), 9, 14 and 18 words.
const verses = [
  'The LORD is my shepherd; I shall not want.',
  'He makes me lie down in green pastures; He leads me beside quiet waters.',
  'He restores my soul; He guides me in the paths of righteousness for the sake of His name.',
];
const words = verses.flatMap((t, vi) => tokenizeWords(t).map((w) => ({ vi, w })));
const wordVerse = words.map((x) => x.vi);
const n = words.length;
const counts = verses.map((t) => tokenizeWords(t).length);

console.log('Forward is the identity');
const fwd = buildReciteOrder(wordVerse, verses.length, false);
check('verse order 0,1,2', eq(fwd.verseOrder, [0, 1, 2]));
check('position == word index', fwd.order.every((w, p) => w === p) && fwd.posOf.every((p, w) => p === w));

console.log('Last to first');
const rev = buildReciteOrder(wordVerse, verses.length, true);
check('verse order 2,1,0', eq(rev.verseOrder, [2, 1, 0]));
check('order is a permutation', eq([...rev.order].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i)));
check('posOf inverts order', rev.order.every((w, p) => rev.posOf[w] === p));
check('position 0 is the last verse\'s first word', words[rev.order[0]].w === 'he' && wordVerse[rev.order[0]] === 2);
check(
  'each verse is still said forward',
  [0, 1, 2].every((vi) => {
    const positions = rev.order.map((w, p) => ({ w, p })).filter(({ w }) => wordVerse[w] === vi);
    return positions.every((x, i) => i === 0 || x.w === positions[i - 1].w + 1);
  })
);
check('the last position is verse 1\'s last word', rev.order[n - 1] === counts[0] - 1);

console.log('Strike reset goes to the start of the verse being said');
const midV3 = 4; // fifth word of verse 3, the first verse in reverse
check('in verse 3 -> position 0', verseStartPosition(rev, wordVerse, midV3) === 0);
const midV1 = n - 2;
check('in verse 1 -> its first position', verseStartPosition(rev, wordVerse, midV1) === counts[2] + counts[1]);
check('forward, in verse 2 -> word 7', verseStartPosition(fwd, wordVerse, 9) === counts[0]);

console.log('A typed reverse run grades the right words');
// Walk the pointer as useRecall does: grades are keyed by order[pos]. Miss
// every word of verse 2 (the middle one, said second).
const outcomes: Record<number, WordOutcome> = {};
for (let pos = 0; pos < n; pos++) {
  const idx = rev.order[pos];
  outcomes[idx] = wordVerse[idx] === 1 ? 'missed' : 'perfect';
}
const final = words.map((_, i) => outcomes[i] || 'missed');
check('verse 1 words perfect', final.slice(0, counts[0]).every((o) => o === 'perfect'));
check('verse 2 words missed', final.slice(counts[0], counts[0] + counts[1]).every((o) => o === 'missed'));
check('verse 3 words perfect', final.slice(counts[0] + counts[1]).every((o) => o === 'perfect'));
check('summary sees every word once', summarizeOutcomes(final).totalWords === n);

console.log('Speech in reverse lands on the right words');
const expected = rev.verseOrder.flatMap((vi) => tokenizeWords(verses[vi]));
check('expected tokens line up with positions', expected.length === n && expected.every((t, p) => t === words[rev.order[p]].w));
// Say verse 3 then verse 2, word for word.
const spoken = tokenizeWords(`${verses[2]} ${verses[1]}`);
// Fed a word at a time, the way transcript updates reach useRecall.
let anchor = 0;
let pointer = 0;
const byWord: Record<number, WordOutcome> = {};
for (let k = 1; k <= spoken.length; k++) {
  const patch = reconcileSpeechWindow(expected, spoken.slice(0, k), anchor, 0, new Set(), pointer);
  anchor = patch.nextAlignAnchor;
  pointer = patch.pointer;
  Object.assign(byWord, positionsToWords(rev, patch.outcomes));
}
const gradedVerses = new Set(Object.keys(byWord).map((k) => wordVerse[Number(k)]));
check('pointer reaches verse 1', pointer === counts[2] + counts[1], pointer);
check('graded words are in verses 3 and 2 only', eq([...gradedVerses].sort(), [1, 2]), [...gradedVerses]);
check('none graded missed', Object.values(byWord).every((o) => o === 'perfect'), byWord);
check('every word of verses 3 and 2 graded', Object.keys(byWord).length === counts[1] + counts[2]);
check('verse 1 untouched', [...Array(counts[0]).keys()].every((i) => byWord[i] === undefined));

console.log(failures === 0 ? '\nAll recite order checks passed.' : `\n${failures} recite order check(s) FAILED.`);
if (failures > 0) process.exit(1);
