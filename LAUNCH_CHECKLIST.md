# Launch checklist

Things that must happen before the app goes public on the App Store. Not
needed for TestFlight.

## Translations

What a stranger can pick in a TestFlight/App Store build today:
BSB, WEB, KJV, Hebrew/Greek, CSB, NASB, NLT.

- **ESV is hidden** from everyone except the accounts in
  `UNRELEASED_TRANSLATION_TESTERS` in `src/data.ts` (currently the
  owner's account plus one more tester). Done 2026-10-25. Nothing to do at launch, unless a
  Crossway licence has come through (then remove `inDevelopment: true` from
  the ESV entry and do everything `capabilityWarningsFor('ESV')` lists).
- **NIV stays out** until Biblica confirms in writing that the memorization
  drills are allowed (see the comment in `src/data.ts`).
- **CSB, NASB and NLT** are licensed free through api.bible on the condition
  the app is never monetised: no ads, fees, subscriptions or upsells.
  Donation links are allowed. Monetising means removing these three.
- **NASB**: Lockman wants a report of distribution numbers every February.

### Before launch: lock the ESV text on the server

Hiding ESV in the picker doesn't stop someone reading its text straight from
Firestore. Every translation's text is world-readable today
(`firestore.rules`, `match /translations/{translationId}`). Before launch,
change that block so ESV can only be read by the tester accounts:

```
match /translations/{translationId} {
  allow read: if translationId != 'ESV'
    || (request.auth != null && request.auth.uid in ['lg9QLmMSlHQhpErSj5UOnmAt20C2', 'D4hglY53zuWR3PVZxngwHhwzhng2']);
  allow write: if false;

  match /books/{bookId}/chapters/{chapterId} {
    allow read: if translationId != 'ESV'
      || (request.auth != null && request.auth.uid in ['lg9QLmMSlHQhpErSj5UOnmAt20C2', 'D4hglY53zuWR3PVZxngwHhwzhng2']);
    allow write: if false;
  }
}
```

Keep the uid list identical to `UNRELEASED_TRANSLATION_TESTERS`. Then deploy
the rules (`firebase deploy --only firestore:rules`) and check that ESV
still loads on the owner's phone and that BSB still loads when signed out.

Deliberately not done yet (decided 2026-10-25): it's only needed once
strangers can download the app.

### Before launch: the sample audio feed

Signed-out visitors see made-up sample recordings labelled ESV, NIV and NKJV
(`SUGGESTED_FEED_RECORDINGS` in `src/data.ts`). It's only labels, not text,
but it advertises translations the app doesn't offer. Relabel them to
translations a stranger can pick.

## Database

- **Indexes deployed** 2026-11-12: 17 indexes, one for every query on a
  collection that grows with users (`firestore.indexes.json`, optimization
  plan Phase 3). The database is Enterprise edition, which makes no indexes by
  itself: a query without one reads, and bills, the whole collection. A new
  `where(` / `orderBy(` on a shared collection needs its index added to that
  file and deployed (`npx firebase-tools deploy --only firestore:indexes
  --non-interactive`). Check with `npx firebase-tools firestore:indexes
  --database ai-studio-da1c3045-26bb-470c-883c-0b120417bcda`.
- **Revisit: chat unread dots** (`useSocial.ts`, the "One tiny listener per
  circle" effect). Each circle a person is in keeps one live database
  listener open for its newest message. Fine for a few circles. If people
  start joining many (say 10 or more), revisit: each listener is a little
  phone memory and one read per new message. Left as is in optimization plan
  Phase 5 (2026-11-12).
