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

### `localFile` — public-domain translations (KJV, WEB)
`bible-api.com`'s own terms say not to bulk-download an entire Bible through its live API,
so this adapter reads from a local dataset file instead — two real formats supported,
auto-detected by file extension, **both verified against real downloaded data** (Genesis 1 =
31 verses, Psalms 119 = 176 verses, spot-checked verse text) before being relied on:

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

## Running

```bash
node run.js --adapter esv --book Genesis     # one book
node run.js --adapter esv                    # entire Bible (1,189 chapters — takes a while
                                              # at the built-in 350ms delay between requests;
                                              # adjust with --delay-ms)
```

Re-running is safe (each chapter write overwrites its own document; nothing accumulates).
