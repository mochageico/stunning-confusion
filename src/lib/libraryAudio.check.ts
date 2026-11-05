// Assertions for which audio plays for a verse, run by `npm run check:libraryaudio`.
//
// Silent failures this guards: an English recording playing over a Hebrew
// verse (or the reverse), a built-in reading (BSB or Hebrew) being skipped --
// or winning over the user's own recording -- and one reading's timings or
// files standing in for the other's.

import type { Recording } from '../types';
import { recordingFitsTranslation, resolveChapterAudio } from './appData';
import {
  LIBRARY_READERS,
  LibraryChapterTimings,
  hasLibraryAudio,
  isLibraryRecording,
  libraryReaderFor,
  libraryReaderOf,
  libraryTimingsKey,
  resolveVerseAudio,
  splitLibraryTimingsKey,
} from './libraryAudio';

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
check('Hebrew OT has it', libraryReaderFor('HEBGRK', 'Psalms')?.id === 'shmuelof');
check('Greek NT does not', !hasLibraryAudio('HEBGRK', 'John'));
check('BSB has it in the OT', libraryReaderFor('BSB', 'Psalms')?.id === 'souer');
check('BSB has it in the NT', libraryReaderFor('BSB', 'John')?.id === 'souer');
check('WEB does not', !hasLibraryAudio('WEB', 'John'));
check('KJV does not', !hasLibraryAudio('KJV', 'Psalms'));
check('ESV does not', !hasLibraryAudio('ESV', 'Psalms'));
check('no translation, no reading', !hasLibraryAudio(undefined, 'Psalms'));
check('unknown book, no reading', !hasLibraryAudio('BSB', 'Hezekiah'));
check('key is reader + book id + English chapter', libraryTimingsKey('HEBGRK', 'Joel', 2) === 'shmuelof/JOL_2');
check('BSB key', libraryTimingsKey('BSB', 'Joel', 2) === 'souer/JOL_2');
check('BSB and Hebrew Psalm 23 keys differ', libraryTimingsKey('BSB', 'Psalms', 23) !== libraryTimingsKey('HEBGRK', 'Psalms', 23));
check('no key for WEB', libraryTimingsKey('WEB', 'Joel', 2) === null);
check(
  'key splits back into the Firestore path',
  JSON.stringify(splitLibraryTimingsKey('souer/PSA_23')) === JSON.stringify({ readerId: 'souer', chapterId: 'PSA_23' })
);
check('reader ids have no underscore (the recording id is library_{reader}_{file})', Object.keys(LIBRARY_READERS).every((id) => !id.includes('_')));

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
check('nothing for a WEB verse even with timings', resolveVerseAudio([], {}, 'Joel', 2, 28, 'WEB', joel2) === null);
check('the Hebrew reading is credited to Shmuelof', libraryReaderOf(v28?.recording)?.id === 'shmuelof');
check('a user recording has no reader', libraryReaderOf(rec('mine', 'HEBGRK')) === null);

console.log('BSB reading');
const psalm23: LibraryChapterTimings = {
  book: 'PSA',
  chapter: 23,
  verses: {
    '1': { file: 'BSB_19_Psa_023.mp3', startSec: 4.8, endSec: 8.23 },
    '2': { file: 'BSB_19_Psa_023.mp3', startSec: 8.23, endSec: 13.1 },
  },
};
const bsb2 = resolveVerseAudio([], {}, 'Psalms', 23, 2, 'BSB', psalm23);
check('a BSB verse falls back to the BSB reading', libraryReaderOf(bsb2?.recording)?.id === 'souer', bsb2?.recording.id);
check('from the souer folder', bsb2?.recording.audioPath === 'audioLibrary/souer/BSB_19_Psa_023.mp3', bsb2?.recording.audioPath);
check('tagged as BSB', bsb2?.recording.translation === 'BSB');
check('titled for the reader', bsb2?.recording.title === 'BSB reading · Bob Souer', bsb2?.recording.title);
check('with that verse\'s times', bsb2?.startSec === 8.23 && bsb2?.endSec === 13.1);
const ownPsalm = rec('mine', 'BSB', 'Psalms', 23, [1]);
check("the user's own BSB recording of verse 1 wins", resolveVerseAudio([ownPsalm], {}, 'Psalms', 23, 1, 'BSB', psalm23)?.recording.id === 'mine');
check('the BSB reading still fills verse 2', libraryReaderOf(resolveVerseAudio([ownPsalm], {}, 'Psalms', 23, 2, 'BSB', psalm23)?.recording)?.id === 'souer');
check(
  "a user's English recording made for WEB also beats the BSB reading",
  resolveVerseAudio([rec('web', 'WEB', 'Psalms', 23, [2])], {}, 'Psalms', 23, 2, 'BSB', psalm23)?.recording.id === 'web'
);
check(
  'a Hebrew recording never plays under BSB',
  libraryReaderOf(resolveVerseAudio([rec('heb', 'HEBGRK', 'Psalms', 23, [2])], {}, 'Psalms', 23, 2, 'BSB', psalm23)?.recording)?.id === 'souer'
);
check(
  'an English recording never plays under Hebrew',
  resolveVerseAudio([rec('eng', 'BSB', 'Psalms', 23, [2])], {}, 'Psalms', 23, 2, 'HEBGRK', null) === null
);
check('the BSB reading never plays under WEB', resolveVerseAudio([], {}, 'Psalms', 23, 2, 'WEB', psalm23) === null);

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
