// Assertions for speechPieces, run by `npm run check:speechpieces`.
//
// Built-in signals: tone bursts stand in for speech, so every cut point is
// known exactly. Pass a folder of real WAVs to also check them:
//   npm run -s check:speechpieces -- <folder>
// Each file is then reported (pieces, lengths) and held to the same rules:
// no piece over the limit, and no loud stretch left out of every piece.

import {
  choosePieces,
  frameLoudness,
  MAX_PIECE_SECONDS,
  parseWav,
  quietFrames,
  splitRecording,
  toBase64,
  type SpeechPiece,
} from './speechPieces';

declare const require: (m: string) => any;
declare const process: { argv: string[]; exitCode?: number };

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const RATE = 16000;

/** A stretch of the made-up recording: sound (a 220 Hz tone) or quiet, in seconds. */
type Part = { sound: number } | { quiet: number };

/** Low hiss under everything, like a real room; 0 for digital silence. */
function makeSamples(parts: Part[], noise = 0.003): Float32Array {
  const total = parts.reduce((n, p) => n + Math.round(RATE * ('sound' in p ? p.sound : p.quiet)), 0);
  const out = new Float32Array(total);
  let at = 0;
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  for (const p of parts) {
    const n = Math.round(RATE * ('sound' in p ? p.sound : p.quiet));
    for (let i = 0; i < n; i++, at++) {
      const tone = 'sound' in p ? 0.3 * Math.sin((2 * Math.PI * 220 * at) / RATE) : 0;
      out[at] = tone + noise * rand();
    }
  }
  return out;
}

function wav(samples: Float32Array, float = false): Uint8Array {
  const bytesPer = float ? 4 : 2;
  const data = samples.length * bytesPer;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  const put = (at: number, s: string) => s.split('').forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
  put(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * bytesPer, true);
  v.setUint16(32, bytesPer, true);
  v.setUint16(34, bytesPer * 8, true);
  put(36, 'data');
  v.setUint32(40, data, true);
  samples.forEach((x, i) => (float ? v.setFloat32(44 + i * 4, x, true) : v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x * 32767))), true)));
  return b;
}

/** Where the sound parts are, in seconds. */
function soundSpans(parts: Part[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let t = 0;
  for (const p of parts) {
    if ('sound' in p) spans.push({ start: t, end: t + p.sound });
    t += 'sound' in p ? p.sound : p.quiet;
  }
  return spans;
}

const lengths = (pieces: SpeechPiece[]) => pieces.map((p) => +(p.endSeconds - p.startSeconds).toFixed(2));
const allWithinLimit = (pieces: SpeechPiece[]) => pieces.every((p) => p.endSeconds - p.startSeconds <= MAX_PIECE_SECONDS + 0.001);
/** Every sound span lies inside the pieces (allowing a cut through it, which only forced cuts make). */
const covers = (pieces: SpeechPiece[], spans: { start: number; end: number }[]) =>
  spans.every((s) => {
    let t = s.start;
    for (const p of pieces) if (p.startSeconds <= t + 0.03 && p.endSeconds > t) t = p.endSeconds;
    return t >= s.end - 0.03;
  });
/** True when no cut falls inside a sound span. */
const cutsInQuiet = (pieces: SpeechPiece[], spans: { start: number; end: number }[]) =>
  pieces.slice(1).every((p) => !spans.some((s) => p.startSeconds > s.start + 0.03 && p.startSeconds < s.end - 0.03));

console.log('\n[1. Reading the WAV header]');
{
  const f = parseWav(wav(makeSamples([{ sound: 1 }])));
  check('16 kHz 16-bit mono is read', !!f && f.sampleRate === 16000 && f.bitsPerSample === 16 && f.channels === 1 && f.dataOffset === 44, f);
  const ff = parseWav(wav(makeSamples([{ sound: 1 }]), true));
  check('32-bit float is read', !!ff && ff.audioFormat === 3 && ff.bitsPerSample === 32, ff);
  check('not a WAV gives null', parseWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) === null);
  // iOS writes an extra chunk before 'data'; the reader must step over it.
  const plain = wav(makeSamples([{ sound: 1 }]));
  const withChunk = new Uint8Array(plain.length + 12);
  withChunk.set(plain.subarray(0, 36));
  withChunk.set([0x46, 0x4c, 0x4c, 0x52, 4, 0, 0, 0, 0, 0, 0, 0], 36); // 'FLLR', 4 bytes
  withChunk.set(plain.subarray(36), 48);
  const fc = parseWav(withChunk);
  check('an extra chunk before the samples is skipped', !!fc && fc.dataOffset === 56, fc);
}

