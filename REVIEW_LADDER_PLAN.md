# Review ladder, passages and grading — decisions

Written 2026-10-27 from a design conversation with the user. **Nothing here is built
yet.** Part 1 (sections 1–6) is what was decided. Part 2 (**Build plan**, at the end)
is the staged plan: one stage per session, in order.

**For the session building a stage:** read this whole file first, then your stage.
Stage files by name when committing (never `git add -A`). After each stage, update the
**Progress** line and add an "As built" note under the stage, like
`MIXED_REVIEW_PLAN.md` does.

**Progress:** stage 1 built (ladder + grading logic, pure; nothing calls it yet).

Mockups: the "My Verses ladder sketches" design canvas (claude.ai artifact
77ZK89BZsaNcsiS8UgXqHL): My Verses by group and by chapter, verse page ladder,
joining, Settings, review recap, welcome back, map star options.

Check new copy against the banned-jargon list in the memory note "three-concept
naming" (no "queue", "phase", "graduate", "rhythm" …).

---

## 1. The ladder (replaces daily / weekly / monthly)

Moves up by **reviews**, not calendar days. Standard counts:

| Step | Reviews to move up | Group | Color |
| --- | --- | --- | --- |
| Every day | 7 | Settling | green (stageDaily) |
| Every 2 days | 4 | Settling | green |
| Every 4 days | 4 | Settling | green |
| Every week | 8 | Steady | blue (stageWeekly) |
| Every 2 weeks | 6 | Steady | blue |
| Every 4 weeks | 12 | Kept | gold (stageComplete's gold) |
| Every 8 weeks | 6 | Kept | gold |
| Every 6 months | for good | Kept | top tier ("halo and glint", below) |

- There is **no end**. "Complete" is no longer a stop; the ladder keeps stretching.
  (An "At the top: Finish" setting was considered and dropped.)
- Weekly and longer steps keep the chapter's review weekday (`chapterReviewAnchorDay`,
  `nthOccurrenceOfWeekday`): 7, 14, 28, 56 days are all multiples of 7. 4 weeks, not
  30 days, on purpose.
- **Group names and descriptions** (name, then the precise description):
  - Settling — "Reviewed every 1–4 days"
  - Steady — "Reviewed every 1–2 weeks"
  - Kept — "Reviewed every 4–8 weeks, then every 6 months for good"
  - My Verses strip: Waiting · Learning · Settling · Steady · Kept.
- Copy says "7 reviews", never "7 clean".
- **Top-tier color ("halo and glint")**, for every 6 months, on the constellation
  map's star (`MapDrawing.tsx`: glow + ring + ink center): a cut ice-blue/white ring
  (hard-stop gradient #FFFFFF / #9CC0E2 / #E3F0FB / #6F98C4), a small 4-point glint at
  the ring's top right, inside a soft blue radial halo (#A8CCF0, ~0.5–0.6 opacity,
  r≈18). On light maps add a thin outer edge (#6F98C4, 0.6px) so it doesn't wash out.
  Bars and dots elsewhere use a pearly platinum gradient.

### Thoroughness setting

One multiplier on every step's review count (each step needs at least 2):
Light 0.5× (~14 months to every 6 months), **Standard 1×** (~28 months, default),
Thorough 1.5× (~3½ years), Navigators 2× (~4½ years), with no slips. The settings
screen calculates these from the table (`daysToTop` in `ladder.ts`) rather than
showing fixed text. Replaces today's
dailyPhaseWeeks / weeklyPhaseMonths / monthlyPhaseYears.

## 2. Passages: verses are reviewed together

- A **passage** = an unbroken run of verses in one chapter and one translation that
  are past Learning. One schedule per passage, never per verse.
- When a verse leaves Learning it **joins** its passage (front or end). The passage
  drops to Every day and runs a **short catch-up**: 3 × every day, 2 × every 2 days,
  2 × every 4 days (~2 weeks), then lands at Every week on the chapter's weekday and
  climbs normally. It does not return to its old step.
- Verses that join while a catch-up is running join it without restarting it.
- A gap between two passages (Romans 8:1–20 and 31–39) keeps them separate. When the
  gap fills, they merge into one passage with one catch-up.
- A passage at the top that gains a verse reopens and climbs at the normal pace (no
  faster second climb; reviewing a bit more is fine).
- Two translations of the same verses = two separate passages.
- Migration: existing items merge into passages at the **lower** step, with the same
  short catch-up.
- Copy: "Romans 8:21–22 join verses 1–20" (not "takes in").

## 3. Missed time

- **Setting "Late reviews move you back", default on.** Missed reviews =
  floor(days overdue / interval). Each moves the passage back one review, never below
  review 1 of its current step. Less than one interval late is free. Then today's
  review is graded normally on top.
- Off: a late passage waits where it was.
- **Long absence:** overdue passages are spread over the next few days automatically
  (Settling first, then most overdue). Today shows a "Welcome back" card.
- This replaces the missed-cycle catch-up in `handleReviewCompleted`, the
  grace / escalate / reset miss policy and the missed-review popup.

## 4. Grading a review

Every counting format reports per verse: **clean, stumble or blank**.

- **Clean setting:** "Accuracy needed for clean", 85–100% in 5% steps, **default 90%**.
- **Recite / type / Keep going / First words** (First words grades only the hidden
  words): at or above the clean setting = clean; below = stumble; under 50% or
  revealed = blank. A requested hint = one stumble.
- **Find the wrong word** uses misses per verse instead of the % system. A miss = a
  swap not found, a correct word wrongly flagged, or a found swap whose replacement
  the user didn't know (Yes/No toggle per swap after the check, Yes by default).
  0–0.49 misses/verse = clean; 0.5–1 = stumble; over 1 = blank.
  Setting: "Find the wrong word can count as a clean review", default on.
- **Self-check:** three buttons per verse, Got it / Stumbled / Blanked. Limits:
  - **Every other review:** a self-check can hold or drop a passage but can't move it
    up twice in a row; the next must be recall or Find the wrong word.
  - **Spot check:** after "Got it", the app always asks for one random Got it verse,
    showing the last 3 words of the verse before as context
    ("…in Christ Jesus. **2** ___"). Missing it holds the whole review, whatever the passage's size (it can't move
    up; stumbles and blanks still apply).
