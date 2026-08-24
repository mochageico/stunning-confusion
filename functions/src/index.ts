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

// The api.bible proxy lives in its own module -- it shares nothing with the
// audio pipeline in this file beyond the Firebase app, and inlining it here
// would bury it in 700 lines of ffmpeg argument construction.
export { fetchApiBibleChapter } from './apiBible';

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
//   adeclick    — removes mouth clicks / saliva ticks (see below)
//   acompressor — evens out lean-in/lean-back level swings WITHIN a take
//
// adeclick is an interpolator, not a filter in the EQ sense: it finds samples
// that are impulsive outliers against an autoregressive prediction of the
// waveform and redraws them from their neighbours. That is exactly what a
// mouth click is — a few milliseconds of broadband tick with no harmonic
// relationship to the speech around it — so it is removed rather than merely
// turned down, and sustained speech is left untouched because sustained speech
// is predictable. `threshold` is the sensitivity knob and is INVERTED: lower
// detects more.
//
// Started at 3.5 (deliberately conservative, to avoid smoothing consonant
// transients) and that did essentially nothing — mouth clicks were reported as
// "very much still there". Now 1.6, below the vinyl-tuned default of 2, plus a
// shorter window so short events are localized better and a wider burst fusion
// so a cluster of ticks is treated as one event.
//
// HONEST LIMIT: adeclick was written for vinyl, where a click is a large,
// very short impulse. Mouth clicks are low-level and slightly longer, so they
// sit much closer to the detector's noise floor and some will always survive.
// If this pass still isn't enough, the answer is a speech-aware model
// (arnndn), not a lower threshold — below ~1.2 it starts audibly dulling
// consonants for very little extra click removal.
//
// It is the most expensive filter in the chain by a wide margin (overlapping
// windowed autoregression). Budgeted against the 300s timeout it is fine for
// recitation-length audio, but it is the first thing to look at if renders
// ever start timing out.
//
// acompressor: threshold/ratio raised from -20dB/2.5 because the first
// listenable render "barely sounded different from the original, just louder".
// Loudness normalization alone doesn't read as "produced" — evening out the
// dynamics within a phrase is what does.
//
// DENOISE: arnndn, never afftdn. This distinction is the whole reason the
// first version sounded worse than the raw take.
//
// afftdn is a spectral subtractor: it estimates a noise floor per FFT bin and
// pulls everything near it down, with no idea what speech is. Low-level
// high-frequency content — breath, air, presence — looks exactly like noise to
// it, so it went first. Measured cost was ~2.7dB across 10-16kHz.
//
// arnndn runs a recurrent network trained to distinguish voice from
// everything else, so it removes the noise floor without flattening quiet
// treble. Measured here against the two candidate models (5s each, mean
// volume, dB change vs dry):
//                       pink noise    harmonic complex    10-16kHz band
//   bd.rnnn                  -6.7            -0.4              -1.8
//   sh.rnnn                 -22.6            -4.4              -2.2
// sh removes ~16dB more noise for essentially the same treble cost, which is
// the trade the whole chain has been trying to make. The -4.4dB on the
// harmonic complex is NOT a real speech figure — a synthetic tone stack is
// legitimately "not speech" to the model, and the more aggressive model
// suppresses it harder. Real voice should see far less.
//
// TUNING: swapping to bd.rnnn is a one-word change below. Do that first if
// the voice ever sounds thinned or "underwater" rather than merely cleaner.
//
// The model is REQUIRED — ffmpeg ships no default weights — so the filter is
// included only when the file is actually present. A missing model degrades
// to the previous chain instead of failing every render, which is the failure
// mode this function has already been through once.
const RNNOISE_MODEL = join(__dirname, '..', 'models', 'sh.rnnn');
const hasRnnoiseModel = existsSync(RNNOISE_MODEL);

