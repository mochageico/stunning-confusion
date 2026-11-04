# BSB audio — build plan

A built-in English reading for the **BSB**, the app's default translation, so that
Listen, the verse Play button and **Coming up next** have something to play from
day one. Today a new user has no recordings, so Listen shows "No recordings for
these verses yet" and Coming up next plays nothing. The feature we most want to
market is silent until the user records verses they haven't learned yet.

Written 2026-11-03, after a market review of scripture memory apps. Nothing here
is built yet. Run the stages in order; each is one session.

**For the session building a stage:** read this whole file first, then
`HEBREW_AUDIO_PLAN.md`, because nearly all of this reuses that pipeline. Stage
files by name when committing (never `git add -A`). After each stage, update the
**Progress** line and add an "As built" note under the stage.

**Progress:** stages 0–1 done 2026-11-03 (48 kbps chosen). Stage 0
found that Souer does **not** read section headings or cross-references, so
stages 1–2 are simpler than written; see stage 0's "As built".

---

## Why this is mostly done already

The Hebrew reading built the whole path, and an English reader slots into it:

- `src/lib/libraryAudio.ts` dresses a built-in reading up as a `Recording`, and
  `resolveVerseAudio` already layers it under the user's own recordings.
- `useListenPlayback.ts` already resolves every verse in Listen through
  `resolveVerseAudio`, so **Coming up next, Learning now, Review and playlists
  all pick it up with no changes**.
- `VersePlayButton`, `ChapterLandingScreen` (the narration picker) and
  `ChapterLibraryPlayer` already handle a built-in reading.
- `firestore.rules` and `storage.rules` already allow public reads of
  `audioLibrary/{readerId}/…` for **any** reader id, so a new reader needs no
  rules change. (Check that the Hebrew rules were deployed. If not, deploying
  them is a step to ask the user about, as always.)
- `scripts/hebrew-audio/` has the download, Whisper alignment, quality check,
  timings build and upload scripts to copy from.

What's Hebrew-specific today: one hard-coded `LIBRARY_READER`, `hasLibraryAudio`
only says yes for `HEBGRK` OT, the cache prefix, the Firestore path, and the
labels "Hebrew reading · …" and "Built in · Hebrew".

---

## The source

| | |
| --- | --- |
| Readers | Bob Souer, Barry Hays, Jordan Gilbert (human). openbible.com also hosts Arabella, David, Sophia and Frederick Surrey readings, which are probably synthetic voices, plus "music" versions with a background track. |
| Licence | **CC0 1.0 (public domain).** bereanbible.com/audio: "These audio versions of God's Word have been dedicated to the public domain (CC0 1.0)". The text has been public domain since 2023-04-30. No credit is required, but we give one anyway. |
| Where | `https://openbible.com/audio/souer/` (and `/hays/`, `/gilbert/`). Each chapter is one MP3, `BSB_{NN}_{Book}_{CCC}.mp3`, e.g. `BSB_01_Gen_001.mp3`, `BSB_19_Psa_119.mp3`, `BSB_43_Jhn_001.mp3`. Also `BSB_00_Souer_OT.zip` (4.2 GB) and `BSB_00_Souer_NT.zip` (921 MB). |
| Size | Souer: 5.50 GB, 69.2 hours. Already mono, 44.1 kHz CBR: the OT at 192 kbps, the NT at 128 kbps (measured in stage 0). |
| Numbering | English, the same as our BSB import (`scripts/import-bible/engbsb_usfx.xml`). No Hebrew-style file splits. |
| Spoken extras | **Stage 0 result:** every file opens with a spoken chapter title ("Genesis 1.", "Matthew chapter 1.", just "Philemon" for one-chapter books), and Psalm titles are read straight after it. Section headings, cross-references and Psalm 119's stanza names are **not** read (10 chapters checked). The note below is the original assumption. ~~**Souer reads the section headings and the Psalm titles** (user, 2026-11-03).~~ Our BSB text has neither: `parseUsfx` in `import-bible/adapters/localFile.js` keeps only what sits between `<v>` and `<ve />`, so the `<s>` headings, the `<d>` Psalm titles and the `<p style="r">` cross-references are dropped. The aligner must still know their words, or it will try to match them to verses (stage 1). Still to hear in stage 0: whether each file opens with a spoken "Genesis chapter 1", and whether cross-references like "(2 Samuel 15:13–29)" are read. |

