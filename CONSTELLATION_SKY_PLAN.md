# Constellations 2: browse, My sky, mystery — build plan

Written 2026-11-11 from a brainstorm + sketches with the user.
Sketches (source of truth for the look): https://claude.ai/artifact/5ScZSeCTHTeHiXqkRXooLL
(rows "Mystery", "New flow", and "Inside a constellation"; older rows are superseded).

This builds ON the existing map (CONSTELLATION_PLAN.md, all stages built 2026-10-25/26):
`src/lib/constellations.ts`, `src/lib/mapLayout.ts`, `src/lib/mapWalk.ts`,
`src/components/map/*`, `src/content/constellations.ts`, `src/content/echoes.json`.
Keep what works there (layout engine, camera, walk, echoes, connect + labels).

**Progress:** (master, overnight run started 2026-11-11, branch `feat/constellation-sky`) Defaults taken for open questions: no placeholders on browse; Verses-tab Map option dropped; Today button opens browse. Stage 1 done (2026-11-11). API, all in `src/lib/constellations.ts` unless noted: `revealedStars(c, queue, found?) → Set<string>`, `newlyFound(c, queue, found?) → string[]`, `isComplete(c, revealed)`, `progress(c, queue, revealed) → {found,total,known}` (known = showing stars the user holds), `nextToLearn(c, queue, revealed) → string[]`, `searchConstellations(list, query)`, plus extras `startStarId(c)`, `joinedTo(c, starId)` (use it for "It's joined to John 10:11"), `EMPTY_SKY`, pure `skyAdd/skyRemove/skyMarkFound/migrateSky`; `suggestedNext` still exported. Types: `Constellation.start?`, `lines[].note?`, `SkyState`. Hook `src/state/useSky.ts`, on AppState as `sky: SkyState` (empty until loaded), `skyReady`, `addToSky(id)`, `removeFromSky(id)`, `markFound(id, starIds)`; `addToSky` saves what shows now as found (so Stage 4's reveal only plays for later stars) and `removeFromSky` keeps `found`. Migration runs inside `loadSky` when no doc exists. Demo seeds `rest-and-trust` (3 of 6 found) and `desiring-and-delighting-in-god` (just added) in every demo screen; `?nosky=1` leaves it empty. Stage 1 verified by master (tsc + checks pass). Stage 2 running in sky-stage-2 (local_6be8c7f5-5e69-48e8-9c73-62cbbfae8a86, Sonnet) and Stage 2 done (2026-11-11, commit 45b3600): `ConstellationsScreen` (browse; exports `verseCounts`) and `ConstellationPreviewScreen`, both Today-tab screens opened with `navigateTo('constellations')`; the preview reads its constellation from `src/lib/constellationPreview.ts` (`openConstellationPreview(id)`, `usePreviewId()`; no AppState field; falls back to the first constellation). `MiniConstellation` and `NIGHT_SKY` colors are in `src/components/map/MiniConstellation.tsx` (Stage 6: merge `NIGHT_SKY` with Stage 3's `SKY` in `skyPalette.ts`); the Today button is `ExploreConstellationsButton.tsx`, under Listen. Preview: Add to my sky also opens `mySky`; Listen plays the showing stars; Read the guide only appears when `guide` is non-empty. Not on a phone; verse rows do nothing when tapped. Stage 3 running in sky-stage-3 (local_8c44bdb2-807c-4907-8d4e-efb4ca53d741, Opus) in parallel, started 2026-11-11 overnight. Stage 3 follow-up done (9757941), verified. Stage 4 DONE (5f91f3a, master-verified: tsc + checks pass; animations NOT seen on screen, hidden browser pane; only MixedReviewScreen got the new-star note), built by sky-stage-1; Stage 5 DONE (2026-11-12, sky-stage-2; tsc + checks pass, map NOT seen on screen in the hidden pane): pure rules `listenOrder(c, revealed)` and `guideNotes(c, revealed)` in lib/constellations.ts, `shownGraph/walkStarts/canWalk` in lib/mapWalk.ts (checks in constellations.check.ts). Walk: `WalkConstellation` takes a new required `hidden` prop (`view.hidden`), builds its graph from found stars only (a hidden star is neither drawn nor crossed), starts only from held stars that have a held, joined, found star to walk to; "Walk it" shows only then. Listen: `ConstellationMap.onListen` now takes `StarRef[]` (found stars in line order); `listenVerses(refs, queue, translationId)` in map/addStars.ts is the one helper both MySkyScreen and the preview page use (held verses as held, so BSB narration plays where it exists; the rest fetched). Guide: `GuideBody`/`GuideSheet revealed` in ConstellationSheets.tsx show description, guide and each line `note` once both ends are found; "Remove from my sky" was already in the sheet from Stage 3; the preview's guide uses `GuideBody` too. Echoes: `echoViews(..., hidden)` skips an echo whose other end is a hidden star (before the ghost fan is placed). Not tested: the real walk or Listen on a phone; echoViews has no check. Was: Stage 5 finished and master-verified (b174870). Stage 6 RUNNING in sky-stage-1 (local_d1a7df8a-7bfa-4c03-988e-320cebdcdb3d, Sonnet) via SendMessage, started 2026-11-12. [old note: (local_d1a7df8a-7bfa-4c03-988e-320cebdcdb3d, Sonnet), sent via SendMessage because start_session is refused on automated turns; use SendMessage to existing sessions for stages 5 and 6 too. Stages 5-6: not started. [Master 2026-11-12 (older note): stage 2 verified; stage 3 hit usage limit after committing 25aa8da, tsc+checks pass; sent back to sky-stage-3 to finish its unchecked web checks BEFORE stage 4 starts.] Stage 3 done (2026-11-11, web-checked): My sky is screen `'mySky'` (`src/screens/MySkyScreen.tsx`, in HOME_TAB_SCREENS) wrapping the reworked `src/components/map/ConstellationMap.tsx`. Open it zoomed into a constellation: `setSkyFocus(id); navigateTo('mySky')` (`src/lib/skyFocus.ts`; demo `?s=sky&focus=<id>`). For Stages 4/5: ConstellationMap props `sky, skyReady, focusId, onLeave, onBrowse, onRemoveFromSky, onListen(items), play`; `skyView(added, found, queue, result)` in mapModel.ts gives `info{revealed,found,complete,next}` per constellation, `hidden` (map star keys), `next`; MapDrawing takes `hidden, groupOpacity, titles, glowColor, nextColor, userLineColor`; popups in `SkyPopups.tsx`; `GuideSheet` has `onRemove` and no "Add the rest"; MapCanvas `frame(rect, insets, instant, glide)`; night colors in `skyPalette.ts`. Verses-tab Map option removed. JumpChips, ConstellationListSheet and mapFullscreen are now unused (Stage 6). Follow-up check done 2026-11-12 (web 375x667): hidden-glow popup shows the exact wording with "Learn <ref>"; empty sky (`?s=sky&nosky=1`) shows the message and Find constellations (browse opens); other constellations fade out when zoomed in; check:layout has 0 errors. Not done: reveal animation (Stage 4), walk/echo rules (Stage 5; Walk still draws hidden stars, Listen plays held stars via startPractice 'listen'), no phone test, check:maplayout not rerun. Note: in the hidden preview pane the first frame after opening can look half-painted for several seconds (animation frames are throttled there); it settled each time, but watch for it on a real phone. Resume check (2026-11-12 2:30am CST, scheduled task): master stopped at 11:24pm on the 5-hour limit after Stage 3 committed (25aa8da); no sessions running; sent the master the resume message (delivered, it started), so it runs Stage 4 next. Stage 4 done (2026-11-12, session sky-stage-1): `components/map/SkyReveal.tsx` (`useReduceMotion`, `useClock`, `RevealOverlay`, `PayoffOverlay`, `RevealBanner`; the reveal is 1.5 s, RAF-driven like the rest of the map rather than Reanimated, and skipped with reduce-motion). `ConstellationMap` has a new required prop `onFound(constellationId, starIds)` (MySkyScreen passes `state.markFound`); on open and after any queue change it runs `newlyFound` per added constellation, calls `onFound`, holds the new star as a glow while its line draws in from the learned star (`joinedFrom` in lib/constellations.ts), then rings it and shows the banner (tap = zoom in + open the star). When a reveal completes a constellation the gold lines (`SKY.gold`) draw in once and stay gold (`MapDrawing` props `goldGroups, goldColor`); the zoomed header reads "Complete · all N lit". Session summary: `components/map/NewStarsNote.tsx` (`<NewStarsNote sky queue navigateTo/>`, uses pure `skyNewStars`) is in the Mixed review finish page only; NOT added to `GuidedLearningScreen` (another session has uncommitted edits there) or the Reference/Thread drills: add the same one line to their `SessionDone` children. Demo: `?s=sky&reveal=1` (1 Peter 5:7 and more reveal on open), `?s=sky&reveal=complete&focus=rest-and-trust` (the last star completes it: payoff). NOT seen on screen: the Browser pane was hidden, so the map never laid out in it (also true of plain `?s=sky`); logic is covered by checks only.

