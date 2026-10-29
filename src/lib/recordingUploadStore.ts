import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { DeviceDoc, readDeviceDoc, writeDeviceDoc } from './deviceFile';
import {
  EMPTY_UPLOADS,
  UploadQueue,
  WaitingUpload,
  addWaiting,
  parseUploads,
  removeWaiting,
  strayFiles,
} from './recordingUploads';

// Where recordings made with no signal wait (recordingUploads.ts): the audio
// in a folder in the documents folder (never the cache folder, which the OS
// may clear), and the list of them in a file beside it (deviceFile.ts). The
// file is always in place before its entry is saved, and the entry comes off
// before the file is deleted, so a crash at any point leaves at worst a stray
// file -- swept by sweepStrayAudio -- never an entry without its audio.
//
// The web has no documents folder and a recording there is a blob: URL that
// goes when the tab does, so it can't wait: OFFLINE_RECORDINGS_SUPPORTED is
// false there and recordings still need signal to save.

export const OFFLINE_RECORDINGS_SUPPORTED = Platform.OS !== 'web';

const FOLDER = 'waiting-uploads';

const docFor = (uid: string): DeviceDoc => ({ fileName: `recording-uploads-${uid}.json`, webKey: `recordingUploads.v1:${uid}` });

function folder(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const audioFile = (fileName: string) => new File(folder(), fileName);

const loaded = new Map<string, UploadQueue>();
let chain: Promise<unknown> = Promise.resolve();

/** Runs `step` after every earlier change has finished, whether or not it failed. */
function inOrder<T>(step: () => Promise<T>): Promise<T> {
  const run = chain.then(step, step);
  chain = run.catch(() => undefined);
  return run;
}

async function current(uid: string): Promise<UploadQueue> {
  const cached = loaded.get(uid);
  if (cached) return cached;
  let queue: UploadQueue = EMPTY_UPLOADS;
  try {
    queue = parseUploads(await readDeviceDoc(docFor(uid)));
  } catch (err) {
    console.error('[uploads] could not read the waiting recordings; starting empty:', err);
  }
  loaded.set(uid, queue);
  return queue;
}

/** Only ever called inside inOrder. */
async function apply(uid: string, change: (queue: UploadQueue) => UploadQueue): Promise<UploadQueue> {
  const before = await current(uid);
  const after = change(before);
  if (after === before) return before;
  await writeDeviceDoc(docFor(uid), after.length === 0 ? null : JSON.stringify(after));
  loaded.set(uid, after);
  return after;
}

const update = (uid: string, change: (queue: UploadQueue) => UploadQueue) => inOrder(() => apply(uid, change));

/** This account's waiting recordings, oldest first. */
export function loadUploads(uid: string): Promise<UploadQueue> {
  if (!OFFLINE_RECORDINGS_SUPPORTED) return Promise.resolve(EMPTY_UPLOADS);
  return inOrder(() => current(uid));
}

/** Applies a change to the list and saves it; resolves with the list as saved. */
export function changeUploads(uid: string, change: (queue: UploadQueue) => UploadQueue): Promise<UploadQueue> {
  return update(uid, change);
}

/**
 * Keeps a finished take on the phone and puts it on the list. The audio is
 * copied in (the recorder's own file sits in a folder the OS may clear) under
 * a .part name and swapped in, then the entry is saved. Resolves once both
 * are on the phone.
 */
export function keepForUpload(uid: string, sourceUri: string, entry: WaitingUpload): Promise<void> {
  // All in one step, so a sweep can never see the file before its entry.
  return inOrder(async () => {
    const dest = audioFile(entry.fileName);
    const part = audioFile(`${entry.fileName}.part`);
    if (part.exists) part.delete();
    await new File(sourceUri).copy(part);
    await part.move(dest, { overwrite: true });
    await apply(uid, (q) => addWaiting(q, entry));
  });
}

/** Takes it off the list, then deletes its audio. */
export async function dropUpload(uid: string, entry: WaitingUpload): Promise<void> {
  await update(uid, (q) => removeWaiting(q, entry.recording.id));
  try {
    const file = audioFile(entry.fileName);
    if (file.exists) file.delete();
  } catch (err) {
    console.error('[uploads] could not delete an uploaded take:', err);
  }
}

/** The kept take's file:// URI, or null if it's missing. */
export function waitingAudioUri(entry: WaitingUpload): string | null {
  if (!OFFLINE_RECORDINGS_SUPPORTED) return null;
  try {
    const file = audioFile(entry.fileName);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** The kept take's bytes, for the upload. */
export function readWaitingAudio(entry: WaitingUpload): Promise<ArrayBuffer> {
  return audioFile(entry.fileName).arrayBuffer();
}

/** Deletes this account's takes that no entry points at (a keep that stopped before its entry was saved). */
export async function sweepStrayAudio(uid: string): Promise<void> {
  if (!OFFLINE_RECORDINGS_SUPPORTED) return;
  await inOrder(async () => {
    const queue = await current(uid);
    const names = folder()
      .list()
      .filter((f): f is File => f instanceof File)
      .map((f) => f.name);
    for (const name of strayFiles(uid, names, queue)) {
      try {
        audioFile(name).delete();
      } catch (err) {
        console.error('[uploads] could not delete a stray take:', err);
      }
    }
  });
}

/** Account deletion: every waiting take and the list, gone. */
export async function clearUploads(uid: string): Promise<void> {
  if (!OFFLINE_RECORDINGS_SUPPORTED) return;
  await inOrder(async () => {
    loaded.set(uid, EMPTY_UPLOADS);
    await writeDeviceDoc(docFor(uid), null);
    for (const f of folder().list()) {
      if (f instanceof File && f.name.startsWith(`${uid}_`)) f.delete();
    }
  });
}
