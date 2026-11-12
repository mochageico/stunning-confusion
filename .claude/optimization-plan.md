# Optimization plan

Written 2026-11-12 for a Claude Opus session to carry out. It follows the audit in `.claude/cleanup-audit.md`.

## How to use this plan

- Do the phases in order. Each task is one commit. Finish and verify a task before starting the next.
- Every task has a **Done when** line. If you cannot meet it, stop and report what you found. Do not widen the task to make it pass.
- The owner has no coding background. Report results in plain words, with numbers.
- You cannot test on a phone. Say so in every report. The owner tests on the phone after an over-the-air update.

## Rules of this repo

Read `CLAUDE.md` first. The ones that matter most here:

- Never read `src/types.ts` or `src/state/useAppState.ts` whole. Use `node scripts/inspect-symbol.cjs <file> <Symbol>`, or Grep with line numbers and a sliced Read (200 lines at most).
- Write code with Write and Edit, not shell heredocs. Many files are CRLF.
- Text that appears twice in a file is common (`const palette = useThemeColors();` is in several components of one file). Before a scripted or line-number edit, count the matches and read the surrounding lines.
- Other sessions edit this folder. Run `git status` and `git branch --show-current` before you start and before you commit. Stage files by name. Never `git add -A`.
- Ask the owner before `git push`, any deploy, or creating a worktree.
- Never switch a `shadow-*` class on and off with a condition. It freezes iOS.
- After adding or removing an AppState field: `npm run -s check:appstate -- --update`, and commit `scripts/appstate-keys.snapshot.txt`.

**Verify after every task:**

```bash
cd /c/Users/micah/Downloads/scripture-memory-app && npx tsc --noEmit -p . && for c in layout queue calendar stages outbox appstate; do npm run -s check:$c 2>&1 | tail -1; done
```

Then open the screens you touched in the demo (`preview_start` with `expo-web`, then `http://localhost:8099/?s=<screen>`) and read the console for errors. Screen names are listed in `scripts/capture-screens.cjs`. Run all 39 `check:` scripts before the last commit of each phase.

## What is slow, with numbers

Measured 2026-11-12 in the web demo with 700 verses (`big=1`), development build, desktop. A phone is several times slower. A production build is faster. Compare numbers only within one run.

**One unrelated state change redraws the open screen.** I changed one field no screen shows (`setAudioSearchQuery`) and timed the redraw:

| Open screen | Cost of one unrelated change | First draw (commits, total) |
|---|---|---|
| Today (`home`) | 125 ms | 4, 460 ms |
| Chapter page (`chapterLanding`) | 125 ms | 4, 468 ms |
| My Verses (`activePlan`) | 94 ms | 4, 396 ms |
| Map (`map`) | 64 ms | 6, 347 ms |
| Record (`record`) | 60 ms | 4, 397 ms |
| Circle chat (`circleChat`) | 51 ms | 4, 283 ms |
| Guided (`guided`) | 50 ms | 5, 210 ms |
| Mixed review (`mixedReview`) | 33 ms | 5, 331 ms |

Anything above about 16 ms drops a frame. The demo was idle between changes (no redraws while sitting still), so the cost is per change, not constant.

**Why.** `App.tsx` runs `useDemoState(useAppState())` in `AppShell` and hands the whole 420-field object to the open screen as `state`. The object is new on every render, and the state hooks contain no `useCallback` at all, so every handler is new too. Nothing can skip a redraw.

**What changes state often:**

- `recordingSeconds` in `src/state/useRecorder.ts` ticks once a second while recording. Only the Record screen shows it.
- Eight text fields write to app state on every keystroke: `setAudioSearchQuery`, `setFindSearchQuery`, `setUserSearchQuery`, `setCreateGroupName`, `setCreateGroupDesc`, `setNewPlanName`, `setNewPlanDesc`, `setInviteCodeInput`.
- Chat and social listeners (`useMessaging.ts`, `useSocial.ts`, `useChallenges.ts`) set state whenever the server sends something.
- The Community tab refreshes every 30 seconds while open (`useAppState.ts`, the `setInterval(refresh, 30_000)` effect).
- Every review, touch and navigation.

**Not measured yet:** how much of each redraw is the `useAppState` hook body (about 3,800 lines, 4 `useMemo`) and how much is the screen. Task 0.2 measures it, and the answer decides how much Phase 2 buys.

## Phase 0 — Measuring tools (do first)

### 0.1 A permanent profiling switch

Add a demo parameter `prof=1` in `src/dev/DemoHarness.tsx` (next to `DEMO_FONT_SCALE`) and use it in `App.tsx` to wrap `<AppShell />` in `<React.Profiler>` whose `onRender` pushes `Math.round(actualDuration)` onto `globalThis.__prof`. Development only, like the rest of demo mode. Wrap both places `<AppShell />` is mounted (there are two, about ten lines apart at the bottom of `App.tsx`).

