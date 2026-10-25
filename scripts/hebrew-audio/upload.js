// Uploads the Shmuelof reading to Firebase:
//   Storage   audioLibrary/shmuelof/{file}.mp3   -- the MP3s, byte-for-byte
//   Firestore audioLibrary/shmuelof/chapters/{BOOKID}_{ch}  -- timings/*.json
//
// The licence (CC BY-NC-ND) forbids altered versions, so each file's sha1 is
// checked against archive.org's before it goes up. Files already in Storage
// with the same md5 are skipped, so it's safe to re-run.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"
//   node scripts/hebrew-audio/upload.js            # everything
//   node scripts/hebrew-audio/upload.js --timings  # only the Firestore timings
//
// Uses firebase-admin from scripts/import-bible (run `npm install` there first).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// node-fetch 2 (used inside firebase-admin's auth and storage clients) fails
// with "Premature close" on gzipped replies under Node 24. Asking it for
// uncompressed replies avoids the broken path.
const Module = require('module');
const loadModule = Module._load;
Module._load = function (request, ...rest) {
  const m = loadModule.call(this, request, ...rest);
  if (request !== 'node-fetch' || m.__noCompress) return m;
  const wrapped = (url, opts = {}) => m(url, { ...opts, compress: false });
  Object.assign(wrapped, m, { default: wrapped, __noCompress: true });
  return wrapped;
};

// Resolve firebase-admin as if from scripts/import-bible, so its subpath exports work.
const requireAdmin = require('module').createRequire(path.join(__dirname, '..', 'import-bible', 'run.js'));
const admin = requireAdmin('firebase-admin');
const { getFirestore } = requireAdmin('firebase-admin/firestore');
const { getStorage } = requireAdmin('firebase-admin/storage');
const firebaseConfig = require('../../firebase-applet-config.json');

const READER = 'shmuelof';
const SOURCES = path.join(__dirname, 'sources');
const TIMINGS = path.join(__dirname, 'timings');
const timingsOnly = process.argv.includes('--timings');

async function main() {
  const app = admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: firebaseConfig.storageBucket,
  });
  // The app's named database, not "(default)" -- same as import-bible/run.js.
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  const bucket = getStorage(app).bucket();

  if (!timingsOnly) {
    const manifest = JSON.parse(fs.readFileSync(path.join(SOURCES, 'manifest.json'), 'utf-8'));
    let uploaded = 0;
    for (const [i, f] of manifest.entries()) {
      const local = path.join(SOURCES, f.name);
      const buf = fs.readFileSync(local);
      const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
      if (sha1 !== f.sha1) throw new Error(`${f.name} differs from archive.org's file -- refusing to upload an altered copy`);
      const remote = bucket.file(`audioLibrary/${READER}/${f.name}`);
      const [exists] = await remote.exists();
      if (exists) {
        const [meta] = await remote.getMetadata();
        if (meta.md5Hash === crypto.createHash('md5').update(buf).digest('base64')) continue;
      }
      await remote.save(buf, {
        resumable: false,
        metadata: {
          contentType: 'audio/mpeg',
          // Immutable: a file is never rewritten in place (see lib/audioCache.ts).
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: { reader: 'Abraham Shmuelof', license: 'CC BY-NC-ND 4.0', source: 'archive.org/details/HebBible_AShmuelof' },
        },
      });
      uploaded++;
      if ((i + 1) % 50 === 0) console.log(`audio ${i + 1}/${manifest.length}`);
    }
    console.log(`Audio: ${uploaded} uploaded, ${manifest.length - uploaded} already there.`);
  }

  const files = fs.readdirSync(TIMINGS).filter((n) => /^[0-9A-Z]{3}_\d+\.json$/.test(n));
  const empty = [];
  for (let i = 0; i < files.length; i += 400) {
    const batch = db.batch();
    for (const name of files.slice(i, i + 400)) {
      const doc = JSON.parse(fs.readFileSync(path.join(TIMINGS, name), 'utf-8'));
      if (Object.keys(doc.verses).length === 0) {
        empty.push(name);
        continue;
      }
      batch.set(db.doc(`audioLibrary/${READER}/chapters/${name.replace('.json', '')}`), doc);
    }
    await batch.commit();
  }
  await db.doc(`audioLibrary/${READER}`).set({
    reader: 'Abraham Shmuelof',
    license: 'CC BY-NC-ND 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
    source: 'https://archive.org/details/HebBible_AShmuelof',
    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`Timings: ${files.length - empty.length} chapters written${empty.length ? `, ${empty.length} skipped as empty: ${empty.join(' ')}` : ''}.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
