# Bible Photos — build plan

Let people photograph the physical Bible page(s) a chapter lives on, so the
page itself becomes a visual anchor. Viewable from Chapter Landing, and as a
third Display mode inside Listen that follows along with playback.

---

## Locked decisions

| Decision | Choice |
| --- | --- |
| Where photos live | Firebase Storage, private to the owner, cached on device |
| Photo → verse mapping | Ordered gallery, each photo optionally tagged with a verse range |
| Listen presentation | Third option in the existing Display dropdown |
| Sharing | Strictly private, enforced in rules. No circle/group visibility. |
| Verse tagging | Optional. Untagged photos default to "whole chapter" and don't auto-flip. |
| Photos per chapter | Capped at 6 |
| Capture sources | Camera and photo library, both |
| Inline behaviour | Photo replaces the verse text, same as Memory Grid does today |

---

## What already exists that this builds on

- **The Display dropdown** — `listenViewMode` at `src/components/PracticeModals.tsx:221`,
  currently `'verses' | 'memoryGrid'`. Adding a third option needs no new chrome.
- **The middle panel** — `src/components/PracticeModals.tsx:1455`, a `flex-1`
  rounded-2xl box that both existing views render into. The photo goes here.
- **The overlay slot** — the selection-mode hint at `src/components/PracticeModals.tsx:1516`
  proves `absolute top-2 right-2` works over this panel. The page/verse pill reuses it.
- **The chapter key convention** — `` `${selectedBook}_${selectedChapter}` `` at
  `src/screens/ChapterLandingScreen.tsx:122`. Reuse verbatim; do not invent a new format.
- **Private cloud media, end to end** — recordings already do upload, owner-only rules,
  and delete. Mirror `firestore.rules:57` and `storage.rules:14`.
- **On-device caching** — `src/lib/audioCache.ts` is a mature model: manifest in
  AsyncStorage, download to `.part` then rename, reconcile against disk on launch.

## What does not exist yet

No image library is installed. `expo-image-picker` and `expo-image-manipulator`
are both new native dependencies, so **this feature requires a new dev-client
build and a TestFlight round-trip.** Nothing ships from a JS-only update.

---

## Phase 0 — Native groundwork (do first, it gates everything)

**Status: code-complete. Build not yet run.**

1. ~~Install native deps~~ — done. Four, not two:
   - `expo-image-picker` `~57.0.11` — capture + library, and its bundled `canhub`
     cropper is what makes `allowsEditing: true` a real crop UI on both platforms.
   - `expo-image-manipulator` `~57.0.11` — EXIF rotation, resize, JPEG re-encode.
   - `expo-image` `~57.0.3` — the app had **no** image library; it renders images
     with React Native's built-in `Image` in exactly one place (`src/components/ui.tsx:351`,
     an avatar). A 2000px photo decodes to roughly 24MB of RAM and the viewer holds
     several at once, which is precisely the memory pressure that makes the Listen
     modal fragile. Needed a `'expo-image'` entry in `plugins`.
   - `expo-screen-orientation` `~57.0.1` — insurance for landscape in the photo
     viewer, since a photographed two-page spread is cramped in portrait. See the
     orientation note below; it is not a drop-in.
