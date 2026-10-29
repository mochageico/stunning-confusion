import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

// A JSON document kept on the device for offline mode (OFFLINE_MODE_PLAN.md):
// the "to send" list (queueOutboxStore.ts) and the copy of the verses
// (localCopyStore.ts). On the phone it's a file in the documents folder
// (never the cache folder, which the OS may clear) -- 700 verses with full
// histories can be more than Android lets one AsyncStorage entry hold. The
// web has no such folder, so it uses AsyncStorage (localStorage) instead.

export interface DeviceDoc {
  /** File name in the documents folder (phone). */
  fileName: string;
  /** AsyncStorage key (web). */
  webKey: string;
}

const fileOf = (d: DeviceDoc) => new File(Paths.document, d.fileName);
const partFileOf = (d: DeviceDoc) => new File(Paths.document, `${d.fileName}.part`);

/** Saved copies, newest first: a leftover .part is a save that stopped just before being swapped in. */
export async function readDeviceDoc(d: DeviceDoc): Promise<string[]> {
  if (Platform.OS === 'web') {
    const raw = await AsyncStorage.getItem(d.webKey);
    return raw ? [raw] : [];
  }
  const out: string[] = [];
  for (const f of [partFileOf(d), fileOf(d)]) if (f.exists) out.push(await f.text());
  return out;
}

/** Saves `json`, or removes the document when it's null. */
export async function writeDeviceDoc(d: DeviceDoc, json: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (json === null) await AsyncStorage.removeItem(d.webKey);
    else await AsyncStorage.setItem(d.webKey, json);
    return;
  }
  const file = fileOf(d);
  if (json === null) {
    if (file.exists) file.delete();
    const part = partFileOf(d);
    if (part.exists) part.delete();
    return;
  }
  // New copy first, then swapped in, so a crash mid-save leaves the old
  // copy (or the complete new one), never half a file.
  const part = partFileOf(d);
  part.create({ overwrite: true });
  part.write(json);
  await part.move(file, { overwrite: true });
}
