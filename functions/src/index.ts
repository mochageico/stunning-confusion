import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { logger } from 'firebase-functions';

const app = initializeApp();

// The app does NOT use the (default) Firestore database — see
// firebase-applet-config.json's `firestoreDatabaseId`. getFirestore() without
// this argument silently reads/writes (default), which exists but is empty,
// so every update here would "succeed" while the app never sees a thing.
const FIRESTORE_DATABASE_ID = 'ai-studio-da1c3045-26bb-470c-883c-0b120417bcda';
const db = getFirestore(app, FIRESTORE_DATABASE_ID);

// Marks a processed output so a redeploy/backfill can tell "already done"
// from "never attempted" without consulting Firestore.
const PROCESSED_METADATA_KEY = 'studioProcessed';
const STUDIO_SUFFIX = '_studio';

// Reject anything larger than the client-side cap in storage.rules — a file
// bigger than that didn't come through the normal upload path.
const MAX_INPUT_BYTES = 50 * 1024 * 1024;

// Any drift beyond this means a filter changed the timeline, which would
// desync every verse tap mark stored on the recording. See DURATION GUARD.
//
// Calibrated against measurement, not guessed. Running this exact chain on a
// 30–37s synthetic source:
//   • stream copy .................... 0ms drift
//   • AAC re-encode, no filters ...... 5ms
//   • full chain -> WAV .............. 4ms   <- the filters' own contribution
//   • full chain -> AAC ............ 101ms
// So ~97ms of the total is AAC framing/resampler padding on the TAIL, not
// content displacement. Probing marker bursts at 5s/15s/25s through the same
// chain showed a constant +18ms offset with no accumulation over time —
// inaudible at verse-boundary granularity (syllables run 100–200ms).
//
// 0.1s therefore rejected every render. 0.5s clears the measured padding with
// 5x headroom while still catching what this guard is actually for: a filter
// that removes audio, which would cost whole seconds, not milliseconds.
const MAX_DURATION_DRIFT_SEC = 0.5;

// EBU R128 target. -16 LUFS is the podcast/mobile convention: loud enough to
// hear in a car or on a phone speaker without clipping on good headphones.
const LOUDNORM_TARGET = 'I=-16:TP=-1.5:LRA=11';

// Everything ahead of loudnorm, in order:
//   highpass    — drops desk rumble/handling noise below speech fundamentals
//   acompressor — evens out lean-in/lean-back level swings WITHIN a take
//
// NO denoiser here, deliberately. The first version ran afftdn (FFT denoise)
// and it was the single biggest quality regression: FFT denoisers attenuate
// low-level content across the whole spectrum, and low-level high-frequency
// content is exactly what breath, air and presence are made of. Measured, it
// cost ~2.7dB in the 10–16kHz band — audible as "lost the treble/warmth", and
// bad enough that the raw take sounded better than the processed one.
// Background noise was always the lowest-priority goal, so it is simply not
// worth that trade. If it comes back it should be arnndn (speech-specific,
// far less destructive), not afftdn.
const PRE_FILTERS = ['highpass=f=70', 'acompressor=threshold=-20dB:ratio=2.5:attack=20:release=250:makeup=1'].join(
  ','
);

// De-esser. Runs AFTER loudnorm (see buildFilterChain) for a specific reason:
// `threshold` here is an ABSOLUTE level, not relative, so ahead of loudnorm a
// quiet recording would never trigger it and a hot one would over-trigger.
// Downstream of loudnorm every take arrives at the same -16 LUFS, which makes
// the threshold behave consistently across recordings.
//
// ffmpeg's dedicated `deesser` filter was tried first and is far too weak —
// at i=0.35 it moved the 6–9kHz band by 0.6dB, i.e. nothing. adynamicequalizer
// is a real dynamic EQ: it cuts a narrow band only while that band is loud.
//
// Measured response of these exact settings (constant-tone sweep, dB change):
//   250Hz  0.0 | 1k  0.0 | 2k -0.2 | 4k -1.9 | 5.5k -6.5
//   6.5k -11.7 | 8k -5.2 | 10k -1.9 | 13k -0.6
// A deep, narrow notch on sibilance with warmth, intelligibility and air all
// left alone — which is the whole point, and what the old chain failed at.
//
// TUNING: `threshold` is the strength knob. 0.20 gives a ~-7.8dB notch,
// 0.30 ~-11.7dB. Raise it if esses are still sharp; lower it if speech starts
// sounding lisped or dull. Everything else can stay put.
const DEESSER =
  'adynamicequalizer=dfrequency=6500:dqfactor=2.5:tfrequency=6500:tqfactor=2.5' +
  ':threshold=0.30:ratio=4:attack=1:release=40:range=12:mode=cut:direction=downward';

