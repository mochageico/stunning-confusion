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

### 3. H3 + F2 — Home screen  (NEXT)

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

### 4. Dashboard screen
Same treatment. Not yet sketched.

## Deferred — needs design, do not build
**The "memory hub" restructure.** The user wants *Edit Memory Verse Queue* folded
into the *My Memory Plans* screen, renamed to something like "Memory Hub". They
explicitly said this "could use some more thought". It is an information
architecture change, not layout. Leave the Edit Queue button where it is until
this is designed and agreed. Bring sketches, don't improvise.

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