**What CC0 lets us do that Shmuelof's licence didn't:** re-encode the files
smaller, trim spoken titles, and normalise loudness. We may also cut verse clips,
but we won't: one file per chapter plus timings is how the app already works.

**Not hotlinked** from openbible.com, for the same reasons as the Hebrew reading:
speed, and control if the files move.

---

## Decisions

| Question | Decision |
| --- | --- |
| Which reader | **Bob Souer** (user, 2026-11-03): the best known, a professional narrator, and the reading Bible Hub and YouVersion lead with. Hays and Gilbert can follow as a choice later. |
| File size | Re-encode to **mono MP3, 48 kbps, 24 kHz**, picked by ear from the stage 0 samples (user, 2026-11-03). That's about 1.5 GB for the whole Bible, a quarter of the original. Keep MP3: every player the app uses handles it. |
| Can the user turn it off? | **No switch** (user, 2026-11-03). The chapter page's narration list already lets the user pick what plays, and their own recordings already win wherever they cover a verse. |
| Other translations | Later, one at a time; see **Later**. CSB, NASB and NLT have no free audio we know of. |

---

## Locked decisions (carried over from the Hebrew reading)

| Decision | Choice |
| --- | --- |
| Priority | The user's own recordings (in the same translation) first, then the built-in reading, then nothing. This is `resolveVerseAudio`'s existing layering. |
| Hosting | Firebase Storage, `audioLibrary/souer/{file}.mp3`, public read, `cacheControl: public, max-age=31536000, immutable`. |
| Timings | Firestore `audioLibrary/souer/chapters/{BOOKID}_{ch}`, the same `LibraryChapterTimings` shape. One doc per chapter, cached on the device forever. |
| Bad clips | **Silence beats the wrong verse.** A verse whose clip can't be confirmed gets no audio. |
| Credit | "BSB read by Bob Souer · public domain (CC0)", shown wherever built-in audio plays, plus on the credits screen. |

---

## Stage 0: Download and inspect (script only)

`scripts/bsb-audio/download.js`, modelled on `scripts/hebrew-audio/download.js`.
Keep `sources/` and `work/` gitignored, like the Hebrew folders.

1. Download the 1,189 chapter files one by one (resumable, skip any already
   present) rather than the 5 GB zips, so a failed run only costs one file.
2. Map `BSB_{NN}_{Book}_{CCC}` to the app's book id and chapter with
   `scripts/import-bible/books.js`. Check that every chapter in our BSB has
   exactly one file, and list any extra or missing files.
3. Write `sources/manifest.json` (file, book id, chapter, bytes, duration).
4. **Listen to about 10 spot checks:** Genesis 1, Psalm 3 (a superscription),
   Psalm 119 (Hebrew-letter stanza headings), Matthew 1 (a list of names),
   John 1, Romans 8 and Philemon. For each, write down whether there's a spoken
   chapter title, whether the section headings are read, and how long the pause
   between verses is.
5. Re-encode three chapters at 32, 48 and 64 kbps mono and pick one by ear.

### As built (2026-11-03)

- `scripts/bsb-audio/files.js` maps file names to book ids. The `NN` prefix is
  the book's place in `ALL_BIBLE_BOOKS`, so no name table is needed.
  `download.js` reads the file list from the openbible.com directory page. It
  checks each file against its Content-Length and walks its MP3 frames, since
  the site publishes no checksums. It writes to `*.part` and renames, so a
  re-run skips only whole files. `sources/` and `work/` are in
  `scripts/bsb-audio/.gitignore`.
