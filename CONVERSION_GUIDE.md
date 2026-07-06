# Web → React Native (Expo) conversion guide

This app is a port of a Vite + React 19 + Tailwind v4 web app (a phone-mockup prototype built
in Google AI Studio) to a real React Native app using Expo SDK 57. Read this whole file before
converting any screen — it defines the conventions every screen must follow so the pieces fit
together without a separate integration pass per file.

## What you're converting

The original app is one giant component (`App.tsx`, ~6800 lines) that holds ~90 `useState`
hooks and ~35 handler functions in a single closure, and renders different "screens" by
conditionally showing `<div>` blocks based on `currentTab` / `currentScreen` state (there is no
`react-router` — it's a hand-rolled state machine). That state + all handlers have already been
centralized into **`expo-app/src/state/useAppState.ts`**, exporting a hook whose return type is
`AppState` (exported as `export type AppState = ReturnType<typeof useAppState>`).

**Your job**: convert one screen's JSX (a line range from the original
`C:\Users\micah\Downloads\scripture-memory (3)\src\App.tsx`, given to you separately) into a
React Native component under `expo-app/src/screens/`. The component receives the already-built
state as a single prop:

```tsx
export default function SomeScreen({ state }: { state: AppState }) {
  const { verses, memoryQueue, navigateTo, triggerToast /* ...whatever you need */ } = state;
  ...
}
```

Do **not** invent new global state or rename any field/handler — read `useAppState.ts` first to
see the exact names available (they match the original 1:1). If a screen needs truly
component-local UI state that the original also scoped as local (rare — almost everything in
the original lived in the one big `App()` closure), it's fine to add a local `useState` inside
your screen component, but check `useAppState.ts` first so you don't duplicate something that's
already there.

Static reference data (`BOOKS`, `INITIAL_VERSES`, etc.) lives in `expo-app/src/data.ts` — import
directly from `'../data'`, or use `state.BOOKS` / `state.DUMMY_PROFILES` (re-exported on the
state object for convenience). Types (`VerseState`, `QueueItem`, `Recording`, `GroupPlan`,
`MemoryPlan`, `GroupedQueueItem`) live in `expo-app/src/types.ts`.

Shared small components live in **`expo-app/src/components/ui.tsx`**:
`HelpTooltip`, `ChipRow`, `AvatarCircle`, `ProgressBar`, `FadeInView`, `PulseView`, `SpinView`,
`BounceView`, `WaveBars`. Use these instead of re-implementing the same pattern — see below for
when each applies.

## Root wrapper per screen

The original wraps each screen's content in something like
`<div className="flex-1 flex flex-col p-5 animate-fade-in text-left space-y-4">`. Port that as:

```tsx
import { ScrollView } from 'react-native';
import { FadeInView } from '../components/ui';

export default function SomeScreen({ state }: { state: AppState }) {
  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* ...content... */}
      </ScrollView>
    </FadeInView>
  );
}
```

- Use `ScrollView` (not a plain `View`) as the scrolling root for any screen whose web version
  had `overflow-y-auto` or was simply taller than one viewport (most of them). Use a plain `View`
  only if the original section clearly never scrolls.
- `space-y-*` on a web flex-col container doesn't exist in RN/NativeWind the same way — replace
  with `contentContainerStyle={{ gap: N }}` (N = the space-y value in px, e.g. `space-y-4` → 16)
  or wrap children and use `className="gap-4"` on the inner View (NativeWind does support `gap-*`
  on Views directly, prefer that over `contentContainerStyle` when not on the root ScrollView).
- Each screen owns its own root — don't assume a parent already provides padding/background.

## Element mapping

