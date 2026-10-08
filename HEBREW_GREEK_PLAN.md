# Hebrew/Greek — build plan

One new option in the translation picker. Old Testament chapters open in
Hebrew (Westminster Leningrad Codex), New Testament chapters open in Greek
(SBLGNT). To the user it is a single translation; behind the scenes it is two
source texts under one translation id.

---

## Locked decisions

| Decision | Choice |
| --- | --- |
| Picker label | **Hebrew/Greek** (full name: "Original languages (WLC + SBLGNT)") |
| Internal id | `HEBGRK` — no `/` or `_` (both break Firestore paths / queue item ids) |
| Hebrew source | Westminster Leningrad Codex — public domain |
| Greek source | SBLGNT — CC BY 4.0, credit line required on NT chapters |
| Hebrew NT / other Greek texts | No. OT is Hebrew, NT is Greek, full stop. |
| Verse numbering | **English numbering.** Hebrew is renumbered at import so Malachi 4:1 is the same verse in every translation and the book picker's chapter counts stay right. |
| Hebrew marks shown | **Vowels only** — vowel points kept, cantillation accents stripped |
| Maqaf (־) | **Separate words** — אֶל־הָאָרֶץ is two words, each with its own hint/tile |
| First-letter hint | Bare consonant for Hebrew (no vowel); bare lowercase letter for Greek (Ἐν → ε) |
| Typing mode | **Strict** — exact letter only. Final forms count as their regular letter (ך=כ, ς=σ). No near-key forgiveness yet. |
| Speech recitation | **Hidden** for this translation |
| Saved verses | **Separate items** — Psalm 23 in BSB and in Hebrew each get their own schedule (already how ids work) |
| UI language | **English** — only the verse text changes; book names, buttons and references stay English |

---

## What already exists that this builds on

- **Translation registry** — `BIBLE_TRANSLATIONS` in `src/data.ts:171`. The new
  entry is `source: 'firestore'`, `isPublicDomain: true`, `capabilities: UNRESTRICTED`.
- **Chapter storage** — `translations/{id}/books/{bookId}/chapters/{n}`, read by
  `src/state/useScripture.ts`, cached forever for firestore-sourced text.
  `firestore.rules:346` already allows any translation id.
- **Importer** — `scripts/import-bible/run.js` with adapters in
  `scripts/import-bible/adapters/`. Handles one source file per translation today.
- **Queue item ids** — `` `${translationId}_${bookId}_${chapter}_${verse}` ``
  (`src/state/useAppState.ts:171`). This is why saved verses are per-translation
  and why the id can't contain `_`.
- **Pure-logic check scripts** — `scripts/run-*-check.cjs` + `src/lib/*.check.ts`.
  The new word-handling logic gets one of these.
- **Fonts** — `APP_FONTS` in `src/components/design.tsx:141`, loaded with
  `useFonts` in `App.tsx`. Fonts are JS assets: **no native rebuild needed**,
  this can ship as an OTA update.

## What breaks today (why this isn't just "add a row")

Every practice mode assumes English letters:

- `normalizeToken` (`src/lib/recitation.ts:56`) keeps only `a–z0–9`. Every
  Hebrew or Greek word normalizes to `""`, and the drills treat a word that
  normalizes to `""` as punctuation — so Hebrew would silently have **zero
  counted words**: no hints, nothing to type, scoring meaningless.
- `firstLetterOnly` (`recitation.ts:73`) searches for `[a-zA-Z0-9]`, so the
  memory grid would show whole words.
- Verse text is split into words with `.split(/\s+/)` in ~14 places, none of
  which know about maqaf.
- Word-tile layouts (`flexWrap` rows) run left-to-right.

---

## Phase 0 — Import the text (gates everything)

**Status (2026-10-07): adapter built and verified dry; Firestore write not yet run.**
`scripts/import-bible/adapters/originalLanguages.js` + `verify-original-languages.js`;
full write-up in `scripts/import-bible/README.md`. Result: 1,189 chapters, 31,083
verses, zero stray characters, verse numbers identical to the BSB except two real
textual differences (Neh 7:68 absent in Hebrew; SBLGNT Romans 16 has v.24 and no
doxology). Where it differs from the steps below:
- **Ketiv/qere:** OSHB gives the ketiv *unpointed*, so "ketiv consonants with qere
  vowels" isn't available. The qere (fully pointed, what's read aloud) is stored.
