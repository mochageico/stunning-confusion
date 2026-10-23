# Mixed review, sections and takeaways — build plan

Written 2026-10-22 from a long brainstorm with the user. Nothing here is built yet.
Each stage is one session. Run them in order: every stage builds on the ones before it.

**For the session building a stage:** read this whole file first, then your stage.
Stage by name when committing (never `git add -A`; other sessions edit this folder).
After each stage, update the **Progress** line below and note anything that changed.

**Progress:** stage 1 built 2026-10-22 (sections on the chapter page). The
chapterSections Firestore rule is **not deployed yet**: build first, then rules.
Stage 2 built 2026-10-22: First words (Outline), and Last to first on Recall's
normal recite and type. Stage 3 built 2026-10-22: Put in order, Which section,
Teach-It (all Practice). Stage 4 built 2026-10-22: Mixed review logic
(`src/lib/mix.ts`, `npm run check:mix`) and its Settings checklist; no screen yet.
Stage 5 built 2026-10-22: the Mixed review screen, Today's Mixed review / Recite
all due buttons, crediting as each round ends. Speech in the session is not yet
tried on a real phone. Stage 6, private half, built 2026-10-22 (takeaways, the
ask, the path; the takeaways Firestore rule is **not deployed**). Sharing, replies
and circle rules are the next session.

---

## Locked decisions

| Decision | Choice |
| --- | --- |
| Sections | Belong to the **chapter**, not to a mode. The user makes them by dragging a bracket edge. No automatic split from BSB headings. |
| Section look | Colored bracket on the **left** of the verses, label at the top of it. Bracket colors are their own small set and never reuse the stage colors (stage dots stay on the right). |
| Memory phrase | One word per section, starting with the first letter of that section's opening verse. The user's Matthew 7 phrase is "john doe ate some edamame but not every apple" (sections start at 1, 6, 7, 12, 13, 15, 21, 24, 28). The app never invents a phrase; with none written it shows the letters. |
| Outline mode | Vertical list, one row per verse. Default 3 words shown, adjustable 0–4 for all verses, plus a per-verse tap that adds one word (wraps at 4). Section labels and phrase words on the dividers, each switchable. **Can run last to first.** |
| Backwards | **Not its own mode.** A "Last to first" option on the normal recite and type: verses in reverse order, each verse still said forward. Word-by-word backwards is ruled out. |
| Counting rule | A format counts as a review if you bring words out of memory. **Counts:** Recite (either direction), Keep going (Pick up the thread), First words (Outline), Find the wrong word (Spot the swap). **Practice, never credits:** Scramble, Put in order, Which section, Teach-It. |
| Mixed review honesty | A verse counts as reviewed only when a counting format covers it that day. A Practice format in the mix is always followed by a counting one before moving on. |
| Teach-It | Named "Teach-It". Say the section in your own words, one fixed **10-second** timer, self-checked. Practice only. |
| "Practice" label | The non-counting formats are labeled "Practice" (not "warm-up"). |
| Tricky verses | **Dropped** as bloat. The mixed-review recap's "where you slipped" list covers it. |
| Takeaways | One per **section**. Asked once the whole section reaches **weekly** reviews. Optional, can be written later. The user can add a secondary **note** under it. |
| Takeaway sharing | Shareable with a circle (share switch remembers the last choice). A circle sees each person's takeaways as their own items; **not** grouped by passage across people (everyone's sections differ). **Replies live on the takeaway**, visible only after tapping it open. |
| Milestones | Books of the Bible as landmarks, counted in verses held ("You hold more verses than Ruth. Next: Philippians, 19 to go"). Shown as markers on the takeaways path. |
| Circle totals | One weekly line ("This week the Tuesday group reviewed 2,140 verses and wrote 6 takeaways"), a bar of everyone's share with **no ranking**, and a shared landmark ladder ("Together you hold more than Hebrews"). |
| Rejected | Lamp/momentum meter, streaks, speed or time as a score, clean-run counter, past-mistakes replay, keyword skeleton, phrase check, finish-the-recording, typing races, extra milestone kinds (first whole chapter etc.). Don't re-pitch these. |

### Names are not final

The user expects to rename some formats. Working names used in this plan:
Mixed review, Recite, Last to first, Keep going (today "Pick up the thread"),
First words (Outline), Find the wrong word (today "Spot the swap"), Put in order,
Which section, Teach-It, Scramble.

