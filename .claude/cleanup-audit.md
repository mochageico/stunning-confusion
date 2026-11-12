# Cleanup audit — 2026-11-11

Looked at on `main` (commit 0b15e5d). Nothing in the app was changed by this audit.

## What was checked

- Type check of the app and of the cloud functions: both pass.
- All 39 `check:` scripts: all pass.
- Every demo screen (about 48, `?s=<screen>` on web): all open with no crash.
- A search for files nothing uses, exported code nothing uses, app-state fields no screen reads, unused variables, dead buttons, unreachable screens and pop-ups that are never opened.
- Cloud functions against what the app calls, database rules against what the app reads, installed packages against what Expo expects.

Not checked: anything that needs a real phone or a signed-in account (audio, speech, push, sign-in, uploads).

## Broken

Nothing plainly broken was found, so nothing was fixed.

Two things look wrong but are harmless today:

- **Web only: buttons inside buttons.** A tappable row that holds its own small button (the "More" dots on a verse row, Play on a recording row, Accept on a friend request, Open on a circle) logs an error in the web preview. Phones are not affected.
- **The demo's "Find a circle" page logs "Missing or insufficient permissions".** The demo has no signed-in user, so this is expected.

## Unfinished or out of date

1. **`README.md` is from July** and is wrong in several places: it says the recorder is simulated, that the app is local-first and runs in Expo Go, and that the old web app is kept for reference.
2. **Eight Expo packages are one patch behind** what this Expo version expects (expo, expo-asset, expo-constants, expo-dev-client, expo-image-manipulator, expo-image-picker, expo-notifications, expo-updates). Run `npx expo install --fix` before the next store build. Do not do it between builds: it changes native code, so an over-the-air update could not carry it.
3. **`firebase.json` lists a second database called `(default)` that does not exist.** Only the `ai-studio-…` database is real. The extra entry can go.
4. **`firestore.indexes.json` describes an index that is not on the live database**, and no code uses it any more (`savedFromRecordingId` on recordings). See optimization 2 before deleting it.
5. **The type check also covers the audio-testing folder**, which is not part of the app. Add it to `exclude` in `tsconfig.json`.

## Unnecessary — your call on each

### Leftover files and folders

| What | Size | Notes |
|---|---|---|
| `legacy-web/` | 19 files, about 700 KB | The original web prototype. Nothing uses it. |
| `CONVERSION_GUIDE.md` | 187 lines | Instructions for the web-to-phone port, finished in July. |
| `little command to run it.txt` | 1 line | A note holding one command. Could move into the README. |
| `firebase-blueprint.json` | small | Left by Google AI Studio. Only the README mentions it. |
| `dist/` | 36 MB | An old export from Nov 3. Not in git; safe to delete, it is rebuilt when needed. |
| `functions/bin/deep-filter.exe` | 26 MB | Not in git and not deployed. Keep if you still run the audio cleanup on this PC. |
| `scripts/bsb-audio/sources` and `work` | 6.8 GB | Downloaded and half-processed BSB audio. Not in git. Delete once you are sure no re-upload is needed. |
| `scripts/hebrew-audio/sources` and `work` | 865 MB | Same, for the Hebrew audio. |
| `scripts/import-bible/sources`, `kjv.json`, `web.xml`, `engbsb_usfx.xml` | 125 MB+ | Bible source files from the import. |
| `scripts/*/timings/` | 2,122 files in git | Per-chapter timing files, including two check files of about 150,000 lines each. They make up most of the repo's file count. Keep only if you expect to rebuild the timings. |
| One-off scripts in `scripts/import-bible/` | 8 files | `restore-memorized-queue`, `undo-restore-memorized-queue`, `migrate-social-security`, `fix-short-copyright`, `cleanup-orphan-recordings`, `diagnose-format`, `diagnose-raw`, `test-parse`. Each was written for one past repair. |
| `scripts/list-api-bibles.cjs` | 1 file | Nothing refers to it. |

### Plan documents for finished work

