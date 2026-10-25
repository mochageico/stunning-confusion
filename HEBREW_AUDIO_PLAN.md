# Hebrew audio — build plan

A built-in Hebrew reading for the **Hebrew/Greek** translation's Old Testament.
It uses Abraham Shmuelof's reading of the whole Tanakh. Any verse in Hebrew can be
played, and Listen can play a passage through, even when the user has no
recording of their own.

**Status (2026-10-24):** Phases 0–1 and the app code are built. The download
was done and every sha1 matched. The full timing run is going (`work/align-run.log`).
Upload and rules deploy are not done yet. As built:
- `scripts/hebrew-audio/download.js` downloads the files and writes `sources/manifest.json`.
- `export-text.js` writes the WLC verses per audio file and the
  Hebrew→English verse map, taken from the importer itself.
- `align.py` uses Whisper turbo with VAD and caches each chapter's
  transcript in `work/whisper/`, so re-running only redoes the matching.
- `build-timings.js` writes `timings/{BOOK}_{ch}.json` plus `report.json`.
- `upload.js` uploads the MP3s and timings.
- App: `src/lib/libraryAudio.ts` (`resolveVerseAudio`) and
  `src/state/useLibraryAudio.ts`. The credit shows under the verse Play button
  and in Listen. Checks: `npm run check:libraryaudio`.
- Translation fix: `resolveChapterAudio` takes a translation id and never
  mixes Hebrew/Greek recordings with English ones.

Findings from the first chapters:
- Whisper skips ~20 s after a spoken title unless `vad_filter` is on.
- A free start for the alignment stops the title's "Bereshit" being taken for Gen 1:1.
- The reader occasionally skips a verse. In 1 Chr 2:51 his eye jumped between two
  lines ending "father of Kiriath-jearim". Such verses get no audio.
- Only two English verses span two files: Num 26:1 and 1 Sam 20:42. The longer
  part plays.

**Result of the full run (2026-10-24 evening):** 96% of words heard. Every
verse's clip was then transcribed on its own (`spot-check.py all`). A clip
holding under 40% of its verse's words gets no audio. That left **22,987 of
23,144 verses (99.3%) with audio**. The 157 without are the reader's real skips
(e.g. Josh 21:36, which his printed Bible lacks, and 1 Chr 2:51) plus clips
Whisper can't confirm. Most of those are short or name-heavy verses Whisper
can't make out alone, so some good audio is withheld on purpose: silence beats
the wrong verse.
- Verse cuts sit in the middle of the longest real pause near each join.
  Whisper's word times can run ~1 s early after a pause, which put Lev 24:1's
  start inside the spoken title.
- Next: `upload.js`, then deploy the firestore + storage rules, then test on a phone.

Greek is separate. It waits on permission from Eddy Lanz for his SBLGNT
reading; see the end of this file.

---

## The source

| | |
| --- | --- |
| Reader | Abraham Shmuelof |
| Where | archive.org item `HebBible_AShmuelof` (also eBible.org/multimedia/hbo) |
| Licence | **CC BY-NC-ND 4.0**: credit the reader, non-commercial use only, no changed versions |
| Files | 929 MP3s, one per **Hebrew** chapter, e.g. `hbofGen_01.mp3`, `hbofJol_04.mp3`. Obadiah is `hbofOba.mp3` (no chapter suffix). The MP3s are archive.org's originals; the OGGs are derived from them. |
| Size | ~70 hours, ~840 MB (~28 kbps mono, fine for speech) |
| Pronunciation | Modern Israeli. Whisper large-v3-turbo transcribes it almost word-perfect. |
| Divine name | Read as *Adonai* (אדוני) wherever the text has יְהוָה |
| Openings | Book and Torah-portion openings start with a spoken title, e.g. Genesis 1 opens with ~8 s of "five books of the Torah, the book of Genesis, the portion Bereshit". Other chapters start straight in. |
| Numbering | **Hebrew chapter numbers.** His Joel 3 is English Joel 2:28–32; Malachi has 3 files. |

**Why it's allowed:** Lev is free with no paid features (the user confirmed this
2026-10-24), so NC is satisfied. We still need the credit line wherever the audio
plays.