Stage 1 adds **one table** of format ids → labels (`src/lib/formatNames.ts`). Every
screen reads labels from it, so a rename later is a one-line change. Check new copy
against the banned-jargon list in the memory note "three-concept naming" (no "queue",
"phase", "graduate", "rhythm" …).

### Open questions (defaults used until the user says otherwise)

1. **Chapter opener:** default is one Practice round (Put in order or Which section) at
   the start of every chapter that has 3+ sections. Alternative: only sometimes.
2. **Chapter order in Mixed review:** default follows Today (daily, then weekly, then
   monthly). Alternative: shuffle chapters.
3. **A miss in a counting round:** default counts as a miss exactly like Recall today
   (below 90% = miss). Note that Pick up the thread on its own never penalizes a miss
   (user's call 2026-10-10). Ask before shipping stage 5.

---

## What already exists that this builds on

- **Due reviews on Today:** `src/screens/HomeScreen.tsx` — the Review card (~line 423)
  with "Review all due" (`handleReviewAllDue` → `startReviewSession`) and per-chapter
  rows (Listen / Review / manual log). Guided learning's button sits in the Learning card
  (~line 416, `state.openGuided()`).
- **Crediting a review:** `handleReviewCompleted(item, success, drillType, opts)` in
  `src/state/useReviewEngine.ts:654`. It already returns `'early'` and changes nothing
  for a verse that isn't due. `opts.quiet` suppresses toasts; `opts.via` is stored on
  the review log. `ReviewLog.via` in `src/types.ts:156` is `'thread' | 'guided'` today.
- **Guided learning, the model to copy:** pure logic + reducer in `src/lib/guided.ts`
  (with `src/lib/guided.check.ts` → `npm run check:guided`), screen in
  `src/screens/GuidedLearningScreen.tsx`, route `'guided'` in `src/state/useAppState.ts`
  (~lines 110/136), opened from `src/state/usePracticeSession.ts:63`.
- **Reusable drills:** `src/components/drills/` (BuildUp, Jigsaw, Scramble, SpotSwap)
  and `src/components/GradedRecitation.tsx` (graded speak/type over a verse span; takes
  `shownWords`, `onSwitchMode`, `onResult(perVerse, mode)`).
- **Pick up the thread:** `src/lib/drills.ts` (`buildThreadPassages` ~906,
  `pickThreadCue` ~1033) and `src/screens/ThreadDrillScreen.tsx` (credit rules ~line 39).
- **Recall (the practice screen):** `src/components/PracticeModals.tsx` shell +
  `src/components/practice/useRecall.ts` (tabs = `LearnMode`, word pointer across
  `verses`) and `RecallPanel.tsx`.
- **Per-user, per-chapter data precedent:** chapter photos —
  `src/state/useChapterPhotos.ts`, stored at `users/{uid}/chapterPhotos/{id}`,
  rule at `firestore.rules:164`.
- **Practice settings:** `PracticeSettings` in `src/screens/SettingsScreen.tsx:61`,
  saved through `src/lib/practicePrefs.ts`.
- **Chapter page:** `src/screens/ChapterLandingScreen.tsx` (drag-select already lives here).
- **Demo mode for checking UI without signing in:** `src/dev/DemoHarness.tsx`, opened
  with `?s=<screen>` on web; `npm run shots` takes screenshots. Add a demo for every
  new screen.
- **Checks:** `npm run check:*` scripts in `scripts/` run the `*.check.ts` files. Every
  new pure module gets one.

---

## Stage 1 — Sections on the chapter page

**Model: Opus.** New data model plus a drag gesture; everything later depends on it.

- **Data:** `ChapterSections` type in `src/types.ts`:
  `{ key, book, chapter, starts: number[], labels: Record<number,string>, phraseWords: Record<number,string>, updatedAt }`.
  Key is `book|chapter` (not per translation: sections are about structure). Note in
  the code that Hebrew/Greek uses English numbering, so this holds.
- **Storage:** `users/{uid}/chapterSections/{key}`, owner-only rule next to the
  chapterPhotos rule. New hook `src/state/useChapterSections.ts` modeled on
  `useChapterPhotos` (load on sign-in, reset on sign-out, destructured into AppState —
  keep `npm run check:appstate` passing by adding the new fields deliberately).
- **Pure helpers** in `src/lib/sections.ts` + `sections.check.ts` + `npm run check:sections`:
  section list from starts, which section a verse is in, move a start (clamped between
  neighbors), split at a verse, merge, labels follow their section when a start moves,
  phrase letters (first letter of each section's opening verse, Hebrew/Greek aware via
  `textScript`), "stretches" fallback for chapters with no sections (reuse
  `buildThreadPassages` with 4 verses).
- **Chapter page:** brackets on the left of the verse list, label at the top of each.
  An **Edit sections** mode: drag the handle on a bracket edge (snaps to verses), tap a
  verse to start a section there, double-tap a handle to join, tap a label to rename,
  memory-phrase word field per section. Must not fight the existing hold-and-drag
  multi-select: edit mode is separate.
- **Colors:** a 4–6 color bracket set as theme tokens (see memory note "theme token
  rules"); never the stage colors.
- `src/lib/formatNames.ts` (the label table above).
- **Demo:** `?s=sections` opens Matthew 7 with the user's nine sections and phrase.
- **Done when:** tsc clean, `check:sections` + `check:appstate` + `check:layout` pass,
  screenshots of the chapter page with brackets and in edit mode, including 1.5× text
  on SE width. Sections survive sign-out/sign-in.
- **Deploy note:** the new rule must reach Firestore before this ships. The memory note
  "social rules deploy" has the order (new app build first, then rules).
- **As built (notes for later stages):**
  - Code: `src/lib/sections.ts` (helpers, `SectionDraft`, `chapterStretches`),
    `src/state/useChapterSections.ts` (`sectionsForChapter`, `saveChapterSections`;
    a blank draft deletes the doc), `src/components/ChapterSections.tsx` (brackets,
    header rows, the handle), `src/lib/formatNames.ts` (`FORMATS` with labels and the
    `counts` flag, `MIX_NAMES` for Mixed review / Last to first / Counts / Practice).
  - Bracket colors are `bracket1`..`bracket6` in theme.tsx (`bracketColor(palette, i)`),
    also as `bg-bracket-1`.. classes.
  - Merge rule: the joined section keeps the upper label/word, or takes the lower one's
    when the upper had none. Stretches overlap by one verse (buildThreadPassages).
  - The user's phrase matches **ESV** first letters (Judge not, Do not give, Ask, So,
    Enter, Beware, Not, Everyone, And). In the BSB the letters are D D A I E B N T W.
    The app shows the user's words and never checks them against the letters.
  - Drag handles: gesture callbacks are worklets with copied closures, so no flags in
    them; the screen keeps drag state in a ref. Row positions are measured at drag
    start (web's onLayout misses rows that only move). Not yet tried on a real phone.
  - Demo: `?s=sections`, plus `&edit=1` to open Edit sections.

## Stage 2 — First words (Outline) and Last to first

**Model: Sonnet for Outline. Opus for the Last to first change inside Recall**
(`useRecall`'s word pointer, strikes and per-verse outcomes all assume forward order;
it's a small change in a delicate place).

- **Outline screen/panel** (`src/components/drills/OutlineDrill.tsx`): rows top to
  bottom, number + first N words + a faint line for the rest. Controls: words slider
  0–4 (default 3), per-verse tap adds a word (wraps), switches for section labels and
  memory phrase, **direction switch (first to last / last to first)**, reset taps.
  Per-verse taps save per chapter (on the ChapterSections doc as `outlineExtra:
  Record<verse, number>`).
- **Counting:** tapping a row (or "Run it") recites that verse with GradedRecitation,
  `shownWords` = the words the row shows. Graded results are what a host credits.
- Reachable as a new tab in Recall (`LearnMode`) and from the chapter page.
- **Last to first in Recall:** an option on Recite (speak and type): verses run last to
  first, each verse forward. Results still map to the right verse.
- **Last to first for GradedRecitation hosts:** no change to GradedRecitation itself;
  hosts run one verse at a time in reverse.
- **Demo:** `?s=outline` (Matthew 7, sections on).
- **Done when:** tsc, checks, screenshots both directions; recite in reverse credits the
  right verses (add a check for the reverse mapping).
- **As built (First words):**
  - Pure logic `src/lib/outline.ts` + `outline.check.ts` (`npm run check:outline`):
    words shown, tap wrap (`bumpExtra`: slider + taps, back to the slider's number
    past 4), rows, grouping by section, grading, and `OutlineRun` (`recordRunResult`
    keys every result by verse and ignores a result for any other verse, which is the
    reverse-order guard; the check runs a whole reversed run).
  - Screen `src/components/drills/OutlineDrill.tsx`: list in the chosen direction with
    section brackets/headers (reuses `BracketGutter`/`SectionHeaderRow`), tap a row =
    one more word (saved), mic on a row = say that verse, **Run it** = every row in
    listed order, one `GradedRecitation` per verse. Settings (folding rows): Words
    shown, Order (First to last / Last to first), Answer by (only where speech works),
    switches for Section labels and Memory phrase (only with sections), Reset taps.
  - It only grades; the host credits through `onVerseGraded`. Recall's panel credits a
    verse that passes 90%, is `reviewing` and is due (and reviews aren't paused),
    quietly, `via: 'outline'`, `perfect: false`. A learning verse is practice only
    (a partly shown verse can't give the perfect graded run learning needs).
  - `outlineExtra` lives on the ChapterSections doc (`useChapterSections.saveOutlineExtra`;
    `saveChapterSections` keeps it). A doc with only taps uses the placeholder start
    `[1]`, never another verse (it would read as a section start); the chapter page
    treats such a doc as "no sections".
  - Reach: new Recall tab "First words" (`LearnMode` 'outline', label from
    `formatNames`), and a First words button on the chapter page (the picked verses,
    or the whole chapter) via `startPractice(..., { learnTab: 'outline' })`
    (`practiceLearnTab` in AppState). Six tabs don't fit at 1.5x, so
    `SegmentedControl` got a `wrap` prop (second row) that Recall's picker uses at
    1.3x and up.
  - `ReviewLog.via` gained `'outline'`. `MIX_NAMES.firstToLast` added.
  - Demo: `?s=outline` opens Matthew 7 (sections on) straight into First words.
  - Not tried: on a real phone (speech grading, the hold on a row); crediting a real
    due verse end to end (the demo queue has no Matthew 7).
- **As built (Last to first in Recall):**
  - `src/lib/reciteOrder.ts`: words keep their passage-order index everywhere
    (outcomes, hidden sample, grid colors, `finalOutcomes`, crediting). Only
    `recitePointer` is a *recite position*; `reciteOrder.order[pos]` gives the word,
    `reciteOrder.posOf[word]` the position. Speech gets its expected tokens in recite
    order and its patch is re-keyed with `positionsToWords`.
  - The setting is a "Verse order" row in Recall's settings card (2+ verses), saved as
    `lastToFirst` in practice prefs. Changing it starts the run over. Passage and grid
    both show the verses in recite order. Crediting still passes `verses` unchanged.
  - `MIX_NAMES.firstToLast` added beside `lastToFirst` for the other side of the switch.
  - Check: `npm run check:reciteorder` (typed and spoken reverse runs, strike reset).

## Stage 3 — Put in order, Which section, Teach-It

**Model: Sonnet.** All three are self-contained Practice formats.

- **Put in order** (`SectionOrderDrill.tsx`): shuffled section labels into numbered
  slots. Reuse JigsawDrill's tile/slot interaction. Needs 3+ sections.
- **Which section** (`WhichSectionDrill.tsx`): show one verse, pick its section from 3
  choices (the right one + two neighbors). Needs 3+ sections.
- **Teach-It** (`TeachItDrill.tsx`): "Say it in your own words", one 10-second ring
  timer, mic transcript if speech is available, then Got it / Not really. Offer
  "Save as takeaway draft" (stored for stage 6; until then keep it in the drill only).
- All three are Practice: they never call `handleReviewCompleted`.
- New Recall tabs where they fit; each needs its prerequisites (sections) or hides.
- **Done when:** tsc, screenshots, demo entries.
- **As built (stage 3):**
  - Pure logic `src/lib/sectionDrills.ts` + `sectionDrills.check.ts`
    (`npm run check:sectiondrills`): `drillSections(verses, doc)` (the chapter's
    sections as far as the selection reaches; one chapter only; `index` stays the
    chapter-wide position so bracket colors match), `buildOrderRound`/`scoreOrder`,
    `buildQuestions`/`choicesFor` (right section + one neighbor each side, or the
    next two at an edge), `teachTargets` (sections, else stretches), the 10 s timer
    maths, `makeTakeawayDraft`/`addDraft` (one draft per section).
  - Drills in `src/components/drills/`: `SectionOrderDrill` (JigsawDrill's tap-to-place
    slots; a tile is the section's label, or its first four words when it has none,
    never its verse range, which would give the order away; "Check order" then shows
    each placed section's verses), `WhichSectionDrill` (8 verses, one per section in
    turn, verse number hidden until answered, choice = label + range + bracket color
    swatch, score at the end, Play again), `TeachItDrill` (section/stretch chips,
    ring timer from react-native-svg, live transcript where `getSpeechRecognizer()`
    exists, else a typed line; the verses are shown after the time is up; Got it /
    Not really; "Save as takeaway draft" keeps `TakeawayDraft`s in the drill only,
    listed at its foot).
  - None of the three calls `handleReviewCompleted` or any credit callback; they
    take no such prop. Each says "is Practice: it never counts as a review".
  - Recall tabs: `LearnMode` gained `putInOrder`, `whichSection`, `teachIt`. useRecall
    takes `chapterSectionsDoc` and returns `sectionList`; Put in order and Which
    section appear only with 3+ sections in the passage (and fall back to Recall if
    the passage changes under them); Teach-It always shows. Labels from `formatNames`.
  - The picker now wraps whenever there are more than 6 tabs (nine, with sections).
    At 1.5x on an SE it is four rows; at 1.3x+ each drill moves its buttons into the
    scrolling area so the controls are still reachable.
  - Demos: `?s=sectionOrder`, `?s=whichSection`, `?s=teachIt` (Matthew 7, sections
    on, entered like First words then the tab). Added to `npm run shots -- --all`.
  - Open for the user: the old verse-order tab is labeled "Order" and the new one
    "Put in order" (from formatNames). Easy to confuse; rename one.
  - Not tried: speech on a real phone (the browser pane blocks the mic, so the typed
    fallback was what ran); Hebrew/Greek passages; sections on a multi-chapter
    selection (they have none, so only Teach-It shows).

## Stage 4 — Mixed review: logic

**Model: Opus.** The session planner and the honesty rule; same weight as Guided phases 1–3.

- `src/lib/mix.ts` + `mix.check.ts` + `npm run check:mix`, pure, like `guided.ts`:
  - Input: due reviewing items, chapter sections, enabled formats, an `Rng`.
  - Build units: per chapter (Today's order), its sections (or stretches).
  - Per chapter: optional opener (open question 1). Per section: draw a format from the
    enabled set; never the same format twice in a row; skip formats whose
    prerequisites fail (Keep going needs an earlier started verse, Find the wrong word
    needs a decoy pool, Put in order / Which section need 3+ sections); fall back to Recite.
  - If the drawn format is Practice, queue a counting format right after it for the same
    section.
  - Reducer: start, round result, skip, stop. Tracks which verses got counting coverage.
  - Credit decision per verse from a counting round: pass/miss/self per the open
    question 3 default.
- Add `'mix'` to `ReviewLog.via` and the opts type.
- Formats setting (which formats are in the mix) saved in practicePrefs; Settings gets a
  "Mixed review" checklist with Counts/Practice tags.
- **Done when:** `check:mix` covers: honesty (no verse credited by a Practice format
  alone), no repeats in a row, fallbacks, stretches when a chapter has no sections,
  stop mid-session keeps earlier credit.
- **As built (stage 4):**
  - `src/lib/mix.ts`: `buildMixPlan(input, rng)` decides the whole session up front
    (chapters, units, rounds), so the screen can say "section 3 of 9". Input: `due`
    (the caller filters: reviewing, due, reviews not paused), `pool` (the whole queue,
    for Keep going's context), `sectionsFor` (`sectionsForChapter`), `enabled`.
  - **Order:** `todayOrder` = daily, weekly, monthly, each in queue order; a chapter
    sits where its first due verse does. A chapter is translation|book|chapter.
  - **Units:** the chapter's sections that hold a due verse (`dueSections`; unlike
    `drillSections`, due verses all in one section still make one section unit, not
    stretches). No sections: each unbroken run of due verses cut by
    `chapterStretches` (4, sharing a verse); a lone verse is its own stretch, since
    `buildThreadPassages` drops runs of one and a due verse must never fall out.
  - **Opener:** a chapter with 3+ sections (holding due verses) opens with Put in
    order or Which section when one is switched on; the next round is always counting.
    **Put in order only ever opens** (it is a whole-chapter round). Which section can
    also be a section's draw.
  - **Prerequisites (`formatFits`):** Keep going needs `unit.contextVerseId`, the
    started (not queued) verse just before an unbroken unit, so every unit verse is
    said whole; Find the wrong word needs a planted word in **every** verse
    (`buildSwapVerses`); Scramble needs a verse that splits into tiles; Which section
    needs a section unit in a 3+ section chapter. Recite, First words, Teach-It: none.
  - **Draws:** `drawFormat` never repeats the previous round's format; when nothing
    fits it falls back to Recite, **even if Recite is unchecked** (so Recite-only
    repeats Recite). A Practice draw gets a `role: 'follow'` counting round on the
    same unit.
  - **Credit (`roundCredits`, open question 3 default):** graded >= 90% pass, under a
    miss; self-check Got it pass / Not really miss, never perfect. Practice rounds
    credit nothing whatever the screen reports; a round only credits its own
    `verseIds` (Keep going's context verse never); a verse keeps its first credit
    (overlapping stretches). Keep going in the mix **does** count a miss, unlike the
    standalone thread screen; ask the user before stage 5 ships.
  - **Reducer:** `startMix(plan)` → `mixReducer` with `start`, `result` (perVerse),
    `skip`, `stop`. `state.newCredits` = exactly the credits the last event earned:
    stage 5 sends each to `handleReviewCompleted(item, outcome === 'pass',
    mode === 'self' ? 'reveal' : mode, { quiet: true, via: 'mix', perfect })` right
    away. Skipping a Practice round still leaves its counting round. `stop` keeps all
    credit. `mixSummary` gives passed / missed / not covered / slipped units /
    formats used for the recap.
  - `ReviewLog.via` gained `'mix'` (`ReviewCompletedOpts` reads it from there). The
    engine only stores `via` on pass logs today, so a mixed-review miss won't show
    `via: 'mix'` in history.
  - **Settings:** "Mixed review" checklist under the practice settings, a checkbox
    row per format with its Counts/Practice badge, saved as `mixFormats` in practice
    prefs (`readMixFormats` cleans it; nothing saved = all on).
  - Not decided by this stage: Recite's direction (Last to first) and First words'
    word count per round; Find the wrong word's per-verse accuracy for crediting.

## Stage 5 — Mixed review: screen and Today

**Model: Opus** for the screen wiring and crediting, Sonnet is fine for the recap
layout if split off.

- `src/screens/MixedReviewScreen.tsx`, route `'mixedReview'`, opened like Guided.
- **Today:** Review card's primary button becomes **Mixed review**; the existing
  "Review all due" stays as a secondary button labeled **Recite all due**. Chapter rows
  unchanged.
- **Start sheet:** verse count, chapters, rough time (reuse `getEstimatedReviewTime`),
  chapter checkboxes, "Add sections" link for chapters without any, Formats link, Start,
  "Stop anytime. What you finish counts."
- **Session:** progress bar, "Matthew 7 · section 3 of 9", section bracket color and
  label, format name with Counts/Practice tag, the drill. Credit each section as soon as
  its counting round ends (`handleReviewCompleted(..., { quiet: true, via: 'mix' })`),
  so closing the app loses nothing.
- **Recap:** verses, sections, time; clean vs slipped; "Where you slipped" list with a
  Practice button per section (opens Recall on those verses); formats used today.
- **Demo:** `?s=mixedReview` with three due chapters.
- **Done when:** tsc, all checks, screenshots of each step at 1.5× on SE, a real-phone
  check of speech in the session.
- **As built (stage 5):**
  - The user confirmed the three open-question defaults before this stage: an
    opener for every chapter with 3+ sections, chapters in Today's order, a slip in
    a counting round is a miss like Recall (Keep going included).
  - Route `'mixedReview'` (Today tab), opened by `state.openMixedReview()`
    (`usePracticeSession`, like `openGuided`). `check:appstate` snapshot updated on
    purpose for it.
  - Today: the Review card's main button is **Mixed review**; the old one is
    **Recite all due (n verses)**, secondary, same `handleReviewAllDue`. Chapter
    rows unchanged.
  - `src/screens/MixedReviewScreen.tsx`. It decides nothing about the plan;
    `buildMixPlan` runs once on Start with `Math.random`. Due = reviewing, due,
    reviews not paused, in `todayOrder`.
  - **Start sheet:** verses and chapters chosen, "About N min" from
    `getEstimatedReviewTime` on the chosen due items only, a checkbox per chapter
    (sections count or "no sections yet"), "Add sections to …" links (chapter page)
    for chapters without, a formats line with "Choose formats" (Settings), Start,
    "Stop anytime. What you finish counts."
  - **Session:** top row progress bar + Skip + X (stop). Then "Matthew 7 · section
    3 of 9" ("part" for stretches, "the whole chapter" for an opener), a bar in the
    section's bracket color (neutral `line` for stretches and openers), the section
    label (or "Verses 6–11"), the format name and its Counts/Practice badge.
  - **What each format reports** (stage 4 left these open):
    - Recite and First words: one `GradedRecitation` over the unit, **first to last
      only** (Last to first is not used in the mix yet). First words keeps the
      first 3 words of each verse showing (the same as the First words drill, the
      shown words still have to be typed or said). "Show text and check myself" is
      a self-check: Got it, or Missed some and pick the verses (never perfect).
    - Keep going: `ThreadRound` over [context verse, ...unit], the cue always inside
      the context verse (`pickThreadCue(..., { fromVerse: 0, beforeVerse: 1 })`), so
      every unit verse is said whole; the context verse shows "Only the way in" and
      is never credited. No cue found → that round runs as Recite.
    - Find the wrong word: `SpotSwapDrill` got `onScored` (per-verse caught /
      decoys / wrongly flagged), `resultNote` and `showSwapCount` (picker hidden, no
      "New swaps" after the check). Per verse accuracy = caught / (decoys + wrongly
      flagged), against the 90% bar, **never perfect** (spotting, not saying). Only
      the first check counts. Worth a look from the user: missing 1 of 2 planted
      words is a miss.
    - Practice rounds: the drill plus a secondary "Done practicing". Put in order
      and Which section get `drillSections` of the chapter's due verses. Teach-It
      gets the unit's verses with no sections, so a section longer than 4 verses
      shows as stretch chips (e.g. 7–10, 10–11), not one whole section.
  - **Crediting:** `send(event)` runs `mixReducer` and sends `next.newCredits` to
    `handleReviewCompleted(item, pass, mode === 'self' ? 'reveal' : mode, { quiet:
    true, via: 'mix', perfect })` right away, one at a time on a promise chain, each
    reading the live item from `memoryQueueRef` (as `handleUpdateVerseStatus` does).
    Checked in the demo: passes logged `via: 'mix'`; a miss went through the
    engine's miss policy (grace) and stays due.
  - A round's verses are memoized per round: saving a credit refreshes AppState,
    and new arrays made drills (Spot the swap, Scramble) deal again mid-round.
  - **Recap:** "Reviews done" / "Stopped for today", verses · sections · minutes
    (screen-measured, not added to Dashboard's study time), Clean / Slipped tiles,
    "N verses not reached are still due today", "Where you slipped" rows with a
    Practice button (`startPractice('learn', ...)` on that section's verses, i.e.
    Recall), formats used today with their badges.
  - Demo: `?s=mixedReview` (Matthew 7:1–14 BSB due daily with the user's sections,
    Romans 8:1–2, Philippians 4:6–7; Psalm 119:11 moved off today), `&start=1`
    taps Start. Added to `npm run shots -- --all`.
  - Not tried: speech on a real phone (the browser pane has no mic; typing and
    self-check were what ran); Hebrew/Greek chapters in the mix; closing the app
    mid-round on a phone (credits are written per round, so it should lose only
    the round on screen).
  - Follow-ups for the user: Teach-It on a whole section (above); Last to first as
    a Recite variety in the mix; whether Find the wrong word's bar is right.

## Stage 6 — Takeaways path

**Model: Sonnet** for the path and the ask. **Opus** for sharing, replies and rules.

- **Data:** `users/{uid}/takeaways/{id}`: `{ book, chapter, sectionStart, sectionEnd,
  label, text, note?, createdAt, sharedTo?: circleId[] }`.
- **The ask:** when every verse in a section is in weekly reviews or later and the
  section has no takeaway, show it once (end of a review session, and a quiet card on
  Today). "Later" leaves an empty dashed stop on the path. Teach-It drafts prefill it.
- **Path screen:** newest at top, stops alternate sides of one line, each in its
  section's bracket color, chapter dividers, the next unlocking section as a dashed stop.
  Mine / With my circle switch. Tap a stop to open it: takeaway, note, replies.
- **Sharing:** share switch per takeaway (remembers last choice). Shared copy at
  `circles/{circleId}/takeaways/{id}` (members-only read, author-only write), replies at
  `.../takeaways/{id}/replies/{replyId}` (members can create their own, immutable,
  same shape as circle messages). Respect block lists like circle chat does.
- **Circle view:** each member's takeaways as their own items (not grouped by passage),
  reply count shown, replies only after opening.
- **Done when:** tsc, checks, screenshots, rules tested against a non-member.
- **Deploy note:** new rules again: build first, then rules.

- **As built (stage 6, private half):**
  - Data: `Takeaway` in types.ts at `users/{uid}/takeaways/{book|chapter|sectionStart}`
    (one per section by construction). Fields as planned plus `status`: absent/'saved'
    = written, 'later' = the empty dashed stop (text may hold what was typed), 'draft' =
    Teach-It's draft (not a stop; fills in the ask). `createdAt`/`updatedAt` are ISO.
    Owner-only rule beside chapterSections, **not deployed**. Account deletion removes them.
  - `src/lib/takeaways.ts` + `npm run check:takeaways`: `sectionStatuses` (a section is
    ready when every verse number start..end is in the queue at weekly or later, a verse in
    two translations at its furthest, a refresher at its return stage; the last section ends
    at the highest verse the user is learning; chapters with no real sections have none),
    `pendingAsks`/`nextAsk`, `nextUp` (the dashed "unlocks at weekly reviews" section:
    furthest along, all verses in the queue), `buildPath` (newest first, chapter dividers,
    sides alternate), `makeTakeaway`.
  - `useTakeaways` (load, `saveTakeaway(spot, {text, note, status})`, `deleteTakeaway`);
    AppState gained `takeaways`, `saveTakeaway`, `deleteTakeaway`, `saveTakeawayDraft`,
    `nextTakeawayAsk`; route `'takeaways'` (Verses tab). Snapshot updated on purpose.
  - The ask: `src/components/TakeawayAsk.tsx` (`TakeawayForm`, `TakeawayAsk`). Quiet card
    on Today above Review ("Write it" / "Later"); open form at the end of the Mixed review
    recap. Later and Save both write the doc, so each section is asked once. Teach-It saves
    a draft only for a real section (stretches, as in Mixed review, stay in the drill) and
    says so if the section already has its takeaway.
  - `src/screens/TakeawaysScreen.tsx`: the path and the opened takeaway (edit text and
    note, show the verses, remove). Reached from My Verses ("Takeaways" row) and a Takeaways
    button on the chapter page. At 1.3x text and up the stops all sit on one side of the line
    (two half-width columns left a card a few words per line).
  - Demos: `?s=takeaways` (`&open=1`), `?s=takeawayAsk` (`&write=1`), `&fresh=1`.
  - Left for sharing: the share switch (a `shareSlot` in `TakeawayForm`, used by the
    opened takeaway and open for the ask; `sharedTo` is not on the type yet), the Mine /
    With my circle switch on the path, `circles/{id}/takeaways` and replies with rules and
    block-list handling, reply counts on stops, deploying the takeaways rule (build first,
    then rules). Not tried: a real phone; Hebrew/Greek chapters; the recap ask live (same
    component as Today's, but no demo reaches weekly through a session).

## Stage 7 — Milestones and circle totals

**Model: Sonnet** for milestones. **Opus** for circle totals (needs a shared stats doc
and rules).

- **Milestones:** `src/lib/milestones.ts` + check: a 66-book verse-count table, verses
  held = items past learning. Ladder by verse count, "next landmark, N to go". Markers
  on the takeaways path at the date each landmark was passed (from review logs).
- **Circle totals:** each member writes a small weekly stats doc (verses reviewed this
  week, takeaways written, verses held) readable by circle co-members. Circle page shows
  the weekly line, the share bar (no names in rank order — alphabetical or fixed member
  order), and the shared landmark ladder.
- **Done when:** tsc, checks, screenshots; a member who leaves the circle drops out of
  the totals.

---

## Model summary

| Stage | Model |
| --- | --- |
| 1 Sections | Opus |
| 2 Outline | Sonnet (Last to first inside Recall: Opus) |
| 3 Put in order, Which section, Teach-It | Sonnet |
| 4 Mixed review logic | Opus |
| 5 Mixed review screen | Opus (recap layout: Sonnet) |
| 6 Takeaways | Sonnet (sharing, replies, rules: Opus) |
| 7 Milestones / circle totals | Sonnet / Opus |

Rule of thumb used: Opus where a mistake corrupts saved data, credits the wrong
verses, or opens a security hole (data models, the review engine, Firestore rules,
`useRecall`). Sonnet for self-contained screens with a clear spec.
