# Practice page plan

A Practice page that isn't tied to today's reviews: pick any verses the way the playlist builder does, then pick a mode. Reference practice becomes a multiple-choice mode inside it. Today's verses gets a "Reviewed today" section at the bottom.

Mockups: https://claude.ai/artifact/8n9CxrKRMdpngyFbhif3RM (private to the owner)

## Locked decisions (2026-11-13)

- **Home:** "Reference practice" and "Pick up the thread" leave the "More for today" menu. The menu is renamed "More". Pick up the thread is not added anywhere new. It is still offered after a passing Recall and lives in Mixed review as "Keep going".
- **Practice door:** a row in Home's list, in this order: Listen to today's scripture, then **Practice** ("Any verses, any mode"), then Today's verses. There's no third big button. The chapter page's Practice button stays as it is.
- **Name:** just "Practice".
- **Practice page, step 1:** the playlist builder's picker. It has My verses / Browse the Bible tabs and a search box. Tick a whole passage, or open it to tick single verses. A tray at the bottom shows what's picked, with chips that remove a passage. Next is in the header.
- **Practice page, step 2:** a mode list that runs on exactly the picked verses. There is no Due / Pick switch. The modes are grouped as "Counts if due" (Recall, Spot the gap, First words, Openings) and "Practice" (References, Build up, Order, Scramble, Teach-It, plus Put in order / Which section when sections exist). A mode the pick is too small for is hidden.
- **Counting:** practice on a due verse can count. A verse that isn't due never changes. This is the existing due-gated credit (`handleReviewCompleted` returns `'early'`).
- **References mode:** multiple choice, built for speed.
  - It shows up for any pick of 2+ verses. It is Practice only and never counts.
  - Directions are Verse → number, Number → verse, and Both (the default).
  - Up to 4 choices, always the nearest neighbors among the picked verses, so knowing a rough range isn't enough. A 2-verse pick gives 2 choices.
  - Number → verse choices are the first ~7 words of each neighbor.
  - With verses from several chapters, the prompt shows the chapter, and the choices are still neighbors within that chapter.
  - A right answer moves on after about 0.5 s. A wrong one shows the right answer, then moves on after about 1.3 s.
  - The end screen shows the score, the average seconds per answer, and the missed list, with "Go again with the missed ones".
- **Today's verses:** the Review list shows only what's still due. A new "Reviewed today" section goes at the very bottom, after Learning and Coming up. Each row has a check, the mode used, the time, and how it went (Perfect / Passed / Need practice).
- **No bottom sheets.** Pop-ups stay centered.

## Stages

Each stage ends with the CLAUDE.md verify line (tsc + checks) and a demo-mode look (`?s=<screen>`).

### 1. Home cleanup
- `src/screens/HomeScreen.tsx`: remove the two menu items, rename the menu "More", and order the list as Listen, then Practice, then Today's verses.
- The Practice row goes to the new `practice` screen. Until stage 3 lands, it can point to a stub.

### 2. Pull the picker out of the playlist editor
- Following the extract-don't-edit-inline rule, move `MyVersesPicker`, `BiblePicker`, `splitIntoPassages`, `orderedPassages` and the tray from `src/components/practice/PlaylistEditor.tsx` into a shared `src/components/versePicker/` component. It holds the picked-verses state and has an `onChange` callback.
- `PlaylistEditor` uses it with no change in behavior. Recheck the playlist flow in demo mode.

### 3. The Practice page
- Add a `'practice'` screen to the screen list in `src/state/useAppState.ts` (and its list near line 182), a case in `App.tsx`, and `?s=practice` in `src/dev/DemoHarness.tsx`.
- Step 1 is the shared picker. Next is disabled until something is picked.
- Step 2 is the mode list, grouped Counts if due / Practice. The rules for which modes are available (currently inline in `useRecall.ts` `learnModes`: Order needs 3+, Spot the gap needs `gapFits`, Openings needs 2+, sections) move into a pure `src/lib/practiceModes.ts`, so the page and the practice pop-up share one rule set.
- Tapping a mode calls `startPractice('learn', pickedVerses, { learnTab })`, the same path the chapter page uses.

### 4. References mode
- Pure logic goes in `src/lib/referenceQuiz.ts`: building questions, the 4-neighbor window clamped to the chapter, openings, the direction mix, and the missed-again round. Add `npm run check:refquiz` (copied from `scripts/run-passages-check.cjs`).
- The UI goes in `src/components/drills/ReferenceQuizDrill.tsx`.
- Add `'references'` to `LearnMode` in `src/components/practice/useRecall.ts`, add it to the mode list for 2+ verses, and render it in `RecallPanel.tsx`. It never calls a credit path.
- Its settings (direction) go behind the mode's gear, like Build up's.

### 5. Today's verses: Reviewed today at the bottom
- `src/screens/TodayVersesScreen.tsx`: take `doneTodayGroups` out of the Review list and give them their own "Reviewed today" `GroupedList` after Coming up.
- Tapping a row opens the same centered pop-up, with **Practice** added. Practice opens the step 2 mode list with those verses.
- **Find out why done passages don't show at all on the owner's build** before relying on `doneTodayGroups`.
- The mode, time and grade on each row depend on what history stores per review. If one of them isn't stored, show what is and note the gap. Don't add AppState fields without asking.

### 6. Retire the old Reference screen
- Delete `src/screens/ReferenceDrillScreen.tsx`, the `'referenceDrill'` screen (in `useAppState.ts`, `App.tsx` and `SESSION_SCREENS`), and its DemoHarness entry. Its cross-book use is covered by References with "All my verses" picked.
- Keep `ThreadDrillScreen`, since a passing Recall still opens it.
- Update the memory notes: practice modes, and the new Practice page.

## Answered questions (2026-11-13)

1. **References choices come only from the picked verses** in that chapter, the nearest neighbors first. If only 2 verses are picked, there are only 2 choices: never pad with unpicked verses.
2. **The Practice picker starts empty** every time.
4. **Picks from several chapters:** References mixes them all into one round. Every other mode runs one chapter at a time. When a chapter's pop-up closes, the Practice page offers "Next passage" or "Stop". A mode shows when it fits at least one chapter and names the chapters it skips (built in stage 3).
3. **Hebrew and Greek verses are left out of References for now.** Hide the mode when the pick has fewer than 2 verses left after dropping them.
