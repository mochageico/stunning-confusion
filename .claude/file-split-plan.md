# Splitting the two very large files

Scoped 2026-10-19 on `translation-sources` (tip `74f92c7`).

**Progress:** stages 0 and 1 are done (2026-10-19). `npm run check:appstate` guards
the AppState shape and `npm run check:retention` tests the moved scheduling math.
The pure helpers now live in `src/lib/logicalDate.ts`, `missPolicy.ts`, `retention.ts`
and `appData.ts`. `reviewCalendar.ts` and `forecast.ts` now import the shared day math
instead of keeping their own copies. Next up: stage 2.

| File | Lines | What it is |
|---|---|---|
| `src/state/useAppState.ts` | 7,803 | One hook holding nearly all app state and actions: 159 `useState`, 35 `useEffect`, and a ~300-line return object |
| `src/components/PracticeModals.tsx` | 2,744 | The Listen and Learn practice screen. Both modes live in one component |

No other branch has unmerged edits to either file, so this is a good time. While a
split is in progress, no other session should touch these files, because moving
code around makes merge conflicts very likely.

## The rule that keeps this safe: screens don't change

64 files take `state: AppState` and read fields by name (`state.memoryQueue`,
`state.joinCircle`, …). `DemoHarness` also overrides fields by name. So the split
keeps the **exact same `AppState` shape**. Each piece becomes its own hook that
`useAppState` calls, and the results are spread into the return object.

This pattern already exists in the file and works: `useSocial(...)` and
`usePushNotifications(...)` are called inside `useAppState` with explicit inputs,
and the return starts with `...social, ...push`. Every new hook follows that pattern.

The real work in each chunk is not cutting and pasting. It's finding every
place outside the chunk that reads or sets the chunk's state, and passing that
access in or out explicitly. The biggest offender is `loadUserData`
(see stage 4).

## Guardrails (stage 0, before moving anything)

1. **Key snapshot.** A small check script that lists every key of `AppState`
   and fails if one goes missing or is renamed. Run it after every chunk.
2. **Existing checks.** Run `tsc` and every `npm run check:*` after every chunk.
3. **Screenshots.** Run `npm run shots` before starting and after each stage, then compare.
4. **One commit per chunk**, with the app run between chunks. Nothing changes behavior. If a
   commit needs a behavior change, it becomes its own separate commit.

## useAppState.ts: four stages, easiest first

### Stage 1: pure helpers out (≈700 lines, almost no risk)
These don't touch React state at all and just move to `src/lib/`:
- Missed-review policy (`applyMissToItem`, `describeMissOutcome`, `resolveMissedCycles`,
  `computeMissedCycles`) → `src/lib/missPolicy.ts`
- Day and sabbath math (`getLogicalDate`, `localDayKey`, `advancePastSabbath`,
  `nextOccurrenceOfWeekday`, `countSabbathDaysInRange`, …) → `src/lib/logicalDate.ts`
- Normalizers (`normalizeGroupPlan`, `normalizeAdoptedPlan`, `stripUndefined`,
  `mapQueueItemsToVerseStates`) → `src/lib/normalize.ts`
- Any parts of the review engine that turn out to be pure (`computeNextDueDateForItem`,
  `validateTouch`, `computeDayReviewLoad`, …) → `src/lib/retention.ts`, with a
  new `check:retention` script so the scheduling math gets its own tests.

Keep `isReviewDue`, `resolveChapterAudio` and `buildVerseId` re-exported from
`useAppState.ts` so the files that import them don't change.

### Stage 2: self-contained features (≈1,800 lines, low risk)
Each owns its own state and needs only `user` and `triggerToast` from outside, plus a
few values passed in:
| New hook | Current lines | ≈ size |
|---|---|---|
| `useLocalPrefs` (translation, highlights, doodles, grid columns, studio playback) | 690–830 | 140 |
| `useChapterPhotos` | 840–1075 | 230 |
| `useAudioDownloads` (offline cache, save chapter offline, cache cap, seek) | 4660–4890 | 230 |
| `useRecorder` (record, pause/resume, mark verse taps) | 6522–6622 | 100 |
| `useImportAudio` (import tagging, studio render watching, persistRecording) | 6623–7000 | 380 |
| `useChatCards` (share into chat, recording requests, quizzes) | 7003–7370 | 370 |
| `useAccountabilityNudges` | 2117–2274 | 160 |