These plans are built and shipped, by your notes: `CONSTELLATION_PLAN.md`, `HEBREW_GREEK_PLAN.md`, `HEBREW_AUDIO_PLAN.md`, `MIXED_REVIEW_PLAN.md`, `OFFLINE_MODE_PLAN.md`, `REVIEW_LADDER_PLAN.md`, `SOCIAL_FEATURES.md`, `SOCIAL_SECURITY_TEST_PLAN.md`, `.claude/file-split-plan.md`, `.claude/ui-polish-plan.md`, `.claude/ui-redesign-plan.md`. Together about 4,000 lines. They could move to one `docs/done/` folder.

Still live: `BIBLE_PHOTOS_PLAN.md`, `BSB_AUDIO_PLAN.md`, `SPEECH_SECOND_PASS_PLAN.md`, `LAUNCH_CHECKLIST.md`, `.claude/ui-simplify-plan.md`, `PRIVACY.md`, `DATA_LICENSES.md`.

### Old git branches

There are 28 local branches. 26 are fully merged into `main` and can be deleted. Two are not merged: `claude/jolly-sutherland-4afdb2` and `feat/bsb-audio-stage6`. Look at those before deleting.

### Packages that look unused

- `prettier-plugin-tailwindcss`: there is no Prettier installed or configured, so this does nothing.
- `@expo/ngrok`: only needed for `expo start --tunnel`. Keep if you use that.

### Code nothing uses

> **Done 2026-11-12** (on `feat/constellation-sky`, uncommitted): the 5 unused pieces, 2 of the 3 unused types, 39 state fields (459 → 420), the unused imports and variables, and 6 launch messages were removed. Left in place: the 15 check-only helpers, the 3 demo seed helpers, `GroupChallengeMembership` (it documents saved data), 4 debug messages that only print on rare events (offline recovery, ladder migration), the `import React` lines, and `explainer` in `VersePageScreen.tsx` (see the reply for why).

**Whole pieces that are never used (5):**

- `NextSevenDays` in `src/components/TodayCards.tsx` — left behind when "Next 7 days" came out of the Today menu.
- `CardHeader` in `src/components/design.tsx`.
- `PulseView` in `src/components/ui.tsx`.
- `starHeld` in `src/lib/mapWalk.ts`.
- `describeSpeechRecording` in `src/lib/speechRecording.ts`.

**Unused types (3):** `BuildUpRep` (drills), `CalendarOpts` (ladderCalendar), `GroupChallengeMembership` (types).

