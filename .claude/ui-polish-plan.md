# UI polish plan — screen-by-screen audit and job list

Written 2026-09-24 on `translation-sources` (11 commits ahead of `main`, nothing on
`main` it lacks). The visual version with a screenshot of every screen is the
artifact: https://claude.ai/artifact/Weszwf3235MpSwDHNHSgvP

The user's brief: "this app feels kinda clunky... lots of small inconsistencies,
font differences... I want it to feel very modern and sleek." They will branch
one session per job from the audit chat. If you are one of those sessions, read
this whole file, then do only your job.

## Decisions

1. **Direction: B (clean modern)** — chosen by the user 2026-09-24 ("generally
   I like B more"). Sans (not serif) titles, grouped lists, one accent, serif
   only for verse text. The user added that the real Today layout "will look
   a bit different", so the mockups set the LOOK only; S1 designs Today with them.
2. **The look: Warm paper, navy, accent picker, floating tab bar** — chosen
   by the user 2026-09-24: "warm paper, and navy--but if we can retain an
   accent color option in settings, that is ideal. also, floating toolbar."
   ("Floating toolbar" = Soft tint's floating tab bar; nothing else in the
   mockups floats that Warm paper lacked.) Reference page, with the pick on
   four screens including the Settings picker:
   https://claude.ai/artifact/WW85ZJixhdqR8VmFFwAN8C (version 2; its source
   holds every value below). The other three variants (Clean, High contrast,
   Soft tint) were not taken. High contrast's larger text and spelled-out
   stage labels were suggested and not taken, so stages stay colored dots,
   but color must never be the only signal (pair a dot with a label or legend
   on the same screen).
3. **Text size: iPhone-standard 17pt body text** (the app is 14pt today).
   Every variant was built on it. The user picked one without objecting, so it
   counts as part of the pick. It changes the TYPE scale in `design.tsx` (F2).
4. **Demo preview kept (F0)** — built 2026-09-24, see below.

### The look, as values

- **Fonts:** Inter for everything you tap (400/500/600/700). Literata for
  scripture only (`@expo-google-fonts/literata`, 0.4.3 on npm: JS and font
  files only, no native module). Playfair Display is retired. Titles are
  sans (Inter 700).
- **Neutrals (light / dark):** canvas `#EFECE6` / `#141311` · card `#FFFDF9` /
  `#1F1D1A` · border `#E2DDD4` / `#2E2B27` · border-strong `#D9D3C8` /
  `#3B3833` · hairline `#ECE7DF` / `#2E2B27` · ink `#1E1C19` / `#F2EEE7` ·
  ink-2 `#4E4943` / `#CFC8BD` · ink-3 `#736C63` / `#9D958A` · segmented tray
  `#E5E0D6` / `#272420`, selected segment `#FFFDF9` / `#3A3631` · tab bar
  `rgba(255,253,249,.97)` / `rgba(27,25,22,.97)`, its edge `#E2DDD4` / `#2E2B27`.
