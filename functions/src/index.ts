import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { logger } from 'firebase-functions';

// The api.bible proxy lives in its own module -- it shares nothing with the
// audio pipeline in this file beyond the Firebase app, and inlining it here
// would bury it in 700 lines of ffmpeg argument construction.
export { fetchApiBibleChapter, purgeApiBibleCache } from './apiBible';

// Speech second pass: Groq Whisper re-checks spoken Recall after Stop
// (SPEECH_SECOND_PASS_PLAN.md).
export { transcribePieces } from './transcribe';

// Social push notifications (messages, friend activity, reports) -- also
// their own module; they share only the Firebase app with this file.
export {
  notifyDmMessage,
  notifyCircleMessage,
  notifyFriendRequest,
  notifyNudge,
  notifyChallenge,
  notifyDmCardAnswer,
  notifyCircleCardAnswer,
  notifyReport,
} from './social';

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

// ── DENOISE: DeepFilterNet ────────────────────────────────────────────────
//
// WHY NOT FFMPEG FILTERS. Two and a half months of tuning an ffmpeg-only chain
// (adeclick, arnndn, compressor, gate, EQ) ended in a blind listening test on
// 2026-10-16 where the best ffmpeg render was judged "almost identical to the
// original", and anything stronger sounded muffled or robotic. Those filters
// can only turn parts of the existing sound up or down.
//
// DeepFilterNet3 is a speech-enhancement network that is far better at telling
// voice from noise than RNNoise (arnndn). In the same test it beat RNNoise,
// Resemble's denoiser, and its own full-strength setting. Resemble Enhance
// (generative "studio" rebuild) sounded best most of the time but garbled
// words occasionally — unacceptable for recitation, where the words are the
// point. DeepFilterNet only removes; it never invents audio.
//
// It runs as the upstream Rust CLI (statically linked, CPU only, ~20x faster
// than real time), fetched at install time by scripts/fetch-deep-filter.js.
//
//   -a 12  ATTENUATION LIMIT. Noise comes down at most 12dB, by blending the
//          enhanced signal with the original. "Gentle" won the listening test
//          over full strength (-a 100): some room tone is what keeps it from
//          sounding robotic or like the speaker is in a vacuum.
//   -D     Compensate the model's lookahead delay. WITHOUT THIS every verse
//          tap mark would be off by the STFT+lookahead latency. Measured: zero
//          sample offset vs the input, output ~30ms shorter at the tail (well
//          inside MAX_DURATION_DRIFT_SEC).
//
// A missing or failing binary degrades to "no denoise" with an error log,
// never a failed render — the same rule the rest of this file follows.
const DEEP_FILTER_PATH = join(__dirname, '..', 'bin', process.platform === 'win32' ? 'deep-filter.exe' : 'deep-filter');
const DEEP_FILTER_ARGS = ['-D', '-a', '12'];

// DeepFilterNet only works at 48kHz, so the whole pipeline runs at 48k.
const OUTPUT_SAMPLE_RATE = '48000';

// ── BOOM TRIM: PER-RECORDING PROXIMITY CORRECTION ─────────────────────────
//
// Holding the phone close to your mouth piles up 100-200Hz (the "proximity
// effect"). That boom is most of what makes a take sound like the speaker is
// "eating the mic" rather than across the table. It varies enormously between
// takes — measured across eight real recitations, the 90-220Hz band sat
// anywhere from +0.1dB to +14.4dB above the 800-2000Hz band — so a fixed cut
// would thin out the good takes to fix the bad ones.
//
// So it is measured per recording and only the excess is removed. The target
// (+1dB) is the take the user picked as having "a great feel where it doesn't
// sound like I'm eating the microphone". Each dB of excess gets 1.5dB of cut
// because a broad bell at 150Hz removes less than its nominal gain from the
// whole 90-220Hz band; 1.5 was what brought a +4.9dB take level with the
// target. Capped at 10dB.
const BOOM_TARGET_DB = 1;
const BOOM_CUT_PER_DB = 1.5;
const BOOM_MAX_CUT_DB = 10;