- **Practice (never credits):** Scramble, Put in order, Which section, Teach-It.
- **Combining a session:** each verse takes the result of the counting round that
  covered it (worst if covered twice). A passage review only counts toward moving up
  if every verse was covered by a counting round. Stopping halfway keeps the covered
  verses' results (stumbles and blanks still apply) but the passage stays on its
  review count.

### Passage outcome

| | Under 12 verses | 12+ verses |
| --- | --- | --- |
| All clean | +1 review | +1 review |
| 1–2 stumbles | Held (doesn't count) | Forgiven (+1 review) |
| 3+ stumbles | Back one review, never below the start of the step | Same |
| A blank | Down one step (blank beats stumbles; one penalty per review) | Same |

- Down a step can move a passage between groups (Every week → Every 4 days = back to
  Settling).
- No "same verse blanks twice" rule.

## 5. After a slip

- **Weak-spot dot:** verses that slipped in a passage's last review get a small dot on
  My Verses and the chapter page; it clears when the verse is next clean. No history,
  no scheduling effect.
- **Fix the transitions** (working name, the user wants it renamed from "Fix the
  joins"): the recap offers Guided learning's **Seam** drill (`seamCue` in
  `src/lib/guided.ts`) on each slipped verse, running in from the end of the verse
  before. ~1 minute. It must be **skippable**. Not a counting format. Finishing it
  clears the weak-spot dot early.
- **Firm up (win it back):** after a stumble-hold or a back-one, the slipped verses
  appear on Today the next day as a short item with a running start. Reciting them
  clean gives the lost review back (a held review counts; a back-one is undone).
  Step drops from a blank can't be won back. Incentive is the point: more reason to
  come back = more practice.

## 6. Idea saved for later (not decided for the build)

- **Find the wrong word, instant grading:** the user knows how many swaps are planted
  (n). As soon as they've flagged n words, grade immediately and show which flags
  were right or wrong, instead of waiting for a "Check" tap. Immediate feedback beats
  delayed feedback.

## Open

- Rename "Fix the transitions".

---

# Part 2 — Build plan

## Where each stage runs

The user runs anything that **touches Firestore or the review engine locally, with
Opus**. Visual work with no Firestore can run in a cloud session (Sonnet is fine).
Each stage says which:

- **Local · Opus** — reads or writes Firestore, or decides what gets credited. A
  mistake here corrupts saved progress. Test against a **test account** first, never
  the main account.
- **Cloud OK · Sonnet** — screens and pure display logic, checked with the demo
  harness (`?s=…`), `npm run shots` and `npm run check:layout`. Writes nothing to
  Firestore. It doesn't need local, but can run locally too.

No Firestore **rules** change in this plan: `users/{uid}/memoryQueue/*` and
`memoryPlans/{uid}` are already owner read/write, and new fields ride on those docs.

## Architecture decisions (made up front so stages agree)

1. **Passages are derived, not stored as their own docs.** `passages(queue)` groups
   reviewing items by translation + book + chapter + consecutive verse numbers. The
   passage's schedule (step, review count, due date, catch-up, firm-up) is written
   **identically on every member item**. A pure `reconcile` makes members agree:
   lowest step, then lowest review count, earliest due date. Joins and merges are just
   reconcile running after a verse enters (it arrives at step 0 with a catch-up, so
   the passage drops to Every day). No new collection, no new rules, the existing
   debounced queue auto-sync keeps persisting it.
2. **New fields on `QueueItem`** (all optional, additive):
   - `ladderStep` (0–7, index into the ladder table), `ladderReviews` (reviews at the
     current step), `catchUp?: true` (short catch-up targets apply).
   - `dayResult?: { day: string; grade: 'clean' | 'stumble' | 'blank'; via?: … }`: this
     verse's result for its passage's current review (see 4).
   - `lastSelfChecked?: true`: the passage's last counted review was a self-check
     (every-other rule).
   - `firmUp?: { day: string; restore: { step: number; reviews: number } }`: winnable
     review after a slip; `slipped?: true`: weak-spot dot. Both follow the existing
     "only ever true / delete to clear" rule (Firestore rejects `undefined`).
3. **Legacy fields keep being written, mapped**, so a friend's view of your verses
   (`profiles/{uid}/shared/memoryQueue`) and any old app build still read something
   sensible: `status: 'reviewing'`, `retentionPhase` = daily for Settling, weekly for
   Steady, monthly for Kept. An old build that *grades* a verse will still write wrong
   progress; ship the new build to every device before migrating (note for the user).
4. **Coverage accumulates per day across every practice screen.** Each graded verse
   gets `dayResult` for today. When every member of the passage has a result for the
   current due review, the passage outcome is applied once (Part 1 §4 table) and the
   `dayResult`s are cleared. A passage left partly covered when the day rolls over gets
   a **penalty-only** outcome (stumbles/blanks apply, it can't move up), applied lazily
   on next load. This makes Recall, Pick up the thread, Guided, First words, the map
   walk, the manual log and Mixed review all follow the same rule without each one
   knowing about passages.
5. **Review settings are user-level** (like Rhythm), on `memoryPlans/{uid}`:
   `ladderVersion: 2`, `thoroughness` (0.5 | 1 | 1.5 | 2), `cleanPct` (85–100, default
   90), `lateMovesBack` (default true), `swapCanBeClean` (default true). The old
   per-plan phase lengths, `reviewsRequired`, miss policy, grace and refresher
   settings are retired (the Review Settings / plan designer screens change in stage 8).
6. **ReviewLog** gains `step?: number`, `grade?`, `outcome?: 'up' | 'held' | 'forgiven'
   | 'back' | 'down' | 'late' | 'joined' | 'wonBack'`. `result: 'pass' | 'miss'` stays
   for older readers (pass = up/forgiven/wonBack). `stage` keeps the mapped legacy
   value.

## Stage 1 — Ladder and grading logic (pure)

**Local · Opus** (no Firestore, but it's the engine's math; cloud is acceptable if
needed).

- `src/lib/ladder.ts` + `ladder.check.ts` + `npm run check:ladder`:
  - The ladder table (step → interval days, base review count, group, color token
    name), `thoroughness` multiplier (min 2 per step), catch-up targets (3/2/2, then
    lands on Every week).
  - `nextDue(step, anchorDay, clock)`: steps 0–2 by days (`nextDueDateISO`), 3+ on the
    chapter weekday (`nthOccurrenceOfWeekday`, 1/2/4/8 weeks), 6 months as 26 weeks
    on the anchor. Sabbath and pause respected like today.
  - `passageOutcome(grades[])` (grades already decided by stage 1 grading): the Part 1 §4 table (under 12 vs
    12+, blank beats stumbles), `applyOutcome(state, outcome)` (never below review 1 of
    the step; down a step lands at review 1 of the step below; step 0 is the floor).
  - `lateness(state, dueISO, clock)`: missed reviews = full intervals overdue, skipping
    Sabbath/paused days (reuse `computeMissedCycles`' elapsed-day logic), applied by
    moving back within the step.
- `src/lib/grading.ts` + `grading.check.ts` + `npm run check:grading`:
  - Recite/type/Keep going/First words accuracy → grade with `cleanPct`, < 50% or
    revealed = blank, a hint = one stumble.
  - Find the wrong word: misses = unfound swaps + wrong flags + "didn't know the
    replacement"; misses per verse 0–0.49 clean, 0.5–1 stumble, > 1 blank;
    `swapCanBeClean` off → best is a stumble.
  - Self-check: three buttons → grade; every-other rule (`canSelfCheckMoveUp`); spot
    check odds and the 3-word lead-in text from the verse before.
- **Done when:** both checks cover every row of the §4 table, both passage sizes, the
  step floors, lateness across a Sabbath and a pause, each thoroughness preset's
  counts, and the swap thresholds at their edges (0.49, 0.5, 1.0, 1.01).

### As built (stage 1)

- `src/lib/ladder.ts`: `LADDER` (label, intervalDays, baseReviews, group, colorToken,
  `top` on the last step), `LADDER_GROUPS` (names + descriptions), `THOROUGHNESS_PRESETS`,
  `stepReviewCount`, `CATCH_UP_REVIEWS`, `reviewsToMoveUp`, `daysToTop`, `catchUpDays`,
  `nextDue`, `passageOutcome`, `applyOutcome`, `lateness`. `LadderState` is
  `{ step, reviews, catchUp? }`; `reviews` counts reviews done at the step, so "review 1
  of the step" is `reviews: 0`.
- `src/lib/grading.ts`: `gradeRecall` (accuracy 0..1, `cleanPct`, revealed, hinted),
  `swapMisses` + `gradeSwap(misses, verses, swapCanBeClean)`, `gradeSelfCheck`,
  `canSelfCheckMoveUp`, `pickSpotCheck` (every time, one random Got it verse),
  `spotCheckLeadIn`, `spotCheckCanMoveUp`.
- `QueueItem` gained the decision-2 fields and `ReviewGrade` in `src/types.ts` (nothing
  writes them yet). `ReviewLog`'s new fields wait for stage 4.
- `scheduledDaysBetween` in `logicalDate.ts` is the elapsed-day logic pulled out of
  `computeMissedCycles` (which now calls it), so lateness and the old miss count share it.
- Choices made while building:
  - **Thoroughness rounds half up** (Light Every day = 4, Thorough Every day = 11). The
    catch-up's 3/2/2 is the same at every thoroughness.
  - **Time to the top** is calculated (`daysToTop`): Standard 843 days, Light 422,
    Thorough 1265, Navigators 1686. §1's estimates were corrected to match.
  - **Lateness counts whole calendar days** (due 9pm yesterday, 8am today = 1 day late),
    unlike `computeMissedCycles`, which compares exact times.
  - **Find the wrong word grades by rate:** `gradeSwap` takes the misses and the verse
    count of whatever the drill covered and gives every verse in it the same grade
    (0.49 / 0.5 / 1 / 1.01 only make sense as a rate). Stage 5 decides the scope.
  - **A missed spot check holds the whole review** (decided with the user): stage 5
    passes `spotCheckCanMoveUp(passed)` as `passageOutcome`'s `canMoveUp`, together
    with the every-other rule (both must allow it).
- `npm run check:ladder`, `npm run check:grading`.

## Stage 2 — Passages logic (pure)

**Local · Opus.**

- `src/lib/passages.ts` + check + `npm run check:passages`:
  - `passages(queue)`: unbroken runs, translation-separate, learning verses excluded.
  - `reconcile(queue)`: members agree (decision 1); a verse arriving from Learning
    starts a catch-up; joining during a catch-up doesn't restart it; a filled gap
    merges two passages; a reopened top-step passage climbs normally. Returns only
    the items that changed (so writes stay small).
  - `recordGrade(queue, verseId, grade, day)` → sets `dayResult`, applies the outcome
    when the passage is fully covered, returns the changed items + a summary for
    toasts/recap.
  - `settleStaleDays(queue, today)`: penalty-only outcome for passages partly covered
    on an earlier day.
  - `firmUp`: set after a hold/back-one; `winBack(queue, passage, grades)` restores
    when the slipped verses are recited clean the next day (not for step drops).
  - `spreadOverdue(queue, maxReviewCap, clock)`: welcome-back spreading, Settling
    first, then most overdue, each day kept under the review-time cap.
  - Weak-spot `slipped` set/clear.
- **Done when:** the check runs every scenario from the design conversation: join at
  the end and the front, join during a catch-up, gap fill and merge, two translations,
  a single-verse passage, a reopened top passage, partial coverage then day rollover,
  win-back allowed vs. not, and a 19-day absence spread under the cap.

## Stage 3 — Migration (pure + dry run)

**Local · Opus · reads Firestore.**

- `src/lib/ladderMigration.ts` + check + `npm run check:migration`:
  - Per item: daily streak d → step 0 (d < 7), 1 (d < 11), 2 (d < 15), else step 3 at
    0; weekly w → 3 (w < 8), 4 (w < 14), else 5; monthly m → 5 (m < 12), 6 (m < 18),
    else 7; `retained` → 7. An active refresher uses its return phase/progress.
    Keep `nextReviewDueDate` (no lateness, no avalanche).
  - Then `reconcile`: passages whose members disagree take the lowest with a catch-up;
    uniform passages keep their mapped step.
  - Output: new items + a **report** (per passage: old stages → new step, due date).
    Idempotent: items that already have `ladderStep` are left alone.
- A **dev-only dry run** (Settings > developer, or a demo route) that loads the signed-in
  account's queue, runs the migration in memory and shows the report. **Writes
  nothing.** Run it on the test account, then the main account, and read the report
  with the user before stage 4.
- **Done when:** the check covers every mapping row and a mixed-stage chapter; the dry
  run's report on the user's real account looks right to the user.

## Stage 4 — Engine swap and settings

**Local · Opus · writes Firestore.** The riskiest stage; split into two sessions if
it runs long (4a settings + migration run, 4b grading path).

- **4a:** `usePlanSettings` gains the new settings (decision 5), saved to
  `memoryPlans/{uid}`. On load: if `ladderVersion !== 2`, back up the queue (local
  JSON via AsyncStorage + a downloadable export on web), run the stage-3 migration,
  write the changed items in batches (≤ 500 per batch), then set `ladderVersion: 2`
  **last**, so an interrupted run simply re-runs (the migration is idempotent). Then
  `settleStaleDays`, lateness (if on) and `spreadOverdue`.
- **4b:** `useReviewEngine`: `handleReviewCompleted` becomes "grade one verse": Learning
  touches unchanged (graduation still waits for due reviews to clear, then the verse
  joins via `reconcile`); reviewing verses go through `recordGrade`. All changed
  passage members are persisted together (one batch). Practicing ahead (not due)
  stays practice, except a firm-up item. Retire `missPolicy` use, the missed-review
  popup state, refreshers, `dailyPhaseExtensionDays` and `reviewsRequired` in the
  engine (fields left on old docs are ignored, not deleted). Keep `syncChallengeProgress`
  and the activity-feed "verse/chapter reached the top" event (now: reaching every
  6 months).
- `npm run check:appstate`: update the snapshot on purpose for the new keys.
- **Done when:** tsc clean, all checks pass, the test account migrated once (and a
  second load did nothing), a passage reviewed end to end moved up, a stumble held, a
  blank dropped a step, and a partly covered passage got its penalty-only outcome the
  next day. Then the user's main account.

## Stage 5 — Every credit path reports grades

**Local · Opus · writes Firestore** (through the engine). A mistake credits the wrong
verses.

- **Mixed review** (`mix.ts`, `MixedReviewScreen`): `roundCredits` returns per-verse
  grades (stage-1 grading) instead of pass/miss; the "every verse covered" rule now
  lives in the engine (decision 4), so a stopped session needs no special case.
  `todayOrder` sorts by ladder step. The self-check becomes Got it / Stumbled /
  Blanked; the every-other rule hides self-check where it can't count; the spot check
  runs after every self-check with a "Got it"; a miss holds the review.
- **Find the wrong word** (`SpotSwapDrill`): after the check, a Yes/No "knew the
  replacement" per found swap; `onScored` reports misses per verse.
- **Recall, Pick up the thread, Guided learning, First words, Walk the constellation,
  the manual log:** each passes a grade, not success/fail. The manual log becomes a
  self-check (subject to the every-other rule).
- **Done when:** tsc, `check:mix`, `check:guided`, `check:thread`, `check:swap`,
  `check:outline` updated and passing; on the test account, one passage reviewed half
  in Recall and half in Mixed review moved up once, not twice.

## Stage 6 — Showing the ladder

**Cloud OK · Sonnet.** Display only; demo data, no Firestore. Can start once stage 1
has landed (it needs the ladder table and the new `QueueItem` fields), in parallel
with stages 2–5.

- `stageProgress.ts`: `VerseStage` becomes waiting / learning / settling / steady /
  kept (+ the top step flagged within kept), driven by `ladderStep`; update
  `check:stages`.
- Theme tokens: Settling = `stageDaily` green, Steady = `stageWeekly` blue, Kept =
  gold (`stageComplete`), plus top-tier tokens for the halo-and-glint (light and dark).
  Labels stay ink (theme rule).
- `VerseStages.tsx` strip and captions, My Verses by group and by chapter (passage
  rows, the gap note, "Romans 8:21–22 join verses 1–20"), the verse page ladder
  (`VerseRoadScreen`/`VersePageScreen`), the weak-spot dot, Today's review card copy.
- Constellation map: ring colors per group and the halo-and-glint top star in
  `MapDrawing.tsx` (spec in Part 1 §1).
- Match the design canvas boards. Demo harness seeds the new fields
  (`DemoHarness.tsx`) so every screen has a demo.
- **Done when:** tsc, `check:layout`, `check:stages`, screenshots at 1.5× on SE width,
  light and dark.

## Stage 7 — Settings, recap, welcome back, firm-up

**Cloud OK · Sonnet** for the screens, wired to the stage-4/5 engine functions (the
demo stubs them). **Local** for one end-to-end pass on the test account afterwards.

- Settings > Reviews: Thoroughness presets with the per-step table, "Accuracy needed
  for clean" (85–100 by 5), "Late reviews move you back", "Find the wrong word can
  count as a clean review".
- Mixed review recap: per-passage outcome tags (Clean / Held / Forgiven / Back 1 /
  Down a step) with the reason line; "Fix the transitions" (final name TBD) running
  the Seam drill, with a clear **Skip**.
- Today: the "Welcome back" card (spread days), the Firm-up item ("win back a
  review"), late notes on rows.
- **Done when:** tsc, `check:layout`, screenshots; then locally on the test account:
  a stumble → firm-up the next day → review won back.

## Stage 8 — Everything else that reads stages

Mixed: pure projections **Cloud OK · Sonnet**; anything that writes Firestore
**Local · Opus**.

- Projections (cloud OK): `forecast.ts`, `reviewCalendar.ts` + Memory Calendar,
  `retention.ts` load estimates (Review Shield, minutes), Dashboard, `milestones`
  `versesHeld` (past Learning, unchanged meaning), `takeaways` `sectionStatuses`
  ("weekly or later" → Steady or later), `constellations`, `reviewLog` stage mapping.
  Update each one's check.
- Writes (local): `circleTotals` (`isReviewLog` counts the new outcomes; it writes
  `memberStats`), group plans (`useGroupPlans` creates queue items with the new
  fields), challenge progress.
- Retire: `MissPolicySection.tsx`, the missed-review popup, `missPolicy.ts` (after
  nothing imports it), the per-plan phase-length controls in `PlanDesignerScreen` /
  `ActivePlanScreen` / `SavedPlansScreen` (replaced by Settings > Reviews; decide with
  the user what those screens keep).
- **Done when:** tsc, every `npm run check:*` passes, no import of `missPolicy` or
  `retentionPhase` logic left outside the legacy-field mapping.

## Stage 9 — Real phone and release

**Local · Opus**, with the user.

- Ship the new build to every device the user uses before migrating the main
  account (decision 3).
- Real-phone checks: speech grading in Mixed review, the Find the wrong word toggles,
  the spot check, a welcome-back after time away (fake the clock on the test account).
- Main account: dry run report again, then migrate, then confirm My Verses matches the
  report.

## Model and place summary

| Stage | Where | Model |
| --- | --- | --- |
| 1 Ladder + grading logic | Local (cloud acceptable) | Opus |
| 2 Passages logic | Local | Opus |
| 3 Migration + dry run | Local (reads Firestore) | Opus |
| 4 Engine swap + settings | Local (writes Firestore) | Opus |
| 5 Credit paths | Local (writes Firestore) | Opus |
| 6 Showing the ladder | Cloud OK | Sonnet |
| 7 Settings, recap, welcome back | Cloud for screens, local pass | Sonnet |
| 8 Other stage readers | Cloud for projections, local for writes | Sonnet / Opus |
| 9 Real phone + release | Local | Opus |