// arnndn is fixed at 48kHz internally, so ffmpeg inserts resamplers around it
// on 44.1k input. OUTPUT_SAMPLE_RATE follows it to 48k so the audio is
// resampled once on the way in rather than twice (in and back out again).
const OUTPUT_SAMPLE_RATE = hasRnnoiseModel ? '48000' : '44100';
// adeclick runs BEFORE arnndn: its autoregressive prediction works on the
// unmodified waveform, and denoising first would smear the very transients it
// is looking for. Both run before the compressor, so neither click nor noise
// floor gets amplified on the way through.
const PRE_FILTERS = [
  'highpass=f=70',
  'adeclick=window=45:overlap=80:arorder=8:threshold=1.6:burst=4',
  ...(hasRnnoiseModel ? [`arnndn=m=${RNNOISE_MODEL.replace(/\\/g, '/')}`] : []),
  // Backed off from -24dB/3.5:1. Compression is part of why the esses got
  // WORSE: sibilants sit below the vowel peaks, so a low threshold and high
  // ratio lift them relative to everything else. Measured on a real take, the
  // 5-8kHz band came out 1.5-2.2dB hotter than the source. 2.5:1 still evens
  // out lean-in/lean-back swings without amplifying the problem the de-esser
  // then has to undo.
  'acompressor=threshold=-22dB:ratio=2.5:attack=20:release=240:makeup=1',
].join(',');

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
// options have been stable for years — `equalizer`, `treble`/`bass`,
// `highpass`, `acompressor`, `agate`, `adeclick`, `loudnorm`, `alimiter` all
// qualify. Two further rules earned the hard way:
//   • Don't name an enum constant you don't need. Every option spelled out is
//     a chance to hit a renamed constant; defaults don't have that problem.
//   • The startup probe (logEnvironmentOnce) dry-runs the real chain, so a
//     parse failure shows up once in the logs rather than silently per-render.
//
// Downward expander, NOT a hard gate. Runs after loudnorm so its threshold
// means the same thing on every recording (the same reason the de-esser does).
//
// This is the "noise cancellation" that is actually safe to apply. A spectral
// denoiser works on the speech as well as the silence and takes the top octave
// with it; an expander only ever pulls DOWN material that is already far below
// speech level, i.e. room tone in the gaps between phrases. Silent gaps are
// most of what makes a recording read as "studio" rather than "phone in a
// room", and this costs nothing in the parts you can hear.
//
// Deliberately gentle: ratio 2 and range 0.15 cap the reduction at about
// -16dB, so pauses go quiet rather than dead — an abruptly digital-black gap
// sounds worse and more artificial than light room tone. The slow-ish release
// (250ms) keeps word tails and breaths from being chopped off.
const GATE = 'agate=threshold=0.02:ratio=2:range=0.15:attack=20:release=250:knee=4';