2. ~~`app.config.js`~~ — done, though not the way this plan first described it.
   The old false string (*"Scripture Memory does not access your photo library…
   this permission is unused"*) is **deleted from `ios.infoPlist`** rather than
   rewritten there, and both iOS strings now come from an `expo-image-picker`
   plugin entry carrying `photosPermission` / `cameraPermission`. That matches how
   `expo-speech-recognition` already declares its strings, and avoids two sources
   of truth — a raw `infoPlist` key would silently win over the plugin's.
   `android.permission.CAMERA` added alongside the existing audio permissions.
3. **New dev-client build — still to run.** Interactive (Apple credential prompts),
   so it isn't scriptable from here.

### The orientation change — read before touching `app.config.js`

`orientation` is now `'default'`, **not** `'portrait'`. This looks like a
regression and is not one.

On iOS the app-level supported-orientation mask is a hard outer bound: a view
controller may narrow it but never exceed it. With `orientation: 'portrait'`,
`ScreenOrientation.unlockAsync()` is a permanent no-op — the module installs but
can never rotate anything. The mask has to be widened at **build** time or the
option is gone for good, which is exactly the kind of thing that costs a second
build to discover.

Portrait is restored in two places, and both halves are required:

- `['expo-screen-orientation', { initialOrientation: 'PORTRAIT' }]` pins iOS at launch.
- A `lockAsync(PORTRAIT_UP)` effect in `App.tsx` pins **Android**, where
  `initialOrientation` does nothing at all — it is an iOS `Info.plist` mod. Without
  that effect, widening the config would have made the entire portrait-designed app
  rotatable on Android.

Net behaviour today is identical to before. The photo viewer can unlock rotation
later as a pure JS change, and must re-lock on exit.

Three things confirmed while doing this, all worth not re-deriving later:

- **The plugin will not clobber the microphone string.** `applyPermissions` in
  `@expo/config-plugins` resolves as `explicit prop || existing infoPlist value ||
  generic default`, and expo-speech-recognition sets `NSMicrophoneUsageDescription`
  statically, so the app's own wording survives. Do not pass `microphonePermission`
  to the image-picker plugin — that would override it.
- **`npx expo config --type prebuild` cannot verify the iOS strings.** They're
  applied by a `withInfoPlist` mod at prebuild time, so they're absent from that
  output by design. Their absence there is not a bug. The build is the real check.
- **Android permissions need nothing added by hand.** expo-image-picker's own
  `AndroidManifest.xml` already declares `CAMERA`, plus `READ_/WRITE_EXTERNAL_STORAGE`
  capped at `maxSdkVersion="32"`, a FileProvider, and the cropper activity. The
  explicit `android.permission.CAMERA` line in `app.config.js` is redundant, kept
  only because it documents intent. Do **not** add `READ_MEDIA_IMAGES` — the picker
  uses the system photo picker, which needs no permission, and declaring it would
  trigger a Play Console data-access declaration for nothing.

### The first build crashed at launch — read this before adding any future module

Symptom: installed fine, then died instantly at the splash, before the dev-client
launcher and before any JS. The crash log said:

```
DYLD — Symbol missing
Symbol not found: _$s15ExpoModulesCore10BaseModuleC11willDestroyyyFTj
Referenced from: ExpoImage.framework/ExpoImage
Expected in:     ExpoModulesCore.framework/ExpoModulesCore
```

That mangled symbol is `ExpoModulesCore.BaseModule.willDestroy()`. Cause: the
project was running `expo@57.0.7` / `expo-modules-core@57.0.6` while SDK 57 expected
`expo@~57.0.14`. `expo-image` is compiled against the current core, which defines
`willDestroy()`; the installed core predated it, so dyld refused to launch.

Fixed with `npx expo install --fix`, which moved 9 packages to their expected
versions — `expo` → 57.0.14, `expo-modules-core` → 57.0.11, `react-native` → 0.86.2,
`reanimated` → 4.5.1, `worklets` → 0.10.1. `BaseModule.willDestroy()` is now present
at `node_modules/expo-modules-core/ios/Core/Modules/Module.swift:41`.

**The lesson, which cost a build: run `npx expo install --check` BEFORE any build
that adds a native module.** The stale packages had been sitting there harmlessly
for a while — nothing broke until a module newer than the installed `expo` was added.
Two wrong theories were ruled out along the way and are worth not revisiting: the
global `use_modular_headers!` in `plugins/withPodfileModularHeaders.js` was not
involved, and neither was expo-screen-orientation's root-view-controller swap (its
`ScreenOrientationViewController.swift` explicitly handles `expo-dev-client`).