**What "no changed versions" means for us:**
- Host the MP3 files **byte-for-byte as downloaded** (check the sha1 against
  archive.org's metadata).
- No trimming, no denoising, no studio chain, no cutting into verse clips.
- Skip the spoken titles by **starting playback after them**, never by cutting
  them out.
- Playback speed is fine. Listen's speed control changes playback on the
  device, not the file. (So we don't need eBible's 20%-slower copy.)
- Verse timings are our own data about the file, not a change to it.

---

## Locked decisions

| Decision | Choice |
| --- | --- |
| Which translation | Only `HEBGRK`, only OT chapters |
| Priority | The user's own recording **in Hebrew** wins; otherwise the built-in reading plays |
| Hosting | Our Firebase Storage, `audioLibrary/shmuelof/{file}.mp3`, public read, `immutable` cache headers. Not hotlinked from archive.org: it's slow, and we'd have no control if it disappears. |
| Timing data | Per **English** verse. Each entry says which file it's in, because some English chapters span two Hebrew files. |
| Credit | "Hebrew audio: Abraham Shmuelof, CC BY-NC-ND 4.0", with a link to the licence. Shown under the player for Hebrew audio and on the translation's info/credits screen. Copy eBible's exact wording at import. |

---

## Phase 0: Download and check (script, no app changes)

`scripts/hebrew-audio/download.js`
1. Read archive.org metadata (`https://archive.org/metadata/HebBible_AShmuelof`).
2. Download the 929 MP3s into `scripts/hebrew-audio/sources/` (gitignored), and
   check each one's sha1.
3. Map each file to a book id and Hebrew chapter. Use the same OSIS book codes
   as `scripts/import-bible/adapters/originalLanguages.js`, plus the archive's
   own codes (`Jol`, `Ezk`, `Sng`…).
4. Check that every Hebrew chapter in the WLC has exactly one file.

Listen to ~10 spot checks to find out which printed Bible he read from. Whisper
suggests the Letteris text (Talking Bibles International). It should match the
WLC almost everywhere, and we store the qere, which is what he reads aloud. The
alignment step reports any verse where the words disagree.

## Phase 1: Verse timings (local script, reuses the bakeoff Whisper setup)

`scripts/hebrew-audio/align.py`, run with `bakeoff/.venv` on the GPU. 70 hours of
audio should take well under an hour.

1. **Get word times.** Use faster-whisper large-v3-turbo with
   `language="he"` and `word_timestamps=True`. Pass the chapter's text as the
   prompt, which got 0 wrong misses in the speech bake-off.
2. **Match words to our text.** Compare the WLC words in Hebrew numbering
   (`parseWlcBook`) with the transcript words. Match on the **bare
   consonants**, because Whisper writes Hebrew without vowels and in modern
   spelling (אלוהים vs אֱלֹהִים, so ignore ו/י spelling letters).
   - Treat יהוה as אדני.
   - Treat each maqaf-joined word as two words, the same as the app's splitter.
   - Use the same kind of word-by-word line-up as `recitation.ts`.
3. **Set verse boundaries.** Each Hebrew verse runs from its first matched
   word to its last. Move each boundary to the quietest point in the gap (he
   pauses between verses) so a clip never cuts off a word.
4. **Convert to English numbering** with OSHB's VerseMap. Export the mapping
   from `originalLanguages.js`; don't copy it.
   - For the two real mid-verse splits (Isa 63:19 into 64:1, Ps 13:6 into
     13:5/6), cut at the matched word given in `PARTIAL_SPLITS`.
   - Time Psalm superscriptions that were moved into `headings` as a heading
     segment, not as verse 1.
5. **Quality report.** Flag every verse with less than ~85% of its words
   matched, or a gap or overlap with the next verse, into
   `align-report.json`. Spot-check those by listening before upload.

Output: one JSON per **English** chapter:
```json
{ "book": "Joel", "chapter": 2, "credit": "...",
  "segments": [ { "verse": 28, "file": "hbofJol_03.mp3", "startSec": 0.0, "endSec": 15.7 } ],
  "heading": { "file": "...", "startSec": 0, "endSec": 4.2 } }
```

## Phase 2: Upload

`scripts/hebrew-audio/upload.js` (admin SDK, same pattern as the bible importer)
- MP3s go to Storage at `audioLibrary/shmuelof/`, `cacheControl: public,
  max-age=31536000, immutable`, `contentType: audio/mpeg`.
- Timing JSON goes to Firestore at `audioLibrary/shmuelof/chapters/{bookId}_{ch}`
  (English numbering).
- Rules: anyone signed in can read both; nobody can write from the client.
  Add these to `firestore.rules` and `storage.rules`, and **deploy them**.

Cost: ~0.85 GB stored is about $0.02/month. A typical chapter download is under
1 MB, and the existing audio cache means repeat listens are free.

## Phase 3: In the app

1. **One resolver for "what plays for this verse".** Add
   `resolveVerseAudio(book, chapter, verse, translationId)` in `src/lib/appData.ts`.
   It returns `{ url | storagePath, startSec, endSec, source: 'mine' | 'library' }`.
   - The user's recording comes first, through today's `resolveChapterAudio`.
   - **Fix while here:** `resolveChapterAudio` ignores translation today, so a
     BSB recording of Psalm 23 would play under Hebrew. For `HEBGRK`, only
     accept recordings whose `translation` is `HEBGRK`. Check what values
     `recordingTranslation` actually saves first.
   - Then the library timings for `HEBGRK` OT chapters.
2. **Load timings** with a `useHebrewAudio(book, chapter)` hook. It does one
   Firestore read per chapter and caches forever, like firestore-sourced text
   in `useScripture.ts`.
3. **VersePlayButton** uses the resolver. A library segment plays exactly like
   a tagged user recording.
4. **Listen** (`useListenPlayback.ts`) already gives each verse its own
   recording or segment, so a chapter spanning two files just works. Check
   that the gap between verses doesn't stutter when it switches files.
5. **Audio cache:** `audioCache.ts` is keyed by Storage path, and library
   files are immutable, so they cache the same way. Add a "Download Hebrew
   audio for this book" button later if wanted, not in v1.
6. **Credit line** under the player whenever `source === 'library'`, and on
   the credits screen.
7. **Web demo** (`?s=`): add a Hebrew chapter with library audio so it can be
   checked without signing in.

Checks: a `src/lib/hebrewAudio.check.ts` covering the resolver's priority rules and the
English↔Hebrew file lookup for Joel 2/3, Mal 3/4, Isa 64:1, Ps 13:5–6, and a
Psalm with a heading.

This can ship as an OTA update: no native modules, since expo-audio and
expo-file-system are already in.

---

## Greek (blocked)

Eddy Lanz has read the full NT from the **SBLGNT**, the same text we show
(`lanz.li/grnt/...`, one MP3 per chapter, e.g. `/grnt/ev/01-Mt-01.mp3`). His
site gives no licence and no contact page. **Nothing happens until he answers
in writing.** If he says yes, Greek reuses everything above: Whisper `language="el"`, compare words
without accents, and English and SBLGNT numbering already match apart from the four verse
fixes already in the importer. Whatever he allows (credit wording, changes,
hosting) gets written into this file.

Fallback if he says no or never answers: a pre-generated el-GR computer voice,
clearly labelled, modern pronunciation. That needs its own decision.