// Holds the true-peak ceiling after de-essing nudges levels around. loudnorm
// already targeted -1.5dBTP; this just guarantees nothing sneaks above it.
const LIMITER = 'alimiter=limit=0.841:level=disabled';

// KNOWN OFFSET: because de-essing runs after loudnorm, removing sibilant
// energy drops integrated loudness slightly below target — measured at
// -17.5 LUFS against a -16 target on a synthetic signal that is 30% sibilance
// bursts, i.e. far more sibilant than real speech, so the real-world gap
// should be a few tenths rather than 1.5. Deliberately NOT compensated with a
// fixed makeup gain: that would be tuned against synthetic material known to
// be unrepresentative. Consistency between recordings (all get identical
// processing) matters more here than hitting -16 exactly. Revisit against
// real recordings if playback feels quiet.

/** Full chain for the apply pass: pre-filters, loudnorm, then de-ess + limit. */
function buildFilterChain(loudnormArgs: string): string {
  return `${PRE_FILTERS},${loudnormArgs},${DEESSER},${LIMITER}`;
}

const ffmpegPath = ffmpegStatic as unknown as string | null;
const ffprobePath = ffprobeStatic.path;

/**
 * npm preserves the exec bit on these binaries in most environments, but the
 * Cloud Functions build/deploy round-trip has historically dropped it. chmod
 * is cheap and idempotent; a lost exec bit otherwise shows up as a baffling
 * EACCES at spawn time.
 */
function ensureExecutable(path: string | null): string {
  if (!path || !existsSync(path)) {
    throw new Error(`Required binary not found at ${path ?? '<null>'}`);
  }
  try {
    chmodSync(path, 0o755);
  } catch {
    // Already executable, or a read-only layer — spawn will tell us for real.
  }
  return path;
}

interface RunResult {
  stdout: string;
  stderr: string;
}