**Checkpoint:** app launches on device with the new deps linked and nothing else
changed. Confirm the two new permission prompts appear with the right wording the
first time a photo is picked or the camera opened.

---

## Phase 1 — Data layer

### Firestore: `users/{uid}/chapterPhotos/{photoId}`

```
chapterKey   string   "John_3", matching ChapterLandingScreen:122
order        number   position within the chapter, 0-based
verseStart   number?  null = untagged
verseEnd     number?  null = untagged
storagePath  string   chapterPhotos/{uid}/{photoId}.jpg
thumbPath    string   chapterPhotos/{uid}/{photoId}_thumb.jpg
width        number   post-resize pixel dims, so layout reserves space
height       number   before the image loads and nothing jumps
createdAt    timestamp
```

Storing `width`/`height` is not optional polish — without them the Listen panel
reflows the moment each image decodes, mid-session.

### Rules

`firestore.rules` — owner-only read and write, modelled on the recordings block
at line 57. No `sharedChapterPhotos` collection, no circle read path. Sharing was
ruled out deliberately: page photos reproduce a copyrighted translation and often
carry handwriting, marginalia, or family-register names.

`storage.rules` — new block beside recordings:

- `allow read`, and `create/update` gated on `request.auth.uid == userId`
- `request.resource.contentType.matches('image/.*')`
- `request.resource.size < 8 * 1024 * 1024` (generous; real uploads land ~400KB)
- **a separate `allow delete` rule** — `storage.rules:16` already documents why:
  delete has no `request.resource`, so size/type checks evaluate against null and
  deny every delete. Do not fold delete into the create/update rule.

### Upload pipeline

Pick → crop → normalize → upload, in `src/lib/chapterPhotos.ts`:

1. `expo-image-picker` with the OS crop step enabled (`allowsEditing: true`).
2. `expo-image-manipulator`: apply EXIF rotation, resize to **2000px on the long
   edge**, JPEG quality 0.75.
3. Second pass for the thumbnail: 400px, quality 0.6.
4. Upload both with `uploadBytesResumable`.

**Use `uploadBytesResumable`, not `uploadBytes`.** `src/state/useAppState.ts:6136`
carries a hard-won comment about the one-shot upload path failing on this stack.
Do not rediscover that.

The 2000px figure is the whole quality argument: enough to pinch into 8pt type
and actually read it, while turning an 8MB camera file into roughly 400KB.
Raw uploads would make Chapter Landing slow, expensive, and hostile on cell data.

### Cache: `src/lib/photoCache.ts`

Same shape as `audioCache.ts` — manifest in AsyncStorage keyed on storage path,
download to `.part` then rename, `reconcileWithDisk()` on launch — but
**deliberately simpler: no LRU, no cap, no pinning UI.** Six photos × ~400KB ×
even 50 chapters is well under 150MB, and unlike recordings there is no version
churn. Copy the `.part`-then-rename discipline exactly; the Android truncation
bug that motivates it (`audioCache.ts:311`) applies identically to images.

**Status: code-complete. Rules NOT yet deployed.**

Built: `ChapterPhoto` in `src/types.ts`, the `chapterPhotos` blocks in both rules
files, `src/lib/chapterPhotos.ts` (capture + prepare), `src/lib/photoCache.ts`
(on-device), and the state layer in `useAppState.ts` — `chapterPhotos`,
`photoCache`, `photosForChapter`, `addChapterPhoto`, `deleteChapterPhoto`,
`setChapterPhotoVerseRange`, `reorderChapterPhotos`, `cacheChapterPhoto`.

Notes worth keeping:

- `manipulateAsync` is **deprecated** in expo-image-manipulator 57. The code uses
  the contextual API instead: `ImageManipulator.manipulate(uri)` -> `.resize()` ->
  `.renderAsync()` -> `.saveAsync()`.
- The picker documents `asset.width`/`height` as possibly `0`, so
  `resolveSourceSize` falls back to a render probe. Without real dimensions there
  is no way to know which edge to constrain.