/** Everything ahead of loudnorm. */
function preFilters(boomCutDb: number): string {
  const filters = ['highpass=f=70'];
  if (boomCutDb > 0.1) filters.push(`equalizer=f=150:width_type=q:w=0.8:g=-${boomCutDb.toFixed(1)}`);
  return filters.join(',');
}

// ── ONLY LONG-STABLE FILTERS BELOW THIS LINE ──────────────────────────────
//
// This chain previously used `adynamicequalizer`, which broke every render for
// two weeks. The reason is a trap worth stating plainly:
//
//   ffmpeg-static ships a DIFFERENT upstream ffmpeg build per platform under
//   the same package version. 5.3.0 gives Windows a 6.1.1 gyan.dev build whose
//   adynamicequalizer accepts `mode=cut` and `direction=downward`, and Linux a
//   7.0.2 johnvansickle build that rejects `mode=cut` outright:
//     "[Eval] Undefined constant or missing '(' in 'cut'"
//     "Error applying option 'mode' to filter 'adynamicequalizer'"
//
// Note the deployed build is NEWER, not older — so "it works on a recent
// ffmpeg" is not the property that matters. adynamicequalizer only landed in
// 2022 and its option surface has been churning ever since; both builds are
// recent and they still disagree.
//
// The chain therefore parsed clean locally and died on EVERY Cloud Functions
// invocation for two weeks. LOCAL TESTING CANNOT VALIDATE FILTER OPTIONS FOR
// THE DEPLOYED ENVIRONMENT. Anything added here must stick to filters whose
// options have been stable for years — `equalizer`, `highpass`/`lowpass`,
// `acompressor`, `asplit`, `amix`, `loudnorm`, `alimiter` all qualify. Two
// further rules earned the hard way:
//   • Don't name an enum constant you don't need. Every option spelled out is
//     a chance to hit a renamed constant; defaults don't have that problem.
//   • The startup probe (logEnvironmentOnce) dry-runs the real chain, so a
//     parse failure shows up once in the logs rather than silently per-render.
//
// No gate and no compressor any more: DeepFilterNet handles the pauses, and
// both were part of what made earlier renders sound close-miked and boxed in.

// ── DE-ESSER: SPLIT-BAND COMPRESSOR ───────────────────────────────────────
//
// WHAT SHIPPED BEFORE THIS, AND WHY IT SOUNDED BAD (measured 2026-10-16 on
// two real recitations, raw upload vs the studio file production made):
//   • adynamicequalizer never worked on the deployed 7.0.2 build — one
//     spelling doesn't parse, the other parses and does nothing — so every
//     render fell back to fixed EQ bells.
//   • Fixed bells cut on EVERY sound, not just on esses. The deployed version
//     (-10dB at 5500 + 7200) took 5-8kHz down ~9-13dB on plain vowels: that
//     is the "muffled" complaint.
//   • Meanwhile on the esses themselves it gutted 4-9kHz (the part that makes
//     an /s/ sound like an /s/) and barely touched 9-12kHz, while the AIR
//     shelf lifted the very top. What was left of each "s" was a thin,
//     piercing hiss: the "still sharp" complaint. Both complaints, one cause.
//   • Retuned bells (7000/9000, -6dB) were committed on 2026-08-24 but never
//     deployed, so none of that tuning was ever heard.
//
// THE FIX: split the signal at 4.5kHz, compress ONLY the top band, add it
// back. On a vowel the top band sits well under the threshold and passes
// through untouched; on an "s" it jumps 15-20dB, crosses the threshold, and
// gets pulled down — evenly across the whole sibilance range, so the
// consonant keeps its shape and just gets quieter. That is what de-essing
// actually means, and it is built only from filters whose options have been
// stable for years (asplit, lowpass/highpass, acompressor, amix).
//
// The crossover is two cascaded 2nd-order Butterworths per side, i.e. a
// Linkwitz-Riley 4th-order pair: the two halves sum back flat, so with the
// compressor idle the band split is inaudible (measured within ~0.5dB).
//
// Measured on the same two recitations (dB relative to a 1-2kHz anchor; the
// "s-peak" column is how far loud esses stand above the voice):
//                         vowels 5-8kHz   esses 4-6k   esses 6-9k   s-peak
//   raw take A                 -11.9          +6.1        +4.9        10.6
//   deployed bells A           -25.3          -4.9        -5.3        -2.3
//   split-band A               -11.7          +4.6        +1.3         4.9
//   raw take B                 -23.2          -1.1        -1.7         2.5
//   deployed bells B           -32.1         -10.9       -10.9        -7.3
//   split-band B               -19.8          -1.0        -2.9        -0.5
//
// TUNING: `threshold` on the high-band compressor is the strength knob, and
// it is an ABSOLUTE level (which is why this runs after loudnorm). Lower it
// for more de-essing — at -26dB vowels start to lose ~1dB of top end, at -30
// it is audibly duller. `ratio` matters much less than threshold here.
//
// 2026-10-25: the original -22dB/8:1 at 4.5kHz made the user sound lisped.
// Picked by ear from a five-step A/B on a real Isaiah 61 take: crossover up to
// 6kHz (leaves the body of the "s" alone), threshold -15dB, ratio 2.5 — only
// the sharpest esses get trimmed.
const DEESS_CROSSOVER_HZ = 6000;
const SPLIT_BAND_DEESSER =
  `asplit[deess_lo][deess_hi];` +
  `[deess_lo]lowpass=f=${DEESS_CROSSOVER_HZ},lowpass=f=${DEESS_CROSSOVER_HZ}[deess_l];` +
  `[deess_hi]highpass=f=${DEESS_CROSSOVER_HZ},highpass=f=${DEESS_CROSSOVER_HZ},` +
  `acompressor=threshold=-15dB:ratio=2.5:attack=1:release=50:knee=2[deess_h];` +
  `[deess_l][deess_h]amix=inputs=2:normalize=0`;