- **Partial verses:** cut at hand-checked words, not the atnah — in the Psalms the
  atnah isn't the main divider. The BSB follows the Hebrew break in 1 Kgs 18/20/22,
  so those stay whole.
- **Psalm headings:** only superscriptions the Hebrew numbers as a separate verse are
  pulled into `headings` (63 chapters). Short ones printed inside Hebrew verse 1
  (Ps 23:1 מִזְמוֹר לְדָוִד) stay in verse 1 — nothing marks where they end.
- **Greek:** also drops ⟦ ⟧ and apparatus digits (⸀1), cuts Mark's shorter ending from
  16:8, and adjusts four verse breaks to the BSB's.

1. **Hebrew source file.** Use the OSHB's WLC (github.com/openscriptures/morphhb,
   OSIS XML). Text is public domain; we don't use their morphology, so no
   credit line is required (add a courtesy one anyway).
2. **Greek source file.** SBLGNT plain text (github.com/LogosBible/SBLGNT).
   Confirm the licence is still CC BY 4.0 on the day of import and copy the
   exact credit line they require.
3. **New adapter** `adapters/originalLanguages.js`: reads both files, writes all
   66 books under `translations/HEBGRK`. OT books from the WLC, NT from SBLGNT.
4. **Text cleanup at import** (stored text = displayed text; do the work once):
   - Hebrew: strip cantillation accents (U+0591–U+05AF), and meteg (U+05BD).
     Keep vowel points, maqaf (U+05BE), sof pasuq (׃).
   - Hebrew: drop paragraph markers (פ / ס) and any bracketed qere notes. Show
     the text as printed in BHS (ketiv consonants with qere vowels).
   - Greek: strip SBLGNT's critical-apparatus signs (⸀ ⸁ ⸂ ⸃ ⸄ ⸅ and similar).
     Keep accents and breathing marks.
5. **Versification remap** (Hebrew → English numbering). Use a published
   mapping table (Paratext's `org.vrs` / `eng.vrs` mapping files) rather than
   hand-writing one. Known shifts: Malachi 3:19–24 → 4:1–6, Joel 3→2:28–32 and
   4→3, Psalm superscriptions, parts of Genesis 31–32, Exodus 7–8, Numbers
   16–17, 1 Kings 4–5, Isaiah 8–9, Jeremiah 8–9, Daniel 3–5, Hosea, Jonah 1–2,
   Micah, Nehemiah, Ecclesiastes, Song of Songs.
   - **Psalm headings:** where the heading is Hebrew verse 1, store it as a
     separate `heading` field, not as part of English verse 1. The BSB doesn't
     make headings a memorizable verse either, and a heading glued onto
     verse 1 would be memorization noise. (Showing the heading is a later
     nicety.)
6. **NT versification** is almost identical to English; spot-check the
   handful of known edge cases (3 John 14–15, Rev 12:18, 2 Cor 13:12–14,
   Rom 16:25–27, Acts 19:40–41). SBLGNT omits the same disputed verses the BSB
   does, and the app already handles gaps.
7. **Verify before relying on it**, same bar as the BSB import: book/chapter/verse
   counts, Genesis 1 = 31, Malachi has 4 chapters with 4:1 present, Psalm 3:1
   has no heading glued on, John 3:16 spot-checked, no stray apparatus signs
   (grep the output for U+2E00–U+2E0F), no accents left in Hebrew.

## Phase 1 — Registry and plumbing

**Status (2026-10-08): done except step 5 (speech gate).** The text is in Firestore —
Romans 8 loads in Greek with the SBLGNT credit on web demo mode. The entry is
`inDevelopment: true`: it shows in pickers in dev builds only, never TestFlight,
until phases 2–3 land. Flip it off then. Step 5 lives in `PracticeModals.tsx`, which
had another session's uncommitted work at the time — fold it into Phase 2, which
edits that file anyway. Pickers use `PICKER_TRANSLATIONS` + `translationLabel()`;
`AudioFeedScreen`'s translation filter still shows raw ids (also left for a quieter
moment).

1. Add the `HEBGRK` entry to `BIBLE_TRANSLATIONS` (`src/data.ts`), after the
   public-domain English ones.