Measure with this in the Browser pane's JavaScript tool:

```js
globalThis.__prof = []; __demoState.setAudioSearchQuery(String(Math.random()));
await new Promise(r => setTimeout(r, 1500)); JSON.stringify(globalThis.__prof)
```

`__demoState` is the live app state, already exposed by the demo. The pane is often hidden, which slows timers to about one a second, so never time with `setTimeout` or `requestAnimationFrame`. Read `actualDuration` only.

**Done when:** the table above can be reproduced with `?s=<screen>&big=1&prof=1`.

### 0.2 Split the cost: hook or screen

With `prof=1` on, record `performance.now()` at the top of `useAppState` and just before its `return {`, and push the difference onto `globalThis.__hook`. Report, per screen, hook time against total time. Remove this timing code before committing (it is for the report only).

**Done when:** you have reported the hook's share for the eight screens in the table. If the hook body is more than about a third of the total, do task 1.3 before Phase 2.

## Phase 1 — Quick wins, no change of structure

### 1.1 Take the recording timer out of app state

Follow the pattern in `src/lib/toastStore.ts` and `src/lib/playbackProgress.ts` (a module-level value, a `Set` of listeners, a hook built on `useSyncExternalStore`).

1. Create `src/lib/recordingClock.ts` with `setRecordingSeconds`, `getRecordingSeconds` and `useRecordingSeconds()`.
2. In `src/state/useRecorder.ts`, replace the `recordingSeconds` `useState` with the store. The hook also snapshots the value when recording stops (`finalRecordingSeconds`, see the comments near line 30); keep that behaviour by reading `getRecordingSeconds()` at that moment.
3. Grep `recordingSeconds` across `src` and `App.tsx`. Each screen that shows it calls `useRecordingSeconds()` in the smallest component that draws the number.
4. Remove `recordingSeconds` from what `useAppState` returns. Update `src/dev/DemoHarness.tsx` if it sets it. Update the snapshot.

