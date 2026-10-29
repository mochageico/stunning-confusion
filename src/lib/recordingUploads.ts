import type { Recording } from '../types';

// Recordings made with no signal (OFFLINE_MODE_PLAN.md stage 7). The take is
// kept as a file on the phone and noted on this list; once signal is back it
// uploads, which starts the usual studio processing, and only then comes off
// the list. Until then it shows in the recordings lists as "waiting to
// upload" and plays from the phone.
//
// Pure functions only -- the files live in recordingUploadStore.ts -- so
// `npm run check:uploads` can run them under plain Node.

export interface WaitingUpload {
  /**
   * The recording as it will be written to Firestore: no audioUrl yet (that
   * only exists after the upload) and none of the on-phone fields below.
   * Edits made while it waits (speaker, sharing, sync marks, order) go here.
   */
  recording: Recording;
  /** The audio file's name in the waiting-uploads folder on the phone. */
  fileName: string;
  contentType: string;
  /**
   * The Firestore doc is written before the audio (see persistRecording: the
   * upload is what starts the studio function, which writes into that doc).
   * Once written it must not be written whole again, or a studio render that
   * already landed would be wiped.
   */
  docWritten: boolean;
  /** Failed upload attempts so far. */
  attempts: number;
  /** When the last attempt began (ms), for the wait between attempts. */
  lastTriedAt: number | null;
}

/** Oldest first, so they upload in the order they were recorded. */
export type UploadQueue = WaitingUpload[];

export const EMPTY_UPLOADS: UploadQueue = [];

/** Puts a recording on the list (replacing one with the same id). */
export function addWaiting(queue: UploadQueue, entry: WaitingUpload): UploadQueue {
  return [...queue.filter((e) => e.recording.id !== entry.recording.id), entry];
}

/** Takes it off: uploaded, or deleted before it could be. */
export function removeWaiting(queue: UploadQueue, id: string): UploadQueue {
  return queue.some((e) => e.recording.id === id) ? queue.filter((e) => e.recording.id !== id) : queue;
}

export function findWaiting(queue: UploadQueue, id: string): WaitingUpload | undefined {
  return queue.find((e) => e.recording.id === id);
}

/** Applies an edit made while it waits, so it goes up with the recording. */
export function patchWaiting(queue: UploadQueue, id: string, patch: Partial<Recording>): UploadQueue {
  if (!findWaiting(queue, id)) return queue;
  return queue.map((e) => (e.recording.id === id ? { ...e, recording: { ...e.recording, ...patch, id } } : e));
}

export function setDocWritten(queue: UploadQueue, id: string, docWritten: boolean): UploadQueue {
  const entry = findWaiting(queue, id);
  if (!entry || entry.docWritten === docWritten) return queue;
  return queue.map((e) => (e === entry ? { ...e, docWritten } : e));
}

/** An attempt is starting: counted now, so one that dies mid-way still waits before the next. */
export function markTried(queue: UploadQueue, id: string, now: number): UploadQueue {
  return queue.map((e) => (e.recording.id === id ? { ...e, attempts: e.attempts + 1, lastTriedAt: now } : e));
}

const FIRST_WAIT_MS = 30_000;
const LONGEST_WAIT_MS = 30 * 60_000;

/** How long after an attempt the next one waits: 30 s, doubling, at most 30 min. */
export function retryWait(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(LONGEST_WAIT_MS, FIRST_WAIT_MS * 2 ** (attempts - 1));
}

/** The next recording to upload now, or null if none is due. */
export function nextDue(queue: UploadQueue, now: number): WaitingUpload | null {
  for (const e of queue) {
    if (e.lastTriedAt === null || now - e.lastTriedAt >= retryWait(e.attempts)) return e;
  }
  return null;
}

/** When the next one falls due (ms from now), or null if the list is empty. */
export function msUntilNextDue(queue: UploadQueue, now: number): number | null {
  let soonest: number | null = null;
  for (const e of queue) {
    const wait = e.lastTriedAt === null ? 0 : Math.max(0, e.lastTriedAt + retryWait(e.attempts) - now);
    if (soonest === null || wait < soonest) soonest = wait;
  }
  return soonest;
}

/**
 * The fields written to Firestore for it. studioStatus is claimed as
 * 'pending' only now, at upload, and uploadedAt says when -- the "still
 * polishing?" check (isStudioPending) dates the wait from it rather than from
 * when it was recorded, which may be days earlier.
 */
export function firestoreFields(entry: WaitingUpload, uploadedAt: number): Recording {
  const { uploadPending: _p, localAudioUri: _l, audioUrl: _a, ...fields } = entry.recording;
  return { ...fields, studioStatus: 'pending', uploadedAt };
}

/** How it shows in the lists while it waits: playing from the phone. */
export function asListed(entry: WaitingUpload, localAudioUri: string | null): Recording {
  const { studioStatus: _s, ...fields } = entry.recording;
  return { ...fields, uploadPending: true, ...(localAudioUri ? { localAudioUri } : {}) };
}

/**
 * The recordings list with everything waiting put in, newest first. One
 * whose doc already reached Firestore (an upload that stopped half-way) is
 * in the loaded list without its audio; the waiting copy replaces it.
 */
export function withWaiting(
  loaded: Recording[],
  queue: UploadQueue,
  uriOf: (entry: WaitingUpload) => string | null
): Recording[] {
  if (queue.length === 0) return loaded;
  const waiting = new Map(queue.map((e) => [e.recording.id, asListed(e, uriOf(e))]));
  const rest = loaded.filter((r) => !waiting.has(r.id));
  return [...[...waiting.values()].reverse(), ...rest];
}

/** File name for a waiting take: the account and recording id, so a sweep can tell whose it is. */
export function waitingFileName(uid: string, recordingId: string, ext: string): string {
  return `${uid}_${recordingId}.${ext.replace(/[^A-Za-z0-9]/g, '') || 'm4a'}`;
}

/** This account's files in the folder that no entry points at, .part copies included (a keep that stopped half-way). */
export function strayFiles(uid: string, fileNames: string[], queue: UploadQueue): string[] {
  const kept = new Set(queue.map((e) => e.fileName));
  return fileNames.filter((n) => n.startsWith(`${uid}_`) && !kept.has(n));
}

function isEntry(v: unknown): v is WaitingUpload {
  const e = v as WaitingUpload;
  return (
    !!e &&
    typeof e === 'object' &&
    !!e.recording &&
    typeof e.recording.id === 'string' &&
    typeof e.fileName === 'string' &&
    e.fileName.length > 0 &&
    typeof e.contentType === 'string'
  );
}

/**
 * Reads the saved list from its copies, newest first (a leftover half-way
 * save comes first). The first copy that reads cleanly wins; an entry that
 * doesn't look like one is dropped rather than failing the whole list.
 */
export function parseUploads(copies: string[]): UploadQueue {
  for (const raw of copies) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    return parsed.filter(isEntry).map((e) => ({
      recording: e.recording,
      fileName: e.fileName,
      contentType: e.contentType,
      docWritten: e.docWritten === true,
      attempts: typeof e.attempts === 'number' && e.attempts > 0 ? e.attempts : 0,
      lastTriedAt: typeof e.lastTriedAt === 'number' ? e.lastTriedAt : null,
    }));
  }
  return EMPTY_UPLOADS;
}
