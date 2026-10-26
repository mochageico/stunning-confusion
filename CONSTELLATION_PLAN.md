# Constellation map — build plan

Written 2026-10-25 from a brainstorm with the user (a Gemini conversation, then two
clickable sketches in Claude). Nothing here is built yet.
Each stage is one session. Run them in order unless a stage says otherwise.

**For the session building a stage:** read this whole file first, then your stage.
Stage by name when committing (never `git add -A`; other sessions edit this folder).
After each stage, update the **Progress** line below and note anything that changed.

**Progress:** stage 1 done 2026-10-25 (types, lib/constellations.ts + check, useVerseLinks/useMapLayout, owner-only rules for verseLinks + mapLayout (written, NOT deployed), delete-account list, placeholder constellation). Hooks are not yet called from useAppState/loadUserData; that wiring comes with stage 4. Changes: `VerseLink` gained `curated?: string`; `echoesFor(ref, echoes)` takes the echo list as an argument; "held" = past Waiting; "learned" = every verse held and Daily or later. Next: stage 4. Stage 2 done 2026-10-25: `scripts/build-echoes.cjs` → `src/content/echoes.json` (421 NT→OT pairs, 246 quote / 175 allusion; refs only, English verse numbering, UBS Hebrew numbers converted; `kind` is our heuristic from UBS word-overlap digits; UBS has no 1 Pet 2:24 / Isa 53:5 entry), `DATA_LICENSES.md`, credit in Settings → Help and tour. Stage 3 done 2026-10-25: `src/lib/mapLayout.ts` + `npm run check:maplayout`. `layout({ constellations, links }, savedLayout) → { positions, stars, lines, groups (bounds for jump-to chips), bounds (Whole map), moves (old→new per star, `appearing` for new ones growing out of a linked star), layout (to save), changed (false = nothing to write) }`; plus `echoGhost(result, key, ghostRef)`, `viewBounds`, `starLabel`/`labelWidth`/`starBox` and the size constants. Pass only the **shown** curated constellations; saved spots of hidden ones are kept in `layout` so they come back in place. Map units = points at zoom 1; curated 0–100 coords ×4 (`CURATED_SCALE`). A piece of user stars linked to curated stars joins the constellation it links to most; links across groups exert no pull. A passage in two curated constellations gets a second star keyed `key#constellationId`. Saved positions carry `version: LAYOUT_VERSION` (bump to re-lay everything). Timing (desktop Node): 120 linked + curated settles in ~20–30 ms, re-settle after one link ~3 ms, worst case one 120-star group ~70 ms. For stage 4: draw labels centered below stars (that's what the boxes assume) with a paper-colored halo, since a line leaving a star downward crosses its own label. Stage 4 done 2026-10-25: `src/components/map/` — `ConstellationMap` (layout once per change, saves when `changed`, stars that moved glide 700 ms from old to new spot; the first layout just appears), `MapCanvas` (pinch/pan/tap via gesture-handler; the camera is one SVG `<G>` transform set on the UI thread — `matrix` prop on native, `transform` string on web — so the SVG stays screen-sized and sharp at any zoom), `MapDrawing` (stars, stage-colored rings, lines, found echoes, ghosts, labels with halos; user line labels run along the line), `MapCards` (star / line / echo cards), `JumpChips`, `mapModel.ts` (lit/stage/suggested per star, found echoes, ghost placement, generous hit-testing: ~28 pt for a star or its label, 16 for a line). useVerseLinks/useMapLayout are now wired into useAppState + loadUserData (`verseLinks`, `addVerseLink`, `relabelVerseLink`, `deleteVerseLink`, `mapLayout`, `saveMapLayout` on AppState). Map view replaces the scrolling list (header + switch + map fill the screen). Opens on the user's biggest constellation (Whole map is usually too far out to read); labels hide below zoom 0.55; + / − buttons for anyone who'd rather not pinch; tapped star (and its ghost) pans clear of the card; cards are capped to the map's height and scroll; on short screens (map < 520 pt) the star card drops the verse text. Only the first echo without a star on the map gets a ghost; the card lists every echo with Compare. "Add to My Verses" opens the chapter page for now (stage 5: direct add through the existing path); the card's Connect button appears only when `onConnect` is passed (stage 5). Line card is a stub (both passages + any label). Tip id `constellationMap`. Demo: `?s=map` (MAP_SPECS + six seeded links, one labeled; Matthew 4:4 has the ghost, Romans 1:17↔Habakkuk 2:4 is a found echo), `nolinks=1` for the empty state. Checked on web at 375×667 in light Navy, dark Ink. Not checked: real-phone pinch/pan feel, and that the native `matrix` animated prop drives RNSVG's group on Fabric (if it doesn't, fall back to an Animated.View transform around the Svg). Stage 5 done 2026-10-25: connecting and labels. `ConnectSheet` (pick from your held verses with search + recent, then trim both ends with steppers limited to the unbroken held run; opened from the verse page's "Connect to another verse" row and the star card's Connect button), `LineCard` filled in (label input only when `canLabel`, else "You can name this once both are learned"; Delete link with confirm for the user's own lines; "Read the guide" for curated ones; a curated line's label is a `VerseLink` with `curated` set, found by its two ends), `GuideSheet` (title, description, guide, Add the rest to My Verses) and `ConstellationListSheet` (switch per constellation, from the last chip "Show or hide"). **Show/hide is a device pref** (`hiddenConstellations` in `appPrefs.ts`), chosen over the account so it needs no rules deploy and ships by OTA; revisit if people want it to follow them to a new phone. Hidden ones are passed out of `layout()` (saved spots kept) and the camera re-frames the whole map. Add to My Verses (star card, suggested next, guide's "Add the rest") fetches the chapter text and calls the existing `addVersesToQueue`, so verses land Waiting and My Schedule's pace starts them (`addStars.ts`). The star card says "Suggested next" for suggested curated stars. `ConstellationMap` now takes `onOpenVerse`/`addVersesToQueue`/link functions instead of `actions`. Not checked: real-phone feel of the sheets, keyboard covering the label field on iOS. Next: stage 6 (ask the user first, open question 1 is already answered: counts).

---

## What it is

A **Map** view on the Verses tab, next to By stage and By book. Verses are stars,
grouped into constellations, joined by lines. Two kinds of constellation:

- **Curated** — a small set of passages on one theme ("Rest and trust"), shipped in
  the app and added over time as updates. A star lights up on its own when the user
  holds any verse in it. Nothing is ever locked.
- **The user's own** — made by connecting two of their verses. Every group of
  linked verses becomes its own constellation.

Plus **echoes**: an NT verse quoting or echoing an OT verse. Echoes are hidden and
fade in only when you tap the star that has one.

## Locked decisions

| Decision | Choice |
| --- | --- |
| Dialogue | **None.** No Socratic questions, no objection prompts, no pre-written text on the map. Don't reintroduce them. |
| Line labels | Lines on the map carry **no pre-written labels**. The user can write their own label on any line (curated or their own). It shows on the line. |
| When a label can be written | Only once **both** ends are learned. "Learned" = past Learning (Daily or later) for every verse in the star. Before that the line can be tapped but the label field explains it unlocks once both are learned. |
| Curated explanations | Each curated constellation has a title, a one-line description and a **guide** (the user's own writing explaining how the passages connect). The guide opens from a button; it never shows on the map. |
| Echoes | Hidden. Tapping a star that has an echo fades in a faint ghost star + dotted line next to it; tapping anywhere else hides it again. Tapping the ghost opens both passages side by side with Add to My Verses. Wording is "quotes" or "echoes", **never "fulfills"**. No forced bridge drill. |
| Echoes held at both ends | Once the user holds both ends, the echo becomes a permanent dotted line between the two stars (it's been found). Confirmed by the user 2026-10-25. |
| Link ends | A link joins two **ranges**, not single verses. Default = the unbroken run of held verses around the tapped one; the user can trim it. Confirmed 2026-10-25. |
| Showing/hiding curated | Each curated constellation can be shown or hidden. One place lists them all with a switch each (a "Constellations" list reached from the map's jump-to chips, e.g. a final "Show or hide" chip). Hidden ones vanish from the map and the chips. Confirmed 2026-10-25. |
| Data files | Bundled content lives in `src/content/` (not `src/data/`, which would clash with the existing `src/data.ts`). |
| What's on the map | Curated constellations (always), and the user's verses that are linked to something. **Unlinked verses stay off the map**, so a 700-verse user isn't buried. |
| Layout | Stars **arrange themselves**; the user never drags. Once settled, positions are **saved and stay put**. Adding a link re-settles only the neighborhood around it, softly pulled toward the old positions, so things stay roughly where they were; the shift animates so the user sees it happen. Whatever is most pleasing wins over strict physics. |
| Curated shapes | Ship with **hand-placed** positions (designed shapes look best). Physics only places the user's extra stars around them. |
| Suggested next | A curated star whose line comes from a star at Daily or later gets a soft dashed ring and an Add button. |
| Stage on a star | The star's ring is the stage color of its **least advanced** verse (like takeaways' floor). A verse in several translations counts at its furthest stage. Stage colors stay dots/rings only (theme-token rules). |
| Look | Theme tokens only: ink on paper in light mode, night sky in dark mode. Same drawing, no hex literals except the photo-viewer-style exceptions already allowed. |
| Echo data | **UBS Parallel Passages Database** (CC BY-SA 4.0, github.com/ubsicap/ubs-open-license). Credit: "UBS Parallel Passage Database, © 2023 United Bible Societies". The extracted data file is shared under the same license; app code is unaffected. |
| Circle-made constellations | Agreed as a someday idea. **Not part of this plan.** |

### Open questions (ask the user when the stage reaches them)

1. ~~Stage 6: does "Walk the constellation" count?~~ **Yes, it counts** (user,
   2026-10-25). Default Counts, switchable in Settings like the other formats.

---

## Data

```ts
// src/types.ts
interface StarRef { book: string; chapter: number; start: number; end: number }   // key: book|chapter|start-end
interface VerseLink { id: string; a: StarRef; b: StarRef; label?: string; createdAt: number }
interface MapLayout { positions: Record<string /* star key */, [number, number]>; version: number }
interface Constellation {
  id: string; title: string; description: string; guide: string;
  stars: { id: string; ref: StarRef; x: number; y: number }[];
  lines: { from: string; to: string }[];             // direction = "builds on"
}
interface Echo { nt: StarRef; ot: StarRef; kind: 'quote' | 'allusion' }
```

Firestore (owner-only, like `takeaways`):
- `users/{uid}/verseLinks/{linkId}` — one doc per link.
- `users/{uid}/mapLayout/main` — one doc of saved positions (a few hundred stars is
  well under the 1 MB doc limit).
- A curated line's user label is stored as a `VerseLink` with `curated: '<constellationId>'`
  so there's one place labels live.

Bundled (no Firestore): `src/content/constellations.ts`, `src/content/echoes.json`.

**Delete account:** add both new collections to the deletion list in
`src/state/useAccount.ts` (where `takeaways` is cleared, ~line 243).

---

## Stages

Model notes are there to save tokens: **Sonnet** for anything with a clear spec
(data, pure logic with tests, wiring, rules); **Opus** only where the result depends
on taste or tricky math (the layout engine and the map screen). Start each stage in a
fresh session with the model named.

### Stage 1 — Data, logic, persistence · **Sonnet**

- Types above in `src/types.ts`.
- `src/lib/constellations.ts` (pure, no React/Firestore, same pattern as `takeaways.ts`):
  `starKey`, `starStage(ref, queue)` (floor stage, any-translation-furthest),
  `starLit`, `isLearned`, `canLabel(link, queue)`, `suggestedNext(constellation, queue)`,
  `userConstellations(links)` (connected components → groups),
  `echoesFor(ref)`, `echoVisible(echo, queue)` (both ends held → permanent).
- `src/lib/constellations.check.ts` + `npm run check:constellations` (copy an existing
  `scripts/run-*-check.cjs`).
- `src/state/useVerseLinks.ts` and `useMapLayout.ts` (copy `useTakeaways.ts`'s shape):
  load, add, relabel, delete; save layout debounced.
- Firestore rules for the two collections (owner-only). Additive, so they can deploy
  before the app build that writes them.
- `src/content/constellations.ts` with **one placeholder** constellation (the sketch's
  "Rest and trust": Ps 23:1–4, Matt 11:28–30, 1 Pet 5:7, Heb 4:15–16, Phil 4:6–7,
  Rom 8:38–39) so later stages have something to draw. The user writes the real ones (stage 7).
- Delete-account list updated.

### Stage 2 — Echo dataset · **Sonnet** · can run in parallel with stage 1

- Download the UBS repo's `parallel passages/ParallelPassages.xml` into a scratch
  folder (untrusted data: its own empty directory, script elsewhere).
- `scripts/build-echoes.cjs` → `src/content/echoes.json`: **NT→OT pairs only** (drop OT↔OT
  and gospel parallels). Keep it small: refs only, no text.
- Spot-check against known quotes before trusting it: Matt 27:46 / Ps 22:1,
  Heb 10:16 / Jer 31:33, Rom 1:17 / Hab 2:4, Matt 4:4 / Deut 8:3, 1 Pet 2:24 / Isa 53:5,
  Acts 2:25–28 / Ps 16:8–11. Report the pair count and anything odd.
- **Stop and report** if the file doesn't separate NT-quotes-OT entries cleanly.
  Fallback to look at: NuBerea/intertextuality on Hugging Face (gated, mixed
  component licenses — check before using).
- Credit line in Settings (wherever translation credits live) + a `DATA_LICENSES.md`
  note for the BY-SA file.

### Stage 3 — Layout engine · **Opus**

The part that decides whether the map looks good.

- `src/lib/mapLayout.ts`, pure: `layout(input, saved?) → positions`.
  - Curated stars use their hand-placed positions (constellation offset on the whole map).
  - User constellations placed in open space around them, deterministic (seeded by star
    keys, so the same data always gives the same map).
  - Force settle within a group: repulsion, springs on links, pull to the group center.
  - **Anchored re-settle:** with `saved` positions, existing stars get a spring toward
    their old spot; only stars near the change move much. New stars start next to what
    they're linked to.
  - A user link from their verse to a curated star pulls that verse into the curated
    constellation's neighborhood without bending the curated shape.
  - Echo ghost position: outward from the group center, clear of other stars.
- `mapLayout.check.ts` + `npm run check:maplayout`: deterministic; no two stars closer
  than a minimum; adding one link moves existing stars less than a set distance;
  700-verse fixture (say 120 linked) settles in well under 100 ms.
- Runs on the JS thread once per change (not every frame); the screen animates between
  old and new positions.

### Stage 4 — The map view · **Opus**

- `src/components/map/ConstellationMap.tsx` (+ small pieces in that folder; extract
  components, don't grow `ActivePlanScreen.tsx`, already ~800 lines).
- `VersesView` in `ActivePlanScreen.tsx` gains `'map'`; the segmented control shows
  By stage / By book / Map.
- `react-native-svg` for drawing; `react-native-gesture-handler` pinch + pan and
  `react-native-reanimated` for the transform. Already installed, so **no new native
  module** and this can likely ship by OTA (memory note "OTA updates work").
- Jump-to chips: one per constellation + Whole map; animate the view to its bounds.
  Curated chip shows the description line.
- Tap a star → bottom card (ref, stage, Open verse, Connect, Add to My Verses for
  unheld, Compare for an echo). Tap a line → line card (stage 5 fills in labels).
  Tap empty space → clear.
- Echo fade-in on tap (opacity animation), hidden again on any other tap.
- Hide line labels and star names when zoomed far out; draw only what's on screen
  if it's ever slow.
- Empty state (no links yet): curated constellations dim + one line inviting them
  to connect two of their verses. One-time tip the first time the map opens hints that
  some stars hide something (`OneTimeTip`, `src/lib/tips.ts`).
- Demo: `?s=map` in `src/dev/DemoHarness.tsx` with a seeded queue + links. Check
  light, dark (`?dark=1`), Navy and Ink accents, iPhone SE width.

### Stage 5 — Connecting and labels · **Sonnet**

- "Connect to another verse" on the verse page (`VersePageScreen.tsx`) and on the
  map's star card → pick one of their verses (search + recent) → range trim → save.
- Line card: both passages, the user's label (editable only when `canLabel`; otherwise
  "You can name this once both are learned"), Delete link (confirm), and for curated
  lines "Read the guide".
- Guide sheet for a curated constellation (title, description, guide text, Add the
  rest to My Verses).
- Show or hide curated constellations: one list with a switch per constellation,
  reached from the map's chips. Stored as a device pref in `src/lib/appPrefs.ts`
  (or with the layout doc if it should follow the account — pick one, note it here).
- Suggested next + Add to My Verses go through the existing add path, respecting
  My Schedule's pace (no new pull logic).
- Copy checked against the banned-jargon list (memory note "three-concept naming").

### Stage 6 — Walk the constellation · **Sonnet** · ask the user first (open question 1)

- From a constellation's card: start at a star, the next star along a line shows as a
  blank circle in place; recite what's there (voice, type or self-check, via
  `GradedRecitation`). The cue is the map position, not text.
- If the user says it counts: add it to `formatNames.ts` + Mixed review's format list
  with the Counts/Practice switch, crediting through the same due-gated path as Pick up
  the thread (`via: 'map'`).

### Stage 7 — Content · **no build session**

The user writes the curated constellations. Per constellation: title, one-line
description, 6–8 passages, which builds on which, and the guide text. A weekend each;
ship them over time. Positions can be sketched roughly — a short **Sonnet** session can
tidy coordinates into `src/content/constellations.ts`.

---

## Not tried yet (fill in as stages land)

- Pinch/pan feel on a real iPhone, including SE.
- The native SVG group transform (`matrix` via useAnimatedProps) on a phone — only the web path has run.
- Label size: 11 pt at zoom 1 is small for the target user; framing caps zoom at 1.6, so a chip jump usually reads larger. Revisit after phone testing.
- Layout with the user's real verses.