// Still probed at startup rather than assumed — the 7.0.2 lesson stands. The
// static bell is the fallback only if the split-band graph is ever rejected;
// it is the committed-but-never-deployed 7000/9000 pair, which is at least
// far gentler than what production actually ran.
interface DeesserCandidate {
  label: string;
  expr: string;
}
const DEESSER_CANDIDATES: ReadonlyArray<DeesserCandidate> = [
  { label: 'split-band', expr: SPLIT_BAND_DEESSER },
  {
    label: 'static-split-bells',
    expr: 'equalizer=f=7000:width_type=q:w=2:g=-6,equalizer=f=9000:width_type=q:w=3:g=-6',
  },
];

// Where the efficacy probe injects test energy. MUST sit inside the band the
// candidates actually cut — measuring attenuation at a frequency the filters
// don't touch would reject a perfectly good de-esser as inert.
const SIBILANCE_PROBE_HZ = 7500;

// A candidate has to attenuate the sibilance band by at least this much to
// count as working. This is a "does it do ANYTHING" gate, not a quality bar —
// an inert filter measures ~0.0dB.
//
// If every candidate is rejected, activeDeesser keeps its initial value (the
// static bells, the last entry) and an error is logged — so the worst case is
// a loud complaint plus the fallback, never a silent no-op.
const MIN_DEESS_ATTENUATION_DB = 2.5;

// Which candidate this binary actually accepts. Starts at the universal
// fallback so a render before/without a successful probe still works.
let activeDeesser: DeesserCandidate = DEESSER_CANDIDATES[DEESSER_CANDIDATES.length - 1];

// NO TONE SHAPING BEYOND THIS. Earlier chains added a presence bell and an
// air shelf to "sound produced"; on real takes both re-sharpened the esses and
// made the voice sound closer to the mic, and the version the user chose in
// the listening test had neither.

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

/**
 * Full chain for the apply pass. Order is load-bearing: the de-esser's
 * threshold is an ABSOLUTE level, so it has to sit downstream of loudnorm so it behaves identically on a quiet
 * take and a hot one.
 */