- **Accents (light / dark), picked in Settings, Navy default:** Navy
  `#294C82` / `#8FB0E8` · Evergreen `#2D6A4F` / `#7CC4A0` · Burgundy
  `#8A2E3B` / `#E59AA6` · Plum `#6A3F8E` / `#C4A5E8` · Walnut `#7A4E2B` /
  `#D9AE84` · Ink `#2B2824` / `#E6E0D6`. Text on an accent fill is `#FFFFFF`
  (light) / `#0B0B0D` (dark). accent-soft = 13% accent over the card color
  (precompute it: RN has no `color-mix`). Every accent was checked at 4.5:1
  or better on card, canvas, its own accent-soft, and as button text, in both
  modes (Navy's weakest is 6.0).
- **Stage dots (mockup values, reconcile with the app's current ones):**
  daily `#2E9A68` / `#4CC38A` · weekly `#3A6BD6` / `#7BA1F2` · monthly
  `#C0831A` / `#E3B04B`.
- **Shape:** card radius 14, button 12, segmented control 9 (inner 7),
  floating bars fully rounded. Cards have a 1px border and no shadow. The
  floating bars carry the only shadow, and it is static. Icons are plain
  lucide in the accent color, with no tinted tiles. Main buttons are filled
  with the accent.

## The four root causes (why it feels clunky)

1. **Bold never renders on iPhone** (verified from source, not guessed).
   `tailwind.config.js` maps `font-sans` → `Inter_400Regular` and `font-serif`
   → `PlayfairDisplay_400Regular` (NativeWind takes `fontFamily[0]`, see
   `react-native-css-interop/dist/css-to-rn/parseDeclaration.js` parseFontFamily).
   `font-bold` etc. only set `fontWeight`. On iOS, expo-font aliases
   `Inter_400Regular` → PostScript `Inter-Regular`, and its swizzled
   `fontNames(forFamilyName:)` returns only `["Inter-Regular"]`, so Fabric's
   `RCTFontWithFontProperties` (RCTFontUtils.mm) picks the closest weight
   from a one-element list = Regular. Result: ~525 bold/semibold Inter or
   Playfair texts draw regular. ~185 texts/inputs with NO family class fall
   back to San Francisco (which bolds correctly) — ChipRow labels, many
   buttons, almost all of CommunityCreateScreen. `font-mono` is NativeWind's
   iOS preset `'Courier New'` (68 sites). Android would fake-bold instead.
2. **No shared parts.** 6 screen-header variants, 7 "pick one" controls
   (ChipRow flex-1 / ChipRow wrap / grey-tray segmented / day circles /
   OptionCards check-right / radio-left cards / empty-circle toggles), 7 radii,
   41 border colors, buttons in 4 capitalization styles.
3. **Color.** 741 hex literals (#1A1A1A ×338), 13+ text greys, 268 uses of
   `text-neutral-400` (2.5:1 on white — fails AA), 9 accent hues with no
   fixed meaning.
4. **Heavy styling.** 36 `border-2 border-[#1A1A1A]` containers (incl. Card /
   CollapsibleCard in `design.tsx`), 271 `uppercase` labels, boxes in boxes,
   Courier numbers, 33 emoji lines mixed with lucide icons.

## Rules every job follows

- Never put a `shadow-*` class in a conditional (iOS Fabric freeze — see
  memory `ios-fabric-shadow-deadlock`). Selection changes color/border only.
- Hold at 1.5× font scale on iPhone SE (375pt, 335pt content width).
- Density work as extracted components, never inline edits.
- Collapsibles: independent, persisted, never exclusive.
- Wrapped chip/tile rows are centered.
- Colors come from the tokens (F2), never hex literals, because the accent
  is the user's choice. Test anything accent-colored in at least Navy and Ink.
- Nothing may end hidden under the floating tab bar: scroll content uses the
  shared bottom inset from F4.
- Words: My Verses / My Schedule / Review Settings. Banned in visible copy:
  queue, priming, rigor, rhythm, phase, graduate, 7-6-5, Memory Plan.
- Finish with before/after screenshots (demo preview, `ios=1`), `npx tsc
  --noEmit` clean, `npm run check:layout` clean. Final feel is judged on the
  real phone, not the web preview.

## Jobs (in order)

### Foundation
- **F0 · Demo preview** — DONE and committed 2026-09-24 on
  `translation-sources`. `src/dev/DemoHarness.tsx` wraps the real `useAppState()` in
  `AppShell` (`useDemoState(useAppState())`): fakes a user, seeds a queue after
  `loadingAuth` settles, overrides community data. On only when the web URL
  has `?s=<screen>` (e.g. `/?s=chapterLanding&ios=1`) or `DEMO_ON_DEVICE` is
  flipped, and never when `__DEV__` is false. `ios=1` reproduces iPhone font
  rendering in the browser. Screenshots: start "expo-web", then
  `npm run shots -- --all` (or specific queries; see the header of
  `scripts/capture-screens.cjs`) → `.shots/` (gitignored). Before/after:
  `--out=.shots/before`. Inventories: `npm run scan:fonts`, `npm run scan:copy`.
- **F1 · Fonts that render** — DONE 2026-09-25 (uncommitted until the user
  reviews). What was built: `design.tsx` "Font faces" section — `APP_FONTS`
  (the one list `useFonts` loads: Inter 400/500/600/700 + 400 italic,
  Literata 400/500/600/700 + 400 italic), className → face resolver, and an
  `InheritedFont` context so a nested AppText keeps its parent's family/weight
  like RN text inheritance did. New `variant="inherit"` = no size (nested
  spans, AvatarCircle's circle-sized initial). All 16 raw `<Text>` outside
  `DevLayoutLab` converted. `tailwind.config.js` sans/mono → Inter, serif →
  Literata; Playfair package removed; `ios=1` no longer forces Courier.
  Original brief: In `AppText`/`AppTextInput`
  (`src/components/design.tsx`): resolve family from className tokens
  (`font-serif` → serif, `font-mono` → Inter + `fontVariant:['tabular-nums']`,
  none/`font-sans` → Inter) and weight tokens → the real file
  (`Inter_500Medium`, `Inter_600SemiBold`, `Inter_700Bold`; map
  extrabold/black → 700 unless we load 800/900), set it in `style` (style beats
  className) with `fontWeight:'normal'` so Android can't fake-bold. Serif
  digits: `lining-nums` (or use sans for numbers) — fixes bouncing chapter and
  calendar numbers. Convert the remaining raw `<Text>` (e.g. `AvatarCircle`
  in `ui.tsx`). Serif = Literata now (see "The look, as values"):
  `npx expo install @expo-google-fonts/literata`, load 400/500/600/700
  (+400 italic if anything uses italic), point `font-serif` at it, and drop
  the Playfair Display loads and package. Titles still marked `font-serif`
  render in Literata until their S job moves them to sans. That in-between
  state is expected.
- **F2 · Tokens + accent setting** (L). `tailwind.config.js` theme: semantic
  colors (ink / ink-2 / ink-3 / line / surface / canvas / accent /
  accent-soft / on-accent / success / warning / danger / stage-daily,
  -weekly, -monthly, -learning) with the values above, radius roles, and the
  TYPE scale moved to iPhone-standard sizes (decision 3). **The accent
  changes at runtime**, so colors can't be baked in at build time. Define
  them as CSS variables (`accent: 'rgb(var(--accent) / <alpha-value>)'`) and
  set the variables at the app root with NativeWind 4's `vars()`, computed
  from (chosen accent, light/dark). JS color props (lucide `color`, `Switch`
  track, `ActivityIndicator`, `StatusBar`) can't read CSS variables. Give
  them a `useThemeColors()` hook fed from the same palette object, or wrap
  lucide icons with `cssInterop` so `className="text-accent"` reaches
  `color`. Persist the choice in AsyncStorage (same pattern as
  `MEMORY_GRID_COLUMNS_KEY`, `useAppState.ts:692`). Read it before first paint
  so the app doesn't flash navy. Optionally mirror it to the user's profile
  so it follows them to a new phone. Add the **Settings › Appearance ›
  Accent color** row: six swatches, a check on the chosen one, and its name
  as the value. S9 restyles it with the rest of Settings. Codemod the
  hex/neutral classes in reviewable chunks, as the type migration did.
  neutral-400 is no longer allowed for text. Dark values are defined here, so
  dark mode later is a switch rather than a project (ui-overhaul bucket 1).
  Proof: the demo preview in each accent, plus a phone check that switching
  recolors the whole app instantly.
- **F3 · Building blocks** (L). ScreenHeader (back, title, optional eyebrow /
  subtitle / actions), SectionHeader, GroupedList + ListRow, SegmentedControl,
  ChoiceCard (one "pick one" pattern), Badge, AppButton variants (primary /
  secondary / quiet / destructive; sentence case), IconButton (round only),
  Avatar, EmptyState, Dialog shell (one overlay pattern — today there are 10
  `absolute inset-0` overlays and 11 RN `Modal`s), `formatDate` /
  `formatDuration`. Restyle CollapsibleCard, OptionCards, ToggleRow,
  StepperRow, ChipRow, Dropdown, HelpTooltip.
- **F4 · Floating tab bar + mini player** (M; after F2). Replace the tab bar
  in `App.tsx` (~line 564, inside the bottom `SafeAreaView`) with a floating
  pill:
  - Position and look: 16pt side margins, sitting 8pt above the home
    indicator (safe-area bottom + 8), about 64pt tall. Tab-bar surface
    color, hairline edge, one static shadow. The active tab is an
    accent-soft pill with the accent icon and label.
  - Content: screens scroll underneath it. Every tab screen's scroll content
    ends with bottom padding = bar height + inset + gap, from ONE shared
    hook or wrapper, never per-screen numbers. Chapter Landing's selection
    bar sits above it.
  - Fade: a soft fade to the page color behind the bar, so text never shows
    in the gaps. Build it with `react-native-svg` `LinearGradient`, already
    installed for lucide, so no new native module.
  - `NowPlayingBar` (~line 478) becomes the same pill style, floating 8pt
    above the tab bar. It is the mockup's Settings screen.
  - Hide both bars on chat screens (existing `chatScreenActive`) and while
    the keyboard is open. Hide by unmounting or moving the bar, never by
    toggling shadow classes.
  - Labels at 1.5×: cap label scaling (`maxFontSizeMultiplier` ≈ 1.3, as iOS
    does). Keep 44pt tap targets.

### Screens (one branch each, most-used first)
- **S1 Today** (M) · **S2 Practice + Listen** (L, includes the July
  practice-controls redesign, ui-overhaul bucket 2) · **S3 Verse Finder** (M)
  · **S4 My Memory Work** (L, bucket 3's personal/group split fits here) ·
  **S5 Review Settings** (M) · **S6 Record + recordings** (M) · **S7
  Community** (L) · **S8 People** (M) · **S9 Settings + first impressions** (M)

### Lock-in
- **L1 Guardrails** (S): extend `scripts/check-layout.cjs` — ban hex literals
  in className, `font-mono`, `text-neutral-400` on text, `uppercase` outside
  SectionHeader, raw Pressable buttons, conditional `shadow-*`.
- **L2 Big-text pass** (M): every screen at 1.5× on SE width, then the phone.

Optional quick-win session before everything: the 7 Bugs below.

## Per-screen findings

Tags: Bug / Font / Style / Copy / UX.

**S1 — Today** (`HomeScreen.tsx`)
- Font: header = tracked date + serif greeting + Courier "ABOUT 5 MIN TODAY".
- Style: section CollapsibleCards are thick black boxes w/ tall empty headers,
  uppercase titles, Courier counts.
- Font: "Listen"/"Learn" pills (no family → SF bold) next to Inter-regular
  "Pull Next Verses"/"Review All Due".
- Style: due rows = stage-colored stripe + colored serif ref + colored
  buttons (rainbow).
- UX: "Reset Reviews for Today" in red at the top of Review; move somewhere
  quieter (recall the 299-verse blast-radius incident).
- Style: lone "?" bubbles; full-size dropdown for "Show 30"; bottom tiles use a
  different card style.
- First run: three empty sections still render as tall "0 …" boxes under
  "Start here"; the Start-here card is a third card style.

**S2 — Practice** (`PracticeModals.tsx`)
- Bug: typing placeholder truncated ("…(nearby key").
- Style: uppercase mode tabs in grey tray; thick black practice box + rule;
  "Restart verse after"/"Words hidden" rows look disabled (grey on grey,
  Courier values); red "0 of 5 mistakes"; lone indigo mic.
- Build Up is the cleanest screen — use as the model.
- Copy: "⚡ Priming Window Size" / "lookahead priming" (~line 1943).
- Listen: dropdowns labeled "View"/"Verse Selection" instead of the value;
  faint verse text; uppercase labels; 40-word empty state naming "Chapter
  Landing page".

**S3 — Verse Finder**
- `BooksScreen.tsx`: good model list; serif old-style digits ("1 Samuel").
- `ChaptersScreen.tsx:42`: bouncing old-style digits; thick black box per
  number; pointless "CHAPTERS AVAILABLE" eyebrow.
- `ChapterLandingScreen.tsx`: every verse its own bordered card (make it a
  continuous list); header mixes 3 control styles (BSB dropdown, square
  "SELECT ALL"); one-off "Verse Layout" switcher; status sheet copy "How far
  into this phase?" / "Graduates next review" (~681–685); uppercase photo
  link; "Due: Today" chips crowd text.

**S4 — My Memory Work**
- `MemoryDeskScreen.tsx`: thick black menu rows, Courier values → grouped list.
- `ActivePlanScreen.tsx:430` — Bug: queue rows crushed (right cluster has no
  shrink; ref wraps, plan badge wraps to 3 lines, preview "What t…").
  Copy: "Memory Verse Queue" (:265), "Memory Queue is currently empty"
  (:386), raw `{group.status}` badge shows "QUEUED". Style: serif
  sentence-case title vs uppercase boxes above; orange/indigo stripes +
  badges; title 16pt vs Review Settings 22pt.
- `MemoryCalendarScreen.tsx:423`: each cell repeats weekday under the header
  row; bouncing serif digits; Courier "1m"; one-off "Calendar View" tray;
  faint intro.
- `FullHistoryScreen.tsx` — Bug: ChipRow date filters truncate ("Last 30 D…").
  Copy: every row "Added to your active memorization queue" (:38).
- `ReferenceDrillScreen.tsx`: chip labels in SF (no family); two chip
  geometries; on/off as empty radio circle instead of ToggleRow.

**S5 — Review Settings**
- `SavedPlansScreen.tsx:95` — Bug: description overflows the card to the
  right. Back button centered on a 3-line header; dashed Create box oversized.
- `PlanDesignerScreen.tsx`: paragraph + amber box + label before first
  control; name input thick black border (others thin grey); disabled
  uppercase "SAVE AS MY OWN" with shadow; toast "(7-6-5, 3 touches)" (:93).
- `App.tsx:372` MissedReviewPromptModal — Bug: `maxHeight:'85%'` card doesn't
  scroll, Apply renders outside it on an 844pt phone. Copy: "--", "->",
  escalation/graduation/phase/refresher. Third choice-card pattern.
- `MissPolicySection.tsx:43`: "…returns to its phase".

**S6 — Record + recordings**
- `RecordScreen.tsx:627`: "2026-09-20 • BSB • 312 seconds"; "TELEPROMPTER
  VERIFICATION" eyebrow; "Tap to Record recitation"; three dropdown widths.
- `RecordingDetailScreen.tsx`: "312 seconds" (:363) / "0s / 312s" (:398) /
  "05:12"; raw date (:367); "DELETE REC" red caps top-right; "EDIT SYNC".
- `App.tsx:157` SaveRecordingDialog: "CHAPTER:" caps+colon labels; raw
  Pressable buttons.
- `AudioFeedScreen.tsx`: titled "Suggested Recordings" vs tile "Find
  Recordings"; raw dates (:299); box-in-box ref; uppercase tabs/badges;
  six avatar colors; Book full-width vs Translation half-width.

**S7 — Community**
- `CommunityHomeScreen.tsx`: no title (only tab without one); Courier feed
  times; "Find Friends" built differently than Profile's; friends +
  communities duplicated on Profile.
- `CommunityFindScreen.tsx`: "FOUND 2 COMMUNITIES" in SF black; grey raised
  "VIEW DASHBOARD" vs black "JOIN CIRCLE".
- `CommunityCreateScreen.tsx`: 10/11 texts no family (SF); emoji 🔓🔒🛡️;
  placeholders lack `placeholderTextColor` (14 inputs app-wide lack it).
- `CommunityPreviewScreen.tsx`: mostly clean; "OWNER / SPONSOR"; shadowed
  caps button.
- `CommunityGroupDetailScreen.tsx:214` — Bug: avatar stack `marginLeft:-10`
  clips initials. Three tinted section buttons (indigo/amber/black); big pink
  "Disband & Delete".
- `GroupPlanDetailScreen.tsx`: "VERSE QUEUE (39)", "Your own queue leads"
  (:19); PACE/VERSE QUEUE/VERSE PRIORITY labels in SF black.

**S8 — People**
- `ProfileScreen.tsx`: square settings button; colored Courier stats;
  friends/communities duplicate Community; toast "Viewing X Circle! 🛡️".
- `DashboardScreen.tsx` (My Progress): Courier numbers, SF labels; five stripe
  colors + Courier chips; milestone grids left-packed.
- `MemberProfileScreen.tsx`: name shown twice; Message/Nudge/Challenge in
  three styles, caps; "REMOVE FRIEND" right under them.
- `DMThreadScreen.tsx` / `CircleChatScreen.tsx`: "+" reaction under every
  message; tall composer; headers differ.
- `FindFriendsScreen.tsx`, `MessagesScreen.tsx`: mostly clean; AvatarCircle's
  thick black ring is heavy (fix once in `ui.tsx`).

**S9 — Settings + first impressions**
- Keep the Appearance › Accent color row F2 adds; restyle it with the rest.
- `SettingsScreen.tsx` — Bug: "Until I'm Back" chip truncates. Section labels
  in SF extrabold caps; every setting boxed; four chip sizes; copy "freezes
  your whole queue --" (:314), "memory queue" (:368). Ideal grouped list.
- `OnboardingScreen.tsx`: thick green outlines on every card; spaced-caps CTA.
- `TourScreen.tsx`: best-written screen; just needs F1/F2.
- `AuthGateScreen.tsx`: bare first impression; "CONTINUE WITH GOOGLE" caps,
  no logo, thick outline.
- `App.tsx:268` ProgressModal: unreachable (nothing calls
  `setShowProgressModal(true)`), still says "My Scripture Memory Plan" /
  "Saved Memory Rhythms". Delete it and its state.

Other copy stragglers: `ChallengeCard.tsx:249` "stay in your queue"; toasts
with emoji in PlanDesigner/MissPolicySection/Profile/RecordingDetail.

## Tools

See F0. `npm run check:layout` already reports 4 errors before any of this
work (fixed heights in ChapterPhotoViewer, ListenPhotoView, ZoomablePhoto) —
not caused by the audit; worth clearing in L1.