- **All 1,189 files downloaded.** Every chapter in `engbsb_usfx.xml` has exactly
  one file, with none missing and none extra. 5.50 GB, 69.2 hours. The shortest
  is Psalm 117 (17 s), the longest Psalm 119 (14 min 31 s). All are mono 44.1 kHz
  CBR: the 929 OT files at 192 kbps, the 260 NT files at 128 kbps.
  `sources/manifest.json` holds name, bookId, chapter, bytes, seconds, kbps.
- **Spot checks** (`inspect.py`, Whisper with the same VAD settings as
  `align.py`; report in `work/inspect/report.md`). Checked: Genesis 1, Psalms 3,
  23 and 119, Matthew 1, John 1, Romans 8, Philemon, 1 Chronicles 1 and
  Isaiah 53.
  - **Spoken chapter title: yes, in every file**, about 1.5–2.6 s in. It's said
    as "Genesis 1." / "Isaiah chapter 53." / "Philemon".
  - **Psalm titles (`<d>`): read**, right after the chapter title ("Psalm 3, a
    psalm of David, when he fled from his son Absalom."). Our text has a typo
    here, "A Psalms of David", so match the title loosely.
  - **Section headings (`<s>`) and cross-references: not read**, in any of the
    10 chapters. This contradicts the 2026-11-03 assumption. Checked by phrase
    against the transcript, net of the same words in the verse text. To hear it
    yourself, listen to Genesis 1 at 0:18, where "The First Day" would fall
    before verse 3: there's only a 0.7 s pause.
  - **Psalm 119's stanza names** ("ALEPH", "BETH") are `<p style="qa">` in the
    USFX, not `<s>` headings, and Souer doesn't read them.
  - "Selah" is read, and it's part of our verse text.
  - **Pauses:** 0.5 s or more at only some verse joins (median 0.64 s, 90th
    percentile 1.1 s, longest 1.9 s). Many joins run on with under 0.5 s, so
    verse boundaries must come from matched words, not pauses. That's stage 2's
    plan already.
  - Without VAD, Whisper skipped John 1:1–5 and invented "2 Chronicles 1" over
    1 Chronicles 1's opening list. With VAD, both transcribe cleanly. Keep
    `vad_filter` in stage 2.
- **What this changes downstream:** stage 1 needs no `<s>` headings, only each
  chapter's spoken title (book name + number) and the Psalm title. Stage 2
  lines up [chapter title, Psalm title, v1, v2, …]. Stage 2's boundary rule
  (end after the verse's own last word) still applies, but it's no longer
  guarding against headings mid-chapter.
- **Bitrate samples** (`encode-samples.py`, PyAV's bundled libmp3lame, so no
  ffmpeg install needed; ffmpeg isn't on this PC). Genesis 1, Psalm 23 and
  Romans 8 at 32, 48 and 64 kbps, mono 24 kHz, are in `work/samples/` next to
  the originals. Durations came out within 20 ms of the original. Whole-Bible
  size would be about 1.0 GB at 32 kbps, 1.5 GB at 48 and 2.0 GB at 64.
  **The user picked 48 kbps** (2026-11-03). In stage 4, also check that the
  encoder's start delay (LAME pads ~50 ms) doesn't shift speech against the
  timings, not just the total duration.

## Stage 1: Text for alignment

`scripts/bsb-audio/export-text.js`: write `work/text.json`, the BSB verses of
every chapter **as the app stores them**. Use the same adapter
(`import-bible/adapters/localFile.js` on `engbsb_usfx.xml`) so the text can't
drift from what users see.

Because Souer reads headings and Psalm titles that our text leaves out, also
pull from the same USFX file each chapter's `<s>` section headings and `<d>`
Psalm title, with the verse each comes before. Stage 2 uses them to recognise
speech that belongs to no verse. Psalm 119's stanza headings ("Aleph", "Beth",
…) are `<s>` headings too.

### As built (2026-11-03)

Stage 0 showed the headings aren't read, so the export is simpler than written
above. `node scripts/bsb-audio/export-text.js` writes `work/text.json` (4.6 MB,
gitignored), keyed `GEN_1`:

```json
{ "file": "BSB_19_Psa_003.mp3", "titles": ["Psalm 3"],
  "psalmTitle": "A Psalms of David, when he fled from his son Absalom.",
  "verses": [{ "v": 1, "text": "O LORD, how my foes have increased! …" }] }
```

- **verses** come from `localFile.js`'s `fetchChapter` on `engbsb_usfx.xml`, the
  importer's own path, so they're exactly what the app stores: 1,189 chapters,
  31,086 verses, none empty. The 16 verses the BSB omits (Matthew 17:21,
  Mark 9:44 and 9:46, Acts 8:37, …) are simply absent, so a chapter's verse
  numbers can skip.
- **titles** lists the spoken chapter title's accepted forms: "Genesis 1" /
  "Genesis chapter 1"; "Psalm 23" (Psalm 1 also "Psalms Psalm 1", as heard);
  and the bare book name for the one-chapter books. Stage 2 should treat the
  title as optional, and not fail a chapter whose title is said some other way.
- **psalmTitle** is the `<d>` before verse 1: 116 Psalms have one, 34 don't
  (Psalm 1, 2, 119, …). It's cleaned by the adapter's own
  `stripFootnotesAndTags`, newly exported as `localFile._internal`. Our text's
  typo "A Psalms of David" in Psalm 3 is kept, since this is what we match
  against. Match loosely.
- **Left out, as not read** (each checked by transcript): `<s>` section
  headings, cross-references (`r`), Psalm 119's stanza names (`qa`, not `<s>`),
  and the Psalms book divisions (`ms1` "BOOK I" + `mr` "Psalms 1—41", at
  Psalms 1, 42, 73, 90 and 107).
- **Already in the verses:** the 16 `pc` inscriptions ("THE KING OF THE JEWS",
  "MENE, MENE, TEKEL, PARSIN"), which sit inside their verse. Zechariah 12's
  `<d>` holds the verse 1 marker, so it's verse text (read once, as verse 1's
  opening) and not a title.
- So stage 2's reading order per chapter is: title, then the Psalm title (if
  any), then the verses in order. Nothing is spoken mid-chapter outside a verse.

