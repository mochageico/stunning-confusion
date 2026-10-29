import type { QueueItem, Rhythm, VerseState } from '../types';
import type { LadderPrefs } from './ladderEngine';

// The copy of your verses on the phone (OFFLINE_MODE_PLAN.md stage 2): what
// the app needs to open with no signal. Saved after each successful load and
// each confirmed save; read only when the server can't be reached (stage 3).
//
// The queue here is the memoryQueue AS FIRESTORE HAS IT, not the live queue:
// the "to send" list (queueOutbox.ts) goes on top of it, the same way it goes
// on top of a server load, and its entries only count as owed because they
// differ from what Firestore holds. A copy of the live queue would make every
// waiting change look already sent.
//
// Pure functions only -- the file it's kept in is localCopyStore.ts -- so
// `npm run check:localcopy` can run them under plain Node.

export const LOCAL_COPY_VERSION = 1;

/** The plan settings loadUserData reads before the queue (memoryPlans/{uid}). */
export interface LocalSettings {
  rhythm: Rhythm;
  ladderPrefs: LadderPrefs;
  /** null until this account's queue has been moved onto the ladder. */
  ladderVersion: number | null;
  masteryTouches: number;
}

export interface LocalCopy {
  version: typeof LOCAL_COPY_VERSION;
  uid: string;
  /** memoryQueue as Firestore last confirmed it, in order; null if never loaded. */
  queue: QueueItem[] | null;
  /** users/{uid}/verses; null if never loaded. */
  verses: VerseState[] | null;
  settings: LocalSettings | null;
  /** When each part was last saved (ISO), so stage 3 can say how old the copy is. */
  savedAt: { queue: string | null; verses: string | null; settings: string | null };
}

export type LocalCopyPatch = Partial<Pick<LocalCopy, 'queue' | 'verses' | 'settings'>>;

const PARTS = ['queue', 'verses', 'settings'] as const;

export const emptyLocalCopy = (uid: string): LocalCopy => ({
  version: LOCAL_COPY_VERSION,
  uid,
  queue: null,
  verses: null,
  settings: null,
  savedAt: { queue: null, verses: null, settings: null },
});

/**
 * A saved copy, or null if it can't be trusted: unreadable, an older layout,
 * or another account's (a file name mix-up must never open someone else's
 * verses). A part with the wrong shape is dropped on its own.
 */
export function parseLocalCopy(raw: string, uid: string): LocalCopy | null {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || data.version !== LOCAL_COPY_VERSION || data.uid !== uid) return null;
  const savedAt = data.savedAt && typeof data.savedAt === 'object' ? data.savedAt : {};
  const copy = emptyLocalCopy(uid);
  if (Array.isArray(data.queue)) copy.queue = data.queue;
  if (Array.isArray(data.verses)) copy.verses = data.verses;
  if (data.settings && typeof data.settings === 'object' && data.settings.rhythm && data.settings.ladderPrefs) {
    copy.settings = data.settings;
  }
  for (const part of PARTS) {
    copy.savedAt[part] = copy[part] !== null && typeof savedAt[part] === 'string' ? savedAt[part] : null;
  }
  return copy;
}

/**
 * The copy with these parts replaced, stamped `now`. Returns the same object
 * when nothing differs, so the caller can skip the save.
 */
export function patchLocalCopy(copy: LocalCopy, patch: LocalCopyPatch, now: string): LocalCopy {
  let next: LocalCopy | null = null;
  for (const part of PARTS) {
    if (!(part in patch)) continue;
    const value = patch[part] ?? null;
    if (JSON.stringify(value) === JSON.stringify(copy[part])) continue;
    if (!next) next = { ...copy, savedAt: { ...copy.savedAt } };
    (next as any)[part] = value;
    next.savedAt[part] = value === null ? null : now;
  }
  return next ?? copy;
}

/** The queue as Firestore holds it, from the auto-sync's baseline, in queue order. */
export function queueFromBaseline(baseline: Iterable<QueueItem>): QueueItem[] {
  return [...baseline].sort((a, b) => a.orderIndex - b.orderIndex);
}
