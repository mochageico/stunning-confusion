// Audio helpers for transcribe.ts, kept free of Firebase imports so the
// bake-off scripts can run the same code.
//
// The collapse this guards against, seen in the bake-off: a piece that opens
// with a spoken number ("Eleven.") can make Whisper write only numbers for
// the whole piece ("11. 12." for 20 s and 80 words of speech). A higher
// temperature or a neutral prompt didn't fix it; sending the piece as two
// halves recovered every word. So a piece that comes back with far too few
// words for its length is retried in halves.

/** Pieces from the app are 16-bit PCM WAV with a plain 44-byte header (src/lib/speechPieces.ts). */
const HEADER = 44;

/** Retry only pieces at least this long: a short one may really hold one word. */
export const RETRY_MIN_SECONDS = 6;
/** Reciting runs about 2-3 words a second; under this, Whisper has collapsed. */
export const MIN_WORDS_PER_SECOND = 0.5;

interface Pcm16 {
  sampleRate: number;
  channels: number;
}

function pcm16(wav: Buffer): Pcm16 | null {
  if (wav.length < HEADER || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 36, 40) !== 'data') return null;
  if (wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(34) !== 16) return null;
  return { sampleRate: wav.readUInt32LE(24), channels: wav.readUInt16LE(22) };
}

export function pieceSeconds(wav: Buffer): number {
  const f = pcm16(wav);
  return f && f.sampleRate ? (wav.length - HEADER) / (f.sampleRate * f.channels * 2) : 0;
}

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** True when Whisper's text is far too short for this much audio. */
export function looksCollapsed(wav: Buffer, text: string): boolean {
  const seconds = pieceSeconds(wav);
  return seconds >= RETRY_MIN_SECONDS && wordCount(text) < seconds * MIN_WORDS_PER_SECOND;
}

function wavWith(f: Pcm16, data: Buffer): Buffer {
  const out = Buffer.alloc(HEADER + data.length);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + data.length, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(f.channels, 22);
  out.writeUInt32LE(f.sampleRate, 24);
  out.writeUInt32LE(f.sampleRate * f.channels * 2, 28);
  out.writeUInt16LE(f.channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(data.length, 40);
  data.copy(out, HEADER);
  return out;
}

/**
 * The piece as two WAVs, cut at the quietest 20 ms in its middle third so
 * the cut falls between words. Null when it isn't a WAV this can cut.
 */
export function halves(wav: Buffer): [Buffer, Buffer] | null {
  const f = pcm16(wav);
  if (!f) return null;
  const frameBytes = f.channels * 2;
  const samples = Math.floor((wav.length - HEADER) / frameBytes);
  const frame = Math.max(1, Math.round(f.sampleRate * 0.02));
  let cut = -1;
  let quietest = Infinity;
  for (let start = Math.floor(samples / 3); start + frame <= Math.floor((2 * samples) / 3); start += frame) {
    let energy = 0;
    for (let s = start; s < start + frame; s++) {
      const x = wav.readInt16LE(HEADER + s * frameBytes);
      energy += x * x;
    }
    if (energy < quietest) {
      quietest = energy;
      cut = start + Math.floor(frame / 2);
    }
  }
  if (cut <= 0) return null;
  const data = wav.subarray(HEADER, HEADER + samples * frameBytes);
  return [wavWith(f, data.subarray(0, cut * frameBytes)), wavWith(f, data.subarray(cut * frameBytes))];
}