console.log('\n[2. Short recordings go whole]');
{
  const parts: Part[] = [{ quiet: 0.5 }, { sound: 4 }, { quiet: 0.6 }, { sound: 5 }, { quiet: 0.5 }];
  const pieces = splitRecording(wav(makeSamples(parts)));
  check('a 10 s recording is one piece', pieces.length === 1, lengths(pieces));
  check('it covers all the sound', covers(pieces, soundSpans(parts)));
}

console.log('\n[3. Long recordings cut at pauses]');
{
  // 3 s phrases with 0.5 s pauses, about 70 s in all.
  const parts: Part[] = [];
  for (let i = 0; i < 20; i++) parts.push({ sound: 3 }, { quiet: 0.5 });
  const pieces = splitRecording(wav(makeSamples(parts)));
  const spans = soundSpans(parts);
  check('no piece is over the limit', allWithinLimit(pieces), lengths(pieces));
  // A pause every 3.5 s: each piece should run to the last pause before 24 s,
  // so every piece but the last is within one phrase of the limit (4 pieces, not 5+).
  check('each piece runs to the last pause in reach', pieces.slice(0, -1).every((p) => p.endSeconds - p.startSeconds > MAX_PIECE_SECONDS - 3.5), lengths(pieces));
  check('as few pieces as fit (4 for 70 s)', pieces.length === 4, lengths(pieces));
  check('every cut is in a pause', cutsInQuiet(pieces, spans), pieces.map((p) => p.startSeconds));
  check('every phrase is in a piece', covers(pieces, spans));
  check('pieces come out in order', pieces.every((p, i) => i === 0 || p.startSeconds >= pieces[i - 1].endSeconds - 0.001));
}

console.log('\n[4. Short gaps are not pauses]');
{
  // 0.15 s gaps (between words) until 30 s, then one real pause.
  const parts: Part[] = [];
  for (let i = 0; i < 10; i++) parts.push({ sound: 2.85 }, { quiet: 0.15 });
  parts.push({ quiet: 0.5 }, { sound: 5 });
  const pieces = splitRecording(wav(makeSamples(parts)));
  const spans = soundSpans(parts);
  check('no piece is over the limit', allWithinLimit(pieces), lengths(pieces));
  // With no 300 ms pause before 24 s, a word gap is the quietest spot: that's where it cuts.
  const firstCut = pieces[1]?.startSeconds ?? -1;
  check('the forced cut lands in a word gap, not mid-word', cutsInQuiet(pieces, spans), firstCut);
  check('everything is covered', covers(pieces, spans));
}

console.log('\n[5. No pause at all: forced cut]');
{
  const parts: Part[] = [{ sound: 60 }];
  const pieces = splitRecording(wav(makeSamples(parts)));
  check('60 s of nonstop sound becomes 3 pieces', pieces.length === 3, lengths(pieces));
  check('no piece is over the limit', allWithinLimit(pieces), lengths(pieces));
  check('everything is covered', covers(pieces, soundSpans(parts)));
}

