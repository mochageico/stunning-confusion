# Offline mode — plan

Brainstormed 2026-10-29. Nothing built yet.

## Why

Today, with no signal:

- **Opening the app** — sign-in is remembered, but the verses can't load, so after the 8-second loading cap the app opens **empty**. Nothing is deleted (the auto-sync's hydration guard holds), but nothing can be reviewed.
- **Losing signal mid-use** — reviews keep working; their Firestore writes wait in the SDK's in-memory queue. **If the app is closed before signal returns, those reviews are lost.** (On the phone the Firestore SDK has no persistent cache: it relies on IndexedDB, which React Native doesn't have.)
- **Already fine** — chapters opened before (`fetchChapterText` caches them in AsyncStorage), downloaded recordings (`useAudioDownloads`), and each verse's own text (stored on the queue item).

Faster launch is **not** a goal: the online launch wait is ~1.5 s and an instant-launch cache was turned down as not worth the risk.

## Decisions

| Question | Decision |
|---|---|
| What works offline | Reviewing, learning (incl. pulling the next waiting verse), reading saved chapters, adding verses |
| Online launch | **Unchanged.** The phone's copy is used only when the server can't be reached |
| Two devices change the same verse | **Keep both.** Both reviews go into the history; the verse's step comes from the most recent one |
| Showing offline state | Small quiet "Offline — will sync later" pill, plus a count of changes waiting to send |
| Community offline | Read-only: last-seen chats and circles, send box greyed with "Needs signal" |
| Recording offline | Record now, upload (and studio-process) later, marked "waiting to upload" |
| Spoken grading offline | If Apple's recogniser needs the network, fall back to self-check (and typing), with a note |
| Adding verses offline | **Saved chapters only** — no book/Bible downloads, since most people use licensed translations that can't be stored long-term |

## Build stages

Each stage ships on its own and is useful by itself.

1. **Nothing done offline is ever lost.** *(Built 2026-10-29: `src/lib/queueOutbox.ts` (logic, `npm run check:outbox`) and `queueOutboxStore.ts` (file), hooked into the auto-sync and `loadUserData`. The merge rule from stage 4 is already in: `applyOutbox` / `mergeVerse`. Needs an airplane-mode test on the phone.)* Every verse write also goes into a "to send" list saved on the phone (a file via expo-file-system, not AsyncStorage — 700 verses with full histories can exceed Android's per-entry limit). An entry is removed only once Firestore confirms it. On every launch, anything left is sent. This fixes the data-loss gap even before the rest exists.
2. **A copy of your verses on the phone.** *(Built 2026-10-29: `src/lib/localCopy.ts` (logic, `npm run check:localcopy`) and `localCopyStore.ts` (file, sharing `deviceFile.ts` with the outbox). The queue saved is what Firestore holds (the auto-sync's baseline), not the live queue, so the "to send" list goes on top of it exactly as on a server load; entries come off the list only after the copy holds them. Each part is saved only if the load really read it, so a failed read never overwrites the copy with defaults. Removed on account deletion. Nothing reads it yet — that's stage 3.)* After each successful load and save, the verse list and the settings the app reads at launch (plan, rhythm, ladder prefs) are saved to a file.
3. **Offline launch.** If the server can't be reached, open from the phone's copy (plus the "to send" list on top) instead of opening empty. While offline:
   - the queue auto-sync writes only to the "to send" list, never straight from the phone copy;
   - the review-ladder catch-up in `loadUserData` (late reviews, welcome-back spread, migration) does **not** run — it waits for the first online load;
   - due reviews still show, since they come from dates.
4. **Coming back online.** Load from the server as normal, then merge in the "to send" list per verse: union `touchLogs` and `reviewLogs` by timestamp (keep both), and take the verse's step, due date and day result from whichever side has the latest review. Then send. Needs its own check script, like `check:queue`.
5. **Offline pill and pending count.** Detect offline from failed or timed-out server reads (or add `@react-native-community/netinfo` — a native module, so a new build; run `npx expo install --check` first).
6. **Community read-only.** Save the last-seen chat and circle lists to the phone; grey out sending.
7. **Offline recordings.** Keep the audio file on the phone with an upload queue; upload and process when back online.
8. **Speech.** Test Apple's recogniser in airplane mode on the phone. If it fails, fall back to self-check with a note.
9. **Adding verses from saved chapters.** Check that the whole Add Verses flow works from cached chapters, with writes going to the "to send" list.

## Open questions

- **Licensed text going stale.** Cached api.bible chapters expire by licence (`cacheTtlMs`). Fine for short offline stretches; how should a long one behave?
- **Signing out with changes still waiting to send.** Probably warn, and refuse until they're sent.
- **Web version.** The browser does have IndexedDB, so Firestore's own persistent cache would work there. Phone-only offline mode may be enough.
- **Day boundaries while offline.** Reviews done offline across midnight must keep their real timestamps, so day results land on the right day.