2. New optional field `shortLabel` on `BibleTranslation` (`src/types.ts:40`)
   — the pickers show `t.id` today (`ChapterLandingScreen.tsx:250`,
   `RecordScreen.tsx:18`); switch them to `t.shortLabel ?? t.id`. Same for places
   that print a recording's `translation` string.
3. New helper `textScriptFor(translationId, bookName): 'latin' | 'hebrew' | 'greek'`
   — `HEBGRK` + OT book → hebrew, + NT book → greek, everything else latin.
   This one function is what every later phase keys off.
4. Attribution becomes per-book: `copyrightFor` gains a book argument so the
   SBLGNT credit line appears on NT chapters only.
5. Hide speech recitation when the script isn't latin (the `speechAvailable`
   gate in `PracticeModals.tsx:1186`). Audio *recording* stays — reading
   Hebrew aloud and recording it is still useful.
6. Update `src/lib/translations.check.ts` so it knows about the new entry.

## Phase 2 — Word handling (the real work)

**Status (2026-10-08): done.** `src/lib/textScript.ts` holds the script-aware
primitives (`splitWords`, `joinWords`, `wordGap`, `normalizeToken`, `firstLetterOnly`,
masks, `applyWordShape`, `scriptOfVerse`); `recitation.ts` re-exports them. Greek
accent folding uses a generated table (`greekBaseLetters.ts`), not `normalize()`.
`npm run check:textscript` (41 checks). Seen working on web: Psalm 23 Recall in Hebrew
(57 words, strict typing, mic hidden), Romans 8 memory grid in Greek, spot-the-swap
decoys keep their vowel points, build-up runs. Beyond the steps below:
- **Grading matched the wrong item.** `handleUpdateVerseStatus` found the saved verse
  by reference alone, so a Hebrew Recall could credit the BSB copy of the same verse.
  `VerseState` now carries `translationId` (Home, chapter page, review sessions) and
  matching uses it.
- **Masks were English-only.** Recall's hide/first-letter masks and Build up's hint rep
  left Hebrew fully visible; they now go through `maskLetters`/`maskExceptFirstLetter`.
- **Gaps after a maqaf.** Word-by-word layouts (Recall, memory grid, spot-the-swap,
  build-up segments) add their own spaces; they use `wordGap()` so עַל־מֵי stays joined.
- Speech gate (Phase 1 step 5) landed here.

All in `src/lib/recitation.ts` (plus a new `src/lib/scripts.ts` if it gets
long), all script-aware:

1. **`splitWords(text, script)`** — one splitter replacing the ~14
   `.split(/\s+/)` call sites. For Hebrew it also splits after a maqaf, keeping
   the ־ on the first piece for display (`אֶל־` + `הָאָרֶץ`). Call sites:
   `recitation.ts` (tokenizeWords, firstLetterLine, ~722), `drills.ts` (101,
   220, 229, 465), `MemoryGrid.tsx:104`, `printMemoryGrid.ts:29`,
   `PracticeModals.tsx` (1148, 1414, 1696, 2397), `ChapterLandingScreen.tsx:519`.
   **They must all use the same splitter** — MemoryGrid and PracticeModals
   index words across each other and drift apart if one splits differently.
2. **`normalizeToken(word, script)`**:
   - Hebrew: remove all points/marks (U+0591–U+05C7), keep letters
     U+05D0–U+05EA, map finals ך→כ ם→מ ן→נ ף→פ ץ→צ.
   - Greek: remove accents/breathings, lowercase, ς→σ.
   - **Don't rely on `String.prototype.normalize('NFD')`** for Greek until it's
     confirmed working in Hermes on a real device; polytonic Greek uses
     precomposed characters (U+1F00–U+1FFF), so ship a small base-letter lookup
     table instead. Hebrew points are already separate characters, so a regex
     is enough.
3. **`firstLetterOnly(word, script)`** — bare consonant for Hebrew, bare
   lowercase letter for Greek, punctuation kept attached as today.
4. **Typing** — `classifyFirstLetterAttempt` already runs both sides through
   `normalizeToken`, so it works once #2 does. `isAdjacentKey` returns false
   for non-Latin characters, which is exactly "strict". Nothing else needed.
5. **Drill tuning:**
   - Spot-the-swap: `MIN_SWAP_WORD_LENGTH = 4` is measured on normalized
     length; Hebrew consonantal words are short. Try 3 for Hebrew.
   - Build-up: `HINGE_WORDS` is English, so Hebrew/Greek bites split on word
     count only. Fine for v1.