// ── DE-ESSER: CAPABILITY-PROBED, NOT ASSUMED ──────────────────────────────
//
// A static bell is the safe option but it is strictly worse than a dynamic
// one: it cuts 6.8k on every vowel, so the only way to get more sibilance
// control is to make the whole recording duller. At -6.5dB the esses were
// still reported as too loud, and -8 is about where speech starts to lisp, so
// the static approach has run out of room.
//
// A dynamic EQ cuts only while the band is actually loud, which is what
// de-essing is supposed to mean — it can take 12dB off an "s" and leave the
// vowel either side completely untouched. The reason the chain isn't simply
// using one is that adynamicequalizer's option names differ between ffmpeg
// builds, and guessing wrong took studio mode down for two weeks.
//
// So: don't guess. List the candidates best-first and let the startup probe
// dry-run each against this specific binary (see resolveDeesser). The static
// bell is last and universal, so there is always a working answer — the worst
// case is that we land back exactly where we are today, with a log line
// saying so, instead of failing every render.
interface DeesserCandidate {
  label: string;
  expr: string;
}
// TUNING — `threshold` IS THE STRENGTH KNOB, AND IT READS BACKWARDS.
//
// It is NOT "the level above which de-essing starts". Raising it produces MORE
// cut, not less. This was worth 0.9dB of actual de-essing when it was set to
// 0.10 on the assumption that a lower number meant a more sensitive trigger —
// the esses came back as "still extremely sharp, almost identical to the
// unprocessed take", which is exactly what -0.9dB sounds like.
//
// Measured on a voiced/sibilant burst signal at -16 LUFS (mean level in band,
// dB change vs no de-esser). Note how little the voiced band moves — that
// selectivity is the entire reason for using a dynamic EQ over a static cut:
//   threshold   0.10   0.20   0.30   0.50   0.80   1.20
//   5.5-9kHz    -1.1   -3.6   -5.2   -7.6  -10.3  -12.9
//   200-1200Hz   0.0   -0.1   -0.1   -0.2   -0.3   -0.5
//
// 1.0 sits at about -11.7dB on sibilance for -0.4dB on the voice. Dial DOWN
// toward 0.5 if speech starts sounding lisped; UP toward 1.2 if esses are
// still sharp.
//
// dqfactor (detection) is deliberately WIDER than tqfactor (cut): listen
// across the whole sibilance region, but only cut where it actually is.
// Widening tqfactor cuts more esses but starts pulling 10-16kHz air down with
// it, which is the complaint this chain started with — leave it narrow.
//
// CAVEAT: this curve was measured on the local 6.1.1 build via the `mode=cut`
// spelling. Production runs 7.0.2 via `mode=cutabove`. Same filter, same
// intent — cut while the detected band is ABOVE threshold — but the two
// spellings were never measured side by side, so treat the absolute dB as
// indicative and the direction as certain.
const DEESSER_CANDIDATES: ReadonlyArray<DeesserCandidate> = [
  {
    // ffmpeg >= 6.1 spelling: mode + separate direction.
    label: 'dynamic-modern',
    expr:
      'adynamicequalizer=dfrequency=7500:dqfactor=1.6:tfrequency=7500:tqfactor=2' +
      ':threshold=1.0:ratio=8:attack=1:release=35:range=16:mode=cut:direction=downward',
  },
  {
    // Pre-6.1 spelling: direction folded into the mode constant. THIS IS THE
    // ONE PRODUCTION ACTUALLY USES — the 7.0.2 build rejects `mode=cut`.
    label: 'dynamic-legacy',
    expr:
      'adynamicequalizer=dfrequency=7500:dqfactor=1.6:tfrequency=7500:tqfactor=2' +
      ':threshold=1.0:ratio=8:attack=1:release=35:range=16:mode=cutabove',
  },
  {
    // Neither dynamic spelling measurably works — fall back to plain static
    // EQ, which behaves identically on every ffmpeg ever built.
    //
    // TWO bells, positioned by measurement against a real recitation.
    //
    // THE KEY LESSON, learned by getting it wrong: "de-ess harder" and "cut
    // where the energy is" are not the same instruction. The measured
    // sibilance plateau on a real take spans 5000-8000Hz and peaks near 6000,
    // so the obvious move was a deep cut centred there. That produced an
    // audible LISP — "esses" came back sounding like "esth".
    //
    // The reason is that the plateau is not all one thing. The 5-6kHz end is
    // what MAKES an /s/ an /s/: strip it and the consonant loses its identity
    // and degrades toward /θ/. The 7-9kHz end is what people actually hear as
    // "sharp" or "harsh". Cutting the whole plateau evenly removes the
    // harshness and the consonant together.
    //
    // So the bells sit at 7000 and 9000, ABOVE the identity band, and the
    // second is narrow (Q3) to keep it off the air above it.
    //
    // Two metrics, both relative to a 3500Hz anchor, measured on the real file:
    //   s-identity = 5500Hz - 3500Hz   (keep HIGH — low means lisp)
    //   harshness  = 8000Hz - 3500Hz   (pull DOWN — this is the complaint)
    //
    //                                    s-identity   harshness    air
    //   raw (untouched)                      +5.8        +4.6      -1.7
    //   -10 @5500+7200  (lisped)             -0.8        -2.4      -5.1
    //    -7 @5500+7200                       +1.2        -0.3      -4.5
    //    -6 @7000 Q2 + -6 @9000 Q3           +4.0        +0.3      -4.6  <- this
    //
    // TUNING: to soften the esses further, deepen the 9000 bell first and the
    // 7000 bell only if that isn't enough — 7000 is the one that costs
    // consonant clarity. If a lisp EVER reappears, raise both centres before
    // reducing gain; the frequency is what causes it, not the depth.
    label: 'static-split-bells',
    expr: 'equalizer=f=7000:width_type=q:w=2:g=-6,equalizer=f=9000:width_type=q:w=3:g=-6',
  },
];

// Where the efficacy probe injects test energy. MUST track the band the
// candidates actually cut — measuring attenuation at a frequency the filters
// don't touch would reject a perfectly good de-esser as inert.
const SIBILANCE_PROBE_HZ = 7500;

