# Bible text importer

Standalone admin script (not part of the Expo app bundle) that populates Firestore's
`translations/{translationId}/books/{bookId}/chapters/{chapterNumber}` collection with
verse text, one chapter per document. The app reads from these collections at runtime via
`src/state/useScripture.ts`, which caches each fetched chapter locally in AsyncStorage.

## Why this exists / licensing

Neither this repo nor Claude generates or stores actual Bible verse text — the **ESV is
copyrighted by Crossway**, and even public-domain translations should come from a
legitimate source rather than being typed out from memory (accuracy risk, not just
licensing). This script is a pipeline, not a text source: you point it at a real,
authorized source via one of the adapters in `adapters/`, and it fetches + writes.

## Setup

```bash
cd scripts/import-bible
npm install
```

You'll need a Firebase service account key for a project with Firestore write access:
Firebase Console → Project Settings → Service Accounts → Generate new private key. Then:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json   # macOS/Linux
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"  # PowerShell
```

## Adapters

### `esv` — official Crossway ESV API
1. Sign up for a free API key: https://api.esv.org/account/create-application/
2. Review Crossway's current terms of use (display requirements, any usage caps) before
   running this against the full Bible.
3. `export ESV_API_KEY=your_key_here`
4. **Test on one chapter first**: `node run.js --adapter esv --book Obadiah` (1 chapter,
   quick to inspect). The verse-splitting logic in `adapters/esv.js` hasn't been verified
   against a live response — check the output looks right before running the full import.

### `localFile` — public-domain translations (BSB, KJV, WEB)
`bible-api.com`'s own terms say not to bulk-download an entire Bible through its live API,
so this adapter reads from a local dataset file instead — two real formats supported,
auto-detected by file extension, **both verified against real downloaded data** (Genesis 1 =
31 verses, Psalms 119 = 176 verses, spot-checked verse text) before being relied on:

**BSB** — USFX XML from eBible.org. **This is the app's default translation**
(`DEFAULT_TRANSLATION_ID` in `src/data.ts`), so this is the one import the app can't
run without. The Berean Standard Bible was placed in the public domain on 30 April
2023 — no licence, no attribution, no restrictions:

```bash
curl -sL -o bsb.zip https://ebible.org/Scriptures/engbsb_usfx.zip
unzip bsb.zip -d bsb
export LOCAL_BIBLE_JSON_PATH=/path/to/bsb/engbsb_usfx.xml
export LOCAL_BIBLE_TRANSLATION_ID=BSB
export LOCAL_BIBLE_TRANSLATION_NAME="Berean Standard Bible"
node run.js --adapter localFile
```

Verified against the real download before being relied on: 66 books, 1,189 chapters,
31,086 verses, Genesis 1 = 31, Psalms 119 = 176, John 3:16 spot-checked. The count is
31,086 rather than the KJV's 31,102 because the BSB follows the critical text and
omits sixteen disputed verses (Matthew 17:21, Mark 9:44/46, John 5:4, Acts 8:37 and
others). **Verse numbers therefore have real gaps** — anything that assumes a chapter
runs 1..n consecutively is wrong, here and in most modern translations.

**KJV** — scrollmapper's JSON (`.json`, book names use "I/II/III <Book>" and "Revelation of
John", normalized automatically):
```bash
curl -sL -o kjv.json https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/KJV.json
export LOCAL_BIBLE_JSON_PATH=/path/to/kjv.json
export LOCAL_BIBLE_TRANSLATION_ID=KJV
export LOCAL_BIBLE_TRANSLATION_NAME="King James Version"
node run.js --adapter localFile
```
(scrollmapper does NOT have the actual World English Bible — its "Webster"/"RWebster" entries
are Noah Webster's 1833 revision, a different public-domain translation. Don't confuse them.)

**WEB** — USFX XML (`.xml`) from the WEB's own publisher's distribution network:
```bash
curl -sL -o web.xml https://raw.githubusercontent.com/seven1m/open-bibles/master/eng-web.usfx.xml
export LOCAL_BIBLE_JSON_PATH=/path/to/web.xml
export LOCAL_BIBLE_TRANSLATION_ID=WEB
export LOCAL_BIBLE_TRANSLATION_NAME="World English Bible"
node run.js --adapter localFile
```

If a future dataset doesn't match either format, `LOCAL_BIBLE_FORMAT` (`usfx-xml` or
`scrollmapper-json`) forces detection, and `adapters/localFile.js`'s `parseUsfxXml`/
`parseScrollmapperJson` functions are the place to add a third format.

### `originalLanguages` — Hebrew/Greek (`HEBGRK`)

One translation id, two texts: Old Testament books from the **Westminster Leningrad
Codex** (public domain, via the Open Scriptures Hebrew Bible), New Testament books from
the **SBL Greek New Testament** (CC BY 4.0 — the app must show its credit line on NT
chapters). Decisions behind it are in `HEBREW_GREEK_PLAN.md` at the repo root.

```bash
mkdir -p sources && cd sources
curl -sSL -o morphhb.zip https://github.com/openscriptures/morphhb/archive/refs/heads/master.zip
curl -sSL -o sblgnt.zip https://github.com/LogosBible/SBLGNT/archive/refs/heads/master.zip
unzip -q morphhb.zip && unzip -q sblgnt.zip && cd ..
node verify-original-languages.js          # dry run -- writes nothing
node run.js --adapter originalLanguages
```

What the adapter does to the text, so it reads like a learner's Bible:
- **Hebrew keeps vowel points, drops cantillation accents** (and meteg/paseq). Maqaf and
  sof pasuq stay. Paragraph markers (פ/ס) go.
- **Ketiv/qere: the qere is stored.** OSHB gives the ketiv unpointed, which would put a
  bare consonantal word mid-verse; the qere is pointed and is what's read aloud.
- **English verse numbering.** OSHB's `VerseMap.xml` maps Hebrew to KJV numbers (Malachi
  3:19 → 4:1, etc.). Where the BSB follows the Hebrew instead (1 Kgs 18/20/22) the Hebrew
  break is kept; two mid-verse splits (Isa 63:19/64:1, Ps 13:5/6) are cut at hand-checked
  words.
- **Psalm superscriptions** that Hebrew numbers as their own verse(s) go into a separate
  `headings` field on the chapter document (63 chapters), not into verse 1. Short
  superscriptions that Hebrew prints *inside* verse 1 (e.g. Ps 23:1 מִזְמוֹר לְדָוִד) stay
  there — the source doesn't mark where they end.
- **Greek drops SBLGNT's apparatus signs** (⸀ ⸂ ⸃ …) and brackets, keeps accents. Four
  verse breaks are adjusted to the BSB's (Acts 19:40/41, 2 Cor 13:12-14, 3 John 14/15,
  Rev 12:17/18), and Mark's "shorter ending" is cut from 16:8 as the BSB footnotes it.

`verify-original-languages.js` compares every chapter's verse numbers with the BSB and
scans for stray characters. Expected result: 1,189 chapters, 0 unexpected characters, and
exactly two differences, both real textual ones — **Nehemiah 7:68** is absent from the
Hebrew, and **Romans 16** in SBLGNT has a v.24 and no doxology (BSB 16:25-27).
`--show "Psalms 51"` prints one chapter.

## Running

```bash
node run.js --adapter esv --book Genesis     # one book
node run.js --adapter esv                    # entire Bible (1,189 chapters — takes a while
                                              # at the built-in 350ms delay between requests;
                                              # adjust with --delay-ms)
```

Re-running is safe (each chapter write overwrites its own document; nothing accumulates).