6. **New check script** `src/lib/scripts.check.ts` +
   `scripts/run-scripts-check.cjs` covering: Genesis 1:1 in Hebrew splits into
   7 words; `אֶל־הָאָרֶץ` → 2 words; finals normalize; typed `ך` matches `כ`;
   Greek `Ἐν` → `ε`; final sigma; apparatus-free input; and a regression that
   every English check still passes unchanged.

## Phase 3 — Right-to-left display and fonts

**Status (2026-10-08): done on web; not yet seen on a real iPhone.** How it landed:
- **Fonts:** Greek needs nothing. Inter and Literata both carry all of polytonic
  Greek (checked against each TTF's character table). Hebrew is Noto Serif Hebrew
  (`@expo-google-fonts/noto-serif-hebrew`, OFL, 4 weights × 56 KB), in `APP_FONTS`.
- **`AppText script=`** is the one switch. `script="hebrew"` on a paragraph swaps in the
  weight-matched Hebrew face, sets it 1.2× (`HEBREW_TEXT_SCALE`, line height too), and
  makes it right-to-left. Nested spans inherit the face. Direction per platform: iOS
  `writingDirection`, web an explicit `dir="rtl"` (react-native-web otherwise uses
  `dir="auto"`, which a fully masked Recall line can't resolve), Android a leading
  U+200F mark. `textAlign: right` everywhere.
- **Rows** that set verses or tiles side by side use `flex-row-reverse` for Hebrew
  (`isRtl()`): chapter list rows and grid tiles, memory grid boxes/headers/dots, Order
  slots, Scramble answer and bank, the Record teleprompter. The printed grid gets
  `dir="rtl" lang="he"`. The spot-the-swap results arrow flips to ←.
- **Mixed-translation lists** (Listen playlists, the reference drill) carry
  `translationId` per verse and pick the script per verse.
- **Verified on web:** Psalm 23 list (numbers right, Noto Serif Hebrew at 20.4px),
  memory grid (verse 1 top-right), Recall (masked lines RTL, revealed words fill
  from the right), Scramble (first phrase lands on the right).

1. **Fonts.** Hebrew: Ezra SIL or Noto Serif Hebrew (both OFL) — pick whichever
   stacks vowel points more cleanly at our sizes on iPhone. Greek: Gentium Plus
   (OFL), which handles polytonic Greek well. Add to `APP_FONTS`. Regular weight
   only — see the iOS font-weight memory before adding a bold face.
2. **Size.** Hebrew with vowel points reads small; render verse text for the
   Hebrew script about 1.2× the English size.
3. **RTL, Hebrew only**, local to verse text — do **not** flip the whole app
   with `I18nManager`:
   - Verse text: `writingDirection: 'rtl'` + `textAlign: 'right'`.
     (`writingDirection` is iOS-only; Android's text engine detects Hebrew on
     its own, but check it.)
   - Word-tile rows (memory grid, build up, scramble, order, spot the swap,
     drag-select): `flexDirection: 'row-reverse'` so the first word sits on
     the right.
   - Printed grid (`printMemoryGrid.ts`): `dir="rtl" lang="he"` on the verse
     blocks, and embed the font.
   - Verse numbers stay Western digits.
4. Greek needs none of this — left-to-right, just the font.

## Phase 4 — Walk every mode

Add a Hebrew and a Greek passage to demo mode (`src/dev/DemoHarness.tsx`) so
this can be checked with `?s=<screen>` on web and `npm run shots` without an
account. Then go through, in both scripts: reading, memory grid, printed grid,
recite by typing, build up, order, scramble, spot the swap, reference drill,
drag-select, manual log. Check on a real iPhone as well as web — RTL and
vowel-point stacking are exactly the kind of thing that differs between them.

---

## Later ideas (not in v1)

- Near-key forgiveness for the Hebrew and Greek phone keyboards.
- Show the Hebrew reference next to the English one where they differ.
- A setting for full accents, or for consonants only (a harder self-test).
- Two-letter hints for Hebrew: a very large share of words start with ו, ה,
  ב or ל, so the first letter alone is a weak cue in narrative passages.
- Hebrew/Greek "hinge words" (ו, כִּי, καί, ὅτι…) for Build up.
- Show Psalm headings.
