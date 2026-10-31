// ============================================================================
// SPEECH SECOND PASS (Groq Whisper)
// ----------------------------------------------------------------------------
// After Stop in spoken Recall, the app sends the recording here in pieces of
// 25 s or less, cut at pauses on the phone. Each piece goes to Groq's
// whisper-large-v3-turbo at the same time, so the wait is one piece's round
// trip, not the sum. The app then marks a word missed only if Apple AND
// Whisper both missed it. Plan and bake-off numbers: SPEECH_SECOND_PASS_PLAN.md.
//
// Why a function rather than calling Groq from the phone: the key must not
// ship in the app, and the free tier's limits (about 20 requests a minute,
// 2,000 a day, shared by every user) can only be counted in one place.
//
// Nothing here is fatal to the user. Busy, over a limit, or Groq down: the
// app simply keeps Apple's grade. So every limit answers { busy: true }
// instead of throwing, and only a malformed request is an error.
//
// No prompt is sent. Whisper's `prompt` means "text said BEFORE this audio",
// and passing the words a piece covers made Whisper skip them in the
// bake-off. No hint measured best.
//
// Audio is not stored: pieces live in this request's memory only.
//
// The key is a Functions secret (GROQ_API_KEY), never app.config.js.
// ============================================================================

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineInt } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { halves, looksCollapsed, pieceSeconds, wordCount } from './transcribeAudio';

const groqKey = defineSecret('GROQ_API_KEY');

// The app's data lives in this named database, not (default) -- see index.ts.
const FIRESTORE_DATABASE_ID = 'ai-studio-da1c3045-26bb-470c-883c-0b120417bcda';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';

/**
 * Pieces (Groq requests) allowed per UTC day across all users. Groq's free
 * tier allows 2,000 a day; the default stays below it so requests already in
 * flight can't overshoot. Raise it with TRANSCRIBE_DAILY_CAP on a paid plan.
 */
const dailyCap = defineInt('TRANSCRIBE_DAILY_CAP', { default: 1800 });

/** Pieces one account may send per UTC day: one person can't spend everyone's day. */
const userDailyCap = defineInt('TRANSCRIBE_USER_DAILY_CAP', { default: 300 });

/** Requests one account may make per minute (each request is up to MAX_PIECES pieces). */
const USER_PER_MINUTE = 4;

// 16 pieces of up to 25 s is about 6.5 minutes of recitation. A 16 kHz 16-bit
// mono WAV is 32 KB a second, so a 25 s piece is about 800 KB; 1.2 MB leaves
// room for a 24 s hard cut plus header. 9 MB total keeps the base64 request
// well under the 32 MB request limit.
const MAX_PIECES = 16;
const MAX_PIECE_BYTES = 1_200_000;
const MAX_TOTAL_BYTES = 9_000_000;

/** Each Groq request's own time limit. The app gives up at about 5 s anyway. */
const GROQ_TIMEOUT_MS = 8000;
/** Longest wait for a 429's retry-after before answering busy. */
const MAX_RETRY_WAIT_MS = 1500;

interface TranscribeRequest {
  /** Just start the instance (sent when Recall opens). */
  warm?: boolean;
  /** WAV pieces, base64, in order. */
  pieces?: string[];
}

export type TranscribeResponse = { texts: string[] } | { busy: true } | { warm: true };

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Counts this request against the per-user and global limits in one
 * transaction. Returns false (and records nothing) when any limit is reached.
 */