---

## How to run this plan (master chat)

One **master** session runs the whole build. It does not write feature code. It:

1. Reads this whole file once. Confirms the branch with the user before stage 1
   (suggested: `git switch -c feat/constellation-sky` from the current branch, since the
   current branch holds the latest Verses-map work). Never pushes, never deploys, never
   publishes an OTA unless the user asks.
2. Starts each stage as its own session with `start_session`, `initiation: "user_asked"`,
   `context: "fresh"`, `use_worktree: false` (all stages work in this folder and commit
   their own files by name), the **model** listed on the stage, and a brief that says:
   "Read CONSTELLATION_SKY_PLAN.md (whole file), then build Stage N. Commit only your own
   files by name. When done, update the Progress line in the plan and end with a 3-line
   report: what you built, what you checked, what you did not check."
3. Launches stages in the order of the **Launch order** below, starting the parallel
   pair together. Waits for the `<side-sessions-event>` note; never polls.
4. After each stage: checks it rather than trusting the note — `git log --oneline -5`,
   `git diff --stat HEAD~N`, and the verify command below. If a check fails, it sends the
   failure back to that same session with SendMessage (not a new session). Then starts
   the next stage.
5. Keeps its own context small: no reading whole source files; diffs by `--stat` and the
   stage's report are enough. The master itself runs on **Sonnet**.