## Stage 2: Verse timings (verses, headings and Psalm titles)

`scripts/bsb-audio/align.py`, a copy of `hebrew-audio/align.py` adapted for
English. Run it with `bakeoff/.venv` on the GPU.

1. faster-whisper large-v3-turbo, `language="en"`, `word_timestamps=True`, with
   the chapter text as the prompt. Cache each chapter's transcript in
   `work/whisper/` so re-runs only redo the matching.
2. **Match words** with the same kind of line-up as `recitation.ts`, comparing
   normalised words: lower case, no punctuation, curly quotes and dashes
   folded. Whisper writes some numbers as digits ("12" for "twelve"), so map
   digits to words before matching. Treat "LORD" as "lord".
3. **Line the transcript up against verses *and* headings**, in reading
   order: Psalm title, then verse 1, …, with each `<s>` heading where it falls.
   Matching headings explicitly stops their words being pulled into the
   neighbouring verse, which an unmatched gap wouldn't guarantee.
4. **Verse boundaries: this is the one real difference from Hebrew.** The
   Hebrew rule was "the middle of the longest pause near the join". Here that
   pause often holds a spoken heading, which would land inside a verse's clip.
   So:
   - a verse ends just after its own last matched word (plus about 0.15 s, or
     the quietest point before the next speech, whichever comes first);
   - a verse starts just before its own first matched word;
   - headings, Psalm titles and any spoken chapter title fall between clips
     and belong to no verse. This skips them with no trimming.
5. Keep the Psalm title's span as `headings["1"]` in the timings doc, the same
   field the Hebrew build writes, even though nothing plays it yet (the BSB
   text the app shows has no Psalm titles).
