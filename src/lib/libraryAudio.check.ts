// Assertions for which audio plays for a verse, run by `npm run check:libraryaudio`.
//
// Two silent failures this guards: an English recording playing over a
// Hebrew verse (or the reverse), and the built-in Hebrew reading being
// skipped -- or winning over the user's own recording.

import type { Recording } from '../types';
import { recordingFitsTranslation, resolveChapterAudio } from './appData';
import { LibraryChapterTimings, hasLibraryAudio, isLibraryRecording, libraryTimingsKey, resolveVerseAudio } from './libraryAudio';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const rec = (id: string, translation: string, book = 'Psalms', chapter = 23, verses = [1, 2]): Recording => ({
  id,
  title: id,
  book,
  chapter,
  translation,
  duration: 60,
  date: '2026-10-24',
  audioUrl: `https://example.test/${id}.m4a`,
  audioPath: `recordings/u/${id}.m4a`,
  verseTimestamps: verses.map((v) => ({ verse: v, startSec: v * 10, endSec: v * 10 + 9 })),
});

console.log('recordingFitsTranslation');
check('English recording fits another English translation', recordingFitsTranslation({ translation: 'BSB' }, 'WEB'));
check('English recording does not fit Hebrew', !recordingFitsTranslation({ translation: 'BSB' }, 'HEBGRK'));
check('Hebrew recording does not fit English', !recordingFitsTranslation({ translation: 'HEBGRK' }, 'BSB'));
check('Hebrew recording fits Hebrew', recordingFitsTranslation({ translation: 'HEBGRK' }, 'HEBGRK'));

console.log('resolveChapterAudio');
const english = rec('eng', 'BSB');
const hebrew = rec('heb', 'HEBGRK');
check('Hebrew verse ignores an English recording', resolveChapterAudio([english], {}, 'Psalms', 23, 'HEBGRK') === null);
check('Hebrew verse finds the Hebrew recording', resolveChapterAudio([english, hebrew], {}, 'Psalms', 23, 'HEBGRK')?.id === 'heb');
check('English verse never picks the Hebrew recording', resolveChapterAudio([hebrew, english], {}, 'Psalms', 23, 'BSB')?.id === 'eng');
check(
  'a chosen English narration is passed over for a Hebrew verse',
  resolveChapterAudio([english, hebrew], { Psalms_23: english }, 'Psalms', 23, 'HEBGRK')?.id === 'heb'
);

console.log('built-in reading');
check('Hebrew OT has it', hasLibraryAudio('HEBGRK', 'Psalms'));
check('Greek NT does not', !hasLibraryAudio('HEBGRK', 'John'));
check('English does not', !hasLibraryAudio('BSB', 'Psalms'));
check('key is book id + English chapter', libraryTimingsKey('HEBGRK', 'Joel', 2) === 'JOL_2');
check('no key for English', libraryTimingsKey('BSB', 'Joel', 2) === null);

// English Joel 2:28 lives in the Hebrew Joel 3 file.
const joel2: LibraryChapterTimings = {
  book: 'JOL',
  chapter: 2,
  verses: {
    '27': { file: 'hbofJol_02.mp3', startSec: 300, endSec: 312 },
    '28': { file: 'hbofJol_03.mp3', startSec: 0, endSec: 15.7 },
  },
};
const v28 = resolveVerseAudio([], {}, 'Joel', 2, 28, 'HEBGRK', joel2);
check('falls back to the built-in reading', isLibraryRecording(v28?.recording), v28?.recording.id);
check('uses the file the verse is in', !!v28?.recording.audioPath?.endsWith('hbofJol_03.mp3'), v28?.recording.audioPath);
check('with that verse\'s times', v28?.startSec === 0 && v28?.endSec === 15.7);
check('the file\'s recording only tags its own verses', v28?.recording.verseTimestamps?.map((t) => t.verse).join() === '28');
check('nothing for a verse with no timing', resolveVerseAudio([], {}, 'Joel', 2, 29, 'HEBGRK', joel2) === null);
check('nothing for an English verse even with timings', resolveVerseAudio([], {}, 'Joel', 2, 28, 'BSB', joel2) === null);

const ownJoel = rec('mine', 'HEBGRK', 'Joel', 2, [28]);
check('the user\'s own Hebrew recording wins', resolveVerseAudio([ownJoel], {}, 'Joel', 2, 28, 'HEBGRK', joel2)?.recording.id === 'mine');
check(
  'own recording without this verse tagged still falls back',
  isLibraryRecording(resolveVerseAudio([rec('mine', 'HEBGRK', 'Joel', 2, [1])], {}, 'Joel', 2, 28, 'HEBGRK', joel2)?.recording)
);
check(
  'an English recording never blocks the fallback',
  isLibraryRecording(resolveVerseAudio([rec('eng', 'BSB', 'Joel', 2, [28])], {}, 'Joel', 2, 28, 'HEBGRK', joel2)?.recording)
);

// Layered like texture packs: a verses 1-5 take on top of a whole-chapter take.
const part = { ...rec('part', 'BSB', 'Romans', 8, [1, 2, 3, 4, 5]), priority: 0 };
const whole = { ...rec('whole', 'BSB', 'Romans', 8, [1, 2, 3, 4, 5, 6, 7]), priority: 1 };
const layerFor = (v: number, picks = {}) => resolveVerseAudio([whole, part], picks, 'Romans', 8, v, 'BSB', null)?.recording.id;
check('top recording plays the verses it has', layerFor(3) === 'part', layerFor(3));
check('the next one down fills in the rest', layerFor(6) === 'whole', layerFor(6));
check('a picked recording goes on top', layerFor(3, { Romans_8: whole }) === 'whole');
check('nothing past every layer', layerFor(9) === undefined);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall passed');