| Web | React Native |
|---|---|
| `<div>` | `<View>` |
| `<span>`, `<p>`, `<h1>`–`<h6>`, `<label>` | `<Text>` |
| `<button onClick={fn}>` | `<Pressable onPress={fn}>` |
| `<img src={x} alt={y} />` | `<Image source={{ uri: x }} accessibilityLabel={y} />` |
| `<input type="text/number" value onChange={e=>...e.target.value}/>` | `<TextInput value onChangeText={(text) => ...}/>` — note `onChangeText` gets the **string directly**, not an event; for number inputs use `keyboardType="numeric"` and `Number(text)`/`parseInt(text, 10)` at the call site |
| `<textarea>` | `<TextInput multiline numberOfLines={n} textAlignVertical="top" />` |
| `<select><option>` | `ChipRow` from `components/ui.tsx` (see below) — do **not** use `@react-native-picker/picker`, it's not installed; we standardized on the chip-row pattern the app already uses everywhere else for consistency |
| `<input type="range">` | `Slider` from `@react-native-community/slider` (`minimumValue`, `maximumValue`, `step`, `value`, `onValueChange`, `minimumTrackTintColor="#1A1A1A"`) |
| `<textarea>`/inline `title="..."` tooltip attribute | drop, or wrap the element in `HelpTooltip` if the info matters |

**RN rule that has no web equivalent**: literal text can *only* be a child of `<Text>`, never a
direct child of `<View>`. If you see a `<div>{someString}</div>` in the original, it becomes
`<View><Text>{someString}</Text></View>`, not `<View>{someString}</View>` (the latter crashes).

## Tailwind / NativeWind className rules

Keep `className` strings from the original wherever the utility has real meaning in RN
(spacing, `flex-*`, `rounded-*`, `border`, `text-*` sizing, `bg-*` colors, `p-*`/`m-*`, `gap-*`,
opacity, `absolute`/`relative`/`inset-*`). Drop or replace the following, since they either don't
exist in RN or don't do what they look like they do:

- **`hover:*`, `active:*`, `focus:*`, `focus-visible:*`, `group-hover:*`** — no pointer/hover
  concept in RN. Delete these variants; keep only the base (non-prefixed) utility from the same
  class string.
- **`cursor-pointer`, `cursor-help`, `select-none`, `pointer-events-none`, `antialiased`,
  `whitespace-nowrap`, `break-keep`** — delete. If pass-through-touches behavior is genuinely
  needed for an overlay, use the RN `pointerEvents="none"` prop on that `View` instead of a
  className.
- **`transition`, `transition-all`, `duration-*`, `ease-*`** on their own (without an `animate-*`
  utility) — delete; static Tailwind transition classes don't animate RN style changes. If the
  original was animating something like a hover color change, it's fine to just drop it — the
  interaction it was softening (hover) doesn't exist on a touchscreen anyway.
- **`animate-fade-in` / `animate-fade-out`** → wrap the element in `<FadeInView>` from
  `components/ui.tsx` instead of relying on the className.
- **`animate-pulse` / `animate-bounce` / `animate-spin`** → wrap in `<PulseView>` / `<BounceView>`
  / `<SpinView>` respectively.
- **Inline `<style>{`@keyframes ...`}</style>` tags** (there's one in the original
  `PracticeModals.tsx` for a "sound wave" animation) — delete the tag entirely; use `<WaveBars>`
  from `components/ui.tsx` for that specific pattern, or a `PulseView`/custom `Animated` value for
  anything else custom.
- **`truncate`, `line-clamp-N`** → use the RN `<Text numberOfLines={N}>` prop instead (with
  `ellipsizeMode="tail"` if needed), not a className.
- **`backdrop-blur-*`** → delete; keep the translucent background color class it's paired with
  (e.g. `bg-black/60`) — a plain translucent overlay is a fine, lower-risk substitute for blur.
- **`overflow-y-auto` / `overflow-x-auto`** on a `<div>` → that element becomes a `<ScrollView>`
  (or `<ScrollView horizontal>`), not a `View` with an overflow className.
- **Percentage inline styles** like `style={{ width: `${x}%` }}` — keep as-is verbatim, valid in
  RN too.
