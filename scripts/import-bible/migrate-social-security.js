#!/usr/bin/env node
// One-off cleanup that goes with the 2026-10-18 social-security rules change
// (see firestore.rules: emailLookup, circleInvites, friends). The new rules
// stop NEW bad data; this fixes data that already exists:
//
//   1. Emails. Every profiles/{uid} doc used to carry `email`, and profiles
//      are listable by any signed-in user. The app strips it on each user's
//      next sign-in, but anyone who doesn't open the app keeps leaking until
//      this runs. Moves each one to emailLookup/{email} -> { uid } (so Find
//      Friends by email keeps working) and deletes the profile field.
//   2. Invite codes. Join-by-code now resolves through circleInvites/{code}.
//      Circles created before that have no lookup doc until a member opens
//      them in the new app version; this backfills all of them at once.
//   3. Fake friendships. The old friends rule let anyone write themselves
//      into anyone's friend list without a request. Lists every friends doc
//      with NO accepted friendRequests doc between the two people (either
//      direction), and with --apply deletes both sides of each such pair.
//      Review the dry-run list first: a real friendship only shows up here
//      if its accepted request was deleted by hand.
//
// Safety: dry run by default -- prints what it would do, writes nothing.
//
// Usage (from this folder, with GOOGLE_APPLICATION_CREDENTIALS set -- see
// README.md):
//   node migrate-social-security.js            # dry run
//   node migrate-social-security.js --apply    # actually writes

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const firebaseConfig = require('../../firebase-applet-config.json');

const apply = process.argv.includes('--apply');

async function commitInChunks(db, ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
}

async function migrateEmails(db) {
  const profiles = await db.collection('profiles').get();
  const ops = [];
  let count = 0;
  profiles.forEach((p) => {
    if (!('email' in p.data())) return;
    count++;
    const email = String(p.data().email || '').trim().toLowerCase();
    if (email && !email.includes('/')) {
      ops.push((b) => b.set(db.doc(`emailLookup/${email}`), { uid: p.id }));
    }
    ops.push((b) => b.update(p.ref, { email: FieldValue.delete() }));
  });
  console.log(`\n[1] Profiles still carrying an email: ${count} (of ${profiles.size})`);
  if (apply && ops.length) await commitInChunks(db, ops);
}

async function backfillInvites(db) {
  const circles = await db.collection('circles').get();
  const ops = [];
  for (const c of circles.docs) {
    const code = c.data().inviteCode;
    if (!code) continue;
    const invite = await db.doc(`circleInvites/${code}`).get();
    if (invite.exists) {
      if (invite.data().circleId !== c.id) {
        console.log(`    ! code ${code} already points at ${invite.data().circleId}, not ${c.id} -- left alone`);
      }
      continue;
    }
    ops.push((b) => b.set(invite.ref, { circleId: c.id }));
  }
  console.log(`\n[2] Circles missing an invite lookup: ${ops.length} (of ${circles.size})`);
  if (apply && ops.length) await commitInChunks(db, ops);
}

async function pruneUnbackedFriendships(db) {
  const accepted = new Set();
  const requests = await db.collection('friendRequests').where('status', '==', 'accepted').get();
  requests.forEach((r) => {
    const { fromUid, toUid } = r.data();
    accepted.add([fromUid, toUid].sort().join('_'));
  });

  const friendDocs = await db.collectionGroup('friends').get();
  const ops = [];
  const pairs = new Set();
  friendDocs.forEach((f) => {
    // profiles/{userId}/friends/{friendUid}
    const userId = f.ref.parent.parent && f.ref.parent.parent.id;
    if (!userId || f.ref.parent.parent.parent.id !== 'profiles') return;
    const pair = [userId, f.id].sort().join('_');
    if (accepted.has(pair)) return;
    if (!pairs.has(pair)) console.log(`    - ${userId} <-> ${f.id}`);
    pairs.add(pair);
    ops.push((b) => b.delete(f.ref));
  });
  console.log(`\n[3] Friendships with no accepted request behind them: ${pairs.size} pair(s), ${ops.length} doc(s)`);
  if (apply && ops.length) await commitInChunks(db, ops);
}

async function main() {
  const app = admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  console.log(apply ? 'APPLYING changes.' : 'Dry run -- nothing will be written. Re-run with --apply to write.');
  await migrateEmails(db);
  await backfillInvites(db);
  await pruneUnbackedFriendships(db);
  console.log(apply ? '\nDone.' : '\nDry run complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
