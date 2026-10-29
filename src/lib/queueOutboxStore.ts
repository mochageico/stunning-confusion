import type { QueueItem } from '../types';
import { DeviceDoc, readDeviceDoc, writeDeviceDoc } from './deviceFile';
import { EMPTY_OUTBOX, Outbox, confirmSent, recordPending } from './queueOutbox';

// Where the "to send" list (queueOutbox.ts) is kept: one per account, in a
// file on the phone (deviceFile.ts) -- a bulk change can put hundreds of
// verses on the list, more than Android lets one AsyncStorage entry hold.
//
// Every change goes through one queue, in order, and is saved before the
// promise it returns resolves: the auto-sync waits for that before writing to
// Firestore, so a write is always on the list before it can be lost.

// Account ids are Firebase uids (letters and digits), safe in a file name.
const docFor = (uid: string): DeviceDoc => ({ fileName: `queue-outbox-${uid}.json`, webKey: `queueOutbox.v1:${uid}` });

const readCandidates = (uid: string) => readDeviceDoc(docFor(uid));

const writeRaw = (uid: string, outbox: Outbox) =>
  writeDeviceDoc(docFor(uid), Object.keys(outbox).length === 0 ? null : JSON.stringify(outbox));

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
