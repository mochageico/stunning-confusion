# Scripture Memory (Expo / React Native)

This is a React Native port of the Scripture Memory web app (originally built in Google AI
Studio as a Vite + React + Tailwind prototype; the frozen original lives in `legacy-web/` for
reference and isn't actively developed). All the business logic, data model, and Firebase
backend are unchanged — only the UI layer and a handful of browser-only APIs were rewritten
for React Native.

## Running it

Run these from the repo root (this Expo app *is* the repo root now — there's no separate
subfolder to `cd` into):

```bash
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app (iOS/Android) or press `i`/`a` for a simulator. Every
feature works in Expo Go **except Google Sign-In** (see below) — the app is local-first, so
scripture memorization, practice modes, the memory queue, plan designer, community screens, and
the (simulated) recorder all work without any cloud account.

## Google Sign-In (optional, requires a dev client)

Expo dropped support for browser-based Google sign-in in Expo Go as of SDK 57, so this uses
`@react-native-google-signin/google-signin` (native code) instead of the web original's
`signInWithPopup`. That means Google Sign-In only works in a **custom dev client**, not plain
Expo Go:

1. Get the Firebase project's "Web client" OAuth ID: Firebase Console → Authentication →
   Sign-in method → Google → Web SDK configuration → Web client ID.
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to that value.
3. Build a dev client and run on it instead of Expo Go:
   ```bash
   npx expo run:android   # or: npx expo run:ios (requires a Mac)
   ```
   (or `eas build --profile development` if you don't have the native toolchains installed
   locally).

Without step 1–2 configured, the sign-in button shows a toast explaining it's not set up yet,
rather than crashing.

## What changed vs. the web version

- **No more phone-mockup chrome.** The web version drew a fake iPhone frame (status bar, notch,
  "9:41" clock) to preview the app inside a desktop browser. That's gone — this *is* the phone
  now.
- **Styling**: Tailwind classNames were kept via [NativeWind](https://www.nativewind.dev) v4
  wherever they had a real RN meaning; hover/cursor/transition-only utilities were dropped (no
  pointer/hover concept on a touchscreen), and non-standard shade numbers the original
  occasionally used (`neutral-450`, `amber-850`, etc. — not part of Tailwind's real palette, and
  no-ops on the web too) were rounded to the nearest real shade.
- **`<select>` dropdowns** became the same horizontal chip-row pattern already used everywhere
  else in the app, for visual consistency, instead of a native picker wheel.
- **`<input type="range">`** sliders became `@react-native-community/slider`.
- **CSS `animate-*` utilities and the one inline `@keyframes` hack** (a "sound wave" animation in
  the practice overlay) were reimplemented with React Native's built-in `Animated` API
  (`src/components/ui.tsx`: `FadeInView`, `PulseView`, `SpinView`, `BounceView`, `WaveBars`).
- **Firebase Auth persistence** now uses `getReactNativePersistence` + AsyncStorage (the web
  version relied on browser storage implicitly).
- **The teleprompter/recorder is still fully simulated** — the original never captured real
  audio (no `MediaRecorder`/`getUserMedia` anywhere), just a timer-driven mock, so this port keeps
  it that way rather than adding real microphone capture that was never part of the product.
- **Bug fix**: the web version's "Listen" practice mode tried to detect verse boundaries via
  `verseObj.id`, a field that doesn't exist on `VerseState` — so verse-reference headers never
  actually appeared while scrolling through a playlist. The RN port fixes this (using a proper
  book/chapter/verse composite key), so those headers now show up correctly.

## Architecture

- `src/state/useAppState.ts` — every piece of state and business-logic handler from the
  original app's single mega-component, centralized into one hook. Screens receive it as a
  single `state` prop (`{ state }: { state: AppState }`) rather than through prop-drilling dozens
  of individual values, mirroring the original's single-closure design so the port carries low
  behavioral risk.
- `src/screens/` — one component per original "screen" (the original had no router; it's a
  hand-rolled state machine on `currentTab`/`currentScreen`, preserved as-is here).
- `src/components/ui.tsx` — small shared primitives (tooltip, chip-row picker, avatar, progress
  bar, animation wrappers) used across screens.
- `src/components/PracticeModals.tsx` — the listen/type/reveal practice overlay.
- `src/firebase.ts`, `src/types.ts`, `src/data.ts` — ported close to verbatim from the web app.
- `firebase-applet-config.json`, `firebase.json`, `firestore.rules`, `firebase-blueprint.json` —
  the same Firebase backend config as the web app (same project, same Firestore rules/schema).
- `CONVERSION_GUIDE.md` — the conversion conventions used throughout this port; useful if you're
  porting more screens or want to understand a specific decision.

## Known rough edges

- `@react-native-picker/picker` was intentionally **not** used (see above) — if you'd prefer a
  native wheel picker somewhere instead of the chip-row pattern, it's a drop-in addition.
- NativeWind v4's support for custom `@keyframes`-style Tailwind animations is inconsistently
  documented upstream; this port sidesteps that entirely by using React Native's own `Animated`
  API instead (see `src/components/ui.tsx`), which is guaranteed to work regardless.
