import { File } from 'expo-file-system';
import { splitRecording, toBase64 } from './speechPieces';

// The audio file the speech engine saves during spoken Recall (the
// recognizer's onAudio, recitation.ts), kept for the second pass in
// SPEECH_SECOND_PASS_PLAN.md. It lives in the cache folder; the caller
// deletes the previous one when a new run starts.

export interface SpeechRecordingInfo {
  bytes: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  seconds: number;
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** Reads a WAV file's format from its header. Null when it isn't a readable WAV. */
export function readSpeechRecording(uri: string): SpeechRecordingInfo | null {
  try {
    const file = new File(uri);
    if (!file.exists) return null;
    const bytes = file.size ?? 0;
    const handle = file.open();
    let head: Uint8Array;
    try {
      head = handle.readBytes(Math.min(bytes, 4096));
    } finally {
      handle.close();
    }
    if (head.length < 12 || ascii(head, 0) !== 'RIFF' || ascii(head, 8) !== 'WAVE') return null;
    // Walk the chunks to 'fmt ' (iOS can put other chunks first).
    for (let at = 12; at + 8 <= head.length; at += 8 + u32(head, at + 4) + (u32(head, at + 4) & 1)) {
      if (ascii(head, at) !== 'fmt ' || at + 24 > head.length) continue;
      const channels = u16(head, at + 10);
      const sampleRate = u32(head, at + 12);
      const byteRate = u32(head, at + 16);
      const bitsPerSample = u16(head, at + 22);
      return { bytes, sampleRate, channels, bitsPerSample, seconds: byteRate ? bytes / byteRate : 0 };
    }
    return null;
  } catch {
    return null;
  }
}

/** One line for a tester toast, e.g. "Saved audio: WAV 16000 Hz, 16-bit, mono, 12.4 s, 397 KB". */
export function describeSpeechRecording(uri: string): string {
  const info = readSpeechRecording(uri);
  const name = uri.split('/').pop() ?? uri;
  if (!info) return `Saved audio: couldn't read ${name}`;
  const channels = info.channels === 1 ? 'mono' : `${info.channels} channels`;
  return `Saved audio: WAV ${info.sampleRate} Hz, ${info.bitsPerSample}-bit, ${channels}, ${info.seconds.toFixed(1)} s, ${Math.round(info.bytes / 1024)} KB`;
}

/** A piece as sent: base64 WAV, and where it sits in the recording. */
export interface SentPiece {
  audio: string;
  startSeconds: number;
  endSeconds: number;
}

/**
 * The recording cut at pauses into pieces of 24 s or less, as base64 WAVs
 * ready for transcribePieces (speechSecondPass.ts). Empty when the file is
 * missing, unreadable, or has no speech.
 */
export async function speechRecordingPieces(uri: string): Promise<SentPiece[]> {
  try {
    const file = new File(uri);
    if (!file.exists) return [];
    return splitRecording(await file.bytes()).map((p) => ({ audio: toBase64(p.wav), startSeconds: p.startSeconds, endSeconds: p.endSeconds }));
  } catch {
    return [];
  }
}

export function deleteSpeechRecording(uri: string | null) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // already gone
  }
}
