# Speech second pass (Groq Whisper after Stop): plan

Status: **stages 1–5 coded 2026-10-31, function deployed; phone test pending (needs an OTA).** Research done 2026-10-24
in the speech bake-off (scripts and data in `bakeoff/`, local only; gitignored).

Stage 1 as built: Recall passes `onAudio` to the recognizer, which on iPhone (not
offline) saves a 16 kHz 16-bit mono WAV (`recordingOptions` with `outputSampleRate:
16000, outputEncoding: 'pcmFormatInt16'`). The file arrives via `audioend` just
after Stop; Recall keeps the last one in `speechAudioUriRef` and deletes it on the
next run or on close (`src/lib/speechRecording.ts`). Owner and tester accounts see
a toast like "Saved audio: WAV 16000 Hz, 16-bit, mono, 12.4 s, 397 KB" to confirm
it on the phone. No native change, so an OTA update is enough to test.

Stage 2 **deployed 2026-10-31** (us-east1). `GROQ_API_KEY` version 3 is the good
key; versions 1 and 2 hold it pasted twice and should be disabled. The limit values
are `TRANSCRIBE_DAILY_CAP` and `TRANSCRIBE_USER_DAILY_CAP` in `functions/.env`, which
is gitignored, so a fresh clone needs them added back. Checked: an unsigned call gets 401, and a 16 kHz
WAV sent to Groq with the function's exact settings came back word-perfect in 1.35 s.
Not yet called signed-in from the app (that comes with stage 5). Key versions 1
and 2 disabled.

Stage 3 coded 2026-10-31. `src/lib/speechPieces.ts` (pure; checked by
`npm run check:speechpieces [folder of WAVs]`) cuts the saved WAV, and
`speechRecordingPieces(uri)` in `speechRecording.ts` returns base64 pieces:
- Loudness per 20 ms frame. "Quiet" means 30% of the way from the noise floor up to
  speech, at least 12 dB under speech, and always anything below -50 dBFS.
- Each piece runs to the middle of the last 300 ms+ pause before 24 s. With no pause
  in reach, it cuts at the quietest frame in the last 4 s. Pieces start where the
  sound starts, trim silence to 0.2 s at the ends, and silent pieces are dropped.
- Bake-off clips: 1–7 pieces each, none over 24 s, no speech left out.
- **Whisper collapse, found here:** a piece opening with a spoken number made Whisper
  write only numbers for the whole piece ("11. 12." for 80 words). Temperature 0.2
  and a neutral prompt didn't help; halves recovered every word. So
  `transcribePieces` now retries a piece in halves when it gets under 0.5 words/s
  on 6 s or more (`functions/src/transcribeAudio.ts`). The extra requests are added
  to the daily count. **This retry is coded but not deployed yet.**
- Scored with `bakeoff/score.ts`: `groq-appsplit-plain` (no retry) 102 wrong misses;
  `groq-appsplit-retry` **8 wrong misses**, 22 of 23 caught (Silero pieces: 16).
  Waits from a home PC: 0.4–2.3 s, or about 3.4 s when a retry happens.

Stage 4 coded 2026-10-31. `combineSecondPass(live, whisper, protectedIdx)` in
`recitation.ts` returns `{ outcomes, rescued }`: a speech-graded miss (or a word
Apple never reached) takes Whisper's 'perfect' or 'close'; anything Apple passed and
every protected position stays as it was, so the second pass never adds a red.
Checks: scenarios 22–24 in `recitation.alignment.check.ts`. `bakeoff/score.ts` now
also scores `apple-voicememos+<engine>` with this function:

| Combined with Apple | Correct words marked wrong | Mistakes caught |
|---|---|---|
| Silero pieces (`groq-chunked-plain`) | 7 | 22 of 23 |
| App pieces, no retry | 4 | 22 of 23 |
| **App pieces + retry (what ships)** | **4** | **22 of 23** |

The 4 left: A "lamb", I "us" twice, H "who". The one let through is still F4
("prominent" for "preeminent"), forgiven by the grader. Whisper is graded with
Apple's learned slips for now; stage 6 separates them.

The collapse retry was **deployed 2026-10-31**.

Stage 5 coded 2026-10-31 (phone test pending: it needs the OTA). `runSecondPass(uri,
expected, live, protectedPos)` in `speechSecondPass.ts` cuts, sends, grades and
combines in one call.
- **Recall** (`useRecall.ts`): the function is warmed when Recall opens. The second pass
  runs once the run is finished and covers the last listening run, from the position
  where listening started to the end. Typed, hinted and tapped words are protected.
  It is skipped when a strike reset happened during that listening run, since the
  audio then holds a verse twice. It is also skipped when Apple left nothing red. The
  results screen says "Double-checking…" and holds the save buttons until it's done.
  If the audio hasn't arrived 2 s after finishing, or the call fails or passes 5 s,
  Apple's grade stays.