**Used only by a check script, never by the app (15):** `PICKER_TRANSLATIONS`, `userConstellations`, `echoVisible`, `englishSwapClasses`, `spotCheckCanMoveUp`, `catchUpDays`, `hasLibraryAudio`, `isLibraryRecording`, `echoGhost`, `nextLine`, `landmarkText`, `heldDates`, `landmarkDates`, `runResultsInOrder`, `confirmIds`. Some may be waiting for a feature (the map's echoes and milestones); the rest can go together with their checks.

**App-state fields no screen reads (50 of 454).** Removing these needs `npm run -s check:appstate -- --update` afterwards.

- Never used at all: `activeFeedFilter`, `setActiveFeedFilter`, `typedRecordingName`, `setTypedRecordingName`.
- Computed but never shown: `memorizedPercent`, `totalVersesCount`, `untouchedCount`, `reviewNotes`, `getMemoryLoadForecast`, `clearSlipped`, `loadingAccountabilityNudges`, `loadingActiveChallenges`, `loadingFriends`, `loadingMyCircles`.
- Used inside the state code but handed to screens for no reason (the screens never call them): `activeGroupId`, `loadActiveCircleData`, `loadCircleFriends`, `loadFriendRequests`, `loadFriends`, `loadMyCircles`, `loadReceivedAccountabilityNudges`, `loadSharedRecordings`, `unregisterPushToken`, and 23 raw setters (`setActiveModal`, `setBackHistory`, `setCurrentScreen`, `setCurrentTab`, `setUser`, `setMemoryQueue`, `setUserRecordings`, `setFeedRecordings`, `setModalVerses`, `setSelectedBook`, `setSelectedChapter`, `setSelectedUserProfile`, `setIsRecording`, `setRecordingSeconds`, `setPausedAt`, `setPausedUntil`, `setDayStartHour`, `setLearningDays`, `setNewVersesPace`, `setMaxReviewCap`, `setSabbathDay`, `setSabbathEnabled`, `setCognitiveLoadSensitivity`, `setGuidedShakyJoins`).
- Demo-only helpers: `seedCircleDaily`, `seedCircleStats`, `seedCircleTakeaways`. Only the demo mode calls them, so keep them.

**Small leftovers:** 92 unused imports and variables across about 30 files (most in `SettingsScreen`, `DashboardScreen`, `ActivePlanScreen`, `ThreadDrillScreen`, `ReferenceDrillScreen`, `RecordingDetailScreen`, `GuidedLearningScreen`, `App.tsx`). Harmless. `npx tsc --noEmit -p . --noUnusedLocals --noUnusedParameters` lists them.

**Debug messages:** 10 `console.log` lines in `useAppState.ts` that print on every launch ("loadUserData started…", "User data fetched…").

**Developer tools shipped inside the app:** `DemoHarness`, `BlocksGallery`, `RecapGallery`, `DevLayoutLab` and `LadderDryRun` (about 3,000 lines) are switched off outside development but still travel in the app bundle. Small cost; covered in optimization 3.

## Large optimizations — plan

In order of how much they are worth. Each one stands alone.

### 1. Stop the whole screen redrawing on every state change

**Problem.** All 454 state fields come from one hook, `useAppState`, and `App.tsx` passes the whole thing to the open screen. Any change anywhere redraws the open screen. The clearest case: while recording, a one-second timer (`recordingSeconds` in `useRecorder`) redraws the whole app every second, though only the Record screen shows the number. The community tab also refreshes every 30 seconds.

**Plan.**

1. Measure first. Wrap the open screen in a React `<Profiler>` in demo mode with `big=1` and write down which state changes fire while recording, reviewing, typing and sitting on the Community tab.
2. Move the fast-changing values out of app state into small stores that only the screens showing them listen to. `toastStore` and `playbackProgress` already work this way. First candidates: `recordingSeconds`, the chat message lists, the 30-second community refresh results.
3. Remove the 50 unread fields above so the object is smaller and the snapshot check is easier to read.
4. Give each screen only the slice it uses, one tab at a time (Today, Verses, Audio, Community, Me), and wrap the screens in `React.memo` so an unrelated change skips them.
5. Check after each step with `check:appstate`, the demo screens and a Profiler run. Stop when recording and typing no longer redraw the screen.

**Risk.** Medium. Step 2 is small and safe. Step 4 touches every screen, so do it tab by tab.

### 2. Database lookups before launch

**Problem.** The live database is the Enterprise kind and has no indexes at all. Queries still work, but as I understand that edition, a query with no index reads through the whole collection. With two users this costs nothing. With many users, these five get slower and cost more with every row anyone adds: the direct-message list, the shared-recordings feed, the activity feed, nudges, and friend search by name.

**Plan.**

1. Confirm it. Run each of the five queries with Query Explain in the Firebase console and see whether it scans the whole collection.
2. Write the five indexes into `firestore.indexes.json` (and drop the stale `savedFromRecordingId` entry).
3. Deploy with `npx firebase-tools deploy --only firestore:indexes --non-interactive`, when you ask for it.
4. Add this to `LAUNCH_CHECKLIST.md`.

**Risk.** Low. Indexes only make reads cheaper.

### 3. Faster launch

**Problem.** `App.tsx` loads all 41 screens and the developer galleries before the first screen appears, and waits for 14 font files.

**Plan.**

1. Measure launch time on the phone first; the earlier work found about 1.5 seconds, so this may not be worth doing.
2. Load rarely used screens only when opened (map, community sub-screens, settings pages, drills).
3. Load the developer tools only in development builds.

**Risk.** Low. **Worth.** Small unless the measurement says otherwise.

### 4. Verse history — not a problem (corrected 2026-11-12)

The first version of this audit said practice history grows without limit. That was wrong. `touchLogs` only grows while a verse is being learned, and `reviewLogs` is capped at 500 per verse. Nothing to do.

The detailed plan for items 1 to 3 is in `.claude/optimization-plan.md`.

### 5. Repo size and tidiness

Not a speed gain in the app, but the 2,122 timing files and the 4,000 lines of finished plans slow down every search through the project. Deleting or moving the items in "Unnecessary" above is the whole plan.