function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      // ffmpeg writes everything informational — including the loudnorm JSON
      // we need to parse — to stderr, not stdout.
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}\n${stderr.slice(-4000)}`));
    });
  });
}

async function probeDurationSec(path: string): Promise<number> {
  const { stdout } = await run(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  const parsed = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(parsed)) throw new Error(`Could not read duration from ${path}`);
  return parsed;
}

interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/**
 * Pass 1 of two-pass loudnorm: measure the material AFTER the rest of the
 * chain has run (loudnorm has to see what actually reaches it, so the pre
 * filters are applied here too and the audio is thrown away).
 *
 * Single-pass loudnorm works, but it operates in a dynamic mode that rides
 * the gain continuously — on sustained speech that pumps audibly. Measuring
 * first lets pass 2 apply one linear gain, which is what actually sounds
 * "produced" rather than just "louder".
 */
async function measureLoudness(inputPath: string): Promise<LoudnormMeasurement | null> {
  const { stderr } = await run(ffmpegPath!, [
    '-hide_banner',
    '-i',
    inputPath,
    '-af',
    `${PRE_FILTERS},loudnorm=${LOUDNORM_TARGET}:print_format=json`,
    '-f',
    'null',
    '-',
  ]);

  // The JSON block is the last {...} ffmpeg prints to stderr.
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const parsed = JSON.parse(stderr.slice(start, end + 1)) as LoudnormMeasurement;
    // A silent or near-silent take measures as -inf, which pass 2 cannot use.
    const finite = [parsed.input_i, parsed.input_tp, parsed.input_lra, parsed.input_thresh].every((v) =>
      Number.isFinite(Number.parseFloat(v))
    );
    return finite ? parsed : null;
  } catch {
    return null;
  }
}

async function renderStudioAudio(inputPath: string, outputPath: string): Promise<void> {
  const measured = await measureLoudness(inputPath);

  // Fall back to single-pass dynamic normalization when measurement is
  // unusable (silent take, or an exotic imported container ffmpeg measured
  // as -inf). Worse-sounding, but still better than shipping the raw file.
  const loudnormArgs = measured
    ? `loudnorm=${LOUDNORM_TARGET}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
      `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
      `:offset=${measured.target_offset}:linear=true:print_format=summary`
    : `loudnorm=${LOUDNORM_TARGET}`;

  if (!measured) {
    logger.warn('Loudness measurement unusable — falling back to single-pass loudnorm', { inputPath });
  }

  await run(ffmpegPath!, [
    '-hide_banner',
    '-y',
    '-i',
    inputPath,
    '-af',
    buildFilterChain(loudnormArgs),
    '-c:a',
    'aac',
    // 128k rather than 96k: at 96k mono, AAC's internal lowpass starts eating
    // the top octave, which compounded the "lost the treble" problem. The size
    // difference on a few minutes of speech is trivial.
    '-b:a',
    '128k',
    // Voice — mono halves the file with no perceptible loss, and keeps
    // playback cost down for users on cellular.
    '-ac',
    '1',
    // loudnorm resamples internally to 192kHz; pinning the output rate stops
    // ffmpeg from carrying that through into the encoded file.
    '-ar',
    '44100',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

export const processStudioAudio = onObjectFinalized(
  {
    // MUST match the Storage bucket's region. Gen2 Storage triggers are
    // delivered via Eventarc, which refuses to wire a bucket to a function in
    // a different region ("A function in region X cannot listen to a bucket in
    // region Y"). This project's bucket is us-east1, NOT the us-central1
    // default most Firebase samples assume.
    region: 'us-east1',
    memory: '1GiB',
    timeoutSeconds: 300,
    // One concurrent render per instance — ffmpeg is CPU-bound and two of
    // them sharing 1GiB is how you get OOM kills instead of throughput.
    concurrency: 1,
  },
  async (event) => {
    const objectPath = event.data.name;
    if (!objectPath || !objectPath.startsWith('recordings/')) return;

    // ── Re-trigger guard ──────────────────────────────────────────────────
    // This function writes its output back into the same recordings/ prefix,
    // which fires this same trigger again. Without this check that is an
    // unbounded loop that bills real money.
    if (objectPath.includes(STUDIO_SUFFIX)) return;
    if (event.data.metadata?.[PROCESSED_METADATA_KEY]) return;

    if (event.data.contentType && !event.data.contentType.startsWith('audio/')) {
      logger.info('Skipping non-audio object', { objectPath, contentType: event.data.contentType });
      return;
    }

    const sizeBytes = Number(event.data.size ?? 0);
    if (sizeBytes > MAX_INPUT_BYTES) {
      logger.warn('Skipping oversized upload', { objectPath, sizeBytes });
      return;
    }

    // recordings/{uid}/{recordingId}.{ext}
    const segments = objectPath.split('/');
    if (segments.length !== 3) {
      logger.warn('Unexpected recordings path shape — skipping', { objectPath });
      return;
    }
    const [, uid, fileName] = segments;
    const recordingId = fileName.replace(/\.[^.]+$/, '');
    const docRef = db.doc(`users/${uid}/recordings/${recordingId}`);

    const bucket = getStorage(app).bucket(event.data.bucket);
    const workDir = mkdtempSync(join(tmpdir(), 'studio-'));
    const inputPath = join(workDir, `in-${fileName}`);
    const outputPath = join(workDir, `out-${recordingId}${STUDIO_SUFFIX}.m4a`);

    try {
      ensureExecutable(ffmpegPath);
      ensureExecutable(ffprobePath);

      await bucket.file(objectPath).download({ destination: inputPath });

      const sourceDuration = await probeDurationSec(inputPath);
      await renderStudioAudio(inputPath, outputPath);
      const renderedDuration = await probeDurationSec(outputPath);

      // ── DURATION GUARD ────────────────────────────────────────────────
      // verseTimestamps on the recording doc are absolute offsets in seconds
      // into the audio (see handleMarkVerseTap in useAppState.ts). Every
      // filter in this chain is length-preserving by design, but if that ever
      // stops being true the verse marks would all silently point at the
      // wrong words. Bail instead — the app falls back to the raw file, which
      // still matches the stored timestamps exactly.
      const drift = Math.abs(renderedDuration - sourceDuration);
      if (drift > MAX_DURATION_DRIFT_SEC) {
        logger.error('Studio render changed duration — discarding to protect verse timestamps', {
          objectPath,
          sourceDuration,
          renderedDuration,
          drift,
        });
        await docRef.update({ studioStatus: 'failed' }).catch(() => {});
        return;
      }

      const studioPath = `recordings/${uid}/${recordingId}${STUDIO_SUFFIX}.m4a`;
      // Firebase download URLs authenticate via this token rather than via
      // storage.rules, so the existing {fileName} wildcard rule needs no
      // change and shared playback keeps working for other users.
      const downloadToken = randomUUID();

      // ── ORPHAN GUARD (pre-upload) ─────────────────────────────────────
      // Rendering takes real time, and the user can delete the recording
      // while it runs. Client-side deletion removes audioPath and
      // studioAudioPath from Storage — but it cannot remove a studio blob
      // that does not exist yet. Uploading against a doc that is already
      // gone strands the blob permanently: nothing references it, the app
      // can never surface it, and no lifecycle rule can distinguish it from
      // a live render. Checking here closes almost the whole window, since
      // the render is where all the time goes.
      if (!(await docRef.get()).exists) {
        logger.info('Recording deleted during render — discarding studio output', { objectPath });
        return;
      }

      await bucket.upload(outputPath, {
        destination: studioPath,
        metadata: {
          contentType: 'audio/mp4',
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: {
            [PROCESSED_METADATA_KEY]: 'true',
            sourcePath: objectPath,
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
      });

      const studioAudioUrl =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
        `${encodeURIComponent(studioPath)}?alt=media&token=${downloadToken}`;

      const studioFields = {
        studioAudioUrl,
        studioAudioPath: studioPath,
        studioStatus: 'ready' as const,
      };

      // ── ORPHAN GUARD (post-upload) ────────────────────────────────────
      // The authoritative half of the guard above: the doc can still go away
      // between that check and this write. Any failure here — a lost race or
      // a transient Firestore error — leaves a blob nothing will ever point
      // at, and this trigger does not retry (onObjectFinalized defaults to
      // retry: false), so no later run will recover it. Take the blob back
      // out rather than leak it.
      try {
        await docRef.update(studioFields);
      } catch (updateErr) {
        logger.error('Could not attach studio render to its recording — removing orphaned blob', {
          objectPath,
          studioPath,
          updateErr,
        });
        await bucket
          .file(studioPath)
          .delete({ ignoreNotFound: true })
          .catch((deleteErr) => logger.error('Failed to remove orphaned studio blob', { studioPath, deleteErr }));
        // Best-effort — fails too if the doc is what went missing, which is
        // fine: a deleted recording has no status left to report.
        await docRef.update({ studioStatus: 'failed' }).catch(() => {});
        return;
      }

      // Mirror onto the shared copy so circle/public listeners get the
      // processed version too. Absent for private recordings — not an error.
      //
      // Deliberately non-fatal: the render is uploaded and the owner's doc
      // already points at it, so falling into the outer catch here would
      // stamp studioStatus: 'failed' over a perfectly good 'ready' and send
      // the owner back to the raw take over a mirroring problem.
      try {
        const sharedRef = db.doc(`sharedRecordings/${recordingId}`);
        if ((await sharedRef.get()).exists) {
          await sharedRef.update(studioFields);
        }
      } catch (mirrorErr) {
        logger.error('Could not mirror studio fields onto shared recording', { objectPath, mirrorErr });
      }

      logger.info('Studio audio ready', {
        objectPath,
        studioPath,
        sourceDuration,
        renderedDuration,
        sizeBytes,
        outputBytes: statSync(outputPath).size,
      });
    } catch (err) {
      logger.error('Studio processing failed', { objectPath, err });
      // Leaves the raw recording fully playable; the client treats 'failed'
      // as "just use audioUrl".
      await docRef.update({ studioStatus: 'failed' }).catch((updateErr) => {
        logger.error('Could not mark studioStatus=failed', { objectPath, updateErr });
      });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
);
