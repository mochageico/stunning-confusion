// Downloads the Shmuelof Hebrew reading (929 MP3s, ~840 MB) into ./sources,
// byte-for-byte, and checks each file's sha1 against archive.org's metadata.
// Safe to re-run: files already present with the right sha1 are skipped.
//
//   node scripts/hebrew-audio/download.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { METADATA_URL, downloadUrl, parseFileName } = require('./files');

const OUT = path.join(__dirname, 'sources');
const CONCURRENCY = 4;

const sha1Of = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

async function fetchWithRetry(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const meta = await (await fetch(METADATA_URL)).json();
  const files = meta.files.filter((f) => f.format === 'VBR MP3' && f.source === 'original');
  const unknown = files.filter((f) => !parseFileName(f.name));
  if (unknown.length) throw new Error(`Unrecognised file names: ${unknown.map((f) => f.name).join(', ')}`);
  console.log(`${files.length} MP3s listed`);

  // Keep the metadata next to the files: sha1s and lengths are reused by align.py and upload.js.
  fs.writeFileSync(
    path.join(OUT, 'manifest.json'),
    JSON.stringify(
      files.map((f) => ({ name: f.name, ...parseFileName(f.name), sha1: f.sha1, bytes: Number(f.size), seconds: Number(f.length) })),
      null,
      1
    )
  );

  let done = 0;
  let fetched = 0;
  const queue = [...files];
  const worker = async () => {
    for (let f; (f = queue.shift()); ) {
      const dest = path.join(OUT, f.name);
      if (!(fs.existsSync(dest) && sha1Of(dest) === f.sha1)) {
        const buf = await fetchWithRetry(downloadUrl(f.name));
        const got = crypto.createHash('sha1').update(buf).digest('hex');
        if (got !== f.sha1) throw new Error(`${f.name}: sha1 ${got}, expected ${f.sha1}`);
        fs.writeFileSync(dest, buf);
        fetched++;
      }
      if (++done % 50 === 0) console.log(`${done}/${files.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`Done: ${files.length} files verified, ${fetched} downloaded this run.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
