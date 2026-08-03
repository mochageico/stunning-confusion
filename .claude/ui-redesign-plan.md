# UI redesign — working plan and handoff

Scratch working doc for the UI redesign. Safe to delete when the work is done.
Written 2026-07-29. If you are a fresh session picking this up, read this whole
file first, then run `npm run check:layout` to see current state.

## The goal

Make the app usable at OS font scales up to **1.5×** on an **iPhone SE 2nd/3rd
gen (375pt wide, 335pt of real content width)** without losing the tight, clean
look it has at 1.0×. The user explicitly likes the current density — this is not
a licence to make everything taller. Layout should be **a function of scale**:
compact at 1.0×, reflowing only as text grows.

## What already exists (done, verified)

- `src/components/design.tsx` — the design system. `AppText` (deterministic font
  scaling, both fontSize and lineHeight, capped at 1.5×, `allowFontScaling={false}`),
  `TYPE` scale with an 11pt floor, `useScaledSpace`, `Card`, `CardHeader`,
  `SettingRow` (inline → stacked past 1.3×), `RangeCaption`, `OptionCards`,
  `ToggleRow`, `MIN_TOUCH`.
- `src/components/MissPolicySection.tsx` — the worked example. Takes plain
  values/setters, not `AppState`, so the lab can drive it.
- `src/screens/DevLayoutLab.tsx` — the harness. Flip `DEV_LAYOUT_LAB` in
  `App.tsx` to mount it; bypasses auth. Renders specimens at 375pt across
  1.0/1.3/1.5. **Must be `false` in anything that ships.**
- `scripts/check-layout.cjs` + `npm run check:layout` — tripwire for sub-11pt
  type and fixed heights on text containers. `LEGACY` list holds not-yet-migrated
  files as warnings; delete entries as they migrate. Was 0 errors / 575 warnings
  across 38 files at time of writing.

Measured evidence from the missed-review fix: the old 4-across preset cards were
66px wide with **107px of overflow at 1.0×** and 310px at 1.5×. The replacement
measures **0 overflow at all three scales**.

## Decisions already made (do not relitigate)

- Support up to 1.5×. Smallest device is SE 2nd/3rd gen (375pt), not SE 1st gen.
- This is a **density rethink**, but the user likes current compactness — prefer
  adaptive/reflowing layouts over permanently taller ones.
- **Do density work as extracted components, never inline edits**, so the later
  rearrangement pass just moves a JSX tag.
- Accordions: **independent collapse, any number open at once, never exclusive.**
  Persist open/closed state. The user is strongly against being forced into a
  one-section-open view.
- Design lab (claude.ai/design) is for the **token layer only** (palette, type
  scale, spacing, elevation). Never for component layout — HTML comps mislead
  about what survives RN's flexbox subset.

## The generative rule

Every pattern that broke was **a horizontal row of text-bearing children sharing
a fixed width** — tab strips, N-across cards, segmented controls, slider stop
labels. Hence:

> On a 375pt screen, text may share a row with a *control*, but never with more
> than one other piece of text.

## Remaining work, in order

### 1. B7 — compact option grid  — DONE, verified
`OptionCards` now dispatches on font scale: below `GRID_MAX_SCALE` (1.25) it
renders `OptionGrid` — a two-column grid of titles with only the *selected*
option's description in a panel below. At or above it, the original
`OptionList` full-width path. Measured on the missed-review options:

| scale | layout | option block height | overflow |
|---|---|---|---|
| 1.0× | grid, 147px cards | **167px** (was 391px) | 0 |
| 1.3× | list, 294px cards | 596px | 0 |
| 1.5× | list, 273px cards | 842px | 0 |

224px saved at 1.0×, a 57% reduction, with zero overflow at every scale.
Also fixed while here: `role="radio"` was using `accessibilityState.selected`
instead of `checked`, and React Native Web drops `accessibilityState` on
`Pressable` entirely — so explicit `aria-checked` / `aria-expanded` props are now
set alongside it. Verified exactly one `aria-checked="true"` per group.

### 2. P2 — Plan Designer accordion  — DONE, verified

