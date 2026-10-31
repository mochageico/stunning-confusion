// ============================================================================
// SPEECH SECOND PASS CLIENT
// ----------------------------------------------------------------------------
// Thin wrapper over the transcribePieces Cloud Function (see
// functions/src/transcribe.ts and SPEECH_SECOND_PASS_PLAN.md). The second pass
// only ever corrects Apple's grade, so every failure here (offline, busy, slow,
// signed out) comes back as null and the caller keeps Apple's grade silently.
// ============================================================================

import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { combineSecondPass, gradeTranscript, WordOutcome } from './recitation';
import { pickPieces } from './speechPieces';
import { SentPiece, speechRecordingPieces } from './speechRecording';

// Must match the region the callable is deployed to (functions/src/transcribe.ts).
const FUNCTIONS_REGION = 'us-east1';

/** How long Recall waits after Stop before keeping Apple's grade. */
export const SECOND_PASS_TIMEOUT_MS = 5000;

type TranscribeResponse = { texts: string[] } | { busy: true } | { warm: true };

const callable = () =>
  httpsCallable<Record<string, unknown>, TranscribeResponse>(getFunctions(getApp(), FUNCTIONS_REGION), 'transcribePieces', {
    timeout: SECOND_PASS_TIMEOUT_MS,
  });

/**
 * Wakes the function so it's ready by Stop. Call when Recall opens; an idle
 * function takes 1-4 s to start, which would otherwise land on the user.
 */
export function warmSecondPass(): void {
  callable()({ warm: true }).catch(() => undefined);
}

/**
 * Whisper's text for each piece (base64 WAV, in order), or null when the
 * second pass isn't available right now.
 */
export async function transcribePieces(pieces: string[]): Promise<string[] | null> {
  if (pieces.length === 0) return null;
  try {
    const { data } = await callable()({ pieces });
    if ('texts' in data && data.texts.length === pieces.length) return data.texts;
    return null;
  } catch {
    return null;
  }
}

export interface SecondPassResult {
  /** Positions (into the `live` array) Whisper turned from missed to passed. */
  rescued: number[];
  /** Their new grades, same order as `rescued`. */
  grades: WordOutcome[];
  /** Pieces sent, of `piecesTotal` in the recording. */
  pieces: number;
  piecesTotal: number;
  ms: number;
}

/**
 * The whole second pass for one recording: cut it into pieces, send them to
 * Whisper, grade Whisper's text against `expected`, and combine with Apple's
 * `live` grade (combineSecondPass). `expected`, `live`, `protectedPos` and
 * `heardAt` all use the same positions: the words this recording could have
 * covered, in the order they were recited. Null whenever the second pass
 * can't run, so the caller keeps Apple's grade.
 *
 * With `heardAt` (seconds since listening started when Apple first graded
 * each word), only the pieces holding a red word are sent (pickPieces), each
 * neighbouring run graded against its own stretch of words. Without it, the
 * whole recording is sent.
 */
export async function runSecondPass(
  uri: string,
  expected: readonly string[],
  live: readonly (WordOutcome | null | undefined)[],
  protectedPos: ReadonlySet<number>,
  heardAt?: readonly (number | null)[]
): Promise<SecondPassResult | null> {
  const started = Date.now();
  let pieces: SentPiece[];
  try {
    pieces = await speechRecordingPieces(uri);
  } catch {
    return null;
  }
  const red = live.map((o, i) => (o ?? 'missed') === 'missed' && !protectedPos.has(i));
  const groups = pickPieces(pieces, heardAt ?? live.map(() => null), red);
  const sent = groups.flatMap((g) => g.pieces);
  const texts = await transcribePieces(sent.map((k) => pieces[k].audio));
  if (!texts) return null;
  const textOf = new Map(sent.map((k, n) => [k, texts[n]]));

  const fixed = new Map<number, WordOutcome>();
  for (const g of groups) {
    const whisper = gradeTranscript(expected.slice(g.from, g.to).join(' '), g.pieces.map((k) => textOf.get(k)).join(' '));
    const shifted = new Set([...protectedPos].filter((p) => p >= g.from && p < g.to).map((p) => p - g.from));
    const { outcomes, rescued } = combineSecondPass(live.slice(g.from, g.to), whisper, shifted);
    for (const p of rescued) if (!fixed.has(p + g.from)) fixed.set(p + g.from, outcomes[p]);
  }
  const rescued = [...fixed.keys()].sort((a, b) => a - b);
  return { rescued, grades: rescued.map((p) => fixed.get(p)!), pieces: sent.length, piecesTotal: pieces.length, ms: Date.now() - started };
}
