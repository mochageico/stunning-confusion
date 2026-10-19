# Social security fix — test plan (2026-10-18)

What changed: `firestore.rules` stops trusting client-written fields for friends, DMs,
circles, shared recordings, nudges, and email search. `src/state/useAppState.ts` was
updated so every normal flow still passes the new rules.

## Order of operations (important)

1. Ship the new app build first (or at the same time). **Old builds break against the
   new rules** in these places: accepting a friend request, creating a circle,
   joining a private circle by code, DMs and race challenges between circle-mates
   (not friends), and -- for anyone with "Friends" verse sharing on -- the profile
   stats sync (old builds still write the verse list onto the profile, which is now
   refused).
2. Deploy the rules: `firebase deploy --only firestore:rules`.
3. Run the one-off cleanup in `scripts/import-bible/`:
   `node migrate-social-security.js` (dry run), read the output, then
   `node migrate-social-security.js --apply`. It removes emails from old profiles,
   backfills invite-code lookups for old circles, lists/deletes friendships that
   have no accepted request behind them, and moves each "Friends" verse list off the
   profile into its friends-only `shared/memoryQueue` doc.

## Happy paths — two test accounts, A and B, on the new build

| # | Flow | Expected |
|---|------|----------|
| 1 | A searches B by exact email | B appears, **no email shown** under the name |
| 2 | A searches B by name prefix | B appears |
| 3 | A sends B a friend request; B accepts | Both see each other as friends |
| 4 | B declines a request; A sends again | Second request arrives |
| 5 | A unfriends B; A sends a new request; B accepts | Friends again |
| 6 | A sends B a nudge | B receives it |
| 7 | A DMs B (friends) | Messages send both ways |
| 8 | A creates a **private** circle; B joins with the code | B is in, sees chat + plans |
| 9 | A creates a **public** circle; B joins from browse | B is in |
| 10 | A and B in a circle, NOT friends: A DMs B | Messages send |
| 11 | Leader A removes B; B tries the code again | "The circle's leader removed you…" |
| 12 | A shares a recording to circle | B sees it in the feed |
| 13 | A disbands a circle that has messages, reactions, a challenge with participants | Disbands without error; B's circle list drops it |
| 14 | Old circle (made before this change): a member opens it, then someone joins by its code | Join works |
| 15 | Delete account (test account) | Succeeds |
| 16 | A challenges friend B to a race (DM or B's profile) | B gets the challenge card |
| 17 | A and B in a circle, NOT friends: A challenges B | Challenge sends |
| 18 | B sets Settings > verse visibility to Friends; A (friend) opens B's profile | A sees B's verse list |
| 19 | B flips visibility back to Private; A reopens B's profile | List is gone |

## Attack checks — each must be refused (permission-denied)

Run from a signed-in test account's browser console (web build) or a scratch script
with the client SDK. These are what the holes allowed before.

| Hole | Attempt | Rule that now blocks it |
|---|---|---|
| 1 | Write `profiles/{victim}/friends/{me}` and `profiles/{me}/friends/{victim}` with no request | friends `create` needs an accept in the same write |
| 1 | Re-accept an old `accepted` request after unfriending, as the **sender** | only the recipient may set `accepted`, stamped with server time |
| 1 | Create `friendRequests/{me}_{x}` with `status: 'accepted'` | create requires `pending` |
| 2 | `setDoc(sharedRecordings/{someoneElsesId}, {ownerId: me, ...})` | update checks the existing owner |
| 3 | List `circles` where `inviteCode == X` | private circle docs are members-only |
| 3 | Create `circles/{privateId}/members/{me}` with no / wrong `inviteCode` | join rule checks the real code |
| 3 | Rejoin after a kick | `banned/{uid}` blocks the join |
| 3 | Create `circleInvites/{code}` pointing at another circle | must match that circle's real code, and you must be a member |
| 4 | Copy victim's `circleIds` into own profile, then create `dmThreads/{a}_{b}` | gate now checks real member docs in `viaCircleId` |
| 4 | Create a thread with a `viaCircleId` you're in but the victim isn't | both must be members |
| 5 | List `profiles` and read `email` | field no longer exists after cleanup script |
| 5 | List `emailLookup` | `list: false` |
| 6 | Nudge a non-friend | needs a real friends doc |
| 6 | 501-char nudge / 2001-char DM or circle message | length caps |
| 7 | Create `challenges/{x}` aimed at a stranger (not friend, no shared circle) | create needs `dmGated` (friend or real co-member in `viaCircleId`) |
| 7 | Create a challenge with a third uid in `participantUids` | must be exactly sender + recipient |
| 8 | Non-friend gets `profiles/{B}/shared/memoryQueue` | friends-only read |
| 8 | List `profiles` and read `sharedMemoryQueue` | field gone after cleanup; profile writes can't add it back |

## How this was verified so far

- No emulator: Java isn't installed on this machine, so the Firestore emulator (and
  rules unit tests) can't run. Install a JDK (e.g. Temurin 21) and the emulator tests
  could be added later.
- Rules compile against the real project with `firebase deploy --only firestore:rules --dry-run`
  (compile-only, nothing deployed).
- App code type-checks (`tsc --noEmit`, no errors in `src/`).
- Each flow above was traced by hand against the new rules; none has been run live yet.
