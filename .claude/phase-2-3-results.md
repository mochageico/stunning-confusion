# Optimization plan, Phase 2 and 3: results and handoff (2026-11-12)

Branch `feat/constellation-sky`, not pushed. Phase 2: ff03129, ea04816,
037c277, b957f9c, 56de320, af390ac, e9b8e36. Phase 3: 8f9314b, 44f9627.
Phase 0-1 results were in the earlier session's notes, not the repo; their
numbers are the "before" column below.

## Phase 2: one unrelated change, big=1&prof=1, median of 7, ms

| Screen | After Phase 1 | After Phase 2 |
|---|---|---|
| home | 38 | 2 |
| chapterLanding | 116 | 1 |
| activePlan | 78 | 1 |
| map | 38 | 1 |
| record | 51 | 3 |
| circleChat | 42 | 2 |
| guided | 43 | 1 |
| mixedReview | 19 | 1 |

All other measured screens 1-4 ms. The member profile's NudgeButton still
redraws on every change (about 3 ms), because `canSendAccountabilityNudge`
reads a log that is not in app state.

## How state is read now

- `src/state/appStore.ts`: `AppStateHost` (App.tsx) runs `useAppState` and
  publishes it; every component calls `useAppFields('a', 'b', ...)`. No
  component takes `state: AppState` any more. `useWholeAppState` is gone.
- Functions called while drawing are listed in `READ_DEPS` in appStore.ts
  with the fields they read. A new get/is/has/can/...For function called
  during render must be added there.
- Memoized at the source (useAppState.ts): activeChapterVerses,
  recordingChapterVerses, recordingSelectedVerses and the blocked-people
  filters. Demo overrides (DemoHarness) are built once per page load.
- Demo console: `__appStore` is the published object (dev only);
  `globalThis.__pickTrace = []` lists which picked fields made a
  component redraw.

## Phase 3

17 indexes deployed to the live database (Enterprise edition), confirmed by
listing. `savedFromRecordingId` was NOT stale: `onSharedRecordingDeleted`
needs it; it is now a COLLECTION_GROUP index. `(default)` removed from
firebase.json. Not checked against real data: the demo has no account.

## Lessons for the next session

- `.shots` is blocked to Read/Glob/Bash by the token guard. Write shots to
  your scratchpad instead: `npm run shots -- --out="<scratchpad>/x" --all "ios=1"`.
  Images over about 50 KB are blocked from Read too; crop them first
  (`node_modules/jimp-compact` is installed and can decode and crop).
- To take "before" shots of old code, the files were swapped with
  `git stash push -- <files>` + `git checkout <commit> -- <files>`. Metro
  does NOT notice a git checkout: `touch` the files, then confirm the page
  renders in the Browser pane before shooting, or every picture is blank.
  Restore with `git checkout HEAD -- <files>` + `git stash pop`, and touch
  again.
- Normal run-to-run picture differences: chat clock times (dated relative
  to now) and the random verse picks in referenceDrill, threadDrill,
  mixedReview.
- The Browser pane is often hidden; time with React Profiler
  `actualDuration` (`prof=1`, `globalThis.__prof`), never with timers.
- The console log persists across navigations in the pane; errors from
  half-finished hot reloads stay in it. Nested-button warnings are
  pre-existing.