- Uploads go through `uploadBytesResumable` **and** the patched `storage` export
  from `firebase.ts`. Any other path hits the one-shot multipart body that RN's
  Blob constructor rejects.
- Photo add writes **blobs first, then the doc** — the reverse of
  `persistRecording`, which writes its doc first only because uploading fires the
  processStudioAudio trigger. Nothing watches this prefix, so the ordering that
  matters here is "never publish a row pointing at bytes that never arrived."

**Rules must be deployed before any of this works** — the default-deny at the top
of `firestore.rules` rejects everything otherwise:

```
npx firebase-tools deploy --only firestore:rules,storage
```

**Checkpoint:** photos upload, appear in the Firebase console, survive a restart,
and load from disk with airplane mode on.

---

## Phase 2 — Chapter Landing

**Zero photos means zero footprint.** No "Photos (0)" card, no empty state
section. Just a small add affordance among the existing chapter actions. The last
several commits have been deflating these screens; a permanent empty card on all
1,189 chapter landings would undo that.

With photos present: a thin horizontal thumbnail strip. Tap opens the full-screen
viewer. Long-press or an edit affordance gives reorder, retag verse range, delete.

Delete removes the Firestore doc, both Storage objects, and the cache entries —
mirroring the recording delete path at `useAppState.ts:6294`. Orphaned Storage
objects bill forever.

**Status: code-complete. Not yet run on device.**

Built: `src/components/ChapterPhotoStrip.tsx` (empty line / thumbnail strip /
source chooser) and `src/components/ChapterPhotoViewer.tsx` (full-screen, swipe
between pages, verse-range tagging, reorder, delete). Mounted in
`ChapterLandingScreen` between the audio card and the view toggle.

Decisions made while building:

- **Reorder is move-left / move-right in the viewer, not drag-and-drop.** For a
  capped list of six, two buttons are less machinery than a drag interaction and
  do not fight the horizontal swipe already bound to changing pages.
- **Untagged thumbnails carry no badge.** The absence is the information; a chip
  on every thumbnail would be noise on the common case.
- **The source chooser leads with the camera**, since the primary act is
  photographing the Bible in front of you rather than hunting a camera roll.
- **The backdrop tap-guard is structural** — a sibling `Pressable` filling the
  space above the sheet, matching PracticeModals' manual-log sheet. RN's
  Pressable has no reliable `stopPropagation`.
- The viewer's initial scroll is **ref-guarded**: `onLayout` fires on every
  layout pass, and ungated it would yank the user back to their entry page on any
  re-layout.

**Checkpoint:** add, view, reorder, retag, and delete all work; a chapter with no
photos looks exactly as it does today.

---

## Phase 3 — The full-screen viewer

This is where reading actually happens, and it's the difference between a useful
feature and a decorative one. A page-sized photo shown at panel size is a grey
rectangle; without real zoom, nobody opens it twice.

Pinch-zoom and pan via `react-native-gesture-handler` + `react-native-reanimated`
— both already installed, and `GestureHandlerRootView` already wraps the app at
`App.tsx:681`, so no new dependency and no root-level wiring. Double-tap to zoom
to fit-width, which is the gesture people actually reach for on a page of text.
Swipe between photos at zoom level 1. Audio keeps playing if it was playing.

Render with `expo-image` and `contentFit="contain"`, not the built-in `Image`.

Rotation is available but off by default. If a two-page spread turns out to need
landscape, `ScreenOrientation.unlockAsync()` on entering the viewer and
`lockAsync(PORTRAIT_UP)` on leaving is now a pure JS change — the build already
carries the capability. **Re-locking on exit is not optional**; the rest of the app
is portrait-designed against an SE floor.

**Status: code-complete. Not yet run on device.**

Built as `src/components/ZoomablePhoto.tsx`, one instance per page inside the
viewer's pager. Pinch (1x-6x), pan bounded to the image's real letterboxed
extent, double-tap to fit-width, and a reset as a page scrolls out of view.

