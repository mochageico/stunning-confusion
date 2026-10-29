// Assertions for the recordings waiting to upload (recordingUploads.ts), run
// by `npm run check:uploads`. Its whole job is that a recitation made with
// no signal is never lost, never uploaded twice over a studio render, and
// never sent to Firestore with fields that only belong on the phone -- so
// each case below is a way that could go wrong.

import { Recording } from '../types';
import {
  addWaiting,
  asListed,
  EMPTY_UPLOADS,
  findWaiting,
  firestoreFields,
  markTried,
  msUntilNextDue,
  nextDue,
  parseUploads,
  patchWaiting,
  removeWaiting,
  retryWait,
  setDocWritten,
  strayFiles,
  UploadQueue,
  waitingFileName,
  WaitingUpload,
  withWaiting,
} from './recordingUploads';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

function rec(id: string, extra: Partial<Recording> = {}): Recording {
  return {
    id,
    title: 'Romans 8 Full Chapter Recitation',
    book: 'Romans',
    chapter: 8,
    translation: 'BSB',
    duration: 300,
    date: '2026-10-29',
    userId: 'u1',
    audioPath: `recordings/u1/${id}.m4a`,
    versesStr: 'Full Chapter',
    priority: 0,
    verseTimestamps: [],
    sharedVisibility: 'private',
    sourceType: 'recorded',
    ...extra,
  };
}

function entry(id: string, extra: Partial<WaitingUpload> = {}): WaitingUpload {
  return {
    recording: rec(id),
    fileName: waitingFileName('u1', id, 'm4a'),
    contentType: 'audio/m4a',
    docWritten: false,
    attempts: 0,
    lastTriedAt: null,
    ...extra,
  };
}

console.log('Adding and removing');
{
  const q1 = addWaiting(EMPTY_UPLOADS, entry('rec_1'));
  const q2 = addWaiting(q1, entry('rec_2'));
  check('kept oldest first', q2.map((e) => e.recording.id).join() === 'rec_1,rec_2');
  const again = addWaiting(q2, entry('rec_1', { contentType: 'audio/*' }));
  check('same id replaces, not duplicates', again.length === 2 && findWaiting(again, 'rec_1')?.contentType === 'audio/*');
  check('remove takes only that one', removeWaiting(q2, 'rec_1').map((e) => e.recording.id).join() === 'rec_2');
  check('removing one not there changes nothing', removeWaiting(q2, 'rec_9') === q2);
  check('the empty list is never changed in place', EMPTY_UPLOADS.length === 0);
}

console.log('Edits while it waits');
{
  const q = addWaiting(EMPTY_UPLOADS, entry('rec_1'));
  const edited = patchWaiting(q, 'rec_1', { user: 'Micah', sharedVisibility: 'circle' });
  check('edit lands on the recording', findWaiting(edited, 'rec_1')?.recording.user === 'Micah');
  check('and goes up with it', firestoreFields(findWaiting(edited, 'rec_1')!, 5).sharedVisibility === 'circle');
  check('an edit cannot change the id', findWaiting(patchWaiting(q, 'rec_1', { id: 'rec_x' }), 'rec_1') !== undefined);
  check('editing one not waiting changes nothing', patchWaiting(q, 'rec_9', { user: 'x' }) === q);
  check('the old list is left as it was', q[0].recording.user === undefined);
}

console.log('What goes to Firestore');
{
  const e = entry('rec_1');
  e.recording = { ...e.recording, uploadPending: true, localAudioUri: 'file:///x.m4a', audioUrl: 'file:///x.m4a' };
  const f = firestoreFields(e, 1234);
  check('no uploadPending', !('uploadPending' in f));
  check('no localAudioUri', !('localAudioUri' in f));
  check('no audioUrl until the upload gives one', !('audioUrl' in f));
  check("studio claimed 'pending' at upload", f.studioStatus === 'pending');
  check('uploadedAt dates the studio wait', f.uploadedAt === 1234);
  check('full chapter keeps start/end absent', !('startVerse' in f) && !('endVerse' in f));
  check('fields kept', f.title === e.recording.title && f.audioPath === e.recording.audioPath);
}

console.log('How it shows while it waits');
{
  const e = entry('rec_1');
  e.recording = { ...e.recording, studioStatus: 'pending' };
  const shown = asListed(e, 'file:///doc/waiting-uploads/u1_rec_1.m4a');
  check('marked waiting', shown.uploadPending === true);
  check('plays from the phone', shown.localAudioUri === 'file:///doc/waiting-uploads/u1_rec_1.m4a');
  check('no "Polishing audio" before it uploads', shown.studioStatus === undefined);
  check('no remote url', shown.audioUrl === undefined);
  check('a missing file just has nothing to play', !('localAudioUri' in asListed(e, null)));
}