**Done when:** with `?s=record&prof=1`, starting a recording in the demo (or calling the store's setter in a loop from the console) adds no entries to `__prof` beyond the Record screen's own small timer component.

### 1.2 Stop redrawing the app on every keystroke

For each of the eight setters listed above:

1. Find the field's `TextInput` (grep `onChangeText={<setter>}`) and who reads the value.
2. **Search fields** (`audioSearchQuery`, `findSearchQuery`, `userSearchQuery`): keep the text in a local `useState` in the screen, and pass it to app state after a 250 ms pause. `useFriends.ts` already debounces `userSearchQuery` for its search; keep one debounce, not two.
3. **Form fields** (`createGroupName`, `createGroupDesc`, `newPlanName`, `newPlanDesc`, `inviteCodeInput`): keep the text local to the screen and change the submit handler to take the values as arguments. Find the handler by grepping the field name in `src/state`. If a handler also clears the field afterwards, the screen clears its own local state on success.
4. Remove any field and setter that nothing reads afterwards. Update the demo harness and the snapshot.

**Done when:** typing in each of the eight fields in the demo adds nothing to `__prof` except that field's own screen, and each form still submits (check the demo for `find`, `create`, `findFriends`, `audioFeed`, `groupDetail`).

**Stop and report if** a field's value is read by an effect in `src/state` in a way that needs every keystroke.

### 1.3 Make the state hook cheap to run

Only if task 0.2 says the hook body is a large share.

1. In `useAppState.ts` and the hooks it calls (`useReviewEngine`, `usePlanSettings`, `useCircles`, `useMessaging`, `useSocial`, `useToday`, `useCalendarDays`), look for work done on every render that loops over `memoryQueue` or another large list: `.filter`, `.map`, `.reduce`, `.sort`, `new Set(`, `new Map(` outside a `useMemo`, effect or handler.
2. Wrap each in `useMemo` with the right inputs. The stats block near `useAppState.ts:2254` is the model.
3. Measure before and after with the task 0.2 timing.

**Done when:** the hook body costs under 5 ms per render with `big=1` in the demo, or you have reported what still costs more and why.

## Phase 2 — Let screens skip redraws they do not need

This is the big one. Keep `useAppState` and the `AppState` type exactly as they are. Change only how screens receive it.

### Design

1. **A store.** New file `src/state/appStore.ts`. It holds the latest `AppState` object and a set of listeners.
2. **A host.** In `App.tsx`, a small component `AppStateHost` runs `useDemoState(useAppState())`, assigns the result to the store during render, and tells listeners in a `useLayoutEffect` with no dependency list. It renders its children. `AppShell` and the screens sit inside it and no longer receive `state` as a prop.
3. **A picker hook.** `useAppFields('memoryQueue', 'navigateTo', ...)` returns just those fields and redraws the component only when one of them changes.
4. **Stable handlers.** For a field whose value is a function, the picker returns one permanent wrapper that calls the newest version. That is what makes "did anything change" answer no, since the hooks recreate every function on every render.

Sketch:

```ts
// src/state/appStore.ts
import { useRef, useSyncExternalStore } from 'react';
import type { AppState } from './useAppState';

let current: AppState | null = null;
const listeners = new Set<() => void>();
const stable = new Map<string, (...args: any[]) => any>();

export function setAppState(next: AppState) { current = next; }      // during the host's render
export function notifyAppState() { listeners.forEach((l) => l()); }   // in the host's layout effect
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const stableFn = (key: string) => {
  let f = stable.get(key);
  if (!f) { f = (...args) => (current as any)[key](...args); stable.set(key, f); }
  return f;
};

export function useAppFields<K extends keyof AppState>(...keys: K[]): Pick<AppState, K> {
  const last = useRef<Pick<AppState, K> | null>(null);
  const read = () => {
    const prev = last.current;
    const next = {} as Pick<AppState, K>;
    let same = prev !== null;
    for (const k of keys) {
      const v = current![k];
      (next as any)[k] = typeof v === 'function' ? stableFn(k as string) : v;
      if (same && (prev as any)[k] !== (next as any)[k]) same = false;
    }
    if (same) return prev!;
    last.current = next;
    return next;
  };
  return useSyncExternalStore(subscribe, read, read);
}
```

### The one real danger: functions called while drawing

A stable wrapper is correct for anything called from a tap, an effect or a timer. It is **wrong** for a function a screen calls while drawing to work out what to show, because the screen will not redraw when that function's hidden inputs change. Known examples to check: `getNewVerseRoom`, `getEstimatedReviewTime`, `validateTouch`, `getMemoryLoadForecast`, anything named `get…`, `is…`, `has…`, `can…`, `…For`, `…Label`.

For each screen you convert:

1. List every state function the screen calls outside an event handler or effect.
2. For each, also pick the data it depends on (read the function to find out, usually `memoryQueue` and plan settings), so the screen redraws when the answer could change. Or replace the call with a value computed in the screen from picked data.
3. Write that list in the commit message.

### Order of work

One commit per step. After each, run the verify command, open that step's demo screens, and compare screenshots before and after with `npm run shots -- "s=<screen>&ios=1"` (pictures land in `.shots/`; read them with the Read tool, not Bash).

1. **2.1** Add the store, the host and the picker. Convert only `AppShell`, `TabBar`, `NowPlayingBar` and `ToastLayer` in `App.tsx`. Screens still get `state` from `AppShell`, read through a temporary `useAppFields`-free helper `useWholeAppState()` that returns the full object and redraws every time. Nothing gets faster yet. This step proves the plumbing.
2. **2.2** Today tab: `HomeScreen`, `TodayVersesScreen`, `MemoryCalendarScreen`, and the hooks they call with `state` (`useToday`, `useCalendarDays` take the whole object; change them to pick their own fields).
3. **2.3** Verses tab: `ActivePlanScreen`, `VersePageScreen`, `ChapterLandingScreen`, `BooksScreen`/`ChaptersScreen`, add-verses screens, the map screens.
4. **2.4** Sessions: `GuidedLearningScreen`, `MixedReviewScreen`, `ThreadDrillScreen`, `ReferenceDrillScreen`, `PracticeModals` and the panels under `src/components/practice/`. These matter most to feel. Typing and speaking must not stutter.
5. **2.5** Audio tab: `RecordScreen`, `RecordingDetailScreen`, `MyRecordingsScreen`, `AudioFeedScreen`.
6. **2.6** Community and Me: the community screens, chat, profile, `DashboardScreen`, `SettingsScreen`, `MemoryPlanScreen`, onboarding.
7. **2.7** Delete `useWholeAppState()` once nothing uses it.

Mechanical shape of each conversion: a screen today starts with `const { a, b, c } = state;`. It becomes `const { a, b, c } = useAppFields('a', 'b', 'c');` and loses its `state` prop. A child that was given `state={state}` picks its own fields the same way.

**Values that defeat the picker.** A field whose value is a fresh array or object on every render (computed in the hook without `useMemo`) looks changed every time. While converting, if a converted screen still redraws on the unrelated change, log which picked key differed and memoize that value at its source.

**Demo mode.** `useDemoState` wraps the real state and overrides fields. The host publishes its output, so the demo keeps working. `globalThis.__demoState` must stay.

**Done when, per step:** the step's screens show 0 entries in `__prof` for the unrelated change (or only the hook-host commit, a few ms), every one of the step's demo screens looks the same in screenshots, and the verify command passes.

**Done when, whole phase:** the table at the top, re-measured, shows every screen under 16 ms for an unrelated change.

**Stop and report if** a screen needs more than about a dozen render-time functions untangled. Leave that screen on `useWholeAppState()` and move on.

## Phase 3 — Database indexes before launch

**What I believe, and how sure.** The only database is `ai-studio-da1c3045-26bb-470c-883c-0b120417bcda`, Enterprise edition (`npx firebase-tools firestore:databases:list`). It has no indexes (`npx firebase-tools firestore:indexes --database <id>` prints empty lists). My understanding is that in this edition a query with no index still runs, by reading through the whole collection, and that no indexes are created automatically. I have not confirmed that against current documentation. Confirm it first.

1. **3.1 Confirm.** Read Google's current Firestore Enterprise edition documentation on indexes and on Query Explain. Report in two sentences whether the belief above is right and how reads are billed for an un-indexed query.
2. **3.2 List the queries.** Grep `where(`, `orderBy(` and `collectionGroup(` in `src` and `functions/src`. Make a table: collection, filters, order, limit, and whether the collection is per-user (small for ever) or shared (grows with users). Known shared ones:
   - `dmThreads`: `participantUids` array-contains, order `lastMessageAt` desc (`useMessaging.ts`)
   - `sharedRecordings`: `sharedWithUids` array-contains, order `createdAt` desc (`useAppState.ts`)
   - `activityEvents`: `uid` in, order `createdAt` desc (`useCircles.ts`)
   - `accountabilityNudges`: `toUid` ==, order `createdAt` desc (`useAccountabilityNudges.ts`)
   - `profiles`: range on `displayNameLower` (`useFriends.ts`)
   - Also check `friendRequests`, `challenges`, `circleInvites`, `circles`, `emailLookup`, `reports`.
3. **3.3 Write the indexes** for every query on a shared collection into `firestore.indexes.json`. Remove the stale `savedFromRecordingId` entry (no code uses it). Check the exact file format for this edition against the documentation; do not guess it.
4. **3.4 Ask the owner** before deploying. The command is `npx firebase-tools deploy --only firestore:indexes --non-interactive`. Afterwards list the indexes again to confirm they exist, and open the five screens that use them.
5. **3.5** Remove the `(default)` database entry from `firebase.json` (that database does not exist) and add an "indexes deployed" line to `LAUNCH_CHECKLIST.md`.

**Done when:** every query on a shared collection has an index on the live database, confirmed by the listing command.

## Phase 4 — Launch time

Earlier work measured about 1.5 seconds to launch, which the owner accepted. Do this phase only if the owner asks or a phone measurement says launch got slower.

1. **4.1 Deferred loading.** `App.tsx` imports 41 screens and four developer tools up front. Try Metro's `inlineRequires` (in `metro.config.js`, under `transformer.getTransformOptions`), which delays running each file until first use and needs no change to the screens. Check Expo's current documentation for the supported way to set it on this SDK. Risk: a file that relies on running at import time. Test every demo screen and all checks.
2. **4.2** If 4.1 is not safe, load the developer tools (`DemoHarness`, `BlocksGallery`, `RecapGallery`, `DevLayoutLab`, `LadderDryRun`) with `require` inside an `if (__DEV__)` so they never run in production.

**Done when:** all demo screens and checks pass and the owner reports the phone launch is no slower. A launch-time number needs the phone; say that you could not measure it.

## Phase 5 — Smaller items, only if measured

- **Long lists.** Only four files use `FlatList`. With `big=1&prof=1`, record the first-draw time of every screen that lists verses. Convert any that take over 300 ms to `FlatList`, following `ActivePlanScreen` (it needs `extraData={renderItem}` or rows do not redraw).
- **Chat unread dots** open one listener per circle (`useSocial.ts`, about line 255). Fine for a few circles. Leave it, and note it in `LAUNCH_CHECKLIST.md` as something to revisit if people join many circles.
- **Icons.** 94 files import from `lucide-react-native`. If Phase 4 measurement shows start-up parse time matters, check whether the whole icon set is being bundled.

## Decided already — do not redo

- **Do not cache the verse queue for an instant launch.** Rejected: 1.5 seconds is fine and the data-loss risk is not worth it.
- **Do not defer the Hebrew fonts.** Tried: fonts load in parallel and the Hebrew files are the smallest.
- **Do not cap practice history.** `touchLogs` only grows while a verse is being learned and `reviewLogs` is already capped at 500 per verse. The audit's item 4 was wrong about this.
- **Do not split `useAppState` into separate hooks again** as part of this plan. That was the file-split program; this plan changes how screens read state, not how state is built.

## Report at the end of each phase

- The table from "What is slow", before and after.
- What was committed (short commit ids), on which branch. Not pushed unless the owner asked.
- What was skipped or left on the old path, and why.
- What the owner should try on the phone: record for a minute, type in a search box, run one guided session and one mixed review, send a chat message.