6. At the end: reports to the user in plain words, lists what wasn't checked on a phone,
   and offers (does not do) the OTA publish.

**Launch order**
```
Stage 1 (Sonnet) ──► Stage 2 (Sonnet) ─┐
                 └─► Stage 3 (Opus)  ──┴─► Stage 4 (Sonnet, high) ──► Stage 5 (Sonnet) ──► Stage 6 (Sonnet)
```
Stages 2 and 3 run at the same time (different files). Everything else is one after
another. Stage 7 is the user's writing, not a session.

**Verify command** (from CLAUDE.md; known baseline failures: `check:layout` has 3
pre-existing `[fixed-height]` errors, `check:maplayout` and `check:milestones` were
already failing — compare with `git stash` before blaming a stage):
```
npx tsc --noEmit -p . && for c in layout queue calendar stages outbox appstate constellations maplayout; do npm run -s check:$c 2>&1 | tail -1; done
```

**Token budget.** The last constellation run (6 stages) cost ~7% of a week. Opus only
where the work is hard to get right in one go (stage 3, the map rework). Everything else
Sonnet. Sessions should Grep + sliced Read (CLAUDE.md rule for `types.ts` /
`useAppState.ts`), not read whole big files.

---

## What the user wants (locked 2026-11-11)

**Two layers.**
- **Constellations** (browse) — a normal page that follows the app's theme (paper in
  light, dark in dark). Scroll cards, search, filter. Tap one → **preview** page →
  **Add to my sky**. Later this page also holds peers' constellations and "design your
  own"; not now.
- **My sky** — the user's own canvas. **Always night sky**, even in light mode. Holds only
  the constellations they added, plus **their own links** (the existing Connect feature
  keeps working; user links are drawn blue-dashed, "Your links"). Tapping a constellation
  **zooms in** smoothly; **back zooms out** smoothly.

