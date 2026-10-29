import { DeviceDoc, readDeviceDoc, writeDeviceDoc } from './deviceFile';
import { emptyLocalCopy, LocalCopy, LocalCopyPatch, parseLocalCopy, patchLocalCopy } from './localCopy';

// Where the copy of your verses (localCopy.ts) is kept: one per account, in a
// file on the phone (deviceFile.ts).
//
// Saves are coalesced: while one is being written, later patches for the same
// account are merged and written once after it, so a run of reviews never
// queues up a run of full-file writes.

// Account ids are Firebase uids (letters and digits), safe in a file name.
const docFor = (uid: string): DeviceDoc => ({ fileName: `local-copy-${uid}.json`, webKey: `localCopy.v1:${uid}` });

const loaded = new Map<string, LocalCopy>();
const pending = new Map<string, LocalCopyPatch>();
let chain: Promise<unknown> = Promise.resolve();

/** Runs `step` after every earlier one has finished, whether or not it failed. */
function inOrder<T>(step: () => Promise<T>): Promise<T> {
  const run = chain.then(step, step);
  chain = run.catch(() => undefined);
  return run;
}

async function current(uid: string): Promise<LocalCopy> {
  const cached = loaded.get(uid);
  if (cached) return cached;
  let copy: LocalCopy | null = null;
  try {
    for (const raw of await readDeviceDoc(docFor(uid))) {
      copy = parseLocalCopy(raw, uid);
      // Half-written or unusable copy: fall back to the older one.
      if (copy) break;
    }
  } catch (err) {
    console.error('[local-copy] could not read the copy on this device:', err);
  }
  const result = copy ?? emptyLocalCopy(uid);
  loaded.set(uid, result);
  return result;
}

/** This account's copy on the device; every part is null if there isn't one. */
export function loadLocalCopy(uid: string): Promise<LocalCopy> {
  return inOrder(() => current(uid));
}

/**
 * Replaces these parts of the copy. Resolves once the copy holding them (or
 * a later one) is saved on the device.
 */
export function saveLocalCopy(uid: string, patch: LocalCopyPatch): Promise<void> {
  pending.set(uid, { ...pending.get(uid), ...patch });
  return inOrder(async () => {
    const waiting = pending.get(uid);
    // Already written by an earlier step that picked this patch up.
    if (!waiting) return;
    pending.delete(uid);
    const before = await current(uid);
    const after = patchLocalCopy(before, waiting, new Date().toISOString());
    if (after === before) return;
    try {
      await writeDeviceDoc(docFor(uid), JSON.stringify(after));
      loaded.set(uid, after);
    } catch (err) {
      // Read the file again next time rather than trust a copy that never landed.
      loaded.delete(uid);
      throw err;
    }
  });
}

/** Removes this account's copy from the device (deleting the account). */
export function clearLocalCopy(uid: string): Promise<void> {
  return inOrder(async () => {
    pending.delete(uid);
    loaded.delete(uid);
    await writeDeviceDoc(docFor(uid), null);
  });
}
