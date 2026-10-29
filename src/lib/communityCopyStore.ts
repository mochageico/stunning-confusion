import type { ChatMessage, Circle, DMThread } from '../types';
import { DeviceDoc, readDeviceDoc, writeDeviceDoc } from './deviceFile';

// The last-seen community lists on the device (OFFLINE_MODE_PLAN.md stage
// 6): your circles, your message threads and the latest messages of each chat
// you opened, so Community still shows something with no signal. Read-only:
// nothing here is ever sent anywhere.
//
// One file per account (deviceFile.ts). Saves wait a moment and then write
// once, so a busy chat doesn't rewrite the file on every message.

const MESSAGES_PER_CHAT = 50;
const MAX_CHATS = 30;
const SAVE_DELAY_MS = 2000;

interface CommunityCopy {
  version: 1;
  uid: string;
  circles: Circle[] | null;
  dmThreads: DMThread[] | null;
  /** 'dm:<threadId>' or 'circle:<circleId>' -> the latest messages, oldest first. */
  chats: Record<string, { messages: ChatMessage[]; savedAt: string }>;
}

// Account ids are Firebase uids (letters and digits), safe in a file name.
const docFor = (uid: string): DeviceDoc => ({ fileName: `community-copy-${uid}.json`, webKey: `communityCopy.v1:${uid}` });

const empty = (uid: string): CommunityCopy => ({ version: 1, uid, circles: null, dmThreads: null, chats: {} });

const loaded = new Map<string, Promise<CommunityCopy>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function current(uid: string): Promise<CommunityCopy> {
  let copy = loaded.get(uid);
  if (!copy) {
    copy = readDeviceDoc(docFor(uid))
      .then((raws) => {
        for (const raw of raws) {
          try {
            const data = JSON.parse(raw);
            // Another account's file must never show here.
            if (data?.version === 1 && data.uid === uid) return { ...empty(uid), ...data } as CommunityCopy;
          } catch {
            // Half-written copy: fall back to the older one.
          }
        }
        return empty(uid);
      })
      .catch((err) => {
        console.error('[community-copy] could not read the copy on this device:', err);
        return empty(uid);
      });
    loaded.set(uid, copy);
  }
  return copy;
}

function change(uid: string, edit: (copy: CommunityCopy) => void) {
  void current(uid).then((copy) => {
    edit(copy);
    const pending = timers.get(uid);
    if (pending) clearTimeout(pending);
    timers.set(
      uid,
      setTimeout(() => {
        timers.delete(uid);
        writeDeviceDoc(docFor(uid), JSON.stringify(copy)).catch((err) =>
          console.error('[community-copy] could not save the copy on this device:', err)
        );
      }, SAVE_DELAY_MS)
    );
  });
}

export const saveCircles = (uid: string, circles: Circle[]) => change(uid, (c) => void (c.circles = circles));

export const saveDmThreads = (uid: string, threads: DMThread[]) => change(uid, (c) => void (c.dmThreads = threads));

export function saveChat(uid: string, chatKey: string, messages: ChatMessage[]) {
  change(uid, (c) => {
    c.chats[chatKey] = { messages: messages.slice(-MESSAGES_PER_CHAT), savedAt: new Date().toISOString() };
    // Only the most recently opened chats are kept.
    const keys = Object.keys(c.chats).sort((a, b) => c.chats[b].savedAt.localeCompare(c.chats[a].savedAt));
    keys.slice(MAX_CHATS).forEach((k) => delete c.chats[k]);
  });
}

export const loadCircles = (uid: string) => current(uid).then((c) => c.circles);

export const loadDmThreads = (uid: string) => current(uid).then((c) => c.dmThreads);

export const loadChat = (uid: string, chatKey: string) => current(uid).then((c) => c.chats[chatKey]?.messages ?? null);

/** Removes this account's copy from the device (deleting the account). */
export async function clearCommunityCopy(uid: string): Promise<void> {
  const pending = timers.get(uid);
  if (pending) clearTimeout(pending);
  timers.delete(uid);
  loaded.delete(uid);
  await writeDeviceDoc(docFor(uid), null);
}