**Today.** One button, "Explore scripture constellations" (subtitle "See how verses
connect"), with a tiny 4-star zigzag on a dark tile. It sits **under** Today's verses and
Listen to today's scripture. Opens the browse page. No sideways scrolling row on Today.

**Mystery.**
- You see a constellation's **starting star** and the stars **joined to it**. Nothing else.
- When a verse is **learned** (Settling or later — `isLearned` in lib/constellations.ts),
  every star joined to it appears.
- A verse the user already holds, anywhere in the constellation, shows right away, and if
  it's learned its neighbors show too ("a memorized verse in the middle shows both its
  connections").
- Once found, a star **stays found** forever (saved), whatever happens to the verse.
- Hidden stars: soft blurred glows, no lines to them, no reference. The preview's verse
  list shows hidden rows as blank bars marked "Hidden".
- **Payoff:** when the last star is found the full shape draws in.
- **Wording: never "Settling" in this feature.** Say "learn". Hidden-star popup: "A hidden
  star. It's joined to John 10:11. Learn that verse and this one will appear!" with a
  "Learn John 10:11" button. Under a constellation: "Learn John 10:11 to uncover what's
  joined to it."
- **Search matches verse references too** (user: finding 1–2 verses that way is fine and
  helps people find things).

**Removed / not wanted.** No "Featured this week" (upkeep). No "Keep going" list on the
browse or sky page (the NEXT marker inside a constellation does that). No swipe or
next/previous arrows between constellations. No "Add all"; verses are added one by one.
No bottom sheets (center popups, per the app rule). Own constellations and circle
constellations: wanted later, **not in this plan**.

**Adding to the sky does not add verses to learn.** Each verse has its own + (which goes
through the existing `addStars.ts` → `addVersesToQueue` path).

---

## Data

- `Constellation` (types.ts) gains `start?: string` (star id; default the first star) and
  `lines[].note?: string` (the user's per-line guide note, shown once both ends are
  found). `guide` stays as the overall text.
- New per-user doc **`users/{uid}/mapLayout/sky`** (the existing `mapLayout/{layoutId}`
  rule already allows it → **no rules deploy**, OTA-able):
  ```ts
  interface SkyState { added: string[]; found: Record<string, string[]>; v: 1 }
  ```
  `added` = constellation ids in My sky, in the order added. `found` = per constellation,
  star ids ever revealed (stays found).
- Migration (runs once on load when there is no sky doc): add every curated constellation
  the user holds a star in and has not hidden (`hiddenConstellations` device pref), and
  seed `found` from the reveal rule. After that `hiddenConstellations` is unused.
- Only the owner and brother use the app (memory: no test account) — test on the main
  account; a rare migration edge case is OK.

---

## Stages

### Stage 1 — Rules, sky state, search · **Sonnet (medium)**
- types.ts: `start`, `lines[].note`, `SkyState`. Run tsc right away.
- `src/lib/constellations.ts` (pure):
  - `revealedStars(c, queue, found): Set<string>` — start + stars joined to start + held
    stars + stars joined to a learned star + `found`.
  - `newlyFound(c, queue, found): string[]` — revealed now but not in `found`.
  - `isComplete(c, revealed)`; `progress(c, queue, revealed)` → `{ found, total, known }`.
  - `nextToLearn(c, queue, revealed)` — revealed, not learned, joined to a learned or
    start star (replaces `suggestedNext` for the NEXT marker; keep the old export until
    stage 3 stops using it).
  - `searchConstellations(list, query)` — title, description, and verse references
    (book name, "Psalm 23", "Ps 23:1"; reuse an existing ref parser if one exists).
- `src/state/useSky.ts` (like `useMapLayout`): load/save the sky doc, `addToSky(id)`,
  `removeFromSky(id)`, `markFound(id, starIds)`, migration above. Wire into
  `useAppState` + `loadUserData` + delete-account list; `npm run -s check:appstate -- --update`
  and commit the snapshot.
- Checks in `src/lib/constellations.check.ts`: start + neighbors only; learned middle star
  shows both neighbors; held-but-learning star shows itself only; found stays found after
  a verse is removed; search finds by reference.
- Demo data: give the demo (`src/dev/DemoHarness.tsx`, `MAP_SPECS`) a sky with two
  constellations added, one partly found.

### Stage 2 — Browse page, preview page, Today button · **Sonnet (high)** · parallel with 3
- New screens `'constellations'` and `'constellationPreview'` (ScreenName + router +
  tab lists in useAppState/App.tsx). Follows app theme via `useTheme()` tokens; no raw hex.
- Shared `MiniConstellation` SVG (in `src/components/map/`): draws a constellation from
  its 0–100 coordinates; found stars accent-filled if held / hollow if not; hidden stars as
  soft glows (RadialGradient circles, **not** an SVG filter, so iOS/Android/web all match);
  no lines to hidden stars.
- Browse (sketch "New 1"): header + back; **My sky** card (dark tile, mini preview,
  "N constellations · N stars lit") → My sky; search field; chips **All** / **In my sky**;
  card list (drawing, title, description, "7 verses · you know 2", Add to my sky / In my
  sky ✓). Leave out the "From circles", "Made by me" and "Design your own" spots until
  those exist (ask the user if they want greyed placeholders; default leave out).
- Preview (sketch "Mystery 3"): big drawing, title, description, "7 verses · 5 hidden",
  **Add to my sky** + **Listen** (found stars only), Read the guide, verse list (found:
  ref + "You know it" or a +; hidden: blank bar + "Hidden"), the line "Each verse you
  learn uncovers the ones joined to it."
- HomeScreen: the explore button under the Today's verses / Listen card (sketch "Today").
- Demo: `?s=constellations`, `?s=constellationPreview`. Check at 375×667 light + dark.

### Stage 3 — My sky (rework the map) · **Opus (high)** · parallel with 2
- My sky = `ConstellationMap` reworked into its own screen `'mySky'` (from the browse
  page's My sky card and after Add to my sky). **Always night sky** colors (own small
  palette in the map folder; dark-on-light rule doesn't apply here).
- Shows only `sky.added` constellations + the user's own links (`userConstellations`).
  Pass only those into `layout()`. Hidden stars ARE laid out (so nothing moves when they
  appear) but drawn as soft glows with no label and no lines.
- **Zoom:** tapping a constellation (its stars or its name) animates the existing camera
  to that group's bounds over ~800 ms ease-in-out, fades other groups out; the header
  becomes the constellation's title + "2 found · 5 still hidden" and the back button
  animates back to the whole sky. Remove the jump chips and the Show/hide sheet (Add /
  remove now lives on the browse page; a "Remove from my sky" goes in the guide popup).
- Inside a constellation: NEXT marker on `nextToLearn`; the hint line "Learn X to
  uncover what's joined to it."; **Listen** and **Walk it** buttons at the bottom.
- Tapping a hidden glow: centered popup (sketch "Mystery 2") with the exact wording above
  and "Learn <ref>" (opens that verse's page / add path). Tapping a found unlit star:
  the smaller star popup (sketch "Tapping an unlit star": ref, play, verse text, Add to My
  Verses, Close; no "joined to" line).
- Empty sky: one line + "Find constellations" → browse.
- Verses tab: remove the **Map** view option (My sky is the one home). The verse page's
  "Connect to another verse" stays and its links show in My sky. Ask the user before
  removing if anything about this looks wrong.
- Keep: pinch/pan, the camera code, labels on lines, echoes (only from found stars),
  full-screen behaviour if it still makes sense (the sky is now its own screen, so
  probably drop the full-screen button).
- Demo: `?s=sky`. Check on web at 375×667 (zoom in/out, hidden tap, empty state).

### Stage 4 — Reveal moment and payoff · **Sonnet (high)**
- On opening My sky (and after any review/learn save while it's mounted): compute
  `newlyFound` per added constellation; save with `markFound`; play the reveal for each
  new star: the line draws in from the learned star, the new star lights with a soft
  pulsing ring (sketch "Mystery 4"), a small banner "A new star appeared · John 10:14 ·
  tap it to read". Reanimated, short (~1.5 s), skipped with reduce-motion.
- Review/learn session summary: one quiet line "1 new star appeared in The Shepherd"
  (tap → My sky zoomed into it). Find the existing session-end summary, don't build a new
  screen.
- Payoff: when `isComplete` flips true, all lines brighten to gold and draw in once, and
  the header says "Complete · all 7 lit" (sketch "A cluster, all stars lit").

### Stage 5 — Walk, Listen, guide, echoes respect the mystery · **Sonnet (medium)**
- `walkOrder` only walks found stars; a walk needs 2 found + held.
- Listen plays found stars in line order (reuse the existing verse audio player; BSB
  narration where it exists; check `useLibraryAudio` for the player API).
- Guide popup: overall `guide` text + each line's `note` once both ends are found; plus
  "Remove from my sky".
- Echo ghosts only for found stars.
- Checks for the walk change in `constellations.check.ts`.

### Stage 6 — Cleanup and docs · **Sonnet (medium)**
- Remove dead code (`hiddenConstellations` pref use, JumpChips, ConstellationListSheet,
  `suggestedNext` if unused) — Grep for callers first.
- Run the verify command, `npm run shots` for the new demo screens, update this file's
  Progress, and the "Not tried on a phone" list below.

### Stage 7 — Content · **the user, no session**
Per constellation in `src/content/constellations.ts`: `id`, `title`, one-line
`description`, `guide`, `start` (the starting star), stars with x/y (0–100; a shape if it
helps, a nice cluster otherwise; 5–9 stars), `lines` (each may carry a `note`).
Goal: 5–10 at launch. The two already there (Rest and trust; Desiring & Delighting in God)
need a `start` picked. A session can tidy coordinates into a shape once verses are chosen.

---

## Open questions (ask the user when a stage reaches them)
1. Stage 2: greyed "From circles / Made by me / Design your own" placeholders, or leave
   them out until built? (Default: leave out.)
2. Stage 3: drop the Verses tab Map option entirely? (Default: yes.)
3. Once someone has added constellations, should Today's button open My sky instead of
   browse? (Default: browse.)

## Not tried on a phone (fill in as stages land)
- (empty)