Four sections are now `CollapsibleCard`s with their current value on the header:
`Weekly Rhythm · 5/7 days`, `Pacing & Limits · 2/day · 10 min`,
`Retention Rigor · 7-6-5`, `Missed Review Handling · Standard`. Storage keys are
`planDesigner.*`. Verified all four open at once (non-exclusive) in the real
screen, not just in a specimen.

Measured screen content height in Advanced mode, against a 620pt viewport:

| scale | all collapsed | all expanded | reduction |
|---|---|---|---|
| 1.0× | 1023px (1.65 screens) | 2442px | 58% |
| 1.3× | 1253px | 3410px | 63% |
| 1.5× | 1490px | 4138px | 64% |

Zero vertical leaks and zero horizontal overflow at every scale, in both states.

Also converted **Quick Presets** from three `flex-1` cards at `height: 100`
(~105pt each, the same B1 failure) to `OptionCards`, which now drives
`applyPreset`.

**Honest gap:** collapsed is 1.65 screens at 1.0×, not the "roughly one screen"
originally projected. The residual is all non-collapsible chrome — header +
subtitle, the Basic/Advanced toggle, Plan Name, Quick Presets, and the Weekly
Forecast + Save Plan card. Getting to ~1 screen would mean making Quick Presets
and/or Plan Name collapsible too, or moving the Weekly Forecast out of the scroll
flow into a sticky footer. Not done — it needs a design call, not just a refactor.

### 3. H3 + F2 — Home screen  — DONE, verified

The mega-card is dissolved into three sibling `CollapsibleCard`s with counts on
their headers: `LEARNING PHASE · 2 verses`, `DUE REVIEWS · 2 due`,
`MEMORY PRIMING · 2 queued`. Storage keys `home.learning` / `.reviews` /
`.priming`.

**Default open state deviates from the original spec, deliberately.** The plan
said "reviews open if any due, else learning, else priming" — one section open.
That conflicts with the user's stated preference for seeing everything at once,
so instead **every section with content in it opens**, and only genuinely empty
sections start collapsed (`defaultCollapsed={learningItems.length === 0}` etc).
A stored choice still wins over the default.

Other changes: `est. N mins` moved to the greeting header ("about 14 min today"),
*Listen to Today's Scripture* promoted to a full-width primary action with
*Edit Memory Verse Queue* demoted to a quiet link beneath it, and the feature
grid is now 2×2 via a `FeatureTile` component (`minHeight`, grows 76 → 103 →
118px across scales) instead of 3-across at a fixed `h-24` plus a stranded
`h-14` row.

Measured at true 375pt device width, all three sections open:

| scale | content height | viewport | tile height |
|---|---|---|---|
| 1.0× | 1044px | 619px | 76px |
| 1.3× | 1196px | 619px | 103px |
| 1.5× | 1354px | 619px | 118px |

Zero vertical leaks and zero horizontal overflow at every scale. Collapsing
Learning left Reviews and Priming open (independence verified on the real
screen). Collapsing one section saves ~133–163px.

