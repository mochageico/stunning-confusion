// Stage 4, part 2: uploads Bob Souer's BSB reading to Firebase:
//   Storage   audioLibrary/souer/{file}.mp3                 -- work/encoded/ (encode.py)
//   Firestore audioLibrary/souer/chapters/{BOOKID}_{ch}      -- timings/*.json
//   Firestore audioLibrary/souer                             -- reader, credit, licence
//
// Only files that passed encode.py's duration and offset check go up. Files
// already in Storage with the same md5 are skipped, so it's safe to re-run.
// The existing audioLibrary rules (firestore.rules, storage.rules) already
// cover any reader id: public read, no client writes.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"
//   node scripts/bsb-audio/upload.js                  # everything
//   node scripts/bsb-audio/upload.js --only GEN_1,PSA_23   # just these chapters (audio + timings)
//   node scripts/bsb-audio/upload.js --timings        # only the Firestore docs
//
// Uses firebase-admin from scripts/import-bible (run `npm install` there first).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// node-fetch 2 (used inside firebase-admin's auth and storage clients) fails
// with "Premature close" on gzipped replies under Node 24. Asking it for
// uncompressed replies avoids the broken path (as in hebrew-audio/upload.js).
const Module = require('module');
const loadModule = Module._load;
Module._load = function (request, ...rest) {
  const m = loadModule.call(this, request, ...rest);
  if (request !== 'node-fetch' || m.__noCompress) return m;
  const wrapped = (url, opts = {}) => m(url, { ...opts, compress: false });
  Object.assign(wrapped, m, { default: wrapped, __noCompress: true });
  return wrapped;
};

const requireAdmin = Module.createRequire(path.join(__dirname, '..', 'import-bible', 'run.js'));
const admin = requireAdmin('firebase-admin');
const { getFirestore } = requireAdmin('firebase-admin/firestore');
const { getStorage } = requireAdmin('firebase-admin/storage');
const firebaseConfig = require('../../firebase-applet-config.json');
const { READER, BASE_URL } = require('./files');

const ENCODED = path.join(__dirname, 'work', 'encoded');
const TIMINGS = path.join(__dirname, 'timings');
const timingsOnly = process.argv.includes('--timings');
const onlyArg = process.argv[process.argv.indexOf('--only') + 1];
const only = process.argv.includes('--only') ? new Set(onlyArg.split(',')) : null;
const PARALLEL = 6;

const READER_DOC = {
  reader: 'Bob Souer',
  translation: 'BSB',
  credit: 'BSB reading by Bob Souer, public domain (CC0 1.0)',
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  source: BASE_URL,
};

async function uploadAudio(bucket) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ENCODED, 'manifest.json'), 'utf-8'));
  const failed = manifest.filter((r) => !r.ok).map((r) => r.name);
  if (failed.length) throw new Error(`${failed.length} files failed encode.py's check: ${failed.join(' ')}`);
  const todo = manifest.filter((r) => !only || only.has(`${r.bookId}_${r.chapter}`));
  let uploaded = 0;
  let skipped = 0;
  let bytes = 0;
  let next = 0;
  const started = Date.now();
  async function worker() {
    while (next < todo.length) {
      const r = todo[next++];
      const buf = fs.readFileSync(path.join(ENCODED, r.name));
      const md5 = crypto.createHash('md5').update(buf);
      if (md5.copy().digest('hex') !== r.md5) throw new Error(`${r.name} changed since encode.py checked it`);
      const remote = bucket.file(`audioLibrary/${READER}/${r.name}`);
      const [exists] = await remote.exists();
      if (exists) {
        const [meta] = await remote.getMetadata();
        if (meta.md5Hash === md5.digest('base64')) {
          skipped++;
          continue;
        }
      }
      await remote.save(buf, {
        resumable: false,
        metadata: {
          contentType: 'audio/mpeg',
          // Immutable: a file is never rewritten in place (see lib/audioCache.ts).
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: { reader: READER_DOC.reader, license: READER_DOC.license, source: READER_DOC.source },
        },
      });
      uploaded++;
      bytes += buf.length;
      if (uploaded % 50 === 0) {
        const mbps = (bytes * 8) / 1e6 / ((Date.now() - started) / 1000);
        console.log(`audio: ${uploaded + skipped}/${todo.length} (${mbps.toFixed(1)} Mbit/s)`);
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  console.log(`Audio: ${uploaded} uploaded (${(bytes / 1e9).toFixed(2)} GB), ${skipped} already there.`);
}

async function uploadTimings(db) {
  const files = fs
    .readdirSync(TIMINGS)
    .filter((n) => /^[0-9A-Z]{3}_\d+\.json$/.test(n))
    .filter((n) => !only || only.has(n.replace('.json', '')));
  for (let i = 0; i < files.length; i += 400) {
    const batch = db.batch();
    for (const name of files.slice(i, i + 400)) {
      const doc = JSON.parse(fs.readFileSync(path.join(TIMINGS, name), 'utf-8'));
      batch.set(db.doc(`audioLibrary/${READER}/chapters/${name.replace('.json', '')}`), doc);
    }
    await batch.commit();
  }
  await db.doc(`audioLibrary/${READER}`).set({ ...READER_DOC, uploadedAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log(`Timings: ${files.length} chapters written, plus the reader doc.`);
}

async function main() {
  const app = admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: firebaseConfig.storageBucket,
  });
  // The app's named database, not "(default)" -- same as import-bible/run.js.
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  if (!timingsOnly) await uploadAudio(getStorage(app).bucket());
  await uploadTimings(db);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