- **Guided check** (`GradedRecitation.tsx`): it warms when listening starts, then works
  the same way on the graded screen, with Continue held while checking.
- Only words still red change. A word tapped green during the check stays as tapped.
- Testers see a toast like "Double-check: 3 words fixed (2 pieces, 1.4 s)" or
  "Double-check unavailable". This replaces the stage 1 "Saved audio" toast.
- Only the last listening run is checked: Stop then start again, and the first
  part keeps Apple's grade. A run stopped part-way and left (partial credit) keeps
  Apple's grade.
- English only (`passageScript === 'latin'`), iPhone only, online only.
- Not live: Whisper corrects words only after you finish. The recording file is
  only written when listening stops, so mid-recitation corrections would need the
  "uploading pieces during the recitation" item under Later.

Stage 2 notes: `functions/src/transcribe.ts` exports `transcribePieces`; the app calls it
through `src/lib/speechSecondPass.ts` (`warmSecondPass()`, `transcribePieces()`,
5 s timeout, null on any failure). Choices made:
- **Warm-up is `{ warm: true }` on the same function,** not a separate one: a
  separate function would wake a different instance.
- **App Check is not enforced yet:** the app has no App Check (it needs App Attest in
  a new native build). Sign-in plus limits guard the key until then.
- **Limits** (in `transcribeUsage/{day}` and `.../users/{uid}`, admin-only): 1,800
  pieces/day overall (Groq free tier is 2,000), 300 pieces/day and 4 requests/minute
  per user, at most 16 pieces of 1.2 MB each, 9 MB per request. The limit check runs
  alongside the Groq calls so it adds no wait; a "no" cancels them.
- **Every limit or Groq failure answers `{ busy: true }`,** never an error, so the app
  quietly keeps Apple's grade. A 429 is retried once if retry-after is 1.5 s or less.
- Groq settings: `language=en`, `temperature=0`, no prompt. Not yet compared with
  `bakeoff/groq_chunked.py`.

## Goal

Make spoken Recall grade more accurately without losing live grading.

- **Apple stays live.** Words keep turning green or red as you speak, exactly as today.
- **After Stop, a second opinion.** The recording goes to Whisper (large-v3-turbo, hosted on Groq). A word stays missed only if **both** Apple and Whisper missed it.
- **Wait after Stop: about 1–1.5 s,** however long the recitation.

## Decisions already made (by the user)

- **Live grading is required.** Whisper can never replace Apple's live grade, only correct it after Stop.
- **Sending audio off the phone is OK.** If an offline mode is ever added, it simply skips the second pass.
- **No on-device Whisper.** A 626 MB+ download plus battery drain rules it out.
- **Plural/singular slips count as correct** (already built: `isPluralPair` in `src/lib/recitation.ts`).
- **Cost:** solo developer with no funding. Start on Groq's free tier and keep requests to a minimum.

## What the bake-off measured

11 real recitations (Isaiah 53, Romans 8:1–14, Ephesians 1:3–10, Colossians 1:15–20,
Galatians 5:22–23), with 23 planted mistakes and 2,069 correctly said words, all
graded by the app's real `gradeTranscript`.

| Setup | Correct words marked wrong | Mistakes caught | Wait after Stop |
|---|---|---|---|
| Apple (Voice Memos transcripts) | 23 | 22 of 23 | live |
| Groq, whole recording | 61–91 | 22 of 23 | 2–4 s |
| **Groq, ≤25 s pieces sent in parallel, no hint** | **16** | 22 of 23 | **0.6–1.4 s** |
| Groq pieces, hint guessed from timing | 32 | 22 of 23 | 0.6–1.5 s |
| **Apple + Groq pieces: missed only if both missed** | **7** | **22 of 23** | 0.6–1.4 s |

The one mistake every setup lets through is "prominent" for "preeminent". The grader's
2-letter tolerance forgives it, not the engine.

### Lessons the build must respect

1. **Never send a long recording whole.** Hosted Whisper skips ~30 s stretches of long
   audio. Cut it at pauses into pieces of **25 s or less**. Locally this used Silero VAD
   via `faster_whisper.vad.get_speech_timestamps` with `min_silence_duration_ms=300,
   speech_pad_ms=200, max_speech_duration_s=24`; see `bakeoff/groq_chunked.py`.
2. **Send the pieces at the same time,** so the wait is one piece's round trip, not the sum.
3. **Whisper's `prompt` means "text said BEFORE this audio".** Passing the words a piece
   covers makes Whisper skip them. If a hint is tried later, give each piece the verse
   text just before the live position at the moment that piece was recorded. Ship
   without a hint first: it measured best.
4. **The app's spoken titles and side notes were a test artifact.** Real recitations
   don't have them, but don't depend on that.

## Architecture