Two things that are load-bearing and easy to break later:

- **`GestureHandlerRootView` is mounted INSIDE the Modal**, not just at the app
  root. On Android an RN Modal renders in its own window and gestures inside it
  are simply dead without a root view of their own.
- **The pager releases its horizontal swipe while zoomed** (`scrollEnabled={!zoomed}`,
  and `Gesture.Pan().enabled(zoomed)`). Without both halves, dragging around a
  magnified page flicks to the next photo instead.

Pan bounds are computed from the photo's stored `width`/`height` against the
measured page box, so they track the letterboxed extent rather than the screen —
this is the second place those persisted dimensions earn their keep.

**Zoom is focal-anchored** (added after first use -- centre-based zoom shipped
first and did not feel "free"). The content under the midpoint of your fingers
stays under it, and double-tap zooms toward the tapped point rather than the
middle, so double-tapping a verse low on the page brings THAT verse up.

The algebra is one line, in `anchorTranslate`. A point p measured from the box
centre renders at `translate + scale * p`; holding the rendered position under
the focal fixed and solving for the new translate gives, with `k = to / from`:

    translate' = focal * (1 - k) + k * translate

Two things that make it behave:

- **Anchor from the state the gesture STARTED in** (`originScale` / `originX` /
  `originY`, captured in `onStart`), never from the previous frame. Frame-relative
  correction compounds and the image creeps.
- **The GestureDetector wraps the OUTER, UNTRANSFORMED box**, not the animated
  child. Gesture coordinates are reported relative to the handler's own view, so
  attaching it to the transformed view reports focal points in already-scaled
  space and feeds the zoom back into itself.

Verified numerically rather than by eye: across a 1.2x -> 6x sequence the point
under the focal drifts 0.00px.

**Checkpoint:** on an iPhone SE, verse text on a photographed page is comfortably
readable after a pinch.

---

## Phase 4 — Listen integration

The riskiest phase. That modal already juggles auto-advance, minimize, playback
rate, seek, and two view modes.

### Wiring

- Extend `listenViewMode` to `'verses' | 'memoryGrid' | 'photo'`.
- Add the option to the Dropdown at `PracticeModals.tsx:1405` **only when at least
  one chapter in the session has a photo** — not only when every chapter does.
- Thread `chapterPhotos` and the cache map through `App.tsx:580`, alongside the
  existing `verseDoodles` / `audioCacheMap` props.

### Resolution is (chapter, verse) → photo, not verse → photo

A Listen session is frequently **not one chapter**. The Verse Selection dropdown
offers Today's Verses, Learning, Review, and Priming, and a session launched from
Home can hold John 3, Psalm 23, and Romans 8 at once. So the lookup re-resolves on
every advance, using the currently playing verse's own book and chapter.

Two consequences:

1. **When the queue crosses into a chapter with no photo**, show a quiet
   placeholder naming that chapter with an "Add a photo" button inline. Noticing a
   photo is missing is the best possible moment to offer to add one.
2. **The pill reads "John 3 · Page 1"**, not just "Page 1", so in a mixed session
   you always know the photo on screen belongs to the verse in your ears.

### Auto-flip with a manual latch

The photo follows `currentVerseIndex` into the matching verse range. The moment
the user swipes by hand, auto-flip switches off for the remainder of the session,
and the footer label changes from "Following playback" to "Manual — tap to resume
following". Without the latch, the page yanks itself away mid-read.

### Mount once, hide with opacity — never conditionally mount

A large decoded bitmap appearing and disappearing inside a live modal is the exact
shape of the iOS Fabric shadow-tree deadlock this project already hit. Render the
photo view once and toggle visibility; do not swap it in and out of the tree on
every Display change.

### Layout inside the panel

Letterbox the image, don't crop-to-fill. A Bible page is portrait, the panel is
roughly square, and cropping to fill would slice off the outer column — precisely
the text you're trying to see.