// A candidate has to attenuate the sibilance band by at least this much to
// count as working. This is a "does it do ANYTHING" gate, not a quality bar —
// an inert filter measures ~0.0dB, while the shallowest candidate we would
// actually ship measures 3.7dB on a broadband probe signal. 2.5 sits cleanly
// between those with room for build-to-build variation in either direction.
//
// If every candidate is rejected, activeDeesser keeps its initial value (the
// static bells, the last entry) and an error is logged — so the worst case is
// a loud complaint plus the known-good fallback, never a silent no-op.
const MIN_DEESS_ATTENUATION_DB = 2.5;

// Which candidate this binary actually accepts. Starts at the universal
// fallback so a render before/without a successful probe still works.
let activeDeesser: DeesserCandidate = DEESSER_CANDIDATES[DEESSER_CANDIDATES.length - 1];

// Presence. The 2–3kHz band is where speech reads as "forward, in the room"
// rather than "behind a curtain" — well below sibilance, so it costs nothing
// in harshness. Absent entirely from the old chain, which is part of why a
// render only ever sounded louder rather than better.
// Moved down from 2800Hz. At Q1.2 a 2800Hz bell reaches well into 4-5kHz,
// i.e. straight into the bottom of the sibilance plateau it now has to sit
// alongside. 2300 keeps the forwardness while staying clear of it, and it
// also lands on a genuine dip in the measured source spectrum.
const PRESENCE = 'equalizer=f=2300:width_type=q:w=1.4:g=2';

// Puts back the air the de-ess bell takes out, well above the sibilance the
// bell is there to control. Centred high enough (11k) that its skirt does not
// meaningfully re-lift 6.8k — the old chain had no compensation at all, which
// is why every render came out darker than its source.
// Raised to +4dB and moved down to 10.5k. The de-ess bells cost real air —
// measured against the raw take, 13kHz sits ~2.9dB lower relative to the
// 3.5kHz anchor than it started even after this compensation. 10.5k is as low
// as the shelf can go before its skirt starts re-lifting the 9k bell's work.
const AIR = 'treble=g=4:f=10500:width_type=q:w=0.7';

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
 * Full chain for the apply pass. Order is load-bearing: everything whose
 * threshold is an ABSOLUTE level (the gate, and the tone shaping that follows
 * it) has to sit downstream of loudnorm so it behaves identically on a quiet
 * take and a hot one.
 */
function buildFilterChain(loudnormArgs: string, deesser: string = activeDeesser.expr): string {
  return `${PRE_FILTERS},${loudnormArgs},${GATE},${deesser},${PRESENCE},${AIR},${LIMITER}`;
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
    const named = [
      'highpass',
      'adeclick',
      'arnndn',
      'agate',
      'acompressor',
      'loudnorm',
      'equalizer',
      'treble',
      'alimiter',
    ];

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
          buildFilterChain(`loudnorm=${LOUDNORM_TARGET}`, candidate.expr),
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

    logger.info('ffmpeg environment', {
      ffmpegPath,
      ffprobePath,
      version: versionOut.split('\n')[0]?.trim() || '<unreadable>',
      filtersPresent: named.filter((f) => new RegExp(`\\b${f}\\b`).test(filters)),
      filtersMissing: named.filter((f) => !new RegExp(`\\b${f}\\b`).test(filters)),
      deesser: chosen?.label ?? '<none accepted>',
      deesserAttenuationDb: chosenAttenuationDb?.toFixed(1) ?? null,
      deesserRejected: rejected,
      // A missing model is silent degradation — the chain still renders, just
      // without denoising — so it has to be visible here or nobody would know.
      rnnoiseModel: hasRnnoiseModel ? RNNOISE_MODEL : '<MISSING — denoise disabled>',
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
    // ffmpeg from carrying that through into the encoded file. Tracks arnndn's
    // fixed 48kHz when the denoiser is active (see OUTPUT_SAMPLE_RATE).
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
    // Raised from 300s. The chain now runs at roughly 3.8x realtime, almost
    // all of it adeclick's windowed autoregression — a 10 minute recitation is
    // ~160s of CPU before arnndn is added on top. 300s left too little room.
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