- **Non-standard Tailwind shade numbers**: the original occasionally uses shades that don't exist
  in Tailwind's default 50/100/200/.../900/950 scale (leftover AI-generated no-ops in the web
  version — they rendered as unstyled there too). Round to the nearest real shade:
  `neutral-150→neutral-200`, `neutral-250→neutral-200`, `neutral-450→neutral-400`,
  `neutral-550→neutral-500`, `neutral-850→neutral-800`, `amber-850→amber-800`. Apply the same
  "round to nearest 100" rule to any other odd shade number you encounter.

## Icons

`lucide-react` → `lucide-react-native` (same icon names/props: `size`, `strokeWidth`). The one
real difference: **always pass an explicit `color` prop** (a hex string) rather than trying to
color the icon via a `text-*` className — don't rely on NativeWind theming SVG icon color.
Quick hex cheat-sheet for colors that appear often in this app (all approximate to the Tailwind
default palette): `neutral-400 #a3a3a3`, `neutral-500 #737373`, `neutral-600 #525252`,
`neutral-800 #262626`, `neutral-900 #171717`, `emerald-600 #059669`, `emerald-700 #047857`,
`amber-600 #d97706`, `red-500 #ef4444`, `red-600 #dc2626`, `indigo-600 #4f46e5`. The app's own
near-black accent `#1A1A1A` is already used as a literal hex throughout the original — keep using
that literal hex for icons/borders where the original did.

## Things that don't need porting at all

- The "iPhone mockup" chrome at the top of the original root render (the 6px black border phone
  frame, fake status bar with "9:41"/5G/battery icons, the black "dynamic island" pill) — that
  was there to simulate a phone inside a desktop browser preview. **Delete it.** The RN app
  already runs full-screen on a real device; there's no mockup frame to draw.
- `document.getElementById('phone_viewport').scrollTop = 0` (a scroll-reset effect keyed on
  screen/tab change) — not needed; each screen is its own mounted RN component now, so its
  `ScrollView` naturally starts at the top on mount. Already omitted from `useAppState.ts`.
- `window.confirm(...)` — used once, inline, in the recording-detail screen's delete button. If
  your assigned range includes it, replace with `Alert.alert(title, message, [{text:'Cancel',
  style:'cancel'}, {text:'Delete', style:'destructive', onPress: () => ...}])` from `react-native`
  (restructure from a synchronous `if (window.confirm(...))` into the Alert callback).
- `navigator.clipboard.writeText(x)` — used once, inline, in the community "share invite code"
  flow. Replace with `import * as Clipboard from 'expo-clipboard'; await
  Clipboard.setStringAsync(x)`.
- Recording/"microphone" UI in this app is **fully simulated** (timers increment a counter; there
  is no real `MediaRecorder`/`getUserMedia` anywhere in the original). Keep it simulated — don't
  add real `expo-av`/`expo-audio` capture, that would be scope the original never had.

## Lists

Use plain `.map()` inside a `ScrollView`, matching the original — these lists are small (tens of
items, not thousands), so a `FlatList` isn't needed and would just be extra ceremony.

## Splitting large sections

If your assigned range covers more than one logical screen/subview (you'll be told when this is
the case), produce multiple output files rather than one huge component — for example the
community tab's "find" and "create" sub-views become separate files even though they're one
conditional block in the original. A thin router component (written separately, not your job)
will pick between them based on `state.communitySubView` / `state.viewingGroupDetail`.

## What "done" looks like

- The file compiles against `AppState` (don't guess field names — check `useAppState.ts`).
- No leftover web-only globals (`document`, `window`, `navigator`) except through the two
  documented replacements above.
- No `<select>`, `<input>`, `<textarea>`, `<img>`, `<button>`, `<div>`, `<span>`, `<p>` tags
  remain — everything is an RN primitive.
- Every string of literal text is inside a `<Text>`.
- Icons imported from `lucide-react-native`.