console.log('Merged into the loaded list');
{
  const loaded = [rec('rec_5', { audioUrl: 'https://x/5' }), rec('rec_3', { audioUrl: 'https://x/3' })];
  const q: UploadQueue = [entry('rec_10'), entry('rec_11')];
  const list = withWaiting(loaded, q, (e) => `file:///${e.fileName}`);
  check('waiting ones first, newest first', list.map((r) => r.id).join() === 'rec_11,rec_10,rec_5,rec_3', list.map((r) => r.id));
  check('loaded ones untouched', list[2] === loaded[0]);
  // A doc that reached Firestore before its audio did.
  const half = withWaiting([rec('rec_10'), ...loaded], q, () => null);
  check('a half-uploaded doc is replaced by the waiting copy, once', half.filter((r) => r.id === 'rec_10').length === 1 && half.find((r) => r.id === 'rec_10')!.uploadPending === true);
  check('nothing waiting: the same list back', withWaiting(loaded, EMPTY_UPLOADS, () => null) === loaded);
}

console.log('Retrying');
{
  check('first try straight away', retryWait(0) === 0);
  check('30 s after one failure', retryWait(1) === 30_000);
  check('doubling', retryWait(3) === 120_000);
  check('never more than 30 min', retryWait(50) === 30 * 60_000);
  const now = 1_000_000;
  const q: UploadQueue = [entry('rec_1', { attempts: 2, lastTriedAt: now - 10_000 }), entry('rec_2')];
  check('one still waiting is skipped for one not tried', nextDue(q, now)?.recording.id === 'rec_2');
  check('oldest first when both are due', nextDue([entry('rec_1'), entry('rec_2')], now)?.recording.id === 'rec_1');
  check('none due', nextDue([entry('rec_1', { attempts: 1, lastTriedAt: now })], now + 1000) === null);
  check('due again after the wait', nextDue([entry('rec_1', { attempts: 1, lastTriedAt: now })], now + 30_000)?.recording.id === 'rec_1');
  check('time until the next', msUntilNextDue([entry('rec_1', { attempts: 1, lastTriedAt: now })], now + 10_000) === 20_000);
  check('nothing waiting: no timer', msUntilNextDue(EMPTY_UPLOADS, now) === null);
  const tried = markTried([entry('rec_1')], 'rec_1', now);
  check('an attempt is counted as it starts', tried[0].attempts === 1 && tried[0].lastTriedAt === now);
}

console.log('Doc written before the audio');
{
  const q = [entry('rec_1')];
  const written = setDocWritten(q, 'rec_1', true);
  check('noted', written[0].docWritten === true);
  check('noting it twice changes nothing', setDocWritten(written, 'rec_1', true) === written);
  check('rolled back', setDocWritten(written, 'rec_1', false)[0].docWritten === false);
}

console.log('Files on the phone');
{
  check('file name has the account and id', waitingFileName('u1', 'rec_1', 'm4a') === 'u1_rec_1.m4a');
  check('odd extensions made safe', waitingFileName('u1', 'rec_1', '../m4a') === 'u1_rec_1.m4a' && waitingFileName('u1', 'rec_1', '') === 'u1_rec_1.m4a');
  const q = [entry('rec_1')];
  const stray = strayFiles('u1', ['u1_rec_1.m4a', 'u1_rec_2.m4a', 'u1_rec_3.m4a.part', 'u2_rec_4.m4a'], q);
  check('strays: unlisted and half-copied, this account only', stray.join() === 'u1_rec_2.m4a,u1_rec_3.m4a.part', stray);
}

console.log('Reading it back');
{
  const q = [entry('rec_1', { docWritten: true, attempts: 2, lastTriedAt: 5 })];
  const json = JSON.stringify(q);
  check('round trip', JSON.stringify(parseUploads([json])) === json);
  check('half-written newer copy falls back to the older', parseUploads(['[{"recor', json]).length === 1);
  check('nothing saved: empty', parseUploads([]).length === 0);
  const junk = JSON.stringify([{ fileName: 'x' }, null, 7, ...q]);
  check('an entry that is not one is dropped, the rest kept', parseUploads([junk]).length === 1);
  const old = JSON.stringify([{ recording: rec('rec_1'), fileName: 'u1_rec_1.m4a', contentType: 'audio/m4a' }]);
  const filled = parseUploads([old])[0];
  check('missing counters filled in', filled.docWritten === false && filled.attempts === 0 && filled.lastTriedAt === null);
  check('not a list: ignored', parseUploads(['{"a":1}']).length === 0);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll recording upload checks passed.');
}
