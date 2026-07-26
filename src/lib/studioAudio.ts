import type { Recording } from '../types';

/**
 * Studio mode plays back a processed render of a recitation (high-pass,
 * denoise, de-ess, compression, EBU R128 loudness normalization) produced
 * server-side by the processStudioAudio Cloud Function.
 *
 * The raw upload is never replaced or deleted, and every resolution here
 * falls back to it. That matters for two reasons:
 *   1. Processing is asynchronous — a recording is playable the instant it
 *      finishes uploading, seconds before the studio render exists.
 *   2. The render can legitimately be rejected server-side (see the duration
 *      guard in the function), and a recording must never become unplayable
 *      because post-processing didn't work out.
 */

/** True when a processed render exists and is ready to play. */
export function hasStudioAudio(recording: Pick<Recording, 'studioAudioUrl' | 'studioStatus'> | null | undefined): boolean {
  return !!recording?.studioAudioUrl && recording.studioStatus === 'ready';
}

/**
 * The URL playback should actually use. Returns undefined only when there is
 * no audio at all — callers already treat that as "not a real recording"
 * (e.g. the seeded demo entries, which have no Storage-backed audio).
 */
export function resolvePlaybackUrl(
  recording: Pick<Recording, 'audioUrl' | 'studioAudioUrl' | 'studioStatus'> | null | undefined,
  studioEnabled: boolean
): string | undefined {
  if (!recording) return undefined;
  if (studioEnabled && hasStudioAudio(recording)) return recording.studioAudioUrl;
  return recording.audioUrl;
}

/**
 * Whether this recording has ANY playable audio, regardless of which version
 * wins above. Used for the "is this a real recording?" gates that previously
 * checked `!!audioUrl` directly — a recording whose raw file is present is
 * playable even while its studio render is still pending.
 */
export function hasPlayableAudio(
  recording: Pick<Recording, 'audioUrl' | 'studioAudioUrl' | 'studioStatus'> | null | undefined
): boolean {
  return !!recording?.audioUrl || hasStudioAudio(recording);
}

/** Copy for the studio badge/toggle, so the states read consistently. */
export function studioStatusLabel(recording: Pick<Recording, 'studioStatus'> | null | undefined): string | null {
  switch (recording?.studioStatus) {
    case 'pending':
      return 'Polishing audio…';
    case 'ready':
      return 'Studio';
    default:
      // 'failed' and legacy/absent both mean "just the original take" — not
      // worth surfacing an error for something the user didn't ask for and
      // which costs them nothing.
      return null;
  }
}
