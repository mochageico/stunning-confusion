# Speech second pass (Groq Whisper after Stop): plan

Status: **planned, not built.** Research done 2026-10-24 in the speech bake-off
(scripts and data in `bakeoff/`, local only; gitignored).

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