async function reserve(db: FirebaseFirestore.Firestore, uid: string, pieces: number): Promise<boolean> {
  const day = dayKey();
  const minute = Math.floor(Date.now() / 60_000);
  const globalRef = db.doc(`transcribeUsage/${day}`);
  const userRef = db.doc(`transcribeUsage/${day}/users/${uid}`);
  return db.runTransaction(async (tx) => {
    const [g, u] = await Promise.all([tx.get(globalRef), tx.get(userRef)]);
    const globalPieces = (g.data()?.pieces as number | undefined) ?? 0;
    const userPieces = (u.data()?.pieces as number | undefined) ?? 0;
    const sameMinute = u.data()?.minute === minute;
    const minuteCalls = sameMinute ? ((u.data()?.minuteCalls as number | undefined) ?? 0) : 0;
    if (globalPieces + pieces > dailyCap.value()) return false;
    if (userPieces + pieces > userDailyCap.value()) return false;
    if (minuteCalls + 1 > USER_PER_MINUTE) return false;
    tx.set(globalRef, { pieces: globalPieces + pieces, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(userRef, { pieces: userPieces + pieces, minute, minuteCalls: minuteCalls + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

class GroqBusy extends Error {}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One piece to Groq. Retries a 429 once, then throws GroqBusy. */
async function transcribePiece(audio: Buffer, index: number, signal: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), `piece${index}.wav`);
    form.append('model', GROQ_MODEL);
    form.append('language', 'en');
    form.append('temperature', '0');
    form.append('response_format', 'json');

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey.value()}` },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(GROQ_TIMEOUT_MS)]),
    });

    if (res.ok) {
      const body = (await res.json()) as { text?: string };
      return (body.text ?? '').trim();
    }
    if (res.status === 429) {
      const retryAfterMs = Number(res.headers.get('retry-after')) * 1000;
      if (attempt === 0 && Number.isFinite(retryAfterMs) && retryAfterMs <= MAX_RETRY_WAIT_MS) {
        await wait(Math.max(retryAfterMs, 200));
        continue;
      }
      throw new GroqBusy('Groq rate limit');
    }
    const detail = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/**
 * One piece, retried as two halves when Whisper collapsed on it (see
 * transcribeAudio.ts). `extra` counts the retry's requests for the usage log.
 */
async function transcribeChecked(audio: Buffer, index: number, signal: AbortSignal, extra: { requests: number }): Promise<string> {
  const text = await transcribePiece(audio, index, signal);
  if (!looksCollapsed(audio, text)) return text;
  const parts = halves(audio);
  if (!parts) return text;
  extra.requests += 2;
  const retried = (await Promise.all(parts.map((p, h) => transcribePiece(p, index * 10 + h, signal)))).join(' ');
  logger.info('Whisper collapsed on a piece; retried in halves', {
    seconds: Math.round(pieceSeconds(audio)),
    before: wordCount(text),
    after: wordCount(retried),
  });
  return wordCount(retried) > wordCount(text) ? retried : text;
}

export const transcribePieces = onCall(
  {
    region: 'us-east1',
    secrets: [groqKey],
    memory: '512MiB',
    timeoutSeconds: 30,
    // App Check is not set up in the app yet (it needs App Attest in a new
    // native build). Until then, sign-in plus the limits above guard the key.
    // Turn on enforceAppCheck here once the app sends tokens.
  },
  async (request): Promise<TranscribeResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to use the second pass.');

    const { warm, pieces } = (request.data ?? {}) as TranscribeRequest;

    // Recall calls this when it opens, so the instance is awake by Stop. A
    // separate warm-up function would wake a different instance.
    if (warm) return { warm: true };

    if (!Array.isArray(pieces) || pieces.length === 0 || pieces.length > MAX_PIECES || pieces.some((p) => typeof p !== 'string')) {
      throw new HttpsError('invalid-argument', `pieces must be 1 to ${MAX_PIECES} base64 strings.`);
    }
    const audio = pieces.map((p) => Buffer.from(p, 'base64'));
    const total = audio.reduce((n, b) => n + b.length, 0);
    if (audio.some((b) => b.length < 44 || b.length > MAX_PIECE_BYTES) || total > MAX_TOTAL_BYTES) {
      throw new HttpsError('invalid-argument', 'A piece is empty or too long.');
    }

    // The limit check and the Groq requests run together, so the check adds
    // no wait. If the check says no, the requests are cancelled.
    const db = getFirestore(FIRESTORE_DATABASE_ID);
    const controller = new AbortController();
    const allowed = reserve(db, request.auth.uid, audio.length).then((ok) => {
      if (!ok) controller.abort();
      return ok;
    });
    const extra = { requests: 0 };
    const results = Promise.all(audio.map((b, i) => transcribeChecked(b, i, controller.signal, extra)));
    results.catch(() => undefined); // handled below; avoids an unhandled rejection when the limit check aborts

    try {
      if (!(await allowed)) {
        logger.info('transcribePieces over a limit', { uid: request.auth.uid, pieces: audio.length });
        return { busy: true };
      }
    } catch (err) {
      // Can't count it, so don't spend it.
      controller.abort();
      logger.error('transcribePieces usage check failed', { err: String(err) });
      return { busy: true };
    }

    try {
      const texts = await results;
      // Retries were not in the up-front count; add them now so the daily total stays true to what Groq saw.
      if (extra.requests) {
        db.doc(`transcribeUsage/${dayKey()}`)
          .set({ pieces: FieldValue.increment(extra.requests) }, { merge: true })
          .catch(() => undefined);
      }
      return { texts };
    } catch (err) {
      controller.abort();
      if (err instanceof GroqBusy) {
        logger.warn('Groq busy', { pieces: audio.length });
      } else {
        logger.error('Groq transcription failed', { err: String(err), pieces: audio.length });
      }
      return { busy: true };
    }
  }
);