console.log('\n[6. Silence]');
{
  check('all silence gives no pieces', splitRecording(wav(makeSamples([{ quiet: 10 }]))).length === 0);
  check('digital silence gives no pieces', splitRecording(wav(makeSamples([{ quiet: 10 }], 0))).length === 0);
  const parts: Part[] = [{ quiet: 5 }, { sound: 3 }, { quiet: 6 }];
  const [p] = splitRecording(wav(makeSamples(parts)));
  check('long silence at the ends is trimmed to about 0.2 s', !!p && Math.abs(p.startSeconds - 4.8) < 0.05 && Math.abs(p.endSeconds - 8.2) < 0.05, p && [p.startSeconds, p.endSeconds]);
  // A long silence in the middle of a long recording yields an all-quiet stretch: it must not become a piece.
  const gap: Part[] = [{ sound: 20 }, { quiet: 30 }, { sound: 10 }];
  const gp = splitRecording(wav(makeSamples(gap)));
  check('a long silent stretch in the middle is not sent', gp.length === 2, lengths(gp));
  check('the two spoken parts are both covered', covers(gp, soundSpans(gap)));
}

console.log('\n[7. Formats and encoding]');
{
  const parts: Part[] = [];
  for (let i = 0; i < 12; i++) parts.push({ sound: 3 }, { quiet: 0.5 });
  const a = splitRecording(wav(makeSamples(parts)));
  const b = splitRecording(wav(makeSamples(parts), true));
  check('float WAV cuts at the same places', a.length === b.length && a.every((p, i) => Math.abs(p.startSeconds - b[i].startSeconds) < 0.001), [lengths(a), lengths(b)]);
  const piece = a[0];
  const f = parseWav(piece.wav);
  check('each piece is a valid WAV of the right length', !!f && Math.abs(f.dataBytes / (RATE * 2) - (piece.endSeconds - piece.startSeconds)) < 0.001, f);
  const Buffer = require('buffer').Buffer;
  const sample = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 7, 8, 9]);
  const ok = [1, 2, 3, 10].every((n) => toBase64(sample.subarray(0, n)) === Buffer.from(sample.subarray(0, n)).toString('base64'));
  check('base64 matches Node for every padding case', ok);
  check('base64 of a whole piece matches Node', toBase64(piece.wav) === Buffer.from(piece.wav).toString('base64'));
  const loud = frameLoudness(piece.wav, f!);
  check('pieces keep a loud middle (the sound made it in)', Math.max(...Array.from(loud)) > -20);
  check('choosePieces on nothing gives nothing', choosePieces(new Float32Array(0), quietFrames(new Float32Array(0))).length === 0);
}

// ---------------------------------------------------------------------------
// Real recordings, when a folder is given.
const folder = process.argv[2];
if (folder) {
  const fs = require('fs');
  const path = require('path');
  const files: string[] = fs.readdirSync(folder).filter((n: string) => n.toLowerCase().endsWith('.wav')).sort();
  console.log(`\n[8. Real recordings in ${folder}: ${files.length}]`);
  for (const name of files) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(folder, name)));
    const f = parseWav(bytes);
    if (!f) {
      check(`${name}: readable`, false);
      continue;
    }
    const seconds = f.dataBytes / (f.sampleRate * f.channels * (f.bitsPerSample / 8));
    const pieces = splitRecording(bytes);
    const loud = frameLoudness(bytes, f);
    const quiet = quietFrames(loud);
    // Loud frames (not quiet) that no piece includes: speech that would never reach Whisper.
    let missed = 0;
    for (let i = 0; i < quiet.length; i++) {
      const t = (i * 20) / 1000;
      if (!quiet[i] && !pieces.some((p) => t >= p.startSeconds - 0.001 && t < p.endSeconds)) missed++;
    }
    console.log(`       ${name}: ${seconds.toFixed(1)} s -> ${pieces.length} pieces [${lengths(pieces).join(', ')}]`);
    check(`${name}: no piece over ${MAX_PIECE_SECONDS} s`, allWithinLimit(pieces));
    check(`${name}: no speech left out`, missed === 0, `${missed} frames`);
  }
}

console.log(failures === 0 ? '\nall speechPieces checks passed.' : `\n${failures} speechPieces check(s) FAILED.`);
if (failures) process.exitCode = 1;
