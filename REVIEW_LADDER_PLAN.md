# Review ladder, passages and grading — decisions

Written 2026-10-27 from a design conversation with the user. **Nothing here is built
yet.** This file records what was decided; a staged build plan (like
`MIXED_REVIEW_PLAN.md`) still has to be written before any code changes.

Mockups: the "My Verses ladder sketches" design canvas (claude.ai artifact
77ZK89BZsaNcsiS8UgXqHL): My Verses by group and by chapter, verse page ladder,
joining, Settings, review recap, welcome back, map star options.

Check new copy against the banned-jargon list in the memory note "three-concept
naming" (no "queue", "phase", "graduate", "rhythm" …).

---

## 1. The ladder (replaces daily / weekly / monthly)

Moves up by **reviews**, not calendar days. Standard counts:

| Step | Reviews to move up | Group | Color |
| --- | --- | --- | --- |
| Every day | 7 | Settling | green (stageDaily) |
| Every 2 days | 4 | Settling | green |
| Every 4 days | 4 | Settling | green |
| Every week | 8 | Steady | blue (stageWeekly) |
| Every 2 weeks | 6 | Steady | blue |
| Every 4 weeks | 12 | Kept | gold (stageComplete's gold) |
| Every 8 weeks | 6 | Kept | gold |
| Every 6 months | for good | Kept | top tier ("halo and glint", below) |

- There is **no end**. "Complete" is no longer a stop; the ladder keeps stretching.
  (An "At the top: Finish" setting was considered and dropped.)
- Weekly and longer steps keep the chapter's review weekday (`chapterReviewAnchorDay`,
  `nthOccurrenceOfWeekday`): 7, 14, 28, 56 days are all multiples of 7. 4 weeks, not
  30 days, on purpose.
- **Group names and descriptions** (name, then the precise description):
  - Settling — "Reviewed every 1–4 days"
  - Steady — "Reviewed every 1–2 weeks"
  - Kept — "Reviewed every 4–8 weeks, then every 6 months for good"
  - My Verses strip: Waiting · Learning · Settling · Steady · Kept.