6. Write `work/align/{BOOK}_{ch}.json`.

## Stage 3: Quality check

Copy `spot-check.py` and `build-timings.js`:

- Transcribe every verse's clip on its own. **A clip holding under 40% of its
  verse's words gets no audio**, the same threshold as Hebrew.
- Flag seconds-per-word outliers and gaps or overlaps in `timings/report.json`,
  and listen to the flagged clips before upload.
- English should do far better than Hebrew's 99.3%, since Whisper is strongest
  in English. Expect trouble in the name lists (1 Chronicles 1–9, Matthew 1,
  Luke 3), as the speech bake-off found with proper nouns. They can go without
  audio.
- Write `timings/{BOOKID}_{ch}.json`.

## Stage 4: Re-encode and upload

`scripts/bsb-audio/upload.js`, a copy of `hebrew-audio/upload.js` with
`READER = 'souer'`:

1. Re-encode each file (mono, 48 kbps, 24 kHz, as chosen in stage 0; PyAV
   as in `encode-samples.py`, since ffmpeg isn't installed; plus a
   loudness normalisation pass so chapters play at the same volume). Re-encoding
   doesn't move speech, but run a quick check that the duration is unchanged
   within 50 ms, so the timings still fit.
2. Upload the MP3s to Storage at `audioLibrary/souer/` with immutable cache
   headers. Skip files already uploaded with the same md5, so the script is safe
   to re-run.
3. Upload the timings to Firestore at `audioLibrary/souer/chapters/`, and the
   reader doc `audioLibrary/souer` (name, credit, licence URL).

Cost: storage is small (roughly 1.5–2 GB after re-encoding). Downloads are the
cost that grows with users, at about 1–2 MB per chapter, and only on the first
play: `audioCache.ts` keeps the file after that. Check it against the
project's Storage pricing before a public launch.

## Stage 5: In the app

1. **A reader per translation.** In `libraryAudio.ts`, replace `LIBRARY_READER`
   with a small registry:
   ```ts
   export const LIBRARY_READERS = {
     shmuelof: { translation: 'HEBGRK', testament: 'ot', name: 'Abraham Shmuelof', label: 'Hebrew reading', credit: '…', licenseUrl: '…' },
     souer: { translation: 'BSB', name: 'Bob Souer', label: 'BSB reading', credit: 'BSB read by Bob Souer · public domain (CC0)', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
   };
   export function libraryReaderFor(translationId, bookName): LibraryReader | null
   ```
   `hasLibraryAudio` becomes `!!libraryReaderFor(…)`. `libraryRecording` takes
   the reader and sets `translation`, `title`, `user` and the storage path from
   it.
2. **Namespace the timings key by reader.** Today `libraryTimingsKey` returns
   `PSA_23` for Hebrew, and BSB Psalm 23 would get the same key, so
   `useLibraryTimings`'s map and in-memory cache would mix them up. Make it
   `souer/PSA_23` and `shmuelof/PSA_23`, and have `loadTimings` split the
   reader off the key for the Firestore path. Keep the Hebrew AsyncStorage
   prefix (`library-audio:v1:shmuelof:`) so Hebrew timings already cached on
   phones stay valid.