Overlays: page/verse pill top-right (the proven slot from line 1516), expand
button bottom-right, page dots bottom-center when the chapter has more than one
photo. The existing grey footer bar with the wave indicator stays, with the
following/manual label.

**Status: code-complete. Not yet run on device.**

Built as `src/components/ListenPhotoView.tsx`, mounted inside PracticeModals'
display panel. `listenViewMode` is now `'verses' | 'memoryGrid' | 'photo'`, and
the props arrive from `App.tsx` alongside the existing `verseDoodles` /
`audioCacheMap` pair.

Deviations from this plan, all deliberate:

- **One image, not a pager.** A paged ScrollView would mount all six full-size
  photos at once; at roughly 24MB decoded apiece that is real pressure inside a
  modal that also owns an audio player. Manual paging is a fling plus tappable
  dots. The inline view is a locator anyway -- reading happens in the lightbox.
- **The follow/manual indicator lives on the photo layer, not the shared footer
  bar.** That bar is shared by all three Display modes, and rewriting its label
  for one of them would couple the photo view to chrome it does not own. It
  appears only once the latch is released -- a "Following playback" badge in the
  default state would be chrome explaining that nothing is wrong.
- **The latch resets on a chapter boundary**, not strictly "for the session". A
  manual page index from one chapter is meaningless in the next; the latch exists
  to protect the page you are reading, not to outlive the passage.
- **Expand opens a read-only lightbox**, not the Chapter Landing viewer. Delete,
  reorder, and re-tagging have no business one tap away mid-session.
- **The image source is undefined until first reveal.** The layer is mounted for
  the whole session, so an ungated `<Image>` would download a photo over cell
  data even for a user who never opens the view. The component stays mounted (the
  tree never changes shape); only the fetch and decode are deferred.

`ZoomablePhoto`'s `width` prop is now optional -- omitted, it measures its own box
rather than acting as one page of a fixed-width pager.

**Gesture callbacks are worklets by default.** Listen's fling handlers threw
"[Worklets] Tried to synchronously call a Remote Function" on the first real
swipe, because `page()` is plain JS that sets React state. Two valid fixes, and
which one to use depends on the handler:

- `.runOnJS(true)` on the gesture -- right when the handler does no UI-thread
  work at all, as with these flings. The whole callback runs on the JS thread.
- `runOnJS(fn)(args)` inside the worklet -- right when the handler DOES drive
  shared values on the UI thread and only needs to poke React on the side, as
  with `setZoomed` in `ZoomablePhoto`.

Never call a JS function bare from `onStart` / `onUpdate` / `onEnd`.

**Checkpoint:** a mixed-chapter session flips pages correctly, degrades gracefully
into chapters with no photo, survives minimize/restore, and doesn't hitch playback
on view switch.

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| Photo is unreadable at panel size | Full-screen zoom is Phase 3, not an afterthought; inline view is a locator |
| Raw camera dumps — glare, curl, sideways | OS crop step at capture, EXIF normalization on save |
| Storage cost / slow loads | 2000px @ q0.75 downscale before upload, separate 400px thumbs for strips |
| Photo desyncs from audio in mixed sessions | Resolution keyed on (chapter, verse); pill names the chapter |
| Fabric deadlock in the Listen modal | Mount once, toggle opacity |
| UI bloat on photo-less chapters | No section at all until a photo exists |
| Copyright / personal marginalia exposure | Private-only, enforced in rules, no sharing path built |
| Orphaned Storage objects | Delete wired through Firestore doc + both objects + cache |
| App Review rejection | Phase 0 rewrites the now-false photo library permission string |

## Deliberately out of scope

Sharing to circles or groups. OCR or text extraction. Auto-detecting verse
numbers from the image. Multi-page stitching. Annotating on top of the photo —
doodles already exist on the Memory Grid and a second annotation surface would
split the mental model.

Going private-first is reversible; going shared-first is not.
