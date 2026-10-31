// Cuts a spoken-Recall recording into pieces for the second pass
// (SPEECH_SECOND_PASS_PLAN.md, stage 3). Hosted Whisper skips ~30 s stretches
// of long audio, so nothing over MAX_PIECE_SECONDS is ever sent whole.
//
// Each piece runs as long as it can: the cut goes in the middle of the last
// pause (MIN_PAUSE_MS of quiet or more) before the limit, so a piece is as few
// requests as possible and never splits a word. With no pause in reach, the
// cut goes at the quietest moment of the last few seconds instead. A simple
// loudness measure is enough here: it only chooses cut points, it doesn't
// decide what was said.
//
// Pieces with no speech are dropped and long silence at either end is
// trimmed, since Whisper invents words ("Thank you.") for silent audio.
//
// Pure TypeScript, no react-native imports: speechPieces.check.ts runs it
// under Node.

export const MAX_PIECE_SECONDS = 24;
export const MIN_PAUSE_MS = 300;
/** Silence left at each end of a piece when trimming. */
const EDGE_PAD_MS = 200;
/** Loudness is measured over frames this long. */
const FRAME_MS = 20;
/** With no pause in reach, the forced cut looks back this far for the quietest frame. */
const HARD_CUT_SEARCH_SECONDS = 4;
/** A piece shorter than this is joined to the next instead of cut off on its own. */
const MIN_PIECE_SECONDS = 2;

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** 1 = integer PCM, 3 = float. */
  audioFormat: number;
  dataOffset: number;
  dataBytes: number;
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Reads a WAV's format and where its samples are. Null when it isn't PCM WAV this can read. */
export function parseWav(b: Uint8Array): WavFormat | null {
  if (b.length < 12 || ascii(b, 0) !== 'RIFF' || ascii(b, 8) !== 'WAVE') return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fmt: Omit<WavFormat, 'dataOffset' | 'dataBytes'> | null = null;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = ascii(b, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && body + 16 <= b.length) {
      let audioFormat = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID.
      if (audioFormat === 0xfffe && size >= 26 && body + 26 <= b.length) audioFormat = view.getUint16(body + 24, true);
      fmt = {
        audioFormat,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data' && fmt) {
      // A file still being written can say 0 or too much; trust what's there.
      const dataBytes = Math.min(size || b.length - body, b.length - body);
      const ok =
        fmt.channels >= 1 &&
        fmt.sampleRate > 0 &&
        ((fmt.audioFormat === 1 && fmt.bitsPerSample === 16) || (fmt.audioFormat === 3 && fmt.bitsPerSample === 32));
      return ok ? { ...fmt, dataOffset: body, dataBytes } : null;
    }
    at = body + size + (size & 1);
  }
  return null;
}

/** Loudness (RMS, in dB of full scale) of each FRAME_MS frame, first channel only. */
export function frameLoudness(b: Uint8Array, f: WavFormat): Float32Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const bytesPerSample = f.bitsPerSample / 8;
  const frameBytes = bytesPerSample * f.channels;
  const totalSamples = Math.floor(f.dataBytes / frameBytes);
  const perFrame = Math.max(1, Math.round((f.sampleRate * FRAME_MS) / 1000));
  const frames = Math.floor(totalSamples / perFrame);
  const out = new Float32Array(frames);
  for (let fr = 0; fr < frames; fr++) {
    let sum = 0;
    for (let s = fr * perFrame; s < (fr + 1) * perFrame; s++) {
      const at = f.dataOffset + s * frameBytes;
      const x = f.audioFormat === 3 ? view.getFloat32(at, true) : view.getInt16(at, true) / 32768;
      sum += x * x;
    }
    out[fr] = 10 * Math.log10(sum / perFrame + 1e-10);
  }
  return out;
}

const percentile = (values: Float32Array, p: number) => {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -100;
};

/** A stretch of the recording, in frames: [start, end). */
export interface Span {
  start: number;
  end: number;
}

/** Anything softer than this is quiet however quiet the rest is (normal speech into a phone is about -30 to -15). */
const ALWAYS_QUIET_DB = -50;

/**
 * Which frames count as quiet. The line sits 30% of the way from the room's
 * noise floor up to normal speech, so it adapts to a quiet bedroom or a noisy
 * car without settings. Never below 12 dB under speech, so a recording that's
 * nearly all speech still finds its breaths. And never below ALWAYS_QUIET_DB,
 * or a recording of only silence would call its loudest hiss speech.
 */
export function quietFrames(loud: Float32Array): Uint8Array {
  const floor = percentile(loud, 0.1);
  const speech = percentile(loud, 0.9);
  const line = Math.max(ALWAYS_QUIET_DB, Math.min(floor + 0.3 * (speech - floor), speech - 12));
  const quiet = new Uint8Array(loud.length);
  for (let i = 0; i < loud.length; i++) quiet[i] = loud[i] < line ? 1 : 0;
  return quiet;
}

