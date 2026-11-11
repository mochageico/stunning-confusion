# UI simplify plan — page by page

Written 2026-11-10 from a look at every screen in the demo preview (375pt wide,
`ios=1`). This is the job list for the sessions that do the rewriting. Read it
first, then do one job per session.

## The goal, in the owner's words

"I want the app to look professional; right now it looks just well vibe-coded.
Re-arranging things is ideal, and honestly just simplifying the pages. It is ok
if things are hidden behind a button. Draw from the way daily-use, professional,
task-oriented apps (think Duolingo) are set up."

## What is already fine (do not redo)

The look itself is settled and good: Warm paper colors, Inter + Literata, the
accent picker, dark mode, the type scale, the floating tab bar, the shared
blocks in `src/components/blocks.tsx`, `design.tsx`, `ui.tsx`. `.claude/ui-polish-plan.md`
holds those values. This plan changes **what is on each page and where**, not
colors or fonts.

## Why it still reads as vibe-coded

Each of these was seen on real screens. They are the things to remove.

1. **Every page is a control panel.** Today shows about 25 things to tap:
   Listen and Learn on every row, Guided learning, Start next verses, Mixed
   review, Recite all due, Reset today's reviews, Coming up next, Add verses,
   All on My Verses, Listen to all, Next 7 days, and four more tools. A
   professional daily app gives one obvious next step.
2. **Two or three big buttons compete.** Today stacks Guided learning + Start
   next verses, then Mixed review + Recite all due. Guided has Begin + Start
   with verse 4 instead.
3. **A setup form before every activity.** Mixed review, Guided learning, Pick
   up the thread and Reference practice all open on a page of options and only
   then a Start button.
4. **Paragraphs explain what the layout should make obvious.** Tip boxes at the
   top of Verses, the chapter page and the practice window; a three-sentence
   disclaimer above the Calendar; footnotes like "BSB stays picked for next
   time", "Total time with a practice or listen session open", "A chapter
   without sections is taken a few verses at a time".
5. **Rare and destructive actions sit in the open.** Delete on every waiting
   verse, Reset today's reviews, Disband circle, Remove from My Verses, Delete
   recording, Stop sharing my progress, and a Developer section in Settings.
6. **Too many pickers stacked.** The practice window shows a 6-way mode grid,
   a Passage / Memory grid switch, two dropdowns and two buttons at once. Listen
   has a dropdown, a List / Grid switch and four chips above Play.