function buildFilterChain(pre: string, loudnormArgs: string, deesser: string = activeDeesser.expr): string {
  return `${pre},${loudnormArgs},${deesser},${LIMITER}`;
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

/**
 * Errors MUST be flattened before they reach logger.error.
 *
 * The structured logger JSON-serializes its payload, and `message`/`stack` are
 * non-enumerable on Error instances — so `logger.error('...', { err })` writes
 * literally `"err":{}` and throws away the only thing worth logging. That is
 * exactly how this function sat broken for two weeks: every invocation failed,
 * every failure logged an empty object, and there was nothing to go on.
 *
 * gRPC/Firestore errors serialize fine (their fields ARE enumerable), which is
 * why the one early "No document to update" failure was readable and no other
 * one was.
 */
function describeError(err: unknown): Record<string, string> {
  if (err instanceof Error) {
    return {
      errName: err.name,
      // ffmpeg failures carry their stderr tail here (see run()), which is
      // where the actual filter/codec complaint lives.
      errMessage: err.message,
      errStack: err.stack ?? '<no stack>',
    };
  }
  return { errMessage: String(err) };
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

/**
 * Mean level (dBFS) of a synthetic signal after `filters`, via volumedetect.
 * Returns null if ffmpeg refused the graph at all — which is how the caller
 * distinguishes "this filter doesn't parse" from "this filter does nothing".
 */
async function meanVolumeAfter(source: string, filters: string): Promise<number | null> {
  try {
    const { stderr } = await run(ffmpegPath!, [
      '-hide_banner',
      '-f',
      'lavfi',
      '-i',
      source,
      '-t',
      '1',
      '-af',
      filters,
      '-f',
      'null',
      '-',
    ]);
    const match = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
    return match ? Number.parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * How many dB a de-esser candidate actually removes from the sibilance band.
 *
 * THIS EXISTS BECAUSE PARSE-VALIDATION WASN'T ENOUGH. The previous probe only
 * checked that a candidate's options were accepted, so `mode=cutabove` — which
 * this build parses happily and then ignores — passed, and shipped a de-esser
 * that did nothing for days. Comparing raw and studio renders of the same
 * recitation showed the sibilance band coming out 1.5-2.2dB LOUDER than the
 * source, not quieter.
 *
 * So: measure the effect, don't infer it from the absence of an error. Feeds
 * band-limited noise centred on the sibilance plateau through the candidate
 * and reports the attenuation. Returns null if the graph won't run.
 */
async function measureDeessAttenuation(expr: string): Promise<number | null> {
  // Loud, steady, band-limited noise — a sustained worst-case "sss". A dynamic
  // de-esser clamps down and holds; an inert one returns the input untouched.
  const source = `anoisesrc=color=white:r=48000:a=0.5`;
  const analyse = `bandpass=f=${SIBILANCE_PROBE_HZ}:width_type=o:w=1.2,volumedetect`;
  const dry = await meanVolumeAfter(source, analyse);
  const wet = await meanVolumeAfter(source, `${expr},${analyse}`);
  if (dry === null || wet === null) return null;
  return dry - wet;
}

/**
 * One-time environment dump, on the first invocation of each instance.
 *
 * The deployed ffmpeg is NOT the one you get locally: ffmpeg-static downloads
 * a per-platform build at install time, so the Linux binary running here is a
 * different build (and potentially a different version) from the Windows/macOS
 * one a filter chain was tuned against. A chain that runs clean locally can
 * still be rejected up here, so record what we actually got before blaming
 * anything else.
 */
let environmentLogged = false;
async function logEnvironmentOnce(): Promise<void> {
  if (environmentLogged) return;
  environmentLogged = true;
  try {
    // `-version` goes to STDOUT (unlike almost everything else ffmpeg prints,
    // which is why the first diagnostic pass logged an empty version string).
    const { stdout: versionOut } = await run(ffmpegPath!, ['-hide_banner', '-version']);
    // `-filters` is the direct answer to "does this build even have the
    // filters the chain names?" — the most likely way a render dies here.
    const { stdout: filters } = await run(ffmpegPath!, ['-hide_banner', '-filters']);
    const named = ['highpass', 'lowpass', 'equalizer', 'asplit', 'amix', 'acompressor', 'loudnorm', 'alimiter'];

    // Filter EXISTENCE is not the failure mode that bit us — option parsing is.
    // So dry-run the real chain against 100ms of silence, once per de-esser
    // candidate, and keep the first that this binary accepts. ~50ms each, once
    // per instance, and it turns "every render fails forever with no
    // explanation" into a single line at startup.
    const rejected: Array<{ label: string; why: string }> = [];
    let chosen: DeesserCandidate | null = null;
    let chosenAttenuationDb: number | null = null;
    for (const candidate of DEESSER_CANDIDATES) {
      // 1. Does the whole chain parse with this candidate in it?
      try {
        await run(ffmpegPath!, [
          '-hide_banner',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=44100:cl=mono',
          '-t',
          '0.1',
          '-af',
          buildFilterChain(preFilters(3), `loudnorm=${LOUDNORM_TARGET}`, candidate.expr),
          '-f',
          'null',
          '-',
        ]);
      } catch (probeErr) {
        rejected.push({
          label: candidate.label,
          why: `did not parse: ${probeErr instanceof Error ? probeErr.message.slice(-300) : String(probeErr)}`,
        });
        continue;
      }

      // 2. Parsing is not the same as working — measure that it actually cuts.
      const attenuation = await measureDeessAttenuation(candidate.expr);
      if (attenuation === null || attenuation < MIN_DEESS_ATTENUATION_DB) {
        rejected.push({
          label: candidate.label,
          why: `parsed but INERT — attenuated ${attenuation?.toFixed(1) ?? '<unmeasurable>'}dB, need >=${MIN_DEESS_ATTENUATION_DB}dB`,
        });
        continue;
      }

      chosen = candidate;
      chosenAttenuationDb = attenuation;
      break;
    }
    if (chosen) activeDeesser = chosen;

    // A missing denoiser is silent degradation — renders still succeed, just
    // without denoising — so it has to be visible here or nobody would know.
    let deepFilter = '<MISSING — denoise disabled>';
    if (existsSync(DEEP_FILTER_PATH)) {
      try {
        ensureExecutable(DEEP_FILTER_PATH);
        deepFilter = (await run(DEEP_FILTER_PATH, ['--version'])).stdout.trim() || DEEP_FILTER_PATH;
      } catch (dfErr) {
        deepFilter = `<PRESENT BUT WON'T RUN — denoise disabled> ${describeError(dfErr).errMessage.slice(0, 300)}`;
      }
    }

    logger.info('ffmpeg environment', {
      ffmpegPath,
      ffprobePath,
      version: versionOut.split('\n')[0]?.trim() || '<unreadable>',
      filtersPresent: named.filter((f) => new RegExp(`\\b${f}\\b`).test(filters)),
      filtersMissing: named.filter((f) => !new RegExp(`\\b${f}\\b`).test(filters)),
      deesser: chosen?.label ?? '<none accepted>',
      deesserAttenuationDb: chosenAttenuationDb?.toFixed(1) ?? null,
      deesserRejected: rejected,
      deepFilter,
      outputSampleRate: OUTPUT_SAMPLE_RATE,
    });
    if (!chosen) {
      // Every candidate including the static bell failed, so the problem is
      // elsewhere in the chain and every render is about to fail.
      logger.error('FILTER CHAIN REJECTED BY THIS FFMPEG BUILD — every render will fail', { rejected });
    }
  } catch (err) {
    logger.error('Could not inspect ffmpeg build', describeError(err));
  }
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
async function measureLoudness(inputPath: string, pre: string): Promise<LoudnormMeasurement | null> {
  const { stderr } = await run(ffmpegPath!, [
    '-hide_banner',
    '-i',
    inputPath,
    '-af',
    `${pre},loudnorm=${LOUDNORM_TARGET}:print_format=json`,
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

/**
 * How far the 90-220Hz "boom" band sits above the 800-2000Hz voice band, in dB.
 * Both bands are measured over the whole file with the same silences in them,
 * so the difference is a fair measure of tonal balance. Null if unmeasurable.
 */
async function measureBoomDb(inputPath: string): Promise<number | null> {
  const band = async (lo: number, hi: number): Promise<number | null> => {
    const { stderr } = await run(ffmpegPath!, [
      '-hide_banner',
      '-i',
      inputPath,
      '-af',
      // Doubled 2nd-order filters: steep enough that neighbouring bands don't
      // leak into the measurement.
      `highpass=f=${lo},highpass=f=${lo},lowpass=f=${hi},lowpass=f=${hi},volumedetect`,
      '-f',
      'null',
      '-',
    ]);
    const match = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
    return match ? Number.parseFloat(match[1]) : null;
  };
  const [boom, voice] = await Promise.all([band(90, 220), band(800, 2000)]);
  return boom === null || voice === null ? null : boom - voice;
}

/**
 * Decode to 48k mono WAV and run DeepFilterNet over it. Returns the path of
 * the denoised WAV, or of the plain decoded WAV if the denoiser is unavailable
 * or fails (logged — see DEEP_FILTER_PATH).
 */
async function denoise(inputPath: string, workDir: string): Promise<string> {
  const decoded = join(workDir, 'decoded.wav');
  await run(ffmpegPath!, ['-hide_banner', '-y', '-i', inputPath, '-ac', '1', '-ar', OUTPUT_SAMPLE_RATE, decoded]);

  if (!existsSync(DEEP_FILTER_PATH)) {
    logger.error('DeepFilterNet binary missing — rendering without denoise', { DEEP_FILTER_PATH });
    return decoded;
  }
  const outDir = join(workDir, 'denoised');
  try {
    await run(ensureExecutable(DEEP_FILTER_PATH), [...DEEP_FILTER_ARGS, '-o', outDir, decoded]);
    const denoised = join(outDir, 'decoded.wav');
    if (!existsSync(denoised)) throw new Error(`deep-filter produced no output at ${denoised}`);
    return denoised;
  } catch (err) {
    logger.error('DeepFilterNet failed — rendering without denoise', describeError(err));
    return decoded;
  }
}

async function renderStudioAudio(inputPath: string, outputPath: string): Promise<void> {
  const workDir = dirname(outputPath);
  const cleanPath = await denoise(inputPath, workDir);

  // Measured AFTER denoising, so room noise doesn't count as boom.
  const boomDb = await measureBoomDb(cleanPath);
  const boomCutDb =
    boomDb === null ? 0 : Math.min(BOOM_MAX_CUT_DB, Math.max(0, (boomDb - BOOM_TARGET_DB) * BOOM_CUT_PER_DB));
  const pre = preFilters(boomCutDb);

  const measured = await measureLoudness(cleanPath, pre);

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
  logger.info('Studio render settings', { inputPath, boomDb, boomCutDb, denoised: cleanPath !== join(workDir, 'decoded.wav') });

  await run(ffmpegPath!, [
    '-hide_banner',
    '-y',
    '-i',
    cleanPath,
    '-af',
    buildFilterChain(pre, loudnormArgs),
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
    OUTPUT_SAMPLE_RATE,
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
    // Sized for the old adeclick chain (~160s of CPU per 10 minutes). The
    // DeepFilterNet chain is several times faster, but a long recitation on a
    // slow instance is the case that matters, so the headroom stays.
    timeoutSeconds: 540,
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

    // Narrates how far a run got. Without this a failure is just "something
    // in a six-step pipeline threw", and the stage is most of the diagnosis.
    let stage = 'start';
    try {
      stage = 'ensure-binaries';
      ensureExecutable(ffmpegPath);
      ensureExecutable(ffprobePath);

      stage = 'log-environment';
      await logEnvironmentOnce();

      stage = 'download-source';
      await bucket.file(objectPath).download({ destination: inputPath });
      logger.info('Studio render starting', { objectPath, sizeBytes });

      stage = 'probe-source';
      const sourceDuration = await probeDurationSec(inputPath);

      stage = 'render';
      await renderStudioAudio(inputPath, outputPath);

      stage = 'probe-render';
      const renderedDuration = await probeDurationSec(outputPath);
      logger.info('Studio render complete', { objectPath, sourceDuration, renderedDuration });

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

      stage = 'upload-render';
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
      stage = 'attach-to-doc';
      try {
        await docRef.update(studioFields);
      } catch (updateErr) {
        logger.error('Could not attach studio render to its recording — removing orphaned blob', {
          objectPath,
          studioPath,
          ...describeError(updateErr),
        });
        await bucket
          .file(studioPath)
          .delete({ ignoreNotFound: true })
          .catch((deleteErr) =>
            logger.error('Failed to remove orphaned studio blob', { studioPath, ...describeError(deleteErr) })
          );
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
        logger.error('Could not mirror studio fields onto shared recording', {
          objectPath,
          ...describeError(mirrorErr),
        });
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
      logger.error('Studio processing failed', { objectPath, stage, ...describeError(err) });
      // Leaves the raw recording fully playable; the client treats 'failed'
      // as "just use audioUrl".
      await docRef.update({ studioStatus: 'failed' }).catch((updateErr) => {
        logger.error('Could not mark studioStatus=failed', { objectPath, ...describeError(updateErr) });
      });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
);

// ── Recording delete cleanup ────────────────────────────────────────────────
// The app deletes a recording's files itself, but only for the paths it knows
// about at that moment: a studio render that landed after the app loaded, a
// Storage delete that failed on a bad connection, or the shared copy in
// sharedRecordings (what circles, chats and the Community feed read) would
// otherwise stay on the server forever with nothing pointing at them. This
// runs on every private-doc delete and removes whatever is left.
//
// Saved copies (users/{saver}/recordings/saved_*) point at the ORIGINAL
// owner's file, so only files under this doc's own uid and id are touched --
// deleting your saved copy never deletes someone else's recording.
export const cleanUpDeletedRecording = onDocumentDeleted(
  { document: 'users/{uid}/recordings/{recordingId}', database: FIRESTORE_DATABASE_ID, region: 'us-east1' },
  async (event) => {
    const { uid, recordingId } = event.params;
    const bucket = getStorage(app).bucket();
    const [files] = await bucket.getFiles({ prefix: `recordings/${uid}/${recordingId}` });
    // The prefix also matches longer ids (rec_1 vs rec_12), so check the name exactly.
    const mine = files.filter((f) => {
      const base = f.name.split('/')[2]?.replace(/\.[^.]+$/, '');
      return base === recordingId || base === `${recordingId}${STUDIO_SUFFIX}`;
    });
    await Promise.all(mine.map((f) => f.delete({ ignoreNotFound: true })));

    const sharedRef = db.doc(`sharedRecordings/${recordingId}`);
    const shared = await sharedRef.get();
    const deletedShared = shared.exists && (shared.data()?.ownerId ?? shared.data()?.userId) === uid;
    if (deletedShared) await sharedRef.delete();

    if (mine.length || deletedShared) {
      logger.info('Cleaned up deleted recording', {
        uid,
        recordingId,
        files: mine.map((f) => f.name),
        deletedShared,
      });
    }
  }
);

// A saved recording is a bookmark of someone else's sharedRecordings copy,
// not a copy of its own. When the owner deletes the recording or makes it
// private, the shared copy goes -- and so must every bookmark of it, or
// it would linger in other people's libraries with audio they no longer
// have the owner's permission to hear. The app also drops bookmarks it can
// no longer read when it loads; this catches them without waiting for that.
// Needs the collection-group index on recordings.savedFromRecordingId
// (firestore.indexes.json).
export const onSharedRecordingDeleted = onDocumentDeleted(
  { document: 'sharedRecordings/{recordingId}', database: FIRESTORE_DATABASE_ID, region: 'us-east1' },
  async (event) => {
    const { recordingId } = event.params;
    const bookmarks = await db.collectionGroup('recordings').where('savedFromRecordingId', '==', recordingId).get();
    if (bookmarks.empty) return;
    const writer = db.bulkWriter();
    bookmarks.docs.forEach((d) => writer.delete(d.ref));
    await writer.close();
    logger.info('Removed bookmarks of an unshared recording', { recordingId, count: bookmarks.size });
  }
);
