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
import { speechRecordingPieces } from './speechRecording';

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
  pieces: number;
  ms: number;
}

/**
 * The whole second pass for one recording: cut it into pieces, send them to
 * Whisper, grade Whisper's text against `expected`, and combine with Apple's
 * `live` grade (combineSecondPass). `expected`, `live` and `protectedPos` all
 * use the same positions: the words this recording could have covered, in
 * the order they were recited. Null whenever the second pass can't run, so
 * the caller keeps Apple's grade.
 */
export async function runSecondPass(
  uri: string,
  expected: readonly string[],
  live: readonly (WordOutcome | null | undefined)[],
  protectedPos: ReadonlySet<number>
): Promise<SecondPassResult | null> {
  const started = Date.now();
  let pieces: string[];
  try {
    pieces = await speechRecordingPieces(uri);
  } catch {
    return null;
  }
  const texts = await transcribePieces(pieces);
  if (!texts) return null;
  const whisper = gradeTranscript(expected.join(' '), texts.join(' '));
  const { outcomes, rescued } = combineSecondPass(live, whisper, protectedPos);
  return { rescued, grades: rescued.map((p) => outcomes[p]), pieces: pieces.length, ms: Date.now() - started };
}