7. **Rows wrap and truncate.** Settings rows wrap to three lines ("Memory Plan
   Designer" beside "3 days · 3 a day · Standard"). Recording details wrap
   their values. The chapter player cuts its title to "Romans 8 Full Cha…".
8. **Long lists of things that do not matter today.** My progress lists ten
   memorized milestones down to "5000 verses, 4987 to go".
9. **Word drift.** "Memory Plan Designer" (Settings and the Plan tab) uses the
   banned "Memory Plan". Guided says "Graduating verses waits" (banned
   "graduate"). The tab is "Verses", its first segment "My Verses".

## The rules (how the professional apps do it)

Apply these to every page. They are the test for "is this page done".

- **R1 · One job per page, few big buttons.** At most one accent-filled
  button on most pages; Today may have two big ones (D1), never more. Other
  actions are quiet text or outline buttons, and rare ones go in the ⋯ menu.
- **R2 · Tap, then do.** An activity starts on the first tap using the last
  choices. Options live behind a gear in the session header, in a centered pop-up,
  and are remembered.
- **R3 · Sessions are full screen.** No tab bar. Top: close ✕, a progress bar,
  a gear. Bottom: one action bar. Every session ends on the same finish page
  (what you did, streak, one Done button).
- **R4 · Rare and destructive actions go in a ⋯ menu** in the header or on the
  row, with a confirm for anything that deletes.
- **R5 · Title plus at most one short line.** No paragraph under a title, no
  footnote under a control. If a control needs a sentence, the label is wrong.
  A tip appears once, as a small dismissible line, never as the first block of
  a page.
- **R6 · A list row is one line of label, one line of value.** Shorten the
  label or drop the value before letting it wrap at normal text size. (At
  1.5× text, value moves under the label; it never squeezes beside it.)
- **R7 · Show the next one, hide the rest.** Next milestone, next review,
  next verse. "See all" opens the full list.
- **R8 · Sections may collapse, any number open at once, choice remembered.**
  (Owner's long-standing rule. Hiding things behind a button is now welcome,
  2026-11-10; forced one-at-a-time accordions are still not.)
- **R9 · Keep the words.** My Verses / My Schedule / Review Settings. Stage
  names Learning, Settling, Steady, Kept, Secure. Never: queue, priming, rigor,
  rhythm, phase, graduate, 7-6-5, Memory Plan.

Standing technical rules still apply: never toggle `shadow-*` classes
conditionally; token colors only; hold at 1.5× text on a 375pt phone; build
new layout as extracted components, not inline edits; keep `AppState`'s shape
unchanged unless a job says otherwise.

## Owner's decisions (2026-11-10)

Sketches of the targets: https://claude.ai/artifact/KMD2n9jhwYLbzTvLwXBzs6
(Today, Today ⋯ menu, practice session, practice gear pop-up, Listen, Verses,
chapter page, Audio tab, Me). Treat them as the target layouts for Jobs 1–3,
5, 7, 10, 11 unless the owner comments otherwise on the canvas.

- **D1 · Today keeps two big buttons, not one.** The owner wants the choice
  between reviewing and starting the next verses. Today: "Review · N due"
  (filled) and "Learn next verses" (soft fill), side by side in one Today
  card. Two big buttons is the max on Today; other pages keep one.
- **D2 · Audio stays a tab, and gets more prominent.** Audio is what sets the
  app apart: recordings, and the listening-first step (hearing a passage
  passively for 1–2 weeks before learning it). Tab bar: Today · Verses ·
  Audio · Community · Me, with Audio in the middle. The tab is the audio hub:
  record, Listening first, My recordings, From friends and circles.
  Listening first also gets its own section on Today and a group on Verses.
  The visible name for it is **"Listening first"** ("priming" stays banned).
  The "Ready to learn in N days" progress on Today needs new tracking of
  listening days; check what exists before building it.
- **D3 · Profile + My progress + Settings → one "Me" tab.** Agreed.
- **D4 · "Memory Plan Designer" renamed.** Agreed: the Plan tab shows My
  Schedule and Review Settings with no overall title; the Settings row is
  "Schedule and reviews".
- **Explanation paragraphs:** the owner finds them excessive and annoying;
  remove them and let the layout explain. The tutorial will be reworked
  separately later to explain the app (not part of this plan).
- **Pickers and button piles:** agreed, the worst offender. Push options into
  gear pop-ups.
- **Destructive actions:** agreed, far too exposed. ⋯ menus with confirm.
- **Wrapping and truncation:** sometimes fine, judge per place (R6 is a
  guide, not a hard rule).

### Round 2 feedback (2026-11-10, same day)

- **"Listening first" is out** as a name ("kinda just weird to say"). Sketches
  now use "Coming up" (the app's current wording). Final name still open.
- **Today was still too busy.** Keep the top Review / Learn next verses pair
  (owner likes it). Three calmer options drawn (Today A, B, C) plus a "Learn
  next" pop-up for when several verses stack up waiting. Owner picks one.
- **One button, one job.** Never let the same-looking button start audio in
  one place and reviews in another. Audio actions use the headphones icon and
  an outline style; filled accent is for practice only.
- **More for today menu: keep.** Rename "Verse Finder" to **"Bible"**
  everywhere.
- **Practice:** the mode chip ("Recall ▾") picks the way to practice; the gear
  holds only that mode's settings ("Recall settings"). Modes are no longer
  listed in the gear pop-up.
- **Listen:** keep the current bold-current-verse style and current repeat
  model (N× each, loop a range by tapping a start then an end verse, Loop
  all, Shuffle in the gear). Follow becomes an icon-only button bottom right
  of the text, a target/crosshair icon. Text / Page switch for the Bible page
  photo; on Page the current verse shows bold under the photo.
- **Verses:** good; group renamed "Coming up".
- **Chapter page: change very little.** Keep today's header, "3 of 39 verses
  memorized", heat strip, and the player card with Add page as they are. Only
  changes: First words / Sections / Takeaways go behind one "Study tools"
  button, the tip box goes, and selecting verses raises the bottom bar (Add,
  Listen, Record, I know these). Owner found the round-1 sketch's font and
  spacing "goofy"; match the real app, not the sketch.
- **Audio tab:** remove the listening row; record card, My recordings, From
  friends and circles only.
- **Me:** approved as sketched.
- **Tutorial:** to be reworked later to explain the app better (separate job).

### Round 3 feedback (2026-11-10)

- **Today: option A chosen.** Its "Today's verses" row opens the Today's
  verses page (sketched): Review (done ones ticked and crossed out), Learning
  (progress pips), Coming up (listen only, days heard), and one outlined
  "Listen to today's scripture" button at the top. No buttons on rows.
- **The audio row on Today is "Listen to today's scripture"**, not "Coming
  up": it always plays both the review verses and the coming-up passages.
- **Practice: Start over stays in the bottom bar**, beside Show next word.
  Not in the gear pop-up.
- **Listen (text): no bold.** Keep the current app's look: each verse with a
  small reference label, the playing verse on a soft accent fill, a looped
  range on a soft green fill, verses outside the range faded. The
  "Looping 28–29 ✕" tag sits below the progress bar, not above the verses.
- **Listen with the Bible page photo: approved.**
- **No bottom sheets anywhere.** The owner finds pop-ups that slide up from
  the bottom glitchy and annoying. Every menu, options panel and chooser is a
  centered pop-up (dialog) with a Close / Done / Cancel in its header. The
  selected-verses bar on the chapter page is a bar, not a sheet, and stays.

## Job 0 · Shared pieces (do first, one session)

**Built 2026-11-10** in `src/components/session.tsx`, shown at `?s=blocks`
(top of the page): `SessionShell`, `SessionDone`, `OptionsPopup`,
`OverflowMenu` (with confirm), plus three pieces the sketches called for:
`ActionCard` (Today's Review / Learn next cards), `IconTile` (soft icon square
for rows like Listen to today's scripture), `ModeChip` (the "Recall ▾" pill).
Checked in light, dark and 1.5× text at 375pt. Not built, on purpose:
the `ListRow` fix (owner said wrapping is sometimes fine; fix per page
instead), `InlineTip` (tips get reworked with the tutorial later; page jobs
just delete tip boxes), `PrimaryBar` (Today has two buttons; sessions use
SessionShell's bottom bar). Original list kept below for reference.

Build in `src/components/`, show each in `?s=blocks`, use them in the jobs below.

- **`SessionShell`** — full-screen frame for R3: ✕, progress bar, gear slot,
  scrolling body, bottom action bar above the keyboard. Hides the tab bar.
- **`SessionDone`** — the shared finish page. Start from
  `src/components/practice/ReviewRecap.tsx`.
- **`OptionsPopup`** — centered pop-up (never a bottom sheet) holding a session's settings (R2). Reuse
  `ToggleRow`, `ChipRow`, `DiscreteSlider`.
- **`OverflowMenu`** — the ⋯ button and its menu, with a `danger` item style
  and built-in confirm (R4).
- **`ListRow` fix** — make the existing row follow R6 (label never wraps at 1×;
  value truncates; stacked layout at large text). Fixes Settings and Recording
  details at once.
- **`InlineTip`** — a one-line dismissible replacement for the big `OneTimeTip`
  box (R5). Six files use `OneTimeTip`.
- **`PrimaryBar`** — the single filled button pinned above the tab bar, so
  every page puts its main action in the same place.

Check: `npx tsc --noEmit -p .`, `npm run check:layout`, blocks gallery in
light, dark, and `scale=1.5&w=375`.

## Jobs, page by page

Most-used first. One session each unless noted. Each job: screenshot before,
rewrite, screenshot after (`npm run shots -- "s=<screen>&ios=1"`, plus
`w=375&scale=1.5` and `dark=1`), run the checks in `CLAUDE.md`.

### Job 1 · Today — `HomeScreen.tsx`, `TodayCards.tsx`

**Built 2026-11-10 as option A** (owner's pick): `HomeScreen.tsx` rewritten,
new `TodayVersesScreen.tsx` (screen `todayVerses`, demo `?s=todayVerses`),
Today's sorting moved to `src/state/useToday.ts`. Review opens Mixed review;
Learn next goes straight into Guided learning when there's one passage and
nothing waiting, otherwise opens the centered Learn next pop-up (Keep going
rows, Guided learning, Start new). The ⋯ menu holds Listen, Review one at a
time, Next 7 days, Reference practice, Pick up the thread, Bible, Find
recordings, Add verses, and Reset (with confirm). Per-passage Review / Listen /
"I reviewed it elsewhere" / Open chapter moved to a centered pop-up on
Today's verses rows. The week strip shows the last seven days (rolling), from
`activityLast15Days`. Not yet phone-tested. The text below is the earlier
draft, kept for reference.
Now: two big cards with two filled buttons each, per-row Listen + Learn/Review,
Reset, Coming up next, Add verses, Listen to all, Next 7 days, More (4 tools).
Target (see the Today sketch):
- Header: greeting, "About 8 min today", streak count and ⋯ at the right.
- One Today card: progress bar ("2 of 11 done"), then the two big buttons
  (D1): Review · N due and Learn next verses. When everything is done the card
  becomes a finished state ("Done for today", next due time).
- Learning now: one row per passage with progress pips and a small play
  button. Tapping the row practices it.
- Listening first (the old "Coming up next"): a Play all header and one row
  per upcoming passage with how long until it is ready to learn.
- Due for review: reference, stage dot, small play button; "Show N more".
- Everything else leaves the page: Reset today's reviews → ⋯ in the header.
  Next 7 days → the Calendar tab. Verse Finder, Find recordings, Reference
  practice, Pick up the thread → a **Practice** row that opens a short list
  (Job 6). Listen to all → ⋯ in the header.
- Empty state (`?s=home&empty=1`): one sentence and one "Add verses" button.

### Job 2 · Practice window — `PracticeModals.tsx`, `practice/RecallPanel.tsx`, `drills/*`

**Built 2026-11-10 (Recall part).** The practice header is now close, session progress, gear; then the reference and a "Recall ▾" mode chip that opens a centered "Way to practice" pop-up. The 2-row mode grid, the Passage / Memory grid switch and the inline Words hidden / Grid shows / Verse order rows moved into the gear's centered pop-up ("Recall settings"), with "Log a review by hand" at its bottom (the clipboard button is gone from the header). The two first-time tip boxes were removed. Start over and Reveal word stay in view under the passage. Drills done too (same day): Build up (bite size, build from), Spot (swaps per verse) and First words (words shown, order, answer by, the two toggles) take a `gear` prop (`DrillGear` in session.tsx) and show those settings in the gear pop-up instead of on screen; without the prop (Guided learning, Mixed review) they keep the old inline look. The other drills had no settings. Listen keeps its old header until Job 3. Not phone-tested.
Now: tip box, 6-mode grid, Passage / Memory grid switch, two dropdowns, two
buttons, all visible at once.
Target: move into `SessionShell`.
- Header: ✕, reference, progress, gear.
- Mode: one chip showing the current mode ("Recall ▾") that opens a pop-up with
  the six modes and a line on each. Not a permanent grid.
- Words hidden, Verse order, Passage / Memory grid → the gear's `OptionsPopup`.
- Body: only the verse area and the mistakes / words counter.
- Bottom bar: the mic or input, with Reveal word as the quiet action. Start
  over stays visible in the bottom bar (owner: hiding it is inconvenient).
- The mark-as-reviewed clipboard icon → gear pop-up as "Log a review by hand".
- Every drill in `drills/` gets the same shell and the same bottom bar position
  for its Check / Next button.

### Job 3 · Listen window — `practice/ListenPanel.tsx`

**Built 2026-11-10.** Header matches practice: minimize ✕, the reference,
"2 of 5", gear. Under it a "Selected verses ▾" chip opens a centered "Which
verses play" pop-up (sources, Coming up's "show up to" count, Edit playlist,
Create playlist), plus a Text / Page switch when the chapter has a page photo.
Verse list look unchanged (no bold; soft accent playing, soft green loop,
faded outside). Follow is an icon-only target button in the list's bottom
right. The "Tap a verse…" line and the status bar are gone; a looped range
shows as one slim "⟲ 28–29 ✕" line under the progress bar. Speed and "N×
each" stay as chips; Shuffle, Loop all and List / Memory grid moved to the
gear's "Listen settings" pop-up. The narrator credit stays on screen (the
Hebrew reading's licence needs it wherever it plays). Page switch not seen in
the demo (no photos there). Not phone-tested.
Target: `SessionShell`. Verse text fills the page. Bottom: a big Play, with
speed and repeat as two small chips beside it. Shuffle, Loop, Follow, List /
Grid and the "Selected verses" picker → gear pop-up. The narrator credit moves
into the pop-up. Drop the "Tap a verse to start there…" line (R5); keep the
behavior.

### Job 4 · Mixed review and Guided learning — `MixedReviewScreen.tsx`, `GuidedLearningScreen.tsx`

**Built 2026-11-10.** Both now open on their first step; the setup pages are
gone. Header row matches practice: ✕, progress (Mixed) or the step (Guided),
gear. Mixed review's gear ("Review settings"): chapters to include (checkboxes,
at least one stays on; changing them rebuilds the rest of the session, and
verses already reviewed today stay done) and a Review formats row to Settings.
"Add sections to …" moved to the finish page. Guided's gear: Passage (radio
list) and "Start a verse now" (verses with no runs yet start on tap; replaces
"Start with verse N instead"). The reviews-due box became one line plus a
Review now button on the finish page, and "Graduating" is gone. Not done: the
finish pages were not moved onto `SessionDone`, and the tab bar still shows
during these sessions. Not phone-tested.
Now: each opens on a setup page (chapter checkboxes, "Add sections to…" links,
formats line; passage dropdown, verse list, warning box, two buttons).
Target (R2): the Start on Today goes straight into the first step.
- Setup pages become the gear pop-ups: chapters to include, formats (link to
  Settings › Review formats), which passage, "start with verse 4 instead".
- "Add sections to Romans 8" is offered once on the finish page, not before
  starting.
- The "5 reviews due" notice in Guided becomes one line on the finish page or
  a toast; fix the banned word "Graduating".
- Both use `SessionShell` and end on `SessionDone`.
- Do these as two sessions; they are the two largest screens.

### Job 5 · Verses tab — `ActivePlanScreen.tsx`, `VersesTabs.tsx`, `VerseStages.tsx`, `VersesByBook.tsx`

**Built 2026-11-10.** Header: search, + (outline icons) and ⋯ (The road,
Where verses come from when a group plan is joined, Takeaways, History). The
tip box, the "road every verse travels" card, the stage captions and the
bottom blocks are gone. One slim card "13 of 22 learned" with the stage bar
opens The road; "Looking ahead" (1 month / 3 months / 1 year) now lives at the
top of The road. One chip row (`FilterChips`, new in session.tsx): All · Due ·
N · Coming up · N · By book · Map. "Waiting to start" is "Coming up". Coming
up rows are one reference line (translation in grey) and one text line, with a
quiet ⋯ (Start learning now, Move to top, Remove from My Verses with confirm);
the Start learning button and swipe-to-delete are gone; holding a row still
reorders. `OverflowMenu` takes `variant="bare"` for row menus. Segments kept
as My Verses · Plan · Calendar. Not phone-tested.
Now: search + Add at top, 3-way switch, a tip box, Due only + By stage
controls, a progress card with "The road" and "Looking ahead", stage sections
with Delete and Start learning on each waiting verse, then "Where your verses
come from", "Your progress", Takeaways, History at the bottom.
Target:
- Header: "Verses", count line, search and + icons. Segments stay: My Verses ·
  Plan · Calendar (rename first segment to "List" if D4-style cleanup is
  wanted, since the tab is already "Verses").
- One slim progress bar with "13 of 22 learned"; tapping it opens The road.
  "Looking ahead" moves into The road.
- One filter chip row: All · Due · By book. Replaces Due only + the dropdown.
- Stage sections collapsed to a header with count; verse rows are one
  reference line and one text line. Delete and Start learning → the row's ⋯.
- Remove the bottom blocks: verse sources → header ⋯ ("Where verses come
  from"), Your progress → Me tab, Takeaways and History → header ⋯ or Me.
- Tip box → `InlineTip` or gone.

### Job 6 · Practice list (new small page) + the two drill setups — `ThreadDrillScreen.tsx`, `ReferenceDrillScreen.tsx`

**Built 2026-11-10.** Reference practice and Pick up the thread start on the
first tap with the last choices (kept for the app session). Both run in
`SessionShell` (✕, progress, "3 of 10", gear) and end on `SessionDone`
(Reference: right / score; Thread: reviewed / slip spots, then Where you
slipped with "Drill it", and What counted). The setup forms moved into the
gear pop-ups ("Reference practice settings", "Thread settings"), without the
row subtitles; a change restarts the session when Done is tapped. "Hard mode"
reads "Type the answer". If nothing matches, the shell shows one line and the
gear. The tab bar hides on these two screens (`SESSION_SCREENS` in App.tsx;
`SessionShell`/`SessionDone` take `safeTop={false}` inside a tab screen).
Skipped: the separate Practice list page — Today's ⋯ already lists Reference
practice, Pick up the thread and Bible (Job 1). Not phone-tested.
A short page listing the extra practices (Reference practice, Pick up the
thread, Verse Finder, the Map), one row each with a one-line description.
Each drill starts on tap with remembered options (R2); its current setup form
(From, Chapter, Verses at a time, How many, Hide verse numbers, Hard mode…)
becomes the gear pop-up. Sessions use `SessionShell` + `SessionDone`.

### Job 7 · Chapter page — `ChapterLandingScreen.tsx`, `ChapterSections.tsx`, `ChapterLibraryPlayer.tsx`

**Built 2026-11-10, per Round 2 (change very little).** Header, "3 of 39
verses memorized", heat strip and the player card with Add page are as they
were. First words / Sections / Takeaways moved behind one quiet "Study tools"
button (a centered pop-up), with Select all on the same line. The tip box and
the "Tap a verse to select it" heading are gone. The selected-verses bar now
holds Add · Listen (headphones) · Record · I know these, each an icon over a
label; Record fills the Audio tab's passage with the picked verses and opens
it; Learn left the bar (Today and Verses start learning). The "Already know
these?" pop-up is centered (was a bottom sheet) and lost its paragraph. Not
phone-tested.
Now: translation picker + list icon, tip box, heat strip, player card with a
truncated title and "Add page", three chips (First words, Sections,
Takeaways), "Tap a verse to select it / Select all", then the verses.
Target:
- Header: Back, "Romans 8", translation chip, ⋯ (Sections, Takeaways, First
  words, Add page photo, Select all).
- One line under the title: "3 of 39 memorized" with the heat strip.
- Player becomes a single small play button in the header row or a slim bar
  (title not shown, since the page title already says Romans 8; recording
  choice inside its pop-up).
- Verses start within the first third of the screen.
- Selecting verses raises a bottom action bar (Add · Status · Listen), which
  is where the instructions now live — no tip box.

### Job 8 · Verse page — `VersePageScreen.tsx`

**Built 2026-11-10.** Text, the four-stop stage line, then one status line
("Every week, 3 of 8 reviews · next today") with its bar, the slip note when
there is one, and the numbers as one grey line ("61 good reviews · 1 missed ·
123 days with it"). The explainer sentence and the three stat tiles are gone.
Practice (filled) and Listen (headphones, outlined) sit in the status card.
The ladder and Its story are folded sections, closed by default and
remembered. Connect to another verse, Open chapter and Remove from My Verses
(with confirm) moved to the header's ⋯. No PrimaryBar (not built in Job 0).
Not phone-tested.
Now: text, 4-step stage line, status card, the full 8-step ladder, Practice /
Listen, three stats, Its story, Connect, Open chapter, Remove.
Target: text, the stage line, one status sentence ("Every week · 3 of 8 ·
next today"), then `PrimaryBar` Practice with Listen beside it. "The ladder"
and "Its story" become collapsed sections (R8). Stats become one line.
Connect on the Map, Open chapter, Remove → ⋯.

### Job 9 · Plan and Calendar — `MemoryPlanScreen.tsx`, `RhythmEditor.tsx`, `ReviewSettings.tsx`, `MemoryCalendarScreen.tsx`

**Built 2026-11-10.** Plan: the "Memory Plan Designer" title, its paragraph
and the "Tap a setting…" line are gone. My Schedule unchanged. Review
Settings uses a new `compact` mode: the four Retention Level choices and one
line ("About 28 months to Secure · 3 perfect recalls to learn"); "Fine-tune"
opens the step table and the four other setting rows (each still opens its
own preview). Calendar: the disclaimer is behind a (?) beside "Next 2 weeks";
the totals and bars stay; after the first week, days with nothing due wait
behind "Show 2 weeks"; the green Lightest days box is one grey line; the day
pop-up is centered. Not phone-tested.
Plan: keep My Schedule fully visible (it is good). Review Settings shows only
the four Retention Level choices and one summary line; the step-by-step table
and the four fine-tuning rows go behind "Fine-tune". Remove the page title and
paragraph (D4).
Calendar: drop the disclaimer paragraph for a small ⓘ. Keep the two totals and
the day bars; hide days with nothing after the first week behind "Show 2 weeks".

### Job 10 · Me — `ProfileScreen.tsx`, `DashboardScreen.tsx`, `SettingsScreen.tsx`
(Shape depends on D3.)
- Top: avatar, name, streak. Three numbers. The 90-day chart.
- Next streak milestone and next verse milestone only (R7); "All milestones"
  opens the rest.
- "Where your verses are" leaves this page (it duplicates the Verses tab).
- "Time studied" joins the numbers row; drop its footnote.
- Settings: apply the `ListRow` fix; rename the plan row (D4); hide the
  Developer section unless `__DEV__`; notifications inbox stays on Me with a
  badge.

### Job 11 · Audio tab and recordings — `RecordScreen.tsx`, `RecordingDetailScreen.tsx`, `MyRecordingsScreen.tsx`, `AudioFeedScreen.tsx`
The Record tab becomes the Audio tab (D2, see the Audio sketch): a record card
(passage, Change, Start recording), a Listening first row with play, My
recordings (play, title, date · length · who can hear it), From friends and
circles (Find more). Import goes into ⋯. The recording screen itself keeps
today's layout minus the subtitle. Consider moving this job up to right after
Job 3, since audio is the app's center.
Recording detail: player on top, then Who can hear it. Details (translation,
length, date, speaker) collapse to the one line already under the title.
Verse timing becomes one row "Verse timing · not set" that opens its editor.
Delete → ⋯.
Find recordings: the people strip and two dropdowns become one filter chip
row; each recording is one row with play on the left and Save in ⋯ or as a
small icon.

### Job 12 · Community — `CommunityHomeScreen.tsx`, `CommunityGroupDetailScreen.tsx`, `GroupPlanDetailScreen.tsx`, `MemberProfileScreen.tsx`, find / create / preview
Community home is close. Make the three sections plain (no collapse arrows on
a page this short), put New circle / Find circles / Add friends under one +
button in the header.
Circle page: Chat first if there are unread messages. "Stop sharing my
progress" and "Disband circle" → the header's settings pop-up. The weekly
summary becomes one card, not three blocks.

### Job 13 · First run and small pages — `OnboardingScreen.tsx`, `AuthGateScreen.tsx`, `AddVersesScreen.tsx`, `TakeawaysScreen.tsx`, `BooksScreen.tsx`, `ChaptersScreen.tsx`, `FullHistoryScreen.tsx`
Onboarding: one question per page with a progress bar and a single Continue
button (the Duolingo pattern), instead of one long scrolling page. "How this
works" shrinks to three short lines.
Add verses: drop both footnotes; the range reads "Verses 1 to 4".
The rest: apply R1, R5, R6 and move on; they are already simple.

### Job 14 · Lock-in
Sweep every screen with `npm run shots -- --overflow --all "w=375&scale=1.5"`
and in dark mode. Grep visible strings for the banned words. Count filled
buttons per screen (R1). Final judgment is on the real phone.

## Order and size

Job 0 → 1 → 2 → 3 → 4 (two sessions) → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14.
Jobs 1–4 are what the owner touches every day and carry most of the
"professional" feeling. Stopping after Job 5 would already change how the app
reads.

## How to look at a page

`preview_start` "expo-web", then `http://localhost:8099/?s=<screen>&ios=1`
(screens are listed in `scripts/capture-screens.cjs`; also `versePage`, `map`,
`blocks`). Add `dark=1`, `scale=1.5`, `accent=ink`. The `.shots/` folder cannot
be read by Claude's file tool in this project, so view pages in the Browser
pane instead.
