// Assertions for the copy of your verses on the phone (localCopy.ts), run by
// `npm run check:localcopy`. It's what the app will open from with no signal,
// so each case below is a way that could open the wrong thing.

import { QueueItem } from '../types';
import { emptyLocalCopy, LOCAL_COPY_VERSION, LocalSettings, parseLocalCopy, patchLocalCopy, queueFromBaseline } from './localCopy';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

function item(verseId: string, orderIndex: number): QueueItem {
  return {
    verseId,
    translationId: 'BSB',
    book: 'Romans',
    chapter: 8,
    verseNumber: orderIndex + 1,
    text: 'test',
    orderIndex,
    status: 'reviewing',
    retentionPhase: 'weekly',
    dateStarted: '2026-09-01T12:00:00.000Z',
    lastReviewDate: '2026-10-01T12:00:00.000Z',
    nextReviewDueDate: '2026-10-08T12:00:00.000Z',
    currentStreakCount: 1,
    totalSuccessfulReviews: 1,
    gracePeriodUsedToday: false,
  };
}

const settings: LocalSettings = {
  rhythm: {
    learningDays: ['M', 'W', 'F'],
    newVersesPace: 2,
    maxReviewCap: 20,
    sabbathEnabled: true,
    sabbathDay: 'Su',
    dayStartHour: 2,
    cognitiveLoadSensitivity: 'medium',
    pausedAt: null,
    pausedUntil: null,
  },
  ladderPrefs: { thoroughness: 1, cleanPct: 90, lateMovesBack: true, swapCanBeClean: false, balanceDays: true },
  ladderVersion: 2,
  masteryTouches: 3,
};

const T1 = '2026-10-29T08:00:00.000Z';
const T2 = '2026-10-29T09:00:00.000Z';

console.log('localCopy — saving parts');
{
  const empty = emptyLocalCopy('alice');
  const a = patchLocalCopy(empty, { queue: [item('ROM_8_1', 0)], settings }, T1);
  check('saved parts are stamped', a.savedAt.queue === T1 && a.savedAt.settings === T1);
  check('parts not in the patch stay unsaved', a.verses === null && a.savedAt.verses === null);
  check('the copy it came from is untouched', empty.queue === null);

  const b = patchLocalCopy(a, { verses: [{ book: 'Romans', chapter: 8, verse: 1, text: 't', status: 'learning' }] }, T2);
  check('a later part keeps the earlier ones as they were', b.queue === a.queue && b.savedAt.queue === T1 && b.savedAt.verses === T2);

  check('the same content again changes nothing (no save)', patchLocalCopy(b, { queue: [item('ROM_8_1', 0)], settings }, T2) === b);
  check('an empty patch changes nothing', patchLocalCopy(b, {}, T2) === b);

  const c = patchLocalCopy(b, { queue: [] }, T2);
  check('an emptied queue is saved as empty, not as never loaded', Array.isArray(c.queue) && c.queue.length === 0 && c.savedAt.queue === T2);
}

console.log('localCopy — reading it back');
{
  const saved = patchLocalCopy(emptyLocalCopy('alice'), { queue: [item('ROM_8_1', 0)], settings }, T1);
  const raw = JSON.stringify(saved);
  const back = parseLocalCopy(raw, 'alice');
  check('a saved copy reads back the same', JSON.stringify(back) === raw, back);
  check("another account's copy is never used", parseLocalCopy(raw, 'bob') === null);
  check('half a file is not a copy', parseLocalCopy(raw.slice(0, raw.length / 2), 'alice') === null);
  check('an older layout is not used', parseLocalCopy(JSON.stringify({ ...saved, version: LOCAL_COPY_VERSION + 1 }), 'alice') === null);
  check('not an object is not a copy', parseLocalCopy('null', 'alice') === null && parseLocalCopy('[]', 'alice') === null);

  const badQueue = parseLocalCopy(JSON.stringify({ ...saved, queue: 'oops' }), 'alice');
  check('a broken part is dropped on its own', badQueue !== null && badQueue.queue === null && badQueue.settings !== null);
  check('...along with its date', badQueue?.savedAt.queue === null && badQueue?.savedAt.settings === T1);
  const badSettings = parseLocalCopy(JSON.stringify({ ...saved, settings: { rhythm: settings.rhythm } }), 'alice');
  check('settings missing the ladder prefs are dropped', badSettings?.settings === null);
}

console.log('localCopy — queueFromBaseline');
{
  const q = queueFromBaseline(new Map([['b', item('b', 2)], ['a', item('a', 0)], ['c', item('c', 1)]]).values());
  check('the queue comes out in queue order', q.map((i) => i.verseId).join() === 'a,c,b');
}

console.log(failures === 0 ? '\ncheck:localcopy — all assertions passed.' : `\ncheck:localcopy — ${failures} FAILED.`);
if (failures > 0) process.exit(1);
