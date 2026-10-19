# Social features: going live (2026-10-18)

This branch adds, on top of the security fixes (see `SOCIAL_SECURITY_TEST_PLAN.md`):

- **Block, report, delete**: block or report anyone from their profile, a chat, or the recordings feed; long-press a message to react, copy, delete your own (or any, as a circle's leader), report, or block. Settings lists blocked people. Community guidelines are agreed to once (App Store guideline 1.2).
- **Notifications**: daily review reminder (local, at a chosen time, only on days with verses) and pushes for DMs, circle chat, friend requests, nudges, challenges, and answers to requests and quizzes. Switches in Settings.
- **Invites**: the circle invite sheet has a working link, a QR code, and Share. The link opens a small page (`hosting/join/index.html`) that hands off to the app, which joins the circle (after sign-up, too).
- **Chat cards**: + in any chat shares a verse, sends a recording, asks for a recording, quizzes a friend (DM), or starts a race (DM).
- **Recording requests**: "I will" opens Record on that passage; saving sends it back to the chat automatically.
- **Quiz a friend**: pick one of their shared verses and how many words to hide; they recite it; the score comes back to the chat. Practice only.
- **Chat polish**: day dividers, times, grouped avatars and names, "New messages" line, unread dots in the inbox, on circles, and on the Community tab.

## Order of operations

The new rules refuse things old app builds do, so the app goes first.

1. **Build the app** (the notifications library is new native code, so an update over the air isn't enough):
   ```bash
   eas build --profile production --platform ios
   ```
   EAS asks whether to set up push notifications for iOS. Answer yes and it creates the Apple push key itself.

2. **Android push** (skip if iOS-only for now): Android pushes go through Google's Firebase Cloud Messaging.
   - In the Firebase console: Project settings > General > Add app > Android, package `com.scripturememory.app`. Download `google-services.json` into the project folder.
   - Add `googleServicesFile: './google-services.json'` under `android` in `app.config.js`.
   - In the Firebase console: Project settings > Service accounts > Generate new private key. Then run `eas credentials`, choose Android > Google Service Account > FCM V1, and upload that key.
   - Review reminders work on Android without any of this; only pushes need it.

3. **Deploy the rules, functions, and invite page** once the new build is in people's hands:
   ```bash
   firebase deploy --only firestore:rules,functions,hosting
   ```
   The first hosting deploy makes `https://bustling-task-lpsvl.web.app/join` live. Until then, invite links show an error page, but the code on the invite sheet still works.

4. **Get report alerts**: put your own account's uid in `functions/.env` as `ADMIN_UIDS=yourUid` (comma-separate several) before deploying functions. Every report then pushes to you. Reports live in the Firebase console under Firestore > `reports`. Apple expects action within 24 hours.

5. **Store links on the invite page**: once the app is listed, fill in `APP_STORE_URL` / `PLAY_STORE_URL` at the bottom of `hosting/join/index.html` and redeploy hosting.

## Things that couldn't be checked here

- **Pushes and reminders** need a real phone with the new build. The web preview can't show them.
- **Firestore triggers on an Enterprise database.** This project's database is on Firebase's Enterprise edition. If `firebase deploy --only functions` refuses the `notify*` triggers, pushes need switching to a callable function the app calls after each send. The reminders, cards, block/report and everything else don't depend on this.
- **Invite links opening the app straight from a text** (no page in between) would need "universal links": an associated-domains entry and an `apple-app-site-association` file. That's optional; the page's "Open in Scripture Memory" button works without it.
- The rules compile (`firebase deploy --only firestore:rules --dry-run`) but haven't been exercised against the live database. The two-account checklist in `SOCIAL_SECURITY_TEST_PLAN.md` covers the friend/DM/circle basics. Add to it:
  - B blocks A: A's DM send, nudge, friend request and challenge all fail; A disappears from B's feed, milestones, inbox and circle chat.
  - A reports a message: a doc appears in `reports`; A can't read it back.
  - A deletes their own DM; the leader removes someone's circle message.
  - A asks B for a recording; B taps "I will", records, saves; the recording card appears in the chat and plays for A.
  - A quizzes B (B shares verses with friends); B takes it; A sees the score.
  - Open an invite link signed out, sign up, finish setup: you land in the circle.

## Where things live

| Piece | File |
|---|---|
| Block, report, unread, card answers | `src/state/useSocial.ts` |
| Push registration, reminders, tap routing | `src/state/usePushNotifications.ts` |
| Push senders (Cloud Functions) | `functions/src/social.ts` |
| Card shapes | `src/lib/chatAttachments.ts` |
| Chat screen (both kinds) | `src/components/chat/ChatView.tsx` |
| Invite link format | `src/lib/invites.ts`, `hosting/join/index.html` |
| Quiz | `src/screens/QuizScreen.tsx` |
| Rules | `firestore.rules` (blocked, reports, users/{uid}/…, responses, attachments) |
