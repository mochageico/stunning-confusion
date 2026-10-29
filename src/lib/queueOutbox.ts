import type { QueueItem } from '../types';

// The "to send" list (OFFLINE_MODE_PLAN.md stage 1): every verse write the
// auto-sync makes is noted here, on the device, before it goes to Firestore,
// and taken off again only once Firestore confirms it. Firestore's own queue
// of unsent writes lives in memory on the phone, so closing the app with no
// signal used to lose every review done since the signal dropped. With this
// list they come back on the next launch.
//
// Pure functions only -- the file it's kept in is queueOutboxStore.ts -- so
// `npm run check:outbox` can run them under plain Node.

export interface OutboxEntry {
  /** The verse as it should be in Firestore, or null to delete it. */
  item: QueueItem | null;
  /** JSON of `item` exactly as it was written, so a confirm can tell an older write from a newer one. */
  json: string | null;
  /**
   * The verse as Firestore last had it when it first went on the list (JSON),
   * or null if Firestore didn't have it yet. Kept from the first entry on: it
   * tells, at the next launch, whether anything else changed the verse since.
   */
  base: string | null;
}

/** verseId -> what still has to reach Firestore for it. */
export type Outbox = Record<string, OutboxEntry>;

export const EMPTY_OUTBOX: Outbox = {};

/**
 * Notes these writes and deletes as waiting to send. `baseOf` gives what
 * Firestore is known to hold for a verse now; a verse already waiting keeps
 * the base it had, since Firestore still hasn't seen the earlier change.
 */
export function recordPending(
  outbox: Outbox,
  writes: { item: QueueItem; json: string }[],
  deletes: string[],
  baseOf: (verseId: string) => string | null
): Outbox {
  if (writes.length === 0 && deletes.length === 0) return outbox;
  const next: Outbox = { ...outbox };
  const baseFor = (id: string) => (id in outbox ? outbox[id].base : baseOf(id));
  for (const { item, json } of writes) next[item.verseId] = { item, json, base: baseFor(item.verseId) };
  for (const id of deletes) next[id] = { item: null, json: null, base: baseFor(id) };
  return next;
}

/**
 * Takes confirmed writes off the list. A verse whose entry has moved on to a
 * newer version since this write began stays on: that newer one hasn't been
 * confirmed yet.
 */
export function confirmSent(outbox: Outbox, writes: { verseId: string; json: string }[], deletes: string[]): Outbox {
  let next: Outbox | null = null;
  const drop = (id: string) => {
    if (!next) next = { ...outbox };
    delete next[id];
  };
  for (const { verseId, json } of writes) if (outbox[verseId]?.json === json) drop(verseId);
  for (const id of deletes) if (outbox[id] && outbox[id].item === null) drop(id);
  return next ?? outbox;
}

/** Takes these verses off the list outright: the caller just wrote their full current version. */
export function confirmIds(outbox: Outbox, ids: Iterable<string>): Outbox {
  let next: Outbox | null = null;
  for (const id of ids) {
    if (!(id in outbox)) continue;
    if (!next) next = { ...outbox };
    delete next[id];
  }
  return next ?? outbox;
}

/** JSON with keys sorted, so two copies of a verse compare equal however their fields were ordered. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  );
}

const sameVerse = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** When this copy of a verse was last practised or reviewed. */
function lastActivity(q: QueueItem): number {
  let latest = time(q.lastReviewDate);
  for (const log of q.touchLogs ?? []) latest = Math.max(latest, time(log.timestamp));
  for (const log of q.reviewLogs ?? []) latest = Math.max(latest, time(log.at));
  return latest;
}

/** Every log from both copies, once each, oldest first. */
function unionLogs<T>(a: T[] | undefined, b: T[] | undefined, at: (log: T) => string): T[] | undefined {
  if (!a && !b) return undefined;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const log of [...(a ?? []), ...(b ?? [])]) {
    const key = stableJson(log);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(log);
  }
  return out.sort((x, y) => time(at(x)) - time(at(y)));
}

/**
 * Two copies of one verse that were changed apart (another device, while this
 * one's change was waiting). Nothing practised is thrown away: both copies'
 * logs are kept, and the verse's step, due date and the rest come from
 * whichever copy was practised most recently. A tie goes to this device.
 */
export function mergeVerse(server: QueueItem, local: QueueItem): QueueItem {
  const newer = lastActivity(local) >= lastActivity(server) ? local : server;
  const merged: QueueItem = { ...newer };
  const touchLogs = unionLogs(server.touchLogs, local.touchLogs, (l) => l.timestamp);
  const reviewLogs = unionLogs(server.reviewLogs, local.reviewLogs, (l) => l.at);
  if (touchLogs) merged.touchLogs = touchLogs;
  if (reviewLogs) merged.reviewLogs = reviewLogs;
  return merged;
}

export interface AppliedOutbox {
  /** The loaded queue with everything still waiting put back on top. */
  queue: QueueItem[];
  /** Verses deleted on this device that Firestore still has: the caller deletes them. */
  deleteIds: string[];
  /** Entries that need nothing more (already in Firestore, or moot): off the list. */
  settled: string[];
}

/**
 * Puts the list back on top of the queue just loaded from Firestore, at
 * launch. For each verse waiting:
 *
 * - Firestore already has it as written: settled.
 * - Firestore still has what it had when the change was made: the change wins.
 * - Firestore has something else (another device changed it too): mergeVerse.
 * - Added here, not in Firestore yet: added back.
 * - Gone from Firestore after it had it (deleted on another device): stays deleted.
 * - Deleted here, still in Firestore: taken out, and the caller deletes it.
 */
export function applyOutbox(loaded: QueueItem[], outbox: Outbox): AppliedOutbox {
  const byId = new Map(loaded.map((q) => [q.verseId, q]));
  const deleteIds: string[] = [];
  const settled: string[] = [];
  for (const [id, entry] of Object.entries(outbox)) {
    const server = byId.get(id);
    if (entry.item === null) {
      if (server) {
        byId.delete(id);
        deleteIds.push(id);
      } else {
        settled.push(id);
      }
      continue;
    }
    if (!server) {
      if (entry.base === null) byId.set(id, entry.item);
      else settled.push(id);
      continue;
    }
    if (sameVerse(server, entry.item)) {
      settled.push(id);
      continue;
    }
    let untouched = false;
    if (entry.base !== null) {
      try {
        untouched = sameVerse(server, JSON.parse(entry.base));
      } catch {
        // An unreadable base just means merging instead.
      }
    }
    byId.set(id, untouched ? entry.item : mergeVerse(server, entry.item));
  }
  const queue = [...byId.values()].sort((a, b) => a.orderIndex - b.orderIndex);
  return { queue, deleteIds, settled };
}