### Stage 3: community (≈1,800 lines, medium risk)
These depend on each other more (circles ↔ friends ↔ messaging ↔ group plans), so
pass shared pieces down explicitly:
| New hook | Current lines | ≈ size |
|---|---|---|
| `useFriends` (search, requests, accept/decline, unfriend) | 1878–2116 | 240 |
| `useMessaging` (DMs, circle chat, reactions) | 2275–2431, 2545–2600 | 210 |
| `useChallenges` (1:1 + group challenges, leaderboard) | 2432–2544, 3146–3330 | 300 |
| `useCircles` (load, create, join, leave, disband, members, settings) | 1714–1877, 2600–3100 | 650 |
| `useGroupPlans` | 3097–3140, 3329–3610 | 400 |

Watch for: group plans and challenges add verses to *your* queue
(`addGroupPlanVersesToOwnQueue`, `syncChallengeProgress`), so they need
`updateMemoryQueue` passed in. They must not keep their own copy of the queue.

### Stage 4: the core (≈2,200 lines, highest risk, real user data)
- `usePlans`: plan/designer sync, activate/save/delete plan, pause/resume (1509–1600, 3614–3890)
- `useReviewEngine`: daily pull, add verses, promote, status override,
  `handleReviewCompleted` (356 lines on its own), review sessions, study sessions (4910–6310)
- `useAccount`: `loadUserData` (477 lines), sign out, display name, delete account (3893–4660)

`loadUserData` is the hard part. Right now it loads one document and calls setters
across every feature. After the split, each hook would expose a `hydrate(data)`
function, and `loadUserData` would call those instead of reaching into everyone's
state. Here the "check how many records a write actually touches" rule applies:
any change to how the queue is saved or loaded gets checked against a real account's data first.

**It's fine to stop after stage 3.** By then useAppState would be about 3,000
lines of core review logic, which still makes sense to read as one file.

### Where it ends up
After stage 4, `useAppState.ts` is about 1,200–1,500 lines: core state, navigation,
toast, the computed metrics, wiring the hooks together and the return object.

## PracticeModals.tsx: one component in three parts

It's one component with `type: 'listen' | 'learn'`. All of Listen's logic is
lines 343–1132, all of Learn's is 1133–1700, and the screen layout branches at 1860
(Listen) and 2245 (Learn).

| New file | From | ≈ size |
|---|---|---|
| `PracticeModals.tsx` (shell: modal frame, header, manual-log sheet, minimized bar) | 301–342, 1690–1860 | 400 |
| `practice/useListenPlayback.ts` (playlist, audio player, lock screen controls, photos) | 343–1132 | 800 |
| `practice/ListenPanel.tsx` (Listen layout: verse list, photo layer, controls) | 1860–2244 | 400 |
| `practice/useRecall.ts` (hide level, typed + spoken pointer, strike reset, speech) | 1133–1690 | 550 |
| `practice/RecallPanel.tsx` (mode picker, passage card, input row, drills) | 2245–2744 | 500 |
| `practice/shared.tsx` (`ListenProgress`, `DrillSettings`, `groupPassages`, constants) | 66–300 | 230 |

Watch for:
- **Hooks will only run for the open mode.** Today both modes' hooks run no matter which
  mode is open. After the split, Listen's effects won't run while Learn is open. That's
  mostly good, but the audio-session reset and `onListenPlayingChange` reporting have
  to be checked so they still fire at the right moments.
- **No styling changes while moving code.** On iOS, toggling `shadow-*` classes
  conditionally caused a freeze before. Move the JSX exactly as it is.
- `recitation.alignment.check.ts` simulates PracticeModals' strike-reset branch.
  Point its comments at `useRecall.ts`.
- Needs testing on a real phone: lock-screen controls and background audio (Listen),
  and speech recognition (Recall). The web demo can't exercise those.

Later, separately: Recall has its own copy of graded recitation, while Thread and
Guided share `GradedRecitation.tsx`. Merging them would change behavior (strike
limit, hide levels, first-letter mode), so it doesn't belong in this split.

## Effort and order

| Step | Sessions |
|---|---|
| Stage 0 guardrails + Stage 1 helpers | 1 |
| PracticeModals split | 1–2 |
| Stage 2 self-contained features | 1–2 |
| Stage 3 community | 1–2 |
| Stage 4 core (optional) | 2 |

Do PracticeModals at any point, since it doesn't overlap with useAppState. Run the
two in parallel only if they're on separate branches.
