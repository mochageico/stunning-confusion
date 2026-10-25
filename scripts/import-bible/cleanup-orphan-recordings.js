#!/usr/bin/env node
// One-off cleanup for recordings that were "deleted" in the app but left
// pieces behind on the server. Before 2026-10-24, deleting a recording only
// removed the owner's private doc and its audio files -- the copy in
// sharedRecordings (what circles, chats and the Community feed read) stayed
// up forever, and any audio file whose delete failed was never retried.
//
// Finds three kinds of leftovers:
//   1. Audio files in Storage under recordings/{uid}/ with no matching
//      users/{uid}/recordings/{id} doc (raw take and/or its _studio render).
//   2. sharedRecordings/{id} docs whose owner's private doc is gone.
//   3. Nothing else -- saved copies in other people's libraries (saved_* docs)
//      are their own docs and are left alone.
//
// Safety: dry run by default -- prints what it would delete, deletes nothing.
//
// Usage (from this folder, with GOOGLE_APPLICATION_CREDENTIALS set -- see
// README.md):
//   node cleanup-orphan-recordings.js            # dry run
//   node cleanup-orphan-recordings.js --apply    # actually deletes

// node-fetch 2 (inside firebase-admin's auth and storage clients) fails with
// "Premature close" on gzipped replies under Node 24 -- same workaround as
// ../hebrew-audio/upload.js.
const Module = require('module');
const loadModule = Module._load;
Module._load = function (request, ...rest) {
  const m = loadModule.call(this, request, ...rest);
  if (request !== 'node-fetch' || m.__noCompress) return m;
  const wrapped = (url, opts = {}) => m(url, { ...opts, compress: false });
  Object.assign(wrapped, m, { default: wrapped, __noCompress: true });
  return wrapped;
};

const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const admin = require('firebase-admin');
const firebaseConfig = require('../../firebase-applet-config.json');

const apply = process.argv.includes('--apply');
const STUDIO_SUFFIX = '_studio';

async function main() {
  const app = admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: firebaseConfig.storageBucket,
  });
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  const bucket = getStorage(app).bucket();

  const docExists = new Map();
  const exists = async (uid, id) => {
    const key = `${uid}/${id}`;
    if (!docExists.has(key)) docExists.set(key, (await db.doc(`users/${uid}/recordings/${id}`).get()).exists);
    return docExists.get(key);
  };

  // 1. Orphaned audio files
  const [files] = await bucket.getFiles({ prefix: 'recordings/' });
  const orphanFiles = [];
  for (const f of files) {
    const parts = f.name.split('/');
    if (parts.length !== 3 || !parts[2]) continue;
    const [, uid, fileName] = parts;
    const id = fileName.replace(/\.[^.]+$/, '').replace(new RegExp(`${STUDIO_SUFFIX}$`), '');
    if (!(await exists(uid, id))) orphanFiles.push({ f, uid, id, size: Number(f.metadata.size || 0) });
  }

  // A "Save to My Library" copy (users/{saver}/recordings/saved_*) points at
  // the ORIGINAL owner's file rather than copying it, so a file with no doc
  // under its own uid can still be in use. Keep those.
  const inUse = new Set();
  const allRecs = await db.collectionGroup('recordings').get();
  for (const d of allRecs.docs) {
    const { audioPath, studioAudioPath } = d.data();
    if (audioPath) inUse.add(audioPath);
    if (studioAudioPath) inUse.add(studioAudioPath);
  }
  for (let i = orphanFiles.length - 1; i >= 0; i--) {
    if (inUse.has(orphanFiles[i].f.name)) {
      console.log(`  keeping ${orphanFiles[i].f.name} -- a saved copy still uses it`);
      orphanFiles.splice(i, 1);
    }
  }

  // 2. Orphaned shared copies
  const shared = await db.collection('sharedRecordings').get();
  const orphanShared = [];
  for (const d of shared.docs) {
    const data = d.data();
    const owner = data.ownerId || data.userId;
    if (!owner) continue;
    if (!(await exists(owner, d.id))) orphanShared.push({ d, owner, data });
  }

  console.log(`Audio files under recordings/: ${files.length}; orphaned: ${orphanFiles.length}`);
  let bytes = 0;
  for (const o of orphanFiles) {
    bytes += o.size;
    console.log(`  file  ${o.f.name}  (${(o.size / 1048576).toFixed(1)} MB)`);
  }
  console.log(`  total ${(bytes / 1048576).toFixed(1)} MB`);
  console.log(`sharedRecordings docs: ${shared.size}; orphaned: ${orphanShared.length}`);
  for (const o of orphanShared) {
    console.log(`  shared ${o.d.id}  ${o.data.book || '?'} ${o.data.chapter || ''}  owner=${o.owner}  visibility=${o.data.visibility}`);
  }

  if (!apply) {
    console.log('\nDry run -- nothing deleted. Re-run with --apply to delete the above.');
    return;
  }
  for (const o of orphanFiles) await o.f.delete({ ignoreNotFound: true });
  for (const o of orphanShared) await o.d.ref.delete();
  console.log(`\nDeleted ${orphanFiles.length} files and ${orphanShared.length} shared copies.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