```
Recall (phone)                          Cloud Function             Groq
──────────────                          ──────────────             ────
Apple live grade (unchanged)
expo-speech-recognition with
  recordingOptions.persist = true
Stop ─► split audio at pauses (≤25 s) ─► transcribePieces ─────► whisper-large-v3-turbo
        upload pieces in parallel        (holds GROQ key,          (one request per piece)
                                          App Check + auth,
                                          per-user rate limit)
     ◄─ transcripts, in order ◄─────────
join ─► gradeTranscriptDetailed(passage, whisperText)
     ─► final[i] = missed only if live[i] missed AND whisper[i] missed
         (protected entries — typed, hints, tap-to-fix — never change)
```

### Where to cut the audio

Two options. Decide in stage 1.

- **On the phone:** no extra server CPU, and pieces can upload *during* the recitation
  (more on that below). Needs a small VAD or a simple energy-based pause finder in JS.
- **In the function:** simpler on the phone (one upload), but the function has to decode
  and run a VAD, which is slower to start up and costs more.

Recommended: **on the phone, using a simple pause finder** (quiet stretches of 300 ms or
more), with a hard cut at 24 s if no pause comes. Silero quality isn't needed for
choosing cut points.

### Wake-up delay

A 2nd-gen Cloud Function that has gone idle takes 1–4 s to start. **Call a tiny warm-up
endpoint when Recall opens.** That's free, and avoids paying for an always-on instance.

## Stages

1. **Saving audio.** Turn on `recordingOptions.persist` in `NativeSpeechRecognizer`
   (`src/lib/recitation.ts`) and confirm the file and format (m4a/wav, sample rate) on a
   real iPhone. Check `npx expo install --check` first (see memory: stale patch
   versions crash).
2. **Cloud Function `transcribePieces`.** In `functions/src/` (alongside `index.ts`,
   `social.ts`):
   - Key in Secret Manager (`defineSecret('GROQ_API_KEY')`), never in the app.
   - Require auth plus App Check; rate-limit per user.
   - Accept up to N pieces (base64 or Storage paths); call Groq in parallel; return
     texts in order.
   - Retry a 429 (free-tier limit, about 20 requests/min) once, then report "busy" so
     the app keeps the Apple grade.
   - Plus a no-op `warm` callable.
3. **Splitting on the phone.** Pause finder plus the 24 s hard cap. Unit-check it on the
   bake-off WAVs (`bakeoff/audio_clean/`).
4. **Combining the grades.** A pure function in `recitation.ts`, something like
   `combineSecondPass(liveOutcomes, whisperOutcomes, protectedIdx)`. Add checks to
   `recitation.alignment.check.ts` and score it with `bakeoff/score.ts` (expect about 7
   wrong misses, 22 of 23 caught).
5. **Recall wiring** (`src/components/practice/useRecall.ts`, and
   `GradedRecitation.tsx` for the guided check):
   - After Stop, show a "Double-checking…" state.
   - Apply the combined grade, and only to words graded by speech.
   - On timeout (about 5 s) or error, keep Apple's grade silently.
   - Strike resets during the run stay Apple-only, since they happen live.
6. **Per-engine learned slips.** Today `users/{uid}/settings/speechSlips` stores keys
   like `set>that` (`src/lib/speechSlips.ts`). Apple and Whisper mishear different
   words, so add the engine to the key (e.g. `apple:set>that`) **before** people build
   up many slips. Migrate existing keys as `apple:`.
7. **Privacy and settings.**
   - `PRIVACY.md`: audio for spoken Recall is sent to Groq for transcription and not
     kept by us. Check Groq's data-retention and training terms first and state them.
   - Optional Settings toggle: "Double-check spoken recitations online" (default on).

## Cost

- Groq whisper-large-v3-turbo: about **$0.04 per hour of audio** (check groq.com/pricing).
- Free tier: about 20 requests/min, reportedly about 8 h of audio/day.
- One recitation is about 1 request per 25 s of audio.
- **Only send recitations where Apple marked something red.** A clean run needs no
  second opinion. That probably cuts usage several-fold, and costs nothing in accuracy:
  the combined rule can only turn red words green, so a run with no red has nothing to
  change.

## Later, not now

- **Uploading pieces during the recitation.** Each finished piece goes to Groq while
  you keep speaking. Whisper's corrections could then appear a few seconds behind your
  voice, not just after Stop.
- **Retrying the hint correctly,** with the text before each piece taken from the live
  pointer.
- **Tightening near-miss tolerance** once Whisper grades the final result. Whisper needs
  far less leniency than Apple, and that would catch "prominent" for "preeminent".

## Re-running the bake-off

From the repo root; scripts live in `bakeoff/` with the Python env in `bakeoff/.venv`.

- `bakeoff/.venv/Scripts/python bakeoff/groq_chunked.py`: Groq in pieces. Needs
  `GROQ_API_KEY` in `bakeoff/.env`.
- `node bakeoff/run-score.cjs`: scores every engine in `bakeoff/results/` with the
  current grader.