/** Runs of quiet frames at least MIN_PAUSE_MS long. */
export function findPauses(quiet: Uint8Array): Span[] {
  const minFrames = Math.ceil(MIN_PAUSE_MS / FRAME_MS);
  const pauses: Span[] = [];
  let runStart = -1;
  for (let i = 0; i <= quiet.length; i++) {
    if (i < quiet.length && quiet[i]) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if (i - runStart >= minFrames) pauses.push({ start: runStart, end: i });
      runStart = -1;
    }
  }
  return pauses;
}

/** The pieces to send, in frames, before trimming. */
export function choosePieces(loud: Float32Array, quiet: Uint8Array): Span[] {
  const total = loud.length;
  const maxFrames = Math.floor((MAX_PIECE_SECONDS * 1000) / FRAME_MS);
  const minFrames = Math.floor((MIN_PIECE_SECONDS * 1000) / FRAME_MS);
  const searchFrames = Math.floor((HARD_CUT_SEARCH_SECONDS * 1000) / FRAME_MS);
  const pad = Math.ceil(EDGE_PAD_MS / FRAME_MS);
  const pauses = findPauses(quiet);
  const pieces: Span[] = [];
  let start = 0;
  for (;;) {
    // Each piece starts where the sound does, so a long silence doesn't use
    // up its 24 s and force a cut through the speech after it.
    let sound = start;
    while (sound < total && quiet[sound]) sound++;
    if (sound >= total) break;
    start = Math.max(start, sound - pad);
    if (total - start <= maxFrames) break;
    const limit = start + maxFrames;
    // The last pause whose middle is in reach, leaving a piece long enough to be worth a request.
    let cut = -1;
    for (const p of pauses) {
      const mid = Math.floor((p.start + p.end) / 2);
      if (mid > start + minFrames && mid <= limit) cut = mid;
    }
    if (cut < 0) {
      // No pause: the quietest frame in the last few seconds before the limit.
      cut = limit;
      for (let i = limit; i > Math.max(start + minFrames, limit - searchFrames); i--) if (loud[i] < loud[cut]) cut = i;
    }
    pieces.push({ start, end: cut });
    start = cut;
  }
  if (total > start && quiet.slice(start).some((q) => !q)) pieces.push({ start, end: total });
  return pieces;
}

/**
 * Trims silence at both ends of a piece down to EDGE_PAD_MS. Null when the
 * piece has no speech at all.
 */
export function trimPiece(piece: Span, quiet: Uint8Array): Span | null {
  let a = piece.start;
  let z = piece.end;
  while (a < z && quiet[a]) a++;
  while (z > a && quiet[z - 1]) z--;
  // A cough or click isn't worth a request: need a fifth of a second of sound.
  if (z - a < Math.ceil(200 / FRAME_MS)) return null;
  const pad = Math.ceil(EDGE_PAD_MS / FRAME_MS);
  return { start: Math.max(piece.start, a - pad), end: Math.min(piece.end, z + pad) };
}

/** A standalone WAV holding `span` (in frames) of the original. */
function pieceWav(b: Uint8Array, f: WavFormat, span: Span): Uint8Array {
  const frameBytes = (f.bitsPerSample / 8) * f.channels;
  const perFrame = Math.max(1, Math.round((f.sampleRate * FRAME_MS) / 1000));
  const from = f.dataOffset + span.start * perFrame * frameBytes;
  const to = Math.min(f.dataOffset + f.dataBytes, f.dataOffset + span.end * perFrame * frameBytes);
  const dataBytes = to - from;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i);
  };
  put(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, f.audioFormat, true);
  v.setUint16(22, f.channels, true);
  v.setUint32(24, f.sampleRate, true);
  v.setUint32(28, f.sampleRate * frameBytes, true);
  v.setUint16(32, frameBytes, true);
  v.setUint16(34, f.bitsPerSample, true);
  put(36, 'data');
  v.setUint32(40, dataBytes, true);
  out.set(b.subarray(from, to), 44);
  return out;
}

export interface SpeechPiece {
  wav: Uint8Array;
  /** Where the piece sits in the recording, in seconds. */
  startSeconds: number;
  endSeconds: number;
}

/** The recording as pieces ready to send, in order. Empty when it isn't a readable WAV or has no speech. */
export function splitRecording(b: Uint8Array): SpeechPiece[] {
  const f = parseWav(b);
  if (!f) return [];
  const loud = frameLoudness(b, f);
  if (loud.length === 0) return [];
  const quiet = quietFrames(loud);
  const seconds = (frame: number) => (frame * FRAME_MS) / 1000;
  return choosePieces(loud, quiet)
    .map((p) => trimPiece(p, quiet))
    .filter((p): p is Span => p !== null)
    .map((p) => ({ wav: pieceWav(b, f, p), startSeconds: seconds(p.start), endSeconds: seconds(p.end) }));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 for the callable (React Native has no Buffer). */
export function toBase64(b: Uint8Array): string {
  const out: string[] = [];
  let chunk = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    chunk +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < b.length ? B64[n & 63] : '=');
    if (chunk.length >= 8192) {
      out.push(chunk);
      chunk = '';
    }
  }
  out.push(chunk);
  return out.join('');
}