- Copy says "7 reviews", never "7 clean".
- **Top-tier color ("halo and glint")**, for every 6 months, on the constellation
  map's star (`MapDrawing.tsx`: glow + ring + ink center): a cut ice-blue/white ring
  (hard-stop gradient #FFFFFF / #9CC0E2 / #E3F0FB / #6F98C4), a small 4-point glint at
  the ring's top right, inside a soft blue radial halo (#A8CCF0, ~0.5–0.6 opacity,
  r≈18). On light maps add a thin outer edge (#6F98C4, 0.6px) so it doesn't wash out.
  Bars and dots elsewhere use a pearly platinum gradient.

### Thoroughness setting

One multiplier on every step's review count (each step needs at least 2):
Light 0.5× (~8 months to every 6 months), **Standard 1×** (~17 months, default),
Thorough 1.5× (~2 years), Navigators 2× (~3 years). Replaces today's
dailyPhaseWeeks / weeklyPhaseMonths / monthlyPhaseYears.

## 2. Passages: verses are reviewed together

- A **passage** = an unbroken run of verses in one chapter and one translation that
  are past Learning. One schedule per passage, never per verse.
- When a verse leaves Learning it **joins** its passage (front or end). The passage
  drops to Every day and runs a **short catch-up**: 3 × every day, 2 × every 2 days,
  2 × every 4 days (~2 weeks), then lands at Every week on the chapter's weekday and
  climbs normally. It does not return to its old step.
- Verses that join while a catch-up is running join it without restarting it.
- A gap between two passages (Romans 8:1–20 and 31–39) keeps them separate. When the
  gap fills, they merge into one passage with one catch-up.
- A passage at the top that gains a verse reopens and climbs at the normal pace (no
  faster second climb; reviewing a bit more is fine).
- Two translations of the same verses = two separate passages.
- Migration: existing items merge into passages at the **lower** step, with the same
  short catch-up.
- Copy: "Romans 8:21–22 join verses 1–20" (not "takes in").

## 3. Missed time

- **Setting "Late reviews move you back", default on.** Missed reviews =
  floor(days overdue / interval). Each moves the passage back one review, never below
  review 1 of its current step. Less than one interval late is free. Then today's
  review is graded normally on top.
- Off: a late passage waits where it was.
- **Long absence:** overdue passages are spread over the next few days automatically
  (Settling first, then most overdue). Today shows a "Welcome back" card.
- This replaces the missed-cycle catch-up in `handleReviewCompleted`, the
  grace / escalate / reset miss policy and the missed-review popup.

## 4. Grading a review

Every counting format reports per verse: **clean, stumble or blank**.

- **Clean setting:** "Accuracy needed for clean", 85–100% in 5% steps, **default 90%**.
- **Recite / type / Keep going / First words** (First words grades only the hidden
  words): at or above the clean setting = clean; below = stumble; under 50% or
  revealed = blank. A requested hint = one stumble.
- **Find the wrong word** uses misses per verse instead of the % system. A miss = a
  swap not found, a correct word wrongly flagged, or a found swap whose replacement
  the user didn't know (Yes/No toggle per swap after the check, Yes by default).
  0–0.49 misses/verse = clean; 0.5–1 = stumble; over 1 = blank.
  Setting: "Find the wrong word can count as a clean review", default on.
- **Self-check:** three buttons per verse, Got it / Stumbled / Blanked. Limits:
  - **Every other review:** a self-check can hold or drop a passage but can't move it
    up twice in a row; the next must be recall or Find the wrong word.
  - **Spot check:** after "Got it", the app sometimes asks for one random verse,
    showing the last 3 words of the verse before as context
    ("…in Christ Jesus. **2** ___"). Missing it = the self-check counts as a stumble.
- **Practice (never credits):** Scramble, Put in order, Which section, Teach-It.
- **Combining a session:** each verse takes the result of the counting round that
  covered it (worst if covered twice). A passage review only counts toward moving up
  if every verse was covered by a counting round. Stopping halfway keeps the covered
  verses' results (stumbles and blanks still apply) but the passage stays on its
  review count.

### Passage outcome

| | Under 12 verses | 12+ verses |
| --- | --- | --- |
| All clean | +1 review | +1 review |
| 1–2 stumbles | Held (doesn't count) | Forgiven (+1 review) |
| 3+ stumbles | Back one review, never below the start of the step | Same |
| A blank | Down one step (blank beats stumbles; one penalty per review) | Same |

- Down a step can move a passage between groups (Every week → Every 4 days = back to
  Settling).
- No "same verse blanks twice" rule.

## 5. After a slip

- **Weak-spot dot:** verses that slipped in a passage's last review get a small dot on
  My Verses and the chapter page; it clears when the verse is next clean. No history,
  no scheduling effect.
- **Fix the transitions** (working name, the user wants it renamed from "Fix the
  joins"): the recap offers Guided learning's **Seam** drill (`seamCue` in
  `src/lib/guided.ts`) on each slipped verse, running in from the end of the verse
  before. ~1 minute. It must be **skippable**. Not a counting format. Finishing it
  clears the weak-spot dot early.
- **Firm up (win it back):** after a stumble-hold or a back-one, the slipped verses
  appear on Today the next day as a short item with a running start. Reciting them
  clean gives the lost review back (a held review counts; a back-one is undone).
  Step drops from a blank can't be won back. Incentive is the point: more reason to
  come back = more practice.

## 6. Idea saved for later (not decided for the build)

- **Find the wrong word, instant grading:** the user knows how many swaps are planted
  (n). As soon as they've flagged n words, grade immediately and show which flags
  were right or wrong, instead of waiting for a "Check" tap. Immediate feedback beats
  delayed feedback.

## Open

- Staged build plan, with Opus for the engine, passages and migration (a mistake
  there corrupts saved data) and Sonnet for screens.
- Rename "Fix the transitions".
