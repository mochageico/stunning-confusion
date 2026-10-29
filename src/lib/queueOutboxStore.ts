import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { QueueItem } from '../types';
import { EMPTY_OUTBOX, Outbox, confirmIds, confirmSent, recordPending } from './queueOutbox';

// Where the "to send" list (queueOutbox.ts) is kept: one per account. On the
// phone it's a file in the documents folder (never the cache folder, which
// the OS may clear) -- a bulk change can put hundreds of verses on the list,
// more than Android lets one AsyncStorage entry hold. The web has no such
// folder, so it uses AsyncStorage (localStorage) instead.
//
// Every change goes through one queue, in order, and is saved before the
// promise it returns resolves: the auto-sync waits for that before writing to
// Firestore, so a write is always on the list before it can be lost.

const KEY_PREFIX = 'queueOutbox.v1:';

// Account ids are Firebase uids (letters and digits), safe in a file name.
const fileFor = (uid: string) => new File(Paths.document, `queue-outbox-${uid}.json`);
const partFileFor = (uid: string) => new File(Paths.document, `queue-outbox-${uid}.json.part`);

/** Saved copies, newest first: a leftover .part is a save that stopped just before being swapped in. */
async function readCandidates(uid: string): Promise<string[]> {
  if (Platform.OS === 'web') {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + uid);
    return raw ? [raw] : [];
  }
  const out: string[] = [];
  for (const f of [partFileFor(uid), fileFor(uid)]) if (f.exists) out.push(await f.text());
  return out;
}

async function writeRaw(uid: string, outbox: Outbox): Promise<void> {
  const empty = Object.keys(outbox).length === 0;
  if (Platform.OS === 'web') {
    if (empty) await AsyncStorage.removeItem(KEY_PREFIX + uid);
    else await AsyncStorage.setItem(KEY_PREFIX + uid, JSON.stringify(outbox));
    return;
  }
  const file = fileFor(uid);
  if (empty) {
    if (file.exists) file.delete();
    return;
  }
  // New copy first, then swapped in, so a crash mid-save leaves the old
  // list (or the complete new one), never half a file.
  const part = partFileFor(uid);
  part.create({ overwrite: true });
  part.write(JSON.stringify(outbox));
  await part.move(file, { overwrite: true });
}

const loaded = new Map<string, Outbox>();
let chain: Promise<unknown> = Promise.resolve();

/** Runs `step` after every earlier change has finished, whether or not it failed. */
function inOrder<T>(step: () => Promise<T>): Promise<T> {
  const run = chain.then(step, step);
  chain = run.catch(() => undefined);
  return run;
}

async function current(uid: string): Promise<Outbox> {
  const cached = loaded.get(uid);
  if (cached) return cached;
  let outbox: Outbox = EMPTY_OUTBOX;
  try {
    for (const raw of await readCandidates(uid)) {
      try {
        outbox = JSON.parse(raw) as Outbox;
        break;
      } catch {
        // Half-written copy: fall back to the older one.
      }
    }
  } catch (err) {
    console.error('[outbox] could not read the to-send list; starting empty:', err);
  }
  loaded.set(uid, outbox);
  return outbox;
}

function update(uid: string, change: (outbox: Outbox) => Outbox): Promise<void> {
  return inOrder(async () => {
    const before = await current(uid);
    const after = change(before);
    if (after === before) return;
    loaded.set(uid, after);
    await writeRaw(uid, after);
  });
}

/** This account's list as it stands. */
export function loadOutbox(uid: string): Promise<Outbox> {
  return inOrder(() => current(uid));
}

/** Notes writes and deletes as waiting; resolves once that's saved on the device. */
export function outboxRecord(
  uid: string,
  writes: { item: QueueItem; json: string }[],
  deletes: string[],
  baseOf: (verseId: string) => string | null
): Promise<void> {
  return update(uid, (o) => recordPending(o, writes, deletes, baseOf));
}

/** Takes writes Firestore confirmed off the list (only the version that was sent). */
export function outboxConfirm(uid: string, writes: { verseId: string; json: string }[], deletes: string[]): Promise<void> {
  return update(uid, (o) => confirmSent(o, writes, deletes));
}

/** Takes verses off the list whose full current version was just written. */
export function outboxSettle(uid: string, ids: Iterable<string>): Promise<void> {
  const list = [...ids];
  return update(uid, (o) => confirmIds(o, list));
}