// ----------------------------------------------------------------------------
// Sending only the pieces that matter
// ----------------------------------------------------------------------------
// The second pass can only turn red words green, so a piece with no red word
// in it has nothing to fix. Which piece holds which word comes from Apple's
// live grade: Recall notes when each word was first graded. Apple trails the
// voice a little, so those times are shifted to line the first word up with
// the first sound in the recording, and every match allows PICK_MARGIN_SECONDS
// either way. A wrong guess fails safe: that word keeps Apple's grade.

/** Slack around each piece when matching words to it, in seconds. */
export const PICK_MARGIN_SECONDS = 2;

/** Pieces sent together, and the stretch of words (positions [from, to)) they're graded against. */
export interface PieceGroup {
  pieces: number[];
  from: number;
  to: number;
}

type PieceSpan = Pick<SpeechPiece, 'startSeconds' | 'endSeconds'>;

/**
 * Estimated time in the recording for every word position. `heardAt` is
 * seconds since listening started when Apple first graded each word (null
 * when it never did: typed, or never reached). Those in between are spread
 * evenly between their neighbours, those before the first fall at the first
 * sound, and those after the last are spread up to the recording's end.
 */
export function estimateWordTimes(pieces: PieceSpan[], heardAt: readonly (number | null)[]): number[] | null {
  const timed = heardAt.flatMap((t, i) => (t == null ? [] : [i]));
  if (timed.length === 0 || pieces.length === 0) return null;
  const first = pieces[0].startSeconds;
  const end = pieces[pieces.length - 1].endSeconds;
  const shift = heardAt[timed[0]]! - first;
  const est = heardAt.map((t) => (t == null ? NaN : t - shift));
  for (let i = 0; i < timed[0]; i++) est[i] = first;
  for (let k = 0; k + 1 < timed.length; k++) {
    const [a, b] = [timed[k], timed[k + 1]];
    for (let i = a + 1; i < b; i++) est[i] = est[a] + ((est[b] - est[a]) * (i - a)) / (b - a);
  }
  const last = timed[timed.length - 1];
  const tail = heardAt.length - 1 - last;
  for (let i = last + 1; i < heardAt.length; i++) est[i] = est[last] + ((Math.max(end, est[last]) - est[last]) * (i - last)) / tail;
  return est;
}

/**
 * Which pieces to send, as groups of neighbouring pieces with the word
 * positions each is graded against. `red[i]` marks a word the second pass
 * could change. With no timing, every piece goes as one group over every
 * word, which is the safe fallback.
 */
export function pickPieces(pieces: PieceSpan[], heardAt: readonly (number | null)[], red: readonly boolean[]): PieceGroup[] {
  const all = (): PieceGroup[] => (pieces.length ? [{ pieces: pieces.map((_, p) => p), from: 0, to: red.length }] : []);
  const est = estimateWordTimes(pieces, heardAt);
  if (!est) return all();

  const distance = (t: number, p: PieceSpan) => (t < p.startSeconds ? p.startSeconds - t : t > p.endSeconds ? t - p.endSeconds : 0);
  const chosen = new Set<number>();
  red.forEach((isRed, i) => {
    if (!isRed) return;
    let nearest = 0;
    pieces.forEach((p, k) => {
      if (distance(est[i], p) <= PICK_MARGIN_SECONDS) chosen.add(k);
      if (distance(est[i], p) < distance(est[i], pieces[nearest])) nearest = k;
    });
    chosen.add(nearest);
  });

  const groups: PieceGroup[] = [];
  for (const k of [...chosen].sort((a, b) => a - b)) {
    const g = groups[groups.length - 1];
    if (g && g.pieces[g.pieces.length - 1] === k - 1) g.pieces.push(k);
    else groups.push({ pieces: [k], from: 0, to: 0 });
  }
  for (const g of groups) {
    const start = pieces[g.pieces[0]].startSeconds - PICK_MARGIN_SECONDS;
    const stop = pieces[g.pieces[g.pieces.length - 1]].endSeconds + PICK_MARGIN_SECONDS;
    const inside = est.flatMap((t, i) => (t >= start && t <= stop ? [i] : []));
    g.from = inside.length ? inside[0] : 0;
    g.to = inside.length ? inside[inside.length - 1] + 1 : 0;
  }
  // Every piece picked: same as sending the whole recording, which grades best.
  return chosen.size === pieces.length ? all() : groups.filter((g) => g.to > g.from);
}