**Lab fix made while doing this:** whole-screen specimens now render inside
`PhoneFrame`, which cancels the lab's own `SCREEN_PADDING` with a negative
margin so screens get the true 375pt width. Before this they rendered ~73pt
narrower (lab padding plus the screen's own `p-5`), which was a stricter test
but made every height figure meaningless for a real device. The Plan Designer
numbers recorded in section 2 above were taken at the OLD narrow width and are
therefore pessimistic — re-measure if the exact figures matter.

### 4. Dashboard screen  (NEXT)

`CollapsibleCard` / `useCollapsed` already exist and are verified (independent
non-exclusive state, per-card `defaultCollapsed`, persisted via AsyncStorage under
`ui.collapsedSections.v1`, header stacks at 1.5×). `OptionCards` handles any
"choose one of N" block. Both are ready to reuse here.

`DevLayoutLab.tsx` also now has `useMockPlanState` + `LivePlanDesigner`, which
render a whole real screen at all three scales with no signed-in user. Copy that
pattern for Home — build a `useMockHomeState` the same way and cast at the call
site (`as unknown as AppState`).

- Split the single mega-card (`HomeScreen.tsx`, the `border-2 ... rounded-2xl`
  card around line 245) into **sibling** cards: Learning, Reviews due, Priming.
- Each independently collapsible, count shown on the collapsed header
  ("Reviews · 12"). Default open state is **automatic by content**: reviews open
  if any are due, else learning, else priming. User can then open/close freely
  and that choice persists.
- Move the `est. N mins` badge up beside the greeting.
- Promote *Listen to Today's Scripture* to a single full-width primary action.
- **F2**: the feature grid becomes 2×2 with `minHeight` instead of 3-across at a
  fixed `h-24` plus a stranded `h-14` row. There are exactly four features.
- Known hotspots in this file: `h-24`/`h-14` on the feature cards, `h-5` on the
  Listen/Learn chips, the "Learning phase…" header packing label + tooltip +
  Pull New Verses + count into one row, and the Priming header's `width: 90`
  dropdown beside "# of verses".


## Memory Desk — DONE (the hub), with follow-ups

`src/screens/MemoryDeskScreen.tsx` is a menu, not an editor: five rows, each
showing current state, each opening a full-width screen. Replaces the
"My Memory Plans" tile on Home. Rows: Memory Queue (`activePlan`), Plan &
Pacing (`planDesigner`), Memory Calendar (`memoryCalendar`), Saved Plans
(`savedPlans`), History (`fullHistory`).

Measured: rows 46px at 1.0× and the whole screen **fits one viewport**; 82px at
1.3× and 93px at 1.5×, where label and detail stack to a column. Zero leaks and
zero horizontal overflow at all three scales.

Routing notes: `memoryDesk` was added to `ScreenName` and `HOME_TAB_SCREENS`
plus the home-tab switch in `App.tsx`. `fullHistory` needed no change — it is
handled *before* the tab checks in `Screens()`, so it is already tab-independent
and works from both the Desk and Profile.

Community study plans deliberately stay in the Community tab — group-owned
content on a different lifecycle.

## The plan/rhythm split — DONE (2026-08-03)

Replaces what were deferred items 1 and 2 (rhythm commit paths + queue page
redesign). Both turned out to be the same problem, and the fix was a data
model change, not a UI one.

**What was actually wrong.** The doc framed the two commit paths as a
working-copy vs saved-copy model. They weren't: the engine reads the
*top-level* state (`isTodayLearningDay` → `learningDays`, `triggerDailyPull` →
`{ newVersesPace, learningDays }`), so a rhythm edit took effect the instant
you made it. The Save button only controlled whether it survived a reload,
while implying it controlled whether it applied at all.

The untraced branch traced out badly: `editingPlanId` was only ever set by
`navigateTo('activePlan')` or `handleEditPlan`, so Memory Desk → Plan & Pacing
left it null on a fresh launch, and Save minted a duplicate plan **with the
same name** and deactivated the real one.

And the three shipped plans (Example / Warrior Track / Gentle Drip) were
identical on every retention field — three schedules wearing plan costumes,
which is what made "pick a plan" meaningless to a first-time tester.

**The split.** `MemoryPlan` is now purely a retention method: rigor, phase
lengths, mastery gates, miss policy. Everything about *your week and your
capacity* moved to a new user-level `Rhythm` type — learning days, pace,
review cap, sabbath, dayStartHour, load sensitivity, pause.

Migration was nearly free: `planTopLevelFields` already mirrored the active
plan's pacing to the root of `memoryPlans/{uid}`, so the load path just reads
rhythm from the root instead of from the active plan. No destructive rewrite;
stale per-plan pacing copies are simply never read again.

Consequences worth knowing:
- **Rhythm commits live** via `updateRhythm(patch)`. No Save button, no dirty
  state, no `saveActivePlanRhythm`.
- **Copy-on-write plans.** One shipped plan (`BUILT_IN_PLAN_ID`, "Standard",
  `isBuiltIn: true`). Editing it requires a rename and forks a copy — which
  also structurally removes the duplicate-plan bug.
- **`preset` ('drip'/'warrior'/'custom') is deleted.** It only labelled a
  combination of three dials and every manual change reset it to 'custom'.
- **Adoption no longer imposes the author's schedule.** `normalizeAdoptedPlan`
  takes retention fields only.
- **Pause is user-level**, so activating another plan no longer silently
  un-pauses you.
- **Lost deliberately:** you can't have per-plan pacing any more. Swapping
  plans doesn't change your speed.

**Queue page** is now Rhythm · Sources · Up Next · read-only retention footer.
The 7-day forecast moved to the Memory Calendar, which already projects the
same days and can name the verses. The nested `maxHeight: 360` ScrollView is
gone — it swallowed vertical drags on device.

**Group plans.** The priority setting was real and wired end to end, but
unobservable: the Join button hardcoded `'individual'` (the mode where the
plan only gets leftover capacity, so a member with a full queue joined and saw
nothing happen), the control lived in the Community tab, and queue rows said a
generic "Group". Now: priority is chosen at join and defaults to `'group'`,
labels are plain language, group rows name their plan, and a Sources block
shows the next pull's actual breakdown from `computeDailyPull`. `'additive'`
now bypasses the Review Shield as well as the pace cap.

**Calendar** runs the real `computeDailyPull` forward against a simulated
queue, so `newVersesPulled` is correct for joined plans and the day sheet
names the verses starting that day.

### Verified
- `npx tsc --noEmit` clean; `npm run check:layout` 0 errors (575 → 524 warnings).
- **`npm run check:calendar`** (new) — 13 assertions on the projection under
  plain Node, following the `check:recitation` pattern. Covers additive vs
  group priority, the 7-day budget not being re-spent daily, queue exhaustion,
  and sabbath.
- Layout lab at 1.0/1.3/1.5×: RhythmEditor and QueueSources both **0 leaks, 0
  horizontal overflow**. Heights 466/660/797 and 249/356/422.
- Found and fixed while measuring: the Sabbath switch had a fixed `w-12` track
  with a font-scaled knob, pushing 17px out of the card at 1.5×.

### Not verified in-browser
The real Memory Calendar and Queue screens need a signed-in user, and there's
no guest mode (see the harness note in memory). Both typecheck, and the
calendar's risky logic is covered by `check:calendar`, but the assembled
screens have not been rendered.

## Deferred — needs design, do not build

### 1. Tiny grey text pass
The user observed that restructured screens still contain lots of small grey
text that is hard to read. Confirmed — two separate problems:

- **Size**: HomeScreen has 21 sub-11pt instances, PlanDesignerScreen has 29
  (16 of them at 8px). These are most of the remaining `check:layout` warnings.
  Fix by migrating remaining `<Text>` to `<AppText>`.
- **Contrast** (the worse one). On white: `text-neutral-400` (#a3a3a3) is
  **2.5:1**, `text-[#888]` is **3.5:1**, `text-neutral-500` (#737373) is
  **4.7:1**. WCAG AA needs 4.5:1 for normal text, so the two most-used label
  colours both fail. Proposal: `neutral-500` becomes the lightest permitted
  colour for real text; `neutral-300`/`400` reserved for disabled states and
  non-text decoration. Add a contrast rule to `check:layout` to hold the line.

## How to verify anything

1. Set `DEV_LAYOUT_LAB = true` in `App.tsx`, add the component as a specimen in
   `DevLayoutLab.tsx`.
2. `npm run web -- --port 8099`, then measure with JS in the page rather than
   eyeballing screenshots:
   `el.scrollHeight - el.clientHeight > 1` on a non-scrolling box is a real leak.
   Check `document.documentElement.scrollWidth - clientWidth` for horizontal.
3. `npx tsc --noEmit` and `npm run check:layout` must both be clean.
4. Set `DEV_LAYOUT_LAB` back to `false`.

Note: trust the browser for **geometry only**. The user has observed the app
looks better on device than in RN Web, and that's correct — type, shadows and
spacing all render differently. For aesthetic judgement, run the lab on a real
phone via Expo (the flag works there too).
