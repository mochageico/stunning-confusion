// Downloads Bob Souer's BSB reading (1,189 chapter MP3s, ~5 GB) into ./sources,
// byte-for-byte, one file at a time rather than the 5 GB zips, so a failed run
// only costs one file. openbible.com publishes no checksums, so each file is
// checked against its Content-Length and must parse as whole MP3 frames.
// Safe to re-run: files already present are skipped (a partly fetched file
// only ever exists as *.part).
//
// Also checks that every chapter of our BSB has exactly one file, and writes
// sources/manifest.json (file, book id, chapter, bytes, seconds, bitrate).
//
//   node scripts/bsb-audio/download.js

const fs = require('fs');
const path = require('path');
const { ALL_BIBLE_BOOKS } = require('../import-bible/books');
const { BASE_URL, downloadUrl, parseFileName } = require('./files');

const OUT = path.join(__dirname, 'sources');
const USFX = path.join(__dirname, '..', 'import-bible', 'engbsb_usfx.xml');
const CONCURRENCY = 4;

async function fetchWithRetry(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const expected = Number(res.headers.get('content-length'));
      if (expected && buf.length !== expected) throw new Error(`got ${buf.length} bytes, expected ${expected}`);
      return buf;
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

// MPEG audio layer III frame tables (bitrates in kbps, sample rates in Hz).
const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Walks the MP3's frames: { seconds, sampleRate, channels, kbps (average), cbr }.
 * Throws if the frames don't run cleanly to the end, which catches a truncated
 * download that Content-Length alone wouldn't (e.g. a server-side short file).
 */
function mp3Info(buf) {
  let pos = 0;
  if (buf.slice(0, 3).toString('latin1') === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    pos = 10 + size + (buf[5] & 0x10 ? 10 : 0);
  }
  let samples = 0;
  let frames = 0;
  let audioBytes = 0;
  let sampleRate = 0;
  let channels = 0;
  const rates = new Set();
  while (pos + 4 <= buf.length) {
    const h = buf.readUInt32BE(pos);
    if ((h & 0xffe00000) >>> 0 !== 0xffe00000) {
      // A trailing ID3v1 tag (or APE tag) is fine; anything else mid-file is not.
      if (buf.slice(pos, pos + 3).toString('latin1') === 'TAG' || buf.slice(pos, pos + 8).toString('latin1') === 'APETAGEX') break;
      throw new Error(`no MP3 frame at byte ${pos} of ${buf.length}`);
    }
    const version = (h >>> 19) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (h >>> 17) & 3; // 1 = layer III
    const kbps = BITRATES[version === 3 ? 1 : 2][(h >>> 12) & 15];
    const sr = (SAMPLE_RATES[version] || [])[(h >>> 10) & 3];
    if (layer !== 1 || !kbps || !sr) throw new Error(`bad MP3 frame header at byte ${pos}`);
    const padding = (h >>> 9) & 1;
    const perFrame = version === 3 ? 1152 : 576;
    const len = Math.floor(((perFrame / 8) * kbps * 1000) / sr) + padding;
    if (pos + len > buf.length + 1) throw new Error(`last frame cut short at byte ${pos}`);
    sampleRate = sr;
    channels = ((h >>> 6) & 3) === 3 ? 1 : 2;
    rates.add(kbps);
    samples += perFrame;
    frames++;
    audioBytes += len;
    pos += len;
  }
  if (!frames) throw new Error('no MP3 frames');
  const seconds = samples / sampleRate;
  return { seconds, sampleRate, channels, kbps: Math.round((audioBytes * 8) / seconds / 1000), cbr: rates.size === 1 };
}

/** Chapter numbers per book in our BSB import, so the audio is checked against the text users see. */
function bsbChapters() {
  const xml = fs.readFileSync(USFX, 'utf8');
  const out = {};
  for (const m of xml.matchAll(/<book id="([A-Z0-9]{3})">([\s\S]*?)<\/book>/g)) {
    out[m[1]] = [...m[2].matchAll(/<c id="(\d+)"[^>]*\/>/g)].map((c) => Number(c[1]));
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const index = await (await fetch(BASE_URL)).text();
  const names = [...new Set([...index.matchAll(/href="(BSB_[^"]+\.mp3)"/g)].map((m) => m[1]))];
  const unknown = names.filter((n) => !parseFileName(n));
  if (unknown.length) throw new Error(`Unrecognised file names: ${unknown.join(', ')}`);
  console.log(`${names.length} MP3s listed`);

  // Every chapter of our BSB has exactly one file, and there are no extras.
  const have = new Map();
  for (const n of names) {
    const { bookId, chapter } = parseFileName(n);
    const key = `${bookId}_${chapter}`;
    if (have.has(key)) throw new Error(`Two files for ${key}: ${have.get(key)}, ${n}`);
    have.set(key, n);
  }
  const text = bsbChapters();
  const missing = [];
  for (const book of ALL_BIBLE_BOOKS) {
    const chapters = text[book.id] || [];
    if (chapters.length !== book.chapters) console.warn(`${book.id}: BSB text has ${chapters.length} chapters, books.js says ${book.chapters}`);
    for (const c of chapters) if (!have.delete(`${book.id}_${c}`)) missing.push(`${book.id}_${c}`);
  }
  if (missing.length) console.warn(`No audio for ${missing.length} chapters: ${missing.join(', ')}`);
  if (have.size) console.warn(`Audio with no BSB chapter: ${[...have.values()].join(', ')}`);
  if (!missing.length && !have.size) console.log('Every BSB chapter has exactly one file.');

  let done = 0;
  let fetched = 0;
  const failed = [];
  const queue = [...names];
  const worker = async () => {
    for (let name; (name = queue.shift()); ) {
      const dest = path.join(OUT, name);
      if (!fs.existsSync(dest)) {
        try {
          const buf = await fetchWithRetry(downloadUrl(name));
          mp3Info(buf);
          fs.writeFileSync(dest + '.part', buf);
          fs.renameSync(dest + '.part', dest);
          fetched++;
        } catch (e) {
          failed.push(`${name}: ${e.message}`);
        }
      }
      if (++done % 50 === 0) console.log(`${done}/${names.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failed.length) {
    console.error(`${failed.length} failed (re-run to retry):\n  ${failed.join('\n  ')}`);
    process.exit(1);
  }

  const manifest = names.map((name) => {
    const buf = fs.readFileSync(path.join(OUT, name));
    const info = mp3Info(buf);
    return { name, ...parseFileName(name), bytes: buf.length, seconds: Math.round(info.seconds * 1000) / 1000, kbps: info.kbps, cbr: info.cbr, sampleRate: info.sampleRate, channels: info.channels };
  });
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

  const bytes = manifest.reduce((s, f) => s + f.bytes, 0);
  const hours = manifest.reduce((s, f) => s + f.seconds, 0) / 3600;
  const formats = [...new Set(manifest.map((f) => `${f.kbps} kbps ${f.cbr ? 'CBR' : 'VBR'} ${f.sampleRate} Hz ${f.channels === 1 ? 'mono' : 'stereo'}`))];
  console.log(`Done: ${manifest.length} files, ${fetched} downloaded this run, ${(bytes / 1e9).toFixed(2)} GB, ${hours.toFixed(1)} hours.`);
  console.log(`Formats: ${formats.slice(0, 8).join('; ')}${formats.length > 8 ? ` (+${formats.length - 8} more)` : ''}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