3. **Labels and credit:** `ChapterLandingScreen.tsx` (~line 592: "Hebrew
   reading · …", "Built in · Hebrew"), `ChapterLibraryPlayer.tsx` (title),
   `VersePlayButton.tsx` (`LibraryCredit`) and `ListenPanel.tsx` (~line 524) all
   read the reader from the recording (its id carries the reader:
   `library_{readerId}_{file}`) instead of the constant.
4. **Checks** in `src/lib/libraryAudio.check.ts`:
   - BSB has a reader in both testaments, WEB and KJV have none, and HEBGRK's NT
     still has none;
   - the BSB and Hebrew keys for Psalm 23 differ;
   - a user's BSB recording of verse 1 beats the built-in reading, and the
     built-in reading still fills verse 2;
   - a Hebrew recording never plays under BSB, or the other way round.
5. **Web demo:** add a BSB chapter with built-in audio to the `?s=` demo data
   so Listen and Coming up next can be checked without signing in.

No native code, so this ships as an OTA update after the stage 4 upload.

## Stage 6: Make it visible

This is the point of the work: the market review found that a feature people
can't see on day one doesn't sell the app.

- **Listen's empty state** (`ListenPanel.tsx`, "No recordings for these verses
  yet") should now only appear for translations with no reading. Reword it for
  them ("No audio for {translation} yet. Record your own on the Record tab.").
- **Coming up next** is the feature to show off. With audio now there for
  every BSB user, give it a one-time tip (`OneTimeTip`) the first time someone
  has waiting verses: "Hear your next verses before you start learning them".
  Check the copy against the banned-jargon list (no "priming", "queue" …).
- **First run:** after onboarding adds the first verses, offer a play button
  for them right away, so a new user hears Scripture in the first minute.
- **App Store listing:** "Listen to any BSB chapter, read by Bob Souer" is a
  concrete line for the description and screenshots.

Check on a phone: built-in audio plays in Listen with the screen locked, and
Coming up next plays a mix of the user's recordings and built-in audio with no
stutter at the switch.

---

## Later

- Let the user choose a reader (Souer, Hays, Gilbert): a picker on the chapter
  page's narration list, remembered per translation.
- "Download this book's audio" for offline use, through `useAudioDownloads`.

Once the registry in stage 5 exists, another translation is mostly a re-run of
stages 0–4 with a new reader id. Two candidates were checked on 2026-11-03:

### KJV: "David" on Bible Hub (blocked on a licence answer)

- Bible Hub's KJV audio pages list three readings: "David", "Musical Bible" and
  "Sophia". The user knows the first as **David Elias**, but no page found
  gives a surname, and no search confirms it.
- The files are at `openbible.com/audio/kjv/`: one MP3 per chapter
  (`KJV_01_Gen_001.mp3`, `KJV_19_Psa_023.mp3`, `KJV_43_Jhn_001.mp3`), plus
  `KJV_00_Chapters.zip` (7.3 GB).
- **There's no licence statement for the KJV audio.** The CC0 line on Bible
  Hub and bereanbible.com is about the BSB recordings. The KJV text is public
  domain, but that doesn't cover a recording of it.
- Some of Bible Hub's single-name readers (Arabella, Sophia, Frederick Surrey)
  look like synthetic voices. Find out whether "David" is a person.
- **Nothing happens until Bible Hub / openbible.com confirm in writing** the
  reader's name, the licence (ideally CC0, like the BSB), and the credit they
  want. Record the answer here, as the Hebrew plan does for Greek.

### WEB: Winfred W. Henson (public domain, whole Bible)

- eBible.org's `eng-web/audio/` is "an audio recording of the World English
  Bible by Winfred W. Henson". It covers all 66 books, in per-book folders
  (`01_Genesis/`, `43_John/`), with the whole Bible in `eng-web_audio.zip`.
- Licence: "you may download, copy, and listen to this recording of the Holy
  Bible freely", and the WEB "is in the Public Domain and has no copyright
  restrictions". Give the credit "WEB read by Winfred W. Henson · public
  domain" anyway.
- **The edition matches:** `eng-web` is the classic WEB, which uses "Yahweh",
  and so does our import (`scripts/import-bible/web.xml` has 5,987 "Yahweh").
  The recording may predate later small text revisions. Stage 3's clip check
  will withhold any verse whose words don't match.
- Other WEB sets exist but are partial: Michael Paul Johnson and volunteers
  (`ebible.org/webaudio/`, Psalms plus most of the NT), Faith Comes by Hearing
  (NT only) and LibriVox volunteers (mixed voices). Henson is the only
  complete single-reader set found.
- Stage 0 still applies: listen for spoken titles and headings, and check the
  file naming inside the book folders.
